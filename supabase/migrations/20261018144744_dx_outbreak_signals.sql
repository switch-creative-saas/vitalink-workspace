-- Outbreak signals for VitaMind Dx: when a condition is circulating, the engine
-- raises its likelihood for patients in the affected state (or nationally).
--
-- Sources:
--   * who      - WHO Disease Outbreak News for Nigeria, synced daily by the
--                dx-outbreaks-sync edge function
--   * ncdc     - NCDC situation reports (published as PDFs, so a VitaLink
--                platform admin records them in the Console)
--   * manual   - other confirmed alerts recorded by a platform admin
--   * sentinel - active outbreaks declared in VitaLink Sentinel (read live)
--
-- Strength (odds multiplier): in the patient's state watch 1.5 / active 3 / high 6;
-- national or unknown state watch 1.2 / active 1.5 / high 2.

create table public.dx_outbreak_signals (
  id uuid primary key default gen_random_uuid(),
  condition_id text not null references public.dx_conditions(id) on delete cascade,
  state text,
  level text not null check (level in ('watch', 'active', 'high')),
  source text not null check (source in ('ncdc', 'who', 'manual')),
  title text not null,
  source_url text,
  note text not null default '',
  starts_on date not null default current_date,
  ends_on date,
  external_id text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (source, external_id, condition_id)
);
create index dx_outbreak_signals_active_idx on public.dx_outbreak_signals (condition_id, ends_on);

alter table public.dx_outbreak_signals enable row level security;
create policy "signed-in users read outbreak signals" on public.dx_outbreak_signals for select to authenticated using (true);
grant select on public.dx_outbreak_signals to authenticated;

create or replace function private.dx_norm_state(p text)
returns text language sql immutable set search_path = '' as $$
  select nullif(lower(btrim(regexp_replace(coalesce(p, ''), '\s+state$', '', 'i'))), '')
$$;

create or replace function private.dx_outbreak_factors(p_state text)
returns table (condition_id text, factor numeric, signals jsonb)
language sql stable security definer set search_path = '' as $$
  with st as (select private.dx_norm_state(p_state) as s),
  recorded as (
    select s.condition_id, s.level, s.state, s.source, s.title, s.source_url, s.starts_on
    from public.dx_outbreak_signals s
    where s.starts_on <= current_date and (s.ends_on is null or s.ends_on >= current_date)
  ),
  sentinel as (
    select c.id, case when o.status = 'monitoring' then 'watch' when o.severity in ('high', 'critical') then 'high' else 'active' end,
      o.state, 'sentinel', o.disease || coalesce(' in ' || o.state, ''), null::text, o.start_date
    from public.sentinel_outbreaks o
    join public.dx_conditions c
      on lower(o.disease) like '%' || lower(c.name) || '%'
      or exists (select 1 from unnest(c.aliases) a where length(a) > 3 and lower(o.disease) ~ ('\m' || lower(a) || '\M'))
    where o.status in ('active', 'monitoring') and (o.end_date is null or o.end_date >= current_date)
  ),
  all_signals as (select * from recorded union all select * from sentinel),
  scored as (
    select a.*,
      case
        when a.state is not null and (select s from st) is not null and private.dx_norm_state(a.state) = (select s from st)
          then case a.level when 'high' then 6.0 when 'active' then 3.0 else 1.5 end
        when a.state is null or (select s from st) is null
          then case a.level when 'high' then 2.0 when 'active' then 1.5 else 1.2 end
      end as f
    from all_signals a
  )
  select condition_id, max(f),
    jsonb_agg(jsonb_build_object('level', level, 'state', state, 'source', source, 'title', title, 'url', source_url, 'since', starts_on) order by f desc)
  from scored where f is not null group by condition_id
$$;
revoke all on function private.dx_outbreak_factors(text) from public, anon, authenticated;

-- What's circulating for a workspace (page banner).
create or replace function public.dx_active_outbreaks(p_organization_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_member(p_organization_id) then (
    select coalesce(jsonb_agg(jsonb_build_object('conditionId', ob.condition_id, 'condition', c.name, 'factor', ob.factor, 'signals', ob.signals)
      order by ob.factor desc), '[]')
    from private.dx_outbreak_factors((select state from public.organizations where id = p_organization_id)) ob
    join public.dx_conditions c on c.id = ob.condition_id
  ) end
$$;

-- Console: platform admins record NCDC / manual signals and end them.
create or replace function public.dx_outbreak_save(
  p_id uuid, p_condition_id text, p_state text, p_level text, p_source text,
  p_title text, p_source_url text, p_note text, p_starts_on date, p_ends_on date)
returns public.dx_outbreak_signals
language plpgsql security definer set search_path = '' as $$
declare v_row public.dx_outbreak_signals;
begin
  perform private.require_platform_admin();
  if p_source not in ('ncdc', 'manual') then raise exception 'Source must be NCDC or manual' using errcode = '22023'; end if;
  if p_level not in ('watch', 'active', 'high') then raise exception 'Level must be watch, active or high' using errcode = '22023'; end if;
  if not exists (select 1 from public.dx_conditions where id = p_condition_id) then raise exception 'Unknown condition' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_title, ''))) < 3 then raise exception 'Add a title' using errcode = '22023'; end if;
  if p_ends_on is not null and p_ends_on < coalesce(p_starts_on, current_date) then raise exception 'End date is before the start date' using errcode = '22023'; end if;

  if p_id is null then
    insert into public.dx_outbreak_signals (condition_id, state, level, source, title, source_url, note, starts_on, ends_on)
    values (p_condition_id, nullif(btrim(p_state), ''), p_level, p_source, btrim(p_title), nullif(btrim(p_source_url), ''),
      coalesce(btrim(p_note), ''), coalesce(p_starts_on, current_date), p_ends_on)
    returning * into v_row;
  else
    update public.dx_outbreak_signals set condition_id = p_condition_id, state = nullif(btrim(p_state), ''), level = p_level, source = p_source,
      title = btrim(p_title), source_url = nullif(btrim(p_source_url), ''), note = coalesce(btrim(p_note), ''),
      starts_on = coalesce(p_starts_on, starts_on), ends_on = p_ends_on
    where id = p_id and source in ('ncdc', 'manual') returning * into v_row;
    if v_row.id is null then raise exception 'Signal not found' using errcode = 'P0002'; end if;
  end if;
  perform private.console_log('outbreak_signal_saved', null, jsonb_build_object('condition', p_condition_id, 'state', p_state, 'level', p_level, 'source', p_source));
  return v_row;
end;
$$;

create or replace function public.dx_outbreak_end(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_platform_admin();
  update public.dx_outbreak_signals set ends_on = current_date - 1 where id = p_id;
  perform private.console_log('outbreak_signal_ended', null, jsonb_build_object('id', p_id));
end;
$$;

revoke all on function public.dx_active_outbreaks(uuid) from public, anon;
revoke all on function public.dx_outbreak_save(uuid, text, text, text, text, text, text, text, date, date) from public, anon;
revoke all on function public.dx_outbreak_end(uuid) from public, anon;
grant execute on function public.dx_active_outbreaks(uuid) to authenticated;
grant execute on function public.dx_outbreak_save(uuid, text, text, text, text, text, text, text, date, date) to authenticated;
grant execute on function public.dx_outbreak_end(uuid) to authenticated;

-- dx_analyze now applies outbreak signals and reports them.
create or replace function public.dx_analyze(
  p_organization_id uuid, p_patient_id uuid, p_age integer, p_sex text,
  p_present text[], p_absent text[], p_text text, p_save boolean default true)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_age integer := p_age;
  v_sex text := lower(coalesce(p_sex, ''));
  v_present text[] := '{}';
  v_absent text[] := '{}';
  v_auto jsonb := '[]';
  v_conditions jsonb;
  v_questions jsonb;
  v_flags jsonb;
  v_risk text;
  v_tests text[];
  v_session uuid;
  v_result jsonb;
  v_learned integer;
  v_state text;
  v_outbreaks jsonb := '[]';
begin
  if not private.has_role(p_organization_id, private.clinical_read_roles()) then
    raise exception 'Only clinical staff can run the diagnosis engine' using errcode = '42501';
  end if;
  if p_patient_id is not null then
    if not exists (select 1 from public.patients where id = p_patient_id and organization_id = p_organization_id) then
      raise exception 'Patient not found in this workspace' using errcode = 'P0002';
    end if;
    select coalesce(v_age, extract(year from age(date_of_birth))::int), coalesce(nullif(v_sex, ''), lower(coalesce(gender, '')))
      into v_age, v_sex from public.patients where id = p_patient_id;
    select nullif(btrim(state), '') into v_state from public.patients where id = p_patient_id;
  end if;
  -- Where the patient is (else the facility's state) decides which outbreak signals apply.
  if v_state is null then
    select nullif(btrim(state), '') into v_state from public.organizations where id = p_organization_id;
  end if;

  -- Findings: what the clinician ticked wins over text, which wins over the record.
  with explicit as (
    select unnest(coalesce(p_present, '{}')) as f, true as present, 'clinician' as source
    union all select unnest(coalesce(p_absent, '{}')), false, 'clinician'
  ),
  from_text as (select finding_id as f, present, 'text' as source from private.dx_extract(p_text)),
  from_record as (select finding_id as f, present, source from private.dx_patient_findings(p_patient_id) where p_patient_id is not null),
  merged as (
    select distinct on (f) f, present, source from (
      select *, 1 as rank from explicit
      union all select *, 2 from from_text
      union all select *, 3 from from_record
    ) x
    where exists (select 1 from public.dx_findings d where d.id = x.f)
    order by f, rank
  )
  select coalesce(array_agg(f) filter (where present), '{}'), coalesce(array_agg(f) filter (where not present), '{}'),
         coalesce(jsonb_agg(jsonb_build_object('id', f, 'present', present, 'source', source)) filter (where source <> 'clinician'), '[]')
    into v_present, v_absent, v_auto from merged;

  if cardinality(v_present) = 0 then
    raise exception 'Add at least one symptom or finding that is present' using errcode = '22023';
  end if;

  with links as (select * from private.dx_learned_links()),
  case_counts as (
    select condition_id, count(*) filter (where organization_id = p_organization_id) as org_n, count(*) as all_n
    from public.dx_cases group by condition_id
  ),
  org_total as (select count(*)::numeric as n from public.dx_cases where organization_id = p_organization_id),
  eligible as (
    select c.*,
      -- local prevalence: seed prior blended with this workspace's confirmed mix (seed = 100 cases),
      -- then raised by any outbreak signal for the condition (odds x factor)
      ((c.prior * 100 + coalesce(cc.org_n, 0)) / (100 + (select n from org_total))) * coalesce(ob.factor, 1)
        / (1 - ((c.prior * 100 + coalesce(cc.org_n, 0)) / (100 + (select n from org_total)))
           + ((c.prior * 100 + coalesce(cc.org_n, 0)) / (100 + (select n from org_total))) * coalesce(ob.factor, 1)) as eff_prior,
      coalesce(cc.all_n, 0) as learned_cases,
      coalesce(ob.factor, 1) as outbreak_factor
    from public.dx_conditions c left join case_counts cc on cc.condition_id = c.id
    left join private.dx_outbreak_factors(v_state) ob on ob.condition_id = c.id
    where (c.sex = 'any' or v_sex = '' or c.sex = v_sex)
      and (v_age is null or ((c.age_min is null or v_age >= c.age_min) and (c.age_max is null or v_age <= c.age_max)))
  ),
  evidence as (
    select e.id as condition_id, f.id as finding_id, f.label, true as present,
      ln(least(50, greatest(0.05, coalesce(l.sensitivity, f.base_rate) / f.base_rate))) as w
    from eligible e cross join public.dx_findings f
    left join links l on l.condition_id = e.id and l.finding_id = f.id
    where f.id = any(v_present)
    union all
    select e.id, f.id, f.label, false,
      ln(least(20, greatest(0.05, (1 - coalesce(l.sensitivity, f.base_rate)) / (1 - f.base_rate))))
    from eligible e cross join public.dx_findings f
    left join links l on l.condition_id = e.id and l.finding_id = f.id
    where f.id = any(v_absent)
  ),
  scored as (
    select e.id, e.icd10, e.name, e.category, e.description, e.urgency, e.recommended_tests, e.advice, e.learned_cases, e.outbreak_factor,
      ln(e.eff_prior / (1 - e.eff_prior)) + coalesce(sum(ev.w), 0) as logodds,
      count(*) filter (where ev.present and ev.w > 0.3) as supporting,
      coalesce(jsonb_agg(jsonb_build_object('finding', ev.finding_id, 'label', ev.label, 'present', ev.present,
          'weight', round(exp(ev.w)::numeric, 2)) order by abs(ev.w) desc) filter (where abs(ev.w) > 0.18), '[]') as why
    from eligible e left join evidence ev on ev.condition_id = e.id
    group by e.id, e.icd10, e.name, e.category, e.description, e.urgency, e.recommended_tests, e.advice, e.learned_cases, e.eff_prior, e.outbreak_factor
  ),
  ranked as (
    select *, 1 / (1 + exp(-logodds)) as probability from scored where supporting > 0
    order by logodds desc limit 8
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'icd10', icd10, 'name', name, 'category', category, 'description', description, 'urgency', urgency,
      'probability', round((1 / (1 + exp(-logodds)))::numeric, 3), 'tests', recommended_tests, 'advice', advice,
      'learnedCases', learned_cases, 'outbreakFactor', outbreak_factor, 'why', why) order by logodds desc), '[]')
    into v_conditions from ranked where probability >= 0.005;

  -- Follow-up questions: unanswered findings that best separate the leading conditions.
  with top as (
    select (c ->> 'id') as id, (c ->> 'probability')::numeric as p from jsonb_array_elements(v_conditions) c limit 5
  ),
  links as (select * from private.dx_learned_links()),
  candidates as (
    select f.id, f.label, f.question,
      sum(t.p * abs(ln(least(50, greatest(0.05, l.sensitivity / f.base_rate)))) + t.p * abs(ln(least(20, greatest(0.05, (1 - l.sensitivity) / (1 - f.base_rate)))))) as gain,
      array_agg(t.id order by t.p desc) as conditions
    from top t join links l on l.condition_id = t.id join public.dx_findings f on f.id = l.finding_id
    where not (f.id = any(v_present)) and not (f.id = any(v_absent)) and f.category <> 'vital' and f.question is not null
    group by f.id, f.label, f.question
  )
  select coalesce(jsonb_agg(jsonb_build_object('finding', id, 'label', label, 'question', question, 'conditions', conditions) order by gain desc), '[]')
    into v_questions from (select * from candidates order by gain desc limit 6) q;

  select coalesce(jsonb_agg(jsonb_build_object('finding', id, 'label', label)), '[]') into v_flags
    from public.dx_findings where red_flag and id = any(v_present);

  v_risk := case
    when jsonb_array_length(v_flags) > 0 then 'high'
    when exists (select 1 from jsonb_array_elements(v_conditions) c where c ->> 'urgency' = 'emergency' and (c ->> 'probability')::numeric >= 0.15) then 'high'
    when exists (select 1 from jsonb_array_elements(v_conditions) c where c ->> 'urgency' in ('urgent', 'emergency') and (c ->> 'probability')::numeric >= 0.15) then 'moderate'
    else 'low' end;

  select coalesce(array_agg(distinct t), '{}') into v_tests
    from (select jsonb_array_elements_text(c -> 'tests') as t from (select c from jsonb_array_elements(v_conditions) c limit 3) x) y;

  select count(*) into v_learned from public.dx_cases;

  select coalesce(jsonb_agg(jsonb_build_object('conditionId', ob.condition_id, 'condition', c.name, 'factor', ob.factor, 'signals', ob.signals)
      order by ob.factor desc), '[]')
    into v_outbreaks from private.dx_outbreak_factors(v_state) ob join public.dx_conditions c on c.id = ob.condition_id;

  v_result := jsonb_build_object(
    'conditions', v_conditions, 'questions', v_questions, 'redFlags', v_flags, 'risk', v_risk, 'tests', to_jsonb(v_tests),
    'present', to_jsonb(v_present), 'absent', to_jsonb(v_absent), 'autoFindings', v_auto,
    'age', v_age, 'sex', nullif(v_sex, ''), 'state', v_state, 'outbreaks', v_outbreaks, 'learnedCasesTotal', v_learned, 'model', 'VitaMind Dx 1.1');

  if coalesce(p_save, true) then
    insert into public.dx_sessions (organization_id, patient_id, inputs, results, risk)
    values (p_organization_id, p_patient_id,
      jsonb_build_object('age', v_age, 'sex', nullif(v_sex, ''), 'present', to_jsonb(v_present), 'absent', to_jsonb(v_absent), 'text', coalesce(p_text, '')),
      v_result, v_risk)
    returning id into v_session;
    v_result := v_result || jsonb_build_object('sessionId', v_session);
  end if;
  return v_result;
end;
$$;
