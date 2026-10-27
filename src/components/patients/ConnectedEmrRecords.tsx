// EMR tab: this patient's history from the hospital's other EMR (NMRS, OpenMRS, OpenEMR,
// Helium Health...). Read-only; vitals and lab results from it also appear in VitaLink's
// own vitals and lab lists, marked with their source.
import { useEffect, useMemo, useState } from 'react';
import { Database, Pill, ShieldAlert, Stethoscope, Syringe, FileText, Activity, ClipboardList, Scissors } from 'lucide-react';
import { cn } from '@/lib/utils';
import { listEmrRecords, type EmrRecord } from '@/lib/supabase/emr';

const KINDS: Record<EmrRecord['kind'], { label: string; one: string; icon: React.ElementType; tone: string }> = {
  condition: { label: 'Diagnoses', one: 'Diagnosis', icon: Stethoscope, tone: 'text-purple-700 bg-purple-50' },
  allergy: { label: 'Allergies', one: 'Allergy', icon: ShieldAlert, tone: 'text-red-700 bg-red-50' },
  medication: { label: 'Medicines', one: 'Medicine', icon: Pill, tone: 'text-emerald-700 bg-emerald-50' },
  encounter: { label: 'Visits', one: 'Visit', icon: ClipboardList, tone: 'text-blue-700 bg-blue-50' },
  note: { label: 'Notes & reports', one: 'Note', icon: FileText, tone: 'text-gray-700 bg-gray-100' },
  immunization: { label: 'Immunisations', one: 'Immunisation', icon: Syringe, tone: 'text-teal-700 bg-teal-50' },
  procedure: { label: 'Procedures', one: 'Procedure', icon: Scissors, tone: 'text-orange-700 bg-orange-50' },
  observation: { label: 'Other observations', one: 'Observation', icon: Activity, tone: 'text-slate-700 bg-slate-100' },
};
const ORDER: EmrRecord['kind'][] = ['condition', 'allergy', 'medication', 'encounter', 'note', 'immunization', 'procedure', 'observation'];
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date not recorded');
const inactive = (status: string | null) => Boolean(status && /inactive|resolved|stopped|completed|entered-in-error|cancelled/i.test(status));

export function ConnectedEmrRecords({ patientId }: { patientId: string }) {
  const [records, setRecords] = useState<EmrRecord[] | null>(null);
  const [kind, setKind] = useState<EmrRecord['kind'] | 'all'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listEmrRecords(patientId).then((list) => { if (!cancelled) setRecords(list); }).catch(() => { if (!cancelled) setRecords([]); });
    return () => { cancelled = true; };
  }, [patientId]);

  const counts = useMemo(() => {
    const map = new Map<EmrRecord['kind'], number>();
    for (const r of records ?? []) map.set(r.kind, (map.get(r.kind) ?? 0) + 1);
    return map;
  }, [records]);
  const sources = useMemo(() => [...new Set((records ?? []).map((r) => r.sourceName))], [records]);
  const shown = (records ?? []).filter((r) => kind === 'all' || r.kind === kind);

  if (records === null) return <div className="premium-card p-4 text-sm text-gray-500">Loading records from connected EMRs…</div>;
  if (records.length === 0) {
    return (
      <div className="premium-card p-8 text-center text-sm text-gray-500 dark:text-slate-400">
        <Database className="mx-auto mb-2 h-8 w-8 text-gray-300" />
        No records from a connected EMR for this patient. Admins can connect the hospital's other EMR under Administration → Connected EMRs.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="premium-card p-3">
        <p className="text-xs text-gray-500">From {sources.join(', ')} · read-only copy, updated on each sync</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={() => setKind('all')} className={cn('rounded-full px-3 py-1 text-xs font-medium', kind === 'all' ? 'bg-royal-600 text-white' : 'bg-gray-100 text-gray-700')}>All ({records.length})</button>
          {ORDER.filter((k) => counts.get(k)).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={cn('rounded-full px-3 py-1 text-xs font-medium', kind === k ? 'bg-royal-600 text-white' : 'bg-gray-100 text-gray-700')}>
              {KINDS[k].label} ({counts.get(k)})
            </button>
          ))}
        </div>
      </div>
      <div className="premium-card divide-y divide-gray-100">
        {shown.map((r) => {
          const meta = KINDS[r.kind];
          const long = (r.detail?.length ?? 0) > 160;
          return (
            <div key={r.id} className={cn('flex gap-3 p-3', inactive(r.status) && 'opacity-60')}>
              <div className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', meta.tone)}><meta.icon className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-gray-900">{r.title}</p>
                  <span className="text-xs text-gray-500">{date(r.recordedAt)}</span>
                </div>
                {r.detail && (
                  <p className={cn('mt-0.5 whitespace-pre-line text-xs text-gray-600', !long || expanded === r.id ? '' : 'line-clamp-2')}>{r.detail}</p>
                )}
                <p className="mt-0.5 text-[11px] text-gray-400">
                  {meta.one}{r.status && r.status !== 'unknown' ? ` · ${r.status}` : ''} · {r.sourceName}
                  {long && <button type="button" className="ml-2 text-royal-600" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>{expanded === r.id ? 'Show less' : 'Show more'}</button>}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
