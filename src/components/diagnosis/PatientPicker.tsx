import { useEffect, useState } from 'react';
import { Search, UserRound, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { searchPatients, type DxPatientMatch } from '@/lib/supabase/diagnosis';

export function PatientPicker({ organizationId, value, onChange }: { organizationId: string; value: DxPatientMatch | null; onChange: (patient: DxPatientMatch | null) => void }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<DxPatientMatch[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (term.trim().length < 2) return;
    const timer = window.setTimeout(() => {
      searchPatients(organizationId, term).then((rows) => { setResults(rows); setOpen(true); }).catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [organizationId, term]);

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-royal-100 bg-royal-50 px-3 py-2">
        <UserRound className="h-4 w-4 shrink-0 text-royal-600" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900">{value.name}</p>
          <p className="text-xs text-gray-500">{value.switchId}{value.age != null ? ` · ${value.age} yrs` : ''}{value.sex ? ` · ${value.sex}` : ''}</p>
        </div>
        <button className="rounded-lg p-1 text-gray-400 hover:bg-white hover:text-gray-700" onClick={() => onChange(null)} aria-label="Clear patient">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <Input
        className="rounded-xl pl-9"
        placeholder="Find patient by name or VitaLink ID (optional)"
        value={term}
        onChange={(e) => { setTerm(e.target.value); if (e.target.value.trim().length < 2) { setResults([]); setOpen(false); } }}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          {results.length === 0 ? <p className="p-3 text-sm text-gray-500">No patients match.</p> : results.map((p) => (
            <button key={p.id} className="block w-full px-3 py-2 text-left hover:bg-gray-50" onMouseDown={() => { onChange(p); setTerm(''); setOpen(false); }}>
              <span className="text-sm font-medium text-gray-900">{p.name}</span>
              <span className="block text-xs text-gray-500">{p.switchId}{p.age != null ? ` · ${p.age} yrs` : ''}{p.sex ? ` · ${p.sex}` : ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
