import { useMemo, useState } from 'react';
import {
  CalendarClock,
  ChevronRight,
  Download,
  Edit3,
  Eye,
  Filter,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useAuth } from '@/contexts/AuthContext';
import type { Role, Staff, PermissionModule, PermissionAction } from '@/types/rbac';
import { DEFAULT_ROLE_TEMPLATES } from '@/types/rbac';

const modules: { id: PermissionModule; label: string }[] = [
  { id: 'patients', label: 'Patients' },
  { id: 'appointments', label: 'Appointments' },
  { id: 'emr', label: 'EMR' },
  { id: 'laboratory', label: 'Lab' },
  { id: 'pharmacy', label: 'Pharmacy' },
  { id: 'billing', label: 'Billing' },
  { id: 'hr', label: 'HR' },
  { id: 'analytics', label: 'Analytics' },
];
const actions: PermissionAction[] = ['view', 'create', 'edit', 'delete', 'export', 'approve'];
const departments = ['General Medicine', 'Surgery', 'Laboratory', 'Pharmacy', 'Billing', 'Front Desk', 'Human Resources', 'Cardiology', 'Pediatrics'];
const hospitals = ['Lagos Central', 'Abuja Metro', 'Kano City'];

const baseRoles: Role[] = [
  { id: 'r-super', name: 'Admin', description: 'Super admin with global access', isDefault: true, isSystem: true, permissions: DEFAULT_ROLE_TEMPLATES.super_admin.permissions, createdAt: '2026-01-01', updatedAt: '2026-01-01', createdBy: 'system', staffCount: 2 },
  { id: 'r-hosp-admin', name: 'HR Manager', description: 'HR operations and staff lifecycle', isDefault: true, isSystem: false, permissions: [{ module: 'hr', actions: ['view', 'create', 'edit', 'delete', 'export', 'approve'] }, { module: 'analytics', actions: ['view', 'export'] }], createdAt: '2026-01-01', updatedAt: '2026-01-01', createdBy: 'system', staffCount: 3 },
  { id: 'r-doctor', name: 'Doctor', description: 'Clinical operations', isDefault: true, isSystem: false, permissions: DEFAULT_ROLE_TEMPLATES.doctor.permissions, createdAt: '2026-01-01', updatedAt: '2026-01-01', createdBy: 'system', staffCount: 15 },
  { id: 'r-nurse', name: 'Nurse', description: 'Nursing workflows', isDefault: true, isSystem: false, permissions: DEFAULT_ROLE_TEMPLATES.nurse.permissions, createdAt: '2026-01-01', updatedAt: '2026-01-01', createdBy: 'system', staffCount: 28 },
  { id: 'r-reception', name: 'Receptionist', description: 'Front desk and scheduling', isDefault: true, isSystem: false, permissions: DEFAULT_ROLE_TEMPLATES.receptionist.permissions, createdAt: '2026-01-01', updatedAt: '2026-01-01', createdBy: 'system', staffCount: 9 },
  { id: 'r-lab', name: 'Lab Scientist', description: 'Lab operations', isDefault: true, isSystem: false, permissions: DEFAULT_ROLE_TEMPLATES.lab_scientist.permissions, createdAt: '2026-01-01', updatedAt: '2026-01-01', createdBy: 'system', staffCount: 7 },
  { id: 'r-pharm', name: 'Pharmacist', description: 'Pharmacy operations', isDefault: true, isSystem: false, permissions: DEFAULT_ROLE_TEMPLATES.pharmacist.permissions, createdAt: '2026-01-01', updatedAt: '2026-01-01', createdBy: 'system', staffCount: 6 },
  { id: 'r-bill', name: 'Accountant', description: 'Revenue and billing workflows', isDefault: true, isSystem: false, permissions: DEFAULT_ROLE_TEMPLATES.billing_officer.permissions, createdAt: '2026-01-01', updatedAt: '2026-01-01', createdBy: 'system', staffCount: 5 },
];

const baseStaff: Staff[] = [
  { id: 's1', userId: 'u1', hospitalId: 'Lagos Central', departmentId: 'Human Resources', roleId: 'r-hosp-admin', firstName: 'Chioma', lastName: 'Okafor', email: 'chioma.okafor@vitalink.africa', phone: '+234 801 111 1000', employeeId: 'EMP-001', status: 'active', isEmailVerified: true, twoFactorEnabled: true, joinedAt: '2026-01-04', lastLoginAt: '2026-04-27T07:41:00Z', createdAt: '2026-01-04', updatedAt: '2026-04-27' },
  { id: 's2', userId: 'u2', hospitalId: 'Lagos Central', departmentId: 'General Medicine', roleId: 'r-doctor', firstName: 'Sarah', lastName: 'Johnson', email: 'sarah.johnson@vitalink.africa', phone: '+234 802 333 2222', employeeId: 'EMP-002', licenseNumber: 'MD-NG-45231', yearsOfExperience: 11, status: 'active', isEmailVerified: true, twoFactorEnabled: false, joinedAt: '2026-01-20', lastLoginAt: '2026-04-27T08:20:00Z', createdAt: '2026-01-20', updatedAt: '2026-04-27' },
  { id: 's3', userId: 'u3', hospitalId: 'Abuja Metro', departmentId: 'Laboratory', roleId: 'r-lab', firstName: 'Amina', lastName: 'Abdullahi', email: 'amina.abdullahi@vitalink.africa', phone: '+234 803 444 5555', employeeId: 'EMP-003', status: 'inactive', isEmailVerified: true, twoFactorEnabled: true, joinedAt: '2026-02-01', lastLoginAt: '2026-04-21T11:15:00Z', createdAt: '2026-02-01', updatedAt: '2026-04-22' },
  { id: 's4', userId: 'u4', hospitalId: 'Lagos Central', departmentId: 'Front Desk', roleId: 'r-reception', firstName: 'David', lastName: 'Adeyemi', email: 'david.adeyemi@vitalink.africa', phone: '+234 804 888 6666', employeeId: 'EMP-004', status: 'pending', isEmailVerified: false, twoFactorEnabled: false, joinedAt: '2026-04-20', inviteStatus: 'pending', inviteSentAt: '2026-04-20T10:00:00Z', inviteExpiresAt: '2026-04-22T10:00:00Z', invitedBy: 'Chioma Okafor', createdAt: '2026-04-20', updatedAt: '2026-04-20' },
];

function csvExport(name: string, rows: string[][]) {
  const content = rows.map((r) => r.join(',')).join('\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function HumanResourcesPage() {
  const { currentRole, hasPermission, userName } = useAuth();
  const [activeTab, setActiveTab] = useState<'staff' | 'roles' | 'profile'>('staff');
  const [roles, setRoles] = useState<Role[]>(baseRoles);
  const [staffList, setStaffList] = useState<Staff[]>(baseStaff);
  const [selectedRole, setSelectedRole] = useState<Role | null>(baseRoles[0]);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(baseStaff[0]);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | Staff['status']>('all');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [staffForm, setStaffForm] = useState({
    fullName: '',
    gender: 'male',
    dob: '',
    phone: '',
    email: '',
    roleId: 'r-doctor',
    departmentId: 'General Medicine',
    hospitalId: 'Lagos Central',
    licenseNumber: '',
    yearsOfExperience: 0,
    accountEmail: '',
    setupMethod: 'magic-link',
    status: 'pending' as Staff['status'],
  });
  const [roleForm, setRoleForm] = useState<{ name: string; description: string; permissions: Record<PermissionModule, PermissionAction[]> }>({
    name: '',
    description: '',
    permissions: modules.reduce((acc, m) => ({ ...acc, [m.id]: ['view'] }), {} as Record<PermissionModule, PermissionAction[]>),
  });

  const canManageHr = hasPermission('Human Resources', 'edit') || hasPermission('Human Resources', 'create') || currentRole === 'super-admin' || currentRole === 'hospital-admin';
  const canViewHr = hasPermission('Human Resources', 'view') || currentRole === 'receptionist';

  const restrictedRole = ['doctor', 'nurse', 'lab-scientist', 'lab-technician', 'pharmacist'].includes(currentRole);
  if (!canViewHr || restrictedRole) {
    return (
      <div className="premium-card p-8 text-center page-transition">
        <h1 className="text-xl font-semibold text-gray-900">Human Resources</h1>
        <p className="text-sm text-gray-500 mt-2">Your role does not have HR access.</p>
      </div>
    );
  }

  const filteredStaff = useMemo(() => {
    return staffList.filter((s) => {
      const role = roles.find((r) => r.id === s.roleId);
      const name = `${s.firstName} ${s.lastName}`.toLowerCase();
      const bySearch = !searchQuery.trim() || name.includes(searchQuery.toLowerCase()) || s.employeeId.toLowerCase().includes(searchQuery.toLowerCase()) || s.departmentId.toLowerCase().includes(searchQuery.toLowerCase());
      const byRole = roleFilter === 'all' || role?.name === roleFilter;
      const byDept = deptFilter === 'all' || s.departmentId === deptFilter;
      const byStatus = statusFilter === 'all' || s.status === statusFilter;
      return bySearch && byRole && byDept && byStatus;
    });
  }, [staffList, roles, searchQuery, roleFilter, deptFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredStaff.length / rowsPerPage));
  const paged = filteredStaff.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  const saveStaffAndInvite = () => {
    if (!canManageHr) return toast.error('No permission to add staff');
    if (!staffForm.fullName || !staffForm.email || !staffForm.accountEmail) return toast.error('Complete required fields');
    const [firstName, ...rest] = staffForm.fullName.trim().split(' ');
    const lastName = rest.join(' ') || 'Staff';
    const id = `s${Date.now()}`;
    const created: Staff = {
      id,
      userId: `u-${id}`,
      hospitalId: staffForm.hospitalId,
      departmentId: staffForm.departmentId,
      roleId: staffForm.roleId,
      firstName,
      lastName,
      email: staffForm.email,
      phone: staffForm.phone,
      employeeId: `EMP-${String(staffList.length + 1).padStart(3, '0')}`,
      licenseNumber: staffForm.licenseNumber || undefined,
      yearsOfExperience: staffForm.yearsOfExperience,
      status: staffForm.status,
      isEmailVerified: false,
      twoFactorEnabled: false,
      joinedAt: new Date().toISOString().slice(0, 10),
      lastLoginAt: undefined,
      createdAt: new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString().slice(0, 10),
      inviteStatus: 'pending',
      inviteSentAt: new Date().toISOString(),
      inviteExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(),
      invitedBy: userName,
    };
    setStaffList((prev) => [created, ...prev]);
    setShowStaffModal(false);
    toast.success('Staff saved & invite sent', {
      description: `Email sent to ${staffForm.accountEmail} with app link + ${staffForm.setupMethod === 'magic-link' ? 'magic link' : 'temporary password'} setup`,
    });
    window.dispatchEvent(new CustomEvent('vitalink:notify', { detail: { module: 'hr', type: 'staff-created', staff: created.email } }));
  };

  const openRoleEditor = (role?: Role) => {
    if (role) {
      const permissionMap = modules.reduce((acc, m) => {
        acc[m.id] = role.permissions.find((p) => p.module === m.id)?.actions ?? [];
        return acc;
      }, {} as Record<PermissionModule, PermissionAction[]>);
      setRoleForm({ name: role.name, description: role.description, permissions: permissionMap });
      setEditingRole(role);
    } else {
      setEditingRole(null);
      setRoleForm({
        name: '',
        description: '',
        permissions: modules.reduce((acc, m) => ({ ...acc, [m.id]: ['view'] }), {} as Record<PermissionModule, PermissionAction[]>),
      });
    }
    setShowRoleModal(true);
  };

  const saveRole = () => {
    if (!canManageHr) return toast.error('No permission');
    if (!roleForm.name.trim()) return toast.error('Role name required');
    const permissions = modules
      .map((m) => ({ module: m.id, actions: roleForm.permissions[m.id] ?? [] }))
      .filter((p) => p.actions.length > 0);
    if (editingRole) {
      setRoles((prev) => prev.map((r) => (r.id === editingRole.id ? { ...r, name: roleForm.name, description: roleForm.description, permissions, updatedAt: new Date().toISOString().slice(0, 10) } : r)));
      toast.success('Role updated');
    } else {
      const newRole: Role = {
        id: `r-${Date.now()}`,
        name: roleForm.name,
        description: roleForm.description || 'Custom role',
        isDefault: false,
        isSystem: false,
        permissions,
        createdAt: new Date().toISOString().slice(0, 10),
        updatedAt: new Date().toISOString().slice(0, 10),
        createdBy: userName,
        staffCount: 0,
      };
      setRoles((prev) => [newRole, ...prev]);
      toast.success('Role added');
    }
    setShowRoleModal(false);
  };

  const runStaffAction = (action: 'view' | 'edit' | 'role' | 'reset' | 'toggle' | 'delete', s: Staff) => {
    if (action === 'view') {
      setSelectedStaff(s);
      setActiveTab('profile');
      return;
    }
    if (!canManageHr) return toast.error('Read-only access');
    if (action === 'toggle') {
      setStaffList((prev) => prev.map((x) => (x.id === s.id ? { ...x, status: x.status === 'active' ? 'inactive' : 'active' } : x)));
      toast.success(`Staff ${s.status === 'active' ? 'deactivated' : 'activated'}`);
    }
    if (action === 'delete') {
      setStaffList((prev) => prev.filter((x) => x.id !== s.id));
      toast.success('Staff deleted');
    }
    if (action === 'reset') toast.success(`Password reset email sent to ${s.email}`);
    if (action === 'edit') toast.message(`Editing ${s.firstName} ${s.lastName}`);
    if (action === 'role') toast.message('Change role flow opened');
  };

  const exportStaff = (format: 'csv' | 'pdf') => {
    if (format === 'pdf') {
      window.print();
      toast.success('HR report ready for PDF');
      return;
    }
    csvExport('vitalink-staff.csv', [
      ['Name', 'Role', 'Department', 'Email', 'Phone', 'Status', 'Last Login'],
      ...filteredStaff.map((s) => [
        `${s.firstName} ${s.lastName}`,
        roles.find((r) => r.id === s.roleId)?.name ?? '',
        s.departmentId,
        s.email,
        s.phone,
        s.status,
        s.lastLoginAt ? new Date(s.lastLoginAt).toLocaleString() : 'Never',
      ]),
    ]);
    toast.success('CSV exported');
  };

  const allStaffCount = staffList.length;
  const activeCount = staffList.filter((s) => s.status === 'active').length;
  const pendingCount = staffList.filter((s) => s.status === 'pending').length;
  const inactiveCount = staffList.filter((s) => s.status === 'inactive').length;

  return (
    <div className="space-y-4 md:space-y-6 page-transition">
      <div className="sticky top-0 z-20 -mx-4 px-4 py-3 md:mx-0 md:px-0 bg-background/90 backdrop-blur-md border-b border-white/40 md:border-0">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#1E4ED8]">Human Resources</h1>
            <p className="text-sm text-gray-500 mt-1">Staff lifecycle, role governance, attendance, and performance across VitaLink facilities</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2 rounded-xl">
                  <Download className="w-4 h-4" />
                  Export
                </Button>
              </PopoverTrigger>
              <PopoverContent className="glass-panel border-white/60 w-56">
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" onClick={() => exportStaff('csv')}>CSV</Button>
                  <Button size="sm" variant="outline" onClick={() => exportStaff('pdf')}>PDF</Button>
                </div>
              </PopoverContent>
            </Popover>
            <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white gap-2 rounded-xl" disabled={!canManageHr} onClick={() => openRoleEditor()}>
              <Shield className="w-4 h-4" />
              Add Role
            </Button>
            <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white gap-2 rounded-xl" disabled={!canManageHr} onClick={() => setShowStaffModal(true)}>
              <UserPlus className="w-4 h-4" />
              Add Staff
            </Button>
          </div>
        </div>
      </div>

      <div className="dashboard-stat-grid">
        <MetricCard label="Total Staff" value={allStaffCount} />
        <MetricCard label="Active" value={activeCount} tone="green" />
        <MetricCard label="Pending Invite" value={pendingCount} tone="amber" />
        <MetricCard label="Inactive" value={inactiveCount} tone="red" />
        <MetricCard label="Roles" value={roles.length} tone="indigo" />
      </div>

      <div className="flex gap-2 p-1 bg-gray-100 rounded-xl w-fit">
        {[
          { id: 'staff', label: 'Staff Directory', icon: Users },
          { id: 'roles', label: 'Roles & Permissions', icon: Shield },
          { id: 'profile', label: 'Staff Profile', icon: Eye },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as 'staff' | 'roles' | 'profile')}
            className={cn('flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200', activeTab === tab.id ? 'bg-white text-royal-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'staff' && (
        <>
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input placeholder="Search name, role, department..." value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }} className="pl-10 rounded-xl bg-white/80" />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2 rounded-xl">
                  <Filter className="w-4 h-4" />
                  Filter
                </Button>
              </PopoverTrigger>
              <PopoverContent className="glass-panel border-white/60 w-80">
                <div className="space-y-3">
                  <div>
                    <Label>Role</Label>
                    <select className="mt-1 w-full rounded-md border border-input px-3 py-2 text-sm" value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}>
                      <option value="all">All</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.name}>{r.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Department</Label>
                    <select className="mt-1 w-full rounded-md border border-input px-3 py-2 text-sm" value={deptFilter} onChange={(e) => { setDeptFilter(e.target.value); setPage(1); }}>
                      <option value="all">All</option>
                      {departments.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label>Status</Label>
                    <select className="mt-1 w-full rounded-md border border-input px-3 py-2 text-sm" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value as Staff['status'] | 'all'); setPage(1); }}>
                      <option value="all">All</option>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="pending">Pending</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <div className="hidden md:block premium-card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Name</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Role</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Department</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Email</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Phone</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 uppercase">Last Login</th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((s) => {
                  const role = roles.find((r) => r.id === s.roleId)?.name ?? 'Unknown';
                  return (
                    <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                      <td className="px-6 py-4 font-medium text-gray-900">{s.firstName} {s.lastName}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{role}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{s.departmentId}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{s.email}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{s.phone}</td>
                      <td className="px-6 py-4">
                        <span className={cn('px-3 py-1 rounded-full text-xs font-medium capitalize', s.status === 'active' ? 'bg-green-100 text-green-700' : s.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600')}>{s.status}</span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">{s.lastLoginAt ? new Date(s.lastLoginAt).toLocaleString() : 'Never'}</td>
                      <td className="px-6 py-4 text-right">
                        <StaffRowActions staff={s} onAction={runStaffAction} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {paged.map((s) => (
              <div key={s.id} className="premium-card p-4">
                <div className="flex justify-between gap-2">
                  <div>
                    <p className="font-semibold text-gray-900">{s.firstName} {s.lastName}</p>
                    <p className="text-xs text-gray-500">{roles.find((r) => r.id === s.roleId)?.name} · {s.departmentId}</p>
                    <p className="text-xs text-gray-500 mt-1">{s.email}</p>
                    <p className="text-xs text-gray-500">{s.phone}</p>
                  </div>
                  <StaffRowActions staff={s} onAction={runStaffAction} />
                </div>
                <div className="flex justify-between mt-3 text-xs">
                  <span className={cn('px-2 py-1 rounded-full capitalize', s.status === 'active' ? 'bg-green-100 text-green-700' : s.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600')}>{s.status}</span>
                  <span className="text-gray-500">{s.lastLoginAt ? new Date(s.lastLoginAt).toLocaleString() : 'Never'}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col md:flex-row gap-2 md:items-center md:justify-between premium-card p-4">
            <div className="text-sm text-gray-500">Showing {(page - 1) * rowsPerPage + 1}-{Math.min(page * rowsPerPage, filteredStaff.length)} of {filteredStaff.length}</div>
            <div className="flex items-center gap-2">
              <select className="rounded-md border border-input px-2 py-1 text-sm" value={rowsPerPage} onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(1); }}>
                {[5, 10, 15].map((n) => (
                  <option key={n} value={n}>{n}/page</option>
                ))}
              </select>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
              <span className="text-sm text-gray-600">{page}/{totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>Next</Button>
            </div>
          </div>
        </>
      )}

      {activeTab === 'roles' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="premium-card p-4 space-y-2">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-900">Roles</h3>
              <Button size="sm" variant="outline" disabled={!canManageHr} onClick={() => openRoleEditor()}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {roles.map((r) => (
              <button key={r.id} onClick={() => setSelectedRole(r)} className={cn('w-full p-3 rounded-xl text-left border transition-all', selectedRole?.id === r.id ? 'border-royal-300 bg-royal-50' : 'border-transparent bg-gray-50 hover:bg-gray-100')}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{r.name}</p>
                    <p className="text-xs text-gray-500">{r.staffCount} staff</p>
                  </div>
                  <ChevronRight className={cn('w-4 h-4 text-gray-400', selectedRole?.id === r.id && 'rotate-90')} />
                </div>
              </button>
            ))}
          </div>
          <div className="lg:col-span-2">
            {selectedRole ? (
              <div className="premium-card p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{selectedRole.name}</h2>
                    <p className="text-sm text-gray-500">{selectedRole.description}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={!canManageHr} onClick={() => openRoleEditor(selectedRole)}>
                      <Edit3 className="w-4 h-4 mr-2" />
                      Edit Role
                    </Button>
                    <Button size="sm" variant="outline" disabled={!canManageHr || selectedRole.isSystem} onClick={() => {
                      setRoles((prev) => prev.filter((r) => r.id !== selectedRole.id));
                      setSelectedRole(null);
                      toast.success('Role deleted');
                    }}>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </Button>
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  {modules.map((m) => {
                    const allowed = selectedRole.permissions.find((p) => p.module === m.id)?.actions ?? [];
                    return (
                      <div key={m.id} className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                        <p className="font-medium text-gray-900 mb-2">{m.label}</p>
                        <div className="flex flex-wrap gap-1">
                          {actions.map((a) => (
                            <span key={a} className={cn('px-2 py-1 rounded text-xs uppercase', allowed.includes(a) ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500')}>
                              {a}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="premium-card p-8 text-center text-gray-500">Select a role to manage permissions.</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'profile' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="premium-card p-4">
            <h3 className="font-semibold text-gray-900 mb-3">Staff Members</h3>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {staffList.map((s) => (
                <button key={s.id} onClick={() => setSelectedStaff(s)} className={cn('w-full p-3 rounded-xl text-left border', selectedStaff?.id === s.id ? 'border-royal-300 bg-royal-50' : 'border-transparent bg-gray-50')}>
                  <p className="font-medium text-gray-900">{s.firstName} {s.lastName}</p>
                  <p className="text-xs text-gray-500">{s.departmentId}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="lg:col-span-2">
            {selectedStaff ? (
              <div className="premium-card p-5 space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">{selectedStaff.firstName} {selectedStaff.lastName}</h2>
                    <p className="text-sm text-gray-500">{roles.find((r) => r.id === selectedStaff.roleId)?.name} · {selectedStaff.departmentId}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => runStaffAction('view', selectedStaff)}>
                    <Eye className="w-4 h-4 mr-2" />
                    Refresh
                  </Button>
                </div>

                <div className="grid md:grid-cols-2 gap-3 text-sm">
                  <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <p className="text-gray-500">Email</p>
                    <p className="font-medium">{selectedStaff.email}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <p className="text-gray-500">Phone</p>
                    <p className="font-medium">{selectedStaff.phone}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <p className="text-gray-500">Last Login</p>
                    <p className="font-medium">{selectedStaff.lastLoginAt ? new Date(selectedStaff.lastLoginAt).toLocaleString() : 'Never'}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <p className="text-gray-500">Assigned Patients</p>
                    <p className="font-medium">{selectedStaff.roleId === 'r-doctor' || selectedStaff.roleId === 'r-nurse' ? 23 : 0}</p>
                  </div>
                </div>

                <div className="grid md:grid-cols-3 gap-3">
                  <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100">
                    <p className="text-xs text-indigo-600">Attendance</p>
                    <p className="font-semibold text-indigo-800 mt-1">Clocked In 08:14 AM</p>
                    <p className="text-xs text-indigo-600 mt-1">Shift: 08:00 - 16:00</p>
                  </div>
                  <div className="p-4 rounded-xl bg-green-50 border border-green-100">
                    <p className="text-xs text-green-600">Performance</p>
                    <p className="font-semibold text-green-800 mt-1">Efficiency 87%</p>
                    <p className="text-xs text-green-600 mt-1">Department benchmark +6%</p>
                  </div>
                  <div className="p-4 rounded-xl bg-amber-50 border border-amber-100">
                    <p className="text-xs text-amber-600">Multi-Hospital</p>
                    <p className="font-semibold text-amber-800 mt-1">{selectedStaff.hospitalId}</p>
                    <p className="text-xs text-amber-600 mt-1">Cross-site enabled</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="font-semibold text-gray-900">Activity Logs</h4>
                  {[
                    'Logged in from Lagos workstation',
                    'Updated appointment schedule',
                    'Viewed patient profile VL-2026-000221',
                    'Role permission sync completed',
                  ].map((log, i) => (
                    <div key={log} className="p-3 rounded-xl bg-gray-50 border border-gray-100 text-sm text-gray-700">
                      #{i + 1} · {log}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="premium-card p-8 text-center text-gray-500">Select staff to view full profile.</div>
            )}
          </div>
        </div>
      )}

      <Dialog open={showStaffModal} onOpenChange={setShowStaffModal}>
        <DialogContent className="glass-panel border-white/60 max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Staff</DialogTitle>
            <DialogDescription>Create staff account and send secure invite email.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-gray-800">Personal Info</h4>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label>Full Name</Label>
                <Input value={staffForm.fullName} onChange={(e) => setStaffForm((s) => ({ ...s, fullName: e.target.value }))} />
              </div>
              <div>
                <Label>Gender</Label>
                <select className="w-full mt-1 rounded-md border border-input px-3 py-2 text-sm" value={staffForm.gender} onChange={(e) => setStaffForm((s) => ({ ...s, gender: e.target.value }))}>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <Label>Date of Birth</Label>
                <Input type="date" value={staffForm.dob} onChange={(e) => setStaffForm((s) => ({ ...s, dob: e.target.value }))} />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={staffForm.phone} onChange={(e) => setStaffForm((s) => ({ ...s, phone: e.target.value }))} />
              </div>
              <div className="md:col-span-2">
                <Label>Email</Label>
                <Input type="email" value={staffForm.email} onChange={(e) => setStaffForm((s) => ({ ...s, email: e.target.value }))} />
              </div>
            </div>

            <h4 className="text-sm font-semibold text-gray-800">Professional Info</h4>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label>Role</Label>
                <select className="w-full mt-1 rounded-md border border-input px-3 py-2 text-sm" value={staffForm.roleId} onChange={(e) => setStaffForm((s) => ({ ...s, roleId: e.target.value }))}>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Department</Label>
                <select className="w-full mt-1 rounded-md border border-input px-3 py-2 text-sm" value={staffForm.departmentId} onChange={(e) => setStaffForm((s) => ({ ...s, departmentId: e.target.value }))}>
                  {departments.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Hospital</Label>
                <select className="w-full mt-1 rounded-md border border-input px-3 py-2 text-sm" value={staffForm.hospitalId} onChange={(e) => setStaffForm((s) => ({ ...s, hospitalId: e.target.value }))}>
                  {hospitals.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>License Number</Label>
                <Input value={staffForm.licenseNumber} onChange={(e) => setStaffForm((s) => ({ ...s, licenseNumber: e.target.value }))} />
              </div>
              <div>
                <Label>Years of Experience</Label>
                <Input type="number" value={staffForm.yearsOfExperience} onChange={(e) => setStaffForm((s) => ({ ...s, yearsOfExperience: Number(e.target.value) }))} />
              </div>
            </div>

            <h4 className="text-sm font-semibold text-gray-800">Account Setup</h4>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label>Login Email</Label>
                <Input type="email" value={staffForm.accountEmail} onChange={(e) => setStaffForm((s) => ({ ...s, accountEmail: e.target.value }))} />
              </div>
              <div>
                <Label>Status</Label>
                <select className="w-full mt-1 rounded-md border border-input px-3 py-2 text-sm" value={staffForm.status} onChange={(e) => setStaffForm((s) => ({ ...s, status: e.target.value as Staff['status'] }))}>
                  <option value="active">Active</option>
                  <option value="pending">Pending</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <Label>Invite Method</Label>
                <div className="flex gap-4 mt-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={staffForm.setupMethod === 'temp-password'} onChange={() => setStaffForm((s) => ({ ...s, setupMethod: 'temp-password' }))} />
                    Temporary Password
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={staffForm.setupMethod === 'magic-link'} onChange={() => setStaffForm((s) => ({ ...s, setupMethod: 'magic-link' }))} />
                    Magic Link
                  </label>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-xs text-amber-700">
              Invite email includes app link, role assignment, and secure password setup link.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStaffModal(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white" onClick={saveStaffAndInvite}>
              <Mail className="w-4 h-4 mr-2" />
              Save & Send Invite Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRoleModal} onOpenChange={setShowRoleModal}>
        <DialogContent className="glass-panel border-white/60 max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRole ? 'Edit Role' : 'Add Role'}</DialogTitle>
            <DialogDescription>Granular toggle permissions for each module/action pair.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label>Role Name</Label>
                <Input value={roleForm.name} onChange={(e) => setRoleForm((s) => ({ ...s, name: e.target.value }))} />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea value={roleForm.description} onChange={(e) => setRoleForm((s) => ({ ...s, description: e.target.value }))} className="min-h-[70px]" />
              </div>
            </div>
            <div className="space-y-3">
              {modules.map((m) => (
                <div key={m.id} className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                  <p className="font-medium text-gray-900 mb-2">{m.label}</p>
                  <div className="flex flex-wrap gap-3">
                    {actions.map((a) => {
                      const checked = roleForm.permissions[m.id]?.includes(a) ?? false;
                      return (
                        <label key={a} className="flex items-center gap-2 text-xs capitalize">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) => {
                              setRoleForm((prev) => {
                                const current = prev.permissions[m.id] ?? [];
                                const next = v ? Array.from(new Set([...current, a])) : current.filter((x) => x !== a);
                                return { ...prev, permissions: { ...prev.permissions, [m.id]: next } };
                              });
                            }}
                          />
                          {a}
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRoleModal(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white" onClick={saveRole}>Save Role</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'green' | 'amber' | 'red' | 'indigo' }) {
  return (
    <div className="premium-card p-4">
      <p className={cn('text-2xl font-bold', tone === 'green' && 'text-green-600', tone === 'amber' && 'text-amber-600', tone === 'red' && 'text-red-600', tone === 'indigo' && 'text-indigo-600', tone === 'default' && 'text-gray-900')}>
        {value}
      </p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}

function StaffRowActions({ staff, onAction }: { staff: Staff; onAction: (action: 'view' | 'edit' | 'role' | 'reset' | 'toggle' | 'delete', staff: Staff) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="glass-panel border-white/60">
        <DropdownMenuItem onClick={() => onAction('view', staff)}><Eye className="w-4 h-4 mr-2" />View Profile</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('edit', staff)}><Edit3 className="w-4 h-4 mr-2" />Edit Staff</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('role', staff)}><Shield className="w-4 h-4 mr-2" />Change Role</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('reset', staff)}><Mail className="w-4 h-4 mr-2" />Reset Password</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onAction('toggle', staff)}><CalendarClock className="w-4 h-4 mr-2" />{staff.status === 'active' ? 'Deactivate' : 'Activate'}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-red-600" onClick={() => onAction('delete', staff)}>
          <Trash2 className="w-4 h-4 mr-2" />
          Delete Staff
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
