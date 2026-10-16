import { requireSupabase } from './client';

// ---------- types shared with the EMR page ----------

export type RiskLevel = 'low' | 'moderate' | 'high' | 'critical';

/** The SOAP form exactly as the EMR editor holds it; stored as jsonb. */
export type SoapContent = Record<string, string>;

export interface ClinicalNote {
  id: string;
  status: 'draft' | 'signed';
  content: SoapContent;
  chiefComplaint: string;
  primaryDiagnosis: string;
  riskLevel: RiskLevel;
  version: number;
  authorId: string | null;
  authorName: string;
  signedAt: string | null;
  signedByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface VitalsReading {
  id: string;
  recordedAt: string;
  recordedByName: string;
  temperatureC: number | null;
  heartRate: number | null;
  systolic: number | null;
  diastolic: number | null;
  respiratoryRate: number | null;
  spo2: number | null;
  weightKg: number | null;
  heightCm: number | null;
  painScore: number | null;
  notes: string | null;
}

export type NewVitals = Partial<Omit<VitalsReading, 'id' | 'recordedAt' | 'recordedByName'>>;

export interface LabResult {
  id: string;
  date: string;
  testName: string;
  testType: string;
  department: string;
  status: 'Pending' | 'Completed';
  referenceRange: string;
  patientValue: string;
  flag: 'Normal' | 'High' | 'Low' | 'Critical';
  orderingDoctor: string;
  technician: string;
  interpretation: string;
  orderedAt: string;
  resultedAt: string | null;
  noteId: string | null;
}

export interface NewLabResult {
  testName: string;
  testType: string;
  department: string;
  referenceRange?: string;
  value?: string;
  flag?: LabResult['flag'];
  status: LabResult['status'];
  noteId?: string;
}

type Person = { full_name: string; email: string } | null;
const nameOf = (person: Person, fallback = '') => person?.full_name || person?.email || fallback;

function friendly(error: { code?: string; message: string }, action: string): Error {
  if (error.code === '42501' || error.code === 'PGRST116') return new Error(`Your role cannot ${action}, or the record is locked.`);
  if (error.code === '23514') return new Error('One of the values is outside the allowed clinical range.');
  return new Error(error.message);
}

// ---------- clinical notes ----------

const NOTE_SELECT = `*,
  author:profiles!clinical_notes_author_id_fkey(full_name, email),
  signer:profiles!clinical_notes_signed_by_fkey(full_name, email)`;

interface NoteRow {
  id: string;
  status: 'draft' | 'signed';
  content: SoapContent;
  chief_complaint: string;
  primary_diagnosis: string;
  risk_level: RiskLevel;
  version: number;
  author_id: string | null;
  signed_at: string | null;
  created_at: string;
  updated_at: string;
  author: Person;
  signer: Person;
}

const noteFromRow = (row: NoteRow): ClinicalNote => ({
  id: row.id,
  status: row.status,
  content: row.content ?? {},
  chiefComplaint: row.chief_complaint,
  primaryDiagnosis: row.primary_diagnosis,
  riskLevel: row.risk_level,
  version: row.version,
  authorId: row.author_id,
  authorName: nameOf(row.author, 'Unknown clinician'),
  signedAt: row.signed_at,
  signedByName: nameOf(row.signer),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function listNotes(organizationId: string, patientId: string): Promise<ClinicalNote[]> {
  const { data, error } = await requireSupabase()
    .from('clinical_notes')
    .select(NOTE_SELECT)
    .eq('organization_id', organizationId)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false });
  if (error) throw friendly(error, 'read clinical notes');
  return (data as unknown as NoteRow[]).map(noteFromRow);
}

/** Creates a draft (or updates the caller's existing draft); pass sign=true to sign and lock it. */
export async function saveNote(
  organizationId: string,
  patientId: string,
  content: SoapContent,
  options: { noteId?: string; sign?: boolean } = {},
): Promise<ClinicalNote> {
  const fields = {
    content,
    chief_complaint: content.chiefComplaint ?? '',
    primary_diagnosis: content.primaryDiagnosis ?? '',
    risk_level: (content.riskLevel as RiskLevel) || 'moderate',
    ...(options.sign ? { status: 'signed' as const } : {}),
  };
  const db = requireSupabase();
  const query = options.noteId
    ? db.from('clinical_notes').update(fields).eq('id', options.noteId)
    : db.from('clinical_notes').insert({ ...fields, organization_id: organizationId, patient_id: patientId });
  const { data, error } = await query.select(NOTE_SELECT).single();
  if (error) throw friendly(error, options.sign ? 'sign clinical notes' : 'save clinical notes');
  return noteFromRow(data as unknown as NoteRow);
}

// ---------- vitals ----------

interface VitalsRow {
  id: string;
  recorded_at: string;
  temperature_c: number | null;
  heart_rate: number | null;
  systolic: number | null;
  diastolic: number | null;
  respiratory_rate: number | null;
  spo2: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  pain_score: number | null;
  notes: string | null;
  recorder: Person;
}

const num = (value: number | string | null) => (value === null ? null : Number(value));

const vitalsFromRow = (row: VitalsRow): VitalsReading => ({
  id: row.id,
  recordedAt: row.recorded_at,
  recordedByName: nameOf(row.recorder, 'Unknown'),
  temperatureC: num(row.temperature_c),
  heartRate: row.heart_rate,
  systolic: row.systolic,
  diastolic: row.diastolic,
  respiratoryRate: row.respiratory_rate,
  spo2: row.spo2,
  weightKg: num(row.weight_kg),
  heightCm: num(row.height_cm),
  painScore: row.pain_score,
  notes: row.notes,
});

const VITALS_SELECT = '*, recorder:profiles!vitals_recorded_by_fkey(full_name, email)';

export async function listVitals(organizationId: string, patientId: string, limit = 20): Promise<VitalsReading[]> {
  const { data, error } = await requireSupabase()
    .from('vitals')
    .select(VITALS_SELECT)
    .eq('organization_id', organizationId)
    .eq('patient_id', patientId)
    .order('recorded_at', { ascending: false })
    .limit(limit);
  if (error) throw friendly(error, 'read vitals');
  return (data as unknown as VitalsRow[]).map(vitalsFromRow);
}

/** Most recent reading for each of the given patients. */
export async function listLatestVitalsByPatient(organizationId: string, patientIds: string[]): Promise<Map<string, VitalsReading>> {
  const latest = new Map<string, VitalsReading>();
  if (patientIds.length === 0) return latest;
  const { data, error } = await requireSupabase()
    .from('vitals')
    .select(VITALS_SELECT)
    .eq('organization_id', organizationId)
    .in('patient_id', patientIds)
    .order('recorded_at', { ascending: false })
    .limit(500);
  if (error) throw friendly(error, 'read vitals');
  for (const row of data as unknown as (VitalsRow & { patient_id: string })[]) {
    if (!latest.has(row.patient_id)) latest.set(row.patient_id, vitalsFromRow(row));
  }
  return latest;
}

export async function recordVitals(organizationId: string, patientId: string, vitals: NewVitals): Promise<VitalsReading> {
  const { data, error } = await requireSupabase()
    .from('vitals')
    .insert({
      organization_id: organizationId,
      patient_id: patientId,
      temperature_c: vitals.temperatureC ?? null,
      heart_rate: vitals.heartRate ?? null,
      systolic: vitals.systolic ?? null,
      diastolic: vitals.diastolic ?? null,
      respiratory_rate: vitals.respiratoryRate ?? null,
      spo2: vitals.spo2 ?? null,
      weight_kg: vitals.weightKg ?? null,
      height_cm: vitals.heightCm ?? null,
      pain_score: vitals.painScore ?? null,
      notes: vitals.notes?.trim() || null,
    })
    .select(VITALS_SELECT)
    .single();
  if (error) throw friendly(error, 'record vitals');
  return vitalsFromRow(data as unknown as VitalsRow);
}

/** "BP 120/80 | HR 72 bpm | Temp 36.8C | SpO2 98%" from whichever values were taken. */
export function formatVitals(reading: VitalsReading | null | undefined): string {
  if (!reading) return '';
  const parts = [
    reading.systolic && reading.diastolic ? `BP ${reading.systolic}/${reading.diastolic}` : '',
    reading.heartRate ? `HR ${reading.heartRate} bpm` : '',
    reading.temperatureC ? `Temp ${reading.temperatureC}C` : '',
    reading.spo2 ? `SpO2 ${reading.spo2}%` : '',
    reading.respiratoryRate ? `RR ${reading.respiratoryRate}/min` : '',
    reading.weightKg ? `Wt ${reading.weightKg} kg` : '',
  ].filter(Boolean);
  return parts.join(' | ');
}

// ---------- lab results ----------

interface LabRow {
  id: string;
  note_id: string | null;
  test_name: string;
  test_type: string;
  department: string;
  status: LabResult['status'];
  reference_range: string;
  value: string;
  flag: LabResult['flag'];
  interpretation: string | null;
  ordered_at: string;
  resulted_at: string | null;
  orderer: Person;
  technician: Person;
}

const LAB_SELECT = `*,
  orderer:profiles!lab_results_ordered_by_fkey(full_name, email),
  technician:profiles!lab_results_technician_id_fkey(full_name, email)`;

const labFromRow = (row: LabRow): LabResult => ({
  id: row.id,
  date: (row.resulted_at ?? row.ordered_at).slice(0, 10),
  testName: row.test_name,
  testType: row.test_type,
  department: row.department,
  status: row.status,
  referenceRange: row.reference_range || '—',
  patientValue: row.value || '--',
  flag: row.flag,
  orderingDoctor: nameOf(row.orderer, '—'),
  technician: nameOf(row.technician, '—'),
  interpretation: row.interpretation ?? '',
  orderedAt: row.ordered_at,
  resultedAt: row.resulted_at,
  noteId: row.note_id,
});

export async function listLabs(organizationId: string, patientId: string): Promise<LabResult[]> {
  const { data, error } = await requireSupabase()
    .from('lab_results')
    .select(LAB_SELECT)
    .eq('organization_id', organizationId)
    .eq('patient_id', patientId)
    .order('ordered_at', { ascending: false });
  if (error) throw friendly(error, 'read lab results');
  return (data as unknown as LabRow[]).map(labFromRow);
}

export async function addLabResults(organizationId: string, patientId: string, labs: NewLabResult[]): Promise<LabResult[]> {
  if (labs.length === 0) return [];
  const { data, error } = await requireSupabase()
    .from('lab_results')
    .insert(labs.map((lab) => ({
      organization_id: organizationId,
      patient_id: patientId,
      note_id: lab.noteId ?? null,
      test_name: lab.testName.trim(),
      test_type: lab.testType.trim() || 'General',
      department: lab.department.trim() || 'Laboratory',
      status: lab.status,
      reference_range: lab.referenceRange?.trim() ?? '',
      value: lab.value?.trim() ?? '',
      flag: lab.flag ?? 'Normal',
    })))
    .select(LAB_SELECT);
  if (error) throw friendly(error, 'add lab results');
  return (data as unknown as LabRow[]).map(labFromRow);
}

export async function completeLab(
  id: string,
  result: { value: string; flag: LabResult['flag']; referenceRange?: string; interpretation?: string },
): Promise<LabResult> {
  const { data, error } = await requireSupabase()
    .from('lab_results')
    .update({
      status: 'Completed',
      value: result.value.trim(),
      flag: result.flag,
      ...(result.referenceRange !== undefined ? { reference_range: result.referenceRange.trim() } : {}),
      interpretation: result.interpretation?.trim() || null,
    })
    .eq('id', id)
    .select(LAB_SELECT)
    .single();
  if (error) throw friendly(error, 'record lab results');
  return labFromRow(data as unknown as LabRow);
}

/** Splits the SOAP "Lab orders" box into individual tests (one per line or comma). */
export function parseLabOrders(text: string): string[] {
  return text.split(/[\n,;]/).map((item) => item.trim()).filter(Boolean);
}
