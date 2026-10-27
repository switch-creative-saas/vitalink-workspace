-- Prescriptions in header search: don't repeat the dose when the drug name already
-- includes it. Same function as 20261026203050 with only the prescription title changed.
create or replace function public.global_search(p_organization_id uuid, p_query text, p_limit integer default 5)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  q text := btrim(coalesce(p_query, ''));
  pat text;
  n integer := least(greatest(coalesce(p_limit, 5), 1), 10);
begin
  if length(q) < 2 then return '[]'::jsonb; end if;
  pat := '%' || replace(replace(q, '%', ''), '_', '') || '%';
  return (
    select coalesce(jsonb_agg(r), '[]') from (
      (select jsonb_build_object('type', 'patient', 'id', p.id, 'title', btrim(p.first_name || ' ' || p.last_name),
          'subtitle', p.switch_id || coalesce(' · ' || initcap(p.gender), '') || coalesce(' · ' || extract(year from age(p.date_of_birth))::int || ' yrs', ''),
          'switchId', p.switch_id, 'status', p.status) as r
       from public.patients p
       where p.organization_id = p_organization_id
         and (p.first_name || ' ' || p.last_name ilike pat or p.switch_id ilike pat or p.phone ilike pat)
       order by p.updated_at desc limit n)
      union all
      (select jsonb_build_object('type', 'appointment', 'id', a.id, 'title', btrim(p.first_name || ' ' || p.last_name),
          'subtitle', a.type || ' · ' || coalesce(a.department, '') || ' · ' || to_char(a.starts_at at time zone 'Africa/Lagos', 'DD Mon, HH24:MI'),
          'switchId', p.switch_id, 'status', a.status)
       from public.appointments a join public.patients p on p.id = a.patient_id
       where a.organization_id = p_organization_id and a.starts_at > now() - interval '30 days'
         and (p.first_name || ' ' || p.last_name ilike pat or p.switch_id ilike pat or a.queue_number ilike pat)
       order by abs(extract(epoch from a.starts_at - now())) limit n)
      union all
      (select jsonb_build_object('type', 'lab', 'id', l.id, 'title', l.order_number,
          'subtitle', btrim(p.first_name || ' ' || p.last_name) || ' · ' || initcap(l.priority) || ' · ' || initcap(l.status),
          'switchId', p.switch_id, 'status', l.status)
       from public.lab_orders l join public.patients p on p.id = l.patient_id
       where l.organization_id = p_organization_id
         and (l.order_number ilike pat or p.first_name || ' ' || p.last_name ilike pat or p.switch_id ilike pat)
       order by l.created_at desc limit n)
      union all
      (select jsonb_build_object('type', 'prescription', 'id', rx.id, 'title', rx.drug_name || case when nullif(btrim(rx.dosage), '') is not null and position(lower(btrim(rx.dosage)) in lower(rx.drug_name)) = 0 then ' ' || btrim(rx.dosage) else '' end,
          'subtitle', btrim(p.first_name || ' ' || p.last_name) || ' · ' || initcap(rx.status),
          'switchId', p.switch_id, 'status', rx.status)
       from public.prescriptions rx join public.patients p on p.id = rx.patient_id
       where rx.organization_id = p_organization_id
         and (rx.drug_name ilike pat or p.first_name || ' ' || p.last_name ilike pat or p.switch_id ilike pat)
       order by rx.created_at desc limit n)
      union all
      (select jsonb_build_object('type', 'staff', 'id', m.id, 'title', coalesce(nullif(pr.full_name, ''), pr.email),
          'subtitle', initcap(replace(m.role, '-', ' ')) || coalesce(' · ' || m.department, '') || ' · ' || initcap(m.status),
          'switchId', null, 'status', m.status)
       from public.memberships m join public.profiles pr on pr.id = m.user_id
       where m.organization_id = p_organization_id
         and (pr.full_name ilike pat or pr.email ilike pat or m.department ilike pat)
       order by pr.full_name limit n)
    ) results
  );
end;
$$;
