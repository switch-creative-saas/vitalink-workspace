// Sentinel's data layer on Supabase. Every function runs as the signed-in
// Sentinel user; row-level security limits them to their own organisation.
//
// Where cases come from:
//   - VitaLink hospitals that approved data sharing (automatic, de-identified)
//   - partner systems through the sentinel-ingest API (API keys below)
//   - manual entry by this organisation's officers
import { requireSupabase } from './client';

const fail = (error: { message: string } | null) => { if (error) throw new Error(error.message); };

// ---------------------------------------------------------------------------
// Account

export interface SentinelMe {
  userId: string;
  fullName: string;
  email: string;
  role: 'admin' | 'officer' | 'viewer' | 'field_worker' | 'analyst';
  organization: {
    id: string; name: string; type: string; state: string; country: string;
    contactEmail: string | null; contactPhone: string | null; focusDiseases: string[]; createdAt: string;
  };
}

export async function signIn(email: string, password: string) {
  const { error } = await requireSupabase().auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(/invalid/i.test(error.message) ? 'Incorrect email or password.' : error.message);
}

/**
 * Google sign-in. Supabase sends the user back to this page; a Google account with no Sentinel
 * organisation yet continues registration from the organisation step.
 */
export async function signInWithGoogle() {
  const { error } = await requireSupabase().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  if (error) throw new Error(error.message);
}

export class AccountExistsError extends Error {}

/** Creates the sign-in account. Supabase emails a 6-digit code unless confirmation is off. */
export async function signUp(email: string, password: string, fullName: string) {
  const { data, error } = await requireSupabase().auth.signUp({
    email: email.trim(), password, options: { data: { full_name: fullName.trim() }, emailRedirectTo: window.location.origin },
  });
  if (error) {
    if (/already registered|already exists/i.test(error.message)) throw new AccountExistsError('An account with this email already exists.');
    if (/password/i.test(error.message)) throw new Error(error.message);
    throw new Error(error.message);
  }
  // Supabase hides existing accounts by returning a user with no identities.
  if (data.user && (data.user.identities?.length ?? 0) === 0) throw new AccountExistsError('An account with this email already exists.');
  return { needsConfirmation: !data.session };
}

export async function verifyEmailCode(email: string, code: string) {
  const { error } = await requireSupabase().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
  if (error) throw new Error(/expired|invalid/i.test(error.message) ? 'That code is wrong or has expired. Check the latest email or send a new code.' : error.message);
}

export async function resendEmailCode(email: string) {
  const { error } = await requireSupabase().auth.resend({ type: 'signup', email: email.trim() });
  fail(error);
}

export async function signOut() {
  await requireSupabase().auth.signOut({ scope: 'local' });
}

/** The signed-in user's Sentinel membership, or null if they don't have one yet. */
export async function getMe(): Promise<SentinelMe | null> {
  const { data, error } = await requireSupabase().rpc('sentinel_me');
  fail(error);
  return (data as SentinelMe | null) ?? null;
}

export type SentinelOrgType = 'NGO' | 'Government' | 'Ministry' | 'International' | 'Research' | 'Academic' | 'Hospital';

export async function createOrganization(input: {
  name: string; type: SentinelOrgType; state: string; contactEmail?: string; contactPhone?: string; focusDiseases: string[];
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc('sentinel_create_organization', {
    p_name: input.name, p_type: input.type, p_state: input.state, p_contact_email: input.contactEmail ?? null,
    p_contact_phone: input.contactPhone ?? null, p_focus_diseases: input.focusDiseases,
  });
  fail(error);
  return data as string;
}

// ---------------------------------------------------------------------------
// Disease registry (shared with VitaLink's diagnosis engine)

export interface RegistryDisease {
  id: string; name: string; category: 'infectious' | 'ntd' | 'ncd'; notifiable: boolean; matchTerms: string[]; icd10: string[];
}

export async function listDiseases(): Promise<RegistryDisease[]> {
  const { data, error } = await requireSupabase().from('sentinel_diseases')
    .select('id, name, category, notifiable, match_terms, icd10_prefixes').order('name');
  fail(error);
  return (data ?? []).map((d) => ({ id: d.id, name: d.name, category: d.category, notifiable: d.notifiable, matchTerms: d.match_terms, icd10: d.icd10_prefixes }));
}

// ---------------------------------------------------------------------------
// Data sources: VitaLink hospitals (consent-based) and partner API keys

export interface VitalinkFacility { id: string; name: string; state: string | null; type: string; linkStatus: 'pending' | 'approved' | 'declined' | 'revoked' | null }

export async function searchVitalinkFacilities(orgId: string, query: string): Promise<VitalinkFacility[]> {
  const { data, error } = await requireSupabase().rpc('sentinel_vitalink_directory', { p_sentinel_org: orgId, p_query: query || null });
  fail(error);
  return (data ?? []) as VitalinkFacility[];
}

/** Asks a VitaLink hospital to share de-identified reports; its admins approve or decline. */
export async function requestFacilityLink(orgId: string, vitalinkOrgId: string, lga?: string): Promise<string> {
  const { data, error } = await requireSupabase().rpc('sentinel_request_link', { p_sentinel_org: orgId, p_vitalink_org: vitalinkOrgId, p_lga: lga ?? null });
  fail(error);
  return data as string;
}

export interface ApiSource {
  id: string; name: string; keyPrefix: string; isActive: boolean; recordsReceived: number; lastReceivedAt: string | null; createdAt: string; revokedAt: string | null;
}

export async function listApiSources(orgId: string): Promise<ApiSource[]> {
  const { data, error } = await requireSupabase().from('sentinel_data_sources')
    .select('id, name, key_prefix, is_active, records_received, last_received_at, created_at, revoked_at')
    .eq('sentinel_org_id', orgId).order('created_at', { ascending: false });
  fail(error);
  return (data ?? []).map((s) => ({
    id: s.id, name: s.name, keyPrefix: s.key_prefix, isActive: s.is_active, recordsReceived: s.records_received,
    lastReceivedAt: s.last_received_at, createdAt: s.created_at, revokedAt: s.revoked_at,
  }));
}

/** Returns the full key once; only its hash is stored. */
export async function createApiKey(orgId: string, name: string): Promise<{ id: string; key: string }> {
  const { data, error } = await requireSupabase().rpc('sentinel_create_api_key', { p_sentinel_org: orgId, p_name: name });
  fail(error);
  return data as { id: string; key: string };
}

export async function revokeApiKey(sourceId: string): Promise<void> {
  const { error } = await requireSupabase().rpc('sentinel_revoke_api_key', { p_source_id: sourceId });
  fail(error);
}

/** Where partner systems send cases (see supabase/functions/sentinel-ingest). */
export const INGEST_URL = `${(import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''}/functions/v1/sentinel-ingest`;

// ---------------------------------------------------------------------------
// Dashboard

type Severity = 'critical' | 'high' | 'moderate' | 'low';

export interface DashboardData {
  days: number;
  stats: {
    activeOutbreaks: number; monitoringOutbreaks: number; newOutbreaks: number; cases: number; previousCases: number; confirmedCases: number;
    openAlerts: number; urgentAlerts: number; facilities: number; facilitiesReporting: number; pendingFacilities: number;
  };
  reporting: { active: number; delayed: number; notReporting: number };
  trendDiseases: string[];
  /** One row per day (7/30 days) or week (90+ days): { date, [disease]: count } */
  trend: Array<{ date: string } & Record<string, number | string>>;
  outbreaks: Array<{ id: string; disease: string; state: string; lga: string | null; severity: Severity; status: string; casesConfirmed: number; casesSuspected: number; deaths: number; cfr: number; startDate: string }>;
  alerts: Array<{ id: string; severity: Severity; title: string; message: string; createdAt: string }>;
  states: Array<{ state: string; cases: number; outbreaks: number; alerts: number; risk: Severity }>;
  topDiseases: Array<{ disease: string; cases: number; previous: number; spark: number[] }>;
}

export async function getDashboard(orgId: string, days: number): Promise<DashboardData> {
  const { data, error } = await requireSupabase().rpc('sentinel_dashboard', { p_sentinel_org: orgId, p_days: days });
  fail(error);
  return data as DashboardData;
}

// ---------------------------------------------------------------------------
// Case registry

export type CaseStatus = 'suspected' | 'probable' | 'confirmed' | 'recovered' | 'deceased';
export type CaseSource = 'manual' | 'vitalink_emr_sync' | 'community_report' | 'lab_notification' | 'partner_api';

export interface SentinelCase {
  id: string;
  reportId: string;
  disease: string;
  diseaseId: string | null;
  category: string | null;
  state: string;
  lga: string | null;
  facilityId: string | null;
  facility: string | null;
  source: CaseSource;
  sourceLabel: string | null;
  ageGroup: string;
  sex: 'male' | 'female' | 'unknown';
  status: CaseStatus;
  labConfirmed: boolean;
  onsetDate: string | null;
  reportDate: string;
  hospitalized: boolean;
  travelHistory: boolean;
  contactTracing: boolean;
  symptoms: string[];
  patientRef: string | null;
  outbreakId: string | null;
  outbreak: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaseFilters {
  search?: string;
  diseaseId?: string;
  status?: CaseStatus;
  source?: CaseSource;
  /** Only cases linked to this outbreak. */
  outbreakId?: string;
  /** Only cases reported in the last n days. */
  days?: number;
}

const CASE_SELECT = `id, report_id, disease, disease_id, disease_category, state, lga, facility_id, source_type, source_label, age_group, sex,
  case_status, lab_confirmed, symptom_onset_date, report_date, hospitalized, travel_history, contact_tracing_initiated, symptoms,
  patient_ref, linked_outbreak_id, notes, created_at, updated_at,
  facility:sentinel_linked_facilities(facility_name), outbreak:sentinel_outbreaks(disease, state)`;

type CaseRow = {
  id: string; report_id: string; disease: string; disease_id: string | null; disease_category: string | null; state: string; lga: string | null;
  facility_id: string | null; source_type: CaseSource; source_label: string | null; age_group: string; sex: SentinelCase['sex'];
  case_status: CaseStatus; lab_confirmed: boolean; symptom_onset_date: string | null; report_date: string; hospitalized: boolean | null;
  travel_history: boolean | null; contact_tracing_initiated: boolean | null; symptoms: string[] | null; patient_ref: string | null;
  linked_outbreak_id: string | null; notes: string | null; created_at: string; updated_at: string;
  facility: { facility_name: string } | null; outbreak: { disease: string; state: string } | null;
};

const caseFromRow = (r: CaseRow): SentinelCase => ({
  id: r.id, reportId: r.report_id, disease: r.disease, diseaseId: r.disease_id, category: r.disease_category, state: r.state, lga: r.lga,
  facilityId: r.facility_id, facility: r.facility?.facility_name ?? null, source: r.source_type, sourceLabel: r.source_label,
  ageGroup: r.age_group, sex: r.sex, status: r.case_status, labConfirmed: r.lab_confirmed, onsetDate: r.symptom_onset_date,
  reportDate: r.report_date, hospitalized: Boolean(r.hospitalized), travelHistory: Boolean(r.travel_history),
  contactTracing: Boolean(r.contact_tracing_initiated), symptoms: r.symptoms ?? [], patientRef: r.patient_ref,
  outbreakId: r.linked_outbreak_id, outbreak: r.outbreak ? `${r.outbreak.disease} · ${r.outbreak.state}` : null, notes: r.notes,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

/** PostgREST `or` values must not contain its separators. */
const orSafe = (value: string) => value.replace(/[,()*%]/g, ' ').trim();

export async function listCases(orgId: string, filters: CaseFilters, page = 0, pageSize = 50): Promise<{ cases: SentinelCase[]; total: number }> {
  let query = requireSupabase().from('sentinel_cases').select(CASE_SELECT, { count: 'exact' })
    .eq('sentinel_org_id', orgId)
    .order('report_date', { ascending: false }).order('created_at', { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);
  const needle = orSafe(filters.search ?? '');
  if (needle) query = query.or(['report_id', 'disease', 'state', 'lga', 'source_label', 'patient_ref'].map((c) => `${c}.ilike.*${needle}*`).join(','));
  if (filters.diseaseId) query = query.eq('disease_id', filters.diseaseId);
  if (filters.status) query = query.eq('case_status', filters.status);
  if (filters.source) query = query.eq('source_type', filters.source);
  if (filters.outbreakId) query = query.eq('linked_outbreak_id', filters.outbreakId);
  if (filters.days) query = query.gte('report_date', new Date(Date.now() - (filters.days - 1) * 86_400_000).toISOString().slice(0, 10));
  const { data, error, count } = await query;
  fail(error);
  return { cases: ((data ?? []) as unknown as CaseRow[]).map(caseFromRow), total: count ?? 0 };
}

/** Every case matching the filters, for CSV export (up to 10,000). */
export async function exportCases(orgId: string, filters: CaseFilters): Promise<SentinelCase[]> {
  const all: SentinelCase[] = [];
  for (let page = 0; page < 10; page += 1) {
    const { cases, total } = await listCases(orgId, filters, page, 1000);
    all.push(...cases);
    if (all.length >= total || cases.length < 1000) break;
  }
  return all;
}

export interface CaseEvent {
  id: string;
  kind: 'reported' | 'status' | 'lab' | 'outbreak' | 'note' | 'contact_tracing' | 'hospitalized';
  detail: Record<string, unknown>;
  actor: string | null;
  at: string;
}

export async function listCaseEvents(caseId: string): Promise<CaseEvent[]> {
  const { data, error } = await requireSupabase().from('sentinel_case_events')
    .select('id, kind, detail, actor_name, created_at').eq('case_id', caseId).order('created_at');
  fail(error);
  return (data ?? []).map((e) => ({ id: e.id, kind: e.kind, detail: e.detail ?? {}, actor: e.actor_name, at: e.created_at }));
}

export interface NewCaseReport {
  disease: string;
  status: CaseStatus;
  labConfirmed: boolean;
  ageGroup: string;
  sex: SentinelCase['sex'];
  state: string;
  lga?: string;
  facilityId?: string;
  onsetDate?: string;
  reportDate?: string;
  hospitalized: boolean;
  symptoms: string[];
  notes?: string;
  /** The reporter's own case number; stored only as a pseudonym, and lets a repeat report update the same case. */
  localRef?: string;
  outbreakId?: string;
  travelHistory: boolean;
  contactTracing: boolean;
}

export async function reportCase(orgId: string, input: NewCaseReport): Promise<{ result: 'accepted' | 'updated'; id: string; reportId: string; status: CaseStatus }> {
  const { data, error } = await requireSupabase().rpc('sentinel_report_case', {
    p_sentinel_org: orgId,
    p_case: {
      disease: input.disease, status: input.status, lab_confirmed: input.labConfirmed, age_group: input.ageGroup, sex: input.sex,
      state: input.state, lga: input.lga || null, facility_id: input.facilityId || null, onset_date: input.onsetDate || null,
      report_date: input.reportDate || null, hospitalized: input.hospitalized, symptoms: input.symptoms, notes: input.notes || null,
      local_ref: input.localRef || null, outbreak_id: input.outbreakId || null, travel_history: input.travelHistory,
      contact_tracing_initiated: input.contactTracing,
    },
  });
  fail(error);
  return data as { result: 'accepted' | 'updated'; id: string; reportId: string; status: CaseStatus };
}

export async function updateCase(caseId: string, changes: {
  status?: CaseStatus; labConfirmed?: boolean; outbreakId?: string | null; contactTracing?: boolean; hospitalized?: boolean;
}) {
  const payload: Record<string, unknown> = {};
  if (changes.status) payload.status = changes.status;
  if (changes.labConfirmed !== undefined) payload.lab_confirmed = changes.labConfirmed;
  if (changes.outbreakId !== undefined) payload.outbreak_id = changes.outbreakId;
  if (changes.contactTracing !== undefined) payload.contact_tracing_initiated = changes.contactTracing;
  if (changes.hospitalized !== undefined) payload.hospitalized = changes.hospitalized;
  const { error } = await requireSupabase().rpc('sentinel_update_case', { p_case: caseId, p_changes: payload });
  fail(error);
}

export async function addCaseNote(caseId: string, note: string) {
  const { error } = await requireSupabase().rpc('sentinel_add_case_note', { p_case: caseId, p_note: note });
  fail(error);
}

export interface LinkedFacility { id: string; name: string; state: string | null; lga: string | null }

/** Facilities sharing data with this organisation (for attributing a manual report). */
export async function listLinkedFacilities(orgId: string): Promise<LinkedFacility[]> {
  const { data, error } = await requireSupabase().from('sentinel_linked_facilities')
    .select('id, facility_name, state, lga').eq('sentinel_org_id', orgId).eq('consent_status', 'approved').eq('is_active', true).order('facility_name');
  fail(error);
  return (data ?? []).map((f) => ({ id: f.id, name: f.facility_name, state: f.state, lga: f.lga }));
}

export interface OutbreakOption { id: string; label: string }

export async function listOpenOutbreaks(orgId: string): Promise<OutbreakOption[]> {
  const { data, error } = await requireSupabase().from('sentinel_outbreaks')
    .select('id, disease, state, lga, start_date').eq('sentinel_org_id', orgId).in('status', ['active', 'monitoring']).order('start_date', { ascending: false });
  fail(error);
  return (data ?? []).map((o) => ({ id: o.id, label: `${o.disease} · ${o.state}${o.lga ? ` / ${o.lga}` : ''}` }));
}

/** Sentinel roles that can report and update cases (viewers and analysts only read). */
export const canEditCases = (role: SentinelMe['role'] | undefined) => role === 'admin' || role === 'officer' || role === 'field_worker';

// ---------------------------------------------------------------------------
// Outbreaks

export type OutbreakSeverity = 'low' | 'moderate' | 'high' | 'critical';
export type OutbreakStatus = 'active' | 'monitoring' | 'resolved' | 'false_alarm';

export interface SentinelOutbreak {
  id: string;
  disease: string;
  diseaseId: string | null;
  state: string;
  lga: string | null;
  severity: OutbreakSeverity;
  status: OutbreakStatus;
  confirmed: number;
  suspected: number;
  deaths: number;
  cfr: number | null;
  startDate: string | null;
  endDate: string | null;
  responseTeamDeployed: boolean;
  description: string | null;
  baselineConfirmed: number;
  baselineSuspected: number;
  baselineDeaths: number;
  linkedCases: number;
  updatedAt: string;
}

export interface OutbreakFilters {
  view: 'open' | 'closed' | 'all';
  state?: string;
  diseaseId?: string;
  severity?: OutbreakSeverity;
}

type OutbreakRow = {
  id: string; disease: string; disease_id: string | null; state: string; lga: string | null; severity: OutbreakSeverity; status: OutbreakStatus;
  cases_confirmed: number; cases_suspected: number; deaths: number; cfr: number | null; start_date: string | null; end_date: string | null;
  response_team_deployed: boolean; description: string | null; baseline_confirmed: number; baseline_suspected: number; baseline_deaths: number;
  updated_at: string; linked: Array<{ count: number }> | null;
};

const outbreakFromRow = (r: OutbreakRow): SentinelOutbreak => ({
  id: r.id, disease: r.disease, diseaseId: r.disease_id, state: r.state, lga: r.lga, severity: r.severity, status: r.status,
  confirmed: r.cases_confirmed, suspected: r.cases_suspected, deaths: r.deaths, cfr: r.cfr === null ? null : Number(r.cfr),
  startDate: r.start_date, endDate: r.end_date, responseTeamDeployed: r.response_team_deployed, description: r.description,
  baselineConfirmed: r.baseline_confirmed, baselineSuspected: r.baseline_suspected, baselineDeaths: r.baseline_deaths,
  linkedCases: r.linked?.[0]?.count ?? 0, updatedAt: r.updated_at,
});

const SEVERITY_ORDER: Record<OutbreakSeverity, number> = { critical: 0, high: 1, moderate: 2, low: 3 };

export async function listOutbreaks(orgId: string, filters: OutbreakFilters): Promise<SentinelOutbreak[]> {
  let query = requireSupabase().from('sentinel_outbreaks')
    .select(`id, disease, disease_id, state, lga, severity, status, cases_confirmed, cases_suspected, deaths, cfr, start_date, end_date,
      response_team_deployed, description, baseline_confirmed, baseline_suspected, baseline_deaths, updated_at, linked:sentinel_cases(count)`)
    .eq('sentinel_org_id', orgId).order('start_date', { ascending: false }).limit(500);
  if (filters.view === 'open') query = query.in('status', ['active', 'monitoring']);
  if (filters.view === 'closed') query = query.in('status', ['resolved', 'false_alarm']);
  if (filters.state) query = query.eq('state', filters.state);
  if (filters.diseaseId) query = query.eq('disease_id', filters.diseaseId);
  if (filters.severity) query = query.eq('severity', filters.severity);
  const { data, error } = await query;
  fail(error);
  return ((data ?? []) as unknown as OutbreakRow[]).map(outbreakFromRow)
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export interface OutbreakEvent {
  id: string;
  kind: 'declared' | 'severity' | 'status' | 'response' | 'update' | 'cases_linked' | 'figures';
  detail: Record<string, unknown>;
  actor: string | null;
  at: string;
}

export async function listOutbreakEvents(outbreakId: string): Promise<OutbreakEvent[]> {
  const { data, error } = await requireSupabase().from('sentinel_outbreak_events')
    .select('id, kind, detail, actor_name, created_at').eq('outbreak_id', outbreakId).order('created_at', { ascending: false });
  fail(error);
  return (data ?? []).map((e) => ({ id: e.id, kind: e.kind, detail: e.detail ?? {}, actor: e.actor_name, at: e.created_at }));
}

export interface DeclareOutbreak {
  disease: string;
  state: string;
  lga?: string;
  severity: OutbreakSeverity;
  startDate?: string;
  description?: string;
  responseTeamDeployed: boolean;
  baselineConfirmed: number;
  baselineSuspected: number;
  baselineDeaths: number;
  /** Link this organisation's matching unlinked cases (same disease and place, from 21 days before the start). */
  linkMatching: boolean;
}

export async function declareOutbreak(orgId: string, input: DeclareOutbreak): Promise<{ id: string; linked: number }> {
  const { data, error } = await requireSupabase().rpc('sentinel_declare_outbreak', {
    p_sentinel_org: orgId,
    p_outbreak: {
      disease: input.disease, state: input.state, lga: input.lga || null, severity: input.severity, start_date: input.startDate || null,
      description: input.description || null, response_team_deployed: input.responseTeamDeployed, baseline_confirmed: input.baselineConfirmed,
      baseline_suspected: input.baselineSuspected, baseline_deaths: input.baselineDeaths, link_matching: input.linkMatching,
    },
  });
  fail(error);
  return data as { id: string; linked: number };
}

export async function updateOutbreak(outbreakId: string, changes: {
  severity?: OutbreakSeverity; status?: OutbreakStatus; note?: string; responseTeamDeployed?: boolean;
  baselineConfirmed?: number; baselineSuspected?: number; baselineDeaths?: number; description?: string;
}) {
  const payload: Record<string, unknown> = {};
  if (changes.severity) payload.severity = changes.severity;
  if (changes.status) payload.status = changes.status;
  if (changes.note) payload.note = changes.note;
  if (changes.responseTeamDeployed !== undefined) payload.response_team_deployed = changes.responseTeamDeployed;
  if (changes.baselineConfirmed !== undefined) payload.baseline_confirmed = changes.baselineConfirmed;
  if (changes.baselineSuspected !== undefined) payload.baseline_suspected = changes.baselineSuspected;
  if (changes.baselineDeaths !== undefined) payload.baseline_deaths = changes.baselineDeaths;
  if (changes.description !== undefined) payload.description = changes.description;
  const { error } = await requireSupabase().rpc('sentinel_update_outbreak', { p_outbreak: outbreakId, p_changes: payload });
  fail(error);
}

export async function addOutbreakUpdate(outbreakId: string, text: string) {
  const { error } = await requireSupabase().rpc('sentinel_add_outbreak_update', { p_outbreak: outbreakId, p_text: text });
  fail(error);
}

export async function linkMatchingCases(outbreakId: string): Promise<number> {
  const { data, error } = await requireSupabase().rpc('sentinel_link_matching_cases', { p_outbreak: outbreakId });
  fail(error);
  return data as number;
}

export interface OutbreakSignal {
  diseaseId: string;
  disease: string;
  state: string;
  lga: string | null;
  thisWeek: number;
  weeklyAverageBefore: number;
  confirmed: number;
  deaths: number;
  firstOnset: string | null;
  reason: string;
  severity: OutbreakSeverity;
}

/** Possible outbreaks detected from recent cases not yet covered by an open outbreak. */
export async function listOutbreakSignals(orgId: string): Promise<OutbreakSignal[]> {
  const { data, error } = await requireSupabase().rpc('sentinel_outbreak_signals', { p_sentinel_org: orgId });
  fail(error);
  return ((data ?? []) as Array<Record<string, unknown>>).map((s) => ({
    diseaseId: String(s.disease_id), disease: String(s.disease), state: String(s.state), lga: (s.lga as string | null) ?? null,
    thisWeek: Number(s.this_week), weeklyAverageBefore: Number(s.weekly_average_before), confirmed: Number(s.confirmed), deaths: Number(s.deaths),
    firstOnset: (s.first_onset as string | null) ?? null, reason: String(s.reason), severity: s.severity as OutbreakSeverity,
  }));
}

/** Sentinel roles that can declare and manage outbreaks. */
export const canManageOutbreaks = (role: SentinelMe['role'] | undefined) => role === 'admin' || role === 'officer';

// ---------------------------------------------------------------------------
// Alerts

export type AlertType = 'lab_notification' | 'cfr_spike' | 'unusual_cluster' | 'facility_not_reporting' | 'new_outbreak' | 'outbreak_threshold' | 'bulletin';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

export interface SentinelAlert {
  id: string;
  type: AlertType;
  severity: OutbreakSeverity;
  status: AlertStatus;
  source: 'system' | 'manual';
  title: string;
  message: string | null;
  state: string | null;
  lga: string | null;
  disease: string | null;
  outbreakId: string | null;
  caseId: string | null;
  createdAt: string;
  createdBy: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  acknowledgedNote: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
}

export interface AlertFilters {
  status?: AlertStatus;
  severity?: OutbreakSeverity;
  type?: AlertType;
}

type AlertRow = {
  id: string; type: AlertType; severity: OutbreakSeverity; status: AlertStatus; source: 'system' | 'manual'; title: string; message: string | null;
  state: string | null; lga: string | null; disease: string | null; outbreak_id: string | null; case_id: string | null; created_at: string;
  created_by_name: string | null; acknowledged_by_name: string | null; acknowledged_at: string | null; acknowledged_note: string | null;
  resolved_by_name: string | null; resolved_at: string | null; resolved_note: string | null;
};

const alertFromRow = (r: AlertRow): SentinelAlert => ({
  id: r.id, type: r.type, severity: r.severity, status: r.status, source: r.source, title: r.title, message: r.message, state: r.state, lga: r.lga,
  disease: r.disease, outbreakId: r.outbreak_id, caseId: r.case_id, createdAt: r.created_at, createdBy: r.created_by_name,
  acknowledgedBy: r.acknowledged_by_name, acknowledgedAt: r.acknowledged_at, acknowledgedNote: r.acknowledged_note,
  resolvedBy: r.resolved_by_name, resolvedAt: r.resolved_at, resolvedNote: r.resolved_note,
});

const ALERT_SELECT = `id, type, severity, status, source, title, message, state, lga, disease, outbreak_id, case_id, created_at, created_by_name,
  acknowledged_by_name, acknowledged_at, acknowledged_note, resolved_by_name, resolved_at, resolved_note`;

export async function listAlerts(orgId: string, filters: AlertFilters, limit = 200): Promise<SentinelAlert[]> {
  let query = requireSupabase().from('sentinel_alerts').select(ALERT_SELECT).eq('sentinel_org_id', orgId).order('created_at', { ascending: false }).limit(limit);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.severity) query = query.eq('severity', filters.severity);
  if (filters.type) query = query.eq('type', filters.type);
  const { data, error } = await query;
  fail(error);
  return ((data ?? []) as AlertRow[]).map(alertFromRow);
}

/** Open alerts by severity, for badges and tabs. */
export async function countAlerts(orgId: string): Promise<Record<AlertStatus, number>> {
  const db = requireSupabase();
  const counts = await Promise.all((['open', 'acknowledged', 'resolved'] as AlertStatus[]).map(async (status) => {
    const { count, error } = await db.from('sentinel_alerts').select('id', { count: 'exact', head: true }).eq('sentinel_org_id', orgId).eq('status', status);
    fail(error);
    return [status, count ?? 0] as const;
  }));
  return Object.fromEntries(counts) as Record<AlertStatus, number>;
}

export async function setAlertStatus(alertId: string, status: AlertStatus, note?: string) {
  const { error } = await requireSupabase().rpc('sentinel_set_alert_status', { p_alert: alertId, p_status: status, p_note: note ?? null });
  fail(error);
}

export interface NewAlert {
  type: Extract<AlertType, 'bulletin' | 'unusual_cluster' | 'lab_notification' | 'cfr_spike' | 'facility_not_reporting' | 'outbreak_threshold'>;
  severity: OutbreakSeverity;
  title: string;
  message?: string;
  state?: string;
  lga?: string;
  disease?: string;
  outbreakId?: string;
}

export async function createAlert(orgId: string, input: NewAlert): Promise<string> {
  const { data, error } = await requireSupabase().rpc('sentinel_create_alert', {
    p_sentinel_org: orgId,
    p_alert: {
      type: input.type, severity: input.severity, title: input.title, message: input.message || null, state: input.state || null,
      lga: input.lga || null, disease: input.disease || null, outbreak_id: input.outbreakId || null,
    },
  });
  fail(error);
  return data as string;
}

/** Calls back with each new or changed alert for this organisation, as it happens. */
export function subscribeToAlerts(orgId: string, onChange: (alert: SentinelAlert, event: 'INSERT' | 'UPDATE') => void): () => void {
  const db = requireSupabase();
  const channel = db.channel(`sentinel-alerts-${orgId}-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sentinel_alerts', filter: `sentinel_org_id=eq.${orgId}` }, (payload) => {
      if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') onChange(alertFromRow(payload.new as AlertRow), payload.eventType);
    })
    .subscribe();
  return () => { void db.removeChannel(channel); };
}

// ---------------------------------------------------------------------------
// Reporting network

export type FacilityType = 'Hospital' | 'Clinic' | 'PHC' | 'Community' | 'Laboratory' | 'Isolation Center';
export type ReportingFrequency = 'daily' | 'weekly' | 'monthly' | 'on_event';

export interface NetworkFacility {
  id: string;
  name: string;
  type: FacilityType;
  state: string;
  lga: string | null;
  ward: string | null;
  /** On VitaLink (data flows automatically once the hospital approves) or a direct reporting site. */
  vitalink: boolean;
  consentStatus: 'pending' | 'approved' | 'declined' | 'revoked';
  isActive: boolean;
  frequency: ReportingFrequency;
  linkedAt: string;
  consentedAt: string | null;
  lastSeen: string | null;
  casesTotal: number;
  cases7d: number;
  encounters7d: number;
}

export async function getFacilityOverview(orgId: string): Promise<NetworkFacility[]> {
  const { data, error } = await requireSupabase().rpc('sentinel_facility_overview', { p_sentinel_org: orgId });
  fail(error);
  return (data ?? []) as NetworkFacility[];
}

export interface DirectSite { name: string; type: FacilityType; state: string; lga?: string; ward?: string; frequency: ReportingFrequency }

export async function addFacility(orgId: string, site: DirectSite): Promise<string> {
  const { data, error } = await requireSupabase().rpc('sentinel_add_facility', { p_sentinel_org: orgId, p_facility: site });
  fail(error);
  return data as string;
}

export async function updateFacility(facilityId: string, changes: Partial<DirectSite> & { isActive?: boolean }) {
  const { isActive, ...rest } = changes;
  const { error } = await requireSupabase().rpc('sentinel_update_facility', {
    p_facility: facilityId, p_changes: { ...rest, ...(isActive === undefined ? {} : { is_active: isActive }) },
  });
  fail(error);
}

/** Withdraws a pending request, stops an approved hospital sharing, or removes/deactivates a direct site. */
export async function removeFacility(facilityId: string): Promise<'withdrawn' | 'stopped' | 'deactivated' | 'deleted'> {
  const { data, error } = await requireSupabase().rpc('sentinel_remove_facility', { p_facility: facilityId });
  fail(error);
  return data as 'withdrawn' | 'stopped' | 'deactivated' | 'deleted';
}

// ---------------------------------------------------------------------------
// Reports

export interface SurveillanceReport {
  from: string;
  to: string;
  days: number;
  previousFrom: string;
  organization: string;
  totals: { cases: number; previousCases: number; suspected: number; confirmed: number; deaths: number; previousDeaths: number; hospitalized: number; states: number; diseases: number };
  byDisease: Array<{
    diseaseId: string; disease: string; category: 'infectious' | 'ntd' | 'ncd'; notifiable: boolean; suspected: number; confirmed: number; deaths: number;
    cases: number; previousCases: number; cfr: number | null; states: number; ytdCases: number; ytdConfirmed: number; ytdDeaths: number;
  }>;
  byState: Array<{ state: string; cases: number; confirmed: number; deaths: number; lgas: number; topDisease: string; openOutbreaks: number }>;
  byAgeSex: Array<{ ageGroup: string; male: number; female: number; unknown: number }>;
  bySource: Record<string, number>;
  weekly: Array<{ week_start: string; epi_week: string; cases: number; confirmed: number; deaths: number }>;
  weeklyByDisease: Array<{ weekStart: string; disease: string; cases: number }>;
  outbreaks: Array<{
    id: string; disease: string; state: string; lga: string | null; severity: OutbreakSeverity; status: OutbreakStatus; startDate: string | null;
    endDate: string | null; confirmed: number; suspected: number; deaths: number; cfr: number | null; responseTeamDeployed: boolean;
    newCases: number; latestUpdate: string | null;
  }>;
  alerts: { total: number; critical: number; high: number; open: number; byType: Record<string, number> };
  reporting: { expected: number; reported: number };
}

export async function getSurveillanceReport(orgId: string, from: string, to: string, options: { category?: 'infectious' | 'ntd' | 'ncd'; diseaseId?: string } = {}): Promise<SurveillanceReport> {
  const { data, error } = await requireSupabase().rpc('sentinel_report', {
    p_sentinel_org: orgId, p_from: from, p_to: to, p_category: options.category ?? null, p_disease: options.diseaseId ?? null,
  });
  fail(error);
  return data as SurveillanceReport;
}

// ---------------------------------------------------------------------------
// Header: global search and activity inbox

export interface SearchResults {
  cases: Array<{ id: string; reportId: string; disease: string; state: string | null; lga: string | null; status: CaseStatus; at: string }>;
  outbreaks: Array<{ id: string; disease: string; state: string; lga: string | null; status: OutbreakStatus; severity: OutbreakSeverity }>;
  alerts: Array<{ id: string; title: string; severity: string; status: AlertStatus; state: string | null }>;
  facilities: Array<{ id: string; name: string; type: string | null; state: string | null; lga: string | null; consent: string }>;
  diseases: Array<{ id: string; name: string; category: string; notifiable: boolean }>;
}

export async function searchSentinel(orgId: string, query: string): Promise<SearchResults> {
  const { data, error } = await requireSupabase().rpc('sentinel_search', { p_sentinel_org: orgId, p_query: query, p_limit: 5 });
  fail(error);
  return data as SearchResults;
}

export interface InboxItem {
  id: string;
  kind: 'case' | 'outbreak' | 'facility';
  event: string;
  targetId: string;
  actor: string | null;
  at: string;
  title: string;
  detail: string | null;
  unread: boolean;
}

export async function getInbox(orgId: string): Promise<{ items: InboxItem[]; unread: number }> {
  const { data, error } = await requireSupabase().rpc('sentinel_inbox', { p_sentinel_org: orgId, p_limit: 30 });
  fail(error);
  const result = data as { items: InboxItem[]; unread: number };
  return { items: result.items ?? [], unread: Number(result.unread ?? 0) };
}

export async function markInboxSeen(orgId: string) {
  const { error } = await requireSupabase().rpc('sentinel_mark_inbox_seen', { p_sentinel_org: orgId });
  fail(error);
}


// ---------------------------------------------------------------------------
// Geographic heatmap

export type RiskLevel = 'critical' | 'high' | 'moderate' | 'low';

export interface HeatmapState {
  state: string;
  cases: number;
  previous: number;
  confirmed: number;
  deaths: number;
  hospitalized: number;
  outbreaks: number;
  alerts: number;
  topDisease: string | null;
  risk: RiskLevel;
  lgas: Array<{ lga: string; cases: number; confirmed: number; deaths: number; topDisease: string | null }>;
  diseases: Array<{ disease: string; cases: number }>;
}

export interface HeatmapData {
  from: string;
  to: string;
  days: number;
  totals: { cases: number; previous: number; confirmed: number; deaths: number; states: number; lgas: number; unlocated: number };
  states: HeatmapState[];
  outbreaks: Array<{ id: string; disease: string; state: string; lga: string | null; severity: OutbreakSeverity; status: OutbreakStatus; confirmed: number; suspected: number; deaths: number }>;
}

export async function getHeatmap(orgId: string, days: number, options: { diseaseId?: string; category?: 'infectious' | 'ntd' | 'ncd' } = {}): Promise<HeatmapData> {
  const { data, error } = await requireSupabase().rpc('sentinel_heatmap', {
    p_sentinel_org: orgId, p_days: days, p_disease: options.diseaseId ?? null, p_category: options.category ?? null,
  });
  fail(error);
  return data as HeatmapData;
}
