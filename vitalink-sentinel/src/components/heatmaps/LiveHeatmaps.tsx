// Geographic heatmap on live Supabase data (sentinel_heatmap): case activity by state for a period,
// with each state's LGAs, open outbreaks and risk. Circles sit on each state's capital.
import { useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowDownRight, ArrowUpRight, MapPin, RefreshCw, X } from 'lucide-react';
import { SBadge as Badge } from '@/components/standalone/SBadge';
import { SButton as Button } from '@/components/standalone/SButton';
import { SCard as Card } from '@/components/standalone/SCard';
import { SSelect as Select } from '@/components/standalone/SSelect';
import { DataTable } from '@/components/ui/DataTable';
import { useSentinelStore } from '@/store/useSentinelStore';
import { getHeatmap, listDiseases, type HeatmapData, type HeatmapState, type RegistryDisease, type RiskLevel } from '@/lib/supabase/sentinel';

const muted = 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';

// State capitals, used as each state's position on the map.
const STATE_POSITIONS: Record<string, [number, number]> = {
  Abia: [5.532, 7.486], Adamawa: [9.2035, 12.4954], 'Akwa Ibom': [5.0377, 7.9128], Anambra: [6.212, 7.07], Bauchi: [10.3103, 9.8439],
  Bayelsa: [4.9267, 6.2676], Benue: [7.7337, 8.5214], Borno: [11.8311, 13.151], 'Cross River': [4.9757, 8.3417], Delta: [6.198, 6.731],
  Ebonyi: [6.3249, 8.1137], Edo: [6.335, 5.6037], Ekiti: [7.6233, 5.2209], Enugu: [6.4584, 7.5464], FCT: [9.0579, 7.4951],
  Gombe: [10.2897, 11.1673], Imo: [5.4836, 7.0333], Jigawa: [11.7562, 9.3388], Kaduna: [10.5105, 7.4165], Kano: [12.0022, 8.592],
  Katsina: [12.9908, 7.6018], Kebbi: [12.4539, 4.1975], Kogi: [7.8023, 6.7333], Kwara: [8.4966, 4.5421], Lagos: [6.6018, 3.3515],
  Nasarawa: [8.4939, 8.5153], Niger: [9.5836, 6.5463], Ogun: [7.1475, 3.3619], Ondo: [7.2571, 5.2058], Osun: [7.7827, 4.5418],
  Oyo: [7.3775, 3.947], Plateau: [9.8965, 8.8583], Rivers: [4.8156, 7.0498], Sokoto: [13.0059, 5.2476], Taraba: [8.8932, 11.36],
  Yobe: [11.747, 11.9608], Zamfara: [12.1628, 6.6614],
};
const NIGERIA_CENTER: [number, number] = [9.08, 8.68];

// CARTO basemap tiles. With a key (VITE_CARTO_BASEMAPS_KEY) usage is counted against your CARTO
// account; without one (local development) the public tile servers are used.
const CARTO_KEY = (import.meta.env.VITE_CARTO_BASEMAPS_KEY as string | undefined)?.trim();
const tileUrl = (style: 'light_all' | 'dark_all') => CARTO_KEY
  ? `https://basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_KEY)}`
  : `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`;
const STATE_ALIASES: Record<string, string> = { Abuja: 'FCT', 'Federal Capital Territory': 'FCT', 'Akwa-Ibom': 'Akwa Ibom', 'Cross-River': 'Cross River', Nassarawa: 'Nasarawa' };
const positionOf = (state: string) => STATE_POSITIONS[STATE_ALIASES[state] ?? state];

const RISK_COLOR: Record<RiskLevel, string> = { critical: '#e11d48', high: '#f97316', moderate: '#f59e0b', low: '#10b981' };
const RISK_ORDER: RiskLevel[] = ['critical', 'high', 'moderate', 'low'];
const PERIODS = [{ days: 7, label: '7 days' }, { days: 30, label: '30 days' }, { days: 90, label: '90 days' }, { days: 365, label: '12 months' }];
type Metric = 'cases' | 'confirmed' | 'deaths';
const METRICS: Array<{ id: Metric; label: string }> = [{ id: 'cases', label: 'All cases' }, { id: 'confirmed', label: 'Confirmed' }, { id: 'deaths', label: 'Deaths' }];

function change(current: number, previous: number) {
  if (!previous) return current ? 'new' : null;
  return Math.round(((current - previous) / previous) * 100);
}

function Trend({ current, previous }: { current: number; previous: number }) {
  const delta = change(current, previous);
  if (delta === null) return <span className="text-slate-400">—</span>;
  if (delta === 'new') return <span className="text-rose-600 dark:text-rose-400">new</span>;
  if (delta === 0) return <span className="text-slate-500">no change</span>;
  const Icon = delta > 0 ? ArrowUpRight : ArrowDownRight;
  return <span className={`inline-flex items-center gap-0.5 ${delta > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}><Icon className="h-3.5 w-3.5" />{Math.abs(delta)}%</span>;
}

/** Zooms to the selected state, or back out to the whole country. */
function FocusOn({ state }: { state: string | null }) {
  const map = useMap();
  useEffect(() => {
    const position = state ? positionOf(state) : null;
    if (position) map.flyTo(position, 8, { duration: 0.6 });
    else map.flyTo(NIGERIA_CENTER, 6, { duration: 0.6 });
  }, [map, state]);
  return null;
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return <Card className="p-5"><p className="text-sm text-slate-500 dark:text-slate-400">{label}</p><p className="mt-2 text-2xl font-bold text-slate-950 dark:text-slate-50">{value}</p>{hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}</Card>;
}

export function LiveHeatmaps() {
  const { activeOrganization, theme, navigate } = useSentinelStore();
  const orgId = activeOrganization?.id;
  const [days, setDays] = useState(30);
  const [diseaseId, setDiseaseId] = useState('');
  const [category, setCategory] = useState<'' | 'infectious' | 'ntd' | 'ncd'>('');
  const [metric, setMetric] = useState<Metric>('cases');
  const [selected, setSelected] = useState<string | null>(null);
  const [diseases, setDiseases] = useState<RegistryDisease[]>([]);
  const [data, setData] = useState<{ key: string; heatmap: HeatmapData } | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const key = JSON.stringify({ days, diseaseId, category, refresh });

  useEffect(() => { listDiseases().then(setDiseases).catch(() => undefined); }, []);

  useEffect(() => {
    if (!orgId) return;
    let alive = true;
    getHeatmap(orgId, days, { diseaseId: diseaseId || undefined, category: category || undefined })
      .then((heatmap) => { if (alive) { setData({ key, heatmap }); setError(''); } })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : 'Could not load the heatmap.'); });
    return () => { alive = false; };
  }, [orgId, days, diseaseId, category, key]);

  // New reports arrive all the time.
  useEffect(() => {
    const timer = window.setInterval(() => setRefresh((n) => n + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const heatmap = data?.heatmap ?? null;
  const loading = !data || data.key !== key;
  const states = useMemo(() => heatmap?.states ?? [], [heatmap]);
  const mapped = useMemo(() => states.filter((s) => positionOf(s.state)), [states]);
  const max = useMemo(() => Math.max(1, ...states.map((s) => s[metric])), [states, metric]);
  const current = states.find((s) => s.state === selected) ?? null;
  const visibleDiseases = diseases.filter((d) => !category || d.category === category);
  const dark = theme === 'dark';

  const radius = (s: HeatmapState) => (s[metric] ? 8 + Math.sqrt(s[metric] / max) * 26 : s.outbreaks || s.alerts ? 7 : 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-950 dark:text-slate-50">Geographic Heatmaps</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Where cases are being reported, how fast they are changing, and where outbreaks are open.</p>
        </div>
        <Button className={muted} onClick={() => setRefresh((n) => n + 1)} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2" data-tour-id="heatmap-filters">
        <div className="flex gap-1 rounded-full bg-white/70 p-1 dark:bg-white/5">
          {PERIODS.map((p) => <button key={p.days} type="button" onClick={() => setDays(p.days)} className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${days === p.days ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white'}`}>{p.label}</button>)}
        </div>
        <Select value={category} onChange={(e) => { setCategory(e.target.value as typeof category); setDiseaseId(''); }}>
          <option value="">All disease groups</option><option value="infectious">Infectious diseases</option><option value="ntd">Neglected tropical diseases</option><option value="ncd">Non-communicable</option>
        </Select>
        <Select value={diseaseId} onChange={(e) => setDiseaseId(e.target.value)}>
          <option value="">All diseases</option>
          {visibleDiseases.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <div className="flex gap-1 rounded-full bg-white/70 p-1 dark:bg-white/5">
          {METRICS.map((m) => <button key={m.id} type="button" onClick={() => setMetric(m.id)} className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${metric === m.id ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white'}`}>{m.label}</button>)}
        </div>
      </div>

      {error && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Cases" value={heatmap ? heatmap.totals.cases.toLocaleString() : '—'} hint={heatmap && <><Trend current={heatmap.totals.cases} previous={heatmap.totals.previous} /> vs previous {PERIODS.find((p) => p.days === days)?.label}</>} />
        <Stat label="Confirmed" value={heatmap ? heatmap.totals.confirmed.toLocaleString() : '—'} />
        <Stat label="Deaths" value={heatmap ? heatmap.totals.deaths.toLocaleString() : '—'} />
        <Stat label="States affected" value={heatmap ? heatmap.totals.states : '—'} hint={heatmap ? `${heatmap.totals.lgas} LGA${heatmap.totals.lgas === 1 ? '' : 's'} with recorded cases` : undefined} />
        <Stat label="Open outbreaks" value={heatmap ? heatmap.outbreaks.length : '—'} hint={heatmap && heatmap.outbreaks.length > 0 ? <button type="button" className="font-semibold text-slate-700 underline dark:text-slate-200" onClick={() => navigate('outbreaks')}>View outbreaks</button> : undefined} />
      </div>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="p-3">
          <div data-tour-id="heatmap-map" className="relative isolate h-[min(560px,70vh)] min-h-[340px] overflow-hidden rounded-[22px]">
            <MapContainer center={NIGERIA_CENTER} zoom={6} minZoom={5} maxZoom={11} scrollWheelZoom={false} className="h-full w-full" style={{ background: dark ? '#0d0e14' : '#e8ebf1' }}>
              <TileLayer
                key={dark ? 'dark' : 'light'}
                url={tileUrl(dark ? 'dark_all' : 'light_all')}
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              />
              <FocusOn state={selected} />
              {mapped.filter((s) => radius(s) > 0).sort((a, b) => b[metric] - a[metric]).map((s) => (
                <CircleMarker key={s.state} center={positionOf(s.state)!} radius={radius(s)}
                  eventHandlers={{ click: () => setSelected(s.state) }}
                  pathOptions={{ color: RISK_COLOR[s.risk], fillColor: RISK_COLOR[s.risk], fillOpacity: selected === s.state ? 0.7 : 0.42, weight: selected === s.state ? 3 : 1.5, dashArray: s[metric] ? undefined : '3 4' }}>
                  <Tooltip direction="top" offset={[0, -4]}>
                    <span className="font-semibold">{s.state}</span> · {s[metric]} {metric === 'cases' ? (s.cases === 1 ? 'case' : 'cases') : metric}
                    {s.outbreaks > 0 && <> · {s.outbreaks} outbreak{s.outbreaks === 1 ? '' : 's'}</>}
                  </Tooltip>
                </CircleMarker>
              ))}
            </MapContainer>
            <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-2xl bg-white/90 px-3 py-2 text-xs text-slate-600 shadow-sm backdrop-blur dark:bg-slate-900/90 dark:text-slate-300">
              <p className="mb-1 font-semibold text-slate-800 dark:text-slate-100">Risk</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1">{RISK_ORDER.map((r) => <span key={r} className="inline-flex items-center gap-1.5 capitalize"><span className="h-2.5 w-2.5 rounded-full" style={{ background: RISK_COLOR[r] }} />{r}</span>)}</div>
              <p className="mt-1 text-[11px] text-slate-500">Bigger circle = more {metric === 'cases' ? 'cases' : metric}</p>
            </div>
            {heatmap && !loading && mapped.every((s) => radius(s) === 0) && (
              <div className="pointer-events-none absolute inset-0 z-[500] grid place-items-center">
                <p className="rounded-2xl bg-white/90 px-4 py-3 text-sm text-slate-600 shadow-sm dark:bg-slate-900/90 dark:text-slate-300">No cases with a location in this period.</p>
              </div>
            )}
          </div>
          {heatmap && heatmap.totals.unlocated > 0 && <p className="px-2 pt-2 text-xs text-slate-500 dark:text-slate-400">{heatmap.totals.unlocated} case{heatmap.totals.unlocated === 1 ? ' has' : 's have'} no state recorded and {heatmap.totals.unlocated === 1 ? 'is' : 'are'} not on the map.</p>}
        </Card>

        <Card className="flex flex-col" data-tour-id="heatmap-detail">
          {current ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400"><MapPin className="h-3.5 w-3.5" />State</p>
                  <h3 className="mt-1 text-xl font-bold text-slate-950 dark:text-slate-50">{current.state}</h3>
                </div>
                <div className="flex items-center gap-2"><Badge tone={current.risk}>{current.risk} risk</Badge>
                  <button type="button" onClick={() => setSelected(null)} className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-900/5 hover:text-slate-700 dark:hover:bg-white/10" aria-label="Back to all states"><X className="h-4 w-4" /></button></div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                {([['Cases', current.cases], ['Confirmed', current.confirmed], ['Deaths', current.deaths]] as const).map(([label, value]) => (
                  <div key={label} className="rounded-2xl bg-white/60 p-3 dark:bg-white/5"><p className="text-lg font-bold text-slate-950 dark:text-slate-50">{value}</p><p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p></div>
                ))}
              </div>
              <p className="mt-3 text-xs text-slate-500 dark:text-slate-400"><Trend current={current.cases} previous={current.previous} /> vs previous period · {current.hospitalized} hospitalised · {current.alerts} open alert{current.alerts === 1 ? '' : 's'}</p>
              <h4 className="mt-5 text-sm font-semibold text-slate-900 dark:text-slate-100">By LGA</h4>
              <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {current.lgas.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No cases in this period.</p> : current.lgas.map((l) => (
                  <div key={l.lga} className="flex items-center gap-3 text-sm">
                    <span className="w-28 shrink-0 truncate text-slate-700 dark:text-slate-200" title={l.lga}>{l.lga}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-900/[0.06] dark:bg-white/10"><span className="block h-full rounded-full" style={{ width: `${(l.cases / Math.max(1, current.lgas[0].cases)) * 100}%`, background: RISK_COLOR[current.risk] }} /></span>
                    <span className="w-8 shrink-0 text-right tabular-nums text-slate-600 dark:text-slate-300">{l.cases}</span>
                  </div>
                ))}
              </div>
              {current.diseases.length > 0 && <>
                <h4 className="mt-5 text-sm font-semibold text-slate-900 dark:text-slate-100">Diseases</h4>
                <div className="mt-2 flex flex-wrap gap-1.5">{current.diseases.map((d) => <span key={d.disease} className="rounded-full border border-slate-900/10 px-2.5 py-1 text-xs text-slate-700 dark:border-white/10 dark:text-slate-200">{d.disease} · {d.cases}</span>)}</div>
              </>}
              {heatmap && heatmap.outbreaks.some((o) => o.state === current.state) && <>
                <h4 className="mt-5 text-sm font-semibold text-slate-900 dark:text-slate-100">Open outbreaks</h4>
                <div className="mt-2 space-y-1.5">{heatmap.outbreaks.filter((o) => o.state === current.state).map((o) => (
                  <button key={o.id} type="button" onClick={() => navigate('outbreaks', o.id)} className="flex w-full items-center justify-between rounded-2xl bg-white/60 px-3 py-2 text-left text-sm hover:bg-white dark:bg-white/5 dark:hover:bg-white/10">
                    <span className="text-slate-800 dark:text-slate-100">{o.disease}{o.lga ? ` · ${o.lga}` : ''}</span><Badge tone={o.severity}>{o.severity}</Badge>
                  </button>
                ))}</div>
              </>}
            </>
          ) : (
            <>
              <h3 className="font-bold text-slate-950 dark:text-slate-50">Most affected states</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Click a state here or on the map for its LGAs and outbreaks.</p>
              <div className="mt-3 flex-1 space-y-1.5 overflow-y-auto">
                {loading && !heatmap && <p className="text-sm text-slate-500">Loading…</p>}
                {heatmap && states.length === 0 && <p className="rounded-2xl border border-dashed border-slate-900/10 p-6 text-center text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">Nothing reported in this period.</p>}
                {[...states].sort((a, b) => b[metric] - a[metric] || RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk)).slice(0, 12).map((s) => (
                  <button key={s.state} type="button" onClick={() => setSelected(s.state)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm hover:bg-white/70 dark:hover:bg-white/5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: RISK_COLOR[s.risk] }} />
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-800 dark:text-slate-100">{s.state}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{s.topDisease ?? (s.outbreaks ? 'Outbreak' : 'Alert')}</span>
                    <span className="w-8 text-right font-semibold tabular-nums text-slate-900 dark:text-slate-50">{s[metric]}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </Card>
      </section>

      {states.length > 0 && (
        <DataTable data-tour-id="heatmap-table" headers={['State', 'Cases', 'vs previous', 'Confirmed', 'Deaths', 'LGAs', 'Outbreaks', 'Alerts', 'Top disease', 'Risk']}>
          {states.map((s) => (
            <tr key={s.state} className="cursor-pointer" onClick={() => { setSelected(s.state); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
              <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-50">{s.state}</td>
              <td className="px-4 py-3 tabular-nums">{s.cases}</td>
              <td className="px-4 py-3 text-xs"><Trend current={s.cases} previous={s.previous} /></td>
              <td className="px-4 py-3 tabular-nums">{s.confirmed}</td>
              <td className="px-4 py-3 tabular-nums">{s.deaths}</td>
              <td className="px-4 py-3 tabular-nums">{s.lgas.filter((l) => l.lga !== 'Not recorded').length}</td>
              <td className="px-4 py-3 tabular-nums">{s.outbreaks}</td>
              <td className="px-4 py-3 tabular-nums">{s.alerts}</td>
              <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{s.topDisease ?? '—'}</td>
              <td className="px-4 py-3"><Badge tone={s.risk}>{s.risk}</Badge></td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  );
}
