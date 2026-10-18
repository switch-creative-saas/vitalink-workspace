// EMR tab: records other hospitals shared about this patient over the VitaLink
// Network. Read-only history, grouped by the referral / transfer they came with;
// they never enter this hospital's own pharmacy, lab or billing queues.
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Network } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RECORD_LABEL, listReceivedRecords, type ReceivedRecord } from '@/lib/supabase/network';
import { RecordContent } from './NetworkRecordView';

const date = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export function ReceivedRecordsPanel({ patientId }: { patientId: string }) {
  const [records, setRecords] = useState<ReceivedRecord[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listReceivedRecords(patientId).then((list) => { if (!cancelled) setRecords(list); }).catch(() => { if (!cancelled) setRecords([]); });
    return () => { cancelled = true; };
  }, [patientId]);

  const groups = useMemo(() => {
    const byTransfer = new Map<string, { number: string; fromOrg: string; sharedAt: string; items: ReceivedRecord[] }>();
    for (const r of records ?? []) {
      const g = byTransfer.get(r.transferId) ?? { number: r.transferNumber, fromOrg: r.fromOrg, sharedAt: r.sharedAt, items: [] };
      g.items.push(r);
      byTransfer.set(r.transferId, g);
    }
    return [...byTransfer.values()].sort((a, b) => b.sharedAt.localeCompare(a.sharedAt));
  }, [records]);

  if (records === null) return <div className="premium-card p-4 text-sm text-gray-500">Loading records from other hospitals...</div>;
  if (records.length === 0) {
    return (
      <div className="premium-card p-8 text-center text-sm text-gray-500 dark:text-slate-400">
        <Network className="mx-auto mb-2 h-8 w-8 text-gray-300" />
        No other hospital has shared records about this patient through the VitaLink Network.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500 dark:text-slate-400">
        Read-only copies shared with the patient's consent. They're kept separate from your own records and don't appear in your pharmacy, lab or billing queues.
      </p>
      {groups.map((g) => (
        <section key={g.number} className="premium-card p-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="font-semibold text-gray-900 dark:text-slate-50">From {g.fromOrg}</h4>
            <span className="text-xs text-gray-500 dark:text-slate-400">{g.number} · shared {date(g.sharedAt)} · {g.items.length} record{g.items.length === 1 ? '' : 's'}</span>
          </div>
          <div className="space-y-1">
            {g.items.map((r) => (
              <div key={r.itemId} className="rounded-lg border border-gray-100 dark:border-slate-700">
                <button type="button" disabled={!r.content} onClick={() => setOpen(open === r.itemId ? null : r.itemId)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm disabled:cursor-default">
                  <span className="min-w-0">
                    <span className="block truncate text-gray-900 dark:text-slate-50">{r.label}</span>
                    <span className="text-[11px] text-gray-500 dark:text-slate-400">{RECORD_LABEL[r.type]} · {date(r.date)}</span>
                  </span>
                  {r.content && (open === r.itemId ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" /> : <ChevronRight className={cn('h-4 w-4 shrink-0 text-gray-400')} />)}
                </button>
                {open === r.itemId && r.content && <RecordContent type={r.type} content={r.content} />}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
