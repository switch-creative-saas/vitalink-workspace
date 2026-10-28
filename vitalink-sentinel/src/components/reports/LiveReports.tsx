// Surveillance reports on live Supabase data (sentinel_report): the weekly epidemiological
// report by ISO epi week, disease trends, NTD reports, outbreak situation reports and custom
// periods. Export as CSV, or print / save as PDF.
import { useEffect, useMemo, useState } from 'react';
import { addDays, endOfISOWeek, format, getISOWeek, getISOWeekYear, startOfISOWeek, subDays, subWeeks } from 'date-fns';
import { Download, Printer } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { SBadge as Badge } from '@/components/standalone/SBadge';
import { SButton as Button } from '@/components/standalone/SButton';
import { SSelect as Select } from '@/components/standalone/SSelect';
import { DataTable } from '@/components/ui/DataTable';
import { useSentinelStore } from '@/store/useSentinelStore';
import { getSurveillanceReport, listDiseases, type RegistryDisease, type SurveillanceReport } from '@/lib/supabase/sentinel';

type ReportKind = 'weekly' | 'trends' | 'ntd' | 'outbreaks' | 'custom';
const KINDS: Array<{ id: ReportKind; label: string }> = [
  { id: 'weekly', label: 'Weekly epidemiological report' }, { id: 'trends', label: 'Disease trends' }, { id: 'ntd', label: 'NTD report' },
  { id: 'outbreaks', label: 'Outbreak situation report' }, { id: 'custom', label: 'Custom' },
];
const COLORS = ['#2563EB', '#DC2626', '#16A34A', '#F59E0B', '#7C3AED', '#0891B2'];
const SOURCE_LABEL: Record<string, string> = { vitalink_emr_sync: 'VitaLink hospitals', partner_api: 'Partner systems', manual: 'Direct reports', lab_notification: 'Laboratories', community_report: 'Community' };
const ALERT_LABEL: Record<string, string> = { lab_notification: 'Confirmed cases', cfr_spike: 'Deaths', unusual_cluster: 'Unusual rises', facility_not_reporting: 'Silent facilities', new_outbreak: 'Outbreaks declared', outbreak_threshold: 'Thresholds', bulletin: 'Bulletins' };
const muted = 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';
const inputClass = 'sentinel-input rounded-xl px-3 py-2 text-sm';
const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const day = (s: string | null) => (s ? format(new Date(s), 'd MMM yyyy') : '—');
const change = (now: number, before: number) => (before === 0 ? (now ? 'new' : '—') : `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}%`);

/** The last 26 completed ISO weeks, newest first. */
function epiWeeks() {
  const lastComplete = subWeeks(startOfISOWeek(new Date()), 1);
  return Array.from({ length: 26 }, (_, i) => {
    const start = subWeeks(lastComplete, i);
    return { value: iso(start), label: `Week ${getISOWeek(start)}, ${getISOWeekYear(start)} (${format(start, 'd MMM')} – ${format(endOfISOWeek(start), 'd MMM')})` };
  });
}

function csvFor(report: SurveillanceReport, title: string): string {
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const row = (...v: unknown[]) => v.map(cell).join(',');
  const lines = [
    row(title), row('Organisation', report.organization), row('Period', report.from, report.to), '',
    row('Summary'), row('Cases', 'Previous period', 'Suspected', 'Confirmed', 'Deaths', 'Hospitalised', 'States', 'Facilities reporting'),
    row(report.totals.cases, report.totals.previousCases, report.totals.suspected, report.totals.confirmed, report.totals.deaths, report.totals.hospitalized,
      report.totals.states, `${report.reporting.reported}/${report.reporting.expected}`), '',
    row('By disease'), row('Disease', 'Category', 'Notifiable', 'Suspected', 'Confirmed', 'Deaths', 'CFR %', 'Cases', 'Previous period', 'States', 'Year to date', 'YTD deaths'),
    ...report.byDisease.map((d) => row(d.disease, d.category, d.notifiable ? 'yes' : 'no', d.suspected, d.confirmed, d.deaths, d.cfr ?? '', d.cases, d.previousCases, d.states, d.ytdCases, d.ytdDeaths)), '',
    row('By state'), row('State', 'Cases', 'Confirmed', 'Deaths', 'LGAs', 'Most reported', 'Open outbreaks'),
    ...report.byState.map((s) => row(s.state, s.cases, s.confirmed, s.deaths, s.lgas, s.topDisease, s.openOutbreaks)), '',
    row('By age group and sex'), row('Age group', 'Male', 'Female', 'Unknown'),
    ...report.byAgeSex.map((a) => row(a.ageGroup, a.male, a.female, a.unknown)), '',
    row('Weekly'), row('Epi week', 'Week starting', 'Cases', 'Confirmed', 'Deaths'),
    ...report.weekly.map((w) => row(w.epi_week, w.week_start, w.cases, w.confirmed, w.deaths)), '',
    row('Outbreaks'), row('Disease', 'State', 'LGA', 'Severity', 'Status', 'Start', 'End', 'Confirmed', 'Suspected', 'Deaths', 'CFR %', 'New cases in period', 'Response team'),
    ...report.outbreaks.map((o) => row(o.disease, o.state, o.lga, o.severity, o.status, o.startDate, o.endDate, o.confirmed, o.suspected, o.deaths, o.cfr ?? '', o.newCases, o.responseTeamDeployed ? 'deployed' : 'no')),
  ];
  return lines.join('\r\n');
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-950 dark:text-slate-50">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-base font-bold text-slate-950 dark:text-slate-50">{title}</h3>
      {children}
    </section>
  );
}

export function LiveReports() {
  const { activeOrganization } = useSentinelStore();
  const orgId = activeOrganization?.id;
  const weeks = useMemo(() => epiWeeks(), []);
  const [kind, setKind] = useState<ReportKind>('weekly');
  const [week, setWeek] = useState(weeks[0].value);
  const [trendWeeks, setTrendWeeks] = useState(12);
  const [customFrom, setCustomFrom] = useState(iso(subDays(new Date(), 29)));
  const [customTo, setCustomTo] = useState(iso(new Date()));
  const [diseaseId, setDiseaseId] = useState('');
  const [diseases, setDiseases] = useState<RegistryDisease[]>([]);
  const [report, setReport] = useState<{ key: string; data: SurveillanceReport } | null>(null);
  const [error, setError] = useState('');

  const period = useMemo(() => {
    switch (kind) {
      case 'weekly': return { from: week, to: iso(addDays(new Date(week), 6)) };
      case 'trends': case 'ntd': return { from: iso(subWeeks(startOfISOWeek(new Date()), trendWeeks - 1)), to: iso(new Date()) };
      case 'outbreaks': return { from: iso(subDays(new Date(), 27)), to: iso(new Date()) };
      default: return { from: customFrom, to: customTo };
    }
  }, [kind, week, trendWeeks, customFrom, customTo]);
  const options = useMemo(() => ({ category: kind === 'ntd' ? ('ntd' as const) : undefined, diseaseId: diseaseId || undefined }), [kind, diseaseId]);
  const key = JSON.stringify({ period, options });

  useEffect(() => { listDiseases().then(setDiseases).catch(() => undefined); }, []);
  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    getSurveillanceReport(orgId, period.from, period.to, options)
      .then((data) => { if (alive) { setReport({ key, data }); setError(''); } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Could not build the report.'); });
    return () => { alive = false; };
  }, [orgId, period, options, key]);

  const data = report?.data;
  const loading = !report || report.key !== key;
  const title = kind === 'weekly'
    ? `Weekly Epidemiological Report: ${weeks.find((w) => w.value === week)?.label ?? ''}`
    : `${KINDS.find((k) => k.id === kind)?.label}: ${day(period.from)} – ${day(period.to)}`;

  const trend = useMemo(() => {
    if (!data) return { rows: [], series: [] as string[] };
    const series = [...new Set(data.weeklyByDisease.map((w) => w.disease))];
    const byWeek = new Map<string, Record<string, number | string>>();
    for (const w of data.weekly) byWeek.set(w.week_start, { week: `W${getISOWeek(new Date(w.week_start))}`, Total: w.cases, Deaths: w.deaths });
    for (const w of data.weeklyByDisease) {
      const r = byWeek.get(w.weekStart) ?? { week: `W${getISOWeek(new Date(w.weekStart))}` };
      r[w.disease] = w.cases;
      byWeek.set(w.weekStart, r);
    }
    return { rows: [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, r]) => r), series };
  }, [data]);

  const exportCsv = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff), csvFor(data, title)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `sentinel-${kind}-report-${period.from}-to-${period.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Report exported');
  };
  const print = () => {
    document.body.classList.add('sentinel-printing');
    const done = () => { document.body.classList.remove('sentinel-printing'); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    window.print();
  };

  const showDiseases = kind !== 'outbreaks';
  const reportingRate = data && data.reporting.expected > 0 ? Math.round((data.reporting.reported / data.reporting.expected) * 100) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-950 dark:text-slate-50">Surveillance Reports</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Built from your live case registry, outbreaks, alerts and facility reporting.</p>
        </div>
        <div className="flex gap-2">
          <Button className={muted} disabled={!data || loading} onClick={exportCsv}><Download className="h-4 w-4" />Export CSV</Button>
          <Button data-tour-id="reports-export" disabled={!data || loading} onClick={print}><Printer className="h-4 w-4" />Export PDF</Button>
        </div>
      </div>

      <div data-tour-id="reports-kinds" className="flex flex-wrap gap-2">
        {KINDS.map((k) => <Button key={k.id} className={kind === k.id ? '' : muted} onClick={() => setKind(k.id)}>{k.label}</Button>)}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {kind === 'weekly' && <Select value={week} onChange={(e) => setWeek(e.target.value)}>{weeks.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}</Select>}
        {(kind === 'trends' || kind === 'ntd') && (
          <Select value={String(trendWeeks)} onChange={(e) => setTrendWeeks(Number(e.target.value))}>
            <option value="4">Last 4 weeks</option><option value="12">Last 12 weeks</option><option value="26">Last 26 weeks</option><option value="52">Last 52 weeks</option>
          </Select>
        )}
        {kind === 'custom' && (
          <>
            <label className="text-xs text-slate-500">From<input className={`${inputClass} mt-1 block`} type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} /></label>
            <label className="text-xs text-slate-500">To<input className={`${inputClass} mt-1 block`} type="date" value={customTo} min={customFrom} max={iso(new Date())} onChange={(e) => setCustomTo(e.target.value)} /></label>
          </>
        )}
        {(kind === 'trends' || kind === 'custom') && (
          <Select value={diseaseId} onChange={(e) => setDiseaseId(e.target.value)}>
            <option value="">All diseases</option>{diseases.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        )}
      </div>

      {error && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      {!data ? <div className="h-96 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" /> : (
        <div id="sentinel-report" className={`sentinel-card space-y-6 rounded-[28px] p-6 ${loading ? 'opacity-60' : ''}`}>
          <header className="border-b border-slate-200 pb-4 dark:border-slate-800">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-300">{data.organization} · VitaLink Sentinel</p>
            <h2 className="mt-1 text-xl font-bold text-slate-950 dark:text-slate-50">{title}</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {day(data.from)} – {day(data.to)} · compared with {day(data.previousFrom)} – {day(format(subDays(new Date(data.from), 1), 'yyyy-MM-dd'))} · generated {format(new Date(), 'd MMM yyyy, HH:mm')}
            </p>
          </header>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Cases" value={data.totals.cases} sub={`${change(data.totals.cases, data.totals.previousCases)} vs previous period`} />
            <Stat label="Confirmed" value={data.totals.confirmed} sub={`${data.totals.suspected} suspected or probable`} />
            <Stat label="Deaths" value={data.totals.deaths} sub={data.totals.confirmed ? `CFR ${Math.round((1000 * data.totals.deaths) / data.totals.confirmed) / 10}% among confirmed` : 'No confirmed cases'} />
            <Stat label="States affected" value={data.totals.states} sub={`${data.totals.diseases} disease${data.totals.diseases === 1 ? '' : 's'}`} />
            <Stat label="Facilities reporting" value={data.reporting.expected ? `${data.reporting.reported}/${data.reporting.expected}` : '—'} sub={reportingRate === null ? 'No sharing facilities' : `${reportingRate}% completeness`} />
          </section>

          {data.totals.cases === 0 && kind !== 'outbreaks' && (
            <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-700">No cases were reported in this period.</p>
          )}

          {showDiseases && data.byDisease.length > 0 && (
            <Section title={kind === 'ntd' ? 'Neglected tropical diseases' : 'Cases by disease'}>
              <DataTable headers={['Disease', 'Suspected', 'Confirmed', 'Deaths', 'CFR', 'Total', 'vs previous', 'States', 'Year to date']}>
                {data.byDisease.map((d) => (
                  <tr key={d.diseaseId}>
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-50">{d.disease}{d.notifiable && <span className="ml-1.5 text-[10px] font-medium text-red-600">notifiable</span>}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{d.suspected}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{d.confirmed}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{d.deaths}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{d.cfr === null ? '—' : `${d.cfr}%`}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-50">{d.cases}</td>
                    <td className="px-4 py-3 text-slate-500">{change(d.cases, d.previousCases)}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{d.states}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{d.ytdCases} ({d.ytdDeaths} deaths)</td>
                  </tr>
                ))}
              </DataTable>
            </Section>
          )}

          {(kind === 'trends' || kind === 'ntd' || kind === 'custom') && trend.rows.length > 0 && (
            <Section title="Weekly trend (by ISO epi week)">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend.rows} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#E8EAF0" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="week" stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis allowDecimals={false} stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={11} width={32} />
                    <Tooltip /><Legend />
                    {trend.series.map((s, i) => <Line key={s} type="monotone" dataKey={s} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} connectNulls />)}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Section>
          )}

          {kind === 'weekly' && data.byDisease.length > 0 && (
            <Section title="Cases and deaths by disease this week">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.byDisease.filter((d) => d.cases > 0).slice(0, 10)} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#E8EAF0" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="disease" stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis allowDecimals={false} stroke="#94A3B8" tickLine={false} axisLine={false} fontSize={11} width={32} />
                    <Tooltip /><Legend />
                    <Bar dataKey="suspected" name="Suspected" stackId="a" fill="#F59E0B" />
                    <Bar dataKey="confirmed" name="Confirmed" stackId="a" fill="#DC2626" />
                    <Bar dataKey="deaths" name="Deaths" fill="#0F172A" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
          )}

          {showDiseases && data.byState.length > 0 && (
            <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
              <Section title="By state">
                <DataTable headers={['State', 'Cases', 'Confirmed', 'Deaths', 'LGAs', 'Most reported', 'Open outbreaks']}>
                  {data.byState.map((s) => (
                    <tr key={s.state}>
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-50">{s.state}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.cases}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.confirmed}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.deaths}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.lgas}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.topDisease}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.openOutbreaks || '—'}</td>
                    </tr>
                  ))}
                </DataTable>
              </Section>
              <Section title="By age group and sex">
                <DataTable headers={['Age group', 'Male', 'Female', 'Unknown']}>
                  {data.byAgeSex.map((a) => (
                    <tr key={a.ageGroup}>
                      <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-50">{a.ageGroup === 'unknown' ? 'Unknown' : `${a.ageGroup} years`}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{a.male}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{a.female}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{a.unknown}</td>
                    </tr>
                  ))}
                </DataTable>
                {Object.keys(data.bySource).length > 0 && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">Sources: {Object.entries(data.bySource).map(([s, n]) => `${SOURCE_LABEL[s] ?? s} ${n}`).join(' · ')}</p>
                )}
              </Section>
            </div>
          )}

          <Section title={kind === 'outbreaks' ? 'Outbreaks open in the last 4 weeks' : 'Outbreaks in this period'}>
            {data.outbreaks.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No outbreaks were open in this period.</p> : (
              <div className="space-y-3">
                {data.outbreaks.map((o) => (
                  <div key={o.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-slate-950 dark:text-slate-50">{o.disease} · {o.lga ? `${o.lga}, ` : ''}{o.state}</p>
                      <div className="flex gap-2"><Badge tone={o.severity}>{o.severity}</Badge><span className="text-xs text-slate-500">{o.status.replace('_', ' ')}</span></div>
                    </div>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                      Since {day(o.startDate)}{o.endDate ? `, closed ${day(o.endDate)}` : ''} · {o.confirmed} confirmed, {o.suspected} suspected, {o.deaths} deaths
                      {o.cfr !== null ? ` (CFR ${o.cfr}%)` : ''} · {o.newCases} new case{o.newCases === 1 ? '' : 's'} in this period · response team {o.responseTeamDeployed ? 'deployed' : 'not deployed'}
                    </p>
                    {o.latestUpdate && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Latest update: {o.latestUpdate}</p>}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Alerts and reporting">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {data.alerts.total} alert{data.alerts.total === 1 ? '' : 's'} raised ({data.alerts.critical} critical, {data.alerts.high} high; {data.alerts.open} still open)
              {Object.keys(data.alerts.byType).length > 0 && `: ${Object.entries(data.alerts.byType).map(([t, n]) => `${ALERT_LABEL[t] ?? t} ${n}`).join(', ')}`}.
              {' '}{data.reporting.expected > 0 ? `${data.reporting.reported} of ${data.reporting.expected} sharing facilities sent data in this period.` : 'No facilities are sharing data yet.'}
            </p>
          </Section>
        </div>
      )}
    </div>
  );
}
