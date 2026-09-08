import { Bell, ChevronDown, Moon, Search, Settings, Sun } from 'lucide-react';
import { SBadge as Badge } from '@/components/standalone/SBadge';
import { SButton as Button } from '@/components/standalone/SButton';
import { DateRangePicker } from '@/components/ui/DateRangePicker';
import { useSentinelStore } from '@/store/useSentinelStore';

const titles = {
  login: 'Login',
  dashboard: 'National Surveillance Dashboard',
  outbreaks: 'Active Outbreaks',
  cases: 'Case Registry',
  alerts: 'Alert Management',
  heatmaps: 'Geographic Heatmaps',
  'contact-tracing': 'Contact Tracing',
  vaccination: 'Vaccination Monitoring',
  epidemiology: 'Epidemiology Analytics',
  emergency: 'Emergency Response Center',
  community: 'Community Reporting',
  ntd: 'NTD Monitoring',
  reports: 'Surveillance Reports',
  diseases: 'Disease Intelligence Registry',
  facilities: 'Reporting Network',
  settings: 'Organization Settings',
};

function getOrgInitials(name?: string) {
  return (name ?? 'Sentinel Organization')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 4);
}

export function TopBar() {
  const { route, activeOrganization, theme, toggleTheme } = useSentinelStore();
  const orgInitials = getOrgInitials(activeOrganization?.fullName ?? activeOrganization?.name);
  return (
    <header className="sticky top-0 z-40 flex h-20 items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90 lg:px-6">
      <div>
        <p className="text-xs font-medium text-slate-400 dark:text-slate-500">Sentinel / {titles[route]}</p>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-950 dark:text-slate-50">{titles[route]}</h1>
      </div>
      <div className="hidden min-w-0 flex-1 justify-center xl:flex">
        <div className="flex h-10 w-full max-w-md items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 text-slate-400 dark:border-slate-800 dark:bg-slate-900">
          <Search className="h-4 w-4" />
          <input className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-50" placeholder="Search within Sentinel..." />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <DateRangePicker />
        <Button className="relative h-10 w-10 border-slate-200 bg-white p-0 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
          <Bell className="h-4 w-4" />
          <span className="absolute -right-1 -top-1 h-4 min-w-4 rounded-full bg-red-500 px-1 text-[10px]">4</span>
        </Button>
        <Button className="hidden h-10 w-10 border-slate-200 bg-white p-0 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:inline-flex">
          <Settings className="h-4 w-4" />
        </Button>
        <Badge className="hidden md:inline-flex">{orgInitials}</Badge>
        <Button className="h-10 w-10 border-slate-200 bg-white p-0 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800" onClick={toggleTheme}>
          {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </Button>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 py-1 pl-1 pr-2 dark:border-slate-800 dark:bg-slate-900">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-blue-600 text-xs font-bold text-white">{orgInitials}</div>
          <span className="hidden text-sm font-semibold text-slate-900 dark:text-slate-50 lg:inline">Jane C</span>
          <ChevronDown className="hidden h-4 w-4 text-slate-400 lg:block" />
        </div>
      </div>
    </header>
  );
}

