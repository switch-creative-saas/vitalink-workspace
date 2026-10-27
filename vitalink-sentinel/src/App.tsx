import { Toaster } from 'sonner';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { OutbreaksPage } from '@/pages/OutbreaksPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { FacilitiesPage } from '@/pages/FacilitiesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { LiveCases } from '@/components/cases/LiveCases';
import { LiveAlerts } from '@/components/alerts/LiveAlerts';
import {
  CaseReportingFeature,
  CommunityReportingFeature,
  ContactTracingFeature,
  DiseaseRegistryFeature,
  EmergencyResponseFeature,
  EpidemiologyAnalyticsFeature,
  GeographicHeatmapsFeature,
  NTDMonitoringFeature,
  PublicHealthAlertsFeature,
  VaccinationMonitoringFeature,
} from '@/components/features/SentinelFeatureModules';
import { AuthProvider } from '@/contexts/AuthContext';
import { SubscriptionProvider } from '@/contexts/SubscriptionContext';
import { SentinelProvider } from '@/contexts/SentinelContext';
import { bootstrapLiveSession, useSentinelStore } from '@/store/useSentinelStore';

function CurrentPage() {
  const { route } = useSentinelStore();
  switch (route) {
    case 'dashboard':
      return <DashboardPage />;
    case 'outbreaks':
      return <OutbreaksPage />;
    case 'cases':
      // Live: the case registry on Supabase; the demo keeps its sample feature module.
      return isSupabaseConfigured ? <LiveCases /> : <CaseReportingFeature />;
    case 'alerts':
      return isSupabaseConfigured ? <LiveAlerts /> : <PublicHealthAlertsFeature />;
    case 'heatmaps':
      return <GeographicHeatmapsFeature />;
    case 'contact-tracing':
      return <ContactTracingFeature />;
    case 'vaccination':
      return <VaccinationMonitoringFeature />;
    case 'epidemiology':
      return <EpidemiologyAnalyticsFeature />;
    case 'emergency':
      return <EmergencyResponseFeature />;
    case 'community':
      return <CommunityReportingFeature />;
    case 'ntd':
      return <NTDMonitoringFeature />;
    case 'reports':
      return <ReportsPage />;
    case 'diseases':
      return <DiseaseRegistryFeature />;
    case 'facilities':
      return <FacilitiesPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <NotFoundPage />;
  }
}

// Live mode: restore the Supabase session before deciding what to show.
bootstrapLiveSession();

export default function App() {
  const { isAuthenticated, authReady } = useSentinelStore();
  if (!authReady) return <div className="grid min-h-screen place-items-center bg-white text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400">Loading VitaLink Sentinel…</div>;
  if (!isAuthenticated) return <LoginPage />;

  return (
    <AuthProvider>
      <SubscriptionProvider>
        <SentinelProvider>
          <AppShell>
            <CurrentPage />
          </AppShell>
          <Toaster position="top-right" richColors theme="dark" />
        </SentinelProvider>
      </SubscriptionProvider>
    </AuthProvider>
  );
}
