-- Guided tours: which tours each signed-in person has finished or dismissed (workspace and Sentinel).
create table if not exists public.user_tours (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  tour_id text not null check (length(tour_id) between 1 and 80),
  status text not null check (status in ('completed', 'dismissed')),
  updated_at timestamptz not null default now(),
  primary key (user_id, tour_id)
);

alter table public.user_tours enable row level security;

create policy "Read own tours" on public.user_tours for select to authenticated using (user_id = (select auth.uid()));
create policy "Record own tours" on public.user_tours for insert to authenticated with check (user_id = (select auth.uid()));
create policy "Update own tours" on public.user_tours for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Reset own tours" on public.user_tours for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.user_tours from anon;
grant select, insert, update, delete on public.user_tours to authenticated;
