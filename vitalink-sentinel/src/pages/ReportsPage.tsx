import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { SButton as Button } from '@/components/standalone/SButton';
import { SCard as Card } from '@/components/standalone/SCard';
import { DataTable } from '@/components/ui/DataTable';
import { mockStateData, mockWeeklyTrend } from '@/data/mockSentinelData';

export function ReportsPage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-2xl font-bold text-slate-950 dark:text-slate-50">Surveillance Reports</h2><p className="text-sm text-slate-500 dark:text-slate-400">Weekly summaries, disease trends, NTD reports, and exports.</p></div><Button onClick={() => toast.success('Report generated')}>Generate Report</Button></div>
      <div className="flex flex-wrap gap-2">{['Weekly Summary', 'Outbreak Reports', 'Disease Trends', 'NTD Reports', 'Custom'].map((tab, index) => <Button key={tab} className={index ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700' : ''}>{tab}</Button>)}</div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card><h3 className="mb-4 font-bold text-slate-950 dark:text-slate-50">Cases by Disease</h3><div className="h-80"><ResponsiveContainer><BarChart data={mockWeeklyTrend.slice(-6)}><CartesianGrid stroke="#E8EAF0" vertical={false} /><XAxis dataKey="week" stroke="#94A3B8" tickLine={false} axisLine={false} /><YAxis stroke="#94A3B8" tickLine={false} axisLine={false} /><Tooltip /><Legend /><Bar dataKey="cholera" fill="#06B6D4" radius={[6, 6, 0, 0]} /><Bar dataKey="malaria" fill="#22C55E" radius={[6, 6, 0, 0]} /><Bar dataKey="tb" fill="#3B82F6" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></Card>
        <Card><h3 className="mb-4 font-bold text-slate-950 dark:text-slate-50">Top States by Cases</h3><DataTable headers={['State', 'Cases', 'Alerts', 'Risk']}>{mockStateData.slice(0, 10).map((state) => <tr key={state.state}><td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-50">{state.state}</td><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{state.totalCases}</td><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{state.alerts}</td><td className="px-4 py-3 text-slate-600 dark:text-slate-300">{state.riskLevel}</td></tr>)}</DataTable></Card>
      </div>
      <div className="flex gap-2"><Button onClick={() => toast.success('PDF downloaded')}>Export PDF</Button><Button className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700" onClick={() => toast.success('CSV downloaded')}>Export CSV</Button></div>
    </div>
  );
}

