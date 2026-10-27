-- Staff record updates in the audit log: only a real role or access (status)
-- change is high risk. Department or schedule edits are routine.
-- From now on membership updates record the previous role/status, which fields
-- changed and whose record it is.

create or replace function private.write_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  prev jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  meta jsonb := '{}'::jsonb;
begin
  if tg_table_name = 'memberships' then
    meta := jsonb_build_object('role', rec ->> 'role', 'status', rec ->> 'status', 'user_id', rec ->> 'user_id',
      'member', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = (rec ->> 'user_id')::uuid));
    if prev is not null then
      meta := meta || jsonb_build_object('previous_role', prev ->> 'role', 'previous_status', prev ->> 'status',
        'changed', (select coalesce(jsonb_agg(k), '[]') from jsonb_object_keys(rec) k
                    where k not in ('updated_at') and rec -> k is distinct from prev -> k));
    end if;
  end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
  values ((rec ->> 'organization_id')::uuid, auth.uid(), lower(tg_op), tg_table_name, rec ->> 'id', meta);
  return null;
end;
$$;

create or replace function private.audit_risk(p_entity text, p_action text, p_meta jsonb)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_entity = 'memberships' and p_action = 'update' then
      case
        when not (p_meta ? 'previous_role') then 'medium'  -- recorded before changes were tracked
        when p_meta ->> 'previous_role' is distinct from p_meta ->> 'role'
          or p_meta ->> 'previous_status' is distinct from p_meta ->> 'status' then 'high'
        else 'low'
      end
    else private.audit_risk(p_entity, p_action)
  end
$$;

create or replace function private.audit_summary(p_entity text, p_action text, p_meta jsonb)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_entity <> 'memberships' then null
    when p_action = 'insert' then format('%s joined as %s', coalesce(p_meta ->> 'member', 'A staff member'), replace(p_meta ->> 'role', '-', ' '))
    when p_action = 'delete' then format('%s was removed from the workspace', coalesce(p_meta ->> 'member', 'A staff member'))
    when not (p_meta ? 'previous_role') then 'Staff record updated'
    when p_meta ->> 'previous_role' is distinct from p_meta ->> 'role'
      then format('%s: role changed from %s to %s', coalesce(p_meta ->> 'member', 'Staff member'), replace(p_meta ->> 'previous_role', '-', ' '), replace(p_meta ->> 'role', '-', ' '))
    when p_meta ->> 'previous_status' is distinct from p_meta ->> 'status'
      then format('%s: access %s', coalesce(p_meta ->> 'member', 'Staff member'), case p_meta ->> 'status' when 'active' then 'restored' else p_meta ->> 'status' end)
    else format('%s: %s updated', coalesce(p_meta ->> 'member', 'Staff member'),
      coalesce((select string_agg(replace(c, '_', ' '), ', ') from jsonb_array_elements_text(p_meta -> 'changed') c), 'details'))
  end
$$;

create or replace function public.security_audit_feed(
  p_organization_id uuid, p_from date default null, p_to date default null, p_search text default null,
  p_module text default null, p_actor uuid default null, p_action text default null, p_risk text default null,
  p_flagged boolean default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_all boolean := private.has_role(p_organization_id, private.security_roles());
  v_result jsonb;
begin
  if not private.is_member(p_organization_id) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;

  with base as (
    select l.*, private.audit_module(l.entity) as module, private.audit_action(l.action) as action_label,
           private.audit_risk(l.entity, l.action, l.metadata) as risk,
           coalesce(l.metadata ->> 'summary', private.audit_summary(l.entity, l.action, l.metadata)) as summary,
           coalesce(nullif(p.full_name, ''), p.email, case when l.actor_id is null then 'System' else 'Unknown user' end) as actor_name,
           p.email as actor_email, m.role as actor_role
    from public.audit_logs l
    left join public.profiles p on p.id = l.actor_id
    left join public.memberships m on m.user_id = l.actor_id and m.organization_id = l.organization_id
    where l.organization_id = p_organization_id
      and (v_all or l.actor_id = auth.uid())
  ),
  filtered as (
    select * from base b
    where (p_from is null or (b.created_at at time zone 'Africa/Lagos')::date >= p_from)
      and (p_to is null or (b.created_at at time zone 'Africa/Lagos')::date <= p_to)
      and (p_module is null or b.module = p_module)
      and (p_actor is null or b.actor_id = p_actor)
      and (p_action is null or b.action_label = p_action)
      and (p_risk is null or b.risk = p_risk)
      and (p_flagged is null or b.flagged = p_flagged)
      and (nullif(btrim(p_search), '') is null or concat_ws(' ', b.actor_name, b.actor_email, b.module, b.entity, b.entity_id,
             b.summary, b.ip_address) ilike '%' || btrim(p_search) || '%')
  ),
  page as (
    select * from filtered order by created_at desc, id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 500) offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'stats', (select jsonb_build_object(
        'events', count(*),
        'high', count(*) filter (where risk = 'high'),
        'deletes', count(*) filter (where action_label = 'DELETE'),
        'signIns', count(*) filter (where action = 'sign_in'),
        'flagged', count(*) filter (where flagged)) from filtered),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'at', created_at, 'actorId', actor_id, 'actorName', actor_name, 'actorEmail', actor_email, 'actorRole', actor_role,
        'action', action_label, 'rawAction', action, 'entity', entity, 'entityId', entity_id, 'module', module, 'risk', risk,
        'summary', summary, 'metadata', metadata, 'ip', ip_address, 'userAgent', user_agent,
        'flagged', flagged, 'flagNote', flag_note, 'flaggedAt', flagged_at) order by created_at desc, id desc), '[]') from page),
    'facets', jsonb_build_object(
      'modules', (select coalesce(jsonb_agg(distinct module), '[]') from base),
      'actors', (select coalesce(jsonb_agg(distinct jsonb_build_object('id', actor_id, 'name', actor_name)) filter (where actor_id is not null), '[]') from base),
      'actions', (select coalesce(jsonb_agg(distinct action_label), '[]') from base)),
    'canSeeAll', v_all
  ) into v_result;
  return v_result;
end;
$$;
