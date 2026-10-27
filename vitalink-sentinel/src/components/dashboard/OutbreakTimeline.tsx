import { differenceInCalendarDays } from 'date-fns';
import { mockActiveOutbreaks } from '@/data/mockSentinelData';
import { SBadge as Badge } from '@/components/standalone/SBadge';
import { SButton as Button } from '@/components/standalone/SButton';

type TimelineOutbreak = Pick<(typeof mockActiveOutbreaks)[number], 'id' | 'disease' | 'state' | 'severity' | 'casesConfirmed' | 'casesSuspected' | 'deaths' | 'cfr' | 'startDate'> & { lga?: string | null };

export function OutbreakTimeline({ outbreaks = mockActiveOutbreaks.slice(0, 3), today = new Date('2026-07-20'), onView }: {
  outbreaks?: TimelineOutbreak[]; today?: Date; onView?: (id: string) => void;
} = {}) {
  return (
    <div className="space-y-3">
      {outbreaks.map((outbreak) => (
        <div key={outbreak.id} className="rounded-2xl border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-bold text-slate-900 dark:text-slate-50">{outbreak.disease}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">{outbreak.state}{outbreak.lga ? ` / ${outbreak.lga}` : ''}</p>
            </div>
            <Badge tone={outbreak.severity}>{outbreak.severity}</Badge>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Confirmed <strong className="block text-slate-900 dark:text-slate-50">{outbreak.casesConfirmed}</strong></span>
            <span>Suspected <strong className="block text-slate-900 dark:text-slate-50">{outbreak.casesSuspected}</strong></span>
            <span>Deaths <strong className="block text-slate-900 dark:text-slate-50">{outbreak.deaths}</strong></span>
            <span>CFR <strong className="block text-slate-900 dark:text-slate-50">{outbreak.cfr}%</strong></span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-slate-500 dark:text-slate-400">{differenceInCalendarDays(today, new Date(outbreak.startDate))} days active</span>
            <Button className="px-3 py-1.5 text-xs" onClick={() => onView?.(outbreak.id)}>View Details</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

