-- VitaCard (NFC) ordering, end to end.
--  * Prices and pack sizes come from the database: per-plan card price and
--    minimum pack on public.plans; delivery fee, pickup address and bank-transfer
--    details in public.platform_settings (edited by VitaLink platform admins).
--  * Orders get a number and a lifecycle: processing (awaiting payment) → paid →
--    dispatched → delivered, or cancelled. Workspace admins place / cancel;
--    payment is confirmed by Paystack (service role) or by a platform admin for
--    bank transfers; platform admins dispatch and deliver.

-- ============================================
-- PRICING SOURCES
-- ============================================

alter table public.plans
  add column nfc_card_price_kobo bigint not null default 250000 check (nfc_card_price_kobo >= 0),
  add column nfc_min_pack integer not null default 100 check (nfc_min_pack > 0);

create table public.platform_settings (
  id boolean primary key default true check (id),
  nfc_delivery_fee_kobo bigint not null default 500000 check (nfc_delivery_fee_kobo >= 0),
  nfc_pickup_address text not null default '',
  nfc_dispatch_days integer not null default 3 check (nfc_dispatch_days between 0 and 60),
  bank_name text not null default '',
  bank_account_name text not null default '',
  bank_account_number text not null default '',
  support_email text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into public.platform_settings (id) values (true);

alter table public.platform_settings enable row level security;
create policy "signed-in users read platform settings" on public.platform_settings
  for select to authenticated using (true);
create policy "platform admins edit platform settings" on public.platform_settings
  for update to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());
revoke all on public.platform_settings from anon;
grant select, update on public.platform_settings to authenticated;

create or replace function private.platform_settings_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.id := true;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger platform_settings_stamp before update on public.platform_settings
  for each row execute function private.platform_settings_stamp();

-- ============================================
-- ORDERS
-- ============================================

create sequence private.nfc_order_serial;

alter table public.nfc_card_orders
  add column order_number text unique,
  add column payment_method text not null default 'paystack' check (payment_method in ('paystack', 'bank_transfer')),
  add column courier text,
  add column paid_at timestamptz,
  add column dispatched_at timestamptz,
  add column delivered_at timestamptz,
  add column cancelled_at timestamptz,
  add column total_kobo bigint generated always as (quantity * price_per_card_kobo + delivery_fee_kobo) stored;

create or replace function private.nfc_order_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  plan public.plans;
  settings public.platform_settings;
  is_service boolean := auth.uid() is null;
  is_platform boolean := private.is_platform_admin();
begin
  if tg_op = 'INSERT' then
    select * into plan from public.plans p
    where p.id = coalesce((select private.effective_plan(s) from public.subscriptions s where s.organization_id = new.organization_id), 'free');
    select * into settings from public.platform_settings;
    if new.quantity < plan.nfc_min_pack or new.quantity % plan.nfc_min_pack <> 0 then
      raise exception 'VitaCards are ordered in packs of %', plan.nfc_min_pack using errcode = '23514';
    end if;
    if new.delivery_option = 'delivery' and coalesce(btrim(new.delivery_address), '') = '' then
      raise exception 'Enter the delivery address' using errcode = '23514';
    end if;
    new.ordered_by := auth.uid();
    new.order_number := 'NFC-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('private.nfc_order_serial')::text, 4, '0');
    new.price_per_card_kobo := plan.nfc_card_price_kobo;
    new.delivery_fee_kobo := case when new.delivery_option = 'delivery' then settings.nfc_delivery_fee_kobo else 0 end;
    new.status := 'processing';
    new.paystack_reference := null;
    new.tracking_number := null;
    new.courier := null;
    new.estimated_delivery_date := null;
    new.paid_at := null; new.dispatched_at := null; new.delivered_at := null; new.cancelled_at := null;
    new.ordered_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- Fixed for everyone after the order is placed.
  new.organization_id := old.organization_id;
  new.order_number := old.order_number;
  new.ordered_by := old.ordered_by;
  new.quantity := old.quantity;
  new.price_per_card_kobo := old.price_per_card_kobo;
  new.delivery_fee_kobo := old.delivery_fee_kobo;
  new.ordered_at := old.ordered_at;

  if new.status is distinct from old.status then
    if old.status in ('delivered', 'cancelled') then
      raise exception 'Order % is already %', old.order_number, old.status using errcode = '42501';
    end if;
    if new.status = 'cancelled' then
      if old.status <> 'processing' and not (is_platform or is_service) then
        raise exception 'Paid orders can only be cancelled by VitaLink; contact support' using errcode = '42501';
      end if;
      new.cancelled_at := now();
    elsif not (is_platform or is_service) then
      raise exception 'Order status is updated by VitaLink' using errcode = '42501';
    elsif new.status = 'paid' then
      new.paid_at := coalesce(old.paid_at, now());
    elsif new.status = 'dispatched' then
      if old.status <> 'paid' then
        raise exception 'Only paid orders can be dispatched' using errcode = '22023';
      end if;
      new.dispatched_at := now();
    elsif new.status = 'delivered' then
      if old.status <> 'dispatched' then
        raise exception 'Only dispatched orders can be marked delivered' using errcode = '22023';
      end if;
      new.delivered_at := now();
    end if;
  end if;

  if not (is_platform or is_service) then
    -- Workspace admins may only fix delivery details / notes before payment.
    if old.status <> 'processing' and (
         new.delivery_option is distinct from old.delivery_option or new.delivery_address is distinct from old.delivery_address
         or new.delivery_contact_name is distinct from old.delivery_contact_name or new.delivery_contact_phone is distinct from old.delivery_contact_phone) then
      raise exception 'Delivery details can no longer be changed; contact support' using errcode = '42501';
    end if;
    new.payment_method := case when old.status = 'processing' then new.payment_method else old.payment_method end;
    new.paystack_reference := old.paystack_reference;
    new.tracking_number := old.tracking_number;
    new.courier := old.courier;
    new.estimated_delivery_date := old.estimated_delivery_date;
    new.paid_at := old.paid_at; new.dispatched_at := old.dispatched_at; new.delivered_at := old.delivered_at;
    if new.delivery_option is distinct from old.delivery_option then
      new.delivery_fee_kobo := case when new.delivery_option = 'delivery' then (select s.nfc_delivery_fee_kobo from public.platform_settings s) else 0 end;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Platform admins (VitaLink) see and manage every workspace's orders.
create policy "platform admins read all nfc orders" on public.nfc_card_orders
  for select to authenticated using (private.is_platform_admin());
create policy "platform admins manage nfc orders" on public.nfc_card_orders
  for update to authenticated using (private.is_platform_admin()) with check (private.is_platform_admin());

create index nfc_card_orders_open_idx on public.nfc_card_orders (status) where status in ('processing', 'paid', 'dispatched');

-- Fulfilment queue for VitaLink, with the ordering workspace's name and contact.
create or replace function public.platform_nfc_orders()
returns table (
  id uuid, order_number text, organization_id uuid, organization_name text, organization_phone text,
  quantity integer, total_kobo bigint, payment_method text, status text,
  delivery_option text, delivery_address text, delivery_contact_name text, delivery_contact_phone text,
  courier text, tracking_number text, estimated_delivery_date date, notes text,
  ordered_by_email text, ordered_at timestamptz, paid_at timestamptz, dispatched_at timestamptz, delivered_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_number, o.organization_id, org.name, org.contact_phone,
         o.quantity, o.total_kobo, o.payment_method, o.status,
         o.delivery_option, o.delivery_address, o.delivery_contact_name, o.delivery_contact_phone,
         o.courier, o.tracking_number, o.estimated_delivery_date, o.notes,
         pr.email, o.ordered_at, o.paid_at, o.dispatched_at, o.delivered_at
  from public.nfc_card_orders o
  join public.organizations org on org.id = o.organization_id
  left join public.profiles pr on pr.id = o.ordered_by
  where private.is_platform_admin()
  order by (o.status in ('processing', 'paid', 'dispatched')) desc, o.ordered_at desc
  limit 300
$$;
revoke execute on function public.platform_nfc_orders() from public, anon;
grant execute on function public.platform_nfc_orders() to authenticated;
