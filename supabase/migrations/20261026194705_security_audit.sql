-- Security & Audit: a readable audit trail, real sign-in sessions, and the two
-- workspace policies VitaLink enforces (idle sign-out and re-sign-in after N days).
--
-- * audit_logs rows now record the caller's IP and browser (from the API request
--   headers) and can be flagged for review.
-- * Sign-ins / sign-outs / exports / session revocations are logged by RPCs.
-- * Sessions come from auth.sessions; revoking one deletes it (its refresh token
--   stops working; the current access token expires within the hour).

alter table public.audit_logs
  add column ip_address text,
  add column user_agent text,
  add column flagged boolean not null default false,
  add column flagged_by uuid references public.profiles(id) on delete set null,
  add column flagged_at timestamptz,
  add column flag_note text;
create index if not exists audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);

-- Stamp who/where on every audit row written during an API request.
create or replace function private.audit_stamp_request()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
begin
  new.actor_id := coalesce(new.actor_id, auth.uid());
  if v_headers is not null then
    new.ip_address := coalesce(new.ip_address, nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', v_headers ->> 'cf-connecting-ip', ''), ',', 1)), ''));
    new.user_agent := coalesce(new.user_agent, left(v_headers ->> 'user-agent', 300));
  end if;
  return new;
end;
$$;
create trigger audit_logs_stamp_request before insert on public.audit_logs
  for each row execute function private.audit_stamp_request();

-- Workspace security policy.
alter table public.organizations
  add column idle_timeout_minutes integer not null default 30 check (idle_timeout_minutes = 0 or idle_timeout_minutes between 5 and 720),
  add column max_session_days integer not null default 30 check (max_session_days between 1 and 90);

create or replace function private.security_roles()
returns text[] language sql immutable set search_path = '' as $$
  select array['super-admin', 'hospital-admin', 'ngo-admin', 'government-admin', 'it-officer']::text[]
$$;

-- Admins and IT officers read the whole workspace log (existing policy covers admins).
drop policy if exists "admins read audit log" on public.audit_logs;
create policy "security staff read audit log" on public.audit_logs for select to authenticated
  using (private.has_role(organization_id, private.security_roles()) or actor_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- How an audit row reads in the UI.
create or replace function private.audit_module(p_entity text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_entity in ('patients') then 'Patients'
    when p_entity in ('appointments') then 'Appointments'
    when p_entity in ('clinical_notes', 'vitals', 'patient_documents', 'identity_scans') then 'EMR'
    when p_entity like 'lab\_%' then 'Laboratory'
    when p_entity in ('prescriptions', 'drug_inventory', 'purchase_orders') then 'Pharmacy'
    when p_entity in ('invoices', 'invoice_payments', 'invoice_line_items') then 'Billing'
    when p_entity in ('memberships', 'staff_invitations') then 'Staff'
    when p_entity in ('subscriptions', 'payments') then 'Subscription'
    when p_entity in ('departments', 'organizations') then 'Administration'
    when p_entity = 'telemedicine_sessions' then 'Telemedicine'
    when p_entity = 'security' then 'Security'
    else initcap(replace(p_entity, '_', ' '))
  end
$$;

create or replace function private.audit_action(p_action text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_action = 'insert' then 'CREATE'
    when p_action = 'update' then 'UPDATE'
    when p_action = 'delete' then 'DELETE'
    when p_action = 'sign_in' then 'LOGIN'
    when p_action = 'sign_out' then 'LOGOUT'
    when p_action = 'export' then 'EXPORT'
    when p_action in ('session_revoked', 'sessions_revoked') then 'REVOKE'
    when p_action like 'department.%' and p_action like '%deleted' then 'DELETE'
    when p_action like 'department.%' and p_action like '%created' then 'CREATE'
    else 'UPDATE'
  end
$$;

create or replace function private.audit_risk(p_entity text, p_action text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_action in ('session_revoked', 'sessions_revoked', 'export', 'security.updated') then 'high'
    when p_action = 'delete' and p_entity in ('patients', 'clinical_notes', 'vitals', 'lab_results', 'prescriptions', 'invoices', 'invoice_payments', 'memberships', 'patient_documents') then 'high'
    when p_entity = 'memberships' and p_action in ('update', 'delete') then 'high'
    when p_action = 'delete' or p_action like '%deleted' then 'medium'
    when p_entity in ('subscriptions', 'invoice_payments', 'staff_invitations', 'organizations') or p_action in ('facility.updated', 'department.staff_transferred') then 'medium'
    else 'low'
  end
$$;

-- One page of the workspace audit trail plus filter options and totals.
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
           private.audit_risk(l.entity, l.action) as risk,
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
             b.metadata ->> 'summary', b.ip_address) ilike '%' || btrim(p_search) || '%')
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
        'summary', coalesce(metadata ->> 'summary',
          case when entity = 'memberships' then format('Staff access %s: role %s, %s', case action when 'insert' then 'granted' when 'delete' then 'removed' else 'changed' end, metadata ->> 'role', metadata ->> 'status') end),
        'metadata', metadata, 'ip', ip_address, 'userAgent', user_agent,
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

-- Sign-in / sign-out / export events, written once per workspace the user belongs to.
create or replace function public.security_log_event(p_action text, p_organization_id uuid default null, p_details jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_action not in ('sign_in', 'sign_out', 'export') then raise exception 'Unknown event' using errcode = '22023'; end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
  select m.organization_id, auth.uid(), p_action, 'security', coalesce(auth.jwt() ->> 'session_id', ''),
    jsonb_build_object('summary', case p_action
      when 'sign_in' then 'Signed in'
      when 'sign_out' then 'Signed out'
      else format('Exported %s audit records', coalesce(p_details ->> 'count', '?')) end) || coalesce(p_details, '{}')
  from public.memberships m
  where m.user_id = auth.uid() and m.status = 'active'
    and (p_organization_id is null or m.organization_id = p_organization_id);
end;
$$;

create or replace function public.security_flag_event(p_log_id bigint, p_flagged boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.audit_logs where id = p_log_id;
  if v_org is null or not private.has_role(v_org, private.security_roles()) then
    raise exception 'Only admins and IT officers can flag events' using errcode = '42501';
  end if;
  update public.audit_logs set flagged = coalesce(p_flagged, true),
    flagged_by = case when coalesce(p_flagged, true) then auth.uid() end,
    flagged_at = case when coalesce(p_flagged, true) then now() end,
    flag_note = case when coalesce(p_flagged, true) then nullif(btrim(p_note), '') end
  where id = p_log_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sessions. Admins / IT officers see every member's; others see their own.
create or replace function public.security_sessions(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_all boolean := private.has_role(p_organization_id, private.security_roles());
  v_org public.organizations;
  v_current uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if not private.is_member(p_organization_id) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;
  select * into v_org from public.organizations where id = p_organization_id;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'userId', s.user_id, 'name', coalesce(nullif(p.full_name, ''), p.email), 'email', p.email, 'role', m.role,
      'createdAt', s.created_at, 'lastActiveAt', coalesce(s.refreshed_at at time zone 'UTC', s.updated_at, s.created_at),
      'ip', host(s.ip), 'userAgent', s.user_agent, 'mfa', s.aal::text = 'aal2', 'isCurrent', s.id = v_current,
      'expiresByPolicy', s.created_at < now() - make_interval(days => v_org.max_session_days)
    ) order by (s.id = v_current) desc, coalesce(s.refreshed_at at time zone 'UTC', s.updated_at) desc), '[]')
    from auth.sessions s
    join public.memberships m on m.user_id = s.user_id and m.organization_id = p_organization_id and m.status = 'active'
    left join public.profiles p on p.id = s.user_id
    where v_all or s.user_id = auth.uid()
  );
end;
$$;

-- End one session (your own, or any member's if you are an admin / IT officer).
create or replace function public.security_revoke_session(p_organization_id uuid, p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_name text;
begin
  select s.user_id into v_user from auth.sessions s
    join public.memberships m on m.user_id = s.user_id and m.organization_id = p_organization_id
    where s.id = p_session_id;
  if v_user is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  if v_user <> auth.uid() and not private.has_role(p_organization_id, private.security_roles()) then
    raise exception 'Only admins and IT officers can end other people''s sessions' using errcode = '42501';
  end if;
  select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = v_user;
  delete from auth.sessions where id = p_session_id;
  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
  values (p_organization_id, auth.uid(), 'session_revoked', 'security', p_session_id::text,
    jsonb_build_object('summary', format('Ended a session for %s', coalesce(v_name, 'a user')), 'user_id', v_user));
end;
$$;

-- End every session except the caller's current one: 'mine' = your other devices,
-- 'workspace' = everyone in the workspace (admins / IT officers).
create or replace function public.security_revoke_all(p_organization_id uuid, p_scope text default 'mine')
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_current uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_count integer;
begin
  if not private.is_member(p_organization_id) then raise exception 'Not a member of this workspace' using errcode = '42501'; end if;
  if p_scope = 'workspace' and not private.has_role(p_organization_id, private.security_roles()) then
    raise exception 'Only admins and IT officers can end everyone''s sessions' using errcode = '42501';
  end if;
  delete from auth.sessions s
  where s.id is distinct from v_current
    and (case when p_scope = 'workspace'
          then exists (select 1 from public.memberships m where m.user_id = s.user_id and m.organization_id = p_organization_id and m.status = 'active')
          else s.user_id = auth.uid() end);
  get diagnostics v_count = row_count;
  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
  values (p_organization_id, auth.uid(), 'sessions_revoked', 'security', '',
    jsonb_build_object('summary', format('Ended %s %s', v_count, case when p_scope = 'workspace' then 'sessions across the workspace' else 'of their other sessions' end)));
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Policy: read by every member (the app enforces idle sign-out), set by admins.
create or replace function public.security_policy(p_organization_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_member(p_organization_id) then
    (select jsonb_build_object('idleTimeoutMinutes', idle_timeout_minutes, 'maxSessionDays', max_session_days)
     from public.organizations where id = p_organization_id) end
$$;

create or replace function public.security_save_policy(p_organization_id uuid, p_idle_timeout_minutes integer, p_max_session_days integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role(p_organization_id, private.security_roles()) then
    raise exception 'Only admins and IT officers can change security settings' using errcode = '42501';
  end if;
  if not (p_idle_timeout_minutes = 0 or p_idle_timeout_minutes between 5 and 720) then
    raise exception 'Idle sign-out must be off or between 5 and 720 minutes' using errcode = '22023';
  end if;
  if p_max_session_days not between 1 and 90 then
    raise exception 'Sign-in must be renewed every 1 to 90 days' using errcode = '22023';
  end if;
  update public.organizations set idle_timeout_minutes = p_idle_timeout_minutes, max_session_days = p_max_session_days
  where id = p_organization_id;
  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
  values (p_organization_id, auth.uid(), 'security.updated', 'security', p_organization_id::text,
    jsonb_build_object('summary', format('Security policy: idle sign-out %s, sign in again every %s days',
      case when p_idle_timeout_minutes = 0 then 'off' else p_idle_timeout_minutes || ' min' end, p_max_session_days)));
end;
$$;

-- Daily: end sessions older than the strictest max_session_days of the user's workspaces.
create or replace function private.security_expire_sessions()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  delete from auth.sessions s
  using (
    select m.user_id, min(o.max_session_days) as days
    from public.memberships m join public.organizations o on o.id = m.organization_id
    where m.status = 'active' group by m.user_id
  ) lim
  where lim.user_id = s.user_id and s.created_at < now() - make_interval(days => lim.days);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
select cron.schedule('vitalink-expire-sessions', '30 2 * * *', 'select private.security_expire_sessions()');

revoke all on function public.security_audit_feed(uuid, date, date, text, text, uuid, text, text, boolean, integer, integer) from public, anon;
revoke all on function public.security_log_event(text, uuid, jsonb) from public, anon;
revoke all on function public.security_flag_event(bigint, boolean, text) from public, anon;
revoke all on function public.security_sessions(uuid) from public, anon;
revoke all on function public.security_revoke_session(uuid, uuid) from public, anon;
revoke all on function public.security_revoke_all(uuid, text) from public, anon;
revoke all on function public.security_policy(uuid) from public, anon;
revoke all on function public.security_save_policy(uuid, integer, integer) from public, anon;
grant execute on function public.security_audit_feed(uuid, date, date, text, text, uuid, text, text, boolean, integer, integer) to authenticated;
grant execute on function public.security_log_event(text, uuid, jsonb) to authenticated;
grant execute on function public.security_flag_event(bigint, boolean, text) to authenticated;
grant execute on function public.security_sessions(uuid) to authenticated;
grant execute on function public.security_revoke_session(uuid, uuid) to authenticated;
grant execute on function public.security_revoke_all(uuid, text) to authenticated;
grant execute on function public.security_policy(uuid) to authenticated;
grant execute on function public.security_save_policy(uuid, integer, integer) to authenticated;
