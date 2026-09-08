import type { PageType } from '@/types';
import type { UserRole } from '@/contexts/AuthContext';
import type { OrganizationType, OrganizationProfile, WorkspaceType } from './organizationTypes';
import { createOrganizationProfile, organizationTypeLabel, workspaceLabel } from './organizationTypes';
import { PAGE_PERMISSIONS, isPageInWorkspace } from './permissions';
import { hasWorkspacePermission } from './roles';

export const DEFAULT_HEALTHCARE_ORGANIZATION: OrganizationProfile = createOrganizationProfile({
  id: 'tenant-lagos',
  name: 'Lagos Central Hospital',
  slug: 'lagos-central',
  organizationType: 'hospital',
});

export function defaultPageForWorkspace(_workspaceType: WorkspaceType): PageType {
  return 'dashboard';
}

export function canAccessPageForWorkspace(params: {
  page: PageType;
  role: UserRole;
  workspaceType: WorkspaceType;
  organizationType: OrganizationType;
}): boolean {
  if (!isPageInWorkspace(params.page, params.workspaceType)) return false;

  if (params.workspaceType === 'healthcare') {
    return true;
  }

  const requiredPermissions = PAGE_PERMISSIONS[params.page] ?? [];
  return requiredPermissions.length === 0 || requiredPermissions.some((permission) => hasWorkspacePermission(params.role, permission));
}

export function workspaceDescriptor(profile: OrganizationProfile): string {
  return `${organizationTypeLabel(profile.organizationType)} - ${workspaceLabel(profile.workspaceType)}`;
}
