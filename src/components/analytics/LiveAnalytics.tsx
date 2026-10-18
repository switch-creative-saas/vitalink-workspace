// Analytics for live workspaces: every figure comes from analytics_overview(),
// computed from this workspace's appointments, invoices, payments, lab orders,
// prescriptions and HMO claims. Each role only receives its own sections.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowUpRight, Calendar, Clock3, CreditCard, Download, FlaskConical, Lightbulb, Pill, RefreshCw, ShieldCheck, Users,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { getAnalyticsOverview, type AnalyticsOverview, type AnalyticsRange } from '@/lib/supabase/analytics';

const RANGES: Array<{ id: AnalyticsRange; label: string; prev: string }> = [
  { id: '24h', label: '24h', prev: 'previous 24 hours' },
  { id: '7d', label: '7 days', prev: 'previous 7 days' },
  { id: '30d', label: '30 days', prev: 'previous 30 days' },
  { id: '90d', label: '90 days', prev: 'previous 90 days' },
];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = [6, 8, 10, 12, 14, 16, 18, 20];
const CATEGORY = { consultation: { label: 'Consultation', color: '#4F46E5' }, lab: { label: 'Laboratory', color: '#7C3AED' }, pharmacy: { label: 'Pharmacy', color: '#059669' } } as Record<string, { label: string; color: string }>;
const AXIS = { fontSize: 11, fill: '#94A3B8' };

const naira = (v: number) => `₦${v.toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

function bucketLabel(iso: string, range: AnalyticsRange) {
  const d = new Date(iso);
  if (range === '24h') return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
  if (range === '7d') return d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Africa/Lagos' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
}

export function LiveAnalytics() {
  const { organization, currentRole } = useAuth();
  const storageKey = `vitalink-analytics-range:${currentRole}`;
  const [range, setRange] = useState<AnalyticsRange>(() => {
    try { const saved = localStorage.getItem(storageKey); return RANGES.some((r) => r.id === saved) ? (saved as AnalyticsRange) : '7d'; } catch { return '7d'; }
  });
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    getAnalyticsOverview(organization.id, range)
      .then((result) => { setData(result); setLoading(false); })
      .catch((error) => { toast.error(error instanceof Error ? error.message : 'Could not load analytics'); setLoading(false); });
  }, [organization.id, range]);

  useEffect(() => { load(); }, [load]);
  const pickRange = (next: AnalyticsRange) => {
    setLoading(true);
    setRange(next);
    try { localStorage.setItem(storageKey, next); } catch { /* not essential */ }
  };

  const prevLabel = RANGES.find((r) => r.id === range)?.prev ?? 'previous period';
  const trend = useMemo(() => (data?.trend ?? []).map((t) => ({ ...t, label: bucketLabel(t.at, range) })), [data, range]);
  const highlights = useMemo(() => (data ? buildHighlights(data, prevLabel) : []), [data, prevLabel]);

  const exportCsv = () => {
    if (!data) return;
    const rows: string[][] = [['VitaLink analytics', organization.name], ['From', data.from], ['To', data.to], []];
    const add = (section: string, entries: Array<[string, string | number | null]>) => {
      rows.push([section]);
      entries.forEach(([k, v]) => rows.push([k, v == null ? '' : String(v)]));
      rows.push([]);
    };
    if (data.patients) add('Patients', [['Registered (total)', data.patients.total], ['New in period', data.patients.new], ['Seen in period', data.patients.seen], ['Returning', data.patients.returning]]);
    if (data.appointments) add('Appointments', [['Total', data.appointments.total], ['Completed', data.appointments.completed], ['No-shows', data.appointments.noShow], ['Cancelled', data.appointments.cancelled], ['Avg wait (min)', data.appointments.avgWaitMin]]);
    if (data.revenue) add('Revenue (NGN)', [['Collected', data.revenue.collected], ['Invoiced', data.revenue.invoiced], ['Outstanding', data.revenue.outstanding], ['Overdue', data.revenue.overdue], ...Object.entries(data.revenue.byCategory).map(([k, v]) => [`Invoiced: ${CATEGORY[k]?.label ?? k}`, v] as [string, number])]);
    if (data.lab) add('Laboratory', [['Orders', data.lab.orders], ['Completed', data.lab.completed], ['Open', data.lab.open], ['Critical', data.lab.critical], ['Avg turnaround (h)', data.lab.avgTurnaroundH]]);
    if (data.pharmacy) add('Pharmacy', [['Dispensed', data.pharmacy.dispensed], ['Awaiting', data.pharmacy.awaiting], ['Low stock items', data.pharmacy.lowStock], ['Expiring in 60 days', data.pharmacy.expiring60d], ['Expired in stock', data.pharmacy.expired]]);
    if (data.insurance) add('HMO claims', [['Submitted', data.insurance.submitted], ['Approved', data.insurance.approved], ['Rejected', data.insurance.rejected], ['Pending', data.insurance.pending], ['Claimed (NGN)', data.insurance.claimed]]);
    if (data.departments?.length) {
      rows.push(['Departments'], ['Department', 'Appointments', 'Completed', 'No-shows', 'Patients', 'Avg wait (min)']);
      data.departments.forEach((d) => rows.push([d.department, String(d.appointments), String(d.completed), String(d.noShow), String(d.patients), d.avgWaitMin == null ? '' : String(d.avgWaitMin)]));
      rows.push([]);
    }
    rows.push(['Trend'], ['Period', 'New patients', 'Appointments', 'Revenue collected (NGN)']);
    trend.forEach((t) => rows.push([t.label, String(t.newPatients ?? ''), String(t.appointments ?? ''), String(t.revenue ?? '')]));
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `vitalink-analytics-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const cards = data ? buildCards(data) : [];
  const nothingYet = data && cards.every((c) => !c.raw);

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Analytics</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">How {organization.name} is doing, from your own records. Compared with the {prevLabel}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900/60">
            {RANGES.map((r) => (
              <button key={r.id} type="button" onClick={() => pickRange(r.id)}
                className={cn('rounded-md px-3 py-1.5 text-sm', range === r.id ? 'bg-white font-medium text-royal-700 shadow-sm dark:bg-slate-800 dark:text-white' : 'text-slate-500 dark:text-slate-400')}>
                {r.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={load} aria-label="Refresh"><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /></Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!data}><Download className="mr-1 h-4 w-4" />Export CSV</Button>
        </div>
      </header>

      {!data && loading && <p className="text-sm text-slate-500">Loading analytics...</p>}

      {data && (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {cards.map((c) => (
              <div key={c.label} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/80">
                <div className="flex items-center justify-between">
                  <c.icon className="h-4 w-4 text-royal-600" />
                  {c.delta != null && (
                    <span className={cn('flex items-center text-[11px] font-medium', c.delta >= 0 === !c.lowerIsBetter ? 'text-emerald-600' : 'text-red-600')}>
                      {c.delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(c.delta)}%
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xl font-bold tabular-nums text-slate-900 dark:text-slate-50">{c.value}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{c.label}</p>
                {c.hint && <p className="mt-0.5 text-[11px] text-slate-400">{c.hint}</p>}
              </div>
            ))}
          </section>

          {nothingYet && (
            <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
              Nothing recorded in this period yet. Figures appear as you book appointments, raise invoices, order labs and dispense.
            </div>
          )}

          {highlights.length > 0 && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/80">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-50"><Lightbulb className="h-4 w-4 text-amber-500" />Highlights</h3>
              <ul className="grid gap-2 text-sm text-slate-700 md:grid-cols-2 dark:text-slate-300">
                {highlights.map((h) => <li key={h} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-900/50">{h}</li>)}
              </ul>
            </section>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {(data.appointments || data.patients) && (
              <Panel title="Activity" subtitle={range === '24h' ? 'Every 3 hours' : range === '90d' ? 'Weekly' : 'Daily'}>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                      <XAxis dataKey="label" tick={AXIS} interval="preserveStartEnd" />
                      <YAxis allowDecimals={false} tick={AXIS} width={30} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {data.appointments && <Line type="monotone" dataKey="appointments" name="Appointments" stroke="#4F46E5" strokeWidth={2} dot={false} isAnimationActive={false} />}
                      {data.patients && <Line type="monotone" dataKey="newPatients" name="New patients" stroke="#059669" strokeWidth={2} dot={false} isAnimationActive={false} />}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            )}

            {data.revenue && (
              <Panel title="Payments received" subtitle={`${naira(data.revenue.collected)} in this period`}>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trend}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                      <XAxis dataKey="label" tick={AXIS} interval="preserveStartEnd" />
                      <YAxis tick={AXIS} width={60} tickFormatter={(v: number) => (v >= 1000 ? `₦${Math.round(v / 1000)}k` : `₦${v}`)} />
                      <Tooltip formatter={(v: number) => naira(v)} />
                      <Area type="monotone" dataKey="revenue" name="Received" stroke="#4F46E5" fill="#6366F133" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            )}

            {data.revenue && (
              <Panel title="Invoiced by service" subtitle={`${naira(data.revenue.invoiced)} invoiced · ${naira(data.revenue.outstanding)} outstanding${data.revenue.overdue ? ` · ${naira(data.revenue.overdue)} overdue` : ''}`}>
                {Object.keys(data.revenue.byCategory).length === 0 ? <Empty text="No invoices in this period." /> : (
                  <div className="flex flex-col items-center gap-3 sm:flex-row">
                    <div className="h-48 w-48 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={Object.entries(data.revenue.byCategory).map(([k, v]) => ({ name: CATEGORY[k]?.label ?? k, value: v, key: k }))} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} isAnimationActive={false}>
                            {Object.keys(data.revenue.byCategory).map((k) => <Cell key={k} fill={CATEGORY[k]?.color ?? '#94A3B8'} />)}
                          </Pie>
                          <Tooltip formatter={(v: number) => naira(v)} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <ul className="w-full space-y-1.5 text-sm">
                      {Object.entries(data.revenue.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                        <li key={k} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY[k]?.color ?? '#94A3B8' }} />{CATEGORY[k]?.label ?? k}</span>
                          <span className="tabular-nums">{naira(v)} <span className="text-xs text-slate-400">({pct(v, data.revenue!.invoiced)}%)</span></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Panel>
            )}

            {data.appointments && (
              <Panel title="When patients come" subtitle="Appointments by day and time (Lagos time)">
                <Heatmap cells={data.appointments.heatmap} />
              </Panel>
            )}
          </div>

          {data.departments && (
            <Panel title="Departments" subtitle="Appointments in this period">
              {data.departments.length === 0 ? <Empty text="No appointments in this period." /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-slate-500">
                      <tr><th className="py-2 pr-3">Department</th><th className="py-2 pr-3">Appointments</th><th className="py-2 pr-3">Completed</th><th className="py-2 pr-3">No-shows</th><th className="py-2 pr-3">Patients</th><th className="py-2">Avg wait</th></tr>
                    </thead>
                    <tbody>
                      {data.departments.map((d) => (
                        <tr key={d.department} className="border-t border-slate-100 dark:border-slate-700">
                          <td className="py-2 pr-3 font-medium">{d.department}</td>
                          <td className="py-2 pr-3 tabular-nums">{d.appointments}</td>
                          <td className="py-2 pr-3 tabular-nums">{d.completed} <span className="text-xs text-slate-400">({pct(d.completed, d.appointments)}%)</span></td>
                          <td className="py-2 pr-3 tabular-nums">{d.noShow}</td>
                          <td className="py-2 pr-3 tabular-nums">{d.patients}</td>
                          <td className="py-2 tabular-nums">{d.avgWaitMin == null ? '—' : `${d.avgWaitMin} min`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            {data.lab && (
              <Panel title="Laboratory" icon={FlaskConical}>
                <Stats rows={[
                  ['Orders', data.lab.orders], ['Completed', data.lab.completed], ['Still open', data.lab.open],
                  ['Critical', data.lab.critical], ['Abnormal results', data.lab.abnormal],
                  ['Avg turnaround', data.lab.avgTurnaroundH == null ? '—' : `${data.lab.avgTurnaroundH} h`],
                ]} />
                <TopList title="Most ordered tests" items={data.lab.topTests} />
              </Panel>
            )}
            {data.pharmacy && (
              <Panel title="Pharmacy" icon={Pill}>
                <Stats rows={[
                  ['Dispensed', data.pharmacy.dispensed], ['Awaiting dispensing', data.pharmacy.awaiting], ['Pharmacy invoiced', naira(data.pharmacy.revenue)],
                  ['Low stock items', data.pharmacy.lowStock], ['Expiring in 60 days', data.pharmacy.expiring60d], ['Expired, still in stock', data.pharmacy.expired],
                ]} />
                <TopList title="Most dispensed" items={data.pharmacy.topDrugs} />
              </Panel>
            )}
            {data.insurance && (
              <Panel title="HMO claims" icon={ShieldCheck}>
                <Stats rows={[
                  ['Submitted', data.insurance.submitted], ['Approved', data.insurance.approved], ['Rejected', data.insurance.rejected],
                  ['Pending', data.insurance.pending], ['Approval rate', data.insurance.approved + data.insurance.rejected ? `${pct(data.insurance.approved, data.insurance.approved + data.insurance.rejected)}%` : '—'],
                  ['Claimed', naira(data.insurance.claimed)], ['Approved amount', naira(data.insurance.approvedAmount)],
                  ['Avg decision time', data.insurance.avgDays == null ? '—' : `${data.insurance.avgDays} days`],
                ]} />
              </Panel>
            )}
          </div>
        </>
      )}
    </div>
  );
}

type Card = { label: string; value: string; raw: number; icon: React.ElementType; delta?: number | null; hint?: string; lowerIsBetter?: boolean };

function buildCards(d: AnalyticsOverview): Card[] {
  const cards: Card[] = [];
  if (d.patients) {
    cards.push({ label: 'New patients', value: String(d.patients.new), raw: d.patients.new, icon: Users, delta: change(d.patients.new, d.patients.newPrev), hint: `${d.patients.total} registered in total` });
    cards.push({ label: 'Patients seen', value: String(d.patients.seen), raw: d.patients.seen, icon: Activity, hint: d.patients.seen ? `${pct(d.patients.returning, d.patients.seen)}% returning` : undefined });
  }
  if (d.appointments) {
    const a = d.appointments;
    cards.push({ label: 'Appointments', value: String(a.total), raw: a.total, icon: Calendar, delta: change(a.total, a.totalPrev), hint: `${a.completed} completed` });
    cards.push({ label: 'No-show rate', value: a.total ? `${pct(a.noShow, a.total)}%` : '—', raw: a.noShow, icon: Calendar, lowerIsBetter: true, hint: `${a.noShow} no-show${a.noShow === 1 ? '' : 's'}` });
    cards.push({ label: 'Average wait', value: a.avgWaitMin == null ? '—' : `${a.avgWaitMin} min`, raw: a.avgWaitMin ?? 0, icon: Clock3, hint: 'check-in to consultation' });
  }
  if (d.revenue) {
    cards.push({ label: 'Payments received', value: naira(d.revenue.collected), raw: d.revenue.collected, icon: CreditCard, delta: change(d.revenue.collected, d.revenue.collectedPrev) });
    cards.push({ label: 'Outstanding', value: naira(d.revenue.outstanding), raw: d.revenue.outstanding, icon: CreditCard, hint: d.revenue.overdue ? `${naira(d.revenue.overdue)} overdue` : 'nothing overdue' });
  }
  if (d.lab) cards.push({ label: 'Lab orders', value: String(d.lab.orders), raw: d.lab.orders, icon: FlaskConical, hint: `${d.lab.open} open · ${d.lab.critical} critical` });
  if (d.pharmacy) cards.push({ label: 'Dispensed', value: String(d.pharmacy.dispensed), raw: d.pharmacy.dispensed, icon: Pill, hint: `${d.pharmacy.awaiting} awaiting` });
  if (d.insurance) cards.push({ label: 'HMO claims', value: String(d.insurance.submitted), raw: d.insurance.submitted, icon: ShieldCheck, hint: `${d.insurance.approved} approved` });
  return cards;
}

// Plain statements derived from the figures; only shown when there's enough data to mean something.
function buildHighlights(d: AnalyticsOverview, prevLabel: string): string[] {
  const out: string[] = [];
  const trendLine = (label: string, now: number, before: number) => {
    const c = change(now, before);
    if (c != null && Math.abs(c) >= 10 && now + before >= 5) out.push(`${label} ${c > 0 ? 'up' : 'down'} ${Math.abs(c)}% on the ${prevLabel} (${now} vs ${before}).`);
  };
  if (d.appointments) trendLine('Appointments', d.appointments.total, d.appointments.totalPrev);
  if (d.patients) trendLine('New patient registrations', d.patients.new, d.patients.newPrev);
  if (d.revenue) {
    const c = change(d.revenue.collected, d.revenue.collectedPrev);
    if (c != null && Math.abs(c) >= 10) out.push(`Payments received ${c > 0 ? 'up' : 'down'} ${Math.abs(c)}% on the ${prevLabel}.`);
    if (d.revenue.overdue > 0) out.push(`${naira(d.revenue.overdue)} is overdue. Follow up from Billing.`);
  }
  if (d.appointments) {
    const worst = [...d.appointments.noShowByDow].filter((x) => x.total >= 5).sort((a, b) => b.rate - a.rate)[0];
    if (worst && worst.rate >= 15) out.push(`No-shows are highest on ${DAYS[worst.dow - 1]}s (${worst.rate}%). Reminders the day before can help.`);
    const busiest = [...d.appointments.heatmap].sort((a, b) => b.count - a.count)[0];
    if (busiest && busiest.count >= 3) out.push(`Busiest time: ${DAYS[busiest.dow - 1]} ${String(busiest.hour).padStart(2, '0')}:00–${String(busiest.hour + 2).padStart(2, '0')}:00 (${busiest.count} appointments).`);
    if (d.appointments.avgWaitMin != null && d.appointments.avgWaitMin >= 30) out.push(`Patients wait ${d.appointments.avgWaitMin} minutes on average between check-in and consultation.`);
  }
  if (d.lab && d.lab.critical > 0) out.push(`${d.lab.critical} critical lab order${d.lab.critical === 1 ? '' : 's'} in this period.`);
  if (d.pharmacy) {
    if (d.pharmacy.expired > 0) out.push(`${d.pharmacy.expired} expired item${d.pharmacy.expired === 1 ? ' is' : 's are'} still in stock. Remove from dispensing.`);
    if (d.pharmacy.lowStock > 0) out.push(`${d.pharmacy.lowStock} medicine${d.pharmacy.lowStock === 1 ? ' is' : 's are'} at or below reorder level.`);
  }
  if (d.insurance && d.insurance.pending > 0) out.push(`${d.insurance.pending} HMO claim${d.insurance.pending === 1 ? ' is' : 's are'} awaiting a decision.`);
  return out.slice(0, 6);
}

function Panel({ title, subtitle, icon: Icon, children }: { title: string; subtitle?: string; icon?: React.ElementType; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800/80">
      <div className="mb-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-50">{Icon && <Icon className="h-4 w-4 text-royal-600" />}{title}</h3>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function Stats({ rows }: { rows: Array<[string, string | number]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
      {rows.map(([k, v]) => <div key={k}><dt className="text-xs text-slate-500 dark:text-slate-400">{k}</dt><dd className="font-semibold tabular-nums text-slate-900 dark:text-slate-50">{v}</dd></div>)}
    </dl>
  );
}

function TopList({ title, items }: { title: string; items: Array<{ name: string; count: number }> }) {
  if (!items.length) return null;
  const max = Math.max(...items.map((i) => i.count));
  return (
    <div className="mt-4">
      <p className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">{title}</p>
      <ul className="space-y-1.5 text-sm">
        {items.map((i) => (
          <li key={i.name}>
            <div className="flex justify-between gap-2"><span className="truncate">{i.name}</span><span className="tabular-nums text-slate-500">{i.count}</span></div>
            <div className="mt-0.5 h-1.5 rounded-full bg-slate-100 dark:bg-slate-900/60"><div className="h-1.5 rounded-full bg-royal-500" style={{ width: `${(i.count / max) * 100}%` }} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Heatmap({ cells }: { cells: Array<{ dow: number; hour: number; count: number }> }) {
  const max = Math.max(1, ...cells.map((c) => c.count));
  const at = (dow: number, hour: number) => cells.find((c) => c.dow === dow && c.hour === hour)?.count ?? 0;
  if (!cells.length) return <Empty text="No appointments in this period." />;
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[420px] gap-1 text-[11px]" style={{ gridTemplateColumns: `40px repeat(${HOURS.length}, minmax(0, 1fr))` }}>
        <span />
        {HOURS.map((h) => <span key={h} className="text-center text-slate-400">{String(h).padStart(2, '0')}</span>)}
        {DAYS.map((day, i) => (
          <div key={day} className="contents">
            <span className="self-center text-slate-500">{day}</span>
            {HOURS.map((h) => {
              const v = at(i + 1, h);
              return (
                <div key={h} title={`${day} ${String(h).padStart(2, '0')}:00–${String(h + 2).padStart(2, '0')}:00 · ${v}`}
                  className={cn('flex h-7 items-center justify-center rounded', v ? 'text-white' : 'bg-slate-100 text-slate-300 dark:bg-slate-900/60 dark:text-slate-600')}
                  style={v ? { backgroundColor: `rgba(79,70,229,${0.25 + (v / max) * 0.7})` } : undefined}>
                  {v || ''}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500 dark:bg-slate-900/50">{text}</p>;
}
