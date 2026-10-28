export const BRAND = {
  name: 'VitaLink',
  shortName: 'VitaLink',
  company: 'VitaLink Africa',
  platform: 'VitaLink Healthcare Platform',
  dashboard: 'VitaLink Dashboard',
  assistant: 'VitaMind AI',
  sentinel: 'VitaLink Sentinel',
  sentinelDescriptor: 'Public Health Intelligence Platform',
  network: 'VitaLink Network',
  cardName: 'VitaCard',
  nfcCardName: 'VitaLink NFC Card',
  smartCardName: 'VitaLink Smart Card',
  patientIdLabel: 'VitaLink ID',
  idPrefix: 'VL',
  tokenPrefix: 'vl',
  website: 'https://www.vitalink.africa',
  supportEmail: 'support@vitalink.africa',
  noreplyEmail: 'noreply@vitalink.africa',
  logoPath: '/vitalink-logo.png',
} as const;

export type BrandIdKind =
  | 'patient'
  | 'hospital'
  | 'appointment'
  | 'invoice'
  | 'prescription'
  | 'lab'
  | 'insurance'
  | 'referral'
  | 'notification'
  | 'card';

export const BRAND_ID_PREFIXES: Record<BrandIdKind, string> = {
  patient: BRAND.idPrefix,
  hospital: 'VLH',
  appointment: 'VLA',
  invoice: 'VLI',
  prescription: 'VLP',
  lab: 'VLL',
  insurance: 'VLN',
  referral: 'VLR',
  notification: 'VLN',
  card: 'VLC',
};

export function formatBrandId(kind: BrandIdKind, serial: number | string, year = new Date().getFullYear()) {
  const normalized = String(serial).replace(/^\D+/, '').padStart(6, '0');
  return `${BRAND_ID_PREFIXES[kind]}-${year}-${normalized}`;
}

export function generateBrandToken(prefix: string, serial = Date.now()) {
  return `${prefix}-${serial}`;
}
