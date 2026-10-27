// Alerts on live Supabase data: raised automatically from cases, outbreaks and facility
// reporting, or issued by officers as bulletins. Updates arrive in real time.
import { useCallback, useEffect, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { Activity, AlertTriangle, Bell, Building2, CheckCircle2, FlaskConical, Megaphone, Plus, Skull, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { SBadge as Badge } from '@/components/standalone/SBadge';
import { SButton as Button } from '@/components/standalone/SButton';
import { SSelect as Select } from '@/components/standalone/SSelect';
import { Modal } from '@/components/ui/Modal';
import { useSentinelStore } from '@/store/useSentinelStore';
import {
  canEditCases, canManageOutbreaks, countAlerts, createAlert, listAlerts, listDiseases, listOpenOutbreaks, setAlertStatus, subscribeToAlerts,
  type AlertFilters, type AlertStatus, type AlertType, type NewAlert, type OutbreakOption, type OutbreakSeverity, type RegistryDisease, type SentinelAlert,
} from '@/lib/supabase/sentinel';

const TYPES: Record<AlertType, { label: string; icon: React.ElementType }> = {
  lab_notification: { label: 'Confirmed case', icon: FlaskConical },
  cfr_spike: { label: 'Death / fatality rate', icon: Skull },
  unusual_cluster: { label: 'Unusual rise', icon: TrendingUp },
  facility_not_reporting: { label: 'Facility not reporting', icon: Building2 },
  new_outbreak: { label: 'Outbreak declared', icon: AlertTriangle },
  outbreak_threshold: { label: 'Outbreak threshold', icon: Activity },
  bulletin: { label: 'Bulletin', icon: Megaphone },
};
const SEVERITIES: OutbreakSeverity[] = ['critical', 'high', 'moderate', 'low'];
const TABS: Array<{ status: AlertStatus; label: string }> = [
  { status: 'open', label: 'Open' }, { status: 'acknowledged', label: 'Acknowledged' }, { status: 'resolved', label: 'Resolved' },
];
const STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo',
  'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];
const muted = 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';
const inputClass = 'sentinel-input rounded-xl px-3 py-2 text-sm';
const when = (iso: string) => `${formatDistanceToNow(new Date(iso), { addSuffix: true })} · ${format(new Date(iso), 'd MMM, HH:mm')}`;

function NewAlertForm({ orgId, diseases, outbreaks, onDone }: { orgId: string; diseases: RegistryDisease[]; outbreaks: OutbreakOption[]; onDone: (created: boolean) => void }) {
  const [form, setForm] = useState<NewAlert>({ type: 'bulletin', severity: 'moderate', title: '', message: '', state: '', lga: '', disease: '', outbreakId: '' });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<NewAlert>) => setForm((f) => ({ ...f, ...patch }));
  const submit = async () => {
    if (!form.title.trim()) { toast.error('Give the alert a title'); return; }
    setBusy(true);
    try { await createAlert(orgId, form); toast.success('Alert issued'); onDone(true); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Select value={form.type} onChange={(e) => set({ type: e.target.value as NewAlert['type'] })}>
          <option value="bulletin">Bulletin / advisory</option><option value="unusual_cluster">Unusual rise</option><option value="outbreak_threshold">Outbreak threshold reached</option>
          <option value="lab_notification">Confirmed case</option><option value="cfr_spike">Death / fatality rate</option><option value="facility_not_reporting">Facility not reporting</option>
        </Select>
        <Select value={form.severity} onChange={(e) => set({ severity: e.target.value as OutbreakSeverity })}>{SEVERITIES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)} severity</option>)}</Select>
        <input className={`${inputClass} md:col-span-2`} placeholder="Title" value={form.title} onChange={(e) => set({ title: e.target.value })} />
        <Select value={form.state} onChange={(e) => set({ state: e.target.value })}><option value="">Nationwide / no specific state</option>{STATES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <input className={inputClass} placeholder="LGA (optional)" value={form.lga} onChange={(e) => set({ lga: e.target.value })} />
        <Select value={form.disease} onChange={(e) => set({ disease: e.target.value })}><option value="">No specific disease</option>{diseases.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
        <Select value={form.outbreakId} onChange={(e) => set({ outbreakId: e.target.value })}><option value="">Not about an outbreak</option>{outbreaks.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</Select>
      </div>
      <textarea className={`${inputClass} min-h-28 w-full`} placeholder="Message: what happened, what people should do" value={form.message} onChange={(e) => set({ message: e.target.value })} />
      <div className="flex justify-end gap-2">
        <Button className={muted} onClick={() => onDone(false)}>Cancel</Button>
        <Button disabled={busy} onClick={() => void submit()}>{busy ? 'Issuing…' : 'Issue alert'}</Button>
      </div>
    </div>
  );
}

function AlertCard({ alert, canAct, onChanged }: { alert: SentinelAlert; canAct: boolean; onChanged: () => void }) {
  const { navigate } = useSentinelStore();
  const [busy, setBusy] = useState(false);
  const Icon = TYPES[alert.type]?.icon ?? Bell;
  const move = async (status: AlertStatus, ask?: string) => {
    let note: string | undefined;
    if (ask) { const answer = window.prompt(ask); if (answer === null) return; note = answer; }
    setBusy(true);
    try { await setAlertStatus(alert.id, status, note); onChanged(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const tone = alert.severity === 'critical' ? 'border-red-300 dark:border-red-900' : alert.severity === 'high' ? 'border-orange-200 dark:border-orange-900/60' : 'border-slate-200 dark:border-slate-800';

  return (
    <div className={`rounded-2xl border bg-white p-4 dark:bg-slate-900 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"><Icon className="h-4 w-4" /></div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={alert.severity}>{alert.severity}</Badge>
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{TYPES[alert.type]?.label ?? alert.type}</span>
              {alert.source === 'manual' && <span className="text-xs text-slate-400">· issued by {alert.createdBy ?? 'an officer'}</span>}
            </div>
            <p className="mt-1 font-semibold text-slate-950 dark:text-slate-50">{alert.title}</p>
            {alert.message && <p className="mt-1 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">{alert.message}</p>}
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {[alert.disease, alert.lga ? `${alert.lga}, ${alert.state}` : alert.state].filter(Boolean).join(' · ')}{alert.disease || alert.state ? ' · ' : ''}{when(alert.createdAt)}
            </p>
            {alert.acknowledgedBy && <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">Acknowledged by {alert.acknowledgedBy}{alert.acknowledgedAt ? ` ${formatDistanceToNow(new Date(alert.acknowledgedAt), { addSuffix: true })}` : ''}{alert.acknowledgedNote ? `: ${alert.acknowledgedNote}` : ''}</p>}
            {alert.resolvedBy && <p className="mt-0.5 text-xs text-emerald-700 dark:text-emerald-300">Resolved by {alert.resolvedBy}{alert.resolvedAt ? ` ${formatDistanceToNow(new Date(alert.resolvedAt), { addSuffix: true })}` : ''}{alert.resolvedNote ? `: ${alert.resolvedNote}` : ''}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {alert.outbreakId && <Button className={`${muted} px-3 py-1.5 text-xs`} onClick={() => navigate('outbreaks')}>Outbreak</Button>}
          {alert.caseId && <Button className={`${muted} px-3 py-1.5 text-xs`} onClick={() => navigate('cases')}>Cases</Button>}
          {alert.type === 'facility_not_reporting' && <Button className={`${muted} px-3 py-1.5 text-xs`} onClick={() => navigate('facilities')}>Facilities</Button>}
          {canAct && alert.status === 'open' && <Button className="px-3 py-1.5 text-xs" disabled={busy} onClick={() => void move('acknowledged', 'Acknowledge: any note on what you are doing? (optional)')}>Acknowledge</Button>}
          {canAct && alert.status !== 'resolved' && <Button className={`${muted} px-3 py-1.5 text-xs`} disabled={busy} onClick={() => void move('resolved', 'How was this resolved? (optional)')}><CheckCircle2 className="h-3.5 w-3.5" />Resolve</Button>}
          {canAct && alert.status !== 'open' && <Button className={`${muted} px-3 py-1.5 text-xs`} disabled={busy} onClick={() => void move('open')}>Reopen</Button>}
        </div>
      </div>
    </div>
  );
}

export function LiveAlerts() {
  const { activeOrganization, me } = useSentinelStore();
  const orgId = activeOrganization?.id;
  const canAct = canEditCases(me?.role);
  const canIssue = canManageOutbreaks(me?.role);
  const [filters, setFilters] = useState<AlertFilters>({ status: 'open' });
  const [alerts, setAlerts] = useState<SentinelAlert[] | null>(null);
  const [counts, setCounts] = useState<Record<AlertStatus, number> | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [diseases, setDiseases] = useState<RegistryDisease[]>([]);
  const [outbreaks, setOutbreaks] = useState<OutbreakOption[]>([]);
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    Promise.all([listAlerts(orgId, filters), countAlerts(orgId)])
      .then(([list, c]) => { if (alive) { setAlerts(list); setCounts(c); setError(''); } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Could not load alerts.'); });
    return () => { alive = false; };
  }, [orgId, filters, refresh]);

  // Anything raised or changed elsewhere (other officers, the case pipeline) shows up straight away.
  useEffect(() => (orgId ? subscribeToAlerts(orgId, reload) : undefined), [orgId, reload]);

  useEffect(() => {
    if (!orgId || !creating) return;
    void Promise.all([listDiseases(), listOpenOutbreaks(orgId)]).then(([d, o]) => { setDiseases(d); setOutbreaks(o); }).catch(() => undefined);
  }, [orgId, creating]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-950 dark:text-slate-50">Alerts</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Raised automatically from cases, outbreaks and facility reporting, or issued by your officers.</p>
        </div>
        {canIssue && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Issue alert</Button>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {TABS.map((t) => (
            <button key={t.status} type="button" onClick={() => setFilters({ ...filters, status: t.status })}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${filters.status === t.status ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
              {t.label}{counts ? ` (${counts[t.status]})` : ''}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Select value={filters.severity ?? ''} onChange={(e) => setFilters({ ...filters, severity: (e.target.value || undefined) as OutbreakSeverity | undefined })}>
            <option value="">All severities</option>{SEVERITIES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </Select>
          <Select value={filters.type ?? ''} onChange={(e) => setFilters({ ...filters, type: (e.target.value || undefined) as AlertType | undefined })}>
            <option value="">All types</option>{(Object.keys(TYPES) as AlertType[]).map((t) => <option key={t} value={t}>{TYPES[t].label}</option>)}
          </Select>
        </div>
      </div>

      {error && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      {alerts === null ? <div className="h-40 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
        : alerts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {filters.status === 'open'
              ? 'No open alerts. Sentinel raises one when a notifiable disease is confirmed, a death is reported, cases rise unusually, an outbreak is declared or a facility stops reporting.'
              : 'Nothing here yet.'}
          </div>
        ) : (
          <div className="space-y-3">{alerts.map((a) => <AlertCard key={a.id} alert={a} canAct={canAct} onChanged={reload} />)}</div>
        )}

      {creating && orgId && (
        <Modal title="Issue an alert" open onClose={() => setCreating(false)}>
          <NewAlertForm orgId={orgId} diseases={diseases} outbreaks={outbreaks} onDone={(created) => { setCreating(false); if (created) reload(); }} />
        </Modal>
      )}
    </div>
  );
}
