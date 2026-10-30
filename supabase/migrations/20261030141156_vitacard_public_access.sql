-- VitaCard taps. Each card carries a link with a random token (https://<app>/card/<token>):
--
--  * Anyone who taps it sees the emergency profile: life-saving basics only.
--  * The patient's PIN (set at the hospital, stored as a bcrypt hash) unlocks their full record for
--    15 minutes, on plans with VitaCard scanning. Five wrong PINs lock the card for 15 minutes.
--  * Every view and PIN attempt is logged (card_access_log, readable by workspace security roles).
--
-- Staff issue, re-PIN and disable cards through the card_* functions below. The public side is
-- served by the vitacard edge function (service role only): nothing here is callable signed out.

create table if not exists public.patient_cards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  token text not null unique,
  pin_hash text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);
create unique index if not exists patient_cards_one_active on public.patient_cards (patient_id) where status = 'active';
alter table public.patient_cards enable row level security;
revoke all on public.patient_cards from anon, authenticated;
grant select (id, organization_id, patient_id, token, status, locked_until, created_at, last_used_at) on public.patient_cards to authenticated;
drop policy if exists "registration staff read cards" on public.patient_cards;
create policy "registration staff read cards" on public.patient_cards
  for select to authenticated using (private.has_role(organization_id, private.clinical_write_roles()));

create table if not exists public.card_access_log (
  id bigint generated always as identity primary key,
  card_id uuid not null references public.patient_cards(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  kind text not null check (kind in ('emergency', 'unlock', 'wrong_pin', 'locked', 'records')),
  at timestamptz not null default now()
);
create index if not exists card_access_log_card_idx on public.card_access_log (card_id, at desc);
alter table public.card_access_log enable row level security;
revoke all on public.card_access_log from anon, authenticated;
grant select on public.card_access_log to authenticated;
drop policy if exists "security roles read card access" on public.card_access_log;
create policy "security roles read card access" on public.card_access_log
  for select to authenticated using (private.has_role(organization_id, private.admin_roles()));

create table if not exists private.card_sessions (
  token_hash text primary key,
  card_id uuid not null references public.patient_cards(id) on delete cascade,
  expires_at timestamptz not null
);

-- PINs: 4 to 6 digits, not all the same digit and not a straight run like 1234 or 9876.
create or replace function private.card_pin_ok(p_pin text)
returns boolean language sql immutable set search_path = '' as $$
  select p_pin ~ '^[0-9]{4,6}$'
     and p_pin !~ '^(.)\1+$'
     and position(p_pin in '0123456789') = 0
     and position(p_pin in '9876543210') = 0
$$;

-- ---------- staff ----------

/** Gives the patient a card link and PIN (replacing any earlier card). Returns the token. */
create or replace function public.card_issue(p_patient_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := (select organization_id from public.patients where id = p_patient_id);
  v_token text;
  v_id uuid;
begin
  if v_org is null or not private.has_role(v_org, private.clinical_write_roles()) then
    raise exception 'Your role cannot set up VitaCards' using errcode = '42501';
  end if;
  if not private.card_pin_ok(coalesce(p_pin, '')) then
    raise exception 'Choose a 4–6 digit PIN that isn''t all one digit or a run like 1234' using errcode = '22023';
  end if;
  update public.patient_cards set status = 'disabled', updated_at = now() where patient_id = p_patient_id and status = 'active';
  v_token := translate(rtrim(encode(extensions.gen_random_bytes(18), 'base64'), '='), '+/', '-_');
  insert into public.patient_cards (organization_id, patient_id, token, pin_hash, created_by)
  values (v_org, p_patient_id, v_token, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), auth.uid())
  returning id into v_id;
  update public.patients set nfc_active = true where id = p_patient_id;
  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
  values (v_org, auth.uid(), 'card_issued', 'patient_cards', v_id::text, jsonb_build_object('patient_id', p_patient_id));
  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;

/** Sets a new PIN (forgotten PIN) and clears any lockout. */
create or replace function public.card_set_pin(p_card_id uuid, p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.patient_cards;
begin
  select * into v_card from public.patient_cards where id = p_card_id;
  if v_card.id is null or not private.has_role(v_card.organization_id, private.clinical_write_roles()) then
    raise exception 'Your role cannot change VitaCard PINs' using errcode = '42501';
  end if;
  if not private.card_pin_ok(coalesce(p_pin, '')) then
    raise exception 'Choose a 4–6 digit PIN that isn''t all one digit or a run like 1234' using errcode = '22023';
  end if;
  update public.patient_cards set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), failed_attempts = 0, locked_until = null, updated_at = now()
  where id = p_card_id;
  delete from private.card_sessions where card_id = p_card_id;
  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
  values (v_card.organization_id, auth.uid(), 'card_pin_reset', 'patient_cards', p_card_id::text, jsonb_build_object('patient_id', v_card.patient_id));
end;
$$;

/** Turns a lost or replaced card off: its link stops working at once. */
create or replace function public.card_disable(p_card_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_card public.patient_cards;
begin
  select * into v_card from public.patient_cards where id = p_card_id;
  if v_card.id is null or not private.has_role(v_card.organization_id, private.clinical_write_roles()) then
    raise exception 'Your role cannot disable VitaCards' using errcode = '42501';
  end if;
  update public.patient_cards set status = 'disabled', updated_at = now() where id = p_card_id;
  delete from private.card_sessions where card_id = p_card_id;
  update public.patients set nfc_active = false where id = v_card.patient_id
    and not exists (select 1 from public.patient_cards c where c.patient_id = v_card.patient_id and c.status = 'active');
  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
  values (v_card.organization_id, auth.uid(), 'card_disabled', 'patient_cards', p_card_id::text, jsonb_build_object('patient_id', v_card.patient_id));
end;
$$;

revoke all on function public.card_issue(uuid, text) from public, anon;
revoke all on function public.card_set_pin(uuid, text) from public, anon;
revoke all on function public.card_disable(uuid) from public, anon;
grant execute on function public.card_issue(uuid, text) to authenticated;
grant execute on function public.card_set_pin(uuid, text) to authenticated;
grant execute on function public.card_disable(uuid) to authenticated;

-- ---------- public side (vitacard edge function only) ----------

create or replace function private.card_log(p_card public.patient_cards, p_kind text)
returns void language sql security definer set search_path = '' as $$
  insert into public.card_access_log (card_id, organization_id, patient_id, kind) values (p_card.id, p_card.organization_id, p_card.patient_id, p_kind);
$$;

/** Emergency profile for a tapped card: life-saving basics only. Null if the link isn't active. */
create or replace function public.card_emergency(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_card public.patient_cards;
  v_recent integer;
  v_result jsonb;
begin
  select * into v_card from public.patient_cards where token = p_token and status = 'active';
  if v_card.id is null then return null; end if;
  select count(*) into v_recent from public.card_access_log where card_id = v_card.id and at > now() - interval '1 minute';
  if v_recent >= 30 then raise exception 'Too many requests for this card. Wait a minute.' using errcode = '53400'; end if;
  perform private.card_log(v_card, 'emergency');
  update public.patient_cards set last_used_at = now() where id = v_card.id;

  select jsonb_build_object(
    'firstName', p.first_name, 'lastName', p.last_name, 'vitalinkId', p.switch_id,
    'age', case when p.date_of_birth is null then null else extract(year from age(p.date_of_birth))::int end,
    'sex', p.gender, 'bloodGroup', p.blood_group, 'genotype', p.genotype,
    'allergies', p.allergies, 'conditions', p.chronic_conditions, 'pregnancy', p.pregnancy_status,
    'disability', p.disability_status,
    'medicines', array_remove(array[nullif(btrim(p.current_medications), '')], null) || coalesce((
      select array_agg(distinct rx.drug_name || coalesce(' ' || nullif(rx.dosage, ''), ''))
      from public.prescriptions rx where rx.patient_id = p.id and rx.status in ('active', 'dispensed') and rx.created_at > now() - interval '90 days'), '{}'),
    'emergencyContact', jsonb_build_object('name', p.emergency_contact_name, 'relationship', p.emergency_relationship, 'phone', p.emergency_phone),
    'hospital', jsonb_build_object('name', o.name, 'phone', o.contact_phone, 'address', nullif(concat_ws(', ', nullif(o.address, ''), nullif(o.state, '')), '')),
    'photo', p.profile_photo_url,
    'fullRecordsAvailable', private.org_has_module(v_card.organization_id, 'nfc-scanning'),
    'locked', v_card.locked_until is not null and v_card.locked_until > now()
  ) into v_result
  from public.patients p join public.organizations o on o.id = p.organization_id
  where p.id = v_card.patient_id;
  return v_result;
end;
$$;

/** Checks the PIN; on success opens a 15-minute session for the full record. */
create or replace function public.card_unlock(p_token text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_card public.patient_cards;
  v_session text;
begin
  select * into v_card from public.patient_cards where token = p_token and status = 'active';
  if v_card.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not private.org_has_module(v_card.organization_id, 'nfc-scanning') then
    return jsonb_build_object('ok', false, 'reason', 'emergency_only');
  end if;
  if v_card.locked_until is not null and v_card.locked_until > now() then
    perform private.card_log(v_card, 'locked');
    return jsonb_build_object('ok', false, 'reason', 'locked', 'until', v_card.locked_until);
  end if;
  if v_card.pin_hash <> extensions.crypt(coalesce(p_pin, ''), v_card.pin_hash) then
    perform private.card_log(v_card, 'wrong_pin');
    update public.patient_cards set
      failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
      locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end,
      updated_at = now()
    where id = v_card.id
    returning * into v_card;
    return jsonb_build_object('ok', false, 'reason', case when v_card.locked_until > now() then 'locked' else 'wrong_pin' end,
      'attemptsLeft', 5 - v_card.failed_attempts, 'until', v_card.locked_until);
  end if;
  update public.patient_cards set failed_attempts = 0, locked_until = null, last_used_at = now() where id = v_card.id;
  delete from private.card_sessions where expires_at < now();
  v_session := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.card_sessions (token_hash, card_id, expires_at)
  values (encode(extensions.digest(v_session, 'sha256'), 'hex'), v_card.id, now() + interval '15 minutes');
  perform private.card_log(v_card, 'unlock');
  return jsonb_build_object('ok', true, 'session', v_session, 'expiresAt', now() + interval '15 minutes');
end;
$$;

/** The full record behind an unlocked session. Null once the session has expired. */
create or replace function public.card_records(p_session text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_card public.patient_cards;
  v_patient public.patients;
begin
  select c.* into v_card from private.card_sessions s join public.patient_cards c on c.id = s.card_id
  where s.token_hash = encode(extensions.digest(coalesce(p_session, ''), 'sha256'), 'hex') and s.expires_at > now() and c.status = 'active';
  if v_card.id is null then return null; end if;
  select * into v_patient from public.patients where id = v_card.patient_id;
  perform private.card_log(v_card, 'records');

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'firstName', v_patient.first_name, 'middleName', v_patient.middle_name, 'lastName', v_patient.last_name, 'vitalinkId', v_patient.switch_id,
      'dateOfBirth', v_patient.date_of_birth, 'sex', v_patient.gender, 'bloodGroup', v_patient.blood_group, 'genotype', v_patient.genotype,
      'phone', v_patient.phone, 'email', v_patient.email, 'address', v_patient.address, 'state', v_patient.state,
      'maritalStatus', v_patient.marital_status, 'occupation', v_patient.occupation, 'photo', v_patient.profile_photo_url,
      'allergies', v_patient.allergies, 'conditions', v_patient.chronic_conditions, 'medicines', v_patient.current_medications,
      'familyHistory', v_patient.family_medical_history, 'surgeries', v_patient.past_surgeries, 'pregnancy', v_patient.pregnancy_status,
      'insurance', jsonb_build_object('provider', v_patient.insurance_provider, 'policyNumber', v_patient.insurance_policy_number,
        'type', v_patient.insurance_type, 'expires', v_patient.insurance_expiry_date),
      'emergencyContact', jsonb_build_object('name', v_patient.emergency_contact_name, 'relationship', v_patient.emergency_relationship,
        'phone', v_patient.emergency_phone, 'address', v_patient.emergency_address)),
    'hospital', (select jsonb_build_object('name', o.name, 'phone', o.contact_phone, 'email', o.contact_email,
        'address', nullif(concat_ws(', ', nullif(o.address, ''), nullif(o.state, '')), '')) from public.organizations o where o.id = v_card.organization_id),
    'prescriptions', coalesce((select jsonb_agg(x order by x->>'date' desc) from (
        select jsonb_build_object('drug', rx.drug_name, 'dosage', rx.dosage, 'frequency', rx.frequency, 'duration', rx.duration,
          'route', rx.route, 'instructions', rx.instructions, 'status', rx.status, 'date', rx.created_at) x
        from public.prescriptions rx where rx.patient_id = v_patient.id and rx.status <> 'cancelled' order by rx.created_at desc limit 60) t), '[]'),
    'appointments', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('at', a.starts_at, 'type', a.type, 'department', a.department, 'status', a.status, 'reason', a.visit_reason,
          'clinician', (select coalesce(nullif(pr.full_name, ''), 'Clinician') from public.profiles pr where pr.id = a.clinician_id)) x
        from public.appointments a where a.patient_id = v_patient.id order by a.starts_at desc limit 40) t), '[]'),
    'labResults', coalesce((select jsonb_agg(x order by x->>'date' desc) from (
        select jsonb_build_object('test', l.test_name, 'value', l.value, 'unit', l.unit, 'flag', l.flag, 'range', l.reference_range,
          'interpretation', l.interpretation, 'date', coalesce(l.resulted_at, l.ordered_at)) x
        from public.lab_results l where l.patient_id = v_patient.id and l.status = 'Completed' order by coalesce(l.resulted_at, l.ordered_at) desc limit 60) t), '[]'),
    'visits', coalesce((select jsonb_agg(x order by x->>'date' desc) from (
        select jsonb_build_object('date', coalesce(n.signed_at, n.created_at), 'complaint', n.chief_complaint, 'diagnosis', n.primary_diagnosis,
          'clinician', (select coalesce(nullif(pr.full_name, ''), 'Clinician') from public.profiles pr where pr.id = coalesce(n.signed_by, n.author_id)),
          'followUp', n.content ->> 'followUp') x
        from public.clinical_notes n where n.patient_id = v_patient.id and n.status = 'signed' order by coalesce(n.signed_at, n.created_at) desc limit 40) t), '[]'),
    'vitals', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
        select jsonb_build_object('at', v.recorded_at, 'temperature', v.temperature_c, 'pulse', v.heart_rate, 'systolic', v.systolic,
          'diastolic', v.diastolic, 'spo2', v.spo2, 'weight', v.weight_kg, 'height', v.height_cm) x
        from public.vitals v where v.patient_id = v_patient.id order by v.recorded_at desc limit 10) t), '[]')
  );
end;
$$;

/** Ends an unlocked session (the "Lock" button). */
create or replace function public.card_lock(p_session text)
returns void language sql security definer set search_path = '' as $$
  delete from private.card_sessions where token_hash = encode(extensions.digest(coalesce(p_session, ''), 'sha256'), 'hex');
$$;

revoke all on function public.card_emergency(text) from public, anon, authenticated;
revoke all on function public.card_unlock(text, text) from public, anon, authenticated;
revoke all on function public.card_records(text) from public, anon, authenticated;
revoke all on function public.card_lock(text) from public, anon, authenticated;
grant execute on function public.card_emergency(text) to service_role;
grant execute on function public.card_unlock(text, text) to service_role;
grant execute on function public.card_records(text) to service_role;
grant execute on function public.card_lock(text) to service_role;
revoke all on function private.card_log(public.patient_cards, text) from public, anon, authenticated;
revoke all on function private.card_pin_ok(text) from public, anon, authenticated;
