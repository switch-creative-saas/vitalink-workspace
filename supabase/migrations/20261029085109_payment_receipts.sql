-- Payment receipts. Every payment gets a numbered receipt, written once by a trigger with the
-- hospital's name and contact details as they were when the patient paid, so a reprint months
-- later still matches the original. Billing staff read them; the patient app will read a
-- patient's own receipts from the same table once patient accounts exist.
create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_id uuid not null unique references public.invoice_payments(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  receipt_number text not null,
  facility_name text not null,
  facility_address text,
  facility_phone text,
  facility_email text,
  patient_name text not null,
  patient_switch_id text,
  invoice_number text not null,
  amount_kobo bigint not null,
  method text not null,
  reference text,
  invoice_total_kobo bigint not null,
  paid_to_date_kobo bigint not null,
  balance_kobo bigint not null,
  items jsonb not null default '[]'::jsonb,
  received_by_name text,
  issued_at timestamptz not null default now(),
  unique (organization_id, receipt_number)
);
create index if not exists payment_receipts_patient_idx on public.payment_receipts (patient_id, issued_at desc);
create index if not exists payment_receipts_invoice_idx on public.payment_receipts (invoice_id);

alter table public.payment_receipts enable row level security;
revoke all on public.payment_receipts from anon, authenticated;
grant select on public.payment_receipts to authenticated;
drop policy if exists "staff read receipts" on public.payment_receipts;
create policy "staff read receipts" on public.payment_receipts
  for select to authenticated using (private.has_role(organization_id, private.billing_read_roles()));

-- Writes the receipt for one payment (no-op if it already has one).
create or replace function private.issue_receipt_for(p_payment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  pay public.invoice_payments;
  inv public.invoices;
  org public.organizations;
  pat public.patients;
  seq integer;
  paid bigint;
begin
  select * into pay from public.invoice_payments where id = p_payment_id;
  if pay.id is null or exists (select 1 from public.payment_receipts where payment_id = pay.id) then return; end if;
  select * into inv from public.invoices where id = pay.invoice_id;
  select * into org from public.organizations where id = pay.organization_id;
  select * into pat from public.patients where id = inv.patient_id;
  -- Per-hospital, per-year numbering: RCT-2026-000001.
  perform pg_advisory_xact_lock(hashtext('receipt:' || pay.organization_id::text));
  select coalesce(max(split_part(receipt_number, '-', 3)::integer), 0) + 1 into seq from public.payment_receipts
    where organization_id = pay.organization_id and receipt_number like 'RCT-' || to_char(pay.received_at, 'YYYY') || '-%';
  select coalesce(sum(amount_kobo), 0) into paid from public.invoice_payments
    where invoice_id = pay.invoice_id and (received_at, id) <= (pay.received_at, pay.id);
  insert into public.payment_receipts (
    organization_id, payment_id, invoice_id, patient_id, receipt_number,
    facility_name, facility_address, facility_phone, facility_email,
    patient_name, patient_switch_id, invoice_number,
    amount_kobo, method, reference, invoice_total_kobo, paid_to_date_kobo, balance_kobo, items, received_by_name, issued_at
  ) values (
    pay.organization_id, pay.id, inv.id, inv.patient_id,
    'RCT-' || to_char(pay.received_at, 'YYYY') || '-' || lpad(seq::text, 6, '0'),
    org.name, nullif(concat_ws(', ', nullif(org.address, ''), nullif(org.state, '')), ''), nullif(org.contact_phone, ''), nullif(org.contact_email, ''),
    trim(coalesce(pat.first_name, '') || ' ' || coalesce(pat.last_name, '')), pat.switch_id, inv.invoice_number,
    pay.amount_kobo, pay.method, pay.reference, inv.total_amount_kobo, paid, greatest(inv.total_amount_kobo - paid, 0),
    coalesce((select jsonb_agg(jsonb_build_object('description', regexp_replace(l.description, ' \(no price set\)$', ''),
        'quantity', l.quantity, 'unit_price_kobo', l.unit_price_kobo, 'total_kobo', l.total_kobo) order by l.created_at)
      from public.invoice_line_items l where l.invoice_id = inv.id), '[]'::jsonb),
    (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = pay.received_by),
    pay.received_at
  );
end;
$$;
revoke all on function private.issue_receipt_for(uuid) from public, anon, authenticated;

create or replace function private.issue_receipt()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.issue_receipt_for(new.id);
  return new;
end;
$$;

drop trigger if exists invoice_payments_receipt on public.invoice_payments;
create trigger invoice_payments_receipt after insert on public.invoice_payments
  for each row execute function private.issue_receipt();

-- Receipts for payments taken before this migration, oldest first so numbers follow time.
do $$
declare p record;
begin
  for p in select id from public.invoice_payments order by received_at, id loop
    perform private.issue_receipt_for(p.id);
  end loop;
end $$;
