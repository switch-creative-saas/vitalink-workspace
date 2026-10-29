-- Daily AI spend counters for the VitaMind AI service. The service checks them before every
-- paid call (Anthropic / OpenAI) and refuses once the day's budget is used, so a leaked token or
-- a bug can't run up an unbounded bill. Only the service (service role) can read or write them.
create table if not exists public.ai_usage_daily (
  day date not null default (now() at time zone 'utc')::date,
  kind text not null check (kind in ('llm', 'embed')),
  requests integer not null default 0,
  tokens bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, kind)
);
alter table public.ai_usage_daily enable row level security;
revoke all on public.ai_usage_daily from anon, authenticated;

create or replace function public.ai_usage_today(p_kind text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('requests', coalesce(max(u.requests), 0), 'tokens', coalesce(max(u.tokens), 0))
  from public.ai_usage_daily u where u.day = (now() at time zone 'utc')::date and u.kind = p_kind
$$;

create or replace function public.ai_usage_add(p_kind text, p_requests integer, p_tokens bigint)
returns jsonb language sql security definer set search_path = '' as $$
  insert into public.ai_usage_daily (day, kind, requests, tokens)
  values ((now() at time zone 'utc')::date, p_kind, greatest(p_requests, 0), greatest(p_tokens, 0))
  on conflict (day, kind) do update
    set requests = public.ai_usage_daily.requests + excluded.requests,
        tokens = public.ai_usage_daily.tokens + excluded.tokens,
        updated_at = now()
  returning jsonb_build_object('requests', requests, 'tokens', tokens)
$$;

revoke all on function public.ai_usage_today(text) from public, anon, authenticated;
revoke all on function public.ai_usage_add(text, integer, bigint) from public, anon, authenticated;
grant execute on function public.ai_usage_today(text) to service_role;
grant execute on function public.ai_usage_add(text, integer, bigint) to service_role;
