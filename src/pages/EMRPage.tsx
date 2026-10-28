import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  Clock3,
  Download,
  FileDigit,
  FilePlus2,
  FileText,
  Filter,
  FlaskConical,
  History,
  Network,
  Database,
  Lock,
  Mic,
  Paperclip,
  Plus,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { usePlan } from '@/hooks/usePlan';
import { DIAGNOSIS_HANDOFF_KEY } from '@/lib/handoffs';
import { printDocument } from '@/lib/printDocument';
import { toast } from 'sonner';
import { findPatientBySwitchId, type RegistryPatient } from '@/lib/patientRegistry';
import { SENTINEL_CLINICAL_EVENT, type SentinelClinicalPayload } from '@/lib/sentinel/events';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { ReceivedRecordsPanel } from '@/components/network/ReceivedRecordsPanel';
import { ConnectedEmrRecords } from '@/components/patients/ConnectedEmrRecords';
import {
  completeLab,
  formatVitals,
  listLabs,
  listNotes,
  listVitals,
  parseLabOrders,
  recordVitals,
  saveNote,
  type ClinicalNote,
  type NewVitals,
  type VitalsReading,
} from '@/lib/supabase/clinical';
import { createPrescriptions, parsePrescriptionLines } from '@/lib/supabase/pharmacy';
import { createLabOrder } from '@/lib/supabase/lab';
import { DOCUMENT_CATEGORIES, documentLink, listDocuments, uploadDocument as uploadPatientDocument, type DocumentCategory } from '@/lib/supabase/documents';

type EmrTab = 'overview' | 'clinical-notes' | 'lab-results' | 'documents' | 'timeline' | 'network' | 'connected-emr';
type TimelineType = 'clinical-note' | 'lab-uploaded' | 'document-added' | 'diagnosis-updated' | 'prescription-issued';
type RiskLevel = 'low' | 'moderate' | 'high' | 'critical';

interface TimelineEvent {
  id: string;
  type: TimelineType;
  title: string;
  detail: string;
  actor: string;
  createdAt: string;
}

interface LabResultItem {
  id: string;
  date: string;
  testName: string;
  testType: string;
  department: string;
  status: 'Pending' | 'Completed';
  referenceRange: string;
  patientValue: string;
  flag: 'Normal' | 'High' | 'Low' | 'Critical';
  orderingDoctor: string;
  technician: string;
  interpretation?: string;
  orderedAt?: string;
  resultedAt?: string | null;
}

interface DocumentItem {
  id: string;
  name: string;
  category: string;
  size: string;
  version: number;
  uploadedBy: string;
  uploadedAt: string;
  tags: string[];
  /** Storage object path (Supabase mode). */
  storagePath?: string;
}

const tabs: { id: EmrTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'clinical-notes', label: 'Clinical Notes', icon: FileText },
  { id: 'lab-results', label: 'Lab Results', icon: FlaskConical },
  { id: 'documents', label: 'Documents', icon: Paperclip },
  { id: 'timeline', label: 'Timeline', icon: History },
  // Live workspaces only: records other hospitals shared over the VitaLink Network.
  ...(isSupabaseConfigured ? [{ id: 'network' as const, label: 'From other hospitals', icon: Network }] : []),
  // Live workspaces only: history imported from the hospital's other EMR (Administration → Connected EMRs).
  ...(isSupabaseConfigured ? [{ id: 'connected-emr' as const, label: 'From connected EMRs', icon: Database }] : []),
];

const defaultLabResults: LabResultItem[] = [
  { id: 'lab_1', date: '2026-04-20', testName: 'HbA1c', testType: 'Chemistry', department: 'Endocrinology', status: 'Completed', referenceRange: '4.0 - 5.6', patientValue: '7.3', flag: 'High', orderingDoctor: 'Dr. Sarah Johnson', technician: 'Okonkwo James' },
  { id: 'lab_2', date: '2026-04-18', testName: 'Fasting Blood Sugar', testType: 'Chemistry', department: 'General', status: 'Completed', referenceRange: '70 - 100', patientValue: '115', flag: 'High', orderingDoctor: 'Dr. Sarah Johnson', technician: 'Okonkwo James' },
  { id: 'lab_3', date: '2026-04-12', testName: 'Lipid Panel', testType: 'Cardio', department: 'Cardiology', status: 'Pending', referenceRange: 'See panel', patientValue: '--', flag: 'Normal', orderingDoctor: 'Dr. Michael Chen', technician: 'Amina Musa' },
];

const defaultDocs: DocumentItem[] = [
  { id: 'doc_1', name: 'Chest X-Ray Report', category: 'Imaging', size: '1.2 MB', version: 2, uploadedBy: 'Dr. Sarah Johnson', uploadedAt: '2026-04-19', tags: ['radiology', 'follow-up'] },
  { id: 'doc_2', name: 'Consent Form - Procedure', category: 'Consent forms', size: '420 KB', version: 1, uploadedBy: 'Nurse Amina', uploadedAt: '2026-04-15', tags: ['consent'] },
];

interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void;
}

const blankSoap = {
  chiefComplaint: '',
  hpi: '',
  reviewSystems: '',
  patientNarrative: '',
  symptomSummary: '',
  vitalSigns: '',
  physicalExam: '',
  labRefs: '',
  imagingRef: '',
  attachments: '',
  measurements: '',
  primaryDiagnosis: '',
  secondaryDiagnosis: '',
  differentialDiagnosis: '',
  riskLevel: 'moderate' as RiskLevel,
  aiSuggestion: '',
  prescriptions: '',
  labOrders: '',
  imagingOrders: '',
  referralNotes: '',
  followUp: '',
  telemedicineFollowup: 'No telemedicine follow-up',
  addendum: '',
};
type SoapForm = typeof blankSoap;

const emptyVitalsForm = { systolic: '', diastolic: '', heartRate: '', temperatureC: '', spo2: '', respiratoryRate: '', weightKg: '', notes: '' };
const emptyLabForm = { testName: '', testType: '', department: '', referenceRange: '', value: '', flag: 'Normal' as LabResultItem['flag'] };

const toNumber = (value: string) => (value.trim() === '' ? undefined : Number(value));

function createAuditLog(action: string, user: string) {
  return {
    id: crypto.randomUUID(),
    when: new Date().toISOString(),
    action,
    user,
    source: 'server-rbac-policy',
  };
}

interface EMRPageProps {
  patientSwitchId?: string;
  onBackToPatients?: () => void;
}

export function EMRPage({ patientSwitchId, onBackToPatients }: EMRPageProps) {
  const { currentRole, canView, canCreate, canEdit, userName, organization } = useAuth();
  const { hasModule } = usePlan();
  const [dictating, setDictating] = useState(false);
  const recognition = useRef<{ stop: () => void } | null>(null);
  const [activeTab, setActiveTab] = useState<EmrTab>('overview');
  const [editorOpen, setEditorOpen] = useState(false);
  const [timeSpent, setTimeSpent] = useState(0);
  const [autosaveAt, setAutosaveAt] = useState('');
  const [signed, setSigned] = useState(false);
  const [noteLocked, setNoteLocked] = useState(false);
  const [noteVersions, setNoteVersions] = useState<string[]>([]);
  const [auditTrail, setAuditTrail] = useState<{ id: string; when: string; action: string; user: string; source: string }[]>([]);
  const [localTimeline, setTimeline] = useState<TimelineEvent[]>(isSupabaseConfigured ? [] : [
    { id: 't1', type: 'lab-uploaded', title: 'Lab result uploaded', detail: 'HbA1c result available', actor: 'Lab Scientist Okonkwo', createdAt: '2026-04-20T12:22:00Z' },
    { id: 't2', type: 'diagnosis-updated', title: 'Diagnosis updated', detail: 'Type 2 Diabetes with improved control', actor: 'Dr. Sarah Johnson', createdAt: '2026-04-20T12:50:00Z' },
  ]);
  const [labResults, setLabResults] = useState<LabResultItem[]>(isSupabaseConfigured ? [] : defaultLabResults);
  const [notes, setNotes] = useState<ClinicalNote[]>([]);
  const [vitals, setVitals] = useState<VitalsReading[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [vitalsForm, setVitalsForm] = useState(emptyVitalsForm);
  const [labForm, setLabForm] = useState(emptyLabForm);
  const [labCompletion, setLabCompletion] = useState({ value: '', flag: 'Normal' as LabResultItem['flag'], interpretation: '' });
  const [documents, setDocuments] = useState<DocumentItem[]>(isSupabaseConfigured ? [] : defaultDocs);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [selectedLab, setSelectedLab] = useState<LabResultItem | null>(null);
  // Lookup result is keyed by the switch ID it was fetched for, so loading state is derived.
  const [lookup, setLookup] = useState<{ switchId?: string; patient: RegistryPatient | null }>({ patient: null });
  useEffect(() => {
    if (!patientSwitchId) return;
    let cancelled = false;
    findPatientBySwitchId(patientSwitchId)
      .then((found) => { if (!cancelled) setLookup({ switchId: patientSwitchId, patient: found }); })
      .catch(() => { if (!cancelled) setLookup({ switchId: patientSwitchId, patient: null }); });
    return () => { cancelled = true; };
  }, [patientSwitchId]);
  const patientLoading = Boolean(patientSwitchId) && lookup.switchId !== patientSwitchId;
  const patient = patientSwitchId && !patientLoading ? lookup.patient : null;
  const patientId = patient?.id;
  const organizationId = organization.id;

  const refreshClinical = useCallback(async () => {
    if (!isSupabaseConfigured || !patientId) return;
    try {
      const [noteRows, vitalRows, labRows] = await Promise.all([
        listNotes(organizationId, patientId),
        listVitals(organizationId, patientId),
        listLabs(organizationId, patientId),
      ]);
      setNotes(noteRows);
      setVitals(vitalRows);
      setLabResults(labRows);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load clinical records');
    }
    // Documents load separately so a storage problem doesn't hide the clinical record.
    listDocuments(organizationId, patientId).then(setDocuments).catch(() => setDocuments([]));
  }, [organizationId, patientId]);

  useEffect(() => {
    void refreshClinical();
  }, [refreshClinical]);

  const latestVitals = vitals[0] ?? null;

  // With Supabase the timeline is built from the stored records.
  const timeline = useMemo<TimelineEvent[]>(() => {
    if (!isSupabaseConfigured) return localTimeline;
    const events: TimelineEvent[] = [
      ...notes.map((note) => ({
        id: `note-${note.id}`,
        type: 'clinical-note' as const,
        title: note.status === 'signed' ? 'Clinical note signed' : 'Clinical note drafted',
        detail: [note.chiefComplaint, note.primaryDiagnosis].filter(Boolean).join(' · ') || 'SOAP note',
        actor: note.status === 'signed' ? note.signedByName || note.authorName : note.authorName,
        createdAt: note.signedAt ?? note.updatedAt,
      })),
      ...labResults.map((lab) => ({
        id: `lab-${lab.id}`,
        type: 'lab-uploaded' as const,
        title: lab.status === 'Completed' ? 'Lab result recorded' : 'Lab ordered',
        detail: lab.status === 'Completed' ? `${lab.testName}: ${lab.patientValue} (${lab.flag})` : lab.testName,
        actor: lab.status === 'Completed' ? lab.technician : lab.orderingDoctor,
        createdAt: lab.resultedAt ?? lab.orderedAt ?? lab.date,
      })),
      ...vitals.map((reading) => ({
        id: `vitals-${reading.id}`,
        type: 'diagnosis-updated' as const,
        title: 'Vitals recorded',
        detail: formatVitals(reading),
        actor: reading.recordedByName,
        createdAt: reading.recordedAt,
      })),
    ];
    return events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [localTimeline, notes, labResults, vitals]);

  const [soap, setSoap] = useState(blankSoap);

  const [labFilters, setLabFilters] = useState({ date: '', testType: '', status: '', department: '' });
  const [docSearch, setDocSearch] = useState('');
  const [docCategory, setDocCategory] = useState('All');
  const [timelineFilter, setTimelineFilter] = useState('all');

  const emrReadAllowed = canView('EMR');
  const canCreateClinical = currentRole === 'doctor' && canCreate('EMR');
  const canEditClinical = currentRole === 'doctor' && canEdit('EMR');
  const canUploadLab = currentRole === 'lab-scientist' || currentRole === 'doctor';
  const canEditLab = currentRole === 'doctor' || currentRole === 'lab-scientist';

  const patientLine = () => (patient ? `${patient.firstName} ${patient.lastName} · ${patient.switchId}${patient.dateOfBirth ? ` · born ${patient.dateOfBirth}` : ''}` : 'No patient selected');

  /** The note as it stands, through the browser's print dialog ("Save as PDF" works too). */
  const printNote = () => printDocument({
    title: 'Clinical note (SOAP)',
    facility: organization.name,
    subtitle: patientLine(),
    sections: [
      { heading: 'Subjective', rows: [['Chief complaint', soap.chiefComplaint], ['History of present illness', soap.hpi], ['Review of systems', soap.reviewSystems], ['Patient narrative', soap.patientNarrative]] },
      { heading: 'Objective', rows: [['Vital signs', soap.vitalSigns], ['Examination', soap.physicalExam], ['Lab references', soap.labRefs], ['Imaging', soap.imagingRef], ['Measurements', soap.measurements]] },
      { heading: 'Assessment', rows: [['Primary diagnosis', soap.primaryDiagnosis], ['Secondary diagnosis', soap.secondaryDiagnosis], ['Differential', soap.differentialDiagnosis], ['Risk', soap.riskLevel]] },
      { heading: 'Plan', rows: [['Prescriptions', soap.prescriptions], ['Lab orders', soap.labOrders], ['Imaging orders', soap.imagingOrders], ['Referral', soap.referralNotes], ['Follow-up', soap.followUp], ['Addendum', soap.addendum]] },
    ],
    footer: `${signed ? 'Signed' : 'Draft, not signed'} · ${userName} · printed ${new Date().toLocaleString()}`,
  });

  const printLabReport = (lab: LabResultItem) => printDocument({
    title: `Lab report: ${lab.testName}`,
    facility: organization.name,
    subtitle: patientLine(),
    sections: [{ heading: 'Result', rows: [
      ['Test', `${lab.testName}${lab.testType ? ` (${lab.testType})` : ''}`], ['Status', lab.status], ['Result', lab.patientValue], ['Flag', lab.flag],
      ['Reference range', lab.referenceRange], ['Interpretation', lab.interpretation ?? ''], ['Ordered by', lab.orderingDoctor], ['Technician', lab.technician],
      ['Ordered', lab.orderedAt ? new Date(lab.orderedAt).toLocaleString() : lab.date], ['Resulted', lab.resultedAt ? new Date(lab.resultedAt).toLocaleString() : ''],
    ] }],
  });

  // Dictation with the browser's speech recognition (Chrome, Edge, Safari); text is appended to the HPI.
  const SpeechRecognitionImpl = typeof window === 'undefined' ? undefined
    : ((window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition);
  const speechSupported = Boolean(SpeechRecognitionImpl);
  const toggleDictation = () => {
    if (dictating) { recognition.current?.stop(); return; }
    if (!SpeechRecognitionImpl) return;
    const rec = new SpeechRecognitionImpl();
    rec.lang = 'en-NG';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event) => {
      const text = Array.from(event.results).slice(event.resultIndex).filter((r) => r.isFinal).map((r) => r[0].transcript.trim()).join(' ');
      if (text) setSoap((p) => ({ ...p, hpi: p.hpi ? `${p.hpi.trimEnd()} ${text}` : text }));
    };
    rec.onerror = (event) => { toast.error(event.error === 'not-allowed' ? 'Allow microphone access to dictate.' : 'Dictation stopped'); };
    rec.onend = () => { setDictating(false); recognition.current = null; };
    recognition.current = rec;
    rec.start();
    setDictating(true);
  };
  useEffect(() => () => recognition.current?.stop(), []);

  /** Sends the complaint to VitaMind Dx (AI Clinical Intelligence) with this patient selected. */
  const analyseWithVitaMind = () => {
    if (!hasModule('ai-clinical-intelligence')) {
      toast.info('VitaMind Dx is on the Growth plan.');
      window.dispatchEvent(new CustomEvent('app:navigate', { detail: { page: 'subscription' } }));
      return;
    }
    const symptoms = [soap.chiefComplaint, soap.hpi, soap.reviewSystems].map((s) => s.trim()).filter(Boolean).join('. ');
    if (!symptoms) { toast.error('Write the chief complaint or history first'); return; }
    sessionStorage.setItem(DIAGNOSIS_HANDOFF_KEY, JSON.stringify({ switchId: patient?.switchId ?? '', symptoms }));
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { page: 'ai-clinical-intelligence' } }));
  };
  const canUploadDocuments = currentRole !== 'receptionist';
  const canReadOnlyAdmin = currentRole === 'hospital-admin';
  const canRecordVitals = currentRole === 'doctor' || currentRole === 'nurse';

  useEffect(() => {
    if (currentRole === 'lab-scientist' && activeTab !== 'lab-results') {
      setActiveTab('lab-results');
    }
  }, [currentRole, activeTab]);

  const addTimeline = (event: Omit<TimelineEvent, 'id' | 'createdAt'>) => {
    setTimeline((prev) => [{ ...event, id: crypto.randomUUID(), createdAt: new Date().toISOString() }, ...prev]);
  };

  const addAudit = (action: string) => {
    setAuditTrail((prev) => [createAuditLog(action, userName), ...prev]);
  };

  const persistNote = async (sign: boolean) => {
    if (!patientId) return null;
    const saved = await saveNote(organizationId, patientId, soap as unknown as Record<string, string>, { noteId: activeNoteId ?? undefined, sign });
    setActiveNoteId(saved.id);
    setNotes((prev) => [saved, ...prev.filter((note) => note.id !== saved.id)]);
    setAutosaveAt(new Date(saved.updatedAt).toLocaleTimeString());
    setNoteVersions(Array.from({ length: saved.version }, (_, i) => `Version ${saved.version - i}`));
    return saved;
  };

  const saveDraft = () => {
    if (isSupabaseConfigured) {
      if (noteLocked) return;
      persistNote(false)
        .then(() => { toast.success('Draft saved'); addAudit('clinical_note_draft_saved'); })
        .catch((error) => toast.error(error instanceof Error ? error.message : 'Could not save the note'));
      return;
    }
    setAutosaveAt(new Date().toLocaleTimeString());
    setNoteVersions((prev) => [`Version ${prev.length + 1} saved at ${new Date().toLocaleTimeString()}`, ...prev]);
    toast.success('Draft autosaved securely');
    addAudit('clinical_note_draft_autosaved');
  };

  const launchClinicalEditor = () => {
    if (!canCreateClinical) {
      toast.error('RBAC: only doctors can create clinical notes.');
      return;
    }
    setActiveNoteId(null);
    setSoap({ ...blankSoap, vitalSigns: formatVitals(latestVitals) });
    setSigned(false);
    setNoteLocked(false);
    setNoteVersions([]);
    setAutosaveAt('');
    setEditorOpen(true);
    setTimeSpent(0);
  };

  const openNote = (note: ClinicalNote) => {
    setActiveNoteId(note.id);
    setSoap({ ...blankSoap, ...(note.content as Partial<SoapForm>) });
    const locked = note.status === 'signed';
    setSigned(locked);
    setNoteLocked(locked);
    setNoteVersions(Array.from({ length: note.version }, (_, i) => `Version ${note.version - i}`));
    setAutosaveAt(new Date(note.updatedAt).toLocaleTimeString());
    setEditorOpen(true);
  };

  const saveClinicalNote = () => {
    if (!canEditClinical || noteLocked) {
      toast.error('RBAC or signature lock prevents editing this note.');
      return;
    }
    saveDraft();
    if (isSupabaseConfigured) return; // timeline is derived from saved notes
    addTimeline({
      type: 'clinical-note',
      title: 'Clinical note created',
      detail: `SOAP note saved for ${soap.chiefComplaint || 'general follow-up'}`,
      actor: userName,
    });
  };

  const signAndLock = () => {
    if (!canEditClinical) {
      toast.error('Only doctors can sign and lock notes.');
      return;
    }
    if (isSupabaseConfigured) {
      persistNote(true)
        .then(async (saved) => {
          if (!saved || !patientId) return;
          setSigned(true);
          setNoteLocked(true);
          addAudit('clinical_note_signed_and_locked');
          const orders = parseLabOrders(soap.labOrders);
          if (orders.length) {
            await createLabOrder(patientId, orders.map((name) => ({ name })), { noteId: saved.id });
            setLabResults(await listLabs(organizationId, patientId));
          }
          const medications = parsePrescriptionLines(soap.prescriptions);
          if (medications.length) await createPrescriptions(organizationId, patientId, medications, saved.id);
          const sent = [
            orders.length ? `${orders.length} lab order(s) sent to the laboratory` : '',
            medications.length ? `${medications.length} prescription(s) sent to the pharmacy` : '',
          ].filter(Boolean);
          toast.success('Note signed and locked.', { description: sent.length ? `${sent.join('; ')}.` : undefined });
          notifySentinel();
        })
        .catch((error) => toast.error(error instanceof Error ? error.message : 'Could not sign the note'));
      return;
    }
    setSigned(true);
    setNoteLocked(true);
    addAudit('clinical_note_signed_and_locked');
    toast.success('Electronic signature applied and note locked.');
    notifySentinel();
  };

  const notifySentinel = () => {
    const sid = patient?.switchId ?? patientSwitchId ?? '';
    if (sid && (soap.primaryDiagnosis.trim() || soap.secondaryDiagnosis.trim())) {
      window.dispatchEvent(
        new CustomEvent<SentinelClinicalPayload>(SENTINEL_CLINICAL_EVENT, {
          detail: {
            patientSwitchId: sid,
            primaryDiagnosis: soap.primaryDiagnosis,
            secondaryDiagnosis: soap.secondaryDiagnosis,
            facilityName: organization.name,
            // Live: the patient's recorded state (no LGA is captured yet); demo keeps sample values.
            state: patient?.state || (isSupabaseConfigured ? undefined : 'Lagos'),
            lga: isSupabaseConfigured ? undefined : 'Ikeja',
          },
        }),
      );
    }
  };

  const copyPrevious = () => {
    if (isSupabaseConfigured) {
      const previous = notes.find((note) => note.status === 'signed' && note.id !== activeNoteId);
      if (!previous) {
        toast.info('No earlier signed note for this patient.');
        return;
      }
      const content = previous.content as Partial<SoapForm>;
      setSoap((prev) => ({
        ...prev,
        hpi: content.hpi ?? prev.hpi,
        reviewSystems: content.reviewSystems ?? prev.reviewSystems,
        physicalExam: content.physicalExam ?? prev.physicalExam,
        primaryDiagnosis: content.primaryDiagnosis ?? prev.primaryDiagnosis,
        secondaryDiagnosis: content.secondaryDiagnosis ?? prev.secondaryDiagnosis,
        prescriptions: content.prescriptions ?? prev.prescriptions,
      }));
      addAudit('clinical_note_copied_from_previous');
      toast.success(`Copied from note of ${new Date(previous.signedAt ?? previous.createdAt).toLocaleDateString()}.`);
      return;
    }
    setSoap((prev) => ({
      ...prev,
      hpi: 'Copied from previous encounter: patient reports improved exercise tolerance and reduced dizziness.',
    }));
    addAudit('clinical_note_copied_from_previous');
    toast.success('Previous note copied.');
  };

  const filteredLabs = useMemo(() => {
    return labResults.filter((lab) => {
      const byDate = labFilters.date ? lab.date === labFilters.date : true;
      const byType = labFilters.testType ? lab.testType === labFilters.testType : true;
      const byStatus = labFilters.status ? lab.status === labFilters.status : true;
      const byDept = labFilters.department ? lab.department === labFilters.department : true;
      return byDate && byType && byStatus && byDept;
    });
  }, [labResults, labFilters]);

  const filteredDocs = useMemo(() => {
    return documents.filter((doc) => {
      const bySearch = doc.name.toLowerCase().includes(docSearch.toLowerCase()) || doc.tags.join(' ').toLowerCase().includes(docSearch.toLowerCase());
      const byCategory = docCategory === 'All' ? true : doc.category === docCategory;
      return bySearch && byCategory;
    });
  }, [documents, docSearch, docCategory]);

  const filteredTimeline = useMemo(() => {
    return timelineFilter === 'all' ? timeline : timeline.filter((item) => item.type === timelineFilter);
  }, [timeline, timelineFilter]);

  const addLabResult = () => {
    if (!canUploadLab || !patientId) {
      toast.error('RBAC: your role cannot upload lab results.');
      return;
    }
    if (!labForm.testName.trim()) {
      toast.error('Enter the test name.');
      return;
    }
    const completed = labForm.value.trim() !== '';
    createLabOrder(patientId, [{
      name: labForm.testName,
      testType: labForm.testType,
      department: labForm.department,
      referenceRange: labForm.referenceRange,
      value: labForm.value,
      flag: labForm.flag,
    }])
      .then(() => listLabs(organizationId, patientId))
      .then((labs) => {
        setLabResults(labs);
        setLabForm(emptyLabForm);
        addAudit(completed ? 'lab_result_recorded' : 'lab_ordered');
        toast.success(completed ? 'Lab result recorded.' : 'Lab order created.');
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Could not save the lab result'));
  };

  const completeSelectedLab = () => {
    if (!selectedLab || !canEditLab) return;
    if (!labCompletion.value.trim()) {
      toast.error('Enter the result value.');
      return;
    }
    completeLab(selectedLab.id, labCompletion)
      .then((saved) => {
        setLabResults((prev) => prev.map((lab) => (lab.id === saved.id ? saved : lab)));
        setSelectedLab(saved);
        setLabCompletion({ value: '', flag: 'Normal', interpretation: '' });
        addAudit('lab_result_completed');
        toast.success('Lab result recorded.');
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Could not record the result'));
  };

  const recordVitalsReading = () => {
    if (!canRecordVitals || !patientId) return;
    const reading: NewVitals = {
      systolic: toNumber(vitalsForm.systolic),
      diastolic: toNumber(vitalsForm.diastolic),
      heartRate: toNumber(vitalsForm.heartRate),
      temperatureC: toNumber(vitalsForm.temperatureC),
      spo2: toNumber(vitalsForm.spo2),
      respiratoryRate: toNumber(vitalsForm.respiratoryRate),
      weightKg: toNumber(vitalsForm.weightKg),
      notes: vitalsForm.notes,
    };
    if (Object.entries(reading).every(([key, value]) => key === 'notes' || value === undefined)) {
      toast.error('Enter at least one measurement.');
      return;
    }
    recordVitals(organizationId, patientId, reading)
      .then((saved) => {
        setVitals((prev) => [saved, ...prev]);
        setVitalsForm(emptyVitalsForm);
        addAudit('vitals_recorded');
        toast.success('Vitals recorded.');
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : 'Could not record vitals'));
  };

  // Earlier results for the same test, newest first, for the detail panel.
  const labHistory = useMemo(() => {
    if (!selectedLab) return [];
    return labResults
      .filter((lab) => lab.testName.toLowerCase() === selectedLab.testName.toLowerCase() && lab.status === 'Completed')
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [labResults, selectedLab]);

  const uploadLabResult = () => {
    if (isSupabaseConfigured) {
      addLabResult();
      return;
    }
    if (!canUploadLab) {
      toast.error('RBAC: your role cannot upload lab results.');
      return;
    }
    const newLab: LabResultItem = {
      id: crypto.randomUUID(),
      date: new Date().toISOString().slice(0, 10),
      testName: 'External CBC Panel',
      testType: 'Hematology',
      department: 'Laboratory',
      status: 'Completed',
      referenceRange: 'See panel',
      patientValue: 'Attached PDF',
      flag: 'Normal',
      orderingDoctor: 'Dr. Sarah Johnson',
      technician: userName,
    };
    setLabResults((prev) => [newLab, ...prev]);
    addTimeline({ type: 'lab-uploaded', title: 'Lab uploaded', detail: newLab.testName, actor: userName });
    addAudit('lab_result_uploaded');
    toast.success('External lab uploaded and verified digitally.');
  };

  const uploadDocumentFiles = async (files: FileList | File[] | null) => {
    if (!files || !patientId || !canUploadDocuments) return;
    const list = Array.from(files);
    if (!list.length) return;
    const category: DocumentCategory = (DOCUMENT_CATEGORIES as readonly string[]).includes(docCategory) ? (docCategory as DocumentCategory) : 'External reports';
    setUploadingDocument(true);
    try {
      for (const file of list) {
        await uploadPatientDocument(organizationId, patientId, file, category);
        addAudit('document_uploaded');
      }
      setDocuments(await listDocuments(organizationId, patientId));
      toast.success(list.length === 1 ? 'Document uploaded.' : `${list.length} documents uploaded.`, { description: `Filed under ${category}.` });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not upload the document');
    } finally {
      setUploadingDocument(false);
      if (documentInputRef.current) documentInputRef.current.value = '';
    }
  };

  const openDocument = (doc: DocumentItem, mode: 'preview' | 'download' | 'share') => {
    if (!doc.storagePath) {
      toast.message(`${mode === 'share' ? 'Sharing' : 'Opening'} ${doc.name} needs a connected workspace.`);
      return;
    }
    // Open the tab synchronously so the popup blocker allows it, then point it at the signed URL.
    const pending = mode === 'preview' ? window.open('', '_blank') : null;
    documentLink(doc.storagePath, { download: mode === 'download', expiresInSeconds: mode === 'share' ? 3600 : 600 })
      .then(async (url) => {
        if (mode === 'share') {
          // Clipboard access can be refused or never answer (e.g. embedded browsers), so fall back to showing the link.
          const copied = await Promise.race([
            navigator.clipboard?.writeText(url).then(() => true, () => false) ?? Promise.resolve(false),
            new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 1500)),
          ]);
          if (copied) {
            toast.success('Secure link copied.', { description: 'Anyone with the link can open it for the next hour.' });
          } else {
            toast.message('Secure link (expires in 1 hour)', { description: url, duration: 20000 });
          }
          addAudit('document_link_shared');
        } else if (pending) {
          pending.location.href = url;
        } else {
          window.location.assign(url);
        }
      })
      .catch((error) => {
        pending?.close();
        toast.error(error instanceof Error ? error.message : 'Could not open the document');
      });
  };

  const uploadDocument = () => {
    if (!canUploadDocuments) {
      toast.error('RBAC: your role cannot upload to document vault.');
      return;
    }
    if (isSupabaseConfigured) {
      documentInputRef.current?.click();
      return;
    }
    const newDoc: DocumentItem = {
      id: crypto.randomUUID(),
      name: 'Referral Letter - Endocrinology',
      category: 'Referral letters',
      size: '328 KB',
      version: 1,
      uploadedBy: userName,
      uploadedAt: new Date().toISOString().slice(0, 10),
      tags: ['referral', 'specialist'],
    };
    setDocuments((prev) => [newDoc, ...prev]);
    addTimeline({ type: 'document-added', title: 'Document added', detail: newDoc.name, actor: userName });
    addAudit('document_uploaded');
    toast.success('Document stored with watermark and access tracking.');
  };

  if (!emrReadAllowed) {
    return <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-red-700">Access denied by EMR RBAC policy.</div>;
  }
  if (patientSwitchId && patientLoading) {
    return <div className="rounded-2xl border border-gray-100 bg-white p-6 text-sm text-gray-500">Loading patient record...</div>;
  }

  if (patientSwitchId && !patient) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-gray-500">Patient Management &gt; Unknown Patient</div>
        <div className="rounded-2xl border border-amber-100 bg-amber-50 p-6">
          <h2 className="text-lg font-semibold text-amber-900">404 Patient Not Found</h2>
          <p className="text-sm text-amber-700 mt-1">No patient record found for VitaLink ID {patientSwitchId}.</p>
          <Button className="mt-4" onClick={onBackToPatients}>Back to Patient List</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 page-transition">
      <div className="text-sm text-gray-500 dark:text-slate-400">
        <button className="hover:text-gray-700 dark:hover:text-slate-200" onClick={onBackToPatients}>Patient Management</button>
        {' > '}
        <span>{patient ? `${patient.firstName} ${patient.lastName}` : 'Patient EMR'}</span>
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-50">Electronic Medical Records</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">Government-grade clinical documentation, lab intelligence, and secure document vault.</p>
        </div>
        <div className="flex gap-2">
          <Button data-tour-id="emr-new-note" className="bg-gradient-to-r from-royal-600 to-royal-800 text-white gap-2" onClick={launchClinicalEditor}>
            <Plus className="w-4 h-4" />
            New Clinical Note
          </Button>
        </div>
      </div>

      <div className="premium-card p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input placeholder="Search patient by VitaLink ID, name, or phone..." className="pl-9" />
        </div>
      </div>

      {editorOpen && (
        <div className="premium-card p-4 sm:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:justify-between md:items-center mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-50">Clinical Documentation Editor (SOAP)</h2>
              <p className="text-xs text-gray-500 dark:text-slate-400">Draft autosave, versioning, digital signature, and timeline sync enabled.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={copyPrevious}>Copy Previous Note</Button>
              <Button variant="outline" onClick={saveDraft}>Autosave</Button>
              <Button variant="outline" onClick={printNote}>
                <Download className="w-4 h-4 mr-2" />
                Print / PDF
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <section className="rounded-xl border border-gray-200 p-4 bg-white/80 min-w-0 overflow-hidden dark:border-slate-700 dark:bg-slate-800/60">
              <h3 className="font-semibold text-gray-900 mb-3 truncate dark:text-slate-50">A) Subjective</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input placeholder="Chief Complaint" value={soap.chiefComplaint} onChange={(e) => setSoap((p) => ({ ...p, chiefComplaint: e.target.value }))} className="md:col-span-2 min-w-0" />
                <textarea className="min-h-24 rounded-md border border-input p-3 text-sm md:col-span-2 w-full min-w-0" placeholder="History of Present Illness" value={soap.hpi} onChange={(e) => setSoap((p) => ({ ...p, hpi: e.target.value }))} />
                <textarea className="min-h-20 rounded-md border border-input p-3 text-sm md:col-span-2 w-full min-w-0" placeholder="Review of Systems" value={soap.reviewSystems} onChange={(e) => setSoap((p) => ({ ...p, reviewSystems: e.target.value }))} />
                <textarea className="min-h-20 rounded-md border border-input p-3 text-sm md:col-span-2 w-full min-w-0" placeholder="Patient narrative" value={soap.patientNarrative} onChange={(e) => setSoap((p) => ({ ...p, patientNarrative: e.target.value }))} />
                <Button variant="outline" className={cn('justify-start min-w-0', dictating && 'border-red-300 bg-red-50 text-red-700')} disabled={!speechSupported} title={speechSupported ? 'Dictate into History of Present Illness' : 'This browser does not support dictation (try Chrome or Edge)'} onClick={toggleDictation}>
                  <Mic className="w-4 h-4 mr-2 shrink-0" /><span className="truncate">{dictating ? 'Stop dictation' : 'Dictate HPI'}</span>
                </Button>
                <Button variant="outline" className="justify-start min-w-0" onClick={analyseWithVitaMind}>
                  <Bot className="w-4 h-4 mr-2 shrink-0" /><span className="truncate">Analyse with VitaMind Dx</span>
                </Button>
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 p-4 bg-white/80 min-w-0 overflow-hidden dark:border-slate-700 dark:bg-slate-800/60">
              <h3 className="font-semibold text-gray-900 mb-3 truncate dark:text-slate-50">B) Objective</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input placeholder="Vital signs auto-pull" value={soap.vitalSigns} onChange={(e) => setSoap((p) => ({ ...p, vitalSigns: e.target.value }))} className="md:col-span-2 min-w-0" />
                <textarea className="min-h-20 rounded-md border border-input p-3 text-sm md:col-span-2 w-full min-w-0" placeholder="Physical examination notes" value={soap.physicalExam} onChange={(e) => setSoap((p) => ({ ...p, physicalExam: e.target.value }))} />
                <Input placeholder="Lab references" value={soap.labRefs} onChange={(e) => setSoap((p) => ({ ...p, labRefs: e.target.value }))} className="min-w-0" />
                <Input placeholder="Imaging reference" value={soap.imagingRef} onChange={(e) => setSoap((p) => ({ ...p, imagingRef: e.target.value }))} className="min-w-0" />
                <Input placeholder="Attach files" value={soap.attachments} onChange={(e) => setSoap((p) => ({ ...p, attachments: e.target.value }))} className="min-w-0" />
                <Input placeholder="Clinical measurements" value={soap.measurements} onChange={(e) => setSoap((p) => ({ ...p, measurements: e.target.value }))} className="min-w-0" />
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 p-4 bg-white/80 min-w-0 overflow-hidden dark:border-slate-700 dark:bg-slate-800/60">
              <h3 className="font-semibold text-gray-900 mb-3 truncate dark:text-slate-50">C) Assessment</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input placeholder="Primary diagnosis (ICD)" value={soap.primaryDiagnosis} onChange={(e) => setSoap((p) => ({ ...p, primaryDiagnosis: e.target.value }))} className="min-w-0" />
                <Input placeholder="Secondary diagnosis" value={soap.secondaryDiagnosis} onChange={(e) => setSoap((p) => ({ ...p, secondaryDiagnosis: e.target.value }))} className="min-w-0" />
                <textarea className="min-h-20 rounded-md border border-input p-3 text-sm md:col-span-2 w-full min-w-0" placeholder="Differential diagnosis" value={soap.differentialDiagnosis} onChange={(e) => setSoap((p) => ({ ...p, differentialDiagnosis: e.target.value }))} />
                <select className="h-10 rounded-md border border-input bg-white px-3 text-sm min-w-0 text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={soap.riskLevel} onChange={(e) => setSoap((p) => ({ ...p, riskLevel: e.target.value as RiskLevel }))}>
                  <option value="low">Low risk</option>
                  <option value="moderate">Moderate risk</option>
                  <option value="high">High risk</option>
                  <option value="critical">Critical risk</option>
                </select>
                <textarea className="min-h-20 rounded-md border border-input p-3 text-sm md:col-span-2 w-full min-w-0" placeholder="Clinical decision support notes (non-final, clinician-reviewed)" value={soap.aiSuggestion} onChange={(e) => setSoap((p) => ({ ...p, aiSuggestion: e.target.value }))} />
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 p-4 bg-white/80 min-w-0 overflow-hidden dark:border-slate-700 dark:bg-slate-800/60">
              <h3 className="font-semibold text-gray-900 mb-3 truncate dark:text-slate-50">D) Plan</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <textarea className="min-h-20 rounded-md border border-input p-3 text-sm w-full min-w-0" placeholder="Medication prescriptions" value={soap.prescriptions} onChange={(e) => setSoap((p) => ({ ...p, prescriptions: e.target.value }))} />
                <textarea className="min-h-20 rounded-md border border-input p-3 text-sm w-full min-w-0" placeholder="Lab orders" value={soap.labOrders} onChange={(e) => setSoap((p) => ({ ...p, labOrders: e.target.value }))} />
                <textarea className="min-h-20 rounded-md border border-input p-3 text-sm w-full min-w-0" placeholder="Imaging orders" value={soap.imagingOrders} onChange={(e) => setSoap((p) => ({ ...p, imagingOrders: e.target.value }))} />
                <textarea className="min-h-20 rounded-md border border-input p-3 text-sm w-full min-w-0" placeholder="Referral notes" value={soap.referralNotes} onChange={(e) => setSoap((p) => ({ ...p, referralNotes: e.target.value }))} />
                <textarea className="min-h-20 rounded-md border border-input p-3 text-sm md:col-span-2 w-full min-w-0" placeholder="Follow-up instructions" value={soap.followUp} onChange={(e) => setSoap((p) => ({ ...p, followUp: e.target.value }))} />
                <select className="h-10 rounded-md border border-input bg-white px-3 text-sm min-w-0 text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={soap.telemedicineFollowup} onChange={(e) => setSoap((p) => ({ ...p, telemedicineFollowup: e.target.value }))}>
                  <option>No telemedicine follow-up</option>
                  <option>Schedule telemedicine in 48h</option>
                  <option>Schedule telemedicine in 7 days</option>
                </select>
                <Input placeholder="Doctor digital stamp" value={signed ? `Signed by ${notes.find((note) => note.id === activeNoteId)?.signedByName || userName}` : 'Applied when the note is signed'} readOnly className="min-w-0" />
                <textarea className="min-h-16 rounded-md border border-input p-3 text-sm md:col-span-2 w-full min-w-0" placeholder="Addendum support" value={soap.addendum} onChange={(e) => setSoap((p) => ({ ...p, addendum: e.target.value }))} />
              </div>
            </section>
          </div>

          <div className="sticky bottom-0 mt-4 p-3 rounded-xl border bg-white/90 backdrop-blur flex flex-wrap gap-2 justify-end min-w-0 dark:border-slate-700 dark:bg-slate-900/90">
            <span className="text-xs text-gray-500 mr-auto flex items-center gap-1 shrink-0 dark:text-slate-400"><Clock3 className="w-3 h-3" />Time spent: {timeSpent} min</span>
            <Button variant="outline" onClick={() => setTimeSpent((v) => v + 5)} className="min-w-0">Track +5 min</Button>
            <Button variant="outline" onClick={() => setEditorOpen(false)} className="min-w-0">Close</Button>
            <Button variant="outline" onClick={saveClinicalNote} disabled={!canEditClinical || noteLocked} className="min-w-0">Save Draft</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-0" onClick={signAndLock} disabled={signed || !canEditClinical}>
              <ShieldCheck className="w-4 h-4 mr-2 shrink-0" />
              {signed ? 'Signed' : 'Sign & Lock'}
            </Button>
          </div>
          <div className="mt-3 text-xs text-gray-500 flex flex-wrap gap-4 dark:text-slate-400">
            <span>Autosave: {autosaveAt || 'Not saved yet'}</span>
            <span className="flex items-center gap-1">{noteLocked ? <Lock className="w-3 h-3" /> : null}Note lock: {noteLocked ? 'Locked' : 'Editable'}</span>
            <span>Versions: {noteVersions.length}</span>
          </div>
        </div>
      )}

      {!editorOpen && (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
          <aside data-tour-id="emr-patient" className="xl:col-span-1 premium-card p-4 min-w-0 overflow-hidden">
            <div className="text-center">
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-royal-500 to-royal-700 mx-auto mb-2 text-white flex items-center justify-center font-bold text-xl shrink-0">{patient ? `${patient.firstName[0] ?? ''}${patient.lastName[0] ?? ''}`.toUpperCase() : '--'}</div>
              <h3 className="font-semibold text-gray-900 truncate dark:text-slate-50">{patient ? `${patient.firstName} ${patient.lastName}` : 'No Patient Selected'}</h3>
              <p className="text-xs text-gray-500 truncate dark:text-slate-400">VitaLink ID: {patient?.switchId ?? '--'}</p>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <div className="p-2 rounded-lg bg-white dark:bg-slate-800/60 truncate">Tenant: {organization.name}</div>
              <div className="p-2 rounded-lg bg-white dark:bg-slate-800/60 truncate">EMR Role: {currentRole}</div>
              <div className="p-2 rounded-lg bg-white dark:bg-slate-800/60 truncate">Encryption at rest: Enabled</div>
            </div>
            {canReadOnlyAdmin ? <p className="mt-3 text-xs text-amber-700 bg-amber-50 p-2 rounded-lg truncate">Admin mode: read-only for medical entries.</p> : null}
          </aside>

          <main className="xl:col-span-3 space-y-4 min-w-0">
            <div data-tour-id="emr-tabs" className="hidden md:flex flex-wrap gap-2 p-1 rounded-xl bg-gray-100 w-full max-w-full min-w-0 dark:bg-slate-900/50">
              {tabs.filter((tab) => (currentRole === 'lab-scientist' ? tab.id === 'lab-results' : true)).map((tab) => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={cn('px-4 py-2 rounded-lg text-sm flex items-center gap-2 whitespace-nowrap min-w-0', activeTab === tab.id ? 'bg-white text-royal-700 shadow-sm dark:bg-slate-800/60 dark:text-white' : 'text-gray-600 dark:text-slate-400')}>
                  <tab.icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </button>
              ))}
            </div>
            <div className="md:hidden">
              <select className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={activeTab} onChange={(e) => setActiveTab(e.target.value as EmrTab)}>
                {tabs.filter((tab) => (currentRole === 'lab-scientist' ? tab.id === 'lab-results' : true)).map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
              </select>
            </div>

            {activeTab === 'overview' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {isSupabaseConfigured && (
                  <div className="premium-card p-4 md:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold text-gray-900 dark:text-slate-50">Vital Signs</h3>
                      <span className="text-xs text-gray-500 dark:text-slate-400">
                        {latestVitals ? `Last recorded ${new Date(latestVitals.recordedAt).toLocaleString()} by ${latestVitals.recordedByName}` : 'No vitals recorded yet'}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-gray-800 dark:text-slate-200">{formatVitals(latestVitals) || '—'}</p>
                    {canRecordVitals ? (
                      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
                        <Input inputMode="numeric" placeholder="Systolic" value={vitalsForm.systolic} onChange={(e) => setVitalsForm((v) => ({ ...v, systolic: e.target.value }))} />
                        <Input inputMode="numeric" placeholder="Diastolic" value={vitalsForm.diastolic} onChange={(e) => setVitalsForm((v) => ({ ...v, diastolic: e.target.value }))} />
                        <Input inputMode="numeric" placeholder="Heart rate" value={vitalsForm.heartRate} onChange={(e) => setVitalsForm((v) => ({ ...v, heartRate: e.target.value }))} />
                        <Input inputMode="decimal" placeholder="Temp °C" value={vitalsForm.temperatureC} onChange={(e) => setVitalsForm((v) => ({ ...v, temperatureC: e.target.value }))} />
                        <Input inputMode="numeric" placeholder="SpO2 %" value={vitalsForm.spo2} onChange={(e) => setVitalsForm((v) => ({ ...v, spo2: e.target.value }))} />
                        <Input inputMode="numeric" placeholder="Resp. rate" value={vitalsForm.respiratoryRate} onChange={(e) => setVitalsForm((v) => ({ ...v, respiratoryRate: e.target.value }))} />
                        <Input inputMode="decimal" placeholder="Weight kg" value={vitalsForm.weightKg} onChange={(e) => setVitalsForm((v) => ({ ...v, weightKg: e.target.value }))} />
                        <Button onClick={recordVitalsReading}>Record vitals</Button>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">Doctors and nurses can record vitals.</p>
                    )}
                  </div>
                )}
                <div className="premium-card p-4">
                  <h3 className="font-semibold text-gray-900 mb-3 dark:text-slate-50">Clinical Workspace Status</h3>
                  <ul className="text-sm text-gray-600 space-y-2 dark:text-slate-300">
                    <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-600" />Template library available</li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-600" />Inline lab attachment supported</li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-600" />Version history enabled</li>
                    <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-green-600" />Audit logging and timeline sync active</li>
                  </ul>
                </div>
                <div className="premium-card p-4">
                  <h3 className="font-semibold text-gray-900 mb-3 dark:text-slate-50">Recent Audit Logs</h3>
                  <div className="space-y-2 max-h-56 overflow-auto">
                    {auditTrail.length === 0 ? <p className="text-sm text-gray-500 dark:text-slate-400">No new audit actions yet.</p> : null}
                    {auditTrail.map((item) => (
                      <div key={item.id} className="rounded-lg border border-gray-100 p-2 text-xs dark:border-slate-700">
                        <p className="font-medium text-gray-800 dark:text-slate-200">{item.action}</p>
                        <p className="text-gray-500 dark:text-slate-400">{item.user} • {new Date(item.when).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'clinical-notes' && (
              <div className="premium-card p-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <h3 className="font-semibold text-gray-900 dark:text-slate-50">Clinical Notes</h3>
                  <Button onClick={launchClinicalEditor} className="bg-gradient-to-r from-royal-600 to-royal-800 text-white">
                    <FilePlus2 className="w-4 h-4 mr-2" />
                    New Clinical Note
                  </Button>
                </div>
                <p className="text-sm text-gray-500 mt-2 dark:text-slate-400">Structured SOAP documentation with signature lock. Signed notes are read-only.</p>
                {isSupabaseConfigured && (
                  <div className="mt-4 space-y-2">
                    {notes.length === 0 ? <p className="text-sm text-gray-500 dark:text-slate-400">No clinical notes for this patient yet.</p> : null}
                    {notes.map((note) => (
                      <button key={note.id} onClick={() => openNote(note)} className="w-full rounded-lg border border-gray-100 p-3 text-left hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800/60">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-medium text-gray-900 dark:text-slate-50">{note.chiefComplaint || 'Untitled note'}</p>
                          <span className={cn('rounded-full px-2 py-0.5 text-xs', note.status === 'signed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
                            {note.status === 'signed' ? 'Signed' : `Draft v${note.version}`}
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-slate-300">{note.primaryDiagnosis || 'No diagnosis recorded'}</p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                          {note.authorName} • {new Date(note.signedAt ?? note.updatedAt).toLocaleString()}
                          {note.status === 'signed' && note.signedByName ? ` • signed by ${note.signedByName}` : ''}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'lab-results' && (
              <div className="space-y-3">
                <div className="premium-card p-3 grid grid-cols-1 md:grid-cols-5 gap-2">
                  <Input type="date" value={labFilters.date} onChange={(e) => setLabFilters((p) => ({ ...p, date: e.target.value }))} />
                  <Input placeholder="Test type" value={labFilters.testType} onChange={(e) => setLabFilters((p) => ({ ...p, testType: e.target.value }))} />
                  <Input placeholder="Status" value={labFilters.status} onChange={(e) => setLabFilters((p) => ({ ...p, status: e.target.value }))} />
                  <Input placeholder="Department" value={labFilters.department} onChange={(e) => setLabFilters((p) => ({ ...p, department: e.target.value }))} />
                  <Button variant="outline" onClick={() => setLabFilters({ date: '', testType: '', status: '', department: '' })}><Filter className="w-4 h-4 mr-2" />Reset</Button>
                </div>
                {isSupabaseConfigured ? (
                  canUploadLab ? (
                    <div className="premium-card p-3 grid grid-cols-2 gap-2 md:grid-cols-7">
                      <Input placeholder="Test name *" value={labForm.testName} onChange={(e) => setLabForm((f) => ({ ...f, testName: e.target.value }))} />
                      <Input placeholder="Test type" value={labForm.testType} onChange={(e) => setLabForm((f) => ({ ...f, testType: e.target.value }))} />
                      <Input placeholder="Department" value={labForm.department} onChange={(e) => setLabForm((f) => ({ ...f, department: e.target.value }))} />
                      <Input placeholder="Reference range" value={labForm.referenceRange} onChange={(e) => setLabForm((f) => ({ ...f, referenceRange: e.target.value }))} />
                      <Input placeholder="Value (blank = order)" value={labForm.value} onChange={(e) => setLabForm((f) => ({ ...f, value: e.target.value }))} />
                      <select className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={labForm.flag} onChange={(e) => setLabForm((f) => ({ ...f, flag: e.target.value as LabResultItem['flag'] }))}>
                        {(['Normal', 'High', 'Low', 'Critical'] as const).map((flag) => <option key={flag}>{flag}</option>)}
                      </select>
                      <Button onClick={addLabResult}><Upload className="w-4 h-4 mr-2" />{labForm.value.trim() ? 'Add result' : 'Order test'}</Button>
                    </div>
                  ) : null
                ) : (
                  <div className="premium-card p-3 flex justify-end">
                    <Button onClick={uploadLabResult} disabled={!canUploadLab}><Upload className="w-4 h-4 mr-2" />Upload External Lab</Button>
                  </div>
                )}
                {isSupabaseConfigured && filteredLabs.length === 0 ? <p className="text-sm text-gray-500 dark:text-slate-400">No lab results for this patient yet.</p> : null}
                <div className="premium-card overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-100 dark:bg-slate-800/80">
                      <tr>
                        <th className="px-3 py-2 text-left text-gray-600 dark:text-slate-300">Date</th><th className="px-3 py-2 text-left text-gray-600 dark:text-slate-300">Test</th><th className="px-3 py-2 text-left text-gray-600 dark:text-slate-300">Range</th><th className="px-3 py-2 text-left text-gray-600 dark:text-slate-300">Value</th><th className="px-3 py-2 text-left text-gray-600 dark:text-slate-300">Flag</th><th className="px-3 py-2 text-left text-gray-600 dark:text-slate-300">Doctor</th><th className="px-3 py-2 text-left text-gray-600 dark:text-slate-300">Tech</th><th className="px-3 py-2 text-left text-gray-600 dark:text-slate-300">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLabs.map((lab) => (
                        <tr key={lab.id} className="border-t border-gray-100 cursor-pointer hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800/60" onClick={() => setSelectedLab(lab)}>
                          <td className="px-3 py-2">{lab.date}</td><td className="px-3 py-2">{lab.testName}</td><td className="px-3 py-2">{lab.referenceRange}</td><td className="px-3 py-2">{lab.patientValue}</td>
                          <td className="px-3 py-2"><span className={cn('px-2 py-0.5 rounded-full text-xs', lab.flag === 'High' ? 'bg-amber-100 text-amber-700' : lab.flag === 'Critical' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700')}>{lab.flag}</span></td>
                          <td className="px-3 py-2">{lab.orderingDoctor}</td><td className="px-3 py-2">{lab.technician}</td><td className="px-3 py-2">{lab.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {selectedLab && (
                  <div className="premium-card p-4">
                    <div className="flex justify-between items-center">
                      <h4 className="font-semibold text-gray-900 dark:text-slate-50">Detailed Lab Report: {selectedLab.testName}</h4>
                      <Button variant="outline" onClick={() => setSelectedLab(null)}>Close</Button>
                    </div>
                    {isSupabaseConfigured ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-sm">
                        <div className="rounded-lg bg-gray-50 p-3 dark:bg-slate-800/60">
                          Status: {selectedLab.status} • Reference range: {selectedLab.referenceRange}
                        </div>
                        <div className="rounded-lg bg-gray-50 p-3 dark:bg-slate-800/60">
                          {labHistory.length > 1
                            ? `Previous ${selectedLab.testName}: ${labHistory.filter((lab) => lab.id !== selectedLab.id).slice(0, 3).map((lab) => `${lab.patientValue} (${lab.date})`).join(', ')}`
                            : 'No earlier results for this test.'}
                        </div>
                        {selectedLab.status === 'Completed' ? (
                          <div className="rounded-lg bg-gray-50 p-3 md:col-span-2 dark:bg-slate-800/60">
                            Interpretation: {selectedLab.interpretation || 'None recorded'}
                          </div>
                        ) : canEditLab ? (
                          <div className="md:col-span-2 grid grid-cols-1 gap-2 md:grid-cols-4">
                            <Input placeholder="Result value *" value={labCompletion.value} onChange={(e) => setLabCompletion((c) => ({ ...c, value: e.target.value }))} />
                            <select className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={labCompletion.flag} onChange={(e) => setLabCompletion((c) => ({ ...c, flag: e.target.value as LabResultItem['flag'] }))}>
                              {(['Normal', 'High', 'Low', 'Critical'] as const).map((flag) => <option key={flag}>{flag}</option>)}
                            </select>
                            <Input placeholder="Interpretation" value={labCompletion.interpretation} onChange={(e) => setLabCompletion((c) => ({ ...c, interpretation: e.target.value }))} />
                            <Button onClick={completeSelectedLab}>Record result</Button>
                          </div>
                        ) : (
                          <p className="md:col-span-2 text-xs text-gray-500 dark:text-slate-400">Awaiting result from the laboratory.</p>
                        )}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-sm">
                        <div className="rounded-lg bg-gray-50 p-3 dark:bg-slate-800/60">AI anomaly highlight: Mild deviation compared with previous trend.</div>
                        <div className="rounded-lg bg-gray-50 p-3 dark:bg-slate-800/60">Compare previous: Prior value was 6.9, now 7.3.</div>
                        <div className="rounded-lg bg-gray-50 p-3 md:col-span-2 dark:bg-slate-800/60">Trend graph (time-based): ▁▂▃▅▆</div>
                        <textarea className="min-h-20 rounded-md border border-input p-3 text-sm md:col-span-2" placeholder="Clinical interpretation note" />
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => printLabReport(selectedLab)}><FileDigit className="w-4 h-4 mr-2" />Print / PDF</Button>
                      {isSupabaseConfigured && hasModule('switch-network') && (
                        <Button variant="outline" onClick={() => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { page: 'switch-network' } }))}>
                          <Share2 className="w-4 h-4 mr-2" />Refer via VitaLink Network
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'documents' && (
              <div className="space-y-3">
                <div className="premium-card p-3 grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-2">
                  <Input placeholder="Search name or tags" value={docSearch} onChange={(e) => setDocSearch(e.target.value)} />
                  <select className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={docCategory} onChange={(e) => setDocCategory(e.target.value)}>
                    {['All', 'Imaging', 'Consent forms', 'Referral letters', 'Discharge summary', 'Insurance files', 'External reports'].map((c) => <option key={c}>{c}</option>)}
                  </select>
                  <Button onClick={uploadDocument} disabled={!canUploadDocuments || uploadingDocument}><Upload className="w-4 h-4 mr-2" />{uploadingDocument ? 'Uploading...' : 'Upload'}</Button>
                  <input
                    ref={documentInputRef}
                    type="file"
                    multiple
                    accept=".pdf,image/*,.doc,.docx,.txt"
                    className="hidden"
                    onChange={(e) => void uploadDocumentFiles(e.target.files)}
                  />
                </div>
                {isSupabaseConfigured ? (
                  <div
                    className="premium-card p-4 border-dashed border-2 border-gray-200 text-center text-sm text-gray-500 dark:border-slate-700 dark:text-slate-400"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void uploadDocumentFiles(e.dataTransfer.files);
                    }}
                  >
                    Drag and drop files here to upload (PDF, images, Word or text, up to 20 MB). Files go into the category selected above
                    {docCategory === 'All' ? ' (External reports while All is selected)' : ''}; shared links expire after an hour.
                  </div>
                ) : (
                  <div className="premium-card p-4 border-dashed border-2 border-gray-200 text-center text-sm text-gray-500 dark:border-slate-700 dark:text-slate-400">
                    Drag and drop files here for secure upload (token-share, expiry links, watermark with VitaLink ID).
                  </div>
                )}
                {isSupabaseConfigured && filteredDocs.length === 0 && (
                  <p className="text-sm text-gray-500 dark:text-slate-400">No documents on this patient's chart yet.</p>
                )}
                <div className="premium-card overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-100 dark:bg-slate-800/80">
                      <tr><th className="px-3 py-2 text-left text-gray-600 dark:text-slate-300">Document</th><th className="px-3 py-2 text-left text-gray-600 dark:text-slate-300">Category</th><th className="px-3 py-2 text-left text-gray-600 dark:text-slate-300">Size</th><th className="px-3 py-2 text-left text-gray-600 dark:text-slate-300">Version</th><th className="px-3 py-2 text-left text-gray-600 dark:text-slate-300">Uploaded by</th><th className="px-3 py-2 text-left text-gray-600 dark:text-slate-300">Date</th><th className="px-3 py-2 text-left text-gray-600 dark:text-slate-300">Actions</th></tr>
                    </thead>
                    <tbody>
                      {filteredDocs.map((doc) => (
                        <tr key={doc.id} className="border-t border-gray-100 dark:border-slate-700">
                          <td className="px-3 py-2">
                            <p className="font-medium text-gray-900 dark:text-slate-50">{doc.name}</p>
                            <p className="text-xs text-gray-500 dark:text-slate-400">{doc.tags.join(', ')}</p>
                          </td>
                          <td className="px-3 py-2">{doc.category}</td>
                          <td className="px-3 py-2">{doc.size}</td>
                          <td className="px-3 py-2">v{doc.version}</td>
                          <td className="px-3 py-2">{doc.uploadedBy}</td>
                          <td className="px-3 py-2">{doc.uploadedAt}</td>
                          <td className="px-3 py-2">
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" onClick={() => openDocument(doc, 'preview')}>Preview</Button>
                              <Button size="sm" variant="outline" onClick={() => openDocument(doc, 'download')}>Download</Button>
                              <Button size="sm" variant="outline" onClick={() => openDocument(doc, 'share')}><Send className="w-3 h-3 mr-1" />Share</Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400">Access history, token-based sharing, expiry links, and watermarking are tracked per document event.</p>
              </div>
            )}

            {activeTab === 'network' && patientId && <ReceivedRecordsPanel patientId={patientId} />}
            {activeTab === 'connected-emr' && patientId && <ConnectedEmrRecords patientId={patientId} />}

            {activeTab === 'timeline' && (
              <div className="space-y-3">
                <div className="premium-card p-3 flex flex-wrap gap-2">
                  <select className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={timelineFilter} onChange={(e) => setTimelineFilter(e.target.value)}>
                    <option value="all">All</option>
                    <option value="clinical-note">Clinical notes</option>
                    <option value="lab-uploaded">Lab uploads</option>
                    <option value="document-added">Documents</option>
                    <option value="diagnosis-updated">Diagnoses</option>
                    <option value="prescription-issued">Prescriptions</option>
                  </select>
                </div>
                <div className="premium-card p-4 space-y-3">
                  {filteredTimeline.map((item) => (
                    <button key={item.id} className="w-full text-left rounded-lg border border-gray-100 p-3 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800/60">
                      <p className="font-medium text-gray-900 dark:text-slate-50">{item.title}</p>
                      <p className="text-sm text-gray-600 dark:text-slate-300">{item.detail}</p>
                      <p className="text-xs text-gray-500 mt-1 dark:text-slate-400">{item.actor} • {new Date(item.createdAt).toLocaleString()}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      <div className="premium-card p-3">
        <h4 className="font-semibold text-gray-900 mb-2 dark:text-slate-50">Security & Access Controls</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
          <div className="rounded-lg bg-gray-50 p-2 dark:bg-slate-800/60">Receptionist: no clinical note create/edit, no lab edit.</div>
          <div className="rounded-lg bg-gray-50 p-2 dark:bg-slate-800/60">Doctor: full EMR clinical note workflow.</div>
          <div className="rounded-lg bg-gray-50 p-2 dark:bg-slate-800/60">Lab Scientist: upload/manage lab results, no clinical edit.</div>
          <div className="rounded-lg bg-gray-50 p-2 dark:bg-slate-800/60">Admin: read-focused mode for medical data.</div>
        </div>
      </div>
    </div>
  );
}
