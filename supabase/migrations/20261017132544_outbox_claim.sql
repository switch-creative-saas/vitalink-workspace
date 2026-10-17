-- console-notify claims a batch of pending emails before sending, so the insert
-- kick and the pg_cron retry never send the same email twice. A claim expires
-- after 5 minutes (e.g. the function crashed mid-batch).

alter table public.notification_outbox add column claimed_at timestamptz;

create or replace function public.claim_outbox(p_limit integer default 25)
returns setof public.notification_outbox
language sql
security definer
set search_path = ''
as $$
  update public.notification_outbox o
  set claimed_at = now(), attempts = o.attempts + 1
  where o.id in (
    select id from public.notification_outbox
    where status = 'pending' and (claimed_at is null or claimed_at < now() - interval '5 minutes')
    order by created_at
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    for update skip locked)
  returning o.*
$$;
revoke execute on function public.claim_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_outbox(integer) to service_role;
