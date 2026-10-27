-- Settings, profile and header: richer profiles with synced preferences and
-- photos, real in-app notifications raised by database events, and a global
-- search that respects each user's access (it runs with their permissions).

-- ---------------------------------------------------------------------------
-- Profiles
alter table public.profiles
  add column phone text check (phone is null or phone ~ '^[0-9 +()-]{7,20}$'),
  add column job_title text check (job_title is null or length(job_title) <= 80),
  add column preferences jsonb not null default '{}',
  add column notification_prefs jsonb not null default '{}';

grant update (phone, job_title, preferences, notification_prefs) on public.profiles to authenticated;

-- Keep profiles.email in step with the sign-in email after a confirmed change.
create or replace function private.sync_profile_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function private.sync_profile_email();

-- Profile photos: public images, each user writes only their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "users upload own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "users replace own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "users delete own avatar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- In-app notifications
create table public.user_notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('appointments', 'lab', 'billing', 'staff', 'network', 'support', 'security', 'system')),
  title text not null,
  body text not null default '',
  link text,
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index user_notifications_user_idx on public.user_notifications (user_id, created_at desc);
create index user_notifications_unread_idx on public.user_notifications (user_id) where read_at is null;

alter table public.user_notifications enable row level security;
create policy "users read own notifications" on public.user_notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy "users mark own notifications" on public.user_notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "users clear own notifications" on public.user_notifications for delete to authenticated
  using (user_id = (select auth.uid()));
grant select, delete on public.user_notifications to authenticated;
grant update (read_at) on public.user_notifications to authenticated;
alter publication supabase_realtime add table public.user_notifications;

-- Raise one notification, unless the user switched that kind off or caused it themselves.
create or replace function private.notify(p_user uuid, p_org uuid, p_kind text, p_title text, p_body text, p_link text, p_priority text default 'normal')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null or p_user = auth.uid() then return; end if;
  if exists (select 1 from public.profiles where id = p_user and notification_prefs ->> p_kind = 'false') then return; end if;
  insert into public.user_notifications (user_id, organization_id, kind, title, body, link, priority)
  values (p_user, p_org, p_kind, p_title, coalesce(p_body, ''), p_link, coalesce(p_priority, 'normal'));
end;
$$;

-- Everyone in a workspace with one of the given roles.
create or replace function private.notify_roles(p_org uuid, p_roles text[], p_kind text, p_title text, p_body text, p_link text, p_priority text default 'normal')
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  for v_user in select user_id from public.memberships where organization_id = p_org and status = 'active' and role = any(p_roles) loop
    perform private.notify(v_user, p_org, p_kind, p_title, p_body, p_link, p_priority);
  end loop;
end;
$$;

create or replace function private.patient_label(p_patient uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(btrim(first_name || ' ' || last_name), 'A patient') from public.patients where id = p_patient
$$;

create or replace function private.wat(p timestamptz)
returns text language sql immutable set search_path = '' as $$
  select to_char(p at time zone 'Africa/Lagos', 'Dy DD Mon, HH24:MI')
$$;

-- Appointments: booked for you, moved to you, or cancelled.
create or replace function private.notify_appointment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_urgent boolean := new.priority in ('emergency', 'stat') or new.status = 'emergency';
  v_what text := private.patient_label(new.patient_id) || ' · ' || new.type || ' · ' || private.wat(new.starts_at);
begin
  if tg_op = 'INSERT' or new.clinician_id is distinct from old.clinician_id then
    perform private.notify(new.clinician_id, new.organization_id, 'appointments',
      case when v_urgent then 'Emergency appointment booked for you' else 'New appointment booked for you' end,
      v_what, '/appointments', case when v_urgent then 'high' else 'normal' end);
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    perform private.notify(new.clinician_id, new.organization_id, 'appointments', 'Appointment cancelled', v_what, '/appointments');
  end if;
  return null;
end;
$$;
create trigger appointments_notify after insert or update of clinician_id, status on public.appointments
  for each row execute function private.notify_appointment();

-- Lab: urgent orders to the lab team, finished results to the requester.
create or replace function private.notify_lab_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_patient text := private.patient_label(new.patient_id);
begin
  if tg_op = 'INSERT' and new.priority in ('urgent', 'stat') then
    perform private.notify_roles(new.organization_id, array['lab-scientist', 'lab-technician'], 'lab',
      upper(new.priority) || ' lab order: ' || new.order_number, v_patient, '/laboratory', 'high');
  elsif tg_op = 'UPDATE' and new.status = 'completed' and old.status <> 'completed' then
    perform private.notify(new.ordered_by, new.organization_id, 'lab',
      case when new.critical then 'Critical lab result: ' || new.order_number else 'Lab results ready: ' || new.order_number end,
      v_patient, '/laboratory', case when new.critical then 'high' else 'normal' end);
  end if;
  return null;
end;
$$;
create trigger lab_orders_notify after insert or update of status on public.lab_orders
  for each row execute function private.notify_lab_order();

-- Staff: the person who sent an invitation hears when it is accepted.
create or replace function private.notify_invitation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.accepted and not old.accepted then
    perform private.notify(new.invited_by, new.organization_id, 'staff', 'Invitation accepted',
      coalesce((select coalesce(nullif(full_name, ''), email) from public.profiles where id = new.accepted_by), new.email)
        || ' joined as ' || replace(new.role, '-', ' '), '/human-resources');
  end if;
  return null;
end;
$$;
create trigger staff_invitations_notify after update of accepted on public.staff_invitations
  for each row execute function private.notify_invitation();

-- Billing: subscription payments to the workspace admins.
create or replace function private.notify_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('success', 'failed') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform private.notify_roles(new.organization_id, private.admin_roles(), 'billing',
      case when new.status = 'success' then 'Subscription payment received' else 'Subscription payment failed' end,
      private.naira(new.amount_kobo) || ' · ' || initcap(coalesce(new.plan_id, '')) || ' (' || new.billing_cycle || ')',
      '/subscription', case when new.status = 'failed' then 'high' else 'normal' end);
  end if;
  return null;
end;
$$;
create trigger payments_notify after insert or update of status on public.payments
  for each row execute function private.notify_payment();

-- Support: a reply from the VitaLink team to the person who opened the ticket.
create or replace function private.notify_support_reply()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_ticket public.support_tickets;
begin
  if new.author_kind <> 'staff' or new.internal then return null; end if;
  select * into v_ticket from public.support_tickets where id = new.ticket_id;
  perform private.notify(v_ticket.created_by, v_ticket.organization_id, 'support',
    'VitaLink Support replied · ' || v_ticket.number, v_ticket.subject, '/help');
  return null;
end;
$$;
create trigger support_messages_notify after insert on public.support_messages
  for each row execute function private.notify_support_reply();

-- Network: in-app alongside the existing emails; email can be switched off per person.
create or replace function private.network_notify(p_org uuid, p_transfer public.network_transfers, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  recipient text;
begin
  perform private.notify_roles(p_org, private.admin_roles() || array['doctor'], 'network', p_title, p_body, '/switch-network',
    case when p_transfer.urgency = 'emergency' then 'high' else 'normal' end);
  for recipient in
    select distinct lower(x.email) from (
      select p.email from public.memberships m join public.profiles p on p.id = m.user_id
      where m.organization_id = p_org and m.status = 'active' and m.role = any (private.admin_roles())
        and coalesce(p.notification_prefs ->> 'email_network', 'true') <> 'false'
      union
      select np.referral_email from public.network_profiles np where np.organization_id = p_org and np.referral_email <> ''
    ) x where x.email is not null and x.email <> ''
  loop
    insert into public.notification_outbox (recipient, subject, body_text, body_html, payload)
    values (recipient, '[VitaLink Network] ' || p_title, p_title || E'\n' || p_body, '',
            jsonb_build_object('kind', 'network', 'title', p_title, 'body', p_body, 'number', p_transfer.number,
                               'transfer_id', p_transfer.id, 'urgency', p_transfer.urgency));
  end loop;
end;
$$;

-- Security: tell someone when an admin ends one of their sessions.
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
  perform private.notify(v_user, p_organization_id, 'security', 'A workspace admin ended one of your sessions',
    'If you didn''t expect this, change your password in Settings.', '/settings', 'high');
end;
$$;

-- Settings → Notifications → "Send a test".
create or replace function public.notify_test(p_organization_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_member(p_organization_id) then raise exception 'Not a member of this workspace' using errcode = '42501'; end if;
  insert into public.user_notifications (user_id, organization_id, kind, title, body, link)
  values (auth.uid(), p_organization_id, 'system', 'Test notification', 'Notifications are working on this device.', '/settings');
end;
$$;
revoke all on function public.notify_test(uuid) from public, anon;
grant execute on function public.notify_test(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Global search (header). SECURITY INVOKER: every table's RLS decides what the
-- caller may see, so results never include records their role can't open.
create or replace function public.global_search(p_organization_id uuid, p_query text, p_limit integer default 5)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  q text := btrim(coalesce(p_query, ''));
  pat text;
  n integer := least(greatest(coalesce(p_limit, 5), 1), 10);
begin
  if length(q) < 2 then return '[]'::jsonb; end if;
  pat := '%' || replace(replace(q, '%', ''), '_', '') || '%';
  return (
    select coalesce(jsonb_agg(r), '[]') from (
      (select jsonb_build_object('type', 'patient', 'id', p.id, 'title', btrim(p.first_name || ' ' || p.last_name),
          'subtitle', p.switch_id || coalesce(' · ' || initcap(p.gender), '') || coalesce(' · ' || extract(year from age(p.date_of_birth))::int || ' yrs', ''),
          'switchId', p.switch_id, 'status', p.status) as r
       from public.patients p
       where p.organization_id = p_organization_id
         and (p.first_name || ' ' || p.last_name ilike pat or p.switch_id ilike pat or p.phone ilike pat)
       order by p.updated_at desc limit n)
      union all
      (select jsonb_build_object('type', 'appointment', 'id', a.id, 'title', btrim(p.first_name || ' ' || p.last_name),
          'subtitle', a.type || ' · ' || coalesce(a.department, '') || ' · ' || to_char(a.starts_at at time zone 'Africa/Lagos', 'DD Mon, HH24:MI'),
          'switchId', p.switch_id, 'status', a.status)
       from public.appointments a join public.patients p on p.id = a.patient_id
       where a.organization_id = p_organization_id and a.starts_at > now() - interval '30 days'
         and (p.first_name || ' ' || p.last_name ilike pat or p.switch_id ilike pat or a.queue_number ilike pat)
       order by abs(extract(epoch from a.starts_at - now())) limit n)
      union all
      (select jsonb_build_object('type', 'lab', 'id', l.id, 'title', l.order_number,
          'subtitle', btrim(p.first_name || ' ' || p.last_name) || ' · ' || initcap(l.priority) || ' · ' || initcap(l.status),
          'switchId', p.switch_id, 'status', l.status)
       from public.lab_orders l join public.patients p on p.id = l.patient_id
       where l.organization_id = p_organization_id
         and (l.order_number ilike pat or p.first_name || ' ' || p.last_name ilike pat or p.switch_id ilike pat)
       order by l.created_at desc limit n)
      union all
      (select jsonb_build_object('type', 'prescription', 'id', rx.id, 'title', rx.drug_name || coalesce(' ' || rx.dosage, ''),
          'subtitle', btrim(p.first_name || ' ' || p.last_name) || ' · ' || initcap(rx.status),
          'switchId', p.switch_id, 'status', rx.status)
       from public.prescriptions rx join public.patients p on p.id = rx.patient_id
       where rx.organization_id = p_organization_id
         and (rx.drug_name ilike pat or p.first_name || ' ' || p.last_name ilike pat or p.switch_id ilike pat)
       order by rx.created_at desc limit n)
      union all
      (select jsonb_build_object('type', 'staff', 'id', m.id, 'title', coalesce(nullif(pr.full_name, ''), pr.email),
          'subtitle', initcap(replace(m.role, '-', ' ')) || coalesce(' · ' || m.department, '') || ' · ' || initcap(m.status),
          'switchId', null, 'status', m.status)
       from public.memberships m join public.profiles pr on pr.id = m.user_id
       where m.organization_id = p_organization_id
         and (pr.full_name ilike pat or pr.email ilike pat or m.department ilike pat)
       order by pr.full_name limit n)
    ) results
  );
end;
$$;
revoke all on function public.global_search(uuid, text, integer) from public, anon;
grant execute on function public.global_search(uuid, text, integer) to authenticated;
