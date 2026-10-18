-- VitaLink Network: records travel with the acceptance.
--
-- The patient consented when the referral was sent, so the chosen records are
-- copied to the receiving hospital the moment it accepts (no separate "share"
-- step on the sender's side that can be forgotten). The receiving hospital then
-- sees them in the patient's EMR via network_patient_received_records().

-- Copies the chosen records' content into the transfer (no permission checks: callers check).
create or replace function private.network_share_items(p_transfer_id uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  t public.network_transfers;
  shared integer;
begin
  select * into t from public.network_transfers where id = p_transfer_id;
  if t.id is null or t.consent_status <> 'consented' then
    return 0;
  end if;
  update public.network_transfer_items i set shared_at = now(), snapshot = case i.record_type
    when 'note' then (select jsonb_build_object('chief_complaint', n.chief_complaint, 'primary_diagnosis', n.primary_diagnosis,
        'content', n.content, 'status', n.status, 'signed_at', n.signed_at, 'created_at', n.created_at,
        'author', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = n.author_id))
      from public.clinical_notes n where n.id = i.record_id and n.organization_id = t.referring_org_id)
    when 'vitals' then (select to_jsonb(v) - 'id' - 'organization_id' - 'patient_id' - 'appointment_id' - 'recorded_by'
      from public.vitals v where v.id = i.record_id and v.organization_id = t.referring_org_id)
    when 'lab_result' then (select jsonb_build_object('test_name', r.test_name, 'test_type', r.test_type, 'value', r.value, 'unit', r.unit,
        'reference_range', r.reference_range, 'flag', r.flag, 'interpretation', r.interpretation, 'resulted_at', r.resulted_at)
      from public.lab_results r where r.id = i.record_id and r.organization_id = t.referring_org_id)
    when 'prescription' then (select jsonb_build_object('drug_name', p.drug_name, 'generic_name', p.generic_name, 'dosage', p.dosage,
        'frequency', p.frequency, 'duration', p.duration, 'route', p.route, 'instructions', p.instructions, 'status', p.status, 'prescribed_at', p.created_at)
      from public.prescriptions p where p.id = i.record_id and p.organization_id = t.referring_org_id)
    when 'document' then (select jsonb_build_object('name', d.name, 'category', d.category, 'mime_type', d.mime_type,
        'size_bytes', d.size_bytes, 'storage_path', d.storage_path, 'uploaded_at', d.created_at)
      from public.patient_documents d where d.id = i.record_id and d.organization_id = t.referring_org_id)
    end
  where i.transfer_id = t.id and i.shared_at is null;
  get diagnostics shared = row_count;
  if shared > 0 then
    update public.network_transfers set records_shared_at = coalesce(records_shared_at, now()) where id = t.id;
  end if;
  return shared;
end;
$$;
revoke execute on function private.network_share_items(uuid) from public, anon, authenticated;

create or replace function public.network_respond(p_transfer_id uuid, p_action text, p_note text default '')
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  t public.network_transfers := private.network_transfer_for(p_transfer_id);
  shared integer;
begin
  if not private.has_role(t.receiving_org_id, private.network_clinical_roles()) then
    raise exception 'Only doctors and admins of the receiving hospital can respond' using errcode = '42501';
  end if;
  if t.status not in ('pending_review', 'info_requested') then
    raise exception 'This % has already been answered', t.kind using errcode = '22023';
  end if;
  if p_action = 'accept' then
    update public.network_transfers set status = 'accepted', accepted_at = now() where id = t.id;
    perform private.network_log(t.id, t.receiving_org_id, 'accepted', coalesce(btrim(p_note), ''));
    shared := private.network_share_items(t.id);
    if shared > 0 then
      perform private.network_log(t.id, t.referring_org_id, 'records_shared',
        shared || ' record' || case when shared = 1 then '' else 's' end || ' shared with ' || t.receiving_org_name || ' (patient consented)');
    end if;
    perform private.network_notify(t.referring_org_id, t, t.receiving_org_name || ' accepted ' || t.number,
      case when shared > 0 then shared || ' authorised record' || case when shared = 1 then ' was' else 's were' end || ' shared with them.' else 'No records were attached.' end
      || coalesce(E'\nNote: ' || nullif(btrim(p_note), ''), ''));
  elsif p_action = 'decline' then
    if coalesce(btrim(p_note), '') = '' then raise exception 'Give a reason for declining' using errcode = '22023'; end if;
    update public.network_transfers set status = 'declined', decline_reason = btrim(p_note) where id = t.id;
    perform private.network_log(t.id, t.receiving_org_id, 'declined', btrim(p_note));
    perform private.network_notify(t.referring_org_id, t, t.receiving_org_name || ' declined ' || t.number, 'Reason: ' || btrim(p_note));
  elsif p_action = 'request_info' then
    if coalesce(btrim(p_note), '') = '' then raise exception 'Say what information you need' using errcode = '22023'; end if;
    update public.network_transfers set status = 'info_requested' where id = t.id;
    perform private.network_log(t.id, t.receiving_org_id, 'info_requested', btrim(p_note));
    perform private.network_notify(t.referring_org_id, t, t.receiving_org_name || ' needs more information on ' || t.number, btrim(p_note));
  else
    raise exception 'Unknown action' using errcode = '22023';
  end if;
end;
$$;

-- Records other hospitals shared about one of our patients (matched by the
-- transfer that registered them, or by VitaLink ID), newest first.
create or replace function public.network_patient_received_records(p_patient_id uuid)
returns table (
  item_id uuid, transfer_id uuid, transfer_number text, from_org text, record_type text, label text,
  record_date timestamptz, shared_at timestamptz, snapshot jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  pat public.patients;
begin
  select * into pat from public.patients where id = p_patient_id;
  if pat.id is null or not private.has_role(pat.organization_id, private.network_roles()) then
    return;
  end if;
  return query
  select i.id, t.id, t.number, t.referring_org_name, i.record_type, i.label, i.record_date, i.shared_at, i.snapshot
  from public.network_transfers t
  join public.network_transfer_items i on i.transfer_id = t.id
  where t.receiving_org_id = pat.organization_id
    and t.consent_status = 'consented'
    and i.shared_at is not null
    and (t.received_patient_id = pat.id or t.patient_snapshot ->> 'switch_id' = pat.switch_id)
  order by i.record_date desc nulls last;
end;
$$;
revoke execute on function public.network_patient_received_records(uuid) from public, anon;
grant execute on function public.network_patient_received_records(uuid) to authenticated;

-- Transfers already accepted before this change: share their records now.
do $$
declare
  rec record;
  shared integer;
begin
  for rec in
    select t.id, t.referring_org_id, t.receiving_org_name from public.network_transfers t
    where t.status in ('accepted', 'records_shared', 'arrived', 'completed') and t.consent_status = 'consented'
      and exists (select 1 from public.network_transfer_items i where i.transfer_id = t.id and i.shared_at is null)
  loop
    shared := private.network_share_items(rec.id);
    if shared > 0 then
      insert into public.network_transfer_events (transfer_id, organization_id, organization_name, actor_name, kind, body)
      values (rec.id, rec.referring_org_id, coalesce((select o.name from public.organizations o where o.id = rec.referring_org_id), ''),
              'VitaLink', 'records_shared', shared || ' record' || case when shared = 1 then '' else 's' end || ' shared with ' || rec.receiving_org_name || ' (patient consented)');
    end if;
  end loop;
end;
$$;
