import { AlertTriangle, BarChart3, Bell, BookOpen, Building2, ClipboardList, Grid3X3, LogOut, MapPinned, Microscope, Network, RadioTower, Settings, Syringe, Users } from 'lucide-react';
import { SButton as Button } from '@/components/standalone/SButton';
import { cn } from '@/lib/utils';
import { useSentinelStore, type SentinelRoute } from '@/store/useSentinelStore';

const navSections: { label: string; items: { route: SentinelRoute; label: string; icon: typeof Grid3X3 }[] }[] = [
  {
    label: 'Overview',
    items: [{ route: 'dashboard', label: 'Dashboard', icon: Grid3X3 }],
  },
  {
    label: 'Surveillance',
    items: [
      { route: 'outbreaks', label: 'Outbreaks', icon: AlertTriangle },
      { route: 'cases', label: 'Cases', icon: ClipboardList },
      { route: 'alerts', label: 'Alerts', icon: Bell },
      { route: 'heatmaps', label: 'Heatmaps', icon: MapPinned },
      { route: 'contact-tracing', label: 'Contact Tracing', icon: Network },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { route: 'epidemiology', label: 'Epidemiology', icon: BarChart3 },
      { route: 'diseases', label: 'Disease Registry', icon: BookOpen },
      { route: 'ntd', label: 'NTD Monitoring', icon: Microscope },
    ],
  },
  {
    label: 'Operations',
    items: [
      { route: 'vaccination', label: 'Vaccination', icon: Syringe },
      { route: 'emergency', label: 'Emergency Center', icon: RadioTower },
      { route: 'community', label: 'Community Reports', icon: Users },
      { route: 'facilities', label: 'Facilities', icon: Building2 },
      { route: 'reports', label: 'Reports', icon: ClipboardList },
    ],
  },
  {
    label: 'Administration',
    items: [{ route: 'settings', label: 'Settings', icon: Settings }],
  },
];

const orgTypeBadgeColors: Record<string, string> = {
  ngo: 'bg-blue-500/15 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  state_ministry: 'bg-purple-500/15 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  ministry: 'bg-purple-500/15 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  national_agency: 'bg-purple-500/15 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
  hmo: 'bg-green-500/15 text-green-700 dark:bg-green-500/20 dark:text-green-300',
  insurance: 'bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
};

function formatOrgType(type?: string) {
  if (!type) return 'NGO';
  if (type === 'state_ministry') return 'Government';
  if (type === 'national_agency') return 'National Agency';
  return type.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function Sidebar() {
  const { route, navigate, activeOrganization, logout } = useSentinelStore();
  const orgType = activeOrganization?.type ?? 'ngo';

  return (
    <aside className="fixed inset-y-0 left-0 hidden w-[272px] flex-col border-r border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-950 lg:flex">
      <div className="flex items-center gap-3">
        <img src="/sentinel-logo.svg" alt="" className="h-11 w-11 rounded-xl border border-slate-100 bg-white shadow-sm dark:border-slate-800" />
        <div>
          <p className="font-bold text-slate-950 dark:text-slate-50">VitaLink Sentinel</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Disease Intelligence</p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/70">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-950 dark:text-slate-50">{activeOrganization?.fullName ?? 'No organization'}</p>
            <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{formatOrgType(orgType)} • {activeOrganization?.sector ?? 'Public Health'}</p>
          </div>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold', orgTypeBadgeColors[orgType] ?? 'bg-slate-500/15 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300')}>
            {formatOrgType(orgType)}
          </span>
        </div>
      </div>

      <nav className="mt-6 flex-1 space-y-5 overflow-y-auto pr-1">
        {navSections.map((section) => (
          <div key={section.label}>
            <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{section.label}</p>
            <div className="mt-2 space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                const active = route === item.route;
                return (
                  <button
                    key={`${section.label}-${item.label}`}
                    onClick={() => navigate(item.route)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
                      active
                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-50',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                    {item.route === 'alerts' && <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] text-white">4</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
        <p className="text-sm font-medium text-slate-950 dark:text-slate-50">Sentinel Officer</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{activeOrganization?.name}</p>
        <Button className="mt-3 w-full bg-slate-950 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700" onClick={logout}>
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}

