-- Sentinel surveillance report for any period: the figures behind the weekly epidemiological
-- report, disease trends, NTD reports and custom reports. Optionally limited to one disease
-- category (infectious / ntd / ncd) or one disease. Compares with the period just before.

create or replace function public.sentinel_report(
  p_sentinel_org uuid, p_from date, p_to date, p_category text default null, p_disease text default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_days int := p_to - p_from + 1;
  v_prev_from date := p_from - (p_to - p_from + 1);
  v_result jsonb;
begin
  if not private.is_sentinel_member(p_sentinel_org) then
    raise exception 'Not a member of this Sentinel organisation' using errcode = '42501';
  end if;
  if p_to < p_from or v_days > 731 then raise exception 'Choose a period of up to two years' using errcode = '22023'; end if;

  with
  scope as (
    select c.*, d.category, d.notifiable
    from public.sentinel_cases c join public.sentinel_diseases d on d.id = c.disease_id
    where c.sentinel_org_id = p_sentinel_org and c.report_date between v_prev_from and p_to
      and (p_category is null or d.category = p_category) and (p_disease is null or c.disease_id = p_disease)
  ),
  cur as (select * from scope where report_date >= p_from),
  prev as (select * from scope where report_date < p_from),
  ytd as (
    select c.disease_id, count(*) cases, count(*) filter (where c.case_status = 'deceased') deaths,
           count(*) filter (where c.lab_confirmed or c.case_status = 'confirmed') confirmed
    from public.sentinel_cases c join public.sentinel_diseases d on d.id = c.disease_id
    where c.sentinel_org_id = p_sentinel_org and c.report_date between date_trunc('year', p_to)::date and p_to
      and (p_category is null or d.category = p_category) and (p_disease is null or c.disease_id = p_disease)
    group by c.disease_id
  ),
  facilities as (
    select f.id from public.sentinel_linked_facilities f
    where f.sentinel_org_id = p_sentinel_org and f.consent_status = 'approved' and f.linked_at::date <= p_to
      and (f.is_active or f.updated_at::date >= p_from)
  ),
  reported as (
    select distinct facility_id from public.sentinel_cases where sentinel_org_id = p_sentinel_org and report_date between p_from and p_to and facility_id is not null
    union
    select distinct facility_id from public.sentinel_syndromic_counts where sentinel_org_id = p_sentinel_org and day between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'days', v_days, 'previousFrom', v_prev_from,
    'organization', (select name from public.sentinel_organizations where id = p_sentinel_org),
    'totals', jsonb_build_object(
      'cases', (select count(*) from cur),
      'previousCases', (select count(*) from prev),
      'suspected', (select count(*) from cur where case_status in ('suspected', 'probable') and not lab_confirmed),
      'confirmed', (select count(*) from cur where lab_confirmed or case_status = 'confirmed'),
      'deaths', (select count(*) from cur where case_status = 'deceased'),
      'previousDeaths', (select count(*) from prev where case_status = 'deceased'),
      'hospitalized', (select count(*) from cur where hospitalized),
      'states', (select count(distinct state) from cur),
      'diseases', (select count(distinct disease_id) from cur)
    ),
    'byDisease', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'diseaseId', d.id, 'disease', d.name, 'category', d.category, 'notifiable', d.notifiable,
        'suspected', coalesce(c.suspected, 0), 'confirmed', coalesce(c.confirmed, 0), 'deaths', coalesce(c.deaths, 0),
        'cases', coalesce(c.cases, 0), 'previousCases', coalesce(p.cases, 0),
        'cfr', case when coalesce(c.confirmed, 0) > 0 then round(100.0 * c.deaths / c.confirmed, 1) end,
        'states', coalesce(c.states, 0),
        'ytdCases', coalesce(y.cases, 0), 'ytdConfirmed', coalesce(y.confirmed, 0), 'ytdDeaths', coalesce(y.deaths, 0)
      ) order by coalesce(c.cases, 0) desc, d.name), '[]')
      from public.sentinel_diseases d
      left join (select disease_id, count(*) cases, count(*) filter (where case_status in ('suspected', 'probable') and not lab_confirmed) suspected,
                        count(*) filter (where lab_confirmed or case_status = 'confirmed') confirmed, count(*) filter (where case_status = 'deceased') deaths,
                        count(distinct state) states
                 from cur group by disease_id) c on c.disease_id = d.id
      left join (select disease_id, count(*) cases from prev group by disease_id) p on p.disease_id = d.id
      left join ytd y on y.disease_id = d.id
      where coalesce(c.cases, 0) + coalesce(p.cases, 0) + coalesce(y.cases, 0) > 0
    ),
    'byState', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'state', s.state, 'cases', s.cases, 'confirmed', s.confirmed, 'deaths', s.deaths, 'lgas', s.lgas,
        'topDisease', s.top_disease,
        'openOutbreaks', (select count(*) from public.sentinel_outbreaks o where o.sentinel_org_id = p_sentinel_org and lower(o.state) = lower(s.state)
                          and o.status in ('active', 'monitoring') and (p_disease is null or o.disease_id = p_disease))
      ) order by s.cases desc), '[]')
      from (
        select state, count(*) cases, count(*) filter (where lab_confirmed or case_status = 'confirmed') confirmed,
               count(*) filter (where case_status = 'deceased') deaths, count(distinct lga) lgas,
               mode() within group (order by disease) top_disease
        from cur group by state
      ) s
    ),
    'byAgeSex', (
      select coalesce(jsonb_agg(jsonb_build_object('ageGroup', a.age_group, 'male', a.male, 'female', a.female, 'unknown', a.unknown)
                                order by array_position(array['0-5', '6-14', '15-29', '30-49', '50+', 'unknown'], a.age_group)), '[]')
      from (select age_group, count(*) filter (where sex = 'male') male, count(*) filter (where sex = 'female') female,
                   count(*) filter (where sex = 'unknown') unknown from cur group by age_group) a
    ),
    'bySource', (
      select coalesce(jsonb_object_agg(source_type, n), '{}') from (select source_type, count(*) n from cur group by source_type) s
    ),
    'weekly', (
      select coalesce(jsonb_agg(w order by w.week_start), '[]') from (
        select date_trunc('week', report_date)::date as week_start, to_char(report_date, 'IYYY-"W"IW') as epi_week,
               count(*) cases, count(*) filter (where lab_confirmed or case_status = 'confirmed') confirmed,
               count(*) filter (where case_status = 'deceased') deaths
        from cur group by 1, 2
      ) w
    ),
    'weeklyByDisease', (
      select coalesce(jsonb_agg(jsonb_build_object('weekStart', week_start, 'disease', disease, 'cases', n) order by week_start), '[]')
      from (select date_trunc('week', report_date)::date week_start, disease, count(*) n from cur
            where disease_id in (select disease_id from cur group by disease_id order by count(*) desc limit 6)
            group by 1, 2) x
    ),
    'outbreaks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', o.id, 'disease', o.disease, 'state', o.state, 'lga', o.lga, 'severity', o.severity, 'status', o.status,
        'startDate', o.start_date, 'endDate', o.end_date, 'confirmed', o.cases_confirmed, 'suspected', o.cases_suspected,
        'deaths', o.deaths, 'cfr', o.cfr, 'responseTeamDeployed', o.response_team_deployed,
        'newCases', (select count(*) from cur where cur.linked_outbreak_id = o.id),
        'latestUpdate', (select e.detail ->> 'text' from public.sentinel_outbreak_events e where e.outbreak_id = o.id and e.kind = 'update'
                         order by e.created_at desc limit 1)
      ) order by (o.status = 'active') desc, o.start_date desc), '[]')
      from public.sentinel_outbreaks o
      where o.sentinel_org_id = p_sentinel_org and o.start_date <= p_to and (o.end_date is null or o.end_date >= p_from)
        and (p_disease is null or o.disease_id = p_disease)
        and (p_category is null or o.disease_id in (select id from public.sentinel_diseases where category = p_category))
    ),
    'alerts', (
      select jsonb_build_object(
        'total', count(*), 'critical', count(*) filter (where severity = 'critical'), 'high', count(*) filter (where severity = 'high'),
        'open', count(*) filter (where status = 'open'),
        'byType', coalesce((select jsonb_object_agg(type, n) from (select type, count(*) n from public.sentinel_alerts
                    where sentinel_org_id = p_sentinel_org and created_at::date between p_from and p_to group by type) t), '{}'))
      from public.sentinel_alerts where sentinel_org_id = p_sentinel_org and created_at::date between p_from and p_to
    ),
    'reporting', jsonb_build_object(
      'expected', (select count(*) from facilities),
      'reported', (select count(*) from facilities f where f.id in (select facility_id from reported))
    )
  ) into v_result;
  return v_result;
end;
$$;

revoke execute on function public.sentinel_report(uuid, date, date, text, text) from public, anon;
grant execute on function public.sentinel_report(uuid, date, date, text, text) to authenticated;
