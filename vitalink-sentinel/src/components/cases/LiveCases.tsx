// Case registry on live Supabase data. Cases arrive from VitaLink hospitals that share
// with this organisation, partner systems (sentinel-ingest) and officers' own reports;
// every change is recorded in the case's history (sentinel_case_events).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { ChevronLeft, ChevronRight, Download, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { SBadge as Badge } from '@/components/standalone/SBadge';
import { SButton as Button } from '@/components/standalone/SButton';
import { SSelect as Select } from '@/components/standalone/SSelect';
import { DataTable } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { diseaseLibrary } from '@/data/mockSentinelData';
import { useSentinelStore } from '@/store/useSentinelStore';
import {
  addCaseNote, canEditCases, exportCases, listCaseEvents, listCases, listDiseases, listLinkedFacilities, listOpenOutbreaks, reportCase, updateCase,
  type CaseEvent, type CaseFilters, type CaseSource, type CaseStatus, type LinkedFacility, type NewCaseReport, type OutbreakOption,
  type RegistryDisease, type SentinelCase,
} from '@/lib/supabase/sentinel';

const PAGE_SIZE = 50;
const STATUSES: CaseStatus[] = ['suspected', 'probable', 'confirmed', 'recovered', 'deceased'];
const SOURCES: Record<CaseSource, string> = {
  vitalink_emr_sync: 'VitaLink hospital', partner_api: 'Partner system', manual: 'Direct report', lab_notification: 'Laboratory', community_report: 'Community report',
};
const AGE_GROUPS = ['0-5', '6-14', '15-29', '30-49', '50+', 'unknown'];
const STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo',
  'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];
const COMMON_SYMPTOMS = ['Fever', 'Headache', 'Vomiting', 'Diarrhoea', 'Cough', 'Rash', 'Bleeding', 'Jaundice', 'Neck stiffness', 'Difficulty breathing', 'Body weakness'];

const tone = (status: CaseStatus) => (status === 'deceased' || status === 'confirmed' ? 'critical' : status === 'probable' ? 'high' : status === 'suspected' ? 'moderate' : 'low');
const day = (iso: string | null) => (iso ? format(new Date(iso), 'd MMM yyyy') : '—');
const muted = 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';
const inputClass = 'sentinel-input rounded-xl px-3 py-2 text-sm';

function eventText(e: CaseEvent): string {
  const d = e.detail as Record<string, string | boolean | null>;
  switch (e.kind) {
    case 'reported': return `Reported as ${d.status ?? 'suspected'}${d.source_type ? ` via ${SOURCES[d.source_type as CaseSource] ?? d.source_type}` : ''}${d.source_label ? ` (${d.source_label})` : ''}`;
    case 'status': return `Status changed from ${d.from} to ${d.to}`;
    case 'lab': return d.lab_confirmed ? 'Laboratory confirmation recorded' : 'Laboratory confirmation removed';
    case 'outbreak': return d.outbreak_id ? `Linked to outbreak: ${d.outbreak ?? 'outbreak'}` : 'Unlinked from outbreak';
    case 'contact_tracing': return d.initiated ? 'Contact tracing started' : 'Contact tracing marked not started';
    case 'hospitalized': return d.hospitalized ? 'Patient admitted' : 'Admission removed';
    case 'note': return String(d.text ?? '');
    default: return e.kind;
  }
}

function toCsv(cases: SentinelCase[]): string {
  const head = ['Case ID', 'Disease', 'Status', 'Lab confirmed', 'State', 'LGA', 'Source', 'Facility / reporter', 'Report date', 'Onset date', 'Age group', 'Sex', 'Hospitalised', 'Symptoms', 'Outbreak', 'Patient ref'];
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = cases.map((c) => [c.reportId, c.disease, c.status, c.labConfirmed ? 'yes' : 'no', c.state, c.lga, SOURCES[c.source], c.facility ?? c.sourceLabel,
    c.reportDate, c.onsetDate, c.ageGroup, c.sex, c.hospitalized ? 'yes' : 'no', c.symptoms.join('; '), c.outbreak, c.patientRef].map(cell).join(','));
  return [head.map(cell).join(','), ...rows].join('\r\n');
}

// ---------------------------------------------------------------------------

function CaseDrawer({ report, canEdit, outbreaks, onClose, onChanged }: {
  report: SentinelCase; canEdit: boolean; outbreaks: OutbreakOption[]; onClose: () => void; onChanged: () => void;
}) {
  const [events, setEvents] = useState<CaseEvent[] | null>(null);
  const [status, setStatus] = useState<CaseStatus>(report.status);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const loadEvents = useCallback(() => { listCaseEvents(report.id).then(setEvents).catch(() => setEvents([])); }, [report.id]);
  useEffect(() => { loadEvents(); }, [loadEvents]);

  const act = async (name: string, action: () => Promise<void>, success: string) => {
    setBusy(name);
    try { await action(); toast.success(success); loadEvents(); onChanged(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5 dark:border-slate-800">
        <div>
          <p className="font-mono text-xs text-blue-600 dark:text-blue-300">{report.reportId}</p>
          <h2 className="text-xl font-bold text-slate-950 dark:text-slate-50">{report.disease}</h2>
          <div className="mt-2 flex flex-wrap gap-2"><Badge tone={tone(report.status)}>{report.status}</Badge>{report.labConfirmed && <Badge tone="low">lab confirmed</Badge>}</div>
        </div>
        <Button className={`h-9 w-9 p-0 ${muted}`} onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></Button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Info label="State / LGA" value={`${report.state}${report.lga ? ` / ${report.lga}` : ''}`} />
          <Info label="Source" value={SOURCES[report.source]} />
          <Info label="Facility / reporter" value={report.facility ?? report.sourceLabel ?? '—'} wide />
          <Info label="Reported" value={day(report.reportDate)} />
          <Info label="Symptom onset" value={day(report.onsetDate)} />
          <Info label="Age group" value={report.ageGroup} />
          <Info label="Sex" value={report.sex} />
          <Info label="Hospitalised" value={report.hospitalized ? 'Yes' : 'No'} />
          <Info label="Contact tracing" value={report.contactTracing ? 'Started' : 'Not started'} />
          <Info label="Outbreak" value={report.outbreak ?? 'Not linked'} wide />
          {report.patientRef && <Info label="Patient pseudonym" value={report.patientRef} wide />}
        </div>
        {report.symptoms.length > 0 && (
          <div className="flex flex-wrap gap-1.5">{report.symptoms.map((s) => <span key={s} className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{s}</span>)}</div>
        )}

        {canEdit && (
          <div className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
            <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">Update case</p>
            <div className="flex gap-2">
              <Select className="flex-1" value={status} onChange={(e) => setStatus(e.target.value as CaseStatus)}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
              <Button disabled={busy !== null || status === report.status} onClick={() => void act('status', () => updateCase(report.id, { status }), `Status set to ${status}`)}>Save</Button>
            </div>
            <Select value={report.outbreakId ?? ''} disabled={busy !== null}
              onChange={(e) => void act('outbreak', () => updateCase(report.id, { outbreakId: e.target.value || null }), e.target.value ? 'Linked to outbreak' : 'Unlinked from outbreak')}>
              <option value="">Not linked to an outbreak</option>
              {outbreaks.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </Select>
            <div className="flex flex-wrap gap-2">
              <Button className={muted} disabled={busy !== null} onClick={() => void act('lab', () => updateCase(report.id, { labConfirmed: !report.labConfirmed }), report.labConfirmed ? 'Lab confirmation removed' : 'Marked lab confirmed')}>
                {report.labConfirmed ? 'Remove lab confirmation' : 'Mark lab confirmed'}
              </Button>
              <Button className={muted} disabled={busy !== null} onClick={() => void act('trace', () => updateCase(report.id, { contactTracing: !report.contactTracing }), report.contactTracing ? 'Contact tracing marked not started' : 'Contact tracing started')}>
                {report.contactTracing ? 'Contact tracing: stop' : 'Start contact tracing'}
              </Button>
              <Button className={muted} disabled={busy !== null} onClick={() => void act('admit', () => updateCase(report.id, { hospitalized: !report.hospitalized }), report.hospitalized ? 'Admission removed' : 'Marked as admitted')}>
                {report.hospitalized ? 'Not admitted' : 'Mark admitted'}
              </Button>
            </div>
          </div>
        )}

        <div>
          <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">History</p>
          {events === null ? <p className="mt-2 text-sm text-slate-500">Loading…</p> : (
            <ol className="mt-3 space-y-3 border-l border-slate-200 pl-4 text-sm dark:border-slate-700">
              {events.map((e) => (
                <li key={e.id}>
                  <p className={e.kind === 'note' ? 'whitespace-pre-line rounded-lg bg-slate-50 p-2 text-slate-700 dark:bg-slate-900 dark:text-slate-200' : 'text-slate-700 dark:text-slate-200'}>{eventText(e)}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{e.actor ?? 'Sentinel'} · {formatDistanceToNow(new Date(e.at), { addSuffix: true })}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
        {canEdit && (
          <div>
            <textarea className="sentinel-input min-h-20 w-full rounded-lg p-3 text-sm" placeholder="Add a note (investigation findings, contacts, follow-up)" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="mt-2 flex justify-end">
              <Button disabled={busy !== null || !note.trim()} onClick={() => void act('note', async () => { await addCaseNote(report.id, note); setNote(''); }, 'Note added')}>Add note</Button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function Info({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ReportCaseForm({ orgId, diseases, facilities, outbreaks, defaultState, onDone }: {
  orgId: string; diseases: RegistryDisease[]; facilities: LinkedFacility[]; outbreaks: OutbreakOption[]; defaultState: string; onDone: (reportId?: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<NewCaseReport>({
    disease: '', status: 'suspected', labConfirmed: false, ageGroup: 'unknown', sex: 'unknown', state: STATES.includes(defaultState) ? defaultState : 'Lagos', lga: '',
    facilityId: '', onsetDate: '', reportDate: today, hospitalized: false, symptoms: [], notes: '', localRef: '', outbreakId: '',
    travelHistory: false, contactTracing: false,
  });
  const [symptomInput, setSymptomInput] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<NewCaseReport>) => setForm((f) => ({ ...f, ...patch }));
  const disease = diseases.find((d) => d.id === form.disease);
  const suggestions = useMemo(() => {
    const known = diseaseLibrary.find((d) => d.name.toLowerCase() === disease?.name.toLowerCase())?.symptoms ?? [];
    return [...new Set([...known, ...COMMON_SYMPTOMS])].filter((s) => !form.symptoms.includes(s));
  }, [disease, form.symptoms]);
  const addSymptom = (s: string) => { const v = s.trim(); if (v && !form.symptoms.includes(v)) set({ symptoms: [...form.symptoms, v] }); setSymptomInput(''); };

  const pickFacility = (id: string) => {
    const f = facilities.find((x) => x.id === id);
    // A facility's saved location can be a free-text value (e.g. "Statewide"); only real states are copied.
    set({ facilityId: id, ...(f?.state && STATES.includes(f.state) ? { state: f.state } : {}), ...(f?.lga ? { lga: f.lga } : {}) });
  };

  const submit = async () => {
    if (!form.disease) { toast.error('Choose the disease'); return; }
    if (form.onsetDate && form.reportDate && form.onsetDate > form.reportDate) { toast.error('Symptom onset can\'t be after the report date'); return; }
    setBusy(true);
    try {
      const result = await reportCase(orgId, form);
      toast.success(result.result === 'updated' ? `Matched existing case ${result.reportId}; it has been updated` : `Case ${result.reportId} reported`);
      onDone(result.reportId);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, RegistryDisease[]>();
    for (const category of ['infectious', 'ntd', 'ncd']) map.set(category, diseases.filter((d) => d.category === category));
    return map;
  }, [diseases]);

  return (
    <div className="space-y-5">
      <Section title="Disease">
        <Select value={form.disease} onChange={(e) => set({ disease: e.target.value })}>
          <option value="">Choose disease…</option>
          {[...grouped.entries()].map(([category, items]) => (
            <optgroup key={category} label={category === 'ntd' ? 'Neglected tropical diseases' : category === 'ncd' ? 'Non-communicable' : 'Infectious'}>
              {items.map((d) => <option key={d.id} value={d.id}>{d.name}{d.notifiable ? ' (notifiable)' : ''}</option>)}
            </optgroup>
          ))}
        </Select>
        <Select value={form.status} onChange={(e) => set({ status: e.target.value as CaseStatus })}>{STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}</Select>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><input type="checkbox" checked={form.labConfirmed} onChange={(e) => set({ labConfirmed: e.target.checked })} />Laboratory confirmed</label>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><input type="checkbox" checked={form.hospitalized} onChange={(e) => set({ hospitalized: e.target.checked })} />Admitted to hospital</label>
      </Section>
      <Section title="Where and when">
        <Select value={form.facilityId} onChange={(e) => pickFacility(e.target.value)}>
          <option value="">{facilities.length ? 'No facility (community or direct report)' : 'No linked facilities yet'}</option>
          {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </Select>
        <input className={inputClass} placeholder="Your case number (optional)" value={form.localRef} onChange={(e) => set({ localRef: e.target.value })} />
        <Select value={form.state} onChange={(e) => set({ state: e.target.value })}>{STATES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <input className={inputClass} placeholder="LGA" value={form.lga} onChange={(e) => set({ lga: e.target.value })} />
        <label className="text-xs text-slate-500 dark:text-slate-400">Symptom onset<input className={`${inputClass} mt-1 w-full`} type="date" max={today} value={form.onsetDate} onChange={(e) => set({ onsetDate: e.target.value })} /></label>
        <label className="text-xs text-slate-500 dark:text-slate-400">Report date<input className={`${inputClass} mt-1 w-full`} type="date" max={today} value={form.reportDate} onChange={(e) => set({ reportDate: e.target.value })} /></label>
      </Section>
      <Section title="Patient (no names or contact details)">
        <Select value={form.ageGroup} onChange={(e) => set({ ageGroup: e.target.value })}>{AGE_GROUPS.map((a) => <option key={a} value={a}>{a === 'unknown' ? 'Age unknown' : `${a} years`}</option>)}</Select>
        <Select value={form.sex} onChange={(e) => set({ sex: e.target.value as NewCaseReport['sex'] })}><option value="female">Female</option><option value="male">Male</option><option value="unknown">Sex unknown</option></Select>
      </Section>
      <Section title="Symptoms">
        <div className="col-span-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {form.symptoms.map((s) => (
              <button key={s} type="button" onClick={() => set({ symptoms: form.symptoms.filter((x) => x !== s) })} className="flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-1 text-xs font-medium text-white">{s}<X className="h-3 w-3" /></button>
            ))}
            {suggestions.slice(0, 10).map((s) => (
              <button key={s} type="button" onClick={() => addSymptom(s)} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-blue-400 dark:border-slate-700 dark:text-slate-300">+ {s}</button>
            ))}
          </div>
          <input className={`${inputClass} w-full`} placeholder="Other symptom, then Enter" value={symptomInput} onChange={(e) => setSymptomInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSymptom(symptomInput); } }} />
        </div>
      </Section>
      <Section title="Investigation">
        <Select value={form.outbreakId} onChange={(e) => set({ outbreakId: e.target.value })}>
          <option value="">Not linked to a known outbreak</option>
          {outbreaks.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </Select>
        <div className="flex flex-col gap-2 text-sm text-slate-700 dark:text-slate-200">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.travelHistory} onChange={(e) => set({ travelHistory: e.target.checked })} />Travelled in the last 21 days</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.contactTracing} onChange={(e) => set({ contactTracing: e.target.checked })} />Contact tracing started</label>
        </div>
        <textarea className={`${inputClass} col-span-2 min-h-20`} placeholder="Notes (clinical picture, exposure, actions taken)" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Section>
      <div className="flex justify-end gap-2">
        <Button className={muted} onClick={() => onDone()}>Cancel</Button>
        <Button disabled={busy} onClick={() => void submit()}>{busy ? 'Submitting…' : 'Submit case report'}</Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h3>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------------------

export function LiveCases() {
  const { activeOrganization, me } = useSentinelStore();
  const orgId = activeOrganization?.id;
  const canEdit = canEditCases(me?.role);
  const [searchInput, setSearchInput] = useState('');
  const [filters, setFilters] = useState<CaseFilters>({ days: 90 });
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ key: string; cases: SentinelCase[]; total: number } | null>(null);
  const [error, setError] = useState('');
  const [diseases, setDiseases] = useState<RegistryDisease[]>([]);
  const [facilities, setFacilities] = useState<LinkedFacility[]>([]);
  const [outbreaks, setOutbreaks] = useState<OutbreakOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const key = JSON.stringify({ filters, page, refresh });

  // Search waits for a pause in typing.
  useEffect(() => {
    const timer = window.setTimeout(() => { setFilters((f) => (f.search === searchInput ? f : { ...f, search: searchInput })); setPage(0); }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    listCases(orgId, filters, page, PAGE_SIZE)
      .then((result) => { if (alive) { setData({ key, ...result }); setError(''); } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Could not load cases.'); });
    return () => { alive = false; };
  }, [orgId, filters, page, key]);

  useEffect(() => {
    if (!orgId) return;
    void Promise.all([listDiseases(), listLinkedFacilities(orgId), listOpenOutbreaks(orgId)])
      .then(([d, f, o]) => { setDiseases(d); setFacilities(f); setOutbreaks(o); })
      .catch(() => undefined);
  }, [orgId, refresh]);

  // New cases arrive from hospitals and partners at any time.
  useEffect(() => {
    const timer = window.setInterval(() => setRefresh((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const loading = !data || data.key !== key;
  const cases = data?.cases ?? [];
  const total = data?.total ?? 0;
  const selected = cases.find((c) => c.id === selectedId) ?? null;
  const setFilter = (patch: Partial<CaseFilters>) => { setFilters((f) => ({ ...f, ...patch })); setPage(0); };

  const download = async () => {
    if (!orgId) return;
    setExporting(true);
    try {
      const all = await exportCases(orgId, filters);
      const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff), toCsv(all)], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `sentinel-cases-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${all.length} case${all.length === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-950 dark:text-slate-50">Case Registry</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{loading && !data ? 'Loading…' : `${total.toLocaleString()} case report${total === 1 ? '' : 's'}`} from linked hospitals, partner systems and direct reports.</p>
        </div>
        <div className="flex gap-2">
          <Button className={muted} disabled={exporting || total === 0} onClick={() => void download()}>{exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Export CSV</Button>
          {canEdit && <Button onClick={() => setReporting(true)}><Plus className="h-4 w-4" />Report New Case</Button>}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-[1fr_200px_160px_180px_150px]">
        <input className={inputClass} placeholder="Search case ID, disease, state, LGA, reporter" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        <Select value={filters.diseaseId ?? ''} onChange={(e) => setFilter({ diseaseId: e.target.value || undefined })}>
          <option value="">All diseases</option>{diseases.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <Select value={filters.status ?? ''} onChange={(e) => setFilter({ status: (e.target.value || undefined) as CaseStatus | undefined })}>
          <option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </Select>
        <Select value={filters.source ?? ''} onChange={(e) => setFilter({ source: (e.target.value || undefined) as CaseSource | undefined })}>
          <option value="">All sources</option>{(Object.keys(SOURCES) as CaseSource[]).map((s) => <option key={s} value={s}>{SOURCES[s]}</option>)}
        </Select>
        <Select value={String(filters.days ?? 0)} onChange={(e) => setFilter({ days: Number(e.target.value) || undefined })}>
          <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option><option value="0">All time</option>
        </Select>
      </div>

      {error && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      {!loading && cases.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {filters.search || filters.diseaseId || filters.status || filters.source ? 'No cases match these filters.'
            : 'No cases yet. They appear here when linked VitaLink hospitals or partner systems report notifiable diseases, or when your team reports one.'}
        </div>
      ) : (
        <div className={loading ? 'opacity-60 transition-opacity' : ''}>
          <DataTable headers={['Case ID', 'Disease', 'State / LGA', 'Source', 'Reported', 'Age / Sex', 'Status', 'Lab', '']}>
            {cases.map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60" onClick={() => setSelectedId(c.id)}>
                <td className="px-4 py-3 font-mono text-xs text-blue-600 dark:text-blue-300">{c.reportId}</td>
                <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-50">{c.disease}{c.outbreak && <span className="ml-1.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">outbreak</span>}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{c.state}{c.lga ? ` / ${c.lga}` : ''}</td>
                <td className="px-4 py-3 text-slate-500 dark:text-slate-400"><span className="block">{c.facility ?? c.sourceLabel ?? SOURCES[c.source]}</span><span className="text-xs">{SOURCES[c.source]}</span></td>
                <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{day(c.reportDate)}</td>
                <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{c.ageGroup} · {c.sex}</td>
                <td className="px-4 py-3"><Badge tone={tone(c.status)}>{c.status}</Badge></td>
                <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{c.labConfirmed ? 'Confirmed' : 'Pending'}</td>
                <td className="px-4 py-3"><Button className="px-3 py-1.5 text-xs" onClick={(e) => { e.stopPropagation(); setSelectedId(c.id); }}>View</Button></td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-slate-500 dark:text-slate-400">
          <span>{page * PAGE_SIZE + 1}–{Math.min(total, (page + 1) * PAGE_SIZE)} of {total.toLocaleString()}</span>
          <div className="flex gap-2">
            <Button className={muted} disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" />Previous</Button>
            <Button className={muted} disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>Next<ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {selected && <CaseDrawer key={selected.id + selected.updatedAt} report={selected} canEdit={canEdit} outbreaks={outbreaks} onClose={() => setSelectedId(null)} onChanged={() => setRefresh((n) => n + 1)} />}
      {orgId && (
        <Modal title="Report a case" open={reporting} onClose={() => setReporting(false)}>
          <ReportCaseForm orgId={orgId} diseases={diseases} facilities={facilities} outbreaks={outbreaks} defaultState={activeOrganization?.state ?? ''}
            onDone={(reportId) => { setReporting(false); if (reportId) { setPage(0); setRefresh((n) => n + 1); } }} />
        </Modal>
      )}
    </div>
  );
}
