// VitaMind Dx for live workspaces: VitaLink's own diagnosis engine. No outside
// AI model is involved; the engine runs in the database, learns from confirmed
// diagnoses and cites research from PubMed.
import { useCallback, useEffect, useState } from 'react';
import { BrainCircuit, ExternalLink, FileImage, History, Radio, ShieldCheck, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { getModelStats, listActiveOutbreaks, searchPatients, type DxModelStats, type DxPatientMatch, type OutbreakSignal } from '@/lib/supabase/diagnosis';
import { DIAGNOSIS_HANDOFF_KEY } from '@/lib/handoffs';
import { PatientPicker } from './PatientPicker';
import { SymptomEngine } from './SymptomEngine';
import { HistoryAnalysis } from './HistoryAnalysis';
import { ImagingReports } from './ImagingReports';
import { VitaMindAI } from './VitaMindAI';

type Tab = 'engine' | 'ai' | 'history' | 'imaging';
const SOURCE_LABEL = { who: 'WHO', ncdc: 'NCDC', manual: 'VitaLink', sentinel: 'Sentinel' } as const;
const LEVEL_STYLE = { high: 'bg-red-100 text-red-700', active: 'bg-amber-100 text-amber-800', watch: 'bg-blue-100 text-blue-700' } as const;
const DOCTOR_ROLES = ['super-admin', 'hospital-admin', 'doctor'];

export function LiveDiagnosis() {
  const { organization, currentRole } = useAuth();
  const [tab, setTab] = useState<Tab>('engine');
  const [patient, setPatient] = useState<DxPatientMatch | null>(null);
  const [stats, setStats] = useState<DxModelStats | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [outbreaks, setOutbreaks] = useState<OutbreakSignal[]>([]);
  // Sent from the EMR note editor: the complaint to analyse and the patient it belongs to.
  const [handoff] = useState<{ switchId: string; symptoms: string } | null>(() => {
    try {
      const raw = sessionStorage.getItem(DIAGNOSIS_HANDOFF_KEY);
      sessionStorage.removeItem(DIAGNOSIS_HANDOFF_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  useEffect(() => {
    if (!handoff?.switchId) return;
    searchPatients(organization.id, handoff.switchId)
      .then((matches) => { const match = matches.find((m) => m.switchId === handoff.switchId); if (match) setPatient(match); })
      .catch(() => undefined);
  }, [handoff, organization.id]);
  const isDoctor = DOCTOR_ROLES.includes(currentRole);

  const loadStats = useCallback(() => { getModelStats(organization.id).then(setStats).catch(() => setStats(null)); }, [organization.id]);
  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { listActiveOutbreaks(organization.id).then(setOutbreaks).catch(() => setOutbreaks([])); }, [organization.id]);
  const goToPlans = () => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { page: 'subscription' } }));

  return (
    <div className="space-y-4 page-transition">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900">AI Clinical Intelligence</h1>
          <p className="text-sm text-gray-500">VitaMind Dx: VitaLink's own diagnosis engine. It learns from confirmed diagnoses and cites published research.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <ShieldCheck className="h-4 w-4 shrink-0" />Decision support, not a final diagnosis
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Knowledge base" value={`${stats.conditions} conditions`} hint={`${stats.findings} findings · ${stats.links} links`} />
          <Stat label="Confirmed cases learned" value={stats.casesAll.toLocaleString()} hint={`${stats.casesHere} from this workspace`} />
          <Stat label="Top suggestion correct" value={stats.confirmedRate == null ? '—' : `${stats.confirmedRate}%`} hint={stats.top3Rate == null ? 'No confirmed analyses yet' : `In top 3: ${stats.top3Rate}%`} />
          <Stat label="Analyses saved here" value={stats.sessionsHere.toLocaleString()} hint={`${stats.papersCached} papers cached`} />
        </div>
      )}

      {outbreaks.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900"><Radio className="h-4 w-4" />Active outbreak signals: the engine raises these conditions for patients in affected areas</p>
          <div className="flex flex-wrap gap-2">
            {outbreaks.map((o) => (
              <span key={`${o.source}-${o.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-2.5 py-1 text-xs text-gray-800">
                <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase', LEVEL_STYLE[o.level])}>{o.level}</span>
                {o.condition}{o.state ? ` · ${o.state}` : ' · national'} · {SOURCE_LABEL[o.source]}
                {o.url && <a href={o.url} target="_blank" rel="noreferrer" aria-label="Source" className="text-gray-400 hover:text-royal-600"><ExternalLink className="h-3 w-3" /></a>}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div data-tour-id="ai-tools" className="flex w-fit flex-wrap gap-1 rounded-xl bg-gray-100 p-1">
          {([
            { id: 'engine', label: 'Symptom Diagnosis Engine', icon: BrainCircuit },
            { id: 'ai', label: 'VitaMind AI', icon: Sparkles },
            { id: 'history', label: 'History-Aware Analysis', icon: History },
            { id: 'imaging', label: 'Imaging Reports', icon: FileImage },
          ] as const).map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-2 rounded-lg px-3 py-2 text-sm', tab === t.id ? 'bg-white text-royal-700 shadow-sm' : 'text-gray-600 hover:text-gray-800')}>
              <t.icon className="h-4 w-4" />{t.label}
            </button>
          ))}
        </div>
        <div data-tour-id="ai-patient" className="md:ml-auto md:w-96"><PatientPicker organizationId={organization.id} value={patient} onChange={setPatient} /></div>
      </div>

      {tab === 'engine' && (
        <SymptomEngine
          key={patient?.id ?? 'none'}
          organizationId={organization.id}
          patient={patient}
          canConfirm={isDoctor}
          initialText={handoff?.symptoms}
          onSaved={() => { loadStats(); setRefreshKey((k) => k + 1); }}
        />
      )}
      {tab === 'ai' && <VitaMindAI organizationId={organization.id} patient={patient} canFeedback={isDoctor} onUpgrade={goToPlans} />}
      {tab === 'history' && <HistoryAnalysis patient={patient} canReview={isDoctor || currentRole === 'nurse'} refreshKey={refreshKey} />}
      {tab === 'imaging' && <ImagingReports organizationId={organization.id} patient={patient} canReport={isDoctor} />}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="premium-card p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-gray-900">{value}</p>
      <p className="text-[11px] text-gray-400">{hint}</p>
    </div>
  );
}
