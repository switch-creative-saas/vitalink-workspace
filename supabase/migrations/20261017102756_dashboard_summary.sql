-- Dashboard figures for one workspace in a single call. Every block follows the
-- same visibility as the underlying tables: members see registry and schedule
-- counts, clinical roles see lab / prescription figures, billing roles see
-- money, and the activity feed only includes event kinds the caller may read.
-- Days are counted in Africa/Lagos time, like the rest of the schema.

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
  activity jsonb;
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

  select coalesce(jsonb_agg(latest.e order by (latest.e ->> 'at')::timestamptz desc), '[]'::jsonb) into activity
  from (
   select events.e from (
    select e from (
      select jsonb_build_object('kind', 'patient', 'message', 'New patient registered: ' || p.first_name || ' ' || p.last_name,
                                'switch_id', p.switch_id, 'at', p.created_at) as e
      from public.patients p
      where p.organization_id = org
      order by p.created_at desc limit 8
    ) a
    union all
    select e from (
      select jsonb_build_object('kind', 'appointment', 'message', 'Appointment completed: ' || p.first_name || ' ' || p.last_name,
                                'switch_id', p.switch_id, 'at', a.completed_at) as e
      from public.appointments a
      join public.patients p on p.id = a.patient_id
      where a.organization_id = org and a.completed_at is not null
      order by a.completed_at desc limit 8
    ) b
    union all
    select e from (
      select jsonb_build_object('kind', case when o.critical then 'alert' else 'lab' end,
                                'message', case when o.critical then 'Critical lab result: ' else 'Lab results ready: ' end
                                           || p.first_name || ' ' || p.last_name || ' (' || o.order_number || ')',
                                'switch_id', p.switch_id, 'at', o.completed_at) as e
      from public.lab_orders o
      join public.patients p on p.id = o.patient_id
      where can_clinical and o.organization_id = org and o.completed_at is not null
      order by o.completed_at desc limit 8
    ) c
    union all
    select e from (
      select jsonb_build_object('kind', 'pharmacy', 'message', 'Dispensed ' || rx.drug_name || ' to ' || p.first_name || ' ' || p.last_name,
                                'switch_id', p.switch_id, 'at', rx.dispensed_at) as e
      from public.prescriptions rx
      join public.patients p on p.id = rx.patient_id
      where can_clinical and rx.organization_id = org and rx.dispensed_at is not null
      order by rx.dispensed_at desc limit 8
    ) d
    union all
    select e from (
      select jsonb_build_object('kind', 'billing', 'message', 'Payment received on ' || i.invoice_number || ': ₦'
                                           || to_char(pay.amount_kobo / 100.0, 'FM999,999,999,990.00'),
                                'at', pay.received_at) as e
      from public.invoice_payments pay
      join public.invoices i on i.id = pay.invoice_id
      where can_billing and pay.organization_id = org
      order by pay.received_at desc limit 8
    ) f
   ) events(e)
   order by (events.e ->> 'at')::timestamptz desc
   limit 8
  ) latest;

  return result || jsonb_build_object('activity', activity);
end;
$$;
revoke execute on function public.dashboard_summary(uuid) from public, anon;
grant execute on function public.dashboard_summary(uuid) to authenticated;
