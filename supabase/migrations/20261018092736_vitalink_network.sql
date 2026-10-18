-- VitaLink Network: directory profiles, inter-hospital referrals / transfers,
-- consented record sharing, and arrival registration at the receiving hospital.
--
--  * network_profiles: what a workspace publishes to the directory (one row per
--    organization). Membership itself stays organizations.joined_network.
--  * network_transfers: a referral or transfer from one workspace to another.
--    The patient's details are copied when it is sent (patient_snapshot), so the
--    receiving hospital never reads the sender's patient table.
--  * network_transfer_items: the records chosen for sharing. Their content is
--    copied into `snapshot` only when the sender shares them (after acceptance
--    and with consent); before that the receiver sees nothing but the list.
--  * network_transfer_events: timeline, audit trail and message thread.
-- Every write goes through the network_* functions below.

-- ---------------------------------------------------------------------------
-- A VitaLink ID follows the patient: unique within a workspace, not globally,
-- so a transferred patient keeps the same ID at the receiving hospital.
alter table public.patients drop constraint patients_switch_id_key;
alter table public.patients add constraint patients_org_switch_id_key unique (organization_id, switch_id);

create or replace function private.stamp_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := auth.uid();
  if tg_table_name = 'patients' then
    new.updated_by := auth.uid();
    -- Network arrivals keep the patient's existing VitaLink ID.
    if coalesce(current_setting('vitalink.keep_switch_id', true), '') <> 'on' or new.switch_id is null then
      new.switch_id := private.next_switch_id();
    end if;
  end if;
  return new;
end;
$$;

-- Who can work with network referrals at all, who can send/answer them.
create or replace function private.network_roles()
returns text[] language sql immutable set search_path = ''
as $$ select array['super-admin','hospital-admin','doctor','nurse','receptionist','billing-officer','insurance-officer']::text[] $$;

create or replace function private.network_clinical_roles()
returns text[] language sql immutable set search_path = ''
as $$ select array['super-admin','hospital-admin','doctor']::text[] $$;

-- ---------------------------------------------------------------------------
-- DIRECTORY PROFILES

create table public.network_profiles (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  visible_in_directory boolean not null default true,
  facility_type text not null default '',
  city text not null default '',
  state text not null default '',
  description text not null default '',
  specialties text[] not null default '{}',
  services text[] not null default '{}',
  emergency boolean not null default false,
  laboratory boolean not null default false,
  imaging boolean not null default false,
  pharmacy boolean not null default false,
  telemedicine boolean not null default false,
  accepting_referrals boolean not null default true,
  accepting_transfers boolean not null default true,
  capacity text not null default 'not_reported' check (capacity in ('available', 'limited', 'unavailable', 'not_reported')),
  capacity_updated_at timestamptz,
  referral_email text not null default '',
  referral_phone text not null default '',
  verified_at timestamptz,
  verified_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.network_profiles enable row level security;
-- Members read their own profile; the directory itself is served by network_directory().
create policy "members read their network profile" on public.network_profiles
  for select to authenticated using (private.is_member(organization_id) or private.is_platform_admin());
revoke all on public.network_profiles from anon, authenticated;
grant select on public.network_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- TRANSFERS

create sequence private.network_transfer_serial;

create table public.network_transfers (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  kind text not null check (kind in ('referral', 'transfer')),
  referring_org_id uuid not null references public.organizations (id) on delete cascade,
  referring_org_name text not null,
  receiving_org_id uuid not null references public.organizations (id) on delete cascade,
  receiving_org_name text not null,
  patient_id uuid references public.patients (id) on delete set null,
  patient_snapshot jsonb not null,
  specialty text not null default '',
  reason text not null check (char_length(btrim(reason)) > 0),
  clinical_summary text not null default '',
  urgency text not null default 'normal' check (urgency in ('normal', 'urgent', 'emergency')),
  requested_date date,
  notes text not null default '',
  referring_clinician_id uuid references public.profiles (id) on delete set null,
  referring_clinician_name text not null default '',
  consent_status text not null default 'consented' check (consent_status in ('consented', 'declined', 'withdrawn')),
  consent_method text not null default '',
  consent_recorded_at timestamptz not null default now(),
  insurance jsonb not null default '{}'::jsonb,
  coverage_status text not null default 'unverified'
    check (coverage_status in ('unverified', 'active', 'authorization_required', 'out_of_network', 'not_covered')),
  status text not null default 'pending_review'
    check (status in ('pending_review', 'info_requested', 'accepted', 'declined', 'records_shared', 'arrived', 'completed', 'cancelled')),
  decline_reason text,
  accepted_at timestamptz,
  records_shared_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  received_patient_id uuid references public.patients (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (referring_org_id <> receiving_org_id)
);
create index network_transfers_referring_idx on public.network_transfers (referring_org_id, created_at desc);
create index network_transfers_receiving_idx on public.network_transfers (receiving_org_id, created_at desc);
create index network_transfers_patient_idx on public.network_transfers (patient_id);
create index network_transfers_received_patient_idx on public.network_transfers (received_patient_id);
create index network_transfers_clinician_idx on public.network_transfers (referring_clinician_id);
create index network_transfers_created_by_idx on public.network_transfers (created_by);

create or replace function private.can_see_transfer(t public.network_transfers)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_role(t.referring_org_id, private.network_roles())
      or private.has_role(t.receiving_org_id, private.network_roles())
$$;

alter table public.network_transfers enable row level security;
create policy "both hospitals read their transfers" on public.network_transfers
  for select to authenticated using (private.can_see_transfer(network_transfers));
revoke all on public.network_transfers from anon, authenticated;
grant select on public.network_transfers to authenticated;

create table public.network_transfer_items (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.network_transfers (id) on delete cascade,
  record_type text not null check (record_type in ('note', 'vitals', 'lab_result', 'prescription', 'document')),
  record_id uuid not null,
  label text not null,
  record_date timestamptz,
  snapshot jsonb,
  shared_at timestamptz,
  unique (transfer_id, record_type, record_id)
);
create index network_transfer_items_transfer_idx on public.network_transfer_items (transfer_id);
alter table public.network_transfer_items enable row level security;
-- The sender sees its list; the receiver sees the list too, but content only once shared.
create policy "both hospitals read transfer items" on public.network_transfer_items
  for select to authenticated using (
    exists (select 1 from public.network_transfers t where t.id = transfer_id and private.can_see_transfer(t)));
revoke all on public.network_transfer_items from anon, authenticated;
grant select (id, transfer_id, record_type, record_id, label, record_date, shared_at) on public.network_transfer_items to authenticated;

create table public.network_transfer_events (
  id bigint generated always as identity primary key,
  transfer_id uuid not null references public.network_transfers (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete set null,
  organization_name text not null default '',
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text not null default '',
  kind text not null check (kind in ('created', 'accepted', 'declined', 'info_requested', 'info_provided', 'message',
                                     'records_shared', 'arrived', 'registered', 'completed', 'cancelled', 'coverage')),
  body text not null default '',
  created_at timestamptz not null default now()
);
create index network_transfer_events_transfer_idx on public.network_transfer_events (transfer_id, created_at);
create index network_transfer_events_org_idx on public.network_transfer_events (organization_id);
create index network_transfer_events_actor_idx on public.network_transfer_events (actor_id);
alter table public.network_transfer_events enable row level security;
create policy "both hospitals read transfer events" on public.network_transfer_events
  for select to authenticated using (
    exists (select 1 from public.network_transfers t where t.id = transfer_id and private.can_see_transfer(t)));
revoke all on public.network_transfer_events from anon, authenticated;
grant select on public.network_transfer_events to authenticated;

alter publication supabase_realtime add table public.network_transfers, public.network_transfer_events;

-- Shared documents: the receiving hospital may open the file once it was shared.
create or replace function private.network_document_shared_with_me(p_path text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.network_transfer_items i
    join public.network_transfers t on t.id = i.transfer_id
    where i.record_type = 'document' and i.shared_at is not null and t.consent_status = 'consented'
      and i.snapshot ->> 'storage_path' = p_path
      and private.has_role(t.receiving_org_id, private.network_roles()))
$$;
grant execute on function private.network_document_shared_with_me(text) to authenticated;

create policy "network receivers read shared documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'patient-documents' and private.network_document_shared_with_me(name));

-- ---------------------------------------------------------------------------
-- HELPERS

create or replace function private.network_actor_name()
returns text language sql stable security definer set search_path = ''
as $$ select coalesce((select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = auth.uid()), 'Someone') $$;

create or replace function private.network_log(p_transfer uuid, p_org uuid, p_kind text, p_body text default '')
returns void language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.network_transfer_events (transfer_id, organization_id, organization_name, actor_id, actor_name, kind, body)
  values (p_transfer, p_org, coalesce((select o.name from public.organizations o where o.id = p_org), ''),
          auth.uid(), private.network_actor_name(), p_kind, coalesce(p_body, ''));
  update public.network_transfers set updated_at = now() where id = p_transfer;
end;
$$;

-- Emails the admins of a workspace (plus its referral inbox) about network activity.
create or replace function private.network_notify(p_org uuid, p_transfer public.network_transfers, p_title text, p_body text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  recipient text;
begin
  for recipient in
    select distinct lower(x.email) from (
      select p.email from public.memberships m join public.profiles p on p.id = m.user_id
      where m.organization_id = p_org and m.status = 'active' and m.role = any (private.admin_roles())
      union
      select np.referral_email from public.network_profiles np where np.organization_id = p_org and np.referral_email <> ''
    ) x where x.email is not null and x.email <> ''
  loop
    insert into public.notification_outbox (recipient, subject, body_text, body_html, payload)
    values (recipient, '[VitaLink Network] ' || p_title, p_title || E'\n' || p_body, '',
            jsonb_build_object('kind', 'network', 'title', p_title, 'body', p_body, 'number', p_transfer.number,
                               'transfer_id', p_transfer.id, 'urgency', p_transfer.urgency));
  end loop;
end;
$$;

create or replace function private.network_transfer_for(p_transfer uuid)
returns public.network_transfers language plpgsql stable security definer set search_path = ''
as $$
declare
  t public.network_transfers;
begin
  select * into t from public.network_transfers where id = p_transfer;
  if t.id is null or not private.can_see_transfer(t) then
    raise exception 'Transfer not found' using errcode = 'P0002';
  end if;
  return t;
end;
$$;

-- ---------------------------------------------------------------------------
-- SETTINGS & DIRECTORY

create or replace function public.network_save_settings(p_organization_id uuid, p_joined boolean, p_profile jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  cap text := coalesce(p_profile ->> 'capacity', 'not_reported');
begin
  if not private.has_role(p_organization_id, private.admin_roles()) then
    raise exception 'Only workspace admins can change network settings' using errcode = '42501';
  end if;
  if cap not in ('available', 'limited', 'unavailable', 'not_reported') then
    raise exception 'Unknown capacity' using errcode = '22023';
  end if;
  update public.organizations set joined_network = coalesce(p_joined, false) where id = p_organization_id;

  insert into public.network_profiles (organization_id) values (p_organization_id) on conflict do nothing;
  update public.network_profiles np set
    visible_in_directory = coalesce((p_profile ->> 'visible_in_directory')::boolean, np.visible_in_directory),
    facility_type = coalesce(btrim(p_profile ->> 'facility_type'), np.facility_type),
    city = coalesce(btrim(p_profile ->> 'city'), np.city),
    state = coalesce(btrim(p_profile ->> 'state'), np.state),
    description = coalesce(btrim(p_profile ->> 'description'), np.description),
    specialties = coalesce((select array_agg(distinct btrim(v)) filter (where btrim(v) <> '') from jsonb_array_elements_text(p_profile -> 'specialties') v), case when p_profile ? 'specialties' then '{}'::text[] else np.specialties end),
    services = coalesce((select array_agg(distinct btrim(v)) filter (where btrim(v) <> '') from jsonb_array_elements_text(p_profile -> 'services') v), case when p_profile ? 'services' then '{}'::text[] else np.services end),
    emergency = coalesce((p_profile ->> 'emergency')::boolean, np.emergency),
    laboratory = coalesce((p_profile ->> 'laboratory')::boolean, np.laboratory),
    imaging = coalesce((p_profile ->> 'imaging')::boolean, np.imaging),
    pharmacy = coalesce((p_profile ->> 'pharmacy')::boolean, np.pharmacy),
    telemedicine = coalesce((p_profile ->> 'telemedicine')::boolean, np.telemedicine),
    accepting_referrals = coalesce((p_profile ->> 'accepting_referrals')::boolean, np.accepting_referrals),
    accepting_transfers = coalesce((p_profile ->> 'accepting_transfers')::boolean, np.accepting_transfers),
    capacity_updated_at = case when cap is distinct from np.capacity then now() else np.capacity_updated_at end,
    capacity = cap,
    referral_email = coalesce(lower(btrim(p_profile ->> 'referral_email')), np.referral_email),
    referral_phone = coalesce(btrim(p_profile ->> 'referral_phone'), np.referral_phone),
    updated_at = now()
  where np.organization_id = p_organization_id;
end;
$$;

-- Every workspace that joined and is visible, for any signed-in member of a workspace.
create or replace function public.network_directory()
returns table (
  organization_id uuid, name text, organization_type text, facility_type text, city text, state text, address text,
  description text, specialties text[], services text[], emergency boolean, laboratory boolean, imaging boolean,
  pharmacy boolean, telemedicine boolean, accepting_referrals boolean, accepting_transfers boolean, capacity text,
  capacity_updated_at timestamptz, referral_phone text, contact_phone text, verified boolean, updated_at timestamptz, is_mine boolean
)
language sql stable security definer set search_path = ''
as $$
  select o.id, o.name, o.organization_type, np.facility_type, np.city, coalesce(nullif(np.state, ''), o.state), o.address,
         np.description, np.specialties, np.services, np.emergency, np.laboratory, np.imaging,
         np.pharmacy, np.telemedicine, np.accepting_referrals, np.accepting_transfers, np.capacity,
         np.capacity_updated_at, np.referral_phone, o.contact_phone, np.verified_at is not null, np.updated_at,
         private.is_member(o.id)
  from public.organizations o
  join public.network_profiles np on np.organization_id = o.id
  where o.joined_network and (np.visible_in_directory or private.is_member(o.id))
    and auth.uid() is not null
    and exists (select 1 from public.memberships m where m.user_id = auth.uid() and m.status = 'active')
  order by o.name
$$;

-- Records of one patient that can be attached to a transfer (RLS of the caller applies).
create or replace function public.network_patient_records(p_patient_id uuid)
returns table (record_type text, record_id uuid, label text, record_date timestamptz)
language sql stable security invoker set search_path = ''
as $$
  select * from (
    select 'note'::text, n.id, 'Clinical note' || coalesce(': ' || nullif(n.primary_diagnosis, ''), coalesce(': ' || nullif(n.chief_complaint, ''), '')), coalesce(n.signed_at, n.created_at)
    from public.clinical_notes n where n.patient_id = p_patient_id and n.status = 'signed'
    union all
    select 'vitals', v.id, 'Vitals' || coalesce(' · BP ' || v.systolic || '/' || v.diastolic, '') || coalesce(' · HR ' || v.heart_rate, '') || coalesce(' · ' || v.temperature_c || '°C', ''), v.recorded_at
    from public.vitals v where v.patient_id = p_patient_id
    union all
    select 'lab_result', r.id, 'Lab: ' || r.test_name || coalesce(' = ' || nullif(r.value, '') || coalesce(' ' || r.unit, ''), ''), coalesce(r.resulted_at, r.ordered_at)
    from public.lab_results r where r.patient_id = p_patient_id and r.status = 'Completed'
    union all
    select 'prescription', p.id, 'Rx: ' || p.drug_name || coalesce(' ' || nullif(p.dosage, ''), '') || coalesce(' · ' || nullif(p.frequency, ''), ''), p.created_at
    from public.prescriptions p where p.patient_id = p_patient_id
    union all
    select 'document', d.id, 'Document: ' || d.name || ' (' || d.category || ')', d.created_at
    from public.patient_documents d where d.patient_id = p_patient_id
  ) x (record_type, record_id, label, record_date)
  order by record_date desc nulls last
$$;

-- ---------------------------------------------------------------------------
-- TRANSFER WORKFLOW

-- p_items: [{ "type": "lab_result", "id": "<uuid>" }, ...]
create or replace function public.network_create_transfer(
  p_kind text, p_receiving_org_id uuid, p_patient_id uuid, p_reason text,
  p_specialty text default '', p_clinical_summary text default '', p_urgency text default 'normal',
  p_requested_date date default null, p_notes text default '', p_items jsonb default '[]'::jsonb,
  p_consent_method text default ''
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  pat public.patients;
  sender public.organizations;
  receiver public.organizations;
  rprof public.network_profiles;
  t public.network_transfers;
  item jsonb;
  item_label text;
  item_date timestamptz;
begin
  select * into pat from public.patients where id = p_patient_id;
  if pat.id is null or not private.has_role(pat.organization_id, private.network_clinical_roles()) then
    raise exception 'Only doctors and admins of the patient''s workspace can refer them' using errcode = '42501';
  end if;
  select * into sender from public.organizations where id = pat.organization_id;
  select * into receiver from public.organizations where id = p_receiving_org_id;
  select * into rprof from public.network_profiles where organization_id = p_receiving_org_id;
  if not sender.joined_network then
    raise exception 'Join the VitaLink Network in Network Settings before sending referrals' using errcode = '22023';
  end if;
  if receiver.id is null or not receiver.joined_network or rprof.organization_id is null then
    raise exception 'That hospital is not on the VitaLink Network' using errcode = '22023';
  end if;
  if receiver.id = sender.id then
    raise exception 'Choose a different hospital' using errcode = '22023';
  end if;
  if p_kind = 'transfer' and not rprof.accepting_transfers then
    raise exception '% is not accepting transfers right now', receiver.name using errcode = '22023';
  end if;
  if p_kind = 'referral' and not rprof.accepting_referrals then
    raise exception '% is not accepting referrals right now', receiver.name using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason for the %', p_kind using errcode = '22023';
  end if;
  if coalesce(btrim(p_consent_method), '') = '' then
    raise exception 'Record how the patient gave consent' using errcode = '22023';
  end if;

  insert into public.network_transfers (
    number, kind, referring_org_id, referring_org_name, receiving_org_id, receiving_org_name, patient_id, patient_snapshot,
    specialty, reason, clinical_summary, urgency, requested_date, notes, referring_clinician_id, referring_clinician_name,
    consent_status, consent_method, insurance, created_by)
  values (
    'VTR-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('private.network_transfer_serial')::text, 4, '0'),
    case when p_kind = 'transfer' then 'transfer' else 'referral' end,
    sender.id, sender.name, receiver.id, receiver.name, pat.id,
    jsonb_build_object(
      'switch_id', pat.switch_id, 'first_name', pat.first_name, 'middle_name', pat.middle_name, 'last_name', pat.last_name,
      'date_of_birth', pat.date_of_birth, 'gender', pat.gender, 'phone', pat.phone, 'email', pat.email,
      'address', pat.address, 'state', pat.state, 'country', pat.country,
      'blood_group', pat.blood_group, 'genotype', pat.genotype, 'allergies', pat.allergies,
      'chronic_conditions', pat.chronic_conditions, 'current_medications', pat.current_medications,
      'emergency_contact_name', pat.emergency_contact_name, 'emergency_relationship', pat.emergency_relationship,
      'emergency_phone', pat.emergency_phone),
    btrim(coalesce(p_specialty, '')), btrim(p_reason), btrim(coalesce(p_clinical_summary, '')),
    case when p_urgency in ('normal', 'urgent', 'emergency') then p_urgency else 'normal' end,
    p_requested_date, btrim(coalesce(p_notes, '')), auth.uid(), private.network_actor_name(),
    'consented', btrim(p_consent_method),
    jsonb_build_object('provider', pat.insurance_provider, 'policy_number', pat.insurance_policy_number,
                       'type', pat.insurance_type, 'expiry', pat.insurance_expiry_date),
    auth.uid())
  returning * into t;

  -- Attach the chosen records (they must belong to this patient).
  for item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    select r.label, r.record_date into item_label, item_date
    from public.network_patient_records(pat.id) r
    where r.record_type = item ->> 'type' and r.record_id = (item ->> 'id')::uuid;
    if not found then
      raise exception 'A selected record does not belong to this patient' using errcode = '22023';
    end if;
    insert into public.network_transfer_items (transfer_id, record_type, record_id, label, record_date)
    values (t.id, item ->> 'type', (item ->> 'id')::uuid, item_label, item_date)
    on conflict do nothing;
  end loop;

  perform private.network_log(t.id, sender.id, 'created',
    initcap(t.kind) || ' sent to ' || receiver.name || ' · consent: ' || t.consent_method);
  perform private.network_notify(receiver.id, t,
    case t.urgency when 'emergency' then 'EMERGENCY ' when 'urgent' then 'Urgent ' else 'New ' end || t.kind || ' from ' || sender.name,
    (t.patient_snapshot ->> 'first_name') || ' ' || (t.patient_snapshot ->> 'last_name') || coalesce(' · ' || nullif(t.specialty, ''), '') || E'\nReason: ' || t.reason);
  return t.id;
end;
$$;

-- Receiving hospital: accept, decline or ask for more information.
create or replace function public.network_respond(p_transfer_id uuid, p_action text, p_note text default '')
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.network_transfers := private.network_transfer_for(p_transfer_id);
begin
  if not private.has_role(t.receiving_org_id, private.network_clinical_roles()) then
    raise exception 'Only doctors and admins of the receiving hospital can respond' using errcode = '42501';
  end if;
  if t.status not in ('pending_review', 'info_requested') then
    raise exception 'This % has already been answered', t.kind using errcode = '22023';
  end if;
  if p_action = 'accept' then
    update public.network_transfers set status = 'accepted', accepted_at = now() where id = t.id;
    perform private.network_log(t.id, t.receiving_org_id, 'accepted', coalesce(btrim(p_note), ''));
    perform private.network_notify(t.referring_org_id, t, t.receiving_org_name || ' accepted ' || t.number,
      'You can now share the authorised records.' || coalesce(E'\nNote: ' || nullif(btrim(p_note), ''), ''));
  elsif p_action = 'decline' then
    if coalesce(btrim(p_note), '') = '' then raise exception 'Give a reason for declining' using errcode = '22023'; end if;
    update public.network_transfers set status = 'declined', decline_reason = btrim(p_note) where id = t.id;
    perform private.network_log(t.id, t.receiving_org_id, 'declined', btrim(p_note));
    perform private.network_notify(t.referring_org_id, t, t.receiving_org_name || ' declined ' || t.number, 'Reason: ' || btrim(p_note));
  elsif p_action = 'request_info' then
    if coalesce(btrim(p_note), '') = '' then raise exception 'Say what information you need' using errcode = '22023'; end if;
    update public.network_transfers set status = 'info_requested' where id = t.id;
    perform private.network_log(t.id, t.receiving_org_id, 'info_requested', btrim(p_note));
    perform private.network_notify(t.referring_org_id, t, t.receiving_org_name || ' needs more information on ' || t.number, btrim(p_note));
  else
    raise exception 'Unknown action' using errcode = '22023';
  end if;
end;
$$;

-- Either hospital: post a message. From the sender while information was requested, it goes back for review.
create or replace function public.network_message(p_transfer_id uuid, p_body text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.network_transfers := private.network_transfer_for(p_transfer_id);
  from_sender boolean := private.has_role(t.referring_org_id, private.network_roles());
begin
  if coalesce(btrim(p_body), '') = '' then raise exception 'Write a message' using errcode = '22023'; end if;
  if from_sender and t.status = 'info_requested' then
    update public.network_transfers set status = 'pending_review' where id = t.id;
    perform private.network_log(t.id, t.referring_org_id, 'info_provided', btrim(p_body));
  else
    perform private.network_log(t.id, case when from_sender then t.referring_org_id else t.receiving_org_id end, 'message', btrim(p_body));
  end if;
  perform private.network_notify(case when from_sender then t.receiving_org_id else t.referring_org_id end, t,
    'New message on ' || t.number || ' from ' || case when from_sender then t.referring_org_name else t.receiving_org_name end,
    left(btrim(p_body), 600));
end;
$$;

-- Sending hospital: copy the authorised records to the receiver (after acceptance, with consent).
create or replace function public.network_share_records(p_transfer_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  t public.network_transfers := private.network_transfer_for(p_transfer_id);
  shared integer;
begin
  if not private.has_role(t.referring_org_id, array['super-admin','hospital-admin','doctor','nurse']) then
    raise exception 'Only clinical staff of the sending hospital can share records' using errcode = '42501';
  end if;
  if t.status <> 'accepted' then
    raise exception 'Records can be shared once the receiving hospital accepts' using errcode = '22023';
  end if;
  if t.consent_status <> 'consented' then
    raise exception 'The patient has not consented to sharing records' using errcode = '22023';
  end if;

  update public.network_transfer_items i set shared_at = now(), snapshot = case i.record_type
    when 'note' then (select jsonb_build_object('chief_complaint', n.chief_complaint, 'primary_diagnosis', n.primary_diagnosis,
        'content', n.content, 'status', n.status, 'signed_at', n.signed_at, 'created_at', n.created_at,
        'author', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = n.author_id))
      from public.clinical_notes n where n.id = i.record_id and n.organization_id = t.referring_org_id)
    when 'vitals' then (select to_jsonb(v) - 'id' - 'organization_id' - 'patient_id' - 'appointment_id' - 'recorded_by'
      from public.vitals v where v.id = i.record_id and v.organization_id = t.referring_org_id)
    when 'lab_result' then (select jsonb_build_object('test_name', r.test_name, 'test_type', r.test_type, 'value', r.value, 'unit', r.unit,
        'reference_range', r.reference_range, 'flag', r.flag, 'interpretation', r.interpretation, 'resulted_at', r.resulted_at)
      from public.lab_results r where r.id = i.record_id and r.organization_id = t.referring_org_id)
    when 'prescription' then (select jsonb_build_object('drug_name', p.drug_name, 'generic_name', p.generic_name, 'dosage', p.dosage,
        'frequency', p.frequency, 'duration', p.duration, 'route', p.route, 'instructions', p.instructions, 'status', p.status, 'prescribed_at', p.created_at)
      from public.prescriptions p where p.id = i.record_id and p.organization_id = t.referring_org_id)
    when 'document' then (select jsonb_build_object('name', d.name, 'category', d.category, 'mime_type', d.mime_type,
        'size_bytes', d.size_bytes, 'storage_path', d.storage_path, 'uploaded_at', d.created_at)
      from public.patient_documents d where d.id = i.record_id and d.organization_id = t.referring_org_id)
    end
  where i.transfer_id = t.id;
  get diagnostics shared = row_count;

  update public.network_transfers set status = 'records_shared', records_shared_at = now() where id = t.id;
  perform private.network_log(t.id, t.referring_org_id, 'records_shared', shared || ' record' || case when shared = 1 then '' else 's' end || ' shared');
  perform private.network_notify(t.receiving_org_id, t, t.referring_org_name || ' shared records for ' || t.number,
    shared || ' authorised record' || case when shared = 1 then '' else 's' end || ' are ready to view.');
  return shared;
end;
$$;

-- Shared record content for the receiving hospital (or the sender).
create or replace function public.network_transfer_records(p_transfer_id uuid)
returns table (id uuid, record_type text, label text, record_date timestamptz, shared_at timestamptz, snapshot jsonb)
language plpgsql stable security definer set search_path = ''
as $$
declare
  t public.network_transfers := private.network_transfer_for(p_transfer_id);
begin
  return query
  select i.id, i.record_type, i.label, i.record_date, i.shared_at,
         case when i.shared_at is not null and t.consent_status = 'consented' then i.snapshot end
  from public.network_transfer_items i where i.transfer_id = t.id
  order by i.record_date desc nulls last;
end;
$$;

-- Receiving hospital: the patient has arrived; optionally register them locally (same VitaLink ID).
create or replace function public.network_mark_arrived(p_transfer_id uuid, p_register boolean default true)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t public.network_transfers := private.network_transfer_for(p_transfer_id);
  s jsonb;
  local_id uuid;
begin
  if not private.has_role(t.receiving_org_id, private.clinical_write_roles()) then
    raise exception 'Only staff of the receiving hospital can record arrival' using errcode = '42501';
  end if;
  if t.status not in ('accepted', 'records_shared') then
    raise exception 'Arrival can be recorded once the % is accepted', t.kind using errcode = '22023';
  end if;
  s := t.patient_snapshot;
  if coalesce(p_register, true) then
    select p.id into local_id from public.patients p
    where p.organization_id = t.receiving_org_id and p.switch_id = s ->> 'switch_id';
    if local_id is null then
      perform set_config('vitalink.keep_switch_id', 'on', true);
      insert into public.patients (organization_id, switch_id, first_name, middle_name, last_name, date_of_birth, gender, phone,
        email, address, state, country, blood_group, genotype, allergies, chronic_conditions, current_medications,
        emergency_contact_name, emergency_relationship, emergency_phone, status)
      values (t.receiving_org_id, s ->> 'switch_id', s ->> 'first_name', s ->> 'middle_name', s ->> 'last_name',
        (s ->> 'date_of_birth')::date, s ->> 'gender', coalesce(s ->> 'phone', ''), s ->> 'email', s ->> 'address',
        s ->> 'state', s ->> 'country', s ->> 'blood_group', s ->> 'genotype', s ->> 'allergies', s ->> 'chronic_conditions',
        s ->> 'current_medications', s ->> 'emergency_contact_name', s ->> 'emergency_relationship', s ->> 'emergency_phone', 'active')
      returning id into local_id;
      perform set_config('vitalink.keep_switch_id', 'off', true);
      perform private.network_log(t.id, t.receiving_org_id, 'registered', 'Registered at ' || t.receiving_org_name || ' as ' || (s ->> 'switch_id'));
    end if;
  end if;
  update public.network_transfers set status = 'arrived', arrived_at = now(), received_patient_id = coalesce(local_id, received_patient_id) where id = t.id;
  perform private.network_log(t.id, t.receiving_org_id, 'arrived', '');
  perform private.network_notify(t.referring_org_id, t, 'Patient arrived at ' || t.receiving_org_name || ' (' || t.number || ')', '');
  return local_id;
end;
$$;

create or replace function public.network_complete(p_transfer_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.network_transfers := private.network_transfer_for(p_transfer_id);
begin
  if not private.has_role(t.receiving_org_id, private.network_clinical_roles()) then
    raise exception 'Only doctors and admins of the receiving hospital can complete it' using errcode = '42501';
  end if;
  if t.status <> 'arrived' then
    raise exception 'Record the patient''s arrival first' using errcode = '22023';
  end if;
  update public.network_transfers set status = 'completed', completed_at = now() where id = t.id;
  perform private.network_log(t.id, t.receiving_org_id, 'completed', '');
  perform private.network_notify(t.referring_org_id, t, t.number || ' completed by ' || t.receiving_org_name, '');
end;
$$;

-- Sending hospital: cancel before the patient arrives (also withdraws consent for unshared records).
create or replace function public.network_cancel(p_transfer_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.network_transfers := private.network_transfer_for(p_transfer_id);
begin
  if not private.has_role(t.referring_org_id, private.network_clinical_roles()) then
    raise exception 'Only doctors and admins of the sending hospital can cancel' using errcode = '42501';
  end if;
  if t.status in ('arrived', 'completed', 'cancelled', 'declined') then
    raise exception 'This % can no longer be cancelled', t.kind using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for cancelling' using errcode = '22023'; end if;
  update public.network_transfers set status = 'cancelled', cancelled_at = now() where id = t.id;
  perform private.network_log(t.id, t.referring_org_id, 'cancelled', btrim(p_reason));
  perform private.network_notify(t.receiving_org_id, t, t.referring_org_name || ' cancelled ' || t.number, 'Reason: ' || btrim(p_reason));
end;
$$;

-- Billing / insurance staff of either hospital record the coverage check.
create or replace function public.network_set_coverage(p_transfer_id uuid, p_status text, p_note text default '')
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.network_transfers := private.network_transfer_for(p_transfer_id);
  org uuid;
begin
  org := case
    when private.has_role(t.receiving_org_id, private.billing_manage_roles()) then t.receiving_org_id
    when private.has_role(t.referring_org_id, private.billing_manage_roles()) then t.referring_org_id end;
  if org is null then
    raise exception 'Only billing, insurance or admin staff can record coverage' using errcode = '42501';
  end if;
  if p_status not in ('unverified', 'active', 'authorization_required', 'out_of_network', 'not_covered') then
    raise exception 'Unknown coverage status' using errcode = '22023';
  end if;
  update public.network_transfers set coverage_status = p_status where id = t.id;
  perform private.network_log(t.id, org, 'coverage', replace(p_status, '_', ' ') || coalesce(' · ' || nullif(btrim(p_note), ''), ''));
end;
$$;

-- VitaLink Console: mark a workspace as verified in the directory.
create or replace function public.console_verify_network_org(p_organization_id uuid, p_verified boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  insert into public.network_profiles (organization_id) values (p_organization_id) on conflict do nothing;
  update public.network_profiles
  set verified_at = case when p_verified then coalesce(verified_at, now()) end,
      verified_by = case when p_verified then (select lower(u.email) from auth.users u where u.id = auth.uid()) end,
      updated_at = now()
  where organization_id = p_organization_id;
end;
$$;

-- Workspaces that already said "join the network" at sign-up get a profile from what we know.
insert into public.network_profiles (organization_id, state, facility_type)
select o.id, coalesce(o.state, ''), initcap(replace(coalesce(o.organization_type, ''), '-', ' '))
from public.organizations o
where o.workspace_type = 'healthcare'
on conflict do nothing;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.network_save_settings(uuid, boolean, jsonb)',
    'public.network_directory()',
    'public.network_patient_records(uuid)',
    'public.network_create_transfer(text, uuid, uuid, text, text, text, text, date, text, jsonb, text)',
    'public.network_respond(uuid, text, text)',
    'public.network_message(uuid, text)',
    'public.network_share_records(uuid)',
    'public.network_transfer_records(uuid)',
    'public.network_mark_arrived(uuid, boolean)',
    'public.network_complete(uuid)',
    'public.network_cancel(uuid, text)',
    'public.network_set_coverage(uuid, text, text)',
    'public.console_verify_network_org(uuid, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
revoke execute on function private.network_notify(uuid, public.network_transfers, text, text), private.network_log(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function private.can_see_transfer(public.network_transfers) to authenticated;
