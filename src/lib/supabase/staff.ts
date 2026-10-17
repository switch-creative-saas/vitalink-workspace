import type { UserRole } from '@/contexts/AuthContext';
import { requireSupabase, functionErrorMessage } from './client';

export interface StaffMember {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string;
  role: UserRole;
  status: 'active' | 'invited' | 'suspended';
  department: string;
  acceptsAppointments: boolean;
  workingStart: string;
  workingEnd: string;
  breakTimes: string[];
  maxPerHour: number;
  joinedAt: string;
}

export interface StaffInvitation {
  id: string;
  email: string;
  role: UserRole;
  department: string;
  token: string;
  accepted: boolean;
  acceptedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface InvitationPreview {
  organizationName: string;
  organizationSlug: string;
  role: UserRole;
  department: string | null;
  email: string;
  expiresAt: string;
  isValid: boolean;
}

export const roleLabel = (role: string) =>
  role.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');

export const inviteLink = (token: string) => `${window.location.origin}/invite?token=${encodeURIComponent(token)}`;

function friendly(error: { code?: string; message: string }, action: string): Error {
  if (error.code === '42501' || error.code === 'PGRST116') return new Error(`Only workspace admins can ${action}.`);
  if (error.code === '23505') return new Error('There is already an open invitation for that email.');
  if (error.code === '23514') return new Error('That role is not valid.');
  return new Error(error.message);
}

const hhmm = (time: string) => time.slice(0, 5);

interface MembershipRow {
  id: string;
  user_id: string;
  role: UserRole;
  status: StaffMember['status'];
  department: string | null;
  accepts_appointments: boolean;
  working_start: string;
  working_end: string;
  break_times: string[];
  max_per_hour: number;
  created_at: string;
  profile: { full_name: string; email: string } | null;
}

export async function listStaff(organizationId: string): Promise<StaffMember[]> {
  const { data, error } = await requireSupabase()
    .from('memberships')
    .select('*, profile:profiles!memberships_user_profile_fk(full_name, email)')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true });
  if (error) throw friendly(error, 'view staff');
  return (data as unknown as MembershipRow[]).map((row) => ({
    membershipId: row.id,
    userId: row.user_id,
    fullName: row.profile?.full_name || row.profile?.email || 'Unnamed',
    email: row.profile?.email ?? '',
    role: row.role,
    status: row.status,
    department: row.department ?? '',
    acceptsAppointments: row.accepts_appointments,
    workingStart: hhmm(row.working_start),
    workingEnd: hhmm(row.working_end),
    breakTimes: row.break_times,
    maxPerHour: row.max_per_hour,
    joinedAt: row.created_at,
  }));
}

export async function updateStaffRole(membershipId: string, role: UserRole) {
  const { error } = await requireSupabase().from('memberships').update({ role }).eq('id', membershipId).select('id').single();
  if (error) throw friendly(error, 'change roles (and not your own)');
}

export async function setStaffStatus(membershipId: string, status: 'active' | 'suspended') {
  const { error } = await requireSupabase().from('memberships').update({ status }).eq('id', membershipId).select('id').single();
  if (error) throw friendly(error, 'suspend or reactivate staff (and not yourself)');
}

export async function removeStaff(membershipId: string) {
  const { error, count } = await requireSupabase().from('memberships').delete({ count: 'exact' }).eq('id', membershipId);
  if (error) throw friendly(error, 'remove staff');
  if (!count) throw new Error('Only workspace admins can remove staff, and you cannot remove yourself.');
}

export async function updateStaffSchedule(
  membershipId: string,
  schedule: Pick<StaffMember, 'department' | 'acceptsAppointments' | 'workingStart' | 'workingEnd' | 'breakTimes' | 'maxPerHour'>,
) {
  const { error } = await requireSupabase().rpc('update_staff_schedule', {
    p_membership_id: membershipId,
    p_department: schedule.department,
    p_accepts_appointments: schedule.acceptsAppointments,
    p_working_start: schedule.workingStart,
    p_working_end: schedule.workingEnd,
    p_break_times: schedule.breakTimes,
    p_max_per_hour: schedule.maxPerHour,
  });
  if (error) throw friendly(error, "change other staff members' schedules");
}

// ---------- invitations ----------

interface InvitationRow {
  id: string;
  email: string;
  role: UserRole;
  department: string | null;
  token: string;
  accepted: boolean;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

const invitationFromRow = (row: InvitationRow): StaffInvitation => ({
  id: row.id,
  email: row.email,
  role: row.role,
  department: row.department ?? '',
  token: row.token,
  accepted: row.accepted,
  acceptedAt: row.accepted_at,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
});

export async function listInvitations(organizationId: string): Promise<StaffInvitation[]> {
  const { data, error } = await requireSupabase()
    .from('staff_invitations')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });
  if (error) throw friendly(error, 'view invitations');
  return (data as InvitationRow[]).map(invitationFromRow);
}

export async function createInvitation(organizationId: string, email: string, role: UserRole, department: string): Promise<StaffInvitation> {
  const { data, error } = await requireSupabase()
    .from('staff_invitations')
    .insert({ organization_id: organizationId, email: email.trim().toLowerCase(), role, department: department.trim() || null })
    .select('*')
    .single();
  if (error) throw friendly(error, 'invite staff');
  return invitationFromRow(data as InvitationRow);
}

export async function revokeInvitation(id: string) {
  const { error } = await requireSupabase().from('staff_invitations').delete().eq('id', id);
  if (error) throw friendly(error, 'revoke invitations');
}

/** Emails the invite when the backend has an email provider; always returns the link. */
export async function sendInvitationEmail(invitationId: string): Promise<{ sent: boolean; link: string; reason?: string }> {
  const { data, error } = await requireSupabase().functions.invoke('send-staff-invite', {
    body: { invitationId, appOrigin: window.location.origin },
  });
  if (error) {
    throw new Error(await functionErrorMessage(error));
  }
  return data as { sent: boolean; link: string; reason?: string };
}

export async function getInvitation(token: string): Promise<InvitationPreview | null> {
  const { data, error } = await requireSupabase().rpc('get_invitation', { p_token: token });
  if (error) throw error;
  const row = (data as Array<{
    organization_name: string; organization_slug: string; role: UserRole; department: string | null;
    email: string; expires_at: string; is_valid: boolean;
  }>)[0];
  if (!row) return null;
  return {
    organizationName: row.organization_name,
    organizationSlug: row.organization_slug,
    role: row.role,
    department: row.department,
    email: row.email,
    expiresAt: row.expires_at,
    isValid: row.is_valid,
  };
}

export async function acceptInvitation(token: string) {
  const { error } = await requireSupabase().rpc('accept_invitation', { p_token: token });
  if (error) throw new Error(error.message);
}
