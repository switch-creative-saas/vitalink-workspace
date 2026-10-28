-- Automatic billing. Clinical actions bill themselves onto the patient's running bill for the visit
-- (an invoice in status 'draft'):
--   lab test ordered (lab_results row)       → lab line, priced from the price list
--   prescription dispensed                   → pharmacy line, priced from the dispensed stock item
--   visit checked in                         → consultation / procedure line, priced from the price list
-- Cancelling the source takes its line back off while the bill is still a draft. Billing staff
-- finalize the bill (draft → unpaid), and drafts left idle for 12 hours are finalized overnight.
-- Totals, payments and status still come from private.invoice_compute.

-- ---------------------------------------------------------------- price list
alter table public.service_prices
  add column if not exists code text,
  add column if not exists unit text not null default 'each';
create unique index if not exists service_prices_unique_code on public.service_prices (organization_id, upper(code)) where code is not null and code <> '';

-- Code first, then exact name, then the category's "default" row, then 0.
create or replace function private.price_for(org uuid, p_category text, p_name text)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select price_kobo from public.service_prices
     where organization_id = org and is_active and coalesce(code, '') <> '' and upper(code) = upper(btrim(p_name)) limit 1),
    (select price_kobo from public.service_prices
     where organization_id = org and category = p_category and is_active and lower(name) = lower(btrim(p_name)) limit 1),
    (select price_kobo from public.service_prices
     where organization_id = org and category = p_category and is_active and lower(name) = 'default' limit 1),
    0)
$$;

-- ---------------------------------------------------------------- invoices: drafts
alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status in ('draft', 'unpaid', 'partial', 'paid', 'void', 'refunded'));
alter table public.invoices add column if not exists finalized_at timestamptz;
create unique index if not exists invoices_one_draft_per_visit
  on public.invoices (organization_id, patient_id, coalesce(appointment_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'draft';

-- A draft stays a draft (it is still collecting charges); everything else follows the payments.
create or replace function private.invoice_compute()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  lines_total bigint := coalesce((select sum(total_kobo) from public.invoice_line_items where invoice_id = new.id), 0);
  paid bigint := coalesce((select sum(amount_kobo) from public.invoice_payments where invoice_id = new.id), 0);
begin
  new.discount_kobo := least(greatest(coalesce(new.discount_kobo, 0), 0), lines_total);
  new.total_amount_kobo := lines_total - new.discount_kobo;
  new.amount_paid_kobo := paid;
  if new.status not in ('void', 'refunded', 'draft') then
    new.status := case
      when new.total_amount_kobo > 0 and paid >= new.total_amount_kobo then 'paid'
      when paid > 0 then 'partial'
      else 'unpaid'
    end;
  end if;
  return new;
end;
$$;

-- Drafts take new charges even after a deposit; a line can come off a draft as long as the bill
-- still covers what was paid. Finalized bills keep the old rule.
create or replace function private.line_item_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  inv public.invoices;
begin
  select * into inv from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if inv.status = 'draft' then
    if tg_op = 'DELETE' and inv.amount_paid_kobo > 0
       and coalesce((select sum(total_kobo) from public.invoice_line_items where invoice_id = inv.id and id <> old.id), 0) - inv.discount_kobo < inv.amount_paid_kobo then
      raise exception 'Removing this would leave % costing less than was paid; refund first', inv.invoice_number using errcode = '42501';
    end if;
    return coalesce(new, old);
  end if;
  if inv.status in ('void', 'refunded') or inv.amount_paid_kobo > 0 then
    raise exception 'Invoice % already has payments or is closed; void it and issue a new one', inv.invoice_number using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

-- The visit a charge belongs to: the one given, else the patient's visit that is active today.
create or replace function private.active_visit(p_patient uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select a.id from public.appointments a
  where a.patient_id = p_patient
    and a.status in ('checked-in', 'in-consultation', 'waiting-lab', 'admitted', 'emergency', 'completed')
    and a.starts_at >= date_trunc('day', now()) - interval '1 day'
  order by (a.status <> 'completed') desc, a.starts_at desc
  limit 1
$$;

-- The patient's running bill for a visit, created on first use.
create or replace function private.open_invoice_for(p_org uuid, p_patient uuid, p_appointment uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_visit uuid := coalesce(p_appointment, private.active_visit(p_patient));
  v_id uuid;
begin
  select id into v_id from public.invoices
  where organization_id = p_org and patient_id = p_patient and status = 'draft'
    and (appointment_id = v_visit or (v_visit is null and appointment_id is null and created_at > now() - interval '24 hours'))
  order by created_at desc limit 1;
  if v_id is null then
    insert into public.invoices (organization_id, patient_id, appointment_id, status, notes)
    values (p_org, p_patient, v_visit, 'draft', 'Running bill, added to automatically')
    on conflict do nothing
    returning id into v_id;
    if v_id is null then -- another charge created it at the same moment
      select id into v_id from public.invoices
      where organization_id = p_org and patient_id = p_patient and status = 'draft'
        and appointment_id is not distinct from v_visit
      order by created_at desc limit 1;
    end if;
  end if;
  return v_id;
end;
$$;

-- Adds one charge for a source, once. Returns quietly if it is already billed.
create or replace function private.bill_charge(p_org uuid, p_patient uuid, p_appointment uuid, p_source_type text, p_source_id uuid,
  p_description text, p_category text, p_quantity integer, p_unit_price bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.invoice_line_items where source_type = p_source_type and source_id = p_source_id) then return; end if;
  insert into public.invoice_line_items (invoice_id, description, category, quantity, unit_price_kobo, source_type, source_id)
  values (private.open_invoice_for(p_org, p_patient, p_appointment),
          p_description || case when coalesce(p_unit_price, 0) = 0 then ' (no price set)' else '' end,
          p_category, greatest(coalesce(p_quantity, 1), 1), greatest(coalesce(p_unit_price, 0), 0), p_source_type, p_source_id)
  on conflict do nothing;
end;
$$;

-- Takes a source's charge back off its bill while that bill is a draft.
create or replace function private.unbill_charge(p_source_type text, p_source_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_invoice uuid;
begin
  delete from public.invoice_line_items li
  using public.invoices i
  where li.invoice_id = i.id and i.status = 'draft' and li.source_type = p_source_type and li.source_id = p_source_id
  returning li.invoice_id into v_invoice;
  -- A draft emptied this way, with nothing paid, goes too.
  if v_invoice is not null then
    delete from public.invoices i
    where i.id = v_invoice and i.status = 'draft' and i.amount_paid_kobo = 0
      and not exists (select 1 from public.invoice_line_items li where li.invoice_id = i.id);
  end if;
end;
$$;

-- ---------------------------------------------------------------- triggers
create or replace function private.autobill_lab_result()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_visit uuid;
begin
  if tg_op = 'DELETE' then
    perform private.unbill_charge('lab_result', old.id);
    return old;
  end if;
  if new.emr_connection_id is not null then return new; end if; -- results imported from another EMR were billed there
  select n.appointment_id into v_visit from public.clinical_notes n where n.id = new.note_id;
  perform private.bill_charge(new.organization_id, new.patient_id, v_visit, 'lab_result', new.id,
    new.test_name, 'lab', 1, private.price_for(new.organization_id, 'lab', new.test_name));
  return new;
end;
$$;
drop trigger if exists lab_results_autobill on public.lab_results;
create trigger lab_results_autobill after insert or delete on public.lab_results
  for each row execute function private.autobill_lab_result();

create or replace function private.autobill_lab_order_cancel()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    for r in select id from public.lab_results where order_id = new.id loop
      perform private.unbill_charge('lab_result', r.id);
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists lab_orders_autobill on public.lab_orders;
create trigger lab_orders_autobill after update of status on public.lab_orders
  for each row execute function private.autobill_lab_order_cancel();

create or replace function private.autobill_prescription()
returns trigger language plpgsql security definer set search_path = '' as $$
declare d public.drug_inventory;
begin
  if new.status = 'dispensed' and (tg_op = 'INSERT' or old.status is distinct from 'dispensed') then
    select * into d from public.drug_inventory where id = new.dispensed_inventory_id;
    perform private.bill_charge(new.organization_id, new.patient_id, new.appointment_id, 'prescription', new.id,
      coalesce(d.drug_name, new.drug_name) || coalesce(' ' || nullif(d.strength, ''), '') || coalesce(' · batch ' || nullif(d.batch_number, ''), ''),
      'pharmacy', greatest(coalesce(new.dispensed_quantity, new.quantity, 1), 1), coalesce(d.unit_price_kobo, 0));
  elsif tg_op = 'UPDATE' and old.status = 'dispensed' and new.status is distinct from 'dispensed' then
    perform private.unbill_charge('prescription', new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists prescriptions_autobill on public.prescriptions;
create trigger prescriptions_autobill after insert or update of status on public.prescriptions
  for each row execute function private.autobill_prescription();

create or replace function private.autobill_visit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_category text := case when new.type = 'Surgery' then 'procedure' else 'consultation' end;
begin
  if new.status in ('checked-in', 'in-consultation', 'waiting-lab', 'admitted', 'emergency', 'completed')
     and (tg_op = 'INSERT' or old.status not in ('checked-in', 'in-consultation', 'waiting-lab', 'admitted', 'emergency', 'completed')) then
    perform private.bill_charge(new.organization_id, new.patient_id, new.id, 'appointment', new.id,
      new.type || coalesce(' — ' || nullif(new.department, ''), ''), v_category, 1, private.price_for(new.organization_id, v_category, new.type));
  elsif tg_op = 'UPDATE' and new.status in ('cancelled', 'no-show') and old.status is distinct from new.status then
    perform private.unbill_charge('appointment', new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists appointments_autobill on public.appointments;
create trigger appointments_autobill after insert or update of status on public.appointments
  for each row execute function private.autobill_visit();

-- ---------------------------------------------------------------- finalizing
create or replace function public.billing_finalize_invoice(p_invoice_id uuid, p_due_days integer default 7)
returns public.invoices language plpgsql security definer set search_path = '' as $$
declare inv public.invoices;
begin
  select * into inv from public.invoices where id = p_invoice_id for update;
  if inv.id is null or not private.has_role(inv.organization_id, private.billing_write_roles()) then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if inv.status <> 'draft' then return inv; end if;
  if not exists (select 1 from public.invoice_line_items where invoice_id = inv.id) then
    raise exception 'This bill has no charges yet' using errcode = '22023';
  end if;
  update public.invoices set status = 'unpaid', finalized_at = now(),
         due_date = coalesce(due_date, current_date + greatest(coalesce(p_due_days, 7), 0)),
         notes = nullif(replace(coalesce(notes, ''), 'Running bill, added to automatically', ''), '')
  where id = inv.id returning * into inv;
  return inv;
end;
$$;
revoke all on function public.billing_finalize_invoice(uuid, integer) from public, anon;
grant execute on function public.billing_finalize_invoice(uuid, integer) to authenticated;

-- Overnight: drafts with no new charges for 12 hours whose visit is over become normal bills.
create or replace function private.finalize_idle_drafts()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.invoices i set status = 'unpaid', finalized_at = now(), due_date = coalesce(i.due_date, current_date + 7),
         notes = nullif(replace(coalesce(i.notes, ''), 'Running bill, added to automatically', ''), '')
  where i.status = 'draft' and i.updated_at < now() - interval '12 hours'
    and exists (select 1 from public.invoice_line_items li where li.invoice_id = i.id)
    and not exists (select 1 from public.appointments a where a.id = i.appointment_id
                    and a.status in ('checked-in', 'in-consultation', 'waiting-lab', 'admitted', 'emergency'));
  get diagnostics n = row_count;
  delete from public.invoices i where i.status = 'draft' and i.amount_paid_kobo = 0 and i.updated_at < now() - interval '12 hours'
    and not exists (select 1 from public.invoice_line_items li where li.invoice_id = i.id);
  return n;
end;
$$;
select cron.unschedule(jobid) from cron.job where jobname = 'vitalink-finalize-draft-bills';
select cron.schedule('vitalink-finalize-draft-bills', '0 1 * * *', 'select private.finalize_idle_drafts()');
