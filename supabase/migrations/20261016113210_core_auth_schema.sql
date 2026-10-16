-- VitaLink core schema: organizations (tenants), profiles, memberships (RBAC),
-- patients, appointments and an append-only audit log. Every table has RLS on.
-- Tenancy rule: a user sees a row only if they hold an active membership in
-- the row's organization. Helper functions live in the unexposed `private` schema.

create schema if not exists private;
grant usage on schema private to authenticated;

-- ============================================
-- Shared value lists (mirror src/contexts/AuthContext.tsx & organizationTypes.ts)
-- ============================================

create or replace function private.valid_roles()
returns text[]
language sql immutable
set search_path = ''
as $$
  select array[
    'super-admin','hospital-admin','doctor','nurse','receptionist','lab-scientist',
    'lab-technician','pharmacist','billing-officer','insurance-officer','it-officer',
    'support-agent','public-health-officer','epidemiologist','government-authority',
    'community-health-worker','who-ngo-observer','ngo-admin','program-manager',
    'data-monitoring-officer','field-officer','public-health-viewer','government-admin',
    'public-health-director','surveillance-officer','data-analyst','government-viewer'
  ]::text[]
$$;

create or replace function private.admin_roles()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['super-admin','hospital-admin','ngo-admin','government-admin']::text[] $$;

create or replace function private.clinical_write_roles()
returns text[]
language sql immutable
set search_path = ''
as $$ select array['super-admin','hospital-admin','doctor','nurse','receptionist']::text[] $$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================
-- ORGANIZATIONS
-- ============================================

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  organization_type text not null check (organization_type in (
    'hospital','clinic','ngo','hmo','insurance','laboratory','pharmacy',
    'government','corporate-healthcare','university'
  )),
  workspace_type text generated always as (
    case when organization_type in ('ngo','government','hmo','insurance')
      then 'public-health' else 'healthcare' end
  ) stored,
  sector text,
  state text,
  country text not null default 'Nigeria',
  address text,
  contact_email text,
  contact_phone text,
  website text,
  joined_network boolean not null default false,
  -- Only changed server-side (billing); create_workspace always starts at 'free'.
  subscription_tier text not null default 'free' check (subscription_tier in ('free','standard','premium')),
  requested_plan text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index organizations_created_by_idx on public.organizations (created_by);
create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();

-- ============================================
-- PROFILES (1:1 with auth.users)
-- ============================================

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  email text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ============================================
-- MEMBERSHIPS (user <-> organization, with role)
-- ============================================

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role = any (private.valid_roles())),
  status text not null default 'active' check (status in ('active','invited','suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index memberships_user_id_idx on public.memberships (user_id);
create trigger memberships_set_updated_at before update on public.memberships
  for each row execute function private.set_updated_at();

-- Security-definer helpers so policies don't recurse through memberships RLS.
create or replace function private.is_member(org uuid)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org and m.user_id = (select auth.uid()) and m.status = 'active'
  )
$$;

create or replace function private.has_role(org uuid, roles text[])
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org and m.user_id = (select auth.uid())
      and m.status = 'active' and m.role = any (roles)
  )
$$;

create or replace function private.shares_org(other_user uuid)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = (select auth.uid()) and mine.status = 'active'
      and theirs.user_id = other_user
  )
$$;

grant execute on function private.is_member(uuid), private.has_role(uuid, text[]),
  private.shares_org(uuid), private.admin_roles(), private.clinical_write_roles(),
  private.valid_roles() to authenticated;

-- ============================================
-- PATIENTS
-- ============================================

create sequence private.patient_serial;
grant usage on sequence private.patient_serial to authenticated;

-- Matches formatBrandId('patient', n): VL-<year>-<6 digits>
create or replace function private.next_switch_id()
returns text
language sql volatile
security definer
set search_path = ''
as $$
  select 'VL-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('private.patient_serial')::text, 6, '0')
$$;
grant execute on function private.next_switch_id() to authenticated;

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  switch_id text not null unique default private.next_switch_id(),
  first_name text not null,
  middle_name text,
  last_name text not null,
  date_of_birth date not null,
  gender text not null check (gender in ('male','female','other')),
  phone text not null,
  email text,
  address text not null default '',
  state text not null default '',
  country text not null default 'Nigeria',
  marital_status text,
  occupation text,
  national_id text,
  profile_photo_url text,
  blood_group text,
  genotype text,
  allergies text,
  chronic_conditions text,
  current_medications text,
  family_medical_history text,
  past_surgeries text,
  disability_status text,
  pregnancy_status text,
  emergency_contact_name text not null default '',
  emergency_relationship text not null default '',
  emergency_phone text not null default '',
  emergency_address text,
  insurance_provider text,
  insurance_policy_number text,
  insurance_expiry_date date,
  insurance_type text,
  nfc_card_id text unique,
  nfc_active boolean not null default false,
  status text not null default 'active' check (status in ('active','inpatient','outpatient','discharged','referred')),
  tags text[] not null default '{}' check (tags <@ array['vip','high-risk','chronic-care','pediatric','geriatric']::text[]),
  department text,
  doctor_assigned text,
  admission_status text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  updated_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);
create index patients_organization_id_idx on public.patients (organization_id);
create index patients_org_name_idx on public.patients (organization_id, last_name, first_name);
create index patients_created_by_idx on public.patients (created_by);
create index patients_updated_by_idx on public.patients (updated_by);

create or replace function private.patients_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.switch_id := old.switch_id;           -- VitaLink ID is immutable
  new.organization_id := old.organization_id;
  return new;
end;
$$;
create trigger patients_stamp before update on public.patients
  for each row execute function private.patients_stamp();

-- Authorship columns always reflect the real caller.
create or replace function private.stamp_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_by := auth.uid();
  if tg_table_name = 'patients' then
    new.updated_by := auth.uid();
    new.switch_id := private.next_switch_id();
  end if;
  return new;
end;
$$;
create trigger patients_stamp_creator before insert on public.patients
  for each row execute function private.stamp_creator();

-- ============================================
-- APPOINTMENTS
-- ============================================

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null,
  clinician_id uuid references auth.users (id) on delete set null,
  department text not null default '',
  starts_at timestamptz not null,
  duration_minutes integer not null default 30 check (duration_minutes between 5 and 720),
  type text not null default 'Consultation' check (type in (
    'Consultation','Follow-up','Surgery','Telemedicine','Vaccination','Lab Review','ANC',
    'Emergency','Specialist Referral','Home Care','Mental Health','Chronic Care','Pediatrics'
  )),
  priority text not null default 'routine' check (priority in ('routine','urgent','stat','emergency')),
  status text not null default 'pending' check (status in (
    'confirmed','checked-in','pending','in-consultation','completed','cancelled',
    'no-show','rescheduled','emergency','waiting-lab','admitted'
  )),
  visit_reason text not null default '',
  notes text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Patient must belong to the same organization as the appointment.
  foreign key (patient_id, organization_id) references public.patients (id, organization_id) on delete cascade
);
create index appointments_org_starts_idx on public.appointments (organization_id, starts_at);
create index appointments_patient_idx on public.appointments (patient_id, organization_id);
create index appointments_clinician_idx on public.appointments (clinician_id);
create index appointments_created_by_idx on public.appointments (created_by);
create trigger appointments_set_updated_at before update on public.appointments
  for each row execute function private.set_updated_at();
create trigger appointments_stamp_creator before insert on public.appointments
  for each row execute function private.stamp_creator();

-- ============================================
-- AUDIT LOG (written only by triggers)
-- ============================================

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid,  -- deliberately no FK: the trail outlives deleted orgs
  actor_id uuid references auth.users (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id);

create or replace function private.write_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
  values (
    (rec ->> 'organization_id')::uuid,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    rec ->> 'id',
    case when tg_table_name = 'memberships'
      then jsonb_build_object('role', rec ->> 'role', 'status', rec ->> 'status', 'user_id', rec ->> 'user_id')
      else '{}'::jsonb end   -- no PHI copied into the audit trail
  );
  return null;
end;
$$;

create trigger patients_audit after insert or update or delete on public.patients
  for each row execute function private.write_audit();
create trigger appointments_audit after insert or update or delete on public.appointments
  for each row execute function private.write_audit();
create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function private.write_audit();

-- ============================================
-- RLS
-- ============================================

alter table public.organizations enable row level security;
alter table public.profiles      enable row level security;
alter table public.memberships   enable row level security;
alter table public.patients      enable row level security;
alter table public.appointments  enable row level security;
alter table public.audit_logs    enable row level security;

-- organizations: members read; admins update; creation via create_workspace() only.
create policy "members read their organizations" on public.organizations
  for select to authenticated using (private.is_member(id));
create policy "admins update their organization" on public.organizations
  for update to authenticated
  using (private.has_role(id, private.admin_roles()))
  with check (private.has_role(id, private.admin_roles()));
revoke update on public.organizations from authenticated;
grant update (name, sector, state, country, address, contact_email, contact_phone, website, joined_network)
  on public.organizations to authenticated;

-- profiles: self + colleagues read; self update.
create policy "read own or colleague profiles" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or private.shares_org(id));
create policy "update own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

-- memberships: see your own rows and your org's roster; admins manage the roster.
create policy "read own memberships or org roster" on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_member(organization_id));
create policy "admins add members" on public.memberships
  for insert to authenticated with check (private.has_role(organization_id, private.admin_roles()));
create policy "admins update members" on public.memberships
  for update to authenticated
  using (private.has_role(organization_id, private.admin_roles()) and user_id <> (select auth.uid()))
  with check (private.has_role(organization_id, private.admin_roles()));
create policy "admins remove members" on public.memberships
  for delete to authenticated
  using (private.has_role(organization_id, private.admin_roles()) and user_id <> (select auth.uid()));

-- patients
create policy "members read patients" on public.patients
  for select to authenticated using (private.is_member(organization_id));
create policy "clinical staff register patients" on public.patients
  for insert to authenticated with check (private.has_role(organization_id, private.clinical_write_roles()));
create policy "clinical staff update patients" on public.patients
  for update to authenticated
  using (private.has_role(organization_id, private.clinical_write_roles()))
  with check (private.has_role(organization_id, private.clinical_write_roles()));
create policy "admins delete patients" on public.patients
  for delete to authenticated using (private.has_role(organization_id, private.admin_roles()));

-- appointments
create policy "members read appointments" on public.appointments
  for select to authenticated using (private.is_member(organization_id));
create policy "clinical staff book appointments" on public.appointments
  for insert to authenticated with check (private.has_role(organization_id, private.clinical_write_roles()));
create policy "clinical staff update appointments" on public.appointments
  for update to authenticated
  using (private.has_role(organization_id, private.clinical_write_roles()))
  with check (private.has_role(organization_id, private.clinical_write_roles()));
create policy "admins delete appointments" on public.appointments
  for delete to authenticated using (private.has_role(organization_id, private.admin_roles()));

-- audit_logs: admins read; nobody writes directly.
create policy "admins read audit log" on public.audit_logs
  for select to authenticated using (private.has_role(organization_id, private.admin_roles()));

-- Nothing is readable by anonymous visitors.
revoke all on public.organizations, public.profiles, public.memberships,
  public.patients, public.appointments, public.audit_logs from anon;

-- ============================================
-- RPCs
-- ============================================

-- Signup step: create an organization and make the caller its admin, atomically.
create or replace function public.create_workspace(
  p_name text,
  p_slug text,
  p_organization_type text,
  p_state text default null,
  p_contact_phone text default null,
  p_joined_network boolean default false,
  p_requested_plan text default null
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  org public.organizations;
  admin_role text;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  insert into public.organizations (
    name, slug, organization_type, sector, state, contact_email, contact_phone,
    joined_network, requested_plan, created_by
  )
  values (
    btrim(p_name), lower(btrim(p_slug)), p_organization_type,
    case p_organization_type when 'ngo' then 'NGO' when 'government' then 'Public' else 'Private' end,
    p_state, (select email from auth.users where id = uid), p_contact_phone,
    coalesce(p_joined_network, false), p_requested_plan, uid
  )
  returning * into org;

  -- Mirrors defaultRoleForOrganizationType() in src/lib/workspace/roles.ts
  admin_role := case p_organization_type
    when 'ngo' then 'ngo-admin'
    when 'government' then 'government-admin'
    when 'hmo' then 'public-health-officer'
    when 'insurance' then 'public-health-officer'
    else 'hospital-admin'
  end;

  insert into public.memberships (organization_id, user_id, role) values (org.id, uid, admin_role);
  return org;
end;
$$;
revoke execute on function public.create_workspace(text, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.create_workspace(text, text, text, text, text, boolean, text) to authenticated;

-- Used by the workspace URL picker before the user has an account.
create or replace function public.is_slug_available(p_slug text)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.organizations where slug = lower(btrim(p_slug)))
$$;
grant execute on function public.is_slug_available(text) to anon, authenticated;
