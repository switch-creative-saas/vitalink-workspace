import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Bell, BookOpen, Building2, ClipboardList, CornerDownLeft, Loader2, Search, X } from 'lucide-react';
import { searchSentinel, type SearchResults } from '@/lib/supabase/sentinel';
import { useSentinelStore, type SentinelRoute } from '@/store/useSentinelStore';
import { NAV_ITEMS } from '../navigation';

interface Entry { key: string; group: string; title: string; subtitle?: string; icon: typeof Search; go: () => void }

const place = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(', ');

/** Search across Sentinel: pages, cases, outbreaks, alerts, facilities and the disease registry. */
export function SearchDialog({ live, onClose }: { live: boolean; onClose: () => void }) {
  const { activeOrganization, navigate } = useSentinelStore();
  const orgId = live ? activeOrganization?.id : undefined;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ query: string; data: SearchResults } | null>(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const term = query.trim();

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!orgId || term.length < 2) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      searchSentinel(orgId, term).then((data) => { if (alive) { setResults({ query: term, data }); setError(''); } }).catch((err: unknown) => { if (alive) setError(err instanceof Error ? err.message : 'Search failed.'); });
    }, 220);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [orgId, term]);

  const entries = useMemo(() => {
    const go = (route: SentinelRoute, id?: string, focusQuery?: string) => () => { navigate(route, id, focusQuery); onClose(); };
    const lower = term.toLowerCase();
    const pages: Entry[] = NAV_ITEMS.filter((item) => !lower || item.label.toLowerCase().includes(lower)).slice(0, lower ? 4 : 8)
      .map((item) => ({ key: `page-${item.route}`, group: 'Go to', title: item.label, subtitle: item.group, icon: item.icon, go: go(item.route) }));
    const data = results && results.query === term && term.length >= 2 ? results.data : null;
    if (!data) return pages;
    return [
      ...data.cases.map((c): Entry => ({ key: `case-${c.id}`, group: 'Cases', title: `${c.reportId} · ${c.disease}`, subtitle: `${place(c.lga, c.state) || 'Location not set'} · ${c.status}`, icon: ClipboardList, go: go('cases', c.id, c.reportId) })),
      ...data.outbreaks.map((o): Entry => ({ key: `outbreak-${o.id}`, group: 'Outbreaks', title: `${o.disease} outbreak`, subtitle: `${place(o.lga, o.state)} · ${o.severity} · ${o.status.replace('_', ' ')}`, icon: AlertTriangle, go: go('outbreaks', o.id) })),
      ...data.alerts.map((a): Entry => ({ key: `alert-${a.id}`, group: 'Alerts', title: a.title, subtitle: `${a.severity} · ${a.status}${a.state ? ` · ${a.state}` : ''}`, icon: Bell, go: go('alerts') })),
      ...data.facilities.map((f): Entry => ({ key: `facility-${f.id}`, group: 'Facilities', title: f.name, subtitle: `${place(f.lga, f.state) || 'Nigeria'}${f.type ? ` · ${f.type}` : ''}`, icon: Building2, go: go('facilities') })),
      ...data.diseases.map((d): Entry => ({ key: `disease-${d.id}`, group: 'Disease registry', title: d.name, subtitle: `${d.category.toUpperCase()}${d.notifiable ? ' · notifiable' : ''}`, icon: BookOpen, go: go('diseases') })),
      ...pages,
    ];
  }, [term, results, navigate, onClose]);

  const searching = Boolean(orgId) && term.length >= 2 && results?.query !== term && !error;
  const index = Math.min(active, Math.max(entries.length - 1, 0));

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index + 1) % Math.max(entries.length, 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index - 1 + entries.length) % Math.max(entries.length, 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); entries[index]?.go(); }
    else if (event.key === 'Escape') onClose();
  };

  return <div className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-950/30 px-4 pt-[12vh] backdrop-blur-sm" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="sentinel-panel w-full max-w-[620px] overflow-hidden rounded-[28px]" role="dialog" aria-label="Search Sentinel" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-3 border-b border-slate-900/[0.06] px-5 dark:border-white/10">
        {searching ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : <Search className="h-5 w-5 text-slate-400" />}
        <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} placeholder={live ? 'Search cases, outbreaks, alerts, facilities, diseases…' : 'Jump to a page…'} className="h-16 min-w-0 flex-1 bg-transparent text-base text-slate-950 outline-none placeholder:text-slate-400 dark:text-white" />
        <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-900/5 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-white" aria-label="Close search"><X className="h-4 w-4" /></button>
      </div>
      <div className="max-h-[56vh] overflow-y-auto p-2">
        {error && <p className="px-4 py-3 text-sm text-rose-500">{error}</p>}
        {entries.length === 0 && !searching && <p className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">No matches for “{term}”.</p>}
        {entries.map((entry, i) => {
          const Icon = entry.icon;
          const header = i === 0 || entries[i - 1].group !== entry.group ? entry.group : null;
          return <div key={entry.key}>
            {header && <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{header}</p>}
            <button type="button" onMouseMove={() => setActive(i)} onClick={entry.go} className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition ${i === index ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-800 dark:text-slate-100'}`}>
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${i === index ? 'bg-white/15 dark:bg-slate-950/10' : 'bg-slate-900/5 dark:bg-white/10'}`}><Icon className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{entry.title}</span>{entry.subtitle && <span className={`block truncate text-xs capitalize ${i === index ? 'opacity-70' : 'text-slate-500 dark:text-slate-400'}`}>{entry.subtitle}</span>}</span>
              {i === index && <CornerDownLeft className="h-4 w-4 shrink-0 opacity-70" />}
            </button>
          </div>;
        })}
      </div>
      <div className="flex items-center gap-4 border-t border-slate-900/[0.06] px-5 py-2.5 text-[11px] text-slate-400 dark:border-white/10"><span>↑↓ to move</span><span>↵ to open</span><span>esc to close</span></div>
    </div>
  </div>;
}
