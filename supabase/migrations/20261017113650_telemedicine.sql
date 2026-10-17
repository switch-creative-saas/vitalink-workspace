-- Telemedicine: video visits and specialist conferences.
-- Media flows browser-to-browser (WebRTC); Supabase Realtime carries only the
-- call setup on a channel named after the session's random room token.
-- Patients join from a link without an account: telemedicine_visit(token)
-- returns the minimum they need and puts them in the waiting room.

create table public.telemedicine_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null default 'consultation' check (kind in ('consultation', 'conference')),
  patient_id uuid not null,
  appointment_id uuid references public.appointments (id) on delete set null,
  host_id uuid references public.profiles (id) on delete set null,
  guest_id uuid references public.profiles (id) on delete set null,
  status text not null default 'scheduled' check (status in ('scheduled', 'waiting', 'live', 'ended', 'cancelled')),
  room_token text not null unique,
  consent_at timestamptz,
  consent_by uuid references public.profiles (id) on delete set null,
  patient_waiting_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (patient_id, organization_id) references public.patients (id, organization_id) on delete cascade
);
create index telemedicine_sessions_org_idx on public.telemedicine_sessions (organization_id, created_at desc);
create index telemedicine_sessions_open_idx on public.telemedicine_sessions (organization_id, status) where status in ('scheduled', 'waiting', 'live');
create index telemedicine_sessions_patient_idx on public.telemedicine_sessions (patient_id, organization_id);
create index telemedicine_sessions_appointment_idx on public.telemedicine_sessions (appointment_id);
create index telemedicine_sessions_host_idx on public.telemedicine_sessions (host_id);
create index telemedicine_sessions_guest_idx on public.telemedicine_sessions (guest_id);
create index telemedicine_sessions_consent_by_idx on public.telemedicine_sessions (consent_by);

create or replace function private.telemedicine_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.host_id := auth.uid();
    new.status := 'scheduled';
    new.room_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    new.created_at := now();
    new.started_at := null; new.ended_at := null; new.patient_waiting_at := null;
    new.consent_at := null; new.consent_by := null;
  else
    new.organization_id := old.organization_id;
    new.kind := old.kind;
    new.patient_id := old.patient_id;
    new.host_id := old.host_id;
    new.room_token := old.room_token;
    new.created_at := old.created_at;
    if old.status in ('ended', 'cancelled') and new.status is distinct from old.status then
      raise exception 'This session has already %', old.status using errcode = '42501';
    end if;
    if new.consent_at is not null and old.consent_at is null then
      new.consent_at := now();
      new.consent_by := auth.uid();
    end if;
    if new.status = 'live' and old.status <> 'live' then
      if new.kind = 'conference' and new.consent_at is null then
        raise exception 'Record the patient''s consent before starting a specialist conference' using errcode = '22023';
      end if;
      new.started_at := coalesce(old.started_at, now());
    elsif new.status = 'ended' and old.status <> 'ended' then
      new.ended_at := now();
      new.started_at := coalesce(old.started_at, now());
    end if;
  end if;

  if new.appointment_id is not null and not exists (
    select 1 from public.appointments a
    where a.id = new.appointment_id and a.organization_id = new.organization_id and a.patient_id = new.patient_id
  ) then
    raise exception 'The appointment must be this patient''s, in this workspace' using errcode = '22023';
  end if;
  if new.guest_id is not null and not exists (
    select 1 from public.memberships m
    where m.user_id = new.guest_id and m.organization_id = new.organization_id and m.status = 'active'
  ) then
    raise exception 'The invited specialist must be a member of this workspace' using errcode = '22023';
  end if;

  new.updated_at := now();
  return new;
end;
$$;
create trigger telemedicine_sessions_stamp before insert or update on public.telemedicine_sessions
  for each row execute function private.telemedicine_stamp();
create trigger telemedicine_sessions_audit after insert or update or delete on public.telemedicine_sessions
  for each row execute function private.write_audit();

alter table public.telemedicine_sessions enable row level security;
create policy "clinical staff read telemedicine" on public.telemedicine_sessions
  for select to authenticated using (private.has_role(organization_id, private.clinical_read_roles()));
create policy "clinicians create telemedicine" on public.telemedicine_sessions
  for insert to authenticated with check (private.has_role(organization_id, private.vitals_write_roles()));
create policy "clinicians run telemedicine" on public.telemedicine_sessions
  for update to authenticated
  using (private.has_role(organization_id, private.vitals_write_roles()))
  with check (private.has_role(organization_id, private.vitals_write_roles()));
revoke all on public.telemedicine_sessions from anon;

alter publication supabase_realtime add table public.telemedicine_sessions;

-- Creates a session (and, for an appointment, stores the patient's join link on it).
create or replace function public.create_telemedicine_session(
  p_patient_id uuid,
  p_kind text default 'consultation',
  p_appointment_id uuid default null,
  p_guest_id uuid default null,
  p_join_base_url text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  org uuid := (select organization_id from public.patients where id = p_patient_id);
  session public.telemedicine_sessions;
begin
  if org is null then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;
  insert into public.telemedicine_sessions (organization_id, kind, patient_id, appointment_id, guest_id, room_token)
  values (org, coalesce(p_kind, 'consultation'), p_patient_id, p_appointment_id, p_guest_id, '')
  returning * into session;

  if p_appointment_id is not null and p_join_base_url is not null and session.kind = 'consultation' then
    update public.appointments
    set telemedicine_url = p_join_base_url || '?t=' || session.room_token
    where id = p_appointment_id;
  end if;
  return jsonb_build_object('id', session.id, 'room_token', session.room_token);
end;
$$;
revoke execute on function public.create_telemedicine_session(uuid, text, uuid, uuid, text) from public, anon;
grant execute on function public.create_telemedicine_session(uuid, text, uuid, uuid, text) to authenticated;

-- Patient side (no account): what the join page shows, and puts them in the waiting room.
create or replace function public.telemedicine_visit(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.telemedicine_sessions;
  info jsonb;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;
  select * into s from public.telemedicine_sessions
  where room_token = p_token and kind = 'consultation'
  for update;
  if s.id is null then
    return null;
  end if;

  if s.status = 'scheduled' then
    update public.telemedicine_sessions
    set status = 'waiting', patient_waiting_at = now(), updated_at = now()
    where id = s.id;
    s.status := 'waiting';
  elsif s.status = 'waiting' then
    update public.telemedicine_sessions set patient_waiting_at = now(), updated_at = now() where id = s.id;
  end if;

  select jsonb_build_object(
           'status', s.status,
           'facility', o.name,
           'clinician', coalesce(nullif(h.full_name, ''), 'your clinician'),
           'patient_first_name', p.first_name,
           'scheduled_for', a.starts_at)
  into info
  from public.organizations o
  join public.patients p on p.id = s.patient_id
  left join public.profiles h on h.id = s.host_id
  left join public.appointments a on a.id = s.appointment_id
  where o.id = s.organization_id;
  return info;
end;
$$;
revoke execute on function public.telemedicine_visit(text) from public;
grant execute on function public.telemedicine_visit(text) to anon, authenticated;

-- Activity feed: finished video visits / conferences.
do $$
declare
  def text := pg_get_functiondef('public.recent_activity(uuid, integer, timestamptz)'::regprocedure);
begin
  def := replace(def, '    -- ---- billing roles ----', $branch$    union all
    (select 'telemedicine', t.ended_at, t.host_id, p.switch_id,
            case when t.kind = 'conference' then 'Specialist conference about ' else 'Video visit with ' end
              || p.first_name || ' ' || p.last_name
              || coalesce(' (' || greatest(1, round(extract(epoch from (t.ended_at - t.started_at)) / 60))::int || ' min)', '')
     from public.telemedicine_sessions t
     join public.patients p on p.id = t.patient_id
     where can_clinical and t.organization_id = org and t.status = 'ended' and t.ended_at is not null and t.ended_at <= before_ts
     order by t.ended_at desc limit lim)
    -- ---- billing roles ----$branch$);
  execute def;
end;
$$;
