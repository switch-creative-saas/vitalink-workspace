-- Temperatures recorded in Fahrenheit (86-113 °F) are converted, not dropped.
create or replace function private.emr_num(p jsonb, p_key text, p_min numeric, p_max numeric)
returns numeric language sql immutable set search_path = '' as $$
  select case
    when (p ->> p_key) !~ '^-?[0-9]+(\.[0-9]+)?$' then null
    when (p ->> p_key)::numeric between p_min and p_max then (p ->> p_key)::numeric
    when p_key = 'temperature_c' and (p ->> p_key)::numeric between 86 and 113 then round(((p ->> p_key)::numeric - 32) * 5 / 9, 1)
  end
$$;

-- The "importing" flag that lets the import correct its own lab results is switched off
-- as soon as the import returns, so nothing else in the same transaction can use it.
alter function public.emr_apply_import(uuid, jsonb) rename to emr_apply_import_core;
alter function public.emr_apply_import_core(uuid, jsonb) set schema private;
revoke execute on function private.emr_apply_import_core(uuid, jsonb) from public, anon, authenticated;

create function public.emr_apply_import(p_run uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  v_result := private.emr_apply_import_core(p_run, p_payload);
  perform set_config('vitalink.emr_import', 'off', true);
  return v_result;
end;
$$;
revoke execute on function public.emr_apply_import(uuid, jsonb) from public, anon;
grant execute on function public.emr_apply_import(uuid, jsonb) to authenticated, service_role;
