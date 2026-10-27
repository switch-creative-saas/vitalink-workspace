import { Moon, Plus, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NEW_CASE, useSentinelStore, type SentinelRoute } from '@/store/useSentinelStore';
import { NAV_ITEMS, iconButtonClass } from './navigation';

function RailButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <div className="group relative">
    <button type="button" aria-label={label} onClick={onClick} className={cn(iconButtonClass, active && 'border-slate-950 bg-slate-950 text-white hover:bg-slate-900 hover:text-white dark:border-white dark:bg-white dark:text-slate-950 dark:hover:bg-white dark:hover:text-slate-950')}>{children}</button>
    <span className="pointer-events-none absolute left-[calc(100%+12px)] top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-full bg-slate-950 px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition group-hover:opacity-100 dark:bg-white dark:text-slate-950">{label}</span>
  </div>;
}

/** Side rail: the less-visited sections, quick case reporting and the theme switch. */
export function Sidebar() {
  const { route, navigate, theme, toggleTheme } = useSentinelStore();
  const go = (target: SentinelRoute) => () => navigate(target);

  return <aside className="sticky top-[76px] hidden h-[calc(100vh-76px)] w-11 shrink-0 flex-col items-center justify-between pb-6 pt-1 md:flex">
    <div className="flex flex-col items-center gap-2.5">
      <RailButton label="Report a case" onClick={() => navigate('cases', NEW_CASE)}><Plus className="h-[18px] w-[18px]" /></RailButton>
      <span className="my-1 h-px w-6 bg-slate-900/10 dark:bg-white/10" />
      {NAV_ITEMS.filter((item) => item.placement === 'rail').map((item) => {
        const Icon = item.icon;
        return <RailButton key={item.route} label={item.label} active={route === item.route} onClick={go(item.route)}><Icon className="h-[18px] w-[18px]" /></RailButton>;
      })}
    </div>
    <div className="flex flex-col items-center gap-1.5 rounded-full border border-white/80 bg-white/60 p-1 backdrop-blur dark:border-white/10 dark:bg-white/[0.05]" role="group" aria-label="Theme">
      {(['dark', 'light'] as const).map((value) => {
        const Icon = value === 'dark' ? Moon : Sun;
        return <button key={value} type="button" aria-label={`${value === 'dark' ? 'Dark' : 'Light'} mode`} aria-pressed={theme === value} onClick={() => { if (theme !== value) toggleTheme(); }}
          className={cn('grid h-9 w-9 place-items-center rounded-full transition', theme === value ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white')}><Icon className="h-4 w-4" /></button>;
      })}
    </div>
  </aside>;
}
