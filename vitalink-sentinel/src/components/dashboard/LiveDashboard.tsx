// Dashboard on live Supabase data (sentinel_dashboard): cases from VitaLink
// hospitals, partner APIs and manual reports, plus this organisation's outbreaks,
// alerts and facility reporting.
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Bell, Building2, ClipboardList } from 'lucide-react';
import { SCard as Card } from '@/components/standalone/SCard';
import { SButton as Button } from '@/components/standalone/SButton';
import { DataTable } from '@/components/ui/DataTable';
import { StatCard } from '@/components/dashboard/StatCard';
import { CaseTrendChart } from '@/components/dashboard/CaseTrendChart';
import { DiseaseDistributionChart } from '@/components/dashboard/DiseaseDistributionChart';
import { AlertFeed } from '@/components/dashboard/AlertFeed';
import { OutbreakTimeline } from '@/components/dashboard/OutbreakTimeline';
import { GeographicHeatmap } from '@/components/dashboard/GeographicHeatmap';
import { useSentinelStore } from '@/store/useSentinelStore';
import { getDashboard, type DashboardData } from '@/lib/supabase/sentinel';

const PERIODS = [{ label: '7 days', range: '7d', days: 7 }, { label: '30 days', range: '30d', days: 30 }, { label: '90 days', range: '90d', days: 90 }] as const;
const LINE_COLORS = ['#22C55E', '#06B6D4', '#3B82F6', '#EF4444', '#F59E0B'];
const REPORTING = [
  { key: 'active', name: 'Reporting', color: '#10B981', dot: 'bg-emerald-500' },
  { key: 'delayed', name: 'Delayed', color: '#3B82F6', dot: 'bg-blue-500' },
  { key: 'notReporting', name: 'Not reporting', color: '#F59E0B', dot: 'bg-amber-500' },
] as const;
const BARS = '▁▂▃▄▅▆▇█';

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
const sparkline = (values: number[]) => {
  const max = Math.max(...values, 1);
  return values.map((value) => BARS[Math.round((value / max) * (BARS.length - 1))]).join('');
};
const change = (now: number, before: number) => (before === 0 ? (now > 0 ? 'new' : '—') : `${now >= before ? '+' : ''}${Math.round(((now - before) / before) * 100)}%`);
const greeting = () => { const hour = new Date().getHours(); return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'; };

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">{children}</p>;
}

export function LiveDashboard() {
  const { activeOrganization, timeRange, setTimeRange, navigate } = useSentinelStore();
  const period = PERIODS.find((item) => item.range === timeRange) ?? PERIODS[1];
  const orgId = activeOrganization?.id;
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    const load = () => getDashboard(orgId, period.days)
      .then((result) => { if (alive) { setData(result); setError(''); } })
      .catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : 'Could not load the dashboard.'); });
    void load();
    // New cases arrive from hospitals and partner systems at any time.
    const timer = window.setInterval(load, 60_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [orgId, period.days]);

  const loading = !data || data.days !== period.days;
  const stats = data?.stats;
  const reportingRate = stats && stats.facilities > 0 ? Math.round((stats.facilitiesReporting / stats.facilities) * 100) : null;

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-[#F1F5F9] p-6 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{format(new Date(), 'EEEE, do MMMM')}</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 dark:text-slate-50">{greeting()}, {activeOrganization?.fullName ?? 'Sentinel team'}.</h2>
        </div>
        <div className="rounded-xl bg-white p-1 shadow-sm dark:bg-slate-800">
          {PERIODS.map((item) => (
            <button key={item.range} type="button" onClick={() => setTimeRange(item.range)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${item.range === period.range ? 'bg-blue-600 text-white dark:bg-blue-500' : 'text-slate-500 dark:text-slate-400'}`}>{item.label}</button>
          ))}
        </div>
      </section>

      {error && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active Outbreaks" value={stats ? String(stats.activeOutbreaks) : '…'} icon={AlertTriangle} tone="critical"
          trend={stats ? `${stats.newOutbreaks} new in ${period.label} · ${stats.monitoringOutbreaks} monitoring` : 'Loading'} />
        <StatCard label={`Total Cases (${period.label})`} value={stats ? stats.cases.toLocaleString() : '…'} icon={ClipboardList} tone="high"
          trend={stats ? `${change(stats.cases, stats.previousCases)} vs previous ${period.label} · ${stats.confirmedCases.toLocaleString()} confirmed` : 'Loading'} />
        <StatCard label="Open Alerts" value={stats ? String(stats.openAlerts) : '…'} icon={Bell} tone="moderate"
          trend={stats ? (stats.urgentAlerts ? `${stats.urgentAlerts} critical or high` : 'None urgent') : 'Loading'} />
        <StatCard label="Facilities Reporting" value={stats ? `${stats.facilitiesReporting} / ${stats.facilities}` : '…'} icon={Building2} tone="low"
          trend={!stats ? 'Loading' : reportingRate === null ? (stats.pendingFacilities ? `${plural(stats.pendingFacilities, 'request')} awaiting approval` : 'No facilities sharing yet') : `${reportingRate}% reported in the last 7 days`} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(360px,1.35fr)]">
        <Card>
          <div className="mb-4">
            <h2 className="font-bold text-slate-950 dark:text-slate-50">Disease Case Trends</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Reported cases per {period.days > 30 ? 'week' : 'day'}, top {data?.trendDiseases.length || 5} diseases</p>
          </div>
          {loading ? <div className="h-80 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
            : data.trendDiseases.length === 0 ? <Empty>No cases reported in the last {period.label}.</Empty>
            : <CaseTrendChart xKey="label" data={data.trend.map((row) => ({ ...row, label: format(new Date(row.date), 'd MMM') }))}
                series={data.trendDiseases.map((disease, index) => ({ key: disease, color: LINE_COLORS[index % LINE_COLORS.length] }))} />}
        </Card>
        <Card>
          <h2 className="font-bold text-slate-950 dark:text-slate-50">Surveillance Status</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">How recently each sharing facility reported</p>
          {stats && stats.facilities === 0 ? <div className="mt-5"><Empty>No facilities are sharing data yet. <button type="button" className="font-semibold text-blue-600 dark:text-blue-300" onClick={() => navigate('facilities')}>Link facilities</button></Empty></div> : (
            <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1"><DiseaseDistributionChart data={REPORTING.map((item) => ({ name: item.name, value: data?.reporting[item.key] ?? 0, color: item.color }))} /></div>
              <div className="space-y-3 text-sm">
                {REPORTING.map((item) => (
                  <div key={item.key} className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                    <span className={`h-2.5 w-2.5 rounded-full ${item.dot}`} />{item.name} {data?.reporting[item.key] ?? 0}
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
        <Card>
          <h2 className="mb-4 font-bold text-slate-950 dark:text-slate-50">Active Outbreaks</h2>
          {data && data.outbreaks.length === 0 ? <Empty>No active outbreaks.</Empty>
            : <OutbreakTimeline outbreaks={data?.outbreaks ?? []} today={new Date()} onView={() => navigate('outbreaks')} />}
        </Card>
        <Card>
          <h2 className="mb-4 font-bold text-slate-950 dark:text-slate-50">Alert Feed</h2>
          {data && data.alerts.length === 0 ? <Empty>No open alerts.</Empty>
            : <AlertFeed alerts={(data?.alerts ?? []).map((alert) => ({ ...alert, acknowledged: false }))} onReview={() => navigate('alerts')} />}
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <Card>
          <h2 className="mb-4 font-bold text-slate-950 dark:text-slate-50">Nigeria Surveillance Risk</h2>
          {data && data.states.length === 0 ? <Empty>No state activity in the last {period.label}.</Empty>
            : <GeographicHeatmap states={(data?.states ?? []).map((row) => ({ state: row.state, riskLevel: row.risk, alerts: row.alerts, totalCases: row.cases }))} />}
        </Card>
        <Card>
          <h2 className="mb-4 font-bold text-slate-950 dark:text-slate-50">Top Diseases This Week</h2>
          {data && data.topDiseases.length === 0 ? <Empty>No cases reported in the last 7 days.</Empty> : (
            <DataTable headers={['Rank', 'Disease', 'Cases', 'vs last week', 'Last 7 days']}>
              {(data?.topDiseases ?? []).map((row, index) => {
                const delta = change(row.cases, row.previous);
                return (
                  <tr key={row.disease}>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">#{index + 1}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-50">{row.disease}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{row.cases.toLocaleString()}</td>
                    <td className={`px-4 py-3 ${delta.startsWith('-') ? 'text-emerald-600 dark:text-emerald-300' : 'text-red-600 dark:text-red-300'}`}>{delta}</td>
                    <td className="px-4 py-3 font-mono tracking-tight text-blue-500 dark:text-blue-300" title={row.spark.join(', ')}>{sparkline(row.spark)}</td>
                  </tr>
                );
              })}
            </DataTable>
          )}
        </Card>
      </section>
      <div className="flex justify-end"><Button className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200" onClick={() => navigate('cases')}>View all cases</Button></div>
    </div>
  );
}
