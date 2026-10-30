import { BRAND, formatBrandId } from '@/config/brand';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import {
  createPatientRemote,
  getPatientBySwitchIdRemote,
  getPatientSummaryRemote,
  listAllPatientsRemote,
  queryPatientsRemote,
  type PatientSummary,
} from '@/lib/supabase/patients';

export type PatientStatus = 'active' | 'inpatient' | 'outpatient' | 'discharged' | 'referred';

export type PatientTag = 'vip' | 'high-risk' | 'chronic-care' | 'pediatric' | 'geriatric';

export interface RegistryPatient {
  id: string;
  tenantId: string;
  switchId: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  dateOfBirth: string;
  gender: 'male' | 'female' | 'other';
  phone: string;
  email?: string;
  address: string;
  state: string;
  country: string;
  maritalStatus?: string;
  occupation?: string;
  nationalId?: string;
  profilePhoto?: string;
  bloodGroup?: string;
  genotype?: string;
  allergies?: string;
  chronicConditions?: string;
  currentMedications?: string;
  familyMedicalHistory?: string;
  pastSurgeries?: string;
  disabilityStatus?: string;
  pregnancyStatus?: string;
  emergencyContactName: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  emergencyAddress?: string;
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
  insuranceExpiryDate?: string;
  insuranceType?: string;
  nfcCardId?: string;
  nfcActive: boolean;
  status: PatientStatus;
  tags: PatientTag[];
  documents: string[];
  timeline: string[];
  doctorAssigned?: string;
  department?: string;
  admissionStatus?: string;
  /** Number from the patient's old card, folder or previous system (OP001, MRN, file no.). */
  previousNumber?: string;
  /** Date of birth worked out from an age, not written down. */
  dobEstimated?: boolean;
  insuranceProviderFilter?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

const STORAGE_KEY = 'vitalink-patient-registry-v1';
const PATIENT_ID_COUNTER_KEY = 'vitalink-patient-id-counters-v1';

const starterPatients: RegistryPatient[] = [
  {
    id: 'pt_1',
    tenantId: 'lagos-central-hospital',
    switchId: 'VL-2026-000245',
    firstName: 'Adebayo',
    middleName: 'Kunle',
    lastName: 'Johnson',
    dateOfBirth: '1981-03-12',
    gender: 'male',
    phone: '+2348012345678',
    email: 'adebayo.j@email.com',
    address: '24 Broad Street',
    state: 'Lagos',
    country: 'Nigeria',
    emergencyContactName: 'Tosin Johnson',
    emergencyRelationship: 'Spouse',
    emergencyPhone: '+2348080011100',
    nfcCardId: 'VLC-88912',
    nfcActive: true,
    status: 'active',
    tags: ['chronic-care'],
    documents: ['Lab: HbA1c Q1'],
    timeline: ['Visit - Cardiology follow up', 'Prescription - Metformin refill'],
    department: 'Cardiology',
    doctorAssigned: 'Dr. Sarah Johnson',
    admissionStatus: 'Outpatient',
    insuranceProvider: 'National Health Insurance Scheme',
    insuranceProviderFilter: 'NHIS',
    createdAt: '2026-02-20T10:22:00.000Z',
    updatedAt: '2026-03-22T08:14:00.000Z',
    createdBy: 'system',
    updatedBy: 'system',
  },
];

const randomLatency = () => 350 + Math.round(Math.random() * 500);

function getCounterMap(): Record<string, number> {
  const raw = localStorage.getItem(PATIENT_ID_COUNTER_KEY);
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

function saveCounterMap(map: Record<string, number>) {
  localStorage.setItem(PATIENT_ID_COUNTER_KEY, JSON.stringify(map));
}

export function getPatients(): RegistryPatient[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(starterPatients));
    return starterPatients;
  }
  try {
    return JSON.parse(raw) as RegistryPatient[];
  } catch {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(starterPatients));
    return starterPatients;
  }
}

export function savePatients(patients: RegistryPatient[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(patients));
}

export async function generateSwitchId(tenantId: string): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, randomLatency()));
  const year = new Date().getFullYear();
  const counterKey = `${tenantId}-${year}`;
  const map = getCounterMap();
  const next = (map[counterKey] ?? 0) + 1;
  map[counterKey] = next;
  saveCounterMap(map);
  return formatBrandId('patient', next, year);
}

export function detectDuplicate(
  tenantId: string,
  payload: Pick<RegistryPatient, 'phone' | 'email' | 'firstName' | 'lastName' | 'dateOfBirth'>,
): RegistryPatient | null {
  const patients = getPatients();
  return (
    patients.find((patient) => {
      if (patient.tenantId !== tenantId) {
        return false;
      }
      const exactPhone = patient.phone === payload.phone;
      const exactEmail = payload.email && patient.email && patient.email.toLowerCase() === payload.email.toLowerCase();
      const probableSamePerson =
        patient.firstName.toLowerCase() === payload.firstName.toLowerCase() &&
        patient.lastName.toLowerCase() === payload.lastName.toLowerCase() &&
        patient.dateOfBirth === payload.dateOfBirth;
      return exactPhone || Boolean(exactEmail) || probableSamePerson;
    }) ?? null
  );
}

export async function createPatient(
  creator: string,
  patient: Omit<RegistryPatient, 'id' | 'switchId' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy'>,
): Promise<RegistryPatient> {
  if (isSupabaseConfigured) return createPatientRemote(patient);
  await new Promise((resolve) => setTimeout(resolve, randomLatency()));
  const duplicate = detectDuplicate(patient.tenantId, patient);
  if (duplicate) {
    throw new Error(`Duplicate detected with ${BRAND.patientIdLabel} ${duplicate.switchId}`);
  }

  const switchId = await generateSwitchId(patient.tenantId);
  const now = new Date().toISOString();
  const newPatient: RegistryPatient = {
    ...patient,
    id: `pt_${crypto.randomUUID()}`,
    switchId,
    createdAt: now,
    updatedAt: now,
    createdBy: creator,
    updatedBy: creator,
  };

  const all = getPatients();
  savePatients([newPatient, ...all]);
  return newPatient;
}

export interface ServerPageResult {
  rows: RegistryPatient[];
  total: number;
}

export interface PatientQueryInput {
  tenantId: string;
  page: number;
  pageSize: number;
  query: string;
  sortBy: 'createdAt' | 'switchId' | 'name' | 'phone';
  sortOrder: 'asc' | 'desc';
  filters: {
    gender: string[];
    status: string[];
    ageMin: string;
    ageMax: string;
    department: string;
    doctorAssigned: string;
    admissionStatus: string;
    chronicCondition: string;
    dateRegistered: string;
    insuranceProvider: string;
  };
}

const QUERY_CACHE_TTL_MS = 12_000;
const queryCache = new Map<string, { expiresAt: number; value: ServerPageResult }>();

function getQueryCacheKey(input: PatientQueryInput) {
  return JSON.stringify(input);
}

export function getPatientBySwitchId(switchId: string, tenantId?: string) {
  const patients = getPatients();
  return patients.find((patient) => patient.switchId === switchId && (tenantId ? patient.tenantId === tenantId : true)) ?? null;
}

export function getPatientById(id: string, tenantId?: string) {
  const patients = getPatients();
  return patients.find((patient) => patient.id === id && (tenantId ? patient.tenantId === tenantId : true)) ?? null;
}

export async function queryPatients(input: PatientQueryInput): Promise<ServerPageResult> {
  if (isSupabaseConfigured) return queryPatientsRemote(input);
  const key = getQueryCacheKey(input);
  const now = Date.now();
  const cached = queryCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  await new Promise((resolve) => setTimeout(resolve, randomLatency()));
  const needle = input.query.toLowerCase();
  const all = getPatients().filter((patient) => patient.tenantId === input.tenantId);
  const indexed = all.filter((patient) => {
    const age = getAge(patient.dateOfBirth);
    const matchesNeedle =
      `${patient.firstName} ${patient.lastName}`.toLowerCase().includes(needle) ||
      patient.switchId.toLowerCase().includes(needle) ||
      patient.phone.toLowerCase().includes(needle);
    const matchesGender = input.filters.gender.length === 0 || input.filters.gender.includes(patient.gender);
    const matchesStatus = input.filters.status.length === 0 || input.filters.status.includes(patient.status);
    const withinMin = input.filters.ageMin ? age >= Number(input.filters.ageMin) : true;
    const withinMax = input.filters.ageMax ? age <= Number(input.filters.ageMax) : true;
    const dept = input.filters.department ? (patient.department ?? '').toLowerCase().includes(input.filters.department.toLowerCase()) : true;
    const doctor = input.filters.doctorAssigned ? (patient.doctorAssigned ?? '').toLowerCase().includes(input.filters.doctorAssigned.toLowerCase()) : true;
    const admission = input.filters.admissionStatus ? (patient.admissionStatus ?? '').toLowerCase().includes(input.filters.admissionStatus.toLowerCase()) : true;
    const chronic = input.filters.chronicCondition ? (patient.chronicConditions ?? '').toLowerCase().includes(input.filters.chronicCondition.toLowerCase()) : true;
    const dateRegistered = input.filters.dateRegistered ? patient.createdAt.slice(0, 10) === input.filters.dateRegistered : true;
    const insurance = input.filters.insuranceProvider
      ? (patient.insuranceProviderFilter ?? '').toLowerCase().includes(input.filters.insuranceProvider.toLowerCase())
      : true;
    return matchesNeedle && matchesGender && matchesStatus && withinMin && withinMax && dept && doctor && admission && chronic && dateRegistered && insurance;
  });

  indexed.sort((a, b) => {
    const order = input.sortOrder === 'asc' ? 1 : -1;
    if (input.sortBy === 'switchId') {
      return a.switchId.localeCompare(b.switchId) * order;
    }
    if (input.sortBy === 'phone') {
      return a.phone.localeCompare(b.phone) * order;
    }
    if (input.sortBy === 'name') {
      return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`) * order;
    }
    return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * order;
  });

  const start = (input.page - 1) * input.pageSize;
  const value = {
    rows: indexed.slice(start, start + input.pageSize),
    total: indexed.length,
  };
  queryCache.set(key, { value, expiresAt: now + QUERY_CACHE_TTL_MS });
  return value;
}

export async function findPatientBySwitchId(switchId: string, tenantId?: string): Promise<RegistryPatient | null> {
  if (isSupabaseConfigured) return getPatientBySwitchIdRemote(switchId, tenantId);
  return getPatientBySwitchId(switchId, tenantId);
}

export async function listTenantPatients(tenantId: string): Promise<RegistryPatient[]> {
  if (isSupabaseConfigured) return listAllPatientsRemote(tenantId);
  return getPatients().filter((patient) => patient.tenantId === tenantId);
}

export type { PatientSummary };

export async function getPatientSummary(tenantId: string): Promise<PatientSummary> {
  if (isSupabaseConfigured) return getPatientSummaryRemote(tenantId);
  const rows = getPatients().filter((patient) => patient.tenantId === tenantId);
  return {
    total: rows.length,
    active: rows.filter((patient) => patient.status === 'active').length,
    inpatient: rows.filter((patient) => patient.status === 'inpatient').length,
    withNfc: rows.filter((patient) => patient.nfcActive).length,
  };
}

export async function fetchPatientsPage(
  tenantId: string,
  page: number,
  pageSize: number,
  rows: RegistryPatient[],
): Promise<ServerPageResult> {
  await new Promise((resolve) => setTimeout(resolve, randomLatency()));
  const tenantRows = rows.filter((patient) => patient.tenantId === tenantId);
  const start = (page - 1) * pageSize;
  return {
    rows: tenantRows.slice(start, start + pageSize),
    total: tenantRows.length,
  };
}

export function getAge(dateOfBirth: string) {
  const now = new Date();
  const dob = new Date(dateOfBirth);
  const years = now.getFullYear() - dob.getFullYear();
  const monthOffset = now.getMonth() - dob.getMonth();
  if (monthOffset < 0 || (monthOffset === 0 && now.getDate() < dob.getDate())) {
    return years - 1;
  }
  return years;
}

export function buildCsv(rows: RegistryPatient[]) {
  const headers = [BRAND.patientIdLabel, 'Name', 'Phone', 'Email', 'Gender', 'Status', 'Department', 'Doctor', 'Registered At'];
  const data = rows.map((patient) => [
    patient.switchId,
    `${patient.firstName} ${patient.lastName}`,
    patient.phone,
    patient.email ?? '',
    patient.gender,
    patient.status,
    patient.department ?? '',
    patient.doctorAssigned ?? '',
    patient.createdAt,
  ]);
  return [headers, ...data].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n');
}

export function sampleImportTemplate() {
  return [
    'firstName,lastName,dateOfBirth,gender,phone,email,tenantId,emergencyContactName,emergencyRelationship,emergencyPhone,status',
    'Jane,Doe,1992-11-07,female,+2348000000000,jane@email.com,lagos-central-hospital,John Doe,Brother,+2348000000001,active',
  ].join('\n');
}
