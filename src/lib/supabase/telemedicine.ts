import { requireSupabase } from './client';

export type TeleKind = 'consultation' | 'conference';
export type TeleStatus = 'scheduled' | 'waiting' | 'live' | 'ended' | 'cancelled';

export interface TeleSession {
  id: string;
  kind: TeleKind;
  status: TeleStatus;
  roomToken: string;
  patientId: string;
  patientName: string;
  patientSwitchId: string;
  appointmentId: string | null;
  appointmentAt: string | null;
  hostId: string | null;
  hostName: string;
  guestId: string | null;
  guestName: string;
  consentAt: string | null;
  patientWaitingAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  summary: string;
  createdAt: string;
  /** Hospital of the invited specialist, when it isn't this one. */
  guestFacility: string;
  /** The inviting doctor's note for the specialist. */
  caseSummary: string;
  /** Set when another hospital invited me: I see only the case note, not their records. */
  external?: { hostFacility: string; patientAge: number | null; patientSex: string };
}

type Person = { full_name: string; email: string } | null;
const nameOf = (person: Person) => person?.full_name || person?.email || '';

interface SessionRow {
  id: string;
  kind: TeleKind;
  status: TeleStatus;
  room_token: string;
  patient_id: string;
  appointment_id: string | null;
  host_id: string | null;
  guest_id: string | null;
  consent_at: string | null;
  patient_waiting_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  summary: string;
  created_at: string;
  guest_name: string | null;
  guest_facility: string | null;
  guest_organization_id: string | null;
  case_summary: string | null;
  patient: { first_name: string; last_name: string; switch_id: string } | null;
  appointment: { starts_at: string } | null;
  host: Person;
  guest: Person;
}

const SELECT = `id, kind, status, room_token, patient_id, appointment_id, host_id, guest_id, consent_at, patient_waiting_at, started_at, ended_at, summary, created_at,
  guest_name, guest_facility, guest_organization_id, case_summary,
  patient:patients!telemedicine_sessions_patient_id_organization_id_fkey(first_name, last_name, switch_id),
  appointment:appointments!telemedicine_sessions_appointment_id_fkey(starts_at),
  host:profiles!telemedicine_sessions_host_id_fkey(full_name, email),
  guest:profiles!telemedicine_sessions_guest_id_fkey(full_name, email)`;

const fromRow = (row: SessionRow): TeleSession => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  roomToken: row.room_token,
  patientId: row.patient_id,
  patientName: row.patient ? `${row.patient.first_name} ${row.patient.last_name}` : 'Unknown patient',
  patientSwitchId: row.patient?.switch_id ?? '',
  appointmentId: row.appointment_id,
  appointmentAt: row.appointment?.starts_at ?? null,
  hostId: row.host_id,
  hostName: nameOf(row.host),
  guestId: row.guest_id,
  // Specialists from other hospitals aren't visible profiles here, so use the name saved at invite time.
  guestName: nameOf(row.guest) || row.guest_name || '',
  consentAt: row.consent_at,
  patientWaitingAt: row.patient_waiting_at,
  startedAt: row.started_at,
  endedAt: row.ended_at,
  summary: row.summary,
  createdAt: row.created_at,
  guestFacility: row.guest_organization_id && row.guest_facility ? row.guest_facility : '',
  caseSummary: row.case_summary ?? '',
});

function friendly(error: { code?: string; message: string }, action: string): Error {
  if (error.code === '42501' && !/already/i.test(error.message)) return new Error(`Your role cannot ${action}.`);
  if (error.code === 'PGRST116') return new Error(`Your role cannot ${action}.`);
  return new Error(error.message);
}

/** Public address patients open links on: VITE_PUBLIC_APP_URL when set (deployments), else this page's origin. */
const publicOrigin = () => ((import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.replace(/\/+$/, '') || window.location.origin);

/** The patient's join link for a consultation room. */
export const visitLink = (roomToken: string) => `${publicOrigin()}/visit?t=${roomToken}`;

/** Open sessions plus the last two days of finished ones. */
export async function listSessions(organizationId: string): Promise<TeleSession[]> {
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { data, error } = await requireSupabase()
    .from('telemedicine_sessions')
    .select(SELECT)
    .eq('organization_id', organizationId)
    .or(`status.in.(scheduled,waiting,live),created_at.gte.${since}`)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw friendly(error, 'view telemedicine sessions');
  return (data as unknown as SessionRow[]).map(fromRow);
}

export async function createSession(input: {
  patientId: string; kind: TeleKind; appointmentId?: string | null; guestId?: string | null;
  guestOrganizationId?: string | null; caseSummary?: string;
}) {
  const { data, error } = await requireSupabase().rpc('create_telemedicine_session', {
    p_patient_id: input.patientId,
    p_kind: input.kind,
    p_appointment_id: input.appointmentId ?? null,
    p_guest_id: input.guestId ?? null,
    p_join_base_url: `${publicOrigin()}/visit`,
    p_guest_organization_id: input.guestOrganizationId ?? null,
    p_case_summary: input.caseSummary?.trim() || null,
  });
  if (error) throw friendly(error, 'start telemedicine sessions');
  return data as { id: string; room_token: string };
}

export async function updateSession(id: string, patch: { status?: TeleStatus; summary?: string; consent?: boolean }) {
  const fields: Record<string, unknown> = {};
  if (patch.status) fields.status = patch.status;
  if (patch.summary !== undefined) fields.summary = patch.summary;
  if (patch.consent) fields.consent_at = new Date().toISOString();
  const { error } = await requireSupabase().from('telemedicine_sessions').update(fields).eq('id', id).select('id').single();
  if (error) throw friendly(error, 'update telemedicine sessions');
}

/** Calls onChange whenever a session in the workspace changes (waiting room, status). */
export function subscribeToSessions(organizationId: string, onChange: () => void) {
  const db = requireSupabase();
  const channel = db
    .channel(`telemedicine-sessions-${organizationId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'telemedicine_sessions', filter: `organization_id=eq.${organizationId}` }, onChange)
    .subscribe();
  return () => { void db.removeChannel(channel); };
}

// ---------- specialists from other network hospitals ----------

export interface NetworkSpecialist { id: string; name: string; title: string; department: string; role: string }

/** Doctors at a network hospital that offers telemedicine. */
export async function listNetworkSpecialists(organizationId: string): Promise<NetworkSpecialist[]> {
  const { data, error } = await requireSupabase().rpc('network_specialists', { p_organization_id: organizationId });
  if (error) throw friendly(error, 'see specialists at other hospitals');
  return (data as Array<{ user_id: string; full_name: string; job_title: string | null; department: string | null; role: string }>).map((row) => ({
    id: row.user_id, name: row.full_name, title: row.job_title ?? '', department: row.department ?? '', role: row.role,
  }));
}

/** Conferences other hospitals invited me to, seen from this workspace. */
export async function listExternalConferences(organizationId: string): Promise<TeleSession[]> {
  const { data, error } = await requireSupabase().rpc('network_my_conferences', { p_organization_id: organizationId });
  if (error) throw friendly(error, 'view network conferences');
  return (data as Array<{
    id: string; status: TeleStatus; room_token: string; host_name: string | null; host_facility: string; patient_name: string;
    patient_age: number | null; patient_sex: string | null; case_summary: string | null; summary: string | null;
    consent_at: string | null; started_at: string | null; created_at: string;
  }>).map((row) => ({
    id: row.id, kind: 'conference', status: row.status, roomToken: row.room_token,
    patientId: '', patientName: row.patient_name, patientSwitchId: '', appointmentId: null, appointmentAt: null,
    hostId: null, hostName: row.host_name ?? '', guestId: null, guestName: '', consentAt: row.consent_at,
    patientWaitingAt: null, startedAt: row.started_at, endedAt: null, summary: row.summary ?? '', createdAt: row.created_at,
    guestFacility: '', caseSummary: row.case_summary ?? '',
    external: { hostFacility: row.host_facility, patientAge: row.patient_age, patientSex: row.patient_sex ?? '' },
  }));
}

/** The invited specialist's notes on a conference hosted by another hospital. */
export async function saveExternalSummary(sessionId: string, summary: string) {
  const { error } = await requireSupabase().rpc('network_conference_save_summary', { p_session_id: sessionId, p_summary: summary });
  if (error) throw friendly(error, 'save the summary');
}

/** Live updates for conferences I'm invited to at other hospitals. */
export function subscribeToMyInvitations(userId: string, onChange: () => void) {
  const db = requireSupabase();
  const channel = db
    .channel(`telemedicine-invites-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'telemedicine_sessions', filter: `guest_id=eq.${userId}` }, onChange)
    .subscribe();
  return () => { void db.removeChannel(channel); };
}

// ---------- patient side (no account) ----------

export interface VisitInfo {
  status: TeleStatus;
  facility: string;
  clinician: string;
  patientFirstName: string;
  scheduledFor: string | null;
}

/** Validates a join link and checks the patient into the waiting room (call again as a heartbeat). */
export async function checkInToVisit(token: string): Promise<VisitInfo | null> {
  const { data, error } = await requireSupabase().rpc('telemedicine_visit', { p_token: token });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as Record<string, string | null>;
  return {
    status: row.status as TeleStatus,
    facility: row.facility ?? '',
    clinician: row.clinician ?? 'your clinician',
    patientFirstName: row.patient_first_name ?? '',
    scheduledFor: row.scheduled_for ?? null,
  };
}
