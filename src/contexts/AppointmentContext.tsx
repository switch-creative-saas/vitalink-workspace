import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { useAuth, type UserRole } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import {
  createAppointmentRemote,
  listAppointmentsRemote,
  listCliniciansRemote,
  subscribeToAppointments,
  updateAppointmentStatusRemote,
} from '@/lib/supabase/appointments';

export type AppointmentStatus =
  | 'confirmed'
  | 'checked-in'
  | 'pending'
  | 'in-consultation'
  | 'completed'
  | 'cancelled'
  | 'no-show'
  | 'rescheduled'
  | 'emergency'
  | 'waiting-lab'
  | 'admitted';

export type AppointmentType =
  | 'Consultation'
  | 'Follow-up'
  | 'Surgery'
  | 'Telemedicine'
  | 'Vaccination'
  | 'Lab Review'
  | 'ANC'
  | 'Emergency'
  | 'Specialist Referral'
  | 'Home Care'
  | 'Mental Health'
  | 'Chronic Care'
  | 'Pediatrics';

export type AppointmentAction =
  | 'check-in'
  | 'start-consultation'
  | 'reschedule'
  | 'cancel'
  | 'no-show'
  | 'send-reminder'
  | 'view-record'
  | 'generate-invoice'
  | 'join-telemedicine'
  | 'add-notes'
  | 'triage'
  | 'print-slip';

export interface AppointmentDoctor {
  id: string;
  name: string;
  department: string;
  avatar: string;
  workingHours: [string, string];
  breaks: string[];
  maxPerHour: number;
}

export interface AppointmentRecord {
  id: string;
  patient: string;
  patientSwitchId: string;
  nfcId: string;
  patientAvatar: string;
  doctor: string;
  doctorId: string;
  doctorAvatar: string;
  department: string;
  date: string;
  time: string;
  duration: number;
  type: AppointmentType;
  priority: 'routine' | 'urgent' | 'stat' | 'emergency';
  insuranceType: 'private' | 'public' | 'corporate' | 'self-pay';
  status: AppointmentStatus;
  visitReason: string;
  history: string[];
  checkInStatus: 'not-arrived' | 'arrived' | 'triage' | 'ready' | 'in-room';
  insuranceStatus: 'active' | 'pending' | 'expired' | 'self-pay';
  outstandingBalance: number;
  lastVitals: string;
  clinicalAlerts: string[];
  emergencyFlags: string[];
  allergies: string[];
  phone: string;
  labLinked: boolean;
  prescriptionReady: boolean;
  telemedicineUrl?: string;
  queueNumber: string;
  queuePosition: number;
  waitMinutes: number;
  consultationMinutes: number;
  lastUpdated: string;
  updatedBy: string;
}

export interface AppointmentFilters {
  date: string;
  doctorId: string;
  department: string;
  status: 'all' | AppointmentStatus;
  timeRange: 'all' | 'morning' | 'afternoon' | 'evening';
  type: 'all' | AppointmentType;
  priority: 'all' | AppointmentRecord['priority'];
  insuranceType: 'all' | AppointmentRecord['insuranceType'];
  query: string;
}

interface AppointmentContextType {
  appointments: AppointmentRecord[];
  doctors: AppointmentDoctor[];
  appointmentTypes: AppointmentType[];
  filters: AppointmentFilters;
  pendingSyncCount: number;
  isOnline: boolean;
  analytics: {
    averageWait: number;
    noShowRate: number;
    averageConsultation: number;
    throughput: number;
    peakHour: string;
  };
  setFilters: (filters: Partial<AppointmentFilters>) => void;
  visibleAppointments: (role: UserRole, userName: string) => AppointmentRecord[];
  createAppointment: (payload: Omit<AppointmentRecord, 'id' | 'lastUpdated' | 'updatedBy' | 'queueNumber' | 'queuePosition'>) => void;
  updateStatus: (id: string, status: AppointmentStatus, reason?: string) => void;
  runAction: (id: string, action: AppointmentAction) => void;
  canOpenAppointmentsHub: (role: UserRole) => boolean;
  canRunAction: (role: UserRole, action: AppointmentAction, appointment?: AppointmentRecord) => boolean;
  preserveDashboardContext: (context: Partial<AppointmentFilters>) => void;
}

const AppointmentContext = createContext<AppointmentContextType | null>(null);

const appointmentsKey = 'vitalink-appointments-core';
const filtersKey = 'vitalink-appointments-dashboard-context';
const offlineQueueKey = 'vitalink-appointments-offline-queue';

export const appointmentTypes: AppointmentType[] = [
  'Consultation',
  'Follow-up',
  'Surgery',
  'Telemedicine',
  'Vaccination',
  'Lab Review',
  'ANC',
  'Emergency',
  'Specialist Referral',
  'Home Care',
  'Mental Health',
  'Chronic Care',
  'Pediatrics',
];

export const appointmentStatuses: AppointmentStatus[] = [
  'confirmed',
  'checked-in',
  'pending',
  'in-consultation',
  'completed',
  'cancelled',
  'no-show',
  'rescheduled',
  'emergency',
  'waiting-lab',
  'admitted',
];

export const doctors: AppointmentDoctor[] = [
  { id: 'doc_1', name: 'Dr. Sarah Johnson', department: 'General Medicine', avatar: 'SJ', workingHours: ['08:00', '18:00'], breaks: ['12:00'], maxPerHour: 2 },
  { id: 'doc_2', name: 'Dr. Michael Chen', department: 'Cardiology', avatar: 'MC', workingHours: ['09:00', '17:00'], breaks: ['13:00'], maxPerHour: 2 },
  { id: 'doc_3', name: 'Dr. Emily Davis', department: 'Pediatrics', avatar: 'ED', workingHours: ['08:30', '16:30'], breaks: ['12:30'], maxPerHour: 3 },
  { id: 'doc_4', name: 'Dr. Ngozi Eze', department: 'Emergency', avatar: 'NE', workingHours: ['07:00', '19:00'], breaks: ['14:00'], maxPerHour: 4 },
];

const today = new Date().toISOString().slice(0, 10);

const seedAppointments: AppointmentRecord[] = [
  {
    id: 'a1',
    patient: 'Chioma Okonkwo',
    patientSwitchId: 'VL-2026-000261',
    nfcId: 'VLC-9A2C-OKO',
    patientAvatar: 'CO',
    doctor: 'Dr. Sarah Johnson',
    doctorId: 'doc_1',
    doctorAvatar: 'SJ',
    department: 'General Medicine',
    date: today,
    time: '09:00',
    duration: 30,
    type: 'Follow-up',
    priority: 'routine',
    insuranceType: 'corporate',
    status: 'confirmed',
    visitReason: 'Blood pressure review and medication tolerance check',
    history: ['Hypertension follow-up - 2026-04-10', 'Medication adjusted - 2026-03-12'],
    checkInStatus: 'not-arrived',
    insuranceStatus: 'active',
    outstandingBalance: 0,
    lastVitals: 'BP 132/84, HR 78, SpO2 98%',
    clinicalAlerts: ['Chronic hypertension'],
    emergencyFlags: [],
    allergies: ['Penicillin'],
    phone: '+2348023456789',
    labLinked: false,
    prescriptionReady: false,
    queueNumber: 'GM-014',
    queuePosition: 4,
    waitMinutes: 12,
    consultationMinutes: 24,
    lastUpdated: new Date().toISOString(),
    updatedBy: 'System',
  },
  {
    id: 'a2',
    patient: 'Emmanuel Adeyemi',
    patientSwitchId: 'VL-2026-000262',
    nfcId: 'VLC-4F11-ADE',
    patientAvatar: 'EA',
    doctor: 'Dr. Michael Chen',
    doctorId: 'doc_2',
    doctorAvatar: 'MC',
    department: 'Cardiology',
    date: today,
    time: '09:30',
    duration: 45,
    type: 'Consultation',
    priority: 'urgent',
    insuranceType: 'private',
    status: 'checked-in',
    visitReason: 'Chest pain follow-up after abnormal ECG',
    history: ['Cardiology consult - 2026-04-18', 'ECG ordered - 2026-04-18'],
    checkInStatus: 'triage',
    insuranceStatus: 'active',
    outstandingBalance: 18500,
    lastVitals: 'BP 148/92, HR 96, SpO2 96%',
    clinicalAlerts: ['Abnormal ECG', 'High BP'],
    emergencyFlags: ['Chest pain protocol'],
    allergies: ['None recorded'],
    phone: '+2348034567890',
    labLinked: true,
    prescriptionReady: false,
    queueNumber: 'CA-006',
    queuePosition: 1,
    waitMinutes: 28,
    consultationMinutes: 38,
    lastUpdated: new Date().toISOString(),
    updatedBy: 'Receptionist John',
  },
  {
    id: 'a3',
    patient: 'Fatima Abdullahi',
    patientSwitchId: 'VL-2026-000263',
    nfcId: 'VLC-A891-ABD',
    patientAvatar: 'FA',
    doctor: 'Dr. Sarah Johnson',
    doctorId: 'doc_1',
    doctorAvatar: 'SJ',
    department: 'General Medicine',
    date: today,
    time: '10:00',
    duration: 30,
    type: 'Lab Review',
    priority: 'stat',
    insuranceType: 'public',
    status: 'waiting-lab',
    visitReason: 'Review malaria and CBC results after high fever',
    history: ['Lab ordered - 2026-05-15', 'Fever triage - 2026-05-15'],
    checkInStatus: 'arrived',
    insuranceStatus: 'pending',
    outstandingBalance: 6200,
    lastVitals: 'Temp 38.8C, HR 104, SpO2 97%',
    clinicalAlerts: ['Fever under surveillance'],
    emergencyFlags: ['Sentinel infectious disease watch'],
    allergies: ['Sulfa drugs'],
    phone: '+2348045678901',
    labLinked: true,
    prescriptionReady: false,
    queueNumber: 'GM-015',
    queuePosition: 2,
    waitMinutes: 46,
    consultationMinutes: 18,
    lastUpdated: new Date().toISOString(),
    updatedBy: 'Lab Scientist Okonkwo',
  },
  {
    id: 'a4',
    patient: 'Oluwaseun Balogun',
    patientSwitchId: 'VL-2026-000264',
    nfcId: 'VLC-5DD2-BAL',
    patientAvatar: 'OB',
    doctor: 'Dr. Emily Davis',
    doctorId: 'doc_3',
    doctorAvatar: 'ED',
    department: 'Pediatrics',
    date: today,
    time: '10:30',
    duration: 30,
    type: 'Vaccination',
    priority: 'routine',
    insuranceType: 'self-pay',
    status: 'pending',
    visitReason: 'Routine immunization schedule',
    history: ['Well-child visit - 2026-03-20'],
    checkInStatus: 'not-arrived',
    insuranceStatus: 'self-pay',
    outstandingBalance: 0,
    lastVitals: 'Weight 18kg, Temp 36.7C',
    clinicalAlerts: [],
    emergencyFlags: [],
    allergies: ['Egg allergy - mild'],
    phone: '+2348067890123',
    labLinked: false,
    prescriptionReady: true,
    queueNumber: 'PD-009',
    queuePosition: 5,
    waitMinutes: 6,
    consultationMinutes: 15,
    lastUpdated: new Date().toISOString(),
    updatedBy: 'System',
  },
  {
    id: 'a5',
    patient: 'Aisha Bello',
    patientSwitchId: 'VL-2026-000265',
    nfcId: 'VLC-23EF-BEL',
    patientAvatar: 'AB',
    doctor: 'Dr. Ngozi Eze',
    doctorId: 'doc_4',
    doctorAvatar: 'NE',
    department: 'Emergency',
    date: today,
    time: '11:00',
    duration: 60,
    type: 'Emergency',
    priority: 'emergency',
    insuranceType: 'private',
    status: 'emergency',
    visitReason: 'Acute asthma exacerbation',
    history: ['Asthma admission - 2025-12-03'],
    checkInStatus: 'ready',
    insuranceStatus: 'active',
    outstandingBalance: 34500,
    lastVitals: 'RR 28, SpO2 91%, HR 118',
    clinicalAlerts: ['Severe asthma'],
    emergencyFlags: ['Emergency escalation active'],
    allergies: ['Aspirin'],
    phone: '+2348078901234',
    labLinked: false,
    prescriptionReady: false,
    queueNumber: 'ER-001',
    queuePosition: 0,
    waitMinutes: 3,
    consultationMinutes: 52,
    lastUpdated: new Date().toISOString(),
    updatedBy: 'Nurse Amina Bello',
  },
];

const defaultFilters: AppointmentFilters = {
  date: today,
  doctorId: 'all',
  department: 'all',
  status: 'all',
  timeRange: 'all',
  type: 'all',
  priority: 'all',
  insuranceType: 'all',
  query: '',
};

/** Position in the day's queue for each department, by appointment time. */
function withQueuePositions(items: AppointmentRecord[]) {
  const counters = new Map<string, number>();
  return [...items]
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
    .map((item) => {
      const key = `${item.date}|${item.department}`;
      const position = (counters.get(key) ?? 0) + 1;
      counters.set(key, position);
      return { ...item, queuePosition: position };
    });
}

function shiftDate(date: string, days: number) {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function readJson<T>(key: string, fallback: T): T {
  const saved = localStorage.getItem(key);
  if (!saved) return fallback;
  try {
    return JSON.parse(saved) as T;
  } catch {
    return fallback;
  }
}

function notify(module: string, type: string, message: string) {
  window.dispatchEvent(new CustomEvent('vitalink:notify', { detail: { module, type, message } }));
}

function routeTo(page: string, extra?: Record<string, string>) {
  window.dispatchEvent(new CustomEvent('app:navigate', { detail: { page, ...extra } }));
}

function timeInRange(time: string, range: AppointmentFilters['timeRange']) {
  if (range === 'all') return true;
  if (range === 'morning') return time < '12:00';
  if (range === 'afternoon') return time >= '12:00' && time < '17:00';
  return time >= '17:00';
}

function visibleForRole(appointment: AppointmentRecord, role: UserRole, userName: string) {
  if (role === 'doctor') return appointment.doctor === userName;
  if (role === 'lab-scientist' || role === 'lab-technician') return appointment.labLinked;
  if (role === 'pharmacist') return appointment.prescriptionReady;
  if (role === 'billing-officer' || role === 'insurance-officer') return appointment.outstandingBalance > 0;
  return true;
}

function allowedAction(role: UserRole, action: AppointmentAction, appointment?: AppointmentRecord) {
  if (role === 'super-admin' || role === 'hospital-admin') return true;
  if (role === 'receptionist') return ['check-in', 'reschedule', 'cancel', 'send-reminder', 'view-record', 'print-slip'].includes(action);
  if (role === 'doctor') return ['start-consultation', 'view-record', 'add-notes', 'send-reminder', 'join-telemedicine'].includes(action);
  if (role === 'nurse') return ['check-in', 'triage', 'view-record', 'add-notes', 'print-slip'].includes(action);
  if (role === 'billing-officer') return action === 'generate-invoice';
  if (role === 'lab-scientist' || role === 'lab-technician') return action === 'view-record' && Boolean(appointment?.labLinked);
  if (role === 'pharmacist') return action === 'view-record' && Boolean(appointment?.prescriptionReady);
  return false;
}

export function AppointmentProvider({ children }: { children: ReactNode }) {
  const { currentRole, userName, organization } = useAuth();
  const organizationId = organization.id;
  // With Supabase, appointments and clinicians are loaded per workspace; otherwise the local demo data is used.
  const [appointments, setAppointments] = useState<AppointmentRecord[]>(() => (isSupabaseConfigured ? [] : readJson(appointmentsKey, seedAppointments)));
  const [clinicians, setClinicians] = useState<AppointmentDoctor[]>(isSupabaseConfigured ? [] : doctors);
  const [filters, setFilterState] = useState<AppointmentFilters>(() => ({ ...defaultFilters, ...readJson<Partial<AppointmentFilters>>(filtersKey, {}) }));
  const [pendingSyncCount, setPendingSyncCount] = useState(() => readJson<unknown[]>(offlineQueueKey, []).length);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    if (!isSupabaseConfigured) localStorage.setItem(appointmentsKey, JSON.stringify(appointments));
  }, [appointments]);

  // Load a window around the selected day; reload on any change pushed by Realtime.
  const windowStart = shiftDate(filters.date, -7);
  const windowEnd = shiftDate(filters.date, 31);
  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const [rows, staff] = await Promise.all([
        listAppointmentsRemote(organizationId, windowStart, windowEnd),
        listCliniciansRemote(organizationId),
      ]);
      setAppointments(withQueuePositions(rows));
      setClinicians(staff);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not load appointments'));
    }
  }, [organizationId, windowStart, windowEnd]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    void reload();
    let timer: number | undefined;
    const unsubscribe = subscribeToAppointments(organizationId, () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void reload(), 300);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [organizationId, reload]);
  useEffect(() => localStorage.setItem(filtersKey, JSON.stringify(filters)), [filters]);

  useEffect(() => {
    const online = () => {
      setIsOnline(true);
      setPendingSyncCount(0);
      localStorage.setItem(offlineQueueKey, '[]');
      notify('appointments', 'offline-sync-flushed', 'Queued appointment changes synchronized');
    };
    const offline = () => setIsOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setAppointments((prev) =>
        prev.map((appointment) =>
          appointment.status === 'checked-in' || appointment.status === 'waiting-lab'
            ? { ...appointment, waitMinutes: appointment.waitMinutes + 1 }
            : appointment,
        ),
      );
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const queueSync = (type: string, appointment: AppointmentRecord) => {
    if (isOnline) return;
    const queue = readJson<Array<{ id: string; type: string; appointmentId: string; createdAt: string }>>(offlineQueueKey, []);
    const next = [...queue, { id: crypto.randomUUID(), type, appointmentId: appointment.id, createdAt: new Date().toISOString() }];
    localStorage.setItem(offlineQueueKey, JSON.stringify(next));
    setPendingSyncCount(next.length);
  };

  const setFilters = (nextFilters: Partial<AppointmentFilters>) => {
    setFilterState((prev) => ({ ...prev, ...nextFilters }));
  };

  const applyMutation = (id: string, updater: (appointment: AppointmentRecord) => AppointmentRecord, eventType: string, message: string) => {
    let changed: AppointmentRecord | null = null;
    setAppointments((prev) =>
      prev.map((appointment) => {
        if (appointment.id !== id) return appointment;
        changed = updater(appointment);
        return changed;
      }),
    );
    if (changed) {
      queueSync(eventType, changed);
      notify('appointments', eventType, message);
      window.dispatchEvent(new CustomEvent('vitalink:appointments:updated', { detail: { appointmentId: id, eventType } }));
    }
  };

  const updateStatus = (id: string, status: AppointmentStatus, reason?: string) => {
    applyMutation(
      id,
      (appointment) => ({
        ...appointment,
        status,
        checkInStatus: status === 'checked-in' ? 'arrived' : status === 'in-consultation' ? 'in-room' : appointment.checkInStatus,
        lastUpdated: new Date().toISOString(),
        updatedBy: userName,
        history: reason ? [`${status}: ${reason}`, ...appointment.history] : [`Status changed to ${status}`, ...appointment.history],
      }),
      `status-${status}`,
      `${userName} changed ${id} to ${status}`,
    );
    if (isSupabaseConfigured) {
      updateAppointmentStatusRemote(id, status, reason)
        .then((saved) => setAppointments((prev) => withQueuePositions(prev.map((item) => (item.id === id ? { ...saved, lastVitals: item.lastVitals } : item)))))
        .catch((error) => {
          toast.error(errorMessage(error, 'Could not update the appointment'));
          void reload(); // drop the optimistic change
        });
    }
  };

  const createAppointment: AppointmentContextType['createAppointment'] = (payload) => {
    if (isSupabaseConfigured) {
      createAppointmentRemote(organizationId, {
        patientSwitchId: payload.patientSwitchId,
        clinicianId: payload.doctorId,
        department: payload.department,
        date: payload.date,
        time: payload.time,
        duration: payload.duration,
        type: payload.type,
        priority: payload.priority,
        insuranceType: payload.insuranceType,
        visitReason: payload.visitReason,
        note: payload.history[0],
      })
        .then((saved) => {
          setAppointments((prev) => withQueuePositions([...prev, saved]));
          notify('appointments', 'appointment-created', `${saved.patient} booked with ${saved.doctor}`);
          toast.success('Appointment created', { description: `${saved.patient} · queue ${saved.queueNumber}` });
        })
        .catch((error) => toast.error(errorMessage(error, 'Could not create the appointment')));
      return;
    }
    const next: AppointmentRecord = {
      ...payload,
      id: crypto.randomUUID(),
      queueNumber: `${payload.department.slice(0, 2).toUpperCase()}-${String(appointments.length + 1).padStart(3, '0')}`,
      queuePosition: appointments.filter((appointment) => appointment.date === payload.date && appointment.department === payload.department).length + 1,
      lastUpdated: new Date().toISOString(),
      updatedBy: userName,
    };
    setAppointments((prev) => [...prev, next]);
    queueSync('appointment-created', next);
    notify('appointments', 'appointment-created', `${next.patient} booked with ${next.doctor}`);
    toast.success('Appointment created', { description: 'Doctor, queue, reminders, and analytics were synchronized.' });
  };

  const runAction = (id: string, action: AppointmentAction) => {
    const appointment = appointments.find((item) => item.id === id);
    if (!appointment) return;
    if (!allowedAction(currentRole, action, appointment)) {
      notify('appointments', 'unauthorized-action', `${currentRole} attempted ${action}`);
      toast.error('RBAC policy blocks this appointment action.');
      return;
    }

    if (action === 'check-in') {
      updateStatus(id, 'checked-in', 'Patient checked in and queued');
      toast.success('Patient checked in', { description: 'Queue, dashboard, and patient flow updated.' });
      return;
    }
    if (action === 'start-consultation') {
      updateStatus(id, 'in-consultation', 'Consultation started from dashboard');
      routeTo('emr', { switchId: appointment.patientSwitchId });
      toast.success('Consultation started', { description: 'Opening EMR consultation workflow.' });
      return;
    }
    if (action === 'reschedule') {
      updateStatus(id, 'rescheduled', 'Reschedule workflow opened');
      routeTo('appointments');
      toast.info('Reschedule workflow opened in Appointments.');
      return;
    }
    if (action === 'cancel') {
      updateStatus(id, 'cancelled', 'Cancelled from appointment quick action');
      toast.error('Appointment cancelled', { description: 'Patient notification and audit log created.' });
      return;
    }
    if (action === 'no-show') {
      updateStatus(id, 'no-show', 'Marked as no-show');
      toast.warning('Marked as no-show', { description: 'No-show metrics and reminders updated.' });
      return;
    }
    if (action === 'send-reminder') {
      notify('appointments', 'reminder-sent', `Reminder sent to ${appointment.patient}`);
      toast.success('Reminder sent', { description: 'SMS, email, push, and WhatsApp-ready channels queued.' });
      return;
    }
    if (action === 'view-record') {
      routeTo('emr', { switchId: appointment.patientSwitchId });
      return;
    }
    if (action === 'generate-invoice') {
      routeTo('billing');
      notify('billing', 'invoice-from-appointment', `Invoice started for ${appointment.patient}`);
      toast.success('Billing flow opened', { description: 'Appointment services carried into invoice generation.' });
      return;
    }
    if (action === 'join-telemedicine') {
      routeTo('telemedicine');
      toast.success('Telemedicine session opened.');
      return;
    }
    if (action === 'add-notes') {
      routeTo('emr', { switchId: appointment.patientSwitchId });
      toast.info('Clinical notes opened in EMR.');
      return;
    }
    if (action === 'triage') {
      updateStatus(id, 'checked-in', 'Queued for nurse triage');
      toast.success('Queued for triage', { description: 'Vitals workflow and queue board updated.' });
      return;
    }
    if (action === 'print-slip') {
      notify('appointments', 'queue-slip-printed', `Queue slip printed for ${appointment.patient}`);
      toast.success(`Queue slip ready: ${appointment.queueNumber}`);
    }
  };

  const visibleAppointments = (role: UserRole, activeUserName: string) => {
    const needle = filters.query.toLowerCase().trim();
    return appointments
      .filter((appointment) => visibleForRole(appointment, role, activeUserName))
      .filter((appointment) => appointment.date === filters.date)
      .filter((appointment) => filters.doctorId === 'all' || appointment.doctorId === filters.doctorId)
      .filter((appointment) => filters.department === 'all' || appointment.department === filters.department)
      .filter((appointment) => filters.status === 'all' || appointment.status === filters.status)
      .filter((appointment) => filters.type === 'all' || appointment.type === filters.type)
      .filter((appointment) => filters.priority === 'all' || appointment.priority === filters.priority)
      .filter((appointment) => filters.insuranceType === 'all' || appointment.insuranceType === filters.insuranceType)
      .filter((appointment) => timeInRange(appointment.time, filters.timeRange))
      .filter((appointment) =>
        needle
          ? `${appointment.patient} ${appointment.doctor} ${appointment.department} ${appointment.type} ${appointment.status} ${appointment.patientSwitchId}`.toLowerCase().includes(needle)
          : true,
      )
      .sort((a, b) => a.time.localeCompare(b.time));
  };

  const analytics = useMemo(() => {
    const todays = appointments.filter((appointment) => appointment.date === filters.date);
    const averageWait = Math.round(todays.reduce((sum, appointment) => sum + appointment.waitMinutes, 0) / Math.max(todays.length, 1));
    const noShowRate = Math.round((todays.filter((appointment) => appointment.status === 'no-show').length / Math.max(todays.length, 1)) * 100);
    const averageConsultation = Math.round(todays.reduce((sum, appointment) => sum + appointment.consultationMinutes, 0) / Math.max(todays.length, 1));
    const throughput = todays.filter((appointment) => ['completed', 'in-consultation', 'checked-in'].includes(appointment.status)).length;
    const hourCounts = todays.reduce<Record<string, number>>((acc, appointment) => {
      const hour = appointment.time.slice(0, 2);
      acc[hour] = (acc[hour] ?? 0) + 1;
      return acc;
    }, {});
    const peakHour = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '09';
    return { averageWait, noShowRate, averageConsultation, throughput, peakHour: `${peakHour}:00` };
  }, [appointments, filters.date]);

  const value = useMemo<AppointmentContextType>(
    () => ({
      appointments,
      doctors: clinicians,
      appointmentTypes,
      filters,
      pendingSyncCount,
      isOnline,
      analytics,
      setFilters,
      visibleAppointments,
      createAppointment,
      updateStatus,
      runAction,
      canOpenAppointmentsHub: (role) => ['receptionist', 'doctor', 'nurse', 'hospital-admin', 'super-admin'].includes(role),
      canRunAction: allowedAction,
      preserveDashboardContext: (context) => {
        const next = { ...filters, ...context };
        localStorage.setItem(filtersKey, JSON.stringify(next));
        setFilterState(next);
      },
    }),
    [appointments, clinicians, filters, pendingSyncCount, isOnline, analytics],
  );

  return <AppointmentContext.Provider value={value}>{children}</AppointmentContext.Provider>;
}

export function useAppointments() {
  const context = useContext(AppointmentContext);
  if (!context) throw new Error('useAppointments must be used within AppointmentProvider');
  return context;
}
