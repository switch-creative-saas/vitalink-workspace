import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlaskConical,
  Plus,
  Search,
  Filter,
  Clock,
  CheckCircle2,
  AlertCircle,
  MoreHorizontal,
  Download,
  ChevronDown,
  ChevronRight,
  FileText,
  Printer,
  Pencil,
  Eye,
  XCircle,
  QrCode,
  Upload,
  WifiOff,
  Sparkles,
  Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useAuth, type UserRole } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { SENTINEL_LAB_EVENT, type SentinelLabPayload } from '@/lib/sentinel/events';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { queryPatients } from '@/lib/patientRegistry';
import {
  createLabOrder,
  listLabOrders,
  listLabTemplates,
  saveLabResults,
  saveLabTemplate,
  setLabOrderStatus,
  type LabOrderRecord,
} from '@/lib/supabase/lab';

type LabStatus = 'pending' | 'processing' | 'completed' | 'cancelled';
type LabPriority = 'routine' | 'urgent' | 'stat';
type SampleType = 'blood' | 'urine' | 'imaging' | 'other';

export interface LabResultLine {
  /** lab_results row id (Supabase mode). */
  id?: string;
  /** Completed in the database: the value can no longer change. */
  locked?: boolean;
  testName: string;
  value: string;
  unit: string;
  referenceRange: string;
  interpretation: string;
  flaggedCritical: boolean;
  attachmentNames: string[];
}

export interface LabOrder {
  /** Display number, e.g. VLL-2026-0001. */
  id: string;
  /** lab_orders row id (Supabase mode). */
  dbId?: string;
  /** Patient's state of residence (Supabase mode), for Sentinel. */
  patientState?: string;
  patientId: string;
  patientName: string;
  uhin: string;
  requestedBy: string;
  doctorId: string;
  tests: string[];
  priority: LabPriority;
  sampleType: SampleType;
  status: LabStatus;
  notes: string;
  createdAt: string;
  criticalFlag: boolean;
  results: LabResultLine[];
  draftSavedAt?: string;
}

export interface LabTemplate {
  id: string;
  name: string;
  fields: { name: string; unit: string; referenceRange: string }[];
}

const PRESET_TESTS = ['CBC', 'Lipid Panel', 'HbA1c', 'Urinalysis', 'Thyroid Function', 'Cardiac Enzymes'] as const;

const DEFAULT_TEMPLATES: LabTemplate[] = [
  {
    id: 'tpl-1',
    name: 'Metabolic panel',
    fields: [
      { name: 'Glucose', unit: 'mg/dL', referenceRange: '70–100' },
      { name: 'Sodium', unit: 'mEq/L', referenceRange: '136–145' },
      { name: 'Potassium', unit: 'mEq/L', referenceRange: '3.5–5.1' },
    ],
  },
  {
    id: 'tpl-2',
    name: 'Lipid standard',
    fields: [
      { name: 'Total Cholesterol', unit: 'mg/dL', referenceRange: '<200' },
      { name: 'LDL', unit: 'mg/dL', referenceRange: '<100' },
      { name: 'HDL', unit: 'mg/dL', referenceRange: '>40' },
    ],
  },
];

const DEMO_PATIENTS = [
  { id: 'p1', name: 'Adebayo Johnson', uhin: 'SH-NG-LAG-001' },
  { id: 'p2', name: 'Chioma Okonkwo', uhin: 'SH-NG-LAG-002' },
  { id: 'p3', name: 'Emmanuel Adeyemi', uhin: 'SH-NG-ABJ-003' },
  { id: 'p4', name: 'Fatima Abdullahi', uhin: 'SH-NG-KAN-004' },
  { id: 'p5', name: 'Ngozi Eze', uhin: 'SH-NG-LAG-005' },
];

function defaultResultLines(tests: string[]): LabResultLine[] {
  return tests.map((testName) => ({
    testName,
    value: '',
    unit: testName === 'HbA1c' ? '%' : testName.includes('Lipid') || testName.includes('Cholesterol') ? 'mg/dL' : '',
    referenceRange:
      testName === 'HbA1c'
        ? '4.0–6.5%'
        : testName === 'CBC'
          ? 'Panel norms'
          : testName === 'Lipid Panel'
            ? 'See components'
            : '—',
    interpretation: '',
    flaggedCritical: false,
    attachmentNames: [],
  }));
}

function seedOrders(): LabOrder[] {
  return [
    {
      id: 'VLL-2026-0001',
      patientId: 'p1',
      patientName: 'Adebayo Johnson',
      uhin: 'SH-NG-LAG-001',
      requestedBy: 'Dr. Sarah Johnson',
      doctorId: 'doc_1',
      tests: ['CBC', 'Lipid Panel', 'HbA1c'],
      priority: 'routine',
      sampleType: 'blood',
      status: 'pending',
      notes: 'Fasting preferred',
      createdAt: '2026-02-23T09:00:00',
      criticalFlag: false,
      results: defaultResultLines(['CBC', 'Lipid Panel', 'HbA1c']),
    },
    {
      id: 'VLL-2026-0002',
      patientId: 'p2',
      patientName: 'Chioma Okonkwo',
      uhin: 'SH-NG-LAG-002',
      requestedBy: 'Dr. Michael Chen',
      doctorId: 'doc_2',
      tests: ['Urinalysis', 'Thyroid Function'],
      priority: 'urgent',
      sampleType: 'urine',
      status: 'processing',
      notes: '',
      createdAt: '2026-02-23T10:15:00',
      criticalFlag: false,
      results: defaultResultLines(['Urinalysis', 'Thyroid Function']),
    },
    {
      id: 'VLL-2026-0003',
      patientId: 'p3',
      patientName: 'Emmanuel Adeyemi',
      uhin: 'SH-NG-ABJ-003',
      requestedBy: 'Dr. Sarah Johnson',
      doctorId: 'doc_1',
      tests: ['Cardiac Enzymes', 'CBC'],
      priority: 'stat',
      sampleType: 'blood',
      status: 'completed',
      notes: 'ER follow-up',
      createdAt: '2026-02-22T14:00:00',
      criticalFlag: true,
      results: (() => {
        const r = defaultResultLines(['Cardiac Enzymes', 'CBC']);
        r[0].value = 'Elevated';
        r[0].flaggedCritical = true;
        r[0].interpretation = 'Troponin trend rising — notify cardiology';
        return r;
      })(),
    },
    {
      id: 'VLL-2026-0004',
      patientId: 'p4',
      patientName: 'Fatima Abdullahi',
      uhin: 'SH-NG-KAN-004',
      requestedBy: 'Dr. Emily Davis',
      doctorId: 'doc_3',
      tests: ['Lipid Panel', 'HbA1c'],
      priority: 'routine',
      sampleType: 'blood',
      status: 'pending',
      notes: '',
      createdAt: '2026-02-22T11:30:00',
      criticalFlag: false,
      results: defaultResultLines(['Lipid Panel', 'HbA1c']),
    },
  ];
}

function seedCompletedResults(orders: LabOrder[]) {
  return orders
    .filter((o) => o.status === 'completed')
    .flatMap((o) =>
      o.results.map((r, i) => ({
        id: `${o.id}-${i}`,
        orderId: o.id,
        test: r.testName,
        patient: o.patientName,
        value: r.value || '—',
        reference: r.referenceRange,
        status: r.flaggedCritical ? 'critical' : 'normal',
        date: o.createdAt.slice(0, 10),
        trend: r.flaggedCritical ? 'up' : 'stable',
        critical: r.flaggedCritical,
        interpretation: r.interpretation,
      })),
    );
}

function nextOrderId(existingIds: string[]): string {
  const year = new Date().getFullYear();
  const nums = existingIds
    .map((id) => {
      const m = id.match(new RegExp(`VLL-${year}-(\\d+)`, 'i'));
      return m ? parseInt(m[1], 10) : 0;
    })
    .filter(Boolean);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `VLL-${year}-${String(next).padStart(4, '0')}`;
}

function orderFromRecord(o: LabOrderRecord): LabOrder {
  return {
    id: o.number,
    dbId: o.id,
    patientState: o.patientState,
    patientId: o.patientId,
    patientName: o.patientName,
    uhin: o.patientSwitchId,
    requestedBy: o.requestedBy,
    doctorId: o.orderedById ?? '',
    tests: o.lines.map((line) => line.testName),
    priority: o.priority,
    sampleType: o.sampleType,
    status: o.status,
    notes: o.notes,
    createdAt: o.createdAt,
    criticalFlag: o.critical,
    draftSavedAt: o.draftSavedAt ?? undefined,
    results: o.lines.map((line) => ({
      id: line.id,
      locked: line.completed,
      testName: line.testName,
      value: line.value,
      unit: line.unit,
      referenceRange: line.referenceRange,
      interpretation: line.interpretation,
      flaggedCritical: line.critical,
      attachmentNames: [],
    })),
  };
}

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

type PatientOption = { id: string; name: string; uhin: string };

function useLabPermissions(role: UserRole, hasPermission: (m: string, a: string) => boolean) {
  return useMemo(() => {
    const superA = role === 'super-admin';
    const admin = role === 'hospital-admin';
    const scientist = role === 'lab-scientist';
    const tech = role === 'lab-technician';
    const doctor = role === 'doctor';
    const nurse = role === 'nurse';
    const reception = role === 'receptionist';

    return {
      canView: hasPermission('Laboratory', 'view') || superA,
      canCreateOrder: hasPermission('Laboratory', 'create') || superA,
      canExport: hasPermission('Laboratory', 'export') || superA,
      canDeleteOrder: hasPermission('Laboratory', 'delete') || superA,
      canEditMeta: hasPermission('Laboratory', 'edit') && (scientist || admin || superA),
      canAdvanceStatus: scientist || admin || superA || tech,
      canSetProcessing: scientist || admin || superA || tech,
      canSetCompleted: scientist || admin || superA,
      canSubmitResults: scientist || admin || superA,
      canSaveDraft: scientist || admin || superA || tech,
      canFlagCritical: scientist || admin || superA,
      canManageTemplates: scientist || admin || superA,
      canOverrideResults: admin || superA,
      canAddDoctorInterpretation: doctor || superA || admin,
      canBulkUpload: scientist || admin || superA,
      /** Full read-only on result lines (nurse / receptionist) */
      isReadOnlyResults: nurse || reception,
      /** Doctor may add interpretation only */
      doctorInterpretationOnly: doctor && !scientist && !admin && !superA,
      techLimited: tech,
    };
  }, [role, hasPermission]);
}

const tabs = [
  { id: 'orders' as const, label: 'Lab Orders' },
  { id: 'results' as const, label: 'Results' },
  { id: 'templates' as const, label: 'Templates' },
];

export function LaboratoryPage() {
  const { currentRole, userName, hasPermission, organization } = useAuth();
  const organizationId = organization.id;
  const { hasAccess } = useSubscription();
  const perms = useLabPermissions(currentRole, hasPermission);

  const [orders, setOrders] = useState<LabOrder[]>(() => (isSupabaseConfigured ? [] : seedOrders()));
  const [templates, setTemplates] = useState<LabTemplate[]>(isSupabaseConfigured ? [] : DEFAULT_TEMPLATES);
  const [patientMatches, setPatientMatches] = useState<PatientOption[]>([]);
  const [pickedPatient, setPickedPatient] = useState<PatientOption | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const [orderRows, templateRows] = await Promise.all([listLabOrders(organizationId), listLabTemplates(organizationId)]);
      setOrders(orderRows.map(orderFromRecord));
      setTemplates(templateRows);
    } catch (error) {
      toast.error(errorText(error, 'Could not load the laboratory'));
    }
  }, [organizationId]);

  useEffect(() => {
    void reload();
  }, [reload]);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['id']>('orders');
  const [search, setSearch] = useState('');
  const [expandedMobile, setExpandedMobile] = useState<Record<string, boolean>>({});

  const [filterStatus, setFilterStatus] = useState<LabStatus | 'all' | 'critical'>('all');
  const [filterPriority, setFilterPriority] = useState<LabPriority | 'all'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);

  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [patientQuery, setPatientQuery] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [customTest, setCustomTest] = useState('');
  const [newPriority, setNewPriority] = useState<LabPriority>('routine');
  const [newSample, setNewSample] = useState<SampleType>('blood');
  const [newNotes, setNewNotes] = useState('');

  const [sheetOrder, setSheetOrder] = useState<LabOrder | null>(null);
  const [resultDraft, setResultDraft] = useState<LabResultLine[]>([]);
  const [templateFormOpen, setTemplateFormOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<LabTemplate | null>(null);
  const [tplName, setTplName] = useState('');
  const [tplFieldsJson, setTplFieldsJson] = useState('[]');

  const [resultsFilters, setResultsFilters] = useState({
    patient: '',
    test: '',
    date: '',
    criticalOnly: false,
  });
  const [reportOpen, setReportOpen] = useState<{
    orderId: string;
    test: string;
    patient: string;
    value: string;
    ref: string;
    interpretation: string;
  } | null>(null);

  const tabBarRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<number | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !newOrderOpen) return;
    const needle = patientQuery.trim();
    if (pickedPatient && needle === `${pickedPatient.name} — ${pickedPatient.uhin}`) return;
    if (needle.length < 2) {
      setPatientMatches([]);
      return;
    }
    const timer = window.setTimeout(() => {
      queryPatients({
        tenantId: organizationId, page: 1, pageSize: 8, query: needle, sortBy: 'name', sortOrder: 'asc',
        filters: { gender: [], status: [], ageMin: '', ageMax: '', department: '', doctorAssigned: '', admissionStatus: '', chronicCondition: '', dateRegistered: '', insuranceProvider: '' },
      })
        .then((result) => setPatientMatches(result.rows.map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}`, uhin: row.switchId }))))
        .catch(() => setPatientMatches([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [patientQuery, newOrderOpen, pickedPatient, organizationId]);

  const filteredPatients = useMemo(() => {
    if (isSupabaseConfigured) return pickedPatient ? [pickedPatient, ...patientMatches.filter((p) => p.id !== pickedPatient.id)] : patientMatches;
    const q = patientQuery.trim().toLowerCase();
    if (!q) return DEMO_PATIENTS;
    return DEMO_PATIENTS.filter(
      (p) => p.name.toLowerCase().includes(q) || p.uhin.toLowerCase().includes(q),
    );
  }, [patientQuery, patientMatches, pickedPatient]);

  const requestedByDefault = currentRole === 'doctor' ? userName : '';

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      const matchSearch =
        !q ||
        o.patientName.toLowerCase().includes(q) ||
        o.id.toLowerCase().includes(q) ||
        o.tests.some((t) => t.toLowerCase().includes(q));
      const matchStatus =
        filterStatus === 'all' ||
        (filterStatus === 'critical' ? o.criticalFlag || o.results.some((r) => r.flaggedCritical) : o.status === filterStatus);
      const matchPri = filterPriority === 'all' || o.priority === filterPriority;
      const d = o.createdAt.slice(0, 10);
      const matchFrom = !dateFrom || d >= dateFrom;
      const matchTo = !dateTo || d <= dateTo;
      return matchSearch && matchStatus && matchPri && matchFrom && matchTo;
    });
  }, [orders, search, filterStatus, filterPriority, dateFrom, dateTo]);

  const completedResults = useMemo(() => seedCompletedResults(orders), [orders]);

  const filteredResultsTab = useMemo(() => {
    return completedResults.filter((r) => {
      const qP = resultsFilters.patient.trim().toLowerCase();
      const qT = resultsFilters.test.trim().toLowerCase();
      const matchP = !qP || r.patient.toLowerCase().includes(qP);
      const matchT = !qT || r.test.toLowerCase().includes(qT);
      const matchD = !resultsFilters.date || r.date === resultsFilters.date;
      const matchC = !resultsFilters.criticalOnly || r.critical;
      return matchP && matchT && matchD && matchC;
    });
  }, [completedResults, resultsFilters]);

  const stats = useMemo(() => {
    const pending = orders.filter((o) => o.status === 'pending').length;
    const processing = orders.filter((o) => o.status === 'processing').length;
    const completedToday = orders.filter(
      (o) => o.status === 'completed' && o.createdAt.startsWith(new Date().toISOString().slice(0, 10)),
    ).length;
    const critical = orders.filter((o) => o.criticalFlag || o.results.some((r) => r.flaggedCritical)).length;
    return { pending, processing, completedToday, critical };
  }, [orders]);

  const tabCounts = useMemo(
    () => ({
      orders: filteredOrders.length,
      results: filteredResultsTab.length,
      templates: templates.length,
    }),
    [filteredOrders.length, filteredResultsTab.length, templates.length],
  );

  const openOrderSheet = useCallback((order: LabOrder) => {
    setSheetOrder(order);
    setResultDraft(order.results.map((r) => ({ ...r, attachmentNames: [...r.attachmentNames] })));
  }, []);

  useEffect(() => {
    if (!sheetOrder) return;
    const fresh = orders.find((o) => o.id === sheetOrder.id);
    if (fresh) {
      setSheetOrder(fresh);
      setResultDraft(fresh.results.map((r) => ({ ...r, attachmentNames: [...r.attachmentNames] })));
    }
  }, [orders, sheetOrder?.id]);

  const persistOrderPatch = useCallback((id: string, patch: Partial<LabOrder>) => {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }, []);

  const handleTabSwipe = useCallback((deltaX: number) => {
    if (Math.abs(deltaX) < 48) return;
    const idx = tabs.findIndex((t) => t.id === activeTab);
    if (deltaX < 0 && idx < tabs.length - 1) setActiveTab(tabs[idx + 1].id);
    if (deltaX > 0 && idx > 0) setActiveTab(tabs[idx - 1].id);
  }, [activeTab]);

  const resetNewOrderForm = () => {
    setPatientQuery('');
    setSelectedPatientId(null);
    setPickedPatient(null);
    setPatientMatches([]);
    setSelectedTests([]);
    setCustomTest('');
    setNewPriority('routine');
    setNewSample('blood');
    setNewNotes('');
  };

  const submitNewOrder = () => {
    if (!perms.canCreateOrder) {
      toast.error('You do not have permission to create lab orders');
      return;
    }
    const patient = isSupabaseConfigured ? pickedPatient : DEMO_PATIENTS.find((p) => p.id === selectedPatientId);
    if (!patient) {
      toast.error('Select a patient');
      return;
    }
    const tests = [...selectedTests];
    if (customTest.trim()) tests.push(customTest.trim());
    if (!tests.length) {
      toast.error('Select at least one test');
      return;
    }
    if (isSupabaseConfigured) {
      const lines = defaultResultLines(tests).map((line) => ({
        name: line.testName,
        unit: line.unit,
        referenceRange: line.referenceRange === '—' ? '' : line.referenceRange,
      }));
      setBusy(true);
      createLabOrder(patient.id, lines, { priority: newPriority, sampleType: newSample, notes: newNotes })
        .then(async () => {
          await reload();
          setNewOrderOpen(false);
          resetNewOrderForm();
          toast.success('Lab order created', { description: `${patient.name} · Status: Pending` });
          window.dispatchEvent(new CustomEvent('vitalink:training-action', { detail: { action: 'laboratory:order-created' } }));
        })
        .catch((error) => toast.error(errorText(error, 'Could not create the lab order')))
        .finally(() => setBusy(false));
      return;
    }
    const id = nextOrderId(orders.map((o) => o.id));
    const newOrder: LabOrder = {
      id,
      patientId: patient.id,
      patientName: patient.name,
      uhin: patient.uhin,
      requestedBy: requestedByDefault || userName,
      doctorId: 'doc_self',
      tests,
      priority: newPriority,
      sampleType: newSample,
      status: 'pending',
      notes: newNotes,
      createdAt: new Date().toISOString(),
      criticalFlag: false,
      results: defaultResultLines(tests),
    };
    setOrders((prev) => [newOrder, ...prev]);
    setNewOrderOpen(false);
    resetNewOrderForm();
    toast.success('Lab order created', {
      description: `${id} · Status: Pending · Lab staff notified`,
    });
    window.dispatchEvent(
      new CustomEvent('vitalink:notify', {
        detail: { channel: 'lab', type: 'new-order', orderId: id, message: 'New lab order queued' },
      }),
    );
    window.dispatchEvent(new CustomEvent('vitalink:training-action', { detail: { action: 'laboratory:order-created' } }));
  };

  const exportCsv = () => {
    if (!perms.canExport) {
      toast.error('Export is restricted for your role');
      return;
    }
    const rows = [
      ['Order ID', 'Patient', 'UHID', 'Tests', 'Priority', 'Status', 'Critical', 'Created'].join(','),
      ...filteredOrders.map((o) =>
        [
          o.id,
          `"${o.patientName}"`,
          o.uhin,
          `"${o.tests.join('; ')}"`,
          o.priority,
          o.status,
          o.criticalFlag ? 'yes' : 'no',
          o.createdAt,
        ].join(','),
      ),
    ].join('\n');
    const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vitalink-lab-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const exportPdf = () => {
    if (!perms.canExport) {
      toast.error('Export is restricted for your role');
      return;
    }
    toast.message('PDF export', {
      description: 'Use your browser print dialog to save as PDF from the open order or results report.',
    });
    window.print();
  };

  const draftLines = () =>
    resultDraft
      .filter((r) => r.id)
      .map((r) => ({
        id: r.id as string,
        value: r.value,
        unit: r.unit,
        referenceRange: r.referenceRange,
        interpretation: r.interpretation,
        critical: r.flaggedCritical,
      }));

  const saveResultDraft = () => {
    if (!sheetOrder || !perms.canSaveDraft) return;
    if (isSupabaseConfigured && sheetOrder.dbId) {
      setBusy(true);
      saveLabResults(sheetOrder.dbId, draftLines(), false)
        .then(async () => {
          await reload();
          toast.success('Draft saved');
        })
        .catch((error) => toast.error(errorText(error, 'Could not save the draft')))
        .finally(() => setBusy(false));
      return;
    }
    persistOrderPatch(sheetOrder.id, {
      results: resultDraft.map((r) => ({ ...r })),
      draftSavedAt: new Date().toISOString(),
    });
    toast.success('Draft saved');
  };

  const submitResults = () => {
    if (!sheetOrder || !perms.canSubmitResults) return;
    const incomplete = resultDraft.some((r) => !r.value.trim());
    if (incomplete) {
      toast.error('Enter values for all tests before submitting');
      return;
    }
    const anyCritical = resultDraft.some((r) => r.flaggedCritical);
    if (isSupabaseConfigured && sheetOrder.dbId) {
      const order = sheetOrder;
      setBusy(true);
      saveLabResults(order.dbId as string, draftLines(), true)
        .then(async () => {
          await reload();
          announceResults(order, anyCritical);
        })
        .catch((error) => toast.error(errorText(error, 'Could not submit the results')))
        .finally(() => setBusy(false));
      return;
    }
    persistOrderPatch(sheetOrder.id, {
      results: resultDraft.map((r) => ({ ...r })),
      status: 'completed',
      criticalFlag: anyCritical,
    });
    announceResults(sheetOrder, anyCritical);
  };

  const announceResults = (order: LabOrder, anyCritical: boolean) => {
    toast.success('Results submitted', {
      description: anyCritical
        ? 'Critical flag set · Urgent alert sent to ordering physician'
        : 'Ordering clinician notified (results ready)',
    });
    if (anyCritical) {
      window.dispatchEvent(
        new CustomEvent('vitalink:notify', {
          detail: {
            channel: 'lab',
            type: 'critical',
            orderId: order.id,
            message: 'Critical lab result — immediate review',
          },
        }),
      );
    } else {
      window.dispatchEvent(
        new CustomEvent('vitalink:notify', {
          detail: { channel: 'lab', type: 'results-ready', orderId: order.id },
        }),
      );
    }
    window.dispatchEvent(new CustomEvent('vitalink:training-action', { detail: { action: 'laboratory:results-submitted' } }));
    window.dispatchEvent(new CustomEvent('vitalink:training-action', { detail: { action: 'laboratory:report-uploaded' } }));
    window.dispatchEvent(new CustomEvent('vitalink:training-action', { detail: { action: 'laboratory:doctor-notified' } }));
    window.dispatchEvent(
      new CustomEvent<SentinelLabPayload>(SENTINEL_LAB_EVENT, {
        detail: {
          orderId: order.id,
          patientName: order.patientName,
          tests: resultDraft.map((r) => ({
            name: r.testName,
            value: r.value,
            interpretation: r.interpretation,
            flaggedPositive: /positive|detected|reactive|elevated|critical/i.test(`${r.value} ${r.interpretation}`),
          })),
          // Live: the patient's recorded state (no LGA is captured yet); demo keeps sample values.
          state: isSupabaseConfigured ? order.patientState || undefined : 'Lagos',
          lga: isSupabaseConfigured ? undefined : 'Ikeja',
        },
      }),
    );
    setSheetOrder(null);
  };

  const setStatus = (order: LabOrder, status: LabStatus) => {
    if (status === 'processing' && !perms.canSetProcessing) {
      toast.error('You cannot move this order to processing');
      return;
    }
    if (status === 'completed' && !perms.canSetCompleted) {
      toast.error('Only lab scientists or admins can mark completed without full result entry');
      return;
    }
    if (isSupabaseConfigured && order.dbId) {
      if (status === 'completed') return;
      setLabOrderStatus(order.dbId, status)
        .then(async () => {
          await reload();
          toast.success(`Status updated → ${status}`);
        })
        .catch((error) => toast.error(errorText(error, 'Could not update the order')));
    } else {
      persistOrderPatch(order.id, { status });
      toast.success(`Status updated → ${status}`);
    }
    if (status === 'processing') {
      window.dispatchEvent(new CustomEvent('vitalink:training-action', { detail: { action: 'laboratory:processing' } }));
    }
  };

  const cancelOrder = (order: LabOrder) => {
    if (!perms.canDeleteOrder && currentRole !== 'hospital-admin' && currentRole !== 'super-admin') {
      toast.error('You cannot cancel orders');
      return;
    }
    if (isSupabaseConfigured && order.dbId) {
      setLabOrderStatus(order.dbId, 'cancelled')
        .then(async () => {
          await reload();
          toast.message('Order cancelled');
          setSheetOrder(null);
        })
        .catch((error) => toast.error(errorText(error, 'Could not cancel the order')));
      return;
    }
    persistOrderPatch(order.id, { status: 'cancelled' });
    toast.message('Order cancelled');
    setSheetOrder(null);
  };

  const toggleTest = (t: string) => {
    setSelectedTests((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const saveTemplate = () => {
    if (!perms.canManageTemplates) return;
    let fields: LabTemplate['fields'];
    try {
      fields = JSON.parse(tplFieldsJson) as LabTemplate['fields'];
      if (!Array.isArray(fields)) throw new Error('invalid');
    } catch {
      toast.error('Fields must be a JSON array of { name, unit, referenceRange }');
      return;
    }
    if (isSupabaseConfigured) {
      if (!tplName.trim()) {
        toast.error('Give the template a name');
        return;
      }
      saveLabTemplate(organizationId, { id: editingTemplate?.id, name: tplName, fields })
        .then(async () => {
          await reload();
          toast.success(editingTemplate ? 'Template updated' : 'Template created');
          setTemplateFormOpen(false);
          setEditingTemplate(null);
        })
        .catch((error) => toast.error(errorText(error, 'Could not save the template')));
      return;
    }
    if (editingTemplate) {
      setTemplates((prev) =>
        prev.map((t) => (t.id === editingTemplate.id ? { ...t, name: tplName, fields } : t)),
      );
      toast.success('Template updated');
    } else {
      setTemplates((prev) => [...prev, { id: `tpl-${Date.now()}`, name: tplName, fields }]);
      toast.success('Template created');
    }
    setTemplateFormOpen(false);
    setEditingTemplate(null);
  };

  const openTemplateEditor = (t: LabTemplate | null) => {
    if (t) {
      setEditingTemplate(t);
      setTplName(t.name);
      setTplFieldsJson(JSON.stringify(t.fields, null, 2));
    } else {
      setEditingTemplate(null);
      setTplName('');
      setTplFieldsJson(
        JSON.stringify(
          [{ name: 'Analyte', unit: '', referenceRange: '' }],
          null,
          2,
        ),
      );
    }
    setTemplateFormOpen(true);
  };

  const bulkCsvInputRef = useRef<HTMLInputElement>(null);

  const onBulkCsv = (file: File | null) => {
    if (!file || !perms.canBulkUpload) return;
    toast.success('Bulk upload queued', {
      description: `${file.name} will be validated and mapped to orders (demo).`,
    });
  };

  const statusBadge = (o: LabOrder) => {
    const showCritical = o.criticalFlag || o.results.some((r) => r.flaggedCritical);
    if (showCritical && o.status === 'completed') {
      return (
        <span className="px-3 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
          Critical
        </span>
      );
    }
    const map: Record<LabStatus, string> = {
      pending: 'bg-amber-100 text-amber-800 border border-amber-200',
      processing: 'bg-blue-100 text-blue-800 border border-blue-200',
      completed: 'bg-emerald-100 text-emerald-800 border border-emerald-200',
      cancelled: 'bg-gray-100 text-gray-600 border border-gray-200',
    };
    return (
      <span className={cn('px-3 py-1 rounded-full text-xs font-medium capitalize', map[o.status])}>
        {o.status}
      </span>
    );
  };

  if (!perms.canView) {
    return (
      <div className="premium-card p-8 text-center text-gray-600 page-transition">
        <p className="font-medium text-gray-900">Laboratory</p>
        <p className="text-sm mt-2">You do not have access to the Laboratory module for this role.</p>
      </div>
    );
  }
  if (!hasAccess('laboratory')) {
    return (
      <div className="premium-card p-8 text-center text-gray-600 page-transition">
        <p className="font-medium text-gray-900">Laboratory</p>
        <p className="text-sm mt-2">Laboratory is locked on your plan. Upgrade to Pro.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 page-transition pb-24 md:pb-8">
      <div
        className="sticky top-0 z-30 -mx-4 px-4 pt-2 pb-3 md:mx-0 md:px-0 bg-[hsl(var(--background))]/90 backdrop-blur-md border-b border-white/40 md:border-0 md:bg-transparent md:backdrop-blur-none"
        ref={tabBarRef}
        onTouchStart={(e) => {
          touchStart.current = e.targetTouches[0].clientX;
        }}
        onTouchEnd={(e) => {
          if (touchStart.current == null) return;
          const end = e.changedTouches[0].clientX;
          handleTabSwipe(touchStart.current - end);
          touchStart.current = null;
        }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-[#1E4ED8]">Laboratory</h1>
            <p className="text-xs md:text-sm text-gray-500 mt-0.5">
              VitaLink · Orders, results, templates — role-aware workflow
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {perms.canBulkUpload && !isSupabaseConfigured && (
              <>
                <input
                  ref={bulkCsvInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => onBulkCsv(e.target.files?.[0] ?? null)}
                />
                <Button
                  data-tour-id="lab-bulk-upload"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 rounded-xl border-[#1E4ED8]/20"
                  onClick={() => {
                    bulkCsvInputRef.current?.click();
                    window.dispatchEvent(new CustomEvent('vitalink:tour-trigger', { detail: { tourId: 'micro-lab-upload' } }));
                  }}
                >
                  <Upload className="w-4 h-4" />
                  Bulk CSV
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-xl border-[#1E4ED8]/20"
              disabled={!perms.canExport}
              onClick={exportCsv}
            >
              <Download className="w-4 h-4" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 rounded-xl border-[#1E4ED8]/20"
              disabled={!perms.canExport}
              onClick={exportPdf}
            >
              <FileText className="w-4 h-4" />
              PDF
            </Button>
            <Button
              size="sm"
              className="gap-1.5 rounded-xl bg-gradient-to-r from-[#1E4ED8] to-[#1E3A8A] text-white shadow-md"
              disabled={!perms.canCreateOrder}
              onClick={() => {
                resetNewOrderForm();
                setNewOrderOpen(true);
              }}
            >
              <Plus className="w-4 h-4" />
              New Order
            </Button>
          </div>
        </div>

        <div className="dashboard-stat-grid mt-4">
          {[
            { label: 'Pending', value: stats.pending, icon: Clock, tone: 'amber' },
            { label: 'Processing', value: stats.processing, icon: FlaskConical, tone: 'blue' },
            { label: 'Completed today', value: stats.completedToday, icon: CheckCircle2, tone: 'emerald' },
            { label: 'Critical', value: stats.critical, icon: AlertCircle, tone: 'red' },
          ].map((s) => (
            <div
              key={s.label}
              className="glass-panel rounded-2xl p-3 md:p-4 border border-white/50 shadow-sm transition-transform"
            >
              <div className="flex items-center gap-2 md:gap-3">
                <div
                  className={cn(
                    'w-9 h-9 md:w-10 md:h-10 rounded-xl flex items-center justify-center shrink-0',
                    s.tone === 'amber' && 'bg-amber-100',
                    s.tone === 'blue' && 'bg-blue-100',
                    s.tone === 'emerald' && 'bg-emerald-100',
                    s.tone === 'red' && 'bg-red-100',
                  )}
                >
                  <s.icon
                    className={cn(
                      'w-4 h-4 md:w-5 md:h-5',
                      s.tone === 'amber' && 'text-amber-600',
                      s.tone === 'blue' && 'text-blue-600',
                      s.tone === 'emerald' && 'text-emerald-600',
                      s.tone === 'red' && 'text-red-600',
                    )}
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-lg md:text-2xl font-bold text-gray-900 leading-tight">{s.value}</p>
                  <p className="text-[10px] md:text-xs text-gray-500 truncate">{s.label}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5 p-1 mt-4 rounded-2xl bg-white/60 backdrop-blur-md border border-white/60 shadow-inner w-full max-w-full dark:border-slate-700 dark:bg-slate-900/50">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm font-medium transition-all duration-200 shrink-0',
                activeTab === tab.id
                  ? 'bg-[#1E4ED8] text-white shadow-md dark:text-white'
                  : 'text-gray-600 hover:bg-white/80 dark:text-slate-400 dark:hover:bg-slate-800/60',
              )}
            >
              {tab.label}
              <span
                className={cn(
                  'px-2 py-0.5 rounded-full text-[10px] md:text-xs',
                   activeTab === tab.id ? 'bg-white/20 text-white dark:text-white' : 'bg-gray-200/80 text-gray-600 dark:bg-slate-800/80 dark:text-slate-400',
                )}
              >
                {tabCounts[tab.id]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {activeTab !== 'templates' && (
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patient, order ID, or test type…"
              className="pl-10 py-2.5 rounded-xl bg-white/80 border-[#1E4ED8]/15 dark:bg-slate-900/50 dark:text-slate-50"
            />
          </div>
          <Popover open={filterOpen} onOpenChange={setFilterOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2 rounded-xl border-[#1E4ED8]/20 shrink-0">
                <Filter className="w-4 h-4" />
                Filters
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 glass-panel border-white/60" align="end">
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Status</Label>
                  <select
                    className="mt-1 w-full rounded-lg border border-gray-200 bg-white/90 px-2 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-50"
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
                  >
                    <option value="all">All</option>
                    <option value="pending">Pending</option>
                    <option value="processing">Processing</option>
                    <option value="completed">Completed</option>
                    <option value="critical">Critical only</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div>
                  <Label className="text-xs">Priority</Label>
                  <select
                    className="mt-1 w-full rounded-lg border border-gray-200 bg-white/90 px-2 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-50"
                    value={filterPriority}
                    onChange={(e) => setFilterPriority(e.target.value as typeof filterPriority)}
                  >
                    <option value="all">All</option>
                    <option value="routine">Routine</option>
                    <option value="urgent">Urgent</option>
                    <option value="stat">STAT</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">From</Label>
                    <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <Label className="text-xs">To</Label>
                    <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="mt-1" />
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setFilterStatus('all');
                    setFilterPriority('all');
                    setDateFrom('');
                    setDateTo('');
                  }}
                >
                  Reset filters
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {activeTab === 'orders' && (
        <>
          {/* Desktop / tablet table */}
          <div className="hidden md:block glass-panel rounded-2xl border border-white/60 overflow-hidden shadow-soft">
            <div className="responsive-table-wrap">
              <table className="w-full text-sm table-fixed">
                <thead>
                  <tr className="bg-gray-100 border-b border-[#1E4ED8]/10 dark:bg-slate-800/80 dark:border-slate-700">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wide dark:text-slate-300">
                      Order ID
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase dark:text-slate-300">Patient</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase dark:text-slate-300">Tests</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase dark:text-slate-300">Priority</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase dark:text-slate-300">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase dark:text-slate-300">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => (
                    <tr
                      key={order.id}
                      className="border-b border-gray-100/80 hover:bg-white/50 cursor-pointer transition-colors dark:border-slate-700 dark:hover:bg-slate-800/60"
                      onClick={() => openOrderSheet(order)}
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-[#1E4ED8] font-medium">{order.id}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 dark:text-slate-50">{order.patientName}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400">{order.uhin}</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 max-w-[220px]">
                          {order.tests.map((test) => (
                            <span
                              key={test}
                              className="px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-800 text-xs border border-indigo-100"
                            >
                              {test}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'px-2.5 py-1 rounded-full text-xs font-medium uppercase',
                            order.priority === 'stat'
                              ? 'bg-red-100 text-red-800'
                              : order.priority === 'urgent'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-gray-100 text-gray-600 dark:bg-slate-800/80 dark:text-slate-300',
                          )}
                        >
                          {order.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3">{statusBadge(order)}</td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <RowActionsMenu
                          order={order}
                          perms={perms}
                          onOpen={() => openOrderSheet(order)}
                          onPrint={() => window.print()}
                          onCancel={() => cancelOrder(order)}
                          onSetProcessing={() => setStatus(order, 'processing')}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3">
            {filteredOrders.map((order) => (
              <div
                key={order.id}
                className="glass-panel rounded-2xl border border-white/60 overflow-hidden shadow-sm transition-transform"
              >
                <button
                  type="button"
                  className="w-full text-left p-4 flex items-start justify-between gap-2"
                  onClick={() => openOrderSheet(order)}
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm text-[#1E4ED8] font-semibold">{order.id}</p>
                    <p className="font-medium text-gray-900 mt-1 dark:text-slate-50">{order.patientName}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">{order.uhin}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {order.tests.slice(0, 3).map((t) => (
                        <span key={t} className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 text-[10px] dark:bg-indigo-500/15 dark:text-indigo-300">
                          {t}
                        </span>
                      ))}
                      {order.tests.length > 3 && (
                        <span className="text-[10px] text-gray-500 dark:text-slate-400">+{order.tests.length - 3}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">{statusBadge(order)}</div>
                </button>
                <div className="px-4 pb-2 flex items-center justify-between border-t border-white/40 bg-white/30 dark:border-slate-700 dark:bg-slate-900/50">
                  <button
                    type="button"
                    className="flex items-center gap-1 text-xs text-[#1E4ED8] py-2"
                    onClick={() =>
                      setExpandedMobile((m) => ({ ...m, [order.id]: !m[order.id] }))
                    }
                  >
                    {expandedMobile[order.id] ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                    Details
                  </button>
                  <RowActionsMenu
                    order={order}
                    perms={perms}
                    onOpen={() => openOrderSheet(order)}
                    onPrint={() => window.print()}
                    onCancel={() => cancelOrder(order)}
                    onSetProcessing={() => setStatus(order, 'processing')}
                  />
                </div>
                {expandedMobile[order.id] && (
                  <div className="px-4 pb-4 text-xs text-gray-600 space-y-1 border-t border-white/40 bg-white/20 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
                    <p>
                      <span className="text-gray-400 dark:text-slate-500">Requested by:</span> {order.requestedBy}
                    </p>
                    <p>
                      <span className="text-gray-400 dark:text-slate-500">Sample:</span> {order.sampleType}
                    </p>
                    <p>
                      <span className="text-gray-400 dark:text-slate-500">Priority:</span> {order.priority}
                    </p>
                    {order.notes && (
                      <p>
                        <span className="text-gray-400 dark:text-slate-500">Notes:</span> {order.notes}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {activeTab === 'results' && (
        <div className="space-y-3">
          <div className="dashboard-stat-grid">
            <Input
              placeholder="Patient"
              value={resultsFilters.patient}
              onChange={(e) => setResultsFilters((f) => ({ ...f, patient: e.target.value }))}
              className="rounded-xl bg-white/80 dark:bg-slate-900/50 dark:text-slate-50"
            />
            <Input
              placeholder="Test type"
              value={resultsFilters.test}
              onChange={(e) => setResultsFilters((f) => ({ ...f, test: e.target.value }))}
              className="rounded-xl bg-white/80 dark:bg-slate-900/50 dark:text-slate-50"
            />
            <Input
              type="date"
              value={resultsFilters.date}
              onChange={(e) => setResultsFilters((f) => ({ ...f, date: e.target.value }))}
              className="rounded-xl bg-white/80 dark:bg-slate-900/50 dark:text-slate-50"
            />
            <label className="flex items-center gap-2 text-sm text-gray-700 glass-panel rounded-xl px-3 border border-white/60 dark:border-slate-700 dark:text-slate-200">
              <Checkbox
                checked={resultsFilters.criticalOnly}
                onCheckedChange={(c) => setResultsFilters((f) => ({ ...f, criticalOnly: !!c }))}
              />
              Critical only
            </label>
          </div>

          <div className="hidden lg:block glass-panel rounded-2xl border border-white/60 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-100 border-b dark:bg-slate-800/80 dark:border-slate-700">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase dark:text-slate-300">Test</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase dark:text-slate-300">Patient</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase dark:text-slate-300">Result</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase dark:text-slate-300">Reference</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase dark:text-slate-300">Flag</th>
                </tr>
              </thead>
              <tbody>
                {filteredResultsTab.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-gray-50 hover:bg-white/60 cursor-pointer dark:border-slate-700 dark:hover:bg-slate-800/60"
                    onClick={() =>
                      setReportOpen({
                        orderId: r.orderId,
                        test: r.test,
                        patient: r.patient,
                        value: r.value,
                        ref: r.reference,
                        interpretation: r.interpretation,
                      })
                    }
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-50">{r.test}</td>
                    <td className="px-4 py-3">{r.patient}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900 dark:text-slate-50">{r.value}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-slate-400">{r.reference}</td>
                    <td className="px-4 py-3">
                      {r.critical ? (
                        <span className="text-red-600 text-xs font-semibold flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" /> Critical
                        </span>
                      ) : (
                        <span className="text-emerald-600 text-xs">Normal</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="lg:hidden space-y-2">
            {filteredResultsTab.map((r) => (
              <button
                key={r.id}
                type="button"
                className="w-full text-left glass-panel rounded-2xl p-4 border border-white/60"
                onClick={() =>
                  setReportOpen({
                    orderId: r.orderId,
                    test: r.test,
                    patient: r.patient,
                    value: r.value,
                    ref: r.reference,
                    interpretation: r.interpretation,
                  })
                }
              >
                <div className="flex justify-between gap-2">
                  <span className="font-medium text-gray-900 dark:text-slate-50">{r.test}</span>
                  {r.critical && <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
                </div>
                <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">{r.patient}</p>
                <p className="text-sm font-semibold mt-2 text-slate-900 dark:text-slate-50">{r.value}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'templates' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              className="rounded-xl bg-[#1E4ED8] text-white"
              disabled={!perms.canManageTemplates}
              onClick={() => openTemplateEditor(null)}
            >
              <Plus className="w-4 h-4 mr-2" />
              New template
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {templates.map((t) => (
              <div key={t.id} className="glass-panel rounded-2xl p-4 border border-white/60 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-slate-50">{t.name}</h3>
                    <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">{t.fields.length} field(s)</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={!perms.canManageTemplates}
                    onClick={() => openTemplateEditor(t)}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                </div>
                <ul className="mt-3 text-xs text-gray-600 space-y-1 dark:text-slate-400">
                  {t.fields.slice(0, 4).map((f) => (
                    <li key={f.name}>
                      {f.name} — {f.unit} (ref {f.referenceRange})
                    </li>
                  ))}
                  {t.fields.length > 4 && <li>…</li>}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New order modal */}
      <Dialog open={newOrderOpen} onOpenChange={setNewOrderOpen}>
        <DialogContent className="glass-panel border-white/60 sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New lab order</DialogTitle>
            <DialogDescription>
              Order IDs use VLL-YEAR-#### (e.g. VLL-2026-0005). Submitting sets status to Pending and notifies lab staff.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Patient</Label>
              <Input
                placeholder="Search name or VitaLink ID…"
                value={patientQuery}
                onChange={(e) => setPatientQuery(e.target.value)}
                className="mt-1 rounded-xl"
              />
              <div className="mt-2 max-h-36 overflow-y-auto rounded-xl border border-gray-200 bg-white/90 dark:border-slate-700 dark:bg-slate-900/50">
                {isSupabaseConfigured && filteredPatients.length === 0 && (
                  <p className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400">
                    {patientQuery.trim().length < 2 ? 'Type at least 2 letters to search patients.' : 'No matching patients.'}
                  </p>
                )}
                {filteredPatients.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={cn(
                       'w-full text-left px-3 py-2 text-sm text-slate-900 hover:bg-[#1E4ED8]/5 dark:text-slate-200 dark:hover:bg-slate-800/60',
                       selectedPatientId === p.id && 'bg-[#1E4ED8]/10 font-medium dark:bg-slate-800/80',
                    )}
                    onClick={() => {
                      setSelectedPatientId(p.id);
                      setPickedPatient(p);
                      setPatientQuery(`${p.name} — ${p.uhin}`);
                    }}
                  >
                    {p.name} <span className="text-gray-500 text-xs dark:text-slate-400">{p.uhin}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Requested by</Label>
              <Input
                readOnly={!!requestedByDefault}
                value={requestedByDefault || userName}
                className="mt-1 rounded-xl bg-gray-50/80 text-slate-900 dark:bg-slate-900/50 dark:text-slate-50"
                onChange={() => {}}
              />
              {!requestedByDefault && (
                 <p className="text-[10px] text-gray-500 mt-1 dark:text-slate-400">Shown as current user; adjust in production EMR.</p>
              )}
            </div>
            <div>
              <Label>Tests (multi-select)</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {PRESET_TESTS.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox checked={selectedTests.includes(t)} onCheckedChange={() => toggleTest(t)} />
                    {t}
                  </label>
                ))}
              </div>
              <Input
                placeholder="Custom test name"
                value={customTest}
                onChange={(e) => setCustomTest(e.target.value)}
                className="mt-2 rounded-xl"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Priority</Label>
                <select
                  className="mt-1 w-full rounded-xl border border-input bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-50"
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value as LabPriority)}
                >
                  <option value="routine">Routine</option>
                  <option value="urgent">Urgent</option>
                  <option value="stat">STAT</option>
                </select>
              </div>
              <div>
                <Label>Sample type</Label>
                <select
                  className="mt-1 w-full rounded-xl border border-input bg-white px-2 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-50"
                  value={newSample}
                  onChange={(e) => setNewSample(e.target.value as SampleType)}
                >
                  <option value="blood">Blood</option>
                  <option value="urine">Urine</option>
                  <option value="imaging">Imaging</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                className="mt-1 rounded-xl min-h-[72px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOrderOpen(false)}>
              Cancel
            </Button>
            <Button className="bg-[#1E4ED8] text-white" disabled={busy} onClick={submitNewOrder}>
              Create order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Order + result entry sheet */}
      <Sheet open={!!sheetOrder} onOpenChange={(o) => !o && setSheetOrder(null)}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg md:max-w-xl overflow-y-auto glass-panel border-l border-white/60"
        >
          {sheetOrder && (
            <>
              <SheetHeader>
                <SheetTitle className="text-[#1E4ED8]">{sheetOrder.id}</SheetTitle>
                <SheetDescription>
                  {sheetOrder.patientName} · {sheetOrder.uhin}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-4 px-4 pb-4">
                <div className="flex flex-wrap gap-2">
                  {statusBadge(sheetOrder)}
                  <span className="px-2 py-1 rounded-lg bg-gray-100 text-xs capitalize dark:bg-slate-800/80 dark:text-slate-300">{sheetOrder.priority}</span>
                  <span className="px-2 py-1 rounded-lg bg-gray-100 text-xs capitalize dark:bg-slate-800/80 dark:text-slate-300">{sheetOrder.sampleType}</span>
                </div>

                <div className="rounded-xl border border-dashed border-[#1E4ED8]/25 p-3 flex items-center gap-3 bg-white/50 dark:bg-slate-800/60">
                  <QrCode className="w-10 h-10 text-[#1E4ED8]" />
                  <div className="text-xs text-gray-600 dark:text-slate-400">
                    <p className="font-medium text-gray-900 dark:text-slate-50">Sample tracking</p>
                    <p className="font-mono mt-0.5">{sheetOrder.id}-S01</p>
                    {!isSupabaseConfigured && (
                      <p className="text-[10px] text-gray-500 mt-1 dark:text-slate-400">Barcode / QR scan hooks to LIS (demo).</p>
                    )}
                  </div>
                </div>

                {/* Offline demo only: EMR link, VitaMind and offline sync are not connected in live workspaces. */}
                {!isSupabaseConfigured && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 rounded-xl text-xs"
                    onClick={() => toast.success('Linked to patient EMR', { description: sheetOrder.uhin })}
                  >
                    <Link2 className="w-3.5 h-3.5" />
                    EMR
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 rounded-xl text-xs"
                    onClick={() =>
                      toast.message('VitaMind AI', { description: 'Insights queued for this order (demo).' })
                    }
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    VitaMind sync
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1 rounded-xl text-xs" onClick={() => toast.message('Offline', { description: 'IndexedDB sync stub — demo only.' })}>
                    <WifiOff className="w-3.5 h-3.5" />
                    Offline
                  </Button>
                </div>
                )}

                <div className="text-sm space-y-1 text-gray-700 dark:text-slate-200">
                  <p>
                    <span className="text-gray-400">Requested by:</span> {sheetOrder.requestedBy}
                  </p>
                  <p>
                    <span className="text-gray-400">Tests:</span> {sheetOrder.tests.join(', ')}
                  </p>
                  {sheetOrder.notes && (
                    <p>
                      <span className="text-gray-400">Notes:</span> {sheetOrder.notes}
                    </p>
                  )}
                </div>

                {perms.canAdvanceStatus && sheetOrder.status !== 'cancelled' && sheetOrder.status !== 'completed' && (
                  <div className="flex flex-wrap gap-2">
                    {sheetOrder.status === 'pending' && (
                      <Button size="sm" className="rounded-xl bg-blue-600 text-white" onClick={() => setStatus(sheetOrder, 'processing')}>
                        Mark sample received (Processing)
                      </Button>
                    )}
                    {perms.canSetCompleted && sheetOrder.status === 'processing' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="rounded-xl"
                        onClick={() => {
                          if (!perms.canSubmitResults) {
                            toast.error('Complete result entry before marking completed');
                            return;
                          }
                          toast.message('Use Submit results after entering values');
                        }}
                      >
                        Hint: submit results
                      </Button>
                    )}
                  </div>
                )}

                {(perms.canSubmitResults ||
                  perms.canSaveDraft ||
                  perms.canAddDoctorInterpretation ||
                  perms.techLimited ||
                  perms.isReadOnlyResults) && (
                  <div className="rounded-2xl border border-white/60 bg-white/40 p-4 space-y-4 dark:border-slate-700 dark:bg-slate-800/60">
                    <h4 className="text-sm font-semibold text-[#1E4ED8]">
                      {perms.isReadOnlyResults ? 'Results (read-only)' : 'Result entry'}
                    </h4>
                    {resultDraft.map((line, idx) => (
                      <div key={line.id ?? line.testName} className="space-y-2 pb-4 border-b border-gray-100 last:border-0 dark:border-slate-700">
                        <p className="text-xs font-semibold text-gray-800 dark:text-slate-200">{line.testName}</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="col-span-2">
                            <Label className="text-[10px]">Value</Label>
                            <Input
                              value={line.value}
                              disabled={
                                perms.isReadOnlyResults ||
                                perms.doctorInterpretationOnly ||
                                line.locked ||
                                sheetOrder.status === 'completed'
                              }
                              onChange={(e) => {
                                const v = e.target.value;
                                setResultDraft((rows) =>
                                  rows.map((r, i) => (i === idx ? { ...r, value: v } : r)),
                                );
                              }}
                              className="h-9 rounded-lg text-sm"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Unit</Label>
                            <Input
                              value={line.unit}
                              disabled={
                                perms.isReadOnlyResults ||
                                perms.doctorInterpretationOnly ||
                                (!perms.canSubmitResults && !perms.canOverrideResults)
                              }
                              onChange={(e) =>
                                setResultDraft((rows) =>
                                  rows.map((r, i) => (i === idx ? { ...r, unit: e.target.value } : r)),
                                )
                              }
                              className="h-9 rounded-lg text-sm"
                            />
                          </div>
                          <div>
                            <Label className="text-[10px]">Reference</Label>
                            <Input
                              value={line.referenceRange}
                              disabled={
                                perms.isReadOnlyResults ||
                                perms.doctorInterpretationOnly ||
                                (!perms.canSubmitResults && !perms.canOverrideResults)
                              }
                              onChange={(e) =>
                                setResultDraft((rows) =>
                                  rows.map((r, i) => (i === idx ? { ...r, referenceRange: e.target.value } : r)),
                                )
                              }
                              className="h-9 rounded-lg text-sm"
                            />
                          </div>
                          <div className="col-span-2">
                            <Label className="text-[10px]">Interpretation</Label>
                            <Textarea
                              value={line.interpretation}
                              disabled={
                                perms.isReadOnlyResults ||
                                (perms.techLimited && !perms.canSubmitResults)
                              }
                              onChange={(e) =>
                                setResultDraft((rows) =>
                                  rows.map((r, i) => (i === idx ? { ...r, interpretation: e.target.value } : r)),
                                )
                              }
                              className="min-h-[56px] rounded-lg text-sm"
                            />
                          </div>
                          {perms.canFlagCritical && !perms.doctorInterpretationOnly && !perms.isReadOnlyResults && (
                            <label className="col-span-2 flex items-center gap-2 text-xs">
                              <Checkbox
                                checked={line.flaggedCritical}
                                onCheckedChange={(c) =>
                                  setResultDraft((rows) =>
                                    rows.map((r, i) => (i === idx ? { ...r, flaggedCritical: !!c } : r)),
                                  )
                                }
                              />
                              Mark line as critical
                            </label>
                          )}
                          {!isSupabaseConfigured && !perms.isReadOnlyResults && !perms.doctorInterpretationOnly && (
                            <div className="col-span-2">
                              <Label className="text-[10px]">Attachments (demo)</Label>
                              <Input
                                type="file"
                                accept=".pdf,image/*"
                                className="text-xs"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (!f) return;
                                  setResultDraft((rows) =>
                                    rows.map((r, i) =>
                                      i === idx ? { ...r, attachmentNames: [...r.attachmentNames, f.name] } : r,
                                    ),
                                  );
                                  toast.success(`Attached ${f.name}`);
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}

                    <div className="flex flex-wrap gap-2 pt-2">
                      {perms.canSaveDraft && !perms.doctorInterpretationOnly && !perms.isReadOnlyResults && (
                        <Button variant="outline" size="sm" className="rounded-xl" disabled={busy || sheetOrder.status === 'completed'} onClick={saveResultDraft}>
                          Save draft
                        </Button>
                      )}
                      {perms.doctorInterpretationOnly && sheetOrder.status !== 'cancelled' && (
                        <Button
                          size="sm"
                          className="rounded-xl bg-[#1E4ED8] text-white"
                          onClick={() => {
                            if (!sheetOrder) return;
                            if (isSupabaseConfigured && sheetOrder.dbId) {
                              saveLabResults(sheetOrder.dbId, draftLines(), false)
                                .then(async () => {
                                  await reload();
                                  toast.success('Interpretation saved', { description: "Visible on the patient's EMR lab results" });
                                })
                                .catch((error) => toast.error(errorText(error, 'Could not save the interpretation')));
                              return;
                            }
                            persistOrderPatch(sheetOrder.id, { results: resultDraft.map((r) => ({ ...r })) });
                            toast.success('Interpretation saved', {
                              description: 'Linked to EMR patient chart (demo)',
                            });
                          }}
                        >
                          Save interpretation
                        </Button>
                      )}
                      {perms.canSubmitResults && sheetOrder.status !== 'cancelled' && !perms.isReadOnlyResults && (
                        <Button size="sm" className="rounded-xl bg-emerald-600 text-white" disabled={busy || sheetOrder.status === 'completed'} onClick={submitResults}>
                          Submit results
                        </Button>
                      )}
                      {perms.techLimited && (
                            <p className="text-[10px] text-gray-500 w-full dark:text-slate-400">
                          Lab technicians: save drafts and set status to Processing; final sign-off by lab scientist.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {perms.isReadOnlyResults && (
                  <p className="text-xs text-gray-500 dark:text-slate-400">Your role has read-only access to this order.</p>
                )}
              </div>

              <SheetFooter className="flex-col sm:flex-row gap-2 border-t border-white/40 bg-white/30 dark:border-slate-700 dark:bg-slate-900/50">
                <Button variant="outline" className="rounded-xl gap-2" onClick={() => window.print()}>
                  <Printer className="w-4 h-4" />
                  Print
                </Button>
                {(perms.canDeleteOrder || currentRole === 'super-admin') && sheetOrder.status !== 'cancelled' && (
                  <Button variant="destructive" className="rounded-xl gap-2" onClick={() => cancelOrder(sheetOrder)}>
                    <XCircle className="w-4 h-4" />
                    Cancel order
                  </Button>
                )}
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Full report dialog */}
      <Dialog open={!!reportOpen} onOpenChange={(o) => !o && setReportOpen(null)}>
        <DialogContent className="glass-panel sm:max-w-md">
          {reportOpen && (
            <>
              <DialogHeader>
                <DialogTitle>{reportOpen.test}</DialogTitle>
                <DialogDescription>
                  {reportOpen.patient} · {reportOpen.orderId}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <p>
                  <span className="text-gray-500">Result:</span>{' '}
                  <span className="font-semibold">{reportOpen.value}</span>
                </p>
                <p>
                  <span className="text-gray-500">Reference:</span> {reportOpen.ref}
                </p>
                {reportOpen.interpretation && (
                  <p>
                    <span className="text-gray-500">Interpretation:</span> {reportOpen.interpretation}
                  </p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => window.print()}>
                  <Printer className="w-4 h-4 mr-2" />
                  Print report
                </Button>
                <Button className="bg-[#1E4ED8] text-white" onClick={() => setReportOpen(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Template editor */}
      <Dialog open={templateFormOpen} onOpenChange={setTemplateFormOpen}>
        <DialogContent className="glass-panel sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingTemplate ? 'Edit template' : 'New template'}</DialogTitle>
            <DialogDescription>JSON array of fields: name, unit, referenceRange</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input value={tplName} onChange={(e) => setTplName(e.target.value)} className="mt-1 rounded-xl" />
            </div>
            <div>
              <Label>Fields JSON</Label>
              <Textarea
                value={tplFieldsJson}
                onChange={(e) => setTplFieldsJson(e.target.value)}
                className="mt-1 font-mono text-xs min-h-[160px] rounded-xl"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateFormOpen(false)}>
              Cancel
            </Button>
            <Button className="bg-[#1E4ED8] text-white" onClick={saveTemplate}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RowActionsMenu({
  order,
  perms,
  onOpen,
  onPrint,
  onCancel,
  onSetProcessing,
}: {
  order: LabOrder;
  perms: ReturnType<typeof useLabPermissions>;
  onOpen: () => void;
  onPrint: () => void;
  onCancel: () => void;
  onSetProcessing: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-xl" onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="w-5 h-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 glass-panel border-white/60">
        <DropdownMenuItem onClick={onOpen}>
          <Eye className="w-4 h-4 mr-2" />
          View details
        </DropdownMenuItem>
        {perms.canEditMeta && order.status !== 'cancelled' && (
          <DropdownMenuItem onClick={onOpen}>
            <Pencil className="w-4 h-4 mr-2" />
            Edit in panel
          </DropdownMenuItem>
        )}
        {order.status === 'pending' && perms.canSetProcessing && (
          <DropdownMenuItem onClick={onSetProcessing}>Mark processing</DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onPrint}>
          <Printer className="w-4 h-4 mr-2" />
          Print report
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {(perms.canDeleteOrder || perms.canOverrideResults) && order.status !== 'cancelled' && (
          <DropdownMenuItem className="text-red-600" onClick={onCancel}>
            <XCircle className="w-4 h-4 mr-2" />
            Cancel order
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
