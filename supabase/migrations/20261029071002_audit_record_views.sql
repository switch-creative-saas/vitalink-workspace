-- Who opened which patient's record, for the Security & Audit page (accountability under the
-- Nigeria Data Protection Act). Repeat opens by the same person within 10 minutes count once.
create or replace function public.audit_record_view(p_patient_id uuid, p_section text default 'emr')
returns void language plpgsql security definer set search_path = '' as $$
declare v_patient public.patients;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select * into v_patient from public.patients where id = p_patient_id;
  if v_patient.id is null or not private.is_member(v_patient.organization_id) then return; end if;
  if exists (select 1 from public.audit_logs where actor_id = auth.uid() and entity = 'patients' and entity_id = p_patient_id::text
             and action = 'view_record' and created_at > now() - interval '10 minutes') then return; end if;
  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
  values (v_patient.organization_id, auth.uid(), 'view_record', 'patients', p_patient_id::text,
          jsonb_build_object('summary', 'Opened the medical record of ' || v_patient.first_name || ' ' || v_patient.last_name || ' (' || coalesce(v_patient.switch_id, '') || ')',
                             'section', left(coalesce(p_section, 'emr'), 40)));
end;
$$;
revoke all on function public.audit_record_view(uuid, text) from public, anon;
grant execute on function public.audit_record_view(uuid, text) to authenticated;
