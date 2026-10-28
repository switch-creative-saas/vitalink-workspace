-- VitaMind insights for the header AI panel: rule-based signals computed from the workspace's own
-- records (vitals, lab results, allergies vs prescriptions, duplicates, appointments, lab turnaround,
-- stock and billing). Each signal is shown only to the roles that act on it; read/dismiss state is per user.

create table if not exists public.vitamind_insight_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  insight_key text not null,
  read_at timestamptz,
  dismissed_at timestamptz,
  primary key (user_id, organization_id, insight_key)
);
alter table public.vitamind_insight_state enable row level security;
create policy "own insight state" on public.vitamind_insight_state for select using (user_id = auth.uid());

create or replace function public.vitamind_insights(p_organization_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  v_role text;
  v_groups text[];
  v_result jsonb;
begin
  select m.role into v_role from public.memberships m
  where m.organization_id = p_organization_id and m.user_id = auth.uid() and m.status = 'active';
  if v_role is null then raise exception 'Not a member of this workspace' using errcode = '42501'; end if;

  v_groups := array['all']
    || case when v_role in ('super-admin', 'hospital-admin', 'doctor', 'nurse', 'lab-scientist', 'lab-technician', 'pharmacist') then array['clinical'] else '{}' end
    || case when v_role in ('super-admin', 'hospital-admin', 'doctor', 'lab-scientist', 'lab-technician') then array['lab'] else '{}' end
    || case when v_role in ('super-admin', 'hospital-admin', 'pharmacist') then array['pharmacy'] else '{}' end
    || case when v_role in ('super-admin', 'hospital-admin', 'billing-officer', 'insurance-officer') then array['billing'] else '{}' end
    || case when v_role in ('super-admin', 'hospital-admin', 'receptionist', 'nurse', 'doctor') then array['frontdesk'] else '{}' end;

  with pt as (
    select p.id, btrim(concat_ws(' ', p.first_name, p.last_name)) as name, p.date_of_birth, p.phone, p.allergies, p.first_name, p.last_name
    from public.patients p where p.organization_id = p_organization_id
  ),
  bp as (
    select v.patient_id, count(*) filter (where v.systolic >= 140 or v.diastolic >= 90) as high_n,
           max(v.systolic) as max_sys, max(v.diastolic) as max_dia, max(v.recorded_at) as last_at,
           bool_or(v.systolic >= 180 or v.diastolic >= 110) as crisis
    from (select v.*, row_number() over (partition by v.patient_id order by v.recorded_at desc) rn
          from public.vitals v where v.organization_id = p_organization_id and v.recorded_at > now() - interval '90 days'
            and v.systolic is not null) v
    where v.rn <= 3 group by v.patient_id
  ),
  acute as (
    select distinct on (v.patient_id) v.patient_id, v.spo2, v.temperature_c, v.heart_rate, v.recorded_at
    from public.vitals v where v.organization_id = p_organization_id and v.recorded_at > now() - interval '48 hours'
      and (v.spo2 < 92 or v.temperature_c >= 39 or v.heart_rate >= 130)
    order by v.patient_id, v.recorded_at desc
  ),
  allergy as (
    select distinct on (rx.id) rx.id, rx.patient_id, rx.drug_name, a.token, rx.created_at
    from public.prescriptions rx
    join pt on pt.id = rx.patient_id
    cross join lateral (select lower(btrim(t)) as token from regexp_split_to_table(coalesce(pt.allergies, ''), '[,;/\n]') t) a
    where rx.organization_id = p_organization_id and rx.status = 'active' and length(a.token) >= 4
      and a.token not in ('none', 'nil', 'nkda', 'no known allergies', 'unknown')
      and (lower(rx.drug_name) like '%' || a.token || '%' or lower(coalesce(rx.generic_name, '')) like '%' || a.token || '%')
  ),
  lab_trend as (
    select r.patient_id, r.test_name, count(*) as n, max(r.resulted_at) as last_at,
           (array_agg(r.value || coalesce(' ' || r.unit, '') order by r.resulted_at desc))[1] as last_value
    from public.lab_results r
    where r.organization_id = p_organization_id and r.flag in ('High', 'Low') and r.resulted_at > now() - interval '90 days'
    group by r.patient_id, r.test_name having count(*) >= 2
  ),
  dupes as (
    select least(a.id, b.id) as a_id, greatest(a.id, b.id) as b_id, a.name as a_name, b.name as b_name,
           case when a.date_of_birth = b.date_of_birth and lower(a.first_name) = lower(b.first_name) and lower(a.last_name) = lower(b.last_name)
                then 'same name and date of birth' else 'same phone number' end as reason
    from pt a join pt b on a.id < b.id
     and ((a.date_of_birth = b.date_of_birth and lower(a.first_name) = lower(b.first_name) and lower(a.last_name) = lower(b.last_name))
          or (nullif(regexp_replace(coalesce(a.phone, ''), '\D', '', 'g'), '') is not null
              and right(regexp_replace(a.phone, '\D', '', 'g'), 10) = right(regexp_replace(coalesce(b.phone, ''), '\D', '', 'g'), 10)
              and length(regexp_replace(a.phone, '\D', '', 'g')) >= 10))
    limit 10
  ),
  noshow as (
    select a.patient_id, count(*) as n, max(a.starts_at) as last_at
    from public.appointments a where a.organization_id = p_organization_id and a.status = 'no-show' and a.starts_at > now() - interval '90 days'
    group by a.patient_id having count(*) >= 2
  ),
  busy as (
    select (select count(*) from public.appointments a where a.organization_id = p_organization_id
              and a.starts_at >= date_trunc('day', now()) and a.starts_at < date_trunc('day', now()) + interval '1 day'
              and a.status not in ('cancelled', 'rescheduled')) as today,
           (select count(*)::numeric / 4 from public.appointments a where a.organization_id = p_organization_id
              and a.starts_at >= date_trunc('day', now()) - interval '28 days' and a.starts_at < date_trunc('day', now())
              and extract(dow from a.starts_at) = extract(dow from now()) and a.status not in ('cancelled', 'rescheduled')) as usual
  ),
  signals as (
    -- Clinical
    select 'bp:' || bp.patient_id as key, 'risk-alert' as type, case when bp.crisis then 'critical' else 'high' end as severity,
           case when bp.crisis then 'Hypertensive-range blood pressure' else 'Elevated blood pressure trend' end as title,
           bp.high_n || ' of the last readings were 140/90 or higher (peak ' || bp.max_sys || '/' || bp.max_dia || ').' as description,
           case when bp.crisis then 'Review today; consider urgent assessment' else 'Review medication and book a follow-up' end as action,
           bp.patient_id, pt.name as patient_name, 'emr' as page, bp.last_at as at, 'clinical' as audience
    from bp join pt on pt.id = bp.patient_id where bp.high_n >= 2 or bp.crisis
    union all
    select 'acute:' || ac.patient_id || ':' || to_char(ac.recorded_at, 'YYYYMMDDHH24'), 'risk-alert', 'critical', 'Abnormal vital signs',
           concat_ws(', ', case when ac.spo2 < 92 then 'SpO₂ ' || ac.spo2 || '%' end, case when ac.temperature_c >= 39 then 'temperature ' || ac.temperature_c || '°C' end,
                     case when ac.heart_rate >= 130 then 'heart rate ' || ac.heart_rate end) || ' recorded ' || to_char(ac.recorded_at, 'DD Mon HH24:MI') || '.',
           'Reassess the patient now', ac.patient_id, pt.name, 'emr', ac.recorded_at, 'clinical'
    from acute ac join pt on pt.id = ac.patient_id
    union all
    select 'critlab:' || r.id, 'risk-alert', 'critical', 'Critical lab result: ' || r.test_name,
           coalesce(r.value || coalesce(' ' || r.unit, ''), 'Value recorded') || coalesce(' (ref ' || r.reference_range || ')', '') || '.',
           'Review and act on the result', r.patient_id, pt.name, 'laboratory', coalesce(r.resulted_at, r.updated_at), 'clinical'
    from public.lab_results r join pt on pt.id = r.patient_id
    where r.organization_id = p_organization_id and r.flag = 'Critical' and coalesce(r.resulted_at, r.updated_at) > now() - interval '7 days'
    union all
    select 'trend:' || lt.patient_id || ':' || lower(lt.test_name), 'trend', 'medium', 'Repeated abnormal ' || lt.test_name,
           lt.n || ' abnormal results in 90 days; latest ' || coalesce(lt.last_value, '—') || '.',
           'Consider follow-up testing or a treatment review', lt.patient_id, pt.name, 'emr', lt.last_at, 'clinical'
    from lab_trend lt join pt on pt.id = lt.patient_id
    union all
    select 'allergy:' || al.id, 'risk-alert', 'critical', 'Possible allergy conflict',
           'Active prescription for ' || al.drug_name || ' but the record lists an allergy to "' || al.token || '".',
           'Check with the patient before dispensing', al.patient_id, pt.name, 'pharmacy', al.created_at, 'clinical'
    from allergy al join pt on pt.id = al.patient_id
    -- Labs
    union all
    select 'labtat:' || o.id, 'prediction', case when o.priority in ('urgent', 'stat') then 'high' else 'medium' end, 'Lab order waiting ' || floor(extract(epoch from now() - o.created_at) / 3600) || ' hours',
           o.order_number || ' (' || coalesce(o.sample_type, 'sample') || ') is still ' || o.status || '.',
           'Process or update the order', o.patient_id, pt.name, 'laboratory', o.created_at, 'lab'
    from public.lab_orders o join pt on pt.id = o.patient_id
    where o.organization_id = p_organization_id and o.status in ('pending', 'processing') and o.created_at < now() - interval '48 hours'
    -- Records and front desk
    union all
    select 'dupe:' || d.a_id || ':' || d.b_id, 'duplicate-detection', 'low', 'Possible duplicate patient record',
           '"' || d.a_name || '" and "' || d.b_name || '" have the ' || d.reason || '.',
           'Review both records and merge if they are the same person', d.a_id, d.a_name, 'patients', now(), 'frontdesk'
    from dupes d
    union all
    select 'noshow:' || ns.patient_id, 'trend', 'medium', 'Repeated missed appointments',
           ns.n || ' no-shows in the last 90 days.', 'Call to confirm before their next visit', ns.patient_id, pt.name, 'appointments', ns.last_at, 'frontdesk'
    from noshow ns join pt on pt.id = ns.patient_id
    union all
    select 'load:' || to_char(now(), 'YYYYMMDD'), 'prediction', case when l.today > l.usual * 1.5 then 'medium' else 'info' end, 'Busier day than usual',
           l.today || ' appointments today vs about ' || round(l.usual) || ' on a typical ' || trim(to_char(now(), 'Day')) || '.',
           'Plan staffing and queue flow', null, null, 'appointments', date_trunc('day', now()), 'frontdesk'
    from busy l where l.usual >= 2 and l.today > l.usual * 1.3
    -- Pharmacy
    union all
    select 'stock:' || di.id || ':' || di.quantity_in_stock, 'prediction', case when di.quantity_in_stock = 0 then 'high' else 'medium' end,
           case when di.quantity_in_stock = 0 then 'Out of stock: ' else 'Low stock: ' end || di.drug_name || coalesce(' ' || di.strength, ''),
           di.quantity_in_stock || ' left (reorder at ' || di.reorder_level || ').', 'Reorder from ' || coalesce(nullif(di.supplier, ''), 'your supplier'),
           null, null, 'pharmacy', di.updated_at, 'pharmacy'
    from public.drug_inventory di
    where di.organization_id = p_organization_id and di.is_active and di.quantity_in_stock <= di.reorder_level
    union all
    select 'expiry:' || di.id || ':' || di.expiry_date, 'prediction', case when di.expiry_date < current_date then 'high' else 'low' end,
           case when di.expiry_date < current_date then 'Expired stock: ' else 'Expiring soon: ' end || di.drug_name || coalesce(' ' || di.strength, ''),
           di.quantity_in_stock || ' units, batch ' || coalesce(di.batch_number, '—') || ', expiry ' || to_char(di.expiry_date, 'DD Mon YYYY') || '.',
           case when di.expiry_date < current_date then 'Remove from shelf' else 'Use first or return to supplier' end, null, null, 'pharmacy', di.updated_at, 'pharmacy'
    from public.drug_inventory di
    where di.organization_id = p_organization_id and di.is_active and di.quantity_in_stock > 0 and di.expiry_date < current_date + 30
    union all
    select 'rxwait:' || rx.id, 'prediction', 'low', 'Prescription not dispensed', rx.drug_name || ' prescribed ' || to_char(rx.created_at, 'DD Mon') || ' is still active.',
           'Dispense or close it', rx.patient_id, pt.name, 'pharmacy', rx.created_at, 'pharmacy'
    from public.prescriptions rx join pt on pt.id = rx.patient_id
    where rx.organization_id = p_organization_id and rx.status = 'active' and rx.created_at < now() - interval '3 days' and rx.created_at > now() - interval '30 days'
    -- Billing
    union all
    select 'overdue:' || to_char(now(), 'YYYYMMDD'), 'prediction', 'medium', 'Overdue invoices',
           count(*) || ' invoices past due, ₦' || to_char(sum(i.total_amount_kobo - i.discount_kobo - i.amount_paid_kobo) / 100, 'FM999,999,999,990') || ' outstanding.',
           'Follow up with patients or HMOs', null, null, 'billing', min(i.due_date)::timestamptz, 'billing'
    from public.invoices i
    where i.organization_id = p_organization_id and i.status in ('unpaid', 'partial') and i.due_date < current_date
    having count(*) > 0
    union all
    select 'hmo:' || to_char(now(), 'YYYYMMDD'), 'prediction', 'low', 'HMO claims not submitted',
           count(*) || ' HMO invoices are still pending submission.', 'Submit claims from Billing', null, null, 'billing', min(i.created_at), 'billing'
    from public.invoices i
    where i.organization_id = p_organization_id and i.hmo_provider is not null and coalesce(i.hmo_claim_status, 'pending') = 'pending'
      and i.status <> 'void' and i.created_at < now() - interval '7 days'
    having count(*) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.key, 'type', s.type, 'severity', s.severity, 'title', s.title, 'description', s.description,
           'recommendedAction', s.action, 'patientId', s.patient_id, 'patientName', s.patient_name, 'page', s.page,
           'createdAt', s.at, 'isRead', st.read_at is not null)
         order by case s.severity when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end, s.at desc), '[]'::jsonb)
  into v_result
  from (select * from signals where audience = any (v_groups) order by at desc nulls last limit 60) s
  left join public.vitamind_insight_state st
    on st.user_id = auth.uid() and st.organization_id = p_organization_id and st.insight_key = s.key
  where st.dismissed_at is null;
  return v_result;
end;
$function$;

create or replace function public.vitamind_mark_insights(p_organization_id uuid, p_keys text[], p_action text default 'read')
returns void language plpgsql security definer set search_path = '' as $function$
begin
  if not private.is_member(p_organization_id) then raise exception 'Not a member of this workspace' using errcode = '42501'; end if;
  if p_action not in ('read', 'dismiss') then raise exception 'Unknown action' using errcode = '22023'; end if;
  insert into public.vitamind_insight_state (user_id, organization_id, insight_key, read_at, dismissed_at)
  select auth.uid(), p_organization_id, k, now(), case when p_action = 'dismiss' then now() end from unnest(p_keys) k
  on conflict (user_id, organization_id, insight_key) do update
    set read_at = coalesce(public.vitamind_insight_state.read_at, now()),
        dismissed_at = case when p_action = 'dismiss' then now() else public.vitamind_insight_state.dismissed_at end;
end;
$function$;

revoke all on function public.vitamind_insights(uuid) from public, anon;
revoke all on function public.vitamind_mark_insights(uuid, text[], text) from public, anon;
grant execute on function public.vitamind_insights(uuid) to authenticated;
grant execute on function public.vitamind_mark_insights(uuid, text[], text) to authenticated;
