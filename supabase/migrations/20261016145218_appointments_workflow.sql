-- Appointments workflow: clinician schedules on memberships, queue/check-in
-- tracking on appointments, server-side queue numbers, double-booking guard,
-- status history and realtime updates.

-- ============================================
-- CLINICIAN SCHEDULES (on the org membership)
-- ============================================

alter table public.memberships
  add column department text,
  add column accepts_appointments boolean not null default false,
  add column working_start time not null default '08:00',
  add column working_end time not null default '17:00',
  add column break_times text[] not null default '{12:00}',
  add column max_per_hour integer not null default 2 check (max_per_hour between 1 and 20);

-- Doctors take appointments by default; so does the hospital admin, since in a
-- small clinic the owner is usually the doctor. Admins can switch it off.
create or replace function private.default_accepts_appointments()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.role in ('doctor', 'hospital-admin') then
    new.accepts_appointments := true;
  end if;
  return new;
end;
$$;
create trigger memberships_default_accepts_appointments before insert on public.memberships
  for each row execute function private.default_accepts_appointments();

update public.memberships set accepts_appointments = true where role in ('doctor', 'hospital-admin');

-- Lets PostgREST embed the member's profile (name) in roster queries.
alter table public.memberships
  add constraint memberships_user_profile_fk foreign key (user_id) references public.profiles (id) on delete cascade;

-- ============================================
-- APPOINTMENTS: queue + check-in tracking
-- ============================================

alter table public.appointments
  add column queue_number text,
  add column check_in_status text not null default 'not-arrived'
    check (check_in_status in ('not-arrived','arrived','triage','ready','in-room')),
  add column insurance_type text not null default 'self-pay'
    check (insurance_type in ('private','public','corporate','self-pay')),
  add column lab_linked boolean not null default false,
  add column prescription_ready boolean not null default false,
  add column outstanding_balance numeric(12,2) not null default 0,
  add column telemedicine_url text,
  add column checked_in_at timestamptz,
  add column consultation_started_at timestamptz,
  add column completed_at timestamptz,
  -- Reason for the latest status change; consumed into history by a trigger.
  add column status_note text,
  add column history text[] not null default '{}',
  add column updated_by uuid references auth.users (id) on delete set null;

alter table public.appointments
  add constraint appointments_clinician_profile_fk foreign key (clinician_id) references public.profiles (id) on delete set null;

create index appointments_updated_by_idx on public.appointments (updated_by);

-- One live booking per clinician per start time.
create unique index appointments_no_double_booking
  on public.appointments (clinician_id, starts_at)
  where clinician_id is not null and status not in ('cancelled', 'no-show', 'rescheduled');

-- Queue number per org/day/department, e.g. GE-004.
create or replace function private.assign_queue_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  seq integer;
  prefix text := upper(left(coalesce(nullif(btrim(new.department), ''), 'GN'), 2));
begin
  perform pg_advisory_xact_lock(hashtext(new.organization_id::text || new.department || (new.starts_at at time zone 'Africa/Lagos')::date::text));
  select count(*) + 1 into seq
  from public.appointments
  where organization_id = new.organization_id
    and department = new.department
    and (starts_at at time zone 'Africa/Lagos')::date = (new.starts_at at time zone 'Africa/Lagos')::date;
  new.queue_number := prefix || '-' || lpad(seq::text, 3, '0');
  new.history := array[coalesce(nullif(new.status_note, ''), 'Appointment booked')];
  new.status_note := null;
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger appointments_assign_queue_number before insert on public.appointments
  for each row execute function private.assign_queue_number();

-- Status transitions stamp timing fields and append to history.
create or replace function private.track_appointment_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  new.organization_id := old.organization_id;
  new.queue_number := old.queue_number;
  if new.status is distinct from old.status then
    if new.status = 'checked-in' and old.checked_in_at is null then
      new.checked_in_at := now();
      if new.check_in_status = 'not-arrived' then new.check_in_status := 'arrived'; end if;
    elsif new.status = 'in-consultation' then
      new.consultation_started_at := coalesce(old.consultation_started_at, now());
      new.check_in_status := 'in-room';
    elsif new.status = 'completed' then
      new.completed_at := coalesce(old.completed_at, now());
    end if;
    new.history := array_prepend(
      coalesce(nullif(new.status_note, ''), 'Status changed to ' || new.status),
      old.history
    );
  end if;
  new.status_note := null;
  return new;
end;
$$;
create trigger appointments_track_status before update on public.appointments
  for each row execute function private.track_appointment_status();

-- Push appointment changes to open dashboards (RLS still applies).
alter publication supabase_realtime add table public.appointments;
