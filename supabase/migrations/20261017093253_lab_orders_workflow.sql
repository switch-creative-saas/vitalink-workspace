-- Laboratory workflow: lab orders group the per-test lab_results rows, carry
-- priority / sample / status, and move pending → processing → completed (or
-- cancelled). Results are saved as drafts by lab staff and submitted by lab
-- scientists or admins; doctors may add interpretations. Lab templates are
-- per workspace.

create or replace function private.lab_staff_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['super-admin','hospital-admin','lab-scientist','lab-technician']::text[] $$;

create or replace function private.lab_complete_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['super-admin','hospital-admin','lab-scientist']::text[] $$;

grant execute on function private.lab_staff_roles(), private.lab_complete_roles() to authenticated;

-- ============================================
-- LAB ORDERS
-- ============================================

create sequence private.lab_order_serial;

create table public.lab_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_number text not null unique,
  patient_id uuid not null,
  note_id uuid references public.clinical_notes (id) on delete set null,
  ordered_by uuid references public.profiles (id) on delete set null,
  priority text not null default 'routine' check (priority in ('routine', 'urgent', 'stat')),
  sample_type text not null default 'blood' check (sample_type in ('blood', 'urine', 'imaging', 'other')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'cancelled')),
  notes text not null default '',
  critical boolean not null default false,
  draft_saved_at timestamptz,
  processing_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (patient_id, organization_id) references public.patients (id, organization_id) on delete cascade
);
create index lab_orders_org_idx on public.lab_orders (organization_id, created_at desc);
create index lab_orders_patient_idx on public.lab_orders (patient_id, organization_id);
create index lab_orders_open_idx on public.lab_orders (organization_id, status) where status in ('pending', 'processing');
create index lab_orders_note_idx on public.lab_orders (note_id);
create index lab_orders_ordered_by_idx on public.lab_orders (ordered_by);
create index lab_orders_completed_by_idx on public.lab_orders (completed_by);

alter table public.lab_results
  add column order_id uuid,
  add column unit text not null default '',
  add foreign key (order_id, organization_id) references public.lab_orders (id, organization_id) on delete cascade;
create index lab_results_order_idx on public.lab_results (order_id, organization_id);

create or replace function private.lab_order_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.ordered_by := auth.uid();
    new.status := 'pending';
    new.critical := false;
    new.created_at := now();
    new.draft_saved_at := null; new.processing_at := null;
    new.completed_by := null; new.completed_at := null; new.cancelled_at := null;
    new.order_number := 'VLL-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('private.lab_order_serial')::text, 4, '0');
  else
    new.organization_id := old.organization_id;
    new.patient_id := old.patient_id;
    new.order_number := old.order_number;
    new.ordered_by := old.ordered_by;
    new.created_at := old.created_at;
    if new.status is distinct from old.status then
      if old.status in ('completed', 'cancelled') then
        raise exception 'Lab order % is already %', old.order_number, old.status using errcode = '42501';
      end if;
      if new.status = 'processing' then
        new.processing_at := now();
      elsif new.status = 'completed' then
        if exists (select 1 from public.lab_results l where l.order_id = new.id and l.status <> 'Completed') then
          raise exception 'Enter and submit every result before completing the order' using errcode = '22023';
        end if;
        new.completed_at := now();
        new.completed_by := auth.uid();
      elsif new.status = 'cancelled' then
        new.cancelled_at := now();
      elsif new.status = 'pending' then
        new.processing_at := null;
      end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger lab_orders_stamp before insert or update on public.lab_orders
  for each row execute function private.lab_order_stamp();
create trigger lab_orders_audit after insert or update or delete on public.lab_orders
  for each row execute function private.write_audit();

-- An order completes itself once every test on it is completed (lab submit,
-- or a clinician recording finished results from the EMR), and its critical
-- flag follows its lines.
create or replace function private.lab_order_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  oid uuid := coalesce(new.order_id, old.order_id);
begin
  if oid is null then
    return null;
  end if;
  update public.lab_orders o
  set critical = exists (select 1 from public.lab_results l where l.order_id = oid and l.flag = 'Critical'),
      status = case
                 when o.status in ('pending', 'processing')
                  and not exists (select 1 from public.lab_results l where l.order_id = oid and l.status <> 'Completed')
                 then 'completed' else o.status
               end
  where o.id = oid and o.status <> 'cancelled';
  return null;
end;
$$;
create trigger lab_results_order_sync after insert or update of status, flag on public.lab_results
  for each row execute function private.lab_order_sync();

-- Existing EMR-ordered tests become one order each (stamp trigger off so the
-- original ordering/result stamps are kept).
alter table public.lab_orders disable trigger lab_orders_stamp;
do $$
declare
  r record;
  new_id uuid;
begin
  for r in select * from public.lab_results where order_id is null order by ordered_at loop
    insert into public.lab_orders (organization_id, order_number, patient_id, note_id, ordered_by, status, critical, created_at, completed_at, completed_by)
    values (r.organization_id,
            'VLL-' || to_char(r.ordered_at, 'YYYY') || '-' || lpad(nextval('private.lab_order_serial')::text, 4, '0'),
            r.patient_id, r.note_id, r.ordered_by,
            case when r.status = 'Completed' then 'completed' else 'pending' end,
            r.flag = 'Critical', r.ordered_at, r.resulted_at,
            case when r.status = 'Completed' then r.technician_id end)
    returning id into new_id;
    update public.lab_results set order_id = new_id where id = r.id;
  end loop;
end;
$$;
alter table public.lab_orders enable trigger lab_orders_stamp;

alter table public.lab_orders enable row level security;
create policy "clinical staff read lab orders" on public.lab_orders
  for select to authenticated using (private.has_role(organization_id, private.clinical_read_roles()));
create policy "clinicians order labs" on public.lab_orders
  for insert to authenticated with check (private.has_role(organization_id, private.lab_write_roles()));
create policy "lab staff update lab orders" on public.lab_orders
  for update to authenticated
  using (private.has_role(organization_id, private.lab_write_roles()))
  with check (private.has_role(organization_id, private.lab_write_roles()));
create policy "admins delete lab orders" on public.lab_orders
  for delete to authenticated using (private.has_role(organization_id, private.admin_roles()));
revoke all on public.lab_orders from anon;

-- ============================================
-- LAB TEMPLATES
-- ============================================

create table public.lab_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  -- [{ "name": text, "unit": text, "referenceRange": text }]
  fields jsonb not null default '[]' check (jsonb_typeof(fields) = 'array'),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index lab_templates_name_idx on public.lab_templates (organization_id, lower(name));
create index lab_templates_created_by_idx on public.lab_templates (created_by);

create or replace function private.lab_template_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.organization_id := old.organization_id;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger lab_templates_stamp before insert or update on public.lab_templates
  for each row execute function private.lab_template_stamp();
create trigger lab_templates_audit after insert or update or delete on public.lab_templates
  for each row execute function private.write_audit();

alter table public.lab_templates enable row level security;
create policy "clinical staff read lab templates" on public.lab_templates
  for select to authenticated using (private.has_role(organization_id, private.clinical_read_roles()));
create policy "lab leads manage lab templates" on public.lab_templates
  for all to authenticated
  using (private.has_role(organization_id, private.lab_complete_roles()))
  with check (private.has_role(organization_id, private.lab_complete_roles()));
revoke all on public.lab_templates from anon;

-- ============================================
-- RPCs (security invoker: RLS and the stamp triggers still apply)
-- ============================================

-- p_tests: [{ "name", "unit", "referenceRange", optional "testType", "department", "value", "flag" }]
create or replace function public.create_lab_order(
  p_patient_id uuid,
  p_tests jsonb,
  p_priority text default 'routine',
  p_sample_type text default 'blood',
  p_notes text default '',
  p_note_id uuid default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  org uuid := (select organization_id from public.patients where id = p_patient_id);
  new_id uuid;
begin
  if org is null then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_tests) <> 'array' or jsonb_array_length(p_tests) = 0
     or exists (select 1 from jsonb_array_elements(p_tests) t where char_length(btrim(coalesce(t ->> 'name', ''))) = 0) then
    raise exception 'Add at least one named test' using errcode = '22023';
  end if;

  insert into public.lab_orders (organization_id, order_number, patient_id, note_id, priority, sample_type, notes)
  values (org, '', p_patient_id, p_note_id, coalesce(p_priority, 'routine'), coalesce(p_sample_type, 'blood'), coalesce(btrim(p_notes), ''))
  returning id into new_id;

  -- A test sent with a value is recorded as a finished result straight away.
  insert into public.lab_results (organization_id, patient_id, note_id, order_id, test_name, test_type, department, unit, reference_range, value, flag, status)
  select org, p_patient_id, p_note_id, new_id, btrim(t ->> 'name'),
         coalesce(nullif(btrim(t ->> 'testType'), ''), 'General'), coalesce(nullif(btrim(t ->> 'department'), ''), 'Laboratory'),
         coalesce(btrim(t ->> 'unit'), ''), coalesce(btrim(t ->> 'referenceRange'), ''), coalesce(btrim(t ->> 'value'), ''),
         coalesce(t ->> 'flag', 'Normal'),
         case when coalesce(btrim(t ->> 'value'), '') <> '' then 'Completed' else 'Pending' end
  from jsonb_array_elements(p_tests) t;

  return new_id;
end;
$$;
revoke execute on function public.create_lab_order(uuid, jsonb, text, text, text, uuid) from public, anon;
grant execute on function public.create_lab_order(uuid, jsonb, text, text, text, uuid) to authenticated;

-- p_lines: [{ "id": uuid, "value": text, "unit": text, "referenceRange": text, "interpretation": text, "critical": bool }]
-- Lab staff edit values on open orders; doctors (and anyone once the order is
-- closed) only change interpretations. p_complete submits the results.
create or replace function public.save_lab_results(p_order_id uuid, p_lines jsonb, p_complete boolean default false)
returns void
language plpgsql
set search_path = ''
as $$
declare
  ord public.lab_orders;
  is_lab boolean;
  line jsonb;
begin
  select * into ord from public.lab_orders where id = p_order_id for update;
  if ord.id is null then
    raise exception 'Lab order not found' using errcode = 'P0002';
  end if;
  is_lab := private.has_role(ord.organization_id, private.lab_staff_roles()) and ord.status in ('pending', 'processing');
  if not private.has_role(ord.organization_id, private.lab_write_roles()) then
    raise exception 'Your role cannot record lab results' using errcode = '42501';
  end if;
  if p_complete and not (is_lab and private.has_role(ord.organization_id, private.lab_complete_roles())) then
    raise exception 'Only lab scientists or admins can submit results on an open order' using errcode = '42501';
  end if;

  for line in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    if is_lab then
      update public.lab_results l
      set value = coalesce(btrim(line ->> 'value'), l.value),
          unit = coalesce(btrim(line ->> 'unit'), l.unit),
          reference_range = coalesce(btrim(line ->> 'referenceRange'), l.reference_range),
          interpretation = nullif(btrim(coalesce(line ->> 'interpretation', l.interpretation, '')), ''),
          flag = case
                   when coalesce((line ->> 'critical')::boolean, false) then 'Critical'
                   when l.flag = 'Critical' then 'Normal'
                   else l.flag
                 end
      where l.id = (line ->> 'id')::uuid and l.order_id = ord.id;
    else
      update public.lab_results l
      set interpretation = nullif(btrim(coalesce(line ->> 'interpretation', l.interpretation, '')), '')
      where l.id = (line ->> 'id')::uuid and l.order_id = ord.id;
    end if;
  end loop;

  if p_complete then
    if exists (select 1 from public.lab_results l where l.order_id = ord.id and btrim(l.value) = '') then
      raise exception 'Enter values for all tests before submitting' using errcode = '22023';
    end if;
    -- lab_order_sync completes the order once the last line is completed.
    update public.lab_results set status = 'Completed' where order_id = ord.id and status <> 'Completed';
  elsif is_lab then
    update public.lab_orders set draft_saved_at = now() where id = ord.id;
  end if;
end;
$$;
revoke execute on function public.save_lab_results(uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_lab_results(uuid, jsonb, boolean) to authenticated;

-- ============================================
-- BILLING: tests on cancelled orders are not billed
-- ============================================

create or replace function public.preview_unbilled_items(p_patient_id uuid)
returns table (source_type text, source_id uuid, description text, category text, quantity integer, unit_price_kobo bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid := (select organization_id from public.patients where id = p_patient_id);
begin
  if org is null or not private.has_role(org, private.billing_write_roles()) then
    raise exception 'Patient not found' using errcode = 'P0002';
  end if;

  return query
  select 'appointment'::text, a.id,
         a.type || coalesce(' — ' || nullif(a.department, ''), '') || ' (' || to_char(a.starts_at at time zone 'Africa/Lagos', 'DD Mon YYYY') || ')',
         case when a.type = 'Surgery' then 'procedure' else 'consultation' end,
         1,
         private.price_for(org, case when a.type = 'Surgery' then 'procedure' else 'consultation' end, a.type)
  from public.appointments a
  where a.patient_id = p_patient_id
    and a.status in ('checked-in','in-consultation','completed','waiting-lab','admitted','emergency')
    and not exists (select 1 from public.invoice_line_items li where li.source_type = 'appointment' and li.source_id = a.id)
  union all
  select 'lab_result'::text, l.id,
         l.test_name || ' (' || to_char(l.ordered_at at time zone 'Africa/Lagos', 'DD Mon YYYY') || ')',
         'lab', 1, private.price_for(org, 'lab', l.test_name)
  from public.lab_results l
  left join public.lab_orders o on o.id = l.order_id
  where l.patient_id = p_patient_id
    and coalesce(o.status, 'pending') <> 'cancelled'
    and not exists (select 1 from public.invoice_line_items li where li.source_type = 'lab_result' and li.source_id = l.id)
  union all
  select 'prescription'::text, rx.id,
         coalesce(d.drug_name, rx.drug_name) || coalesce(' · ' || d.batch_number, ''),
         'pharmacy', greatest(coalesce(rx.dispensed_quantity, rx.quantity, 1), 1), coalesce(d.unit_price_kobo, 0)
  from public.prescriptions rx
  left join public.drug_inventory d on d.id = rx.dispensed_inventory_id
  where rx.patient_id = p_patient_id
    and rx.status = 'dispensed'
    and not exists (select 1 from public.invoice_line_items li where li.source_type = 'prescription' and li.source_id = rx.id);
end;
$$;
