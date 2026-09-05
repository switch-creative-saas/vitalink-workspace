import { useMemo, useState } from 'react';
import { mockNetworkService } from '@/features/network/services/networkService';
import type { Consent, InsuranceStatus, NetworkRole, OrganizationNetworkSettings, TransferRequest } from '@/features/network/types';

export function useNetworkWorkflow() {
  const [state, setState] = useState(() => mockNetworkService.getState());

  const refresh = () => setState(mockNetworkService.getState());

  const activeOrganization = useMemo(
    () => state.organizations.find((organization) => organization.id === state.activeOrganizationId) ?? state.organizations[0],
    [state.activeOrganizationId, state.organizations],
  );

  const setActiveOrganization = (organizationId: string) => setState(mockNetworkService.setActiveOrganization(organizationId));
  const setActiveRole = (role: NetworkRole) => setState(mockNetworkService.setActiveRole(role));
  const updateOrganizationSettings = (settings: OrganizationNetworkSettings) => setState(mockNetworkService.updateOrganizationNetworkSettings(settings));
  const createTransfer = (transfer: Omit<TransferRequest, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'timeline' | 'audit'>) =>
    setState(mockNetworkService.createTransferRequest(transfer));
  const recordConsent = (transferId: string, consent: Consent) => setState(mockNetworkService.recordConsent(transferId, consent));
  const acceptTransfer = (transferId: string) => setState(mockNetworkService.acceptTransfer(transferId));
  const requestMoreInformation = (transferId: string, request: string) => setState(mockNetworkService.requestMoreInformation(transferId, request));
  const declineTransfer = (transferId: string, reason: string) => setState(mockNetworkService.declineTransfer(transferId, reason));
  const transferRecords = (transferId: string) => setState(mockNetworkService.transferRecords(transferId));
  const verifyInsurance = (transferId: string, status: InsuranceStatus) => setState(mockNetworkService.verifyInsurance(transferId, status));
  const markPatientArrived = (transferId: string) => setState(mockNetworkService.setTransferStatus(transferId, 'Patient Arrived', 'Patient arrival recorded'));
  const completeTransfer = (transferId: string) => setState(mockNetworkService.setTransferStatus(transferId, 'Completed', 'Transfer completed'));

  return {
    state,
    activeOrganization,
    refresh,
    setActiveOrganization,
    setActiveRole,
    updateOrganizationSettings,
    createTransfer,
    recordConsent,
    acceptTransfer,
    requestMoreInformation,
    declineTransfer,
    transferRecords,
    verifyInsurance,
    markPatientArrived,
    completeTransfer,
    searchOrganizations: mockNetworkService.searchNetworkOrganizations,
  };
}
