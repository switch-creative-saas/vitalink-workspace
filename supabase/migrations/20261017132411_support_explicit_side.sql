-- A platform admin can also be a member of a workspace (and raise tickets
-- there), so the side a reply / update comes from is explicit: the console passes
-- p_as_staff => true; the workspace Help page never does.

drop function public.support_reply(uuid, text, boolean, jsonb);
drop function public.support_update_ticket(uuid, text, text, text);
drop function public.support_mark_read(uuid);

create function public.support_reply(p_ticket_id uuid, p_body text, p_internal boolean default false, p_attachments jsonb default '[]', p_as_staff boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket public.support_tickets;
  staff boolean := coalesce(p_as_staff, false) and private.is_platform_admin();
  customer_email text;
  me text := (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = auth.uid());
begin
  if coalesce(p_as_staff, false) and not staff then
    raise exception 'Only VitaLink support can reply as support' using errcode = '42501';
  end if;
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
        resolved_at = null,
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
create function public.support_update_ticket(p_ticket_id uuid, p_status text default null, p_priority text default null, p_assigned_to text default null, p_as_staff boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket public.support_tickets;
  staff boolean := coalesce(p_as_staff, false) and private.is_platform_admin();
begin
  select * into ticket from public.support_tickets where id = p_ticket_id for update;
  if ticket.id is null or not private.can_see_ticket(ticket) then
    raise exception 'Ticket not found' using errcode = 'P0002';
  end if;
  if p_status is not null and p_status not in ('open', 'pending', 'resolved', 'closed') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;
  if not staff and (p_priority is not null or p_assigned_to is not null or coalesce(p_status, 'closed') not in ('closed', 'open')) then
    raise exception 'Only VitaLink support can change that' using errcode = '42501';
  end if;
  update public.support_tickets
  set status = coalesce(p_status, status),
      priority = case when p_priority in ('low', 'normal', 'high', 'urgent') then p_priority else priority end,
      assigned_to = case when p_assigned_to is null then assigned_to when p_assigned_to = '' then null else lower(p_assigned_to) end,
      resolved_at = case when p_status in ('resolved', 'closed') then coalesce(resolved_at, now()) when p_status in ('open', 'pending') then null else resolved_at end,
      staff_unread = case when not staff and p_status = 'open' and ticket.status <> 'open' then true else staff_unread end,
      updated_at = now()
  where id = ticket.id;
  if p_status is not null and p_status is distinct from ticket.status then
    insert into public.support_messages (ticket_id, organization_id, author_id, author_kind, body)
    values (ticket.id, ticket.organization_id, auth.uid(), 'system',
            case p_status when 'resolved' then 'Marked resolved' when 'closed' then 'Closed' when 'open' then 'Reopened' else 'Waiting on customer' end
              || ' by ' || case when staff then 'VitaLink Support' else coalesce((select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = auth.uid()), 'the customer') end);
    if not staff and p_status = 'open' then
      perform private.emit_event('support', 'support.reopened', 'Ticket reopened: ' || ticket.number || ' ' || ticket.subject, '', ticket.organization_id, ticket.id);
    end if;
  end if;
end;
$$;

create function public.support_mark_read(p_ticket_id uuid, p_as_staff boolean default false)
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
  if coalesce(p_as_staff, false) then
    if private.is_platform_admin() then
      update public.support_tickets set staff_unread = false where id = ticket.id and staff_unread;
    end if;
  else
    update public.support_tickets set customer_unread = false where id = ticket.id and customer_unread;
  end if;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.support_reply(uuid, text, boolean, jsonb, boolean)',
    'public.support_update_ticket(uuid, text, text, text, boolean)',
    'public.support_mark_read(uuid, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
