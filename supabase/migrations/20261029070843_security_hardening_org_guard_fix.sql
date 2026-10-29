-- workspace_type is generated from organization_type, so guarding organization_type covers both.
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
