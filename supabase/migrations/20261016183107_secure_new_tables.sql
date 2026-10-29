-- Hardening for the tables added directly to the live project (prescriptions, drug_inventory,
-- invoices, nfc_card_orders, staff_invitations, sentinel_*):
--   * staff_invitations was readable by anyone (USING true) -> token lookup/accept via RPCs only
--   * pharmacy/billing policies used role names that don't exist ('admin', 'super_admin',
--     'billing_officer') -> real hyphenated roles via helper functions
--   * sentinel facility insert check compared a column with itself
--   * any member could rewrite NFC orders (incl. price/status) -> admins, guarded fields
--   * prescriptions/invoices could point at another org's patient/note/appointment
-- All tables were empty when this ran.

-- ============================================
-- Role helpers (match private.valid_roles())
-- ============================================

create or replace function private.pharmacy_write_roles()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['super-admin','hospital-admin','pharmacist']::text[] $$;

create or replace function private.billing_write_roles()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['super-admin','hospital-admin','billing-officer','insurance-officer','receptionist']::text[] $$;

create or replace function private.billing_manage_roles()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['super-admin','hospital-admin','billing-officer','insurance-officer']::text[] $$;

create or replace function private.billing_read_roles()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['super-admin','hospital-admin','billing-officer','insurance-officer','receptionist','doctor','nurse','pharmacist']::text[] $$;

grant execute on function private.pharmacy_write_roles(), private.billing_write_roles(),
  private.billing_manage_roles(), private.billing_read_roles() to authenticated;

-- Fix the advisor warning on the chat-created helper.
create or replace function private.sentinel_admin_roles()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['admin']::text[] $$;

-- appointments needs (id, organization_id) as a key for same-org foreign keys.
alter table public.appointments add constraint appointments_id_org_key unique (id, organization_id);

-- ============================================
-- PRESCRIPTIONS
-- ============================================

alter table public.prescriptions
  drop constraint prescriptions_patient_id_fkey,
  drop constraint prescriptions_note_id_fkey,
  drop constraint prescriptions_appointment_id_fkey,
  add constraint prescriptions_patient_same_org_fkey
    foreign key (patient_id, organization_id) references public.patients (id, organization_id) on delete cascade,
  add constraint prescriptions_note_same_org_fkey
    foreign key (note_id, organization_id) references public.clinical_notes (id, organization_id) on delete set null (note_id),
  add constraint prescriptions_appointment_same_org_fkey
    foreign key (appointment_id, organization_id) references public.appointments (id, organization_id) on delete set null (appointment_id);
create index idx_prescriptions_patient_org on public.prescriptions (patient_id, organization_id);
create index idx_prescriptions_prescribed_by on public.prescriptions (prescribed_by);
create index idx_prescriptions_dispensed_by on public.prescriptions (dispensed_by);

-- Prescriber/dispenser always reflect the real caller; only pharmacy staff dispense.
create or replace function private.prescription_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.prescribed_by := auth.uid();
    new.status := 'active';
    new.dispensed_at := null;
    new.dispensed_by := null;
    new.dispensed_quantity := null;
    return new;
  end if;
  new.organization_id := old.organization_id;
  new.patient_id := old.patient_id;
  new.prescribed_by := old.prescribed_by;
  if new.status = 'dispensed' and old.status <> 'dispensed' then
    if not private.has_role(old.organization_id, private.pharmacy_write_roles()) then
      raise exception 'Only pharmacy staff can dispense' using errcode = '42501';
    end if;
    new.dispensed_at := now();
    new.dispensed_by := auth.uid();
    new.dispensed_quantity := coalesce(new.dispensed_quantity, new.quantity);
  elsif old.status = 'dispensed' then
    raise exception 'Dispensed prescriptions cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger prescriptions_stamp before insert or update on public.prescriptions
  for each row execute function private.prescription_stamp();
create trigger prescriptions_audit after insert or update or delete on public.prescriptions
  for each row execute function private.write_audit();

drop policy "members_read_prescriptions" on public.prescriptions;
drop policy "clinical_write_prescriptions" on public.prescriptions;
drop policy "clinical_update_prescriptions" on public.prescriptions;
drop policy "admin_delete_prescriptions" on public.prescriptions;

create policy "clinical staff read prescriptions" on public.prescriptions
  for select to authenticated using (private.has_role(organization_id, private.clinical_read_roles()));
create policy "prescribers write prescriptions" on public.prescriptions
  for insert to authenticated with check (private.has_role(organization_id, private.note_write_roles()));
create policy "prescribers and pharmacy update prescriptions" on public.prescriptions
  for update to authenticated
  using (private.has_role(organization_id, private.note_write_roles() || private.pharmacy_write_roles()))
  with check (private.has_role(organization_id, private.note_write_roles() || private.pharmacy_write_roles()));
create policy "admins delete prescriptions" on public.prescriptions
  for delete to authenticated using (private.has_role(organization_id, private.admin_roles()));

-- ============================================
-- DRUG INVENTORY
-- ============================================

create index idx_drug_inventory_created_by on public.drug_inventory (created_by);

create or replace function private.stamp_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := auth.uid();
  return new;
end;
$$;
create trigger drug_inventory_stamp before insert on public.drug_inventory
  for each row execute function private.stamp_created_by();
create trigger drug_inventory_audit after insert or update or delete on public.drug_inventory
  for each row execute function private.write_audit();

drop policy "members_read_drug_inventory" on public.drug_inventory;
drop policy "pharmacist_insert_drug_inventory" on public.drug_inventory;
drop policy "pharmacist_update_drug_inventory" on public.drug_inventory;
drop policy "admin_delete_drug_inventory" on public.drug_inventory;

create policy "members read drug inventory" on public.drug_inventory
  for select to authenticated using (private.is_member(organization_id));
create policy "pharmacy adds stock" on public.drug_inventory
  for insert to authenticated with check (private.has_role(organization_id, private.pharmacy_write_roles()));
create policy "pharmacy updates stock" on public.drug_inventory
  for update to authenticated
  using (private.has_role(organization_id, private.pharmacy_write_roles()))
  with check (private.has_role(organization_id, private.pharmacy_write_roles()));
create policy "admins delete stock" on public.drug_inventory
  for delete to authenticated using (private.has_role(organization_id, private.admin_roles()));

-- ============================================
-- INVOICES + LINE ITEMS
-- ============================================

alter table public.invoices
  drop constraint invoices_patient_id_fkey,
  drop constraint invoices_appointment_id_fkey,
  add constraint invoices_patient_same_org_fkey
    foreign key (patient_id, organization_id) references public.patients (id, organization_id) on delete cascade,
  add constraint invoices_appointment_same_org_fkey
    foreign key (appointment_id, organization_id) references public.appointments (id, organization_id) on delete set null (appointment_id);
create index idx_invoices_patient_org on public.invoices (patient_id, organization_id);
create index idx_invoices_appointment on public.invoices (appointment_id);
create index idx_invoices_created_by on public.invoices (created_by);

-- The invoice number counter is internal; callers can't advance or read it.
revoke all on sequence public.invoice_number_seq from anon, authenticated;

create or replace function private.invoice_stamp()
returns trigger
language plpgsql
security definer  -- needs the revoked invoice_number_seq
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.invoice_number := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0');
  else
    new.organization_id := old.organization_id;
    new.patient_id := old.patient_id;
    new.invoice_number := old.invoice_number;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;
alter table public.invoices alter column invoice_number drop default;
create trigger invoices_stamp before insert or update on public.invoices
  for each row execute function private.invoice_stamp();
create trigger invoices_audit after insert or update or delete on public.invoices
  for each row execute function private.write_audit();

drop policy "members_read_invoices" on public.invoices;
drop policy "billing_insert_invoices" on public.invoices;
drop policy "billing_update_invoices" on public.invoices;
drop policy "admin_delete_invoices" on public.invoices;

create policy "staff read invoices" on public.invoices
  for select to authenticated using (private.has_role(organization_id, private.billing_read_roles()));
create policy "billing creates invoices" on public.invoices
  for insert to authenticated with check (private.has_role(organization_id, private.billing_write_roles()));
create policy "billing updates invoices" on public.invoices
  for update to authenticated
  using (private.has_role(organization_id, private.billing_manage_roles()))
  with check (private.has_role(organization_id, private.billing_manage_roles()));
create policy "admins delete invoices" on public.invoices
  for delete to authenticated using (private.has_role(organization_id, private.admin_roles()));

drop policy "members_read_line_items" on public.invoice_line_items;
drop policy "billing_insert_line_items" on public.invoice_line_items;
drop policy "billing_delete_line_items" on public.invoice_line_items;

create policy "staff read line items" on public.invoice_line_items
  for select to authenticated using (exists (
    select 1 from public.invoices i
    where i.id = invoice_line_items.invoice_id and private.has_role(i.organization_id, private.billing_read_roles())
  ));
create policy "billing adds line items" on public.invoice_line_items
  for insert to authenticated with check (exists (
    select 1 from public.invoices i
    where i.id = invoice_line_items.invoice_id and private.has_role(i.organization_id, private.billing_write_roles())
  ));
create policy "billing updates line items" on public.invoice_line_items
  for update to authenticated
  using (exists (
    select 1 from public.invoices i
    where i.id = invoice_line_items.invoice_id and private.has_role(i.organization_id, private.billing_manage_roles())
  ))
  with check (exists (
    select 1 from public.invoices i
    where i.id = invoice_line_items.invoice_id and private.has_role(i.organization_id, private.billing_manage_roles())
  ));
create policy "billing removes line items" on public.invoice_line_items
  for delete to authenticated using (exists (
    select 1 from public.invoices i
    where i.id = invoice_line_items.invoice_id and private.has_role(i.organization_id, private.billing_manage_roles())
  ));

-- ============================================
-- NFC CARD ORDERS
-- ============================================

create index idx_nfc_orders_ordered_by on public.nfc_card_orders (ordered_by);

-- Price, payment and fulfilment fields are set by VitaLink (service role / webhooks);
-- workspace admins can only place orders, edit delivery details and cancel early.
create or replace function private.nfc_order_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;  -- service role
  end if;
  if tg_op = 'INSERT' then
    new.ordered_by := auth.uid();
    new.price_per_card_kobo := 250000;
    new.delivery_fee_kobo := 0;
    new.status := 'processing';
    new.paystack_reference := null;
    new.tracking_number := null;
    new.estimated_delivery_date := null;
    new.ordered_at := now();
    if new.quantity < 100 then
      raise exception 'NFC VitaCards are ordered in packs of at least 100' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.status is distinct from old.status
     and not (new.status = 'cancelled' and old.status in ('processing', 'confirmed')) then
    raise exception 'Order status is updated by VitaLink' using errcode = '42501';
  end if;
  if old.status not in ('processing', 'confirmed') then
    raise exception 'This order can no longer be changed' using errcode = '42501';
  end if;
  new.organization_id := old.organization_id;
  new.ordered_by := old.ordered_by;
  new.quantity := old.quantity;
  new.price_per_card_kobo := old.price_per_card_kobo;
  new.delivery_fee_kobo := old.delivery_fee_kobo;
  new.paystack_reference := old.paystack_reference;
  new.tracking_number := old.tracking_number;
  new.estimated_delivery_date := old.estimated_delivery_date;
  new.ordered_at := old.ordered_at;
  return new;
end;
$$;
create trigger nfc_orders_guard before insert or update on public.nfc_card_orders
  for each row execute function private.nfc_order_guard();

drop policy "members_read_nfc_orders" on public.nfc_card_orders;
drop policy "admin_insert_nfc_orders" on public.nfc_card_orders;
drop policy "admin_update_nfc_orders" on public.nfc_card_orders;

create policy "members read nfc orders" on public.nfc_card_orders
  for select to authenticated using (private.is_member(organization_id));
create policy "admins place nfc orders" on public.nfc_card_orders
  for insert to authenticated with check (private.has_role(organization_id, private.admin_roles()));
create policy "admins edit nfc orders" on public.nfc_card_orders
  for update to authenticated
  using (private.has_role(organization_id, private.admin_roles()))
  with check (private.has_role(organization_id, private.admin_roles()));

-- ============================================
-- STAFF INVITATIONS
-- ============================================

create index idx_staff_invitations_invited_by on public.staff_invitations (invited_by);
create index idx_staff_invitations_accepted_by on public.staff_invitations (accepted_by);
create unique index staff_invitations_one_open_per_email
  on public.staff_invitations (organization_id, lower(email)) where not accepted;

create or replace function private.invitation_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.invited_by := auth.uid();
    new.email := lower(btrim(new.email));
    new.accepted := false;
    new.accepted_by := null;
    new.accepted_at := null;
  else
    new.organization_id := old.organization_id;
    new.token := old.token;
    new.email := old.email;
    new.invited_by := old.invited_by;
  end if;
  return new;
end;
$$;
create trigger staff_invitations_stamp before insert or update on public.staff_invitations
  for each row execute function private.invitation_stamp();

drop policy "public_read_by_token" on public.staff_invitations;
drop policy "admin_read_invitations" on public.staff_invitations;
drop policy "admin_insert_invitations" on public.staff_invitations;
drop policy "admin_update_invitations" on public.staff_invitations;

create policy "admins read invitations" on public.staff_invitations
  for select to authenticated using (private.has_role(organization_id, private.admin_roles()));
create policy "admins send invitations" on public.staff_invitations
  for insert to authenticated with check (private.has_role(organization_id, private.admin_roles()));
create policy "admins revoke invitations" on public.staff_invitations
  for update to authenticated
  using (private.has_role(organization_id, private.admin_roles()))
  with check (private.has_role(organization_id, private.admin_roles()));
create policy "admins delete invitations" on public.staff_invitations
  for delete to authenticated using (private.has_role(organization_id, private.admin_roles()));

-- What the invite landing page may show before sign-in: no token, no other invites.
create or replace function public.get_invitation(p_token text)
returns table (organization_name text, role text, department text, email text, expires_at timestamptz, is_valid boolean)
language sql stable
security definer
set search_path = ''
as $$
  select o.name, i.role, i.department, i.email, i.expires_at,
         (not i.accepted and i.expires_at > now()) as is_valid
  from public.staff_invitations i
  join public.organizations o on o.id = i.organization_id
  where i.token = p_token
$$;
revoke execute on function public.get_invitation(text) from public;
grant execute on function public.get_invitation(text) to anon, authenticated;

-- Signed-in user joins the workspace; the invite must be addressed to their confirmed email.
create or replace function public.accept_invitation(p_token text)
returns public.memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  invite public.staff_invitations;
  user_email text;
  member public.memberships;
begin
  if uid is null then
    raise exception 'Sign in to accept the invitation' using errcode = '28000';
  end if;
  select * into invite from public.staff_invitations where token = p_token for update;
  if invite.id is null or invite.accepted or invite.expires_at <= now() then
    raise exception 'This invitation is invalid or has expired' using errcode = 'P0002';
  end if;
  select lower(email) into user_email from auth.users where id = uid and email_confirmed_at is not null;
  if user_email is distinct from invite.email then
    raise exception 'This invitation was sent to a different email address' using errcode = '42501';
  end if;

  insert into public.memberships (organization_id, user_id, role, department, status)
  values (invite.organization_id, uid, invite.role, invite.department, 'active')
  on conflict (organization_id, user_id)
    do update set role = excluded.role, department = coalesce(excluded.department, public.memberships.department), status = 'active'
  returning * into member;

  update public.staff_invitations set accepted = true, accepted_by = uid, accepted_at = now() where id = invite.id;
  return member;
end;
$$;
revoke execute on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;

-- ============================================
-- SENTINEL: facility insert compared a column with itself
-- ============================================

drop policy "sentinel_admin_write_facilities" on public.sentinel_linked_facilities;
create policy "sentinel admins link facilities" on public.sentinel_linked_facilities
  for insert to authenticated with check (exists (
    select 1 from public.sentinel_users su
    where su.id = (select auth.uid())
      and su.sentinel_org_id = sentinel_linked_facilities.sentinel_org_id
      and su.role = any (private.sentinel_admin_roles())
      and su.is_active
  ));

-- ============================================
-- No anonymous table access on any of these
-- ============================================

revoke all on public.prescriptions, public.drug_inventory, public.invoices, public.invoice_line_items,
  public.nfc_card_orders, public.staff_invitations, public.sentinel_organizations, public.sentinel_users,
  public.sentinel_linked_facilities, public.sentinel_cases, public.sentinel_outbreaks, public.sentinel_alerts
  from anon;
