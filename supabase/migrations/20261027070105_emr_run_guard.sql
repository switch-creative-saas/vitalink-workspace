-- One sync at a time per connection. A run the platform stopped mid-way (it never
-- reported back) is closed as failed after 10 minutes so the next one can start.
create or replace function public.emr_begin_run(p_connection uuid, p_trigger text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_conn public.emr_connections; v_run uuid;
begin
  v_conn := private.can_run_emr(p_connection);
  update public.emr_sync_runs
  set status = 'failed', error = 'Stopped before finishing; the next sync carries on from the last saved point.', finished_at = now()
  where connection_id = v_conn.id and status = 'running' and started_at < now() - interval '10 minutes';
  if p_trigger in ('manual', 'schedule') and exists (
    select 1 from public.emr_sync_runs where connection_id = v_conn.id and status = 'running' and trigger in ('manual', 'schedule')
  ) then
    raise exception 'A sync is already running for this EMR' using errcode = '55P03';
  end if;
  insert into public.emr_sync_runs (connection_id, organization_id, trigger)
  values (v_conn.id, v_conn.organization_id, p_trigger) returning id into v_run;
  update public.emr_connections set last_sync_at = now() where id = v_conn.id;
  return v_run;
end;
$$;
