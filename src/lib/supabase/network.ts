// VitaLink Network: directory, referrals / transfers between workspaces and
// consented record sharing. Every write goes through network_* database
// functions; reads use RLS (both hospitals on a transfer can see it).
import { requireSupabase } from './client';

export type Capacity = 'available' | 'limited' | 'unavailable' | 'not_reported';
export type TransferKind = 'referral' | 'transfer';
export type Urgency = 'normal' | 'urgent' | 'emergency';
export type TransferStatus = 'pending_review' | 'info_requested' | 'accepted' | 'declined' | 'records_shared' | 'arrived' | 'completed' | 'cancelled';
export type Coverage = 'unverified' | 'active' | 'authorization_required' | 'out_of_network' | 'not_covered';
export type RecordType = 'note' | 'vitals' | 'lab_result' | 'prescription' | 'document';

export const CAPACITY_LABEL: Record<Capacity, string> = {
  available: 'Available', limited: 'Limited', unavailable: 'Full', not_reported: 'Not reported',
};
export const STATUS_LABEL: Record<TransferStatus, string> = {
  pending_review: 'Awaiting review', info_requested: 'Information requested', accepted: 'Accepted',
  declined: 'Declined', records_shared: 'Records shared', arrived: 'Patient arrived', completed: 'Completed', cancelled: 'Cancelled',
};
export const COVERAGE_LABEL: Record<Coverage, string> = {
  unverified: 'Not verified', active: 'Active coverage', authorization_required: 'Authorisation required',
  out_of_network: 'Out of network', not_covered: 'Not covered',
};
export const RECORD_LABEL: Record<RecordType, string> = {
  note: 'Clinical note', vitals: 'Vitals', lab_result: 'Lab result', prescription: 'Prescription', document: 'Document',
};

/** Roles that may use the network at all, and those that may send / answer referrals. */
export const NETWORK_ROLES = ['super-admin', 'hospital-admin', 'doctor', 'nurse', 'receptionist', 'billing-officer', 'insurance-officer'];
export const NETWORK_CLINICAL_ROLES = ['super-admin', 'hospital-admin', 'doctor'];
export const NETWORK_ADMIN_ROLES = ['super-admin', 'hospital-admin'];
export const NETWORK_SHARE_ROLES = ['super-admin', 'hospital-admin', 'doctor', 'nurse'];
export const NETWORK_ARRIVAL_ROLES = ['super-admin', 'hospital-admin', 'doctor', 'nurse', 'receptionist'];
export const NETWORK_COVERAGE_ROLES = ['super-admin', 'hospital-admin', 'billing-officer', 'insurance-officer'];

function fail(error: { code?: string; message: string }): never {
  throw new Error(error.message);
}

// ---------- directory & settings ----------

export interface NetworkFacility {
  organizationId: string;
  name: string;
  organizationType: string;
  facilityType: string;
  city: string;
  state: string;
  address: string;
  description: string;
  specialties: string[];
  services: string[];
  emergency: boolean;
  laboratory: boolean;
  imaging: boolean;
  pharmacy: boolean;
  telemedicine: boolean;
  acceptingReferrals: boolean;
  acceptingTransfers: boolean;
  capacity: Capacity;
  capacityUpdatedAt: string | null;
  phone: string;
  verified: boolean;
  updatedAt: string;
  isMine: boolean;
}

export async function listDirectory(): Promise<NetworkFacility[]> {
  const { data, error } = await requireSupabase().rpc('network_directory');
  if (error) fail(error);
  return (data as Array<Record<string, unknown>>).map((r) => ({
    organizationId: String(r.organization_id), name: String(r.name), organizationType: String(r.organization_type ?? ''),
    facilityType: String(r.facility_type ?? ''), city: String(r.city ?? ''), state: String(r.state ?? ''), address: String(r.address ?? ''),
    description: String(r.description ?? ''), specialties: (r.specialties as string[]) ?? [], services: (r.services as string[]) ?? [],
    emergency: Boolean(r.emergency), laboratory: Boolean(r.laboratory), imaging: Boolean(r.imaging), pharmacy: Boolean(r.pharmacy),
    telemedicine: Boolean(r.telemedicine), acceptingReferrals: Boolean(r.accepting_referrals), acceptingTransfers: Boolean(r.accepting_transfers),
    capacity: (r.capacity as Capacity) ?? 'not_reported', capacityUpdatedAt: (r.capacity_updated_at as string | null) ?? null,
    phone: String(r.referral_phone || r.contact_phone || ''), verified: Boolean(r.verified), updatedAt: String(r.updated_at), isMine: Boolean(r.is_mine),
  }));
}

export interface NetworkSettings {
  joined: boolean;
  visibleInDirectory: boolean;
  facilityType: string;
  city: string;
  state: string;
  description: string;
  specialties: string[];
  services: string[];
  emergency: boolean;
  laboratory: boolean;
  imaging: boolean;
  pharmacy: boolean;
  telemedicine: boolean;
  acceptingReferrals: boolean;
  acceptingTransfers: boolean;
  capacity: Capacity;
  referralEmail: string;
  referralPhone: string;
  verified: boolean;
}

export async function getSettings(organizationId: string): Promise<NetworkSettings> {
  const db = requireSupabase();
  const [{ data: org, error: orgError }, { data: p, error }] = await Promise.all([
    db.from('organizations').select('joined_network, state').eq('id', organizationId).single(),
    db.from('network_profiles').select('*').eq('organization_id', organizationId).maybeSingle(),
  ]);
  if (orgError) fail(orgError);
  if (error) fail(error);
  return {
    joined: Boolean(org?.joined_network), visibleInDirectory: p?.visible_in_directory ?? true,
    facilityType: p?.facility_type ?? '', city: p?.city ?? '', state: p?.state || org?.state || '', description: p?.description ?? '',
    specialties: p?.specialties ?? [], services: p?.services ?? [], emergency: Boolean(p?.emergency), laboratory: Boolean(p?.laboratory),
    imaging: Boolean(p?.imaging), pharmacy: Boolean(p?.pharmacy), telemedicine: Boolean(p?.telemedicine),
    acceptingReferrals: p?.accepting_referrals ?? true, acceptingTransfers: p?.accepting_transfers ?? true,
    capacity: (p?.capacity as Capacity) ?? 'not_reported', referralEmail: p?.referral_email ?? '', referralPhone: p?.referral_phone ?? '',
    verified: Boolean(p?.verified_at),
  };
}

export async function saveSettings(organizationId: string, s: NetworkSettings) {
  const { error } = await requireSupabase().rpc('network_save_settings', {
    p_organization_id: organizationId,
    p_joined: s.joined,
    p_profile: {
      visible_in_directory: s.visibleInDirectory, facility_type: s.facilityType, city: s.city, state: s.state, description: s.description,
      specialties: s.specialties, services: s.services, emergency: s.emergency, laboratory: s.laboratory, imaging: s.imaging,
      pharmacy: s.pharmacy, telemedicine: s.telemedicine, accepting_referrals: s.acceptingReferrals, accepting_transfers: s.acceptingTransfers,
      capacity: s.capacity, referral_email: s.referralEmail, referral_phone: s.referralPhone,
    },
  });
  if (error) fail(error);
}

// ---------- transfers ----------

export interface PatientSnapshot {
  switch_id: string; first_name: string; middle_name?: string | null; last_name: string; date_of_birth: string; gender: string;
  phone?: string | null; email?: string | null; address?: string | null; state?: string | null; blood_group?: string | null;
  genotype?: string | null; allergies?: string | null; chronic_conditions?: string | null; current_medications?: string | null;
  emergency_contact_name?: string | null; emergency_relationship?: string | null; emergency_phone?: string | null;
}

export interface NetworkTransfer {
  id: string;
  number: string;
  kind: TransferKind;
  referringOrgId: string;
  referringOrgName: string;
  receivingOrgId: string;
  receivingOrgName: string;
  patientId: string | null;
  patient: PatientSnapshot;
  specialty: string;
  reason: string;
  clinicalSummary: string;
  urgency: Urgency;
  requestedDate: string | null;
  notes: string;
  clinicianName: string;
  consentMethod: string;
  consentRecordedAt: string;
  insurance: { provider?: string | null; policy_number?: string | null; type?: string | null; expiry?: string | null };
  coverage: Coverage;
  status: TransferStatus;
  declineReason: string | null;
  receivedPatientId: string | null;
  createdAt: string;
  updatedAt: string;
}

const toTransfer = (r: Record<string, any>): NetworkTransfer => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
  id: r.id, number: r.number, kind: r.kind, referringOrgId: r.referring_org_id, referringOrgName: r.referring_org_name,
  receivingOrgId: r.receiving_org_id, receivingOrgName: r.receiving_org_name, patientId: r.patient_id, patient: r.patient_snapshot,
  specialty: r.specialty, reason: r.reason, clinicalSummary: r.clinical_summary, urgency: r.urgency, requestedDate: r.requested_date,
  notes: r.notes, clinicianName: r.referring_clinician_name, consentMethod: r.consent_method, consentRecordedAt: r.consent_recorded_at,
  insurance: r.insurance ?? {}, coverage: r.coverage_status, status: r.status, declineReason: r.decline_reason,
  receivedPatientId: r.received_patient_id, createdAt: r.created_at, updatedAt: r.updated_at,
});

export async function listTransfers(organizationId: string): Promise<NetworkTransfer[]> {
  const { data, error } = await requireSupabase()
    .from('network_transfers')
    .select('*')
    .or(`referring_org_id.eq.${organizationId},receiving_org_id.eq.${organizationId}`)
    .order('updated_at', { ascending: false })
    .limit(300);
  if (error) fail(error);
  return (data as Array<Record<string, unknown>>).map(toTransfer);
}

export interface TransferEvent { id: number; kind: string; body: string; organizationId: string | null; organizationName: string; actorName: string; at: string }

export async function listEvents(transferId: string): Promise<TransferEvent[]> {
  const { data, error } = await requireSupabase()
    .from('network_transfer_events')
    .select('id, kind, body, organization_id, organization_name, actor_name, created_at')
    .eq('transfer_id', transferId)
    .order('created_at');
  if (error) fail(error);
  return (data as Array<Record<string, unknown>>).map((e) => ({
    id: Number(e.id), kind: String(e.kind), body: String(e.body ?? ''), organizationId: (e.organization_id as string | null) ?? null,
    organizationName: String(e.organization_name ?? ''), actorName: String(e.actor_name ?? ''), at: String(e.created_at),
  }));
}

export interface TransferRecord { id: string; type: RecordType; label: string; date: string | null; sharedAt: string | null; content: Record<string, unknown> | null }

export async function listTransferRecords(transferId: string): Promise<TransferRecord[]> {
  const { data, error } = await requireSupabase().rpc('network_transfer_records', { p_transfer_id: transferId });
  if (error) fail(error);
  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), type: r.record_type as RecordType, label: String(r.label), date: (r.record_date as string | null) ?? null,
    sharedAt: (r.shared_at as string | null) ?? null, content: (r.snapshot as Record<string, unknown> | null) ?? null,
  }));
}

export interface ShareableRecord { type: RecordType; id: string; label: string; date: string | null }

export async function listShareableRecords(patientId: string): Promise<ShareableRecord[]> {
  const { data, error } = await requireSupabase().rpc('network_patient_records', { p_patient_id: patientId });
  if (error) fail(error);
  return (data as Array<Record<string, unknown>>).map((r) => ({
    type: r.record_type as RecordType, id: String(r.record_id), label: String(r.label), date: (r.record_date as string | null) ?? null,
  }));
}

export async function createTransfer(input: {
  kind: TransferKind; receivingOrgId: string; patientId: string; reason: string; specialty: string; clinicalSummary: string;
  urgency: Urgency; requestedDate: string | null; notes: string; records: Array<{ type: RecordType; id: string }>; consentMethod: string;
}): Promise<string> {
  const { data, error } = await requireSupabase().rpc('network_create_transfer', {
    p_kind: input.kind, p_receiving_org_id: input.receivingOrgId, p_patient_id: input.patientId, p_reason: input.reason,
    p_specialty: input.specialty, p_clinical_summary: input.clinicalSummary, p_urgency: input.urgency,
    p_requested_date: input.requestedDate || null, p_notes: input.notes, p_items: input.records, p_consent_method: input.consentMethod,
  });
  if (error) fail(error);
  return data as string;
}

export async function respond(transferId: string, action: 'accept' | 'decline' | 'request_info', note = '') {
  const { error } = await requireSupabase().rpc('network_respond', { p_transfer_id: transferId, p_action: action, p_note: note });
  if (error) fail(error);
}

export async function sendMessage(transferId: string, body: string) {
  const { error } = await requireSupabase().rpc('network_message', { p_transfer_id: transferId, p_body: body });
  if (error) fail(error);
}

export async function shareRecords(transferId: string): Promise<number> {
  const { data, error } = await requireSupabase().rpc('network_share_records', { p_transfer_id: transferId });
  if (error) fail(error);
  return Number(data ?? 0);
}

export async function markArrived(transferId: string, register: boolean): Promise<string | null> {
  const { data, error } = await requireSupabase().rpc('network_mark_arrived', { p_transfer_id: transferId, p_register: register });
  if (error) fail(error);
  return (data as string | null) ?? null;
}

export async function completeTransfer(transferId: string) {
  const { error } = await requireSupabase().rpc('network_complete', { p_transfer_id: transferId });
  if (error) fail(error);
}

export async function cancelTransfer(transferId: string, reason: string) {
  const { error } = await requireSupabase().rpc('network_cancel', { p_transfer_id: transferId, p_reason: reason });
  if (error) fail(error);
}

export async function setCoverage(transferId: string, status: Coverage, note = '') {
  const { error } = await requireSupabase().rpc('network_set_coverage', { p_transfer_id: transferId, p_status: status, p_note: note });
  if (error) fail(error);
}

/** Signed link for a shared document (the receiving hospital may read it once shared). */
export async function sharedDocumentLink(storagePath: string): Promise<string> {
  const { data, error } = await requireSupabase().storage.from('patient-documents').createSignedUrl(storagePath, 600);
  if (error || !data) throw new Error(error?.message ?? 'Could not open the document');
  return data.signedUrl;
}

/** Re-runs onChange when a transfer for this workspace changes or gets a new event. */
export function subscribeToTransfers(organizationId: string, onChange: () => void) {
  const db = requireSupabase();
  const channel = db
    .channel(`network-${organizationId}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'network_transfers', filter: `referring_org_id=eq.${organizationId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'network_transfers', filter: `receiving_org_id=eq.${organizationId}` }, onChange)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'network_transfer_events' }, onChange)
    .subscribe();
  return () => { void db.removeChannel(channel); };
}

// ---------- received records (receiving hospital's EMR) ----------

export interface ReceivedRecord {
  itemId: string;
  transferId: string;
  transferNumber: string;
  fromOrg: string;
  type: RecordType;
  label: string;
  date: string | null;
  sharedAt: string;
  content: Record<string, unknown> | null;
}

/** Records other hospitals shared about this patient over the network (read-only history). */
export async function listReceivedRecords(patientId: string): Promise<ReceivedRecord[]> {
  const { data, error } = await requireSupabase().rpc('network_patient_received_records', { p_patient_id: patientId });
  if (error) fail(error);
  return (data as Array<Record<string, unknown>>).map((r) => ({
    itemId: String(r.item_id), transferId: String(r.transfer_id), transferNumber: String(r.transfer_number), fromOrg: String(r.from_org),
    type: r.record_type as RecordType, label: String(r.label), date: (r.record_date as string | null) ?? null,
    sharedAt: String(r.shared_at), content: (r.snapshot as Record<string, unknown> | null) ?? null,
  }));
}
