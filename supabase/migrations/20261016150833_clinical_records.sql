-- Clinical records: SOAP notes (draft -> signed, immutable once signed),
-- vital signs and lab results. Readable by clinical staff only; every change
-- lands in audit_logs (without copying clinical content).

create or replace function private.clinical_read_roles()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['super-admin','hospital-admin','doctor','nurse','lab-scientist','lab-technician','pharmacist']::text[] $$;

create or replace function private.note_write_roles()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['super-admin','hospital-admin','doctor']::text[] $$;

create or replace function private.vitals_write_roles()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['super-admin','hospital-admin','doctor','nurse']::text[] $$;

create or replace function private.lab_write_roles()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['super-admin','hospital-admin','doctor','lab-scientist','lab-technician']::text[] $$;

grant execute on function private.clinical_read_roles(), private.note_write_roles(),
  private.vitals_write_roles(), private.lab_write_roles() to authenticated;

-- ============================================
-- CLINICAL NOTES
-- ============================================

create table public.clinical_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null,
  appointment_id uuid references public.appointments (id) on delete set null,
  author_id uuid references public.profiles (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'signed')),
  -- Full SOAP form; a few fields are lifted out for listing and search.
  content jsonb not null default '{}'::jsonb,
  chief_complaint text not null default '',
  primary_diagnosis text not null default '',
  risk_level text not null default 'moderate' check (risk_level in ('low','moderate','high','critical')),
  version integer not null default 1,
  signed_at timestamptz,
  signed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (patient_id, organization_id) references public.patients (id, organization_id) on delete cascade,
  unique (id, organization_id)
);
create index clinical_notes_patient_idx on public.clinical_notes (organization_id, patient_id, created_at desc);
create index clinical_notes_patient_fk_idx on public.clinical_notes (patient_id, organization_id);
create index clinical_notes_appointment_idx on public.clinical_notes (appointment_id);
create index clinical_notes_author_idx on public.clinical_notes (author_id);
create index clinical_notes_signed_by_idx on public.clinical_notes (signed_by);

create or replace function private.clinical_note_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.author_id := auth.uid();
  new.version := 1;
  if new.status = 'signed' then
    new.signed_at := now();
    new.signed_by := auth.uid();
  else
    new.signed_at := null;
    new.signed_by := null;
  end if;
  return new;
end;
$$;
create trigger clinical_notes_before_insert before insert on public.clinical_notes
  for each row execute function private.clinical_note_insert();

create or replace function private.clinical_note_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'signed' then
    raise exception 'Signed clinical notes cannot be changed' using errcode = '42501';
  end if;
  if old.author_id is distinct from auth.uid() then
    raise exception 'Only the author can edit a draft note' using errcode = '42501';
  end if;
  new.organization_id := old.organization_id;
  new.patient_id := old.patient_id;
  new.author_id := old.author_id;
  new.created_at := old.created_at;
  new.version := old.version + 1;
  new.updated_at := now();
  if new.status = 'signed' then
    new.signed_at := now();
    new.signed_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger clinical_notes_before_update before update on public.clinical_notes
  for each row execute function private.clinical_note_update();

-- ============================================
-- VITAL SIGNS
-- ============================================

create table public.vitals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null,
  appointment_id uuid references public.appointments (id) on delete set null,
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  temperature_c numeric(4,1) check (temperature_c between 25 and 45),
  heart_rate integer check (heart_rate between 20 and 250),
  systolic integer check (systolic between 50 and 260),
  diastolic integer check (diastolic between 30 and 180),
  respiratory_rate integer check (respiratory_rate between 4 and 80),
  spo2 integer check (spo2 between 50 and 100),
  weight_kg numeric(5,1) check (weight_kg between 0.3 and 400),
  height_cm numeric(5,1) check (height_cm between 20 and 260),
  pain_score integer check (pain_score between 0 and 10),
  notes text,
  foreign key (patient_id, organization_id) references public.patients (id, organization_id) on delete cascade,
  check (num_nonnulls(temperature_c, heart_rate, systolic, diastolic, respiratory_rate, spo2, weight_kg, height_cm, pain_score) > 0)
);
create index vitals_patient_idx on public.vitals (organization_id, patient_id, recorded_at desc);
create index vitals_patient_fk_idx on public.vitals (patient_id, organization_id);
create index vitals_appointment_idx on public.vitals (appointment_id);
create index vitals_recorded_by_idx on public.vitals (recorded_by);

create or replace function private.vitals_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.recorded_by := auth.uid();
  new.recorded_at := coalesce(new.recorded_at, now());
  return new;
end;
$$;
create trigger vitals_before_insert before insert on public.vitals
  for each row execute function private.vitals_insert();

-- ============================================
-- LAB RESULTS (orders start Pending, technicians complete them)
-- ============================================

create table public.lab_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null,
  note_id uuid references public.clinical_notes (id) on delete set null,
  ordered_by uuid references public.profiles (id) on delete set null,
  technician_id uuid references public.profiles (id) on delete set null,
  test_name text not null check (char_length(btrim(test_name)) > 0),
  test_type text not null default 'General',
  department text not null default 'Laboratory',
  status text not null default 'Pending' check (status in ('Pending', 'Completed')),
  reference_range text not null default '',
  value text not null default '',
  flag text not null default 'Normal' check (flag in ('Normal', 'High', 'Low', 'Critical')),
  interpretation text,
  ordered_at timestamptz not null default now(),
  resulted_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (patient_id, organization_id) references public.patients (id, organization_id) on delete cascade
);
create index lab_results_patient_idx on public.lab_results (organization_id, patient_id, ordered_at desc);
create index lab_results_patient_fk_idx on public.lab_results (patient_id, organization_id);
create index lab_results_pending_idx on public.lab_results (organization_id, status) where status = 'Pending';
create index lab_results_note_idx on public.lab_results (note_id);
create index lab_results_ordered_by_idx on public.lab_results (ordered_by);
create index lab_results_technician_idx on public.lab_results (technician_id);

create or replace function private.lab_result_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.ordered_by := auth.uid();
    new.ordered_at := now();
  else
    new.organization_id := old.organization_id;
    new.patient_id := old.patient_id;
    new.ordered_by := old.ordered_by;
    new.ordered_at := old.ordered_at;
    if old.status = 'Completed' and new.value is distinct from old.value then
      raise exception 'Completed lab values cannot be changed; record a new result instead' using errcode = '42501';
    end if;
  end if;
  if new.status = 'Completed' and (tg_op = 'INSERT' or old.status <> 'Completed') then
    new.resulted_at := now();
    new.technician_id := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger lab_results_stamp before insert or update on public.lab_results
  for each row execute function private.lab_result_stamp();

-- ============================================
-- AUDIT + RLS
-- ============================================

create trigger clinical_notes_audit after insert or update or delete on public.clinical_notes
  for each row execute function private.write_audit();
create trigger vitals_audit after insert or update or delete on public.vitals
  for each row execute function private.write_audit();
create trigger lab_results_audit after insert or update or delete on public.lab_results
  for each row execute function private.write_audit();

alter table public.clinical_notes enable row level security;
alter table public.vitals enable row level security;
alter table public.lab_results enable row level security;

create policy "clinical staff read notes" on public.clinical_notes
  for select to authenticated using (private.has_role(organization_id, private.clinical_read_roles()));
create policy "clinicians write notes" on public.clinical_notes
  for insert to authenticated with check (private.has_role(organization_id, private.note_write_roles()));
create policy "clinicians edit own drafts" on public.clinical_notes
  for update to authenticated
  using (private.has_role(organization_id, private.note_write_roles()) and author_id = (select auth.uid()) and status = 'draft')
  with check (private.has_role(organization_id, private.note_write_roles()));
create policy "authors delete own drafts" on public.clinical_notes
  for delete to authenticated
  using (author_id = (select auth.uid()) and status = 'draft' and private.has_role(organization_id, private.note_write_roles()));

create policy "clinical staff read vitals" on public.vitals
  for select to authenticated using (private.has_role(organization_id, private.clinical_read_roles()));
create policy "clinical staff record vitals" on public.vitals
  for insert to authenticated with check (private.has_role(organization_id, private.vitals_write_roles()));

create policy "clinical staff read labs" on public.lab_results
  for select to authenticated using (private.has_role(organization_id, private.clinical_read_roles()));
create policy "lab staff add labs" on public.lab_results
  for insert to authenticated with check (private.has_role(organization_id, private.lab_write_roles()));
create policy "lab staff update labs" on public.lab_results
  for update to authenticated
  using (private.has_role(organization_id, private.lab_write_roles()))
  with check (private.has_role(organization_id, private.lab_write_roles()));

revoke all on public.clinical_notes, public.vitals, public.lab_results from anon;
