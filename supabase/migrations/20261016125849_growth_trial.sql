-- 14-day Growth trial alongside the Free plan. A trial is a subscription in
-- status 'trialing' whose current_period_end is the trial end; afterwards the
-- workspace falls back to Free unless it has paid. One trial per account.

alter table public.subscriptions drop constraint subscriptions_status_check;
alter table public.subscriptions add constraint subscriptions_status_check
  check (status in ('active','trialing','pending_payment','past_due','cancelled','comped'));

create or replace function private.effective_plan(s public.subscriptions)
returns text
language sql stable
set search_path = ''
as $$
  select case
    when s.status = 'comped' then s.plan_id
    when s.status = 'trialing' and s.current_period_end > now() then s.plan_id
    when s.status = 'active' and (s.current_period_end is null or s.current_period_end > now() - interval '3 days') then s.plan_id
    else 'free'
  end
$$;

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
  is_trial boolean := coalesce(p_plan_id, 'free') = 'trial';
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if is_trial and not is_admin and exists (
    select 1 from public.organizations where created_by = uid and requested_plan = 'trial'
  ) then
    raise exception 'You have already used your free trial. Choose the Free plan or a paid plan.' using errcode = '42501';
  end if;

  select * into plan from public.plans where id = case when is_trial then 'growth' else coalesce(p_plan_id, 'free') end;
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
    coalesce(p_joined_network, false), case when is_trial then 'trial' else plan.id end, uid
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

  insert into public.subscriptions (organization_id, plan_id, billing_cycle, status, current_period_end, comped_by)
  values (
    org.id, plan.id, coalesce(p_billing_cycle, 'monthly'),
    case when is_admin then 'comped' when is_trial then 'trialing' when plan.id = 'free' then 'active' else 'pending_payment' end,
    case when is_trial and not is_admin then now() + interval '14 days' end,
    case when is_admin then uid end
  );

  select * into org from public.organizations where id = org.id;
  return org;
end;
$$;
