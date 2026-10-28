-- Internal help desk: staff send requests to their own workspace admins (audience 'internal');
-- only workspace admins talk to VitaLink Support (audience 'vitalink'), and they can escalate a
-- staff request to VitaLink. Workspace admins answer as author_kind 'admin' and can leave
-- internal notes that only other workspace admins see.

alter table public.support_tickets
  add column if not exists audience text not null default 'vitalink' check (audience in ('vitalink', 'internal')),
  add column if not exists escalated_at timestamptz;
create index if not exists support_tickets_org_audience_idx on public.support_tickets (organization_id, audience, last_message_at desc);

alter table public.support_messages drop constraint if exists support_messages_author_kind_check;
alter table public.support_messages add constraint support_messages_author_kind_check
  check (author_kind in ('customer', 'staff', 'admin', 'system'));

create or replace function private.is_workspace_admin(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_role(org, private.admin_roles())
$$;

-- VitaLink only sees tickets addressed to it; staff see their own; workspace admins see all of theirs.
create or replace function private.can_see_ticket(t public.support_tickets)
returns boolean language sql stable security definer set search_path = '' as $$
  select (private.is_platform_admin() and t.audience = 'vitalink')
      or (private.is_member(t.organization_id)
          and (t.created_by = auth.uid() or private.is_workspace_admin(t.organization_id)))
$$;

drop policy if exists "see messages on visible tickets" on public.support_messages;
create policy "see messages on visible tickets" on public.support_messages for select using (
  exists (select 1 from public.support_tickets t where t.id = support_messages.ticket_id and private.can_see_ticket(t))
  and (not internal
       or (author_kind = 'staff' and private.is_platform_admin())
       or (author_kind = 'admin' and private.is_workspace_admin(organization_id)))
);

create or replace function private.notify_workspace_admins(p_org uuid, p_title text, p_body text, p_priority text default 'normal')
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  for v_user in select m.user_id from public.memberships m
                where m.organization_id = p_org and m.status = 'active' and m.role = any (private.admin_roles()) loop
    perform private.notify(v_user, p_org, 'support', p_title, p_body, '/help', p_priority);
  end loop;
end;
$$;

drop function if exists public.support_create_ticket(uuid, text, text, text, text, text, jsonb);
create or replace function public.support_create_ticket(p_organization_id uuid, p_kind text, p_subject text, p_body text,
  p_category text default 'general', p_priority text default 'normal', p_attachments jsonb default '[]', p_audience text default null)
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  ticket public.support_tickets;
  me text := (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = auth.uid());
  v_audience text;
begin
  if not private.is_member(p_organization_id) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;
  -- Only workspace admins reach VitaLink directly; everyone else goes to their admins.
  v_audience := case when private.is_workspace_admin(p_organization_id) and coalesce(p_audience, 'vitalink') = 'vitalink'
                     then 'vitalink' else 'internal' end;
  insert into public.support_tickets (organization_id, number, kind, category, priority, subject, created_by, staff_unread, audience)
  values (p_organization_id,
          case when v_audience = 'internal' then 'REQ-' else 'SUP-' end || to_char(now(), 'YYYY') || '-' || lpad(nextval('private.support_ticket_serial')::text, 4, '0'),
          coalesce(p_kind, 'support'), coalesce(nullif(btrim(p_category), ''), 'general'),
          case when p_priority in ('low', 'normal', 'high', 'urgent') then p_priority else 'normal' end,
          btrim(p_subject), auth.uid(), true, v_audience)
  returning * into ticket;
  insert into public.support_messages (ticket_id, organization_id, author_id, author_kind, body, attachments)
  values (ticket.id, p_organization_id, auth.uid(), 'customer', btrim(p_body), coalesce(p_attachments, '[]'));
  if v_audience = 'vitalink' then
    perform private.emit_event('support', 'support.' || ticket.kind,
      case ticket.kind when 'bug' then 'Bug report' when 'feedback' then 'Feedback' when 'feature' then 'Feature request'
                       when 'chat' then 'Live chat' else 'Support ticket' end
        || ' ' || ticket.number || ': ' || ticket.subject,
      'From ' || coalesce(me, 'a user') || ' · ' || ticket.priority || E' priority\n' || left(btrim(p_body), 500),
      p_organization_id, ticket.id);
  else
    perform private.notify_workspace_admins(p_organization_id, 'New help request · ' || ticket.number,
      coalesce(me, 'A colleague') || ': ' || ticket.subject, case when ticket.priority = 'urgent' then 'high' else 'normal' end);
  end if;
  return ticket.id;
end;
$function$;

drop function if exists public.support_reply(uuid, text, boolean, jsonb, boolean);
create or replace function public.support_reply(p_ticket_id uuid, p_body text, p_internal boolean default false,
  p_attachments jsonb default '[]', p_as_staff boolean default false, p_as_admin boolean default false)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  ticket public.support_tickets;
  staff boolean;
  admin boolean;
  customer_email text;
  me text := (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = auth.uid());
begin
  select * into ticket from public.support_tickets where id = p_ticket_id for update;
  if ticket.id is null or not private.can_see_ticket(ticket) then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  staff := coalesce(p_as_staff, false) and private.is_platform_admin() and ticket.audience = 'vitalink';
  admin := coalesce(p_as_admin, false) and ticket.audience = 'internal' and private.is_workspace_admin(ticket.organization_id);
  if coalesce(p_as_staff, false) and not staff then
    raise exception 'Only VitaLink support can reply as support' using errcode = '42501';
  end if;
  if coalesce(p_as_admin, false) and not admin then
    raise exception 'Only workspace admins can answer help requests' using errcode = '42501';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Write a message' using errcode = '22023';
  end if;
  insert into public.support_messages (ticket_id, organization_id, author_id, author_kind, body, internal, attachments)
  values (ticket.id, ticket.organization_id, auth.uid(),
          case when staff then 'staff' when admin then 'admin' else 'customer' end, btrim(p_body),
          (staff or admin) and coalesce(p_internal, false), coalesce(p_attachments, '[]'));

  if (staff or admin) and coalesce(p_internal, false) then
    update public.support_tickets set updated_at = now() where id = ticket.id;
    return;
  end if;

  if staff or admin then
    update public.support_tickets
    set last_message_at = now(), customer_unread = true, staff_unread = false,
        first_response_at = coalesce(first_response_at, now()),
        status = case when status in ('open', 'resolved', 'closed') then 'pending' else status end,
        resolved_at = null, updated_at = now()
    where id = ticket.id;
  end if;

  if staff then
    select p.email into customer_email from public.profiles p where p.id = ticket.created_by;
    if customer_email is not null then
      insert into public.notification_outbox (recipient, subject, body_text, body_html, payload)
      values (customer_email,
              'Re: ' || ticket.subject || ' [' || ticket.number || ']',
              'VitaLink Support replied to ' || ticket.number || E':\n\n' || left(btrim(p_body), 2000) || E'\n\nReply from Help & Support in your VitaLink workspace.',
              '<p>VitaLink Support replied to <strong>' || private.escape_html(ticket.number) || '</strong>:</p><blockquote style="border-left:3px solid #c7d2fe;margin:0;padding-left:12px">'
                || replace(private.escape_html(left(btrim(p_body), 2000)), E'\n', '<br>') || '</blockquote><p style="color:#64748b">Reply from Help &amp; Support in your VitaLink workspace.</p>',
              jsonb_build_object('kind', 'support_reply', 'ticket_id', ticket.id, 'number', ticket.number, 'subject', ticket.subject,
                                 'body', left(btrim(p_body), 4000), 'customer_name', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = ticket.created_by)));
    end if;
  elsif not admin then
    update public.support_tickets
    set last_message_at = now(), staff_unread = true, customer_unread = false,
        status = case when status in ('pending', 'resolved', 'closed') then 'open' else status end,
        resolved_at = null, updated_at = now()
    where id = ticket.id;
    if ticket.audience = 'vitalink' then
      perform private.emit_event('support', 'support.reply', 'New reply on ' || ticket.number || ': ' || ticket.subject,
        'From ' || coalesce(me, 'a user') || E'\n' || left(btrim(p_body), 500), ticket.organization_id, ticket.id);
    else
      perform private.notify_workspace_admins(ticket.organization_id, 'New reply · ' || ticket.number, coalesce(me, 'A colleague') || ': ' || ticket.subject);
    end if;
  end if;
end;
$function$;

drop function if exists public.support_update_ticket(uuid, text, text, text, boolean);
create or replace function public.support_update_ticket(p_ticket_id uuid, p_status text default null, p_priority text default null,
  p_assigned_to text default null, p_as_staff boolean default false, p_as_admin boolean default false)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  ticket public.support_tickets;
  staff boolean;
  admin boolean;
  actor text := (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = auth.uid());
begin
  select * into ticket from public.support_tickets where id = p_ticket_id for update;
  if ticket.id is null or not private.can_see_ticket(ticket) then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  staff := coalesce(p_as_staff, false) and private.is_platform_admin() and ticket.audience = 'vitalink';
  admin := coalesce(p_as_admin, false) and ticket.audience = 'internal' and private.is_workspace_admin(ticket.organization_id);
  if p_status is not null and p_status not in ('open', 'pending', 'resolved', 'closed') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  if not (staff or admin) and (p_priority is not null or p_assigned_to is not null or coalesce(p_status, 'closed') not in ('closed', 'open')) then
    raise exception 'Only the support team can change that' using errcode = '42501';
  end if;
  if admin and nullif(p_assigned_to, '') is not null and not exists (
    select 1 from public.memberships m join auth.users u on u.id = m.user_id
    where m.organization_id = ticket.organization_id and m.status = 'active' and m.role = any (private.admin_roles()) and lower(u.email) = lower(p_assigned_to)) then
    raise exception 'Assign help requests to a workspace admin' using errcode = '22023';
  end if;
  update public.support_tickets
  set status = coalesce(p_status, status),
      priority = case when p_priority in ('low', 'normal', 'high', 'urgent') then p_priority else priority end,
      assigned_to = case when p_assigned_to is null then assigned_to when p_assigned_to = '' then null else lower(p_assigned_to) end,
      resolved_at = case when p_status in ('resolved', 'closed') then coalesce(resolved_at, now()) when p_status in ('open', 'pending') then null else resolved_at end,
      staff_unread = case when not (staff or admin) and p_status = 'open' and ticket.status <> 'open' then true else staff_unread end,
      customer_unread = case when admin and p_status = 'resolved' and ticket.status <> 'resolved' then true else customer_unread end,
      updated_at = now()
  where id = ticket.id;
  if p_status is not null and p_status is distinct from ticket.status then
    insert into public.support_messages (ticket_id, organization_id, author_id, author_kind, body)
    values (ticket.id, ticket.organization_id, auth.uid(), 'system',
            case p_status when 'resolved' then 'Marked resolved' when 'closed' then 'Closed' when 'open' then 'Reopened' else 'Waiting on requester' end
              || ' by ' || case when staff then 'VitaLink Support' else coalesce(actor, 'a team member') end);
    if not (staff or admin) and p_status = 'open' then
      if ticket.audience = 'vitalink' then
        perform private.emit_event('support', 'support.reopened', 'Ticket reopened: ' || ticket.number || ' ' || ticket.subject, '', ticket.organization_id, ticket.id);
      else
        perform private.notify_workspace_admins(ticket.organization_id, 'Help request reopened · ' || ticket.number, ticket.subject);
      end if;
    end if;
    if admin and p_status = 'resolved' then
      perform private.notify(ticket.created_by, ticket.organization_id, 'support', 'Help request resolved · ' || ticket.number, ticket.subject, '/help');
    end if;
  end if;
end;
$function$;

drop function if exists public.support_mark_read(uuid, boolean);
create or replace function public.support_mark_read(p_ticket_id uuid, p_as_staff boolean default false)
returns void language plpgsql security definer set search_path = '' as $function$
declare ticket public.support_tickets;
begin
  select * into ticket from public.support_tickets where id = p_ticket_id;
  if ticket.id is null or not private.can_see_ticket(ticket) then return; end if;
  if coalesce(p_as_staff, false) then
    -- "Staff" is VitaLink for VitaLink tickets and the workspace admins for internal requests.
    if (ticket.audience = 'vitalink' and private.is_platform_admin())
       or (ticket.audience = 'internal' and private.is_workspace_admin(ticket.organization_id)) then
      update public.support_tickets set staff_unread = false where id = ticket.id and staff_unread;
    end if;
  else
    update public.support_tickets set customer_unread = false where id = ticket.id and customer_unread;
  end if;
end;
$function$;

-- A workspace admin hands a staff request to VitaLink Support. The requester keeps seeing replies.
create or replace function public.support_escalate(p_ticket_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  ticket public.support_tickets;
  me text := (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = auth.uid());
begin
  select * into ticket from public.support_tickets where id = p_ticket_id for update;
  if ticket.id is null or ticket.audience <> 'internal' or not private.is_workspace_admin(ticket.organization_id) then
    raise exception 'Only workspace admins can escalate their team''s requests' using errcode = '42501';
  end if;
  update public.support_tickets
  set audience = 'vitalink', escalated_at = now(), staff_unread = true, assigned_to = null,
      status = 'open', resolved_at = null, last_message_at = now(), updated_at = now()
  where id = ticket.id;
  insert into public.support_messages (ticket_id, organization_id, author_id, author_kind, body)
  values (ticket.id, ticket.organization_id, auth.uid(), 'system', 'Escalated to VitaLink Support by ' || coalesce(me, 'a workspace admin'));
  if nullif(btrim(coalesce(p_note, '')), '') is not null then
    insert into public.support_messages (ticket_id, organization_id, author_id, author_kind, body)
    values (ticket.id, ticket.organization_id, auth.uid(), 'customer', btrim(p_note));
  end if;
  perform private.emit_event('support', 'support.escalated', 'Escalated ' || ticket.number || ': ' || ticket.subject,
    'From ' || coalesce(me, 'a workspace admin') || ' · ' || ticket.priority || E' priority\n' || left(coalesce(btrim(p_note), ''), 500),
    ticket.organization_id, ticket.id);
  perform private.notify(ticket.created_by, ticket.organization_id, 'support', 'Sent to VitaLink Support · ' || ticket.number, ticket.subject, '/help');
end;
$function$;

-- Notify the requester when a workspace admin replies (VitaLink replies were already covered).
create or replace function private.notify_support_reply()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_ticket public.support_tickets;
begin
  if new.author_kind not in ('staff', 'admin') or new.internal then return null; end if;
  select * into v_ticket from public.support_tickets where id = new.ticket_id;
  perform private.notify(v_ticket.created_by, v_ticket.organization_id, 'support',
    case when new.author_kind = 'staff' then 'VitaLink Support replied · ' else 'Your admin replied · ' end || v_ticket.number, v_ticket.subject, '/help');
  return null;
end;
$function$;

-- The console works only on tickets addressed to VitaLink.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.console_inbox(text, text, uuid)'::regprocedure);
  d := replace(d, 'where (p_organization_id is null', 'where t.audience = ''vitalink'' and (p_organization_id is null');
  execute d;
  d := pg_get_functiondef('public.console_ticket(uuid)'::regprocedure);
  d := replace(d, 'select * into t from public.support_tickets where id = p_ticket_id;', 'select * into t from public.support_tickets where id = p_ticket_id and audience = ''vitalink'';');
  execute d;
  d := pg_get_functiondef('public.console_workspace_crm(uuid)'::regprocedure);
  d := replace(d, 'from public.support_tickets t where t.organization_id = p_organization_id)', 'from public.support_tickets t where t.organization_id = p_organization_id and t.audience = ''vitalink'')');
  execute d;
end $$;

grant execute on function public.support_create_ticket(uuid, text, text, text, text, text, jsonb, text) to authenticated;
grant execute on function public.support_reply(uuid, text, boolean, jsonb, boolean, boolean) to authenticated;
grant execute on function public.support_update_ticket(uuid, text, text, text, boolean, boolean) to authenticated;
grant execute on function public.support_mark_read(uuid, boolean) to authenticated;
grant execute on function public.support_escalate(uuid, text) to authenticated;
