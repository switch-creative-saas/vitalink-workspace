-- Paper-record scanning (Starter and up) and the consultation scribe (Growth and up).
--
-- * Plans get two modules: 'ocr-intake' (photograph paper records or a register page and turn them
--   into patient records) and 'ai-scribe' (listen to a consultation, draft the note, pick out
--   symptoms and learn from the doctor's diagnosis).
-- * consultation_scribes keeps the consent, the transcript and the draft. Audio is never stored.
--   Only the vitamind-assist edge function writes it, after checking role, plan and limits.
-- * ai_tool_usage counts each person's and workspace's use for rate limits.

update public.plans set
  modules = (select array_agg(distinct m) from unnest(modules || array['ocr-intake']) m),
  features = features || array['Snap paper records to register patients']
where id in ('starter', 'growth', 'enterprise') and not ('ocr-intake' = any(modules));

update public.plans set
  modules = (select array_agg(distinct m) from unnest(modules || array['ai-scribe']) m),
  features = features || array['AI consultation scribe: notes, symptoms and learning from your diagnoses']
where id in ('growth', 'enterprise') and not ('ai-scribe' = any(modules));

-- Transcription is billed per minute of audio: counted as kind 'audio' (tokens = seconds).
alter table public.ai_usage_daily drop constraint if exists ai_usage_daily_kind_check;
alter table public.ai_usage_daily add constraint ai_usage_daily_kind_check check (kind in ('llm', 'embed', 'audio'));

create table if not exists public.ai_tool_usage (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null,
  kind text not null check (kind in ('ocr', 'transcribe', 'scribe_draft')),
  units integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists ai_tool_usage_user_idx on public.ai_tool_usage (user_id, kind, created_at desc);
create index if not exists ai_tool_usage_org_idx on public.ai_tool_usage (organization_id, kind, created_at desc);
alter table public.ai_tool_usage enable row level security;
revoke all on public.ai_tool_usage from anon, authenticated;

create table if not exists public.consultation_scribes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  consent_at timestamptz not null default now(),
  status text not null default 'recording' check (status in ('recording', 'drafted', 'discarded')),
  transcript text not null default '' check (length(transcript) <= 200000),
  audio_seconds integer not null default 0,
  draft jsonb,
  dx_session_id uuid references public.dx_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists consultation_scribes_patient_idx on public.consultation_scribes (patient_id, created_at desc);
alter table public.consultation_scribes enable row level security;
revoke all on public.consultation_scribes from anon, authenticated;
grant select on public.consultation_scribes to authenticated;
drop policy if exists "clinical staff read scribes" on public.consultation_scribes;
create policy "clinical staff read scribes" on public.consultation_scribes
  for select to authenticated using (private.has_role(organization_id, private.clinical_read_roles()));

-- Who started a scribe for which patient (transcript appends every minute aren't logged one by one).
drop trigger if exists consultation_scribes_audit on public.consultation_scribes;
create trigger consultation_scribes_audit after insert or delete on public.consultation_scribes
  for each row execute function private.write_audit();
