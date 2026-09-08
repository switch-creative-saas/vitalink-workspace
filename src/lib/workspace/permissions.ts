import type { PageType } from '@/types';
import type { OrganizationType, WorkspaceType } from './organizationTypes';

export type WorkspacePermission =
  | 'dashboard.view'
  | 'healthcare.identity'
  | 'healthcare.patients'
  | 'healthcare.emr'
  | 'healthcare.telemedicine'
  | 'healthcare.ai'
  | 'healthcare.appointments'
  | 'healthcare.laboratory'
  | 'healthcare.pharmacy'
  | 'healthcare.billing'
  | 'healthcare.analytics'
  | 'healthcare.hr'
  | 'healthcare.admin'
  | 'network.view'
  | 'sentinel.view'
  | 'sentinel.manage'
  | 'settings.view'
  | 'settings.billing'
  | 'settings.audit'
  | 'support.view';

export const PAGE_PERMISSIONS: Partial<Record<PageType, WorkspacePermission[]>> = {
  dashboard: ['dashboard.view'],
  'patient-identity': ['healthcare.identity'],
  patients: ['healthcare.patients'],
  emr: ['healthcare.emr'],
  'nfc-cards': ['healthcare.identity'],
  telemedicine: ['healthcare.telemedicine'],
  'ai-clinical-intelligence': ['healthcare.ai'],
  'switch-network': ['network.view'],
  appointments: ['healthcare.appointments'],
  laboratory: ['healthcare.laboratory'],
  pharmacy: ['healthcare.pharmacy'],
  billing: ['healthcare.billing'],
  analytics: ['healthcare.analytics'],
  'human-resources': ['healthcare.hr'],
  administration: ['healthcare.admin'],
  subscription: ['settings.billing'],
  'audit-logs': ['settings.audit'],
  settings: ['settings.view'],
  help: ['support.view'],
};

export const HEALTHCARE_WORKSPACE_PAGES: PageType[] = [
  'dashboard',
  'patient-identity',
  'patients',
  'emr',
  'nfc-cards',
  'telemedicine',
  'ai-clinical-intelligence',
  'switch-network',
  'appointments',
  'laboratory',
  'pharmacy',
  'billing',
  'analytics',
  'human-resources',
  'administration',
  'subscription',
  'audit-logs',
  'settings',
  'help',
];

export const PUBLIC_HEALTH_WORKSPACE_PAGES: PageType[] = [
  'dashboard',
  'switch-network',
  'administration',
  'settings',
  'audit-logs',
  'help',
];

export function isPageInWorkspace(page: PageType, workspaceType: WorkspaceType): boolean {
  return (workspaceType === 'public-health' ? PUBLIC_HEALTH_WORKSPACE_PAGES : HEALTHCARE_WORKSPACE_PAGES).includes(page);
}

export function isPublicHealthOrganization(type: OrganizationType): boolean {
  return type === 'ngo' || type === 'government';
}
