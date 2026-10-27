import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useSentinelStore } from '@/store/useSentinelStore';

export type UserRole =
  | 'super-admin'
  | 'hospital-admin'
  | 'doctor'
  | 'nurse'
  | 'lab-scientist'
  | 'pharmacist'
  | 'receptionist'
  | 'public-health-officer'
  | 'epidemiologist'
  | 'government-authority'
  | 'community-health-worker'
  | 'who-ngo-observer'
  | 'ngo-program-manager'
  | 'researcher';

interface AuthContextValue {
  userName: string;
  userEmail: string;
  currentRole: UserRole;
}

// Sentinel member roles (sentinel_users.role) to the app's role-based views.
const LIVE_ROLES: Record<string, UserRole> = {
  admin: 'super-admin', officer: 'public-health-officer', analyst: 'epidemiologist', field_worker: 'community-health-worker', viewer: 'who-ngo-observer',
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { activeOrganization, me } = useSentinelStore();
  const value = useMemo<AuthContextValue>(
    () => (me
      // Live: the signed-in member and their Sentinel role.
      ? { userName: me.fullName, userEmail: me.email, currentRole: LIVE_ROLES[me.role] ?? 'public-health-officer' }
      : {
        userName: 'Sentinel Officer',
        userEmail: activeOrganization ? `officer@${activeOrganization.id}.sentinel.ng` : 'officer@sentinel.ng',
        currentRole: activeOrganization?.type === 'ngo' ? 'ngo-program-manager' : 'public-health-officer',
      }),
    [activeOrganization, me],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
