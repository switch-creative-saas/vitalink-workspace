-- Specialist conferences across the VitaLink Network. A doctor can invite a specialist from
-- their own hospital or from any network hospital that offers telemedicine. The outside
-- specialist is not a member of the inviting hospital, so they never get its records: they see
-- the case note the inviting doctor wrote, the patient's name, age and sex, and the call itself.
-- Patient consent is still required before the call can start (telemedicine_stamp).
alter table public.telemedicine_sessions
  add column if not exists guest_organization_id uuid references public.organizations(id) on delete set null,
  add column if not exists guest_name text,
  add column if not exists guest_facility text,
  add column if not exists case_summary text check (case_summary is null or length(case_summary) <= 4000);

-- Doctors (and admins) at a network hospital that offers telemedicine and is listed in the directory.
create or replace function private.network_specialist_ok(p_user_id uuid, p_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    join public.network_profiles np on np.organization_id = o.id
    where m.user_id = p_user_id and m.organization_id = p_organization_id and m.status = 'active'
      and m.role in ('doctor', 'hospital-admin', 'super-admin')
      and o.joined_network and np.visible_in_directory and np.telemedicine
  )
$$;
revoke all on function private.network_specialist_ok(uuid, uuid) from public, anon, authenticated;

create or replace function private.telemedicine_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  inside boolean;
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

  if new.guest_id is null then
    new.guest_organization_id := null; new.guest_name := null; new.guest_facility := null;
  elsif tg_op = 'INSERT' or new.guest_id is distinct from old.guest_id or new.guest_organization_id is distinct from old.guest_organization_id then
    inside := exists (select 1 from public.memberships m
      where m.user_id = new.guest_id and m.organization_id = new.organization_id and m.status = 'active');
    if inside then
      new.guest_organization_id := new.organization_id;
    else
      if new.kind <> 'conference' then
        raise exception 'Only specialist conferences can include someone from another hospital' using errcode = '22023';
      end if;
      if not exists (select 1 from public.organizations o where o.id = new.organization_id and o.joined_network) then
        raise exception 'Join the VitaLink Network to invite specialists from other hospitals' using errcode = '22023';
      end if;
      if new.guest_organization_id is null or not private.network_specialist_ok(new.guest_id, new.guest_organization_id) then
        raise exception 'This specialist is not available for network conferences' using errcode = '22023';
      end if;
    end if;
    new.guest_name := (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = new.guest_id);
    new.guest_facility := (select o.name from public.organizations o where o.id = new.guest_organization_id);
  else
    new.guest_organization_id := old.guest_organization_id;
    new.guest_name := old.guest_name;
    new.guest_facility := old.guest_facility;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.create_telemedicine_session(
  p_patient_id uuid, p_kind text default 'consultation', p_appointment_id uuid default null,
  p_guest_id uuid default null, p_join_base_url text default null,
  p_guest_organization_id uuid default null, p_case_summary text default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  org uuid := (select organization_id from public.patients where id = p_patient_id);
  session public.telemedicine_sessions;
begin
  if org is null then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;
  insert into public.telemedicine_sessions (organization_id, kind, patient_id, appointment_id, guest_id, guest_organization_id, case_summary, room_token)
  values (org, coalesce(p_kind, 'consultation'), p_patient_id, p_appointment_id, p_guest_id, p_guest_organization_id, nullif(trim(p_case_summary), ''), '')
  returning * into session;

  if p_appointment_id is not null and p_join_base_url is not null and session.kind = 'consultation' then
    update public.appointments
    set telemedicine_url = p_join_base_url || '?t=' || session.room_token
    where id = p_appointment_id;
  end if;
  return jsonb_build_object('id', session.id, 'room_token', session.room_token);
end;
$$;
drop function if exists public.create_telemedicine_session(uuid, text, uuid, uuid, text);
revoke all on function public.create_telemedicine_session(uuid, text, uuid, uuid, text, uuid, text) from public, anon;
grant execute on function public.create_telemedicine_session(uuid, text, uuid, uuid, text, uuid, text) to authenticated;

-- Specialists a doctor can invite from another network hospital.
create or replace function public.network_specialists(p_organization_id uuid)
returns table (user_id uuid, full_name text, job_title text, department text, role text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, coalesce(nullif(p.full_name, ''), p.email), p.job_title, m.department, m.role
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.organization_id = p_organization_id
    and m.user_id <> auth.uid()
    and private.network_specialist_ok(m.user_id, p_organization_id)
    -- The caller must be a doctor or admin at a different hospital that is itself on the network.
    and exists (
      select 1 from public.memberships me join public.organizations o on o.id = me.organization_id
      where me.user_id = auth.uid() and me.status = 'active' and o.joined_network
        and me.organization_id <> p_organization_id
        and me.role in ('doctor', 'hospital-admin', 'super-admin')
        and private.is_member(me.organization_id)
    )
  order by m.role = 'doctor' desc, 2
$$;
revoke all on function public.network_specialists(uuid) from public, anon;
grant execute on function public.network_specialists(uuid) to authenticated;

-- Conferences another hospital invited me to, as seen from my workspace.
create or replace function public.network_my_conferences(p_organization_id uuid)
returns table (
  id uuid, status text, room_token text, host_name text, host_facility text,
  patient_name text, patient_age integer, patient_sex text, case_summary text, summary text,
  consent_at timestamptz, started_at timestamptz, created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select s.id, s.status, s.room_token,
         (select coalesce(nullif(h.full_name, ''), h.email) from public.profiles h where h.id = s.host_id),
         o.name,
         trim(pt.first_name || ' ' || pt.last_name),
         case when pt.date_of_birth is null then null else extract(year from age(pt.date_of_birth))::integer end,
         pt.gender, s.case_summary, s.summary, s.consent_at, s.started_at, s.created_at
  from public.telemedicine_sessions s
  join public.organizations o on o.id = s.organization_id
  join public.patients pt on pt.id = s.patient_id
  where s.kind = 'conference'
    and s.guest_id = auth.uid()
    and s.guest_organization_id = p_organization_id
    and s.organization_id <> p_organization_id
    and private.is_member(p_organization_id)
    and (s.status in ('scheduled', 'waiting', 'live') or s.created_at > now() - interval '2 days')
  order by s.created_at desc
$$;
revoke all on function public.network_my_conferences(uuid) from public, anon;
grant execute on function public.network_my_conferences(uuid) to authenticated;

-- The outside specialist adds to the case discussion summary (they can't edit anything else).
create or replace function public.network_conference_save_summary(p_session_id uuid, p_summary text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.telemedicine_sessions;
begin
  select * into s from public.telemedicine_sessions where id = p_session_id;
  if s.id is null or s.guest_id is distinct from auth.uid() or s.guest_organization_id is null
     or not private.is_member(s.guest_organization_id) then
    raise exception 'Conference not found' using errcode = 'P0002';
  end if;
  if s.status = 'cancelled' then
    raise exception 'This conference was cancelled' using errcode = '22023';
  end if;
  update public.telemedicine_sessions set summary = left(coalesce(p_summary, ''), 8000) where id = s.id;
end;
$$;
revoke all on function public.network_conference_save_summary(uuid, text) from public, anon;
grant execute on function public.network_conference_save_summary(uuid, text) to authenticated;

-- Lets the invited specialist receive live updates for their own invitations (realtime follows
-- RLS). Only the session row: no patient record, and only while their sign-in passes MFA.
drop policy if exists "invited specialist reads own conference" on public.telemedicine_sessions;
create policy "invited specialist reads own conference" on public.telemedicine_sessions
  for select to authenticated using (guest_id = auth.uid() and kind = 'conference' and private.mfa_ok());
