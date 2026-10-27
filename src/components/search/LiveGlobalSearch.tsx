// Header search for live workspaces. global_search runs with the signed-in
// user's permissions, so it only returns records their role can open.
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Calendar, FlaskConical, Pill, Search, User, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { globalSearch, type SearchHit } from '@/lib/supabase/profile';

const TYPES: Record<SearchHit['type'], { label: string; icon: React.ElementType; tone: string }> = {
  patient: { label: 'Patients', icon: User, tone: 'bg-blue-100 text-blue-600' },
  appointment: { label: 'Appointments', icon: Calendar, tone: 'bg-green-100 text-green-600' },
  lab: { label: 'Lab orders', icon: FlaskConical, tone: 'bg-purple-100 text-purple-600' },
  prescription: { label: 'Prescriptions', icon: Pill, tone: 'bg-amber-100 text-amber-700' },
  staff: { label: 'Staff', icon: Users, tone: 'bg-indigo-100 text-indigo-600' },
};
const ORDER: SearchHit['type'][] = ['patient', 'appointment', 'lab', 'prescription', 'staff'];
const PAGE_FOR: Record<SearchHit['type'], string> = {
  patient: 'patients', appointment: 'appointments', lab: 'laboratory', prescription: 'pharmacy', staff: 'human-resources',
};

export function LiveGlobalSearch() {
  const { organization } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searched, setSearched] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const loading = query.trim().length >= 2 && searched !== query.trim();
  const ordered = ORDER.flatMap((t) => results.filter((r) => r.type === t));

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let alive = true;
    const t = window.setTimeout(() => {
      globalSearch(organization.id, q)
        .then((rows) => { if (alive) { setResults(rows); setSearched(q); setSelected(-1); } })
        .catch(() => { if (alive) { setResults([]); setSearched(q); } });
    }, 250);
    return () => { alive = false; window.clearTimeout(t); };
  }, [query, organization.id]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const choose = (hit: SearchHit) => {
    setOpen(false);
    setQuery('');
    setResults([]);
    // Patients (and their appointments) open the chart; everything else opens its page.
    const detail = hit.switchId && (hit.type === 'patient' || hit.type === 'appointment') ? { switchId: hit.switchId } : { page: PAGE_FOR[hit.type] };
    window.dispatchEvent(new CustomEvent('app:navigate', { detail }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); inputRef.current?.focus(); setOpen(true); return; }
      if (!open) return;
      if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((i) => Math.min(i + 1, ordered.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((i) => Math.max(i - 1, -1)); }
      if (e.key === 'Enter' && selected >= 0 && ordered[selected]) choose(ordered[selected]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const showPanel = open && query.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative w-full min-w-0 max-w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input ref={inputRef} type="text" value={query} placeholder="Search patients, appointments, records..."
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          className="w-full rounded-xl border-0 bg-gray-100/80 py-2.5 pl-10 pr-12 text-sm text-slate-900 outline-none placeholder:text-slate-500 focus:bg-white focus:ring-2 focus:ring-[#1E4ED8]/20 dark:bg-slate-900/50 dark:text-slate-50 dark:placeholder:text-slate-400 dark:focus:bg-slate-800" />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }} aria-label="Clear search"
            className="absolute right-10 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-800"><X className="h-3.5 w-3.5" /></button>
        )}
        <kbd className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 lg:block dark:bg-slate-800 dark:text-slate-400">⌘K</kbd>
      </div>

      {showPanel && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 min-w-[18rem] overflow-hidden rounded-2xl border border-gray-100/50 bg-white/95 shadow-2xl backdrop-blur-xl dark:border-slate-700 dark:bg-slate-900/95">
          {loading && ordered.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-500">Searching…</p>
          ) : ordered.length === 0 ? (
            <div className="p-6 text-center"><Search className="mx-auto mb-2 h-7 w-7 text-gray-300" /><p className="text-sm text-slate-600 dark:text-slate-400">No results for “{query.trim()}”</p></div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto py-2">
              {ORDER.map((type) => {
                const hits = ordered.filter((r) => r.type === type);
                if (!hits.length) return null;
                const cfg = TYPES[type];
                return (
                  <div key={type} className="mb-1">
                    <p className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">{cfg.label}</p>
                    {hits.map((hit) => {
                      const index = ordered.indexOf(hit);
                      return (
                        <button key={`${type}-${hit.id}`} onClick={() => choose(hit)} onMouseEnter={() => setSelected(index)}
                          className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-left', selected === index ? 'bg-[#1E4ED8]/5' : 'hover:bg-gray-50 dark:hover:bg-slate-800')}>
                          <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', cfg.tone)}><cfg.icon className="h-4 w-4" /></div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-50">{hit.title}</p>
                            <p className="truncate text-xs text-slate-600 dark:text-slate-400">{hit.subtitle}</p>
                          </div>
                          <ArrowRight className="h-4 w-4 shrink-0 text-gray-300" />
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
          {ordered.length > 0 && (
            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
              <span>{ordered.length} result{ordered.length === 1 ? '' : 's'}</span><span className="hidden sm:inline">↑↓ to move · Enter to open · Esc to close</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
