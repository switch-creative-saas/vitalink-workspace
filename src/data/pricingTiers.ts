export type PricingTierId = 'starter' | 'growth' | 'enterprise';

export interface PricingTier {
  id: PricingTierId;
  name: string;
  tagline: string;
  targetCustomer: string;
  hardwareFee: number;
  hardwareFeeUSD: number;
  hardwareIncludes: string[];
  monthlyPrice: number | null;
  annualPrice: number | null;
  monthlyEffective: number | null;
  encountersPerMonth: number | null;
  nfcCardPrice: number;
  nfcCardMinimumPack: number;
  hmoMicroFeePercent: number;
  sentinelIncluded: boolean;
  features: { name: string; included: boolean; limit?: string }[];
  modules: string[];
  highlighted: boolean;
  ctaLabel: string;
}

// Keep in sync with public.plans (the server is the source of truth for prices, modules and limits).
const FREE_MODULES = ['dashboard', 'patients', 'health-identity', 'patient-identity', 'appointments', 'emr', 'human-resources', 'subscription', 'settings', 'help', 'nfc-cards'];
const STARTER_MODULES = [...FREE_MODULES, 'billing', 'pharmacy', 'analytics', 'nfc-scanning', 'ocr-intake'];
const GROWTH_MODULES = [...STARTER_MODULES, 'telemedicine', 'laboratory', 'ai-clinical-intelligence', 'vitamind-ai', 'ai-scribe', 'ocr-ai', 'vitalink-network', 'switch-network'];

export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'starter', name: 'Starter', tagline: 'For small private clinics, 1–2 doctors',
    targetCustomer: 'Small private clinics with 1–2 doctors',
    hardwareFee: 0, hardwareFeeUSD: 0, hardwareIncludes: [],
    monthlyPrice: 45000, annualPrice: 450000, monthlyEffective: 37500, encountersPerMonth: null,
    nfcCardPrice: 2500, nfcCardMinimumPack: 100, hmoMicroFeePercent: 1.5, sentinelIncluded: false,
    highlighted: false, ctaLabel: 'Choose Starter', modules: STARTER_MODULES,
    features: [
      { name: 'Up to 5 staff accounts', included: true }, { name: 'Up to 500 patient records', included: true },
      { name: 'Appointment reminders (SMS)', included: true }, { name: 'Basic invoicing and receipts', included: true },
      { name: 'Pharmacy stock tracking', included: true, limit: 'up to 100 drug SKUs' }, { name: 'Basic monthly reports', included: true },
      { name: 'VitaCard scanning & setup with full records', included: true }, { name: '10 NFC cards included', included: true, limit: 'more at ₦2,500/card' }, { name: 'Email support', included: true },
      { name: 'Snap paper records to register patients', included: true },
      { name: 'HMO billing and claims', included: false }, { name: 'Sentinel surveillance', included: false, limit: 'add-on ₦50,000/month' },
    ],
  },
  {
    id: 'growth', name: 'Growth', tagline: 'For mid-tier private hospitals, 3–15 doctors',
    targetCustomer: 'Private hospitals with 3–15 doctors',
    hardwareFee: 0, hardwareFeeUSD: 0, hardwareIncludes: [],
    monthlyPrice: 120000, annualPrice: 1200000, monthlyEffective: 100000, encountersPerMonth: null,
    nfcCardPrice: 2500, nfcCardMinimumPack: 100, hmoMicroFeePercent: 1, sentinelIncluded: false,
    highlighted: true, ctaLabel: 'Choose Growth', modules: GROWTH_MODULES,
    features: [
      { name: 'Up to 20 staff accounts', included: true }, { name: 'Unlimited patient records', included: true },
      { name: 'Full EMR with clinical note templates', included: true }, { name: 'Prescription management', included: true },
      { name: 'Full pharmacy (unlimited SKUs, low-stock alerts)', included: true }, { name: 'HMO/insurance billing and claims', included: true },
      { name: 'Advanced analytics dashboard', included: true }, { name: 'Staff roles and permissions', included: true },
      { name: 'Sentinel surveillance (read-only)', included: true, limit: 'full access ₦50,000/month' }, { name: '25 NFC cards included', included: true },
      { name: 'VitaMind AI clinical decision support', included: true }, { name: 'AI consultation scribe', included: true }, { name: 'Priority email + WhatsApp support', included: true },
    ],
  },
  {
    id: 'enterprise', name: 'Enterprise', tagline: 'For hospital chains, state facilities, NGOs and government',
    targetCustomer: 'Hospital chains, state facilities, NGOs and government',
    hardwareFee: 0, hardwareFeeUSD: 0, hardwareIncludes: [],
    monthlyPrice: null, annualPrice: 3000000, monthlyEffective: null, encountersPerMonth: null,
    nfcCardPrice: 2500, nfcCardMinimumPack: 100, hmoMicroFeePercent: 0.75, sentinelIncluded: true,
    highlighted: false, ctaLabel: 'Contact Sales', modules: [...GROWTH_MODULES, 'administration', 'audit-logs', 'sentinel'],
    features: [
      { name: 'Unlimited staff accounts', included: true }, { name: 'Multi-branch / multi-facility management', included: true },
      { name: 'Full Sentinel with outbreak alerts and public health reporting', included: true }, { name: 'Custom integrations (lab systems, NHIS, HMO APIs)', included: true },
      { name: 'Dedicated onboarding and training', included: true }, { name: 'SLA and uptime commitments', included: true },
      { name: 'White-label option', included: true }, { name: 'Quarterly business reviews', included: true },
      { name: 'Custom NFC card design', included: true }, { name: 'Invoiced annually, from ₦3,000,000/year', included: true },
    ],
  },
];

export const NFC_CARD_PRICING = { unitProductionCost: 1700, bulkWholesalePrice: 2500, directRetailPrice: 3000, minimumBulkOrder: 100, minimumEnterpriseOrder: 100 };
export const SENTINEL_ADDON = { monthlyPrice: 50000, description: 'Full Sentinel access: outbreak alerts, heatmaps and public health reporting powered by your EMR data. For Starter and Growth.' };
// Permanent free tier; keep modules in sync with the `free` row in public.plans.
export const FREE_PLAN = {
  id: 'free' as const,
  name: 'Free',
  modules: FREE_MODULES,
  sentinelIncluded: false,
  description: 'Up to 2 staff and 50 patients: registry, basic notes and appointments. Upgrade anytime.',
};

export const FREE_TRIAL = {
  id: 'trial' as const,
  name: '14-Day Free Trial',
  durationDays: 14,
  modules: PRICING_TIERS.find((tier) => tier.id === 'growth')!.modules,
  sentinelIncluded: false,
  description: 'Full Growth access for 14 days. No payment required.',
};
