-- Fills a demo workspace (for investors and sales demos) with an all-features plan and fictional
-- sample data. Not a migration: run it by hand, once per demo workspace, after the demo account
-- has signed up through the app. Replace both ids below first.
--
--   :org  = the demo workspace's organizations.id
--   :user = the demo account's auth.users.id (its owner, super-admin)
--
-- Everything clinical is inserted as the demo account (role "authenticated" with its id), so the
-- app's own triggers and row-level security apply exactly as they would for a real hospital:
-- VitaLink IDs, automatic billing, receipts and audit entries are all created by the database.
-- All names and phone numbers are invented.
do $$
declare
  v_org uuid := ':org';
  v_user uuid := ':user';
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_patients uuid[] := '{}';
  v_pid uuid;
  v_note uuid;
  v_appt uuid;
  v_inv uuid;
  i integer;
  first_names text[] := array['Chiamaka','Tunde','Aisha','Emeka','Funmilayo','Ibrahim','Ngozi','Segun','Halima','Chinedu','Bisola','Musa','Adaeze','Kunle','Zainab','Obinna','Yetunde','Sani'];
  last_names  text[] := array['Okafor','Adeyemi','Bello','Nwosu','Adebayo','Abubakar','Eze','Ogunleye','Yusuf','Okeke','Balogun','Garba','Uche','Afolabi','Lawal','Okonkwo','Oladipo','Danjuma'];
  genders     text[] := array['female','male','female','male','female','male','female','male','female','male','female','male','female','male','female','male','female','male'];
  genotypes   text[] := array['AA','AS','AA','SS','AA','AC','AS','AA','AA','AS','AA','AA','SS','AA','AS','AA','AA','AC'];
  bloods      text[] := array['O+','A+','B+','O+','AB+','O-','A+','B+','O+','A-','O+','B+','O+','A+','O+','B-','A+','O+'];
  conditions  text[] := array['', 'Hypertension', '', 'Sickle cell disease', 'Type 2 diabetes', '', 'Asthma', 'Hypertension', '', '', 'Pregnancy (28 weeks)', 'Type 2 diabetes', '', '', 'Hypertension', '', '', ''];
  complaints  text[] := array['Fever and chills for 3 days','Headache and dizziness','Cough for 2 weeks','Painful joints and chest pain','Frequent urination and thirst','Fever, vomiting','Shortness of breath at night','Routine BP review','Abdominal pain and loose stools','Fever with body aches','Antenatal visit','Blurred vision, high sugars','Rash and itching','Sore throat','Palpitations','Back pain','Fever and headache','Ear pain'];
  diagnoses   text[] := array['Malaria','Hypertension','Tuberculosis (suspected)','Sickle cell crisis','Type 2 diabetes mellitus','Typhoid fever','Asthma','Hypertension','Gastroenteritis','Malaria','Normal pregnancy','Type 2 diabetes mellitus','Contact dermatitis','Pharyngitis','Anxiety','Mechanical back pain','Malaria','Otitis media'];
begin
  if v_org::text like ':%' or v_user::text like ':%' then raise exception 'Set :org and :user first'; end if;
  if not exists (select 1 from public.memberships where organization_id = v_org and user_id = v_user and status = 'active') then
    raise exception 'That account is not an active member of that workspace';
  end if;

  -- ---------- plan: everything included (no payment) ----------
  insert into public.subscriptions (organization_id, plan_id, billing_cycle, status, current_period_end)
  values (v_org, 'enterprise', 'annual', 'comped', null)
  on conflict (organization_id) do update set plan_id = 'enterprise', billing_cycle = 'annual', status = 'comped', current_period_end = null,
    paystack_subscription_code = null, paystack_email_token = null;
  insert into public.subscription_addons (organization_id, addon_id, status, current_period_end)
  values (v_org, 'sentinel', 'comped', null)
  on conflict (organization_id, addon_id) do update set status = 'comped', current_period_end = null;

  -- On the network and offering telemedicine, so referrals and specialist calls can be shown.
  update public.organizations set joined_network = true where id = v_org;
  insert into public.network_profiles (organization_id, visible_in_directory, facility_type, city, state, description, specialties, services,
    emergency, laboratory, imaging, pharmacy, telemedicine, accepting_referrals, accepting_transfers, capacity)
  values (v_org, false, 'Hospital', 'Ikeja', 'Lagos', 'Demonstration workspace with fictional data.', array['Internal Medicine','Paediatrics','Obstetrics'],
    array['Outpatient','Emergency','Laboratory','Pharmacy','Maternity'], true, true, true, true, true, true, true, 'available')
  on conflict (organization_id) do nothing;

  -- Departments (skipped if setup already added them); added directly, as the app does through department_save.
  insert into public.departments (organization_id, name, code, description, is_active, created_by)
  select v_org, d.name, d.code, d.descr, true, v_user
  from (values ('General Outpatient','GOPD','Walk-in and booked consultations'), ('Emergency','EMR','24/7 emergency care'),
               ('Laboratory','LAB','Haematology, chemistry and microbiology'), ('Pharmacy','PHA','Dispensary'),
               ('Maternity','MAT','Antenatal and delivery'), ('Paediatrics','PAED','Children''s clinic')) d(name, code, descr)
  where not exists (select 1 from public.departments x where x.organization_id = v_org and lower(x.name) = lower(d.name));

  -- ---------- act as the demo account from here on ----------
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated', 'aal', 'aal2', 'session_id', gen_random_uuid())::text, true);

  -- Price list.
  insert into public.service_prices (organization_id, category, name, price_kobo, unit)
  select v_org, p.cat, p.name, p.kobo, p.unit
  from (values ('consultation','General consultation',1000000,'visit'), ('consultation','Specialist consultation',2000000,'visit'),
               ('consultation','Follow-up visit',500000,'visit'), ('lab','Malaria parasite (MP)',300000,'test'),
               ('lab','Full blood count (FBC)',800000,'test'), ('lab','Fasting blood sugar',250000,'test'),
               ('lab','HbA1c',1200000,'test'), ('lab','Widal test',350000,'test'), ('lab','Urinalysis',250000,'test'),
               ('imaging','Chest X-ray',1500000,'study'), ('room','Ward bed (per night)',2500000,'night')) p(cat, name, kobo, unit)
  where not exists (select 1 from public.service_prices s where s.organization_id = v_org and s.name = p.name);

  -- Pharmacy stock.
  insert into public.drug_inventory (organization_id, drug_name, generic_name, category, formulation, strength, unit_of_measure,
    quantity_in_stock, reorder_level, unit_cost_kobo, unit_price_kobo, expiry_date, batch_number, supplier)
  select v_org, d.name, d.generic, d.cat, d.form, d.strength, d.unit, d.qty, d.reorder, d.cost, d.price, v_today + d.days, d.batch, 'Demo Pharma Ltd'
  from (values
    ('Coartem','Artemether/Lumefantrine','Antimalarial','Tablet','80/480mg','pack',120,30,150000,250000,400,'CT-2201'),
    ('Paracetamol','Paracetamol','Analgesic','Tablet','500mg','tablet',2000,300,500,2000,600,'PC-1180'),
    ('Amlodipine','Amlodipine','Antihypertensive','Tablet','5mg','tablet',600,100,1500,4000,500,'AM-0912'),
    ('Metformin','Metformin','Antidiabetic','Tablet','500mg','tablet',800,150,1000,3000,450,'MF-3321'),
    ('Ciprofloxacin','Ciprofloxacin','Antibiotic','Tablet','500mg','tablet',25,60,3000,8000,300,'CP-7781'),
    ('Amoxicillin','Amoxicillin','Antibiotic','Capsule','500mg','capsule',400,100,2000,5000,40,'AX-5520'),
    ('Salbutamol inhaler','Salbutamol','Bronchodilator','Inhaler','100mcg','inhaler',30,10,180000,350000,500,'SB-2234'),
    ('ORS','Oral rehydration salts','Electrolyte','Powder','20.5g','sachet',300,50,8000,20000,700,'OR-1102'),
    ('Folic acid','Folic acid','Supplement','Tablet','5mg','tablet',1000,200,300,1000,500,'FA-6610'),
    ('Ferrous sulphate','Ferrous sulphate','Supplement','Tablet','200mg','tablet',900,200,400,1500,550,'FS-4410')
  ) d(name, generic, cat, form, strength, unit, qty, reorder, cost, price, days, batch)
  where not exists (select 1 from public.drug_inventory x where x.organization_id = v_org and x.drug_name = d.name);

  -- ---------- patients ----------
  for i in 1..18 loop
    insert into public.patients (organization_id, first_name, last_name, date_of_birth, gender, phone, address, state, country,
      blood_group, genotype, chronic_conditions, allergies, emergency_contact_name, emergency_relationship, emergency_phone, status, insurance_provider)
    values (v_org, first_names[i], last_names[i], (v_today - ((18 + (i * 37) % 52) * 365 + i * 11)), genders[i],
      '0800' || lpad((1000000 + i * 7919)::text, 7, '0'), (10 + i) || ' Demo Street, Ikeja', 'Lagos', 'Nigeria',
      bloods[i], genotypes[i], nullif(conditions[i], ''), case when i % 5 = 0 then 'Penicillin' end,
      'Next of kin ' || i, case when i % 2 = 0 then 'Spouse' else 'Sibling' end, '0900' || lpad((2000000 + i * 4231)::text, 7, '0'),
      'active', case when i % 3 = 0 then 'Demo HMO' end)
    returning id into v_pid;
    v_patients := v_patients || v_pid;
  end loop;

  -- ---------- visits ----------
  for i in 1..18 loop
    v_pid := v_patients[i];
    -- A past visit with a signed note, vitals and labs for most patients.
    if i <= 14 then
      insert into public.appointments (organization_id, patient_id, clinician_id, department, starts_at, duration_minutes, type, priority, status, visit_reason, insurance_type, completed_at)
      values (v_org, v_pid, v_user, 'General Outpatient', (v_today - (i % 9 + 1)) + time '09:00' + (i * interval '20 minutes'), 20,
        case when i = 11 then 'ANC' when i in (2, 8, 15) then 'Chronic Care' else 'Consultation' end, 'routine', 'completed', complaints[i],
        case when i % 3 = 0 then 'private' else 'self-pay' end, now() - (i % 9 + 1) * interval '1 day')
      returning id into v_appt;
      insert into public.vitals (organization_id, patient_id, appointment_id, recorded_by, recorded_at, temperature_c, heart_rate, systolic, diastolic, respiratory_rate, spo2, weight_kg, height_cm)
      values (v_org, v_pid, v_appt, v_user, now() - (i % 9 + 1) * interval '1 day',
        case when diagnoses[i] in ('Malaria','Typhoid fever','Pharyngitis','Otitis media') then 38.6 + (i % 4) * 0.2 else 36.8 end,
        78 + i % 15, case when diagnoses[i] = 'Hypertension' then 158 else 118 + i % 12 end, case when diagnoses[i] = 'Hypertension' then 98 else 76 + i % 8 end,
        16 + i % 5, case when diagnoses[i] = 'Asthma' then 93 else 98 end, 58 + i * 1.7, 155 + i % 25);
      insert into public.clinical_notes (organization_id, patient_id, appointment_id, author_id, status, chief_complaint, primary_diagnosis, risk_level, content)
      values (v_org, v_pid, v_appt, v_user, 'draft', complaints[i], diagnoses[i], case when diagnoses[i] in ('Sickle cell crisis','Tuberculosis (suspected)') then 'high' else 'moderate' end,
        jsonb_build_object('chiefComplaint', complaints[i], 'hpi', complaints[i] || '. Onset gradual. No recent travel.', 'primaryDiagnosis', diagnoses[i],
          'followUp', 'Review in 2 weeks or sooner if symptoms worsen.'))
      returning id into v_note;
      update public.clinical_notes set status = 'signed' where id = v_note;
      insert into public.lab_results (organization_id, patient_id, note_id, ordered_by, test_name, test_type, department, status, reference_range, value, unit, flag, interpretation, ordered_at, resulted_at)
      values (v_org, v_pid, v_note, v_user,
        case when diagnoses[i] = 'Malaria' then 'Malaria parasite (MP)' when diagnoses[i] like 'Type 2%' then 'HbA1c' when diagnoses[i] = 'Typhoid fever' then 'Widal test' else 'Full blood count (FBC)' end,
        'Blood', 'Laboratory', 'Completed',
        case when diagnoses[i] like 'Type 2%' then '4.0-5.6' when diagnoses[i] = 'Malaria' then 'Negative' else '11.5-16.5' end,
        case when diagnoses[i] = 'Malaria' then 'Positive (++)' when diagnoses[i] like 'Type 2%' then '8.4' when diagnoses[i] = 'Typhoid fever' then 'O 1:160' else '12.8' end,
        case when diagnoses[i] like 'Type 2%' then '%' when diagnoses[i] in ('Malaria','Typhoid fever') then '' else 'g/dL' end,
        case when diagnoses[i] in ('Malaria','Typhoid fever') or diagnoses[i] like 'Type 2%' then 'High' else 'Normal' end,
        case when diagnoses[i] = 'Malaria' then 'Plasmodium falciparum seen.' else '' end,
        now() - (i % 9 + 1) * interval '1 day', now() - (i % 9 + 1) * interval '1 day' + interval '2 hours');
      insert into public.prescriptions (organization_id, patient_id, note_id, prescribed_by, drug_name, dosage, frequency, duration, quantity, route, status)
      values (v_org, v_pid, v_note, v_user,
        case when diagnoses[i] = 'Malaria' then 'Coartem' when diagnoses[i] = 'Hypertension' then 'Amlodipine' when diagnoses[i] like 'Type 2%' then 'Metformin'
             when diagnoses[i] = 'Typhoid fever' then 'Ciprofloxacin' when diagnoses[i] = 'Asthma' then 'Salbutamol inhaler' when diagnoses[i] = 'Gastroenteritis' then 'ORS'
             when diagnoses[i] = 'Normal pregnancy' then 'Folic acid' else 'Paracetamol' end,
        case when diagnoses[i] = 'Malaria' then '4 tablets' when diagnoses[i] = 'Asthma' then '2 puffs' else '1 tablet' end,
        case when diagnoses[i] = 'Malaria' then 'twice daily' else 'daily' end, case when diagnoses[i] = 'Malaria' then '3 days' else '30 days' end,
        case when diagnoses[i] = 'Malaria' then 1 else 30 end, case when diagnoses[i] = 'Asthma' then 'inhaled' else 'oral' end, 'active');
    end if;
  end loop;

  -- Today's clinic: a queue in every state, so the dashboard and appointments look like a working day.
  for i in 1..10 loop
    insert into public.appointments (organization_id, patient_id, clinician_id, department, starts_at, duration_minutes, type, priority, status, check_in_status, visit_reason, insurance_type, checked_in_at, queue_number)
    values (v_org, v_patients[i + 4], v_user, case when i = 6 then 'Maternity' when i = 9 then 'Paediatrics' else 'General Outpatient' end,
      v_today + time '08:30' + (i * interval '30 minutes'), 20,
      case when i = 4 then 'Telemedicine' when i = 6 then 'ANC' when i = 3 then 'Follow-up' else 'Consultation' end,
      case when i = 2 then 'urgent' else 'routine' end,
      case when i <= 2 then 'completed' when i = 3 then 'in-consultation' when i in (4, 5) then 'checked-in' when i = 6 then 'waiting-lab' else 'confirmed' end,
      case when i <= 6 then 'arrived' else 'not-arrived' end, complaints[i + 4], case when i % 3 = 0 then 'private' else 'self-pay' end,
      case when i <= 6 then now() - (7 - i) * interval '25 minutes' end, i);
  end loop;

  -- A few pending lab orders for the lab queue.
  insert into public.lab_results (organization_id, patient_id, ordered_by, test_name, test_type, department, status, reference_range, ordered_at)
  select v_org, v_patients[k], v_user, t, 'Blood', 'Laboratory', 'Pending', r, now() - k * interval '15 minutes'
  from (values (5, 'Malaria parasite (MP)', 'Negative'), (9, 'Full blood count (FBC)', '11.5-16.5 g/dL'), (12, 'Fasting blood sugar', '3.9-5.5 mmol/L')) x(k, t, r);

  -- Payments on some running bills (receipts are issued automatically).
  for v_inv in select id from public.invoices where organization_id = v_org and total_amount_kobo > 0 order by created_at limit 6 loop
    insert into public.invoice_payments (invoice_id, amount_kobo, method, reference)
    select v_inv, least(total_amount_kobo - amount_paid_kobo, 1000000), case when random() < 0.5 then 'cash' else 'pos' end, 'DEMO'
    from public.invoices where id = v_inv and total_amount_kobo - amount_paid_kobo > 0;
  end loop;

end $$;
