import {
  AlertTriangle, BarChart3, Bell, BookOpen, Building2, ClipboardList, FileBarChart, LayoutGrid, MapPinned, Microscope, Network, RadioTower,
  Settings, Syringe, Users,
} from 'lucide-react';
import type { SentinelRoute } from '@/store/useSentinelStore';

export interface NavItem {
  route: SentinelRoute;
  label: string;
  icon: typeof LayoutGrid;
  /** Top bar pills hold the everyday sections; the rest sit on the side rail. */
  placement: 'top' | 'rail';
  group: 'Overview' | 'Surveillance' | 'Intelligence' | 'Operations' | 'Administration';
}

export const NAV_ITEMS: NavItem[] = [
  { route: 'dashboard', label: 'Dashboard', icon: LayoutGrid, placement: 'top', group: 'Overview' },
  { route: 'outbreaks', label: 'Outbreaks', icon: AlertTriangle, placement: 'top', group: 'Surveillance' },
  { route: 'cases', label: 'Cases', icon: ClipboardList, placement: 'top', group: 'Surveillance' },
  { route: 'alerts', label: 'Alerts', icon: Bell, placement: 'top', group: 'Surveillance' },
  { route: 'heatmaps', label: 'Heatmaps', icon: MapPinned, placement: 'top', group: 'Surveillance' },
  { route: 'facilities', label: 'Facilities', icon: Building2, placement: 'top', group: 'Operations' },
  { route: 'reports', label: 'Reports', icon: FileBarChart, placement: 'top', group: 'Operations' },
  { route: 'contact-tracing', label: 'Contact Tracing', icon: Network, placement: 'rail', group: 'Surveillance' },
  { route: 'epidemiology', label: 'Epidemiology', icon: BarChart3, placement: 'rail', group: 'Intelligence' },
  { route: 'diseases', label: 'Disease Registry', icon: BookOpen, placement: 'rail', group: 'Intelligence' },
  { route: 'ntd', label: 'NTD Monitoring', icon: Microscope, placement: 'rail', group: 'Intelligence' },
  { route: 'vaccination', label: 'Vaccination', icon: Syringe, placement: 'rail', group: 'Operations' },
  { route: 'emergency', label: 'Emergency Center', icon: RadioTower, placement: 'rail', group: 'Operations' },
  { route: 'community', label: 'Community Reports', icon: Users, placement: 'rail', group: 'Operations' },
  { route: 'settings', label: 'Settings', icon: Settings, placement: 'rail', group: 'Administration' },
];

export const PAGE_TITLES: Record<SentinelRoute, string> = {
  login: 'Sign in',
  dashboard: 'National Surveillance',
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

export const iconButtonClass = 'relative grid h-11 w-11 shrink-0 place-items-center rounded-full border border-white/80 bg-white/70 text-slate-700 shadow-[0_6px_18px_-12px_rgba(15,23,42,0.45)] backdrop-blur transition hover:bg-white hover:text-slate-950 dark:border-white/10 dark:bg-white/[0.06] dark:text-slate-300 dark:hover:bg-white/[0.12] dark:hover:text-white';
