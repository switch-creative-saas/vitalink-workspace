export type NetworkRole =
  | 'Organization Administrator'
  | 'Hospital Administrator'
  | 'Doctor'
  | 'Nurse'
  | 'Referral Coordinator'
  | 'Medical Records Officer'
  | 'Billing Officer'
  | 'Insurance Officer'
  | 'Laboratory Staff'
  | 'Pharmacy Staff'
  | 'Receptionist';

export type CapacityStatus = 'Available' | 'Limited' | 'Unavailable' | 'Not Reported';
export type TransferUrgency = 'Normal' | 'Urgent' | 'Emergency';
export type ConsentStatus = 'Patient consented' | 'Patient declined' | 'Consent pending';
export type InsuranceStatus = 'Active Coverage' | 'Verification Pending' | 'Authorization Required' | 'Out of Network' | 'Coverage Unavailable';
export type TransferStatus =
  | 'Draft'
  | 'Pending Receiving Hospital Review'
  | 'Information Requested'
  | 'Accepted — Awaiting Patient Transfer'
  | 'Declined'
  | 'Records Transferred'
  | 'Patient Arrived'
  | 'Completed';

export interface NetworkOrganization {
  id: string;
  name: string;
  facilityType: string;
  city: string;
  state: string;
  verified: boolean;
  specialties: string[];
  services: string[];
  emergencyAvailable: boolean;
  laboratory: boolean;
  imaging: boolean;
  pharmacy: boolean;
  telemedicine: boolean;
  acceptingReferrals: boolean;
  acceptingTransfers: boolean;
  capacity: CapacityStatus;
  rating: number;
  distanceKm: number;
  visibleInDirectory: boolean;
  joinedNetwork: boolean;
  lastUpdated: string;
}

export interface NetworkPatient {
  id: string;
  name: string;
  dateOfBirth: string;
  currentFacilityId: string;
  insuranceProvider: string;
  insurancePlan: string;
  memberId: string;
}

export interface TransferRecord {
  id: string;
  type: string;
  date: string;
  sourceFacilityId: string;
  status: 'Available' | 'Transferred';
}

export interface Consent {
  status: ConsentStatus;
  timestamp?: string;
  method?: string;
  authorizedRecordIds: string[];
}

export interface InsuranceVerification {
  provider: string;
  plan: string;
  memberId: string;
  coverageStatus: InsuranceStatus;
  receivingFacilityNetworkStatus: string;
  authorizationRequired: boolean;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  userRole: NetworkRole;
  action: string;
  organizationId: string;
  transferId: string;
}

export interface TransferRequest {
  id: string;
  referringFacilityId: string;
  receivingFacilityId: string;
  patientId: string;
  patientName: string;
  patientDateOfBirth: string;
  currentFacility: string;
  specialtyRequired: string;
  reason: string;
  clinicalSummary: string;
  urgency: TransferUrgency;
  requestedTransferDate: string;
  referringClinician: string;
  additionalNotes: string;
  selectedRecordIds: string[];
  consent: Consent;
  insurance: InsuranceVerification;
  status: TransferStatus;
  infoRequest?: string;
  declineReason?: string;
  createdAt: string;
  updatedAt: string;
  timeline: string[];
  audit: AuditEvent[];
}

export interface NetworkState {
  activeOrganizationId: string;
  activeRole: NetworkRole;
  organizations: NetworkOrganization[];
  patients: NetworkPatient[];
  records: TransferRecord[];
  transfers: TransferRequest[];
}

export interface OrganizationNetworkSettings {
  organizationId: string;
  joinedNetwork: boolean;
  visibleInDirectory: boolean;
  specialties: string[];
  services: string[];
  location: string;
  facilityType: string;
  emergencyAvailable: boolean;
  laboratory: boolean;
  imaging: boolean;
  pharmacy: boolean;
  telemedicine: boolean;
  acceptingReferrals: boolean;
  acceptingTransfers: boolean;
  capacity: CapacityStatus;
}
