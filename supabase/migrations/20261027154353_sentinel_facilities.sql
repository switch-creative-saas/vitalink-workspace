-- Sentinel reporting network: VitaLink hospitals that share data (requested by Sentinel,
-- approved by the hospital) and the organisation's own direct reporting sites (clinics,
-- PHCs, community points that report through Sentinel officers). Changes go through
-- role-checked functions; the overview gives each facility's real reporting activity.

drop policy if exists "sentinel admins link facilities" on public.sentinel_linked_facilities;
revoke insert, update, delete, truncate on public.sentinel_linked_facilities from authenticated, anon;

-- A case attributed to a facility counts as that facility reporting.
create or replace function private.sentinel_case_facility_reported()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.facility_id is not null then
    update public.sentinel_linked_facilities
    set last_report_date = greatest(coalesce(last_report_date, new.report_date), new.report_date)
    where id = new.facility_id;
  end if;
  return null;
end;
$$;
create trigger sentinel_cases_facility_reported after insert on public.sentinel_cases
  for each row execute function private.sentinel_case_facility_reported();

/** Facilities with what they've actually sent. */
create or replace function public.sentinel_facility_overview(p_sentinel_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not private.is_sentinel_member(p_sentinel_org) then
    raise exception 'Not a member of this Sentinel organisation' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'name', f.facility_name, 'type', f.facility_type, 'state', f.state, 'lga', f.lga, 'ward', f.ward,
    'vitalink', f.vitalink_org_id is not null, 'consentStatus', f.consent_status, 'isActive', f.is_active,
    'frequency', f.reporting_frequency, 'linkedAt', f.linked_at, 'consentedAt', f.consented_at,
    'lastSeen', greatest(f.last_report_date, s.last_day),
    'casesTotal', coalesce(c.total, 0), 'cases7d', coalesce(c.week, 0), 'encounters7d', coalesce(s.week, 0)
  ) order by f.is_active desc, (f.consent_status = 'pending') desc, f.facility_name), '[]')
  into v_result
  from public.sentinel_linked_facilities f
  left join lateral (select count(*) total, count(*) filter (where report_date >= current_date - 6) week
                     from public.sentinel_cases where facility_id = f.id) c on true
  left join lateral (select max(day) last_day, sum(encounters) filter (where day >= current_date - 6) week
                     from public.sentinel_syndromic_counts where facility_id = f.id) s on true
  where f.sentinel_org_id = p_sentinel_org;
  return v_result;
end;
$$;

/** A direct reporting site (not on VitaLink): it reports through this organisation's officers. */
create or replace function public.sentinel_add_facility(p_sentinel_org uuid, p_facility jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_type text := coalesce(nullif(p_facility ->> 'type', ''), 'Clinic');
begin
  if not private.sentinel_can_declare(p_sentinel_org) then
    raise exception 'Only Sentinel admins and officers can register reporting sites' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_facility ->> 'name', ''))) = 0 then raise exception 'Enter the facility name' using errcode = '22023'; end if;
  if nullif(btrim(p_facility ->> 'state'), '') is null then raise exception 'Choose the state' using errcode = '22023'; end if;
  insert into public.sentinel_linked_facilities (sentinel_org_id, facility_name, facility_type, state, lga, ward, reporting_frequency,
    data_sharing_consent, consent_status, consented_at, requested_by, consented_by, is_active)
  values (p_sentinel_org, btrim(p_facility ->> 'name'), v_type, btrim(p_facility ->> 'state'), nullif(btrim(p_facility ->> 'lga'), ''),
    nullif(btrim(p_facility ->> 'ward'), ''), coalesce(nullif(p_facility ->> 'frequency', ''), 'weekly'),
    true, 'approved', now(), auth.uid(), auth.uid(), true)
  returning id into v_id;
  return v_id;
end;
$$;

/** Edits a facility. VitaLink hospitals keep the name, type and state their own workspace gives them. */
create or replace function public.sentinel_update_facility(p_facility uuid, p_changes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_f public.sentinel_linked_facilities;
begin
  select * into v_f from public.sentinel_linked_facilities where id = p_facility;
  if v_f.id is null then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  if not private.sentinel_can_declare(v_f.sentinel_org_id) then
    raise exception 'Only Sentinel admins and officers can edit facilities' using errcode = '42501';
  end if;
  update public.sentinel_linked_facilities set
    facility_name = case when v_f.vitalink_org_id is null and p_changes ? 'name' then coalesce(nullif(btrim(p_changes ->> 'name'), ''), facility_name) else facility_name end,
    facility_type = case when v_f.vitalink_org_id is null and p_changes ? 'type' then p_changes ->> 'type' else facility_type end,
    state = case when v_f.vitalink_org_id is null and p_changes ? 'state' then coalesce(nullif(btrim(p_changes ->> 'state'), ''), state) else state end,
    lga = case when p_changes ? 'lga' then nullif(btrim(p_changes ->> 'lga'), '') else lga end,
    ward = case when p_changes ? 'ward' then nullif(btrim(p_changes ->> 'ward'), '') else ward end,
    reporting_frequency = coalesce(nullif(p_changes ->> 'frequency', ''), reporting_frequency),
    -- Reactivating a VitaLink hospital needs its consent again (sentinel_request_link).
    is_active = case when p_changes ? 'is_active' and (v_f.vitalink_org_id is null or not (p_changes ->> 'is_active')::boolean)
                     then (p_changes ->> 'is_active')::boolean else is_active end,
    updated_at = now()
  where id = p_facility;
end;
$$;

/**
 * Removes a facility from the network. A pending VitaLink request is withdrawn; an approved VitaLink
 * hospital stops sharing (the hospital sees it as stopped). A direct site with reports is deactivated
 * rather than deleted so its cases keep their facility.
 */
create or replace function public.sentinel_remove_facility(p_facility uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_f public.sentinel_linked_facilities;
begin
  select * into v_f from public.sentinel_linked_facilities where id = p_facility;
  if v_f.id is null then raise exception 'Facility not found' using errcode = 'P0002'; end if;
  if not private.is_sentinel_admin(v_f.sentinel_org_id) then
    raise exception 'Only Sentinel admins can remove facilities' using errcode = '42501';
  end if;
  if v_f.vitalink_org_id is not null and v_f.consent_status <> 'approved' then
    delete from public.sentinel_linked_facilities where id = p_facility;
    return 'withdrawn';
  end if;
  if v_f.vitalink_org_id is not null then
    update public.sentinel_linked_facilities set consent_status = 'revoked', is_active = false, updated_at = now() where id = p_facility;
    return 'stopped';
  end if;
  if exists (select 1 from public.sentinel_cases where facility_id = p_facility) then
    update public.sentinel_linked_facilities set is_active = false, updated_at = now() where id = p_facility;
    return 'deactivated';
  end if;
  delete from public.sentinel_linked_facilities where id = p_facility;
  return 'deleted';
end;
$$;

revoke execute on function public.sentinel_facility_overview(uuid), public.sentinel_add_facility(uuid, jsonb), public.sentinel_update_facility(uuid, jsonb),
  public.sentinel_remove_facility(uuid) from public, anon;
grant execute on function public.sentinel_facility_overview(uuid), public.sentinel_add_facility(uuid, jsonb), public.sentinel_update_facility(uuid, jsonb),
  public.sentinel_remove_facility(uuid) to authenticated;
