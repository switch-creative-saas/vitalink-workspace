-- organizations.subscription_tier was changed outside the migrations to plan names
-- ('free','starter','growth','enterprise','trialing'), while both apps and
-- private.sync_subscription_tier() use 'free' | 'standard' | 'premium'. With the
-- drifted rule, any move to a Starter/Growth plan or trial failed. Restore the
-- documented values and recompute them from each workspace's effective plan.
alter table public.organizations drop constraint organizations_subscription_tier_check;
update public.organizations o
set subscription_tier = case coalesce((select private.effective_plan(s) from public.subscriptions s where s.organization_id = o.id), 'free')
  when 'free' then 'free' when 'enterprise' then 'premium' else 'standard' end;
alter table public.organizations add constraint organizations_subscription_tier_check
  check (subscription_tier in ('free', 'standard', 'premium'));
