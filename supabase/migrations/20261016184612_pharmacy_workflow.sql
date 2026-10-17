-- Pharmacy workflow: atomic dispensing against stock, purchase orders that
-- restock on delivery, and stock that can never go negative.

alter table public.drug_inventory
  add constraint drug_inventory_stock_not_negative check (quantity_in_stock >= 0),
  add constraint drug_inventory_reorder_not_negative check (reorder_level >= 0),
  add constraint drug_inventory_id_org_key unique (id, organization_id);

alter table public.prescriptions
  add column dispensed_inventory_id uuid,
  add constraint prescriptions_inventory_same_org_fkey
    foreign key (dispensed_inventory_id, organization_id)
    references public.drug_inventory (id, organization_id) on delete set null (dispensed_inventory_id);
create index idx_prescriptions_inventory on public.prescriptions (dispensed_inventory_id);

-- Dispense a prescription from a specific stock batch in one transaction.
create or replace function public.dispense_prescription(p_prescription_id uuid, p_inventory_id uuid, p_quantity integer)
returns public.prescriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  rx public.prescriptions;
  stock public.drug_inventory;
begin
  select * into rx from public.prescriptions where id = p_prescription_id for update;
  if rx.id is null or not private.has_role(rx.organization_id, private.pharmacy_write_roles()) then
    raise exception 'Only pharmacy staff in this workspace can dispense' using errcode = '42501';
  end if;
  if rx.status <> 'active' then
    raise exception 'This prescription is already %', rx.status using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be at least 1' using errcode = '22023';
  end if;

  select * into stock from public.drug_inventory
  where id = p_inventory_id and organization_id = rx.organization_id
  for update;
  if stock.id is null or not stock.is_active then
    raise exception 'That stock item is not available' using errcode = 'P0002';
  end if;
  if stock.expiry_date is not null and stock.expiry_date < current_date then
    raise exception '% (batch %) has expired', stock.drug_name, coalesce(stock.batch_number, '-') using errcode = '22023';
  end if;
  if stock.quantity_in_stock < p_quantity then
    raise exception 'Only % in stock for %', stock.quantity_in_stock, stock.drug_name using errcode = '22023';
  end if;

  update public.drug_inventory set quantity_in_stock = quantity_in_stock - p_quantity where id = stock.id;
  -- prescription_stamp trigger records dispensed_by / dispensed_at.
  update public.prescriptions
  set status = 'dispensed', dispensed_quantity = p_quantity, dispensed_inventory_id = stock.id
  where id = rx.id
  returning * into rx;
  return rx;
end;
$$;
revoke execute on function public.dispense_prescription(uuid, uuid, integer) from public, anon;
grant execute on function public.dispense_prescription(uuid, uuid, integer) to authenticated;

-- ============================================
-- PURCHASE ORDERS
-- ============================================

create sequence private.purchase_order_serial;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  po_number text not null unique,
  supplier text not null check (char_length(btrim(supplier)) > 0),
  -- [{ "inventory_id": uuid, "drug_name": text, "quantity": int }]
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'delivered', 'cancelled')),
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  delivered_by uuid references public.profiles (id) on delete set null,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index purchase_orders_org_idx on public.purchase_orders (organization_id, created_at desc);
create index purchase_orders_created_by_idx on public.purchase_orders (created_by);
create index purchase_orders_approved_by_idx on public.purchase_orders (approved_by);
create index purchase_orders_delivered_by_idx on public.purchase_orders (delivered_by);

create or replace function private.purchase_order_insert()
returns trigger
language plpgsql
security definer  -- uses the private serial
set search_path = ''
as $$
begin
  new.created_by := auth.uid();
  new.status := 'pending';
  new.approved_by := null; new.approved_at := null;
  new.delivered_by := null; new.delivered_at := null;
  new.po_number := 'PO-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('private.purchase_order_serial')::text, 4, '0');
  if exists (
    select 1 from jsonb_array_elements(new.items) item
    where coalesce((item ->> 'quantity')::int, 0) <= 0
       or not exists (
         select 1 from public.drug_inventory d
         where d.id = (item ->> 'inventory_id')::uuid and d.organization_id = new.organization_id
       )
  ) then
    raise exception 'Each order line needs a stock item from this workspace and a quantity above 0' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger purchase_orders_before_insert before insert on public.purchase_orders
  for each row execute function private.purchase_order_insert();
create trigger purchase_orders_set_updated_at before update on public.purchase_orders
  for each row execute function private.set_updated_at();
create trigger purchase_orders_audit after insert or update or delete on public.purchase_orders
  for each row execute function private.write_audit();

alter table public.purchase_orders enable row level security;
create policy "pharmacy reads purchase orders" on public.purchase_orders
  for select to authenticated using (private.has_role(organization_id, private.pharmacy_write_roles()));
create policy "pharmacy raises purchase orders" on public.purchase_orders
  for insert to authenticated with check (private.has_role(organization_id, private.pharmacy_write_roles()));
create policy "admins delete pending purchase orders" on public.purchase_orders
  for delete to authenticated using (status = 'pending' and private.has_role(organization_id, private.admin_roles()));
-- No UPDATE policy: status changes go through set_purchase_order_status().
revoke all on public.purchase_orders from anon;

-- pending -> approved (admins) -> delivered (admins or pharmacists; restocks); pending/approved -> cancelled (admins)
create or replace function public.set_purchase_order_status(p_purchase_order_id uuid, p_status text)
returns public.purchase_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  po public.purchase_orders;
  item jsonb;
begin
  select * into po from public.purchase_orders where id = p_purchase_order_id for update;
  if po.id is null or not private.has_role(po.organization_id, private.pharmacy_write_roles()) then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;

  if p_status = 'approved' then
    if po.status <> 'pending' then raise exception 'Only pending orders can be approved' using errcode = '22023'; end if;
    if not private.has_role(po.organization_id, private.admin_roles()) then
      raise exception 'Only workspace admins can approve purchase orders' using errcode = '42501';
    end if;
    update public.purchase_orders set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = po.id returning * into po;

  elsif p_status = 'delivered' then
    if po.status <> 'approved' then raise exception 'Only approved orders can be received' using errcode = '22023'; end if;
    for item in select * from jsonb_array_elements(po.items) loop
      update public.drug_inventory
      set quantity_in_stock = quantity_in_stock + (item ->> 'quantity')::int
      where id = (item ->> 'inventory_id')::uuid and organization_id = po.organization_id;
    end loop;
    update public.purchase_orders set status = 'delivered', delivered_by = auth.uid(), delivered_at = now()
    where id = po.id returning * into po;

  elsif p_status = 'cancelled' then
    if po.status not in ('pending', 'approved') then raise exception 'This order can no longer be cancelled' using errcode = '22023'; end if;
    if not private.has_role(po.organization_id, private.admin_roles()) then
      raise exception 'Only workspace admins can cancel purchase orders' using errcode = '42501';
    end if;
    update public.purchase_orders set status = 'cancelled' where id = po.id returning * into po;

  else
    raise exception 'Unknown status %', p_status using errcode = '22023';
  end if;
  return po;
end;
$$;
revoke execute on function public.set_purchase_order_status(uuid, text) from public, anon;
grant execute on function public.set_purchase_order_status(uuid, text) to authenticated;
