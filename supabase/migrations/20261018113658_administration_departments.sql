-- Administration: real departments per workspace, facility operating settings,
-- and the admin RPCs behind the Administration page.
--
-- Staff, invitations and appointments keep their department as text (the
-- department's name), so booking, analytics and the staff list keep working;
-- renaming a department here renames it everywhere in the workspace.

create or replace function private.default_working_hours()
returns jsonb language sql immutable set search_path = '' as $$
  select '[
    {"day":0,"open":"09:00","close":"13:00","closed":true},
    {"day":1,"open":"08:00","close":"17:00","closed":false},
    {"day":2,"open":"08:00","close":"17:00","closed":false},
    {"day":3,"open":"08:00","close":"17:00","closed":false},
    {"day":4,"open":"08:00","close":"17:00","closed":false},
    {"day":5,"open":"08:00","close":"17:00","closed":false},
    {"day":6,"open":"09:00","close":"13:00","closed":false}
  ]'::jsonb
$$;

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 80),
  code text not null check (code ~ '^[A-Z0-9-]{2,12}$'),
  description text not null default '',
  location text not null default '',
  head_membership_id uuid references public.memberships(id) on delete set null,
  working_hours jsonb not null default private.default_working_hours(),
  linked_services text[] not null default '{}',
  rooms integer not null default 0 check (rooms between 0 and 10000),
  equipment integer not null default 0 check (equipment between 0 and 100000),
  beds integer not null default 0 check (beds between 0 and 10000),
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index departments_org_name_key on public.departments (organization_id, lower(name));
create unique index departments_org_code_key on public.departments (organization_id, code);
create index departments_head_idx on public.departments (head_membership_id);
create trigger departments_set_updated_at before update on public.departments
  for each row execute function private.set_updated_at();

alter table public.departments enable row level security;
create policy "members read departments" on public.departments
  for select to authenticated using (private.is_member(organization_id));
-- All writes go through the definer RPCs below (validation + audit trail).

grant select on public.departments to authenticated;

-- Facility operating settings, enforced when appointments are booked.
alter table public.organizations
  add column max_patients_per_day integer check (max_patients_per_day between 1 and 100000),
  add column appointment_buffer_minutes integer not null default 0 check (appointment_buffer_minutes between 0 and 240),
  add column emergency_24x7 boolean not null default false;

-- Backfill: every department name already used by staff, invitations or
-- appointments becomes a real department.
insert into public.departments (organization_id, name, code)
select organization_id, name,
       left(regexp_replace(upper(name), '[^A-Z0-9]', '', 'g'), 4) || '-' || lpad(row_number() over (partition by organization_id order by name)::text, 2, '0')
from (
  select distinct on (organization_id, lower(btrim(department))) organization_id, btrim(department) as name
  from (
    select organization_id, department from public.memberships
    union all select organization_id, department from public.staff_invitations
    union all select organization_id, department from public.appointments
  ) used
  where length(btrim(coalesce(department, ''))) >= 2
  order by organization_id, lower(btrim(department))
) d
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Helpers
create or replace function private.department_audit(p_org uuid, p_department uuid, p_action text, p_summary text, p_extra jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
  values (p_org, auth.uid(), p_action, 'departments', p_department::text, jsonb_build_object('summary', p_summary) || coalesce(p_extra, '{}'));
$$;
revoke all on function private.department_audit(uuid, uuid, text, text, jsonb) from public, anon, authenticated;

create or replace function private.valid_working_hours(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'array' and jsonb_array_length(p) = 7
     and (select count(distinct (e ->> 'day')::int) = 7 and bool_and(
            (e ->> 'day') ~ '^[0-6]$'
            and (e ->> 'open') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            and (e ->> 'close') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            and jsonb_typeof(e -> 'closed') = 'boolean'
            and ((e ->> 'closed')::boolean or (e ->> 'close') > (e ->> 'open')))
          from jsonb_array_elements(p) e)
$$;

-- ---------------------------------------------------------------------------
-- Create / update a department. p_id null creates.
create or replace function public.department_save(
  p_organization_id uuid, p_id uuid, p_name text, p_code text, p_description text, p_location text,
  p_head_membership_id uuid, p_working_hours jsonb, p_linked_services text[],
  p_rooms integer, p_equipment integer, p_beds integer, p_is_active boolean)
returns public.departments
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.departments;
  v_row public.departments;
  v_name text := btrim(coalesce(p_name, ''));
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_changes text[] := '{}';
begin
  if not private.has_role(p_organization_id, private.admin_roles()) then
    raise exception 'Only workspace admins can manage departments' using errcode = '42501';
  end if;
  if length(v_name) < 2 then raise exception 'Give the department a name' using errcode = '22023'; end if;
  if v_code !~ '^[A-Z0-9-]{2,12}$' then
    raise exception 'Department code must be 2-12 letters, numbers or dashes' using errcode = '22023';
  end if;
  if p_working_hours is not null and not private.valid_working_hours(p_working_hours) then
    raise exception 'Opening hours must close after they open' using errcode = '22023';
  end if;
  if p_head_membership_id is not null and not exists (
    select 1 from public.memberships where id = p_head_membership_id and organization_id = p_organization_id and status = 'active') then
    raise exception 'Head of department must be active staff in this workspace' using errcode = '22023';
  end if;
  if exists (select 1 from public.departments where organization_id = p_organization_id and id is distinct from p_id and lower(name) = lower(v_name)) then
    raise exception 'A department called "%" already exists', v_name using errcode = '23505';
  end if;
  if exists (select 1 from public.departments where organization_id = p_organization_id and id is distinct from p_id and code = v_code) then
    raise exception 'Department code % is already used', v_code using errcode = '23505';
  end if;

  if p_id is null then
    insert into public.departments (organization_id, name, code, description, location, head_membership_id,
      working_hours, linked_services, rooms, equipment, beds, is_active)
    values (p_organization_id, v_name, v_code, coalesce(btrim(p_description), ''), coalesce(btrim(p_location), ''), p_head_membership_id,
      coalesce(p_working_hours, private.default_working_hours()), coalesce(p_linked_services, '{}'),
      greatest(coalesce(p_rooms, 0), 0), greatest(coalesce(p_equipment, 0), 0), greatest(coalesce(p_beds, 0), 0), coalesce(p_is_active, true))
    returning * into v_row;
    perform private.department_audit(p_organization_id, v_row.id, 'department.created', format('Department %s (%s) created', v_name, v_code));
    return v_row;
  end if;

  select * into v_old from public.departments where id = p_id and organization_id = p_organization_id for update;
  if v_old.id is null then raise exception 'Department not found' using errcode = 'P0002'; end if;

  update public.departments set
    name = v_name, code = v_code,
    description = coalesce(btrim(p_description), ''), location = coalesce(btrim(p_location), ''),
    head_membership_id = p_head_membership_id,
    working_hours = coalesce(p_working_hours, working_hours),
    linked_services = coalesce(p_linked_services, '{}'),
    rooms = greatest(coalesce(p_rooms, 0), 0), equipment = greatest(coalesce(p_equipment, 0), 0), beds = greatest(coalesce(p_beds, 0), 0),
    is_active = coalesce(p_is_active, is_active)
  where id = p_id
  returning * into v_row;

  -- A rename follows the department everywhere its name is used.
  if v_old.name <> v_row.name then
    update public.memberships set department = v_row.name
      where organization_id = p_organization_id and lower(btrim(department)) = lower(v_old.name);
    update public.staff_invitations set department = v_row.name
      where organization_id = p_organization_id and lower(btrim(department)) = lower(v_old.name);
    update public.appointments set department = v_row.name
      where organization_id = p_organization_id and lower(btrim(department)) = lower(v_old.name);
    v_changes := v_changes || format('renamed from %s', v_old.name);
  end if;
  if v_old.head_membership_id is distinct from v_row.head_membership_id then v_changes := v_changes || 'head of department changed'::text; end if;
  if v_old.is_active <> v_row.is_active then v_changes := v_changes || (case when v_row.is_active then 'reactivated' else 'deactivated' end); end if;
  if v_old.working_hours <> v_row.working_hours then v_changes := v_changes || 'opening hours changed'::text; end if;
  if (v_old.rooms, v_old.equipment, v_old.beds) <> (v_row.rooms, v_row.equipment, v_row.beds) then v_changes := v_changes || 'resources updated'::text; end if;
  if v_old.code <> v_row.code or v_old.description <> v_row.description or v_old.location <> v_row.location
     or v_old.linked_services <> v_row.linked_services then v_changes := v_changes || 'details updated'::text; end if;

  if cardinality(v_changes) > 0 then
    perform private.department_audit(p_organization_id, v_row.id, 'department.updated',
      format('%s: %s', v_row.name, array_to_string(v_changes, ', ')));
  end if;
  return v_row;
end;
$$;

-- Assign staff to a department (or move them from another one).
create or replace function public.department_assign_staff(p_department_id uuid, p_membership_ids uuid[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_dept public.departments;
  v_member record;
  v_count integer := 0;
  v_from uuid;
begin
  select * into v_dept from public.departments where id = p_department_id;
  if v_dept.id is null then raise exception 'Department not found' using errcode = 'P0002'; end if;
  if not private.has_role(v_dept.organization_id, private.admin_roles()) then
    raise exception 'Only workspace admins can assign staff' using errcode = '42501';
  end if;

  for v_member in
    select m.id, m.department, coalesce(nullif(p.full_name, ''), p.email, 'Staff member') as name
    from public.memberships m left join public.profiles p on p.id = m.user_id
    where m.id = any(coalesce(p_membership_ids, '{}')) and m.organization_id = v_dept.organization_id and m.status = 'active'
  loop
    if lower(btrim(coalesce(v_member.department, ''))) = lower(v_dept.name) then continue; end if;
    update public.memberships set department = v_dept.name where id = v_member.id;
    v_count := v_count + 1;
    if coalesce(btrim(v_member.department), '') = '' then
      perform private.department_audit(v_dept.organization_id, v_dept.id, 'department.staff_added',
        format('%s joined %s', v_member.name, v_dept.name), jsonb_build_object('membership_id', v_member.id));
    else
      select id into v_from from public.departments
        where organization_id = v_dept.organization_id and lower(name) = lower(btrim(v_member.department));
      perform private.department_audit(v_dept.organization_id, v_dept.id, 'department.staff_transferred',
        format('%s moved from %s to %s', v_member.name, btrim(v_member.department), v_dept.name),
        jsonb_build_object('membership_id', v_member.id, 'staff_name', v_member.name,
          'from_department_id', v_from, 'from_department', btrim(v_member.department), 'to_department', v_dept.name));
      -- The head of the old department stops being its head when moved out.
      if v_from is not null then
        update public.departments set head_membership_id = null where id = v_from and head_membership_id = v_member.id;
      end if;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Take a staff member out of their department.
create or replace function public.department_remove_staff(p_department_id uuid, p_membership_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_dept public.departments;
  v_name text;
begin
  select * into v_dept from public.departments where id = p_department_id;
  if v_dept.id is null then raise exception 'Department not found' using errcode = 'P0002'; end if;
  if not private.has_role(v_dept.organization_id, private.admin_roles()) then
    raise exception 'Only workspace admins can change staff departments' using errcode = '42501';
  end if;
  select coalesce(nullif(p.full_name, ''), p.email, 'Staff member') into v_name
    from public.memberships m left join public.profiles p on p.id = m.user_id
    where m.id = p_membership_id and m.organization_id = v_dept.organization_id
      and lower(btrim(coalesce(m.department, ''))) = lower(v_dept.name);
  if v_name is null then raise exception 'That staff member is not in this department' using errcode = 'P0002'; end if;

  update public.memberships set department = null where id = p_membership_id;
  update public.departments set head_membership_id = null where id = v_dept.id and head_membership_id = p_membership_id;
  perform private.department_audit(v_dept.organization_id, v_dept.id, 'department.staff_removed',
    format('%s left %s', v_name, v_dept.name), jsonb_build_object('membership_id', p_membership_id));
end;
$$;

-- Delete a department. Its staff become unassigned; past appointments keep the name.
create or replace function public.department_delete(p_department_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_dept public.departments;
  v_staff integer;
begin
  select * into v_dept from public.departments where id = p_department_id;
  if v_dept.id is null then raise exception 'Department not found' using errcode = 'P0002'; end if;
  if not private.has_role(v_dept.organization_id, private.admin_roles()) then
    raise exception 'Only workspace admins can delete departments' using errcode = '42501';
  end if;
  update public.memberships set department = null
    where organization_id = v_dept.organization_id and lower(btrim(department)) = lower(v_dept.name);
  get diagnostics v_staff = row_count;
  delete from public.departments where id = v_dept.id;
  perform private.department_audit(v_dept.organization_id, v_dept.id, 'department.deleted',
    format('Department %s (%s) deleted%s', v_dept.name, v_dept.code,
      case when v_staff > 0 then format(', %s staff unassigned', v_staff) else '' end));
end;
$$;

-- Facility profile + operating settings.
create or replace function public.facility_save(
  p_organization_id uuid, p_name text, p_address text, p_state text, p_contact_phone text, p_contact_email text,
  p_website text, p_max_patients_per_day integer, p_appointment_buffer_minutes integer, p_emergency_24x7 boolean)
returns public.organizations
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.organizations;
begin
  if not private.has_role(p_organization_id, private.admin_roles()) then
    raise exception 'Only workspace admins can change facility settings' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'Facility name is required' using errcode = '22023'; end if;
  if nullif(btrim(p_contact_email), '') is not null and btrim(p_contact_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid contact email' using errcode = '22023';
  end if;
  if p_max_patients_per_day is not null and p_max_patients_per_day not between 1 and 100000 then
    raise exception 'Max patients per day must be between 1 and 100000' using errcode = '22023';
  end if;
  if coalesce(p_appointment_buffer_minutes, 0) not between 0 and 240 then
    raise exception 'Buffer must be between 0 and 240 minutes' using errcode = '22023';
  end if;

  update public.organizations set
    name = btrim(p_name),
    address = nullif(btrim(p_address), ''),
    state = nullif(btrim(p_state), ''),
    contact_phone = nullif(btrim(p_contact_phone), ''),
    contact_email = nullif(lower(btrim(p_contact_email)), ''),
    website = nullif(btrim(p_website), ''),
    max_patients_per_day = p_max_patients_per_day,
    appointment_buffer_minutes = coalesce(p_appointment_buffer_minutes, 0),
    emergency_24x7 = coalesce(p_emergency_24x7, false)
  where id = p_organization_id
  returning * into v_row;

  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
  values (p_organization_id, auth.uid(), 'facility.updated', 'organizations', p_organization_id::text,
    jsonb_build_object('summary', 'Facility profile and operating settings saved',
      'max_patients_per_day', p_max_patients_per_day, 'appointment_buffer_minutes', coalesce(p_appointment_buffer_minutes, 0),
      'emergency_24x7', coalesce(p_emergency_24x7, false)));
  return v_row;
end;
$$;

-- Everything the Administration page shows, computed from real records.
create or replace function public.administration_overview(p_organization_id uuid, p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_result jsonb;
begin
  if not private.has_role(p_organization_id, private.admin_roles()) then
    raise exception 'Only workspace admins can view administration' using errcode = '42501';
  end if;

  with staff as (
    select m.id, m.role, m.department, m.accepts_appointments, m.working_start, m.working_end, m.max_per_hour,
           coalesce(nullif(p.full_name, ''), p.email, 'Staff member') as name, p.email
    from public.memberships m left join public.profiles p on p.id = m.user_id
    where m.organization_id = p_organization_id and m.status = 'active'
  ),
  appts as (
    select a.*, lower(btrim(a.department)) as dkey
    from public.appointments a
    where a.organization_id = p_organization_id and a.starts_at >= v_from and a.starts_at <= now() + interval '1 day'
  ),
  revenue as (
    select lower(btrim(a.department)) as dkey, sum(ip.amount_kobo) as kobo
    from public.invoice_payments ip
    join public.invoices i on i.id = ip.invoice_id
    join public.appointments a on a.id = i.appointment_id
    where ip.organization_id = p_organization_id and ip.received_at >= v_from
    group by 1
  ),
  dept as (
    select d.*,
      (select coalesce(jsonb_agg(jsonb_build_object('membershipId', s.id, 'name', s.name, 'email', s.email, 'role', s.role,
          'acceptsAppointments', s.accepts_appointments) order by s.name), '[]')
        from staff s where lower(btrim(s.department)) = lower(d.name)) as staff_list,
      (select count(*) from staff s where lower(btrim(s.department)) = lower(d.name)) as staff_count,
      (select coalesce(sum(s.max_per_hour * greatest(0, extract(epoch from (s.working_end - s.working_start)) / 3600)), 0)::int
        from staff s where lower(btrim(s.department)) = lower(d.name) and s.accepts_appointments
          and s.max_per_hour is not null and s.working_start is not null and s.working_end is not null) as daily_capacity
    from public.departments d where d.organization_id = p_organization_id
  )
  select jsonb_build_object(
    'facility', (select jsonb_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'address', o.address, 'state', o.state,
        'country', o.country, 'contactEmail', o.contact_email, 'contactPhone', o.contact_phone, 'website', o.website,
        'organizationType', o.organization_type, 'joinedNetwork', o.joined_network, 'createdAt', o.created_at,
        'maxPatientsPerDay', o.max_patients_per_day, 'appointmentBufferMinutes', o.appointment_buffer_minutes,
        'emergency24x7', o.emergency_24x7,
        'bookedToday', (select count(*) from public.appointments a where a.organization_id = o.id
            and (a.starts_at at time zone 'Africa/Lagos')::date = v_today and a.status not in ('cancelled', 'rescheduled')))
      from public.organizations o where o.id = p_organization_id),
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('membershipId', s.id, 'name', s.name, 'email', s.email, 'role', s.role,
        'department', nullif(btrim(s.department), '')) order by s.name), '[]') from staff s),
    'departments', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'name', d.name, 'code', d.code, 'description', d.description, 'location', d.location,
        'headMembershipId', d.head_membership_id, 'workingHours', d.working_hours, 'linkedServices', d.linked_services,
        'rooms', d.rooms, 'equipment', d.equipment, 'beds', d.beds, 'isActive', d.is_active, 'createdAt', d.created_at,
        'staff', d.staff_list, 'staffCount', d.staff_count, 'dailyCapacity', d.daily_capacity,
        'performance', jsonb_build_object(
          'appointments', (select count(*) from appts a where a.dkey = lower(d.name) and a.starts_at <= now()),
          'completed', (select count(*) from appts a where a.dkey = lower(d.name) and a.status = 'completed'),
          'noShow', (select count(*) from appts a where a.dkey = lower(d.name) and a.status = 'no-show'),
          'patients', (select count(distinct a.patient_id) from appts a where a.dkey = lower(d.name) and a.status not in ('cancelled', 'no-show', 'rescheduled') and a.starts_at <= now()),
          'revenueKobo', coalesce((select r.kobo from revenue r where r.dkey = lower(d.name)), 0),
          'avgWaitMin', (select round(avg(extract(epoch from (a.consultation_started_at - a.checked_in_at)) / 60)::numeric, 0)
              from appts a where a.dkey = lower(d.name) and a.checked_in_at is not null and a.consultation_started_at > a.checked_in_at),
          'bookedToday', (select count(*) from appts a where a.dkey = lower(d.name)
              and (a.starts_at at time zone 'Africa/Lagos')::date = v_today and a.status not in ('cancelled', 'rescheduled')),
          'upcoming', (select count(*) from public.appointments a where a.organization_id = p_organization_id
              and lower(btrim(a.department)) = lower(d.name) and a.starts_at > now() and a.status not in ('cancelled', 'no-show', 'rescheduled', 'completed'))
        ),
        'activity', (select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]') from (
            select l.created_at, jsonb_build_object('id', l.id, 'action', l.action, 'summary', l.metadata ->> 'summary', 'at', l.created_at,
              'actor', coalesce(nullif(p.full_name, ''), p.email)) as j
            from public.audit_logs l left join public.profiles p on p.id = l.actor_id
            where l.organization_id = p_organization_id and l.entity = 'departments' and l.entity_id = d.id::text
            order by l.created_at desc limit 8) x)
      ) order by d.is_active desc, d.name), '[]') from dept d),
    'unassignedStaff', (select count(*) from staff s where coalesce(btrim(s.department), '') = ''
        or not exists (select 1 from public.departments d where d.organization_id = p_organization_id and lower(d.name) = lower(btrim(s.department)))),
    'transfers', (select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]') from (
        select l.created_at, jsonb_build_object('id', l.id, 'at', l.created_at, 'staffName', l.metadata ->> 'staff_name',
          'from', l.metadata ->> 'from_department', 'to', l.metadata ->> 'to_department', 'toDepartmentId', l.entity_id,
          'fromDepartmentId', l.metadata ->> 'from_department_id', 'actor', coalesce(nullif(p.full_name, ''), p.email)) as j
        from public.audit_logs l left join public.profiles p on p.id = l.actor_id
        where l.organization_id = p_organization_id and l.action = 'department.staff_transferred'
        order by l.created_at desc limit 20) x),
    'auditLog', (select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]') from (
        select l.created_at, jsonb_build_object('id', l.id, 'action', l.action, 'summary', l.metadata ->> 'summary', 'at', l.created_at,
          'actor', coalesce(nullif(p.full_name, ''), p.email)) as j
        from public.audit_logs l left join public.profiles p on p.id = l.actor_id
        where l.organization_id = p_organization_id and (l.action like 'department.%' or l.action = 'facility.updated')
        order by l.created_at desc limit 25) x)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.department_save(uuid, uuid, text, text, text, text, uuid, jsonb, text[], integer, integer, integer, boolean) from public, anon;
revoke all on function public.department_assign_staff(uuid, uuid[]) from public, anon;
revoke all on function public.department_remove_staff(uuid, uuid) from public, anon;
revoke all on function public.department_delete(uuid) from public, anon;
revoke all on function public.facility_save(uuid, text, text, text, text, text, text, integer, integer, boolean) from public, anon;
revoke all on function public.administration_overview(uuid, integer) from public, anon;
grant execute on function public.department_save(uuid, uuid, text, text, text, text, uuid, jsonb, text[], integer, integer, integer, boolean) to authenticated;
grant execute on function public.department_assign_staff(uuid, uuid[]) to authenticated;
grant execute on function public.department_remove_staff(uuid, uuid) to authenticated;
grant execute on function public.department_delete(uuid) to authenticated;
grant execute on function public.facility_save(uuid, text, text, text, text, text, text, integer, integer, boolean) to authenticated;
grant execute on function public.administration_overview(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Enforce the facility's operating settings when appointments are booked or moved.
-- Emergencies bypass the limits when the facility runs a 24/7 emergency service.
create or replace function private.enforce_facility_limits()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org public.organizations;
  v_day date;
  v_booked integer;
  v_clash timestamptz;
begin
  if new.status in ('cancelled', 'no-show', 'rescheduled', 'completed') then return new; end if;
  -- Only bookings and moves are checked; status changes on existing appointments are not.
  if tg_op = 'UPDATE' and new.starts_at = old.starts_at and new.clinician_id is not distinct from old.clinician_id
     and new.duration_minutes = old.duration_minutes then
    return new;
  end if;
  select * into v_org from public.organizations where id = new.organization_id;
  if v_org.emergency_24x7 and (new.priority = 'emergency' or new.type = 'Emergency') then return new; end if;

  if v_org.max_patients_per_day is not null and (tg_op = 'INSERT' or (new.starts_at at time zone 'Africa/Lagos')::date <> (old.starts_at at time zone 'Africa/Lagos')::date) then
    v_day := (new.starts_at at time zone 'Africa/Lagos')::date;
    select count(*) into v_booked from public.appointments a
      where a.organization_id = new.organization_id and a.id <> new.id
        and (a.starts_at at time zone 'Africa/Lagos')::date = v_day
        and a.status not in ('cancelled', 'rescheduled');
    if v_booked >= v_org.max_patients_per_day then
      raise exception 'This facility is fully booked for % (limit % patients a day)', to_char(v_day, 'DD Mon YYYY'), v_org.max_patients_per_day
        using errcode = '23514';
    end if;
  end if;

  -- The buffer is the minimum gap between one clinician's appointment start
  -- times (the per-hour cap is set per staff member).
  if new.clinician_id is not null and v_org.appointment_buffer_minutes > 0 then
    select a.starts_at into v_clash from public.appointments a
      where a.organization_id = new.organization_id and a.clinician_id = new.clinician_id and a.id <> new.id
        and a.status not in ('cancelled', 'no-show', 'rescheduled', 'completed')
        and a.starts_at > new.starts_at - make_interval(mins => v_org.appointment_buffer_minutes)
        and a.starts_at < new.starts_at + make_interval(mins => v_org.appointment_buffer_minutes)
      limit 1;
    if v_clash is not null then
      raise exception 'The clinician has an appointment at %; this facility keeps % minutes between appointments',
        to_char(v_clash at time zone 'Africa/Lagos', 'HH24:MI'), v_org.appointment_buffer_minutes
        using errcode = '23P01';
    end if;
  end if;
  return new;
end;
$$;

create trigger appointments_facility_limits before insert or update on public.appointments
  for each row execute function private.enforce_facility_limits();
