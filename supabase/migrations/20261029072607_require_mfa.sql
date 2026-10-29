-- Two-step verification (TOTP), enforced in the database.
--
-- Who needs it: workspace admins, clinical staff (anyone who can read patient records), VitaLink
-- platform admins, and anyone who has turned it on. For them, every role check (has_role,
-- is_member, is_platform_admin, which back all RLS policies and RPCs) passes only when the session
-- is verified (JWT aal = 'aal2'). A stolen password alone can't read patient data.

create or replace function private.mfa_required_roles()
returns text[] language sql immutable set search_path = '' as $$
  select array['super-admin', 'hospital-admin', 'ngo-admin', 'government-admin',
               'doctor', 'nurse', 'lab-scientist', 'lab-technician', 'pharmacist']::text[]
$$;

-- Deliberately does not call has_role / is_member / is_platform_admin (they call this).
create or replace function private.mfa_needed(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = p_user and f.status = 'verified')
      or exists (select 1 from public.memberships m where m.user_id = p_user and m.status = 'active' and m.role = any (private.mfa_required_roles()))
      or exists (select 1 from auth.users u join private.platform_admins pa on pa.email = lower(u.email)
                 where u.id = p_user and u.email_confirmed_at is not null)
$$;

create or replace function private.mfa_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
      or (select auth.uid()) is null
      or not private.mfa_needed((select auth.uid()))
$$;

create or replace function private.has_role(org uuid, roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org and m.user_id = (select auth.uid())
      and m.status = 'active' and m.role = any (roles)
  ) and (select private.mfa_ok())
$$;

create or replace function private.is_member(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.organization_id = org and m.user_id = (select auth.uid()) and m.status = 'active'
  ) and (select private.mfa_ok())
$$;

create or replace function private.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.users u
    join private.platform_admins pa on pa.email = lower(u.email)
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null
  ) and (select private.mfa_ok())
$$;

/** What the app needs to know before loading data. Readable before two-step verification. */
create or replace function public.mfa_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'required', exists (select 1 from public.memberships m where m.user_id = (select auth.uid()) and m.status = 'active'
                                                          and m.role = any (private.mfa_required_roles()))
             or exists (select 1 from auth.users u join private.platform_admins pa on pa.email = lower(u.email)
                        where u.id = (select auth.uid()) and u.email_confirmed_at is not null),
    'enrolled', exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified'),
    'aal', coalesce((select auth.jwt() ->> 'aal'), 'aal1'))
$$;

-- Lost phone: a workspace admin (verified) clears a staff member's authenticator. Audited.
create or replace function public.mfa_reset_member(p_membership_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.memberships;
begin
  select * into m from public.memberships where id = p_membership_id;
  if m.id is null or not private.has_role(m.organization_id, private.admin_roles()) then
    raise exception 'Only workspace admins can reset two-step verification' using errcode = '42501';
  end if;
  if m.user_id = auth.uid() then
    raise exception 'Manage your own two-step verification in Settings' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users u join private.platform_admins pa on pa.email = lower(u.email) where u.id = m.user_id) then
    raise exception 'This account belongs to VitaLink staff; ask VitaLink to reset it' using errcode = '42501';
  end if;
  delete from auth.mfa_factors where user_id = m.user_id;
  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
  values (m.organization_id, auth.uid(), 'mfa_reset', 'memberships', m.id::text,
          jsonb_build_object('summary', 'Reset two-step verification for '
            || coalesce((select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = m.user_id), 'a staff member')));
end;
$$;

-- VitaLink platform admins (verified) reset any account by email. Logged in the console audit log.
create or replace function public.console_reset_mfa(p_email text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_user uuid; n integer;
begin
  perform private.require_platform_admin();
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then raise exception 'No account with that email' using errcode = 'P0002'; end if;
  if v_user = auth.uid() then raise exception 'Ask another platform admin to reset your own two-step verification' using errcode = '22023'; end if;
  delete from auth.mfa_factors where user_id = v_user;
  get diagnostics n = row_count;
  perform private.console_log('mfa.reset', null, jsonb_build_object('email', lower(btrim(p_email)), 'factors_removed', n));
  return n;
end;
$$;

revoke all on function public.mfa_status() from public, anon;
revoke all on function public.mfa_reset_member(uuid) from public, anon;
revoke all on function public.console_reset_mfa(text) from public, anon;
grant execute on function public.mfa_status() to authenticated;
grant execute on function public.mfa_reset_member(uuid) to authenticated;
grant execute on function public.console_reset_mfa(text) to authenticated;
