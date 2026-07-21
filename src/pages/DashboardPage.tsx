import { useState, useEffect } from 'react';
import { 
  Users, 
  CalendarCheck, 
  FlaskConical, 
  Pill, 
  TrendingUp, 
  CreditCard,
  Activity,
  Clock,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Search,
  ChevronRight,
  UserPlus,
  CalendarPlus,
  Stethoscope,
  CalendarClock,
  Ban,
  MessageSquare,
  FileText,
  Video,
  NotebookPen,
  ClipboardList,
  Printer,
  Phone,
  Mail,
  Wallet,
  HeartPulse,
  WifiOff,
  UserCheck,
  Timer,
  Siren,
  BadgeDollarSign,
  Filter,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { PatientOnboardingWizard } from '@/components/patients/PatientOnboardingWizard';
import { DashboardHero } from '@/components/dashboard/DashboardHero';
import { VitaCardWidget } from '@/components/dashboard/VitaCardWidget';
import {
  appointmentStatuses,
  useAppointments,
  type AppointmentAction,
  type AppointmentRecord,
  type AppointmentStatus,
} from '@/contexts/AppointmentContext';

interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeType?: 'increase' | 'decrease' | 'neutral';
  icon: React.ElementType;
  color: string;
  subtitle?: string;
}

function StatCard({ title, value, change, changeType, icon: Icon, color, subtitle }: StatCardProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const numericValue = typeof value === 'string' ? parseInt(value.replace(/[^0-9]/g, '')) || 0 : value;

  useEffect(() => {
    const duration = 800;
    const steps = 30;
    const increment = numericValue / steps;
    let current = 0;
    let frame = 0;
    
    const timer = setInterval(() => {
      frame++;
      current = Math.min(numericValue, increment * frame);
      setDisplayValue(Math.floor(current));
      if (frame >= steps) {
        setDisplayValue(numericValue);
        clearInterval(timer);
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [numericValue]);

  const display = typeof value === 'string' && value.includes('₦') 
    ? `₦${displayValue.toLocaleString()}` 
    : displayValue.toLocaleString();

  return (
    <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl p-5 shadow-soft hover:shadow-card transition-all duration-300 hover:-translate-y-1 cursor-pointer group card-equal-height h-full min-w-0 overflow-hidden">
      <div className="flex items-start justify-between mb-4 gap-2 min-w-0">
        <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0", color)}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        {change !== undefined && (
          <div className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium flex-shrink-0",
            changeType === 'increase' ? "bg-green-100 text-green-700" :
            changeType === 'decrease' ? "bg-red-100 text-red-700" :
            "bg-gray-100 text-gray-700"
          )}>
            {changeType === 'increase' ? <TrendingUp className="w-3 h-3" /> :
             changeType === 'decrease' ? <TrendingUp className="w-3 h-3 rotate-180" /> : null}
            {change > 0 ? '+' : ''}{change}%
          </div>
        )}
      </div>
      <h3 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1 truncate tabular-nums">{display}</h3>
      <p className="text-sm text-gray-500 truncate">{title}</p>
      {subtitle && <p className="text-xs text-gray-400 mt-1 text-clamp-2">{subtitle}</p>}
    </div>
  );
}

// Quick Action Modals
function NewPatientModal({
  open,
  onClose,
  creatorName,
  canCreatePatient,
}: {
  open: boolean;
  onClose: () => void;
  creatorName: string;
  canCreatePatient: boolean;
}) {
  return (
    <PatientOnboardingWizard
      open={open}
      onOpenChange={onClose}
      tenantId="lagos-central-hospital"
      creatorName={creatorName}
      canCreate={canCreatePatient}
    />
  );
}

function BookAppointmentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [patient, setPatient] = useState('');
  const [doctor, setDoctor] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState('09:00');
  const [type, setType] = useState('consultation');

  const handleBook = () => {
    toast.success('Appointment booked successfully!', {
      description: `${patient} booked with ${doctor} on ${date} at ${time}`,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg bg-white/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="text-[#1E4ED8] flex items-center gap-2">
            <CalendarPlus className="w-5 h-5" />
            Book Appointment
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 mt-4">
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Select Patient *</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input 
                placeholder="Search patient by name or UHIN..." 
                className="pl-10"
                value={patient}
                onChange={(e) => setPatient(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Select Doctor *</label>
            <select 
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
              value={doctor}
              onChange={(e) => setDoctor(e.target.value)}
            >
              <option value="">Select doctor</option>
              <option value="Dr. Sarah Johnson">Dr. Sarah Johnson - General Medicine</option>
              <option value="Dr. Michael Chen">Dr. Michael Chen - Cardiology</option>
              <option value="Dr. Emily Davis">Dr. Emily Davis - Pediatrics</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-700 mb-1 block">Date *</label>
              <Input 
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700 mb-1 block">Time *</label>
              <select 
                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              >
                <option value="08:00">08:00 AM</option>
                <option value="09:00">09:00 AM</option>
                <option value="10:00">10:00 AM</option>
                <option value="11:00">11:00 AM</option>
                <option value="14:00">02:00 PM</option>
                <option value="15:00">03:00 PM</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Appointment Type</label>
            <select 
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="consultation">Consultation</option>
              <option value="follow-up">Follow-up</option>
              <option value="emergency">Emergency</option>
              <option value="routine-check">Routine Check</option>
            </select>
          </div>
          
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button 
              className="bg-[#1E4ED8] hover:bg-[#1E4ED8]/90 text-white"
              onClick={handleBook}
            >
              <CalendarCheck className="w-4 h-4 mr-2" />
              Book Appointment
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OrderLabModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [patient, setPatient] = useState('');
  const [testType, setTestType] = useState('');
  const [priority, setPriority] = useState('routine');

  const handleOrder = () => {
    toast.success('Lab order created!', {
      description: `${testType} ordered for ${patient}. Lab will be notified.`,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg bg-white/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="text-[#1E4ED8] flex items-center gap-2">
            <FlaskConical className="w-5 h-5" />
            Order Lab Test
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 mt-4">
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Select Patient *</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input 
                placeholder="Search patient..." 
                className="pl-10"
                value={patient}
                onChange={(e) => setPatient(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Test Type *</label>
            <select 
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
              value={testType}
              onChange={(e) => setTestType(e.target.value)}
            >
              <option value="">Select test</option>
              <option value="CBC">Complete Blood Count (CBC)</option>
              <option value="Lipid Panel">Lipid Panel</option>
              <option value="HbA1c">HbA1c</option>
              <option value="Urinalysis">Urinalysis</option>
              <option value="Thyroid Function">Thyroid Function</option>
              <option value="Liver Function">Liver Function</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Priority</label>
            <div className="flex gap-2">
              {['routine', 'urgent', 'stat'].map((p) => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all",
                    priority === p 
                      ? p === 'stat' ? "bg-red-100 text-red-700 border-2 border-red-300" :
                        p === 'urgent' ? "bg-amber-100 text-amber-700 border-2 border-amber-300" :
                        "bg-blue-100 text-blue-700 border-2 border-blue-300"
                      : "bg-gray-50 text-gray-600 border-2 border-transparent hover:bg-gray-100"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button 
              className="bg-[#1E4ED8] hover:bg-[#1E4ED8]/90 text-white"
              onClick={handleOrder}
            >
              <FlaskConical className="w-4 h-4 mr-2" />
              Order Test
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DispenseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [patient, setPatient] = useState('');
  const [medication, setMedicication] = useState('');
  const [quantity, setQuantity] = useState(1);

  const handleDispense = () => {
    toast.success('Medication dispensed!', {
      description: `${quantity}x ${medication} dispensed to ${patient}. Inventory updated.`,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg bg-white/95 backdrop-blur-xl">
        <DialogHeader>
          <DialogTitle className="text-[#1E4ED8] flex items-center gap-2">
            <Pill className="w-5 h-5" />
            Dispense Medication
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 mt-4">
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Select Patient *</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input 
                placeholder="Search patient..." 
                className="pl-10"
                value={patient}
                onChange={(e) => setPatient(e.target.value)}
                autoFocus
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Medication *</label>
            <select 
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
              value={medication}
              onChange={(e) => setMedicication(e.target.value)}
            >
              <option value="">Select medication</option>
              <option value="Paracetamol 500mg">Paracetamol 500mg (245 in stock)</option>
              <option value="Amoxicillin 250mg">Amoxicillin 250mg (32 in stock - LOW)</option>
              <option value="Metformin 500mg">Metformin 500mg (189 in stock)</option>
              <option value="Amlodipine 5mg">Amlodipine 5mg (12 in stock - CRITICAL)</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Quantity</label>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                -
              </button>
              <span className="w-16 text-center font-semibold">{quantity}</span>
              <button 
                onClick={() => setQuantity(quantity + 1)}
                className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
              >
                +
              </button>
            </div>
          </div>
          
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button 
              className="bg-[#1E4ED8] hover:bg-[#1E4ED8]/90 text-white"
              onClick={handleDispense}
            >
              <Pill className="w-4 h-4 mr-2" />
              Dispense
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Skeleton Loader for stats
function StatCardSkeleton() {
  return (
    <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl p-5 animate-pulse card-equal-height h-full min-w-0">
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 rounded-xl bg-gray-200" />
        <div className="w-16 h-6 rounded-full bg-gray-200" />
      </div>
      <div className="w-24 h-8 bg-gray-200 rounded mb-2" />
      <div className="w-32 h-4 bg-gray-200 rounded" />
    </div>
  );
}

const statusStyles: Record<AppointmentStatus, string> = {
  confirmed: 'bg-green-100 text-green-700 border-green-200',
  'checked-in': 'bg-blue-100 text-blue-700 border-blue-200',
  pending: 'bg-amber-100 text-amber-700 border-amber-200',
  'in-consultation': 'bg-indigo-100 text-indigo-700 border-indigo-200',
  completed: 'bg-slate-100 text-slate-700 border-slate-200',
  cancelled: 'bg-red-100 text-red-700 border-red-200',
  'no-show': 'bg-gray-100 text-gray-700 border-gray-200',
  rescheduled: 'bg-purple-100 text-purple-700 border-purple-200',
  emergency: 'bg-red-100 text-red-800 border-red-300',
  'waiting-lab': 'bg-cyan-100 text-cyan-700 border-cyan-200',
  admitted: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const actionConfig: Array<{ id: AppointmentAction; label: string; icon: React.ElementType }> = [
  { id: 'check-in', label: 'Check-In Patient', icon: UserCheck },
  { id: 'start-consultation', label: 'Start Consultation', icon: Stethoscope },
  { id: 'reschedule', label: 'Reschedule', icon: CalendarClock },
  { id: 'cancel', label: 'Cancel Appointment', icon: Ban },
  { id: 'no-show', label: 'Mark as No Show', icon: AlertCircle },
  { id: 'send-reminder', label: 'Send Reminder', icon: MessageSquare },
  { id: 'view-record', label: 'View Patient Record', icon: FileText },
  { id: 'generate-invoice', label: 'Generate Invoice', icon: BadgeDollarSign },
  { id: 'join-telemedicine', label: 'Join Telemedicine', icon: Video },
  { id: 'add-notes', label: 'Add Clinical Notes', icon: NotebookPen },
  { id: 'triage', label: 'Queue for Triage', icon: ClipboardList },
  { id: 'print-slip', label: 'Print Queue Slip', icon: Printer },
];

export function DashboardPage() {
  const { canCreate, canView, currentRole, userName } = useAuth();
  const {
    doctors,
    filters,
    setFilters,
    visibleAppointments,
    updateStatus,
    runAction,
    canOpenAppointmentsHub,
    canRunAction,
    preserveDashboardContext,
    pendingSyncCount,
    isOnline,
  } = useAppointments();
  const [showNewPatient, setShowNewPatient] = useState(false);
  const [showBookAppointment, setShowBookAppointment] = useState(false);
  const [showOrderLab, setShowOrderLab] = useState(false);
  const [showDispense, setShowDispense] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<AppointmentRecord | null>(null);
  const [loading, setLoading] = useState(true);

  // Simulate loading
  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  const quickActions = [
    { 
      label: 'New Patient', 
      icon: UserPlus, 
      color: 'from-blue-500 to-blue-700',
      onClick: () => setShowNewPatient(true),
      permission: canCreate('Patients')
    },
    { 
      label: 'Book Appointment', 
      icon: CalendarPlus, 
      color: 'from-green-500 to-green-700',
      onClick: () => setShowBookAppointment(true),
      permission: canCreate('Appointments')
    },
    { 
      label: 'Order Lab Test', 
      icon: FlaskConical, 
      color: 'from-purple-500 to-purple-700',
      onClick: () => setShowOrderLab(true),
      permission: canCreate('Laboratory')
    },
    { 
      label: 'Dispense Meds', 
      icon: Pill, 
      color: 'from-amber-500 to-amber-700',
      onClick: () => setShowDispense(true),
      permission: canCreate('Pharmacy')
    },
  ].filter(action => action.permission);

  const dashboardAppointments = visibleAppointments(currentRole, userName);
  const upcomingAppointments = dashboardAppointments.slice(0, 5);
  const completedToday = dashboardAppointments.filter((appointment) => appointment.status === 'completed').length;
  const pendingToday = dashboardAppointments.filter((appointment) => ['pending', 'confirmed', 'checked-in', 'waiting-lab'].includes(appointment.status)).length;

  const pendingTasks = pendingToday + 18;
  const scheduledToday = 12;

  const heroKpis = [
    { label: "Today's Patients", value: String(scheduledToday), sublabel: 'Scheduled' },
    { label: 'Appointments', value: String(dashboardAppointments.length), sublabel: `${completedToday} done` },
    { label: 'Revenue', value: '₦1.2M', sublabel: '+23% vs yesterday' },
    { label: 'Pending Tasks', value: String(pendingTasks), sublabel: `${pendingToday} appts · 18 labs` },
  ];

  const dailySummary = `${scheduledToday} patients scheduled · ${dashboardAppointments.length} appointments · ${pendingTasks} items need attention`;

  const stats = [
    { title: 'Registry Total', value: '2,847', change: 12, changeType: 'increase' as const, icon: Users, color: 'bg-gradient-to-br from-blue-500 to-blue-700', subtitle: '+156 this month' },
    { title: 'Pending Lab Results', value: '18', change: -5, changeType: 'decrease' as const, icon: FlaskConical, color: 'bg-gradient-to-br from-vitamind-500 to-vitamind-700', subtitle: '3 urgent, 15 routine' },
    { title: 'Completed Today', value: completedToday, change: 8, changeType: 'increase' as const, icon: CalendarCheck, color: 'bg-gradient-to-br from-green-500 to-green-700', subtitle: `${pendingToday} still active` },
    { title: 'Claims Queue', value: '7', change: 2, changeType: 'neutral' as const, icon: CreditCard, color: 'bg-gradient-to-br from-slate-500 to-slate-700', subtitle: 'Billing follow-ups' },
  ];

  const recentActivity = [
    { id: 1, type: 'patient', message: 'New patient registered: Adebayo Johnson', time: '2 min ago', icon: UserPlus, color: 'bg-blue-500' },
    { id: 2, type: 'appointment', message: 'Appointment completed: Sarah Williams', time: '15 min ago', icon: CheckCircle2, color: 'bg-green-500' },
    { id: 3, type: 'lab', message: 'Lab results ready: Michael Brown', time: '32 min ago', icon: FlaskConical, color: 'bg-purple-500' },
    { id: 4, type: 'alert', message: 'Critical: High BP alert for patient #4521', time: '1 hour ago', icon: AlertCircle, color: 'bg-red-500' },
    { id: 5, type: 'billing', message: 'Invoice #VLI-2026-001 paid', time: '2 hours ago', icon: CreditCard, color: 'bg-amber-500' },
  ];

  const navigateToAppointments = () => {
    if (!canOpenAppointmentsHub(currentRole) || !canView('Appointments')) {
      toast.error('RBAC: Your role cannot open the full appointments module.');
      return;
    }
    preserveDashboardContext({
      date: filters.date,
      doctorId: filters.doctorId,
      department: filters.department,
      status: filters.status,
      query: filters.query,
    });
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { page: 'appointments' } }));
  };

  const handleAppointmentClick = (appointment: AppointmentRecord) => {
    setSelectedAppointment(appointment);
    toast.info(`Opening appointment: ${appointment.patient}`, {
      description: `${appointment.type} at ${appointment.time} with ${appointment.doctor}`,
    });
  };

  return (
    <div className="space-y-4 page-transition contain-layout min-w-0">
      <DashboardHero userName={userName} dailySummary={dailySummary} kpis={heroKpis} />

      <VitaCardWidget
        isOnline={isOnline}
        onTapCard={() => toast.info('Hold VitaCard near the reader')}
        onQrScan={() => toast.info('Opening QR scanner')}
      />

      {/* Secondary metrics */}
      <div className="dashboard-stat-grid">
        {loading 
          ? Array(4).fill(0).map((_, i) => <StatCardSkeleton key={i} />)
          : stats.map((stat) => (
              <StatCard key={stat.title} {...stat} />
            ))
        }
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Quick Actions */}
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-soft min-w-0 overflow-hidden">
            <h2 className="text-sm font-semibold text-gray-900 mb-3 truncate">Quick Actions</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              {quickActions.map((action) => (
                <button
                  key={action.label}
                  onClick={action.onClick}
                  className="flex flex-col items-center gap-1.5 p-2.5 sm:p-3 rounded-xl bg-gray-50 hover:bg-vitalink-50 border border-gray-100 hover:border-vitalink-200 transition-all duration-200 group min-w-0"
                >
                  <div className={cn("w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center transition-transform duration-200 group-hover:scale-110 bg-gradient-to-br shrink-0", action.color)}>
                    <action.icon className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                  </div>
                  <span className="text-xs sm:text-sm font-medium text-gray-700 text-center truncate w-full">{action.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Upcoming Appointments */}
          <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-soft min-w-0 overflow-hidden">
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900 truncate">Upcoming Appointments</h2>
                  <p className="text-xs text-gray-500 flex items-center gap-2 mt-0.5">
                    {isOnline ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" /> : <WifiOff className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                    <span className="truncate">{isOnline ? 'Live scheduling feed' : `Offline mode - ${pendingSyncCount} queued updates`}</span>
                  </p>
                </div>
                <button
                  onClick={navigateToAppointments}
                className="text-xs sm:text-sm text-[#1E4ED8] hover:text-[#1E4ED8]/80 font-medium flex items-center gap-1 shrink-0"
              >
                View All <ArrowRight className="w-4 h-4" />
              </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
                <div className="relative min-w-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 shrink-0" />
                  <Input
                    value={filters.query}
                    onChange={(event) => setFilters({ query: event.target.value })}
                    placeholder="Search patient, doctor, type..."
                    className="pl-9 h-9 bg-white/80"
                  />
                </div>
                <select
                  value={filters.doctorId}
                  onChange={(event) => setFilters({ doctorId: event.target.value })}
                  className="h-9 rounded-lg border border-gray-200 bg-white/80 px-3 text-xs text-gray-700 shrink-0"
                  aria-label="Filter appointments by doctor"
                >
                  <option value="all">All doctors</option>
                  {doctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>{doctor.name}</option>
                  ))}
                </select>
                <select
                  value={filters.status}
                  onChange={(event) => setFilters({ status: event.target.value as AppointmentStatus | 'all' })}
                  className="h-9 rounded-lg border border-gray-200 bg-white/80 px-3 text-xs text-gray-700 shrink-0"
                  aria-label="Filter appointments by status"
                >
                  <option value="all">All statuses</option>
                  {appointmentStatuses.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2 sm:space-y-3">
              {upcomingAppointments.map((apt) => (
                <button 
                  key={apt.id} 
                  onClick={() => handleAppointmentClick(apt)}
                  className={cn(
                    'w-full flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border text-left transition-all duration-200 cursor-pointer group active:scale-[0.99]',
                    apt.priority === 'emergency' || apt.status === 'emergency'
                      ? 'bg-red-50 border-red-200 hover:bg-red-100'
                      : apt.waitMinutes >= 30
                        ? 'bg-amber-50 border-amber-200 hover:bg-amber-100'
                        : 'bg-gray-50 border-gray-100 hover:bg-white hover:border-[#1E4ED8]/20 hover:shadow-md',
                  )}
                >
                  <div className="w-12 h-12 rounded-xl bg-[#1E4ED8]/10 flex flex-col items-center justify-center flex-shrink-0">
                    <span className="text-xs sm:text-sm font-bold text-[#1E4ED8]">{apt.time}</span>
                    <span className="text-[10px] text-gray-500">{apt.queueNumber}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-7 h-7 rounded-full bg-white border border-gray-200 text-[11px] font-bold text-[#1E4ED8] flex items-center justify-center flex-shrink-0">{apt.patientAvatar}</span>
                      <h3 className="font-semibold text-gray-900 text-sm sm:text-base truncate">{apt.patient}</h3>
                      {apt.time <= new Date().toTimeString().slice(0, 5) && !['completed', 'cancelled', 'no-show'].includes(apt.status) && (
                        <span className="hidden sm:inline-flex px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-semibold">overdue</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs sm:text-sm text-gray-500">
                      <span>{apt.type}</span>
                      <span className="hidden sm:inline">•</span>
                      <span className="hidden sm:inline">{apt.department}</span>
                      <span>•</span>
                      <span className="text-gray-400 truncate max-w-[12rem]">{apt.doctor}</span>
                      <span className="inline-flex items-center gap-1 text-gray-400">
                        <Timer className="w-3 h-3" />
                        {apt.waitMinutes}m wait
                      </span>
                    </div>
                  </div>
                  {apt.emergencyFlags.length > 0 && <Siren className="w-4 h-4 text-red-500 flex-shrink-0" />}
                  <span className={cn("px-2 sm:px-3 py-1 rounded-full border text-[10px] sm:text-xs font-medium flex-shrink-0", statusStyles[apt.status])}>
                    {apt.status}
                  </span>
                  <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                </button>
              ))}
              {upcomingAppointments.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                  No appointments match the current dashboard filters.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-4 sm:space-y-6">
          {/* AI Insights Preview */}
          <div className="bg-white/70 backdrop-blur-xl border-l-4 border-l-vitamind-500 rounded-2xl p-4 shadow-soft min-w-0 overflow-hidden">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-vitamind-600 shrink-0" />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-gray-900 truncate">VitaMind Insights</h2>
                <p className="text-[10px] text-gray-500 truncate">Clinical Intelligence for Better Healthcare</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-red-50 border border-red-100 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span className="text-xs sm:text-sm font-medium text-red-700 truncate">High Risk Alert</span>
                </div>
                <p className="text-xs text-red-600 truncate">3 patients require immediate attention</p>
              </div>
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-100 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-xs sm:text-sm font-medium text-amber-700 truncate">Trend Detected</span>
                </div>
                <p className="text-xs text-amber-600 truncate">Unusual lab pattern in 5 patients</p>
              </div>
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-100 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-4 h-4 text-blue-500 shrink-0" />
                  <span className="text-xs sm:text-sm font-medium text-blue-700 truncate">Prediction</span>
                </div>
                <p className="text-xs text-blue-600 truncate">15% increase in admissions expected</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => toast.info('Opening VitaMind Insights...')}
              className="w-full mt-3 py-2 px-4 rounded-xl bg-gradient-vitamind text-white text-sm font-medium hover:shadow-lg hover:shadow-vitamind-500/25 transition-all duration-200 min-w-0"
            >
              Open VitaMind
            </button>
          </div>

          {/* Recent Activity */}
          <div className="bg-white/70 backdrop-blur-xl border border-white/60 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-soft min-w-0 overflow-hidden">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-4">Recent Activity</h2>
            <div className="space-y-3 sm:space-y-4">
              {recentActivity.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className={cn("w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center flex-shrink-0", activity.color)}>
                    <activity.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs sm:text-sm text-gray-900 truncate">{activity.message}</p>
                    <p className="text-[10px] sm:text-xs text-gray-400">{activity.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Offline Sync Status */}
          <div className="bg-white/70 backdrop-blur-xl border border-green-100 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-soft bg-gradient-to-br from-green-50/50 to-emerald-50/50">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-green-500 flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 text-sm sm:text-base">Sync Status</h3>
                <p className="text-xs sm:text-sm text-green-600">All data synced</p>
              </div>
            </div>
            <div className="space-y-2 text-xs sm:text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Last sync</span>
                <span className="text-gray-700">2 minutes ago</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Pending items</span>
                <span className="text-gray-700">0</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Cached records</span>
                <span className="text-gray-700">2,847</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <NewPatientModal open={showNewPatient} onClose={() => setShowNewPatient(false)} creatorName={userName} canCreatePatient={canCreate('Patients')} />
      <BookAppointmentModal open={showBookAppointment} onClose={() => setShowBookAppointment(false)} />
      <OrderLabModal open={showOrderLab} onClose={() => setShowOrderLab(false)} />
      <DispenseModal open={showDispense} onClose={() => setShowDispense(false)} />
      <Dialog open={Boolean(selectedAppointment)} onOpenChange={(open) => !open && setSelectedAppointment(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto bg-white/95 backdrop-blur-xl sm:max-w-4xl p-0">
          {selectedAppointment && (
            <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="p-4 sm:p-6 space-y-4 border-b lg:border-b-0 lg:border-r border-gray-100">
                <DialogHeader>
                  <DialogTitle className="text-[#1E4ED8] flex items-center gap-2">
                    <CalendarCheck className="w-5 h-5" />
                    Quick Appointment Hub
                  </DialogTitle>
                </DialogHeader>

                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-[#1E4ED8] text-white flex items-center justify-center font-bold">
                      {selectedAppointment.patientAvatar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-gray-900 truncate">{selectedAppointment.patient}</h3>
                      <p className="text-xs text-gray-500">{selectedAppointment.patientSwitchId} • {selectedAppointment.nfcId}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className={cn('px-2 py-1 rounded-full border text-xs font-medium', statusStyles[selectedAppointment.status])}>{selectedAppointment.status}</span>
                        <span className="px-2 py-1 rounded-full bg-white border border-gray-200 text-xs text-gray-600">{selectedAppointment.type}</span>
                        <span className="px-2 py-1 rounded-full bg-white border border-gray-200 text-xs text-gray-600">{selectedAppointment.priority}</span>
                      </div>
                    </div>
                    <div className="text-right text-xs text-gray-500">
                      <p className="font-semibold text-gray-900">{selectedAppointment.time}</p>
                      <p>{selectedAppointment.queueNumber}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border border-gray-100 p-3">
                    <p className="text-xs text-gray-500">Visit reason</p>
                    <p className="font-medium text-gray-900 mt-1">{selectedAppointment.visitReason}</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 p-3">
                    <p className="text-xs text-gray-500">Department & doctor</p>
                    <p className="font-medium text-gray-900 mt-1">{selectedAppointment.department}</p>
                    <p className="text-gray-500">{selectedAppointment.doctor}</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 p-3">
                    <p className="text-xs text-gray-500">Check-in & queue</p>
                    <p className="font-medium text-gray-900 mt-1">{selectedAppointment.checkInStatus} • position {selectedAppointment.queuePosition}</p>
                    <p className="text-gray-500">{selectedAppointment.waitMinutes} min wait</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 p-3">
                    <p className="text-xs text-gray-500">Insurance & balance</p>
                    <p className="font-medium text-gray-900 mt-1">{selectedAppointment.insuranceStatus} • {selectedAppointment.insuranceType}</p>
                    <p className="text-gray-500">₦{selectedAppointment.outstandingBalance.toLocaleString()} outstanding</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
                    <HeartPulse className="w-4 h-4 text-blue-600 mb-2" />
                    <p className="text-xs text-blue-700 font-medium">Last vitals</p>
                    <p className="text-xs text-blue-700/80 mt-1">{selectedAppointment.lastVitals}</p>
                  </div>
                  <div className="rounded-xl bg-red-50 border border-red-100 p-3">
                    <AlertCircle className="w-4 h-4 text-red-600 mb-2" />
                    <p className="text-xs text-red-700 font-medium">Clinical alerts</p>
                    <p className="text-xs text-red-700/80 mt-1">{selectedAppointment.clinicalAlerts.join(', ') || 'None'}</p>
                  </div>
                  <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                    <Wallet className="w-4 h-4 text-amber-600 mb-2" />
                    <p className="text-xs text-amber-700 font-medium">Allergies</p>
                    <p className="text-xs text-amber-700/80 mt-1">{selectedAppointment.allergies.join(', ')}</p>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-100 p-3">
                  <p className="text-xs font-medium text-gray-500 mb-2">Appointment history</p>
                  <div className="space-y-2">
                    {selectedAppointment.history.slice(0, 4).map((item) => (
                      <div key={item} className="flex items-center gap-2 text-xs text-gray-600">
                        <span className="w-2 h-2 rounded-full bg-[#1E4ED8]" />
                        {item}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-4 sm:p-6 space-y-4">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Filter className="w-4 h-4 text-gray-500" />
                    <p className="text-sm font-semibold text-gray-900">Interactive status</p>
                  </div>
                  <select
                    value={selectedAppointment.status}
                    onChange={(event) => {
                      const nextStatus = event.target.value as AppointmentStatus;
                      updateStatus(selectedAppointment.id, nextStatus, 'Status changed from dashboard widget');
                      setSelectedAppointment((prev) => prev ? { ...prev, status: nextStatus } : prev);
                    }}
                    className="w-full h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm"
                  >
                    {appointmentStatuses.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {actionConfig.map((action) => {
                    const Icon = action.icon;
                    const allowed = canRunAction(currentRole, action.id, selectedAppointment);
                    return (
                      <Button
                        key={action.id}
                        variant={allowed ? 'outline' : 'ghost'}
                        disabled={!allowed}
                        onClick={() => runAction(selectedAppointment.id, action.id)}
                        className={cn('justify-start gap-2 min-h-10 text-left', !allowed && 'text-gray-400')}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        <span className="truncate">{action.label}</span>
                      </Button>
                    );
                  })}
                </div>

                <div className="rounded-xl border border-gray-100 p-3 space-y-2">
                  <p className="text-xs font-medium text-gray-500">Quick contact</p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => toast.success(`Calling ${selectedAppointment.phone}`)}>
                      <Phone className="w-4 h-4 mr-2" />
                      Call
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => runAction(selectedAppointment.id, 'send-reminder')}>
                      <Mail className="w-4 h-4 mr-2" />
                      Email
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => toast.info('WhatsApp reminder channel is future-ready.')}>
                      <MessageSquare className="w-4 h-4 mr-2" />
                      WhatsApp
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-xs text-gray-600 space-y-1">
                  <p><span className="font-medium text-gray-900">Last update:</span> {new Date(selectedAppointment.lastUpdated).toLocaleString()}</p>
                  <p><span className="font-medium text-gray-900">Updated by:</span> {selectedAppointment.updatedBy}</p>
                  <p><span className="font-medium text-gray-900">Sync:</span> {isOnline ? 'Realtime broadcast active' : 'Offline-first queue active'}</p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
