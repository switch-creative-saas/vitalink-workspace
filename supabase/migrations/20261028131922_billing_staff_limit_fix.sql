-- Staff limit: invitations have no status column, so only read it for memberships.
create or replace function private.enforce_staff_limit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_plan public.plans; v_used integer; v_is_member boolean := tg_table_name = 'memberships';
begin
  if v_is_member then
    if new.status not in ('active', 'invited') then return new; end if;
    if tg_op = 'UPDATE' then
      if old.status in ('active', 'invited') then return new; end if;
    end if;
  end if;
  v_plan := private.workspace_plan(new.organization_id);
  if v_plan.max_staff is null then return new; end if;
  select (select count(*) from public.memberships where organization_id = new.organization_id and status in ('active', 'invited'))
       + (select count(*) from public.staff_invitations where organization_id = new.organization_id and not accepted and expires_at > now())
    into v_used;
  -- An invitation being accepted turns into a membership: don't count the person twice.
  if v_is_member then
    if exists (
      select 1 from public.staff_invitations i join auth.users u on lower(u.email) = lower(i.email)
      where i.organization_id = new.organization_id and u.id = new.user_id and not i.accepted and i.expires_at > now()) then
      v_used := v_used - 1;
    end if;
  end if;
  if v_used >= v_plan.max_staff then
    raise exception 'Your % plan allows up to % staff accounts. Upgrade your plan to add more people.', v_plan.name, v_plan.max_staff using errcode = 'P0001';
  end if;
  return new;
end;
$$;
