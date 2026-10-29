-- Plan check the edge functions can call as the signed-in user (members only).
create or replace function public.workspace_has_module(p_organization_id uuid, p_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_member(p_organization_id) and private.org_has_module(p_organization_id, p_module)
$$;
revoke all on function public.workspace_has_module(uuid, text) from public, anon;
grant execute on function public.workspace_has_module(uuid, text) to authenticated;
