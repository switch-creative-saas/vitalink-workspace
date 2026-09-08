export type OrganizationType =
  | 'hospital'
  | 'clinic'
  | 'ngo'
  | 'hmo'
  | 'insurance'
  | 'laboratory'
  | 'pharmacy'
  | 'government'
  | 'corporate-healthcare'
  | 'university';

export type WorkspaceType = 'healthcare' | 'public-health';

export interface OrganizationProfile {
  id: string;
  name: string;
  organizationType: OrganizationType;
  workspaceType: WorkspaceType;
  slug?: string;
  sector?: string;
  state?: string;
  contactEmail?: string;
  contactPhone?: string;
  joinedNetwork?: boolean;
  createdAt?: string;
  subscriptionTier?: 'free' | 'standard' | 'premium';
}

export const ORGANIZATION_TYPE_OPTIONS: { value: OrganizationType; label: string }[] = [
  { value: 'hospital', label: 'Hospital' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'ngo', label: 'NGO' },
  { value: 'hmo', label: 'HMO' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'laboratory', label: 'Laboratory' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'government', label: 'Government' },
  { value: 'corporate-healthcare', label: 'Corporate Healthcare' },
  { value: 'university', label: 'University' },
];

export const PUBLIC_HEALTH_ORG_TYPES: OrganizationType[] = ['ngo', 'government', 'hmo', 'insurance'];
export const HEALTHCARE_ORG_TYPES: OrganizationType[] = ORGANIZATION_TYPE_OPTIONS
  .map((option) => option.value)
  .filter((type) => !PUBLIC_HEALTH_ORG_TYPES.includes(type));

const LEGACY_ORG_TYPE_MAP: Record<string, OrganizationType> = {
  hospital: 'hospital',
  clinic: 'clinic',
  ngo: 'ngo',
  hmo: 'hmo',
  insurance: 'insurance',
  laboratory: 'laboratory',
  lab: 'laboratory',
  pharmacy: 'pharmacy',
  government: 'government',
  govt: 'government',
  'corporate healthcare': 'corporate-healthcare',
  corporate: 'corporate-healthcare',
  university: 'university',
};

export function normalizeOrganizationType(raw?: string | null): OrganizationType {
  if (!raw) return 'hospital';
  const key = raw.trim().toLowerCase().replace(/_/g, '-');
  return LEGACY_ORG_TYPE_MAP[key] ?? LEGACY_ORG_TYPE_MAP[key.replace(/-/g, ' ')] ?? 'hospital';
}

export function workspaceForOrganizationType(type: OrganizationType): WorkspaceType {
  return PUBLIC_HEALTH_ORG_TYPES.includes(type) ? 'public-health' : 'healthcare';
}

export function sectorForOrganizationType(type: OrganizationType): string {
  if (type === 'ngo') return 'NGO';
  if (type === 'government') return 'Public';
  return 'Private';
}

export function organizationTypeLabel(type: OrganizationType): string {
  return ORGANIZATION_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? 'Healthcare Organization';
}

export function workspaceLabel(workspaceType: WorkspaceType): string {
  return workspaceType === 'public-health' ? 'Public Health Workspace' : 'Healthcare Workspace';
}

export function createOrganizationProfile(params: {
  id: string;
  name?: string;
  slug?: string;
  organizationType?: string | null;
  workspaceType?: WorkspaceType;
  sector?: string;
  state?: string;
  contactEmail?: string;
  contactPhone?: string;
  joinedNetwork?: boolean;
  createdAt?: string;
  subscriptionTier?: 'free' | 'standard' | 'premium';
}): OrganizationProfile {
  const organizationType = normalizeOrganizationType(params.organizationType);
  return {
    id: params.id,
    name: params.name?.trim() || 'VitaLink Organization',
    slug: params.slug,
    organizationType,
    workspaceType: params.workspaceType ?? workspaceForOrganizationType(organizationType),
    sector: params.sector ?? sectorForOrganizationType(organizationType),
    state: params.state,
    contactEmail: params.contactEmail,
    contactPhone: params.contactPhone,
    joinedNetwork: params.joinedNetwork,
    createdAt: params.createdAt,
    subscriptionTier: params.subscriptionTier ?? 'free',
  };
}
