import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { usePlan } from '@/hooks/usePlan';
import { isSupabaseConfigured } from '@/lib/supabase/client';

export type PlanTier = 'free' | 'pro' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual';
export type FeatureKey =
  | 'patient_basic'
  | 'patient_full'
  | 'appointments_basic'
  | 'appointments_advanced'
  | 'emr_basic'
  | 'emr_full'
  | 'telemedicine'
  | 'ai_limited'
  | 'ai_full'
  | 'laboratory'
  | 'pharmacy'
  | 'billing'
  | 'analytics_basic'
  | 'analytics_advanced'
  | 'multi_hospital'
  | 'inter_hospital_referrals'
  | 'custom_workflows'
  | 'api_access'
  | 'public_health_sentinel';

type UsageMetric = 'staff' | 'patients' | 'storageGB';
type PaymentMethodType = 'card' | 'bank_transfer';

interface PlanLimits {
  staff: number | 'unlimited';
  patients: number | 'unlimited';
  storageGB: number | 'unlimited';
}

interface Usage {
  staff: number;
  patients: number;
  storageGB: number;
}

export interface TenantSubscription {
  tenantId: string;
  tenantName: string;
  plan: PlanTier;
  billingCycle: BillingCycle;
  autoRenew: boolean;
  trialEndsAt?: string;
  gracePeriodEndsAt?: string;
  nextBillingAt: string;
  usage: Usage;
  couponCode?: string;
}

export interface PaymentMethod {
  id: string;
  type: PaymentMethodType;
  isDefault: boolean;
  brand?: 'Visa' | 'Mastercard';
  last4?: string;
  accountBank?: string;
  accountEnding?: string;
}

export interface BillingInvoice {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  plan: PlanTier;
  cycle: BillingCycle;
  amount: number;
  tax: number;
  total: number;
  status: 'paid' | 'pending' | 'failed';
  issuedAt: string;
  dueAt: string;
}

interface SubscriptionContextType {
  DEV_OVERRIDE: boolean;
  tenantId: string;
  setTenantId: (tenantId: string) => void;
  subscription: TenantSubscription;
  limits: PlanLimits;
  paymentMethods: PaymentMethod[];
  invoices: BillingInvoice[];
  planAccess: Record<PlanTier, FeatureKey[]>;
  hasAccess: (feature: FeatureKey) => boolean;
  isUsageBlocked: (metric: UsageMetric) => boolean;
  usagePct: (metric: UsageMetric) => number;
  updatePlan: (plan: PlanTier, cycle: BillingCycle) => void;
  toggleAutoRenew: (next: boolean) => void;
  addPaymentMethod: (method: Omit<PaymentMethod, 'id' | 'isDefault'>) => void;
  setDefaultPaymentMethod: (id: string) => void;
  editPaymentMethod: (id: string, updates: Partial<PaymentMethod>) => void;
  removePaymentMethod: (id: string) => void;
  trackUsage: (metric: UsageMetric, nextValue: number) => void;
  addAudit: (message: string) => void;
  billingAuditLogs: string[];
}

const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: { staff: 5, patients: 100, storageGB: 1 },
  pro: { staff: 50, patients: 10000, storageGB: 100 },
  enterprise: { staff: 'unlimited', patients: 'unlimited', storageGB: 'unlimited' },
};

const PLAN_ACCESS: Record<PlanTier, FeatureKey[]> = {
  free: ['patient_basic', 'appointments_basic', 'emr_basic', 'analytics_basic'],
  pro: [
    'patient_basic',
    'patient_full',
    'appointments_basic',
    'appointments_advanced',
    'emr_basic',
    'emr_full',
    'laboratory',
    'pharmacy',
    'billing',
    'analytics_basic',
    'analytics_advanced',
    'ai_limited',
  ],
  enterprise: [
    'patient_basic',
    'patient_full',
    'appointments_basic',
    'appointments_advanced',
    'emr_basic',
    'emr_full',
    'laboratory',
    'pharmacy',
    'billing',
    'analytics_basic',
    'analytics_advanced',
    'ai_limited',
    'ai_full',
    'telemedicine',
    'multi_hospital',
    'inter_hospital_referrals',
    'custom_workflows',
    'api_access',
    'public_health_sentinel',
  ],
};

const SubscriptionContext = createContext<SubscriptionContextType | null>(null);

// Feature keys mapped to the module ids stored on each plan in Supabase.
const FEATURE_MODULES: Record<FeatureKey, string> = {
  patient_basic: 'patients',
  patient_full: 'patients',
  appointments_basic: 'appointments',
  appointments_advanced: 'appointments',
  emr_basic: 'emr',
  emr_full: 'emr',
  telemedicine: 'telemedicine',
  ai_limited: 'ai-clinical-intelligence',
  ai_full: 'ai-clinical-intelligence',
  laboratory: 'laboratory',
  pharmacy: 'pharmacy',
  billing: 'billing',
  analytics_basic: 'dashboard',
  analytics_advanced: 'analytics',
  multi_hospital: 'vitalink-network',
  inter_hospital_referrals: 'vitalink-network',
  custom_workflows: 'administration',
  api_access: 'administration',
  public_health_sentinel: 'sentinel',
};

const tierForPlan = (tierId: string | undefined): PlanTier =>
  tierId === 'enterprise' ? 'enterprise' : !tierId || tierId === 'free' ? 'free' : 'pro';

const TENANT_SUBSCRIPTIONS: Record<string, TenantSubscription> = {
  'tenant-lagos': {
    tenantId: 'tenant-lagos',
    tenantName: 'VitaLink - Lagos Central',
    plan: 'pro',
    billingCycle: 'annual',
    autoRenew: true,
    nextBillingAt: '2026-12-01',
    usage: { staff: 42, patients: 2847, storageGB: 45.2 },
    trialEndsAt: undefined,
    gracePeriodEndsAt: undefined,
  },
  'tenant-abuja': {
    tenantId: 'tenant-abuja',
    tenantName: 'VitaLink - Abuja Metro',
    plan: 'free',
    billingCycle: 'monthly',
    autoRenew: false,
    nextBillingAt: '2026-05-11',
    usage: { staff: 4, patients: 88, storageGB: 0.9 },
    trialEndsAt: undefined,
    gracePeriodEndsAt: '2026-05-18',
  },
};

const INITIAL_INVOICES: BillingInvoice[] = [
  {
    id: 'inv-1',
    tenantId: 'tenant-lagos',
    invoiceNumber: 'VLI-2026-101',
    plan: 'pro',
    cycle: 'annual',
    amount: 1350000,
    tax: 67500,
    total: 1417500,
    status: 'paid',
    issuedAt: '2026-01-01',
    dueAt: '2026-01-15',
  },
  {
    id: 'inv-2',
    tenantId: 'tenant-lagos',
    invoiceNumber: 'VLI-2026-120',
    plan: 'pro',
    cycle: 'monthly',
    amount: 120000,
    tax: 6000,
    total: 126000,
    status: 'pending',
    issuedAt: '2026-04-01',
    dueAt: '2026-04-10',
  },
];

const INITIAL_PAYMENT_METHODS: PaymentMethod[] = [
  { id: 'pm-1', type: 'card', brand: 'Visa', last4: '4242', isDefault: true },
  { id: 'pm-2', type: 'bank_transfer', accountBank: 'GTBank', accountEnding: '9081', isDefault: false },
];

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const [tenantId, setTenantIdState] = useState<string>(() => localStorage.getItem('vitalink-tenant-id') ?? 'tenant-lagos');
  const [tenantSubscriptions, setTenantSubscriptions] = useState<Record<string, TenantSubscription>>(TENANT_SUBSCRIPTIONS);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(INITIAL_PAYMENT_METHODS);
  const [invoices] = useState<BillingInvoice[]>(INITIAL_INVOICES);
  const [billingAuditLogs, setBillingAuditLogs] = useState<string[]>([]);
  // Offline demo only: unlocks every feature. Live workspaces are gated by their plan.
  const [DEV_OVERRIDE] = useState<boolean>(!isSupabaseConfigured);
  const { organization } = useAuth();
  const { plan: workspacePlan, hasModule } = usePlan();

  const demoSubscription = tenantSubscriptions[tenantId] ?? tenantSubscriptions['tenant-lagos'];
  const subscription: TenantSubscription = isSupabaseConfigured
    ? {
        tenantId: organization.id,
        tenantName: organization.name,
        plan: tierForPlan(workspacePlan?.tierId === 'trial' ? 'growth' : workspacePlan?.tierId),
        billingCycle: workspacePlan?.billingCycle === 'annual' ? 'annual' : 'monthly',
        autoRenew: workspacePlan?.status === 'active',
        trialEndsAt: workspacePlan?.isTrialActive ? workspacePlan.trialEndDate : undefined,
        nextBillingAt: '',
        usage: { staff: 0, patients: 0, storageGB: 0 },
      }
    : demoSubscription;
  const limits = PLAN_LIMITS[subscription.plan];

  const setTenantId = (nextTenantId: string) => {
    setTenantIdState(nextTenantId);
    localStorage.setItem('vitalink-tenant-id', nextTenantId);
  };

  const addAudit = (message: string) => {
    const log = `${new Date().toLocaleString()} - ${message}`;
    setBillingAuditLogs((prev) => [log, ...prev].slice(0, 40));
  };

  const hasAccess = (feature: FeatureKey): boolean => {
    if (DEV_OVERRIDE) return true;
    if (isSupabaseConfigured) return hasModule(FEATURE_MODULES[feature]);
    const planFeatures = PLAN_ACCESS[subscription.plan] ?? [];
    if (!planFeatures.includes(feature)) return false;
    const now = Date.now();
    if (subscription.gracePeriodEndsAt && now > new Date(subscription.gracePeriodEndsAt).getTime()) return false;
    return true;
  };

  const usagePct = (metric: UsageMetric): number => {
    const limit = limits[metric];
    if (limit === 'unlimited') return 0;
    return Math.min(100, (subscription.usage[metric] / limit) * 100);
  };

  const isUsageBlocked = (metric: UsageMetric): boolean => {
    if (DEV_OVERRIDE || isSupabaseConfigured) return false;
    const limit = limits[metric];
    if (limit === 'unlimited') return false;
    return subscription.usage[metric] >= limit;
  };

  const updatePlan = (plan: PlanTier, cycle: BillingCycle) => {
    setTenantSubscriptions((prev) => ({
      ...prev,
      [tenantId]: {
        ...prev[tenantId],
        plan,
        billingCycle: cycle,
        trialEndsAt: plan === 'pro' && prev[tenantId].plan === 'free' ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString().slice(0, 10) : prev[tenantId].trialEndsAt,
      },
    }));
    addAudit(`Plan changed to ${plan.toUpperCase()} (${cycle}) for ${subscription.tenantName}`);
  };

  const toggleAutoRenew = (next: boolean) => {
    setTenantSubscriptions((prev) => ({
      ...prev,
      [tenantId]: { ...prev[tenantId], autoRenew: next },
    }));
    addAudit(`Auto-renew ${next ? 'enabled' : 'disabled'} for ${subscription.tenantName}`);
  };

  const addPaymentMethod = (method: Omit<PaymentMethod, 'id' | 'isDefault'>) => {
    setPaymentMethods((prev) => [...prev, { ...method, id: `pm-${Date.now()}`, isDefault: prev.length === 0 }]);
    addAudit(`Payment method added (${method.type}) for ${subscription.tenantName}`);
  };

  const setDefaultPaymentMethod = (id: string) => {
    setPaymentMethods((prev) => prev.map((method) => ({ ...method, isDefault: method.id === id })));
    addAudit('Default payment method updated');
  };

  const editPaymentMethod = (id: string, updates: Partial<PaymentMethod>) => {
    setPaymentMethods((prev) => prev.map((method) => (method.id === id ? { ...method, ...updates } : method)));
    addAudit(`Payment method ${id} updated`);
  };

  const removePaymentMethod = (id: string) => {
    setPaymentMethods((prev) => {
      const next = prev.filter((method) => method.id !== id);
      if (next.length > 0 && !next.some((method) => method.isDefault)) {
        next[0] = { ...next[0], isDefault: true };
      }
      return next;
    });
    addAudit(`Payment method ${id} removed`);
  };

  const trackUsage = (metric: UsageMetric, nextValue: number) => {
    setTenantSubscriptions((prev) => ({
      ...prev,
      [tenantId]: {
        ...prev[tenantId],
        usage: {
          ...prev[tenantId].usage,
          [metric]: nextValue,
        },
      },
    }));
  };

  const value = useMemo<SubscriptionContextType>(
    () => ({
      DEV_OVERRIDE,
      tenantId,
      setTenantId,
      subscription,
      limits,
      // Platform invoices and saved cards live with Paystack, not in this demo store.
      paymentMethods: isSupabaseConfigured ? [] : paymentMethods,
      invoices: isSupabaseConfigured ? [] : invoices,
      planAccess: PLAN_ACCESS,
      hasAccess,
      isUsageBlocked,
      usagePct,
      updatePlan,
      toggleAutoRenew,
      addPaymentMethod,
      setDefaultPaymentMethod,
      editPaymentMethod,
      removePaymentMethod,
      trackUsage,
      addAudit,
      billingAuditLogs,
    }),
    [DEV_OVERRIDE, tenantId, subscription, limits, paymentMethods, invoices, billingAuditLogs, hasModule],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (!context) throw new Error('useSubscription must be used within SubscriptionProvider');
  return context;
}
