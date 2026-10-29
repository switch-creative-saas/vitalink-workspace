-- "Remember this device" for two-step verification.
--
-- After someone enters a code, their browser gets a random device token (only its hash is stored
-- here). On a later sign-in from that browser, the token marks the new session as trusted, so no
-- code is asked for, as long as the device was used in the last 14 days and was first trusted
-- less than 30 days ago. After that, or once the device is forgotten or two-step verification is
-- reset, the code is asked for again.
--
-- Trust is keyed by the session_id inside the login token, so edge functions (which forward the
-- token) inherit it without any change.

create table if not exists private.mfa_trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  label text not null default 'Browser',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists mfa_trusted_devices_user on private.mfa_trusted_devices (user_id);

create table if not exists private.mfa_trusted_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null references private.mfa_trusted_devices(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function private.device_window_ok(d private.mfa_trusted_devices)
returns boolean language sql stable set search_path = '' as $$
  select d.revoked_at is null and d.last_seen_at > now() - interval '14 days' and d.created_at > now() - interval '30 days'
$$;

-- Is this sign-in session vouched for by a still-valid trusted device?
create or replace function private.session_trusted()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.mfa_trusted_sessions s
    join private.mfa_trusted_devices d on d.id = s.device_id
    where s.session_id = nullif((select auth.jwt() ->> 'session_id'), '')::uuid
      and s.user_id = (select auth.uid())
      and private.device_window_ok(d)
  )
$$;

create or replace function private.mfa_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
      or (select auth.uid()) is null
      or not private.mfa_needed((select auth.uid()))
      or private.session_trusted()
$$;

/** After a code is entered: remember this browser (keeps at most 10 per person). */
create or replace function public.mfa_trust_device(p_token text, p_label text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((select auth.jwt() ->> 'aal'), '') <> 'aal2' then
    raise exception 'Enter a code first' using errcode = '42501';
  end if;
  if length(coalesce(p_token, '')) < 40 then raise exception 'Invalid device token' using errcode = '22023'; end if;
  insert into private.mfa_trusted_devices (user_id, token_hash, label)
  values (auth.uid(), encode(extensions.digest(p_token, 'sha256'), 'hex'), left(coalesce(nullif(btrim(p_label), ''), 'Browser'), 80))
  on conflict (token_hash) do update set last_seen_at = now(), revoked_at = null
    where private.mfa_trusted_devices.user_id = auth.uid();
  delete from private.mfa_trusted_devices where id in (
    select id from private.mfa_trusted_devices where user_id = auth.uid() order by last_seen_at desc offset 10);
end;
$$;

/**
 * At sign-in / reload from a remembered browser: if its token is still valid, this session is
 * trusted (no code needed) and the device's last use is updated. Returns whether it's trusted.
 */
create or replace function public.mfa_check_device(p_token text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare d private.mfa_trusted_devices; v_session uuid := nullif((select auth.jwt() ->> 'session_id'), '')::uuid;
begin
  if auth.uid() is null or coalesce(p_token, '') = '' then return false; end if;
  select * into d from private.mfa_trusted_devices
  where user_id = auth.uid() and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if d.id is null or not private.device_window_ok(d) then return false; end if;
  update private.mfa_trusted_devices set last_seen_at = now() where id = d.id;
  if v_session is not null then
    insert into private.mfa_trusted_sessions (session_id, user_id, device_id) values (v_session, auth.uid(), d.id)
    on conflict (session_id) do nothing;
  end if;
  return true;
end;
$$;

create or replace function public.mfa_devices(p_token text default null)
returns table (id uuid, label text, created_at timestamptz, last_seen_at timestamptz, expires_at timestamptz, this_device boolean)
language sql stable security definer set search_path = '' as $$
  select d.id, d.label, d.created_at, d.last_seen_at,
         least(d.last_seen_at + interval '14 days', d.created_at + interval '30 days'),
         d.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
  from private.mfa_trusted_devices d
  where d.user_id = auth.uid() and private.device_window_ok(d)
  order by d.last_seen_at desc
$$;

create or replace function public.mfa_forget_device(p_id uuid)
returns void language sql security definer set search_path = '' as $$
  update private.mfa_trusted_devices set revoked_at = now() where id = p_id and user_id = auth.uid()
$$;

-- Resetting two-step verification also forgets every remembered device.
create or replace function private.forget_all_devices(p_user uuid)
returns void language sql security definer set search_path = '' as $$
  update private.mfa_trusted_devices set revoked_at = now() where user_id = p_user and revoked_at is null
$$;

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
  perform private.forget_all_devices(m.user_id);
  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
  values (m.organization_id, auth.uid(), 'mfa_reset', 'memberships', m.id::text,
          jsonb_build_object('summary', 'Reset two-step verification for '
            || coalesce((select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = m.user_id), 'a staff member')));
end;
$$;

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
  perform private.forget_all_devices(v_user);
  perform private.console_log('mfa.reset', null, jsonb_build_object('email', lower(btrim(p_email)), 'factors_removed', n));
  return n;
end;
$$;

-- Old trusted-session rows are only bookkeeping.
select cron.unschedule(jobid) from cron.job where jobname = 'vitalink-prune-trusted-sessions';
select cron.schedule('vitalink-prune-trusted-sessions', '40 3 * * *',
  $$delete from private.mfa_trusted_sessions where created_at < now() - interval '31 days';
    delete from private.mfa_trusted_devices where revoked_at < now() - interval '30 days' or created_at < now() - interval '60 days'$$);

revoke all on function public.mfa_trust_device(text, text) from public, anon;
revoke all on function public.mfa_check_device(text) from public, anon;
revoke all on function public.mfa_devices(text) from public, anon;
revoke all on function public.mfa_forget_device(uuid) from public, anon;
grant execute on function public.mfa_trust_device(text, text) to authenticated;
grant execute on function public.mfa_check_device(text) to authenticated;
grant execute on function public.mfa_devices(text) to authenticated;
grant execute on function public.mfa_forget_device(uuid) to authenticated;
