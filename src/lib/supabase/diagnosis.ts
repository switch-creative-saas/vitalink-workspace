// VitaMind Dx: VitaLink's own diagnosis engine. The model runs in the database
// (dx_analyze) from a knowledge base that learns from confirmed diagnoses;
// research comes from PubMed through the dx-literature edge function.
import { requireSupabase } from './client';

export interface DxFinding { id: string; label: string; category: 'symptom' | 'sign' | 'vital' | 'history'; redFlag: boolean; question: string | null }

export interface DxEvidence { finding: string; label: string; present: boolean; weight: number }

export interface DxCondition {
  id: string;
  icd10: string;
  name: string;
  category: string;
  description: string;
  urgency: 'routine' | 'urgent' | 'emergency';
  probability: number;
  tests: string[];
  advice: string;
  learnedCases: number;
  outbreakFactor?: number;
  why: DxEvidence[];
}

export interface DxResult {
  sessionId?: string;
  conditions: DxCondition[];
  questions: Array<{ finding: string; label: string; question: string; conditions: string[] }>;
  redFlags: Array<{ finding: string; label: string }>;
  risk: 'low' | 'moderate' | 'high';
  tests: string[];
  present: string[];
  absent: string[];
  autoFindings: Array<{ id: string; present: boolean; source: 'text' | 'vitals' | 'record' }>;
  age: number | null;
  sex: string | null;
  state?: string | null;
  outbreaks?: Array<{ conditionId: string; condition: string; factor: number; signals: Array<{ level: string; state: string | null; source: string; title: string; url: string | null }> }>;
  learnedCasesTotal: number;
  model: string;
}

export interface DxPatientMatch { id: string; switchId: string; name: string; age: number | null; sex: string }

export interface DxArticle { pmid: string; title: string; journal: string; year: string; authors: string; types: string[]; doi: string | null; url: string; source?: 'PubMed' | 'Europe PMC'; openAccess?: boolean; local?: boolean }

export interface DxModelStats {
  conditions: number; findings: number; links: number; casesAll: number; casesHere: number; sessionsHere: number;
  confirmedRate: number | null; top3Rate: number | null; papersCached: number;
}

export interface DxInsight { severity: 'high' | 'moderate' | 'info'; title: string; detail: string; kind: string }

export interface DxPatientInsights {
  patient: { id: string; switchId: string; name: string; age: number | null; sex: string; genotype: string | null; bloodGroup: string | null; allergies: string | null; chronicConditions: string | null; currentMedications: string | null };
  insights: DxInsight[];
  diagnoses: Array<{ at: string; diagnosis: string; complaint: string | null; source: string; status: string }>;
  labs: Array<{ test: string; value: string; unit: string | null; flag: string; reference: string | null; at: string }>;
  vitals: Array<{ at: string; systolic: number | null; diastolic: number | null; heartRate: number | null; temperature: number | null; spo2: number | null; weight: number | null }>;
  sessions: Array<{ id: string; at: string; risk: string; status: string; top: string | null; confirmed: string | null; note: string | null }>;
  reviews: Array<{ at: string; note: string; by: string | null }>;
}

export interface ImagingReport { id: string; documentId: string; modality: string; findings: string; impression: string; status: 'preliminary' | 'final'; reportedBy: string; createdAt: string }

const fail = (error: { message: string } | null) => { if (error) throw new Error(error.message); };

export async function listFindings(): Promise<DxFinding[]> {
  const { data, error } = await requireSupabase().from('dx_findings').select('id, label, category, red_flag, question').order('sort');
  fail(error);
  return (data ?? []).map((f) => ({ id: f.id, label: f.label, category: f.category, redFlag: f.red_flag, question: f.question }));
}

export async function listConditionNames(): Promise<Array<{ id: string; name: string; icd10: string }>> {
  const { data, error } = await requireSupabase().from('dx_conditions').select('id, name, icd10').order('name');
  fail(error);
  return data ?? [];
}

export async function searchPatients(organizationId: string, term: string): Promise<DxPatientMatch[]> {
  const needle = term.trim().replace(/[%,()]/g, ' ');
  if (needle.length < 2) return [];
  const { data, error } = await requireSupabase()
    .from('patients')
    .select('id, switch_id, first_name, last_name, date_of_birth, gender')
    .eq('organization_id', organizationId)
    .or(`switch_id.ilike.%${needle}%,first_name.ilike.%${needle}%,last_name.ilike.%${needle}%`)
    .limit(8);
  fail(error);
  return (data ?? []).map((p) => ({
    id: p.id, switchId: p.switch_id, name: `${p.first_name} ${p.last_name}`.trim(), sex: p.gender ?? '',
    age: p.date_of_birth ? Math.floor((Date.now() - new Date(p.date_of_birth).getTime()) / (365.25 * 24 * 3600 * 1000)) : null,
  }));
}

export async function analyze(input: {
  organizationId: string; patientId: string | null; age: number | null; sex: string | null;
  present: string[]; absent: string[]; text: string; save?: boolean;
}): Promise<DxResult> {
  const { data, error } = await requireSupabase().rpc('dx_analyze', {
    p_organization_id: input.organizationId, p_patient_id: input.patientId, p_age: input.age, p_sex: input.sex,
    p_present: input.present, p_absent: input.absent, p_text: input.text, p_save: input.save ?? true,
  });
  fail(error);
  return data as DxResult;
}

/** Confirms the final diagnosis (teaches the model), or closes with another diagnosis when conditionId is null. */
export async function confirmDiagnosis(sessionId: string, conditionId: string | null, note?: string): Promise<void> {
  const { error } = await requireSupabase().rpc('dx_confirm', { p_session_id: sessionId, p_condition_id: conditionId, p_note: note ?? null });
  fail(error);
}

export async function getLiterature(conditionId: string, refresh = false): Promise<{ articles: DxArticle[]; total: number; fetchedAt: string; stale?: boolean }> {
  const { data, error } = await requireSupabase().functions.invoke('dx-literature', { body: { conditionId, refresh } });
  if (error) {
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.error ?? 'Could not reach PubMed right now.');
  }
  return data;
}

export async function getModelStats(organizationId: string): Promise<DxModelStats | null> {
  const { data, error } = await requireSupabase().rpc('dx_model_stats', { p_organization_id: organizationId });
  fail(error);
  return data as DxModelStats | null;
}

export async function getPatientInsights(patientId: string): Promise<DxPatientInsights> {
  const { data, error } = await requireSupabase().rpc('dx_patient_insights', { p_patient_id: patientId });
  fail(error);
  return data as DxPatientInsights;
}

export async function markReviewed(patientId: string, note: string): Promise<void> {
  const { error } = await requireSupabase().rpc('dx_mark_reviewed', { p_patient_id: patientId, p_note: note });
  fail(error);
}

export async function listImagingReports(organizationId: string, patientId: string): Promise<ImagingReport[]> {
  const { data, error } = await requireSupabase()
    .from('dx_imaging_reports')
    .select('id, document_id, modality, findings, impression, status, created_at, reporter:profiles!dx_imaging_reports_reported_by_fkey(full_name, email)')
    .eq('organization_id', organizationId).eq('patient_id', patientId)
    .order('created_at', { ascending: false });
  if (error && /relationship|reporter/i.test(error.message)) {
    // No profile relationship: fall back to the reports without names.
    const plain = await requireSupabase().from('dx_imaging_reports').select('id, document_id, modality, findings, impression, status, created_at')
      .eq('organization_id', organizationId).eq('patient_id', patientId).order('created_at', { ascending: false });
    fail(plain.error);
    return (plain.data ?? []).map((r) => ({ id: r.id, documentId: r.document_id, modality: r.modality, findings: r.findings, impression: r.impression, status: r.status, reportedBy: '', createdAt: r.created_at }));
  }
  fail(error);
  return (data ?? []).map((r) => {
    const who = r.reporter as unknown as { full_name?: string; email?: string } | null;
    return { id: r.id, documentId: r.document_id, modality: r.modality, findings: r.findings, impression: r.impression, status: r.status, reportedBy: who?.full_name || who?.email || '', createdAt: r.created_at };
  });
}

export async function saveImagingReport(documentId: string, report: { modality: string; findings: string; impression: string; status: 'preliminary' | 'final' }): Promise<void> {
  const { error } = await requireSupabase().rpc('dx_save_imaging_report', {
    p_document_id: documentId, p_modality: report.modality, p_findings: report.findings, p_impression: report.impression, p_status: report.status,
  });
  fail(error);
}

// ---------------------------------------------------------------------------
// Outbreak signals (WHO feed, NCDC entries, Sentinel) that raise conditions in VitaMind Dx.

export interface OutbreakSignal {
  id: string; conditionId: string | null; condition: string; state: string | null; level: 'watch' | 'active' | 'high';
  source: 'who' | 'ncdc' | 'manual' | 'sentinel'; title: string; url: string | null; note: string; since: string; until: string | null;
}

export async function listActiveOutbreaks(organizationId: string): Promise<OutbreakSignal[]> {
  const { data, error } = await requireSupabase().rpc('dx_active_outbreaks', { p_organization_id: organizationId });
  fail(error);
  return (data ?? []) as OutbreakSignal[];
}

export async function saveOutbreakSignal(input: {
  id?: string | null; conditionId: string; state: string; level: OutbreakSignal['level']; source: 'ncdc' | 'manual';
  title: string; url: string; note: string; startsOn: string; endsOn: string;
}): Promise<void> {
  const { error } = await requireSupabase().rpc('dx_outbreak_save', {
    p_id: input.id ?? null, p_condition_id: input.conditionId, p_state: input.state, p_level: input.level, p_source: input.source,
    p_title: input.title, p_source_url: input.url, p_note: input.note, p_starts_on: input.startsOn || null, p_ends_on: input.endsOn || null,
  });
  fail(error);
}

export async function endOutbreakSignal(id: string): Promise<void> {
  const { error } = await requireSupabase().rpc('dx_outbreak_end', { p_id: id });
  fail(error);
}

// ---------------------------------------------------------------------------
// VitaMind AI (paid tier): retrieval + Claude, through the vitamind-diagnose edge function.

export interface VitaMindDifferential { condition: string; probability: 'high' | 'medium' | 'low'; supporting_evidence: string[]; against_evidence: string[] }

export interface VitaMindResult {
  result_id: string;
  session_id: string;
  differential: VitaMindDifferential[];
  confidence_score: number;
  red_flags: string[];
  recommended_actions: string[];
  citations: Array<{ title: string; source: string }>;
  requires_urgent_review: boolean;
  disclaimer: string;
  model_used: string;
  latency_ms: number;
}

export class VitaMindError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

async function vitamind<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke('vitamind-diagnose', { body });
  if (error) {
    const payload = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new VitaMindError(payload?.error ?? 'VitaMind AI is unavailable right now.', payload?.code);
  }
  return data as T;
}

export const vitamindStatus = (organizationId: string) =>
  vitamind<{ access: boolean; configured: boolean }>({ action: 'status', organizationId });

export const vitamindDiagnose = (organizationId: string, input: { patientId: string | null; chiefComplaint: string; age?: number | null; sex?: string | null }) =>
  vitamind<VitaMindResult>({ action: 'diagnose', organizationId, ...input });

export const vitamindFeedback = (organizationId: string, resultId: string, feedback: 'confirm' | 'override' | 'partial', actualDiagnosis?: string, notes?: string) =>
  vitamind<{ id: string }>({ action: 'feedback', organizationId, resultId, feedback, actualDiagnosis, notes });

/** Console: every recorded signal (active and past), newest first. */
export async function listOutbreakSignals(): Promise<Array<OutbreakSignal & { active: boolean }>> {
  const { data, error } = await requireSupabase()
    .from('dx_outbreak_signals')
    .select('id, condition_id, state, level, source, title, source_url, note, starts_on, ends_on, condition:dx_conditions(name)')
    .order('starts_on', { ascending: false })
    .limit(100);
  fail(error);
  const today = new Date().toISOString().slice(0, 10);
  return (data ?? []).map((r) => ({
    id: r.id, conditionId: r.condition_id, condition: (r.condition as unknown as { name: string } | null)?.name ?? r.condition_id,
    state: r.state, level: r.level, source: r.source, title: r.title, url: r.source_url, note: r.note, since: r.starts_on, until: r.ends_on,
    active: r.starts_on <= today && (!r.ends_on || r.ends_on >= today),
  }));
}
