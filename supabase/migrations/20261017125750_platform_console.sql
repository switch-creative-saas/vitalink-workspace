-- VitaLink Console: a private back office for VitaLink platform admins.
-- Everything goes through SECURITY DEFINER functions that first require
-- private.is_platform_admin() (confirmed email on private.platform_admins), so a
-- non-admin who finds the page gets errors and no data. Business data only:
-- workspaces, plans, payments, card orders and staff lists; patients appear as
-- counts, never records. Every console action is written to
-- public.platform_audit_log.

create or replace function private.require_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Not available' using errcode = '42501';
  end if;
end;
$$;

-- ============================================
-- AUDIT LOG
-- ============================================

create table public.platform_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_email text not null default '',
  action text not null,
  organization_id uuid references public.organizations (id) on delete set null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index platform_audit_log_created_idx on public.platform_audit_log (created_at desc);
create index platform_audit_log_org_idx on public.platform_audit_log (organization_id, created_at desc);
create index platform_audit_log_actor_idx on public.platform_audit_log (actor_id);

alter table public.platform_audit_log enable row level security;
create policy "platform admins read the console log" on public.platform_audit_log
  for select to authenticated using (private.is_platform_admin());
revoke all on public.platform_audit_log from anon, authenticated;
grant select on public.platform_audit_log to authenticated;

create or replace function private.console_log(p_action text, p_org uuid, p_details jsonb default '{}')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.platform_audit_log (actor_id, actor_email, action, organization_id, details)
  values (auth.uid(), coalesce((select u.email from auth.users u where u.id = auth.uid()), ''), p_action, p_org, coalesce(p_details, '{}'))
$$;

-- Card-order and settings changes made by platform admins are logged too.
create or replace function private.console_log_nfc_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_platform_admin() and (new.status is distinct from old.status or new.tracking_number is distinct from old.tracking_number) then
    perform private.console_log('card_order.' || new.status, new.organization_id,
      jsonb_build_object('order', new.order_number, 'from', old.status, 'to', new.status, 'courier', new.courier, 'tracking', new.tracking_number));
  end if;
  return null;
end;
$$;
create trigger nfc_card_orders_console_log after update on public.nfc_card_orders
  for each row execute function private.console_log_nfc_order();

create or replace function private.console_log_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.console_log('settings.updated', null, jsonb_build_object(
    'delivery_fee_kobo', new.nfc_delivery_fee_kobo, 'pickup_address', new.nfc_pickup_address,
    'dispatch_days', new.nfc_dispatch_days, 'bank_name', new.bank_name,
    'bank_details_changed', (new.bank_account_number is distinct from old.bank_account_number or new.bank_account_name is distinct from old.bank_account_name)));
  return null;
end;
$$;
create trigger platform_settings_console_log after update on public.platform_settings
  for each row execute function private.console_log_settings();

-- ============================================
-- READ: overview, workspaces, one workspace, payments, log
-- ============================================

-- Monthly value of a subscription that is paying right now (annual / 12).
create or replace function private.monthly_value_kobo(s public.subscriptions)
returns bigint
language sql
stable
set search_path = ''
as $$
  select case
    when s.status = 'active' and private.effective_plan(s) <> 'free' then
      coalesce((select case when s.billing_cycle = 'annual' then coalesce(p.annual_price_kobo, p.monthly_price_kobo * 12) / 12 else p.monthly_price_kobo end
                from public.plans p where p.id = s.plan_id), 0)
    else 0
  end
$$;

create or replace function public.console_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  month_start timestamptz := date_trunc('month', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  last_month_start timestamptz := month_start - interval '1 month';
begin
  perform private.require_platform_admin();
  return jsonb_build_object(
    'workspaces', (select count(*) from public.organizations),
    'workspaces_new_this_month', (select count(*) from public.organizations where created_at >= month_start),
    'users', (select count(*) from public.profiles),
    'users_new_this_month', (select count(*) from public.profiles where created_at >= month_start),
    'paying', (select count(*) from public.subscriptions s where s.status = 'active' and private.effective_plan(s) <> 'free'),
    'trialing', (select count(*) from public.subscriptions s where s.status = 'trialing' and s.current_period_end > now()),
    'trials_ending_7d', (select count(*) from public.subscriptions s where s.status = 'trialing' and s.current_period_end between now() and now() + interval '7 days'),
    'comped', (select count(*) from public.subscriptions where status = 'comped'),
    'free', (select count(*) from public.subscriptions s where private.effective_plan(s) = 'free'),
    'past_due', (select count(*) from public.subscriptions where status = 'past_due'),
    'pending_payment', (select count(*) from public.subscriptions where status = 'pending_payment'),
    'mrr_kobo', (select coalesce(sum(private.monthly_value_kobo(s)), 0) from public.subscriptions s),
    'revenue_this_month_kobo',
      (select coalesce(sum(amount_kobo), 0) from public.payments where status = 'success' and paid_at >= month_start)
      + (select coalesce(sum(total_kobo), 0) from public.nfc_card_orders where paid_at >= month_start and status <> 'cancelled'),
    'revenue_last_month_kobo',
      (select coalesce(sum(amount_kobo), 0) from public.payments where status = 'success' and paid_at >= last_month_start and paid_at < month_start)
      + (select coalesce(sum(total_kobo), 0) from public.nfc_card_orders where paid_at >= last_month_start and paid_at < month_start and status <> 'cancelled'),
    'card_orders_awaiting_payment', (select count(*) from public.nfc_card_orders where status = 'processing'),
    'card_orders_to_dispatch', (select count(*) from public.nfc_card_orders where status = 'paid'),
    'card_orders_in_transit', (select count(*) from public.nfc_card_orders where status = 'dispatched'),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('plan', x.plan_id, 'count', x.n) order by x.n desc), '[]'::jsonb)
              from (select private.effective_plan(s) as plan_id, count(*) n from public.subscriptions s group by 1) x)
  );
end;
$$;

create or replace function public.console_workspaces(p_search text default null)
returns table (
  id uuid, name text, slug text, organization_type text, state text, contact_email text, contact_phone text,
  created_at timestamptz, owner_email text, plan_id text, plan_name text, effective_plan text, status text,
  billing_cycle text, current_period_end timestamptz, staff_count integer, patient_count integer,
  last_payment_at timestamptz, revenue_kobo bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  needle text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_platform_admin();
  return query
  select o.id, o.name, o.slug, o.organization_type, o.state, o.contact_email, o.contact_phone,
         o.created_at, owner.email, s.plan_id, p.name, private.effective_plan(s), s.status,
         s.billing_cycle, s.current_period_end,
         (select count(*) from public.memberships m where m.organization_id = o.id and m.status = 'active')::integer,
         (select count(*) from public.patients pt where pt.organization_id = o.id)::integer,
         greatest((select max(pay.paid_at) from public.payments pay where pay.organization_id = o.id and pay.status = 'success'),
                  (select max(n.paid_at) from public.nfc_card_orders n where n.organization_id = o.id)),
         (select coalesce(sum(pay.amount_kobo), 0) from public.payments pay where pay.organization_id = o.id and pay.status = 'success')
           + (select coalesce(sum(n.total_kobo), 0) from public.nfc_card_orders n where n.organization_id = o.id and n.paid_at is not null and n.status <> 'cancelled')
  from public.organizations o
  left join public.subscriptions s on s.organization_id = o.id
  left join public.plans p on p.id = s.plan_id
  left join public.profiles owner on owner.id = o.created_by
  where needle is null
     or o.name ilike '%' || needle || '%' or o.slug ilike '%' || needle || '%'
     or coalesce(o.contact_email, '') ilike '%' || needle || '%' or coalesce(owner.email, '') ilike '%' || needle || '%'
     or coalesce(o.state, '') ilike '%' || needle || '%'
  order by o.created_at desc
  limit 500;
end;
$$;

create or replace function public.console_workspace(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org public.organizations;
begin
  perform private.require_platform_admin();
  select * into org from public.organizations where id = p_organization_id;
  if org.id is null then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'workspace', jsonb_build_object(
      'id', org.id, 'name', org.name, 'slug', org.slug, 'organization_type', org.organization_type,
      'workspace_type', org.workspace_type, 'state', org.state, 'country', org.country, 'address', org.address,
      'contact_email', org.contact_email, 'contact_phone', org.contact_phone, 'website', org.website,
      'joined_network', org.joined_network, 'created_at', org.created_at,
      'owner_email', (select email from public.profiles where id = org.created_by)),
    'subscription', (select jsonb_build_object(
      'plan_id', s.plan_id, 'plan_name', p.name, 'effective_plan', private.effective_plan(s), 'status', s.status,
      'billing_cycle', s.billing_cycle, 'current_period_end', s.current_period_end,
      'has_recurring', s.paystack_subscription_code is not null,
      'comped_by', (select email from public.profiles where id = s.comped_by), 'updated_at', s.updated_at)
      from public.subscriptions s left join public.plans p on p.id = s.plan_id where s.organization_id = org.id),
    'counts', jsonb_build_object(
      'patients', (select count(*) from public.patients where organization_id = org.id),
      'appointments_30d', (select count(*) from public.appointments where organization_id = org.id and starts_at >= now() - interval '30 days'),
      'invoices_30d', (select count(*) from public.invoices where organization_id = org.id and created_at >= now() - interval '30 days'),
      'video_visits_30d', (select count(*) from public.telemedicine_sessions where organization_id = org.id and status = 'ended' and ended_at >= now() - interval '30 days')),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', pr.full_name, 'email', pr.email, 'role', m.role, 'status', m.status, 'joined', m.created_at,
               'last_sign_in', u.last_sign_in_at) order by m.created_at)
      from public.memberships m
      join public.profiles pr on pr.id = m.user_id
      left join auth.users u on u.id = m.user_id
      where m.organization_id = org.id), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'reference', pay.reference, 'kind', pay.kind, 'plan_id', pay.plan_id, 'billing_cycle', pay.billing_cycle,
               'amount_kobo', pay.amount_kobo, 'setup_fee_kobo', pay.setup_fee_kobo, 'status', pay.status,
               'created_at', pay.created_at, 'paid_at', pay.paid_at) order by pay.created_at desc)
      from public.payments pay where pay.organization_id = org.id), '[]'::jsonb),
    'card_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_number', n.order_number, 'quantity', n.quantity, 'total_kobo', n.total_kobo, 'status', n.status,
               'payment_method', n.payment_method, 'delivery_option', n.delivery_option, 'delivery_address', n.delivery_address,
               'contact_name', n.delivery_contact_name, 'contact_phone', n.delivery_contact_phone,
               'ordered_at', n.ordered_at, 'paid_at', n.paid_at) order by n.ordered_at desc)
      from public.nfc_card_orders n where n.organization_id = org.id), '[]'::jsonb),
    'log', coalesce((
      select jsonb_agg(jsonb_build_object('action', l.action, 'actor', l.actor_email, 'details', l.details, 'at', l.created_at) order by l.created_at desc)
      from (select * from public.platform_audit_log where organization_id = org.id order by created_at desc limit 50) l), '[]'::jsonb)
  );
end;
$$;

-- Subscription payments and paid card orders in one list, newest first.
create or replace function public.console_payments(p_limit integer default 200)
returns table (
  occurred_at timestamptz, organization_id uuid, organization_name text, kind text, description text,
  amount_kobo bigint, status text, reference text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return query
  select * from (
    select coalesce(pay.paid_at, pay.created_at), pay.organization_id, o.name, 'subscription'::text,
           p.name || ' (' || pay.billing_cycle || ')' || case when pay.kind = 'renewal' then ' renewal' else '' end
             || case when pay.setup_fee_kobo > 0 then ' incl. setup fee' else '' end,
           pay.amount_kobo, pay.status, pay.reference
    from public.payments pay
    join public.organizations o on o.id = pay.organization_id
    left join public.plans p on p.id = pay.plan_id
    union all
    select n.paid_at, n.organization_id, o.name, 'card_order'::text,
           n.order_number || ' · ' || n.quantity || ' VitaCards (' || replace(n.payment_method, '_', ' ') || ')',
           n.total_kobo, case when n.status = 'cancelled' then 'refund_due' else 'success' end, coalesce(n.paystack_reference, n.order_number)
    from public.nfc_card_orders n
    join public.organizations o on o.id = n.organization_id
    where n.paid_at is not null
  ) all_payments
  order by 1 desc nulls last
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;

create or replace function public.console_log(p_limit integer default 200)
returns setof public.platform_audit_log
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return query select * from public.platform_audit_log order by created_at desc limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;

-- ============================================
-- WRITE: plans and trials
-- ============================================

-- p_action: 'comp' (plan free of charge until changed), 'trial' (plan for p_days),
-- 'extend' (push the current period end by p_days), 'free' (move to the Free plan).
create or replace function public.console_set_subscription(
  p_organization_id uuid,
  p_action text,
  p_plan_id text default null,
  p_days integer default null,
  p_reason text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  before public.subscriptions;
  after public.subscriptions;
begin
  perform private.require_platform_admin();
  select * into before from public.subscriptions where organization_id = p_organization_id for update;
  if before.organization_id is null then
    raise exception 'This workspace has no subscription record' using errcode = 'P0002';
  end if;
  if p_action in ('comp', 'trial') and not exists (select 1 from public.plans where id = p_plan_id) then
    raise exception 'Unknown plan' using errcode = '22023';
  end if;
  if p_action in ('trial', 'extend') and coalesce(p_days, 0) not between 1 and 366 then
    raise exception 'Days must be between 1 and 366' using errcode = '22023';
  end if;

  if p_action = 'comp' then
    update public.subscriptions set plan_id = p_plan_id, status = 'comped', comped_by = auth.uid(), current_period_end = null
    where organization_id = p_organization_id returning * into after;
  elsif p_action = 'trial' then
    update public.subscriptions set plan_id = p_plan_id, status = 'trialing', comped_by = null,
           current_period_end = now() + make_interval(days => p_days)
    where organization_id = p_organization_id returning * into after;
  elsif p_action = 'extend' then
    if before.status not in ('trialing', 'active', 'past_due') then
      raise exception 'Only trials and paid plans have a period to extend' using errcode = '22023';
    end if;
    update public.subscriptions
    set current_period_end = greatest(coalesce(current_period_end, now()), now()) + make_interval(days => p_days),
        status = case when status = 'past_due' then 'active' else status end
    where organization_id = p_organization_id returning * into after;
  elsif p_action = 'free' then
    update public.subscriptions set plan_id = 'free', status = 'active', comped_by = null, current_period_end = null
    where organization_id = p_organization_id returning * into after;
  else
    raise exception 'Unknown action' using errcode = '22023';
  end if;

  perform private.console_log('subscription.' || p_action, p_organization_id, jsonb_build_object(
    'reason', nullif(btrim(coalesce(p_reason, '')), ''),
    'from', jsonb_build_object('plan', before.plan_id, 'status', before.status, 'period_end', before.current_period_end),
    'to', jsonb_build_object('plan', after.plan_id, 'status', after.status, 'period_end', after.current_period_end)));
end;
$$;

-- ============================================
-- WRITE: who is a platform admin
-- ============================================

create or replace function public.console_admins()
returns table (email text, added_at timestamptz, has_account boolean, last_sign_in timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_admin();
  return query
  select pa.email, pa.created_at, (u.id is not null and u.email_confirmed_at is not null), u.last_sign_in_at
  from private.platform_admins pa
  left join auth.users u on lower(u.email) = pa.email
  order by pa.created_at;
end;
$$;

create or replace function public.console_add_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  address text := lower(btrim(coalesce(p_email, '')));
begin
  perform private.require_platform_admin();
  if address !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  insert into private.platform_admins (email) values (address) on conflict (email) do nothing;
  perform private.console_log('admin.added', null, jsonb_build_object('email', address));
end;
$$;

create or replace function public.console_remove_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  address text := lower(btrim(coalesce(p_email, '')));
begin
  perform private.require_platform_admin();
  if (select count(*) from private.platform_admins) <= 1 then
    raise exception 'There must always be at least one platform admin' using errcode = '22023';
  end if;
  if address = (select lower(u.email) from auth.users u where u.id = auth.uid()) then
    raise exception 'You cannot remove yourself; ask another platform admin' using errcode = '22023';
  end if;
  delete from private.platform_admins where email = address;
  perform private.console_log('admin.removed', null, jsonb_build_object('email', address));
end;
$$;

-- ============================================
-- GRANTS: signed-in users only (each function re-checks the admin list)
-- ============================================

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.console_overview()',
    'public.console_workspaces(text)',
    'public.console_workspace(uuid)',
    'public.console_payments(integer)',
    'public.console_log(integer)',
    'public.console_set_subscription(uuid, text, text, integer, text)',
    'public.console_admins()',
    'public.console_add_admin(text)',
    'public.console_remove_admin(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
revoke execute on function private.require_platform_admin(), private.console_log(text, uuid, jsonb), private.monthly_value_kobo(public.subscriptions) from public, anon;
