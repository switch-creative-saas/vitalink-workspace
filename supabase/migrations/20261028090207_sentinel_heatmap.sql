-- Sentinel geographic heatmap: case activity by state (and LGA within each state) for a period,
-- compared with the period before, plus the open outbreaks and alerts that drive risk.
create or replace function public.sentinel_heatmap(
  p_sentinel_org uuid,
  p_days integer default 30,
  p_disease text default null,
  p_category text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_from date := current_date - (v_days - 1);
  v_prev_from date := current_date - (2 * v_days - 1);
  v_result jsonb;
begin
  if not private.is_sentinel_member(p_sentinel_org) then
    raise exception 'Not a member of this Sentinel organisation' using errcode = '42501';
  end if;

  with scoped as (
    select c.*, (c.report_date >= v_from) as in_period
    from public.sentinel_cases c
    where c.sentinel_org_id = p_sentinel_org
      and c.report_date >= v_prev_from
      and c.state is not null and btrim(c.state) <> ''
      and (p_disease is null or c.disease_id = p_disease)
      and (p_category is null or c.disease_id in (select d.id from public.sentinel_diseases d where d.category = p_category))
  ),
  current_cases as (select * from scoped where in_period),
  outbreaks as (
    select o.* from public.sentinel_outbreaks o
    where o.sentinel_org_id = p_sentinel_org and o.status in ('active', 'monitoring')
      and (p_disease is null or o.disease_id = p_disease)
      and (p_category is null or o.disease_id in (select d.id from public.sentinel_diseases d where d.category = p_category))
  ),
  alerts as (
    select a.* from public.sentinel_alerts a
    where a.sentinel_org_id = p_sentinel_org and a.status <> 'resolved' and a.state is not null
      and (p_disease is null or a.disease = (select d.name from public.sentinel_diseases d where d.id = p_disease))
      and (p_category is null or a.disease in (select d.name from public.sentinel_diseases d where d.category = p_category))
  ),
  state_names as (
    select state from scoped union select state from outbreaks union select state from alerts
  ),
  states as (
    select
      s.state,
      (select count(*) from current_cases c where c.state = s.state) as cases,
      (select count(*) from scoped c where c.state = s.state and not c.in_period) as previous,
      (select count(*) from current_cases c where c.state = s.state and (c.lab_confirmed or c.case_status = 'confirmed')) as confirmed,
      (select count(*) from current_cases c where c.state = s.state and c.case_status = 'deceased') as deaths,
      (select count(*) from current_cases c where c.state = s.state and c.hospitalized) as hospitalized,
      (select count(*) from outbreaks o where o.state = s.state) as outbreaks,
      (select count(*) from alerts a where a.state = s.state) as alerts,
      (select c.disease from current_cases c where c.state = s.state group by c.disease order by count(*) desc, c.disease limit 1) as top_disease
    from state_names s
  )
  select jsonb_build_object(
    'from', v_from,
    'to', current_date,
    'days', v_days,
    'totals', jsonb_build_object(
      'cases', (select count(*) from current_cases),
      'previous', (select count(*) from scoped where not in_period),
      'confirmed', (select count(*) from current_cases where lab_confirmed or case_status = 'confirmed'),
      'deaths', (select count(*) from current_cases where case_status = 'deceased'),
      'states', (select count(*) from states where cases > 0),
      'lgas', (select count(distinct (state, lga)) from current_cases where lga is not null and btrim(lga) <> ''),
      'unlocated', (select count(*) from public.sentinel_cases c
                    where c.sentinel_org_id = p_sentinel_org and c.report_date >= v_from and (c.state is null or btrim(c.state) = '')
                      and (p_disease is null or c.disease_id = p_disease) and (p_category is null or c.disease_id in (select d.id from public.sentinel_diseases d where d.category = p_category)))
    ),
    'states', coalesce((
      select jsonb_agg(jsonb_build_object(
        'state', st.state, 'cases', st.cases, 'previous', st.previous, 'confirmed', st.confirmed, 'deaths', st.deaths,
        'hospitalized', st.hospitalized, 'outbreaks', st.outbreaks, 'alerts', st.alerts, 'topDisease', st.top_disease,
        -- Same rules as the dashboard, plus fast growth in cases.
        'risk', case
          when st.outbreaks > 1 or st.alerts >= 3 or (st.deaths > 0 and st.confirmed >= 5) then 'critical'
          when st.outbreaks = 1 or st.alerts = 2 or (st.cases >= 5 and st.cases >= 2 * greatest(st.previous, 1)) then 'high'
          when st.alerts = 1 or (st.cases > 0 and st.cases > st.previous) then 'moderate'
          else 'low' end,
        'lgas', coalesce((
          select jsonb_agg(jsonb_build_object('lga', l.lga, 'cases', l.cases, 'confirmed', l.confirmed, 'deaths', l.deaths, 'topDisease', l.top_disease)
                           order by l.cases desc, l.lga)
          from (
            select coalesce(nullif(btrim(c.lga), ''), 'Not recorded') as lga, count(*) as cases,
                   count(*) filter (where c.lab_confirmed or c.case_status = 'confirmed') as confirmed,
                   count(*) filter (where c.case_status = 'deceased') as deaths,
                   mode() within group (order by c.disease) as top_disease
            from current_cases c where c.state = st.state
            group by 1
          ) l
        ), '[]'::jsonb),
        'diseases', coalesce((
          select jsonb_agg(jsonb_build_object('disease', d.disease, 'cases', d.cases) order by d.cases desc, d.disease)
          from (select c.disease, count(*) as cases from current_cases c where c.state = st.state group by c.disease) d
        ), '[]'::jsonb)
      ) order by st.cases desc, st.outbreaks desc, st.alerts desc, st.state)
      from states st
    ), '[]'::jsonb),
    'outbreaks', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'disease', o.disease, 'state', o.state, 'lga', o.lga, 'severity', o.severity,
                                          'status', o.status, 'confirmed', o.cases_confirmed, 'suspected', o.cases_suspected, 'deaths', o.deaths)
                       order by array_position(array['critical', 'high', 'moderate', 'low'], o.severity), o.start_date desc)
      from outbreaks o
    ), '[]'::jsonb),
    'diseases', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.disease_id, 'disease', d.disease, 'cases', d.cases) order by d.cases desc)
      from (select disease_id, disease, count(*) as cases from current_cases group by disease_id, disease) d
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.sentinel_heatmap(uuid, integer, text, text) from public, anon;
grant execute on function public.sentinel_heatmap(uuid, integer, text, text) to authenticated;
