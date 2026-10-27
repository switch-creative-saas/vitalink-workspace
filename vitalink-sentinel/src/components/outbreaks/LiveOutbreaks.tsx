// Outbreaks on live Supabase data: possible outbreaks detected from the case stream,
// declared outbreaks with counts that follow their linked cases, and each outbreak's
// history, epidemic curve and response actions.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { differenceInCalendarDays, format, formatDistanceToNow } from 'date-fns';
import { AlertTriangle, Link2, Plus, Radar } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { SBadge as Badge } from '@/components/standalone/SBadge';
import { SButton as Button } from '@/components/standalone/SButton';
import { SCard as Card } from '@/components/standalone/SCard';
import { SSelect as Select } from '@/components/standalone/SSelect';
import { Modal } from '@/components/ui/Modal';
import { useSentinelStore } from '@/store/useSentinelStore';
import {
  addOutbreakUpdate, canEditCases, canManageOutbreaks, declareOutbreak, linkMatchingCases, listCases, listDiseases, listOutbreakEvents,
  listOutbreakSignals, listOutbreaks, updateOutbreak,
  type DeclareOutbreak, type OutbreakEvent, type OutbreakFilters, type OutbreakSeverity, type OutbreakSignal, type OutbreakStatus,
  type RegistryDisease, type SentinelCase, type SentinelOutbreak,
} from '@/lib/supabase/sentinel';

const SEVERITIES: OutbreakSeverity[] = ['critical', 'high', 'moderate', 'low'];
const STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo',
  'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];
const STATUS_LABEL: Record<OutbreakStatus, string> = { active: 'Active', monitoring: 'Monitoring', resolved: 'Resolved', false_alarm: 'False alarm' };
const muted = 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';
const inputClass = 'sentinel-input rounded-xl px-3 py-2 text-sm';
const day = (iso: string | null) => (iso ? format(new Date(iso), 'd MMM yyyy') : '—');
const daysActive = (o: SentinelOutbreak) => (o.startDate ? differenceInCalendarDays(o.endDate ? new Date(o.endDate) : new Date(), new Date(o.startDate)) + 1 : 0);
const place = (o: { state: string; lga: string | null }) => `${o.lga ? `${o.lga}, ` : ''}${o.state}`;

function eventText(e: OutbreakEvent): string {
  const d = e.detail as Record<string, string | number | boolean | null>;
  switch (e.kind) {
    case 'declared': return `Outbreak declared (${d.severity})${d.description ? `: ${d.description}` : ''}`;
    case 'severity': return `Severity changed from ${d.from} to ${d.to}`;
    case 'status': return `Status changed from ${STATUS_LABEL[d.from as OutbreakStatus] ?? d.from} to ${STATUS_LABEL[d.to as OutbreakStatus] ?? d.to}${d.note ? `: ${d.note}` : ''}`;
    case 'response': return d.deployed ? 'Rapid response team deployed' : 'Response team stood down';
    case 'cases_linked': return `${d.count} matching case${d.count === 1 ? '' : 's'} linked`;
    case 'figures': return `Figures recorded before tracking updated (confirmed ${d.baseline_confirmed ?? '–'}, suspected ${d.baseline_suspected ?? '–'}, deaths ${d.baseline_deaths ?? '–'})`;
    case 'update': return String(d.text ?? '');
    default: return e.kind;
  }
}

// ---------------------------------------------------------------------------

function DeclareForm({ orgId, diseases, prefill, onDone }: {
  orgId: string; diseases: RegistryDisease[]; prefill: Partial<DeclareOutbreak> | null; onDone: (declared: boolean) => void;
}) {
  const [form, setForm] = useState<DeclareOutbreak>({
    disease: '', state: 'Lagos', lga: '', severity: 'moderate', startDate: new Date().toISOString().slice(0, 10), description: '',
    responseTeamDeployed: false, baselineConfirmed: 0, baselineSuspected: 0, baselineDeaths: 0, linkMatching: true, ...prefill,
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<DeclareOutbreak>) => setForm((f) => ({ ...f, ...patch }));
  const number = (v: string) => Math.max(0, Number.parseInt(v, 10) || 0);

  const submit = async () => {
    if (!form.disease) { toast.error('Choose the disease'); return; }
    if (form.baselineDeaths > form.baselineConfirmed + form.baselineSuspected && form.baselineConfirmed + form.baselineSuspected > 0) {
      toast.error('Deaths can\'t exceed the cases entered'); return;
    }
    setBusy(true);
    try {
      const result = await declareOutbreak(orgId, form);
      toast.success(`Outbreak declared${result.linked ? `; ${result.linked} matching case${result.linked === 1 ? '' : 's'} linked` : ''}. An alert has been raised.`);
      onDone(true);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Select value={form.disease} onChange={(e) => set({ disease: e.target.value })}>
          <option value="">Choose disease…</option>
          {diseases.filter((d) => d.category !== 'ncd').map((d) => <option key={d.id} value={d.id}>{d.name}{d.notifiable ? ' (notifiable)' : ''}</option>)}
        </Select>
        <Select value={form.severity} onChange={(e) => set({ severity: e.target.value as OutbreakSeverity })}>
          {SEVERITIES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)} severity</option>)}
        </Select>
        <Select value={form.state} onChange={(e) => set({ state: e.target.value })}>{STATES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <input className={inputClass} placeholder="LGA (leave blank for the whole state)" value={form.lga} onChange={(e) => set({ lga: e.target.value })} />
        <label className="text-xs text-slate-500 dark:text-slate-400">Start date (first case onset)
          <input className={`${inputClass} mt-1 w-full`} type="date" max={new Date().toISOString().slice(0, 10)} value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={form.responseTeamDeployed} onChange={(e) => set({ responseTeamDeployed: e.target.checked })} />Rapid response team deployed
        </label>
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Cases known before Sentinel tracking (optional)</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">From line lists or situation reports not entered case by case. Linked cases are added on top automatically.</p>
        <div className="mt-2 grid grid-cols-3 gap-3">
          <label className="text-xs text-slate-500 dark:text-slate-400">Confirmed<input className={`${inputClass} mt-1 w-full`} type="number" min={0} value={form.baselineConfirmed} onChange={(e) => set({ baselineConfirmed: number(e.target.value) })} /></label>
          <label className="text-xs text-slate-500 dark:text-slate-400">Suspected<input className={`${inputClass} mt-1 w-full`} type="number" min={0} value={form.baselineSuspected} onChange={(e) => set({ baselineSuspected: number(e.target.value) })} /></label>
          <label className="text-xs text-slate-500 dark:text-slate-400">Deaths<input className={`${inputClass} mt-1 w-full`} type="number" min={0} value={form.baselineDeaths} onChange={(e) => set({ baselineDeaths: number(e.target.value) })} /></label>
        </div>
      </div>
      <textarea className={`${inputClass} min-h-20 w-full`} placeholder="Description (what was observed, suspected source, initial actions)" value={form.description} onChange={(e) => set({ description: e.target.value })} />
      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={form.linkMatching} onChange={(e) => set({ linkMatching: e.target.checked })} />Link matching cases already in the registry (same disease and place)
      </label>
      <div className="flex justify-end gap-2">
        <Button className={muted} onClick={() => onDone(false)}>Cancel</Button>
        <Button disabled={busy} onClick={() => void submit()}>{busy ? 'Declaring…' : 'Declare outbreak'}</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function OutbreakDetail({ outbreak, canManage, canPost, onClose, onChanged }: {
  outbreak: SentinelOutbreak; canManage: boolean; canPost: boolean; onClose: () => void; onChanged: () => void;
}) {
  const { activeOrganization } = useSentinelStore();
  const [events, setEvents] = useState<OutbreakEvent[] | null>(null);
  const [cases, setCases] = useState<SentinelCase[] | null>(null);
  const [update, setUpdate] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [figures, setFigures] = useState({ c: outbreak.baselineConfirmed, s: outbreak.baselineSuspected, d: outbreak.baselineDeaths });
  const open = outbreak.status === 'active' || outbreak.status === 'monitoring';

  const load = useCallback(() => {
    listOutbreakEvents(outbreak.id).then(setEvents).catch(() => setEvents([]));
    if (activeOrganization) listCases(activeOrganization.id, { outbreakId: outbreak.id }, 0, 500).then((r) => setCases(r.cases)).catch(() => setCases([]));
  }, [outbreak.id, activeOrganization]);
  useEffect(() => { load(); }, [load]);

  const curve = useMemo(() => {
    if (!cases?.length) return [];
    const byDay = new Map<string, { date: string; confirmed: number; suspected: number }>();
    for (const c of cases) {
      const date = c.onsetDate ?? c.reportDate;
      const row = byDay.get(date) ?? { date, confirmed: 0, suspected: 0 };
      if (c.labConfirmed || c.status === 'confirmed') row.confirmed += 1; else row.suspected += 1;
      byDay.set(date, row);
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ ...r, label: format(new Date(r.date), 'd MMM') }));
  }, [cases]);

  const act = async (name: string, action: () => Promise<unknown>, success: string) => {
    setBusy(name);
    try { await action(); toast.success(success); load(); onChanged(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  };
  const close = (status: 'resolved' | 'false_alarm') => {
    const note = window.prompt(status === 'resolved' ? 'Why is this outbreak over? (e.g. 2 incubation periods without new cases)' : 'Why was this a false alarm?');
    if (note === null) return;
    void act('close', () => updateOutbreak(outbreak.id, { status, note }), status === 'resolved' ? 'Outbreak resolved' : 'Marked as false alarm');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={outbreak.severity}>{outbreak.severity}</Badge>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">{STATUS_LABEL[outbreak.status]}</span>
        <span className="text-sm text-slate-500 dark:text-slate-400">{place(outbreak)} · since {day(outbreak.startDate)}{outbreak.endDate ? ` · closed ${day(outbreak.endDate)}` : ` · day ${daysActive(outbreak)}`}</span>
      </div>
      {outbreak.description && <p className="text-sm text-slate-600 dark:text-slate-300">{outbreak.description}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[['Confirmed', outbreak.confirmed], ['Suspected', outbreak.suspected], ['Deaths', outbreak.deaths], ['CFR', outbreak.cfr === null ? '—' : `${outbreak.cfr}%`]].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900"><p className="text-xs text-slate-500 dark:text-slate-400">{label}</p><p className="text-xl font-bold text-slate-950 dark:text-slate-50">{value}</p></div>
        ))}
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {outbreak.linkedCases} linked case{outbreak.linkedCases === 1 ? '' : 's'}
        {outbreak.baselineConfirmed + outbreak.baselineSuspected + outbreak.baselineDeaths > 0 && ` + figures from before tracking (${outbreak.baselineConfirmed} confirmed, ${outbreak.baselineSuspected} suspected, ${outbreak.baselineDeaths} deaths)`}
      </p>

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-950 dark:text-slate-50">Epidemic curve (by symptom onset)</p>
        {cases === null ? <div className="h-48 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          : curve.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500 dark:border-slate-700">No linked cases yet.</p>
          : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={curve} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="#E8EAF0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis allowDecimals={false} stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={11} width={28} />
                  <Tooltip />
                  <Bar dataKey="confirmed" name="Confirmed" stackId="a" fill="#DC2626" />
                  <Bar dataKey="suspected" name="Suspected" stackId="a" fill="#F59E0B" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
      </div>

      {canManage && (
        <div className="space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
          <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">Manage</p>
          <div className="flex flex-wrap gap-2">
            <Select value={outbreak.severity} disabled={busy !== null} onChange={(e) => void act('severity', () => updateOutbreak(outbreak.id, { severity: e.target.value as OutbreakSeverity }), 'Severity updated')}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)} severity</option>)}
            </Select>
            <Button className={muted} disabled={busy !== null} onClick={() => void act('response', () => updateOutbreak(outbreak.id, { responseTeamDeployed: !outbreak.responseTeamDeployed }), outbreak.responseTeamDeployed ? 'Response team stood down' : 'Response team deployed')}>
              {outbreak.responseTeamDeployed ? 'Stand down response team' : 'Deploy response team'}
            </Button>
            {open && <Button className={muted} disabled={busy !== null} onClick={() => void act('link', async () => { const n = await linkMatchingCases(outbreak.id); if (!n) throw new Error('No new matching cases to link'); }, 'Matching cases linked')}><Link2 className="h-4 w-4" />Link matching cases</Button>}
          </div>
          <div className="flex flex-wrap gap-2">
            {outbreak.status === 'active' && <Button className={muted} disabled={busy !== null} onClick={() => void act('monitor', () => updateOutbreak(outbreak.id, { status: 'monitoring' }), 'Moved to monitoring')}>Move to monitoring</Button>}
            {outbreak.status === 'monitoring' && <Button className={muted} disabled={busy !== null} onClick={() => void act('reactivate', () => updateOutbreak(outbreak.id, { status: 'active' }), 'Outbreak reactivated')}>Reactivate</Button>}
            {open && <Button disabled={busy !== null} onClick={() => close('resolved')}>Resolve outbreak</Button>}
            {open && <Button className={muted} disabled={busy !== null} onClick={() => close('false_alarm')}>False alarm</Button>}
            {!open && <Button className={muted} disabled={busy !== null} onClick={() => void act('reopen', () => updateOutbreak(outbreak.id, { status: 'active', note: 'Reopened' }), 'Outbreak reopened')}>Reopen</Button>}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-600 dark:text-slate-300">Figures from before tracking</summary>
            <div className="mt-2 grid grid-cols-4 items-end gap-2">
              {(['c', 's', 'd'] as const).map((k) => (
                <label key={k} className="text-xs text-slate-500 dark:text-slate-400">{k === 'c' ? 'Confirmed' : k === 's' ? 'Suspected' : 'Deaths'}
                  <input className={`${inputClass} mt-1 w-full`} type="number" min={0} value={figures[k]} onChange={(e) => setFigures({ ...figures, [k]: Math.max(0, Number.parseInt(e.target.value, 10) || 0) })} />
                </label>
              ))}
              <Button disabled={busy !== null} onClick={() => void act('figures', () => updateOutbreak(outbreak.id, { baselineConfirmed: figures.c, baselineSuspected: figures.s, baselineDeaths: figures.d }), 'Figures updated')}>Save</Button>
            </div>
          </details>
        </div>
      )}

      {canPost && (
        <div>
          <textarea className={`${inputClass} min-h-20 w-full`} placeholder="Post a situation update (response activities, new findings, needs)" value={update} onChange={(e) => setUpdate(e.target.value)} />
          <div className="mt-2 flex justify-end"><Button disabled={busy !== null || !update.trim()} onClick={() => void act('update', async () => { await addOutbreakUpdate(outbreak.id, update); setUpdate(''); }, 'Update posted')}>Post update</Button></div>
        </div>
      )}

      <div>
        <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">History</p>
        {events === null ? <p className="mt-2 text-sm text-slate-500">Loading…</p> : (
          <ol className="mt-3 space-y-3 border-l border-slate-200 pl-4 text-sm dark:border-slate-700">
            {events.map((e) => (
              <li key={e.id}>
                <p className={e.kind === 'update' ? 'whitespace-pre-line rounded-lg bg-slate-50 p-2 text-slate-700 dark:bg-slate-900 dark:text-slate-200' : 'text-slate-700 dark:text-slate-200'}>{eventText(e)}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{e.actor ?? 'Sentinel'} · {formatDistanceToNow(new Date(e.at), { addSuffix: true })}</p>
              </li>
            ))}
          </ol>
        )}
      </div>

      {cases && cases.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-950 dark:text-slate-50">Linked cases ({cases.length})</p>
          <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-xs">
              <tbody>
                {cases.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                    <td className="px-3 py-2 font-mono text-blue-600 dark:text-blue-300">{c.reportId}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{c.lga ?? c.state}</td>
                    <td className="px-3 py-2 text-slate-500">{day(c.reportDate)}</td>
                    <td className="px-3 py-2"><Badge tone={c.status === 'deceased' || c.status === 'confirmed' ? 'critical' : c.status === 'recovered' ? 'low' : 'moderate'}>{c.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="flex justify-end"><Button className={muted} onClick={onClose}>Close</Button></div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function LiveOutbreaks() {
  const { activeOrganization, me, focus, clearFocus } = useSentinelStore();
  const orgId = activeOrganization?.id;
  const canManage = canManageOutbreaks(me?.role);
  const canPost = canEditCases(me?.role);
  const [filters, setFilters] = useState<OutbreakFilters>({ view: focus?.route === 'outbreaks' ? 'all' : 'open' });
  const [data, setData] = useState<{ key: string; outbreaks: SentinelOutbreak[] } | null>(null);
  const [signals, setSignals] = useState<OutbreakSignal[]>([]);
  const [diseases, setDiseases] = useState<RegistryDisease[]>([]);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(focus?.route === 'outbreaks' ? focus.id : null);
  const [declaring, setDeclaring] = useState<Partial<DeclareOutbreak> | null>(null);
  const [refresh, setRefresh] = useState(0);
  const key = JSON.stringify({ filters, refresh });

  // Opened from header search or the inbox (the outbreak may already be closed).
  const [openedFocus, setOpenedFocus] = useState(focus);
  if (focus?.route === 'outbreaks' && focus !== openedFocus) {
    setOpenedFocus(focus);
    setFilters({ view: 'all' });
    setSelectedId(focus.id);
  }
  useEffect(() => { if (focus?.route === 'outbreaks') clearFocus(); }, [focus, clearFocus]);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    listOutbreaks(orgId, filters)
      .then((outbreaks) => { if (alive) { setData({ key, outbreaks }); setError(''); } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Could not load outbreaks.'); });
    listOutbreakSignals(orgId).then((s) => { if (alive) setSignals(s); }).catch(() => undefined);
    return () => { alive = false; };
  }, [orgId, filters, key]);

  useEffect(() => { listDiseases().then(setDiseases).catch(() => undefined); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setRefresh((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const outbreaks = useMemo(() => data?.outbreaks ?? [], [data]);
  const loading = !data || data.key !== key;
  const selected = outbreaks.find((o) => o.id === selectedId) ?? null;
  const activeCount = outbreaks.filter((o) => o.status === 'active').length;
  const statesInUse = useMemo(() => [...new Set(outbreaks.map((o) => o.state))].sort(), [outbreaks]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-950 dark:text-slate-50">Outbreaks {activeCount > 0 && <Badge tone="critical">{activeCount} active</Badge>}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Declared outbreaks, their response, and possible outbreaks detected from incoming cases.</p>
        </div>
        {canManage && <Button onClick={() => setDeclaring({})}><Plus className="h-4 w-4" />Declare outbreak</Button>}
      </div>

      {signals.length > 0 && (
        <Card>
          <div className="mb-3 flex items-center gap-2"><Radar className="h-5 w-5 text-amber-500" /><h3 className="font-bold text-slate-950 dark:text-slate-50">Possible outbreaks detected</h3></div>
          <div className="space-y-2">
            {signals.map((s) => (
              <div key={`${s.diseaseId}-${s.state}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
                <div>
                  <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">{s.disease} · {s.lga ? `${s.lga}, ` : ''}{s.state}</p>
                  <p className="text-xs text-amber-800 dark:text-amber-200">{s.reason}. {s.thisWeek} case{s.thisWeek === 1 ? '' : 's'} this week{s.confirmed ? `, ${s.confirmed} confirmed` : ''}{s.deaths ? `, ${s.deaths} death${s.deaths === 1 ? '' : 's'}` : ''}.</p>
                </div>
                {canManage && (
                  <Button className="px-3 py-1.5 text-xs" onClick={() => setDeclaring({
                    disease: s.diseaseId, state: STATES.includes(s.state) ? s.state : 'Lagos', lga: s.lga ?? '', severity: s.severity,
                    startDate: s.firstOnset ?? undefined, description: `${s.reason}.`,
                  })}><AlertTriangle className="h-3.5 w-3.5" />Declare</Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <Select value={filters.view} onChange={(e) => setFilters({ ...filters, view: e.target.value as OutbreakFilters['view'] })}>
          <option value="open">Active and monitoring</option><option value="closed">Resolved and false alarms</option><option value="all">All outbreaks</option>
        </Select>
        <Select value={filters.diseaseId ?? ''} onChange={(e) => setFilters({ ...filters, diseaseId: e.target.value || undefined })}>
          <option value="">All diseases</option>{diseases.filter((d) => d.category !== 'ncd').map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <Select value={filters.state ?? ''} onChange={(e) => setFilters({ ...filters, state: e.target.value || undefined })}>
          <option value="">All states</option>{[...new Set([...statesInUse, ...(filters.state ? [filters.state] : [])])].map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Select value={filters.severity ?? ''} onChange={(e) => setFilters({ ...filters, severity: (e.target.value || undefined) as OutbreakSeverity | undefined })}>
          <option value="">All severities</option>{SEVERITIES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </Select>
      </div>

      {error && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      {!loading && outbreaks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          {filters.view === 'open' ? 'No active outbreaks.' : 'No outbreaks match these filters.'}
          {filters.view === 'open' && signals.length === 0 && ' Possible outbreaks appear here automatically when cases cluster or a notifiable disease is confirmed.'}
        </div>
      ) : (
        <div className={`grid gap-4 xl:grid-cols-2 ${loading ? 'opacity-60' : ''}`}>
          {outbreaks.map((o) => (
            <Card key={o.id} className={o.severity === 'critical' && o.status === 'active' ? 'border-red-300 dark:border-red-900' : ''}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold text-slate-950 dark:text-slate-50">{o.disease}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{place(o)} · {o.endDate ? `${daysActive(o)} days, closed ${day(o.endDate)}` : `day ${daysActive(o)}`}</p>
                </div>
                <div className="flex items-center gap-2">
                  {o.status !== 'active' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{STATUS_LABEL[o.status]}</span>}
                  <Badge tone={o.severity}>{o.severity}</Badge>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-4 gap-3 text-sm text-slate-500 dark:text-slate-400">
                <span>Confirmed <strong className="block text-slate-950 dark:text-slate-50">{o.confirmed}</strong></span>
                <span>Suspected <strong className="block text-slate-950 dark:text-slate-50">{o.suspected}</strong></span>
                <span>Deaths <strong className="block text-slate-950 dark:text-slate-50">{o.deaths}</strong></span>
                <span>CFR <strong className="block text-slate-950 dark:text-slate-50">{o.cfr === null ? '—' : `${o.cfr}%`}</strong></span>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <span className={`text-sm ${o.responseTeamDeployed ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300'}`}>
                  {o.responseTeamDeployed ? 'Response team deployed' : 'No response team deployed'} · updated {formatDistanceToNow(new Date(o.updatedAt), { addSuffix: true })}
                </span>
                <Button className="px-3 py-1.5 text-xs" onClick={() => setSelectedId(o.id)}>Open</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <Modal title={`${selected.disease} outbreak`} open onClose={() => setSelectedId(null)}>
          <OutbreakDetail key={selected.id + selected.updatedAt} outbreak={selected} canManage={canManage} canPost={canPost}
            onClose={() => setSelectedId(null)} onChanged={() => setRefresh((n) => n + 1)} />
        </Modal>
      )}
      {declaring && orgId && (
        <Modal title="Declare an outbreak" open onClose={() => setDeclaring(null)}>
          <DeclareForm orgId={orgId} diseases={diseases} prefill={declaring} onDone={(declared) => { setDeclaring(null); if (declared) setRefresh((n) => n + 1); }} />
        </Modal>
      )}
    </div>
  );
}

