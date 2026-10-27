-- Safer patient matching on import:
--  * never merge into a VitaLink patient that is already linked to a *different* record
--    of the same EMR (if the source keeps two records, they stay two patients here);
--  * a name + date-of-birth match also needs the same sex.
create or replace function private.emr_linked_elsewhere(p_patient uuid, p_connection uuid, p_external text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.emr_patient_links
                 where connection_id = p_connection and patient_id = p_patient and external_id <> p_external)
$$;

do $migration$
declare
  d text := pg_get_functiondef('private.emr_apply_import_core'::regproc);
  before text;
begin
  before := d;
  d := replace(d,
    $a$where organization_id = v_conn.organization_id and national_id = btrim(p ->> 'national_id') limit 1;$a$,
    $b$where organization_id = v_conn.organization_id and national_id = btrim(p ->> 'national_id')
          and not private.emr_linked_elsewhere(id, v_conn.id, v_ext) limit 1;$b$);
  d := replace(d,
    $a$and right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 10)
        limit 1;$a$,
    $b$and right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = right(regexp_replace(v_phone, '[^0-9]', '', 'g'), 10)
          and not private.emr_linked_elsewhere(id, v_conn.id, v_ext)
        limit 1;$b$);
  d := replace(d,
    $a$and lower(first_name) = lower(btrim(p ->> 'first_name')) and lower(last_name) = lower(btrim(p ->> 'last_name'))
        limit 1;$a$,
    $b$and lower(first_name) = lower(btrim(p ->> 'first_name')) and lower(last_name) = lower(btrim(p ->> 'last_name'))
          and gender = v_gender and not private.emr_linked_elsewhere(id, v_conn.id, v_ext)
        limit 1;$b$);
  if (length(d) - length(before)) < 200 then
    raise exception 'emr_apply_import_core did not match the expected text; matching rules not updated';
  end if;
  execute d;
end;
$migration$;
