import type {
  AppointmentDoctor,
  AppointmentRecord,
  AppointmentStatus,
  AppointmentType,
} from '@/contexts/AppointmentContext';
import { requireSupabase, functionErrorMessage } from './client';
import { formatVitals, listLatestVitalsByPatient } from './clinical';

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || '--';

const hhmm = (time: string) => time.slice(0, 5);

// Appointments are stored as timestamptz and shown in the browser's local time.
function localDate(iso: string) {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function localTime(iso: string) {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
const minutesBetween = (from: string | null, to: string | null) =>
  from ? Math.max(0, Math.round(((to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()) / 60_000)) : 0;

// ---------- clinicians ----------

interface ClinicianRow {
  user_id: string;
  role: string;
  department: string | null;
  working_start: string;
  working_end: string;
  break_times: string[];
  max_per_hour: number;
  profile: { full_name: string; email: string } | null;
}

export async function listCliniciansRemote(organizationId: string): Promise<AppointmentDoctor[]> {
  const { data, error } = await requireSupabase()
    .from('memberships')
    .select('user_id, role, department, working_start, working_end, break_times, max_per_hour, profile:profiles!memberships_user_profile_fk(full_name, email)')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .eq('accepts_appointments', true);
  if (error) throw error;
  return (data as unknown as ClinicianRow[]).map((row) => {
    const name = row.profile?.full_name || row.profile?.email || 'Clinician';
    return {
      id: row.user_id,
      name,
      department: row.department || 'General Medicine',
      avatar: initials(name),
      workingHours: [hhmm(row.working_start), hhmm(row.working_end)],
      breaks: row.break_times,
      maxPerHour: row.max_per_hour,
    };
  });
}

// ---------- appointments ----------

interface AppointmentRow {
  id: string;
  organization_id: string;
  patient_id: string;
  clinician_id: string | null;
  department: string;
  starts_at: string;
  duration_minutes: number;
  type: AppointmentType;
  priority: AppointmentRecord['priority'];
  status: AppointmentStatus;
  visit_reason: string;
  notes: string | null;
  queue_number: string | null;
  check_in_status: AppointmentRecord['checkInStatus'];
  insurance_type: AppointmentRecord['insuranceType'];
  telemedicine_url: string | null;
  checked_in_at: string | null;
  consultation_started_at: string | null;
  completed_at: string | null;
  history: string[];
  updated_at: string;
  updated_by: string | null;
  patient: {
    first_name: string;
    last_name: string;
    switch_id: string;
    nfc_card_id: string | null;
    phone: string;
    allergies: string | null;
    chronic_conditions: string | null;
    insurance_expiry_date: string | null;
  } | null;
  clinician: { full_name: string; email: string } | null;
}

const SELECT = `*,
  patient:patients(first_name, last_name, switch_id, nfc_card_id, phone, allergies, chronic_conditions, insurance_expiry_date),
  clinician:profiles!appointments_clinician_profile_fk(full_name, email)`;

const splitList = (value: string | null | undefined) =>
  (value ?? '').split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);

/** Live per-patient balance and open lab / prescription counts (patient_care_flags RPC). */
interface CareFlags {
  outstandingKobo: number;
  openLabOrders: number;
  activePrescriptions: number;
}

function fromRow(row: AppointmentRow, lastVitals = '', flags?: CareFlags): AppointmentRecord {
  const patientName = row.patient ? `${row.patient.first_name} ${row.patient.last_name}` : 'Unknown patient';
  const doctorName = row.clinician?.full_name || row.clinician?.email || 'Unassigned';
  const waitEnd = row.consultation_started_at ?? (row.status === 'checked-in' || row.status === 'waiting-lab' ? null : row.completed_at ?? row.updated_at);
  const consultEnd = row.completed_at ?? (row.status === 'in-consultation' ? null : row.updated_at);
  const insuranceExpired = row.patient?.insurance_expiry_date ? new Date(row.patient.insurance_expiry_date) < new Date() : false;
  const allergies = splitList(row.patient?.allergies);
  return {
    id: row.id,
    patient: patientName,
    patientSwitchId: row.patient?.switch_id ?? '',
    nfcId: row.patient?.nfc_card_id ?? 'Not linked',
    patientAvatar: initials(patientName),
    doctor: doctorName,
    doctorId: row.clinician_id ?? '',
    doctorAvatar: initials(doctorName),
    department: row.department,
    date: localDate(row.starts_at),
    time: localTime(row.starts_at),
    duration: row.duration_minutes,
    type: row.type,
    priority: row.priority,
    insuranceType: row.insurance_type,
    status: row.status,
    visitReason: row.visit_reason,
    history: row.history,
    checkInStatus: row.check_in_status,
    insuranceStatus: row.insurance_type === 'self-pay' ? 'self-pay' : insuranceExpired ? 'expired' : 'active',
    outstandingBalance: (flags?.outstandingKobo ?? 0) / 100,
    lastVitals: lastVitals || 'Vitals not recorded',
    clinicalAlerts: splitList(row.patient?.chronic_conditions),
    emergencyFlags: row.priority === 'emergency' ? ['Emergency booking'] : [],
    allergies: allergies.length ? allergies : ['None recorded'],
    phone: row.patient?.phone ?? '',
    labLinked: (flags?.openLabOrders ?? 0) > 0,
    prescriptionReady: (flags?.activePrescriptions ?? 0) > 0,
    telemedicineUrl: row.telemedicine_url ?? undefined,
    queueNumber: row.queue_number ?? '--',
    queuePosition: 0, // filled in per department/day by the context
    waitMinutes: minutesBetween(row.checked_in_at, waitEnd),
    consultationMinutes: minutesBetween(row.consultation_started_at, consultEnd),
    lastUpdated: row.updated_at,
    updatedBy: row.updated_by ?? '',
  };
}

export async function listAppointmentsRemote(organizationId: string, fromDate: string, toDate: string): Promise<AppointmentRecord[]> {
  const { data, error } = await requireSupabase()
    .from('appointments')
    .select(SELECT)
    .eq('organization_id', organizationId)
    .gte('starts_at', new Date(`${fromDate}T00:00:00`).toISOString())
    .lt('starts_at', new Date(`${toDate}T23:59:59`).toISOString())
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return withPatientDetails(organizationId, data as unknown as AppointmentRow[]);
}

async function loadCareFlags(organizationId: string, patientIds: string[]): Promise<Map<string, CareFlags>> {
  const { data, error } = await requireSupabase().rpc('patient_care_flags', {
    p_organization_id: organizationId,
    p_patient_ids: patientIds,
  });
  if (error) throw error;
  return new Map((data as Array<{ patient_id: string; outstanding_kobo: number; open_lab_orders: number; active_prescriptions: number }>).map((row) => [
    row.patient_id,
    { outstandingKobo: Number(row.outstanding_kobo), openLabOrders: row.open_lab_orders, activePrescriptions: row.active_prescriptions },
  ]));
}

async function withPatientDetails(organizationId: string, rows: AppointmentRow[]): Promise<AppointmentRecord[]> {
  const patientIds = [...new Set(rows.map((row) => row.patient_id))];
  // Latest vitals are empty for roles that can't read clinical data.
  const [vitals, flags] = await Promise.all([
    listLatestVitalsByPatient(organizationId, patientIds).catch(() => new Map()),
    loadCareFlags(organizationId, patientIds).catch(() => new Map<string, CareFlags>()),
  ]);
  return rows.map((row) => fromRow(row, formatVitals(vitals.get(row.patient_id)), flags.get(row.patient_id)));
}

export interface NewAppointmentInput {
  patientSwitchId: string;
  clinicianId: string;
  department: string;
  date: string;
  time: string;
  duration: number;
  type: AppointmentType;
  priority: AppointmentRecord['priority'];
  insuranceType: AppointmentRecord['insuranceType'];
  visitReason: string;
  note?: string;
}

export async function createAppointmentRemote(organizationId: string, input: NewAppointmentInput): Promise<AppointmentRecord> {
  const db = requireSupabase();
  const { data: patient, error: patientError } = await db
    .from('patients')
    .select('id, insurance_type, insurance_provider')
    .eq('organization_id', organizationId)
    .eq('switch_id', input.patientSwitchId.trim().toUpperCase())
    .maybeSingle();
  if (patientError) throw patientError;
  if (!patient) throw new Error(`No patient with VitaLink ID ${input.patientSwitchId} in this workspace. Register them first.`);

  const insurance = (patient.insurance_type ?? '').toLowerCase();
  const insuranceType: AppointmentRecord['insuranceType'] = ['private', 'public', 'corporate'].includes(insurance)
    ? (insurance as AppointmentRecord['insuranceType'])
    : patient.insurance_provider ? 'private' : input.insuranceType;

  const { data, error } = await db
    .from('appointments')
    .insert({
      organization_id: organizationId,
      patient_id: patient.id,
      clinician_id: input.clinicianId,
      department: input.department,
      starts_at: new Date(`${input.date}T${input.time}:00`).toISOString(),
      duration_minutes: input.duration,
      type: input.type,
      priority: input.priority,
      insurance_type: insuranceType,
      visit_reason: input.visitReason,
      status_note: input.note,
    })
    .select(SELECT)
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('That clinician is already booked at this time.');
    if (error.code === '42501') throw new Error('Your role cannot book appointments in this workspace.');
    throw error;
  }
  const [record] = await withPatientDetails(organizationId, [data as unknown as AppointmentRow]);
  return record;
}

export async function updateAppointmentStatusRemote(id: string, status: AppointmentStatus, note?: string): Promise<AppointmentRecord> {
  const { data, error } = await requireSupabase()
    .from('appointments')
    .update({ status, status_note: note ?? null })
    .eq('id', id)
    .select(SELECT)
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('That slot has been rebooked; this appointment cannot be restored to it.');
    if (error.code === 'PGRST116' || error.code === '42501') throw new Error('Your role cannot update this appointment.');
    throw error;
  }
  const row = data as unknown as AppointmentRow;
  const [record] = await withPatientDetails(row.organization_id, [row]);
  return record;
}

/** Calls onChange whenever an appointment in the organization is inserted, updated or deleted. */
export function subscribeToAppointments(organizationId: string, onChange: () => void) {
  const db = requireSupabase();
  const channel = db
    .channel(`appointments:${organizationId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `organization_id=eq.${organizationId}` }, onChange)
    .subscribe();
  return () => { void db.removeChannel(channel); };
}

/** Emails the patient a reminder (send-appointment-reminder Edge Function). */
export async function sendAppointmentReminderRemote(appointmentId: string): Promise<{ sent: boolean; to?: string; reason?: string }> {
  const { data, error } = await requireSupabase().functions.invoke('send-appointment-reminder', { body: { appointmentId } });
  if (error) {
    throw new Error(await functionErrorMessage(error));
  }
  return data as { sent: boolean; to?: string; reason?: string };
}
