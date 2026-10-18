-- VitaMind AI: the paid tier of VitaLink's clinical decision support.
-- Retrieval-augmented generation over PubMed / guideline / FMOH text (pgvector),
-- run by the Python service in apps/vitamind-ai and called through the
-- vitamind-diagnose edge function. VitaMind Dx (dx_*) remains the included tier.
--
-- Mapping to the VitaLink schema: staff are auth users (profiles.id); workspace
-- membership is checked with private.has_role / private.is_member.

create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------------
-- Knowledge (shared across workspaces; public literature, written by the service)
create table public.vitamind_knowledge (
  id uuid primary key default gen_random_uuid(),
  source_url text not null,
  title text not null,
  chunk_index integer not null default 0,
  chunk_text text not null,
  embedding extensions.vector(1536) not null,
  source_type text not null check (source_type in ('pubmed', 'guideline', 'fmoh')),
  created_at timestamptz not null default now(),
  unique (source_url, chunk_index)
);
create index vitamind_knowledge_embedding_idx on public.vitamind_knowledge
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.vitamind_knowledge enable row level security;
create policy "signed-in users read knowledge" on public.vitamind_knowledge for select to authenticated using (true);
grant select (id, source_url, title, chunk_index, chunk_text, source_type, created_at) on public.vitamind_knowledge to authenticated;

-- Cosine-similarity search, used by the service's /search and /diagnose.
create or replace function public.vitamind_match_knowledge(query_embedding extensions.vector(1536), match_count integer default 5, min_similarity double precision default 0.2)
returns table (id uuid, title text, source_url text, source_type text, chunk_text text, similarity double precision)
language sql stable set search_path = '' as $$
  select k.id, k.title, k.source_url, k.source_type, k.chunk_text,
         1 - (k.embedding operator(extensions.<=>) query_embedding) as similarity
  from public.vitamind_knowledge k
  where 1 - (k.embedding operator(extensions.<=>) query_embedding) >= min_similarity
  order by k.embedding operator(extensions.<=>) query_embedding
  limit least(greatest(match_count, 1), 50)
$$;
revoke all on function public.vitamind_match_knowledge(extensions.vector, integer, double precision) from public, anon, authenticated;
grant execute on function public.vitamind_match_knowledge(extensions.vector, integer, double precision) to service_role;

-- ---------------------------------------------------------------------------
-- Sessions, results, feedback (per workspace)
create table public.vitamind_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references public.patients(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  chief_complaint text not null,
  structured_emr_snapshot jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index vitamind_sessions_org_idx on public.vitamind_sessions (organization_id, created_at desc);
create index vitamind_sessions_patient_idx on public.vitamind_sessions (patient_id, created_at desc);

create table public.vitamind_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.vitamind_sessions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  differential jsonb not null default '[]',
  confidence_score numeric check (confidence_score between 0 and 1),
  citations jsonb not null default '[]',
  red_flags jsonb not null default '[]',
  recommended_actions jsonb not null default '[]',
  requires_urgent_review boolean not null default false,
  raw_prompt text,
  raw_response text,
  model_used text,
  latency_ms integer,
  created_at timestamptz not null default now()
);
create index vitamind_results_session_idx on public.vitamind_results (session_id);

create table public.vitamind_feedback (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.vitamind_results(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  clinician_id uuid references public.profiles(id) on delete set null default auth.uid(),
  action text not null check (action in ('confirm', 'override', 'partial')),
  actual_diagnosis text,
  notes text,
  created_at timestamptz not null default now()
);
create index vitamind_feedback_result_idx on public.vitamind_feedback (result_id);

-- The org on a result / feedback row always matches its parent.
create or replace function private.vitamind_stamp_org()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'vitamind_results' then
    select organization_id into new.organization_id from public.vitamind_sessions where id = new.session_id;
  else
    select organization_id into new.organization_id from public.vitamind_results where id = new.result_id;
  end if;
  if new.organization_id is null then raise exception 'Parent record not found' using errcode = '23503'; end if;
  return new;
end;
$$;
create trigger vitamind_results_stamp_org before insert on public.vitamind_results for each row execute function private.vitamind_stamp_org();
create trigger vitamind_feedback_stamp_org before insert on public.vitamind_feedback for each row execute function private.vitamind_stamp_org();

alter table public.vitamind_sessions enable row level security;
alter table public.vitamind_results enable row level security;
alter table public.vitamind_feedback enable row level security;

create policy "clinical staff read sessions" on public.vitamind_sessions for select to authenticated
  using (private.has_role(organization_id, private.clinical_read_roles()));
create policy "clinical staff start sessions" on public.vitamind_sessions for insert to authenticated
  with check (private.has_role(organization_id, private.clinical_read_roles()) and created_by = (select auth.uid())
    and (patient_id is null or exists (select 1 from public.patients p where p.id = patient_id and p.organization_id = vitamind_sessions.organization_id)));
create policy "clinical staff read results" on public.vitamind_results for select to authenticated
  using (private.has_role(organization_id, private.clinical_read_roles()));
create policy "clinical staff read feedback" on public.vitamind_feedback for select to authenticated
  using (private.has_role(organization_id, private.clinical_read_roles()));
create policy "doctors give feedback" on public.vitamind_feedback for insert to authenticated
  with check (private.has_role(organization_id, private.note_write_roles()) and clinician_id = (select auth.uid()));
-- Results are written only by the VitaMind AI service (service role).

grant select, insert on public.vitamind_sessions to authenticated;
grant select on public.vitamind_results to authenticated;
grant select, insert on public.vitamind_feedback to authenticated;

-- ---------------------------------------------------------------------------
-- Plan gating: VitaMind AI is its own plan module ("vitamind-ai").
update public.plans set modules = array_append(modules, 'vitamind-ai')
where id = 'enterprise' and not ('vitamind-ai' = any(modules));

create or replace function private.org_has_module(p_org uuid, p_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p_module = any(p.modules)
    from public.subscriptions s join public.plans p on p.id = private.effective_plan(s)
    where s.organization_id = p_org
  ), (select p_module = any(modules) from public.plans where id = 'free'), false)
$$;
revoke all on function private.org_has_module(uuid, text) from public, anon, authenticated;

create or replace function public.vitamind_access(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_member(p_organization_id) and private.org_has_module(p_organization_id, 'vitamind-ai')
$$;
grant execute on function public.vitamind_access(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Clinician feedback also teaches VitaMind Dx: the final diagnosis plus the
-- findings in the chief complaint become a confirmed case.
alter table public.dx_cases drop constraint dx_cases_source_check;
alter table public.dx_cases add constraint dx_cases_source_check check (source in ('engine', 'emr', 'vitamind'));

create or replace function private.vitamind_learn_from_feedback()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_session public.vitamind_sessions;
  v_result public.vitamind_results;
  v_dx text;
  v_condition text;
  v_present text[];
  v_absent text[];
begin
  select * into v_result from public.vitamind_results where id = new.result_id;
  select * into v_session from public.vitamind_sessions where id = v_result.session_id;
  v_dx := lower(btrim(coalesce(nullif(new.actual_diagnosis, ''),
    case when new.action = 'confirm' then v_result.differential -> 0 ->> 'condition' end, '')));
  if v_dx = '' then return null; end if;
  select c.id into v_condition from public.dx_conditions c
    where v_dx like '%' || lower(c.name) || '%'
       or exists (select 1 from unnest(c.aliases) a where length(a) > 3 and v_dx ~ ('\m' || lower(a) || '\M'))
    order by length(c.name) desc limit 1;
  if v_condition is null then return null; end if;
  select coalesce(array_agg(finding_id) filter (where present), '{}'), coalesce(array_agg(finding_id) filter (where not present), '{}')
    into v_present, v_absent from private.dx_extract(v_session.chief_complaint);
  if cardinality(v_present) = 0 then return null; end if;
  insert into public.dx_cases (organization_id, patient_id, condition_id, present, absent, source, confirmed_by)
  values (v_session.organization_id, v_session.patient_id, v_condition, v_present, v_absent, 'vitamind', new.clinician_id);
  return null;
end;
$$;
create trigger vitamind_feedback_learn after insert on public.vitamind_feedback
  for each row execute function private.vitamind_learn_from_feedback();
