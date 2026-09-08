import { Toaster } from 'sonner';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { OutbreaksPage } from '@/pages/OutbreaksPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { FacilitiesPage } from '@/pages/FacilitiesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
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
import { useSentinelStore } from '@/store/useSentinelStore';

function CurrentPage() {
  const { route } = useSentinelStore();
  switch (route) {
    case 'dashboard':
      return <DashboardPage />;
    case 'outbreaks':
      return <OutbreaksPage />;
    case 'cases':
      return <CaseReportingFeature />;
    case 'alerts':
      return <PublicHealthAlertsFeature />;
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

export default function App() {
  const { isAuthenticated } = useSentinelStore();
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
