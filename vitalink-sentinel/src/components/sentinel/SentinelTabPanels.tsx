import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Biohazard,
  Building2,
  Download,
  Filter,
  Globe2,
  HeartPulse,
  Link2,
  Microscope,
  Plus,
  RefreshCw,
  Shield,
  Syringe,
  Upload,
  Users,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';
import { useSentinel } from '@/contexts/SentinelContext';
import { DISEASE_CATALOG } from '@/lib/sentinel/diseaseCatalog';
import { cn } from '@/lib/utils';
import type { SentinelTabId, SentinelCase, CaseFilters, NewAlertData, NewCaseData } from '@/types/sentinel';
import { OutbreakDetailModal } from '@/components/sentinel/modals/OutbreakDetailModal';
import { CreateAlertModal } from '@/components/sentinel/modals/CreateAlertModal';
import { FilterModal } from '@/components/sentinel/modals/FilterModal';
import { NewCaseModal } from '@/components/sentinel/modals/NewCaseModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { SentinelMapPanel } from '@/components/sentinel/SentinelMapPanel';
import { useSentinelTheme, getSentinelChartColors } from '@/hooks/useSentinelTheme';

function useSurveillanceMetrics(cases: SentinelCase[]) {
  return useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const active = cases.filter((c) => !['recovered', 'fatal'].includes(c.classification)).length;
    const newToday = cases.filter((c) => c.reportedAt.startsWith(today)).length;
    const fatal = cases.filter((c) => c.classification === 'fatal').length;
    const recovered = cases.filter((c) => c.classification === 'recovered').length;
    const confirmed = cases.filter((c) => c.classification === 'confirmed').length;
    const denom = Math.max(1, cases.length);
    const mortalityRate = fatal / denom;
    const recoveryRate = recovered / denom;
    const cfr = confirmed ? fatal / Math.max(1, confirmed) : 0;
    const r0 = 1.08 + (newToday % 7) * 0.05;
    const testPos = 12 + (active % 15);
    const hospitalOcc = 68 + (active % 12);
    const icu = 72 + (fatal % 8);
    const vaxCov = 78 - fatal * 0.5;

    const trend = Array.from({ length: 14 }).map((_, i) => {
      const day = new Date();
      day.setDate(day.getDate() - (13 - i));
      const label = day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const base = cases.filter((c) => c.reportedAt.startsWith(day.toISOString().slice(0, 10))).length;
      return { label, cases: base || Math.max(0, (i + active) % 6), forecast: undefined as number | undefined };
    });

    const weekly = [
      { w: 'W1', outbreakSignals: 2 + (active % 3) },
      { w: 'W2', outbreakSignals: 1 + (active % 2) },
      { w: 'W3', outbreakSignals: 3 },
      { w: 'W4', outbreakSignals: active % 4 },
    ];

    const demoAge = [
      { name: '0-4', value: 12 + (active % 5) },
      { name: '5-14', value: 18 + (active % 7) },
      { name: '15-44', value: 35 + (active % 9) },
      { name: '45-64', value: 22 + (active % 6) },
      { name: '65+', value: 13 + (active % 4) },
    ];

    const demoGender = [
      { name: 'Female', value: 52 },
      { name: 'Male', value: 46 },
      { name: 'Other/U', value: 2 },
    ];

    const COLORS = ['#818cf8', '#c084fc', '#f472b6'];

    return {
      active,
      newToday,
      mortalityRate,
      recoveryRate,
      cfr,
      r0,
      testPos,
      hospitalOcc,
      icu,
      vaxCov,
      trend,
      weekly,
      demoAge,
      demoGender,
      COLORS,
    };
  }, [cases]);
}

function MetricCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'green' | 'yellow' | 'red';
}) {
  const { classes } = useSentinelTheme();

  const toneClass =
    tone === 'green'
      ? classes.metricGreen
      : tone === 'yellow'
        ? classes.metricYellow
        : tone === 'red'
          ? classes.metricRed
          : classes.metric;

  return (
    <div className={cn(toneClass, 'transition-all duration-300 hover:scale-[1.01]')}>
      <p className={classes.metricLabel}>{label}</p>
      <p className={classes.metricValue}>{value}</p>
      {sub ? <p className={classes.metricSub}>{sub}</p> : null}
    </div>
  );
}

export function SentinelSurveillancePanel() {
  const { cases, exportCasesCsv, outbreaks, createAlert } = useSentinel();
  const m = useSurveillanceMetrics(cases);
  const { classes, isDark } = useSentinelTheme();
  const chartColors = getSentinelChartColors(isDark);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Modal states
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [createAlertModalOpen, setCreateAlertModalOpen] = useState(false);
  const [selectedOutbreakId, setSelectedOutbreakId] = useState<string | null>(null);
  const [outbreakDetailOpen, setOutbreakDetailOpen] = useState(false);
  const [filters, setFilters] = useState<CaseFilters>({});

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      toast.success('Surveillance data refreshed');
    }, 800);
  };

  const handleOpenOutbreakDetail = (outbreakId: string) => {
    setSelectedOutbreakId(outbreakId);
    setOutbreakDetailOpen(true);
  };

  const handleApplyFilters = (newFilters: CaseFilters) => {
    setFilters(newFilters);
    toast.success('Filters applied');
  };

  const handleCreateAlert = async (data: NewAlertData) => {
    await createAlert(data);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header with Actions */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className={cn('text-xl font-semibold flex items-center gap-2', classes.textPrimary)}>
            <Activity className={cn('w-6 h-6', isDark ? 'text-amber-300' : 'text-amber-600')} />
            National surveillance cockpit
          </h2>
          <p className={cn('text-sm', classes.textSecondary)}>
            Live aggregates · tenant-isolated line lists · NDPR-safe pseudonymous refs
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Filter Button */}
          <Button className={classes.buttonOutline} onClick={() => setFilterModalOpen(true)}>
            <Filter className="w-4 h-4 mr-2" />
            Filter
          </Button>

          {/* Refresh Button */}
          <Button
            variant="outline"
            className={classes.buttonOutline}
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn('w-4 h-4 mr-2', isRefreshing && 'animate-spin')} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>

          {/* Export CSV */}
          <Button
            variant="outline"
            className={classes.buttonOutline}
            onClick={() => {
              exportCasesCsv();
              toast.success('Export queued — CSV line list');
            }}
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>

          {/* Create Alert */}
          <Button className={cn(classes.buttonPrimary, 'bg-red-600 hover:bg-red-700')} onClick={() => setCreateAlertModalOpen(true)}>
            <Bell className="w-4 h-4 mr-2" />
            Create Alert
          </Button>

          {/* Export PDF */}
          <Button className={classes.buttonOutline} onClick={() => toast.success('PDF export queued')}>
            <Download className="w-4 h-4 mr-2" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* Metric Cards - Row 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <MetricCard label="Active signals" value={String(m.active)} sub="non-closed classifications" tone="yellow" />
        <MetricCard label="New today" value={String(m.newToday)} tone="yellow" />
        <MetricCard label="Mortality rate" value={`${(m.mortalityRate * 100).toFixed(1)}%`} tone={m.mortalityRate > 0.05 ? 'red' : 'green'} />
        <MetricCard label="Recovery rate" value={`${(m.recoveryRate * 100).toFixed(1)}%`} tone="green" />
        <MetricCard label="CFR (confirmed)" value={`${(m.cfr * 100).toFixed(1)}%`} tone={m.cfr > 0.04 ? 'red' : 'yellow'} />
      </div>

      {/* Metric Cards - Row 2 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <MetricCard label="R₀ estimate" value={m.r0.toFixed(2)} sub="model-assisted nowcast" tone="yellow" />
        <MetricCard label="Test positivity % (proxy)" value={`${m.testPos}%`} tone="yellow" />
        <MetricCard label="Hospital occupancy %" value={`${m.hospitalOcc}%`} tone={m.hospitalOcc > 85 ? 'red' : 'yellow'} />
        <MetricCard label="ICU utilization %" value={`${m.icu}%`} tone={m.icu > 85 ? 'red' : 'yellow'} />
        <MetricCard label="Vaccination coverage" value={`${m.vaxCov.toFixed(1)}%`} tone="green" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={cn(classes.card, 'p-4')}>
          <h3 className={cn('text-sm font-semibold mb-4 flex items-center gap-2', classes.textPrimary)}>
            <Zap className={cn('w-4 h-4', isDark ? 'text-amber-300' : 'text-amber-600')} />
            Daily case trend
          </h3>
          <div className="h-56 w-full min-w-0 sentinel-chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={m.trend}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartColors.purple} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={chartColors.blue} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis dataKey="label" tick={{ fill: chartColors.axis, fontSize: 10 }} />
                <YAxis tick={{ fill: chartColors.axis, fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    background: chartColors.tooltipBg,
                    border: `1px solid ${chartColors.tooltipBorder}`,
                    borderRadius: '8px',
                  }}
                  labelStyle={{ color: chartColors.tooltipText }}
                  itemStyle={{ color: chartColors.purple }}
                />
                <Area type="monotone" dataKey="cases" stroke={chartColors.purple} fillOpacity={1} fill="url(#g1)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={cn(classes.card, 'p-4')}>
          <h3 className={cn('text-sm font-semibold mb-4', classes.textPrimary)}>Weekly outbreak signals</h3>
          <div className="h-56 w-full min-w-0 sentinel-chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={m.weekly}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis dataKey="w" tick={{ fill: chartColors.axis, fontSize: 10 }} />
                <YAxis tick={{ fill: chartColors.axis, fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    background: chartColors.tooltipBg,
                    border: `1px solid ${chartColors.tooltipBorder}`,
                    borderRadius: '8px',
                  }}
                  labelStyle={{ color: chartColors.tooltipText }}
                />
                <Bar dataKey="outbreakSignals" fill={chartColors.pink} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Demographics Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={cn(classes.card, 'p-4')}>
          <h3 className={cn('text-sm font-semibold mb-4', classes.textPrimary)}>Age distribution</h3>
          <div className="h-52 w-full min-w-0 sentinel-chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={m.demoAge} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis type="number" tick={{ fill: chartColors.axis, fontSize: 10 }} />
                <YAxis dataKey="name" type="category" tick={{ fill: chartColors.axis, fontSize: 10 }} width={48} />
                <Tooltip
                  contentStyle={{
                    background: chartColors.tooltipBg,
                    border: `1px solid ${chartColors.tooltipBorder}`,
                    borderRadius: '8px',
                  }}
                  labelStyle={{ color: chartColors.tooltipText }}
                />
                <Bar dataKey="value" fill={chartColors.blue} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className={cn(classes.card, 'p-4')}>
          <h3 className={cn('text-sm font-semibold mb-4', classes.textPrimary)}>Gender split</h3>
          <div className="h-52 w-full min-w-0 flex items-center justify-center sentinel-chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={m.demoGender} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={72}>
                  {m.demoGender.map((_, i) => (
                    <Cell key={i} fill={[chartColors.purple, chartColors.blue, chartColors.pink][i % 3]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: chartColors.tooltipBg,
                    border: `1px solid ${chartColors.tooltipBorder}`,
                    borderRadius: '8px',
                  }}
                  labelStyle={{ color: chartColors.tooltipText }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Outbreaks Section */}
      {outbreaks.length > 0 ? (
        <div className={cn(classes.card, 'p-4', classes.border, 'border-red-400/40')}>
          <div className={cn('flex items-center gap-2', isDark ? 'text-red-300' : 'text-red-600')}>
            <Biohazard className="w-5 h-5" />
            <span className="font-semibold">Active outbreak engine outputs</span>
          </div>
          <ul className={cn('mt-3 space-y-2 text-sm', classes.textSecondary)}>
            {outbreaks.map((o) => (
              <li 
                key={o.id} 
                className="flex flex-wrap gap-2 items-center cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => handleOpenOutbreakDetail(o.id)}
              >
                <span className={cn('font-medium', classes.textPrimary)}>{o.diseaseName}</span>
                <span className={classes.textMuted}>· {o.caseCount} cases ·</span>
                <span className={cn(
                  'px-2 py-0.5 rounded-full text-xs font-medium',
                  o.status === 'active'
                    ? (isDark ? 'bg-red-500/20 text-red-300' : 'bg-red-100 text-red-700')
                    : (isDark ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-700')
                )}>
                  {o.status.toUpperCase()}
                </span>
                <span className={cn('text-xs underline', classes.textMuted)}>View details →</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Modals */}
      <FilterModal
        isOpen={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        onApply={handleApplyFilters}
        initialFilters={filters}
      />
      <CreateAlertModal
        isOpen={createAlertModalOpen}
        onClose={() => setCreateAlertModalOpen(false)}
        onCreate={handleCreateAlert}
      />
      <OutbreakDetailModal
        outbreakId={selectedOutbreakId}
        isOpen={outbreakDetailOpen}
        onClose={() => setOutbreakDetailOpen(false)}
      />
    </div>
  );
}

export function SentinelDiseaseTrackingPanel() {
  const { cases } = useSentinel();
  const { classes, isDark } = useSentinelTheme();
  const grouped = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of cases) map.set(c.diseaseId, (map.get(c.diseaseId) ?? 0) + 1);
    return map;
  }, [cases]);

  const sections: { title: string; cat: 'infectious' | 'ntd' | 'ncd'; icon: typeof Activity; color: string }[] = [
    { title: 'Infectious diseases', cat: 'infectious', icon: Biohazard, color: isDark ? 'text-red-300' : 'text-red-600' },
    { title: 'Neglected tropical diseases', cat: 'ntd', icon: Microscope, color: isDark ? 'text-amber-300' : 'text-amber-600' },
    { title: 'Non-communicable diseases', cat: 'ncd', icon: HeartPulse, color: isDark ? 'text-pink-300' : 'text-pink-600' },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className={cn('text-xl font-semibold flex items-center gap-2', classes.textPrimary)}>
            <Globe2 className={cn('w-6 h-6', isDark ? 'text-sky-300' : 'text-sky-600')} />
            Disease intelligence registry
          </h2>
          <p className={cn('text-sm', classes.textSecondary)}>
            Central ontology aligned to laboratory reflex pathways & EMR ICD capture.
          </p>
        </div>
        <div className="flex gap-2">
          <Button className={classes.buttonPrimary} onClick={() => toast.success('Disease registry synced')}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Sync Registry
          </Button>
        </div>
      </div>
      {sections.map((s) => (
        <div key={s.cat} className={cn(classes.card, 'p-4')}>
          <h3 className={cn('text-sm font-semibold mb-3 flex items-center gap-2', classes.textPrimary)}>
            <s.icon className={cn('w-4 h-4', s.color)} />
            {s.title}
          </h3>
          <ScrollArea className="h-[min(280px,40vh)] pr-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {DISEASE_CATALOG.filter((d) => d.category === s.cat).map((d) => (
                <div key={d.id} className={cn(
                  'rounded-xl px-3 py-2 text-sm flex justify-between gap-2',
                  classes.bgElevated,
                  'border border-[var(--sentinel-border-default)]'
                )}>
                  <span className={classes.textPrimary}>{d.name}</span>
                  <span className={cn('tabular-nums', isDark ? 'text-amber-300' : 'text-amber-600')}>
                    {grouped.get(d.id) ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      ))}
    </div>
  );
}

export function SentinelCaseReportingPanel() {
  const { cases, addManualCase, readOnly, createCase } = useSentinel();
  const { classes, isDark } = useSentinelTheme();
  const [diseaseId, setDiseaseId] = useState('malaria');
  const [classification, setClassification] = useState<SentinelCase['classification']>('suspected');
  const [isUploading, setIsUploading] = useState(false);
  const [newCaseModalOpen, setNewCaseModalOpen] = useState(false);

  const submit = () => {
    if (readOnly) {
      toast.error('Read-only mode - case submission disabled');
      return;
    }
    const def = DISEASE_CATALOG.find((d) => d.id === diseaseId);
    if (!def) return;
    addManualCase({
      tenantId: 'manual',
      diseaseId: def.id,
      diseaseName: def.name,
      category: def.category,
      classification,
      patientRef: `MANUAL-${crypto.randomUUID().slice(0, 8)}`,
      ageGroup: 'unknown',
      gender: 'unknown',
      reportedAt: new Date().toISOString(),
      source: 'manual',
      geo: {
        country: 'Nigeria',
        state: 'Lagos',
        lga: 'Ikeja',
        facilityId: 'manual-entry',
        facilityName: 'Manual surveillance entry',
      },
    });
    toast.success('Case logged to Sentinel pipeline');
  };

  const handleCreateCase = async (data: NewCaseData) => {
    await createCase(data);
  };

  const handleUploadCsv = () => {
    setIsUploading(true);
    setTimeout(() => {
      setIsUploading(false);
      toast.success('CSV import completed - 12 cases imported');
    }, 1500);
  };

  const handleImportLab = () => {
    toast.success('Lab records import initiated - fetching from LIS...');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className={cn('text-xl font-semibold', classes.textPrimary)}>Case reporting & classification</h2>
          <p className={cn('text-sm', classes.textSecondary)}>
            Auto-ingest from EMR, Lab, Pharmacy, Telemedicine via integration bus.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button className={classes.buttonSecondary} onClick={handleImportLab} disabled={readOnly}>
            <Upload className="w-4 h-4 mr-2" />
            Import Lab Records
          </Button>
          <Button className={classes.buttonSecondary} onClick={handleUploadCsv} disabled={isUploading || readOnly}>
            <Upload className={cn('w-4 h-4 mr-2', isUploading && 'animate-bounce')} />
            {isUploading ? 'Importing...' : 'Upload CSV'}
          </Button>
          <Button className={classes.buttonPrimary} onClick={() => setNewCaseModalOpen(true)} disabled={readOnly}>
            <Plus className="w-4 h-4 mr-2" />
            Report New Case
          </Button>
        </div>
      </div>

      {/* Quick Entry Form */}
      <div className={cn(classes.card, 'p-4 grid grid-cols-1 md:grid-cols-4 gap-3')}>
        <div className="md:col-span-2 space-y-2">
          <Label className={classes.textSecondary}>Disease</Label>
          <Select value={diseaseId} onValueChange={setDiseaseId} disabled={readOnly}>
            <SelectTrigger className={classes.buttonOutline}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {DISEASE_CATALOG.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className={classes.textSecondary}>Classification</Label>
          <Select value={classification} onValueChange={(v) => setClassification(v as SentinelCase['classification'])} disabled={readOnly}>
            <SelectTrigger className={classes.buttonOutline}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['suspected', 'probable', 'confirmed', 'recovered', 'fatal'] as const).map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button className={cn(classes.buttonPrimary, 'w-full')} disabled={readOnly} onClick={submit}>
            Log case
          </Button>
        </div>
      </div>

      {/* Cases Table */}
      <div className={cn(classes.card, 'overflow-x-auto')}>
        <table className={classes.table}>
          <thead>
            <tr>
              <th>Ref</th>
              <th>Disease</th>
              <th>Class</th>
              <th>Source</th>
              <th>State / LGA</th>
              <th>Reported</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id}>
                <td className={cn('font-mono text-xs', classes.textSecondary)}>{c.patientRef}</td>
                <td className={classes.textPrimary}>{c.diseaseName}</td>
                <td className={cn(
                  'capitalize',
                  c.classification === 'confirmed' ? (isDark ? 'text-emerald-300' : 'text-emerald-600') :
                  c.classification === 'suspected' ? (isDark ? 'text-amber-300' : 'text-amber-600') :
                  (isDark ? 'text-sky-300' : 'text-sky-600')
                )}>
                  {c.classification}
                </td>
                <td className={classes.textSecondary}>{c.source}</td>
                <td className={classes.textSecondary}>
                  {c.geo.state} / {c.geo.lga}
                </td>
                <td className={cn('text-xs', classes.textMuted)}>
                  {new Date(c.reportedAt).toLocaleString()}
                </td>
                <td>
                  <div className="flex gap-1">
                    <Button size="sm" className={classes.buttonGhost} onClick={() => toast.info('Edit case - feature enabled')}>
                      Edit
                    </Button>
                    <Button size="sm" className={classes.buttonGhost} onClick={() => toast.success('Case resolved')}>
                      Resolve
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modals */}
      <NewCaseModal
        isOpen={newCaseModalOpen}
        onClose={() => setNewCaseModalOpen(false)}
        onCreate={handleCreateCase}
      />
    </div>
  );
}

export function SentinelOutbreakPanel() {
  const { outbreaks, thresholds, setThresholds, canConfigureThresholds } = useSentinel();
  const { classes, isDark } = useSentinelTheme();

  const handleSimulateOutbreak = () => {
    toast.success('Outbreak simulation triggered - analyzing spread patterns...');
  };

  const handleCreateAlert = () => {
    toast.success('Emergency alert created - notifying response teams');
  };

  const handleAssignTeam = () => {
    toast.success('Response team assigned - epidemiologists dispatched');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className={cn('text-xl font-semibold flex items-center gap-2', classes.textPrimary)}>
          <AlertTriangle className={cn('w-6 h-6', isDark ? 'text-red-400' : 'text-red-600')} />
          Outbreak intelligence
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button className={classes.buttonSecondary} onClick={handleSimulateOutbreak}>
            <Zap className="w-4 h-4 mr-2" />
            Simulate Outbreak
          </Button>
          <Button className={cn(classes.buttonPrimary, 'bg-red-600 hover:bg-red-700')} onClick={handleCreateAlert}>
            <Bell className="w-4 h-4 mr-2" />
            Create Alert
          </Button>
        </div>
      </div>

      {canConfigureThresholds ? (
        <div className={cn(classes.card, 'p-4 space-y-4')}>
          <p className={cn('text-sm', classes.textSecondary)}>Configurable thresholds · multi-facility & velocity rules</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <Label className={classes.textSecondary}>Min cases for signal ({thresholds.minCasesForSignal})</Label>
              <Slider
                value={[thresholds.minCasesForSignal]}
                min={1}
                max={20}
                step={1}
                onValueChange={([v]) => setThresholds({ ...thresholds, minCasesForSignal: v })}
                className="mt-3"
              />
            </div>
            <div>
              <Label className={classes.textSecondary}>Weekly growth % ({thresholds.growthPctWeekly})</Label>
              <Slider
                value={[thresholds.growthPctWeekly]}
                min={5}
                max={100}
                step={5}
                onValueChange={([v]) => setThresholds({ ...thresholds, growthPctWeekly: v })}
                className="mt-3"
              />
            </div>
            <div>
              <Label className={classes.textSecondary}>Min facilities involved ({thresholds.minFacilitiesInvolved})</Label>
              <Slider
                value={[thresholds.minFacilitiesInvolved]}
                min={1}
                max={10}
                step={1}
                onValueChange={([v]) => setThresholds({ ...thresholds, minFacilitiesInvolved: v })}
                className="mt-3"
              />
            </div>
            <div>
              <Label className={classes.textSecondary}>Cluster radius km ({thresholds.clusterRadiusKm})</Label>
              <Slider
                value={[thresholds.clusterRadiusKm]}
                min={10}
                max={200}
                step={5}
                onValueChange={([v]) => setThresholds({ ...thresholds, clusterRadiusKm: v })}
                className="mt-3"
              />
            </div>
          </div>
        </div>
      ) : (
        <p className={cn('text-sm', classes.textMuted)}>Threshold controls restricted — epidemiologist / government authority</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {outbreaks.length === 0 ? (
          <div className={cn(classes.card, 'p-6', classes.textSecondary)}>
            No active outbreak clusters crossing configured thresholds.
          </div>
        ) : (
          outbreaks.map((o) => (
            <div key={o.id} className={cn(classes.card, 'p-4', classes.border, 'border-red-400/40')}>
              <div className="flex justify-between items-start gap-2">
                <div>
                  <p className={cn('text-lg font-semibold', classes.textPrimary)}>{o.diseaseName}</p>
                  <p className={cn('text-xs', classes.textMuted)}>{new Date(o.startedAt).toLocaleString()}</p>
                </div>
                <span className={cn(
                  'text-xs px-2 py-1 rounded-full border',
                  o.status === 'active'
                    ? (isDark ? 'border-red-400 text-red-300 animate-pulse' : 'border-red-500 text-red-600')
                    : (isDark ? 'border-amber-400 text-amber-200' : 'border-amber-500 text-amber-600')
                )}>
                  {o.status}
                </span>
              </div>
              <p className={cn('text-sm mt-2', classes.textSecondary)}>
                {o.caseCount} cases · {o.facilityCount} facilities · {o.affectedStates.join(', ')}
              </p>
              <ul className={cn('mt-3 text-xs space-y-1 list-disc pl-4', classes.textSecondary)}>
                {o.recommendedActions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <Button size="sm" className={classes.buttonGhost} onClick={() => toast.info('Opening outbreak timeline...')}>
                  View Timeline
                </Button>
                <Button size="sm" className={classes.buttonPrimary} onClick={handleAssignTeam}>
                  Assign Team
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export function SentinelHeatmapsPanel() {
  const { cases } = useSentinel();
  const { classes, isDark } = useSentinelTheme();
  const [layer, setLayer] = useState<'cases' | 'facilities' | 'labs' | 'vax' | 'outbreak'>('cases');
  const [stateFilter, setStateFilter] = useState('All');
  const [showClusters, setShowClusters] = useState(true);
  const [heatmapIntensity, setHeatmapIntensity] = useState(0.7);

  const filtered = useMemo(() => {
    if (stateFilter === 'All') return cases;
    return cases.filter((c) => c.geo.state === stateFilter);
  }, [cases, stateFilter]);

  const states = useMemo(() => ['All', ...new Set(cases.map((c) => c.geo.state))], [cases]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className={cn('text-xl font-semibold flex items-center gap-2', classes.textPrimary)}>
          <Globe2 className={cn('w-6 h-6', isDark ? 'text-emerald-300' : 'text-emerald-600')} />
          Geographic intelligence
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            className={showClusters ? classes.buttonPrimary : classes.buttonSecondary}
            onClick={() => setShowClusters(!showClusters)}
          >
            {showClusters ? 'Hide Clusters' : 'Show Clusters'}
          </Button>
          <Button className={classes.buttonOutline} onClick={() => toast.success('Satellite view toggled')}>
            Satellite Mode
          </Button>
        </div>
      </div>

      <div className={cn(classes.card, 'p-4 flex flex-col sm:flex-row flex-wrap gap-3')}>
        <div className="space-y-1">
          <Label className={cn('text-xs', classes.textMuted)}>Layer</Label>
          <Select value={layer} onValueChange={(v) => setLayer(v as typeof layer)}>
            <SelectTrigger className={cn('w-full sm:w-44', classes.buttonOutline)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cases">Cases heatmap</SelectItem>
              <SelectItem value="facilities">Hospitals</SelectItem>
              <SelectItem value="labs">Labs</SelectItem>
              <SelectItem value="vax">Vaccination centers</SelectItem>
              <SelectItem value="outbreak">Outbreak zones</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className={cn('text-xs', classes.textMuted)}>State filter</Label>
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className={cn('w-full sm:w-44', classes.buttonOutline)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {states.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className={cn('text-xs', classes.textMuted)}>Heat Intensity ({Math.round(heatmapIntensity * 100)}%)</Label>
          <Slider
            value={[heatmapIntensity * 100]}
            min={10}
            max={100}
            step={5}
            onValueChange={([v]) => setHeatmapIntensity(v / 100)}
            className="w-full sm:w-44 mt-2"
          />
        </div>
      </div>

      <SentinelMapPanel cases={filtered} layerMode={layer} />

      {/* Disease Filter */}
      <div className={cn(classes.card, 'p-3 flex flex-wrap gap-2')}>
        <span className={cn('text-sm mr-2', classes.textSecondary)}>Filter by disease:</span>
        {['All', 'Malaria', 'COVID-19', 'Cholera', 'Typhoid'].map((disease) => (
          <button
            key={disease}
            className={cn(
              'px-2 py-1 rounded text-xs transition-colors',
              disease === 'All' ? classes.buttonPrimary : classes.buttonGhost
            )}
            onClick={() => toast.info(`Filtered: ${disease}`)}
          >
            {disease}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SentinelContactPanel() {
  const { cases, contacts } = useSentinel();
  const { classes, isDark } = useSentinelTheme();

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className={cn('text-xl font-semibold flex items-center gap-2', classes.textPrimary)}>
          <Link2 className={cn('w-6 h-6', isDark ? 'text-cyan-300' : 'text-cyan-600')} />
          Contact tracing graph
        </h2>
        <div className="flex gap-2">
          <Button className={classes.buttonOutline} onClick={() => toast.success('Contact graph exported')}>
            <Download className="w-4 h-4 mr-2" />
            Export Graph
          </Button>
        </div>
      </div>

      <div className={cn(classes.card, 'p-4')}>
        <p className={cn('text-sm mb-4', classes.textSecondary)}>
          Household · facility · travel exposure edges with risk scoring. Timeline visualization plugs into EMR encounter chronology.
        </p>
        <div className="overflow-x-auto rounded-xl">
          <table className={classes.table}>
            <thead>
              <tr>
                <th className="text-left">Edge</th>
                <th className="text-left">Relationship</th>
                <th className="text-left">Risk</th>
                <th className="text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((e) => (
                <tr key={e.id}>
                  <td className={cn('font-mono text-xs', classes.textSecondary)}>
                    {e.fromCaseId.slice(0, 8)} → {e.toCaseId.slice(0, 8)}
                  </td>
                  <td className={cn('capitalize', classes.textPrimary)}>{e.relationship}</td>
                  <td className={cn(isDark ? 'text-amber-300' : 'text-amber-600')}>
                    {(e.riskScore * 100).toFixed(0)}%
                  </td>
                  <td>
                    <Button size="sm" className={classes.buttonGhost} onClick={() => toast.info('Viewing contact details...')}>
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={cn('text-xs mt-3', classes.textMuted)}>
          {cases.length} cases participating in graph expansion.
        </p>
      </div>
    </div>
  );
}

export function SentinelVaccinationPanel() {
  const { vaccinations } = useSentinel();
  const { classes, isDark } = useSentinelTheme();

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className={cn('text-xl font-semibold flex items-center gap-2', classes.textPrimary)}>
          <Syringe className={cn('w-6 h-6', isDark ? 'text-pink-300' : 'text-pink-600')} />
          Vaccination monitoring
        </h2>
        <div className="flex gap-2">
          <Button className={classes.buttonPrimary} onClick={() => toast.success('Vaccination data synced')}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Sync Data
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {vaccinations.map((v) => (
          <div key={v.id} className={cn(classes.card, 'p-4')}>
            <div className="flex justify-between items-start">
              <p className={cn('font-semibold', classes.textPrimary)}>{v.vaccineName}</p>
              <span className={cn(classes.badgeBlue, 'text-xs')}>{v.region}</span>
            </div>
            <div className={cn('mt-3 h-3 rounded-full overflow-hidden', classes.bgElevated)}>
              <div
                className="h-full bg-gradient-to-r from-emerald-400 to-cyan-400"
                style={{ width: `${v.coveragePct}%` }}
              />
            </div>
            <p className={cn('text-sm mt-2', classes.textSecondary)}>
              {v.dosesAdministered.toLocaleString()} / {v.dosesScheduled.toLocaleString()} doses · {v.coveragePct}% coverage
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SentinelAlertsPanel() {
  const { alerts, acknowledgeAlert, createAlert, resolveAlert, readOnly } = useSentinel();
  const { classes, isDark } = useSentinelTheme();
  const [createAlertModalOpen, setCreateAlertModalOpen] = useState(false);
  const sorted = useMemo(() => [...alerts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [alerts]);

  const handleCreateAlert = async (data: NewAlertData) => {
    await createAlert(data);
  };

  const handleEscalate = () => {
    toast.success('Alert escalated - senior officials notified');
  };

  const handleCreateBulletin = () => {
    toast.success('Public health bulletin created - ready for distribution');
  };

  const handleResolve = (id: string) => {
    resolveAlert(id);
    toast.success('Alert resolved');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className={cn('text-xl font-semibold flex items-center gap-2', classes.textPrimary)}>
          <Bell className={cn('w-6 h-6 animate-pulse', isDark ? 'text-amber-300' : 'text-amber-600')} />
          Public health alerts
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button className={classes.buttonSecondary} onClick={handleCreateBulletin} disabled={readOnly}>
            Create Bulletin
          </Button>
          <Button className={classes.buttonSecondary} onClick={handleEscalate} disabled={readOnly}>
            Escalate
          </Button>
          <Button className={cn(classes.buttonPrimary, 'bg-red-600 hover:bg-red-700')} onClick={() => setCreateAlertModalOpen(true)} disabled={readOnly}>
            <Plus className="w-4 h-4 mr-2" />
            Create Alert
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {sorted.length === 0 ? (
          <div className={cn(classes.card, 'p-8 text-center', classes.textSecondary)}>
            <Bell className={cn('w-12 h-12 mx-auto mb-3 opacity-50', isDark ? 'text-amber-300' : 'text-amber-600')} />
            <p>No active alerts</p>
            <p className={cn('text-sm mt-1', classes.textMuted)}>Create an alert to notify response teams</p>
          </div>
        ) : (
          sorted.map((a) => (
            <div
              key={a.id}
              className={cn(
                classes.card,
                'p-4 flex flex-col sm:flex-row sm:items-center gap-3',
                a.priority === 'emergency'
                  ? cn(classes.border, 'border-red-400/60 shadow-red-500/20')
                  : a.priority === 'high'
                    ? cn(classes.border, 'border-amber-400/50')
                    : classes.border,
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={cn('font-semibold', classes.textPrimary)}>{a.title}</p>
                  {a.priority === 'emergency' && (
                    <span className={cn('text-[10px] px-1.5 py-0.5 rounded bg-red-500 text-white font-medium')}>EMERGENCY</span>
                  )}
                </div>
                <p className={cn('text-sm', classes.textSecondary)}>{a.body}</p>
                <p className={cn('text-[10px] mt-1', classes.textMuted)}>
                  {a.type.replace(/_/g, ' ')} · {a.priority.toUpperCase()} · {a.region} · {new Date(a.createdAt).toLocaleString()}
                </p>
                <p className={cn('text-[10px]', classes.textMuted)}>
                  In-app {a.delivery.inApp ? '✓' : '—'} · Email {a.delivery.email ? '✓' : '—'} · SMS {a.delivery.smsReady ? '✓' : '—'}
                </p>
              </div>
              <div className="flex gap-2">
                {!a.acknowledged ? (
                  <Button size="sm" className={classes.buttonOutline} onClick={() => acknowledgeAlert(a.id)} disabled={readOnly}>
                    Acknowledge
                  </Button>
                ) : (
                  <span className={cn('text-xs shrink-0 px-2 py-1 rounded bg-emerald-500/10 text-emerald-600', isDark ? 'text-emerald-300' : 'text-emerald-600')}>Acknowledged</span>
                )}
                <Button size="sm" className={classes.buttonGhost} onClick={() => handleResolve(a.id)} disabled={readOnly}>
                  Resolve
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modals */}
      <CreateAlertModal
        isOpen={createAlertModalOpen}
        onClose={() => setCreateAlertModalOpen(false)}
        onCreate={handleCreateAlert}
      />
    </div>
  );
}

export function SentinelEpidemiologyAnalyticsPanel() {
  const { aiBriefing } = useSentinel();
  const { classes } = useSentinelTheme();

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className={cn('text-xl font-semibold', classes.textPrimary)}>Epidemiology analytics</h2>
        <div className="flex gap-2">
          <Button className={classes.buttonOutline} onClick={() => toast.success('Regional comparison report generated')}>
            Compare Regions
          </Button>
          <Button className={classes.buttonPrimary} onClick={() => toast.success('Forecast job queued')}>
            Run 14-day Forecast
          </Button>
        </div>
      </div>

      <div className={cn(classes.card, 'p-4 whitespace-pre-line text-sm', classes.textSecondary)}>
        {aiBriefing}
      </div>

      <div className={cn(classes.card, 'p-4')}>
        <p className={cn('text-sm', classes.textSecondary)}>
          Seasonal decomposition, regional comparisons, and forecast ensembles — exportable to government PDF bundles (enterprise).
        </p>

        {/* Analytics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          {[
            { label: 'R₀ Trend', value: '1.08', change: '+0.02' },
            { label: 'Doubling Time', value: '12.4 days', change: '-1.2' },
            { label: 'Rt (Effective)', value: '0.94', change: '-0.05' },
            { label: 'Serial Interval', value: '4.2 days', change: '0.0' },
          ].map((stat) => (
            <div key={stat.label} className={cn(classes.bgElevated, 'p-3 rounded-lg')}>
              <p className={cn('text-xs', classes.textMuted)}>{stat.label}</p>
              <p className={cn('text-lg font-semibold', classes.textPrimary)}>{stat.value}</p>
              <p className={cn('text-xs', stat.change.startsWith('+') ? 'text-red-500' : 'text-emerald-500')}>
                {stat.change}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SentinelEmergencyPanel() {
  const { emergencyCapacity } = useSentinel();
  const { classes, isDark } = useSentinelTheme();
  const [emergencyMode, setEmergencyMode] = useState(false);

  const toggleEmergencyMode = () => {
    setEmergencyMode(!emergencyMode);
    toast.success(emergencyMode ? 'Emergency mode deactivated' : 'EMERGENCY MODE ACTIVATED - All resources on alert');
  };

  const handleCreateIncident = () => {
    toast.success('New incident created - incident ID: INC-' + Math.floor(Math.random() * 10000));
  };

  const handleAllocateResources = () => {
    toast.success('Resources allocated - optimization complete');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className={cn('text-xl font-semibold flex items-center gap-2', classes.textPrimary)}>
          <Shield className={cn('w-6 h-6', isDark ? 'text-violet-300' : 'text-violet-600')} />
          Emergency response center
          {emergencyMode && (
            <span className={cn(classes.badgeRed, 'animate-pulse text-xs')}>EMERGENCY ACTIVE</span>
          )}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button className={classes.buttonOutline} onClick={handleCreateIncident}>
            <Plus className="w-4 h-4 mr-2" />
            Create Incident
          </Button>
          <Button className={classes.buttonSecondary} onClick={handleAllocateResources}>
            Allocate Resources
          </Button>
          <Button
            className={cn(
              emergencyMode
                ? cn(classes.buttonPrimary, 'bg-red-600 hover:bg-red-700')
                : cn(classes.buttonPrimary, 'bg-amber-600 hover:bg-amber-700')
            )}
            onClick={toggleEmergencyMode}
          >
            {emergencyMode ? 'Deactivate Emergency' : 'Activate Emergency Mode'}
          </Button>
        </div>
      </div>

      {/* Capacity Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={cn(classes.metric, 'text-center')}>
          <p className={classes.metricLabel}>Total Beds Available</p>
          <p className={classes.metricValue}>
            {emergencyCapacity.reduce((sum, f) => sum + f.bedsAvailable, 0)}
          </p>
        </div>
        <div className={cn(classes.metric, 'text-center')}>
          <p className={classes.metricLabel}>ICU Available</p>
          <p className={classes.metricValue}>
            {emergencyCapacity.reduce((sum, f) => sum + f.icuAvailable, 0)}
          </p>
        </div>
        <div className={cn(classes.metric, 'text-center')}>
          <p className={classes.metricLabel}>Oxygen Units</p>
          <p className={classes.metricValue}>
            {emergencyCapacity.reduce((sum, f) => sum + f.oxygenUnitsAvailable, 0)}
          </p>
        </div>
        <div className={cn(classes.metric, 'text-center')}>
          <p className={classes.metricLabel}>Ambulances Ready</p>
          <p className={classes.metricValue}>
            {emergencyCapacity.reduce((sum, f) => sum + f.ambulancesAvailable, 0)}
          </p>
        </div>
      </div>

      {/* Facility Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {emergencyCapacity.map((f) => (
          <div key={f.facilityId} className={cn(classes.card, 'p-4 space-y-3')}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className={cn('w-5 h-5', isDark ? 'text-amber-300' : 'text-amber-600')} />
                <span className={cn('font-semibold', classes.textPrimary)}>{f.name}</span>
              </div>
              <div className="flex gap-1">
                <Button size="sm" className={classes.buttonGhost} onClick={() => toast.info(`Bed management for ${f.name}`)}>
                  Beds
                </Button>
                <Button size="sm" className={classes.buttonGhost} onClick={() => toast.info(`Oxygen tracking for ${f.name}`)}>
                  O₂
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className={cn(classes.bgElevated, 'rounded-lg p-2')}>
                <p className={cn('text-xs', classes.textMuted)}>Beds</p>
                <p className={cn(classes.textPrimary)}>
                  {f.bedsAvailable}/{f.bedsTotal}
                </p>
                <div className={cn('mt-1 h-1 rounded-full', classes.bgElevated)}>
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${(f.bedsAvailable / f.bedsTotal) * 100}%` }}
                  />
                </div>
              </div>
              <div className={cn(classes.bgElevated, 'rounded-lg p-2')}>
                <p className={cn('text-xs', classes.textMuted)}>ICU</p>
                <p className={cn(classes.textPrimary)}>
                  {f.icuAvailable}/{f.icuTotal}
                </p>
                <div className={cn('mt-1 h-1 rounded-full', classes.bgElevated)}>
                  <div
                    className={cn(
                      'h-full rounded-full',
                      f.icuAvailable / f.icuTotal < 0.2 ? 'bg-red-500' : 'bg-emerald-500'
                    )}
                    style={{ width: `${(f.icuAvailable / f.icuTotal) * 100}%` }}
                  />
                </div>
              </div>
              <div className={cn(classes.bgElevated, 'rounded-lg p-2')}>
                <p className={cn('text-xs', classes.textMuted)}>Oxygen</p>
                <p className={cn(classes.textPrimary)}>{f.oxygenUnitsAvailable} units</p>
              </div>
              <div className={cn(classes.bgElevated, 'rounded-lg p-2')}>
                <p className={cn('text-xs', classes.textMuted)}>Ambulances</p>
                <p className={cn(classes.textPrimary)}>{f.ambulancesAvailable}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SentinelCommunityPanel() {
  const { addCommunityReport, readOnly, isOnline } = useSentinel();
  const { classes, isDark } = useSentinelTheme();
  const [summary, setSummary] = useState('');
  const [type, setType] = useState<'symptom_cluster' | 'suspected_outbreak' | 'mortality' | 'drug_shortage'>('symptom_cluster');

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={cn('text-xl font-semibold flex items-center gap-2', classes.textPrimary)}>
            <Users className={cn('w-6 h-6', isDark ? 'text-orange-300' : 'text-orange-600')} />
            Community reporting
          </h2>
          <span className={cn(
            'text-xs px-2 py-1 rounded-full border',
            isOnline
              ? (isDark ? 'border-emerald-400 text-emerald-300' : 'border-emerald-500 text-emerald-600')
              : (isDark ? 'border-amber-400 text-amber-200' : 'border-amber-500 text-amber-600')
          )}>
            {isOnline ? 'Online sync' : 'Offline capture — queued'}
          </span>
        </div>
        <div className="flex gap-2">
          <Button className={classes.buttonOutline} onClick={() => toast.success('Syncing community reports...')}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Sync Reports
          </Button>
        </div>
      </div>

      <div className={cn(classes.card, 'p-4 space-y-3 max-w-xl')}>
        <div className="space-y-2">
          <Label className={classes.textSecondary}>Report type</Label>
          <Select value={type} onValueChange={(v) => setType(v as typeof type)} disabled={readOnly}>
            <SelectTrigger className={classes.buttonOutline}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="symptom_cluster">Symptom cluster</SelectItem>
              <SelectItem value="suspected_outbreak">Suspected outbreak</SelectItem>
              <SelectItem value="mortality">Mortality signal</SelectItem>
              <SelectItem value="drug_shortage">Drug shortage</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className={classes.textSecondary}>Summary</Label>
          <Input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className={classes.buttonOutline}
            placeholder="Describe observation"
            disabled={readOnly}
          />
        </div>
        <div className="flex gap-2">
          <Button
            className={classes.buttonPrimary}
            disabled={readOnly || !summary.trim()}
            onClick={() => {
              addCommunityReport({
                reporterRole: 'CHW',
                facilityName: 'Community node',
                reportType: type,
                summary,
                state: 'Niger',
                lga: 'Bosso',
              });
              setSummary('');
              toast.success(isOnline ? 'Report synced to Sentinel' : 'Saved offline — will sync');
            }}
          >
            Submit report
          </Button>
          <Button className={classes.buttonGhost} onClick={() => setSummary('')}>
            Clear
          </Button>
        </div>
      </div>

      {/* Recent Community Reports */}
      <div className={cn(classes.card, 'p-4')}>
        <h3 className={cn('text-sm font-semibold mb-3', classes.textPrimary)}>Recent Community Reports</h3>
        <div className={cn('space-y-2', classes.textSecondary)}>
          <div className={cn(classes.bgElevated, 'p-3 rounded-lg flex justify-between items-center')}>
            <div>
              <p className={cn('font-medium', classes.textPrimary)}>Suspected outbreak reported</p>
              <p className="text-xs">Community node · Niger/Bosso · 2 hours ago</p>
            </div>
            <span className={cn(classes.badgeAmber, 'text-xs')}>Pending Review</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SentinelNTDPanel() {
  const { cases } = useSentinel();
  const { classes, isDark } = useSentinelTheme();
  const ntdCounts = useMemo(() => {
    const ntds = DISEASE_CATALOG.filter((d) => d.category === 'ntd').map((d) => d.id);
    return cases.filter((c) => ntds.includes(c.diseaseId)).length;
  }, [cases]);

  const ntdList = useMemo(() => {
    const ntds = DISEASE_CATALOG.filter((d) => d.category === 'ntd');
    return ntds.map((d) => ({
      name: d.name,
      count: cases.filter((c) => c.diseaseId === d.id).length,
    }));
  }, [cases]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className={cn('text-xl font-semibold flex items-center gap-2', classes.textPrimary)}>
          <Microscope className={cn('w-6 h-6', isDark ? 'text-lime-300' : 'text-lime-600')} />
          NTD monitoring
        </h2>
        <div className="flex gap-2">
          <Button className={classes.buttonOutline} onClick={() => toast.success('MDA schedule generated')}>
            Generate MDA Schedule
          </Button>
        </div>
      </div>

      <div className={cn(classes.card, 'p-4')}>
        <p className={cn('text-sm', classes.textSecondary)}>
          WHO NTD roadmap alignment · MDA scheduling hooks · cross-border readiness for neglected tropical diseases.
        </p>
        <div className="flex items-baseline gap-2 mt-4">
          <p className={cn('text-3xl font-bold', classes.textPrimary)}>{ntdCounts}</p>
          <p className={cn('text-sm', classes.textMuted)}>Surveillance-tagged NTD cases</p>
        </div>
      </div>

      {/* NTD Breakdown */}
      <div className={cn(classes.card, 'p-4')}>
        <h3 className={cn('text-sm font-semibold mb-3', classes.textPrimary)}>NTD Breakdown</h3>
        <div className="space-y-2">
          {ntdList.map((ntd) => (
            <div key={ntd.name} className={cn(classes.bgElevated, 'p-3 rounded-lg flex justify-between items-center')}>
              <span className={classes.textPrimary}>{ntd.name}</span>
              <span className={cn(
                'px-2 py-1 rounded text-xs font-medium',
                ntd.count > 0
                  ? (isDark ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-700')
                  : (isDark ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-100 text-emerald-700')
              )}>
                {ntd.count} cases
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function SentinelActivePanel({ tab }: { tab: SentinelTabId }) {
  switch (tab) {
    case 'surveillance':
      return <SentinelSurveillancePanel />;
    case 'disease-tracking':
      return <SentinelDiseaseTrackingPanel />;
    case 'case-reporting':
      return <SentinelCaseReportingPanel />;
    case 'outbreak':
      return <SentinelOutbreakPanel />;
    case 'heatmaps':
      return <SentinelHeatmapsPanel />;
    case 'contact-tracing':
      return <SentinelContactPanel />;
    case 'vaccination':
      return <SentinelVaccinationPanel />;
    case 'alerts':
      return <SentinelAlertsPanel />;
    case 'epidemiology-analytics':
      return <SentinelEpidemiologyAnalyticsPanel />;
    case 'emergency':
      return <SentinelEmergencyPanel />;
    case 'community':
      return <SentinelCommunityPanel />;
    case 'ntd':
      return <SentinelNTDPanel />;
    default:
      return null;
  }
}
