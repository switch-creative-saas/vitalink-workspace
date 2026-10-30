-- Two-step verification at the point of need, not at sign-in.
--
-- * Signing in needs only the password: workspace pages (dashboard, registry, appointments,
--   billing, stock…) load straight away.
-- * Patient records need the code once per sign-in (or a remembered browser): clinical notes,
--   vitals, lab orders and results, prescriptions, patient documents (not photos), scribe and
--   VitaMind analyses, and imported EMR records. The database enforces this, so a stolen
--   password alone still can't read medical records. The app also asks again after 30 minutes
--   without use.
-- * VitaLink platform admins (the console) still need the code before anything.
-- People who haven't set up two-step verification are not asked (it stays optional).

-- The strict check: verified this session, or a remembered browser, or two-step not in use.
create or replace function private.records_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
      or (select auth.uid()) is null
      or not private.mfa_needed((select auth.uid()))
      or private.session_trusted()
$$;

-- Kept strict (used by is_platform_admin: the console).
create or replace function private.mfa_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.records_ok()
$$;

-- Workspace membership and roles no longer wait for the code.
create or replace function private.has_role(org uuid, roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org and m.user_id = (select auth.uid())
      and m.status = 'active' and m.role = any (roles)
  )
$$;

create or replace function private.is_member(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org and m.user_id = (select auth.uid()) and m.status = 'active'
  )
$$;

-- A role that reads or writes patient records: needs the code.
create or replace function private.has_record_role(org uuid, roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_role(org, roles) and private.records_ok()
$$;

-- Every clinical table: an extra rule on top of the existing ones (restrictive = AND).
do $$
declare t text;
begin
  foreach t in array array['clinical_notes', 'vitals', 'lab_orders', 'lab_results', 'prescriptions', 'patient_documents',
                           'consultation_scribes', 'dx_sessions', 'dx_imaging_reports', 'emr_records', 'vitamind_results', 'vitamind_sessions']
  loop
    execute format('drop policy if exists "two-step for patient records" on public.%I', t);
    execute format('create policy "two-step for patient records" on public.%I as restrictive for all to authenticated using (private.records_ok()) with check (private.records_ok())', t);
  end loop;
end $$;

-- Patient documents in storage (patient photos stay visible, e.g. in the registry).
drop policy if exists "two-step for patient documents" on storage.objects;
create policy "two-step for patient documents" on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'patient-documents' or position('/patient-photos/' in name) > 0 or private.records_ok())
  with check (bucket_id <> 'patient-documents' or position('/patient-photos/' in name) > 0 or private.records_ok());

-- Functions that read or change a patient's record check the code too.
do $$
declare f record;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('dx_analyze', 'dx_confirm', 'dx_patient_insights', 'dx_save_imaging_report', 'network_share_records')
  loop
    execute replace(pg_get_functiondef(f.oid), 'private.has_role(', 'private.has_record_role(');
  end loop;
end $$;

-- What the app needs to know (readable without the code).
create or replace function public.mfa_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'required', exists (select 1 from auth.users u join private.platform_admins pa on pa.email = lower(u.email)
                        where u.id = (select auth.uid()) and u.email_confirmed_at is not null),
    'recommended', exists (select 1 from public.memberships m where m.user_id = (select auth.uid()) and m.status = 'active'
                                                             and m.role = any (private.mfa_required_roles())),
    'enrolled', exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified'),
    'recordsUnlocked', private.records_ok(),
    'aal', coalesce((select auth.jwt() ->> 'aal'), 'aal1'))
$$;
