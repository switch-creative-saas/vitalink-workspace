-- Connected EMRs: hospitals that already run another EMR (OpenMRS/NMRS, Bahmni,
-- LAMISPlus, OpenEMR, any FHIR R4 system, or a commercial EMR that pushes data
-- to us) see those patients and their records inside VitaLink.
--
-- Every connector turns the other system's data into one normalised payload and
-- hands it to emr_apply_import, which matches or creates the VitaLink patient,
-- fills empty demographic fields, adds vitals and lab results to the native
-- tables, and keeps everything else (encounters, diagnoses, medicines, notes,
-- immunisations...) as read-only records shown on the patient's EMR page.
-- Credentials live in Supabase Vault; no table holds them in plain text.

create table public.emr_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  system text not null,
  method text not null check (method in ('fhir', 'openmrs', 'lamisplus', 'push', 'file')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  base_url text,
  auth_type text not null default 'none'
    check (auth_type in ('none', 'basic', 'bearer', 'oauth2_client', 'oauth2_password', 'lamisplus')),
  username text,
  client_id text,
  token_url text,
  scope text,
  secret_id uuid,
  push_key_prefix text,
  push_key_hash text unique,
  auto_sync boolean not null default true,
  sync_every_minutes int not null default 60 check (sync_every_minutes between 15 and 1440),
  status text not null default 'active' check (status in ('active', 'paused', 'error')),
  cursor jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (method in ('push', 'file') or base_url ~ '^https://')
);
create index emr_connections_org_idx on public.emr_connections (organization_id);

create table public.emr_sync_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.emr_connections(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  trigger text not null check (trigger in ('manual', 'schedule', 'push', 'file', 'test')),
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  counts jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  error text,
  started_by uuid default auth.uid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index emr_sync_runs_connection_idx on public.emr_sync_runs (connection_id, started_at desc);

create table public.emr_patient_links (
  connection_id uuid not null references public.emr_connections(id) on delete cascade,
  external_id text not null,
  patient_id uuid not null references public.patients(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  matched_by text not null check (matched_by in ('created', 'national_id', 'phone_dob', 'name_dob', 'manual')),
  created_at timestamptz not null default now(),
  primary key (connection_id, external_id)
);
create index emr_patient_links_patient_idx on public.emr_patient_links (patient_id);

create table public.emr_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  connection_id uuid references public.emr_connections(id) on delete set null,
  source_name text not null,
  kind text not null check (kind in ('encounter', 'condition', 'allergy', 'medication', 'immunization', 'procedure', 'note', 'observation')),
  external_id text not null,
  recorded_at timestamptz,
  title text not null,
  detail text,
  status text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, kind, external_id)
);
create index emr_records_patient_idx on public.emr_records (patient_id, recorded_at desc);

-- Vitals and lab results from a connected EMR sit with VitaLink's own, marked by source.
alter table public.vitals add column emr_connection_id uuid references public.emr_connections(id) on delete set null, add column external_id text;
alter table public.lab_results add column emr_connection_id uuid references public.emr_connections(id) on delete set null, add column external_id text;
create unique index vitals_emr_external_idx on public.vitals (emr_connection_id, external_id) where external_id is not null;
create unique index lab_results_emr_external_idx on public.lab_results (emr_connection_id, external_id) where external_id is not null;

alter table public.emr_connections enable row level security;
alter table public.emr_sync_runs enable row level security;
alter table public.emr_patient_links enable row level security;
alter table public.emr_records enable row level security;

create policy emr_connections_read on public.emr_connections for select to authenticated
  using (private.has_role(organization_id, private.admin_roles()));
create policy emr_sync_runs_read on public.emr_sync_runs for select to authenticated
  using (private.has_role(organization_id, private.admin_roles()));
create policy emr_patient_links_read on public.emr_patient_links for select to authenticated
  using (private.has_role(organization_id, private.clinical_read_roles()));
create policy emr_records_read on public.emr_records for select to authenticated
  using (private.has_role(organization_id, private.clinical_read_roles()));

-- Admins see the settings but never the key hash or the Vault reference.
revoke select on public.emr_connections from authenticated, anon;
grant select (id, organization_id, system, method, name, base_url, auth_type, username, client_id, token_url, scope, push_key_prefix,
  auto_sync, sync_every_minutes, status, cursor, last_sync_at, last_success_at, last_error, created_by, created_at, updated_at)
  on public.emr_connections to authenticated;
revoke insert, update, delete on public.emr_connections, public.emr_sync_runs, public.emr_patient_links, public.emr_records from authenticated, anon;

create trigger emr_connections_audit after insert or update or delete on public.emr_connections
  for each row execute function private.write_audit();

-- ---------------------------------------------------------------------------
-- Managing connections (workspace admins)

create or replace function private.require_emr_admin(p_org uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_role(p_org, private.admin_roles()) then
    raise exception 'Only workspace admins can manage connected EMRs' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.emr_save_connection(
  p_id uuid, p_org uuid, p_system text, p_method text, p_name text,
  p_base_url text default null, p_auth_type text default 'none', p_username text default null,
  p_client_id text default null, p_token_url text default null, p_scope text default null,
  p_secret text default null, p_auto_sync boolean default true, p_sync_every_minutes int default 60
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  v_secret uuid;
  v_url text := nullif(regexp_replace(btrim(coalesce(p_base_url, '')), '/+$', ''), '');
begin
  perform private.require_emr_admin(p_org);
  if p_method not in ('push', 'file') and (v_url is null or v_url !~ '^https://') then
    raise exception 'Enter the EMR''s https:// address. Plain http would send patient data and passwords unencrypted.' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.emr_connections (organization_id, system, method, name, base_url, auth_type, username, client_id, token_url, scope, auto_sync, sync_every_minutes)
    values (p_org, p_system, p_method, btrim(p_name), v_url, coalesce(p_auth_type, 'none'), nullif(btrim(p_username), ''), nullif(btrim(p_client_id), ''),
            nullif(btrim(p_token_url), ''), nullif(btrim(p_scope), ''), coalesce(p_auto_sync, true), coalesce(p_sync_every_minutes, 60))
    returning id into v_id;
  else
    update public.emr_connections set
      system = p_system, method = p_method, name = btrim(p_name), base_url = v_url, auth_type = coalesce(p_auth_type, 'none'),
      username = nullif(btrim(p_username), ''), client_id = nullif(btrim(p_client_id), ''), token_url = nullif(btrim(p_token_url), ''),
      scope = nullif(btrim(p_scope), ''), auto_sync = coalesce(p_auto_sync, true), sync_every_minutes = coalesce(p_sync_every_minutes, 60),
      status = case when status = 'error' then 'active' else status end, updated_at = now()
    where id = v_id and organization_id = p_org;
    if not found then raise exception 'Connection not found' using errcode = 'P0002'; end if;
  end if;

  -- A blank secret keeps the saved one.
  if nullif(p_secret, '') is not null then
    select secret_id into v_secret from public.emr_connections where id = v_id;
    if v_secret is null then
      v_secret := vault.create_secret(p_secret, 'emr-connection-' || v_id, 'Connected EMR credential');
      update public.emr_connections set secret_id = v_secret where id = v_id;
    else
      perform vault.update_secret(v_secret, p_secret);
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.emr_delete_connection(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_conn public.emr_connections;
begin
  select * into v_conn from public.emr_connections where id = p_id;
  if v_conn.id is null then raise exception 'Connection not found' using errcode = 'P0002'; end if;
  perform private.require_emr_admin(v_conn.organization_id);
  if v_conn.secret_id is not null then delete from vault.secrets where id = v_conn.secret_id; end if;
  -- Patients and their imported records stay; they're part of this hospital's history now.
  delete from public.emr_connections where id = p_id;
end;
$$;

create or replace function public.emr_set_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.emr_connections where id = p_id;
  if v_org is null then raise exception 'Connection not found' using errcode = 'P0002'; end if;
  perform private.require_emr_admin(v_org);
  if p_status not in ('active', 'paused') then raise exception 'Invalid status' using errcode = '22023'; end if;
  update public.emr_connections set status = p_status, last_error = case when p_status = 'active' then null else last_error end, updated_at = now() where id = p_id;
end;
$$;

/** New key for a vendor or the hospital's IT to push records; shown once, only its hash is kept. */
create or replace function public.emr_create_push_key(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_key text;
begin
  select organization_id into v_org from public.emr_connections where id = p_id;
  if v_org is null then raise exception 'Connection not found' using errcode = 'P0002'; end if;
  perform private.require_emr_admin(v_org);
  v_key := 'vlek_' || encode(extensions.gen_random_bytes(24), 'hex');
  update public.emr_connections
  set push_key_prefix = left(v_key, 13), push_key_hash = encode(extensions.digest(v_key, 'sha256'), 'hex'), updated_at = now()
  where id = p_id;
  return v_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sync bookkeeping (the emr-sync / emr-ingest functions, or an admin's file import)

create or replace function private.can_run_emr(p_connection uuid)
returns public.emr_connections language plpgsql stable security definer set search_path = '' as $$
declare v_conn public.emr_connections;
begin
  select * into v_conn from public.emr_connections where id = p_connection;
  if v_conn.id is null then raise exception 'Connection not found' using errcode = 'P0002'; end if;
  if coalesce(auth.role(), '') <> 'service_role' then perform private.require_emr_admin(v_conn.organization_id); end if;
  return v_conn;
end;
$$;

create or replace function public.emr_begin_run(p_connection uuid, p_trigger text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_conn public.emr_connections; v_run uuid;
begin
  v_conn := private.can_run_emr(p_connection);
  insert into public.emr_sync_runs (connection_id, organization_id, trigger)
  values (v_conn.id, v_conn.organization_id, p_trigger) returning id into v_run;
  update public.emr_connections set last_sync_at = now() where id = v_conn.id;
  return v_run;
end;
$$;

create or replace function public.emr_finish_run(p_run uuid, p_error text default null, p_cursor jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_run public.emr_sync_runs; v_status text;
begin
  select * into v_run from public.emr_sync_runs where id = p_run;
  if v_run.id is null then raise exception 'Run not found' using errcode = 'P0002'; end if;
  perform private.can_run_emr(v_run.connection_id);
  v_status := case
    when p_error is not null then 'failed'
    when jsonb_array_length(v_run.errors) > 0 then 'partial'
    else 'success' end;
  update public.emr_sync_runs set status = v_status, error = p_error, finished_at = now() where id = p_run returning * into v_run;
  update public.emr_connections set
    cursor = coalesce(p_cursor, cursor),
    last_error = p_error,
    last_success_at = case when p_error is null then now() else last_success_at end,
    status = case when p_error is not null and status = 'active' then 'error'
                  when p_error is null and status = 'error' then 'active' else status end,
    updated_at = now()
  where id = v_run.connection_id;
  return jsonb_build_object('status', v_status, 'counts', v_run.counts, 'errors', v_run.errors);
end;
$$;

-- Dates from other systems come in many shapes ("2019", "2019-04", full timestamps); unreadable ones become null.
create or replace function private.emr_ts(p text)
returns timestamptz language plpgsql stable set search_path = '' as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  if p ~ '^\d{4}$' then return (p || '-01-01')::timestamptz; end if;
  if p ~ '^\d{4}-\d{2}$' then return (p || '-01')::timestamptz; end if;
  return p::timestamptz;
exception when others then
  return null;
end;
$$;

-- Lab results imported from another EMR keep that system's dates and stay read-only in
-- VitaLink; only the import itself may apply the source system's corrections.
create or replace function private.lab_result_stamp()
returns trigger language plpgsql set search_path = '' as $$
declare
  importing boolean := coalesce(current_setting('vitalink.emr_import', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    new.ordered_by := auth.uid();
    new.ordered_at := case when importing and new.emr_connection_id is not null then coalesce(new.ordered_at, now()) else now() end;
  else
    if old.emr_connection_id is not null and not importing then
      raise exception 'This result came from a connected EMR and can only be changed there' using errcode = '42501';
    end if;
    new.organization_id := old.organization_id;
    new.patient_id := old.patient_id;
    new.ordered_by := old.ordered_by;
    new.ordered_at := old.ordered_at;
    if old.status = 'Completed' and new.value is distinct from old.value and not importing then
      raise exception 'Completed lab values cannot be changed; record a new result instead' using errcode = '42501';
    end if;
  end if;
  if importing and new.emr_connection_id is not null then
    new.resulted_at := coalesce(new.resulted_at, now());
  elsif new.status = 'Completed' and (tg_op = 'INSERT' or old.status <> 'Completed') then
    new.resulted_at := now();
    new.technician_id := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Keeps only values the vitals table accepts (devices and other EMRs sometimes store junk).
create or replace function private.emr_num(p jsonb, p_key text, p_min numeric, p_max numeric)
returns numeric language sql immutable set search_path = '' as $$
  select case when (p ->> p_key) ~ '^-?[0-9]+(\.[0-9]+)?$' and (p ->> p_key)::numeric between p_min and p_max
    then (p ->> p_key)::numeric end
$$;

-- Adds items to a comma-separated text field without repeating what's there.
create or replace function private.emr_merge_list(p_current text, p_items text[])
returns text language sql immutable set search_path = '' as $$
  select nullif(array_to_string(array(
    select distinct on (lower(btrim(v))) btrim(v)
    from unnest(string_to_array(coalesce(p_current, ''), ',') || coalesce(p_items, '{}')) with ordinality as t(v, n)
    where btrim(coalesce(v, '')) <> '' and lower(btrim(v)) not in ('none', 'nil', 'n/a', 'nkda')
    order by lower(btrim(v)), n
  ), ', '), '')
$$;

/**
 * Imports one batch of the normalised payload:
 *   { "patients": [ { external_id, first_name, middle_name, last_name, date_of_birth, gender, phone, email,
 *       address, state, national_id, blood_group, genotype,
 *       allergies: [{external_id, substance, reaction, severity, recorded_at}],
 *       conditions: [{external_id, name, code, status, onset, recorded_at}],
 *       medications: [{external_id, name, dosage, status, recorded_at}],
 *       vitals: [{external_id, recorded_at, temperature_c, heart_rate, systolic, diastolic, respiratory_rate, spo2, weight_kg, height_cm}],
 *       labs: [{external_id, test_name, value, unit, reference_range, flag, interpretation, resulted_at}],
 *       encounters: [{external_id, type, reason, started_at, ended_at, location, provider, status}],
 *       notes: [{external_id, title, text, recorded_at, author}],
 *       immunizations: [{external_id, vaccine, date, dose}],
 *       procedures: [{external_id, name, date, status}] } ] }
 * One bad patient never stops the rest: it's skipped and listed in the run's errors.
 */
create or replace function public.emr_apply_import(p_run uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_run public.emr_sync_runs;
  v_conn public.emr_connections;
  p jsonb;
  x jsonb;
  v_patient uuid;
  v_matched text;
  v_ext text;
  v_dob date;
  v_phone text;
  v_gender text;
  c_patients int := 0; c_created int := 0; c_vitals int := 0; c_labs int := 0; c_records int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_rows int;
begin
  select * into v_run from public.emr_sync_runs where id = p_run;
  if v_run.id is null or v_run.status <> 'running' then raise exception 'Sync run is not open' using errcode = 'P0002'; end if;
  v_conn := private.can_run_emr(v_run.connection_id);
  perform set_config('vitalink.emr_import', 'on', true);

  for p in select * from jsonb_array_elements(coalesce(p_payload -> 'patients', '[]'::jsonb)) loop
    begin
      v_ext := nullif(btrim(p ->> 'external_id'), '');
      if v_ext is null then raise exception 'Record has no patient id from the EMR'; end if;
      v_dob := case when (p ->> 'date_of_birth') ~ '^\d{4}-\d{2}-\d{2}' then left(p ->> 'date_of_birth', 10)::date end;
      v_phone := nullif(regexp_replace(coalesce(p ->> 'phone', ''), '[^0-9+]', '', 'g'), '');
      v_gender := case lower(left(coalesce(p ->> 'gender', ''), 1)) when 'm' then 'male' when 'f' then 'female' else 'other' end;
      v_patient := null;
      v_matched := null;

      select patient_id into v_patient from public.emr_patient_links where connection_id = v_conn.id and external_id = v_ext;

      -- Same person already registered in VitaLink?
      if v_patient is null and nullif(btrim(p ->> 'national_id'), '') is not null then
        select id into v_patient from public.patients
        where organization_id = v_conn.organization_id and national_id = btrim(p ->> 'national_id') limit 1;
        if v_patient is not null then v_matched := 'national_id'; end if;
      end if;
      if v_patient is null and v_phone is not null and v_dob is not null then
        select id into v_patient from public.patients
        where organization_id = v_conn.organization_id and date_of_birth = v_dob
          and right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 10)
        limit 1;
        if v_patient is not null then v_matched := 'phone_dob'; end if;
      end if;
      if v_patient is null and v_dob is not null then
        select id into v_patient from public.patients
        where organization_id = v_conn.organization_id and date_of_birth = v_dob
          and lower(first_name) = lower(btrim(p ->> 'first_name')) and lower(last_name) = lower(btrim(p ->> 'last_name'))
        limit 1;
        if v_patient is not null then v_matched := 'name_dob'; end if;
      end if;

      if v_patient is null then
        if nullif(btrim(p ->> 'first_name'), '') is null or nullif(btrim(p ->> 'last_name'), '') is null then
          raise exception 'Patient % has no full name', v_ext;
        end if;
        if v_dob is null then raise exception 'Patient % has no date of birth', v_ext; end if;
        insert into public.patients (organization_id, first_name, middle_name, last_name, date_of_birth, gender, phone, email, address, state,
                                     national_id, blood_group, genotype, status)
        values (v_conn.organization_id, btrim(p ->> 'first_name'), nullif(btrim(p ->> 'middle_name'), ''), btrim(p ->> 'last_name'), v_dob, v_gender,
                coalesce(v_phone, ''), nullif(btrim(p ->> 'email'), ''), coalesce(p ->> 'address', ''), coalesce(p ->> 'state', ''),
                nullif(btrim(p ->> 'national_id'), ''), nullif(btrim(p ->> 'blood_group'), ''), nullif(btrim(p ->> 'genotype'), ''), 'active')
        returning id into v_patient;
        v_matched := 'created';
        c_created := c_created + 1;
      else
        -- Fill only what VitaLink doesn't have; never overwrite the hospital's own edits.
        update public.patients set
          middle_name = coalesce(middle_name, nullif(btrim(p ->> 'middle_name'), '')),
          phone = case when coalesce(phone, '') = '' then coalesce(v_phone, '') else phone end,
          email = coalesce(email, nullif(btrim(p ->> 'email'), '')),
          address = case when coalesce(address, '') = '' then coalesce(p ->> 'address', '') else address end,
          state = case when coalesce(state, '') = '' then coalesce(p ->> 'state', '') else state end,
          national_id = coalesce(national_id, nullif(btrim(p ->> 'national_id'), '')),
          blood_group = coalesce(blood_group, nullif(btrim(p ->> 'blood_group'), '')),
          genotype = coalesce(genotype, nullif(btrim(p ->> 'genotype'), ''))
        where id = v_patient;
      end if;

      if v_matched is not null then
        insert into public.emr_patient_links (connection_id, external_id, patient_id, organization_id, matched_by)
        values (v_conn.id, v_ext, v_patient, v_conn.organization_id, v_matched)
        on conflict (connection_id, external_id) do nothing;
      end if;

      -- Allergies, conditions and medicines also feed the patient's summary fields used in alerts.
      update public.patients set
        allergies = private.emr_merge_list(allergies, array(select a ->> 'substance' from jsonb_array_elements(coalesce(p -> 'allergies', '[]')) a
                                                              where coalesce(a ->> 'status', 'active') not in ('inactive', 'resolved', 'entered-in-error'))),
        chronic_conditions = private.emr_merge_list(chronic_conditions, array(select a ->> 'name' from jsonb_array_elements(coalesce(p -> 'conditions', '[]')) a
                                                              where coalesce(a ->> 'status', 'active') in ('active', 'recurrence', 'relapse', 'chronic'))),
        current_medications = private.emr_merge_list(current_medications, array(select concat_ws(' ', a ->> 'name', a ->> 'dosage') from jsonb_array_elements(coalesce(p -> 'medications', '[]')) a
                                                              where coalesce(a ->> 'status', 'active') in ('active', 'on-hold', 'intended')))
      where id = v_patient;

      for x in select * from jsonb_array_elements(coalesce(p -> 'vitals', '[]')) loop
        if private.emr_num(x, 'temperature_c', 25, 45) is null and private.emr_num(x, 'heart_rate', 20, 250) is null
           and private.emr_num(x, 'systolic', 50, 260) is null and private.emr_num(x, 'diastolic', 30, 180) is null
           and private.emr_num(x, 'respiratory_rate', 4, 80) is null and private.emr_num(x, 'spo2', 50, 100) is null
           and private.emr_num(x, 'weight_kg', 0.3, 400) is null and private.emr_num(x, 'height_cm', 20, 260) is null then
          continue;
        end if;
        insert into public.vitals (organization_id, patient_id, recorded_at, temperature_c, heart_rate, systolic, diastolic, respiratory_rate, spo2,
                                   weight_kg, height_cm, notes, emr_connection_id, external_id)
        values (v_conn.organization_id, v_patient, coalesce(private.emr_ts(x ->> 'recorded_at'), now()),
                private.emr_num(x, 'temperature_c', 25, 45), round(private.emr_num(x, 'heart_rate', 20, 250)), round(private.emr_num(x, 'systolic', 50, 260)),
                round(private.emr_num(x, 'diastolic', 30, 180)), round(private.emr_num(x, 'respiratory_rate', 4, 80)), round(private.emr_num(x, 'spo2', 50, 100)),
                private.emr_num(x, 'weight_kg', 0.3, 400), private.emr_num(x, 'height_cm', 20, 260), 'From ' || v_conn.name,
                v_conn.id, coalesce(nullif(x ->> 'external_id', ''), md5(v_ext || x::text)))
        on conflict (emr_connection_id, external_id) where external_id is not null do nothing;
        get diagnostics v_rows = row_count;
        c_vitals := c_vitals + v_rows;
      end loop;

      for x in select * from jsonb_array_elements(coalesce(p -> 'labs', '[]')) loop
        continue when nullif(btrim(x ->> 'test_name'), '') is null;
        insert into public.lab_results (organization_id, patient_id, test_name, test_type, department, status, reference_range, value, unit, flag,
                                        interpretation, ordered_at, resulted_at, emr_connection_id, external_id)
        values (v_conn.organization_id, v_patient, btrim(x ->> 'test_name'), 'General', 'Laboratory', 'Completed', coalesce(x ->> 'reference_range', ''),
                coalesce(x ->> 'value', ''), coalesce(x ->> 'unit', ''),
                case lower(coalesce(x ->> 'flag', '')) when 'high' then 'High' when 'h' then 'High' when 'low' then 'Low' when 'l' then 'Low'
                  when 'critical' then 'Critical' when 'hh' then 'Critical' when 'll' then 'Critical' when 'panic' then 'Critical' else 'Normal' end,
                nullif(x ->> 'interpretation', ''), coalesce(private.emr_ts(x ->> 'resulted_at'), now()), coalesce(private.emr_ts(x ->> 'resulted_at'), now()),
                v_conn.id, coalesce(nullif(x ->> 'external_id', ''), md5(v_ext || x::text)))
        on conflict (emr_connection_id, external_id) where external_id is not null do update
          set value = excluded.value, unit = excluded.unit, flag = excluded.flag, reference_range = excluded.reference_range,
              interpretation = excluded.interpretation, resulted_at = excluded.resulted_at;
        c_labs := c_labs + 1;
      end loop;

      -- Everything else: read-only history on the patient's EMR page.
      insert into public.emr_records (organization_id, patient_id, connection_id, source_name, kind, external_id, recorded_at, title, detail, status, data)
      select v_conn.organization_id, v_patient, v_conn.id, v_conn.name, r.kind,
             coalesce(nullif(r.item ->> 'external_id', ''), md5(v_ext || r.kind || r.item::text)),
             r.recorded_at, left(r.title, 300), r.detail, r.status, r.item
      from (
        select 'condition' kind, i item, coalesce(i ->> 'name', 'Diagnosis') title, nullif(concat_ws(' · ', i ->> 'code', case when i ? 'onset' then 'since ' || (i ->> 'onset') end), '') detail,
               i ->> 'status' status, coalesce(private.emr_ts(i ->> 'recorded_at'), private.emr_ts(i ->> 'onset')) recorded_at
          from jsonb_array_elements(coalesce(p -> 'conditions', '[]')) i
        union all
        select 'allergy', i, coalesce(i ->> 'substance', 'Allergy'), nullif(concat_ws(' · ', i ->> 'reaction', i ->> 'severity'), ''), i ->> 'status', private.emr_ts(i ->> 'recorded_at')
          from jsonb_array_elements(coalesce(p -> 'allergies', '[]')) i
        union all
        select 'medication', i, coalesce(i ->> 'name', 'Medicine'), i ->> 'dosage', i ->> 'status', private.emr_ts(i ->> 'recorded_at')
          from jsonb_array_elements(coalesce(p -> 'medications', '[]')) i
        union all
        select 'encounter', i, coalesce(nullif(i ->> 'type', ''), 'Visit'), nullif(concat_ws(' · ', i ->> 'reason', i ->> 'location', i ->> 'provider'), ''), i ->> 'status', private.emr_ts(i ->> 'started_at')
          from jsonb_array_elements(coalesce(p -> 'encounters', '[]')) i
        union all
        select 'note', i, coalesce(nullif(i ->> 'title', ''), 'Clinical note'), i ->> 'text', null, private.emr_ts(i ->> 'recorded_at')
          from jsonb_array_elements(coalesce(p -> 'notes', '[]')) i
        union all
        select 'immunization', i, coalesce(i ->> 'vaccine', 'Immunisation'), case when i ? 'dose' then 'Dose ' || (i ->> 'dose') end, i ->> 'status', private.emr_ts(i ->> 'date')
          from jsonb_array_elements(coalesce(p -> 'immunizations', '[]')) i
        union all
        select 'procedure', i, coalesce(i ->> 'name', 'Procedure'), null, i ->> 'status', private.emr_ts(i ->> 'date')
          from jsonb_array_elements(coalesce(p -> 'procedures', '[]')) i
        union all
        select 'observation', i, coalesce(i ->> 'name', 'Observation'), nullif(concat_ws(' ', i ->> 'value', i ->> 'unit'), ''), i ->> 'status', private.emr_ts(i ->> 'recorded_at')
          from jsonb_array_elements(coalesce(p -> 'observations', '[]')) i
      ) r
      on conflict (connection_id, kind, external_id) do update
        set title = excluded.title, detail = excluded.detail, status = excluded.status, recorded_at = excluded.recorded_at,
            data = excluded.data, updated_at = now();
      get diagnostics v_rows = row_count;
      c_records := c_records + v_rows;
      c_patients := c_patients + 1;
    exception when others then
      if jsonb_array_length(v_errors) < 50 then
        v_errors := v_errors || jsonb_build_object('patient', coalesce(p ->> 'external_id', '?'), 'error', sqlerrm);
      end if;
    end;
  end loop;

  update public.emr_sync_runs set
    counts = jsonb_build_object(
      'patients', coalesce((counts ->> 'patients')::int, 0) + c_patients,
      'created', coalesce((counts ->> 'created')::int, 0) + c_created,
      'vitals', coalesce((counts ->> 'vitals')::int, 0) + c_vitals,
      'labs', coalesce((counts ->> 'labs')::int, 0) + c_labs,
      'records', coalesce((counts ->> 'records')::int, 0) + c_records),
    errors = case when jsonb_array_length(errors) < 50 then errors || v_errors else errors end
  where id = p_run;

  return jsonb_build_object('patients', c_patients, 'created', c_created, 'vitals', c_vitals, 'labs', c_labs, 'records', c_records, 'errors', v_errors);
end;
$$;

-- ---------------------------------------------------------------------------
-- Server-side only (edge functions with the service role)

/** Connection settings with the decrypted credential, for emr-sync. */
create or replace function public.emr_sync_config(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(c) - 'push_key_hash' - 'secret_id'
         || jsonb_build_object('secret', (select decrypted_secret from vault.decrypted_secrets where id = c.secret_id))
  from public.emr_connections c where c.id = p_id
$$;

/** The connection a push key belongs to. */
create or replace function public.emr_push_connection(p_key text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', id, 'organization_id', organization_id, 'name', name, 'status', status)
  from public.emr_connections
  where push_key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')
$$;

/** Pull connections whose next scheduled sync is due. */
create or replace function public.emr_due_connections()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select id from public.emr_connections
  where auto_sync and status <> 'paused' and method in ('fhir', 'openmrs', 'lamisplus')
    and (last_sync_at is null or last_sync_at < now() - make_interval(mins => sync_every_minutes))
  order by last_sync_at nulls first
  limit 10
$$;

insert into private.app_config (key, value)
values ('emr_cron_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

create or replace function public.emr_cron_secret()
returns text language sql stable security definer set search_path = '' as $$
  select value from private.app_config where key = 'emr_cron_secret'
$$;

revoke execute on function public.emr_sync_config(uuid), public.emr_push_connection(text), public.emr_due_connections(), public.emr_cron_secret()
  from public, anon, authenticated;
grant execute on function public.emr_sync_config(uuid), public.emr_push_connection(text), public.emr_due_connections(), public.emr_cron_secret()
  to service_role;

revoke execute on function public.emr_save_connection(uuid, uuid, text, text, text, text, text, text, text, text, text, text, boolean, int),
  public.emr_delete_connection(uuid), public.emr_set_status(uuid, text), public.emr_create_push_key(uuid),
  public.emr_begin_run(uuid, text), public.emr_finish_run(uuid, text, jsonb), public.emr_apply_import(uuid, jsonb)
  from public, anon;
grant execute on function public.emr_save_connection(uuid, uuid, text, text, text, text, text, text, text, text, text, text, boolean, int),
  public.emr_delete_connection(uuid), public.emr_set_status(uuid, text), public.emr_create_push_key(uuid),
  public.emr_begin_run(uuid, text), public.emr_finish_run(uuid, text, jsonb), public.emr_apply_import(uuid, jsonb)
  to authenticated, service_role;

-- Scheduled pulls: every 15 minutes the function syncs whatever is due.
select cron.schedule('vitalink-emr-sync', '*/15 * * * *', $$
  select net.http_post(
    url := (select value from private.app_config where key = 'functions_base_url') || '/emr-sync',
    body := '{"action":"scheduled"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-emr-cron', (select value from private.app_config where key = 'emr_cron_secret')))
  where exists (select 1 from public.emr_due_connections())
$$);
