import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { mockOrganizations, type MockOrganization, type OrganizationType } from '@/data/mockSentinelData';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { getMe, signOut as liveSignOut, type SentinelMe } from '@/lib/supabase/sentinel';

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
  /** Live mode: false until the Supabase session has been checked. */
  authReady: boolean;
  /** Live mode: the signed-in Sentinel member. */
  me: SentinelMe | null;
  /** Live mode: signed in, but not yet part of a Sentinel organisation (finish registration). */
  pendingAccount: { email: string; fullName: string } | null;
  route: SentinelRoute;
  timeRange: '7d' | '30d' | '90d' | '1y';
  theme: SentinelTheme;
  /** A record to open once its page loads (search results, inbox, alert links). */
  focus: { route: SentinelRoute; id: string; query?: string } | null;
}

const STORAGE_KEY = 'vitalink-sentinel-standalone-store';
const SENTINEL_AUTH_KEY = 'sentinel_auth';
const SENTINEL_ORG_KEY = 'sentinel_org';

const defaultState: SentinelStoreState = {
  isAuthenticated: false,
  activeOrganization: null,
  authReady: !isSupabaseConfigured,
  me: null,
  pendingAccount: null,
  route: 'login',
  timeRange: '30d',
  theme: 'light',
  focus: null,
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
  // Live: only a real Supabase session (checked in bootstrapLiveSession) signs anyone
  // in. Browser storage and ?sentinelAuto=1 links are trusted in the offline demo only.
  if (isSupabaseConfigured) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<SentinelStoreState>;
      return { ...defaultState, theme: saved.theme ?? defaultState.theme, timeRange: saved.timeRange ?? defaultState.timeRange };
    } catch {
      return defaultState;
    }
  }

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(isSupabaseConfigured
    ? { theme: state.theme, timeRange: state.timeRange, route: state.route }
    : state));
  if (!isSupabaseConfigured && state.isAuthenticated && state.activeOrganization) {
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

/** `navigate('cases', NEW_CASE)` opens the case report form. */
export const NEW_CASE = 'new';

// Stable references, so components can pass them to effects and callbacks.
function navigate(route: SentinelRoute, focusId?: string, query?: string) {
  setState({ route, focus: focusId ? { route, id: focusId, query } : null });
}

function clearFocus() {
  if (state.focus) setState({ focus: null });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

emit();

// ---------------------------------------------------------------------------
// Live mode (Supabase)

const LIVE_ORG_TYPES: Record<string, OrganizationType> = {
  NGO: 'ngo', Government: 'national_agency', Ministry: 'state_ministry', International: 'international', Research: 'ngo', Academic: 'ngo',
};

function organizationFromMe(me: SentinelMe): MockOrganization {
  const type = LIVE_ORG_TYPES[me.organization.type] ?? 'ngo';
  return {
    id: me.organization.id,
    name: getOrgInitials(me.organization.name),
    fullName: me.organization.name,
    type,
    state: me.organization.state,
    sector: sectorForOrganizationType(type),
    contactEmail: me.organization.contactEmail ?? undefined,
    contactPhone: me.organization.contactPhone ?? undefined,
    createdAt: me.organization.createdAt,
    subscriptionTier: 'free',
  };
}

function lastRoute(): SentinelRoute {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { route?: SentinelRoute };
    return saved.route && VALID_ROUTES.includes(saved.route) ? saved.route : 'dashboard';
  } catch {
    return 'dashboard';
  }
}

/** Signs the current Supabase user in to Sentinel, or flags that they still need an organisation. */
export async function syncLiveSession(): Promise<SentinelMe | null> {
  const { data } = await supabase!.auth.getSession();
  const user = data.session?.user;
  if (!user) {
    setState({ authReady: true, isAuthenticated: false, me: null, activeOrganization: null, pendingAccount: null, route: 'login' });
    return null;
  }
  const me = await getMe().catch(() => null);
  if (me) {
    setState({ authReady: true, isAuthenticated: true, me, activeOrganization: organizationFromMe(me), pendingAccount: null,
      route: state.isAuthenticated ? state.route : lastRoute() });
  } else {
    setState({ authReady: true, isAuthenticated: false, me: null, activeOrganization: null, route: 'login',
      pendingAccount: { email: user.email ?? '', fullName: (user.user_metadata?.full_name as string | undefined) ?? '' } });
  }
  return me;
}

let liveStarted = false;
/** Called once at start-up: restores the session and follows sign-in / sign-out from any tab. */
export function bootstrapLiveSession() {
  if (!isSupabaseConfigured || liveStarted) return;
  liveStarted = true;
  void syncLiveSession();
  supabase!.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') setState({ isAuthenticated: false, me: null, activeOrganization: null, pendingAccount: null, route: 'login' });
    if (event === 'SIGNED_IN') void syncLiveSession();
  });
}

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
    if (isSupabaseConfigured) {
      void liveSignOut();
      setState({ isAuthenticated: false, me: null, activeOrganization: null, pendingAccount: null, route: 'login' });
      return;
    }
    localStorage.removeItem(SENTINEL_AUTH_KEY);
    localStorage.removeItem(SENTINEL_ORG_KEY);
    setState({ isAuthenticated: false, activeOrganization: null, route: 'login' });
  }, []);

  return {
    ...snapshot,
    organizations: mockOrganizations,
    login,
    logout,
    navigate,
    clearFocus,
    setTimeRange: (timeRange: SentinelStoreState['timeRange']) => setState({ timeRange }),
    toggleTheme: () => setState({ theme: snapshot.theme === 'dark' ? 'light' : 'dark' }),
  };
}
