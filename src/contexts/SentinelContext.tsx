import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { DISEASE_CATALOG } from '@/lib/sentinel/diseaseCatalog';
import { evaluateOutbreakSignals } from '@/lib/sentinel/outbreakEngine';
import {
  SENTINEL_CLINICAL_EVENT,
  SENTINEL_LAB_EVENT,
  SENTINEL_PHARMACY_EVENT,
  type SentinelClinicalPayload,
  type SentinelLabPayload,
  type SentinelPharmacyPayload,
} from '@/lib/sentinel/events';
import { primaryMatch } from '@/lib/sentinel/matchDisease';
import { canConfigureThresholds, tabsForRole } from '@/lib/sentinel/sentinelRbac';
import { formatBrandId } from '@/config/brand';
import type {
  CommunityReport,
  ContactEdge,
  EmergencyCapacity,
  OutbreakCluster,
  OutbreakDetails,
  PublicHealthAlert,
  SentinelCase,
  SentinelTabId,
  SentinelThresholds,
  VaccinationSeries,
  CaseFilters,
  CaseClassification,
  NewCaseData,
  CaseUpdateData,
  ResolutionData,
  NewAlertData,
  SurveillanceMetrics,
  AIRecommendation,
} from '@/types/sentinel';
// API imports - will be used for full implementation
// import { ... } from '@/lib/sentinel/api/mockApi';
// import { initSyncEngine, getSyncStatus } from '@/lib/sentinel/api/syncEngine';

const STORAGE_CASES = 'vitalink-sentinel-cases';
const STORAGE_ALERTS = 'vitalink-sentinel-alerts';
const STORAGE_THRESHOLDS = 'vitalink-sentinel-thresholds';
const STORAGE_COMMUNITY = 'vitalink-sentinel-community-queue';
const STORAGE_AUDIT = 'vitalink-sentinel-audit';

const DEFAULT_THRESHOLDS: SentinelThresholds = {
  minCasesForSignal: 4,
  growthPctWeekly: 35,
  minFacilitiesInvolved: 2,
  clusterRadiusKm: 45,
};

function anonymizedRef(switchId: string): string {
  const tail = switchId.slice(-4).padStart(4, '*');
  return `UHIN-••••${tail}`;
}

function ageGroupFromSeed(seed: string): string {
  const buckets = ['0-4', '5-14', '15-44', '45-64', '65+'];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i)) % buckets.length;
  return buckets[h];
}

export interface SentinelContextValue {
  // Core
  tenantId: string;
  activeTab: SentinelTabId;
  setActiveTab: (t: SentinelTabId) => void;
  allowedTabs: SentinelTabId[];
  readOnly: boolean;
  canConfigureThresholds: boolean;
  
  // Data State
  thresholds: SentinelThresholds;
  setThresholds: (t: SentinelThresholds) => void;
  cases: SentinelCase[];
  outbreaks: OutbreakCluster[];
  alerts: PublicHealthAlert[];
  contacts: ContactEdge[];
  vaccinations: VaccinationSeries[];
  emergencyCapacity: EmergencyCapacity[];
  aiRecommendations: AIRecommendation[];
  metrics: SurveillanceMetrics | null;
  
  // Data Loading
  isLoading: boolean;
  refreshData: () => Promise<void>;
  
  // Case Operations
  getCase: (id: string) => Promise<SentinelCase | null>;
  createCase: (data: NewCaseData) => Promise<SentinelCase>;
  updateCase: (id: string, data: CaseUpdateData) => Promise<SentinelCase>;
  resolveCase: (id: string, data: ResolutionData) => Promise<void>;
  deleteCase: (id: string) => Promise<void>;
  
  // Outbreak Operations
  getOutbreakDetails: (id: string) => Promise<OutbreakDetails | null>;
  
  // Alert Operations
  acknowledgeAlert: (id: string) => void;
  resolveAlert: (id: string) => void;
  createAlert: (data: NewAlertData) => Promise<void>;
  
  // Export
  exportCasesCsv: () => void;
  exportCasesPdf: (filters?: CaseFilters) => Promise<void>;
  
  // Community
  addCommunityReport: (r: Omit<CommunityReport, 'id' | 'createdAt' | 'syncStatus'>) => void;
  
  // Legacy (for backward compatibility)
  addManualCase: (c: Omit<SentinelCase, 'id'>) => void;
  aiBriefing: string;
  auditTail: string[];
  isOnline: boolean;
  
  // Sync
  syncStatus: { isSyncing: boolean; pendingCount: number; lastSync: string | null };
  triggerSync: () => Promise<void>;
}

const SentinelContext = createContext<SentinelContextValue | null>(null);

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function seedCases(tenantId: string): SentinelCase[] {
  const baseGeo = {
    country: 'Nigeria',
    state: 'Lagos',
    lga: 'Ikeja',
    facilityId: 'fac-lagos-central',
    facilityName: 'Lagos Central Hospital',
    coordinates: { lat: 6.5244, lng: 3.3792 },
  };
  const day = (i: number) => new Date(Date.now() - i * 86400000).toISOString();
  return [
    {
      id: 'case-seed-1',
      tenantId,
      diseaseId: 'malaria',
      diseaseName: 'Malaria',
      category: 'infectious',
      classification: 'confirmed',
      patientRef: anonymizedRef('VL-2026-100001'),
      ageGroup: '15-44',
      gender: 'female',
      reportedAt: day(0),
      source: 'lab_positive',
      geo: { ...baseGeo },
    },
    {
      id: 'case-seed-2',
      tenantId,
      diseaseId: 'covid-19',
      diseaseName: 'COVID-19',
      category: 'infectious',
      classification: 'probable',
      patientRef: anonymizedRef('VL-2026-100002'),
      ageGroup: '45-64',
      gender: 'male',
      reportedAt: day(1),
      source: 'emr_diagnosis',
      geo: { ...baseGeo, lga: 'Surulere', coordinates: { lat: 6.5, lng: 3.35 } },
    },
    {
      id: 'case-seed-3',
      tenantId,
      diseaseId: 'cholera',
      diseaseName: 'Cholera',
      category: 'infectious',
      classification: 'suspected',
      patientRef: anonymizedRef('VL-2026-100003'),
      ageGroup: '5-14',
      gender: 'male',
      reportedAt: day(2),
      source: 'community',
      geo: { ...baseGeo, state: 'Rivers', lga: 'Port Harcourt', facilityId: 'fac-ph', facilityName: 'PHC Rumuomasi' },
    },
  ];
}

export function SentinelProvider({ children }: { children: ReactNode }) {
  const { currentRole } = useAuth();
  const { tenantId } = useSubscription();
  const [activeTab, setActiveTabState] = useState<SentinelTabId>('surveillance');
  const [cases, setCases] = useState<SentinelCase[]>(() => {
    const saved = loadJson<SentinelCase[]>(STORAGE_CASES, []);
    return saved.length ? saved : seedCases(tenantId);
  });
  const [outbreaks, setOutbreaks] = useState<OutbreakCluster[]>([]);
  const [alerts, setAlerts] = useState<PublicHealthAlert[]>(() => loadJson(STORAGE_ALERTS, []));
  const [thresholds, setThresholdsState] = useState<SentinelThresholds>(() =>
    loadJson(STORAGE_THRESHOLDS, DEFAULT_THRESHOLDS),
  );
  const [contacts] = useState<ContactEdge[]>(() => [
    {
      id: 'edge-1',
      fromCaseId: 'case-seed-1',
      toCaseId: 'case-seed-2',
      relationship: 'facility',
      riskScore: 0.42,
      notedAt: new Date().toISOString(),
    },
  ]);
  const [vaccinations] = useState<VaccinationSeries[]>(() => [
    {
      id: 'vac-cov',
      vaccineName: 'COVID-19 primary series',
      dosesScheduled: 12000,
      dosesAdministered: 10140,
      coveragePct: 84.5,
      region: 'Lagos',
    },
    {
      id: 'vac-yellow',
      vaccineName: 'Yellow Fever',
      dosesScheduled: 8000,
      dosesAdministered: 6420,
      coveragePct: 80.25,
      region: 'National',
    },
  ]);
  const [emergencyCapacity] = useState<EmergencyCapacity[]>(() => [
    {
      facilityId: 'fac-lagos-central',
      name: 'Lagos Central Hospital',
      bedsAvailable: 42,
      bedsTotal: 280,
      icuAvailable: 6,
      icuTotal: 22,
      oxygenUnitsAvailable: 18,
      ambulancesAvailable: 4,
    },
    {
      facilityId: 'fac-abuja',
      name: 'Abuja Metro Referral',
      bedsAvailable: 11,
      bedsTotal: 190,
      icuAvailable: 2,
      icuTotal: 14,
      oxygenUnitsAvailable: 9,
      ambulancesAvailable: 2,
    },
  ]);
  const [auditTail, setAuditTail] = useState<string[]>(() => loadJson(STORAGE_AUDIT, []));
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine);

  const allowedTabs = useMemo(() => tabsForRole(currentRole), [currentRole]);
  const readOnly = currentRole === 'who-ngo-observer';
  const configThresholds = canConfigureThresholds(currentRole);

  const pushAudit = useCallback((line: string) => {
    setAuditTail((prev) => {
      const next = [`${new Date().toISOString()} — ${line}`, ...prev].slice(0, 200);
      localStorage.setItem(STORAGE_AUDIT, JSON.stringify(next));
      return next;
    });
  }, []);

  useEffect(() => {
    const onOff = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', onOff);
    window.addEventListener('offline', onOff);
    return () => {
      window.removeEventListener('online', onOff);
      window.removeEventListener('offline', onOff);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_CASES, JSON.stringify(cases));
  }, [cases]);

  useEffect(() => {
    localStorage.setItem(STORAGE_ALERTS, JSON.stringify(alerts));
  }, [alerts]);

  useEffect(() => {
    localStorage.setItem(STORAGE_THRESHOLDS, JSON.stringify(thresholds));
  }, [thresholds]);

  const setThresholds = useCallback(
    (t: SentinelThresholds) => {
      if (!configThresholds && currentRole !== 'super-admin') return;
      setThresholdsState(t);
      pushAudit('Thresholds updated');
    },
    [configThresholds, currentRole, pushAudit],
  );

  const runOutbreakScan = useCallback(
    (nextCases: SentinelCase[]) => {
      const byDisease = new Map<string, SentinelCase[]>();
      for (const c of nextCases) {
        const arr = byDisease.get(c.diseaseId) ?? [];
        arr.push(c);
        byDisease.set(c.diseaseId, arr);
      }
      const nextOut: OutbreakCluster[] = [];
      for (const [diseaseId, list] of byDisease) {
        const def = DISEASE_CATALOG.find((d) => d.id === diseaseId);
        const sig = evaluateOutbreakSignals(diseaseId, def?.name ?? diseaseId, list, thresholds);
        if (sig) nextOut.push(sig);
      }
      setOutbreaks(nextOut);

      setAlerts((prev) => {
        const existing = new Set(prev.map((a) => a.title));
        const extra: PublicHealthAlert[] = [];
        for (const o of nextOut) {
          const title = `Outbreak signal: ${o.diseaseName}`;
          if (existing.has(title)) continue;
          extra.push({
            id: `alt-${o.id}`,
            type: 'outbreak_warning',
            priority: o.status === 'active' ? 'emergency' : 'high',
            title,
            body: `${o.caseCount} cases across ${o.facilityCount} facilities · States: ${o.affectedStates.join(', ')}`,
            diseaseId: o.diseaseId,
            region: o.affectedStates[0],
            createdAt: new Date().toISOString(),
            delivery: { inApp: true, email: true, smsReady: true },
            acknowledged: false,
          });
        }
        return extra.length ? [...extra, ...prev] : prev;
      });
    },
    [thresholds],
  );

  useEffect(() => {
    runOutbreakScan(cases);
  }, [cases, runOutbreakScan]);

  const ingestClinical = useCallback(
    (payload: SentinelClinicalPayload) => {
      const text = [payload.primaryDiagnosis, payload.secondaryDiagnosis].filter(Boolean).join(' ');
      const match = primaryMatch(text);
      if (!match) return;
      const newCase: SentinelCase = {
        id: crypto.randomUUID(),
        tenantId,
        diseaseId: match.id,
        diseaseName: match.name,
        category: match.category,
        classification: 'probable',
        patientRef: anonymizedRef(payload.patientSwitchId),
        ageGroup: ageGroupFromSeed(payload.patientSwitchId),
        gender: 'unknown',
        reportedAt: new Date().toISOString(),
        source: 'emr_diagnosis',
        geo: {
          country: 'Nigeria',
          state: payload.state ?? 'Lagos',
          lga: payload.lga ?? 'Ikeja',
          facilityId: 'current-facility',
          facilityName: payload.facilityName ?? 'Clinical site',
        },
        notes: 'Auto-generated from EMR diagnosis',
      };
      setCases((prev) => [...prev, newCase]);
      pushAudit(`EMR-linked surveillance case ${match.name} (${newCase.patientRef})`);
    },
    [tenantId, pushAudit],
  );

  const ingestLab = useCallback(
    (payload: SentinelLabPayload) => {
      for (const line of payload.tests) {
        const match = primaryMatch(`${line.name} ${line.value}`);
        if (!match) continue;
        const inferredPositive =
          /positive|detected|reactive/gi.test(`${line.value} ${line.interpretation ?? ''}`) ||
          ['malaria', 'typhoid', 'hiv', 'hepatitis', 'tb'].some((k) =>
            line.name.toLowerCase().includes(k),
          );
        const pos = line.flaggedPositive ?? inferredPositive;
        if (!pos) continue;
        const newCase: SentinelCase = {
          id: crypto.randomUUID(),
          tenantId,
          diseaseId: match.id,
          diseaseName: match.name,
          category: match.category,
          classification: 'confirmed',
          patientRef: `VLL-${payload.orderId.slice(-6)}`,
          ageGroup: 'unknown',
          gender: 'unknown',
          reportedAt: new Date().toISOString(),
          source: 'lab_positive',
          geo: {
            country: 'Nigeria',
            state: payload.state ?? 'Lagos',
            lga: payload.lga ?? 'Ikeja',
            facilityId: 'lab-site',
            facilityName: 'Laboratory node',
          },
          linkedLabOrderId: payload.orderId,
          notes: `${line.name}: ${line.value}`,
        };
        setCases((prev) => [...prev, newCase]);
        pushAudit(`Lab-confirmed signal ${match.name} order ${payload.orderId}`);
      }
    },
    [tenantId, pushAudit],
  );

  const ingestPharmacy = useCallback(
    (payload: SentinelPharmacyPayload) => {
      if (payload.quantityInStock > payload.reorderLevel) return;
      setAlerts((prev) => {
        const title = `Medicine shortage watch: ${payload.itemName}`;
        if (prev.some((a) => a.title === title)) return prev;
        return [
          {
            id: crypto.randomUUID(),
            type: 'medicine_shortage',
            priority: 'medium',
            title,
            body: `Stock at ${payload.quantityInStock} units (reorder ${payload.reorderLevel}) · ${payload.facilityName ?? 'Facility'}`,
            createdAt: new Date().toISOString(),
            delivery: { inApp: true, email: false, smsReady: true },
            acknowledged: false,
          },
          ...prev,
        ];
      });
      pushAudit(`Pharmacy shortage signal recorded (${payload.itemName})`);
    },
    [pushAudit],
  );

  useEffect(() => {
    const onClinical = (e: Event) => {
      const detail = (e as CustomEvent<SentinelClinicalPayload>).detail;
      if (detail) ingestClinical(detail);
    };
    const onLab = (e: Event) => {
      const detail = (e as CustomEvent<SentinelLabPayload>).detail;
      if (detail) ingestLab(detail);
    };
    const onPharm = (e: Event) => {
      const detail = (e as CustomEvent<SentinelPharmacyPayload>).detail;
      if (detail) ingestPharmacy(detail);
    };
    window.addEventListener(SENTINEL_CLINICAL_EVENT, onClinical as EventListener);
    window.addEventListener(SENTINEL_LAB_EVENT, onLab as EventListener);
    window.addEventListener(SENTINEL_PHARMACY_EVENT, onPharm as EventListener);
    return () => {
      window.removeEventListener(SENTINEL_CLINICAL_EVENT, onClinical as EventListener);
      window.removeEventListener(SENTINEL_LAB_EVENT, onLab as EventListener);
      window.removeEventListener(SENTINEL_PHARMACY_EVENT, onPharm as EventListener);
    };
  }, [ingestClinical, ingestLab, ingestPharmacy]);

  const setActiveTab = useCallback((t: SentinelTabId) => {
    if (!allowedTabs.includes(t)) return;
    setActiveTabState(t);
    window.history.replaceState({}, '', `/switch-sentinel?view=${encodeURIComponent(t)}`);
  }, [allowedTabs]);

  useEffect(() => {
    const sync = () => {
      if (!window.location.pathname.startsWith('/switch-sentinel')) return;
      const params = new URLSearchParams(window.location.search);
      const v = params.get('view') as SentinelTabId | null;
      if (v && allowedTabs.includes(v)) setActiveTabState(v);
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [allowedTabs]);

  useEffect(() => {
    if (!allowedTabs.length) return;
    setActiveTabState((prev) => (allowedTabs.includes(prev) ? prev : allowedTabs[0]));
  }, [allowedTabs]);

  const acknowledgeAlert = useCallback(
    (id: string) => {
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
      pushAudit(`Alert acknowledged ${id}`);
    },
    [pushAudit],
  );

  const addManualCase = useCallback(
    (c: Omit<SentinelCase, 'id'>) => {
      if (readOnly) return;
      setCases((prev) => [...prev, { ...c, id: crypto.randomUUID() }]);
      pushAudit(`Manual case entry ${c.diseaseName}`);
    },
    [readOnly, pushAudit],
  );

  const addCommunityReport = useCallback(
    (r: Omit<CommunityReport, 'id' | 'createdAt' | 'syncStatus'>) => {
      if (readOnly) return;
      const rep: CommunityReport = {
        ...r,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        syncStatus: isOnline ? 'synced' : 'pending',
      };
      const q = loadJson<CommunityReport[]>(STORAGE_COMMUNITY, []);
      localStorage.setItem(STORAGE_COMMUNITY, JSON.stringify([rep, ...q]));
      pushAudit(`Community report ${rep.reportType} (${rep.syncStatus})`);
      if (rep.reportType === 'suspected_outbreak') {
        setAlerts((prev) => [
          {
            id: crypto.randomUUID(),
            type: 'disease_cluster',
            priority: 'high',
            title: 'Community suspected outbreak',
            body: rep.summary,
            region: `${rep.state} / ${rep.lga}`,
            createdAt: rep.createdAt,
            delivery: { inApp: true, email: true, smsReady: true },
            acknowledged: false,
          },
          ...prev,
        ]);
      }
    },
    [readOnly, isOnline, pushAudit],
  );

  const exportCasesCsv = useCallback(() => {
    const header = ['id', 'disease', 'classification', 'source', 'state', 'lga', 'reportedAt', 'patientRef'];
    const lines = cases.map((c) =>
      [c.id, c.diseaseName, c.classification, c.source, c.geo.state, c.geo.lga, c.reportedAt, c.patientRef].join(','),
    );
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vitalink-sentinel-cases-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    pushAudit('Exported surveillance case line list (CSV)');
  }, [cases, pushAudit]);

  const aiBriefing = useMemo(() => {
    const top = [...cases].reduce<Record<string, number>>((acc, c) => {
      acc[c.diseaseName] = (acc[c.diseaseName] ?? 0) + 1;
      return acc;
    }, {});
    const ranked = Object.entries(top).sort((a, b) => b[1] - a[1])[0];
    const ob = outbreaks[0];
    return [
      `VitaMind AI — epidemiology pulse (${new Date().toLocaleDateString()})`,
      ranked ? `Highest burden condition: ${ranked[0]} (${ranked[1]} records in window).` : 'Insufficient stratified volume for ranking.',
      ob
        ? `Active outbreak engine: ${ob.diseaseName} in ${ob.affectedStates.join(', ')} — status ${ob.status.toUpperCase()}.`
        : 'No rule-based outbreak crossing current thresholds.',
      'Suggested actions: validate line lists, align lab reflex pathways, and synchronize pharmacy buffers for symptomatic care.',
      'Future-ready: WHO/NCDC/Africa CDC adapters can subscribe to this stream via enterprise API (planned).',
    ].join('\n');
  }, [cases, outbreaks]);

  const value = useMemo<SentinelContextValue>(
    () => ({
      tenantId,
      activeTab,
      setActiveTab,
      allowedTabs,
      readOnly,
      canConfigureThresholds: configThresholds,
      thresholds,
      setThresholds,
      cases,
      outbreaks,
      alerts,
      contacts,
      vaccinations,
      emergencyCapacity,
      acknowledgeAlert,
      addManualCase,
      addCommunityReport,
      aiBriefing,
      auditTail,
      isOnline,
      // New API properties (placeholder implementations for now)
      aiRecommendations: [],
      metrics: null,
      isLoading: false,
      refreshData: async () => {},
      getCase: async (id: string) => cases.find(c => c.id === id) || null,
      createCase: async (data: NewCaseData) => {
        const disease = DISEASE_CATALOG.find(d => d.id === data.diseaseId);
        const newCase: SentinelCase = {
          id: crypto.randomUUID(),
          tenantId,
          diseaseId: data.diseaseId,
          diseaseName: disease?.name || 'Unknown',
          category: disease?.category || 'infectious',
          classification: data.classification,
          patientRef: data.patientRef || anonymizedRef(formatBrandId('patient', Date.now())),
          ageGroup: data.ageGroup,
          gender: data.gender,
          reportedAt: new Date().toISOString(),
          source: data.source,
          geo: data.geo,
          notes: data.notes,
        };
        setCases(prev => [...prev, newCase]);
        return newCase;
      },
      updateCase: async (id: string, data: CaseUpdateData) => {
        const updated = cases.find(c => c.id === id);
        if (updated) {
          const newCase = { ...updated, ...data };
          setCases(prev => prev.map(c => c.id === id ? newCase : c));
          return newCase;
        }
        throw new Error('Case not found');
      },
      resolveCase: async (id: string, data: ResolutionData) => {
        const classification: CaseClassification = data.status === 'resolved' ? 'recovered' : data.status === 'fatal' ? 'fatal' : 'recovered';
        setCases(prev => prev.map(c => c.id === id ? { ...c, classification, notes: data.resolutionNotes } : c));
      },
      deleteCase: async (id: string) => {
        setCases(prev => prev.filter(c => c.id !== id));
      },
      getOutbreakDetails: async (_id: string) => null,
      resolveAlert: (id: string) => {
        setAlerts(prev => prev.map(a => a.id === id ? { ...a, acknowledged: true } : a));
      },
      createAlert: async (data: NewAlertData) => {
        const newAlert: PublicHealthAlert = {
          id: crypto.randomUUID(),
          type: data.type,
          priority: data.priority,
          title: data.title,
          body: data.body,
          region: data.region || 'National',
          createdAt: new Date().toISOString(),
          delivery: {
            inApp: data.channels.includes('inApp'),
            email: data.channels.includes('email'),
            smsReady: data.channels.includes('sms'),
          },
          acknowledged: false,
        };
        setAlerts(prev => [newAlert, ...prev]);
      },
      exportCasesCsv: () => {
        const headers = ['ID', 'Disease', 'Classification', 'Patient Ref', 'Age Group', 'Gender', 'Reported At', 'Source', 'State', 'LGA', 'Facility'];
        const rows = cases.map(c => [
          c.id,
          c.diseaseName,
          c.classification,
          c.patientRef,
          c.ageGroup,
          c.gender,
          c.reportedAt,
          c.source,
          c.geo.state,
          c.geo.lga,
          c.geo.facilityName,
        ]);
        const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sentinel-cases-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      },
      exportCasesPdf: async (_filters?: CaseFilters) => {
        // Placeholder for PDF export - would require a PDF library like jsPDF
        toast.info('PDF export requires PDF library integration (jsPDF)');
      },
      syncStatus: { isSyncing: false, pendingCount: 0, lastSync: null },
      triggerSync: async () => {},
    }),
    [
      tenantId,
      activeTab,
      setActiveTab,
      allowedTabs,
      readOnly,
      configThresholds,
      thresholds,
      setThresholds,
      cases,
      outbreaks,
      alerts,
      contacts,
      vaccinations,
      emergencyCapacity,
      acknowledgeAlert,
      addManualCase,
      addCommunityReport,
      exportCasesCsv,
      aiBriefing,
      auditTail,
      isOnline,
    ],
  );

  return <SentinelContext.Provider value={value}>{children}</SentinelContext.Provider>;
}

export function useSentinel() {
  const ctx = useContext(SentinelContext);
  if (!ctx) throw new Error('useSentinel must be used within SentinelProvider');
  return ctx;
}
