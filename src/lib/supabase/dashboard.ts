import { requireSupabase } from './client';

const toNaira = (kobo: unknown) => Number(kobo ?? 0) / 100;
const count = (value: unknown) => (value === undefined || value === null ? null : Number(value));

export type ActivityKind =
  | 'patient' | 'booking' | 'checkin' | 'appointment'
  | 'lab-order' | 'lab' | 'alert' | 'prescription' | 'pharmacy' | 'note' | 'vitals' | 'document'
  | 'invoice' | 'billing' | 'claim' | 'staff';

export interface DashboardActivity {
  kind: ActivityKind;
  message: string;
  at: string;
  switchId: string | null;
  actor: string | null;
}

/** Newest-first activity feed; pass the last item's `at` as `before` for the next page. */
export async function listRecentActivity(organizationId: string, limit = 10, before?: string): Promise<DashboardActivity[]> {
  const { data, error } = await requireSupabase().rpc('recent_activity', {
    p_organization_id: organizationId,
    p_limit: limit,
    p_before: before ?? null,
  });
  if (error) throw new Error(error.code === '42501' ? 'You are not a member of this workspace.' : error.message);
  return ((data as Array<Record<string, string | null>> | null) ?? []).map((row) => ({
    kind: row.kind as ActivityKind,
    message: row.message ?? '',
    at: row.at ?? '',
    switchId: row.switch_id ?? null,
    actor: row.actor ?? null,
  }));
}

export interface CriticalLab {
  orderNumber: string;
  patient: string;
  switchId: string;
  completedAt: string;
}

/**
 * Workspace figures for the dashboard. Fields the caller's role may not see are
 * null (clinical, billing and stock blocks), so the UI can hide them.
 */
export interface DashboardSummary {
  generatedAt: string;
  patientsTotal: number;
  patientsNewThisMonth: number;
  appointmentsToday: number;
  patientsToday: number;
  appointmentsCompletedToday: number;
  appointmentsOpenToday: number;
  labsPending: number | null;
  labsProcessing: number | null;
  labsUrgentOpen: number | null;
  labsCritical7d: number | null;
  criticalLabs: CriticalLab[];
  prescriptionsActive: number | null;
  revenueToday: number | null;
  revenueYesterday: number | null;
  outstanding: number | null;
  invoicesOverdue: number | null;
  claimsSubmitted: number | null;
  claimsSubmittedValue: number | null;
  stockLow: number | null;
  stockExpiring30d: number | null;
}

export async function getDashboardSummary(organizationId: string): Promise<DashboardSummary> {
  const { data, error } = await requireSupabase().rpc('dashboard_summary', { p_organization_id: organizationId });
  if (error) throw new Error(error.code === '42501' ? 'You are not a member of this workspace.' : error.message);
  const raw = data as Record<string, unknown>;
  const hasBilling = raw.revenue_today_kobo !== undefined;
  return {
    generatedAt: String(raw.generated_at),
    patientsTotal: Number(raw.patients_total ?? 0),
    patientsNewThisMonth: Number(raw.patients_new_this_month ?? 0),
    appointmentsToday: Number(raw.appointments_today ?? 0),
    patientsToday: Number(raw.patients_today ?? 0),
    appointmentsCompletedToday: Number(raw.appointments_completed_today ?? 0),
    appointmentsOpenToday: Number(raw.appointments_open_today ?? 0),
    labsPending: count(raw.labs_pending),
    labsProcessing: count(raw.labs_processing),
    labsUrgentOpen: count(raw.labs_urgent_open),
    labsCritical7d: count(raw.labs_critical_7d),
    criticalLabs: ((raw.critical_labs as Array<Record<string, string>> | undefined) ?? []).map((row) => ({
      orderNumber: row.order_number,
      patient: row.patient,
      switchId: row.switch_id,
      completedAt: row.completed_at,
    })),
    prescriptionsActive: count(raw.prescriptions_active),
    revenueToday: hasBilling ? toNaira(raw.revenue_today_kobo) : null,
    revenueYesterday: hasBilling ? toNaira(raw.revenue_yesterday_kobo) : null,
    outstanding: hasBilling ? toNaira(raw.outstanding_kobo) : null,
    invoicesOverdue: count(raw.invoices_overdue),
    claimsSubmitted: count(raw.claims_submitted),
    claimsSubmittedValue: hasBilling ? toNaira(raw.claims_submitted_kobo) : null,
    stockLow: count(raw.stock_low),
    stockExpiring30d: count(raw.stock_expiring_30d),
  };
}

/**
 * One canonical form for VitaCard numbers: readers report the same chip as
 * "04:a1:b2:...", "04 A1 B2 ..." or "04A1B2...". Upper-case, and for hex UIDs
 * drop the separators; printed card numbers keep their dashes.
 */
export function normalizeCardId(raw: string) {
  const value = raw.trim().toUpperCase().replace(/[\s:]+/g, '');
  return /^[0-9A-F-]+$/.test(value) && /[0-9]/.test(value) ? value.replace(/-/g, '') : value;
}

/** Escapes a value for use inside a PostgREST `or()` filter. */
const orValue = (text: string) => `"${text.replace(/["\\]/g, (char) => `\\${char}`)}"`;

/** Finds a patient in the workspace by VitaLink ID or VitaCard (NFC) id, e.g. from a card tap or QR scan. */
export async function findPatientByCode(organizationId: string, code: string): Promise<{ switchId: string; name: string } | null> {
  const value = code.trim();
  if (!value) return null;
  const escaped = orValue(value);
  const card = orValue(normalizeCardId(value));
  const { data, error } = await requireSupabase()
    .from('patients')
    .select('switch_id, first_name, last_name')
    .eq('organization_id', organizationId)
    .or(`switch_id.ilike.${escaped},nfc_card_id.eq.${escaped},nfc_card_id.eq.${card}`)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { switchId: data.switch_id as string, name: `${data.first_name} ${data.last_name}` } : null;
}

// ---------- digital health identity ----------

export type ScanMethod = 'nfc' | 'qr' | 'manual';

export interface IdentityScan {
  id: string;
  method: ScanMethod;
  at: string;
  patientName: string;
  switchId: string;
  scannedBy: string;
}

/** Records that a patient was identified (best effort: a failed log never blocks care). */
export async function logIdentityScan(organizationId: string, patientId: string, method: ScanMethod) {
  await requireSupabase().from('identity_scans').insert({ organization_id: organizationId, patient_id: patientId, method });
}

export async function listIdentityScans(organizationId: string, limit = 8): Promise<IdentityScan[]> {
  const { data, error } = await requireSupabase()
    .from('identity_scans')
    .select('id, method, created_at, patient:patients!identity_scans_patient_id_organization_id_fkey(first_name, last_name, switch_id), scanner:profiles!identity_scans_scanned_by_fkey(full_name, email)')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as unknown as Array<{
    id: string; method: ScanMethod; created_at: string;
    patient: { first_name: string; last_name: string; switch_id: string } | null;
    scanner: { full_name: string; email: string } | null;
  }>).map((row) => ({
    id: row.id,
    method: row.method,
    at: row.created_at,
    patientName: row.patient ? `${row.patient.first_name} ${row.patient.last_name}` : 'Unknown patient',
    switchId: row.patient?.switch_id ?? '',
    scannedBy: row.scanner?.full_name || row.scanner?.email || '',
  }));
}

/** Links a VitaCard (NFC UID or printed card number) to a patient; null unlinks it. */
export async function setPatientCard(patientId: string, cardId: string | null) {
  const { error } = await requireSupabase()
    .from('patients')
    .update({ nfc_card_id: cardId?.trim() ? normalizeCardId(cardId) : null, nfc_active: Boolean(cardId?.trim()) })
    .eq('id', patientId)
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('That VitaCard is already linked to another patient.');
    if (error.code === '42501' || error.code === 'PGRST116') throw new Error('Your role cannot change VitaCard links.');
    throw new Error(error.message);
  }
}

/** The patient's most recent attended visit (checked in or further along). */
export async function getLastVisit(organizationId: string, patientId: string): Promise<{ at: string; type: string; status: string; department: string } | null> {
  const { data, error } = await requireSupabase()
    .from('appointments')
    .select('starts_at, type, status, department')
    .eq('organization_id', organizationId)
    .eq('patient_id', patientId)
    .in('status', ['checked-in', 'in-consultation', 'waiting-lab', 'admitted', 'emergency', 'completed'])
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? { at: data.starts_at as string, type: data.type as string, status: data.status as string, department: data.department as string } : null;
}
