import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  BarChart3,
  Briefcase,
  Building2,
  CalendarClock,
  ChevronRight,
  Clock,
  Edit3,
  Filter,
  FlaskConical,
  Hospital,
  Pill,
  Plus,
  Save,
  Search,
  Settings,
  ShieldAlert,
  Trash2,
  Upload,
  UserPlus,
  Users,
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
import { useAuth } from '@/contexts/AuthContext';
import type { PermissionModule, Department as RbacDepartment } from '@/types/rbac';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { LiveAdministration } from '@/components/administration/LiveAdministration';

type DeptSize = 'small' | 'medium' | 'large';
type AdminTab = 'departments' | 'facility';
type DepartmentAlertType = 'understaffed' | 'overbooked' | 'inactive';

interface FacilityConfig {
  maxPatientsPerDay: number;
  appointmentBufferMinutes: number;
  emergency24x7: boolean;
  telemedicineEnabled: boolean;
  labEnabled: boolean;
  pharmacyEnabled: boolean;
  billingEnabled: boolean;
}

interface FacilityUnit {
  id: string;
  name: string;
  code: string;
  address: string;
  city: string;
  state: string;
  phone: string;
  email: string;
  isPrimary: boolean;
  active: boolean;
}

interface StaffMember {
  id: string;
  name: string;
  role: string;
  hospitalId: string;
}

interface DepartmentTransferLog {
  id: string;
  staffId: string;
  staffName: string;
  fromDepartmentCode: string;
  toDepartmentCode: string;
  when: string;
}

interface DepartmentPerformance {
  patientsHandled: number;
  appointmentsCompleted: number;
  revenueGenerated: number;
  averageWaitMinutes: number;
}

interface DepartmentView extends RbacDepartment {
  size: DeptSize;
  location: string;
  linkedServices: string[];
  activityLogs: string[];
  resources: { rooms: number; equipment: number; beds: number };
  performance: DepartmentPerformance;
  assignedStaffIds: string[];
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEPARTMENT_MODULE_LABELS: Record<PermissionModule, string> = {
  dashboard: 'Dashboard',
  appointments: 'Appointments',
  patients: 'Patients',
  emr: 'EMR',
  laboratory: 'Laboratory',
  pharmacy: 'Pharmacy',
  billing: 'Billing',
  insurance: 'Insurance',
  analytics: 'Analytics',
  inventory: 'Inventory',
  administration: 'Administration',
  hr: 'Human Resources',
  settings: 'Settings',
  audit_logs: 'Audit Logs',
};

const initialStaff: StaffMember[] = [
  { id: 's1', name: 'Dr. Sarah Johnson', role: 'doctor', hospitalId: 'f1' },
  { id: 's2', name: 'Dr. Chioma Okonkwo', role: 'doctor', hospitalId: 'f1' },
  { id: 's3', name: 'Amina Abdullahi', role: 'lab-scientist', hospitalId: 'f1' },
  { id: 's4', name: 'Pharm. Emmanuel Adeyemi', role: 'pharmacist', hospitalId: 'f2' },
  { id: 's5', name: 'Nurse Amina Bello', role: 'nurse', hospitalId: 'f1' },
  { id: 's6', name: 'Dr. Michael Chen', role: 'doctor', hospitalId: 'f2' },
  { id: 's7', name: 'John Friday', role: 'receptionist', hospitalId: 'f1' },
];

const initialFacilities: FacilityUnit[] = [
  {
    id: 'f1',
    name: 'VitaLink - Lagos Central',
    code: 'SH-LAG-001',
    address: '123 Healthcare Avenue, Victoria Island',
    city: 'Lagos',
    state: 'Lagos State',
    phone: '+234 1 234 5678',
    email: 'lagos@vitalink.africa',
    isPrimary: true,
    active: true,
  },
  {
    id: 'f2',
    name: 'VitaLink - Abuja Metro',
    code: 'SH-ABJ-002',
    address: '22 Constitutional Drive, Garki',
    city: 'Abuja',
    state: 'FCT',
    phone: '+234 9 111 4589',
    email: 'abuja@vitalink.africa',
    isPrimary: false,
    active: true,
  },
];

const initialDepartments: DepartmentView[] = [
  {
    id: 'd1',
    hospitalId: 'f1',
    name: 'General Medicine',
    code: 'GM',
    description: 'Primary healthcare, triage, and physician consults',
    headId: 's1',
    headName: 'Dr. Sarah Johnson',
    workingHours: DAYS.map((_, i) => ({
      dayOfWeek: i,
      isOpen: i !== 0,
      openTime: i === 6 ? '09:00' : '08:00',
      closeTime: i === 6 ? '14:00' : '18:00',
      slotDuration: 30,
    })),
    allowedModules: ['appointments', 'emr', 'patients', 'analytics'],
    staffCount: 4,
    patientCount: 2456,
    isActive: true,
    createdAt: '2026-01-01',
    updatedAt: '2026-04-20',
    size: 'large',
    location: 'Main Block, Floor 1',
    linkedServices: ['Triage', 'Outpatient', 'Telemedicine'],
    activityLogs: ['Department created by Super Admin', 'Shift model updated', 'Staff assignment updated'],
    resources: { rooms: 12, equipment: 42, beds: 18 },
    performance: { patientsHandled: 2456, appointmentsCompleted: 1780, revenueGenerated: 9450000, averageWaitMinutes: 24 },
    assignedStaffIds: ['s1', 's5', 's7'],
  },
  {
    id: 'd2',
    hospitalId: 'f1',
    name: 'Laboratory',
    code: 'LAB',
    description: 'Diagnostic and pathology services',
    headId: 's3',
    headName: 'Amina Abdullahi',
    workingHours: DAYS.map((_, i) => ({
      dayOfWeek: i,
      isOpen: i !== 0,
      openTime: '07:00',
      closeTime: i === 6 ? '15:00' : '19:00',
      slotDuration: 20,
    })),
    allowedModules: ['laboratory', 'emr', 'billing', 'analytics'],
    staffCount: 6,
    patientCount: 1104,
    isActive: true,
    createdAt: '2026-01-02',
    updatedAt: '2026-04-19',
    size: 'medium',
    location: 'Diagnostic Wing, Ground Floor',
    linkedServices: ['Hematology', 'Microbiology'],
    activityLogs: ['Quality protocol refreshed', 'Equipment calibration completed'],
    resources: { rooms: 5, equipment: 73, beds: 0 },
    performance: { patientsHandled: 1104, appointmentsCompleted: 1096, revenueGenerated: 5250000, averageWaitMinutes: 18 },
    assignedStaffIds: ['s3'],
  },
  {
    id: 'd3',
    hospitalId: 'f2',
    name: 'Pharmacy',
    code: 'PHARM',
    description: 'Medication dispensing and prescription management',
    headId: 's4',
    headName: 'Pharm. Emmanuel Adeyemi',
    workingHours: DAYS.map((_, i) => ({
      dayOfWeek: i,
      isOpen: i !== 0,
      openTime: '08:00',
      closeTime: i === 6 ? '17:00' : '20:00',
      slotDuration: 15,
    })),
    allowedModules: ['pharmacy', 'billing', 'patients', 'analytics'],
    staffCount: 3,
    patientCount: 845,
    isActive: true,
    createdAt: '2026-01-03',
    updatedAt: '2026-04-18',
    size: 'small',
    location: 'Tower B, Floor 1',
    linkedServices: ['Outpatient Pharmacy', 'Insurance Desk'],
    activityLogs: ['Night shift added', 'Stock threshold tuned'],
    resources: { rooms: 3, equipment: 26, beds: 0 },
    performance: { patientsHandled: 845, appointmentsCompleted: 0, revenueGenerated: 3100000, averageWaitMinutes: 13 },
    assignedStaffIds: ['s4'],
  },
];

const workflowSteps = ['Reception', 'Doctor', 'Laboratory', 'Pharmacy'];

// Live workspaces manage real departments and facility settings; the sample
// data below only backs the offline demo.
export function AdministrationPage() {
  return isSupabaseConfigured ? <LiveAdministration /> : <DemoAdministrationPage />;
}

function DemoAdministrationPage() {
  const { currentRole, hasPermission, userName } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('departments');
  const [departments, setDepartments] = useState<DepartmentView[]>(initialDepartments);
  const [facilities, setFacilities] = useState<FacilityUnit[]>(initialFacilities);
  const [staff] = useState<StaffMember[]>(initialStaff);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<string | null>(initialDepartments[0]?.id ?? null);
  const [selectedFacilityId, setSelectedFacilityId] = useState<string>(initialFacilities[0].id);
  const [search, setSearch] = useState('');
  const [sizeFilter, setSizeFilter] = useState<'all' | DeptSize>('all');
  const [activityFilter, setActivityFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [showAddDepartment, setShowAddDepartment] = useState(false);
  const [showTransferDialog, setShowTransferDialog] = useState(false);
  const [showFacilityDialog, setShowFacilityDialog] = useState(false);
  const [transferStaffId, setTransferStaffId] = useState<string>('');
  const [transferTargetCode, setTransferTargetCode] = useState<string>('');
  const [transferLogs, setTransferLogs] = useState<DepartmentTransferLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<string[]>([]);
  const [facilityConfig, setFacilityConfig] = useState<FacilityConfig>({
    maxPatientsPerDay: 220,
    appointmentBufferMinutes: 10,
    emergency24x7: true,
    telemedicineEnabled: true,
    labEnabled: true,
    pharmacyEnabled: true,
    billingEnabled: true,
  });
  const [departmentForm, setDepartmentForm] = useState({
    name: '',
    code: '',
    description: '',
    headId: '',
    assignedStaffIds: [] as string[],
    linkedServices: [] as string[],
    moduleLinks: ['appointments', 'emr'] as PermissionModule[],
    location: '',
    hospitalId: initialFacilities[0].id,
    openTime: '08:00',
    closeTime: '17:00',
  });
  const [facilityForm, setFacilityForm] = useState({
    name: '',
    code: '',
    address: '',
    city: '',
    state: '',
    phone: '',
    email: '',
  });

  const canViewAdmin = hasPermission('Administration', 'view');
  const canCreateDept = hasPermission('Administration', 'create');
  const canEditDept = hasPermission('Administration', 'edit');
  const canDeleteDept = hasPermission('Administration', 'delete');
  const isSuperAdmin = currentRole === 'super-admin';
  const isHospitalAdmin = currentRole === 'hospital-admin';
  const isHod = currentRole === 'doctor';
  const readOnlyRole = ['nurse', 'receptionist', 'lab-scientist', 'lab-technician', 'pharmacist', 'billing-officer'].includes(currentRole);
  const canManageDepartment = canEditDept || canCreateDept || isSuperAdmin || isHospitalAdmin || isHod;
  const canSystemConfigure = isSuperAdmin;

  const selectedDepartment = departments.find((d) => d.id === selectedDepartmentId) ?? null;

  const filteredDepartments = useMemo(() => {
    return departments.filter((dept) => {
      const bySearch =
        !search.trim() ||
        dept.name.toLowerCase().includes(search.toLowerCase()) ||
        dept.code.toLowerCase().includes(search.toLowerCase());
      const bySize = sizeFilter === 'all' || dept.size === sizeFilter;
      const byActivity = activityFilter === 'all' || (activityFilter === 'active' ? dept.isActive : !dept.isActive);
      return bySearch && bySize && byActivity;
    });
  }, [departments, search, sizeFilter, activityFilter]);

  const departmentAlerts = useMemo(() => {
    if (!selectedDepartment) return [] as { type: DepartmentAlertType; text: string }[];
    const alerts: { type: DepartmentAlertType; text: string }[] = [];
    if (selectedDepartment.staffCount < 4) alerts.push({ type: 'understaffed', text: 'Understaffed for current patient demand' });
    if (selectedDepartment.performance.averageWaitMinutes > 30) alerts.push({ type: 'overbooked', text: 'Overbooked schedules detected this week' });
    if (!selectedDepartment.isActive) alerts.push({ type: 'inactive', text: 'Department is currently inactive' });
    return alerts;
  }, [selectedDepartment]);

  if (!canViewAdmin || readOnlyRole) {
    return (
      <div className="premium-card p-8 text-center page-transition">
        <h1 className="text-xl font-semibold text-gray-900">Administration</h1>
        <p className="text-sm text-gray-500 mt-2">Your role has read-only access to department information.</p>
      </div>
    );
  }

  const logAudit = (message: string) => {
    const entry = `${new Date().toLocaleString()} - ${userName}: ${message}`;
    setAuditLogs((prev) => [entry, ...prev].slice(0, 20));
  };

  const generateCode = (name: string) =>
    name
      .split(' ')
      .filter(Boolean)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('')
      .slice(0, 5);

  const saveDepartment = (assignNow: boolean) => {
    if (!canCreateDept && !isHod) return toast.error('No permission to create department');
    if (!departmentForm.name.trim()) return toast.error('Department name is required');
    const code = (departmentForm.code || generateCode(departmentForm.name)).toUpperCase();
    const head = staff.find((s) => s.id === departmentForm.headId);
    const newDept: DepartmentView = {
      id: `d-${Date.now()}`,
      hospitalId: departmentForm.hospitalId,
      name: departmentForm.name,
      code,
      description: departmentForm.description,
      headId: head?.id,
      headName: head?.name,
      workingHours: DAYS.map((_, idx) => ({
        dayOfWeek: idx,
        isOpen: idx !== 0,
        openTime: departmentForm.openTime,
        closeTime: departmentForm.closeTime,
        slotDuration: 30,
      })),
      allowedModules: departmentForm.moduleLinks,
      staffCount: assignNow ? departmentForm.assignedStaffIds.length : 0,
      patientCount: 0,
      isActive: true,
      createdAt: new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString().slice(0, 10),
      size: departmentForm.assignedStaffIds.length > 9 ? 'large' : departmentForm.assignedStaffIds.length > 4 ? 'medium' : 'small',
      location: departmentForm.location || 'Not assigned',
      linkedServices: departmentForm.linkedServices,
      activityLogs: ['Department created'],
      resources: { rooms: 0, equipment: 0, beds: 0 },
      performance: { patientsHandled: 0, appointmentsCompleted: 0, revenueGenerated: 0, averageWaitMinutes: 0 },
      assignedStaffIds: assignNow ? departmentForm.assignedStaffIds : [],
    };
    setDepartments((prev) => [newDept, ...prev]);
    setSelectedDepartmentId(newDept.id);
    setShowAddDepartment(false);
    setDepartmentForm({
      name: '',
      code: '',
      description: '',
      headId: '',
      assignedStaffIds: [],
      linkedServices: [],
      moduleLinks: ['appointments', 'emr'],
      location: '',
      hospitalId: selectedFacilityId,
      openTime: '08:00',
      closeTime: '17:00',
    });
    logAudit(`Created department ${newDept.name} (${newDept.code})`);
    toast.success(assignNow ? 'Department created and staff assigned' : 'Department created');
  };

  const addStaffToDepartment = () => {
    if (!selectedDepartment) return;
    if (!canManageDepartment) return toast.error('No permission');
    const available = staff.find((s) => !selectedDepartment.assignedStaffIds.includes(s.id) && s.hospitalId === selectedDepartment.hospitalId);
    if (!available) return toast.message('No available staff to auto-assign');
    setDepartments((prev) =>
      prev.map((d) =>
        d.id === selectedDepartment.id
          ? {
              ...d,
              assignedStaffIds: [...d.assignedStaffIds, available.id],
              staffCount: d.staffCount + 1,
              activityLogs: [`Auto-assigned ${available.name}`, ...d.activityLogs].slice(0, 8),
            }
          : d,
      ),
    );
    logAudit(`Auto-assigned ${available.name} to ${selectedDepartment.name}`);
    toast.success(`${available.name} assigned to ${selectedDepartment.name}`);
  };

  const deleteDepartment = () => {
    if (!selectedDepartment) return;
    if (!canDeleteDept && !isSuperAdmin) return toast.error('No permission to delete');
    setDepartments((prev) => prev.filter((d) => d.id !== selectedDepartment.id));
    logAudit(`Deleted department ${selectedDepartment.name}`);
    setSelectedDepartmentId(departments.find((d) => d.id !== selectedDepartment.id)?.id ?? null);
    toast.success('Department deleted');
  };

  const transferStaff = () => {
    if (!selectedDepartment) return;
    if (!canManageDepartment) return toast.error('No permission');
    const staffMember = staff.find((s) => s.id === transferStaffId);
    const target = departments.find((d) => d.code === transferTargetCode);
    if (!staffMember || !target || target.id === selectedDepartment.id) return toast.error('Pick valid transfer details');
    if (!selectedDepartment.assignedStaffIds.includes(staffMember.id)) return toast.error('Staff not in selected department');

    setDepartments((prev) =>
      prev.map((d) => {
        if (d.id === selectedDepartment.id) {
          return {
            ...d,
            assignedStaffIds: d.assignedStaffIds.filter((id) => id !== staffMember.id),
            staffCount: Math.max(0, d.staffCount - 1),
            activityLogs: [`Transferred ${staffMember.name} to ${target.name}`, ...d.activityLogs].slice(0, 8),
          };
        }
        if (d.id === target.id) {
          return {
            ...d,
            assignedStaffIds: Array.from(new Set([...d.assignedStaffIds, staffMember.id])),
            staffCount: d.staffCount + 1,
            activityLogs: [`Received ${staffMember.name} from ${selectedDepartment.name}`, ...d.activityLogs].slice(0, 8),
          };
        }
        return d;
      }),
    );
    setTransferLogs((prev) => [
      {
        id: `t-${Date.now()}`,
        staffId: staffMember.id,
        staffName: staffMember.name,
        fromDepartmentCode: selectedDepartment.code,
        toDepartmentCode: target.code,
        when: new Date().toISOString(),
      },
      ...prev,
    ]);
    logAudit(`Transferred ${staffMember.name} from ${selectedDepartment.code} to ${target.code}`);
    setTransferStaffId('');
    setTransferTargetCode('');
    setShowTransferDialog(false);
    toast.success('Staff transfer completed');
  };

  const saveFacilityConfig = () => {
    if (!canSystemConfigure && !isHospitalAdmin) return toast.error('Insufficient permission');
    logAudit('Updated facility operational settings');
    toast.success('Facility settings saved');
  };

  const addFacility = () => {
    if (!canSystemConfigure) return toast.error('Only Super Admin can add facilities');
    if (!facilityForm.name.trim() || !facilityForm.code.trim()) return toast.error('Facility name and code are required');
    const created: FacilityUnit = {
      id: `f-${Date.now()}`,
      name: facilityForm.name,
      code: facilityForm.code.toUpperCase(),
      address: facilityForm.address,
      city: facilityForm.city,
      state: facilityForm.state,
      phone: facilityForm.phone,
      email: facilityForm.email,
      isPrimary: false,
      active: true,
    };
    setFacilities((prev) => [created, ...prev]);
    setShowFacilityDialog(false);
    setFacilityForm({ name: '', code: '', address: '', city: '', state: '', phone: '', email: '' });
    logAudit(`Added facility ${created.name}`);
    toast.success('New facility added');
  };

  return (
    <div className="space-y-4 md:space-y-6 page-transition">
      <div className="sticky top-0 z-20 -mx-4 px-4 py-3 md:mx-0 md:px-0 bg-background/90 backdrop-blur-md border-b border-white/40 md:border-0">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#1E4ED8]">Administration</h1>
            <p className="text-sm text-gray-500 mt-1">Department governance, facility controls, and multi-hospital operational structure</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2 rounded-xl" onClick={() => setActiveTab('facility')}>
              <Settings className="w-4 h-4" />
              Facility Settings
            </Button>
            <Button
              className="bg-gradient-to-r from-royal-500 to-royal-700 text-white gap-2 rounded-xl"
              onClick={() => setShowAddDepartment(true)}
              disabled={!canCreateDept && !isHod}
            >
              <Plus className="w-4 h-4" />
              Add Department
            </Button>
          </div>
        </div>
      </div>

      <div className="flex gap-2 p-1 bg-gray-100 rounded-xl w-fit">
        {[
          { id: 'departments' as const, label: 'Departments', icon: Building2 },
          { id: 'facility' as const, label: 'Facility Settings', icon: Hospital },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn('flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200', activeTab === tab.id ? 'bg-white text-royal-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'departments' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 md:gap-6">
          <div className="xl:col-span-4 space-y-4">
            <div className="premium-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">Department Directory</h3>
                <span className="px-2 py-1 rounded-full bg-royal-100 text-royal-700 text-xs font-medium">{filteredDepartments.length}</span>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input className="pl-9 rounded-xl" placeholder="Search departments..." value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-gray-500">Size</Label>
                  <select className="w-full mt-1 rounded-lg border border-input px-2 py-2 text-sm" value={sizeFilter} onChange={(e) => setSizeFilter(e.target.value as 'all' | DeptSize)}>
                    <option value="all">All</option>
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Activity</Label>
                  <select className="w-full mt-1 rounded-lg border border-input px-2 py-2 text-sm" value={activityFilter} onChange={(e) => setActivityFilter(e.target.value as 'all' | 'active' | 'inactive')}>
                    <option value="all">All</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="text-xs text-gray-500 flex items-center gap-1">
                <Filter className="w-3 h-3" />
                Filter by size/activity for operational reviews
              </div>
            </div>

            <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
              {filteredDepartments.map((dept) => (
                <button
                  key={dept.id}
                  onClick={() => setSelectedDepartmentId(dept.id)}
                  className={cn(
                    'w-full text-left premium-card p-4 transition-all duration-200',
                    selectedDepartmentId === dept.id ? 'ring-2 ring-royal-200 bg-royal-50/60' : '',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-gray-900">{dept.name}</p>
                      <p className="text-xs text-gray-500 mt-1">{dept.code}</p>
                    </div>
                    <ChevronRight className={cn('w-4 h-4 text-gray-400 transition-transform', selectedDepartmentId === dept.id && 'rotate-90')} />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700">{dept.staffCount} staff</span>
                    <span className={cn('px-2 py-1 rounded-full', dept.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600')}>
                      {dept.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="xl:col-span-8">
            {!selectedDepartment ? (
              <div className="premium-card p-8 text-center text-gray-500">Select a department to view details.</div>
            ) : (
              <div className="space-y-4 animate-page-fade-in">
                <div className="premium-card p-5 md:p-6">
                  <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-xl font-bold text-gray-900">{selectedDepartment.name}</h2>
                        <span className="px-2 py-1 rounded-full bg-royal-100 text-royal-700 text-xs">{selectedDepartment.code}</span>
                        <span className={cn('px-2 py-1 rounded-full text-xs', selectedDepartment.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600')}>
                          {selectedDepartment.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mt-2">{selectedDepartment.description}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={addStaffToDepartment} disabled={!canManageDepartment}>
                        <UserPlus className="w-4 h-4 mr-2" />
                        Add Staff
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setShowTransferDialog(true)} disabled={!canManageDepartment}>
                        <ArrowRightLeft className="w-4 h-4 mr-2" />
                        Transfer Staff
                      </Button>
                      <Button size="sm" variant="outline" disabled={!canEditDept}>
                        <Edit3 className="w-4 h-4 mr-2" />
                        Edit Department
                      </Button>
                      <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50" onClick={deleteDepartment} disabled={!canDeleteDept && !isSuperAdmin}>
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
                  <MetricCard icon={Users} label="Staff Count" value={selectedDepartment.staffCount.toString()} />
                  <MetricCard icon={CalendarClock} label="Patients Handled" value={selectedDepartment.performance.patientsHandled.toLocaleString()} />
                  <MetricCard icon={BarChart3} label="Appointments" value={selectedDepartment.performance.appointmentsCompleted.toLocaleString()} />
                  <MetricCard icon={Briefcase} label="Revenue" value={`NGN ${selectedDepartment.performance.revenueGenerated.toLocaleString()}`} />
                </div>

                <div className="grid xl:grid-cols-2 gap-4">
                  <div className="premium-card p-5">
                    <h3 className="font-semibold text-gray-900 mb-3">Overview</h3>
                    <div className="space-y-3 text-sm">
                      <div className="flex items-center justify-between"><span className="text-gray-500">Head of Department</span><span className="font-medium">{selectedDepartment.headName ?? 'Not assigned'}</span></div>
                      <div className="flex items-center justify-between"><span className="text-gray-500">Location</span><span className="font-medium">{selectedDepartment.location}</span></div>
                      <div className="flex items-center justify-between"><span className="text-gray-500">Average Wait Time</span><span className="font-medium">{selectedDepartment.performance.averageWaitMinutes} mins</span></div>
                      <div className="flex items-center justify-between"><span className="text-gray-500">Assigned Facility</span><span className="font-medium">{facilities.find((f) => f.id === selectedDepartment.hospitalId)?.name}</span></div>
                    </div>
                  </div>
                  <div className="premium-card p-5">
                    <h3 className="font-semibold text-gray-900 mb-3">Module Integration</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedDepartment.allowedModules.map((module) => (
                        <span key={module} className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-medium">
                          {DEPARTMENT_MODULE_LABELS[module]}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-3">Integrated with HR, Appointments, EMR, Billing, and Analytics contexts.</p>
                  </div>
                </div>

                <div className="grid xl:grid-cols-2 gap-4">
                  <div className="premium-card p-5">
                    <h3 className="font-semibold text-gray-900 mb-3">Staff List (HR Linked)</h3>
                    <div className="space-y-2">
                      {selectedDepartment.assignedStaffIds.length === 0 ? (
                        <p className="text-sm text-gray-500">No staff assigned yet.</p>
                      ) : (
                        selectedDepartment.assignedStaffIds.map((id) => {
                          const member = staff.find((s) => s.id === id);
                          if (!member) return null;
                          return (
                            <div key={id} className="p-3 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium text-gray-900">{member.name}</p>
                                <p className="text-xs text-gray-500">{member.role}</p>
                              </div>
                              <span className="text-xs px-2 py-1 rounded-full bg-royal-100 text-royal-700">HR linked</span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="premium-card p-5">
                    <h3 className="font-semibold text-gray-900 mb-3">Smart Alerts</h3>
                    <div className="space-y-2">
                      {departmentAlerts.length === 0 ? (
                        <p className="text-sm text-green-700 bg-green-50 rounded-xl p-3 border border-green-100">No active risk alerts for this department.</p>
                      ) : (
                        departmentAlerts.map((alert) => (
                          <div key={alert.type} className="p-3 rounded-xl bg-amber-50 border border-amber-100 text-amber-800 text-sm flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" />
                            {alert.text}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid xl:grid-cols-2 gap-4">
                  <div className="premium-card p-5">
                    <h3 className="font-semibold text-gray-900 mb-3">Operational Hours</h3>
                    <div className="space-y-2">
                      {selectedDepartment.workingHours.map((wh) => (
                        <div key={wh.dayOfWeek} className="p-2.5 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-between text-sm">
                          <span className="font-medium text-gray-700">{DAYS[wh.dayOfWeek]}</span>
                          {wh.isOpen ? (
                            <span className="text-gray-600 flex items-center gap-1"><Clock className="w-3 h-3" />{wh.openTime}-{wh.closeTime}</span>
                          ) : (
                            <span className="text-gray-400">Closed</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="premium-card p-5">
                    <h3 className="font-semibold text-gray-900 mb-3">Resources & Workflow</h3>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className="p-3 rounded-xl bg-gray-50 text-center">
                        <p className="text-lg font-bold text-gray-900">{selectedDepartment.resources.rooms}</p>
                        <p className="text-xs text-gray-500">Rooms</p>
                      </div>
                      <div className="p-3 rounded-xl bg-gray-50 text-center">
                        <p className="text-lg font-bold text-gray-900">{selectedDepartment.resources.equipment}</p>
                        <p className="text-xs text-gray-500">Equipment</p>
                      </div>
                      <div className="p-3 rounded-xl bg-gray-50 text-center">
                        <p className="text-lg font-bold text-gray-900">{selectedDepartment.resources.beds}</p>
                        <p className="text-xs text-gray-500">Beds</p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-gray-100 p-3 bg-gray-50 text-sm text-gray-700">
                      <p className="font-medium mb-1">Patient Flow</p>
                      <p>{workflowSteps.join(' -> ')}</p>
                    </div>
                  </div>
                </div>

                <div className="grid xl:grid-cols-2 gap-4">
                  <div className="premium-card p-5">
                    <h3 className="font-semibold text-gray-900 mb-3">Department Activity Logs</h3>
                    <div className="space-y-2">
                      {selectedDepartment.activityLogs.map((log) => (
                        <div key={log} className="p-3 rounded-lg bg-gray-50 border border-gray-100 text-sm text-gray-700">{log}</div>
                      ))}
                    </div>
                  </div>
                  <div className="premium-card p-5">
                    <h3 className="font-semibold text-gray-900 mb-3">Internal Transfer History</h3>
                    <div className="space-y-2">
                      {transferLogs.length === 0 ? (
                        <p className="text-sm text-gray-500">No transfer records yet.</p>
                      ) : (
                        transferLogs.slice(0, 6).map((log) => (
                          <div key={log.id} className="p-3 rounded-lg bg-gray-50 border border-gray-100 text-sm text-gray-700">
                            {log.staffName}: {log.fromDepartmentCode} {'->'} {log.toDepartmentCode}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'facility' && (
        <div className="space-y-4">
          <div className="grid lg:grid-cols-3 gap-4">
            <div className="premium-card p-5 lg:col-span-2">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div>
                  <h3 className="font-semibold text-gray-900">General Info</h3>
                  <p className="text-sm text-gray-500 mt-1">Hospital profile, contact, and branding.</p>
                </div>
                <Button variant="outline" className="rounded-xl gap-2"><Upload className="w-4 h-4" />Upload Logo</Button>
              </div>
              <div className="grid md:grid-cols-2 gap-3 mt-4">
                <Input value={facilities.find((f) => f.id === selectedFacilityId)?.name ?? ''} readOnly />
                <Input value={facilities.find((f) => f.id === selectedFacilityId)?.address ?? ''} readOnly />
                <Input value={facilities.find((f) => f.id === selectedFacilityId)?.phone ?? ''} readOnly />
                <Input value={facilities.find((f) => f.id === selectedFacilityId)?.email ?? ''} readOnly />
              </div>
            </div>
            <div className="premium-card p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Facility Selection</h3>
              <select className="w-full rounded-xl border border-input px-3 py-2 text-sm" value={selectedFacilityId} onChange={(e) => setSelectedFacilityId(e.target.value)}>
                {facilities.map((facility) => (
                  <option key={facility.id} value={facility.id}>{facility.name}</option>
                ))}
              </select>
              <Button className="mt-3 w-full bg-gradient-to-r from-royal-500 to-royal-700 text-white rounded-xl" onClick={() => setShowFacilityDialog(true)} disabled={!canSystemConfigure}>
                <Plus className="w-4 h-4 mr-2" />
                Add Facility
              </Button>
            </div>
          </div>

          <div className="grid xl:grid-cols-2 gap-4">
            <div className="premium-card p-5">
              <h3 className="font-semibold text-gray-900 mb-3">Operational Settings</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Max Patients/Day</Label>
                  <Input type="number" value={facilityConfig.maxPatientsPerDay} onChange={(e) => setFacilityConfig((prev) => ({ ...prev, maxPatientsPerDay: Number(e.target.value) }))} />
                </div>
                <div>
                  <Label>Buffer (mins)</Label>
                  <Input type="number" value={facilityConfig.appointmentBufferMinutes} onChange={(e) => setFacilityConfig((prev) => ({ ...prev, appointmentBufferMinutes: Number(e.target.value) }))} />
                </div>
              </div>
              <div className="flex items-center justify-between mt-4 p-3 rounded-xl border border-gray-100 bg-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-800">Emergency 24/7 Availability</p>
                  <p className="text-xs text-gray-500">Overrides standard working hours.</p>
                </div>
                <Switch checked={facilityConfig.emergency24x7} onCheckedChange={(checked) => setFacilityConfig((prev) => ({ ...prev, emergency24x7: checked }))} disabled={!canSystemConfigure && !isHospitalAdmin} />
              </div>
            </div>

            <div className="premium-card p-5">
              <h3 className="font-semibold text-gray-900 mb-3">System Configuration</h3>
              <div className="space-y-2">
                {[
                  { key: 'telemedicineEnabled', label: 'Telemedicine', icon: CalendarClock },
                  { key: 'labEnabled', label: 'Laboratory', icon: FlaskConical },
                  { key: 'pharmacyEnabled', label: 'Pharmacy', icon: Pill },
                  { key: 'billingEnabled', label: 'Billing', icon: Briefcase },
                ].map((item) => (
                  <div key={item.key} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <span className="text-sm font-medium text-gray-800 flex items-center gap-2"><item.icon className="w-4 h-4 text-gray-500" />{item.label}</span>
                    <Switch
                      checked={facilityConfig[item.key as keyof FacilityConfig] as boolean}
                      onCheckedChange={(checked) =>
                        setFacilityConfig((prev) => ({ ...prev, [item.key]: checked }))
                      }
                      disabled={!canSystemConfigure}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="premium-card p-5">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
              <div>
                <h3 className="font-semibold text-gray-900">Multi-Hospital Configuration</h3>
                <p className="text-sm text-gray-500">Assign departments and staff to facilities for scalable operations.</p>
              </div>
              <Button variant="outline" className="rounded-xl gap-2" onClick={saveFacilityConfig}>
                <Save className="w-4 h-4" />
                Save Config
              </Button>
            </div>
            <div className="space-y-3">
              {facilities.map((facility) => (
                <div key={facility.id} className="p-4 rounded-2xl border border-gray-100 bg-white/80">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <p className="font-semibold text-gray-900">{facility.name}</p>
                      <p className="text-xs text-gray-500">{facility.code} • {facility.city}, {facility.state}</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {facility.isPrimary && <span className="px-2 py-1 rounded-full bg-royal-100 text-royal-700">Primary</span>}
                      <span className={cn('px-2 py-1 rounded-full', facility.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600')}>
                        {facility.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                  <div className="grid md:grid-cols-3 gap-3 mt-3 text-sm">
                    <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                      <p className="text-xs text-gray-500">Departments</p>
                      <p className="font-semibold text-gray-900">{departments.filter((d) => d.hospitalId === facility.id).length}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                      <p className="text-xs text-gray-500">Assigned Staff</p>
                      <p className="font-semibold text-gray-900">{staff.filter((s) => s.hospitalId === facility.id).length}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-gray-50 border border-gray-100">
                      <p className="text-xs text-gray-500">Department Mapping</p>
                      <p className="font-semibold text-gray-900">Enabled</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="premium-card p-5">
            <h3 className="font-semibold text-gray-900 mb-3">Administration Audit Logs</h3>
            <div className="space-y-2">
              {auditLogs.length === 0 ? (
                <p className="text-sm text-gray-500">No admin actions logged yet.</p>
              ) : (
                auditLogs.map((log) => (
                  <div key={log} className="p-3 rounded-lg bg-gray-50 border border-gray-100 text-sm text-gray-700">{log}</div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <Dialog open={showAddDepartment} onOpenChange={setShowAddDepartment}>
        <DialogContent className="glass-panel border-white/60 max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Department</DialogTitle>
            <DialogDescription>Create a department with module links, staff assignment, and operating structure.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label>Department Name</Label>
                <Input value={departmentForm.name} onChange={(e) => setDepartmentForm((prev) => ({ ...prev, name: e.target.value, code: prev.code || generateCode(e.target.value) }))} />
              </div>
              <div>
                <Label>Department Code</Label>
                <Input value={departmentForm.code} onChange={(e) => setDepartmentForm((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))} />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={departmentForm.description} onChange={(e) => setDepartmentForm((prev) => ({ ...prev, description: e.target.value }))} className="min-h-[72px]" />
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label>Head of Department</Label>
                <select className="w-full mt-1 rounded-md border border-input px-3 py-2 text-sm" value={departmentForm.headId} onChange={(e) => setDepartmentForm((prev) => ({ ...prev, headId: e.target.value }))}>
                  <option value="">Select Head</option>
                  {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Facility</Label>
                <select className="w-full mt-1 rounded-md border border-input px-3 py-2 text-sm" value={departmentForm.hospitalId} onChange={(e) => setDepartmentForm((prev) => ({ ...prev, hospitalId: e.target.value }))}>
                  {facilities.map((facility) => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <Label>Operating Time (Open)</Label>
                <Input type="time" value={departmentForm.openTime} onChange={(e) => setDepartmentForm((prev) => ({ ...prev, openTime: e.target.value }))} />
              </div>
              <div>
                <Label>Operating Time (Close)</Label>
                <Input type="time" value={departmentForm.closeTime} onChange={(e) => setDepartmentForm((prev) => ({ ...prev, closeTime: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Location (floor/wing)</Label>
              <Input value={departmentForm.location} onChange={(e) => setDepartmentForm((prev) => ({ ...prev, location: e.target.value }))} />
            </div>
            <div>
              <Label>Assigned Staff</Label>
              <div className="mt-2 grid md:grid-cols-2 gap-2">
                {staff
                  .filter((member) => member.hospitalId === departmentForm.hospitalId)
                  .map((member) => (
                    <label key={member.id} className="flex items-center gap-2 text-sm p-2 rounded-lg border border-gray-100 bg-gray-50">
                      <Checkbox
                        checked={departmentForm.assignedStaffIds.includes(member.id)}
                        onCheckedChange={(checked) =>
                          setDepartmentForm((prev) => ({
                            ...prev,
                            assignedStaffIds: checked
                              ? Array.from(new Set([...prev.assignedStaffIds, member.id]))
                              : prev.assignedStaffIds.filter((id) => id !== member.id),
                          }))
                        }
                      />
                      {member.name}
                    </label>
                  ))}
              </div>
            </div>
            <div>
              <Label>Linked Services</Label>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2">
                {['Lab', 'Pharmacy', 'Appointments', 'EMR', 'Billing', 'Telemedicine'].map((service) => (
                  <label key={service} className="flex items-center gap-2 text-sm p-2 rounded-lg border border-gray-100 bg-gray-50">
                    <Checkbox
                      checked={departmentForm.linkedServices.includes(service)}
                      onCheckedChange={(checked) =>
                        setDepartmentForm((prev) => ({
                          ...prev,
                          linkedServices: checked ? [...prev.linkedServices, service] : prev.linkedServices.filter((s) => s !== service),
                        }))
                      }
                    />
                    {service}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label>Department to Module Linking</Label>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2">
                {(['appointments', 'emr', 'laboratory', 'pharmacy', 'billing', 'analytics', 'hr'] as PermissionModule[]).map((module) => (
                  <label key={module} className="flex items-center gap-2 text-sm p-2 rounded-lg border border-gray-100 bg-gray-50">
                    <Checkbox
                      checked={departmentForm.moduleLinks.includes(module)}
                      onCheckedChange={(checked) =>
                        setDepartmentForm((prev) => ({
                          ...prev,
                          moduleLinks: checked ? [...prev.moduleLinks, module] : prev.moduleLinks.filter((m) => m !== module),
                        }))
                      }
                    />
                    {DEPARTMENT_MODULE_LABELS[module]}
                  </label>
                ))}
              </div>
            </div>
            {!canSystemConfigure && (
              <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 mt-0.5" />
                Department-based permission override is limited for your role. Super Admin manages system-wide overrides.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDepartment(false)}>Cancel</Button>
            <Button variant="outline" onClick={() => saveDepartment(false)}>Save</Button>
            <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white" onClick={() => saveDepartment(true)}>
              <Users className="w-4 h-4 mr-2" />
              Save & Assign Staff
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTransferDialog} onOpenChange={setShowTransferDialog}>
        <DialogContent className="glass-panel border-white/60 max-w-lg">
          <DialogHeader>
            <DialogTitle>Transfer Staff</DialogTitle>
            <DialogDescription>Move staff between departments and track transfer history.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Staff Member</Label>
              <select className="w-full mt-1 rounded-md border border-input px-3 py-2 text-sm" value={transferStaffId} onChange={(e) => setTransferStaffId(e.target.value)}>
                <option value="">Select staff</option>
                {selectedDepartment?.assignedStaffIds.map((id) => {
                  const member = staff.find((s) => s.id === id);
                  if (!member) return null;
                  return <option key={member.id} value={member.id}>{member.name}</option>;
                })}
              </select>
            </div>
            <div>
              <Label>Target Department</Label>
              <select className="w-full mt-1 rounded-md border border-input px-3 py-2 text-sm" value={transferTargetCode} onChange={(e) => setTransferTargetCode(e.target.value)}>
                <option value="">Select target</option>
                {departments.filter((d) => d.id !== selectedDepartment?.id).map((dept) => (
                  <option key={dept.id} value={dept.code}>{dept.name} ({dept.code})</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTransferDialog(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white" onClick={transferStaff}>
              <ArrowRightLeft className="w-4 h-4 mr-2" />
              Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showFacilityDialog} onOpenChange={setShowFacilityDialog}>
        <DialogContent className="glass-panel border-white/60 max-w-xl">
          <DialogHeader>
            <DialogTitle>Add Facility</DialogTitle>
            <DialogDescription>Multi-hospital setup for VitaLink network scaling.</DialogDescription>
          </DialogHeader>
          <div className="grid md:grid-cols-2 gap-3">
            <div><Label>Name</Label><Input value={facilityForm.name} onChange={(e) => setFacilityForm((prev) => ({ ...prev, name: e.target.value }))} /></div>
            <div><Label>Code</Label><Input value={facilityForm.code} onChange={(e) => setFacilityForm((prev) => ({ ...prev, code: e.target.value }))} /></div>
            <div className="md:col-span-2"><Label>Address</Label><Input value={facilityForm.address} onChange={(e) => setFacilityForm((prev) => ({ ...prev, address: e.target.value }))} /></div>
            <div><Label>City</Label><Input value={facilityForm.city} onChange={(e) => setFacilityForm((prev) => ({ ...prev, city: e.target.value }))} /></div>
            <div><Label>State</Label><Input value={facilityForm.state} onChange={(e) => setFacilityForm((prev) => ({ ...prev, state: e.target.value }))} /></div>
            <div><Label>Phone</Label><Input value={facilityForm.phone} onChange={(e) => setFacilityForm((prev) => ({ ...prev, phone: e.target.value }))} /></div>
            <div><Label>Email</Label><Input type="email" value={facilityForm.email} onChange={(e) => setFacilityForm((prev) => ({ ...prev, email: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFacilityDialog(false)}>Cancel</Button>
            <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white" onClick={addFacility}>
              <Plus className="w-4 h-4 mr-2" />
              Add Facility
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="premium-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{label}</p>
        <Icon className="w-4 h-4 text-gray-400" />
      </div>
      <p className="text-xl font-bold text-gray-900 mt-2">{value}</p>
    </div>
  );
}
