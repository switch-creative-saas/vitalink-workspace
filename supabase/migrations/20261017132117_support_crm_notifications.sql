-- Help & Support, CRM notes and console notifications.
--
--  * support_tickets / support_messages: one system for support requests, bug
--    reports, feedback, feature requests and live chat. Customers see their own
--    tickets (workspace admins see all of their workspace's); VitaLink platform
--    admins see everything and can add internal notes.
--  * crm_notes: private VitaLink notes on a workspace.
--  * platform_events: what happened (sign-ups, workspaces, payments, plan
--    changes, card orders, support). Shown in the console feed and fanned out to
--    notification_outbox as emails per admin preferences.
--  * notification_outbox: emails waiting to be sent by the console-notify Edge
--    Function (Resend). pg_net pokes the function whenever mail is queued and
--    pg_cron retries every 10 minutes.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Where the database reaches the Edge Functions (per project).
create table private.app_config (
  key text primary key,
  value text not null
);
insert into private.app_config (key, value) values
  ('functions_base_url', 'https://ynbdsrazaplzsrllfgym.supabase.co/functions/v1');

alter table public.platform_settings
  add column support_phone text not null default '',
  add column support_whatsapp text not null default '',
  add column support_hours text not null default '';

-- ============================================
-- SUPPORT
-- ============================================

create sequence private.support_ticket_serial;

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  number text not null unique,
  kind text not null default 'support' check (kind in ('support', 'bug', 'feedback', 'feature', 'chat')),
  category text not null default 'general',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'pending', 'resolved', 'closed')),
  subject text not null check (char_length(btrim(subject)) > 0),
  created_by uuid references public.profiles (id) on delete set null,
  assigned_to text,
  customer_unread boolean not null default false,
  staff_unread boolean not null default true,
  first_response_at timestamptz,
  last_message_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_tickets_org_idx on public.support_tickets (organization_id, last_message_at desc);
create index support_tickets_inbox_idx on public.support_tickets (status, last_message_at desc);
create index support_tickets_created_by_idx on public.support_tickets (created_by);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  author_kind text not null check (author_kind in ('customer', 'staff', 'system')),
  body text not null check (char_length(btrim(body)) > 0),
  internal boolean not null default false,
  -- [{ "name": text, "path": text, "size": int, "type": text }]
  attachments jsonb not null default '[]' check (jsonb_typeof(attachments) = 'array'),
  created_at timestamptz not null default now()
);
create index support_messages_ticket_idx on public.support_messages (ticket_id, created_at);
create index support_messages_org_idx on public.support_messages (organization_id);
create index support_messages_author_idx on public.support_messages (author_id);

create or replace function private.can_see_ticket(t public.support_tickets)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin()
      or (private.is_member(t.organization_id)
          and (t.created_by = auth.uid() or private.has_role(t.organization_id, private.admin_roles())))
$$;

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
create policy "ticket owners, workspace admins and VitaLink read tickets" on public.support_tickets
  for select to authenticated using (private.can_see_ticket(support_tickets));
create policy "see messages on visible tickets" on public.support_messages
  for select to authenticated using (
    exists (select 1 from public.support_tickets t where t.id = ticket_id and private.can_see_ticket(t))
    and (not internal or private.is_platform_admin()));
revoke all on public.support_tickets, public.support_messages from anon, authenticated;
grant select on public.support_tickets, public.support_messages to authenticated;

alter publication supabase_realtime add table public.support_tickets, public.support_messages;

-- Private bucket for ticket attachments: <organization_id>/<ticket_id>/<file>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-attachments', 'support-attachments', false, 10485760,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'text/csv',
              'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

create policy "members and VitaLink read support files" on storage.objects
  for select to authenticated
  using (bucket_id = 'support-attachments' and (private.is_member(private.object_org(name)) or private.is_platform_admin()));
create policy "members and VitaLink upload support files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'support-attachments' and (private.is_member(private.object_org(name)) or private.is_platform_admin()));

-- ============================================
-- CRM NOTES (VitaLink only)
-- ============================================

create table public.crm_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  author_email text not null,
  body text not null check (char_length(btrim(body)) > 0),
  created_at timestamptz not null default now()
);
create index crm_notes_org_idx on public.crm_notes (organization_id, created_at desc);
alter table public.crm_notes enable row level security;
create policy "VitaLink reads CRM notes" on public.crm_notes for select to authenticated using (private.is_platform_admin());
revoke all on public.crm_notes from anon, authenticated;
grant select on public.crm_notes to authenticated;

-- ============================================
-- EVENTS, PREFERENCES, OUTBOX
-- ============================================

create table public.platform_events (
  id bigint generated always as identity primary key,
  category text not null check (category in ('signups', 'subscriptions', 'payments', 'orders', 'support')),
  type text not null,
  title text not null,
  body text not null default '',
  organization_id uuid references public.organizations (id) on delete set null,
  ticket_id uuid references public.support_tickets (id) on delete set null,
  amount_kobo bigint,
  actor_email text not null default '',
  created_at timestamptz not null default now()
);
create index platform_events_created_idx on public.platform_events (created_at desc);
create index platform_events_org_idx on public.platform_events (organization_id);
create index platform_events_ticket_idx on public.platform_events (ticket_id);
alter table public.platform_events enable row level security;
create policy "VitaLink reads events" on public.platform_events for select to authenticated using (private.is_platform_admin());
revoke all on public.platform_events from anon, authenticated;
grant select on public.platform_events to authenticated;
alter publication supabase_realtime add table public.platform_events;

-- Per-admin email preferences and feed read marker (keyed by admin email).
create table public.platform_admin_prefs (
  email text primary key check (email = lower(email)),
  email_enabled boolean not null default true,
  categories text[] not null default array['signups', 'subscriptions', 'payments', 'orders', 'support'],
  include_own_actions boolean not null default false,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.platform_admin_prefs enable row level security;
create policy "admins read their own prefs" on public.platform_admin_prefs
  for select to authenticated using (private.is_platform_admin() and email = (select lower(u.email) from auth.users u where u.id = auth.uid()));
revoke all on public.platform_admin_prefs from anon, authenticated;
grant select on public.platform_admin_prefs to authenticated;

create table public.notification_outbox (
  id bigint generated always as identity primary key,
  recipient text not null,
  subject text not null,
  body_text text not null,
  body_html text not null,
  event_id bigint references public.platform_events (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index notification_outbox_pending_idx on public.notification_outbox (created_at) where status = 'pending';
create index notification_outbox_event_idx on public.notification_outbox (event_id);
alter table public.notification_outbox enable row level security;
create policy "VitaLink reads the outbox" on public.notification_outbox for select to authenticated using (private.is_platform_admin());
revoke all on public.notification_outbox from anon, authenticated;
grant select on public.notification_outbox to authenticated;

create or replace function private.escape_html(value text)
returns text
language sql
immutable
set search_path = ''
as $$ select replace(replace(replace(replace(coalesce(value, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') $$;

create or replace function private.naira(kobo bigint)
returns text
language sql
immutable
set search_path = ''
as $$ select '₦' || to_char(coalesce(kobo, 0) / 100.0, 'FM999,999,999,990.00') $$;

-- Records an event and queues an email to each admin who wants that category.
create or replace function private.emit_event(
  p_category text, p_type text, p_title text, p_body text default '',
  p_org uuid default null, p_ticket uuid default null, p_amount bigint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text := coalesce((select lower(u.email) from auth.users u where u.id = auth.uid()), '');
  event_id bigint;
  org_name text := (select o.name from public.organizations o where o.id = p_org);
  admin record;
begin
  insert into public.platform_events (category, type, title, body, organization_id, ticket_id, amount_kobo, actor_email)
  values (p_category, p_type, p_title, coalesce(p_body, ''), p_org, p_ticket, p_amount, actor)
  returning id into event_id;

  for admin in
    select pa.email, coalesce(pr.email_enabled, true) as enabled, coalesce(pr.categories, array['signups','subscriptions','payments','orders','support']) as categories,
           coalesce(pr.include_own_actions, false) as own
    from private.platform_admins pa
    left join public.platform_admin_prefs pr on pr.email = pa.email
  loop
    continue when not admin.enabled or not (p_category = any (admin.categories));
    continue when admin.email = actor and not admin.own;
    insert into public.notification_outbox (recipient, subject, body_text, body_html, event_id)
    values (
      admin.email,
      '[VitaLink] ' || p_title,
      p_title || coalesce(E'\n' || nullif(p_body, ''), '') || coalesce(E'\nWorkspace: ' || org_name, '') || E'\n\nOpen the VitaLink Console to see more.',
      '<p><strong>' || private.escape_html(p_title) || '</strong></p>'
        || coalesce('<p>' || private.escape_html(nullif(p_body, '')) || '</p>', '')
        || coalesce('<p style="color:#64748b">Workspace: ' || private.escape_html(org_name) || '</p>', '')
        || '<p style="color:#64748b;font-size:12px">You get this because you are a VitaLink platform admin. Change alerts in the VitaLink Console → Notifications.</p>',
      event_id);
  end loop;
end;
$$;

-- Pokes the email function (best effort; pg_cron retries anything left pending).
create or replace function private.kick_outbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform net.http_post(
    url := (select value from private.app_config where key = 'functions_base_url') || '/console-notify',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb);
  return null;
exception when others then
  return null;
end;
$$;
create trigger notification_outbox_kick after insert on public.notification_outbox
  for each statement execute function private.kick_outbox();

select cron.schedule('vitalink-console-notify-retry', '*/10 * * * *', $cron$
  select net.http_post(
    url := (select value from private.app_config where key = 'functions_base_url') || '/console-notify',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb)
  where exists (select 1 from public.notification_outbox where status = 'pending')
$cron$);

-- ============================================
-- EVENT SOURCES
-- ============================================

create or replace function private.event_new_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.emit_event('signups', 'user.signed_up', 'New sign-up: ' || coalesce(nullif(new.full_name, ''), new.email), new.email);
  return null;
end;
$$;
create trigger profiles_platform_event after insert on public.profiles
  for each row execute function private.event_new_profile();

create or replace function private.event_new_workspace()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.emit_event('signups', 'workspace.created', 'New workspace: ' || new.name,
    concat_ws(' · ', new.organization_type, nullif(new.state, ''), nullif(new.contact_email, ''), nullif(new.contact_phone, ''),
              'requested plan: ' || coalesce(new.requested_plan, 'free')),
    new.id);
  return null;
end;
$$;
create trigger organizations_platform_event after insert on public.organizations
  for each row execute function private.event_new_workspace();

create or replace function private.event_subscription_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  plan_name text := (select p.name from public.plans p where p.id = new.plan_id);
  org_name text := (select o.name from public.organizations o where o.id = new.organization_id);
begin
  if new.status is not distinct from old.status and new.plan_id is not distinct from old.plan_id then
    return null;
  end if;
  perform private.emit_event('subscriptions', 'subscription.' || new.status,
    org_name || ': ' || case new.status
      when 'active' then 'now on ' || plan_name
      when 'trialing' then 'started a ' || plan_name || ' trial'
      when 'comped' then plan_name || ' comped'
      when 'past_due' then 'payment overdue (' || plan_name || ')'
      when 'pending_payment' then 'chose ' || plan_name || ', awaiting payment'
      when 'cancelled' then 'subscription cancelled'
      else new.status end,
    'Was ' || coalesce((select p.name from public.plans p where p.id = old.plan_id), old.plan_id) || ' (' || old.status || ')'
      || coalesce(' · until ' || to_char(new.current_period_end at time zone 'Africa/Lagos', 'DD Mon YYYY'), ''),
    new.organization_id);
  return null;
end;
$$;
create trigger subscriptions_platform_event after update on public.subscriptions
  for each row execute function private.event_subscription_change();

create or replace function private.event_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  org_name text := (select o.name from public.organizations o where o.id = new.organization_id);
  plan_name text := (select p.name from public.plans p where p.id = new.plan_id);
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  if new.status = 'success' then
    perform private.emit_event('payments', 'payment.received', 'Payment received: ' || private.naira(new.amount_kobo) || ' from ' || org_name,
      plan_name || ' (' || new.billing_cycle || ')' || case when new.kind = 'renewal' then ' renewal' else '' end
        || case when new.setup_fee_kobo > 0 then ' incl. setup fee ' || private.naira(new.setup_fee_kobo) else '' end || ' · ref ' || new.reference,
      new.organization_id, null, new.amount_kobo);
  elsif new.status = 'failed' then
    perform private.emit_event('payments', 'payment.failed', 'Payment failed: ' || private.naira(new.amount_kobo) || ' from ' || org_name,
      plan_name || ' · ref ' || new.reference, new.organization_id, null, new.amount_kobo);
  end if;
  return null;
end;
$$;
create trigger payments_platform_event after insert or update of status on public.payments
  for each row execute function private.event_payment();

create or replace function private.event_card_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  org_name text := (select o.name from public.organizations o where o.id = new.organization_id);
begin
  if tg_op = 'INSERT' then
    perform private.emit_event('orders', 'card_order.placed',
      'Card order ' || new.order_number || ': ' || new.quantity || ' VitaCards for ' || org_name,
      private.naira(new.total_kobo) || ' by ' || replace(new.payment_method, '_', ' ') || ' · '
        || case when new.delivery_option = 'delivery' then 'deliver to ' || coalesce(new.delivery_address, '') else 'pickup' end
        || coalesce(' · ' || new.delivery_contact_name, '') || coalesce(' ' || new.delivery_contact_phone, ''),
      new.organization_id, null, new.total_kobo);
  elsif new.status is distinct from old.status and new.status in ('paid', 'cancelled', 'delivered') then
    perform private.emit_event(case when new.status = 'paid' then 'payments' else 'orders' end, 'card_order.' || new.status,
      'Card order ' || new.order_number || ' ' || case new.status when 'paid' then 'paid: ' || private.naira(new.total_kobo) when 'cancelled' then 'cancelled' else 'delivered' end
        || ' (' || org_name || ')',
      case when new.status = 'paid' then 'Ready to dispatch · ' || new.quantity || ' cards' else '' end,
      new.organization_id, null, case when new.status = 'paid' then new.total_kobo end);
  end if;
  return null;
end;
$$;
create trigger nfc_card_orders_platform_event after insert or update of status on public.nfc_card_orders
  for each row execute function private.event_card_order();

-- ============================================
-- SUPPORT RPCs
-- ============================================

-- p_attachments: [{ "name", "path", "size", "type" }] already uploaded to support-attachments.
create or replace function public.support_create_ticket(
  p_organization_id uuid,
  p_kind text,
  p_subject text,
  p_body text,
  p_category text default 'general',
  p_priority text default 'normal',
  p_attachments jsonb default '[]'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket public.support_tickets;
  me text := (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = auth.uid());
begin
  if not private.is_member(p_organization_id) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;
  insert into public.support_tickets (organization_id, number, kind, category, priority, subject, created_by, staff_unread)
  values (p_organization_id,
          'SUP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('private.support_ticket_serial')::text, 4, '0'),
          coalesce(p_kind, 'support'), coalesce(nullif(btrim(p_category), ''), 'general'),
          case when p_priority in ('low', 'normal', 'high', 'urgent') then p_priority else 'normal' end,
          btrim(p_subject), auth.uid(), true)
  returning * into ticket;
  insert into public.support_messages (ticket_id, organization_id, author_id, author_kind, body, attachments)
  values (ticket.id, p_organization_id, auth.uid(), 'customer', btrim(p_body), coalesce(p_attachments, '[]'));
  perform private.emit_event('support', 'support.' || ticket.kind,
    case ticket.kind when 'bug' then 'Bug report' when 'feedback' then 'Feedback' when 'feature' then 'Feature request'
                     when 'chat' then 'Live chat' else 'Support ticket' end
      || ' ' || ticket.number || ': ' || ticket.subject,
    'From ' || coalesce(me, 'a user') || ' · ' || ticket.priority || E' priority\n' || left(btrim(p_body), 500),
    p_organization_id, ticket.id);
  return ticket.id;
end;
$$;

create or replace function public.support_reply(p_ticket_id uuid, p_body text, p_internal boolean default false, p_attachments jsonb default '[]')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket public.support_tickets;
  staff boolean := private.is_platform_admin();
  customer_email text;
  me text := (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = auth.uid());
begin
  select * into ticket from public.support_tickets where id = p_ticket_id for update;
  if ticket.id is null or not private.can_see_ticket(ticket) then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Write a message' using errcode = '22023';
  end if;
  insert into public.support_messages (ticket_id, organization_id, author_id, author_kind, body, internal, attachments)
  values (ticket.id, ticket.organization_id, auth.uid(), case when staff then 'staff' else 'customer' end, btrim(p_body),
          staff and coalesce(p_internal, false), coalesce(p_attachments, '[]'));

  if staff and coalesce(p_internal, false) then
    update public.support_tickets set updated_at = now() where id = ticket.id;
    return;
  end if;

  if staff then
    update public.support_tickets
    set last_message_at = now(), customer_unread = true, staff_unread = false,
        first_response_at = coalesce(first_response_at, now()),
        status = case when status in ('open', 'resolved', 'closed') then 'pending' else status end,
        updated_at = now()
    where id = ticket.id;
    -- Tell the person who raised it.
    select p.email into customer_email from public.profiles p where p.id = ticket.created_by;
    if customer_email is not null then
      insert into public.notification_outbox (recipient, subject, body_text, body_html)
      values (customer_email,
              'Re: ' || ticket.subject || ' [' || ticket.number || ']',
              'VitaLink Support replied to ' || ticket.number || E':\n\n' || left(btrim(p_body), 2000) || E'\n\nReply from Help & Support in your VitaLink workspace.',
              '<p>VitaLink Support replied to <strong>' || private.escape_html(ticket.number) || '</strong>:</p><blockquote style="border-left:3px solid #c7d2fe;margin:0;padding-left:12px">'
                || replace(private.escape_html(left(btrim(p_body), 2000)), E'\n', '<br>') || '</blockquote><p style="color:#64748b">Reply from Help &amp; Support in your VitaLink workspace.</p>');
    end if;
  else
    update public.support_tickets
    set last_message_at = now(), staff_unread = true, customer_unread = false,
        status = case when status in ('pending', 'resolved', 'closed') then 'open' else status end,
        resolved_at = null, updated_at = now()
    where id = ticket.id;
    perform private.emit_event('support', 'support.reply', 'New reply on ' || ticket.number || ': ' || ticket.subject,
      'From ' || coalesce(me, 'a user') || E'\n' || left(btrim(p_body), 500), ticket.organization_id, ticket.id);
  end if;
end;
$$;

-- Staff: status / priority / assignee. Customers: close or reopen their own ticket.
create or replace function public.support_update_ticket(p_ticket_id uuid, p_status text default null, p_priority text default null, p_assigned_to text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket public.support_tickets;
  staff boolean := private.is_platform_admin();
begin
  select * into ticket from public.support_tickets where id = p_ticket_id for update;
  if ticket.id is null or not private.can_see_ticket(ticket) then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  if not staff and (p_priority is not null or p_assigned_to is not null or coalesce(p_status, 'closed') not in ('closed', 'open')) then
    raise exception 'Only VitaLink support can change that' using errcode = '42501';
  end if;
  update public.support_tickets
  set status = coalesce(p_status, status),
      priority = case when p_priority in ('low', 'normal', 'high', 'urgent') then p_priority else priority end,
      assigned_to = case when p_assigned_to is null then assigned_to when p_assigned_to = '' then null else lower(p_assigned_to) end,
      resolved_at = case when p_status in ('resolved', 'closed') then coalesce(resolved_at, now()) when p_status in ('open', 'pending') then null else resolved_at end,
      updated_at = now()
  where id = ticket.id;
  if p_status is not null and p_status is distinct from ticket.status then
    insert into public.support_messages (ticket_id, organization_id, author_id, author_kind, body)
    values (ticket.id, ticket.organization_id, auth.uid(), 'system',
            case p_status when 'resolved' then 'Marked resolved' when 'closed' then 'Closed' when 'open' then 'Reopened' else 'Waiting on customer' end
              || ' by ' || coalesce((select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = auth.uid()), 'someone'));
  end if;
end;
$$;

create or replace function public.support_mark_read(p_ticket_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket public.support_tickets;
begin
  select * into ticket from public.support_tickets where id = p_ticket_id;
  if ticket.id is null or not private.can_see_ticket(ticket) then
    return;
  end if;
  if private.is_platform_admin() and not private.is_member(ticket.organization_id) then
    update public.support_tickets set staff_unread = false where id = ticket.id and staff_unread;
  elsif ticket.created_by = auth.uid() or private.has_role(ticket.organization_id, private.admin_roles()) then
    update public.support_tickets set customer_unread = false where id = ticket.id and customer_unread;
    if private.is_platform_admin() then
      update public.support_tickets set staff_unread = false where id = ticket.id and staff_unread;
    end if;
  end if;
end;
$$;

-- ============================================
-- CONSOLE RPCs: notes, feed, prefs
-- ============================================

create or replace function public.console_add_note(p_organization_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  insert into public.crm_notes (organization_id, author_email, body)
  values (p_organization_id, (select lower(u.email) from auth.users u where u.id = auth.uid()), btrim(p_body));
end;
$$;

create or replace function public.console_my_prefs()
returns public.platform_admin_prefs
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := (select lower(u.email) from auth.users u where u.id = auth.uid());
  prefs public.platform_admin_prefs;
begin
  perform private.require_platform_admin();
  insert into public.platform_admin_prefs (email) values (me) on conflict (email) do nothing;
  select * into prefs from public.platform_admin_prefs where email = me;
  return prefs;
end;
$$;

create or replace function public.console_save_prefs(p_email_enabled boolean, p_categories text[], p_include_own boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := (select lower(u.email) from auth.users u where u.id = auth.uid());
begin
  perform private.require_platform_admin();
  insert into public.platform_admin_prefs (email, email_enabled, categories, include_own_actions)
  values (me, p_email_enabled,
          array(select c from unnest(coalesce(p_categories, '{}')) c where c in ('signups', 'subscriptions', 'payments', 'orders', 'support')),
          p_include_own)
  on conflict (email) do update
  set email_enabled = excluded.email_enabled, categories = excluded.categories,
      include_own_actions = excluded.include_own_actions, updated_at = now();
end;
$$;

create or replace function public.console_mark_feed_read()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := (select lower(u.email) from auth.users u where u.id = auth.uid());
begin
  perform private.require_platform_admin();
  insert into public.platform_admin_prefs (email, last_read_at) values (me, now())
  on conflict (email) do update set last_read_at = now();
end;
$$;

-- Email delivery health for the console banner.
create or replace function public.console_outbox_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return jsonb_build_object(
    'pending', (select count(*) from public.notification_outbox where status = 'pending'),
    'sent_24h', (select count(*) from public.notification_outbox where status = 'sent' and sent_at > now() - interval '1 day'),
    'failed_24h', (select count(*) from public.notification_outbox where status in ('failed', 'skipped') and created_at > now() - interval '1 day'),
    'last_error', (select last_error from public.notification_outbox where status in ('failed', 'skipped') order by created_at desc limit 1));
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.support_create_ticket(uuid, text, text, text, text, text, jsonb)',
    'public.support_reply(uuid, text, boolean, jsonb)',
    'public.support_update_ticket(uuid, text, text, text)',
    'public.support_mark_read(uuid)',
    'public.console_add_note(uuid, text)',
    'public.console_my_prefs()',
    'public.console_save_prefs(boolean, text[], boolean)',
    'public.console_mark_feed_read()',
    'public.console_outbox_status()'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
revoke execute on function private.emit_event(text, text, text, text, uuid, uuid, bigint), private.can_see_ticket(public.support_tickets) from public, anon;
grant execute on function private.can_see_ticket(public.support_tickets) to authenticated;
