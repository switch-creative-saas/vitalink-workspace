-- Staff management: schedule editing (admins for anyone, staff for themselves)
-- and the invite landing page also needs the workspace slug to open it after joining.

create or replace function public.update_staff_schedule(
  p_membership_id uuid,
  p_department text,
  p_accepts_appointments boolean,
  p_working_start time,
  p_working_end time,
  p_break_times text[],
  p_max_per_hour integer
)
returns public.memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.memberships;
begin
  select * into target from public.memberships where id = p_membership_id;
  if target.id is null then
    raise exception 'Staff member not found' using errcode = 'P0002';
  end if;
  if not (target.user_id = auth.uid() or private.has_role(target.organization_id, private.admin_roles())) then
    raise exception 'Only workspace admins can change other staff schedules' using errcode = '42501';
  end if;
  if p_working_end <= p_working_start then
    raise exception 'Shift end must be after shift start' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_break_times, '{}')) b where b !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception 'Break times must look like 12:00' using errcode = '22023';
  end if;

  update public.memberships
  set department = nullif(btrim(p_department), ''),
      accepts_appointments = coalesce(p_accepts_appointments, accepts_appointments),
      working_start = p_working_start,
      working_end = p_working_end,
      break_times = coalesce(p_break_times, '{}'),
      max_per_hour = p_max_per_hour
  where id = p_membership_id
  returning * into target;
  return target;
end;
$$;
revoke execute on function public.update_staff_schedule(uuid, text, boolean, time, time, text[], integer) from public, anon;
grant execute on function public.update_staff_schedule(uuid, text, boolean, time, time, text[], integer) to authenticated;

drop function public.get_invitation(text);
create function public.get_invitation(p_token text)
returns table (organization_name text, organization_slug text, role text, department text, email text, expires_at timestamptz, is_valid boolean)
language sql stable
security definer
set search_path = ''
as $$
  select o.name, o.slug, i.role, i.department, i.email, i.expires_at,
         (not i.accepted and i.expires_at > now()) as is_valid
  from public.staff_invitations i
  join public.organizations o on o.id = i.organization_id
  where i.token = p_token
$$;
revoke execute on function public.get_invitation(text) from public;
grant execute on function public.get_invitation(text) to anon, authenticated;
