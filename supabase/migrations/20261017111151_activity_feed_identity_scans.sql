-- 1. recent_activity: the workspace activity feed (who did what, newest first),
--    paginated with p_before. Event kinds follow table visibility: members see
--    registrations and the schedule, clinical roles see clinical events, billing
--    roles see money, admins see staff changes.
-- 2. dashboard_summary no longer builds a feed (the dashboard calls recent_activity).
-- 3. identity_scans: log of patient identifications (VitaCard tap, QR, manual)
--    behind the Digital Health Identity "Recent scans" list.

create or replace function public.recent_activity(
  p_organization_id uuid,
  p_limit integer default 10,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid := p_organization_id;
  lim integer := least(greatest(coalesce(p_limit, 10), 1), 50);
  before_ts timestamptz := coalesce(p_before, 'infinity'::timestamptz);
  can_clinical boolean := private.has_role(org, private.clinical_read_roles());
  can_billing boolean := private.has_role(org, private.billing_read_roles());
  can_admin boolean := private.has_role(org, private.admin_roles());
  feed jsonb;
begin
  if org is null or not private.is_member(org) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;

  with events as (
    -- ---- everyone in the workspace ----
    (select 'patient'::text as kind, p.created_at as at, p.created_by as actor, p.switch_id,
            'Registered ' || p.first_name || ' ' || p.last_name as message
     from public.patients p
     where p.organization_id = org and p.created_at < before_ts
     order by p.created_at desc limit lim)
    union all
    (select 'booking', a.created_at, a.created_by, p.switch_id,
            'Booked ' || lower(a.type) || ' for ' || p.first_name || ' ' || p.last_name
              || coalesce(' with ' || nullif(c.full_name, ''), '')
              || ' · ' || to_char(a.starts_at at time zone 'Africa/Lagos', 'DD Mon HH24:MI')
     from public.appointments a
     join public.patients p on p.id = a.patient_id
     left join public.profiles c on c.id = a.clinician_id
     where a.organization_id = org and a.created_at < before_ts
     order by a.created_at desc limit lim)
    union all
    (select 'checkin', a.checked_in_at, a.updated_by, p.switch_id,
            p.first_name || ' ' || p.last_name || ' checked in (' || coalesce(a.queue_number, a.department) || ')'
     from public.appointments a
     join public.patients p on p.id = a.patient_id
     where a.organization_id = org and a.checked_in_at is not null and a.checked_in_at < before_ts
     order by a.checked_in_at desc limit lim)
    union all
    (select 'appointment', a.completed_at, a.updated_by, p.switch_id,
            'Completed ' || lower(a.type) || ' for ' || p.first_name || ' ' || p.last_name
     from public.appointments a
     join public.patients p on p.id = a.patient_id
     where a.organization_id = org and a.completed_at is not null and a.completed_at < before_ts
     order by a.completed_at desc limit lim)
    -- ---- clinical roles ----
    union all
    (select 'lab-order', o.created_at, o.ordered_by, p.switch_id,
            'Ordered ' || coalesce((select string_agg(l.test_name, ', ' order by l.test_name) from public.lab_results l where l.order_id = o.id), 'lab tests')
              || ' for ' || p.first_name || ' ' || p.last_name
              || case when o.priority <> 'routine' then ' (' || upper(o.priority) || ')' else '' end
     from public.lab_orders o
     join public.patients p on p.id = o.patient_id
     where can_clinical and o.organization_id = org and o.created_at < before_ts
     order by o.created_at desc limit lim)
    union all
    (select case when o.critical then 'alert' else 'lab' end, o.completed_at, o.completed_by, p.switch_id,
            case when o.critical then 'Critical result for ' else 'Results ready for ' end
              || p.first_name || ' ' || p.last_name || ' (' || o.order_number || ')'
     from public.lab_orders o
     join public.patients p on p.id = o.patient_id
     where can_clinical and o.organization_id = org and o.completed_at is not null and o.completed_at < before_ts
     order by o.completed_at desc limit lim)
    union all
    (select 'prescription', rx.created_at, rx.prescribed_by, p.switch_id,
            'Prescribed ' || rx.drug_name || ' for ' || p.first_name || ' ' || p.last_name
     from public.prescriptions rx
     join public.patients p on p.id = rx.patient_id
     where can_clinical and rx.organization_id = org and rx.created_at < before_ts
     order by rx.created_at desc limit lim)
    union all
    (select 'pharmacy', rx.dispensed_at, rx.dispensed_by, p.switch_id,
            'Dispensed ' || coalesce(rx.dispensed_quantity::text || ' × ', '') || coalesce(d.drug_name, rx.drug_name)
              || ' to ' || p.first_name || ' ' || p.last_name
     from public.prescriptions rx
     join public.patients p on p.id = rx.patient_id
     left join public.drug_inventory d on d.id = rx.dispensed_inventory_id
     where can_clinical and rx.organization_id = org and rx.dispensed_at is not null and rx.dispensed_at < before_ts
     order by rx.dispensed_at desc limit lim)
    union all
    (select 'note', n.signed_at, n.signed_by, p.switch_id,
            'Signed clinical note for ' || p.first_name || ' ' || p.last_name
              || coalesce(': ' || nullif(n.primary_diagnosis, ''), '')
     from public.clinical_notes n
     join public.patients p on p.id = n.patient_id
     where can_clinical and n.organization_id = org and n.status = 'signed' and n.signed_at is not null and n.signed_at < before_ts
     order by n.signed_at desc limit lim)
    union all
    (select 'vitals', v.recorded_at, v.recorded_by, p.switch_id,
            'Recorded vitals for ' || p.first_name || ' ' || p.last_name
              || coalesce(' · BP ' || v.systolic || '/' || v.diastolic, '')
     from public.vitals v
     join public.patients p on p.id = v.patient_id
     where can_clinical and v.organization_id = org and v.recorded_at < before_ts
     order by v.recorded_at desc limit lim)
    union all
    (select 'document', doc.created_at, doc.uploaded_by, p.switch_id,
            'Uploaded ' || doc.name || ' (' || doc.category || ') for ' || p.first_name || ' ' || p.last_name
     from public.patient_documents doc
     join public.patients p on p.id = doc.patient_id
     where can_clinical and doc.organization_id = org and doc.created_at < before_ts
     order by doc.created_at desc limit lim)
    -- ---- billing roles ----
    union all
    (select 'invoice', i.created_at, i.created_by, p.switch_id,
            'Invoice ' || i.invoice_number || ' for ' || p.first_name || ' ' || p.last_name || ': ₦'
              || to_char(i.total_amount_kobo / 100.0, 'FM999,999,999,990.00')
     from public.invoices i
     join public.patients p on p.id = i.patient_id
     where can_billing and i.organization_id = org and i.created_at < before_ts
     order by i.created_at desc limit lim)
    union all
    (select 'billing', pay.received_at, pay.received_by, p.switch_id,
            'Payment of ₦' || to_char(pay.amount_kobo / 100.0, 'FM999,999,999,990.00') || ' (' || replace(pay.method, '_', ' ') || ') on ' || i.invoice_number
     from public.invoice_payments pay
     join public.invoices i on i.id = pay.invoice_id
     join public.patients p on p.id = i.patient_id
     where can_billing and pay.organization_id = org and pay.received_at < before_ts
     order by pay.received_at desc limit lim)
    union all
    (select 'claim', i.hmo_submitted_at, null::uuid, p.switch_id,
            'HMO claim to ' || coalesce(i.hmo_provider, 'HMO') || ' for ' || i.invoice_number || ': ₦'
              || to_char(coalesce(i.hmo_claimed_kobo, 0) / 100.0, 'FM999,999,999,990.00')
     from public.invoices i
     join public.patients p on p.id = i.patient_id
     where can_billing and i.organization_id = org and i.hmo_submitted_at is not null and i.hmo_submitted_at < before_ts
     order by i.hmo_submitted_at desc limit lim)
    union all
    (select 'claim', i.hmo_resolved_at, null::uuid, p.switch_id,
            'HMO claim ' || coalesce(i.hmo_claim_status, 'resolved') || ' for ' || i.invoice_number
     from public.invoices i
     join public.patients p on p.id = i.patient_id
     where can_billing and i.organization_id = org and i.hmo_resolved_at is not null and i.hmo_resolved_at < before_ts
     order by i.hmo_resolved_at desc limit lim)
    -- ---- admins ----
    union all
    (select 'staff', s.accepted_at, s.accepted_by, null::text,
            coalesce(nullif(pr.full_name, ''), s.email) || ' joined as ' || replace(s.role, '-', ' ')
     from public.staff_invitations s
     left join public.profiles pr on pr.id = s.accepted_by
     where can_admin and s.organization_id = org and s.accepted and s.accepted_at is not null and s.accepted_at < before_ts
     order by s.accepted_at desc limit lim)
  ),
  latest as (
    select e.*, coalesce(nullif(pr.full_name, ''), pr.email) as actor_name
    from events e
    left join public.profiles pr on pr.id = e.actor
    where e.at is not null
    order by e.at desc
    limit lim
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'kind', kind, 'at', at, 'message', message, 'switch_id', switch_id, 'actor', actor_name
         ) order by at desc), '[]'::jsonb)
  into feed
  from latest;

  return feed;
end;
$$;
revoke execute on function public.recent_activity(uuid, integer, timestamptz) from public, anon;
grant execute on function public.recent_activity(uuid, integer, timestamptz) to authenticated;

-- ============================================
-- dashboard_summary without the feed
-- ============================================

create or replace function public.dashboard_summary(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid := p_organization_id;
  day_start timestamptz := date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  day_end timestamptz := day_start + interval '1 day';
  month_start timestamptz := date_trunc('month', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  can_clinical boolean := private.has_role(org, private.clinical_read_roles());
  can_billing boolean := private.has_role(org, private.billing_read_roles());
  can_stock boolean := private.has_role(org, private.pharmacy_write_roles() || private.admin_roles());
  result jsonb;
begin
  if org is null or not private.is_member(org) then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;

  result := jsonb_build_object(
    'generated_at', now(),
    'patients_total', (select count(*) from public.patients where organization_id = org),
    'patients_new_this_month', (select count(*) from public.patients where organization_id = org and created_at >= month_start),
    'appointments_today', (select count(*) from public.appointments
                           where organization_id = org and starts_at >= day_start and starts_at < day_end
                             and status not in ('cancelled', 'rescheduled')),
    'patients_today', (select count(distinct patient_id) from public.appointments
                       where organization_id = org and starts_at >= day_start and starts_at < day_end
                         and status not in ('cancelled', 'rescheduled')),
    'appointments_completed_today', (select count(*) from public.appointments
                                     where organization_id = org and starts_at >= day_start and starts_at < day_end
                                       and status = 'completed'),
    'appointments_open_today', (select count(*) from public.appointments
                                where organization_id = org and starts_at >= day_start and starts_at < day_end
                                  and status in ('pending', 'confirmed', 'checked-in', 'in-consultation', 'waiting-lab', 'emergency'))
  );

  if can_clinical then
    result := result || jsonb_build_object(
      'labs_pending', (select count(*) from public.lab_orders where organization_id = org and status = 'pending'),
      'labs_processing', (select count(*) from public.lab_orders where organization_id = org and status = 'processing'),
      'labs_urgent_open', (select count(*) from public.lab_orders
                           where organization_id = org and status in ('pending', 'processing') and priority in ('urgent', 'stat')),
      'labs_critical_7d', (select count(*) from public.lab_orders
                           where organization_id = org and critical and completed_at >= now() - interval '7 days'),
      'critical_labs', coalesce((
        select jsonb_agg(c order by (c ->> 'completed_at')::timestamptz desc)
        from (
          select jsonb_build_object(
                   'order_number', o.order_number,
                   'patient', p.first_name || ' ' || p.last_name,
                   'switch_id', p.switch_id,
                   'completed_at', o.completed_at) as c
          from public.lab_orders o
          join public.patients p on p.id = o.patient_id
          where o.organization_id = org and o.critical and o.completed_at >= now() - interval '7 days'
          order by o.completed_at desc
          limit 3
        ) recent), '[]'::jsonb),
      'prescriptions_active', (select count(*) from public.prescriptions where organization_id = org and status = 'active')
    );
  end if;

  if can_billing then
    result := result || jsonb_build_object(
      'revenue_today_kobo', (select coalesce(sum(amount_kobo), 0) from public.invoice_payments
                             where organization_id = org and received_at >= day_start and received_at < day_end),
      'revenue_yesterday_kobo', (select coalesce(sum(amount_kobo), 0) from public.invoice_payments
                                 where organization_id = org and received_at >= day_start - interval '1 day' and received_at < day_start),
      'outstanding_kobo', (select coalesce(sum(greatest(total_amount_kobo - amount_paid_kobo, 0)), 0) from public.invoices
                           where organization_id = org and status in ('unpaid', 'partial')),
      'invoices_overdue', (select count(*) from public.invoices
                           where organization_id = org and status in ('unpaid', 'partial')
                             and due_date < (now() at time zone 'Africa/Lagos')::date),
      'claims_submitted', (select count(*) from public.invoices where organization_id = org and hmo_claim_status = 'submitted'),
      'claims_submitted_kobo', (select coalesce(sum(hmo_claimed_kobo), 0) from public.invoices
                                where organization_id = org and hmo_claim_status = 'submitted')
    );
  end if;

  if can_stock then
    result := result || jsonb_build_object(
      'stock_low', (select count(*) from public.drug_inventory
                    where organization_id = org and is_active and quantity_in_stock <= reorder_level),
      'stock_expiring_30d', (select count(*) from public.drug_inventory
                             where organization_id = org and is_active and quantity_in_stock > 0
                               and expiry_date is not null and expiry_date <= (now() at time zone 'Africa/Lagos')::date + 30)
    );
  end if;

  return result;
end;
$$;

-- ============================================
-- IDENTITY SCANS
-- ============================================

create table public.identity_scans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null,
  method text not null check (method in ('nfc', 'qr', 'manual')),
  scanned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (patient_id, organization_id) references public.patients (id, organization_id) on delete cascade
);
create index identity_scans_org_idx on public.identity_scans (organization_id, created_at desc);
create index identity_scans_patient_idx on public.identity_scans (patient_id, organization_id);
create index identity_scans_scanned_by_idx on public.identity_scans (scanned_by);

create or replace function private.identity_scan_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.scanned_by := auth.uid();
  new.created_at := now();
  return new;
end;
$$;
create trigger identity_scans_stamp before insert on public.identity_scans
  for each row execute function private.identity_scan_stamp();

alter table public.identity_scans enable row level security;
create policy "members read identity scans" on public.identity_scans
  for select to authenticated using (private.is_member(organization_id));
create policy "members log identity scans" on public.identity_scans
  for insert to authenticated with check (private.is_member(organization_id));
revoke all on public.identity_scans from anon;
