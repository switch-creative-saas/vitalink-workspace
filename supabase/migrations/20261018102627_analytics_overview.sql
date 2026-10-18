-- Analytics page: every figure computed from the workspace's own records for a
-- time range (24h / 7d / 30d / 90d), with the previous period of the same
-- length for comparison. Sections are returned only to roles allowed to see
-- them (null otherwise), matching the page's role rules. Times are Lagos time.

create or replace function public.analytics_overview(p_organization_id uuid, p_range text default '7d')
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  span interval := case p_range when '24h' then interval '24 hours' when '30d' then interval '30 days' when '90d' then interval '90 days' else interval '7 days' end;
  step interval := case p_range when '24h' then interval '3 hours' when '90d' then interval '7 days' else interval '1 day' end;
  t_end timestamptz := now();
  t_start timestamptz := now() - span;
  p_start timestamptz := now() - span * 2;
  v_role text := (select m.role from public.memberships m where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.status = 'active');
  is_admin boolean := v_role = any (private.admin_roles());
  see_patients boolean := is_admin or v_role in ('doctor', 'nurse', 'receptionist');
  see_appts boolean := is_admin or v_role in ('doctor', 'nurse', 'receptionist');
  see_depts boolean := is_admin or v_role = 'doctor';
  see_revenue boolean := is_admin or v_role in ('billing-officer', 'insurance-officer');
  see_lab boolean := is_admin or v_role in ('doctor', 'lab-scientist', 'lab-technician');
  see_pharmacy boolean := is_admin or v_role = 'pharmacist';
  see_insurance boolean := is_admin or v_role in ('billing-officer', 'insurance-officer');
  result jsonb;
begin
  if v_role is null then
    raise exception 'Not a member of this workspace' using errcode = '42501';
  end if;

  result := jsonb_build_object('range', p_range, 'from', t_start, 'to', t_end, 'role', v_role);

  if see_patients then
    result := result || jsonb_build_object('patients', (
      with seen as (
        select distinct a.patient_id from public.appointments a
        where a.organization_id = p_organization_id and a.starts_at >= t_start and a.starts_at < t_end
          and a.status not in ('cancelled', 'rescheduled'))
      select jsonb_build_object(
        'total', (select count(*) from public.patients p where p.organization_id = p_organization_id),
        'new', (select count(*) from public.patients p where p.organization_id = p_organization_id and p.created_at >= t_start),
        'new_prev', (select count(*) from public.patients p where p.organization_id = p_organization_id and p.created_at >= p_start and p.created_at < t_start),
        'seen', (select count(*) from seen),
        'returning', (select count(*) from seen s where exists (
          select 1 from public.appointments b where b.organization_id = p_organization_id and b.patient_id = s.patient_id
            and b.starts_at < t_start and b.status in ('completed', 'checked-in', 'in-consultation', 'admitted', 'waiting-lab'))))));
  end if;

  if see_appts then
    result := result || jsonb_build_object('appointments', (
      select jsonb_build_object(
        'total', count(*) filter (where a.starts_at >= t_start and a.status not in ('cancelled', 'rescheduled')),
        'total_prev', count(*) filter (where a.starts_at < t_start and a.status not in ('cancelled', 'rescheduled')),
        'completed', count(*) filter (where a.starts_at >= t_start and a.status = 'completed'),
        'no_show', count(*) filter (where a.starts_at >= t_start and a.status = 'no-show'),
        'cancelled', count(*) filter (where a.starts_at >= t_start and a.status = 'cancelled'),
        'telemedicine', count(*) filter (where a.starts_at >= t_start and a.type ilike '%tele%'),
        'avg_wait_min', round(avg(extract(epoch from (a.consultation_started_at - a.checked_in_at)) / 60)
                              filter (where a.starts_at >= t_start and a.consultation_started_at > a.checked_in_at))::int,
        'avg_consult_min', round(avg(extract(epoch from (a.completed_at - a.consultation_started_at)) / 60)
                              filter (where a.starts_at >= t_start and a.completed_at > a.consultation_started_at))::int,
        'heatmap', (
          select coalesce(jsonb_agg(jsonb_build_object('dow', h.dow, 'hour', h.hr, 'count', h.n)), '[]'::jsonb) from (
            select extract(isodow from b.starts_at at time zone 'Africa/Lagos')::int dow,
                   (floor(extract(hour from b.starts_at at time zone 'Africa/Lagos') / 2) * 2)::int as hr, count(*) n
            from public.appointments b
            where b.organization_id = p_organization_id and b.starts_at >= t_start and b.starts_at < t_end
              and b.status not in ('cancelled', 'rescheduled')
            group by 1, 2) h),
        'no_show_by_dow', (
          select coalesce(jsonb_agg(jsonb_build_object('dow', d.dow, 'rate', d.rate, 'total', d.total)), '[]'::jsonb) from (
            select extract(isodow from b.starts_at at time zone 'Africa/Lagos')::int dow, count(*) total,
                   round(100.0 * count(*) filter (where b.status = 'no-show') / nullif(count(*), 0))::int rate
            from public.appointments b
            where b.organization_id = p_organization_id and b.starts_at >= t_start and b.starts_at < least(t_end, now())
              and b.status not in ('cancelled', 'rescheduled')
            group by 1) d))
      from public.appointments a
      where a.organization_id = p_organization_id and a.starts_at >= p_start and a.starts_at < t_end));
  end if;

  if see_depts then
    result := result || jsonb_build_object('departments', (
      select coalesce(jsonb_agg(row_to_json(d) order by d.appointments desc), '[]'::jsonb) from (
        select coalesce(nullif(a.department, ''), 'General') department, count(*) appointments,
               count(*) filter (where a.status = 'completed') completed,
               count(*) filter (where a.status = 'no-show') no_show,
               count(distinct a.patient_id) patients,
               round(avg(extract(epoch from (a.consultation_started_at - a.checked_in_at)) / 60)
                     filter (where a.consultation_started_at > a.checked_in_at))::int avg_wait_min
        from public.appointments a
        where a.organization_id = p_organization_id and a.starts_at >= t_start and a.starts_at < t_end
          and a.status not in ('cancelled', 'rescheduled')
        group by 1) d));
  end if;

  if see_revenue then
    result := result || jsonb_build_object('revenue', jsonb_build_object(
      'collected_kobo', (select coalesce(sum(ip.amount_kobo), 0) from public.invoice_payments ip
                         where ip.organization_id = p_organization_id and ip.received_at >= t_start),
      'collected_prev_kobo', (select coalesce(sum(ip.amount_kobo), 0) from public.invoice_payments ip
                              where ip.organization_id = p_organization_id and ip.received_at >= p_start and ip.received_at < t_start),
      'invoiced_kobo', (select coalesce(sum(i.total_amount_kobo - coalesce(i.discount_kobo, 0)), 0) from public.invoices i
                        where i.organization_id = p_organization_id and i.created_at >= t_start and i.status not in ('void', 'refunded')),
      'outstanding_kobo', (select coalesce(sum(i.total_amount_kobo - coalesce(i.discount_kobo, 0) - i.amount_paid_kobo), 0) from public.invoices i
                           where i.organization_id = p_organization_id and i.status in ('unpaid', 'partial')),
      'overdue_kobo', (select coalesce(sum(i.total_amount_kobo - coalesce(i.discount_kobo, 0) - i.amount_paid_kobo), 0) from public.invoices i
                       where i.organization_id = p_organization_id and i.status in ('unpaid', 'partial') and i.due_date < (now() at time zone 'Africa/Lagos')::date),
      'by_category', (select coalesce(jsonb_object_agg(x.category, x.total), '{}'::jsonb) from (
        select coalesce(li.category, 'other') category, sum(li.total_kobo) total
        from public.invoice_line_items li join public.invoices i on i.id = li.invoice_id
        where i.organization_id = p_organization_id and i.created_at >= t_start and i.status not in ('void', 'refunded')
        group by 1) x)));
  end if;

  if see_lab then
    result := result || jsonb_build_object('lab', (
      select jsonb_build_object(
        'orders', count(*),
        'completed', count(*) filter (where o.status = 'completed'),
        'open', count(*) filter (where o.status in ('pending', 'processing')),
        'cancelled', count(*) filter (where o.status = 'cancelled'),
        'critical', count(*) filter (where o.critical),
        'avg_turnaround_h', round((avg(extract(epoch from (o.completed_at - o.created_at)) / 3600) filter (where o.completed_at is not null))::numeric, 1),
        'top_tests', (select coalesce(jsonb_agg(jsonb_build_object('test', x.test_name, 'count', x.n) order by x.n desc), '[]'::jsonb) from (
          select r.test_name, count(*) n from public.lab_results r
          where r.organization_id = p_organization_id and r.ordered_at >= t_start
          group by 1 order by 2 desc limit 5) x),
        'abnormal', (select count(*) from public.lab_results r where r.organization_id = p_organization_id and r.resulted_at >= t_start
                     and coalesce(r.flag, '') not in ('', 'normal', 'Normal', 'N')))
      from public.lab_orders o
      where o.organization_id = p_organization_id and o.created_at >= t_start));
  end if;

  if see_pharmacy then
    result := result || jsonb_build_object('pharmacy', jsonb_build_object(
      'dispensed', (select count(*) from public.prescriptions p where p.organization_id = p_organization_id and p.dispensed_at >= t_start),
      'awaiting', (select count(*) from public.prescriptions p where p.organization_id = p_organization_id and p.status = 'active'),
      'top_drugs', (select coalesce(jsonb_agg(jsonb_build_object('drug', x.drug_name, 'count', x.n) order by x.n desc), '[]'::jsonb) from (
        select p.drug_name, count(*) n from public.prescriptions p
        where p.organization_id = p_organization_id and p.dispensed_at >= t_start
        group by 1 order by 2 desc limit 5) x),
      'revenue_kobo', (select coalesce(sum(li.total_kobo), 0) from public.invoice_line_items li join public.invoices i on i.id = li.invoice_id
                       where i.organization_id = p_organization_id and i.created_at >= t_start and li.category = 'pharmacy' and i.status not in ('void', 'refunded')),
      'low_stock', (select count(*) from public.drug_inventory d where d.organization_id = p_organization_id and d.is_active and d.quantity_in_stock <= d.reorder_level),
      'expiring_60d', (select count(*) from public.drug_inventory d where d.organization_id = p_organization_id and d.is_active and d.quantity_in_stock > 0
                       and d.expiry_date >= current_date and d.expiry_date < current_date + 60),
      'expired', (select count(*) from public.drug_inventory d where d.organization_id = p_organization_id and d.is_active and d.quantity_in_stock > 0 and d.expiry_date < current_date)));
  end if;

  if see_insurance then
    result := result || jsonb_build_object('insurance', (
      select jsonb_build_object(
        'submitted', count(*),
        'approved', count(*) filter (where i.hmo_claim_status = 'approved'),
        'rejected', count(*) filter (where i.hmo_claim_status = 'rejected'),
        'pending', count(*) filter (where i.hmo_claim_status in ('pending', 'submitted')),
        'claimed_kobo', coalesce(sum(i.hmo_claimed_kobo), 0),
        'approved_kobo', coalesce(sum(i.hmo_claimed_kobo) filter (where i.hmo_claim_status = 'approved'), 0),
        'avg_days', round((avg(extract(epoch from (i.hmo_resolved_at - i.hmo_submitted_at)) / 86400) filter (where i.hmo_resolved_at is not null))::numeric, 1))
      from public.invoices i
      where i.organization_id = p_organization_id and i.hmo_submitted_at >= t_start));
  end if;

  -- Trend buckets (patients / appointments for those who may see them, revenue for finance roles).
  result := result || jsonb_build_object('trend', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'at', b.bucket,
      'new_patients', case when see_patients then (select count(*) from public.patients p where p.organization_id = p_organization_id and p.created_at >= b.bucket and p.created_at < b.bucket + step) end,
      'appointments', case when see_appts then (select count(*) from public.appointments a where a.organization_id = p_organization_id and a.starts_at >= b.bucket and a.starts_at < b.bucket + step and a.status not in ('cancelled', 'rescheduled')) end,
      'revenue_kobo', case when see_revenue then (select coalesce(sum(ip.amount_kobo), 0) from public.invoice_payments ip where ip.organization_id = p_organization_id and ip.received_at >= b.bucket and ip.received_at < b.bucket + step) end
    ) order by b.bucket), '[]'::jsonb)
    from generate_series(t_start, t_end - step + interval '1 second', step) as b (bucket)));

  return result;
end;
$$;
revoke execute on function public.analytics_overview(uuid, text) from public, anon;
grant execute on function public.analytics_overview(uuid, text) to authenticated;
