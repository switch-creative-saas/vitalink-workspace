-- New subscription plans (Free / Starter / Growth / Enterprise) with per-plan limits, no setup fees,
-- annual = 10 x monthly, and the Sentinel full-access add-on (NGN 50,000/month) for Starter and Growth.
-- Limits are enforced in the database; Sentinel access is provisioned per workspace.

-- ---------------------------------------------------------------------------
-- Plans

alter table public.plans
  add column if not exists tagline text,
  add column if not exists features text[] not null default '{}',
  add column if not exists max_staff integer,
  add column if not exists max_patients integer,
  add column if not exists max_drug_skus integer,
  add column if not exists nfc_cards_included integer not null default 0,
  add column if not exists sms_reminders boolean not null default false,
  add column if not exists sentinel_access text not null default 'none';

alter table public.plans drop constraint if exists plans_sentinel_access_check;
alter table public.plans add constraint plans_sentinel_access_check check (sentinel_access in ('none', 'read_only', 'full'));

update public.plans set
  name = 'Free', tagline = 'For solo practitioners and very small clinics testing the platform',
  monthly_price_kobo = 0, annual_price_kobo = 0, setup_fee_kobo = 0, self_serve = true, sort_order = 0,
  modules = array['dashboard','patients','health-identity','patient-identity','appointments','emr','human-resources','subscription','settings','help'],
  max_staff = 2, max_patients = 50, max_drug_skus = 0, nfc_cards_included = 0, sms_reminders = false, sentinel_access = 'none',
  features = array['Up to 2 staff accounts', 'Up to 50 patient records', 'Basic patient registration and search', 'Manual appointment scheduling (no reminders)',
    'Basic outpatient notes', 'No pharmacy, invoicing or reports', 'No NFC cards or Sentinel', 'VitaLink branding on all outputs'],
  paystack_plan_monthly = null, paystack_plan_annual = null
where id = 'free';

update public.plans set
  name = 'Starter', tagline = 'For small private clinics, 1–2 doctors',
  monthly_price_kobo = 4500000, annual_price_kobo = 45000000, setup_fee_kobo = 0, self_serve = true, sort_order = 1,
  modules = array['dashboard','patients','health-identity','patient-identity','appointments','emr','human-resources','billing','pharmacy','analytics','nfc-cards','subscription','settings','help'],
  max_staff = 5, max_patients = 500, max_drug_skus = 100, nfc_cards_included = 10, sms_reminders = true, sentinel_access = 'none',
  features = array['Everything in Free, plus:', 'Up to 5 staff accounts', 'Up to 500 patient records', 'Appointment reminders (SMS)',
    'Basic invoicing and receipts', 'Pharmacy stock tracking (up to 100 drug SKUs)', 'Basic monthly reports', '10 NFC cards included (more at ₦2,500/card)', 'Email support'],
  paystack_plan_monthly = null, paystack_plan_annual = null
where id = 'starter';

update public.plans set
  name = 'Growth', tagline = 'For mid-tier private hospitals, 3–15 doctors',
  monthly_price_kobo = 12000000, annual_price_kobo = 120000000, setup_fee_kobo = 0, self_serve = true, sort_order = 2,
  modules = array['dashboard','patients','health-identity','patient-identity','appointments','emr','human-resources','billing','pharmacy','analytics','nfc-cards',
    'telemedicine','laboratory','ai-clinical-intelligence','vitalink-network','switch-network','subscription','settings','help'],
  max_staff = 20, max_patients = null, max_drug_skus = null, nfc_cards_included = 25, sms_reminders = true, sentinel_access = 'read_only',
  features = array['Everything in Starter, plus:', 'Up to 20 staff accounts', 'Unlimited patient records', 'Full EMR with clinical note templates', 'Prescription management',
    'Full pharmacy (unlimited SKUs, low-stock alerts)', 'HMO/insurance billing and claims', 'Advanced analytics dashboard', 'Staff roles and permissions',
    'Sentinel disease surveillance (read-only)', '25 NFC cards included', 'VitaMind AI clinical decision support', 'Priority email + WhatsApp support'],
  paystack_plan_monthly = null, paystack_plan_annual = null
where id = 'growth';

update public.plans set
  name = 'Enterprise', tagline = 'For hospital chains, state facilities, NGOs and government',
  monthly_price_kobo = 25000000, annual_price_kobo = 300000000, setup_fee_kobo = 0, self_serve = false, sort_order = 3,
  modules = array['dashboard','patients','health-identity','patient-identity','appointments','emr','human-resources','billing','pharmacy','analytics','nfc-cards',
    'telemedicine','laboratory','ai-clinical-intelligence','vitalink-network','switch-network','administration','audit-logs','sentinel','vitamind-ai','subscription','settings','help'],
  max_staff = null, max_patients = null, max_drug_skus = null, nfc_cards_included = 0, sms_reminders = true, sentinel_access = 'full',
  features = array['Everything in Growth, plus:', 'Unlimited staff accounts', 'Multi-branch / multi-facility management', 'Full Sentinel access with outbreak alerts and public health reporting',
    'Custom integrations (lab systems, NHIS, HMO APIs)', 'Dedicated onboarding and training', 'SLA and uptime commitments', 'White-label option', 'Quarterly business reviews',
    'Custom NFC card design', 'Invoiced annually · from ₦3,000,000/year'],
  paystack_plan_monthly = null, paystack_plan_annual = null
where id = 'enterprise';

-- ---------------------------------------------------------------------------
-- Add-ons

create table if not exists public.plan_addons (
  id text primary key,
  name text not null,
  description text not null default '',
  monthly_price_kobo bigint not null,
  eligible_plans text[] not null default '{}',
  paystack_plan_monthly text,
  created_at timestamptz not null default now()
);
alter table public.plan_addons enable row level security;
drop policy if exists "Anyone signed in can read add-ons" on public.plan_addons;
create policy "Anyone signed in can read add-ons" on public.plan_addons for select to authenticated using (true);
grant select on public.plan_addons to authenticated;

insert into public.plan_addons (id, name, description, monthly_price_kobo, eligible_plans)
values ('sentinel', 'VitaLink Sentinel (full access)', 'Disease surveillance with outbreak alerts, heatmaps and public health reporting, powered by your own clinical data.',
        5000000, array['starter', 'growth'])
on conflict (id) do update set name = excluded.name, description = excluded.description, monthly_price_kobo = excluded.monthly_price_kobo, eligible_plans = excluded.eligible_plans;

create table if not exists public.subscription_addons (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  addon_id text not null references public.plan_addons (id),
  status text not null default 'pending_payment' check (status in ('active', 'pending_payment', 'past_due', 'cancelled', 'comped')),
  current_period_end timestamptz,
  paystack_customer_code text,
  paystack_subscription_code text,
  paystack_email_token text,
  comped_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, addon_id)
);
alter table public.subscription_addons enable row level security;
drop policy if exists "Members read their add-ons" on public.subscription_addons;
create policy "Members read their add-ons" on public.subscription_addons for select to authenticated
  using (exists (select 1 from public.memberships m where m.organization_id = subscription_addons.organization_id and m.user_id = (select auth.uid()) and m.status = 'active'));
grant select on public.subscription_addons to authenticated;

alter table public.payments add column if not exists addon_id text references public.plan_addons (id);
alter table public.payments drop constraint if exists payments_kind_check;
alter table public.payments add constraint payments_kind_check check (kind in ('initial', 'renewal', 'addon', 'addon_renewal'));

-- ---------------------------------------------------------------------------
-- Entitlements

create or replace function private.workspace_plan(p_organization_id uuid)
returns public.plans
language sql stable security definer set search_path = ''
as $$
  select p.* from public.plans p
  where p.id = coalesce((select private.effective_plan(s) from public.subscriptions s where s.organization_id = p_organization_id), 'free')
$$;

create or replace function private.addon_active(p_organization_id uuid, p_addon text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.subscription_addons a
    where a.organization_id = p_organization_id and a.addon_id = p_addon
      and (a.status = 'comped' or (a.status = 'active' and (a.current_period_end is null or a.current_period_end > now() - interval '3 days')))
  )
$$;

-- 'full' (Enterprise, or the add-on on an eligible plan), 'read_only' (Growth), otherwise 'none'.
create or replace function private.workspace_sentinel_access(p_organization_id uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_plan public.plans;
begin
  v_plan := private.workspace_plan(p_organization_id);
  if v_plan.sentinel_access = 'full' then return 'full'; end if;
  if private.addon_active(p_organization_id, 'sentinel')
     and v_plan.id = any (coalesce((select eligible_plans from public.plan_addons where id = 'sentinel'), '{}')) then
    return 'full';
  end if;
  return v_plan.sentinel_access;
end;
$$;

create or replace function public.workspace_entitlements(p_organization_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_plan public.plans;
  v_sub public.subscriptions;
  v_addon public.subscription_addons;
begin
  if not exists (select 1 from public.memberships where organization_id = p_organization_id and user_id = auth.uid() and status = 'active') then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;
  v_plan := private.workspace_plan(p_organization_id);
  select * into v_sub from public.subscriptions where organization_id = p_organization_id;
  select * into v_addon from public.subscription_addons where organization_id = p_organization_id and addon_id = 'sentinel';
  return jsonb_build_object(
    'planId', v_sub.plan_id,
    'effectivePlanId', v_plan.id,
    'status', v_sub.status,
    'billingCycle', v_sub.billing_cycle,
    'currentPeriodEnd', v_sub.current_period_end,
    'renews', v_sub.paystack_subscription_code is not null,
    'limits', jsonb_build_object('staff', v_plan.max_staff, 'patients', v_plan.max_patients, 'drugSkus', v_plan.max_drug_skus,
                                 'nfcCardsIncluded', v_plan.nfc_cards_included, 'smsReminders', v_plan.sms_reminders),
    'usage', jsonb_build_object(
      'staff', (select count(*) from public.memberships where organization_id = p_organization_id and status in ('active', 'invited'))
             + (select count(*) from public.staff_invitations where organization_id = p_organization_id and not accepted and expires_at > now()),
      'patients', (select count(*) from public.patients where organization_id = p_organization_id),
      'drugSkus', (select count(*) from public.drug_inventory where organization_id = p_organization_id and is_active)
    ),
    'sentinelAccess', private.workspace_sentinel_access(p_organization_id),
    'sentinelAddon', case when v_addon.organization_id is null then null else jsonb_build_object(
      'status', v_addon.status, 'currentPeriodEnd', v_addon.current_period_end, 'renews', v_addon.paystack_subscription_code is not null) end
  );
end;
$$;
grant execute on function public.workspace_entitlements(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Limits (new rows only; existing data is never removed)

create or replace function private.enforce_staff_limit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_plan public.plans; v_used integer;
begin
  if tg_table_name = 'memberships' and (new.status not in ('active', 'invited') or (tg_op = 'UPDATE' and old.status in ('active', 'invited'))) then
    return new;
  end if;
  v_plan := private.workspace_plan(new.organization_id);
  if v_plan.max_staff is null then return new; end if;
  select (select count(*) from public.memberships where organization_id = new.organization_id and status in ('active', 'invited'))
       + (select count(*) from public.staff_invitations where organization_id = new.organization_id and not accepted and expires_at > now())
    into v_used;
  -- An invitation being accepted turns into a membership: don't count the person twice.
  if tg_table_name = 'memberships' and exists (
    select 1 from public.staff_invitations i join auth.users u on lower(u.email) = lower(i.email)
    where i.organization_id = new.organization_id and u.id = new.user_id and not i.accepted and i.expires_at > now()) then
    v_used := v_used - 1;
  end if;
  if v_used >= v_plan.max_staff then
    raise exception 'Your % plan allows up to % staff accounts. Upgrade your plan to add more people.', v_plan.name, v_plan.max_staff using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_staff_limit on public.staff_invitations;
create trigger enforce_staff_limit before insert on public.staff_invitations for each row execute function private.enforce_staff_limit();
drop trigger if exists enforce_staff_limit on public.memberships;
create trigger enforce_staff_limit before insert or update of status on public.memberships for each row execute function private.enforce_staff_limit();

create or replace function private.enforce_patient_limit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_plan public.plans;
begin
  v_plan := private.workspace_plan(new.organization_id);
  if v_plan.max_patients is not null and (select count(*) from public.patients where organization_id = new.organization_id) >= v_plan.max_patients then
    raise exception 'Your % plan holds up to % patient records. Upgrade your plan to register more patients.', v_plan.name, v_plan.max_patients using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_patient_limit on public.patients;
create trigger enforce_patient_limit before insert on public.patients for each row execute function private.enforce_patient_limit();

create or replace function private.enforce_drug_sku_limit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_plan public.plans;
begin
  if not new.is_active or (tg_op = 'UPDATE' and old.is_active) then return new; end if;
  v_plan := private.workspace_plan(new.organization_id);
  if v_plan.max_drug_skus is not null and (select count(*) from public.drug_inventory where organization_id = new.organization_id and is_active) >= v_plan.max_drug_skus then
    raise exception 'Your % plan tracks up to % drugs. Upgrade to Growth for unlimited pharmacy stock.', v_plan.name, v_plan.max_drug_skus using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists enforce_drug_sku_limit on public.drug_inventory;
create trigger enforce_drug_sku_limit before insert or update of is_active on public.drug_inventory for each row execute function private.enforce_drug_sku_limit();

-- ---------------------------------------------------------------------------
-- Sentinel for hospital workspaces

alter table public.sentinel_organizations drop constraint if exists sentinel_organizations_type_check;
alter table public.sentinel_organizations add constraint sentinel_organizations_type_check
  check (type in ('NGO', 'Government', 'Ministry', 'International', 'Research', 'Academic', 'Hospital'));
alter table public.sentinel_organizations add column if not exists vitalink_org_id uuid unique references public.organizations (id) on delete set null;

-- Keeps the workspace's own Sentinel organisation in line with what it pays for:
-- full = admins stay admins (others officers), read-only = everyone a viewer, none = switched off.
create or replace function private.sync_workspace_sentinel(p_organization_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_access text; v_sentinel uuid;
begin
  select id into v_sentinel from public.sentinel_organizations where vitalink_org_id = p_organization_id;
  if v_sentinel is null then return; end if;
  v_access := private.workspace_sentinel_access(p_organization_id);
  update public.sentinel_organizations set is_active = (v_access <> 'none'), updated_at = now() where id = v_sentinel;
  if v_access = 'none' then
    update public.sentinel_users set is_active = false, updated_at = now() where sentinel_org_id = v_sentinel and is_active;
  elsif v_access = 'read_only' then
    update public.sentinel_users set role = 'viewer', is_active = true, updated_at = now() where sentinel_org_id = v_sentinel and (role <> 'viewer' or not is_active);
  else
    update public.sentinel_users su set is_active = true, updated_at = now(),
      role = case when exists (select 1 from public.memberships m where m.organization_id = p_organization_id and m.user_id = su.id and m.status = 'active'
                                and m.role = any (private.admin_roles())) then 'admin' else 'officer' end
    where su.sentinel_org_id = v_sentinel;
  end if;
end;
$$;

create or replace function private.on_entitlement_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.sync_workspace_sentinel(new.organization_id);
  return new;
end;
$$;
drop trigger if exists sync_sentinel_on_subscription on public.subscriptions;
create trigger sync_sentinel_on_subscription after insert or update on public.subscriptions for each row execute function private.on_entitlement_change();
drop trigger if exists sync_sentinel_on_addon on public.subscription_addons;
create trigger sync_sentinel_on_addon after insert or update on public.subscription_addons for each row execute function private.on_entitlement_change();

-- "Open Sentinel" from a workspace: returns the Sentinel organisation to open, creating the
-- workspace's own (with its facility already sharing data) the first time.
create or replace function public.open_workspace_sentinel(p_organization_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_member public.memberships;
  v_org public.organizations;
  v_access text;
  v_sentinel uuid;
  v_existing public.sentinel_users;
  v_profile record;
begin
  select * into v_member from public.memberships where organization_id = p_organization_id and user_id = v_uid and status = 'active';
  if v_member.id is null then raise exception 'Not a member of this workspace' using errcode = '42501'; end if;
  v_access := private.workspace_sentinel_access(p_organization_id);
  if v_access = 'none' then
    return jsonb_build_object('access', 'none');
  end if;

  select * into v_existing from public.sentinel_users where id = v_uid;
  select id into v_sentinel from public.sentinel_organizations where vitalink_org_id = p_organization_id;

  -- Already in another Sentinel organisation (e.g. an NGO): open that one.
  if v_existing.id is not null and (v_sentinel is null or v_existing.sentinel_org_id <> v_sentinel) then
    return jsonb_build_object('access', v_access, 'sentinelOrgId', v_existing.sentinel_org_id, 'own', false);
  end if;

  select * into v_org from public.organizations where id = p_organization_id;
  if v_sentinel is null then
    if not (v_member.role = any (private.admin_roles())) then
      return jsonb_build_object('access', v_access, 'needsAdmin', true);
    end if;
    insert into public.sentinel_organizations (name, type, state, country, contact_email, contact_phone, joined_network, vitalink_org_id)
    values (v_org.name, 'Hospital', coalesce(nullif(v_org.state, ''), 'National'), coalesce(v_org.country, 'Nigeria'), v_org.contact_email, v_org.contact_phone, true, v_org.id)
    returning id into v_sentinel;
    insert into public.sentinel_linked_facilities (sentinel_org_id, facility_name, facility_type, state, vitalink_org_id, data_sharing_consent,
                                                   reporting_frequency, is_active, consent_status, requested_by, consented_by, consented_at)
    values (v_sentinel, v_org.name, 'Hospital', coalesce(nullif(v_org.state, ''), 'Statewide'), v_org.id, true, 'daily', true, 'approved', v_uid, v_uid, now());
  end if;

  if v_existing.id is null then
    select coalesce(nullif(p.full_name, ''), u.email) as name, u.email into v_profile
    from auth.users u left join public.profiles p on p.id = u.id where u.id = v_uid;
    insert into public.sentinel_users (id, sentinel_org_id, full_name, email, role, is_active)
    values (v_uid, v_sentinel, v_profile.name, v_profile.email, 'viewer', true);
  end if;
  perform private.sync_workspace_sentinel(p_organization_id);
  return jsonb_build_object('access', v_access, 'sentinelOrgId', v_sentinel, 'own', true);
end;
$$;
grant execute on function public.open_workspace_sentinel(uuid) to authenticated;

-- Add-ons and plans that lapse without a webhook (period simply ran out): switch Sentinel off daily.
create or replace function private.sync_all_workspace_sentinels()
returns void
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  for r in select vitalink_org_id from public.sentinel_organizations where vitalink_org_id is not null loop
    perform private.sync_workspace_sentinel(r.vitalink_org_id);
  end loop;
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'workspace-sentinel-sync') then
    perform cron.unschedule('workspace-sentinel-sync');
  end if;
  perform cron.schedule('workspace-sentinel-sync', '20 1 * * *', 'select private.sync_all_workspace_sentinels()');
end $$;
