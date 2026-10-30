import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { LifeBuoy, Lock } from 'lucide-react';
import { ResponsiveProvider } from '@/contexts/ResponsiveContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { SubscriptionProvider } from '@/contexts/SubscriptionContext';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageContainer } from '@/components/layout/PageContainer';
import { VitaMindAIPanel } from '@/components/ai/VitaMindAIPanel';
import { AIFloatingButton } from '@/components/ai/AIFloatingButton';
import { AuthGatewayPage } from '@/pages/AuthGatewayPage';
import { resetPlatformAdminCheck } from '@/hooks/usePlatformAdmin';
import { Toaster } from '@/components/ui/sonner';
import type { PageType } from '@/types';
import { GuidedTourProvider, useGuidedTour } from '@/contexts/GuidedTourContext';
import { WorkspaceSetup } from '@/components/onboarding/WorkspaceSetup';
import { useAuth } from '@/contexts/AuthContext';
import { SecurityAuditProvider } from '@/contexts/SecurityAuditContext';
import { AppointmentProvider } from '@/contexts/AppointmentContext';
import { BRAND } from '@/config/brand';
import { defaultPageForWorkspace, workspaceDescriptor } from '@/lib/workspace/workspace';
import type { OrganizationProfile } from '@/lib/workspace/organizationTypes';
import { usePlan } from '@/hooks/usePlan';
import { UpgradeGate } from '@/components/UpgradeGate';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { signOut } from '@/lib/supabase/auth';
import { SessionGuard } from '@/components/security/SessionGuard';
import { OfflineBanner } from '@/components/offline/OfflineStatus';
import { ProfileSync } from '@/components/profile/ProfileSync';
import { MfaGate } from '@/components/auth/MfaGate';
import { MfaReminder } from '@/components/auth/MfaReminder';
import { isLowData } from '@/lib/network/dataSaver';
import { PageLoading, PageLoadBoundary } from '@/components/layout/PageLoading';
import { startOfflinePreparation } from '@/lib/offline/prepare';

// The VitaLink Console is its own app (own sign-in, own layout); only its code is downloaded at /console.
// Pages load on first use (one small file each), so the first visit on a slow connection only
// downloads the sign-in screen and the shell. Once signed in on a good connection the rest are
// fetched in the background so moving around is instant (skipped in low-data mode).
const PAGE_LOADERS = {
  DashboardPage: () => import('@/pages/DashboardPage'),
  PatientIdentityPage: () => import('@/pages/PatientIdentityPage'),
  PatientsPage: () => import('@/pages/PatientsPage'),
  EMRPage: () => import('@/pages/EMRPage'),
  TelemedicinePage: () => import('@/pages/TelemedicinePage'),
  AIClinicalIntelligencePage: () => import('@/pages/AIClinicalIntelligencePage'),
  VitaLinkNetworkPage: () => import('@/pages/VitaLinkNetworkPage'),
  AppointmentsPage: () => import('@/pages/AppointmentsPage'),
  LaboratoryPage: () => import('@/pages/LaboratoryPage'),
  PharmacyPage: () => import('@/pages/PharmacyPage'),
  BillingPage: () => import('@/pages/BillingPage'),
  AnalyticsPage: () => import('@/pages/AnalyticsPage'),
  HumanResourcesPage: () => import('@/pages/HumanResourcesPage'),
  AdministrationPage: () => import('@/pages/AdministrationPage'),
  SubscriptionPage: () => import('@/pages/SubscriptionPage'),
  AuditLogsPage: () => import('@/pages/AuditLogsPage'),
  SettingsPage: () => import('@/pages/SettingsPage'),
  HelpSupportPage: () => import('@/pages/HelpSupportPage'),
  NFCCardsPage: () => import('@/pages/NFCCardsPage'),
  PatientVisitPage: () => import('@/pages/PatientVisitPage'),
};
const DashboardPage = lazy(() => PAGE_LOADERS.DashboardPage().then((m) => ({ default: m.DashboardPage })));
const PatientIdentityPage = lazy(() => PAGE_LOADERS.PatientIdentityPage().then((m) => ({ default: m.PatientIdentityPage })));
const PatientsPage = lazy(() => PAGE_LOADERS.PatientsPage().then((m) => ({ default: m.PatientsPage })));
const EMRPage = lazy(() => PAGE_LOADERS.EMRPage().then((m) => ({ default: m.EMRPage })));
const TelemedicinePage = lazy(() => PAGE_LOADERS.TelemedicinePage().then((m) => ({ default: m.TelemedicinePage })));
const AIClinicalIntelligencePage = lazy(() => PAGE_LOADERS.AIClinicalIntelligencePage().then((m) => ({ default: m.AIClinicalIntelligencePage })));
const VitaLinkNetworkPage = lazy(() => PAGE_LOADERS.VitaLinkNetworkPage().then((m) => ({ default: m.VitaLinkNetworkPage })));
const AppointmentsPage = lazy(() => PAGE_LOADERS.AppointmentsPage().then((m) => ({ default: m.AppointmentsPage })));
const LaboratoryPage = lazy(() => PAGE_LOADERS.LaboratoryPage().then((m) => ({ default: m.LaboratoryPage })));
const PharmacyPage = lazy(() => PAGE_LOADERS.PharmacyPage().then((m) => ({ default: m.PharmacyPage })));
const BillingPage = lazy(() => PAGE_LOADERS.BillingPage().then((m) => ({ default: m.BillingPage })));
const AnalyticsPage = lazy(() => PAGE_LOADERS.AnalyticsPage().then((m) => ({ default: m.AnalyticsPage })));
const HumanResourcesPage = lazy(() => PAGE_LOADERS.HumanResourcesPage().then((m) => ({ default: m.HumanResourcesPage })));
const AdministrationPage = lazy(() => PAGE_LOADERS.AdministrationPage().then((m) => ({ default: m.AdministrationPage })));
const SubscriptionPage = lazy(() => PAGE_LOADERS.SubscriptionPage().then((m) => ({ default: m.SubscriptionPage })));
const AuditLogsPage = lazy(() => PAGE_LOADERS.AuditLogsPage().then((m) => ({ default: m.AuditLogsPage })));
const SettingsPage = lazy(() => PAGE_LOADERS.SettingsPage().then((m) => ({ default: m.SettingsPage })));
const HelpSupportPage = lazy(() => PAGE_LOADERS.HelpSupportPage().then((m) => ({ default: m.HelpSupportPage })));
const NFCCardsPage = lazy(() => PAGE_LOADERS.NFCCardsPage().then((m) => ({ default: m.NFCCardsPage })));
const PatientVisitPage = lazy(() => PAGE_LOADERS.PatientVisitPage().then((m) => ({ default: m.PatientVisitPage })));

function prefetchPages() {
  if (isLowData()) return;
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1500));
  idle(() => { Object.values(PAGE_LOADERS).forEach((load) => void load().catch(() => undefined)); });
}

const ConsoleApp = lazy(() => import('@/components/console/ConsoleApp'));

function App() {
  // Patients open video-visit links without an account.
  if (isSupabaseConfigured && window.location.pathname === '/visit') return <Suspense fallback={<PageLoading fullScreen />}><PatientVisitPage /></Suspense>;
  if (isSupabaseConfigured && /^\/console(\/|$)/.test(window.location.pathname)) {
    return <Suspense fallback={null}><ConsoleApp /></Suspense>;
  }
  return (
    <ResponsiveProvider>
      <AuthProvider>
        <SubscriptionProvider>
          <AppShell />
        </SubscriptionProvider>
      </AuthProvider>
    </ResponsiveProvider>
  );
}

function AppShell() {
  const {
    currentRole,
    userName,
    userEmail,
    setCurrentRole,
    setUserProfile,
    clearUserProfile,
    canAccessPage,
    organization,
    workspaceType,
    setActiveOrganization,
  } = useAuth();
  const { hasModule } = usePlan();
  // With Supabase the gateway always re-validates the real session on load.
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => !isSupabaseConfigured && Boolean(localStorage.getItem('vitalink-auth-session')));
  // Signed in: fetch the other pages in the background (good connections only).
  useEffect(() => { if (isAuthenticated) prefetchPages(); }, [isAuthenticated]);
  // Signed in: get this device ready to work offline (every page and recent records), then keep it fresh.
  useEffect(() => {
    if (!isAuthenticated || !isSupabaseConfigured || !/^[0-9a-f-]{36}$/i.test(organization.id)) return;
    return startOfflinePreparation(organization.id);
  }, [isAuthenticated, organization.id]);
  const [currentPage, setCurrentPage] = useState<PageType>('dashboard');
  const [vitaMindPanelOpen, setVitaMindPanelOpen] = useState(false);
  const [emrSwitchId, setEmrSwitchId] = useState<string | null>(null);
  // The address the app was opened on (e.g. a bookmark, or a payment provider's
  // return URL with ?reference=...). Sign-in redirects would otherwise replace it.
  const [deepLink, setDeepLink] = useState<string | null>(() => {
    const { pathname, search } = window.location;
    return pathname === '/' || pathname === '' ? null : `${pathname}${search}`;
  });
  const pagePathMap: Partial<Record<Exclude<PageType, 'emr'>, string>> = {
    dashboard: '/',
    'patient-identity': '/patient-identity',
    patients: '/patients',
    telemedicine: '/telemedicine',
    'ai-clinical-intelligence': '/ai-clinical-intelligence',
    'switch-network': '/switch-network',
    appointments: '/appointments',
    laboratory: '/laboratory',
    pharmacy: '/pharmacy',
    billing: '/billing',
    analytics: '/analytics',
    'human-resources': '/human-resources',
    administration: '/administration',
    'nfc-cards': '/nfc-cards',
    subscription: '/subscription',
    'audit-logs': '/audit-logs',
    settings: '/settings',
    help: '/help',
  };

  const parseRoute = () => {
    const path = window.location.pathname;
    if (path.startsWith('/emr/')) {
      const id = decodeURIComponent(path.replace('/emr/', ''));
      setCurrentPage('emr');
      setEmrSwitchId(id || null);
      return;
    }
    if (path === '/emr') {
      setCurrentPage('emr');
      setEmrSwitchId(null);
      return;
    }
    if (path === '/patients') {
      setCurrentPage('patients');
      setEmrSwitchId(null);
      return;
    }
    const pageEntry = Object.entries(pagePathMap).find(([, routePath]) => routePath === path);
    if (pageEntry) {
      setCurrentPage(pageEntry[0] as PageType);
      setEmrSwitchId(null);
      return;
    }
    setCurrentPage('dashboard');
    setEmrSwitchId(null);
  };

  useEffect(() => {
    parseRoute();
    const onPopState = () => parseRoute();
    const onAppNavigate = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; page?: PageType; switchId?: string }>).detail;
      if (!detail) return;
      if (detail.switchId) {
        openEmrForPatient(detail.switchId);
        return;
      }
      if (detail.page) {
        navigateToPage(detail.page);
        return;
      }
      if (detail.path) {
        window.history.pushState({}, '', detail.path);
        parseRoute();
      }
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('app:navigate', onAppNavigate as EventListener);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('app:navigate', onAppNavigate as EventListener);
    };
  }, []);

  const canLeaveOnboardingWizard = () => {
    const guardedWindow = window as Window & { __vitalinkOnboardingRouteGuard?: () => boolean };
    return guardedWindow.__vitalinkOnboardingRouteGuard?.() ?? true;
  };

  const navigateToPage = (page: PageType) => {
    if (!canLeaveOnboardingWizard()) return;
    setCurrentPage(page);
    if (page === 'emr') {
      const path = emrSwitchId ? `/emr/${encodeURIComponent(emrSwitchId)}` : '/emr';
      window.history.pushState({}, '', path);
      return;
    }
    const path = pagePathMap[page as Exclude<PageType, 'emr'>] ?? '/';
    window.history.pushState({}, '', path);
  };

  const openEmrForPatient = (switchId: string) => {
    if (!canLeaveOnboardingWizard()) return;
    setCurrentPage('emr');
    setEmrSwitchId(switchId);
    window.history.pushState({}, '', `/emr/${encodeURIComponent(switchId)}`);
  };

  const renderPage = () => {
    if (!canAccessPage(currentPage)) {
      return (
        <AccessRestricted
          pageTitle={getPageTitle()}
          workspaceDescription={workspaceDescriptor(organization)}
          onNavigateHome={() => navigateToPage(defaultPageForWorkspace(workspaceType))}
        />
      );
    }

    const gatedPages: Partial<Record<PageType, { requiredPlan: string; moduleName: string; description: string; features: string[] }>> = {
      telemedicine: { requiredPlan: 'Growth Corridor', moduleName: 'Telemedicine', description: 'Enable virtual consultations integrated with patient EMR records.', features: ['Video and voice consultations', 'Prescription generation', 'EMR-connected consultation notes'] },
      laboratory: { requiredPlan: 'Growth Corridor', moduleName: 'Laboratory', description: 'Manage lab orders and result workflows from the patient record.', features: ['Lab order management', 'Result validation', 'EMR-linked diagnostics'] },
      pharmacy: { requiredPlan: 'Growth Corridor', moduleName: 'Pharmacy', description: 'Coordinate dispensing and medicine inventory from a single workspace.', features: ['Dispensing workflows', 'Inventory visibility', 'EMR-linked prescriptions'] },
      'human-resources': { requiredPlan: 'Growth Corridor', moduleName: 'Human Resources', description: 'Coordinate staffing, schedules, and workforce operations.', features: ['Staff records', 'Workforce scheduling', 'Operational reporting'] },
      analytics: { requiredPlan: 'Growth Corridor', moduleName: 'Analytics', description: 'Unlock advanced hospital performance analytics and reporting.', features: ['Performance dashboards', 'Operational trends', 'Exportable reports'] },
      administration: { requiredPlan: 'Enterprise', moduleName: 'Administration', description: 'Manage multi-site controls and enterprise workspace settings.', features: ['Multi-site controls', 'Custom workflows', 'Enterprise administration'] },
      'audit-logs': { requiredPlan: 'Enterprise', moduleName: 'Security & Audit', description: 'Review enterprise-grade security and audit history.', features: ['Detailed audit trails', 'Security oversight', 'Compliance reporting'] },
    };
    const gate = gatedPages[currentPage];
    if (gate && !hasModule(currentPage)) return <UpgradeGate {...gate} onBack={() => navigateToPage('dashboard')} />;

    switch (currentPage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'patient-identity':
        return <PatientIdentityPage />;
      case 'patients':
        return <PatientsPage onOpenPatientEmr={openEmrForPatient} />;
      case 'emr':
        return <EMRPage patientSwitchId={emrSwitchId ?? undefined} onBackToPatients={() => window.history.length > 1 ? window.history.back() : navigateToPage('patients')} />;
      case 'telemedicine':
        return <TelemedicinePage />;
      case 'ai-clinical-intelligence':
        return <AIClinicalIntelligencePage />;
      case 'switch-network':
        return <VitaLinkNetworkPage />;
      case 'appointments':
        return <AppointmentsPage />;
      case 'laboratory':
        return <LaboratoryPage />;
      case 'pharmacy':
        return <PharmacyPage />;
      case 'billing':
        return <BillingPage />;
      case 'analytics':
        return <AnalyticsPage />;
      case 'human-resources':
        return <HumanResourcesPage />;
      case 'administration':
        return <AdministrationPage />;
      case 'nfc-cards':
        return <NFCCardsPage />;
      case 'subscription':
        return <SubscriptionPage />;
      case 'audit-logs':
        return <AuditLogsPage />;
      case 'settings':
        return <SettingsPage onLogout={() => void handleLogout()} onDeleteAccount={handleDeleteAccount} />;
      case 'help':
        return <HelpSupportPage />;
      default:
        return <DashboardPage />;
    }
  };

  const getPageTitle = () => {
    switch (currentPage) {
      case 'dashboard':
        return 'Dashboard';
      case 'patient-identity':
        return 'Digital Health Identity';
      case 'patients':
        return 'Patient Management';
      case 'emr':
        return 'Electronic Medical Records';
      case 'telemedicine':
        return 'Telemedicine';
      case 'ai-clinical-intelligence':
        return 'AI Clinical Intelligence';
      case 'switch-network':
        return BRAND.network;
      case 'appointments':
        return 'Appointments';
      case 'laboratory':
        return 'Laboratory';
      case 'pharmacy':
        return 'Pharmacy';
      case 'billing':
        return 'Billing & Insurance';
      case 'analytics':
        return 'Analytics';
      case 'human-resources':
        return 'Human Resources';
      case 'administration':
        return 'Administration';
      case 'nfc-cards':
        return 'Order NFC Cards';
      case 'subscription':
        return 'Subscription & Billing';
      case 'audit-logs':
        return 'Security & Audit';
      case 'settings':
        return 'Settings';
      case 'help':
        return 'Help & Support';
      default:
        return 'Dashboard';
    }
  };

  const handleAuthenticated = (payload: { role: typeof currentRole; name: string; email: string; redirectPage: PageType; organization: OrganizationProfile }) => {
    setCurrentRole(payload.role);
    setActiveOrganization(payload.organization);
    setUserProfile({ name: payload.name, email: payload.email, avatar: payload.name.split(' ').map((part) => part[0]).slice(0, 2).join('') });

    if (payload.organization.workspaceType === 'public-health') {
      const sentinelUrl = new URL(import.meta.env.VITE_SENTINEL_WORKSPACE_URL ?? 'http://127.0.0.1:5173/');
      sentinelUrl.searchParams.set('sentinelAuto', '1');
      sentinelUrl.searchParams.set('orgId', payload.organization.id);
      sentinelUrl.searchParams.set('orgName', payload.organization.name);
      sentinelUrl.searchParams.set('orgSlug', payload.organization.slug ?? payload.organization.id);
      sentinelUrl.searchParams.set('orgType', payload.organization.organizationType);
      if (payload.organization.sector) sentinelUrl.searchParams.set('sector', payload.organization.sector);
      if (payload.organization.state) sentinelUrl.searchParams.set('state', payload.organization.state);
      if (payload.organization.contactEmail) sentinelUrl.searchParams.set('contactEmail', payload.organization.contactEmail);
      if (payload.organization.contactPhone) sentinelUrl.searchParams.set('contactPhone', payload.organization.contactPhone);
      if (typeof payload.organization.joinedNetwork === 'boolean') sentinelUrl.searchParams.set('joinedNetwork', String(payload.organization.joinedNetwork));
      if (payload.organization.subscriptionTier) sentinelUrl.searchParams.set('subscriptionTier', payload.organization.subscriptionTier);
      window.location.href = sentinelUrl.toString();
      return;
    }

    resetPlatformAdminCheck();
    setIsAuthenticated(true);
    // Return to the page the app was opened on, once, if it is a page this app knows.
    if (deepLink) {
      setDeepLink(null);
      const path = deepLink.split('?')[0];
      if (path.startsWith('/emr/') || Object.values(pagePathMap).includes(path)) {
        window.history.replaceState({}, '', deepLink);
        parseRoute();
        return;
      }
    }
    setCurrentPage(payload.redirectPage);
    if (payload.redirectPage === 'emr') {
      window.history.pushState({}, '', '/emr');
      return;
    }
    const path = pagePathMap[payload.redirectPage as Exclude<PageType, 'emr'>] ?? '/';
    window.history.pushState({}, '', path);
  };

  const loggingOut = useRef(false);
  const handleLogout = async (forced = false) => {
    if (!forced && !canLeaveOnboardingWizard()) return;
    loggingOut.current = true;
    localStorage.removeItem('vitalink-auth-session');
    // Must finish before the gateway mounts, or its session check signs the user straight back in.
    if (isSupabaseConfigured) {
      const unsynced = await signOut().catch(() => 0);
      if (unsynced) toast.info(`${unsynced} change${unsynced === 1 ? '' : 's'} made offline will be sent the next time you sign in on this device.`, { duration: 10000 });
    }
    resetPlatformAdminCheck();
    setActiveOrganization(null);
    setIsAuthenticated(false);
    setCurrentPage('dashboard');
    setVitaMindPanelOpen(false);
    window.history.pushState({}, '', '/');
    loggingOut.current = false;
  };

  // Idle timeout, or the session was ended from another device / by an admin.
  const handleForcedSignOut = (reason: string) => {
    if (loggingOut.current) return;
    toast.info(reason, { duration: 8000 });
    void handleLogout(true);
  };

  const handleDeleteAccount = () => {
    const rawUsers = localStorage.getItem('vitalink-auth-users');
    if (rawUsers) {
      try {
        const users = JSON.parse(rawUsers) as Array<{ email?: string }>;
        const nextUsers = users.filter((user) => user.email?.toLowerCase() !== userEmail.toLowerCase());
        localStorage.setItem('vitalink-auth-users', JSON.stringify(nextUsers));
      } catch {
        // Keep fail-safe behavior: if users payload is invalid, continue logout flow.
      }
    }
    localStorage.removeItem(`vitalink-onboarding-complete-${userEmail.toLowerCase()}`);
    clearUserProfile();
    handleLogout();
  };

  return (
    <SecurityAuditProvider>
      {isSupabaseConfigured && <MfaGate />}
      {!isAuthenticated ? (
        <AuthGatewayPage onAuthenticated={handleAuthenticated} defaultTheme={document.documentElement.classList.contains('dark-theme') ? 'dark' : 'light'} />
      ) : (
        <GuidedTourProvider currentPage={currentPage} currentRole={currentRole} userName={userName} onNavigate={navigateToPage}>
          <AppointmentProvider>
          <SetupGate />
          <AppLayout>
            {isSupabaseConfigured && organization.id && <SessionGuard organizationId={organization.id} onSignOut={handleForcedSignOut} />}
            {isSupabaseConfigured && <ProfileSync />}
            <div className="app-shell flex h-screen overflow-hidden min-w-0 max-w-[100vw]">
        <Sidebar 
          currentPage={currentPage} 
          onPageChange={(page) => navigateToPage(page as PageType)}
        />
        
        <div className="flex-1 flex flex-col min-w-0 relative">
          {isSupabaseConfigured && <MfaReminder />}
          <Header 
            title={getPageTitle()} 
            onAIClick={() => setVitaMindPanelOpen(!vitaMindPanelOpen)}
            onPageChange={(page) => navigateToPage(page as PageType)}
            onLogout={() => void handleLogout()}
            onDeleteAccount={handleDeleteAccount}
          />
          
          {isSupabaseConfigured && <OfflineBanner />}
          <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 page-transition">
            <PageContainer className="py-4 md:py-5 lg:py-6">
              <PageLoadBoundary key={currentPage}><Suspense fallback={<PageLoading />}>{renderPage()}</Suspense></PageLoadBoundary>
            </PageContainer>
          </main>
        </div>

        <VitaMindAIPanel 
          isOpen={vitaMindPanelOpen} 
          onClose={() => setVitaMindPanelOpen(false)} 
        />
        
        <button
          onClick={() => navigateToPage('help')}
          className="fixed bottom-24 right-6 z-30 w-12 h-12 rounded-full bg-white/85 backdrop-blur-md border border-white/60 shadow-lg flex items-center justify-center text-vitalink-700 transition-transform"
          title="Help & Support"
        >
          <LifeBuoy className="w-5 h-5" />
        </button>
        <AIFloatingButton onClick={() => setVitaMindPanelOpen(!vitaMindPanelOpen)} />
            </div>
          </AppLayout>
          </AppointmentProvider>
        </GuidedTourProvider>
      )}
      {/* Below the 80px header so toasts never cover search, the bell or the profile menu. */}
      <Toaster position="top-right" offset={88} />
    </SecurityAuditProvider>
  );
}

// New workspaces: facility setup covers the app until it's finished or put off.
function SetupGate() {
  const { setupOpen } = useGuidedTour();
  return setupOpen ? <WorkspaceSetup /> : null;
}

export default App;

function AccessRestricted({
  pageTitle,
  workspaceDescription,
  onNavigateHome,
}: {
  pageTitle: string;
  workspaceDescription: string;
  onNavigateHome: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300">
          <Lock className="h-5 w-5" />
        </div>
        <p className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Workspace Access Restricted</p>
        <h2 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{pageTitle}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-400">
          This route is not available in the active {workspaceDescription}. Switch to an eligible healthcare workspace or return to your workspace home.
        </p>
        <button
          type="button"
          onClick={onNavigateHome}
          className="mt-6 rounded-xl bg-vitalink-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-vitalink-700"
        >
          Return to Workspace Home
        </button>
      </div>
    </div>
  );
}
