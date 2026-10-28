import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Copy, Mail, RefreshCw, Search, Trash2, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth, type UserRole } from '@/contexts/AuthContext';
import { roleOptionsForOrganizationType } from '@/lib/workspace/roles';
import { listDepartmentNames } from '@/lib/supabase/administration';
import {
  createInvitation,
  inviteLink,
  listInvitations,
  listStaff,
  removeStaff,
  revokeInvitation,
  roleLabel,
  sendInvitationEmail,
  setStaffStatus,
  updateStaffRole,
  updateStaffSchedule,
  type StaffInvitation,
  type StaffMember,
} from '@/lib/supabase/staff';

const ADMIN_ROLES: UserRole[] = ['super-admin', 'hospital-admin', 'ngo-admin', 'government-admin'];
// Suggestions only until the workspace creates its own departments in Administration.
const SUGGESTED_DEPARTMENTS = ['General Medicine', 'Surgery', 'Pediatrics', 'Cardiology', 'Obstetrics & Gynaecology', 'Emergency', 'Laboratory', 'Pharmacy', 'Billing', 'Front Desk', 'Administration'];

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Invite link copied');
  } catch {
    window.prompt('Copy this invite link', text);
  }
}

function invitationState(invite: StaffInvitation): 'accepted' | 'expired' | 'pending' {
  if (invite.accepted) return 'accepted';
  return new Date(invite.expiresAt) <= new Date() ? 'expired' : 'pending';
}

export function StaffManagement() {
  const { organization, currentRole, userEmail } = useAuth();
  const organizationId = organization.id;
  const isAdmin = ADMIN_ROLES.includes(currentRole);
  const roleOptions = useMemo(() => roleOptionsForOrganizationType(organization.organizationType), [organization.organizationType]);

  const [tab, setTab] = useState<'staff' | 'invitations'>('staff');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [invitations, setInvitations] = useState<StaffInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [departments, setDepartments] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'doctor' as UserRole, department: '' });
  const [sending, setSending] = useState(false);
  const [lastInvite, setLastInvite] = useState<{ link: string; sent: boolean; reason?: string; email: string } | null>(null);

  const [scheduleFor, setScheduleFor] = useState<StaffMember | null>(null);
  const [scheduleForm, setScheduleForm] = useState({ department: '', acceptsAppointments: false, workingStart: '08:00', workingEnd: '17:00', breaks: '12:00', maxPerHour: 2 });

  const reload = useCallback(async () => {
    try {
      const [members, invites, departmentNames] = await Promise.all([
        listStaff(organizationId),
        isAdmin ? listInvitations(organizationId) : Promise.resolve([]),
        listDepartmentNames(organizationId).catch(() => [] as string[]),
      ]);
      setStaff(members);
      setInvitations(invites);
      setDepartments(departmentNames);
    } catch (error) {
      toast.error(errorText(error, 'Could not load staff'));
    } finally {
      setLoading(false);
    }
  }, [organizationId, isAdmin]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filteredStaff = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return staff;
    return staff.filter((member) => `${member.fullName} ${member.email} ${member.role} ${member.department}`.toLowerCase().includes(needle));
  }, [staff, search]);

  const pendingInvites = invitations.filter((invite) => invitationState(invite) === 'pending');
  const metrics = [
    { label: 'Total Staff', value: staff.length, tone: 'text-gray-900' },
    { label: 'Active', value: staff.filter((m) => m.status === 'active').length, tone: 'text-green-700' },
    { label: 'Pending Invites', value: pendingInvites.length, tone: 'text-amber-700' },
    { label: 'Suspended', value: staff.filter((m) => m.status === 'suspended').length, tone: 'text-red-700' },
    { label: 'Taking Appointments', value: staff.filter((m) => m.acceptsAppointments && m.status === 'active').length, tone: 'text-indigo-700' },
  ];

  const sendInvite = async () => {
    const email = inviteForm.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Enter a valid email address.');
      return;
    }
    setSending(true);
    try {
      const invite = await createInvitation(organizationId, email, inviteForm.role, inviteForm.department);
      const delivery = await sendInvitationEmail(invite.id).catch((error) => ({ sent: false, link: inviteLink(invite.token), reason: errorText(error, 'Email failed') }));
      setLastInvite({ ...delivery, email: invite.email });
      toast.success(delivery.sent ? `Invitation emailed to ${invite.email}` : 'Invitation created — share the link');
      setInviteForm((form) => ({ ...form, email: '' }));
      void reload();
    } catch (error) {
      toast.error(errorText(error, 'Could not create the invitation'));
    } finally {
      setSending(false);
    }
  };

  const resend = async (invite: StaffInvitation) => {
    try {
      const delivery = await sendInvitationEmail(invite.id);
      if (delivery.sent) toast.success(`Invitation re-sent to ${invite.email}`);
      else {
        toast.info(delivery.reason ?? 'Email is not configured; link copied instead.');
        await copyText(delivery.link);
      }
    } catch (error) {
      toast.error(errorText(error, 'Could not resend'));
    }
  };

  const revoke = async (invite: StaffInvitation) => {
    if (!window.confirm(`Revoke the invitation for ${invite.email}?`)) return;
    try {
      await revokeInvitation(invite.id);
      toast.success('Invitation revoked');
      void reload();
    } catch (error) {
      toast.error(errorText(error, 'Could not revoke'));
    }
  };

  const changeRole = async (member: StaffMember, role: UserRole) => {
    try {
      await updateStaffRole(member.membershipId, role);
      toast.success(`${member.fullName} is now ${roleLabel(role)}`);
      void reload();
    } catch (error) {
      toast.error(errorText(error, 'Could not change role'));
    }
  };

  const toggleSuspend = async (member: StaffMember) => {
    const next = member.status === 'suspended' ? 'active' : 'suspended';
    if (next === 'suspended' && !window.confirm(`Suspend ${member.fullName}? They lose access to this workspace until reactivated.`)) return;
    try {
      await setStaffStatus(member.membershipId, next);
      toast.success(next === 'suspended' ? 'Staff member suspended' : 'Staff member reactivated');
      void reload();
    } catch (error) {
      toast.error(errorText(error, 'Could not update status'));
    }
  };

  const remove = async (member: StaffMember) => {
    if (!window.confirm(`Remove ${member.fullName} from ${organization.name}? Their records stay; they lose access.`)) return;
    try {
      await removeStaff(member.membershipId);
      toast.success('Staff member removed');
      void reload();
    } catch (error) {
      toast.error(errorText(error, 'Could not remove'));
    }
  };

  const openSchedule = (member: StaffMember) => {
    setScheduleFor(member);
    setScheduleForm({
      department: member.department,
      acceptsAppointments: member.acceptsAppointments,
      workingStart: member.workingStart,
      workingEnd: member.workingEnd,
      breaks: member.breakTimes.join(', '),
      maxPerHour: member.maxPerHour,
    });
  };

  const saveSchedule = async () => {
    if (!scheduleFor) return;
    try {
      await updateStaffSchedule(scheduleFor.membershipId, {
        department: scheduleForm.department,
        acceptsAppointments: scheduleForm.acceptsAppointments,
        workingStart: scheduleForm.workingStart,
        workingEnd: scheduleForm.workingEnd,
        breakTimes: scheduleForm.breaks.split(',').map((time) => time.trim()).filter(Boolean),
        maxPerHour: Number(scheduleForm.maxPerHour) || 1,
      });
      toast.success('Schedule saved');
      setScheduleFor(null);
      void reload();
    } catch (error) {
      toast.error(errorText(error, 'Could not save the schedule'));
    }
  };

  const isSelf = (member: StaffMember) => member.email.toLowerCase() === userEmail.toLowerCase();

  return (
    <div className="space-y-4 md:space-y-6 page-transition">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#1E4ED8]">Human Resources</h1>
          <p className="mt-1 text-sm text-gray-500">Staff, roles and clinic schedules for {organization.name}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2 rounded-xl" onClick={() => void reload()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button data-tour-id="staff-invite" className="gap-2 rounded-xl bg-gradient-to-r from-royal-500 to-royal-700 text-white" disabled={!isAdmin} onClick={() => { setLastInvite(null); setInviteOpen(true); }}>
            <UserPlus className="h-4 w-4" />
            Invite Staff
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {metrics.map((metric) => (
          <div key={metric.label} className="premium-card p-4">
            <p className="text-xs uppercase tracking-wide text-gray-500">{metric.label}</p>
            <p className={cn('mt-1 text-2xl font-bold', metric.tone)}>{metric.value}</p>
          </div>
        ))}
      </div>

      <div data-tour-id="staff-tabs" className="flex w-fit gap-2 rounded-xl bg-gray-100 p-1">
        {([
          { id: 'staff', label: 'Staff Directory', icon: Users },
          ...(isAdmin ? [{ id: 'invitations', label: `Invitations${pendingInvites.length ? ` (${pendingInvites.length})` : ''}`, icon: Mail }] : []),
        ] as { id: 'staff' | 'invitations'; label: string; icon: typeof Users }[]).map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={cn('flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all', tab === item.id ? 'bg-white text-royal-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'staff' && (
        <>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input placeholder="Search name, email, role, department..." value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-xl bg-white/80 pl-10" />
          </div>
          <div className="premium-card overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Schedule</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td className="px-4 py-6 text-gray-500" colSpan={6}>Loading staff…</td></tr> : null}
                {!loading && filteredStaff.length === 0 ? <tr><td className="px-4 py-6 text-gray-500" colSpan={6}>No staff match.</td></tr> : null}
                {filteredStaff.map((member) => (
                  <tr key={member.membershipId} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{member.fullName}{isSelf(member) ? ' (you)' : ''}</p>
                      <p className="text-xs text-gray-500">{member.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin && !isSelf(member) ? (
                        <select className="rounded-md border border-input bg-white px-2 py-1 text-sm" value={member.role} onChange={(e) => void changeRole(member, e.target.value as UserRole)}>
                          {[...new Set([member.role, ...roleOptions])].map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                        </select>
                      ) : roleLabel(member.role)}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{member.department || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {member.acceptsAppointments
                        ? <span>{member.workingStart}–{member.workingEnd} · {member.maxPerHour}/hr{member.breakTimes.length ? ` · break ${member.breakTimes.join(', ')}` : ''}</span>
                        : <span className="text-gray-400">No appointments</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium capitalize', member.status === 'active' ? 'bg-green-100 text-green-700' : member.status === 'suspended' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>{member.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {(isAdmin || isSelf(member)) && (
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => openSchedule(member)}>
                            <CalendarClock className="h-3.5 w-3.5" />
                            Schedule
                          </Button>
                        )}
                        {isAdmin && !isSelf(member) && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => void toggleSuspend(member)}>{member.status === 'suspended' ? 'Reactivate' : 'Suspend'}</Button>
                            <Button size="sm" variant="outline" className="text-red-600" onClick={() => void remove(member)}><Trash2 className="h-3.5 w-3.5" /></Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'invitations' && isAdmin && (
        <div className="premium-card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invitations.length === 0 ? <tr><td className="px-4 py-6 text-gray-500" colSpan={6}>No invitations yet. Use “Invite Staff” to add your team.</td></tr> : null}
              {invitations.map((invite) => {
                const state = invitationState(invite);
                return (
                  <tr key={invite.id} className="border-b border-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{invite.email}</td>
                    <td className="px-4 py-3">{roleLabel(invite.role)}</td>
                    <td className="px-4 py-3 text-gray-700">{invite.department || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={cn('rounded-full px-2.5 py-1 text-xs font-medium capitalize', state === 'accepted' ? 'bg-green-100 text-green-700' : state === 'expired' ? 'bg-gray-100 text-gray-600' : 'bg-amber-100 text-amber-700')}>{state}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{state === 'accepted' && invite.acceptedAt ? `Joined ${new Date(invite.acceptedAt).toLocaleDateString()}` : new Date(invite.expiresAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {state === 'pending' && (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => void copyText(inviteLink(invite.token))}><Copy className="h-3.5 w-3.5" />Copy link</Button>
                          <Button size="sm" variant="outline" className="gap-1" onClick={() => void resend(invite)}><Mail className="h-3.5 w-3.5" />Resend</Button>
                          <Button size="sm" variant="outline" className="text-red-600" onClick={() => void revoke(invite)}>Revoke</Button>
                        </div>
                      )}
                      {state === 'expired' && (
                        <div className="flex justify-end">
                          <Button size="sm" variant="outline" onClick={() => void revoke(invite)}>Remove</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="glass-panel max-w-lg border-white/60">
          <DialogHeader>
            <DialogTitle>Invite staff</DialogTitle>
            <DialogDescription>They join {organization.name} with this role once they sign in with the invited email.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Work email</Label>
              <Input type="email" placeholder="name@hospital.com" value={inviteForm.email} onChange={(e) => setInviteForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Role</Label>
                <select className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm" value={inviteForm.role} onChange={(e) => setInviteForm((f) => ({ ...f, role: e.target.value as UserRole }))}>
                  {roleOptions.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                </select>
              </div>
              <div>
                <Label>Department</Label>
                <DepartmentPicker departments={departments} value={inviteForm.department} onChange={(department) => setInviteForm((f) => ({ ...f, department }))} />
              </div>
            </div>
            {lastInvite && (
              <div className={cn('rounded-xl border p-3 text-sm', lastInvite.sent ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-900')}>
                <p className="font-medium">{lastInvite.sent ? `Email sent to ${lastInvite.email}.` : `Invitation for ${lastInvite.email} is ready to share.`}</p>
                {!lastInvite.sent && lastInvite.reason ? <p className="mt-1 text-xs">{lastInvite.reason}</p> : null}
                <div className="mt-2 flex gap-2">
                  <Input readOnly value={lastInvite.link} className="text-xs" />
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => void copyText(lastInvite.link)}><Copy className="h-3.5 w-3.5" />Copy</Button>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)}>Close</Button>
            <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white" disabled={sending} onClick={() => void sendInvite()}>
              {sending ? 'Sending…' : 'Send invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(scheduleFor)} onOpenChange={(open) => !open && setScheduleFor(null)}>
        <DialogContent className="glass-panel max-w-lg border-white/60">
          <DialogHeader>
            <DialogTitle>Schedule — {scheduleFor?.fullName}</DialogTitle>
            <DialogDescription>Used to check availability when appointments are booked.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Department</Label>
              <DepartmentPicker departments={departments} value={scheduleForm.department} onChange={(department) => setScheduleForm((f) => ({ ...f, department }))} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={scheduleForm.acceptsAppointments} onChange={(e) => setScheduleForm((f) => ({ ...f, acceptsAppointments: e.target.checked }))} />
              Takes patient appointments
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Shift starts</Label>
                <Input type="time" value={scheduleForm.workingStart} onChange={(e) => setScheduleForm((f) => ({ ...f, workingStart: e.target.value }))} />
              </div>
              <div>
                <Label>Shift ends</Label>
                <Input type="time" value={scheduleForm.workingEnd} onChange={(e) => setScheduleForm((f) => ({ ...f, workingEnd: e.target.value }))} />
              </div>
              <div>
                <Label>Break times</Label>
                <Input placeholder="12:00, 15:30" value={scheduleForm.breaks} onChange={(e) => setScheduleForm((f) => ({ ...f, breaks: e.target.value }))} />
              </div>
              <div>
                <Label>Max patients / hour</Label>
                <Input type="number" min={1} max={20} value={scheduleForm.maxPerHour} onChange={(e) => setScheduleForm((f) => ({ ...f, maxPerHour: Number(e.target.value) }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleFor(null)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white" onClick={() => void saveSchedule()}>Save schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// The workspace's own departments once it has any; free text with suggestions before that.
function DepartmentPicker({ departments, value, onChange }: { departments: string[]; value: string; onChange: (value: string) => void }) {
  if (departments.length === 0) {
    return (
      <>
        <Input list="staff-departments" value={value} onChange={(e) => onChange(e.target.value)} />
        <datalist id="staff-departments">{SUGGESTED_DEPARTMENTS.map((d) => <option key={d} value={d} />)}</datalist>
      </>
    );
  }
  const options = value && !departments.includes(value) ? [value, ...departments] : departments;
  return (
    <select className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">No department</option>
      {options.map((d) => <option key={d} value={d}>{d}</option>)}
    </select>
  );
}
