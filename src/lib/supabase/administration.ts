// Administration page data: departments, facility settings and their audit trail.
// Figures come from administration_overview(), computed from the workspace's own
// staff, appointments and payments; every change goes through an audited RPC.
import { requireSupabase } from './client';

export interface WorkingDay { day: number; open: string; close: string; closed: boolean }

export interface DepartmentStaff { membershipId: string; name: string; email: string | null; role: string; acceptsAppointments?: boolean }

export interface AdminActivity { id: number; action: string; summary: string; at: string; actor: string | null }

export interface AdminDepartment {
  id: string;
  name: string;
  code: string;
  description: string;
  location: string;
  headMembershipId: string | null;
  workingHours: WorkingDay[];
  linkedServices: string[];
  rooms: number;
  equipment: number;
  beds: number;
  isActive: boolean;
  createdAt: string;
  staff: DepartmentStaff[];
  staffCount: number;
  /** Bookable appointments per day from the schedules of staff who take appointments. */
  dailyCapacity: number;
  performance: {
    appointments: number; completed: number; noShow: number; patients: number;
    revenue: number; avgWaitMin: number | null; bookedToday: number; upcoming: number;
  };
  activity: AdminActivity[];
}

export interface FacilityProfile {
  id: string;
  name: string;
  slug: string;
  address: string;
  state: string;
  country: string;
  contactEmail: string;
  contactPhone: string;
  website: string;
  organizationType: string;
  joinedNetwork: boolean;
  createdAt: string;
  maxPatientsPerDay: number | null;
  appointmentBufferMinutes: number;
  emergency24x7: boolean;
  bookedToday: number;
}

export interface StaffTransfer { id: number; at: string; staffName: string; from: string; to: string; actor: string | null }

export interface AdministrationOverview {
  facility: FacilityProfile;
  staff: Array<DepartmentStaff & { department: string | null }>;
  departments: AdminDepartment[];
  unassignedStaff: number;
  transfers: StaffTransfer[];
  auditLog: AdminActivity[];
}

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v == null ? '' : String(v));

export async function getAdministrationOverview(organizationId: string, days = 30): Promise<AdministrationOverview> {
  const { data, error } = await requireSupabase().rpc('administration_overview', { p_organization_id: organizationId, p_days: days });
  if (error) throw new Error(error.message);
  const r = data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const f = r.facility ?? {};
  return {
    facility: {
      id: str(f.id), name: str(f.name), slug: str(f.slug), address: str(f.address), state: str(f.state), country: str(f.country),
      contactEmail: str(f.contactEmail), contactPhone: str(f.contactPhone), website: str(f.website),
      organizationType: str(f.organizationType), joinedNetwork: Boolean(f.joinedNetwork), createdAt: str(f.createdAt),
      maxPatientsPerDay: f.maxPatientsPerDay == null ? null : num(f.maxPatientsPerDay),
      appointmentBufferMinutes: num(f.appointmentBufferMinutes), emergency24x7: Boolean(f.emergency24x7), bookedToday: num(f.bookedToday),
    },
    staff: r.staff ?? [],
    departments: (r.departments ?? []).map((d: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      id: d.id, name: d.name, code: d.code, description: str(d.description), location: str(d.location),
      headMembershipId: d.headMembershipId ?? null,
      workingHours: [...(d.workingHours ?? [])].sort((a: WorkingDay, b: WorkingDay) => a.day - b.day),
      linkedServices: d.linkedServices ?? [], rooms: num(d.rooms), equipment: num(d.equipment), beds: num(d.beds),
      isActive: Boolean(d.isActive), createdAt: d.createdAt, staff: d.staff ?? [], staffCount: num(d.staffCount),
      dailyCapacity: num(d.dailyCapacity),
      performance: {
        appointments: num(d.performance?.appointments), completed: num(d.performance?.completed), noShow: num(d.performance?.noShow),
        patients: num(d.performance?.patients), revenue: num(d.performance?.revenueKobo) / 100,
        avgWaitMin: d.performance?.avgWaitMin == null ? null : num(d.performance.avgWaitMin),
        bookedToday: num(d.performance?.bookedToday), upcoming: num(d.performance?.upcoming),
      },
      activity: d.activity ?? [],
    })),
    unassignedStaff: num(r.unassignedStaff),
    transfers: r.transfers ?? [],
    auditLog: r.auditLog ?? [],
  };
}

export interface DepartmentInput {
  name: string;
  code: string;
  description: string;
  location: string;
  headMembershipId: string | null;
  workingHours: WorkingDay[];
  linkedServices: string[];
  rooms: number;
  equipment: number;
  beds: number;
  isActive: boolean;
}

/** Creates a department when id is null; returns its id. */
export async function saveDepartment(organizationId: string, id: string | null, input: DepartmentInput): Promise<string> {
  const { data, error } = await requireSupabase().rpc('department_save', {
    p_organization_id: organizationId, p_id: id, p_name: input.name, p_code: input.code, p_description: input.description,
    p_location: input.location, p_head_membership_id: input.headMembershipId, p_working_hours: input.workingHours,
    p_linked_services: input.linkedServices, p_rooms: input.rooms, p_equipment: input.equipment, p_beds: input.beds,
    p_is_active: input.isActive,
  });
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/** Puts staff in a department, moving them out of any other one (logged as a transfer). */
export async function assignStaffToDepartment(departmentId: string, membershipIds: string[]): Promise<number> {
  const { data, error } = await requireSupabase().rpc('department_assign_staff', { p_department_id: departmentId, p_membership_ids: membershipIds });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function removeStaffFromDepartment(departmentId: string, membershipId: string): Promise<void> {
  const { error } = await requireSupabase().rpc('department_remove_staff', { p_department_id: departmentId, p_membership_id: membershipId });
  if (error) throw new Error(error.message);
}

export async function deleteDepartment(departmentId: string): Promise<void> {
  const { error } = await requireSupabase().rpc('department_delete', { p_department_id: departmentId });
  if (error) throw new Error(error.message);
}

export interface FacilityInput {
  name: string;
  address: string;
  state: string;
  contactPhone: string;
  contactEmail: string;
  website: string;
  maxPatientsPerDay: number | null;
  appointmentBufferMinutes: number;
  emergency24x7: boolean;
}

export async function saveFacility(organizationId: string, input: FacilityInput): Promise<void> {
  const { error } = await requireSupabase().rpc('facility_save', {
    p_organization_id: organizationId, p_name: input.name, p_address: input.address, p_state: input.state,
    p_contact_phone: input.contactPhone, p_contact_email: input.contactEmail, p_website: input.website,
    p_max_patients_per_day: input.maxPatientsPerDay, p_appointment_buffer_minutes: input.appointmentBufferMinutes,
    p_emergency_24x7: input.emergency24x7,
  });
  if (error) throw new Error(error.message);
}

/** Department names in the workspace, for pickers elsewhere (staff, invitations). */
export async function listDepartmentNames(organizationId: string): Promise<string[]> {
  const { data, error } = await requireSupabase()
    .from('departments').select('name').eq('organization_id', organizationId).eq('is_active', true).order('name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.name as string);
}
