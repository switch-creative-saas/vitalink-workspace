-- Console reads for the support inbox, notification feed and workspace CRM.
-- Platform admins cannot read other workspaces' organizations / profiles
-- directly, so these platform-admin-only functions join the names in.

-- p_view: 'open' (open + pending), 'unread', 'mine', 'resolved' (resolved + closed), 'all'.
create or replace function public.console_inbox(p_view text default 'open', p_search text default null, p_organization_id uuid default null)
returns table (
  id uuid, number text, kind text, category text, priority text, status text, subject text,
  organization_id uuid, organization_name text, requester_name text, requester_email text,
  assigned_to text, staff_unread boolean, last_message_at timestamptz, created_at timestamptz,
  first_response_at timestamptz, message_count bigint, last_message text, last_author_kind text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me text := (select lower(u.email) from auth.users u where u.id = auth.uid());
  term text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_platform_admin();
  return query
  select t.id, t.number, t.kind, t.category, t.priority, t.status, t.subject,
         t.organization_id, o.name, coalesce(nullif(p.full_name, ''), p.email, 'Deleted user'), p.email,
         t.assigned_to, t.staff_unread, t.last_message_at, t.created_at, t.first_response_at,
         (select count(*) from public.support_messages m where m.ticket_id = t.id and m.author_kind <> 'system' and not m.internal),
         lm.body, lm.author_kind
  from public.support_tickets t
  join public.organizations o on o.id = t.organization_id
  left join public.profiles p on p.id = t.created_by
  left join lateral (
    select m.body, m.author_kind from public.support_messages m
    where m.ticket_id = t.id and m.author_kind <> 'system'
    order by m.created_at desc limit 1) lm on true
  where (p_organization_id is null or t.organization_id = p_organization_id)
    and case coalesce(p_view, 'open')
          when 'open' then t.status in ('open', 'pending')
          when 'unread' then t.staff_unread
          when 'mine' then t.assigned_to = me and t.status in ('open', 'pending')
          when 'resolved' then t.status in ('resolved', 'closed')
          else true end
    and (term is null or t.subject ilike '%' || term || '%' or t.number ilike '%' || term || '%'
         or o.name ilike '%' || term || '%' or p.email ilike '%' || term || '%' or p.full_name ilike '%' || term || '%')
  order by (t.status in ('open', 'pending')) desc,
           case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end
             * case when t.status = 'open' then 1 else 0 end,
           t.last_message_at desc
  limit 300;
end;
$$;

create or replace function public.console_ticket(p_ticket_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t public.support_tickets;
begin
  perform private.require_platform_admin();
  select * into t from public.support_tickets where id = p_ticket_id;
  if t.id is null then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'ticket', to_jsonb(t),
    'organization', (select jsonb_build_object('id', o.id, 'name', o.name, 'type', o.organization_type, 'state', o.state,
                       'contact_email', o.contact_email, 'contact_phone', o.contact_phone,
                       'plan', (select coalesce(pl.name, s.plan_id) || ' · ' || s.status from public.subscriptions s left join public.plans pl on pl.id = s.plan_id where s.organization_id = o.id))
                     from public.organizations o where o.id = t.organization_id),
    'requester', (select jsonb_build_object('name', coalesce(nullif(p.full_name, ''), p.email), 'email', p.email,
                    'role', (select m.role from public.memberships m where m.user_id = p.id and m.organization_id = t.organization_id))
                  from public.profiles p where p.id = t.created_by),
    'messages', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', m.id, 'author_kind', m.author_kind, 'internal', m.internal, 'body', m.body,
                    'attachments', m.attachments, 'created_at', m.created_at,
                    'author', coalesce(nullif(p.full_name, ''), p.email, 'Deleted user'), 'author_email', p.email) order by m.created_at)
                  from public.support_messages m left join public.profiles p on p.id = m.author_id
                  where m.ticket_id = t.id), '[]'::jsonb),
    'other_tickets', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'number', x.number, 'subject', x.subject, 'status', x.status, 'created_at', x.created_at) order by x.created_at desc)
                  from (select * from public.support_tickets x where x.organization_id = t.organization_id and x.id <> t.id order by x.created_at desc limit 10) x), '[]'::jsonb));
end;
$$;

-- Notification feed with workspace names; p_before pages back (inclusive cursor, dedupe by id).
create or replace function public.console_feed(p_limit integer default 50, p_before timestamptz default null, p_category text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me text := (select lower(u.email) from auth.users u where u.id = auth.uid());
  last_read timestamptz;
begin
  perform private.require_platform_admin();
  select pr.last_read_at into last_read from public.platform_admin_prefs pr where pr.email = me;
  last_read := coalesce(last_read, '-infinity'::timestamptz);
  return jsonb_build_object(
    'unread', (select count(*) from public.platform_events e where e.created_at > last_read),
    'last_read_at', last_read,
    'events', coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc, x.id desc) from (
        select e.id, e.category, e.type, e.title, e.body, e.organization_id, o.name as organization_name,
               e.ticket_id, e.amount_kobo, e.actor_email, e.created_at
        from public.platform_events e
        left join public.organizations o on o.id = e.organization_id
        where (p_before is null or e.created_at <= p_before)
          and (p_category is null or e.category = p_category)
        order by e.created_at desc, e.id desc
        limit greatest(1, least(coalesce(p_limit, 50), 200))) x), '[]'::jsonb));
end;
$$;

-- CRM view of one workspace: notes, tickets and its event timeline.
create or replace function public.console_workspace_crm(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return jsonb_build_object(
    'notes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'author', n.author_email, 'body', n.body, 'created_at', n.created_at) order by n.created_at desc)
              from public.crm_notes n where n.organization_id = p_organization_id), '[]'::jsonb),
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'number', t.number, 'subject', t.subject, 'status', t.status,
                'kind', t.kind, 'priority', t.priority, 'last_message_at', t.last_message_at, 'staff_unread', t.staff_unread) order by t.last_message_at desc)
              from public.support_tickets t where t.organization_id = p_organization_id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
                select e.id, e.category, e.title, e.body, e.amount_kobo, e.created_at from public.platform_events e
                where e.organization_id = p_organization_id order by e.created_at desc limit 100) x), '[]'::jsonb));
end;
$$;

create or replace function public.console_delete_note(p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  delete from public.crm_notes where id = p_note_id;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.console_inbox(text, text, uuid)',
    'public.console_ticket(uuid)',
    'public.console_feed(integer, timestamptz, text)',
    'public.console_workspace_crm(uuid)',
    'public.console_delete_note(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
