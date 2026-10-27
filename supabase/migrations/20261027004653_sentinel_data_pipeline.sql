-- VitaLink Sentinel data pipeline.
--
-- Sentinel collects de-identified case reports from three kinds of source:
--   1. VitaLink hospitals that have approved data sharing with a Sentinel
--      organisation (automatic, from confirmed diagnoses, signed EMR notes and
--      positive lab tests), plus daily symptom counts for early warning.
--   2. Other healthcare systems through the partner API (sentinel-ingest edge
--      function; plain JSON or FHIR R4), each with its own API key.
--   3. Sentinel's own users (manual entry), so organisations can use it alone.
-- No names, phone numbers, addresses or record IDs are ever stored: patients
-- become a keyed hash that is different for every Sentinel organisation.

-- ---------------------------------------------------------------------------
-- Disease registry shared by Sentinel and VitaLink
create table public.sentinel_diseases (
  id text primary key,
  name text not null,
  category text not null check (category in ('infectious', 'ntd', 'ncd')),
  notifiable boolean not null default false,
  match_terms text[] not null default '{}',
  icd10_prefixes text[] not null default '{}',
  dx_condition_ids text[] not null default '{}',
  lab_terms text[] not null default '{}'
);
alter table public.sentinel_diseases enable row level security;
create policy "signed-in users read diseases" on public.sentinel_diseases for select to authenticated using (true);
grant select on public.sentinel_diseases to authenticated;

insert into public.sentinel_diseases (id, name, category, notifiable, match_terms, icd10_prefixes, dx_condition_ids, lab_terms) values
('covid-19', 'COVID-19', 'infectious', true, '{covid,covid-19,sars-cov,coronavirus}', '{U07}', '{}', '{covid,sars-cov}'),
('cholera', 'Cholera', 'infectious', true, '{cholera,vibrio cholerae}', '{A00}', '{cholera}', '{cholera}'),
('malaria', 'Malaria', 'infectious', false, '{malaria,plasmodium}', '{B50,B51,B52,B53,B54}', '{malaria,severe_malaria}', '{malaria,mp ,mrdt,plasmodium}'),
('tuberculosis', 'Tuberculosis', 'infectious', true, '{tuberculosis,pulmonary tb,ptb,koch}', '{A15,A16,A17,A18,A19}', '{tb}', '{genexpert,afb,tb lam,mtb}'),
('typhoid', 'Typhoid Fever', 'infectious', false, '{typhoid,salmonella typhi,enteric fever}', '{A01}', '{typhoid}', '{blood culture}'),
('lassa', 'Lassa Fever', 'infectious', true, '{lassa,arenavirus}', '{A96.2}', '{lassa}', '{lassa}'),
('yellow-fever', 'Yellow Fever', 'infectious', true, '{yellow fever}', '{A95}', '{}', '{yellow fever}'),
('measles', 'Measles', 'infectious', true, '{measles,rubeola}', '{B05}', '{measles}', '{measles}'),
('meningitis', 'Meningitis', 'infectious', true, '{meningitis,meningococcal,csm}', '{A39,G00,G01,G02,G03}', '{meningitis}', '{csf}'),
('mpox', 'Mpox', 'infectious', true, '{mpox,monkeypox}', '{B04}', '{}', '{mpox,monkeypox}'),
('ebola', 'Ebola', 'infectious', true, '{ebola,evd,filovirus}', '{A98.4}', '{}', '{ebola}'),
('hiv', 'HIV/AIDS', 'infectious', false, '{hiv,aids,retroviral}', '{B20,B21,B22,B23,B24,Z21}', '{hiv}', '{hiv}'),
('hepatitis', 'Hepatitis', 'infectious', false, '{hepatitis,hbv,hcv,hav}', '{B15,B16,B17,B18,B19}', '{hepatitis}', '{hbsag,anti-hcv,hepatitis}'),
('dengue', 'Dengue Fever', 'infectious', true, '{dengue}', '{A90,A91}', '{dengue}', '{dengue,ns1}'),
('influenza', 'Influenza', 'infectious', false, '{influenza,flu}', '{J09,J10,J11}', '{ili}', '{influenza}'),
('pneumonia', 'Pneumonia', 'infectious', false, '{pneumonia,bronchopneumonia,chest infection}', '{J12,J13,J14,J15,J16,J17,J18}', '{pneumonia}', '{}'),
('onchocerciasis', 'Onchocerciasis (River Blindness)', 'ntd', false, '{onchocerciasis,river blindness}', '{B73}', '{}', '{skin snip}'),
('lymphatic-filariasis', 'Lymphatic Filariasis', 'ntd', false, '{lymphatic filariasis,elephantiasis,wuchereria}', '{B74}', '{}', '{microfilaria}'),
('schistosomiasis', 'Schistosomiasis', 'ntd', false, '{schistosomiasis,bilharzia}', '{B65}', '{schistosomiasis}', '{schistosoma}'),
('sth', 'Soil-transmitted Helminths', 'ntd', false, '{soil-transmitted,ascaris,hookworm,trichuris,helminth}', '{B76,B77,B79}', '{}', '{ova}'),
('trachoma', 'Trachoma', 'ntd', false, '{trachoma}', '{A71}', '{}', '{}'),
('leprosy', 'Leprosy', 'ntd', true, '{leprosy,hansen}', '{A30}', '{}', '{slit skin}'),
('buruli-ulcer', 'Buruli Ulcer', 'ntd', false, '{buruli}', '{A31.1}', '{}', '{}'),
('hat', 'Human African Trypanosomiasis', 'ntd', true, '{sleeping sickness,trypanosomiasis}', '{B56}', '{}', '{trypanosom}'),
('guinea-worm', 'Dracunculiasis (Guinea Worm)', 'ntd', true, '{guinea worm,dracunculiasis}', '{B72}', '{}', '{}'),
('chagas', 'Chagas Disease', 'ntd', false, '{chagas}', '{B57}', '{}', '{}'),
('vl', 'Visceral Leishmaniasis', 'ntd', false, '{leishmaniasis,kala-azar}', '{B55}', '{}', '{leishmania}'),
('rabies', 'Rabies', 'ntd', true, '{rabies}', '{A82}', '{}', '{rabies}'),
('yaws', 'Yaws', 'ntd', false, '{yaws}', '{A66}', '{}', '{}'),
('hypertension', 'Hypertension', 'ncd', false, '{hypertension,high blood pressure,htn}', '{I10,I11,I12,I13,I15,I16}', '{hypertension,hypertensive_emergency}', '{}'),
('diabetes', 'Diabetes', 'ncd', false, '{diabetes,t2dm,t1dm,diabetes mellitus}', '{E10,E11,E13,E14}', '{diabetes,diabetic_emergency}', '{}'),
('stroke', 'Stroke', 'ncd', false, '{stroke,cerebrovascular,cva}', '{I60,I61,I62,I63,I64}', '{stroke}', '{}'),
('asthma', 'Asthma', 'ncd', false, '{asthma}', '{J45,J46}', '{asthma}', '{}'),
('cancer', 'Cancer', 'ncd', false, '{cancer,carcinoma,malignancy,lymphoma,leukaemia,leukemia}', '{C}', '{}', '{}'),
('maternal-mortality', 'Maternal mortality indicators', 'ncd', true, '{maternal mortality,maternal death,obstetric haemorrhage,obstetric hemorrhage,postpartum haemorrhage,postpartum hemorrhage}', '{O72,O95,O96,O97}', '{}', '{}'),
('child-mortality', 'Child mortality indicators', 'ncd', false, '{infant mortality,under-five,child mortality}', '{}', '{}', '{}');

-- ---------------------------------------------------------------------------
-- Cases: richer shape, de-duplication and provenance
create sequence public.sentinel_case_seq;
alter table public.sentinel_cases
  add column disease_id text references public.sentinel_diseases(id),
  add column symptoms text[] not null default '{}',
  add column patient_ref text,
  add column external_ref text,
  add column source_id uuid,
  add column source_label text;
alter table public.sentinel_cases alter column report_id set default
  'SNT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.sentinel_case_seq')::text, 6, '0');
alter table public.sentinel_cases drop constraint if exists sentinel_cases_source_type_check;
alter table public.sentinel_cases add constraint sentinel_cases_source_type_check
  check (source_type = any (array['manual', 'vitalink_emr_sync', 'community_report', 'lab_notification', 'partner_api']));
create unique index sentinel_cases_external_ref_key on public.sentinel_cases (sentinel_org_id, external_ref) where external_ref is not null;
create index sentinel_cases_episode_idx on public.sentinel_cases (sentinel_org_id, patient_ref, disease_id, report_date);
create index sentinel_cases_report_idx on public.sentinel_cases (sentinel_org_id, report_date desc);

-- Per-organisation secret for patient pseudonyms; never readable by users.
create table private.sentinel_salts (
  sentinel_org_id uuid primary key references public.sentinel_organizations(id) on delete cascade,
  salt bytea not null default extensions.gen_random_bytes(32)
);

create or replace function private.sentinel_patient_ref(p_sentinel_org uuid, p_key text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_salt bytea;
begin
  insert into private.sentinel_salts (sentinel_org_id) values (p_sentinel_org) on conflict do nothing;
  select salt into v_salt from private.sentinel_salts where sentinel_org_id = p_sentinel_org;
  return 'P-' || upper(left(encode(extensions.hmac(convert_to(p_key, 'UTF8'), v_salt, 'sha256'), 'hex'), 12));
end;
$$;

-- ---------------------------------------------------------------------------
-- Consent: a Sentinel organisation asks; the VitaLink hospital's admins decide.
alter table public.sentinel_linked_facilities
  add column consent_status text not null default 'pending' check (consent_status in ('pending', 'approved', 'declined', 'revoked')),
  add column requested_by uuid references auth.users(id) on delete set null,
  add column consented_by uuid references auth.users(id) on delete set null,
  add column consented_at timestamptz,
  add column cases_shared integer not null default 0;
create unique index sentinel_linked_facilities_pair_key on public.sentinel_linked_facilities (sentinel_org_id, vitalink_org_id) where vitalink_org_id is not null;

-- ---------------------------------------------------------------------------
-- Partner systems (API keys). Only a hash of each key is stored.
create table public.sentinel_data_sources (
  id uuid primary key default gen_random_uuid(),
  sentinel_org_id uuid not null references public.sentinel_organizations(id) on delete cascade,
  kind text not null default 'api' check (kind in ('api')),
  name text not null check (length(btrim(name)) between 2 and 80),
  key_prefix text not null,
  key_hash text not null unique,
  is_active boolean not null default true,
  records_received integer not null default 0,
  last_received_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
alter table public.sentinel_data_sources enable row level security;
create policy "sentinel members read sources" on public.sentinel_data_sources for select to authenticated
  using (private.is_sentinel_member(sentinel_org_id));
grant select (id, sentinel_org_id, kind, name, key_prefix, is_active, records_received, last_received_at, created_by, created_at, revoked_at)
  on public.sentinel_data_sources to authenticated;

-- Daily symptom counts per facility (syndromic surveillance).
create table public.sentinel_syndromic_counts (
  sentinel_org_id uuid not null references public.sentinel_organizations(id) on delete cascade,
  facility_id uuid not null references public.sentinel_linked_facilities(id) on delete cascade,
  day date not null,
  syndrome text not null,
  encounters integer not null default 0,
  primary key (sentinel_org_id, facility_id, day, syndrome)
);
alter table public.sentinel_syndromic_counts enable row level security;
create policy "sentinel members read symptom counts" on public.sentinel_syndromic_counts for select to authenticated
  using (private.is_sentinel_member(sentinel_org_id));
grant select on public.sentinel_syndromic_counts to authenticated;

-- ---------------------------------------------------------------------------
-- Matching helpers
create or replace function private.sentinel_match_disease(p_text text)
returns text language sql stable set search_path = '' as $$
  select d.id from public.sentinel_diseases d
  where exists (
    select 1 from unnest(d.match_terms) t
    where ' ' || regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', ' ', 'g') || ' '
          like '% ' || regexp_replace(lower(btrim(t)), '[^a-z0-9]+', ' ', 'g') || ' %')
  order by d.notifiable desc, (select max(length(t)) from unnest(d.match_terms) t) desc
  limit 1
$$;

-- Accepts a registry id, a name, an ICD-10 code or free text.
create or replace function private.sentinel_resolve_disease(p_value text)
returns text language sql stable set search_path = '' as $$
  select coalesce(
    (select id from public.sentinel_diseases where id = lower(btrim(p_value))),
    (select id from public.sentinel_diseases where lower(name) = lower(btrim(p_value))),
    (select d.id from public.sentinel_diseases d, unnest(d.icd10_prefixes) pfx
       where upper(btrim(p_value)) ~ '^[A-Z][0-9]' and upper(btrim(p_value)) like pfx || '%'
       order by length(pfx) desc limit 1),
    private.sentinel_match_disease(p_value))
$$;

create or replace function private.sentinel_age_group(p_dob date)
returns text language sql stable set search_path = '' as $$
  select case
    when p_dob is null then 'unknown'
    when extract(year from age(p_dob)) <= 5 then '0-5'
    when extract(year from age(p_dob)) <= 14 then '6-14'
    when extract(year from age(p_dob)) <= 29 then '15-29'
    when extract(year from age(p_dob)) <= 49 then '30-49'
    else '50+' end
$$;

create or replace function private.sentinel_age_group_years(p_age numeric)
returns text language sql immutable set search_path = '' as $$
  select case when p_age is null or p_age < 0 then 'unknown' when p_age <= 5 then '0-5' when p_age <= 14 then '6-14'
    when p_age <= 29 then '15-29' when p_age <= 49 then '30-49' else '50+' end
$$;

create or replace function private.sentinel_category(p_disease text)
returns text language sql stable set search_path = '' as $$
  select case (select category from public.sentinel_diseases where id = p_disease)
    when 'ntd' then 'ntd' when 'ncd' then 'chronic' else 'communicable' end
$$;

create or replace function private.sentinel_status_rank(p_status text)
returns integer language sql immutable set search_path = '' as $$
  select case p_status when 'suspected' then 1 when 'probable' then 2 when 'confirmed' then 3 when 'recovered' then 4 when 'deceased' then 5 else 0 end
$$;

-- ---------------------------------------------------------------------------
-- Core upsert used by every source. One case per patient + disease episode
-- (21 days); a later report upgrades status, adds symptoms and lab confirmation.
create or replace function private.sentinel_record_case(
  p_sentinel_org uuid, p_facility uuid, p_external_ref text, p_patient_ref text, p_disease text, p_status text,
  p_lab_confirmed boolean, p_source_type text, p_source_id uuid, p_source_label text,
  p_age_group text, p_sex text, p_state text, p_lga text, p_onset date, p_report_date date,
  p_hospitalized boolean, p_symptoms text[], p_notes text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_case public.sentinel_cases;
  v_status text := coalesce(nullif(p_status, ''), 'suspected');
begin
  if p_disease is null or not exists (select 1 from public.sentinel_diseases where id = p_disease) then
    return jsonb_build_object('result', 'rejected', 'reason', 'Unknown disease');
  end if;
  if v_status not in ('suspected', 'probable', 'confirmed', 'recovered', 'deceased') then v_status := 'suspected'; end if;
  if coalesce(p_lab_confirmed, false) and private.sentinel_status_rank(v_status) < 3 then v_status := 'confirmed'; end if;

  select * into v_case from public.sentinel_cases
  where sentinel_org_id = p_sentinel_org
    and ((p_external_ref is not null and external_ref = p_external_ref)
      or (p_patient_ref is not null and patient_ref = p_patient_ref and disease_id = p_disease
          and report_date >= coalesce(p_report_date, current_date) - 21))
  order by report_date desc limit 1 for update;

  if v_case.id is not null then
    update public.sentinel_cases set
      case_status = case when private.sentinel_status_rank(v_status) > private.sentinel_status_rank(case_status) then v_status else case_status end,
      lab_confirmed = lab_confirmed or coalesce(p_lab_confirmed, false),
      hospitalized = coalesce(hospitalized, false) or coalesce(p_hospitalized, false),
      symptoms = (select coalesce(array_agg(distinct s), '{}') from unnest(symptoms || coalesce(p_symptoms, '{}')) s),
      symptom_onset_date = least(symptom_onset_date, p_onset),
      notes = coalesce(nullif(notes, ''), p_notes),
      updated_at = now()
    where id = v_case.id returning * into v_case;
    return jsonb_build_object('result', 'updated', 'id', v_case.id, 'reportId', v_case.report_id, 'status', v_case.case_status);
  end if;

  insert into public.sentinel_cases (sentinel_org_id, disease_id, disease, disease_category, state, lga, facility_id, source_type,
    source_id, source_label, age_group, sex, case_status, lab_confirmed, symptom_onset_date, report_date, hospitalized,
    symptoms, patient_ref, external_ref, notes)
  values (p_sentinel_org, p_disease, (select name from public.sentinel_diseases where id = p_disease), private.sentinel_category(p_disease),
    coalesce(nullif(btrim(p_state), ''), 'Unknown'), nullif(btrim(p_lga), ''), p_facility, p_source_type,
    p_source_id, p_source_label, coalesce(nullif(p_age_group, ''), 'unknown'),
    case when lower(p_sex) in ('male', 'female') then lower(p_sex) else 'unknown' end,
    v_status, coalesce(p_lab_confirmed, false), p_onset, coalesce(p_report_date, current_date), coalesce(p_hospitalized, false),
    coalesce(p_symptoms, '{}'), p_patient_ref, p_external_ref, p_notes)
  returning * into v_case;
  return jsonb_build_object('result', 'accepted', 'id', v_case.id, 'reportId', v_case.report_id, 'status', v_case.case_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Feed from VitaLink: sends one patient event to every Sentinel organisation the
-- hospital has approved, de-identified per organisation.
create or replace function private.sentinel_feed_from_vitalink(
  p_org uuid, p_patient uuid, p_disease text, p_status text, p_lab boolean, p_source_type text, p_symptoms text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_link public.sentinel_linked_facilities;
  v_patient public.patients;
  v_result jsonb;
begin
  if p_disease is null then return; end if;
  select * into v_patient from public.patients where id = p_patient;
  if v_patient.id is null then return; end if;
  for v_link in
    select * from public.sentinel_linked_facilities
    where vitalink_org_id = p_org and consent_status = 'approved' and is_active
  loop
    v_result := private.sentinel_record_case(v_link.sentinel_org_id, v_link.id, null,
      private.sentinel_patient_ref(v_link.sentinel_org_id, 'vitalink:' || p_patient::text), p_disease, p_status, p_lab, p_source_type,
      null, v_link.facility_name, private.sentinel_age_group(v_patient.date_of_birth), v_patient.gender,
      coalesce(nullif(v_patient.state, ''), v_link.state), v_link.lga, null, (now() at time zone 'Africa/Lagos')::date, false, p_symptoms, null);
    if v_result ->> 'result' = 'accepted' then
      update public.sentinel_linked_facilities set cases_shared = cases_shared + 1, last_report_date = current_date where id = v_link.id;
    else
      update public.sentinel_linked_facilities set last_report_date = current_date where id = v_link.id;
    end if;
  end loop;
end;
$$;

create or replace function private.sentinel_symptom_labels(p_findings text[])
returns text[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(label order by sort), '{}') from public.dx_findings
  where id = any(coalesce(p_findings, '{}')) and category in ('symptom', 'sign')
$$;

-- Confirmed diagnoses from VitaMind Dx / EMR learning.
create or replace function private.sentinel_on_dx_case()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.sentinel_feed_from_vitalink(new.organization_id, new.patient_id,
    (select id from public.sentinel_diseases where new.condition_id = any(dx_condition_ids) limit 1),
    'probable', false, 'vitalink_emr_sync', private.sentinel_symptom_labels(new.present));
  return null;
end;
$$;
create trigger dx_cases_sentinel_feed after insert on public.dx_cases
  for each row when (new.patient_id is not null) execute function private.sentinel_on_dx_case();

-- Signed EMR notes: notifiable diagnoses become cases; every signed encounter
-- feeds the daily symptom counts.
create or replace function private.sentinel_on_note()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_text text := coalesce(new.chief_complaint, '') || ' ' || coalesce(new.content ->> 'symptomSummary', '') || ' ' || coalesce(new.content ->> 'hpi', '');
  v_findings text[];
  v_disease text;
  v_link public.sentinel_linked_facilities;
  v_syndrome text;
  v_day date := (now() at time zone 'Africa/Lagos')::date;
begin
  if new.status <> 'signed' or (tg_op = 'UPDATE' and old.status = 'signed') then return null; end if;
  select coalesce(array_agg(finding_id) filter (where present), '{}') into v_findings from private.dx_extract(v_text);

  v_disease := private.sentinel_match_disease(new.primary_diagnosis);
  if v_disease is not null then
    perform private.sentinel_feed_from_vitalink(new.organization_id, new.patient_id, v_disease,
      case when new.primary_diagnosis ~* '(suspect|query|\?|r/o|rule out)' then 'suspected' else 'probable' end,
      false, 'vitalink_emr_sync', private.sentinel_symptom_labels(v_findings));
  end if;

  for v_link in select * from public.sentinel_linked_facilities where vitalink_org_id = new.organization_id and consent_status = 'approved' and is_active loop
    for v_syndrome in
      select distinct s from (
        select case
          when f in ('fever', 'high_fever', 'v_fever') then 'fever'
          when f in ('diarrhoea', 'profuse_watery') then 'acute_diarrhoea'
          when f = 'bloody_stool' then 'bloody_diarrhoea'
          when f in ('cough', 'sob', 'chronic_cough', 'wheeze') then 'respiratory'
          when f in ('rash', 'vesicular_rash') then 'rash'
          when f = 'jaundice' then 'jaundice'
          when f in ('bleeding', 'haemoptysis') then 'haemorrhagic'
          when f in ('neck_stiffness', 'confusion', 'convulsions') then 'neurological'
          when f = 'vomiting' then 'vomiting'
        end as s from unnest(v_findings) f) x
      where s is not null
    loop
      insert into public.sentinel_syndromic_counts (sentinel_org_id, facility_id, day, syndrome, encounters)
      values (v_link.sentinel_org_id, v_link.id, v_day, v_syndrome, 1)
      on conflict (sentinel_org_id, facility_id, day, syndrome) do update set encounters = public.sentinel_syndromic_counts.encounters + 1;
    end loop;
  end loop;
  return null;
end;
$$;
create trigger clinical_notes_sentinel_feed after insert or update of status on public.clinical_notes
  for each row execute function private.sentinel_on_note();

-- Positive lab tests become lab-confirmed cases.
create or replace function private.sentinel_on_lab_result()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_result text := lower(coalesce(new.value, '') || ' ' || coalesce(new.interpretation, ''));
  v_disease text;
begin
  if new.status <> 'Completed' or (tg_op = 'UPDATE' and old.status = 'Completed' and old.value is not distinct from new.value) then return null; end if;
  if v_result !~ '(positive|detected|reactive|seen|\+)' or v_result ~ '(negative|not detected|non-reactive|nonreactive|not seen|no parasite)' then return null; end if;
  select d.id into v_disease from public.sentinel_diseases d
  where exists (select 1 from unnest(d.lab_terms) t where lower(new.test_name) like '%' || btrim(t) || '%')
  limit 1;
  if v_disease is null then return null; end if;
  perform private.sentinel_feed_from_vitalink(new.organization_id, new.patient_id, v_disease, 'confirmed', true, 'lab_notification', '{}');
  return null;
end;
$$;
create trigger lab_results_sentinel_feed after insert or update of status, value on public.lab_results
  for each row execute function private.sentinel_on_lab_result();

-- ---------------------------------------------------------------------------
-- Partner API ingest (called by the sentinel-ingest edge function with the
-- service role). p_cases is already normalised from JSON or FHIR.
create or replace function public.sentinel_ingest(p_key text, p_cases jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_source public.sentinel_data_sources;
  v_item jsonb;
  v_results jsonb := '[]';
  v_result jsonb;
  v_disease text;
  v_ext text;
  v_n integer := 0;
begin
  select * into v_source from public.sentinel_data_sources
  where key_hash = encode(extensions.digest(convert_to(coalesce(p_key, ''), 'UTF8'), 'sha256'), 'hex') and is_active;
  if v_source.id is null then raise exception 'Invalid or revoked API key' using errcode = '28000'; end if;
  if jsonb_typeof(p_cases) <> 'array' then raise exception 'cases must be an array' using errcode = '22023'; end if;
  if jsonb_array_length(p_cases) > 500 then raise exception 'Send at most 500 cases per request' using errcode = '22023'; end if;

  for v_item in select * from jsonb_array_elements(p_cases) loop
    v_ext := nullif(btrim(v_item ->> 'external_id'), '');
    v_disease := private.sentinel_resolve_disease(coalesce(v_item ->> 'disease', ''));
    if v_ext is null then
      v_result := jsonb_build_object('result', 'rejected', 'reason', 'external_id is required');
    elsif v_disease is null then
      v_result := jsonb_build_object('result', 'rejected', 'reason', format('Unknown disease "%s"', v_item ->> 'disease'));
    else
      v_result := private.sentinel_record_case(v_source.sentinel_org_id, null, 'api:' || v_source.id || ':' || v_ext,
        case when nullif(v_item ->> 'patient_id', '') is not null
          then private.sentinel_patient_ref(v_source.sentinel_org_id, 'api:' || v_source.id || ':' || (v_item ->> 'patient_id')) end,
        v_disease, lower(coalesce(v_item ->> 'status', 'suspected')),
        coalesce((v_item ->> 'lab_confirmed')::boolean, false), 'partner_api', v_source.id,
        coalesce(nullif(v_item ->> 'facility', ''), v_source.name),
        coalesce(nullif(v_item ->> 'age_group', ''), private.sentinel_age_group_years((v_item ->> 'age')::numeric)),
        v_item ->> 'sex', v_item ->> 'state', v_item ->> 'lga',
        nullif(v_item ->> 'onset_date', '')::date, coalesce(nullif(v_item ->> 'report_date', '')::date, current_date),
        coalesce((v_item ->> 'hospitalized')::boolean, false),
        coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(v_item -> 'symptoms') = 'array' then v_item -> 'symptoms' else '[]'::jsonb end)), '{}'),
        left(v_item ->> 'notes', 1000));
      v_n := v_n + 1;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object('external_id', v_ext) || v_result);
  end loop;

  update public.sentinel_data_sources set records_received = records_received + v_n, last_received_at = now() where id = v_source.id;
  return jsonb_build_object('source', v_source.name, 'received', jsonb_array_length(p_cases), 'results', v_results);
end;
$$;
revoke all on function public.sentinel_ingest(text, jsonb) from public, anon, authenticated;
grant execute on function public.sentinel_ingest(text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Sentinel organisation management (standalone use)
create or replace function private.is_sentinel_admin(p_sentinel_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sentinel_users where id = auth.uid() and sentinel_org_id = p_sentinel_org and is_active and role = 'admin')
$$;

-- Creates a Sentinel organisation with the caller as its first admin.
create or replace function public.sentinel_create_organization(p_name text, p_type text, p_state text, p_contact_email text, p_contact_phone text, p_focus_diseases text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_user auth.users;
begin
  select * into v_user from auth.users where id = auth.uid();
  if v_user.id is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if exists (select 1 from public.sentinel_users where id = v_user.id) then
    raise exception 'This account already belongs to a Sentinel organisation' using errcode = '23505';
  end if;
  if length(btrim(coalesce(p_name, ''))) < 3 then raise exception 'Enter the organisation name' using errcode = '22023'; end if;
  insert into public.sentinel_organizations (name, type, state, country, contact_email, contact_phone, focus_diseases)
  values (btrim(p_name), p_type, coalesce(nullif(btrim(p_state), ''), 'National'), 'Nigeria',
    coalesce(nullif(btrim(p_contact_email), ''), v_user.email), nullif(btrim(p_contact_phone), ''), coalesce(p_focus_diseases, '{}'))
  returning id into v_org;
  insert into public.sentinel_users (id, sentinel_org_id, full_name, email, role)
  values (v_user.id, v_org, coalesce(nullif(v_user.raw_user_meta_data ->> 'full_name', ''), v_user.email), v_user.email, 'admin');
  insert into private.sentinel_salts (sentinel_org_id) values (v_org);
  return v_org;
end;
$$;

-- The caller's Sentinel membership (null if none).
create or replace function public.sentinel_me()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('userId', u.id, 'fullName', u.full_name, 'email', u.email, 'role', u.role,
    'organization', jsonb_build_object('id', o.id, 'name', o.name, 'type', o.type, 'state', o.state, 'country', o.country,
      'contactEmail', o.contact_email, 'contactPhone', o.contact_phone, 'focusDiseases', o.focus_diseases, 'createdAt', o.created_at))
  from public.sentinel_users u join public.sentinel_organizations o on o.id = u.sentinel_org_id
  where u.id = auth.uid() and u.is_active and o.is_active
$$;

-- API keys for partner systems: the key is returned once and never again.
create or replace function public.sentinel_create_api_key(p_sentinel_org uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_key text := 'vlsk_' || encode(extensions.gen_random_bytes(24), 'hex'); v_id uuid;
begin
  if not private.is_sentinel_admin(p_sentinel_org) then raise exception 'Only Sentinel admins can create API keys' using errcode = '42501'; end if;
  insert into public.sentinel_data_sources (sentinel_org_id, name, key_prefix, key_hash, created_by)
  values (p_sentinel_org, btrim(p_name), left(v_key, 12), encode(extensions.digest(convert_to(v_key, 'UTF8'), 'sha256'), 'hex'), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'key', v_key);
end;
$$;

create or replace function public.sentinel_revoke_api_key(p_source_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select sentinel_org_id into v_org from public.sentinel_data_sources where id = p_source_id;
  if v_org is null or not private.is_sentinel_admin(v_org) then raise exception 'Not allowed' using errcode = '42501'; end if;
  update public.sentinel_data_sources set is_active = false, revoked_at = now() where id = p_source_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Linking VitaLink hospitals (consent-based)

-- Sentinel side: VitaLink healthcare facilities that can be asked to share.
create or replace function public.sentinel_vitalink_directory(p_sentinel_org uuid, p_query text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_sentinel_member(p_sentinel_org) then (
    select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'state', o.state, 'type', o.organization_type,
      'linkStatus', l.consent_status) order by o.name), '[]')
    from public.organizations o
    left join public.sentinel_linked_facilities l on l.vitalink_org_id = o.id and l.sentinel_org_id = p_sentinel_org
    where o.workspace_type = 'healthcare'
      and (nullif(btrim(p_query), '') is null or o.name ilike '%' || btrim(p_query) || '%' or o.state ilike '%' || btrim(p_query) || '%')
  ) end
$$;

create or replace function public.sentinel_request_link(p_sentinel_org uuid, p_vitalink_org uuid, p_lga text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_org public.organizations;
  v_link uuid;
  v_sentinel text;
begin
  if not private.is_sentinel_admin(p_sentinel_org) then raise exception 'Only Sentinel admins can request data sharing' using errcode = '42501'; end if;
  select * into v_org from public.organizations where id = p_vitalink_org and workspace_type = 'healthcare';
  if v_org.id is null then raise exception 'Facility not found on VitaLink' using errcode = 'P0002'; end if;
  select name into v_sentinel from public.sentinel_organizations where id = p_sentinel_org;
  insert into public.sentinel_linked_facilities (sentinel_org_id, facility_name, facility_type, state, lga, vitalink_org_id,
    data_sharing_consent, reporting_frequency, consent_status, requested_by)
  values (p_sentinel_org, v_org.name, 'Hospital', coalesce(v_org.state, 'Unknown'), nullif(btrim(p_lga), ''), v_org.id,
    false, 'on_event', 'pending', auth.uid())
  on conflict (sentinel_org_id, vitalink_org_id) where vitalink_org_id is not null
  do update set consent_status = case when public.sentinel_linked_facilities.consent_status = 'approved' then 'approved' else 'pending' end,
    requested_by = auth.uid(), updated_at = now()
  returning id into v_link;
  perform private.notify_roles(v_org.id, private.admin_roles(), 'network', 'Public health data-sharing request',
    v_sentinel || ' asks to receive de-identified disease reports from ' || v_org.name || '. Review it in Administration.', '/administration', 'high');
  return v_link;
end;
$$;

-- VitaLink side: what this hospital shares, and with whom.
create or replace function public.vitalink_sentinel_links(p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.has_role(p_org, private.admin_roles()) then (
    select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'sentinelOrg', s.name, 'sentinelType', s.type, 'sentinelState', s.state,
      'status', l.consent_status, 'requestedAt', l.linked_at, 'consentedAt', l.consented_at, 'casesShared', l.cases_shared,
      'lastReportDate', l.last_report_date) order by l.linked_at desc), '[]')
    from public.sentinel_linked_facilities l join public.sentinel_organizations s on s.id = l.sentinel_org_id
    where l.vitalink_org_id = p_org
  ) end
$$;

create or replace function public.vitalink_respond_sentinel_link(p_link_id uuid, p_decision text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_link public.sentinel_linked_facilities;
begin
  select * into v_link from public.sentinel_linked_facilities where id = p_link_id;
  if v_link.id is null or not private.has_role(v_link.vitalink_org_id, private.admin_roles()) then
    raise exception 'Only this hospital''s admins can decide on data sharing' using errcode = '42501';
  end if;
  if p_decision not in ('approved', 'declined', 'revoked') then raise exception 'Unknown decision' using errcode = '22023'; end if;
  update public.sentinel_linked_facilities set consent_status = p_decision, data_sharing_consent = (p_decision = 'approved'),
    is_active = (p_decision = 'approved'), consented_by = auth.uid(), consented_at = now(), updated_at = now()
  where id = p_link_id;
  insert into public.audit_logs (organization_id, actor_id, action, entity, entity_id, metadata)
  values (v_link.vitalink_org_id, auth.uid(), 'security.updated', 'security', p_link_id::text,
    jsonb_build_object('summary', format('Public health data sharing with %s %s',
      (select name from public.sentinel_organizations where id = v_link.sentinel_org_id), p_decision)));
end;
$$;

revoke all on function public.sentinel_create_organization(text, text, text, text, text, text[]) from public, anon;
revoke all on function public.sentinel_me() from public, anon;
revoke all on function public.sentinel_create_api_key(uuid, text) from public, anon;
revoke all on function public.sentinel_revoke_api_key(uuid) from public, anon;
revoke all on function public.sentinel_vitalink_directory(uuid, text) from public, anon;
revoke all on function public.sentinel_request_link(uuid, uuid, text) from public, anon;
revoke all on function public.vitalink_sentinel_links(uuid) from public, anon;
revoke all on function public.vitalink_respond_sentinel_link(uuid, text) from public, anon;
grant execute on function public.sentinel_create_organization(text, text, text, text, text, text[]) to authenticated;
grant execute on function public.sentinel_me() to authenticated;
grant execute on function public.sentinel_create_api_key(uuid, text) to authenticated;
grant execute on function public.sentinel_revoke_api_key(uuid) to authenticated;
grant execute on function public.sentinel_vitalink_directory(uuid, text) to authenticated;
grant execute on function public.sentinel_request_link(uuid, uuid, text) to authenticated;
grant execute on function public.vitalink_sentinel_links(uuid) to authenticated;
grant execute on function public.vitalink_respond_sentinel_link(uuid, text) to authenticated;
