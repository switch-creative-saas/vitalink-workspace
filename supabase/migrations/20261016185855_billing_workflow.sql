-- Patient billing: price list, invoices built from unbilled appointments / lab
-- tests / dispensed drugs (each source billed once), a payments ledger, and HMO
-- claims. Invoice totals, amount paid and status are always computed by the
-- database from line items and payments.

-- ============================================
-- PRICE LIST
-- ============================================

create table public.service_prices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  category text not null check (category in ('consultation','lab','procedure','room','imaging','supplies','other')),
  name text not null check (char_length(btrim(name)) > 0),
  price_kobo bigint not null check (price_kobo >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index service_prices_unique_name on public.service_prices (organization_id, category, lower(name));
create trigger service_prices_set_updated_at before update on public.service_prices
  for each row execute function private.set_updated_at();

alter table public.service_prices enable row level security;
create policy "members read prices" on public.service_prices
  for select to authenticated using (private.is_member(organization_id));
create policy "billing manages prices" on public.service_prices
  for all to authenticated
  using (private.has_role(organization_id, private.billing_manage_roles()))
  with check (private.has_role(organization_id, private.billing_manage_roles()));
revoke all on public.service_prices from anon;

-- Price lookup: exact name in the category, else that category's "Default" entry, else 0.
create or replace function private.price_for(org uuid, p_category text, p_name text)
returns bigint
language sql stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select price_kobo from public.service_prices
     where organization_id = org and category = p_category and is_active and lower(name) = lower(btrim(p_name)) limit 1),
    (select price_kobo from public.service_prices
     where organization_id = org and category = p_category and is_active and lower(name) = 'default' limit 1),
    0)
$$;

-- ============================================
-- LINE ITEMS: where each charge came from
-- ============================================

alter table public.invoice_line_items
  add column source_type text not null default 'manual' check (source_type in ('appointment','lab_result','prescription','manual')),
  add column source_id uuid,
  add constraint invoice_line_items_quantity_positive check (quantity > 0),
  add constraint invoice_line_items_price_not_negative check (unit_price_kobo >= 0);
-- A visit, test or dispensed drug can only be billed once.
create unique index invoice_line_items_bill_once on public.invoice_line_items (source_type, source_id) where source_id is not null;

-- ============================================
-- INVOICES: HMO claim details
-- ============================================

alter table public.invoices
  add column hmo_coverage_percent integer check (hmo_coverage_percent between 0 and 100),
  add column hmo_claimed_kobo bigint check (hmo_claimed_kobo >= 0),
  add column hmo_submitted_at timestamptz,
  add column hmo_resolved_at timestamptz,
  add constraint invoices_discount_not_negative check (discount_kobo >= 0);

-- ============================================
-- PAYMENTS LEDGER
-- ============================================

create table public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  amount_kobo bigint not null check (amount_kobo > 0),
  method text not null check (method in ('cash','card','bank_transfer','pos','hmo','nhis','waiver','paystack')),
  reference text,
  note text,
  received_by uuid references public.profiles (id) on delete set null,
  received_at timestamptz not null default now()
);
create index invoice_payments_invoice_idx on public.invoice_payments (invoice_id);
create index invoice_payments_org_idx on public.invoice_payments (organization_id, received_at desc);
create index invoice_payments_received_by_idx on public.invoice_payments (received_by);

alter table public.invoice_payments enable row level security;
create policy "staff read payments" on public.invoice_payments
  for select to authenticated using (private.has_role(organization_id, private.billing_read_roles()));
create policy "cashiers record payments" on public.invoice_payments
  for insert to authenticated with check (private.has_role(organization_id, private.billing_write_roles()));
create policy "admins reverse payments" on public.invoice_payments
  for delete to authenticated using (private.has_role(organization_id, private.admin_roles()));
revoke all on public.invoice_payments from anon;

create or replace function private.payment_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
begin
  select * into inv from public.invoices where id = new.invoice_id;
  if inv.id is null then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  if inv.status in ('void', 'refunded') then raise exception 'This invoice is %', inv.status using errcode = '22023'; end if;
  new.organization_id := inv.organization_id;
  new.received_by := auth.uid();
  new.received_at := now();
  if new.amount_kobo > inv.total_amount_kobo - inv.amount_paid_kobo then
    raise exception 'Payment is more than the balance of ₦%', to_char((inv.total_amount_kobo - inv.amount_paid_kobo) / 100.0, 'FM999,999,999,990.00') using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger invoice_payments_guard before insert on public.invoice_payments
  for each row execute function private.payment_guard();
create trigger invoice_payments_audit after insert or update or delete on public.invoice_payments
  for each row execute function private.write_audit();

-- ============================================
-- TOTALS / STATUS are derived, never typed in
-- ============================================

create or replace function private.invoice_compute()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lines_total bigint := coalesce((select sum(total_kobo) from public.invoice_line_items where invoice_id = new.id), 0);
  paid bigint := coalesce((select sum(amount_kobo) from public.invoice_payments where invoice_id = new.id), 0);
begin
  new.discount_kobo := least(greatest(coalesce(new.discount_kobo, 0), 0), lines_total);
  new.total_amount_kobo := lines_total - new.discount_kobo;
  new.amount_paid_kobo := paid;
  if new.status not in ('void', 'refunded') then
    new.status := case
      when new.total_amount_kobo > 0 and paid >= new.total_amount_kobo then 'paid'
      when paid > 0 then 'partial'
      else 'unpaid'
    end;
  end if;
  return new;
end;
$$;
create trigger invoices_compute before insert or update on public.invoices
  for each row execute function private.invoice_compute();

-- Line items / payments changing -> recompute the parent invoice.
create or replace function private.touch_invoice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.invoices set updated_at = now() where id = coalesce(new.invoice_id, old.invoice_id);
  return null;
end;
$$;
create trigger invoice_line_items_touch after insert or update or delete on public.invoice_line_items
  for each row execute function private.touch_invoice();
create trigger invoice_payments_touch after insert or delete on public.invoice_payments
  for each row execute function private.touch_invoice();

-- Charges are frozen once money has been taken (void and reissue instead).
create or replace function private.line_item_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
begin
  select * into inv from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if inv.status in ('void', 'refunded') or inv.amount_paid_kobo > 0 then
    raise exception 'Invoice % already has payments or is closed; void it and issue a new one', inv.invoice_number using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger invoice_line_items_guard before insert or update or delete on public.invoice_line_items
  for each row execute function private.line_item_guard();

-- Clients may only edit these invoice fields; totals, amounts and HMO fields come from the database.
revoke update on public.invoices from authenticated;
grant update (discount_kobo, due_date, notes, payment_method, status) on public.invoices to authenticated;

-- ============================================
-- UNBILLED ITEMS + INVOICE BUILDER
-- ============================================

create or replace function public.preview_unbilled_items(p_patient_id uuid)
returns table (source_type text, source_id uuid, description text, category text, quantity integer, unit_price_kobo bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid := (select organization_id from public.patients where id = p_patient_id);
begin
  if org is null or not private.has_role(org, private.billing_write_roles()) then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;

  return query
  select 'appointment'::text, a.id,
         a.type || coalesce(' — ' || nullif(a.department, ''), '') || ' (' || to_char(a.starts_at at time zone 'Africa/Lagos', 'DD Mon YYYY') || ')',
         case when a.type = 'Surgery' then 'procedure' else 'consultation' end,
         1,
         private.price_for(org, case when a.type = 'Surgery' then 'procedure' else 'consultation' end, a.type)
  from public.appointments a
  where a.patient_id = p_patient_id
    and a.status in ('checked-in','in-consultation','completed','waiting-lab','admitted','emergency')
    and not exists (select 1 from public.invoice_line_items li where li.source_type = 'appointment' and li.source_id = a.id)
  union all
  select 'lab_result'::text, l.id,
         l.test_name || ' (' || to_char(l.ordered_at at time zone 'Africa/Lagos', 'DD Mon YYYY') || ')',
         'lab', 1, private.price_for(org, 'lab', l.test_name)
  from public.lab_results l
  where l.patient_id = p_patient_id
    and not exists (select 1 from public.invoice_line_items li where li.source_type = 'lab_result' and li.source_id = l.id)
  union all
  select 'prescription'::text, rx.id,
         coalesce(d.drug_name, rx.drug_name) || coalesce(' · ' || d.batch_number, ''),
         'pharmacy', greatest(coalesce(rx.dispensed_quantity, rx.quantity, 1), 1), coalesce(d.unit_price_kobo, 0)
  from public.prescriptions rx
  left join public.drug_inventory d on d.id = rx.dispensed_inventory_id
  where rx.patient_id = p_patient_id
    and rx.status = 'dispensed'
    and not exists (select 1 from public.invoice_line_items li where li.source_type = 'prescription' and li.source_id = rx.id);
end;
$$;
revoke execute on function public.preview_unbilled_items(uuid) from public, anon;
grant execute on function public.preview_unbilled_items(uuid) to authenticated;

-- p_extra_items: [{ "description": text, "category": text, "quantity": int, "unit_price_kobo": int }]
create or replace function public.build_patient_invoice(
  p_patient_id uuid,
  p_discount_kobo bigint default 0,
  p_due_days integer default 7,
  p_extra_items jsonb default '[]'::jsonb,
  p_payment_method text default null,
  p_notes text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  org uuid := (select organization_id from public.patients where id = p_patient_id);
  inv public.invoices;
  item_count integer;
begin
  if org is null or not private.has_role(org, private.billing_write_roles()) then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;

  insert into public.invoices (organization_id, patient_id, due_date, payment_method, notes)
  values (org, p_patient_id, current_date + greatest(coalesce(p_due_days, 7), 0), p_payment_method, p_notes)
  returning * into inv;

  insert into public.invoice_line_items (invoice_id, description, category, quantity, unit_price_kobo, source_type, source_id)
  select inv.id, u.description, u.category, u.quantity, u.unit_price_kobo, u.source_type, u.source_id
  from public.preview_unbilled_items(p_patient_id) u;

  insert into public.invoice_line_items (invoice_id, description, category, quantity, unit_price_kobo, source_type)
  select inv.id, btrim(x ->> 'description'), coalesce(x ->> 'category', 'other'),
         greatest(coalesce((x ->> 'quantity')::int, 1), 1), greatest(coalesce((x ->> 'unit_price_kobo')::bigint, 0), 0), 'manual'
  from jsonb_array_elements(coalesce(p_extra_items, '[]'::jsonb)) x
  where char_length(btrim(coalesce(x ->> 'description', ''))) > 0;

  select count(*) into item_count from public.invoice_line_items where invoice_id = inv.id;
  if item_count = 0 then
    raise exception 'Nothing to bill: this patient has no unbilled visits, tests or dispensed drugs' using errcode = '22023';
  end if;

  update public.invoices set discount_kobo = greatest(coalesce(p_discount_kobo, 0), 0) where id = inv.id returning * into inv;
  return inv;
end;
$$;
revoke execute on function public.build_patient_invoice(uuid, bigint, integer, jsonb, text, text) from public, anon;
grant execute on function public.build_patient_invoice(uuid, bigint, integer, jsonb, text, text) to authenticated;

-- ============================================
-- HMO CLAIMS
-- ============================================

-- VitaLink's HMO micro-fee by plan (basis points): Enterprise 0.75%, Growth 1%, others 1.5%.
create or replace function private.hmo_fee_bps(org uuid)
returns integer
language sql stable
security definer
set search_path = ''
as $$
  select case coalesce((select private.effective_plan(s) from public.subscriptions s where s.organization_id = org), 'free')
    when 'enterprise' then 75 when 'growth' then 100 else 150 end
$$;

create or replace function public.submit_hmo_claim(p_invoice_id uuid, p_provider text, p_policy_number text, p_coverage_percent integer)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
  claimed bigint;
begin
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null or not private.has_role(inv.organization_id, private.billing_manage_roles()) then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if inv.status in ('void', 'refunded', 'paid') then raise exception 'This invoice is %', inv.status using errcode = '22023'; end if;
  if inv.hmo_claim_status in ('submitted', 'approved') then raise exception 'A claim is already % for this invoice', inv.hmo_claim_status using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_provider, ''))) = 0 then raise exception 'Enter the HMO / insurer' using errcode = '22023'; end if;
  if p_coverage_percent is null or p_coverage_percent not between 1 and 100 then raise exception 'Coverage must be 1-100%%' using errcode = '22023'; end if;

  claimed := least(round(inv.total_amount_kobo * p_coverage_percent / 100.0)::bigint, inv.total_amount_kobo - inv.amount_paid_kobo);
  update public.invoices set
    hmo_provider = btrim(p_provider),
    hmo_policy_number = nullif(btrim(coalesce(p_policy_number, '')), ''),
    hmo_coverage_percent = p_coverage_percent,
    hmo_claimed_kobo = claimed,
    hmo_micro_fee_kobo = round(claimed * private.hmo_fee_bps(inv.organization_id) / 10000.0)::bigint,
    hmo_claim_status = 'submitted',
    hmo_submitted_at = now(),
    hmo_resolved_at = null,
    payment_method = 'hmo'
  where id = inv.id
  returning * into inv;
  return inv;
end;
$$;
revoke execute on function public.submit_hmo_claim(uuid, text, text, integer) from public, anon;
grant execute on function public.submit_hmo_claim(uuid, text, text, integer) to authenticated;

-- Approval books the covered amount as an HMO payment (capped at the balance).
create or replace function public.resolve_hmo_claim(p_invoice_id uuid, p_approved boolean, p_approved_amount_kobo bigint default null)
returns public.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.invoices;
  pay bigint;
begin
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null or not private.has_role(inv.organization_id, private.billing_manage_roles()) then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if inv.hmo_claim_status is distinct from 'submitted' then raise exception 'There is no submitted claim on this invoice' using errcode = '22023'; end if;

  if p_approved then
    pay := least(coalesce(p_approved_amount_kobo, inv.hmo_claimed_kobo, 0), inv.total_amount_kobo - inv.amount_paid_kobo);
    if pay > 0 then
      insert into public.invoice_payments (invoice_id, amount_kobo, method, reference, note)
      values (inv.id, pay, 'hmo', inv.hmo_policy_number, 'HMO claim approved: ' || inv.hmo_provider);
    end if;
    update public.invoices set hmo_claim_status = 'approved', hmo_resolved_at = now(),
      hmo_micro_fee_kobo = round(pay * private.hmo_fee_bps(inv.organization_id) / 10000.0)::bigint
    where id = inv.id returning * into inv;
  else
    update public.invoices set hmo_claim_status = 'rejected', hmo_resolved_at = now(), hmo_micro_fee_kobo = 0
    where id = inv.id returning * into inv;
  end if;
  return inv;
end;
$$;
revoke execute on function public.resolve_hmo_claim(uuid, boolean, bigint) from public, anon;
grant execute on function public.resolve_hmo_claim(uuid, boolean, bigint) to authenticated;
