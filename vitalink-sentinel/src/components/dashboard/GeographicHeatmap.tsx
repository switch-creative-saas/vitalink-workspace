import { mockStateData } from '@/data/mockSentinelData';
import { SBadge as Badge } from '@/components/standalone/SBadge';

type HeatmapState = Pick<(typeof mockStateData)[number], 'state' | 'riskLevel' | 'alerts' | 'totalCases'>;

export function GeographicHeatmap({ states = mockStateData.slice(0, 20) }: { states?: HeatmapState[] } = {}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {states.map((state) => (
        <div key={state.state} className="rounded-xl border border-slate-100 bg-slate-50 p-3 transition hover:border-blue-200 hover:bg-blue-50/50 dark:border-slate-800 dark:bg-slate-800/60 dark:hover:border-blue-900/60 dark:hover:bg-blue-950/20">
          <div className="flex items-center justify-between gap-1">
            <span className="truncate text-xs font-semibold text-slate-900 dark:text-slate-50">{state.state}</span>
            <Badge tone={state.riskLevel} className="px-1.5 text-[10px]">{state.alerts}</Badge>
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{state.totalCases.toLocaleString()} cases</p>
        </div>
      ))}
    </div>
  );
}

