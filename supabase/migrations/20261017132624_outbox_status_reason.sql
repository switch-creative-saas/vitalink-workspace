-- The console banner also shows why queued emails are waiting (e.g. email not configured).
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
    'last_sent_at', (select max(sent_at) from public.notification_outbox where status = 'sent'),
    'last_error', (select last_error from public.notification_outbox where last_error is not null and status <> 'sent' order by created_at desc limit 1));
end;
$$;
