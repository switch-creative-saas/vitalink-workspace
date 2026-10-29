// Structured, de-identified patient record for VitaMind: no name, phone, address or VitaLink ID
// leaves VitaLink. Read with the service-role client after the caller's access was checked.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const age = (dob: string | null) => (dob ? Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000)) : null);

export async function emrSnapshot(db: SupabaseClient, patientId: string) {
  const [{ data: p }, { data: vitals }, { data: notes }, { data: rx }, { data: labs }, { data: appts }] = await Promise.all([
    db.from('patients').select('date_of_birth, gender, genotype, blood_group, allergies, chronic_conditions, current_medications, family_medical_history, past_surgeries, pregnancy_status, state').eq('id', patientId).maybeSingle(),
    db.from('vitals').select('recorded_at, temperature_c, heart_rate, systolic, diastolic, respiratory_rate, spo2, weight_kg').eq('patient_id', patientId).order('recorded_at', { ascending: false }).limit(3),
    db.from('clinical_notes').select('created_at, chief_complaint, primary_diagnosis, status').eq('patient_id', patientId).order('created_at', { ascending: false }).limit(5),
    db.from('prescriptions').select('drug_name, dosage, frequency, status, created_at').eq('patient_id', patientId).in('status', ['active', 'dispensed']).order('created_at', { ascending: false }).limit(10),
    db.from('lab_results').select('test_name, value, unit, flag, reference_range, resulted_at').eq('patient_id', patientId).eq('status', 'Completed').order('resulted_at', { ascending: false }).limit(8),
    db.from('appointments').select('starts_at, department, type, status').eq('patient_id', patientId).order('starts_at', { ascending: false }).limit(5),
  ]);
  if (!p) return null;
  return {
    age: age(p.date_of_birth),
    sex: p.gender,
    allergies: p.allergies ? [p.allergies] : [],
    medications: [...(p.current_medications ? [p.current_medications] : []), ...(rx ?? []).map((r) => `${r.drug_name} ${r.dosage ?? ''} ${r.frequency ?? ''} (${r.status})`.replace(/\s+/g, ' ').trim())],
    vitals: vitals ?? [],
    history: {
      chronic_conditions: p.chronic_conditions, genotype: p.genotype, blood_group: p.blood_group, pregnancy_status: p.pregnancy_status,
      family_history: p.family_medical_history, past_surgeries: p.past_surgeries, state: p.state,
      recent_notes: (notes ?? []).map((n) => ({ date: n.created_at.slice(0, 10), complaint: n.chief_complaint, diagnosis: n.primary_diagnosis || null })),
      recent_labs: labs ?? [],
      recent_appointments: appts ?? [],
    },
  };
}
