import type { PageType } from '@/types';
import { BRAND } from '@/config/brand';
import type { OrganizationType, WorkspaceType } from './organizationTypes';

export type NavigationIconKey =
  | 'dashboard'
  | 'identity'
  | 'patients'
  | 'emr'
  | 'video'
  | 'ai'
  | 'network'
  | 'appointments'
  | 'laboratory'
  | 'pharmacy'
  | 'billing'
  | 'analytics'
  | 'hr'
  | 'administration'
  | 'subscription'
  | 'audit'
  | 'nfc-cards'
  | 'settings';

export interface WorkspaceNavigationItem {
  id: PageType;
  label: string;
  icon: NavigationIconKey;
  module: string;
}

export const HEALTHCARE_NAVIGATION: WorkspaceNavigationItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', module: 'Dashboard' },
  { id: 'patient-identity', label: 'Health Identity', icon: 'identity', module: 'Patients' },
  { id: 'patients', label: 'Patients', icon: 'patients', module: 'Patients' },
  { id: 'emr', label: 'EMR', icon: 'emr', module: 'EMR' },
  { id: 'nfc-cards', label: 'Order NFC Cards', icon: 'nfc-cards', module: 'Patients' },
  { id: 'telemedicine', label: 'Telemedicine', icon: 'video', module: 'Appointments' },
  { id: 'ai-clinical-intelligence', label: 'AI Clinical Intelligence', icon: 'ai', module: 'EMR' },
  { id: 'switch-network', label: BRAND.network, icon: 'network', module: 'Administration' },
  { id: 'appointments', label: 'Appointments', icon: 'appointments', module: 'Appointments' },
  { id: 'laboratory', label: 'Laboratory', icon: 'laboratory', module: 'Laboratory' },
  { id: 'pharmacy', label: 'Pharmacy', icon: 'pharmacy', module: 'Pharmacy' },
  { id: 'billing', label: 'Billing', icon: 'billing', module: 'Billing' },
  { id: 'analytics', label: 'Analytics', icon: 'analytics', module: 'Analytics' },
  { id: 'human-resources', label: 'Human Resources', icon: 'hr', module: 'Human Resources' },
  { id: 'administration', label: 'Administration', icon: 'administration', module: 'Administration' },
  { id: 'subscription', label: 'Subscription', icon: 'subscription', module: 'Settings' },
  { id: 'audit-logs', label: 'Security', icon: 'audit', module: 'Settings' },
];

const PUBLIC_HEALTH_BASE_NAVIGATION: WorkspaceNavigationItem[] = [
  { id: 'switch-network', label: 'Public Health Network', icon: 'network', module: 'Public Health' },
  { id: 'audit-logs', label: 'Reporting Audit', icon: 'audit', module: 'Settings' },
];

const GOVERNMENT_NAVIGATION: WorkspaceNavigationItem[] = [
  ...PUBLIC_HEALTH_BASE_NAVIGATION,
  { id: 'administration', label: 'Authority Admin', icon: 'administration', module: 'Administration' },
];

export const BOTTOM_NAVIGATION: WorkspaceNavigationItem[] = [
  { id: 'settings', label: 'Settings', icon: 'settings', module: 'Settings' },
];

export function getNavigationForWorkspace(
  workspaceType: WorkspaceType,
  organizationType: OrganizationType,
): WorkspaceNavigationItem[] {
  if (workspaceType === 'public-health') {
    return organizationType === 'government' ? GOVERNMENT_NAVIGATION : PUBLIC_HEALTH_BASE_NAVIGATION;
  }

  return HEALTHCARE_NAVIGATION;
}
