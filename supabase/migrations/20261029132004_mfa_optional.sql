-- Two-step verification is optional for workspace staff: nobody is blocked at registration. Once a
-- person sets it up it is always required for them, and VitaLink platform admins must still use it
-- (the console reaches every workspace). The app shows a standing reminder until it is set up;
-- mfa_status.recommended marks the roles it matters most for (admins and clinical staff).
create or replace function private.mfa_needed(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = p_user and f.status = 'verified')
      or exists (select 1 from auth.users u join private.platform_admins pa on pa.email = lower(u.email)
                 where u.id = p_user and u.email_confirmed_at is not null)
$$;

create or replace function public.mfa_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'required', exists (select 1 from auth.users u join private.platform_admins pa on pa.email = lower(u.email)
                        where u.id = (select auth.uid()) and u.email_confirmed_at is not null),
    'recommended', exists (select 1 from public.memberships m where m.user_id = (select auth.uid()) and m.status = 'active'
                                                             and m.role = any (private.mfa_required_roles())),
    'enrolled', exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified'),
    'aal', coalesce((select auth.jwt() ->> 'aal'), 'aal1'))
$$;
