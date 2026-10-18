// Administration for live workspaces: real departments, staff placement and the
// facility's operating settings. Figures come from administration_overview();
// every change goes through an audited RPC and shows up in the activity logs.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRightLeft, BarChart3, Building2, CalendarClock, ChevronRight, Clock, Edit3, Hospital, Plus,
  RefreshCw, Save, Search, ShieldAlert, Trash2, UserMinus, UserPlus, Users, Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import {
  assignStaffToDepartment, deleteDepartment, getAdministrationOverview, removeStaffFromDepartment, saveDepartment, saveFacility,
  type AdminActivity, type AdminDepartment, type AdministrationOverview, type DepartmentInput, type FacilityInput, type WorkingDay,
} from '@/lib/supabase/administration';

type AdminTab = 'departments' | 'facility';

const ADMIN_ROLES = ['super-admin', 'hospital-admin', 'ngo-admin', 'government-admin'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SERVICES = ['Appointments', 'EMR', 'Laboratory', 'Pharmacy', 'Billing', 'Telemedicine', 'Inpatient', 'Emergency'];
const PERIODS = [{ days: 30, label: '30 days' }, { days: 90, label: '90 days' }, { days: 365, label: '12 months' }];
const SELECT = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

const DEFAULT_HOURS: WorkingDay[] = DAYS.map((_, day) => ({
  day, open: day === 0 || day === 6 ? '09:00' : '08:00', close: day === 0 || day === 6 ? '13:00' : '17:00', closed: day === 0,
}));

const naira = (v: number) => `₦${v.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
const roleLabel = (role: string) => role.split('-').map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ');
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
const codeFrom = (name: string) => {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter(Boolean);
  const code = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 4);
  return code.slice(0, 6);
};

const emptyForm = (): DepartmentInput & { assign: string[] } => ({
  name: '', code: '', description: '', location: '', headMembershipId: null, workingHours: DEFAULT_HOURS,
  linkedServices: ['Appointments', 'EMR'], rooms: 0, equipment: 0, beds: 0, isActive: true, assign: [],
});

export function LiveAdministration() {
  const { organization, currentRole, setActiveOrganization } = useAuth();
  const isAdmin = ADMIN_ROLES.includes(currentRole);
  const [tab, setTab] = useState<AdminTab>('departments');
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AdministrationOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [deptDialog, setDeptDialog] = useState<{ id: string | null } | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignIds, setAssignIds] = useState<string[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transfer, setTransfer] = useState({ membershipId: '', targetId: '' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [facility, setFacility] = useState<FacilityInput | null>(null);
  const [capInput, setCapInput] = useState('');

  const load = useCallback(() => {
    if (!isAdmin) return;
    getAdministrationOverview(organization.id, days)
      .then((result) => {
        setData(result);
        setLoading(false);
        // The facility form restarts from the saved profile on every load.
        const f = result.facility;
        setFacility({
          name: f.name, address: f.address, state: f.state, contactPhone: f.contactPhone, contactEmail: f.contactEmail, website: f.website,
          maxPatientsPerDay: f.maxPatientsPerDay, appointmentBufferMinutes: f.appointmentBufferMinutes, emergency24x7: f.emergency24x7,
        });
        setCapInput(f.maxPatientsPerDay == null ? '' : String(f.maxPatientsPerDay));
        setSelectedId((current) => (current && result.departments.some((d) => d.id === current) ? current : result.departments[0]?.id ?? null));
      })
      .catch((error) => { toast.error(error instanceof Error ? error.message : 'Could not load administration'); setLoading(false); });
  }, [organization.id, days, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const departments = useMemo(() => data?.departments ?? [], [data]);
  const staff = useMemo(() => data?.staff ?? [], [data]);
  const selected = departments.find((d) => d.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return departments.filter((d) =>
      (!needle || d.name.toLowerCase().includes(needle) || d.code.toLowerCase().includes(needle))
      && (statusFilter === 'all' || (statusFilter === 'active' ? d.isActive : !d.isActive)));
  }, [departments, search, statusFilter]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      load();
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Something went wrong');
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="premium-card p-8 text-center page-transition">
        <ShieldAlert className="w-8 h-8 text-gray-400 mx-auto" />
        <h1 className="text-xl font-semibold text-gray-900 mt-3">Administration</h1>
        <p className="text-sm text-gray-500 mt-2">Departments and facility settings are managed by your workspace admins.</p>
      </div>
    );
  }

  const openCreate = () => { setForm(emptyForm()); setDeptDialog({ id: null }); };
  const openEdit = (dept: AdminDepartment) => {
    setForm({
      name: dept.name, code: dept.code, description: dept.description, location: dept.location, headMembershipId: dept.headMembershipId,
      workingHours: dept.workingHours.length === 7 ? dept.workingHours : DEFAULT_HOURS, linkedServices: dept.linkedServices,
      rooms: dept.rooms, equipment: dept.equipment, beds: dept.beds, isActive: dept.isActive, assign: [],
    });
    setDeptDialog({ id: dept.id });
  };

  const submitDepartment = async () => {
    if (!deptDialog) return;
    const editing = deptDialog.id;
    const { assign, ...input } = form;
    const ok = await run(async () => {
      const id = await saveDepartment(organization.id, editing, { ...input, code: input.code || codeFrom(input.name) });
      const toAssign = Array.from(new Set([...assign, ...(input.headMembershipId && !editing ? [input.headMembershipId] : [])]));
      if (toAssign.length) await assignStaffToDepartment(id, toAssign);
      setSelectedId(id);
    }, editing ? 'Department updated' : 'Department created');
    if (ok) setDeptDialog(null);
  };

  const submitAssign = async () => {
    if (!selected || !assignIds.length) return;
    const ok = await run(() => assignStaffToDepartment(selected.id, assignIds), `${assignIds.length === 1 ? 'Staff member' : `${assignIds.length} staff`} added to ${selected.name}`);
    if (ok) { setAssignOpen(false); setAssignIds([]); }
  };

  const submitTransfer = async () => {
    const target = departments.find((d) => d.id === transfer.targetId);
    if (!selected || !target || !transfer.membershipId) { toast.error('Pick a staff member and a department'); return; }
    const ok = await run(() => assignStaffToDepartment(target.id, [transfer.membershipId]), `Moved to ${target.name}`);
    if (ok) { setTransferOpen(false); setTransfer({ membershipId: '', targetId: '' }); }
  };

  const submitFacility = async () => {
    if (!facility) return;
    const cap = capInput.trim() === '' ? null : Number(capInput);
    if (cap !== null && (!Number.isInteger(cap) || cap < 1)) { toast.error('Max patients per day must be a whole number, or blank for no limit'); return; }
    const next = { ...facility, maxPatientsPerDay: cap };
    const ok = await run(() => saveFacility(organization.id, next), 'Facility settings saved');
    if (ok && next.name.trim() !== organization.name) setActiveOrganization({ ...organization, name: next.name.trim() });
  };

  const alerts = selected ? departmentAlerts(selected) : [];
  const deptTransfers = selected ? (data?.transfers ?? []).filter((t) => t.to === selected.name || t.from === selected.name) : [];
  const head = selected?.staff.find((s) => s.membershipId === selected.headMembershipId);
  const otherStaff = selected ? staff.filter((s) => !selected.staff.some((m) => m.membershipId === s.membershipId)) : [];

  return (
    <div className="space-y-4 md:space-y-6 page-transition">
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1E4ED8]">Administration</h1>
          <p className="text-sm text-gray-500 mt-1">Departments, staff placement and operating settings for {organization.name}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Performance period" className="rounded-xl border border-input bg-background px-3 py-2 text-sm" value={days} onChange={(e) => { setLoading(true); setDays(Number(e.target.value)); }}>
            {PERIODS.map((p) => <option key={p.days} value={p.days}>Last {p.label}</option>)}
          </select>
          <Button variant="outline" className="gap-2 rounded-xl" onClick={() => { setLoading(true); load(); }} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            Refresh
          </Button>
          <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white gap-2 rounded-xl" onClick={openCreate}>
            <Plus className="w-4 h-4" />
            Add Department
          </Button>
        </div>
      </div>

      <div className="flex gap-2 p-1 bg-gray-100 rounded-xl w-fit">
        {[
          { id: 'departments' as const, label: 'Departments', icon: Building2 },
          { id: 'facility' as const, label: 'Facility Settings', icon: Hospital },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn('flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium', tab === t.id ? 'bg-white text-royal-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {loading && !data ? (
        <div className="premium-card p-8 text-center text-sm text-gray-500">Loading administration…</div>
      ) : tab === 'departments' ? (
        departments.length === 0 ? (
          <div className="premium-card p-10 text-center">
            <Building2 className="w-10 h-10 text-gray-300 mx-auto" />
            <h3 className="font-semibold text-gray-900 mt-3">No departments yet</h3>
            <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">Create your first department, then place staff in it. Appointments, analytics and the staff list use these departments.</p>
            <Button className="mt-4 bg-gradient-to-r from-royal-500 to-royal-700 text-white rounded-xl gap-2" onClick={openCreate}><Plus className="w-4 h-4" />Add Department</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
            <div className="lg:col-span-4 space-y-4">
              <div className="premium-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Department Directory</h3>
                  <span className="px-2 py-1 rounded-full bg-royal-100 text-royal-700 text-xs font-medium">{filtered.length}</span>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input className="pl-9 rounded-xl" placeholder="Search departments..." value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <select aria-label="Filter by status" className={SELECT} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
                  <option value="all">All departments</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
                {data && data.unassignedStaff > 0 && (
                  <p className="text-xs rounded-lg bg-amber-50 border border-amber-100 text-amber-800 p-2.5">
                    {data.unassignedStaff} staff member{data.unassignedStaff === 1 ? ' is' : 's are'} not in any department.
                  </p>
                )}
              </div>

              <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                {filtered.map((dept) => (
                  <button
                    key={dept.id}
                    onClick={() => setSelectedId(dept.id)}
                    className={cn('w-full text-left premium-card p-4', selectedId === dept.id ? 'ring-2 ring-royal-200 bg-royal-50/60' : '')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-900">{dept.name}</p>
                        <p className="text-xs text-gray-500 mt-1">{dept.code}{dept.location ? ` · ${dept.location}` : ''}</p>
                      </div>
                      <ChevronRight className={cn('w-4 h-4 text-gray-400', selectedId === dept.id && 'rotate-90')} />
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs">
                      <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700">{dept.staffCount} staff</span>
                      <span className={cn('px-2 py-1 rounded-full', dept.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600')}>
                        {dept.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </button>
                ))}
                {filtered.length === 0 && <p className="text-sm text-gray-500 text-center py-6">No departments match.</p>}
              </div>
            </div>

            <div className="lg:col-span-8">
              {!selected ? (
                <div className="premium-card p-8 text-center text-gray-500">Select a department to view details.</div>
              ) : (
                <div className="space-y-4">
                  <div className="premium-card p-5 md:p-6">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-xl font-bold text-gray-900">{selected.name}</h2>
                          <span className="px-2 py-1 rounded-full bg-royal-100 text-royal-700 text-xs">{selected.code}</span>
                          <span className={cn('px-2 py-1 rounded-full text-xs', selected.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600')}>
                            {selected.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 mt-2">{selected.description || 'No description yet.'}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => { setAssignIds([]); setAssignOpen(true); }} disabled={busy}>
                          <UserPlus className="w-4 h-4 mr-2" />Add Staff
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setTransfer({ membershipId: '', targetId: '' }); setTransferOpen(true); }} disabled={busy || selected.staffCount === 0 || departments.length < 2}>
                          <ArrowRightLeft className="w-4 h-4 mr-2" />Transfer Staff
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openEdit(selected)} disabled={busy}>
                          <Edit3 className="w-4 h-4 mr-2" />Edit
                        </Button>
                        <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50" onClick={() => setConfirmDelete(true)} disabled={busy}>
                          <Trash2 className="w-4 h-4 mr-2" />Delete
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    <MetricCard icon={Users} label="Staff" value={selected.staffCount.toLocaleString()} hint={`${selected.staff.filter((s) => s.acceptsAppointments).length} taking appointments`} />
                    <MetricCard icon={CalendarClock} label="Patients seen" value={selected.performance.patients.toLocaleString()} hint={`Last ${PERIODS.find((p) => p.days === days)?.label}`} />
                    <MetricCard icon={BarChart3} label="Appointments" value={selected.performance.appointments.toLocaleString()} hint={`${selected.performance.completed} completed · ${selected.performance.noShow} no-show`} />
                    <MetricCard icon={Wallet} label="Revenue collected" value={naira(selected.performance.revenue)} hint="Payments on this department's visits" />
                  </div>

                  <div className="grid xl:grid-cols-2 gap-4">
                    <div className="premium-card p-5">
                      <h3 className="font-semibold text-gray-900 mb-3">Overview</h3>
                      <div className="space-y-3 text-sm">
                        <Row label="Head of department" value={head?.name ?? 'Not assigned'} />
                        <Row label="Location" value={selected.location || 'Not set'} />
                        <Row label="Average wait" value={selected.performance.avgWaitMin == null ? 'No check-ins yet' : `${selected.performance.avgWaitMin} min`} />
                        <Row label="Booked today" value={selected.dailyCapacity > 0 ? `${selected.performance.bookedToday} of ${selected.dailyCapacity} slots` : String(selected.performance.bookedToday)} />
                        <Row label="Upcoming appointments" value={String(selected.performance.upcoming)} />
                      </div>
                    </div>
                    <div className="premium-card p-5">
                      <h3 className="font-semibold text-gray-900 mb-3">Alerts</h3>
                      <div className="space-y-2">
                        {alerts.length === 0 ? (
                          <p className="text-sm text-green-700 bg-green-50 rounded-xl p-3 border border-green-100">Nothing needs attention in this department.</p>
                        ) : alerts.map((text) => (
                          <div key={text} className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-800 text-sm flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{text}
                          </div>
                        ))}
                      </div>
                      {selected.linkedServices.length > 0 && (
                        <>
                          <p className="text-xs font-medium text-gray-500 mt-4 mb-2">Services</p>
                          <div className="flex flex-wrap gap-2">
                            {selected.linkedServices.map((s) => <span key={s} className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-medium">{s}</span>)}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="grid xl:grid-cols-2 gap-4">
                    <div className="premium-card p-5">
                      <h3 className="font-semibold text-gray-900 mb-3">Staff</h3>
                      <div className="space-y-2">
                        {selected.staff.length === 0 ? (
                          <p className="text-sm text-gray-500">No staff in this department yet.</p>
                        ) : selected.staff.map((member) => (
                          <div key={member.membershipId} className="p-3 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{member.name}</p>
                              <p className="text-xs text-gray-500">{roleLabel(member.role)}{member.acceptsAppointments ? ' · takes appointments' : ''}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {member.membershipId === selected.headMembershipId && <span className="text-xs px-2 py-1 rounded-full bg-royal-100 text-royal-700">Head</span>}
                              <button
                                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"
                                title={`Remove ${member.name} from ${selected.name}`}
                                disabled={busy}
                                onClick={() => run(() => removeStaffFromDepartment(selected.id, member.membershipId), `${member.name} removed from ${selected.name}`)}
                              >
                                <UserMinus className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="premium-card p-5">
                      <h3 className="font-semibold text-gray-900 mb-3">Opening Hours</h3>
                      <div className="space-y-2">
                        {selected.workingHours.map((wh) => (
                          <div key={wh.day} className="p-2.5 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-between text-sm">
                            <span className="font-medium text-gray-700">{DAYS[wh.day]}</span>
                            {wh.closed ? <span className="text-gray-400">Closed</span> : (
                              <span className="text-gray-600 flex items-center gap-1"><Clock className="w-3 h-3" />{wh.open}–{wh.close}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid xl:grid-cols-2 gap-4">
                    <div className="premium-card p-5">
                      <h3 className="font-semibold text-gray-900 mb-3">Resources</h3>
                      <div className="grid grid-cols-3 gap-2">
                        {[['Rooms', selected.rooms], ['Equipment', selected.equipment], ['Beds', selected.beds]].map(([label, value]) => (
                          <div key={label} className="p-3 rounded-xl bg-gray-50 text-center">
                            <p className="text-lg font-bold text-gray-900">{value}</p>
                            <p className="text-xs text-gray-500">{label}</p>
                          </div>
                        ))}
                      </div>
                      <h3 className="font-semibold text-gray-900 mt-5 mb-3">Transfer History</h3>
                      {deptTransfers.length === 0 ? <p className="text-sm text-gray-500">No staff moved in or out yet.</p> : (
                        <div className="space-y-2">
                          {deptTransfers.slice(0, 6).map((t) => (
                            <div key={t.id} className="p-3 rounded-lg bg-gray-50 border border-gray-100 text-sm text-gray-700">
                              <span className="font-medium">{t.staffName}</span>: {t.from} → {t.to}
                              <span className="block text-xs text-gray-400 mt-0.5">{when(t.at)}{t.actor ? ` · by ${t.actor}` : ''}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="premium-card p-5">
                      <h3 className="font-semibold text-gray-900 mb-3">Activity</h3>
                      <ActivityList items={selected.activity} empty="No changes recorded yet." />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      ) : data && facility ? (
        <div className="space-y-4">
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="premium-card p-5 lg:col-span-2">
              <h3 className="font-semibold text-gray-900">General Info</h3>
              <p className="text-sm text-gray-500 mt-1">Your facility's profile and contact details.</p>
              <div className="grid md:grid-cols-2 gap-3 mt-4">
                <Field label="Facility name"><Input value={facility.name} onChange={(e) => setFacility({ ...facility, name: e.target.value })} /></Field>
                <Field label="State"><Input value={facility.state} onChange={(e) => setFacility({ ...facility, state: e.target.value })} /></Field>
                <Field label="Address" className="md:col-span-2"><Input value={facility.address} onChange={(e) => setFacility({ ...facility, address: e.target.value })} /></Field>
                <Field label="Phone"><Input value={facility.contactPhone} onChange={(e) => setFacility({ ...facility, contactPhone: e.target.value })} /></Field>
                <Field label="Email"><Input type="email" value={facility.contactEmail} onChange={(e) => setFacility({ ...facility, contactEmail: e.target.value })} /></Field>
                <Field label="Website" className="md:col-span-2"><Input value={facility.website} placeholder="https://" onChange={(e) => setFacility({ ...facility, website: e.target.value })} /></Field>
              </div>
            </div>
            <div className="premium-card p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Workspace</h3>
              <div className="space-y-3 text-sm">
                <Row label="Type" value={roleLabel(data.facility.organizationType || 'hospital')} />
                <Row label="Workspace ID" value={data.facility.slug} />
                <Row label="Departments" value={String(departments.length)} />
                <Row label="Active staff" value={String(staff.length)} />
                <Row label="VitaLink Network" value={data.facility.joinedNetwork ? 'Joined' : 'Not joined'} />
                <Row label="Created" value={new Date(data.facility.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} />
              </div>
            </div>
          </div>

          <div className="premium-card p-5">
            <h3 className="font-semibold text-gray-900">Operating Settings</h3>
            <p className="text-sm text-gray-500 mt-1">Applied whenever an appointment is booked or moved.</p>
            <div className="grid md:grid-cols-3 gap-4 mt-4">
              <Field label="Max patients per day">
                <Input type="number" min={1} placeholder="No limit" value={capInput} onChange={(e) => setCapInput(e.target.value)} />
                <p className="text-xs text-gray-500 mt-1">{data.facility.bookedToday} booked today. Leave blank for no limit.</p>
              </Field>
              <Field label="Gap between a clinician's appointments (min)">
                <Input type="number" min={0} max={240} value={facility.appointmentBufferMinutes} onChange={(e) => setFacility({ ...facility, appointmentBufferMinutes: Number(e.target.value) || 0 })} />
                <p className="text-xs text-gray-500 mt-1">0 only blocks double bookings at the same time.</p>
              </Field>
              <div className="flex items-start justify-between gap-3 p-3 rounded-xl border border-gray-100 bg-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-800">24/7 emergency service</p>
                  <p className="text-xs text-gray-500 mt-0.5">Emergency bookings skip the daily limit and the gap.</p>
                </div>
                <Switch checked={facility.emergency24x7} onCheckedChange={(checked) => setFacility({ ...facility, emergency24x7: checked })} />
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white rounded-xl gap-2" onClick={submitFacility} disabled={busy}>
                <Save className="w-4 h-4" />Save Settings
              </Button>
            </div>
          </div>

          <div className="premium-card p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Administration Audit Log</h3>
            <ActivityList items={data.auditLog} empty="No administration changes recorded yet." />
          </div>
        </div>
      ) : null}

      <Dialog open={deptDialog !== null} onOpenChange={(open) => !open && setDeptDialog(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{deptDialog?.id ? 'Edit Department' : 'Add Department'}</DialogTitle>
            <DialogDescription>{deptDialog?.id ? 'Renaming a department renames it for its staff and appointments too.' : 'Staff you place here book appointments under this department.'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Department name">
                <Input value={form.name} onChange={(e) => {
                  const name = e.target.value;
                  setForm((f) => ({ ...f, name, code: !deptDialog?.id && (f.code === '' || f.code === codeFrom(f.name)) ? codeFrom(name) : f.code }));
                }} />
              </Field>
              <Field label="Code">
                <Input value={form.code} maxLength={12} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') }))} />
              </Field>
            </div>
            <Field label="Description">
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="min-h-[72px]" />
            </Field>
            <div className="grid md:grid-cols-2 gap-3">
              <Field label="Head of department">
                <select className={SELECT} value={form.headMembershipId ?? ''} onChange={(e) => setForm((f) => ({ ...f, headMembershipId: e.target.value || null }))}>
                  <option value="">Not assigned</option>
                  {(deptDialog?.id ? selected?.staff ?? [] : staff).map((m) => <option key={m.membershipId} value={m.membershipId}>{m.name} · {roleLabel(m.role)}</option>)}
                </select>
                {deptDialog?.id && <p className="text-xs text-gray-500 mt-1">Choose from this department's staff.</p>}
              </Field>
              <Field label="Location (floor / wing)">
                <Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
              </Field>
            </div>

            <div>
              <Label>Opening hours</Label>
              <div className="mt-2 space-y-1.5">
                {form.workingHours.map((wh) => (
                  <div key={wh.day} className="grid grid-cols-[110px_auto_1fr_1fr] items-center gap-2 text-sm">
                    <span className="text-gray-700">{DAYS[wh.day]}</span>
                    <Switch checked={!wh.closed} onCheckedChange={(open) => setForm((f) => ({ ...f, workingHours: f.workingHours.map((d) => (d.day === wh.day ? { ...d, closed: !open } : d)) }))} aria-label={`${DAYS[wh.day]} open`} />
                    <Input type="time" value={wh.open} disabled={wh.closed} onChange={(e) => setForm((f) => ({ ...f, workingHours: f.workingHours.map((d) => (d.day === wh.day ? { ...d, open: e.target.value } : d)) }))} />
                    <Input type="time" value={wh.close} disabled={wh.closed} onChange={(e) => setForm((f) => ({ ...f, workingHours: f.workingHours.map((d) => (d.day === wh.day ? { ...d, close: e.target.value } : d)) }))} />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Label>Services</Label>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                {SERVICES.map((service) => (
                  <label key={service} className="flex items-center gap-2 text-sm p-2 rounded-lg border border-gray-100 bg-gray-50">
                    <Checkbox
                      checked={form.linkedServices.includes(service)}
                      onCheckedChange={(checked) => setForm((f) => ({ ...f, linkedServices: checked ? [...f.linkedServices, service] : f.linkedServices.filter((s) => s !== service) }))}
                    />
                    {service}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {(['rooms', 'equipment', 'beds'] as const).map((key) => (
                <Field key={key} label={key[0].toUpperCase() + key.slice(1)}>
                  <Input type="number" min={0} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: Math.max(0, Number(e.target.value) || 0) }))} />
                </Field>
              ))}
            </div>

            {deptDialog?.id ? (
              <div className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-800">Active</p>
                  <p className="text-xs text-gray-500">Inactive departments stay in records but are hidden from staff pickers.</p>
                </div>
                <Switch checked={form.isActive} onCheckedChange={(checked) => setForm((f) => ({ ...f, isActive: checked }))} />
              </div>
            ) : staff.length > 0 && (
              <div>
                <Label>Place staff in this department</Label>
                <div className="mt-2 grid md:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {staff.map((member) => (
                    <label key={member.membershipId} className="flex items-center gap-2 text-sm p-2 rounded-lg border border-gray-100 bg-gray-50">
                      <Checkbox
                        checked={form.assign.includes(member.membershipId)}
                        onCheckedChange={(checked) => setForm((f) => ({ ...f, assign: checked ? [...f.assign, member.membershipId] : f.assign.filter((id) => id !== member.membershipId) }))}
                      />
                      <span className="min-w-0 truncate">{member.name}<span className="text-gray-400"> · {member.department ?? 'No department'}</span></span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeptDialog(null)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white" onClick={submitDepartment} disabled={busy || form.name.trim().length < 2}>
              <Save className="w-4 h-4 mr-2" />{deptDialog?.id ? 'Save Changes' : 'Create Department'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add staff to {selected?.name}</DialogTitle>
            <DialogDescription>Staff already in another department are moved here, and the move is logged.</DialogDescription>
          </DialogHeader>
          {otherStaff.length === 0 ? <p className="text-sm text-gray-500">Everyone in the workspace is already in this department.</p> : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {otherStaff.map((member) => (
                <label key={member.membershipId} className="flex items-center gap-3 text-sm p-2.5 rounded-lg border border-gray-100 bg-gray-50">
                  <Checkbox
                    checked={assignIds.includes(member.membershipId)}
                    onCheckedChange={(checked) => setAssignIds((ids) => (checked ? [...ids, member.membershipId] : ids.filter((id) => id !== member.membershipId)))}
                  />
                  <span className="min-w-0">
                    <span className="font-medium text-gray-900">{member.name}</span>
                    <span className="block text-xs text-gray-500">{roleLabel(member.role)} · {member.department ? `now in ${member.department}` : 'no department'}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white" onClick={submitAssign} disabled={busy || assignIds.length === 0}>
              <UserPlus className="w-4 h-4 mr-2" />Add {assignIds.length || ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Transfer staff</DialogTitle>
            <DialogDescription>Move a staff member from {selected?.name} to another department. Their future appointments keep their current department.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Staff member">
              <select className={SELECT} value={transfer.membershipId} onChange={(e) => setTransfer((t) => ({ ...t, membershipId: e.target.value }))}>
                <option value="">Select staff</option>
                {selected?.staff.map((m) => <option key={m.membershipId} value={m.membershipId}>{m.name}</option>)}
              </select>
            </Field>
            <Field label="Move to">
              <select className={SELECT} value={transfer.targetId} onChange={(e) => setTransfer((t) => ({ ...t, targetId: e.target.value }))}>
                <option value="">Select department</option>
                {departments.filter((d) => d.id !== selected?.id && d.isActive).map((d) => <option key={d.id} value={d.id}>{d.name} ({d.code})</option>)}
              </select>
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white" onClick={submitTransfer} disabled={busy || !transfer.membershipId || !transfer.targetId}>
              <ArrowRightLeft className="w-4 h-4 mr-2" />Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {selected?.staffCount ? `Its ${selected.staffCount} staff member${selected.staffCount === 1 ? '' : 's'} will have no department. ` : ''}
              Past appointments keep the department name. To keep it on record instead, edit it and switch it to inactive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={() => { if (selected) void run(() => deleteDepartment(selected.id), `${selected.name} deleted`); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function departmentAlerts(d: AdminDepartment): string[] {
  const alerts: string[] = [];
  const bookable = d.staff.filter((s) => s.acceptsAppointments).length;
  if (!d.isActive && d.performance.upcoming > 0) alerts.push(`Inactive, but ${d.performance.upcoming} upcoming appointment${d.performance.upcoming === 1 ? ' is' : 's are'} still booked here.`);
  if (d.isActive && d.staffCount === 0) alerts.push('No staff in this department.');
  else if (d.isActive && bookable === 0 && d.performance.upcoming > 0) alerts.push('Appointments are booked here but no staff member takes appointments.');
  if (d.dailyCapacity > 0 && d.performance.bookedToday > d.dailyCapacity) alerts.push(`Overbooked today: ${d.performance.bookedToday} appointments for ${d.dailyCapacity} slots.`);
  if (d.performance.appointments >= 10 && d.performance.noShow / d.performance.appointments > 0.2) {
    alerts.push(`High no-show rate: ${Math.round((d.performance.noShow / d.performance.appointments) * 100)}% of appointments.`);
  }
  if (d.performance.avgWaitMin != null && d.performance.avgWaitMin > 45) alerts.push(`Patients wait ${d.performance.avgWaitMin} min on average after check-in.`);
  if (d.isActive && !d.headMembershipId && d.staffCount > 0) alerts.push('No head of department assigned.');
  return alerts;
}

function ActivityList({ items, empty }: { items: AdminActivity[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-gray-500">{empty}</p>;
  return (
    <div className="space-y-2">
      {items.map((log) => (
        <div key={log.id} className="p-3 rounded-lg bg-gray-50 border border-gray-100 text-sm text-gray-700">
          {log.summary}
          <span className="block text-xs text-gray-400 mt-0.5">{when(log.at)}{log.actor ? ` · ${log.actor}` : ''}</span>
        </div>
      ))}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 text-right truncate">{value}</span>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, hint }: { icon: React.ElementType; label: string; value: string; hint?: string }) {
  return (
    <div className="premium-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{label}</p>
        <Icon className="w-4 h-4 text-gray-400" />
      </div>
      <p className="text-xl font-bold text-gray-900 mt-2">{value}</p>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}
