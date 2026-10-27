import type { UserRole } from '@/contexts/AuthContext';
import type { OrganizationType } from './organizationTypes';
import type { WorkspacePermission } from './permissions';

export const PUBLIC_HEALTH_ROLES: UserRole[] = [
  'ngo-admin',
  'program-manager',
  'data-monitoring-officer',
  'field-officer',
  'public-health-viewer',
  'government-admin',
  'public-health-director',
  'surveillance-officer',
  'data-analyst',
  'government-viewer',
  'public-health-officer',
  'epidemiologist',
  'government-authority',
  'community-health-worker',
  'who-ngo-observer',
];

export const HEALTHCARE_ADMIN_ROLES: UserRole[] = ['super-admin', 'hospital-admin', 'it-officer'];

export const WORKSPACE_ROLE_PERMISSIONS: Partial<Record<UserRole, WorkspacePermission[]>> = {
  'ngo-admin': [
    'dashboard.view',
    'sentinel.view',
    'sentinel.manage',
    'network.view',
    'settings.view',
    'settings.audit',
    'support.view',
  ],
  'program-manager': ['dashboard.view', 'sentinel.view', 'sentinel.manage', 'network.view', 'settings.view', 'support.view'],
  'data-monitoring-officer': ['dashboard.view', 'sentinel.view', 'network.view', 'support.view'],
  'field-officer': ['dashboard.view', 'sentinel.view', 'support.view'],
  'public-health-viewer': ['dashboard.view', 'sentinel.view', 'support.view'],
  'government-admin': [
    'dashboard.view',
    'sentinel.view',
    'sentinel.manage',
    'network.view',
    'healthcare.admin',
    'settings.view',
    'settings.audit',
    'support.view',
  ],
  'public-health-director': ['dashboard.view', 'sentinel.view', 'sentinel.manage', 'network.view', 'settings.view', 'settings.audit', 'support.view'],
  'surveillance-officer': ['dashboard.view', 'sentinel.view', 'network.view', 'support.view'],
  'data-analyst': ['dashboard.view', 'sentinel.view', 'settings.audit', 'support.view'],
  'government-viewer': ['dashboard.view', 'sentinel.view', 'support.view'],
  'public-health-officer': ['dashboard.view', 'sentinel.view', 'network.view', 'support.view'],
  epidemiologist: ['dashboard.view', 'sentinel.view', 'sentinel.manage', 'network.view', 'settings.audit', 'support.view'],
  'government-authority': ['dashboard.view', 'sentinel.view', 'network.view', 'healthcare.admin', 'settings.audit', 'support.view'],
  'community-health-worker': ['dashboard.view', 'sentinel.view', 'support.view'],
  'who-ngo-observer': ['dashboard.view', 'sentinel.view', 'support.view'],
};

/** Whoever sets up a workspace owns it, whatever its type (matches create_workspace in the database). */
export const WORKSPACE_OWNER_ROLE: UserRole = 'super-admin';

export function roleOptionsForOrganizationType(type: OrganizationType): UserRole[] {
  if (type === 'ngo') {
    return ['ngo-admin', 'program-manager', 'data-monitoring-officer', 'field-officer', 'public-health-viewer'];
  }

  if (type === 'government') {
    return ['government-admin', 'public-health-director', 'surveillance-officer', 'data-analyst', 'government-viewer'];
  }

  if (type === 'hmo' || type === 'insurance') {
    return ['public-health-officer', 'data-monitoring-officer', 'public-health-viewer'];
  }

  return [
    'hospital-admin',
    'doctor',
    'nurse',
    'receptionist',
    'lab-scientist',
    'lab-technician',
    'pharmacist',
    'billing-officer',
    'insurance-officer',
    'it-officer',
    'support-agent',
  ];
}

export function hasWorkspacePermission(role: UserRole, permission: WorkspacePermission): boolean {
  if (role === 'super-admin') return true;
  return WORKSPACE_ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}
