import { useEffect, useMemo, useState } from 'react';
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
import { toast } from 'sonner';
import { getPatientBySwitchId } from '@/lib/patientRegistry';
import { SENTINEL_CLINICAL_EVENT, type SentinelClinicalPayload } from '@/lib/sentinel/events';

type EmrTab = 'overview' | 'clinical-notes' | 'lab-results' | 'documents' | 'timeline';
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
}

const tabs: { id: EmrTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'clinical-notes', label: 'Clinical Notes', icon: FileText },
  { id: 'lab-results', label: 'Lab Results', icon: FlaskConical },
  { id: 'documents', label: 'Documents', icon: Paperclip },
  { id: 'timeline', label: 'Timeline', icon: History },
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
  const { currentRole, canView, canCreate, canEdit, userName } = useAuth();
  const [activeTab, setActiveTab] = useState<EmrTab>('overview');
  const [editorOpen, setEditorOpen] = useState(false);
  const [timeSpent, setTimeSpent] = useState(0);
  const [autosaveAt, setAutosaveAt] = useState('');
  const [signed, setSigned] = useState(false);
  const [noteLocked, setNoteLocked] = useState(false);
  const [noteVersions, setNoteVersions] = useState<string[]>([]);
  const [auditTrail, setAuditTrail] = useState<{ id: string; when: string; action: string; user: string; source: string }[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([
    { id: 't1', type: 'lab-uploaded', title: 'Lab result uploaded', detail: 'HbA1c result available', actor: 'Lab Scientist Okonkwo', createdAt: '2026-04-20T12:22:00Z' },
    { id: 't2', type: 'diagnosis-updated', title: 'Diagnosis updated', detail: 'Type 2 Diabetes with improved control', actor: 'Dr. Sarah Johnson', createdAt: '2026-04-20T12:50:00Z' },
  ]);
  const [labResults, setLabResults] = useState<LabResultItem[]>(defaultLabResults);
  const [documents, setDocuments] = useState<DocumentItem[]>(defaultDocs);
  const [selectedLab, setSelectedLab] = useState<LabResultItem | null>(null);
  const patient = useMemo(() => (patientSwitchId ? getPatientBySwitchId(patientSwitchId) : null), [patientSwitchId]);

  const [soap, setSoap] = useState({
    chiefComplaint: '',
    hpi: '',
    reviewSystems: '',
    patientNarrative: '',
    symptomSummary: '',
    vitalSigns: 'BP 128/82 | HR 72 bpm | Temp 36.8C | SpO2 98%',
    physicalExam: '',
    labRefs: '',
    imagingRef: '',
    attachments: '',
    measurements: '',
    primaryDiagnosis: '',
    secondaryDiagnosis: '',
    differentialDiagnosis: '',
    riskLevel: 'moderate' as RiskLevel,
    aiSuggestion: 'Possible uncontrolled glycemic trend. Consider medication adjustment and closer interval follow-up.',
    prescriptions: '',
    labOrders: '',
    imagingOrders: '',
    referralNotes: '',
    followUp: '',
    telemedicineFollowup: 'No',
    addendum: '',
  });

  const [labFilters, setLabFilters] = useState({ date: '', testType: '', status: '', department: '' });
  const [docSearch, setDocSearch] = useState('');
  const [docCategory, setDocCategory] = useState('All');
  const [timelineFilter, setTimelineFilter] = useState('all');

  const emrReadAllowed = canView('EMR');
  const canCreateClinical = currentRole === 'doctor' && canCreate('EMR');
  const canEditClinical = currentRole === 'doctor' && canEdit('EMR');
  const canUploadLab = currentRole === 'lab-scientist' || currentRole === 'doctor';
  const canEditLab = currentRole === 'doctor' || currentRole === 'lab-scientist';
  const canUploadDocuments = currentRole !== 'receptionist';
  const canReadOnlyAdmin = currentRole === 'hospital-admin';

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

  const saveDraft = () => {
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
    setEditorOpen(true);
    setTimeSpent(0);
  };

  const saveClinicalNote = () => {
    if (!canEditClinical || noteLocked) {
      toast.error('RBAC or signature lock prevents editing this note.');
      return;
    }
    saveDraft();
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
    setSigned(true);
    setNoteLocked(true);
    addAudit('clinical_note_signed_and_locked');
    toast.success('Electronic signature applied and note locked.');
    const sid = patient?.switchId ?? patientSwitchId ?? '';
    if (sid && (soap.primaryDiagnosis.trim() || soap.secondaryDiagnosis.trim())) {
      window.dispatchEvent(
        new CustomEvent<SentinelClinicalPayload>(SENTINEL_CLINICAL_EVENT, {
          detail: {
            patientSwitchId: sid,
            primaryDiagnosis: soap.primaryDiagnosis,
            secondaryDiagnosis: soap.secondaryDiagnosis,
            facilityName: 'Lagos Central Hospital',
            state: patient?.state ?? 'Lagos',
            lga: 'Ikeja',
          },
        }),
      );
    }
  };

  const copyPrevious = () => {
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

  const uploadLabResult = () => {
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

  const uploadDocument = () => {
    if (!canUploadDocuments) {
      toast.error('RBAC: your role cannot upload to document vault.');
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
          <Button className="bg-gradient-to-r from-royal-600 to-royal-800 text-white gap-2" onClick={launchClinicalEditor}>
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
              <Button variant="outline" onClick={() => toast.success('Clinical PDF generated.')}>
                <Download className="w-4 h-4 mr-2" />
                Export PDF
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
                <Button variant="outline" className="justify-start min-w-0"><Mic className="w-4 h-4 mr-2 shrink-0" /><span className="truncate">Voice-to-text input</span></Button>
                <Button variant="outline" className="justify-start min-w-0"><Bot className="w-4 h-4 mr-2 shrink-0" /><span className="truncate">AI symptom summary</span></Button>
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
                <textarea className="min-h-20 rounded-md border border-input p-3 text-sm md:col-span-2 w-full min-w-0" placeholder="AI diagnostic suggestions (non-final)" value={soap.aiSuggestion} onChange={(e) => setSoap((p) => ({ ...p, aiSuggestion: e.target.value }))} />
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
                <Input placeholder="Doctor digital stamp" value="SWITCH-DOCTOR-STAMP-VERIFIED" readOnly className="min-w-0" />
                <textarea className="min-h-16 rounded-md border border-input p-3 text-sm md:col-span-2 w-full min-w-0" placeholder="Addendum support" value={soap.addendum} onChange={(e) => setSoap((p) => ({ ...p, addendum: e.target.value }))} />
              </div>
            </section>
          </div>

          <div className="sticky bottom-0 mt-4 p-3 rounded-xl border bg-white/90 backdrop-blur flex flex-wrap gap-2 justify-end min-w-0 dark:border-slate-700 dark:bg-slate-900/90">
            <span className="text-xs text-gray-500 mr-auto flex items-center gap-1 shrink-0 dark:text-slate-400"><Clock3 className="w-3 h-3" />Time spent: {timeSpent} min</span>
            <Button variant="outline" onClick={() => setTimeSpent((v) => v + 5)} className="min-w-0">Track +5 min</Button>
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
          <aside className="xl:col-span-1 premium-card p-4 min-w-0 overflow-hidden">
            <div className="text-center">
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-royal-500 to-royal-700 mx-auto mb-2 text-white flex items-center justify-center font-bold text-xl shrink-0">AJ</div>
              <h3 className="font-semibold text-gray-900 truncate dark:text-slate-50">{patient ? `${patient.firstName} ${patient.lastName}` : 'No Patient Selected'}</h3>
              <p className="text-xs text-gray-500 truncate dark:text-slate-400">VitaLink ID: {patient?.switchId ?? '--'}</p>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <div className="p-2 rounded-lg bg-white dark:bg-slate-800/60 truncate">Tenant: Lagos Central Hospital</div>
              <div className="p-2 rounded-lg bg-white dark:bg-slate-800/60 truncate">EMR Role: {currentRole}</div>
              <div className="p-2 rounded-lg bg-white dark:bg-slate-800/60 truncate">Encryption at rest: Enabled</div>
            </div>
            {canReadOnlyAdmin ? <p className="mt-3 text-xs text-amber-700 bg-amber-50 p-2 rounded-lg truncate">Admin mode: read-only for medical entries.</p> : null}
          </aside>

          <main className="xl:col-span-3 space-y-4 min-w-0">
            <div className="hidden md:flex flex-wrap gap-2 p-1 rounded-xl bg-gray-100 w-full max-w-full min-w-0 dark:bg-slate-900/50">
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
                <p className="text-sm text-gray-500 mt-2 dark:text-slate-400">Structured SOAP documentation with doctor-controlled AI suggestions and signature lock.</p>
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
                <div className="premium-card p-3 flex justify-end">
                  <Button onClick={uploadLabResult} disabled={!canUploadLab}><Upload className="w-4 h-4 mr-2" />Upload External Lab</Button>
                </div>
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-sm">
                      <div className="rounded-lg bg-gray-50 p-3 dark:bg-slate-800/60">AI anomaly highlight: Mild deviation compared with previous trend.</div>
                      <div className="rounded-lg bg-gray-50 p-3 dark:bg-slate-800/60">Compare previous: Prior value was 6.9, now 7.3.</div>
                      <div className="rounded-lg bg-gray-50 p-3 md:col-span-2 dark:bg-slate-800/60">Trend graph (time-based): ▁▂▃▅▆</div>
                      <textarea className="min-h-20 rounded-md border border-input p-3 text-sm md:col-span-2" placeholder="Clinical interpretation note" />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="outline"><FileDigit className="w-4 h-4 mr-2" />Export PDF</Button>
                      <Button variant="outline"><Share2 className="w-4 h-4 mr-2" />Share referral hospital</Button>
                      <Button variant="outline" disabled={!canEditLab}>Digital verification signature</Button>
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
                  <Button onClick={uploadDocument} disabled={!canUploadDocuments}><Upload className="w-4 h-4 mr-2" />Upload</Button>
                </div>
                <div className="premium-card p-4 border-dashed border-2 border-gray-200 text-center text-sm text-gray-500 dark:border-slate-700 dark:text-slate-400">
                  Drag and drop files here for secure upload (token-share, expiry links, watermark with VitaLink ID).
                </div>
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
                              <Button size="sm" variant="outline">Preview</Button>
                              <Button size="sm" variant="outline">Download</Button>
                              <Button size="sm" variant="outline"><Send className="w-3 h-3 mr-1" />Share</Button>
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
