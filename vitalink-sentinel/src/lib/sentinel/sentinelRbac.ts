import type { UserRole } from '@/contexts/AuthContext';
import type { SentinelTabId } from '@/types/sentinel';

const ALL_TABS: SentinelTabId[] = [
  'surveillance',
  'disease-tracking',
  'case-reporting',
  'outbreak',
  'heatmaps',
  'contact-tracing',
  'vaccination',
  'alerts',
  'epidemiology-analytics',
  'emergency',
  'community',
  'ntd',
];

const COMMUNITY_ONLY: SentinelTabId[] = ['community'];

const LAB_FOCUS: SentinelTabId[] = ['surveillance', 'case-reporting', 'outbreak', 'alerts', 'epidemiology-analytics'];

const REGIONAL_VIEW: SentinelTabId[] = ALL_TABS.filter((t) => t !== 'emergency');

/** WHO/NGO — aggregate read-only scope (same tabs, UI restricts edits via context flags) */
const OBSERVER_TABS: SentinelTabId[] = ALL_TABS;

export function tabsForRole(role: UserRole): SentinelTabId[] {
  switch (role) {
    case 'super-admin':
      return ALL_TABS;
    case 'epidemiologist':
      return ALL_TABS;
    case 'public-health-officer':
      return REGIONAL_VIEW;
    case 'government-authority':
      return ALL_TABS;
    case 'community-health-worker':
      return COMMUNITY_ONLY;
    case 'who-ngo-observer':
      return OBSERVER_TABS;
    case 'lab-scientist':
      return LAB_FOCUS;
    case 'hospital-admin':
      return ['surveillance', 'outbreak', 'heatmaps', 'alerts', 'emergency', 'case-reporting'];
    default:
      return [];
  }
}

export function canMutateSentinel(role: UserRole): boolean {
  if (role === 'who-ngo-observer') return false;
  return tabsForRole(role).length > 0;
}

export function canConfigureThresholds(role: UserRole): boolean {
  return role === 'super-admin' || role === 'epidemiologist' || role === 'government-authority';
}
