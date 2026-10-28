// First-run workspace setup: right after someone creates a workspace they are walked through their
// facility details, departments and team before the dashboard. Registration marks the new workspace
// here (before any payment redirect); finishing or skipping setup is saved as the "setup" tour.
import type { UserRole } from '@/contexts/AuthContext';

const PENDING_KEY = 'vitalink-setup-pending';

export const SETUP_TOUR_ID = 'setup';

/** Roles the database lets change facility settings and departments (private.admin_roles). */
export const SETUP_ROLES: UserRole[] = ['super-admin', 'hospital-admin', 'ngo-admin', 'government-admin'];

export function markWorkspaceSetupPending(organizationId: string) {
  try { localStorage.setItem(PENDING_KEY, organizationId); } catch { /* storage blocked */ }
}

export function isWorkspaceSetupPending(organizationId: string) {
  try { return Boolean(organizationId) && localStorage.getItem(PENDING_KEY) === organizationId; } catch { return false; }
}

export function clearWorkspaceSetupPending() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* storage blocked */ }
}
