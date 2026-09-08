import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { mockOrganizations, type MockOrganization, type OrganizationType } from '@/data/mockSentinelData';

export type SentinelRoute =
  | 'login'
  | 'dashboard'
  | 'outbreaks'
  | 'cases'
  | 'alerts'
  | 'heatmaps'
  | 'contact-tracing'
  | 'vaccination'
  | 'epidemiology'
  | 'emergency'
  | 'community'
  | 'ntd'
  | 'reports'
  | 'diseases'
  | 'facilities'
  | 'settings';

export type SentinelTheme = 'dark' | 'light';

interface SentinelStoreState {
  isAuthenticated: boolean;
  activeOrganization: MockOrganization | null;
  route: SentinelRoute;
  timeRange: '7d' | '30d' | '90d' | '1y';
  theme: SentinelTheme;
}

const STORAGE_KEY = 'vitalink-sentinel-standalone-store';
const SENTINEL_AUTH_KEY = 'sentinel_auth';
const SENTINEL_ORG_KEY = 'sentinel_org';

const defaultState: SentinelStoreState = {
  isAuthenticated: false,
  activeOrganization: null,
  route: 'login',
  timeRange: '30d',
  theme: 'light',
};

const VALID_ROUTES: SentinelRoute[] = [
  'dashboard',
  'outbreaks',
  'cases',
  'alerts',
  'heatmaps',
  'contact-tracing',
  'vaccination',
  'epidemiology',
  'emergency',
  'community',
  'ntd',
  'reports',
  'diseases',
  'facilities',
  'settings',
];

let state = loadState();
const listeners = new Set<() => void>();

function loadState(): SentinelStoreState {
  const bootstrapped = loadOrganizationFromUrl();
  if (bootstrapped) {
    return {
      ...defaultState,
      isAuthenticated: true,
      activeOrganization: bootstrapped.organization,
      route: bootstrapped.route,
    };
  }

  const restored = loadOrganizationFromStorage();
  if (restored) {
    return {
      ...defaultState,
      isAuthenticated: true,
      activeOrganization: restored,
      route: 'dashboard',
    };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as SentinelStoreState;
    return { ...defaultState, ...parsed, route: parsed.isAuthenticated ? parsed.route : 'login' };
  } catch {
    return defaultState;
  }
}

function loadOrganizationFromUrl(): { organization: MockOrganization; route: SentinelRoute } | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get('sentinelAuto') !== '1') return null;

  const route = routeFromParams(params);
  const orgType = mapOrganizationType(params.get('orgType'));
  const organization: MockOrganization = {
    id: params.get('orgId') || params.get('orgSlug') || 'public-health-workspace',
    name: params.get('orgShortName') || getOrgInitials(params.get('orgName') || 'Sentinel'),
    fullName: params.get('orgName') || 'Public Health Workspace',
    type: orgType,
    state: params.get('state') || (orgType === 'ngo' ? 'National' : 'Federal'),
    sector: params.get('sector') || sectorForOrganizationType(orgType),
    contactEmail: params.get('contactEmail') || undefined,
    contactPhone: params.get('contactPhone') || undefined,
    joinedNetwork: params.get('joinedNetwork') === 'true',
    createdAt: new Date().toISOString(),
    subscriptionTier: normalizeSubscriptionTier(params.get('subscriptionTier')),
  };

  localStorage.setItem(SENTINEL_ORG_KEY, JSON.stringify({
    id: organization.id,
    name: organization.fullName,
    type: params.get('orgType') || organization.type,
    sector: organization.sector,
    state: organization.state,
    contactEmail: organization.contactEmail,
    contactPhone: organization.contactPhone,
    joinedNetwork: organization.joinedNetwork,
    createdAt: organization.createdAt,
    subscriptionTier: organization.subscriptionTier,
  }));
  localStorage.setItem(SENTINEL_AUTH_KEY, JSON.stringify({
    isAuthenticated: true,
    orgId: organization.id,
    orgType: params.get('orgType') || organization.type,
  }));
  window.history.replaceState({}, '', window.location.pathname || '/');
  return { organization, route };
}

function loadOrganizationFromStorage(): MockOrganization | null {
  try {
    const authRaw = localStorage.getItem(SENTINEL_AUTH_KEY);
    const orgRaw = localStorage.getItem(SENTINEL_ORG_KEY);
    if (!authRaw || !orgRaw) return null;

    const auth = JSON.parse(authRaw) as { isAuthenticated?: boolean; orgId?: string; orgType?: string };
    if (!auth.isAuthenticated) return null;

    const org = JSON.parse(orgRaw) as {
      id?: string;
      name?: string;
      type?: string;
      sector?: string;
      state?: string;
      contactEmail?: string;
      contactPhone?: string;
      joinedNetwork?: boolean;
      createdAt?: string;
      subscriptionTier?: 'free' | 'standard' | 'premium';
    };
    const orgType = mapOrganizationType(org.type ?? auth.orgType);
    const fullName = org.name || 'Public Health Workspace';
    return {
      id: org.id || auth.orgId || 'public-health-workspace',
      name: getOrgInitials(fullName),
      fullName,
      type: orgType,
      state: org.state || (orgType === 'ngo' ? 'National' : 'Federal'),
      sector: org.sector || sectorForOrganizationType(orgType),
      contactEmail: org.contactEmail,
      contactPhone: org.contactPhone,
      joinedNetwork: org.joinedNetwork,
      createdAt: org.createdAt,
      subscriptionTier: org.subscriptionTier,
    };
  } catch {
    return null;
  }
}

function routeFromParams(params: URLSearchParams): SentinelRoute {
  const route = params.get('route') as SentinelRoute | null;
  return route && VALID_ROUTES.includes(route) ? route : 'dashboard';
}

function mapOrganizationType(type?: string | null): OrganizationType {
  const key = type?.trim().toLowerCase().replace(/_/g, '-') ?? '';
  if (key === 'government' || key === 'ministry' || key === 'state-ministry') return 'state_ministry';
  if (key === 'national-agency') return 'national_agency';
  if (key === 'international') return 'international';
  if (key === 'hmo') return 'hmo';
  if (key === 'insurance') return 'insurance';
  return 'ngo';
}

function sectorForOrganizationType(type: OrganizationType): string {
  if (type === 'ngo') return 'NGO';
  if (type === 'state_ministry' || type === 'ministry' || type === 'national_agency') return 'Public';
  return 'Private';
}

function getOrgInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 4) || 'SO';
}

function normalizeSubscriptionTier(value?: string | null): 'free' | 'standard' | 'premium' {
  return value === 'standard' || value === 'premium' ? value : 'free';
}

function emit() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (state.isAuthenticated && state.activeOrganization) {
    localStorage.setItem(SENTINEL_AUTH_KEY, JSON.stringify({
      isAuthenticated: true,
      orgId: state.activeOrganization.id,
      orgType: state.activeOrganization.type,
    }));
    localStorage.setItem(SENTINEL_ORG_KEY, JSON.stringify({
      id: state.activeOrganization.id,
      name: state.activeOrganization.fullName,
      type: state.activeOrganization.type,
      sector: state.activeOrganization.sector ?? sectorForOrganizationType(state.activeOrganization.type),
      state: state.activeOrganization.state,
      contactEmail: state.activeOrganization.contactEmail,
      contactPhone: state.activeOrganization.contactPhone,
      joinedNetwork: state.activeOrganization.joinedNetwork,
      createdAt: state.activeOrganization.createdAt,
      subscriptionTier: state.activeOrganization.subscriptionTier ?? 'free',
    }));
  }
  document.documentElement.classList.toggle('dark', state.theme === 'dark');
  document.documentElement.style.colorScheme = state.theme;
  listeners.forEach((listener) => listener());
}

function setState(next: Partial<SentinelStoreState>) {
  state = { ...state, ...next };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

emit();

export function useSentinelStore() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', snapshot.theme === 'dark');
  }, [snapshot.theme]);

  const login = useCallback((organizationId: string) => {
    const organization = mockOrganizations.find((org) => org.id === organizationId) ?? mockOrganizations[0];
    setState({ isAuthenticated: true, activeOrganization: organization, route: 'dashboard' });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(SENTINEL_AUTH_KEY);
    localStorage.removeItem(SENTINEL_ORG_KEY);
    setState({ isAuthenticated: false, activeOrganization: null, route: 'login' });
  }, []);

  return {
    ...snapshot,
    organizations: mockOrganizations,
    login,
    logout,
    navigate: (route: SentinelRoute) => setState({ route }),
    setTimeRange: (timeRange: SentinelStoreState['timeRange']) => setState({ timeRange }),
    toggleTheme: () => setState({ theme: snapshot.theme === 'dark' ? 'light' : 'dark' }),
  };
}
