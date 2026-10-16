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

const CORE_MODULES = ['dashboard', 'patients', 'health-identity', 'patient-identity', 'appointments', 'emr', 'billing', 'subscription', 'settings', 'help', 'nfc-cards'];
const GROWTH_MODULES = ['telemedicine', 'laboratory', 'pharmacy', 'human-resources', 'analytics', 'ai-clinical-intelligence', 'vitalink-network', 'switch-network'];

export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'starter', name: 'Starter Node', tagline: 'For small clinics & primary care',
    targetCustomer: 'Outpatient centers, maternity homes, single-doctor clinics (1-10 beds)',
    hardwareFee: 250000, hardwareFeeUSD: 160, hardwareIncludes: ['1 Edge Gateway', '50 NFC VitaCards included', 'On-site LAN Setup'],
    monthlyPrice: 45000, annualPrice: 459000, monthlyEffective: 38250, encountersPerMonth: 1500,
    nfcCardPrice: 2500, nfcCardMinimumPack: 100, hmoMicroFeePercent: 1.5, sentinelIncluded: false,
    highlighted: false, ctaLabel: 'Get Started', modules: CORE_MODULES,
    features: [
      { name: 'Patient Registry', included: true }, { name: 'Health Identity (NFC VitaCard)', included: true },
      { name: 'EMR - Core Records', included: true }, { name: 'Appointments', included: true },
      { name: 'Basic Billing', included: true }, { name: 'Offline-First Operation', included: true },
      { name: 'Active Offline Encounters', included: true, limit: '1,500 / month' }, { name: 'Telemedicine', included: false },
      { name: 'Laboratory Module', included: false }, { name: 'Pharmacy Module', included: false },
      { name: 'Human Resources', included: false }, { name: 'VitaMind AI', included: false },
      { name: 'Analytics & Reports', included: false }, { name: 'HMO Claim Sync', included: true, limit: '1.5% micro-fee' },
      { name: 'VitaLink Network Access', included: false }, { name: 'Sentinel Surveillance', included: false },
      { name: 'Multi-site Support', included: false }, { name: 'Custom API Integrations', included: false }, { name: 'Dedicated Support SLA', included: false },
    ],
  },
  {
    id: 'growth', name: 'Growth Corridor', tagline: 'For mid-sized hospitals',
    targetCustomer: 'Private general hospitals, specialist centers, diagnostic corridors (11-50 beds)',
    hardwareFee: 650000, hardwareFeeUSD: 420, hardwareIncludes: ['2 High-Capacity Edge Gateways', '200 NFC VitaCards included', 'On-site LAN / Staff Onboarding'],
    monthlyPrice: 120000, annualPrice: 1224000, monthlyEffective: 102000, encountersPerMonth: 6000,
    nfcCardPrice: 2500, nfcCardMinimumPack: 100, hmoMicroFeePercent: 1, sentinelIncluded: false,
    highlighted: true, ctaLabel: 'Start Growing', modules: [...CORE_MODULES, ...GROWTH_MODULES],
    features: [
      { name: 'Patient Registry', included: true }, { name: 'Health Identity (NFC VitaCard)', included: true },
      { name: 'EMR - Full Records', included: true }, { name: 'Appointments', included: true },
      { name: 'Full Billing & Invoicing', included: true }, { name: 'Offline-First Operation', included: true },
      { name: 'Active Offline Encounters', included: true, limit: '6,000 / month' }, { name: 'Telemedicine', included: true },
      { name: 'Laboratory Module', included: true }, { name: 'Pharmacy Module', included: true },
      { name: 'Human Resources', included: true }, { name: 'VitaMind AI', included: true },
      { name: 'Analytics & Reports', included: true }, { name: 'HMO Claim Sync', included: true, limit: '1.0% micro-fee' },
      { name: 'VitaLink Network Access', included: true }, { name: 'Sentinel Surveillance', included: false },
      { name: 'Multi-site Support', included: false }, { name: 'Custom API Integrations', included: false }, { name: 'Dedicated Support SLA', included: false },
    ],
  },
  {
    id: 'enterprise', name: 'Enterprise & NGO Corridor', tagline: 'For networks, tertiary hospitals & NGOs',
    targetCustomer: 'Multi-site hospital networks, state health boards, NGO partners',
    hardwareFee: 1800000, hardwareFeeUSD: 1150, hardwareIncludes: ['Multi-gateway cluster', 'Server redundancy', 'Custom NFC card deployment', 'Full on-site implementation team'],
    monthlyPrice: 350000, annualPrice: null, monthlyEffective: null, encountersPerMonth: null,
    nfcCardPrice: 2500, nfcCardMinimumPack: 100, hmoMicroFeePercent: 0.75, sentinelIncluded: true,
    highlighted: false, ctaLabel: 'Contact Sales', modules: [...CORE_MODULES, ...GROWTH_MODULES, 'administration', 'audit-logs', 'sentinel'],
    features: [
      { name: 'Patient Registry', included: true }, { name: 'Health Identity (NFC VitaCard)', included: true },
      { name: 'EMR - Full Records + Custom Fields', included: true }, { name: 'Appointments', included: true },
      { name: 'Full Billing & Invoicing', included: true }, { name: 'Offline-First Operation', included: true },
      { name: 'Active Offline Encounters', included: true, limit: 'Unlimited' }, { name: 'Telemedicine', included: true },
      { name: 'Laboratory Module', included: true }, { name: 'Pharmacy Module', included: true }, { name: 'Human Resources', included: true },
      { name: 'VitaMind AI', included: true }, { name: 'Analytics & Reports', included: true },
      { name: 'HMO Claim Sync', included: true, limit: '0.75% negotiated micro-fee' }, { name: 'VitaLink Network Access', included: true },
      { name: 'Sentinel Surveillance', included: true, limit: 'Included free' }, { name: 'Multi-site Support', included: true },
      { name: 'Custom API Integrations (NHIA/SSHIA)', included: true }, { name: 'Dedicated Support SLA', included: true },
      { name: 'Zero-Downtime Guarantee', included: true }, { name: 'NDPA 2023 Compliance Package', included: true },
    ],
  },
];

export const NFC_CARD_PRICING = { unitProductionCost: 1700, bulkWholesalePrice: 2500, directRetailPrice: 3000, minimumBulkOrder: 100, minimumEnterpriseOrder: 100 };
export const SENTINEL_ADDON = { monthlyPrice: 50000, annualPrice: 480000, annualSavings: 120000, description: 'Real-time disease surveillance, outbreak detection, and NCDC reporting powered by your EMR data.' };
// Permanent free tier; keep modules in sync with the `free` row in public.plans.
export const FREE_PLAN = {
  id: 'free' as const,
  name: 'Free',
  modules: ['dashboard', 'patients', 'health-identity', 'patient-identity', 'appointments', 'emr', 'subscription', 'settings', 'help'],
  sentinelIncluded: false,
  description: 'Patient registry, core EMR and appointments. Upgrade anytime.',
};

export const FREE_TRIAL = {
  id: 'trial' as const,
  name: '14-Day Free Trial',
  durationDays: 14,
  modules: PRICING_TIERS.find((tier) => tier.id === 'growth')!.modules,
  sentinelIncluded: false,
  description: 'Full Growth Corridor access for 14 days. No payment required.',
};
