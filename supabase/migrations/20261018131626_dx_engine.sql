-- VitaLink diagnosis engine (VitaMind Dx): a probabilistic decision-support model
-- that runs entirely inside VitaLink. No external AI model is called.
--
-- * Knowledge: dx_conditions / dx_findings / dx_condition_findings hold seed
--   estimates (prevalence among outpatients in Nigeria, how often each finding
--   appears with each condition). Every figure is refined by confirmed cases.
-- * Inference: naive-Bayes log-odds per condition from the findings marked
--   present or absent (typed, extracted from free text, or read from the
--   patient's vitals and record), with an explanation for every condition.
-- * Learning: when a clinician confirms a diagnosis (in the engine, or by
--   signing an EMR note whose primary diagnosis matches), the case's findings
--   update the condition's statistics. Counts are pooled across workspaces as
--   numbers only; no patient details leave a workspace.
-- * Literature comes from PubMed (edge function dx-literature), cached here.

-- ---------------------------------------------------------------------------
-- Knowledge base (global, read-only to users; maintained by migrations)
create table public.dx_findings (
  id text primary key,
  label text not null,
  category text not null check (category in ('symptom', 'sign', 'vital', 'history')),
  base_rate numeric not null check (base_rate > 0 and base_rate < 1),
  red_flag boolean not null default false,
  question text,
  aliases text[] not null default '{}',
  sort integer not null default 100
);

create table public.dx_conditions (
  id text primary key,
  icd10 text not null,
  name text not null,
  category text not null,
  description text not null default '',
  urgency text not null check (urgency in ('routine', 'urgent', 'emergency')),
  prior numeric not null check (prior > 0 and prior < 1),
  sex text not null default 'any' check (sex in ('any', 'female', 'male')),
  age_min integer,
  age_max integer,
  recommended_tests text[] not null default '{}',
  advice text not null default '',
  pubmed_query text not null,
  aliases text[] not null default '{}'
);

create table public.dx_condition_findings (
  condition_id text not null references public.dx_conditions(id) on delete cascade,
  finding_id text not null references public.dx_findings(id) on delete cascade,
  sensitivity numeric not null check (sensitivity > 0 and sensitivity < 1),
  primary key (condition_id, finding_id)
);

alter table public.dx_findings enable row level security;
alter table public.dx_conditions enable row level security;
alter table public.dx_condition_findings enable row level security;
create policy "signed-in users read findings" on public.dx_findings for select to authenticated using (true);
create policy "signed-in users read conditions" on public.dx_conditions for select to authenticated using (true);
create policy "signed-in users read links" on public.dx_condition_findings for select to authenticated using (true);
grant select on public.dx_findings, public.dx_conditions, public.dx_condition_findings to authenticated;

-- Drug classes for allergy checks in the history analysis.
create table public.dx_allergy_classes (
  allergen text not null,
  drug_pattern text not null,
  primary key (allergen, drug_pattern)
);
alter table public.dx_allergy_classes enable row level security;
create policy "signed-in users read allergy classes" on public.dx_allergy_classes for select to authenticated using (true);
grant select on public.dx_allergy_classes to authenticated;

-- ---------------------------------------------------------------------------
-- Sessions, confirmed cases, reviews, imaging reports, literature cache
create table public.dx_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid references public.patients(id) on delete set null,
  created_by uuid default auth.uid(),
  inputs jsonb not null,
  results jsonb not null,
  risk text not null check (risk in ('low', 'moderate', 'high')),
  status text not null default 'open' check (status in ('open', 'confirmed', 'closed')),
  confirmed_condition_id text references public.dx_conditions(id),
  outcome_note text,
  closed_by uuid,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index dx_sessions_org_idx on public.dx_sessions (organization_id, created_at desc);
create index dx_sessions_patient_idx on public.dx_sessions (patient_id, created_at desc);

create table public.dx_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid references public.dx_sessions(id) on delete set null,
  patient_id uuid references public.patients(id) on delete set null,
  condition_id text not null references public.dx_conditions(id),
  present text[] not null default '{}',
  absent text[] not null default '{}',
  source text not null check (source in ('engine', 'emr')),
  confirmed_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index dx_cases_condition_idx on public.dx_cases (condition_id);
create index dx_cases_org_idx on public.dx_cases (organization_id, created_at desc);

create table public.dx_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  reviewed_by uuid default auth.uid(),
  note text not null default '',
  created_at timestamptz not null default now()
);
create index dx_reviews_patient_idx on public.dx_reviews (patient_id, created_at desc);

create table public.dx_imaging_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  document_id uuid not null references public.patient_documents(id) on delete cascade,
  modality text not null default 'Other',
  findings text not null default '',
  impression text not null,
  status text not null default 'final' check (status in ('preliminary', 'final')),
  reported_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index dx_imaging_reports_doc_idx on public.dx_imaging_reports (document_id, created_at desc);

create table public.dx_literature (
  condition_id text primary key references public.dx_conditions(id) on delete cascade,
  query text not null,
  articles jsonb not null default '[]',
  total integer not null default 0,
  fetched_at timestamptz not null default now()
);

alter table public.dx_sessions enable row level security;
alter table public.dx_cases enable row level security;
alter table public.dx_reviews enable row level security;
alter table public.dx_imaging_reports enable row level security;
alter table public.dx_literature enable row level security;

create policy "clinical staff read sessions" on public.dx_sessions for select to authenticated
  using (private.has_role(organization_id, private.clinical_read_roles()));
create policy "clinical staff read cases" on public.dx_cases for select to authenticated
  using (private.has_role(organization_id, private.clinical_read_roles()));
create policy "clinical staff read reviews" on public.dx_reviews for select to authenticated
  using (private.has_role(organization_id, private.clinical_read_roles()));
create policy "clinical staff read imaging reports" on public.dx_imaging_reports for select to authenticated
  using (private.has_role(organization_id, private.clinical_read_roles()));
create policy "signed-in users read literature" on public.dx_literature for select to authenticated using (true);
grant select on public.dx_sessions, public.dx_cases, public.dx_reviews, public.dx_imaging_reports, public.dx_literature to authenticated;
-- All writes go through the definer functions below.

-- ---------------------------------------------------------------------------
-- Learned statistics: seed estimates blended with confirmed cases.
-- Each seed figure counts as 20 cases, so real cases take over as they accumulate.
create or replace function private.dx_learned_links()
returns table (condition_id text, finding_id text, sensitivity numeric, learned_cases integer)
language sql stable security definer set search_path = '' as $$
  with counts as (
    select c.condition_id, f.finding_id,
           count(*) filter (where f.finding_id = any(c.present)) as present_n,
           count(*) filter (where f.finding_id = any(c.absent)) as absent_n
    from public.dx_cases c
    cross join lateral (select unnest(c.present || c.absent) as finding_id) f
    group by 1, 2
  ),
  links as (
    select l.condition_id, l.finding_id, l.sensitivity as seed from public.dx_condition_findings l
    union
    -- findings seen in confirmed cases but not in the seed start from their base rate
    select k.condition_id, k.finding_id, fd.base_rate from counts k
    join public.dx_findings fd on fd.id = k.finding_id
    where not exists (select 1 from public.dx_condition_findings l where l.condition_id = k.condition_id and l.finding_id = k.finding_id)
  )
  select l.condition_id, l.finding_id,
         least(0.99, greatest(0.005, (l.seed * 20 + coalesce(k.present_n, 0)) / (20 + coalesce(k.present_n, 0) + coalesce(k.absent_n, 0)))),
         (coalesce(k.present_n, 0) + coalesce(k.absent_n, 0))::int
  from links l left join counts k on k.condition_id = l.condition_id and k.finding_id = l.finding_id
$$;
revoke all on function private.dx_learned_links() from public, anon, authenticated;

-- Pull findings out of free text, with simple negation ("no fever", "denies cough").
create or replace function private.dx_extract(p_text text)
returns table (finding_id text, present boolean)
language sql stable set search_path = '' as $$
  with t as (select ' ' || regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9 ]+', ' ', 'g') || ' ' as body),
  hits as (
    select f.id, a.alias,
      t.body ~ ('(^| )(no|not|denies|denied|without|nil|negative for|absent) ([a-z]+ ){0,2}' || regexp_replace(lower(a.alias), '[^a-z0-9 ]+', ' ', 'g') || ' ') as negated
    from public.dx_findings f
    cross join lateral unnest(f.aliases) a(alias)
    cross join t
    where length(a.alias) > 2
      and position(' ' || regexp_replace(lower(a.alias), '[^a-z0-9 ]+', ' ', 'g') || ' ' in t.body) > 0
  )
  select id, not bool_or(negated) from hits group by id
$$;

-- What the patient's record and latest vitals say, as findings.
create or replace function private.dx_patient_findings(p_patient_id uuid)
returns table (finding_id text, present boolean, source text)
language sql stable security definer set search_path = '' as $$
  with p as (select * from public.patients where id = p_patient_id),
  v as (
    select * from public.vitals where patient_id = p_patient_id and recorded_at > now() - interval '48 hours'
    order by recorded_at desc limit 1
  ),
  rows as (
    select 'v_fever' as f, v.temperature_c >= 37.5 as present from v where v.temperature_c is not null
    union all select 'v_high_bp', v.systolic >= 140 or v.diastolic >= 90 from v where v.systolic is not null
    union all select 'v_severe_bp', v.systolic >= 180 or v.diastolic >= 120 from v where v.systolic is not null
    union all select 'v_hypotension', v.systolic < 90 from v where v.systolic is not null
    union all select 'v_tachycardia', v.heart_rate > 100 from v where v.heart_rate is not null
    union all select 'v_tachypnoea', v.respiratory_rate > 22 from v where v.respiratory_rate is not null
    union all select 'v_hypoxia', v.spo2 < 94 from v where v.spo2 is not null
    union all select 'h_sickle', true from p where upper(coalesce(p.genotype, '')) in ('SS', 'SC', 'HBSS', 'HBSC')
    union all select 'h_sickle', false from p where upper(coalesce(p.genotype, '')) in ('AA', 'AS', 'HBAA', 'HBAS')
    union all select 'h_diabetes', true from p where p.chronic_conditions ~* 'diabet'
    union all select 'h_hypertension', true from p where p.chronic_conditions ~* 'hypertens|high blood pressure'
    union all select 'h_asthma', true from p where p.chronic_conditions ~* 'asthma'
    union all select 'h_hiv', true from p where p.chronic_conditions ~* '\mhiv\M|retroviral'
    union all select 'pregnant', true from p where p.pregnancy_status ~* '^(yes|pregnant)|weeks|trimester'
  )
  select f, present, case when f like 'v\_%' then 'vitals' else 'record' end from rows
$$;
revoke all on function private.dx_patient_findings(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Run a differential.
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
      -- local prevalence: seed prior blended with this workspace's confirmed mix (seed = 100 cases)
      (c.prior * 100 + coalesce(cc.org_n, 0)) / (100 + (select n from org_total)) as eff_prior,
      coalesce(cc.all_n, 0) as learned_cases
    from public.dx_conditions c left join case_counts cc on cc.condition_id = c.id
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
    select e.id, e.icd10, e.name, e.category, e.description, e.urgency, e.recommended_tests, e.advice, e.learned_cases,
      ln(e.eff_prior / (1 - e.eff_prior)) + coalesce(sum(ev.w), 0) as logodds,
      count(*) filter (where ev.present and ev.w > 0.3) as supporting,
      coalesce(jsonb_agg(jsonb_build_object('finding', ev.finding_id, 'label', ev.label, 'present', ev.present,
          'weight', round(exp(ev.w)::numeric, 2)) order by abs(ev.w) desc) filter (where abs(ev.w) > 0.18), '[]') as why
    from eligible e left join evidence ev on ev.condition_id = e.id
    group by e.id, e.icd10, e.name, e.category, e.description, e.urgency, e.recommended_tests, e.advice, e.learned_cases, e.eff_prior
  ),
  ranked as (
    select *, 1 / (1 + exp(-logodds)) as probability from scored where supporting > 0
    order by logodds desc limit 8
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'icd10', icd10, 'name', name, 'category', category, 'description', description, 'urgency', urgency,
      'probability', round((1 / (1 + exp(-logodds)))::numeric, 3), 'tests', recommended_tests, 'advice', advice,
      'learnedCases', learned_cases, 'why', why) order by logodds desc), '[]')
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

  v_result := jsonb_build_object(
    'conditions', v_conditions, 'questions', v_questions, 'redFlags', v_flags, 'risk', v_risk, 'tests', to_jsonb(v_tests),
    'present', to_jsonb(v_present), 'absent', to_jsonb(v_absent), 'autoFindings', v_auto,
    'age', v_age, 'sex', nullif(v_sex, ''), 'learnedCasesTotal', v_learned, 'model', 'VitaMind Dx 1.0');

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

-- Confirm the final diagnosis for a session (teaches the model), or close it with another diagnosis.
create or replace function public.dx_confirm(p_session_id uuid, p_condition_id text, p_note text default null)
returns public.dx_sessions
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.dx_sessions;
begin
  select * into v_session from public.dx_sessions where id = p_session_id for update;
  if v_session.id is null then raise exception 'Analysis not found' using errcode = 'P0002'; end if;
  if not private.has_role(v_session.organization_id, private.note_write_roles()) then
    raise exception 'Only doctors can confirm a diagnosis' using errcode = '42501';
  end if;
  if v_session.status <> 'open' then raise exception 'This analysis is already closed' using errcode = '22023'; end if;
  if p_condition_id is null and length(btrim(coalesce(p_note, ''))) < 2 then
    raise exception 'Name the final diagnosis' using errcode = '22023';
  end if;

  if p_condition_id is not null then
    if not exists (select 1 from public.dx_conditions where id = p_condition_id) then
      raise exception 'Unknown condition' using errcode = '22023';
    end if;
    insert into public.dx_cases (organization_id, session_id, patient_id, condition_id, present, absent, source)
    select v_session.organization_id, v_session.id, v_session.patient_id, p_condition_id,
      array(select jsonb_array_elements_text(v_session.inputs -> 'present')),
      array(select jsonb_array_elements_text(v_session.inputs -> 'absent')), 'engine';
  end if;

  update public.dx_sessions set
    status = case when p_condition_id is null then 'closed' else 'confirmed' end,
    confirmed_condition_id = p_condition_id, outcome_note = nullif(btrim(p_note), ''),
    closed_by = auth.uid(), closed_at = now()
  where id = p_session_id returning * into v_session;
  return v_session;
end;
$$;

-- Signing an EMR note with a matching primary diagnosis confirms the patient's
-- most recent open analysis from the last 14 days, so the model learns from
-- normal documentation too.
create or replace function private.dx_learn_from_note()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_condition text;
  v_session public.dx_sessions;
  v_dx text := lower(btrim(coalesce(new.primary_diagnosis, '')));
begin
  if new.status <> 'signed' or v_dx = '' or (tg_op = 'UPDATE' and old.status = 'signed') then return null; end if;
  select c.id into v_condition from public.dx_conditions c
    where v_dx like '%' || lower(c.name) || '%'
       or lower(c.icd10) = split_part(v_dx, ' ', 1)
       or exists (select 1 from unnest(c.aliases) a where length(a) > 3 and v_dx ~ ('\m' || lower(a) || '\M'))
    order by length(c.name) desc limit 1;
  if v_condition is null then return null; end if;
  select * into v_session from public.dx_sessions
    where organization_id = new.organization_id and patient_id = new.patient_id and status = 'open'
      and created_at > now() - interval '14 days'
    order by created_at desc limit 1;
  if v_session.id is null then return null; end if;
  insert into public.dx_cases (organization_id, session_id, patient_id, condition_id, present, absent, source, confirmed_by)
  select v_session.organization_id, v_session.id, v_session.patient_id, v_condition,
    array(select jsonb_array_elements_text(v_session.inputs -> 'present')),
    array(select jsonb_array_elements_text(v_session.inputs -> 'absent')), 'emr', coalesce(new.signed_by, auth.uid());
  update public.dx_sessions set status = 'confirmed', confirmed_condition_id = v_condition,
    outcome_note = 'Confirmed by signed EMR note', closed_by = coalesce(new.signed_by, auth.uid()), closed_at = now()
  where id = v_session.id;
  return null;
end;
$$;
create trigger clinical_notes_dx_learn after insert or update of status on public.clinical_notes
  for each row execute function private.dx_learn_from_note();

-- ---------------------------------------------------------------------------
-- History-aware analysis: rules over the patient's own record.
create or replace function public.dx_patient_insights(p_patient_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_patient public.patients;
  v_insights jsonb := '[]';
  v_result jsonb;
begin
  select * into v_patient from public.patients where id = p_patient_id;
  if v_patient.id is null or not private.has_role(v_patient.organization_id, private.clinical_read_roles()) then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;

  with labs as (
    select l.*, nullif(substring(l.value from '(-?[0-9]+(?:\.[0-9]+)?)'), '')::numeric as num,
           row_number() over (partition by lower(btrim(l.test_name)) order by coalesce(l.resulted_at, l.updated_at) desc) as rn
    from public.lab_results l where l.patient_id = p_patient_id and l.status = 'Completed'
  ),
  trends as (
    select a.test_name, a.num as latest, b.num as previous, a.unit, a.flag, a.reference_range
    from labs a join labs b on lower(btrim(a.test_name)) = lower(btrim(b.test_name)) and b.rn = 2
    where a.rn = 1 and a.num is not null and b.num is not null and b.num <> 0
  ),
  vit as (select * from public.vitals where patient_id = p_patient_id and recorded_at > now() - interval '180 days'),
  notes as (select * from public.clinical_notes where patient_id = p_patient_id and created_at > now() - interval '90 days'),
  rx as (select * from public.prescriptions where patient_id = p_patient_id and status = 'active'),
  rules as (
    -- critical / abnormal labs in the last 6 months
    select 'high' as severity, 'Critical lab result' as title,
      format('%s: %s%s (reference %s)', l.test_name, l.value, coalesce(' ' || nullif(l.unit, ''), ''), coalesce(nullif(l.reference_range, ''), 'n/a')) as detail,
      'labs' as kind
    from labs l where l.rn = 1 and l.flag = 'Critical' and coalesce(l.resulted_at, l.updated_at) > now() - interval '180 days'
    union all
    select 'moderate', format('%s result', case l.flag when 'High' then 'High' else 'Low' end),
      format('%s: %s%s (reference %s)', l.test_name, l.value, coalesce(' ' || nullif(l.unit, ''), ''), coalesce(nullif(l.reference_range, ''), 'n/a')), 'labs'
    from labs l where l.rn = 1 and l.flag in ('High', 'Low') and coalesce(l.resulted_at, l.updated_at) > now() - interval '180 days'
    union all
    -- lab trends worth noticing (>= 10% change between the last two results)
    select case when t.flag in ('Critical', 'High', 'Low') then 'moderate' else 'info' end,
      format('%s %s', t.test_name, case when t.latest > t.previous then 'rising' else 'falling' end),
      format('%s → %s%s (%s%s%%)', t.previous, t.latest, coalesce(' ' || nullif(t.unit, ''), ''),
        case when t.latest > t.previous then '+' else '' end, round((t.latest - t.previous) / abs(t.previous) * 100)), 'labs'
    from trends t where abs(t.latest - t.previous) / abs(t.previous) >= 0.10
    union all
    -- raised blood pressure on repeated readings
    select case when count(*) filter (where v.systolic >= 180 or v.diastolic >= 120) > 0 then 'high' else 'moderate' end,
      'Raised blood pressure on repeat readings',
      format('%s of %s readings in 6 months were 140/90 or above (highest %s/%s).%s',
        count(*) filter (where v.systolic >= 140 or v.diastolic >= 90), count(*), max(v.systolic), max(v.diastolic),
        case when coalesce(v_patient.chronic_conditions, '') !~* 'hypertens' then ' Hypertension is not on the problem list.' else '' end), 'vitals'
    from vit v where v.systolic is not null
    having count(*) filter (where v.systolic >= 140 or v.diastolic >= 90) >= 2
    union all
    -- weight loss of 5% or more
    select 'moderate', 'Weight loss',
      format('%s kg → %s kg (%s%%) over %s days.', w.first_kg, w.last_kg, round((w.last_kg - w.first_kg) / w.first_kg * 100, 1), w.days), 'vitals'
    from (
      select (array_agg(weight_kg order by recorded_at))[1] as first_kg, (array_agg(weight_kg order by recorded_at desc))[1] as last_kg,
             extract(day from max(recorded_at) - min(recorded_at))::int as days
      from vit where weight_kg is not null having count(*) >= 2
    ) w where w.first_kg > 0 and (w.first_kg - w.last_kg) / w.first_kg >= 0.05
    union all
    -- same complaint again and again
    select 'moderate', 'Repeat visits for the same complaint',
      format('"%s" recorded %s times in 90 days.', min(n.chief_complaint), count(*)), 'visits'
    from notes n where length(btrim(coalesce(n.chief_complaint, ''))) > 2
    group by lower(btrim(n.chief_complaint)) having count(*) >= 2
    union all
    select 'info', 'Frequent visits', format('%s appointments in the last 90 days.', count(*)), 'visits'
    from public.appointments a where a.patient_id = p_patient_id and a.starts_at > now() - interval '90 days' and a.starts_at <= now()
      and a.status not in ('cancelled', 'rescheduled')
    having count(*) >= 4
    union all
    -- allergy conflicts with active or recent prescriptions
    select 'high', 'Prescription conflicts with a recorded allergy',
      format('%s prescribed%s; patient is allergic to %s.', p.drug_name, ' on ' || to_char(p.created_at at time zone 'Africa/Lagos', 'DD Mon YYYY'), ac.allergen), 'medication'
    from public.prescriptions p
    join public.dx_allergy_classes ac on coalesce(v_patient.allergies, '') ~* ('\m' || ac.allergen)
    where p.patient_id = p_patient_id and p.status <> 'cancelled' and p.created_at > now() - interval '180 days'
      and (p.drug_name ~* ac.drug_pattern or coalesce(p.generic_name, '') ~* ac.drug_pattern)
    union all
    select 'moderate', 'Many active medicines',
      format('%s active prescriptions: review for interactions and duplication.', count(*)), 'medication'
    from rx having count(*) >= 5
    union all
    -- differentials never closed
    select 'info', 'Differential not confirmed',
      format('Analysis from %s is still open (top: %s).', to_char(s.created_at at time zone 'Africa/Lagos', 'DD Mon'), s.results -> 'conditions' -> 0 ->> 'name'), 'engine'
    from public.dx_sessions s where s.patient_id = p_patient_id and s.status = 'open' and s.created_at < now() - interval '3 days'
  )
  select coalesce(jsonb_agg(jsonb_build_object('severity', severity, 'title', title, 'detail', detail, 'kind', kind)
    order by case severity when 'high' then 0 when 'moderate' then 1 else 2 end), '[]') into v_insights from rules;

  select jsonb_build_object(
    'patient', jsonb_build_object('id', v_patient.id, 'switchId', v_patient.switch_id,
      'name', btrim(v_patient.first_name || ' ' || v_patient.last_name),
      'age', extract(year from age(v_patient.date_of_birth))::int, 'sex', v_patient.gender,
      'genotype', v_patient.genotype, 'bloodGroup', v_patient.blood_group, 'allergies', v_patient.allergies,
      'chronicConditions', v_patient.chronic_conditions, 'currentMedications', v_patient.current_medications),
    'insights', v_insights,
    'diagnoses', (select coalesce(jsonb_agg(x.j order by x.at desc), '[]') from (
        select n.created_at as at, jsonb_build_object('at', n.created_at, 'diagnosis', n.primary_diagnosis, 'complaint', n.chief_complaint,
          'source', 'EMR note', 'status', n.status) as j
        from public.clinical_notes n where n.patient_id = p_patient_id and (length(btrim(coalesce(n.primary_diagnosis, ''))) > 0 or length(btrim(coalesce(n.chief_complaint, ''))) > 0)
        union all
        select c.created_at, jsonb_build_object('at', c.created_at, 'diagnosis', d.name, 'complaint', null,
          'source', case c.source when 'emr' then 'Confirmed via EMR' else 'Confirmed in VitaMind Dx' end, 'status', 'confirmed')
        from public.dx_cases c join public.dx_conditions d on d.id = c.condition_id where c.patient_id = p_patient_id
        order by 1 desc limit 15) x),
    'labs', (select coalesce(jsonb_agg(jsonb_build_object('test', l.test_name, 'value', l.value, 'unit', l.unit, 'flag', l.flag,
          'reference', l.reference_range, 'at', coalesce(l.resulted_at, l.updated_at)) order by coalesce(l.resulted_at, l.updated_at) desc), '[]')
        from (select * from public.lab_results where patient_id = p_patient_id and status = 'Completed' order by coalesce(resulted_at, updated_at) desc limit 12) l),
    'vitals', (select coalesce(jsonb_agg(jsonb_build_object('at', v.recorded_at, 'systolic', v.systolic, 'diastolic', v.diastolic,
          'heartRate', v.heart_rate, 'temperature', v.temperature_c, 'spo2', v.spo2, 'weight', v.weight_kg) order by v.recorded_at), '[]')
        from (select * from public.vitals where patient_id = p_patient_id order by recorded_at desc limit 10) v),
    'sessions', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'at', s.created_at, 'risk', s.risk, 'status', s.status,
          'top', s.results -> 'conditions' -> 0 ->> 'name', 'confirmed', d.name, 'note', s.outcome_note) order by s.created_at desc), '[]')
        from (select * from public.dx_sessions where patient_id = p_patient_id order by created_at desc limit 10) s
        left join public.dx_conditions d on d.id = s.confirmed_condition_id),
    'reviews', (select coalesce(jsonb_agg(jsonb_build_object('at', r.created_at, 'note', r.note,
          'by', coalesce(nullif(pr.full_name, ''), pr.email)) order by r.created_at desc), '[]')
        from (select * from public.dx_reviews where patient_id = p_patient_id order by created_at desc limit 5) r
        left join public.profiles pr on pr.id = r.reviewed_by)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.dx_mark_reviewed(p_patient_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.patients where id = p_patient_id;
  if v_org is null or not private.has_role(v_org, private.note_write_roles() || array['nurse']) then
    raise exception 'Only clinicians can record a review' using errcode = '42501';
  end if;
  insert into public.dx_reviews (organization_id, patient_id, note) values (v_org, p_patient_id, coalesce(btrim(p_note), ''));
end;
$$;

create or replace function public.dx_save_imaging_report(p_document_id uuid, p_modality text, p_findings text, p_impression text, p_status text)
returns public.dx_imaging_reports language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.patient_documents;
  v_row public.dx_imaging_reports;
begin
  select * into v_doc from public.patient_documents where id = p_document_id;
  if v_doc.id is null or not private.has_role(v_doc.organization_id, private.note_write_roles()) then
    raise exception 'Only doctors can report imaging' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_impression, ''))) < 2 then raise exception 'Add an impression' using errcode = '22023'; end if;
  insert into public.dx_imaging_reports (organization_id, patient_id, document_id, modality, findings, impression, status)
  values (v_doc.organization_id, v_doc.patient_id, v_doc.id, coalesce(nullif(btrim(p_modality), ''), 'Other'),
    coalesce(btrim(p_findings), ''), btrim(p_impression), case when p_status = 'preliminary' then 'preliminary' else 'final' end)
  returning * into v_row;
  return v_row;
end;
$$;

-- Model overview for the page header: size of the knowledge base and what it has learned.
create or replace function public.dx_model_stats(p_organization_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.has_role(p_organization_id, private.clinical_read_roles()) then jsonb_build_object(
    'conditions', (select count(*) from public.dx_conditions),
    'findings', (select count(*) from public.dx_findings),
    'links', (select count(*) from public.dx_condition_findings),
    'casesAll', (select count(*) from public.dx_cases),
    'casesHere', (select count(*) from public.dx_cases where organization_id = p_organization_id),
    'sessionsHere', (select count(*) from public.dx_sessions where organization_id = p_organization_id),
    'confirmedRate', (select round(100.0 * count(*) filter (where status = 'confirmed' and (results -> 'conditions' -> 0 ->> 'id') = confirmed_condition_id)
        / nullif(count(*) filter (where status = 'confirmed'), 0)) from public.dx_sessions where organization_id = p_organization_id),
    'top3Rate', (select round(100.0 * count(*) filter (where status = 'confirmed' and exists (
          select 1 from jsonb_array_elements(results -> 'conditions') with ordinality c(v, i) where i <= 3 and c.v ->> 'id' = confirmed_condition_id))
        / nullif(count(*) filter (where status = 'confirmed'), 0)) from public.dx_sessions where organization_id = p_organization_id),
    'papersCached', (select coalesce(sum(jsonb_array_length(articles)), 0) from public.dx_literature)
  ) end
$$;

revoke all on function public.dx_analyze(uuid, uuid, integer, text, text[], text[], text, boolean) from public, anon;
revoke all on function public.dx_confirm(uuid, text, text) from public, anon;
revoke all on function public.dx_patient_insights(uuid) from public, anon;
revoke all on function public.dx_mark_reviewed(uuid, text) from public, anon;
revoke all on function public.dx_save_imaging_report(uuid, text, text, text, text) from public, anon;
revoke all on function public.dx_model_stats(uuid) from public, anon;
grant execute on function public.dx_analyze(uuid, uuid, integer, text, text[], text[], text, boolean) to authenticated;
grant execute on function public.dx_confirm(uuid, text, text) to authenticated;
grant execute on function public.dx_patient_insights(uuid) to authenticated;
grant execute on function public.dx_mark_reviewed(uuid, text) to authenticated;
grant execute on function public.dx_save_imaging_report(uuid, text, text, text, text) to authenticated;
grant execute on function public.dx_model_stats(uuid) to authenticated;
