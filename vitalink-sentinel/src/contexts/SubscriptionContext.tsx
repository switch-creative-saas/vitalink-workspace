import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useSentinelStore } from '@/store/useSentinelStore';

interface SubscriptionContextValue {
  tenantId: string;
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { activeOrganization } = useSentinelStore();
  const value = useMemo(
    () => ({ tenantId: activeOrganization?.id ?? 'sentinel-public-health' }),
    [activeOrganization],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  const value = useContext(SubscriptionContext);
  if (!value) throw new Error('useSubscription must be used inside SubscriptionProvider');
  return value;
}
