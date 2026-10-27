-- Sentinel dashboard: one call returning everything the dashboard shows for
-- the caller's organisation over the last p_days days (7, 30, 90 or 365).

create or replace function public.sentinel_dashboard(p_sentinel_org uuid, p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days int := greatest(1, least(coalesce(p_days, 30), 365));
  v_from date := current_date - (v_days - 1);
  v_prev_from date := current_date - (2 * v_days - 1);
  v_bucket int := case when v_days <= 30 then 1 else 7 end;
  v_top text[];
  v_result jsonb;
begin
  if not private.is_sentinel_member(p_sentinel_org) then
    raise exception 'Not a member of this Sentinel organisation' using errcode = '42501';
  end if;

  -- The five diseases with most cases in the period drive the trend chart.
  select coalesce(array_agg(disease order by n desc, disease), '{}') into v_top
  from (
    select c.disease, count(*) n from public.sentinel_cases c
    where c.sentinel_org_id = p_sentinel_org and c.report_date >= v_from
    group by c.disease order by n desc, c.disease limit 5
  ) t;

  with
  cases as (
    select * from public.sentinel_cases c
    where c.sentinel_org_id = p_sentinel_org and c.report_date >= v_prev_from
  ),
  facilities as (
    select f.*,
      case
        when f.last_report_date >= current_date - 6 then 'active'
        when f.last_report_date >= current_date - 29 then 'delayed'
        else 'not_reporting'
      end as reporting
    from public.sentinel_linked_facilities f
    where f.sentinel_org_id = p_sentinel_org and f.is_active and f.consent_status = 'approved'
  ),
  active_outbreaks as (
    select * from public.sentinel_outbreaks o
    where o.sentinel_org_id = p_sentinel_org and o.status in ('active', 'monitoring')
  ),
  open_alerts as (
    select * from public.sentinel_alerts a
    where a.sentinel_org_id = p_sentinel_org and not a.acknowledged
  ),
  buckets as (
    select gs::date as day_start
    from generate_series(v_from::timestamp, current_date::timestamp, make_interval(days => v_bucket)) gs
  ),
  state_rows as (
    select s.state,
      count(c.id) filter (where c.report_date >= v_from) as cases,
      (select count(*) from active_outbreaks o where o.state = s.state) as outbreaks,
      (select count(*) from open_alerts a where a.state = s.state) as alerts
    from (
      select distinct state from cases where report_date >= v_from and state is not null
      union select state from active_outbreaks where state is not null
      union select state from open_alerts where state is not null
    ) s
    left join cases c on c.state = s.state
    group by s.state
  )
  select jsonb_build_object(
    'days', v_days,
    'stats', jsonb_build_object(
      'activeOutbreaks', (select count(*) from active_outbreaks where status = 'active'),
      'monitoringOutbreaks', (select count(*) from active_outbreaks where status = 'monitoring'),
      'newOutbreaks', (select count(*) from active_outbreaks where start_date >= v_from),
      'cases', (select count(*) from cases where report_date >= v_from),
      'previousCases', (select count(*) from cases where report_date < v_from),
      'confirmedCases', (select count(*) from cases where report_date >= v_from and case_status = 'confirmed'),
      'openAlerts', (select count(*) from open_alerts),
      'urgentAlerts', (select count(*) from open_alerts where severity in ('critical', 'high')),
      'facilities', (select count(*) from facilities),
      'facilitiesReporting', (select count(*) from facilities where reporting = 'active'),
      'pendingFacilities', (select count(*) from public.sentinel_linked_facilities f
        where f.sentinel_org_id = p_sentinel_org and f.consent_status = 'pending')
    ),
    'reporting', jsonb_build_object(
      'active', (select count(*) from facilities where reporting = 'active'),
      'delayed', (select count(*) from facilities where reporting = 'delayed'),
      'notReporting', (select count(*) from facilities where reporting = 'not_reporting')
    ),
    'trendDiseases', to_jsonb(v_top),
    'trend', (
      select coalesce(jsonb_agg(row_data order by day_start), '[]')
      from (
        select b.day_start,
          jsonb_build_object('date', b.day_start)
          || coalesce((
            select jsonb_object_agg(d, (
              select count(*) from cases c
              where c.disease = d and c.report_date >= b.day_start and c.report_date < b.day_start + v_bucket
            ))
            from unnest(v_top) d
          ), '{}') as row_data
        from buckets b
      ) t
    ),
    'outbreaks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'disease', o.disease, 'state', o.state, 'lga', o.lga, 'severity', o.severity, 'status', o.status,
        'casesConfirmed', o.cases_confirmed, 'casesSuspected', o.cases_suspected, 'deaths', o.deaths,
        'cfr', o.cfr, 'startDate', o.start_date
      ) order by array_position(array['critical', 'high', 'moderate', 'low'], o.severity), o.start_date desc), '[]')
      from (select * from active_outbreaks order by array_position(array['critical', 'high', 'moderate', 'low'], severity), start_date desc limit 3) o
    ),
    'alerts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'severity', a.severity, 'title', a.title, 'message', a.message, 'createdAt', a.created_at
      ) order by a.created_at desc), '[]')
      from (select * from open_alerts order by created_at desc limit 5) a
    ),
    'states', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'state', r.state, 'cases', r.cases, 'outbreaks', r.outbreaks, 'alerts', r.alerts,
        'risk', case when r.outbreaks > 1 or r.alerts >= 3 then 'critical'
                     when r.outbreaks = 1 or r.alerts = 2 then 'high'
                     when r.alerts = 1 then 'moderate' else 'low' end
      ) order by r.outbreaks desc, r.alerts desc, r.cases desc), '[]')
      from (select * from state_rows order by outbreaks desc, alerts desc, cases desc limit 20) r
    ),
    'topDiseases', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'disease', t.disease, 'cases', t.this_week, 'previous', t.last_week,
        'spark', (
          select jsonb_agg((select count(*) from cases c where c.disease = t.disease and c.report_date = current_date - g) order by g desc)
          from generate_series(6, 0, -1) g
        )
      ) order by t.this_week desc, t.disease), '[]')
      from (
        select c.disease,
          count(*) filter (where c.report_date >= current_date - 6) as this_week,
          count(*) filter (where c.report_date between current_date - 13 and current_date - 7) as last_week
        from public.sentinel_cases c
        where c.sentinel_org_id = p_sentinel_org and c.report_date >= current_date - 13
        group by c.disease
        having count(*) filter (where c.report_date >= current_date - 6) > 0
        order by this_week desc, c.disease limit 5
      ) t
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.sentinel_dashboard(uuid, int) from public, anon;
grant execute on function public.sentinel_dashboard(uuid, int) to authenticated;
