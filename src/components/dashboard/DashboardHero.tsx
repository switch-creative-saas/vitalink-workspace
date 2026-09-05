import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface HeroKpi {
  label: string;
  value: string;
  sublabel?: string;
}

interface DashboardHeroProps {
  userName?: string;
  dailySummary: string;
  kpis: HeroKpi[];
  className?: string;
}

export function DashboardHero({ userName, dailySummary, kpis, className }: DashboardHeroProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200/80 bg-white shadow-soft overflow-hidden min-w-0 dark:border-slate-700 dark:bg-slate-800/80',
        className,
      )}
    >
      <div className="bg-gradient-to-r from-[#1E3A8A] to-[#1E4ED8] px-4 py-3 text-white">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded-full bg-white/15 text-[10px] font-medium backdrop-blur-sm">
                VitaLink
              </span>
              <span className="px-2 py-0.5 rounded-full bg-vitamind-500/30 text-violet-100 text-[10px] font-medium flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                VitaMind
              </span>
            </div>
            <h1 className="text-lg sm:text-xl font-bold truncate">
              Welcome back{userName ? `, ${userName.split(' ')[0]}` : ''}
            </h1>
            <p className="text-xs sm:text-sm text-white/80 mt-0.5 line-clamp-2 max-w-2xl">{dailySummary}</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 lg:gap-3 flex-shrink-0 lg:max-w-[52%] w-full">
            {kpis.map((kpi) => (
              <div
                key={kpi.label}
                className="rounded-lg bg-white/10 backdrop-blur-sm border border-white/15 px-2.5 py-2 min-w-0"
              >
                <p className="text-[10px] uppercase tracking-wide text-white/70 truncate">{kpi.label}</p>
                <p className="text-sm sm:text-base font-bold truncate tabular-nums">{kpi.value}</p>
                {kpi.sublabel && (
                  <p className="text-[10px] text-white/60 truncate">{kpi.sublabel}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
