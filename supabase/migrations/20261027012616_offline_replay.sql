-- Offline sync: changes made without a connection are queued on the device and
-- sent when it returns. Inserts carry a device-generated id, so a resend is a
-- harmless duplicate-key error. Functions that aren't naturally repeatable go
-- through offline_replay, which runs each queued request id at most once.

create table if not exists private.offline_requests (
  id uuid primary key,
  user_id uuid not null,
  fn text not null,
  result jsonb,
  created_at timestamptz not null default now()
);

create or replace function private.offline_claim(p_request_id uuid, p_fn text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_row private.offline_requests;
begin
  insert into private.offline_requests (id, user_id, fn) values (p_request_id, auth.uid(), p_fn)
  on conflict (id) do nothing;
  if found then return null; end if;
  -- Already applied (the device lost the reply and sent it again).
  select * into v_row from private.offline_requests where id = p_request_id;
  if v_row.user_id is distinct from auth.uid() then
    raise exception 'Request id already used' using errcode = '42501';
  end if;
  return jsonb_build_object('result', v_row.result);
end;
$$;

create or replace function private.offline_store(p_request_id uuid, p_result jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.offline_requests set result = p_result where id = p_request_id and user_id = auth.uid();
$$;

revoke all on function private.offline_claim(uuid, text), private.offline_store(uuid, jsonb) from public, anon;
grant execute on function private.offline_claim(uuid, text), private.offline_store(uuid, jsonb) to authenticated;

-- Runs as the caller, so the wrapped function applies its usual permission checks.
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
        p_args ->> 'p_sample_type', p_args ->> 'p_notes', (p_args ->> 'p_note_id')::uuid));
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

revoke execute on function public.offline_replay(uuid, text, jsonb) from public, anon;
grant execute on function public.offline_replay(uuid, text, jsonb) to authenticated;

-- Replays only matter for a few days; keep a month.
select cron.schedule('vitalink-prune-offline-requests', '17 3 * * *',
  $$delete from private.offline_requests where created_at < now() - interval '30 days'$$);
