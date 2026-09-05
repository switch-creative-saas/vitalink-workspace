import { formatBrandId } from '@/config/brand';
import { initialNetworkState } from '@/features/network/mock/networkMockData';
import type {
  AuditEvent,
  Consent,
  InsuranceStatus,
  NetworkRole,
  NetworkState,
  OrganizationNetworkSettings,
  TransferRequest,
  TransferStatus,
} from '@/features/network/types';

const STORAGE_KEY = 'vitalink-network-state-v1';

const cloneState = (state: NetworkState): NetworkState => JSON.parse(JSON.stringify(state)) as NetworkState;

function readState(): NetworkState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const state = cloneState(initialNetworkState);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return state;
  }
  try {
    return { ...cloneState(initialNetworkState), ...(JSON.parse(raw) as NetworkState) };
  } catch {
    const state = cloneState(initialNetworkState);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return state;
  }
}

function writeState(state: NetworkState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return state;
}

function audit(transfer: TransferRequest, role: NetworkRole, organizationId: string, action: string): AuditEvent {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    userRole: role,
    action,
    organizationId,
    transferId: transfer.id,
  };
}

function withTransferUpdate(
  transferId: string,
  updater: (transfer: TransferRequest, state: NetworkState) => TransferRequest,
) {
  const state = readState();
  const transfers = state.transfers.map((transfer) => (transfer.id === transferId ? updater(transfer, state) : transfer));
  return writeState({ ...state, transfers });
}

export const mockNetworkService = {
  getState() {
    return readState();
  },

  setActiveOrganization(organizationId: string) {
    const state = readState();
    return writeState({ ...state, activeOrganizationId: organizationId });
  },

  setActiveRole(role: NetworkRole) {
    const state = readState();
    return writeState({ ...state, activeRole: role });
  },

  updateOrganizationNetworkSettings(settings: OrganizationNetworkSettings) {
    const state = readState();
    const organizations = state.organizations.map((organization) =>
      organization.id === settings.organizationId
        ? {
            ...organization,
            joinedNetwork: settings.joinedNetwork,
            visibleInDirectory: settings.visibleInDirectory,
            specialties: settings.specialties,
            services: settings.services,
            city: settings.location.split(',')[0]?.trim() || organization.city,
            facilityType: settings.facilityType,
            emergencyAvailable: settings.emergencyAvailable,
            laboratory: settings.laboratory,
            imaging: settings.imaging,
            pharmacy: settings.pharmacy,
            telemedicine: settings.telemedicine,
            acceptingReferrals: settings.acceptingReferrals,
            acceptingTransfers: settings.acceptingTransfers,
            capacity: settings.capacity,
            lastUpdated: new Date().toISOString(),
          }
        : organization,
    );
    return writeState({ ...state, organizations });
  },

  searchNetworkOrganizations(query: string, filters: Record<string, string | boolean>, sortBy: string) {
    const state = readState();
    const needle = query.trim().toLowerCase();
    const filtered = state.organizations.filter((organization) => {
      if (!organization.joinedNetwork || !organization.visibleInDirectory) return false;
      const haystack = [
        organization.name,
        organization.city,
        organization.state,
        organization.facilityType,
        organization.capacity,
        ...organization.specialties,
        ...organization.services,
      ]
        .join(' ')
        .toLowerCase();
      const matchesNeedle = needle ? haystack.includes(needle) : true;
      const matchesSpecialty = filters.specialty ? organization.specialties.some((item) => item.toLowerCase().includes(String(filters.specialty).toLowerCase())) : true;
      const matchesLocation = filters.location ? `${organization.city} ${organization.state}`.toLowerCase().includes(String(filters.location).toLowerCase()) : true;
      const matchesFacilityType = filters.facilityType ? organization.facilityType === filters.facilityType : true;
      const matchesService = filters.service ? organization.services.some((item) => item.toLowerCase().includes(String(filters.service).toLowerCase())) : true;
      const matchesCapacity = filters.capacity ? organization.capacity === filters.capacity : true;
      const booleanKeys = ['emergencyAvailable', 'laboratory', 'imaging', 'pharmacy', 'telemedicine', 'acceptingReferrals', 'acceptingTransfers'];
      const matchesBooleans = booleanKeys.every((key) => (filters[key] ? Boolean(organization[key as keyof typeof organization]) : true));
      return matchesNeedle && matchesSpecialty && matchesLocation && matchesFacilityType && matchesService && matchesCapacity && matchesBooleans;
    });
    return filtered.sort((a, b) => {
      if (sortBy === 'Distance') return a.distanceKm - b.distanceKm;
      if (sortBy === 'Rating') return b.rating - a.rating;
      if (sortBy === 'Availability') return Number(b.acceptingTransfers) - Number(a.acceptingTransfers) || a.capacity.localeCompare(b.capacity);
      return Number(b.specialties.join(' ').toLowerCase().includes(needle)) - Number(a.specialties.join(' ').toLowerCase().includes(needle));
    });
  },

  createTransferRequest(input: Omit<TransferRequest, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'timeline' | 'audit'>) {
    const state = readState();
    const nextNumber = state.transfers.length + 245;
    const id = formatBrandId('referral', nextNumber).replace(/^VLR-/, 'VTR-');
    const now = new Date().toISOString();
    const transfer: TransferRequest = {
      ...input,
      id,
      status: 'Pending Receiving Hospital Review',
      createdAt: now,
      updatedAt: now,
      timeline: ['Transfer Created', 'Sent to Receiving Hospital', 'Receiving Hospital Reviewing'],
      audit: [],
    };
    transfer.audit = [audit(transfer, state.activeRole, state.activeOrganizationId, 'Transfer request sent')];
    return writeState({ ...state, transfers: [transfer, ...state.transfers] });
  },

  recordConsent(transferId: string, consent: Consent) {
    return withTransferUpdate(transferId, (transfer, state) => ({
      ...transfer,
      consent,
      selectedRecordIds: consent.authorizedRecordIds,
      updatedAt: new Date().toISOString(),
      timeline: consent.status === 'Patient consented' ? [...new Set([...transfer.timeline, 'Patient Consent Recorded', 'Records Authorized'])] : transfer.timeline,
      audit: [...transfer.audit, audit(transfer, state.activeRole, state.activeOrganizationId, `Consent updated: ${consent.status}`)],
    }));
  },

  acceptTransfer(transferId: string) {
    return this.setTransferStatus(transferId, 'Accepted — Awaiting Patient Transfer', 'Transfer accepted');
  },

  requestMoreInformation(transferId: string, request: string) {
    return withTransferUpdate(transferId, (transfer, state) => ({
      ...transfer,
      status: 'Information Requested',
      infoRequest: request,
      updatedAt: new Date().toISOString(),
      timeline: [...new Set([...transfer.timeline, 'Information Requested'])],
      audit: [...transfer.audit, audit(transfer, state.activeRole, state.activeOrganizationId, `Information requested: ${request}`)],
    }));
  },

  declineTransfer(transferId: string, reason: string) {
    return withTransferUpdate(transferId, (transfer, state) => ({
      ...transfer,
      status: 'Declined',
      declineReason: reason,
      updatedAt: new Date().toISOString(),
      timeline: [...new Set([...transfer.timeline, 'Transfer Declined'])],
      audit: [...transfer.audit, audit(transfer, state.activeRole, state.activeOrganizationId, `Transfer declined: ${reason}`)],
    }));
  },

  setTransferStatus(transferId: string, status: TransferStatus, action: string) {
    const timelineByStatus: Partial<Record<TransferStatus, string>> = {
      'Accepted — Awaiting Patient Transfer': 'Transfer Accepted',
      'Records Transferred': 'Records Transferred',
      'Patient Arrived': 'Patient Arrived',
      Completed: 'Transfer Completed',
    };
    return withTransferUpdate(transferId, (transfer, state) => ({
      ...transfer,
      status,
      updatedAt: new Date().toISOString(),
      timeline: timelineByStatus[status] ? [...new Set([...transfer.timeline, timelineByStatus[status]])] : transfer.timeline,
      audit: [...transfer.audit, audit(transfer, state.activeRole, state.activeOrganizationId, action)],
    }));
  },

  verifyInsurance(transferId: string, coverageStatus: InsuranceStatus) {
    return withTransferUpdate(transferId, (transfer, state) => ({
      ...transfer,
      insurance: { ...transfer.insurance, coverageStatus, authorizationRequired: coverageStatus === 'Authorization Required' },
      updatedAt: new Date().toISOString(),
      audit: [...transfer.audit, audit(transfer, state.activeRole, state.activeOrganizationId, `Insurance verification updated: ${coverageStatus}`)],
    }));
  },

  transferRecords(transferId: string) {
    const state = readState();
    const transfer = state.transfers.find((item) => item.id === transferId);
    if (!transfer) return state;
    const records = state.records.map((record) => (transfer.selectedRecordIds.includes(record.id) ? { ...record, status: 'Transferred' as const } : record));
    const transfers = state.transfers.map((item) =>
      item.id === transferId
        ? {
            ...item,
            status: 'Records Transferred' as const,
            updatedAt: new Date().toISOString(),
            timeline: [...new Set([...item.timeline, 'Records Transferred'])],
            audit: [...item.audit, audit(item, state.activeRole, state.activeOrganizationId, 'Authorized records transferred')],
          }
        : item,
    );
    return writeState({ ...state, records, transfers });
  },
};
