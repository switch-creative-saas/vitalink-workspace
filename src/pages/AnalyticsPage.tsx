import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Calendar,
  Clock3,
  CreditCard,
  Download,
  Eye,
  FlaskConical,
  Search,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, CartesianGrid, AreaChart, Area } from 'recharts';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { LiveAnalytics } from '@/components/analytics/LiveAnalytics';

type TimeRange = '24h' | '7d' | '30d' | '90d';
type AnalyticsModule = 'all' | 'appointments' | 'laboratory' | 'pharmacy' | 'billing' | 'patients';

type AnalyticsSummary = {
  patients: number;
  appointments: number;
  revenue: number;
  lab_tests: number;
  pharmacy_sales: number;
  insurance_claims: number;
};

const TIME_RANGES: TimeRange[] = ['24h', '7d', '30d', '90d'];

const rangeData: Record<TimeRange, AnalyticsSummary> = {
  '24h': { patients: 82, appointments: 64, revenue: 1650000, lab_tests: 97, pharmacy_sales: 760000, insurance_claims: 14 },
  '7d': { patients: 524, appointments: 448, revenue: 9820000, lab_tests: 711, pharmacy_sales: 4100000, insurance_claims: 86 },
  '30d': { patients: 2487, appointments: 1943, revenue: 42100000, lab_tests: 2932, pharmacy_sales: 18000000, insurance_claims: 314 },
  '90d': { patients: 7341, appointments: 5910, revenue: 124600000, lab_tests: 8740, pharmacy_sales: 53300000, insurance_claims: 902 },
};

const trendByRange: Record<TimeRange, { t: string; patients: number; appointments: number; revenue: number; wait: number }[]> = {
  '24h': [
    { t: '00', patients: 8, appointments: 7, revenue: 120000, wait: 17 },
    { t: '06', patients: 12, appointments: 10, revenue: 220000, wait: 19 },
    { t: '12', patients: 30, appointments: 24, revenue: 780000, wait: 22 },
    { t: '18', patients: 32, appointments: 23, revenue: 530000, wait: 16 },
  ],
  '7d': [
    { t: 'Mon', patients: 62, appointments: 57, revenue: 1190000, wait: 26 },
    { t: 'Tue', patients: 71, appointments: 61, revenue: 1320000, wait: 24 },
    { t: 'Wed', patients: 66, appointments: 58, revenue: 1180000, wait: 25 },
    { t: 'Thu', patients: 74, appointments: 63, revenue: 1460000, wait: 22 },
    { t: 'Fri', patients: 89, appointments: 76, revenue: 1760000, wait: 28 },
    { t: 'Sat', patients: 78, appointments: 67, revenue: 1640000, wait: 20 },
    { t: 'Sun', patients: 84, appointments: 66, revenue: 1240000, wait: 18 },
  ],
  '30d': [
    { t: 'W1', patients: 590, appointments: 450, revenue: 9800000, wait: 24 },
    { t: 'W2', patients: 604, appointments: 470, revenue: 10100000, wait: 23 },
    { t: 'W3', patients: 636, appointments: 498, revenue: 10900000, wait: 21 },
    { t: 'W4', patients: 657, appointments: 525, revenue: 11300000, wait: 20 },
  ],
  '90d': [
    { t: 'M1', patients: 2320, appointments: 1860, revenue: 40100000, wait: 25 },
    { t: 'M2', patients: 2441, appointments: 1945, revenue: 41700000, wait: 22 },
    { t: 'M3', patients: 2580, appointments: 2105, revenue: 42800000, wait: 20 },
  ],
};

const deptRows = [
  { department: 'Consultation', patients: 1620, revenue: 13200000, avgTime: 19, efficiency: 86 },
  { department: 'Laboratory', patients: 1240, revenue: 8500000, avgTime: 42, efficiency: 74 },
  { department: 'Pharmacy', patients: 1880, revenue: 10700000, avgTime: 12, efficiency: 89 },
  { department: 'Billing', patients: 1090, revenue: 9700000, avgTime: 9, efficiency: 91 },
];

const appointmentHeatmap = [
  { day: 'Mon', h08: 23, h10: 36, h12: 26, h14: 31, h16: 18 },
  { day: 'Tue', h08: 21, h10: 34, h12: 24, h14: 28, h16: 19 },
  { day: 'Wed', h08: 25, h10: 38, h12: 28, h14: 35, h16: 21 },
  { day: 'Thu', h08: 24, h10: 35, h12: 25, h14: 30, h16: 20 },
  { day: 'Fri', h08: 29, h10: 43, h12: 32, h14: 39, h16: 24 },
];

function safeExportFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function AnalyticsPage() {
  return isSupabaseConfigured ? <LiveAnalyticsPage /> : <DemoAnalyticsPage />;
}

const ANALYTICS_ROLES = ['super-admin', 'hospital-admin', 'doctor', 'nurse', 'receptionist', 'pharmacist', 'lab-scientist', 'lab-technician', 'billing-officer', 'insurance-officer'];

function LiveAnalyticsPage() {
  const { currentRole } = useAuth();
  const { hasAccess } = useSubscription();
  if (!ANALYTICS_ROLES.includes(currentRole)) {
    return <div className="premium-card p-8 text-center"><h1 className="text-xl font-semibold">Analytics</h1><p className="mt-2 text-sm text-gray-500">Your role doesn't have access to analytics.</p></div>;
  }
  if (!hasAccess('analytics_advanced')) {
    return <div className="premium-card p-8 text-center"><h1 className="text-xl font-semibold">Analytics</h1><p className="mt-2 text-sm text-gray-500">Analytics is included in the Growth and Enterprise plans. Upgrade from Subscription to unlock it.</p></div>;
  }
  return <LiveAnalytics />;
}

// Offline demo only (no Supabase): illustrative sample figures.
function DemoAnalyticsPage() {
  const { currentRole, hasPermission, userName } = useAuth();
  const { hasAccess } = useSubscription();
  const storageKey = `vitalink-analytics-range:${currentRole}`;
  const [dateRange, setDateRange] = useState<TimeRange>(() => {
    const saved = localStorage.getItem(storageKey);
    return TIME_RANGES.includes(saved as TimeRange) ? (saved as TimeRange) : '7d';
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState<AnalyticsModule>('all');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTitle, setDetailTitle] = useState('Analytics details');
  const [exportOpen, setExportOpen] = useState(false);
  const [widgetExport, setWidgetExport] = useState('entire-dashboard');

  useEffect(() => {
    localStorage.setItem(storageKey, dateRange);
  }, [dateRange, storageKey]);

  const summary = rangeData[dateRange];
  const trend = trendByRange[dateRange];
  const overdues = Math.round(summary.revenue * 0.13);
  const pending = Math.round(summary.revenue * 0.19);
  const activeUsers = Math.round(summary.appointments * 0.46);
  const avgWait = Math.round(trend.reduce((a, x) => a + x.wait, 0) / trend.length);
  const retention = 73 + (dateRange === '90d' ? 4 : dateRange === '30d' ? 2 : 0);

  const canViewAnalytics = hasPermission('Analytics', 'view') || ['doctor', 'pharmacist', 'lab-scientist', 'billing-officer', 'receptionist', 'hospital-admin', 'super-admin'].includes(currentRole);
  const canExport = hasPermission('Analytics', 'export') || currentRole === 'super-admin';

  const allowedSections: string[] = useMemo(() => {
    if (currentRole === 'super-admin' || currentRole === 'hospital-admin') return ['patient', 'department', 'revenue', 'lab', 'pharmacy', 'appointment', 'insurance'] as const;
    if (currentRole === 'doctor') return ['patient', 'department', 'appointment'] as const;
    if (currentRole === 'pharmacist') return ['pharmacy'] as const;
    if (currentRole === 'lab-scientist') return ['lab'] as const;
    if (currentRole === 'billing-officer' || currentRole === 'insurance-officer') return ['revenue', 'insurance'] as const;
    if (currentRole === 'receptionist') return ['appointment', 'patient'] as const;
    return ['patient'] as const;
  }, [currentRole]);

  const revenueBreakdown = [
    { name: 'Consultation', value: Math.round(summary.revenue * 0.34), color: '#4F46E5' },
    { name: 'Laboratory', value: Math.round(summary.revenue * 0.22), color: '#7C3AED' },
    { name: 'Pharmacy', value: Math.round(summary.revenue * 0.28), color: '#059669' },
    { name: 'Billing/Other', value: Math.round(summary.revenue * 0.16), color: '#D97706' },
  ];

  const doSearch = () => {
    if (!searchQuery.trim()) return toast.error('Enter search text');
    setDetailTitle(`Search results · ${searchScope.toUpperCase()}`);
    setDetailOpen(true);
    toast.success(`Filtered analytics for "${searchQuery}"`);
  };

  const exportAs = (format: 'pdf' | 'csv' | 'excel') => {
    if (!canExport) return toast.error('Export restricted for your role');
    if (format === 'pdf') {
      window.print();
      toast.success('Executive summary print/PDF view opened');
      return;
    }
    const rows = [
      ['range', dateRange],
      ['patients', String(summary.patients)],
      ['appointments', String(summary.appointments)],
      ['lab_tests', String(summary.lab_tests)],
      ['revenue', String(summary.revenue)],
      ['pharmacy_sales', String(summary.pharmacy_sales)],
      ['insurance_claims', String(summary.insurance_claims)],
      ['widget', widgetExport],
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    safeExportFile(`vitalink-analytics-${dateRange}.${format === 'excel' ? 'xlsx' : 'csv'}`, csv, 'text/csv;charset=utf-8;');
    toast.success(`Exported ${widgetExport} as ${format.toUpperCase()}`);
  };

  const openDetails = (title: string) => {
    setDetailTitle(title);
    setDetailOpen(true);
  };

  if (!canViewAnalytics) {
    return (
      <div className="premium-card p-8 text-center page-transition">
        <h1 className="text-xl font-semibold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-2">No analytics access for your role.</p>
      </div>
    );
  }
  if (!hasAccess('analytics_advanced')) {
    return (
      <div className="premium-card p-8 text-center page-transition">
        <h1 className="text-xl font-semibold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500 mt-2">Advanced analytics is locked on your plan. Upgrade to Pro.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 page-transition">
      <div className="sticky top-0 z-20 -mx-4 px-4 py-3 md:mx-0 md:px-0 bg-background/90 backdrop-blur-md border-b border-white/40 md:border-0">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#1E4ED8]">Healthcare Intelligence</h1>
            <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">Unified real-time analytics across EMR, appointments, laboratory, pharmacy and billing.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 p-1 bg-gray-100 rounded-lg dark:bg-slate-900/50">
              {TIME_RANGES.map((range) => (
                <button
                  key={range}
                  onClick={() => setDateRange(range)}
                  className={cn('px-3 py-1.5 rounded-md text-sm font-medium transition-all', dateRange === range ? 'bg-white text-royal-600 shadow-sm dark:bg-slate-800/60 dark:text-white' : 'text-gray-500 dark:text-slate-400')}
                >
                  {range}
                </button>
              ))}
            </div>
            <Popover open={exportOpen} onOpenChange={setExportOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2 rounded-xl" disabled={!canExport}>
                  <Download className="w-4 h-4" />
                  Export
                </Button>
              </PopoverTrigger>
              <PopoverContent className="glass-panel border-white/60 w-80">
                <div className="space-y-3">
                  <div>
                    <Label>Export target</Label>
                    <select className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={widgetExport} onChange={(e) => setWidgetExport(e.target.value)}>
                      <option value="entire-dashboard">Entire dashboard</option>
                      <option value="kpi-cards">KPI cards only</option>
                      <option value="patient-analytics">Patient analytics widget</option>
                      <option value="department-performance">Department performance widget</option>
                      <option value="revenue-analytics">Revenue analytics widget</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Button size="sm" variant="outline" onClick={() => exportAs('pdf')}>PDF</Button>
                    <Button size="sm" variant="outline" onClick={() => exportAs('csv')}>CSV</Button>
                    <Button size="sm" variant="outline" onClick={() => exportAs('excel')}>Excel</Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search patients, appointments, revenue, lab results..." className="pl-10 bg-white/80 rounded-xl dark:bg-slate-900/50 dark:text-slate-50" />
        </div>
        <select className="rounded-xl border border-input px-3 py-2 text-sm bg-white/80 text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={searchScope} onChange={(e) => setSearchScope(e.target.value as AnalyticsModule)}>
          <option value="all">All modules</option>
          <option value="patients">Patients</option>
          <option value="appointments">Appointments</option>
          <option value="billing">Revenue</option>
          <option value="laboratory">Lab results</option>
        </select>
        <Button className="rounded-xl bg-[#1E4ED8] text-white" onClick={doSearch}>Search</Button>
      </div>

      <div className="dashboard-stat-grid">
        {[
          { label: 'Total Patients', value: summary.patients, icon: Users, action: () => openDetails('Total Patients') },
          { label: 'Appointments', value: summary.appointments, icon: Calendar, action: () => openDetails('Appointments') },
          { label: 'Lab Tests', value: summary.lab_tests, icon: FlaskConical, action: () => openDetails('Lab Tests') },
          { label: 'Revenue', value: `₦${summary.revenue.toLocaleString()}`, icon: CreditCard, action: () => openDetails('Revenue') },
          { label: 'Active Users', value: activeUsers, icon: UserCheck, action: () => openDetails('Active Users') },
          { label: 'Avg Wait (min)', value: avgWait, icon: Clock3, action: () => openDetails('Wait Time') },
          { label: 'Retention %', value: `${retention}%`, icon: TrendingUp, action: () => openDetails('Retention') },
          { label: 'Claims', value: summary.insurance_claims, icon: Activity, action: () => openDetails('Insurance Claims') },
        ].map((card) => (
          <button key={card.label} onClick={card.action} className="premium-card p-4 text-left hover:shadow-md transition-all card-equal-height h-full min-w-0 overflow-hidden">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <card.icon className="w-5 h-5 text-[#4F46E5] flex-shrink-0" />
              <Eye className="w-4 h-4 text-gray-400 flex-shrink-0 dark:text-slate-400" />
            </div>
            <p className="text-lg font-bold text-gray-900 mt-3 truncate tabular-nums dark:text-slate-50">{card.value}</p>
            <p className="text-xs text-gray-500 truncate dark:text-slate-400">{card.label}</p>
          </button>
        ))}
      </div>

      <div className="premium-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2 dark:text-slate-50">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            VitaMind AI Insights
          </h3>
          <Button size="sm" variant="outline" onClick={() => openDetails('AI Insights')}>View Details</Button>
        </div>
        <div className="grid md:grid-cols-2 gap-3 text-sm text-gray-700 dark:text-slate-200">
          <div className="p-3 rounded-xl bg-white border border-indigo-100 dark:border-slate-700 dark:bg-slate-800/60">Patient volume increased by <strong>23%</strong> this week.</div>
          <div className="p-3 rounded-xl bg-white border border-amber-100 dark:border-slate-700 dark:bg-slate-800/60">Lab turnaround time is <strong>11% slower</strong> than baseline.</div>
          <div className="p-3 rounded-xl bg-white border border-emerald-100 dark:border-slate-700 dark:bg-slate-800/60">Revenue growth is being driven by <strong>pharmacy sales (+19%)</strong>.</div>
          <div className="p-3 rounded-xl bg-white border border-red-100 dark:border-slate-700 dark:bg-slate-800/60">High no-show rate detected on <strong>Mondays (17%)</strong>.</div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="premium-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 dark:text-slate-50">System Trend (Line)</h3>
            <Button size="sm" variant="ghost" onClick={() => openDetails('System Trend')}>View Details</Button>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                <XAxis dataKey="t" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="patients" stroke="#4F46E5" strokeWidth={2.5} />
                <Line type="monotone" dataKey="appointments" stroke="#059669" strokeWidth={2.5} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="premium-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 dark:text-slate-50">Revenue Composition (Pie)</h3>
            <Button size="sm" variant="ghost" onClick={() => openDetails('Revenue Composition')}>View Details</Button>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={revenueBreakdown} dataKey="value" nameKey="name" outerRadius={95}>
                  {revenueBreakdown.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => `₦${v.toLocaleString()}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {allowedSections.includes('department') && (
        <div className="premium-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 dark:text-slate-50">Department Performance (critical)</h3>
            <Button size="sm" variant="ghost" onClick={() => openDetails('Department Performance')}>View Details</Button>
          </div>
          <div className="responsive-table-wrap">
            <table className="w-full table-fixed">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-100 dark:border-slate-700 dark:bg-slate-800/80">
                  <th className="text-left py-3 text-xs text-gray-600 uppercase dark:text-slate-300">Department</th>
                  <th className="text-left py-3 text-xs text-gray-600 uppercase dark:text-slate-300">Patients Served</th>
                  <th className="text-left py-3 text-xs text-gray-600 uppercase dark:text-slate-300">Revenue</th>
                  <th className="text-left py-3 text-xs text-gray-600 uppercase dark:text-slate-300">Avg Time</th>
                  <th className="text-left py-3 text-xs text-gray-600 uppercase dark:text-slate-300">Efficiency</th>
                </tr>
              </thead>
              <tbody>
                {deptRows.map((d) => (
                  <tr key={d.department} className="border-b border-gray-50 hover:bg-gray-50/60 dark:border-slate-700 dark:hover:bg-slate-800/60">
                    <td className="py-3 text-sm font-medium">{d.department}</td>
                    <td className="py-3 text-sm">{d.patients.toLocaleString()}</td>
                    <td className="py-3 text-sm">₦{d.revenue.toLocaleString()}</td>
                    <td className="py-3 text-sm">{d.avgTime} mins</td>
                    <td className="py-3">
                      <div className="w-28 h-2 rounded-full bg-gray-100 overflow-hidden dark:bg-slate-800">
                        <div className="h-full bg-gradient-to-r from-indigo-500 to-indigo-400" style={{ width: `${d.efficiency}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {allowedSections.includes('revenue') && (
          <div className="premium-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Revenue Trend (Area)</h3>
              <Button size="sm" variant="ghost" onClick={() => openDetails('Revenue Trend')}>View Details</Button>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                  <XAxis dataKey="t" />
                  <YAxis />
                  <Tooltip formatter={(v: number) => `₦${v.toLocaleString()}`} />
                  <Area type="monotone" dataKey="revenue" stroke="#4F46E5" fill="#6366F122" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-gray-500 mt-2">Paid vs pending vs overdue: Paid ₦{(summary.revenue - pending - overdues).toLocaleString()} · Pending ₦{pending.toLocaleString()} · Overdue ₦{overdues.toLocaleString()}</p>
          </div>
        )}

        {allowedSections.includes('lab') && (
          <div className="premium-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Lab Analytics (Bar)</h3>
              <Button size="sm" variant="ghost" onClick={() => openDetails('Lab Analytics')}>View Details</Button>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[{ k: 'Tests', v: summary.lab_tests }, { k: 'Pending', v: Math.round(summary.lab_tests * 0.18) }, { k: 'Completed', v: Math.round(summary.lab_tests * 0.82) }, { k: 'Top CBC', v: Math.round(summary.lab_tests * 0.21) }]}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                  <XAxis dataKey="k" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="v" fill="#7C3AED" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {allowedSections.includes('pharmacy') && (
          <div className="premium-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 dark:text-slate-50">Pharmacy Analytics</h3>
              <Button size="sm" variant="ghost" onClick={() => openDetails('Pharmacy Analytics')}>View Details</Button>
            </div>
            <ul className="space-y-2 text-sm text-slate-900 dark:text-slate-200">
              <li className="p-3 rounded-lg bg-gray-50 dark:bg-slate-800/60">Most dispensed: <strong>Paracetamol 500mg</strong></li>
              <li className="p-3 rounded-lg bg-gray-50 dark:bg-slate-800/60">Stock turnover rate: <strong>4.2x / month</strong></li>
              <li className="p-3 rounded-lg bg-gray-50 dark:bg-slate-800/60">Expired drugs: <strong>12 units</strong></li>
              <li className="p-3 rounded-lg bg-gray-50 dark:bg-slate-800/60">Revenue from pharmacy: <strong>₦{summary.pharmacy_sales.toLocaleString()}</strong></li>
            </ul>
          </div>
        )}

        {allowedSections.includes('appointment') && (
          <div className="premium-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 dark:text-slate-50">Appointment Heatmap</h3>
              <Button size="sm" variant="ghost" onClick={() => openDetails('Appointment Analytics')}>View Details</Button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-6 text-xs text-gray-500 dark:text-slate-400">
                <span />
                <span>08</span><span>10</span><span>12</span><span>14</span><span>16</span>
              </div>
              {appointmentHeatmap.map((r) => (
                <div key={r.day} className="grid grid-cols-6 gap-1 items-center text-xs">
                  <span className="text-gray-500 dark:text-slate-400">{r.day}</span>
                  {(['h08', 'h10', 'h12', 'h14', 'h16'] as const).map((k) => {
                    const v = r[k];
                    return (
                      <div key={k} className="h-7 rounded-md flex items-center justify-center text-[10px] text-white" style={{ backgroundColor: `rgba(79,70,229,${Math.min(0.15 + v / 55, 0.95)})` }}>
                        {v}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {allowedSections.includes('insurance') && (
          <div className="premium-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 dark:text-slate-50">Insurance Analytics</h3>
              <Button size="sm" variant="ghost" onClick={() => openDetails('Insurance Analytics')}>View Details</Button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm text-slate-900 dark:text-slate-200">
              <div className="p-3 rounded-lg bg-blue-50 border border-blue-100 dark:border-slate-700 dark:bg-slate-800/60">Claims submitted: <strong>{summary.insurance_claims}</strong></div>
              <div className="p-3 rounded-lg bg-green-50 border border-green-100 dark:border-slate-700 dark:bg-slate-800/60">Approval rate: <strong>78%</strong></div>
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-100 dark:border-slate-700 dark:bg-slate-800/60">Avg processing: <strong>5.4 days</strong></div>
              <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100 dark:border-slate-700 dark:bg-slate-800/60">Insurance revenue: <strong>₦{Math.round(summary.revenue * 0.41).toLocaleString()}</strong></div>
            </div>
          </div>
        )}
      </div>

      <div className="premium-card p-5">
        <h3 className="font-semibold text-gray-900 mb-3 dark:text-slate-50">Automations & Government Reporting</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => toast.success('Daily summary report queued (email)')}>Daily summary report</Button>
          <Button variant="outline" size="sm" onClick={() => toast.success('Weekly performance insights generated')}>Weekly insights</Button>
          <Button variant="outline" size="sm" onClick={() => toast.warning('Alert: Revenue drop detected in current range')}>Revenue drop alert</Button>
          <Button variant="outline" size="sm" onClick={() => toast.warning('Alert: High no-show trends detected')}>No-show alert</Button>
          <Button variant="outline" size="sm" onClick={() => toast.warning('Alert: Pharmacy low stock trend rising')}>Low stock alert</Button>
          <Button variant="outline" size="sm" onClick={() => toast.success('Government reporting package generated')}>Government export mode</Button>
          <Button variant="outline" size="sm" onClick={() => toast.success('VitaLink Network comparison view initialized')}>Multi-hospital analytics</Button>
          <Button variant="outline" size="sm" onClick={() => toast.success('Predictive forecast generated')}>Predictive analytics</Button>
          <Button variant="outline" size="sm" onClick={() => toast.success(`Custom dashboard saved for ${userName}`)}>Save custom dashboard</Button>
        </div>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="glass-panel border-white/60 max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detailTitle}</DialogTitle>
            <DialogDescription>Drill-down analytics with breakdown, filters, and time trends.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm text-slate-900 dark:text-slate-200">
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-slate-800/60">Time range: <strong>{dateRange}</strong></div>
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-slate-800/60">Current scope: <strong>{searchScope}</strong></div>
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-slate-800/60">Use this drill-down to filter by department, clinician, status, and trend horizon.</div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
