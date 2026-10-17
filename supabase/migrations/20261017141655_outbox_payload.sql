-- Structured data for the branded email layout. Alerts are rendered from their
-- platform_events row (event_id); support replies carry the ticket details here.
alter table public.notification_outbox add column payload jsonb;

do $$
declare
  def text := pg_get_functiondef('public.support_reply(uuid, text, boolean, jsonb, boolean)'::regprocedure);
  old_insert text := 'insert into public.notification_outbox (recipient, subject, body_text, body_html)';
  new_insert text := 'insert into public.notification_outbox (recipient, subject, body_text, body_html, payload)';
  old_tail text := $q$'</blockquote><p style="color:#64748b">Reply from Help &amp; Support in your VitaLink workspace.</p>');$q$;
  new_tail text := $q$'</blockquote><p style="color:#64748b">Reply from Help &amp; Support in your VitaLink workspace.</p>',
              jsonb_build_object('kind', 'support_reply', 'ticket_id', ticket.id, 'number', ticket.number, 'subject', ticket.subject,
                                 'body', left(btrim(p_body), 4000), 'customer_name', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = ticket.created_by)));$q$;
begin
  if position(old_insert in def) = 0 or position(old_tail in def) = 0 then
    raise exception 'support_reply body changed; patch not applied';
  end if;
  execute replace(replace(def, old_insert, new_insert), old_tail, new_tail);
end;
$$;
