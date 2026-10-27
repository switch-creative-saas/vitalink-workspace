-- Offline sync: a lab order (and its test lines) created without a connection
-- gets its ids on the device, so results entered offline for it still match
-- once both are sent. Callers that pass no ids are unaffected.
drop function if exists public.create_lab_order(uuid, jsonb, text, text, text, uuid);

create function public.create_lab_order(p_patient_id uuid, p_tests jsonb, p_priority text DEFAULT 'routine'::text, p_sample_type text DEFAULT 'blood'::text, p_notes text DEFAULT ''::text, p_note_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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

  insert into public.lab_orders (id, organization_id, order_number, patient_id, note_id, priority, sample_type, notes)
  values (coalesce(p_order_id, gen_random_uuid()), org, '', p_patient_id, p_note_id, coalesce(p_priority, 'routine'), coalesce(p_sample_type, 'blood'), coalesce(btrim(p_notes), ''))
  returning id into new_id;

  -- A test sent with a value is recorded as a finished result straight away.
  insert into public.lab_results (id, organization_id, patient_id, note_id, order_id, test_name, test_type, department, unit, reference_range, value, flag, status)
  select coalesce((t ->> 'id')::uuid, gen_random_uuid()), org, p_patient_id, p_note_id, new_id, btrim(t ->> 'name'),
         coalesce(nullif(btrim(t ->> 'testType'), ''), 'General'), coalesce(nullif(btrim(t ->> 'department'), ''), 'Laboratory'),
         coalesce(btrim(t ->> 'unit'), ''), coalesce(btrim(t ->> 'referenceRange'), ''), coalesce(btrim(t ->> 'value'), ''),
         coalesce(t ->> 'flag', 'Normal'),
         case when coalesce(btrim(t ->> 'value'), '') <> '' then 'Completed' else 'Pending' end
  from jsonb_array_elements(p_tests) t;

  return new_id;
end;
$function$;

revoke execute on function public.create_lab_order(uuid, jsonb, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.create_lab_order(uuid, jsonb, text, text, text, uuid, uuid) to authenticated;

create or replace function public.offline_replay(p_request_id uuid, p_fn text, p_args jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_prev jsonb;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  v_prev := private.offline_claim(p_request_id, p_fn);
  if v_prev is not null then return v_prev -> 'result'; end if;

  case p_fn
    when 'create_lab_order' then
      v_result := to_jsonb(public.create_lab_order(
        (p_args ->> 'p_patient_id')::uuid, p_args -> 'p_tests', p_args ->> 'p_priority',
        p_args ->> 'p_sample_type', p_args ->> 'p_notes', (p_args ->> 'p_note_id')::uuid, (p_args ->> 'p_order_id')::uuid));
    when 'save_lab_results' then
      perform public.save_lab_results((p_args ->> 'p_order_id')::uuid, p_args -> 'p_lines', (p_args ->> 'p_complete')::boolean);
    when 'dispense_prescription' then
      v_result := to_jsonb(public.dispense_prescription(
        (p_args ->> 'p_prescription_id')::uuid, (p_args ->> 'p_inventory_id')::uuid, (p_args ->> 'p_quantity')::int));
    else
      raise exception '% can''t be queued offline', p_fn using errcode = '22023';
  end case;

  perform private.offline_store(p_request_id, v_result);
  return v_result;
end;
$$;
