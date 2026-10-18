-- The page banner lists every active signal nationally, not only those for the facility's state.
create or replace function public.dx_active_outbreaks(p_organization_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_member(p_organization_id) then (
    select coalesce(jsonb_agg(x.j order by x.rank, x.since desc), '[]') from (
      select case s.level when 'high' then 0 when 'active' then 1 else 2 end as rank, s.starts_on as since,
        jsonb_build_object('id', s.id, 'conditionId', s.condition_id, 'condition', c.name, 'state', s.state, 'level', s.level,
          'source', s.source, 'title', s.title, 'url', s.source_url, 'note', s.note, 'since', s.starts_on, 'until', s.ends_on) as j
      from public.dx_outbreak_signals s join public.dx_conditions c on c.id = s.condition_id
      where s.starts_on <= current_date and (s.ends_on is null or s.ends_on >= current_date)
      union all
      select case when o.status = 'monitoring' then 2 when o.severity in ('high', 'critical') then 0 else 1 end, o.start_date,
        jsonb_build_object('id', o.id, 'conditionId', null, 'condition', o.disease, 'state', o.state,
          'level', case when o.status = 'monitoring' then 'watch' when o.severity in ('high', 'critical') then 'high' else 'active' end,
          'source', 'sentinel', 'title', o.disease || coalesce(' in ' || o.state, ''), 'url', null, 'note', coalesce(o.intervention_notes, ''),
          'since', o.start_date, 'until', o.end_date)
      from public.sentinel_outbreaks o
      where o.status in ('active', 'monitoring') and (o.end_date is null or o.end_date >= current_date)
    ) x
  ) end
$$;
