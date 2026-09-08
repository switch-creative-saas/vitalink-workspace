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

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { activeOrganization } = useSentinelStore();
  const value = useMemo<AuthContextValue>(
    () => ({
      userName: 'Sentinel Officer',
      userEmail: activeOrganization ? `officer@${activeOrganization.id}.sentinel.ng` : 'officer@sentinel.ng',
      currentRole: activeOrganization?.type === 'ngo' ? 'ngo-program-manager' : 'public-health-officer',
    }),
    [activeOrganization],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
