-- A first sync that stopped part-way (cursor still has a "next" page) is resumed by the
-- next scheduled check even when automatic syncing is off or its interval hasn't passed.
create or replace function public.emr_due_connections()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select id from public.emr_connections
  where status <> 'paused' and method in ('fhir', 'openmrs', 'lamisplus')
    and not exists (select 1 from public.emr_sync_runs r where r.connection_id = emr_connections.id and r.status = 'running'
                    and r.started_at > now() - interval '10 minutes')
    and (
      (cursor ? 'next' and (last_sync_at is null or last_sync_at < now() - interval '2 minutes'))
      or (auto_sync and (last_sync_at is null or last_sync_at < now() - make_interval(mins => sync_every_minutes)))
    )
  order by last_sync_at nulls first
  limit 10
$$;
