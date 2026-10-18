import { BRAND } from '@/config/brand';
import type { PatientQueryInput, PatientStatus, PatientTag, RegistryPatient, ServerPageResult } from '@/lib/patientRegistry';
import { requireSupabase } from './client';

// Row shape of public.patients (snake_case). Organization id doubles as the app's tenantId.
interface PatientRow {
  id: string;
  organization_id: string;
  switch_id: string;
  first_name: string;
  middle_name: string | null;
  last_name: string;
  date_of_birth: string;
  gender: 'male' | 'female' | 'other';
  phone: string;
  email: string | null;
  address: string;
  state: string;
  country: string;
  marital_status: string | null;
  occupation: string | null;
  national_id: string | null;
  profile_photo_url: string | null;
  blood_group: string | null;
  genotype: string | null;
  allergies: string | null;
  chronic_conditions: string | null;
  current_medications: string | null;
  family_medical_history: string | null;
  past_surgeries: string | null;
  disability_status: string | null;
  pregnancy_status: string | null;
  emergency_contact_name: string;
  emergency_relationship: string;
  emergency_phone: string;
  emergency_address: string | null;
  insurance_provider: string | null;
  insurance_policy_number: string | null;
  insurance_expiry_date: string | null;
  insurance_type: string | null;
  nfc_card_id: string | null;
  nfc_active: boolean;
  status: PatientStatus;
  tags: PatientTag[];
  department: string | null;
  doctor_assigned: string | null;
  admission_status: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

const optional = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

function fromRow(row: PatientRow): RegistryPatient {
  return {
    id: row.id,
    tenantId: row.organization_id,
    switchId: row.switch_id,
    firstName: row.first_name,
    middleName: row.middle_name ?? undefined,
    lastName: row.last_name,
    dateOfBirth: row.date_of_birth,
    gender: row.gender,
    phone: row.phone,
    email: row.email ?? undefined,
    address: row.address,
    state: row.state,
    country: row.country,
    maritalStatus: row.marital_status ?? undefined,
    occupation: row.occupation ?? undefined,
    nationalId: row.national_id ?? undefined,
    profilePhoto: row.profile_photo_url ?? undefined,
    bloodGroup: row.blood_group ?? undefined,
    genotype: row.genotype ?? undefined,
    allergies: row.allergies ?? undefined,
    chronicConditions: row.chronic_conditions ?? undefined,
    currentMedications: row.current_medications ?? undefined,
    familyMedicalHistory: row.family_medical_history ?? undefined,
    pastSurgeries: row.past_surgeries ?? undefined,
    disabilityStatus: row.disability_status ?? undefined,
    pregnancyStatus: row.pregnancy_status ?? undefined,
    emergencyContactName: row.emergency_contact_name,
    emergencyRelationship: row.emergency_relationship,
    emergencyPhone: row.emergency_phone,
    emergencyAddress: row.emergency_address ?? undefined,
    insuranceProvider: row.insurance_provider ?? undefined,
    insurancePolicyNumber: row.insurance_policy_number ?? undefined,
    insuranceExpiryDate: row.insurance_expiry_date ?? undefined,
    insuranceType: row.insurance_type ?? undefined,
    insuranceProviderFilter: row.insurance_provider ?? undefined,
    nfcCardId: row.nfc_card_id ?? undefined,
    nfcActive: row.nfc_active,
    status: row.status,
    tags: row.tags ?? [],
    // Documents and timeline move to their own tables in a later phase.
    documents: [],
    timeline: [],
    doctorAssigned: row.doctor_assigned ?? undefined,
    department: row.department ?? undefined,
    admissionStatus: row.admission_status ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by ?? '',
    updatedBy: row.updated_by ?? '',
  };
}

type NewPatient = Omit<RegistryPatient, 'id' | 'switchId' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>;

function toInsert(patient: NewPatient) {
  // switch_id, created_by and updated_by are set by database triggers.
  return {
    organization_id: patient.tenantId,
    first_name: patient.firstName.trim(),
    middle_name: optional(patient.middleName),
    last_name: patient.lastName.trim(),
    date_of_birth: patient.dateOfBirth,
    gender: patient.gender,
    phone: patient.phone.trim(),
    email: optional(patient.email),
    address: patient.address ?? '',
    state: patient.state ?? '',
    country: patient.country || 'Nigeria',
    marital_status: optional(patient.maritalStatus),
    occupation: optional(patient.occupation),
    national_id: optional(patient.nationalId),
    profile_photo_url: optional(patient.profilePhoto),
    blood_group: optional(patient.bloodGroup),
    genotype: optional(patient.genotype),
    allergies: optional(patient.allergies),
    chronic_conditions: optional(patient.chronicConditions),
    current_medications: optional(patient.currentMedications),
    family_medical_history: optional(patient.familyMedicalHistory),
    past_surgeries: optional(patient.pastSurgeries),
    disability_status: optional(patient.disabilityStatus),
    pregnancy_status: optional(patient.pregnancyStatus),
    emergency_contact_name: patient.emergencyContactName ?? '',
    emergency_relationship: patient.emergencyRelationship ?? '',
    emergency_phone: patient.emergencyPhone ?? '',
    emergency_address: optional(patient.emergencyAddress),
    insurance_provider: optional(patient.insuranceProvider),
    insurance_policy_number: optional(patient.insurancePolicyNumber),
    insurance_expiry_date: optional(patient.insuranceExpiryDate),
    insurance_type: optional(patient.insuranceType),
    nfc_card_id: optional(patient.nfcCardId),
    nfc_active: patient.nfcActive ?? false,
    status: patient.status ?? 'active',
    tags: patient.tags ?? [],
    department: optional(patient.department),
    doctor_assigned: optional(patient.doctorAssigned),
    admission_status: optional(patient.admissionStatus),
  };
}

/** Escapes a value for use inside a PostgREST `or()` filter. */
const orValue = (value: string) => `"${value.replace(/["\\]/g, (char) => `\\${char}`)}"`;

function isoDateYearsAgo(years: number) {
  const date = new Date();
  date.setFullYear(date.getFullYear() - years);
  return date.toISOString().slice(0, 10);
}

export async function queryPatientsRemote(input: PatientQueryInput): Promise<ServerPageResult> {
  let query = requireSupabase()
    .from('patients')
    .select('*', { count: 'exact' })
    .eq('organization_id', input.tenantId);

  const needle = input.query.trim();
  if (needle) {
    const like = orValue(`%${needle}%`);
    const terms = [`first_name.ilike.${like}`, `last_name.ilike.${like}`, `switch_id.ilike.${like}`, `phone.ilike.${like}`];
    const [first, ...rest] = needle.split(/\s+/);
    if (rest.length > 0) {
      // "Ada Obi" should match first + last name together.
      terms.push(`and(first_name.ilike.${orValue(`%${first}%`)},last_name.ilike.${orValue(`%${rest.join(' ')}%`)})`);
    }
    query = query.or(terms.join(','));
  }

  const { filters } = input;
  if (filters.gender.length) query = query.in('gender', filters.gender);
  if (filters.status.length) query = query.in('status', filters.status);
  // age >= min  <=>  born on or before today - min years
  if (filters.ageMin) query = query.lte('date_of_birth', isoDateYearsAgo(Number(filters.ageMin)));
  if (filters.ageMax) query = query.gt('date_of_birth', isoDateYearsAgo(Number(filters.ageMax) + 1));
  if (filters.department) query = query.ilike('department', `%${filters.department}%`);
  if (filters.doctorAssigned) query = query.ilike('doctor_assigned', `%${filters.doctorAssigned}%`);
  if (filters.admissionStatus) query = query.ilike('admission_status', `%${filters.admissionStatus}%`);
  if (filters.chronicCondition) query = query.ilike('chronic_conditions', `%${filters.chronicCondition}%`);
  if (filters.insuranceProvider) query = query.ilike('insurance_provider', `%${filters.insuranceProvider}%`);
  if (filters.dateRegistered) {
    const start = new Date(`${filters.dateRegistered}T00:00:00`);
    const end = new Date(start.getTime() + 86_400_000);
    query = query.gte('created_at', start.toISOString()).lt('created_at', end.toISOString());
  }

  const ascending = input.sortOrder === 'asc';
  if (input.sortBy === 'name') query = query.order('first_name', { ascending }).order('last_name', { ascending });
  else if (input.sortBy === 'switchId') query = query.order('switch_id', { ascending });
  else if (input.sortBy === 'phone') query = query.order('phone', { ascending });
  else query = query.order('created_at', { ascending });

  const from = (input.page - 1) * input.pageSize;
  const { data, error, count } = await query.range(from, from + input.pageSize - 1);
  if (error) throw error;
  return { rows: (data as PatientRow[]).map(fromRow), total: count ?? 0 };
}

async function findDuplicate(patient: NewPatient): Promise<PatientRow | null> {
  const terms = [`phone.eq.${orValue(patient.phone.trim())}`];
  if (patient.email?.trim()) terms.push(`email.ilike.${orValue(patient.email.trim())}`);
  terms.push(
    `and(first_name.ilike.${orValue(patient.firstName.trim())},last_name.ilike.${orValue(patient.lastName.trim())},date_of_birth.eq.${patient.dateOfBirth})`,
  );
  const { data, error } = await requireSupabase()
    .from('patients')
    .select('*')
    .eq('organization_id', patient.tenantId)
    .or(terms.join(','))
    .limit(1);
  if (error) throw error;
  return (data?.[0] as PatientRow | undefined) ?? null;
}

export async function createPatientRemote(patient: NewPatient): Promise<RegistryPatient> {
  const duplicate = await findDuplicate(patient);
  if (duplicate) throw new Error(`Duplicate detected with ${BRAND.patientIdLabel} ${duplicate.switch_id}`);
  const { data, error } = await requireSupabase().from('patients').insert(toInsert(patient)).select('*').single();
  if (error) {
    if (error.code === '42501') throw new Error('Your role cannot register patients in this workspace.');
    if (error.code === '23505' && error.message.includes('nfc_card_id')) throw new Error('That NFC card is already assigned to another patient.');
    throw error;
  }
  return fromRow(data as PatientRow);
}

/** The active workspace's id, as the app stores it after sign-in. */
function activeOrganizationId(): string | undefined {
  try {
    return (JSON.parse(localStorage.getItem('vitalink-active-organization') ?? 'null') as { id?: string } | null)?.id;
  } catch {
    return undefined;
  }
}

// A VitaLink ID is unique per workspace (it follows a patient transferred over the
// VitaLink Network), so always look it up within one workspace.
export async function getPatientBySwitchIdRemote(switchId: string, organizationId?: string): Promise<RegistryPatient | null> {
  const orgId = organizationId ?? activeOrganizationId();
  let query = requireSupabase().from('patients').select('*').eq('switch_id', switchId);
  if (orgId) query = query.eq('organization_id', orgId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as PatientRow) : null;
}

export async function listAllPatientsRemote(tenantId: string): Promise<RegistryPatient[]> {
  const pageSize = 1000;
  const rows: RegistryPatient[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await requireSupabase()
      .from('patients')
      .select('*')
      .eq('organization_id', tenantId)
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data as PatientRow[]).map(fromRow));
    if (!data || data.length < pageSize) return rows;
  }
}

export interface PatientSummary {
  total: number;
  active: number;
  inpatient: number;
  withNfc: number;
}

export async function getPatientSummaryRemote(tenantId: string): Promise<PatientSummary> {
  const db = requireSupabase();
  const count = async (apply: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    const { count: value, error } = await apply(base());
    if (error) throw error;
    return value ?? 0;
  };
  function base() {
    return db.from('patients').select('id', { count: 'exact', head: true }).eq('organization_id', tenantId);
  }
  const [total, active, inpatient, withNfc] = await Promise.all([
    count((q) => q),
    count((q) => q.eq('status', 'active')),
    count((q) => q.eq('status', 'inpatient')),
    count((q) => q.eq('nfc_active', true)),
  ]);
  return { total, active, inpatient, withNfc };
}
