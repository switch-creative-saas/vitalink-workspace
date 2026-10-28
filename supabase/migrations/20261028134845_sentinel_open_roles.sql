-- Only admins and public-health / surveillance roles can open Sentinel from a healthcare workspace.
create or replace function private.sentinel_roles()
returns text[] language sql immutable set search_path = '' as $$
  select array['super-admin','hospital-admin','ngo-admin','government-admin','public-health-officer','epidemiologist',
               'surveillance-officer','public-health-director','data-monitoring-officer','program-manager','data-analyst',
               'field-officer','public-health-viewer','government-viewer','government-authority','community-health-worker','who-ngo-observer']::text[]
$$;

create or replace function public.open_workspace_sentinel(p_organization_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid := auth.uid();
  v_member public.memberships;
  v_org public.organizations;
  v_access text;
  v_sentinel uuid;
  v_existing public.sentinel_users;
  v_profile record;
begin
  select * into v_member from public.memberships where organization_id = p_organization_id and user_id = v_uid and status = 'active';
  if v_member.id is null then raise exception 'Not a member of this workspace' using errcode = '42501'; end if;
  if not (v_member.role = any (private.sentinel_roles())) then
    raise exception 'Sentinel is for workspace admins and public health officers' using errcode = '42501';
  end if;
  v_access := private.workspace_sentinel_access(p_organization_id);
  if v_access = 'none' then
    return jsonb_build_object('access', 'none');
  end if;

  select * into v_existing from public.sentinel_users where id = v_uid;
  select id into v_sentinel from public.sentinel_organizations where vitalink_org_id = p_organization_id;

  if v_existing.id is not null and (v_sentinel is null or v_existing.sentinel_org_id <> v_sentinel) then
    return jsonb_build_object('access', v_access, 'sentinelOrgId', v_existing.sentinel_org_id, 'own', false);
  end if;

  select * into v_org from public.organizations where id = p_organization_id;
  if v_sentinel is null then
    if not (v_member.role = any (private.admin_roles())) then
      return jsonb_build_object('access', v_access, 'needsAdmin', true);
    end if;
    insert into public.sentinel_organizations (name, type, state, country, contact_email, contact_phone, joined_network, vitalink_org_id)
    values (v_org.name, 'Hospital', coalesce(nullif(v_org.state, ''), 'National'), coalesce(v_org.country, 'Nigeria'), v_org.contact_email, v_org.contact_phone, true, v_org.id)
    returning id into v_sentinel;
    insert into public.sentinel_linked_facilities (sentinel_org_id, facility_name, facility_type, state, vitalink_org_id, data_sharing_consent,
                                                   reporting_frequency, is_active, consent_status, requested_by, consented_by, consented_at)
    values (v_sentinel, v_org.name, 'Hospital', coalesce(nullif(v_org.state, ''), 'Statewide'), v_org.id, true, 'daily', true, 'approved', v_uid, v_uid, now());
  end if;

  if v_existing.id is null then
    select coalesce(nullif(p.full_name, ''), u.email) as name, u.email into v_profile
    from auth.users u left join public.profiles p on p.id = u.id where u.id = v_uid;
    insert into public.sentinel_users (id, sentinel_org_id, full_name, email, role, is_active)
    values (v_uid, v_sentinel, v_profile.name, v_profile.email, 'viewer', true);
  end if;
  perform private.sync_workspace_sentinel(p_organization_id);
  return jsonb_build_object('access', v_access, 'sentinelOrgId', v_sentinel, 'own', true);
end;
$function$;
