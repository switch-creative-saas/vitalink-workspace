import { AlertTriangle, Bell, Download, Map, RefreshCw, ShieldPlus, Upload, WandSparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { SBadge as Badge } from '@/components/standalone/SBadge';
import { SButton as Button } from '@/components/standalone/SButton';
import { SCard as Card } from '@/components/standalone/SCard';
import { SSelect as Select } from '@/components/standalone/SSelect';
import { DataTable } from '@/components/ui/DataTable';
import { diseaseLibrary, mockFacilities, mockRecentCases, mockStateData } from '@/data/mockSentinelData';

const textPrimary = 'text-slate-950 dark:text-slate-50';
const textSecondary = 'text-slate-500 dark:text-slate-400';
const quietButton = 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';

export function DiseaseRegistryFeature() {
  const categories = [
    { label: 'Infectious Diseases', match: ['Communicable', 'Respiratory', 'Waterborne', 'Vector-borne', 'Zoonotic'] },
    { label: 'Neglected Tropical Diseases', match: ['NTD'] },
    { label: 'Non-communicable Diseases', items: [{ name: 'Hypertension', cases: 0 }, { name: 'Diabetes', cases: 0 }, { name: 'Sickle Cell Disease', cases: 0 }] },
  ];

  return (
    <div className="space-y-5">
      <FeatureHeader title="Disease Intelligence Registry" subtitle="Categorized surveillance catalog for routine sync and public-health reporting.">
        <Button onClick={() => toast.success('Registry synced')}><RefreshCw className="h-4 w-4" />Sync Registry</Button>
      </FeatureHeader>
      <div className="grid gap-4 xl:grid-cols-3">
        {categories.map((category) => {
          const diseases = ('items' in category ? category.items : diseaseLibrary.filter((disease) => category.match.includes(disease.group)).slice(0, 8)) ?? [];
          return (
            <Card key={category.label}>
              <h3 className={`font-bold ${textPrimary}`}>{category.label}</h3>
              <div className="mt-4 space-y-2">
                {diseases.map((disease) => (
                  <div key={disease.name} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/60">
                    <span className={`text-sm font-medium ${textPrimary}`}>{disease.name}</span>
                    <Badge tone={'risk' in disease ? disease.risk as 'critical' | 'high' | 'moderate' | 'low' : 'low'}>{disease.cases} cases</Badge>
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export function CaseReportingFeature() {
  return (
    <div className="space-y-5">
      <FeatureHeader title="Case Reporting & Classification" subtitle="EMR ingest queue with classification, source, location, and resolution actions.">
        <Button className={quietButton}><Upload className="h-4 w-4" />Import CSV</Button>
        <Button><Download className="h-4 w-4" />Export CSV</Button>
      </FeatureHeader>
      <DataTable headers={['Reference ID', 'Disease', 'Classification', 'Source', 'Location', 'Date', 'Actions']}>
        {mockRecentCases.slice(0, 14).map((report) => (
          <tr key={report.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
            <td className="px-4 py-3 font-mono text-xs text-blue-600 dark:text-blue-300">{report.reportId}</td>
            <td className={`px-4 py-3 font-semibold ${textPrimary}`}>{report.disease}</td>
            <td className="px-4 py-3"><Badge tone={report.status === 'confirmed' ? 'critical' : 'moderate'}>{report.status === 'confirmed' ? 'Confirmed' : 'Suspected'}</Badge></td>
            <td className={`px-4 py-3 ${textSecondary}`}>{report.labConfirmed ? 'EMR ingest' : 'Manual report'}</td>
            <td className={`px-4 py-3 ${textSecondary}`}>{report.state} / {report.lga}</td>
            <td className={`px-4 py-3 ${textSecondary}`}>{report.dateReported}</td>
            <td className="px-4 py-3"><div className="flex gap-2"><Button className="px-3 py-1.5 text-xs">Edit</Button><Button className={`px-3 py-1.5 text-xs ${quietButton}`}>Resolve</Button></div></td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}

export function GeographicHeatmapsFeature() {
  const filters = ['Cholera', 'Malaria', 'Lassa Fever', 'Diphtheria'];
  return (
    <div className="space-y-5">
      <FeatureHeader title="Geographic Heatmaps" subtitle="Risk density visualization with filter controls and map mode switching.">
        <div className="rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          <button className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-blue-600 shadow-sm dark:bg-slate-700 dark:text-white">Map</button>
          <button className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${textSecondary}`}>Satellite</button>
        </div>
      </FeatureHeader>
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">{filters.map((filter, index) => <Button key={filter} className={index ? quietButton : ''}>{filter}</Button>)}</div>
          <label className={`flex items-center gap-3 text-sm ${textSecondary}`}>Heat Intensity <input type="range" min="1" max="10" defaultValue="7" className="accent-blue-600" /></label>
        </div>
        <div className="grid min-h-[420px] place-items-center rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-center">
            <Map className="mx-auto h-12 w-12 text-blue-500" />
            <p className={`mt-3 font-semibold ${textPrimary}`}>Nigeria Heatmap Container</p>
            <p className={`mt-1 text-sm ${textSecondary}`}>Ready for react-leaflet tile layers, markers, and regional risk overlays.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

export function ContactTracingFeature() {
  const rows = [
    ['SEN-2026-1041 -> SEN-2026-1018', 'Household', 'Edo / Etsako West', 88],
    ['SEN-2026-1022 -> Facility Cluster', 'Facility', 'Borno / Maiduguri', 73],
    ['SEN-2026-1034 -> Cross-border Travel', 'Travel', 'Kano / Fagge', 61],
  ];
  return (
    <FeatureTable title="Contact Tracing" subtitle="Relationship edges, exposure contexts, and percentage risk scoring." headers={['Edges', 'Relationship', 'Location', 'Risk Score', 'Actions']}>
      {rows.map(([edge, relationship, location, score]) => (
        <tr key={edge as string}>
          <td className={`px-4 py-3 font-mono text-xs text-blue-600 dark:text-blue-300`}>{edge}</td>
          <td className={`px-4 py-3 font-semibold ${textPrimary}`}>{relationship}</td>
          <td className={`px-4 py-3 ${textSecondary}`}>{location}</td>
          <td className="px-4 py-3"><Progress value={score as number} tone={(score as number) > 80 ? 'red' : 'amber'} /></td>
          <td className="px-4 py-3"><Button className="px-3 py-1.5 text-xs">Review Chain</Button></td>
        </tr>
      ))}
    </FeatureTable>
  );
}

export function VaccinationMonitoringFeature() {
  const rows = [
    ['Edo', 'Yellow Fever', 84000, 120000],
    ['Borno', 'Cholera OCV', 156000, 220000],
    ['Kano', 'Diphtheria Booster', 91000, 140000],
    ['Lagos', 'Measles-Rubella', 232000, 250000],
  ];
  return (
    <div className="space-y-5">
      <FeatureHeader title="Vaccination Monitoring" subtitle="Coverage progress against target doses across priority regions." />
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map(([region, vaccine, current, target]) => (
          <Card key={`${region}-${vaccine}`}>
            <div className="flex items-center justify-between">
              <div><h3 className={`font-bold ${textPrimary}`}>{vaccine}</h3><p className={`text-sm ${textSecondary}`}>{region}</p></div>
              <Badge tone="low">{Math.round((Number(current) / Number(target)) * 100)}%</Badge>
            </div>
            <Progress value={Math.round((Number(current) / Number(target)) * 100)} className="mt-5" />
            <p className={`mt-3 text-sm ${textSecondary}`}>{Number(current).toLocaleString()} of {Number(target).toLocaleString()} target doses</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function PublicHealthAlertsFeature() {
  return (
    <div className="space-y-5">
      <FeatureHeader title="Public Health Alerts" subtitle="Central bulletin and escalation workspace for public-health notifications.">
        <Button className={quietButton}>Create Bulletin</Button>
        <Button className={quietButton}>Escalate</Button>
        <Button><Bell className="h-4 w-4" />Create Alert</Button>
      </FeatureHeader>
      <Card className="grid min-h-[360px] place-items-center text-center">
        <div>
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300"><Bell className="h-6 w-6" /></div>
          <h3 className={`mt-4 text-lg font-bold ${textPrimary}`}>No active bulletins</h3>
          <p className={`mx-auto mt-2 max-w-md text-sm ${textSecondary}`}>New alerts, bulletins, and escalations will appear here once created or synced from partner feeds.</p>
        </div>
      </Card>
    </div>
  );
}

export function EpidemiologyAnalyticsFeature() {
  const metrics = [['R0 Trend', '1.32', '+0.08'], ['Doubling Time', '9.4d', 'stable'], ['Rt Effective', '0.94', '-0.12'], ['Serial Interval', '5.8d', 'median']];
  return (
    <div className="space-y-5">
      <FeatureHeader title="Epidemiology Analytics" subtitle="AI-assisted insight workspace for burden, transmission, and response timing." />
      <div className="grid gap-4 md:grid-cols-4">{metrics.map(([label, value, note]) => <Card key={label}><p className={`text-sm ${textSecondary}`}>{label}</p><p className={`mt-2 text-3xl font-bold ${textPrimary}`}>{value}</p><p className={`mt-2 text-xs ${textSecondary}`}>{note}</p></Card>)}</div>
      <Card>
        <div className="mb-3 flex items-center gap-2"><WandSparkles className="h-4 w-4 text-blue-600" /><h3 className={`font-bold ${textPrimary}`}>Highest-burden conditions</h3></div>
        <textarea className="sentinel-input min-h-44 w-full rounded-2xl p-4 text-sm" defaultValue={'Malaria remains the highest-burden routine condition, while cholera and Lassa Fever are driving outbreak-response load. Prioritize Edo CFR review, Borno waterborne response, and Kano diphtheria vaccination gaps.'} />
      </Card>
    </div>
  );
}

export function EmergencyResponseFeature() {
  const facilities = mockFacilities.slice(0, 6).map((facility, index) => ({ facility, usage: 42 + index * 8 }));
  const metrics = [['Total Beds', 428], ['ICU', 48], ['Oxygen', 312], ['Ambulances', 26]];
  return (
    <div className="space-y-5">
      <FeatureHeader title="Emergency Response Center" subtitle="Capacity visibility for beds, ICU, oxygen, ambulances, and response readiness.">
        <Button><ShieldPlus className="h-4 w-4" />Activate Response</Button>
      </FeatureHeader>
      <div className="grid gap-4 md:grid-cols-4">{metrics.map(([label, value]) => <Card key={label}><p className={`text-sm ${textSecondary}`}>{label}</p><p className={`mt-2 text-3xl font-bold ${textPrimary}`}>{value}</p></Card>)}</div>
      <div className="grid gap-4 lg:grid-cols-2">{facilities.map(({ facility, usage }) => <Card key={facility.id}><div className="flex justify-between gap-3"><div><h3 className={`font-bold ${textPrimary}`}>{facility.name}</h3><p className={`text-sm ${textSecondary}`}>{facility.state} / {facility.lga}</p></div><Badge tone={usage > 75 ? 'critical' : usage > 60 ? 'moderate' : 'low'}>{usage}% used</Badge></div><Progress value={usage} tone={usage > 75 ? 'red' : usage > 60 ? 'amber' : 'green'} className="mt-5" /></Card>)}</div>
    </div>
  );
}

export function CommunityReportingFeature() {
  return (
    <div className="space-y-5">
      <FeatureHeader title="Community Reporting" subtitle="Live-sync community submissions and pending-review triage." />
      <Card>
        <div className="grid gap-3 md:grid-cols-[240px_1fr_auto]">
          <Select><option>Suspected outbreak</option><option>Medicine shortage</option><option>Mortality signal</option><option>Community rumor</option></Select>
          <input className="sentinel-input rounded-xl px-3 py-2 text-sm" placeholder="Summary" />
          <Button>Submit Live Sync</Button>
        </div>
      </Card>
      <Card>
        <h3 className={`mb-4 font-bold ${textPrimary}`}>Recent Community Reports</h3>
        <div className="space-y-3">{['Suspected outbreak reported', 'Water source contamination', 'Unusual fever cluster'].map((title, index) => <div key={title} className="flex items-center justify-between rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60"><div><p className={`font-semibold ${textPrimary}`}>{title}</p><p className={`text-sm ${textSecondary}`}>{mockStateData[index].state} / Community node · {index + 1}h ago</p></div><Badge tone="moderate">Pending Review</Badge></div>)}</div>
      </Card>
    </div>
  );
}

export function NTDMonitoringFeature() {
  const ntds = diseaseLibrary.filter((disease) => disease.group === 'NTD');
  return (
    <div className="space-y-5">
      <FeatureHeader title="NTD Monitoring" subtitle="Program list for neglected tropical disease surveillance and MDA planning.">
        <Button>Generate MDA Schedule</Button>
      </FeatureHeader>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{ntds.map((disease) => <Card key={disease.name}><div className="flex items-center justify-between gap-3"><h3 className={`font-bold ${textPrimary}`}>{disease.name}</h3><Badge tone="low">0 cases</Badge></div><p className={`mt-3 line-clamp-2 text-sm ${textSecondary}`}>{disease.description}</p><p className={`mt-4 text-xs ${textSecondary}`}>MDA status: ready for schedule generation</p></Card>)}</div>
    </div>
  );
}

function FeatureHeader({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className={`text-2xl font-bold ${textPrimary}`}>{title}</h2><p className={`text-sm ${textSecondary}`}>{subtitle}</p></div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

function FeatureTable({ title, subtitle, headers, children }: { title: string; subtitle: string; headers: string[]; children: ReactNode }) {
  return <div className="space-y-5"><FeatureHeader title={title} subtitle={subtitle} /><DataTable headers={headers}>{children}</DataTable></div>;
}

function Progress({ value, tone = 'blue', className }: { value: number; tone?: 'blue' | 'green' | 'amber' | 'red'; className?: string }) {
  const color = tone === 'green' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : tone === 'red' ? 'bg-red-500' : 'bg-blue-500';
  return <div className={`h-2 rounded-full bg-slate-100 dark:bg-slate-800 ${className ?? ''}`}><div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}
