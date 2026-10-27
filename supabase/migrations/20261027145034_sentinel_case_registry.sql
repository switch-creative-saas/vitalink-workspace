-- Sentinel case registry: a real history for every case, and writes only through
-- role-checked functions (viewers and analysts read; admins, officers and field
-- workers report and update). Cases from VitaLink hospitals and partner APIs keep
-- arriving through the pipeline functions, which run as the database owner.

create table public.sentinel_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.sentinel_cases(id) on delete cascade,
  sentinel_org_id uuid not null references public.sentinel_organizations(id) on delete cascade,
  kind text not null check (kind in ('reported', 'status', 'lab', 'outbreak', 'note', 'contact_tracing', 'hospitalized')),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  actor_name text,
  created_at timestamptz not null default now()
);
create index sentinel_case_events_case_idx on public.sentinel_case_events (case_id, created_at);

alter table public.sentinel_case_events enable row level security;
create policy sentinel_case_events_read on public.sentinel_case_events for select to authenticated
  using (private.is_sentinel_member(sentinel_org_id));
revoke insert, update, delete on public.sentinel_case_events from authenticated, anon;

-- Direct edits are replaced by the functions below.
drop policy if exists sentinel_officer_insert_cases on public.sentinel_cases;
drop policy if exists sentinel_officer_update_cases on public.sentinel_cases;
revoke insert, update, delete, truncate on public.sentinel_cases from authenticated, anon;

create or replace function private.sentinel_actor()
returns table (actor_id uuid, actor_name text) language sql stable security definer set search_path = '' as $$
  select auth.uid(), (select coalesce(nullif(full_name, ''), email) from public.sentinel_users where id = auth.uid() limit 1)
$$;

-- Every change to a case is written to its history, whoever or whatever made it.
create or replace function private.sentinel_case_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_name text := coalesce((select coalesce(nullif(full_name, ''), email) from public.sentinel_users where id = auth.uid() limit 1),
                          new.source_label,
                          case new.source_type when 'vitalink_emr_sync' then 'VitaLink hospital' when 'partner_api' then 'Partner system'
                                               when 'lab_notification' then 'Laboratory' else 'Sentinel' end);
begin
  if tg_op = 'INSERT' then
    insert into public.sentinel_case_events (case_id, sentinel_org_id, kind, detail, actor_id, actor_name)
    values (new.id, new.sentinel_org_id, 'reported',
            jsonb_build_object('status', new.case_status, 'source_type', new.source_type, 'source_label', new.source_label,
                               'lab_confirmed', new.lab_confirmed), v_actor, v_name);
    return null;
  end if;
  if new.case_status is distinct from old.case_status then
    insert into public.sentinel_case_events (case_id, sentinel_org_id, kind, detail, actor_id, actor_name)
    values (new.id, new.sentinel_org_id, 'status', jsonb_build_object('from', old.case_status, 'to', new.case_status), v_actor, v_name);
  end if;
  if new.lab_confirmed is distinct from old.lab_confirmed then
    insert into public.sentinel_case_events (case_id, sentinel_org_id, kind, detail, actor_id, actor_name)
    values (new.id, new.sentinel_org_id, 'lab', jsonb_build_object('lab_confirmed', new.lab_confirmed), v_actor, v_name);
  end if;
  if new.linked_outbreak_id is distinct from old.linked_outbreak_id then
    insert into public.sentinel_case_events (case_id, sentinel_org_id, kind, detail, actor_id, actor_name)
    values (new.id, new.sentinel_org_id, 'outbreak', jsonb_build_object(
      'outbreak_id', new.linked_outbreak_id,
      'outbreak', (select disease || ' · ' || state from public.sentinel_outbreaks where id = new.linked_outbreak_id)), v_actor, v_name);
  end if;
  if new.contact_tracing_initiated is distinct from old.contact_tracing_initiated then
    insert into public.sentinel_case_events (case_id, sentinel_org_id, kind, detail, actor_id, actor_name)
    values (new.id, new.sentinel_org_id, 'contact_tracing', jsonb_build_object('initiated', new.contact_tracing_initiated), v_actor, v_name);
  end if;
  if new.hospitalized is distinct from old.hospitalized then
    insert into public.sentinel_case_events (case_id, sentinel_org_id, kind, detail, actor_id, actor_name)
    values (new.id, new.sentinel_org_id, 'hospitalized', jsonb_build_object('hospitalized', new.hospitalized), v_actor, v_name);
  end if;
  return null;
end;
$$;

create trigger sentinel_cases_history after insert or update on public.sentinel_cases
  for each row execute function private.sentinel_case_history();

-- Earlier cases get their "reported" entry so every timeline starts somewhere.
insert into public.sentinel_case_events (case_id, sentinel_org_id, kind, detail, actor_name, created_at)
select c.id, c.sentinel_org_id, 'reported', jsonb_build_object('status', c.case_status, 'source_type', c.source_type, 'source_label', c.source_label),
       coalesce(c.source_label, 'Sentinel'), c.created_at
from public.sentinel_cases c
where not exists (select 1 from public.sentinel_case_events e where e.case_id = c.id);

create or replace function private.sentinel_can_report(p_sentinel_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sentinel_users where id = auth.uid() and sentinel_org_id = p_sentinel_org and is_active
                 and role in ('admin', 'officer', 'field_worker'))
$$;

/**
 * Manual case report from Sentinel. p_case: { disease, status, lab_confirmed, age_group, sex, state, lga,
 * facility_id, onset_date, report_date, hospitalized, symptoms[], notes, local_ref, outbreak_id,
 * travel_history, contact_tracing_initiated }. local_ref (the reporter's own case number) is stored only
 * as a pseudonym and lets a repeat report of the same patient update the existing case.
 */
create or replace function public.sentinel_report_case(p_sentinel_org uuid, p_case jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_disease text := private.sentinel_resolve_disease(p_case ->> 'disease');
  v_facility uuid;
  v_outbreak uuid;
  v_ref text;
  v_name text;
  v_result jsonb;
begin
  if not private.sentinel_can_report(p_sentinel_org) then
    raise exception 'Your Sentinel role can view cases but not report them' using errcode = '42501';
  end if;
  if v_disease is null then raise exception 'Choose a disease from the registry' using errcode = '22023'; end if;

  select id into v_facility from public.sentinel_linked_facilities
  where id = nullif(p_case ->> 'facility_id', '')::uuid and sentinel_org_id = p_sentinel_org;
  select id into v_outbreak from public.sentinel_outbreaks
  where id = nullif(p_case ->> 'outbreak_id', '')::uuid and sentinel_org_id = p_sentinel_org;
  if nullif(btrim(p_case ->> 'local_ref'), '') is not null then
    v_ref := private.sentinel_patient_ref(p_sentinel_org, 'manual:' || btrim(p_case ->> 'local_ref'));
  end if;
  select actor_name into v_name from private.sentinel_actor();

  v_result := private.sentinel_record_case(
    p_sentinel_org, v_facility, null, v_ref, v_disease, p_case ->> 'status', (p_case ->> 'lab_confirmed')::boolean,
    'manual', null, coalesce(v_name, 'Sentinel officer'), p_case ->> 'age_group', p_case ->> 'sex',
    coalesce(nullif(p_case ->> 'state', ''), (select state from public.sentinel_linked_facilities where id = v_facility)),
    coalesce(nullif(p_case ->> 'lga', ''), (select lga from public.sentinel_linked_facilities where id = v_facility)),
    nullif(p_case ->> 'onset_date', '')::date, nullif(p_case ->> 'report_date', '')::date,
    (p_case ->> 'hospitalized')::boolean,
    array(select jsonb_array_elements_text(coalesce(p_case -> 'symptoms', '[]'))), nullif(btrim(p_case ->> 'notes'), ''));

  if v_result ->> 'result' = 'rejected' then raise exception '%', v_result ->> 'reason' using errcode = '22023'; end if;
  update public.sentinel_cases set
    reported_by = coalesce(reported_by, auth.uid()),
    linked_outbreak_id = coalesce(v_outbreak, linked_outbreak_id),
    travel_history = coalesce((p_case ->> 'travel_history')::boolean, travel_history),
    contact_tracing_initiated = coalesce((p_case ->> 'contact_tracing_initiated')::boolean, contact_tracing_initiated)
  where id = (v_result ->> 'id')::uuid;
  return v_result;
end;
$$;

/** Status, lab confirmation, outbreak link, contact tracing or admission. Missing keys are left as they are. */
create or replace function public.sentinel_update_case(p_case uuid, p_changes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_case public.sentinel_cases;
  v_outbreak uuid;
begin
  select * into v_case from public.sentinel_cases where id = p_case for update;
  if v_case.id is null then raise exception 'Case not found' using errcode = 'P0002'; end if;
  if not private.sentinel_can_report(v_case.sentinel_org_id) then
    raise exception 'Your Sentinel role can view cases but not change them' using errcode = '42501';
  end if;
  if p_changes ? 'status' and p_changes ->> 'status' not in ('suspected', 'probable', 'confirmed', 'recovered', 'deceased') then
    raise exception 'Unknown case status' using errcode = '22023';
  end if;
  if p_changes ? 'outbreak_id' and p_changes ->> 'outbreak_id' is not null then
    select id into v_outbreak from public.sentinel_outbreaks
    where id = (p_changes ->> 'outbreak_id')::uuid and sentinel_org_id = v_case.sentinel_org_id;
    if v_outbreak is null then raise exception 'Outbreak not found' using errcode = 'P0002'; end if;
  end if;

  update public.sentinel_cases set
    case_status = coalesce(p_changes ->> 'status', case_status),
    lab_confirmed = coalesce((p_changes ->> 'lab_confirmed')::boolean, lab_confirmed),
    linked_outbreak_id = case when p_changes ? 'outbreak_id' then v_outbreak else linked_outbreak_id end,
    contact_tracing_initiated = coalesce((p_changes ->> 'contact_tracing_initiated')::boolean, contact_tracing_initiated),
    hospitalized = coalesce((p_changes ->> 'hospitalized')::boolean, hospitalized),
    updated_at = now()
  where id = p_case;
end;
$$;

create or replace function public.sentinel_add_case_note(p_case uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select sentinel_org_id into v_org from public.sentinel_cases where id = p_case;
  if v_org is null then raise exception 'Case not found' using errcode = 'P0002'; end if;
  if not private.sentinel_can_report(v_org) then
    raise exception 'Your Sentinel role can view cases but not add notes' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) = 0 then raise exception 'Write a note first' using errcode = '22023'; end if;
  insert into public.sentinel_case_events (case_id, sentinel_org_id, kind, detail, actor_id, actor_name)
  select p_case, v_org, 'note', jsonb_build_object('text', left(btrim(p_note), 4000)), a.actor_id, a.actor_name from private.sentinel_actor() a;
end;
$$;

revoke execute on function public.sentinel_report_case(uuid, jsonb), public.sentinel_update_case(uuid, jsonb), public.sentinel_add_case_note(uuid, text) from public, anon;
grant execute on function public.sentinel_report_case(uuid, jsonb), public.sentinel_update_case(uuid, jsonb), public.sentinel_add_case_note(uuid, text) to authenticated;
