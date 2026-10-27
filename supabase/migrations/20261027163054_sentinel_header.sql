-- Sentinel header: global search and the activity inbox (with per-member read state).

alter table public.sentinel_users add column if not exists inbox_seen_at timestamptz;

-- Search across the organisation's cases, outbreaks, alerts, facilities and the disease registry.
create or replace function public.sentinel_search(p_sentinel_org uuid, p_query text, p_limit integer default 6)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
  v_like text;
  v_limit integer := least(greatest(coalesce(p_limit, 6), 1), 20);
begin
  if not private.is_sentinel_member(p_sentinel_org) then
    raise exception 'Not a member of this Sentinel organisation' using errcode = '42501';
  end if;
  if length(v_q) < 2 then
    return jsonb_build_object('cases', '[]'::jsonb, 'outbreaks', '[]'::jsonb, 'alerts', '[]'::jsonb, 'facilities', '[]'::jsonb, 'diseases', '[]'::jsonb);
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  return jsonb_build_object(
    'cases', coalesce((
      select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('id', c.id, 'reportId', c.report_id, 'disease', c.disease, 'state', c.state, 'lga', c.lga,
                                  'status', c.case_status, 'at', c.report_date) x
        from public.sentinel_cases c
        where c.sentinel_org_id = p_sentinel_org
          and (c.report_id ilike v_like or c.disease ilike v_like or c.state ilike v_like or c.lga ilike v_like
               or c.patient_ref ilike v_like or c.external_ref ilike v_like or c.source_label ilike v_like)
        order by c.report_date desc, c.created_at desc limit v_limit) s), '[]'::jsonb),
    'outbreaks', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('id', o.id, 'disease', o.disease, 'state', o.state, 'lga', o.lga, 'status', o.status, 'severity', o.severity) x
        from public.sentinel_outbreaks o
        where o.sentinel_org_id = p_sentinel_org and (o.disease ilike v_like or o.state ilike v_like or o.lga ilike v_like)
        order by (o.status in ('active', 'monitoring')) desc, o.start_date desc nulls last limit v_limit) s), '[]'::jsonb),
    'alerts', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('id', a.id, 'title', a.title, 'severity', a.severity, 'status', a.status, 'state', a.state) x
        from public.sentinel_alerts a
        where a.sentinel_org_id = p_sentinel_org and (a.title ilike v_like or a.disease ilike v_like or a.state ilike v_like or a.message ilike v_like)
        order by (a.status <> 'resolved') desc, a.created_at desc limit v_limit) s), '[]'::jsonb),
    'facilities', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('id', f.id, 'name', f.facility_name, 'type', f.facility_type, 'state', f.state, 'lga', f.lga, 'consent', f.consent_status) x
        from public.sentinel_linked_facilities f
        where f.sentinel_org_id = p_sentinel_org and (f.facility_name ilike v_like or f.state ilike v_like or f.lga ilike v_like)
        order by f.is_active desc, f.facility_name limit v_limit) s), '[]'::jsonb),
    'diseases', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('id', d.id, 'name', d.name, 'category', d.category, 'notifiable', d.notifiable) x
        from public.sentinel_diseases d
        where d.name ilike v_like or d.id ilike v_like or exists (select 1 from unnest(d.match_terms) t where t ilike v_like)
        order by d.name limit v_limit) s), '[]'::jsonb)
  );
end;
$$;

-- Recent activity by other people (and by hospitals / API feeds) in the organisation.
create or replace function public.sentinel_inbox(p_sentinel_org uuid, p_limit integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seen timestamptz;
  v_items jsonb;
begin
  if not private.is_sentinel_member(p_sentinel_org) then
    raise exception 'Not a member of this Sentinel organisation' using errcode = '42501';
  end if;
  select u.inbox_seen_at into v_seen from public.sentinel_users u where u.id = auth.uid() and u.sentinel_org_id = p_sentinel_org;

  with feed as (
    select e.id, 'case' as kind, e.kind as event, e.case_id as target_id, e.actor_name as actor, e.created_at as at,
      case e.kind
        when 'reported' then 'New ' || c.disease || ' case reported'
        when 'status' then c.report_id || ' marked ' || replace(e.detail->>'to', '_', ' ')
        when 'lab' then c.report_id || case when (e.detail->>'lab_confirmed')::boolean then ' lab-confirmed' else ' lab result cleared' end
        when 'outbreak' then c.report_id || case when e.detail->>'outbreak_id' is null then ' unlinked from outbreak' else ' linked to an outbreak' end
        when 'note' then 'Note on ' || c.report_id
        when 'contact_tracing' then 'Contact tracing ' || case when (e.detail->>'initiated')::boolean then 'started' else 'stopped' end || ' for ' || c.report_id
        else c.report_id || ' updated'
      end as title,
      case when e.kind = 'note' then left(e.detail->>'text', 140) else concat_ws(' · ', c.report_id, c.disease, nullif(concat_ws(', ', c.lga, c.state), '')) end as detail
    from public.sentinel_case_events e
    join public.sentinel_cases c on c.id = e.case_id
    where e.sentinel_org_id = p_sentinel_org and e.actor_id is distinct from auth.uid()
    union all
    select e.id, 'outbreak', e.kind, e.outbreak_id, e.actor_name, e.created_at,
      case e.kind
        when 'declared' then o.disease || ' outbreak declared in ' || o.state
        when 'severity' then o.disease || ' outbreak severity now ' || (e.detail->>'to')
        when 'status' then o.disease || ' outbreak ' || replace(e.detail->>'to', '_', ' ')
        when 'response' then 'Response team ' || case when (e.detail->>'deployed')::boolean then 'deployed' else 'stood down' end || ' · ' || o.disease
        when 'cases_linked' then coalesce(e.detail->>'count', 'New') || ' cases linked to ' || o.disease || ' outbreak'
        when 'figures' then o.disease || ' outbreak figures updated'
        else 'Update on ' || o.disease || ' outbreak'
      end,
      case when e.kind = 'update' then left(coalesce(e.detail->>'text', e.detail->>'note'), 140) else concat_ws(', ', o.lga, o.state) end
    from public.sentinel_outbreak_events e
    join public.sentinel_outbreaks o on o.id = e.outbreak_id
    where e.sentinel_org_id = p_sentinel_org and e.actor_id is distinct from auth.uid()
    union all
    select f.id, 'facility', f.consent_status, f.id, f.facility_name, coalesce(f.consented_at, f.updated_at),
      f.facility_name || case f.consent_status when 'approved' then ' approved data sharing' when 'declined' then ' declined data sharing' else ' withdrew data sharing' end,
      concat_ws(', ', f.lga, f.state)
    from public.sentinel_linked_facilities f
    where f.sentinel_org_id = p_sentinel_org and f.vitalink_org_id is not null and f.consent_status in ('approved', 'declined', 'revoked')
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'event', event, 'targetId', target_id, 'actor', actor, 'at', at,
                                               'title', title, 'detail', detail, 'unread', v_seen is null or at > v_seen) order by at desc), '[]'::jsonb)
  into v_items
  from (select * from feed order by at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) f;

  return jsonb_build_object('items', v_items, 'seenAt', v_seen,
    'unread', (select count(*) from jsonb_array_elements(v_items) i where (i->>'unread')::boolean));
end;
$$;

create or replace function public.sentinel_mark_inbox_seen(p_sentinel_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sentinel_users set inbox_seen_at = now() where id = auth.uid() and sentinel_org_id = p_sentinel_org;
  if not found then raise exception 'Not a member of this Sentinel organisation' using errcode = '42501'; end if;
end;
$$;

revoke all on function public.sentinel_search(uuid, text, integer), public.sentinel_inbox(uuid, integer), public.sentinel_mark_inbox_seen(uuid) from public, anon;
grant execute on function public.sentinel_search(uuid, text, integer), public.sentinel_inbox(uuid, integer), public.sentinel_mark_inbox_seen(uuid) to authenticated;
