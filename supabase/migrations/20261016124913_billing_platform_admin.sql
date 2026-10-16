-- Billing: plan catalogue, one subscription per organization, Paystack payment
-- records, and platform admins (VitaLink staff) who can activate plans without paying.
-- Clients can read plans and their own org's subscription; every write happens in
-- SECURITY DEFINER functions or Edge Functions using the service role.

-- ============================================
-- PLATFORM ADMINS (not exposed through the API)
-- ============================================

create table private.platform_admins (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

insert into private.platform_admins (email) values ('fredakojuru@gmail.com');

-- Matches on a confirmed email so an unverified signup can't claim an admin address.
create or replace function private.is_platform_admin()
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users u
    join private.platform_admins pa on pa.email = lower(u.email)
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null
  )
$$;

create or replace function public.am_i_platform_admin()
returns boolean
language sql stable
security definer
set search_path = ''
as $$ select private.is_platform_admin() $$;
revoke execute on function public.am_i_platform_admin() from public, anon;
grant execute on function public.am_i_platform_admin() to authenticated;

-- ============================================
-- PLANS (source of truth for what gets charged; mirrors src/data/pricingTiers.ts)
-- ============================================

create table public.plans (
  id text primary key,
  name text not null,
  monthly_price_kobo bigint not null default 0,
  annual_price_kobo bigint,
  setup_fee_kobo bigint not null default 0,
  modules text[] not null default '{}',
  self_serve boolean not null default true,
  sort_order integer not null default 0,
  -- Filled lazily by the paystack-checkout function the first time a plan is sold.
  paystack_plan_monthly text,
  paystack_plan_annual text
);

insert into public.plans (id, name, monthly_price_kobo, annual_price_kobo, setup_fee_kobo, modules, self_serve, sort_order) values
  ('free', 'Free', 0, 0, 0,
    array['dashboard','patients','health-identity','patient-identity','appointments','emr','subscription','settings','help'], true, 0),
  ('starter', 'Starter Node', 4500000, 45900000, 25000000,
    array['dashboard','patients','health-identity','patient-identity','appointments','emr','billing','subscription','settings','help','nfc-cards'], true, 1),
  ('growth', 'Growth Corridor', 12000000, 122400000, 65000000,
    array['dashboard','patients','health-identity','patient-identity','appointments','emr','billing','subscription','settings','help','nfc-cards',
          'telemedicine','laboratory','pharmacy','human-resources','analytics','ai-clinical-intelligence','vitalink-network','switch-network'], true, 2),
  ('enterprise', 'Enterprise & NGO Corridor', 35000000, null, 180000000,
    array['dashboard','patients','health-identity','patient-identity','appointments','emr','billing','subscription','settings','help','nfc-cards',
          'telemedicine','laboratory','pharmacy','human-resources','analytics','ai-clinical-intelligence','vitalink-network','switch-network',
          'administration','audit-logs','sentinel'], false, 3);

alter table public.plans enable row level security;
create policy "anyone reads plans" on public.plans for select to anon, authenticated using (true);
revoke insert, update, delete on public.plans from anon, authenticated;

-- ============================================
-- SUBSCRIPTIONS (exactly one per organization)
-- ============================================

create table public.subscriptions (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  plan_id text not null references public.plans (id),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly','annual')),
  -- pending_payment: chose a paid plan but hasn't paid yet (has Free access meanwhile)
  -- comped: activated by a platform admin without payment
  status text not null default 'active' check (status in ('active','pending_payment','past_due','cancelled','comped')),
  current_period_end timestamptz,
  paystack_customer_code text,
  paystack_subscription_code text,
  paystack_email_token text,
  comped_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_plan_id_idx on public.subscriptions (plan_id);
create index subscriptions_comped_by_idx on public.subscriptions (comped_by);
create index subscriptions_customer_idx on public.subscriptions (paystack_customer_code);
create trigger subscriptions_set_updated_at before update on public.subscriptions
  for each row execute function private.set_updated_at();

alter table public.subscriptions enable row level security;
create policy "members read their subscription" on public.subscriptions
  for select to authenticated using (private.is_member(organization_id));
revoke insert, update, delete on public.subscriptions from anon, authenticated;
revoke all on public.subscriptions from anon;

-- The plan an org can actually use right now.
create or replace function private.effective_plan(s public.subscriptions)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when s.status = 'comped' then s.plan_id
    when s.status = 'active' and (s.current_period_end is null or s.current_period_end > now() - interval '3 days') then s.plan_id
    else 'free'
  end
$$;

-- Keep organizations.subscription_tier in step for anything that still reads it.
create or replace function private.sync_subscription_tier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.organizations
  set subscription_tier = case private.effective_plan(new)
    when 'free' then 'free' when 'enterprise' then 'premium' else 'standard' end
  where id = new.organization_id;
  return null;
end;
$$;
create trigger subscriptions_sync_tier after insert or update on public.subscriptions
  for each row execute function private.sync_subscription_tier();

create trigger subscriptions_audit after insert or update on public.subscriptions
  for each row execute function private.write_audit();

-- ============================================
-- PAYMENTS (Paystack transactions)
-- ============================================

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  reference text not null unique,
  kind text not null default 'initial' check (kind in ('initial','renewal')),
  plan_id text not null references public.plans (id),
  billing_cycle text not null check (billing_cycle in ('monthly','annual')),
  amount_kobo bigint not null,
  setup_fee_kobo bigint not null default 0,
  status text not null default 'initialized' check (status in ('initialized','success','failed','abandoned')),
  paystack_payload jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index payments_org_created_idx on public.payments (organization_id, created_at desc);
create index payments_plan_id_idx on public.payments (plan_id);
create index payments_created_by_idx on public.payments (created_by);

alter table public.payments enable row level security;
create policy "admins read payments" on public.payments
  for select to authenticated using (private.has_role(organization_id, private.admin_roles()));
revoke insert, update, delete on public.payments from anon, authenticated;
revoke all on public.payments from anon;

-- ============================================
-- create_workspace now takes the chosen plan
-- ============================================

drop function public.create_workspace(text, text, text, text, text, boolean, text);

create or replace function public.create_workspace(
  p_name text,
  p_slug text,
  p_organization_type text,
  p_state text default null,
  p_contact_phone text default null,
  p_joined_network boolean default false,
  p_plan_id text default 'free',
  p_billing_cycle text default 'monthly'
)
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  org public.organizations;
  admin_role text;
  plan public.plans;
  is_admin boolean := private.is_platform_admin();
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into plan from public.plans where id = coalesce(p_plan_id, 'free');
  if plan.id is null then
    raise exception 'Unknown plan %', p_plan_id using errcode = '22023';
  end if;
  if not plan.self_serve and not is_admin then
    raise exception 'The % plan is arranged through sales', plan.name using errcode = '42501';
  end if;
  if p_billing_cycle = 'annual' and plan.annual_price_kobo is null then
    raise exception 'The % plan has no annual billing', plan.name using errcode = '22023';
  end if;

  insert into public.organizations (
    name, slug, organization_type, sector, state, contact_email, contact_phone,
    joined_network, requested_plan, created_by
  )
  values (
    btrim(p_name), lower(btrim(p_slug)), p_organization_type,
    case p_organization_type when 'ngo' then 'NGO' when 'government' then 'Public' else 'Private' end,
    p_state, (select email from auth.users where id = uid), p_contact_phone,
    coalesce(p_joined_network, false), plan.id, uid
  )
  returning * into org;

  admin_role := case p_organization_type
    when 'ngo' then 'ngo-admin'
    when 'government' then 'government-admin'
    when 'hmo' then 'public-health-officer'
    when 'insurance' then 'public-health-officer'
    else 'hospital-admin'
  end;
  insert into public.memberships (organization_id, user_id, role) values (org.id, uid, admin_role);

  insert into public.subscriptions (organization_id, plan_id, billing_cycle, status, comped_by)
  values (
    org.id, plan.id, coalesce(p_billing_cycle, 'monthly'),
    case when is_admin then 'comped' when plan.id = 'free' then 'active' else 'pending_payment' end,
    case when is_admin then uid end
  );

  select * into org from public.organizations where id = org.id;  -- picks up synced tier
  return org;
end;
$$;
revoke execute on function public.create_workspace(text, text, text, text, text, boolean, text, text) from public, anon;
grant execute on function public.create_workspace(text, text, text, text, text, boolean, text, text) to authenticated;

-- Platform admins can put any existing workspace on any plan without payment.
create or replace function public.comp_subscription(p_organization_id uuid, p_plan_id text, p_billing_cycle text default 'monthly')
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  sub public.subscriptions;
begin
  if not private.is_platform_admin() then
    raise exception 'Only VitaLink platform admins can comp subscriptions' using errcode = '42501';
  end if;
  update public.subscriptions
  set plan_id = p_plan_id, billing_cycle = coalesce(p_billing_cycle, 'monthly'), status = 'comped',
      comped_by = auth.uid(), current_period_end = null
  where organization_id = p_organization_id
  returning * into sub;
  if sub.organization_id is null then
    raise exception 'No subscription for organization %', p_organization_id using errcode = 'P0002';
  end if;
  return sub;
end;
$$;
revoke execute on function public.comp_subscription(uuid, text, text) from public, anon;
grant execute on function public.comp_subscription(uuid, text, text) to authenticated;

-- Existing workspaces (created before billing existed): a platform admin's get the plan
-- they asked for, comped; everyone else starts on Free.
insert into public.subscriptions (organization_id, plan_id, status, comped_by)
select
  o.id,
  case when pa.email is not null and p.id is not null then p.id else 'free' end,
  case when pa.email is not null then 'comped' else 'active' end,
  case when pa.email is not null then o.created_by end
from public.organizations o
left join auth.users u on u.id = o.created_by and u.email_confirmed_at is not null
left join private.platform_admins pa on pa.email = lower(u.email)
left join public.plans p on p.id = o.requested_plan
on conflict (organization_id) do nothing;

-- OAuth providers put the display name in `name` rather than `full_name`.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;
