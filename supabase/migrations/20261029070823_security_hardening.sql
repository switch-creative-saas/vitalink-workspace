-- Security hardening from the October 2026 sweep (defence in depth; RLS already blocked these paths).

-- 1. Signed-out visitors never write tables directly; their few flows (invite lookup, slug check,
--    the patient's video-visit link) go through dedicated functions.
revoke insert, update, delete, truncate on all tables in schema public from anon;
alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon;

-- Functions that require a signed-in member anyway: not callable signed out.
revoke execute on function public.open_workspace_sentinel(uuid) from anon, public;
revoke execute on function public.support_create_ticket(uuid, text, text, text, text, text, jsonb, text) from anon, public;
revoke execute on function public.support_escalate(uuid, text) from anon, public;
revoke execute on function public.support_mark_read(uuid, boolean) from anon, public;
revoke execute on function public.support_reply(uuid, text, boolean, jsonb, boolean, boolean) from anon, public;
revoke execute on function public.support_update_ticket(uuid, text, text, text, boolean, boolean) from anon, public;
revoke execute on function public.vitamind_access(uuid) from anon, public;
revoke execute on function public.workspace_entitlements(uuid) from anon, public;
grant execute on function public.open_workspace_sentinel(uuid) to authenticated;
grant execute on function public.support_create_ticket(uuid, text, text, text, text, text, jsonb, text) to authenticated;
grant execute on function public.support_escalate(uuid, text) to authenticated;
grant execute on function public.support_mark_read(uuid, boolean) to authenticated;
grant execute on function public.support_reply(uuid, text, boolean, jsonb, boolean, boolean) to authenticated;
grant execute on function public.support_update_ticket(uuid, text, text, text, boolean, boolean) to authenticated;
grant execute on function public.vitamind_access(uuid) to authenticated;
grant execute on function public.workspace_entitlements(uuid) to authenticated;

-- 2. Workspace admins edit their facility's details, not the fields VitaLink trusts
--    (workspace kind, plan tier, owner). Those change only through VitaLink's own functions.
-- Runs as the caller (not security definer) so current_user tells a direct client update apart from
-- VitaLink's own functions, which run as their owner.
create or replace function private.organizations_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') or coalesce(auth.role(), '') = 'service_role' or private.is_platform_admin() then
    return new;
  end if;
  new.organization_type := old.organization_type;
  new.subscription_tier := old.subscription_tier;
  new.requested_plan := old.requested_plan;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;
drop trigger if exists organizations_guard on public.organizations;
create trigger organizations_guard before update on public.organizations
  for each row execute function private.organizations_guard();

-- 3. People join a workspace by accepting an invitation sent to their own email; admins can't
--    attach an arbitrary account directly.
drop policy if exists "admins add members" on public.memberships;
