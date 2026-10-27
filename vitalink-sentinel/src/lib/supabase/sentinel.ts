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

export type SentinelOrgType = 'NGO' | 'Government' | 'Ministry' | 'International' | 'Research' | 'Academic';

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
