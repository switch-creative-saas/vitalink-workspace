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
import { mockRecentCases } from '@/data/mockSentinelData';
import { useSentinelStore } from '@/store/useSentinelStore';

export function DashboardPage() {
  const { activeOrganization } = useSentinelStore();
  const topDiseases = ['Malaria', 'Cholera', 'Tuberculosis', 'Diphtheria', 'Lassa Fever'];
  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-[#F1F5F9] p-6 dark:border-slate-800 dark:bg-slate-900">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Saturday, 5th September</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 dark:text-slate-50">Good morning, {activeOrganization?.fullName ?? 'Sentinel team'}.</h2>
        </div>
        <div className="flex items-center gap-2">
          <Button>This Month</Button>
          <Button className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">Edit Widget</Button>
        </div>
      </section>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active Outbreaks" value="3" trend="up 12% vs last week" icon={AlertTriangle} tone="critical" />
        <StatCard label="Total Cases (7 days)" value="1,247" trend="up 8% vs last week" icon={ClipboardList} tone="high" />
        <StatCard label="Active Alerts" value="8" trend="4 require action" icon={Bell} tone="moderate" />
        <StatCard label="Facilities Reporting" value="142 / 180" trend="79% reporting rate" icon={Building2} tone="low" />
      </section>
      <section className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(360px,1.35fr)]">
        <Card>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-bold text-slate-950 dark:text-slate-50">Disease Case Trends</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Reported cases over the selected period</p>
            </div>
            <div className="rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {['7 days', '30 days', '90 days'].map((label, index) => (
                <button key={label} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${index === 1 ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>{label}</button>
              ))}
            </div>
          </div>
          <CaseTrendChart />
        </Card>
        <Card>
          <h2 className="font-bold text-slate-950 dark:text-slate-50">Surveillance Status</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Current reporting and outbreak activity</p>
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1"><DiseaseDistributionChart /></div>
            <div className="space-y-3 text-sm">
              {['Active 56', 'Delayed 21', 'Not Reporting 17'].map((item, index) => (
                <div key={item} className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                  <span className={`h-2.5 w-2.5 rounded-full ${index === 0 ? 'bg-emerald-500' : index === 1 ? 'bg-blue-500' : 'bg-amber-500'}`} />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </Card>
        <Card><h2 className="mb-4 font-bold text-slate-950 dark:text-slate-50">Active Outbreaks</h2><OutbreakTimeline /></Card>
        <Card><h2 className="mb-4 font-bold text-slate-950 dark:text-slate-50">Alert Feed</h2><AlertFeed /></Card>
      </section>
      <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <Card><h2 className="mb-4 font-bold text-slate-950 dark:text-slate-50">Nigeria Surveillance Risk</h2><GeographicHeatmap /></Card>
        <Card>
          <h2 className="mb-4 font-bold text-slate-950 dark:text-slate-50">Top Diseases This Week</h2>
          <DataTable headers={['Rank', 'Disease', 'Cases', 'Change', 'Trend']}>
            {topDiseases.map((disease, index) => (
              <tr key={disease}>
                <td className="px-4 py-3 text-slate-500 dark:text-slate-400">#{index + 1}</td>
                <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-50">{disease}</td>
                <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{mockRecentCases.filter((item) => item.disease === disease).length * 37}</td>
                <td className="px-4 py-3 text-emerald-600 dark:text-emerald-300">+{8 + index}%</td>
                <td className="px-4 py-3 text-blue-500 dark:text-blue-300">▁▂▃▅▆</td>
              </tr>
            ))}
          </DataTable>
        </Card>
      </section>
    </div>
  );
}

