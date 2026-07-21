import { useEffect, useState } from 'react';
import { LifeBuoy } from 'lucide-react';
import { ResponsiveProvider } from '@/contexts/ResponsiveContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { SubscriptionProvider } from '@/contexts/SubscriptionContext';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { AppLayout } from '@/components/layout/AppLayout';
import { PageContainer } from '@/components/layout/PageContainer';
import { VitaMindAIPanel } from '@/components/ai/VitaMindAIPanel';
import { AIFloatingButton } from '@/components/ai/AIFloatingButton';
import { DashboardPage } from '@/pages/DashboardPage';
import { PatientIdentityPage } from '@/pages/PatientIdentityPage';
import { PatientsPage } from '@/pages/PatientsPage';
import { EMRPage } from '@/pages/EMRPage';
import { TelemedicinePage } from '@/pages/TelemedicinePage';
import { AIClinicalIntelligencePage } from '@/pages/AIClinicalIntelligencePage';
import { VitaLinkNetworkPage } from '@/pages/VitaLinkNetworkPage';
import { AppointmentsPage } from '@/pages/AppointmentsPage';
import { LaboratoryPage } from '@/pages/LaboratoryPage';
import { PharmacyPage } from '@/pages/PharmacyPage';
import { BillingPage } from '@/pages/BillingPage';
import { AnalyticsPage } from '@/pages/AnalyticsPage';
import { HumanResourcesPage } from '@/pages/HumanResourcesPage';
import { AdministrationPage } from '@/pages/AdministrationPage';
import { SubscriptionPage } from '@/pages/SubscriptionPage';
import { AuditLogsPage } from '@/pages/AuditLogsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { HelpSupportPage } from '@/pages/HelpSupportPage';
import { VitaLinkSentinelPage } from '@/pages/VitaLinkSentinelPage';
import { AuthGatewayPage } from '@/pages/AuthGatewayPage';
import { Toaster } from '@/components/ui/sonner';
import type { PageType } from '@/types';
import { GuidedTourProvider } from '@/contexts/GuidedTourContext';
import { useAuth } from '@/contexts/AuthContext';
import { SecurityAuditProvider } from '@/contexts/SecurityAuditContext';
import { SentinelProvider } from '@/contexts/SentinelContext';
import { AppointmentProvider } from '@/contexts/AppointmentContext';
import { BRAND } from '@/config/brand';

function App() {
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
  const { currentRole, userName, userEmail, setCurrentRole, setUserProfile, clearUserProfile } = useAuth();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => Boolean(localStorage.getItem('vitalink-auth-session')));
  const [currentPage, setCurrentPage] = useState<PageType>('dashboard');
  const [vitaMindPanelOpen, setVitaMindPanelOpen] = useState(false);
  const [emrSwitchId, setEmrSwitchId] = useState<string | null>(null);
  const pagePathMap: Record<Exclude<PageType, 'emr'>, string> = {
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
    'switch-sentinel': '/switch-sentinel',
    'human-resources': '/human-resources',
    administration: '/administration',
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
    if (path === '/switch-sentinel' || path.startsWith('/switch-sentinel')) {
      setCurrentPage('switch-sentinel');
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
    if (page === 'switch-sentinel') {
      window.history.pushState({}, '', '/switch-sentinel?view=surveillance');
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
      case 'switch-sentinel':
        return <VitaLinkSentinelPage />;
      case 'human-resources':
        return <HumanResourcesPage />;
      case 'administration':
        return <AdministrationPage />;
      case 'subscription':
        return <SubscriptionPage />;
      case 'audit-logs':
        return <AuditLogsPage />;
      case 'settings':
        return <SettingsPage onLogout={handleLogout} onDeleteAccount={handleDeleteAccount} />;
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
      case 'switch-sentinel':
        return BRAND.sentinel;
      case 'human-resources':
        return 'Human Resources';
      case 'administration':
        return 'Administration';
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

  const handleAuthenticated = (payload: { role: typeof currentRole; name: string; email: string; redirectPage: PageType }) => {
    setCurrentRole(payload.role);
    setUserProfile({ name: payload.name, email: payload.email, avatar: payload.name.split(' ').map((part) => part[0]).slice(0, 2).join('') });
    setIsAuthenticated(true);
    setCurrentPage(payload.redirectPage);
    if (payload.redirectPage === 'emr') {
      window.history.pushState({}, '', '/emr');
      return;
    }
    const path = pagePathMap[payload.redirectPage as Exclude<PageType, 'emr'>] ?? '/';
    window.history.pushState({}, '', path);
  };

  const handleLogout = () => {
    if (!canLeaveOnboardingWizard()) return;
    localStorage.removeItem('vitalink-auth-session');
    setIsAuthenticated(false);
    setCurrentPage('dashboard');
    setVitaMindPanelOpen(false);
    window.history.pushState({}, '', '/');
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
      {!isAuthenticated ? (
        <AuthGatewayPage onAuthenticated={handleAuthenticated} defaultTheme={document.documentElement.classList.contains('dark-theme') ? 'dark' : 'light'} />
      ) : (
        <GuidedTourProvider currentPage={currentPage} currentRole={currentRole} userName={userName} onNavigate={navigateToPage}>
          <SentinelProvider>
          <AppointmentProvider>
          <AppLayout>
            <div className="app-shell flex h-screen overflow-hidden min-w-0 max-w-[100vw]">
        <Sidebar 
          currentPage={currentPage} 
          onPageChange={(page) => navigateToPage(page as PageType)}
        />
        
        <div className="flex-1 flex flex-col min-w-0 relative">
          <Header 
            title={getPageTitle()} 
            onAIClick={() => setVitaMindPanelOpen(!vitaMindPanelOpen)}
            onPageChange={(page) => navigateToPage(page as PageType)}
            onLogout={handleLogout}
            onDeleteAccount={handleDeleteAccount}
          />
          
          <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0 page-transition">
            <PageContainer className="py-4 md:py-5 lg:py-6">
              {renderPage()}
            </PageContainer>
          </main>
        </div>

        <VitaMindAIPanel 
          isOpen={vitaMindPanelOpen} 
          onClose={() => setVitaMindPanelOpen(false)} 
        />
        
        <button
          onClick={() => navigateToPage('help')}
          className="fixed bottom-24 right-6 z-30 w-12 h-12 rounded-full bg-white/85 backdrop-blur-md border border-white/60 shadow-lg flex items-center justify-center text-vitalink-700 hover:scale-105 transition-transform"
          title="Help & Support"
        >
          <LifeBuoy className="w-5 h-5" />
        </button>
        <AIFloatingButton onClick={() => setVitaMindPanelOpen(!vitaMindPanelOpen)} />
        <Toaster position="top-right" />
            </div>
          </AppLayout>
          </AppointmentProvider>
          </SentinelProvider>
        </GuidedTourProvider>
      )}
    </SecurityAuditProvider>
  );
}

export default App;
