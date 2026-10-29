import { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileLock2,
  Filter,
  Hospital,
  PhoneCall,
  Search,
  Send,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { BRAND } from '@/config/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { networkRoles } from '@/features/network/mock/networkMockData';
import { useNetworkWorkflow } from '@/features/network/hooks/useNetworkWorkflow';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { LiveNetwork } from '@/components/network/LiveNetwork';
import type {
  CapacityStatus,
  ConsentStatus,
  InsuranceStatus,
  NetworkOrganization,
  NetworkPatient,
  OrganizationNetworkSettings,
  TransferRequest,
  TransferUrgency,
} from '@/features/network/types';

type NetworkTab = 'directory' | 'referrals' | 'portability' | 'conference';
type TransferStep = 1 | 2 | 3 | 4;

const capacityOptions: CapacityStatus[] = ['Available', 'Limited', 'Unavailable', 'Not Reported'];
const insuranceOptions: InsuranceStatus[] = ['Active Coverage', 'Verification Pending', 'Authorization Required', 'Out of Network', 'Coverage Unavailable'];
const declineReasons = ['No capacity', 'Specialty unavailable', 'Insurance/authorization issue', 'Clinical mismatch', 'Other'];

const canCreateTransfer = (role: string) => ['Doctor', 'Referral Coordinator', 'Hospital Administrator', 'Organization Administrator'].includes(role);
const canReviewTransfer = (role: string) => ['Referral Coordinator', 'Hospital Administrator', 'Doctor'].includes(role);
const canTransferRecords = (role: string) => ['Medical Records Officer', 'Hospital Administrator', 'Referral Coordinator'].includes(role);
const canVerifyInsurance = (role: string) => ['Insurance Officer', 'Billing Officer', 'Hospital Administrator'].includes(role);

const emptyFilters = {
  query: '',
  specialty: '',
  location: '',
  facilityType: '',
  service: '',
  capacity: '',
  emergencyAvailable: false,
  laboratory: false,
  imaging: false,
  pharmacy: false,
  telemedicine: false,
  acceptingReferrals: false,
  acceptingTransfers: false,
  sortBy: 'Relevance',
};

const initialTransferForm = {
  patientId: '',
  receivingFacilityId: '',
  specialtyRequired: '',
  reason: '',
  clinicalSummary: '',
  urgency: 'Normal' as TransferUrgency,
  requestedTransferDate: new Date().toISOString().slice(0, 10),
  referringClinician: 'Dr. Sarah Johnson',
  additionalNotes: '',
  selectedRecordIds: [] as string[],
  consentStatus: 'Consent pending' as ConsentStatus,
  consentMethod: 'Verbal confirmation',
  insuranceStatus: 'Verification Pending' as InsuranceStatus,
};

export function VitaLinkNetworkPage() {
  return isSupabaseConfigured ? <LiveNetworkPage /> : <DemoVitaLinkNetworkPage />;
}

function LiveNetworkPage() {
  const { hasAccess } = useSubscription();
  if (!hasAccess('multi_hospital')) {
    return <div className="rounded-2xl border border-amber-100 bg-amber-50 p-6 text-amber-800">The VitaLink Network is included in the Growth and Enterprise plans. Upgrade from Subscription to join.</div>;
  }
  return <LiveNetwork />;
}

// Offline demo only (no Supabase): simulated hospitals and transfers kept in this browser.
function DemoVitaLinkNetworkPage() {
  const { canView } = useAuth();
  const { hasAccess } = useSubscription();
  const workflow = useNetworkWorkflow();
  const { state, activeOrganization } = workflow;
  const [activeTab, setActiveTab] = useState<NetworkTab>('directory');
  const [filters, setFilters] = useState(emptyFilters);
  const [selectedOrganization, setSelectedOrganization] = useState<NetworkOrganization | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferStep, setTransferStep] = useState<TransferStep>(1);
  const [transferForm, setTransferForm] = useState(initialTransferForm);
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [infoRequest, setInfoRequest] = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const [recordTransferProgress, setRecordTransferProgress] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const activeRole = state.activeRole;
  const visibleOrganizations = useMemo(
    () => workflow.searchOrganizations(filters.query, filters, filters.sortBy),
    [filters, state.organizations],
  );
  const patientsForActiveOrganization = state.patients.filter((patient) => patient.currentFacilityId === activeOrganization.id);
  const selectedPatient = state.patients.find((patient) => patient.id === transferForm.patientId) ?? patientsForActiveOrganization[0];
  const selectedTransfer = state.transfers.find((transfer) => transfer.id === selectedTransferId) ?? null;
  const incomingTransfers = state.transfers.filter((transfer) => transfer.receivingFacilityId === activeOrganization.id);
  const outgoingTransfers = state.transfers.filter((transfer) => transfer.referringFacilityId === activeOrganization.id);
  const accessibleTransfers = [...incomingTransfers, ...outgoingTransfers.filter((transfer) => !incomingTransfers.some((item) => item.id === transfer.id))];
  const authorizedRecords = selectedTransfer ? state.records.filter((record) => selectedTransfer.selectedRecordIds.includes(record.id)) : [];
  const receivedRecords = state.records.filter((record) => record.status === 'Transferred' && accessibleTransfers.some((transfer) => transfer.selectedRecordIds.includes(record.id) && transfer.receivingFacilityId === activeOrganization.id));

  const metrics = [
    { label: 'Network Organizations', value: state.organizations.filter((item) => item.joinedNetwork).length },
    { label: 'Verified Organizations', value: state.organizations.filter((item) => item.verified).length },
    { label: 'Open Referrals', value: state.transfers.filter((item) => !['Declined', 'Completed'].includes(item.status)).length },
    { label: 'Pending Transfers', value: state.transfers.filter((item) => item.status === 'Pending Receiving Hospital Review').length },
    { label: 'Active Transfers', value: state.transfers.filter((item) => ['Accepted — Awaiting Patient Transfer', 'Records Transferred', 'Patient Arrived'].includes(item.status)).length },
    { label: 'Completed Transfers', value: state.transfers.filter((item) => item.status === 'Completed').length },
  ];

  if (!canView('Administration')) {
    return <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-red-700">Your role does not have access to the network.</div>;
  }
  if (!hasAccess('multi_hospital')) {
    return <div className="rounded-2xl border border-amber-100 bg-amber-50 p-6 text-amber-800">Multi-hospital networking is an Enterprise feature. Upgrade to continue.</div>;
  }

  const openTransfer = (organization: NetworkOrganization) => {
    setSelectedOrganization(organization);
    setTransferForm({
      ...initialTransferForm,
      patientId: patientsForActiveOrganization[0]?.id ?? '',
      receivingFacilityId: organization.id,
      specialtyRequired: organization.specialties[0] ?? '',
    });
    setTransferStep(1);
    setTransferOpen(true);
  };

  const validateTransferStep = () => {
    if (transferStep === 1 && !transferForm.patientId) return 'Select a patient before continuing.';
    if (transferStep === 2 && (!transferForm.receivingFacilityId || !transferForm.specialtyRequired || !transferForm.reason || !transferForm.clinicalSummary)) return 'Complete the required transfer details.';
    if (transferStep === 3 && transferForm.selectedRecordIds.length === 0) return 'Select at least one record to share.';
    if (transferStep === 4 && transferForm.consentStatus !== 'Patient consented') return 'Patient consent must be recorded before submitting this frontend transfer.';
    return '';
  };

  const nextTransferStep = () => {
    const error = validateTransferStep();
    if (error) {
      toast.error(error);
      return;
    }
    setTransferStep((step) => Math.min(4, step + 1) as TransferStep);
  };

  const submitTransfer = () => {
    const error = validateTransferStep();
    if (error || !selectedPatient || !selectedOrganization) {
      toast.error(error || 'Transfer form is incomplete.');
      return;
    }
    const selectedRecordIds = transferForm.selectedRecordIds;
    workflow.createTransfer({
      referringFacilityId: activeOrganization.id,
      receivingFacilityId: selectedOrganization.id,
      patientId: selectedPatient.id,
      patientName: selectedPatient.name,
      patientDateOfBirth: selectedPatient.dateOfBirth,
      currentFacility: activeOrganization.name,
      specialtyRequired: transferForm.specialtyRequired,
      reason: transferForm.reason,
      clinicalSummary: transferForm.clinicalSummary,
      urgency: transferForm.urgency,
      requestedTransferDate: transferForm.requestedTransferDate,
      referringClinician: transferForm.referringClinician,
      additionalNotes: transferForm.additionalNotes,
      selectedRecordIds,
      consent: {
        status: transferForm.consentStatus,
        method: transferForm.consentMethod,
        timestamp: new Date().toISOString(),
        authorizedRecordIds: selectedRecordIds,
      },
      insurance: {
        provider: selectedPatient.insuranceProvider,
        plan: selectedPatient.insurancePlan,
        memberId: selectedPatient.memberId,
        coverageStatus: transferForm.insuranceStatus,
        receivingFacilityNetworkStatus: 'In Network - frontend simulation',
        authorizationRequired: transferForm.insuranceStatus === 'Authorization Required',
      },
    });
    toast.success(`Transfer request sent successfully to ${selectedOrganization.name}.`);
    setTransferOpen(false);
    setActiveTab('referrals');
  };

  const simulateRecordTransfer = () => {
    if (!selectedTransfer) return;
    setRecordTransferProgress('Preparing authorized records...');
    window.setTimeout(() => setRecordTransferProgress('Encrypting transfer package...'), 650);
    window.setTimeout(() => {
      setRecordTransferProgress('Secure transfer completed.');
      workflow.transferRecords(selectedTransfer.id);
      toast.success('Authorized records transferred successfully.');
    }, 1400);
  };

  const statusTone = (status: string) => {
    if (status.includes('Accepted') || status.includes('Completed') || status.includes('Transferred') || status === 'Available') return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800';
    if (status.includes('Pending') || status.includes('Limited') || status.includes('Requested') || status.includes('Authorization')) return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800';
    if (status.includes('Declined') || status.includes('Unavailable') || status.includes('Out of Network')) return 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800';
    return 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
  };

  return (
    <div className="space-y-5 page-transition">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{BRAND.network}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">Find hospitals on VitaLink, refer or transfer patients, and share records with the patient's consent.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={state.activeOrganizationId} onChange={(event) => workflow.setActiveOrganization(event.target.value)}>
            {state.organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
          </select>
          <select className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={activeRole} onChange={(event) => workflow.setActiveRole(event.target.value as typeof activeRole)}>
            {networkRoles.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>Network Settings</Button>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
        {metrics.map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-white/70 bg-white/75 p-4 shadow-soft dark:border-slate-700 dark:bg-slate-800/80">
            <p className="text-xs text-slate-600 dark:text-slate-400">{metric.label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{metric.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/35 dark:text-blue-200">
        <div className="flex flex-wrap items-center gap-2">
          {['Discovery', 'Referral', 'Authorization', 'Record Exchange', 'Receiving Care', 'Completion'].map((item, index) => (
            <div key={item} className="flex items-center gap-2">
              <span className="rounded-full bg-white px-3 py-1 font-medium dark:bg-slate-800 dark:text-slate-50">{item}</span>
              {index < 5 && <ArrowRight className="h-4 w-4 text-blue-400" />}
            </div>
          ))}
        </div>
      </section>

      <div className="flex max-w-full gap-2 overflow-x-auto rounded-xl bg-gray-100 p-1 w-fit dark:bg-slate-900/70">
        {[
          { id: 'directory', label: 'Network Directory' },
          { id: 'referrals', label: 'Inter-Hospital Referrals' },
          { id: 'portability', label: 'Record Portability' },
          { id: 'conference', label: 'Cross-Hospital Conference' },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as NetworkTab)} className={cn('whitespace-nowrap rounded-lg px-4 py-2 text-sm transition-colors', activeTab === tab.id ? 'bg-white text-royal-700 shadow-sm dark:bg-slate-800 dark:text-blue-300' : 'text-slate-600 hover:bg-white/60 dark:text-slate-400 dark:hover:bg-slate-800/70')}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'directory' && (
        <div className="space-y-4">
          <DirectoryFilters filters={filters} setFilters={setFilters} />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {visibleOrganizations.map((organization) => (
                <OrganizationCard
                  key={organization.id}
                  organization={organization}
                  selected={selectedOrganization?.id === organization.id}
                  onSelect={() => setSelectedOrganization(organization)}
                  onTransfer={() => openTransfer(organization)}
                  canCreate={canCreateTransfer(activeRole)}
                  statusTone={statusTone}
                />
              ))}
            </div>
            <FacilityProfile
              organization={selectedOrganization ?? visibleOrganizations[0]}
              onTransfer={openTransfer}
              canCreate={canCreateTransfer(activeRole)}
              statusTone={statusTone}
            />
          </div>
        </div>
      )}

      {activeTab === 'referrals' && (
        <TransferBoard
          transfers={accessibleTransfers}
          activeOrganizationId={activeOrganization.id}
          organizations={state.organizations}
          selectedTransfer={selectedTransfer}
          onSelect={setSelectedTransferId}
          canReview={canReviewTransfer(activeRole)}
          infoRequest={infoRequest}
          setInfoRequest={setInfoRequest}
          declineReason={declineReason}
          setDeclineReason={setDeclineReason}
          onAccept={(id) => { workflow.acceptTransfer(id); toast.success(`Transfer ${id} accepted.`); }}
          onRequestInfo={(id) => {
            if (!infoRequest.trim()) return toast.error('Specify what information is needed.');
            workflow.requestMoreInformation(id, infoRequest);
            setInfoRequest('');
            toast.info('Information request sent.');
          }}
          onDecline={(id) => {
            if (!declineReason) return toast.error('Select a decline reason.');
            workflow.declineTransfer(id, declineReason);
            setDeclineReason('');
            toast.error('Transfer declined with reason recorded.');
          }}
          onArrived={(id) => { workflow.markPatientArrived(id); toast.success('Patient arrival recorded.'); }}
          onComplete={(id) => { workflow.completeTransfer(id); toast.success('Transfer completed.'); }}
          statusTone={statusTone}
        />
      )}

      {activeTab === 'portability' && (
        <PortabilityPanel
          transfers={accessibleTransfers}
          selectedTransfer={selectedTransfer ?? accessibleTransfers[0] ?? null}
          records={authorizedRecords.length ? authorizedRecords : state.records.filter((record) => (selectedTransfer ?? accessibleTransfers[0])?.selectedRecordIds.includes(record.id))}
          activeRole={activeRole}
          onSelect={setSelectedTransferId}
          onTransferRecords={simulateRecordTransfer}
          progress={recordTransferProgress}
          canTransfer={canTransferRecords(activeRole)}
          onVerifyInsurance={(id, status) => { workflow.verifyInsurance(id, status); toast.success('Insurance verification completed.'); }}
          canVerifyInsurance={canVerifyInsurance(activeRole)}
          receivedRecords={receivedRecords}
          organizations={state.organizations}
          statusTone={statusTone}
        />
      )}

      {activeTab === 'conference' && (
        <div className="rounded-2xl border border-white/70 bg-white/75 p-5 shadow-soft space-y-4 dark:border-slate-700 dark:bg-slate-800/80">
          <h3 className="font-semibold text-slate-900 dark:text-slate-50">Cross-Hospital Specialist Conference</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Input placeholder={`Patient ${BRAND.patientIdLabel}`} />
            <Input placeholder="Invite specialist organization ID" />
            <Input placeholder="Invite specialist staff ID/email" />
          </div>
          <p className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">Conference context is limited to explicitly authorized transfer/referral data in this frontend prototype.</p>
          <Button className="bg-royal-700 text-white hover:bg-royal-800" onClick={() => toast.success('Cross-hospital conference started with secure shared context.')}>
            <PhoneCall className="mr-2 h-4 w-4" />
            Start Specialist Call
          </Button>
        </div>
      )}

      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        step={transferStep}
        setStep={setTransferStep}
        form={transferForm}
        setForm={setTransferForm}
        patients={patientsForActiveOrganization}
        selectedPatient={selectedPatient}
        receivingOrganization={selectedOrganization}
        records={selectedPatient ? state.records.filter((record) => record.sourceFacilityId === selectedPatient.currentFacilityId) : []}
        nextStep={nextTransferStep}
        submitTransfer={submitTransfer}
      />
      <NetworkSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        organization={activeOrganization}
        onSave={(settings) => {
          workflow.updateOrganizationSettings(settings);
          setSettingsOpen(false);
          toast.success('Network participation settings saved.');
        }}
      />
    </div>
  );
}

function DirectoryFilters({ filters, setFilters }: { filters: typeof emptyFilters; setFilters: (filters: typeof emptyFilters) => void }) {
  const update = (key: keyof typeof emptyFilters, value: string | boolean) => setFilters({ ...filters, [key]: value });
  return (
    <div className="rounded-2xl border border-white/70 bg-white/75 p-4 shadow-soft space-y-3 dark:border-slate-700 dark:bg-slate-800/80">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input className="pl-9" placeholder="Search specialty, organization, service, or location" value={filters.query} onChange={(event) => update('query', event.target.value)} />
        </div>
        <Input placeholder="Specialty" value={filters.specialty} onChange={(event) => update('specialty', event.target.value)} />
        <Input placeholder="Location" value={filters.location} onChange={(event) => update('location', event.target.value)} />
        <Input placeholder="Service" value={filters.service} onChange={(event) => update('service', event.target.value)} />
        <select className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={filters.facilityType} onChange={(event) => update('facilityType', event.target.value)}>
          <option value="">Any facility type</option>
          <option>Hospital</option>
          <option>Specialist Hospital</option>
          <option>Teaching Hospital</option>
          <option>Medical Centre</option>
        </select>
        <select className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={filters.capacity} onChange={(event) => update('capacity', event.target.value)}>
          <option value="">Any capacity</option>
          {capacityOptions.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={filters.sortBy} onChange={(event) => update('sortBy', event.target.value)}>
          {['Relevance', 'Distance', 'Rating', 'Availability'].map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        {(['emergencyAvailable', 'laboratory', 'imaging', 'pharmacy', 'telemedicine', 'acceptingReferrals', 'acceptingTransfers'] as const).map((key) => (
          <button key={key} onClick={() => update(key, !filters[key])} className={cn('rounded-lg border px-3 py-2 text-xs capitalize', filters[key] ? 'border-royal-600 bg-royal-50 text-royal-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-300' : 'border-gray-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400')}>
            {key.replace(/([A-Z])/g, ' $1')}
          </button>
        ))}
        <Button variant="outline" size="sm" onClick={() => setFilters(emptyFilters)}>
          <Filter className="mr-2 h-4 w-4" />
          Clear
        </Button>
      </div>
    </div>
  );
}

function OrganizationCard({ organization, selected, onSelect, onTransfer, canCreate, statusTone }: { organization: NetworkOrganization; selected: boolean; onSelect: () => void; onTransfer: () => void; canCreate: boolean; statusTone: (status: string) => string }) {
  return (
    <button type="button" onClick={onSelect} className={cn('rounded-2xl border bg-white/75 p-4 text-left shadow-soft transition-all hover:shadow-md dark:bg-slate-800/80', selected ? 'border-royal-300 ring-2 ring-royal-100 dark:border-blue-500 dark:ring-blue-900/50' : 'border-white/70 dark:border-slate-700')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-900 dark:text-slate-50 truncate">{organization.name}</h3>
          <p className="text-xs text-slate-600 dark:text-slate-400">{organization.facilityType} · {organization.city}, {organization.state}</p>
        </div>
        <span className={cn('rounded-full border px-2 py-1 text-[11px]', organization.verified ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-gray-200 bg-gray-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400')}>
          {organization.verified ? 'Verified' : 'Mock'}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {organization.specialties.slice(0, 3).map((item) => <span key={item} className="rounded-full bg-blue-50 px-2 py-1 text-[11px] text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{item}</span>)}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-400">
        <Capability label="Emergency" enabled={organization.emergencyAvailable} />
        <Capability label="Lab" enabled={organization.laboratory} />
        <Capability label="Imaging" enabled={organization.imaging} />
        <Capability label="Telemedicine" enabled={organization.telemedicine} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className={cn('rounded-full border px-2 py-1 text-[11px]', statusTone(organization.capacity))}>{organization.capacity}</span>
        <Button size="sm" disabled={!canCreate || !organization.acceptingTransfers} onClick={(event) => { event.stopPropagation(); onTransfer(); }}>
          Request Transfer
        </Button>
      </div>
    </button>
  );
}

function FacilityProfile({ organization, onTransfer, canCreate, statusTone }: { organization?: NetworkOrganization; onTransfer: (organization: NetworkOrganization) => void; canCreate: boolean; statusTone: (status: string) => string }) {
  if (!organization) return null;
  return (
    <aside className="rounded-2xl border border-white/70 bg-white/85 p-5 shadow-soft xl:sticky xl:top-24 h-fit dark:border-slate-700 dark:bg-slate-800/90">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-royal-50 p-3 text-royal-700 dark:bg-blue-950/40 dark:text-blue-300"><Hospital className="h-5 w-5" /></div>
        <div>
          <h2 className="font-semibold text-slate-900 dark:text-slate-50">{organization.name}</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">{organization.facilityType} · {organization.city}, {organization.state}</p>
        </div>
      </div>
      <div className="mt-4 space-y-3 text-sm">
        <ProfileRow label="Verification" value={organization.verified ? 'Verified organization' : 'Frontend mock profile'} />
        <ProfileRow label="Specialties" value={organization.specialties.join(', ')} />
        <ProfileRow label="Services" value={organization.services.join(', ')} />
        <ProfileRow label="Capacity" value={organization.capacity} badgeClass={statusTone(organization.capacity)} />
      </div>
      <p className="mt-4 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">Capacity information is provided by the facility and may change.</p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <Capability label="Referrals" enabled={organization.acceptingReferrals} />
        <Capability label="Transfers" enabled={organization.acceptingTransfers} />
        <Capability label="Pharmacy" enabled={organization.pharmacy} />
        <Capability label="Laboratory" enabled={organization.laboratory} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={!canCreate || !organization.acceptingReferrals} variant="outline" onClick={() => onTransfer(organization)}>Send Referral</Button>
        <Button disabled={!canCreate || !organization.acceptingTransfers} className="bg-royal-700 text-white hover:bg-royal-800" onClick={() => onTransfer(organization)}>Request Patient Transfer</Button>
      </div>
    </aside>
  );
}

function TransferDialog({ open, onOpenChange, step, setStep, form, setForm, patients, selectedPatient, receivingOrganization, records, nextStep, submitTransfer }: { open: boolean; onOpenChange: (open: boolean) => void; step: TransferStep; setStep: (step: TransferStep) => void; form: typeof initialTransferForm; setForm: (form: typeof initialTransferForm) => void; patients: NetworkPatient[]; selectedPatient?: NetworkPatient; receivingOrganization: NetworkOrganization | null; records: { id: string; type: string; date: string }[]; nextStep: () => void; submitTransfer: () => void }) {
  const update = <K extends keyof typeof initialTransferForm>(key: K, value: (typeof initialTransferForm)[K]) => setForm({ ...form, [key]: value });
  const recordIds = records.map((record) => record.id);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto bg-white/95 backdrop-blur-xl dark:bg-slate-900">
        <DialogHeader>
          <DialogTitle>Request Patient Transfer</DialogTitle>
          <DialogDescription>Frontend-only transfer workflow. Patient data appears only inside this authorized workflow, not in the public directory.</DialogDescription>
        </DialogHeader>
        <Progress value={(step / 4) * 100} />
        <div className="grid grid-cols-4 gap-2 text-xs">
          {['Patient', 'Transfer', 'Records', 'Consent'].map((item, index) => <button key={item} onClick={() => setStep((index + 1) as TransferStep)} className={cn('rounded-lg px-3 py-2', step === index + 1 ? 'bg-royal-50 text-royal-700 dark:bg-blue-950/40 dark:text-blue-300' : 'bg-gray-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400')}>{item}</button>)}
        </div>
        {step === 1 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <select className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={form.patientId} onChange={(event) => update('patientId', event.target.value)}>
              {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.id}</option>)}
            </select>
            <Input value={selectedPatient?.id ?? ''} readOnly placeholder={BRAND.patientIdLabel} />
            <Input value={selectedPatient?.name ?? ''} readOnly placeholder="Patient name" />
            <Input value={selectedPatient?.dateOfBirth ?? ''} readOnly placeholder="Date of birth" />
            <Input value={receivingOrganization?.name ?? ''} readOnly placeholder="Receiving facility" />
          </div>
        )}
        {step === 2 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input value={form.specialtyRequired} onChange={(event) => update('specialtyRequired', event.target.value)} placeholder="Specialty required" />
            <select className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={form.urgency} onChange={(event) => update('urgency', event.target.value as TransferUrgency)}>
              <option>Normal</option>
              <option>Urgent</option>
              <option>Emergency</option>
            </select>
            <Input type="date" value={form.requestedTransferDate} onChange={(event) => update('requestedTransferDate', event.target.value)} />
            <Input value={form.referringClinician} onChange={(event) => update('referringClinician', event.target.value)} placeholder="Referring clinician" />
            <Textarea className="md:col-span-2" value={form.reason} onChange={(event) => update('reason', event.target.value)} placeholder="Reason for transfer" />
            <Textarea className="md:col-span-2" value={form.clinicalSummary} onChange={(event) => update('clinicalSummary', event.target.value)} placeholder="Clinical summary" />
            <Textarea className="md:col-span-2" value={form.additionalNotes} onChange={(event) => update('additionalNotes', event.target.value)} placeholder="Additional notes" />
          </div>
        )}
        {step === 3 && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => update('selectedRecordIds', recordIds)}>Select All</Button>
              <Button variant="outline" size="sm" onClick={() => update('selectedRecordIds', [])}>Clear All</Button>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {records.map((record) => (
                <label key={record.id} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50">
                  <input type="checkbox" checked={form.selectedRecordIds.includes(record.id)} onChange={(event) => update('selectedRecordIds', event.target.checked ? [...form.selectedRecordIds, record.id] : form.selectedRecordIds.filter((id) => id !== record.id))} />
                  {record.type} · {record.date}
                </label>
              ))}
            </div>
          </div>
        )}
        {step === 4 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">
              Patient consent is required before authorized medical information is shared with the receiving organization, except where applicable emergency/legal exceptions would later be handled by the backend and applicable policy.
            </div>
            <select className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={form.consentStatus} onChange={(event) => update('consentStatus', event.target.value as ConsentStatus)}>
              <option>Patient consented</option>
              <option>Patient declined</option>
              <option>Consent pending</option>
            </select>
            <Input value={form.consentMethod} onChange={(event) => update('consentMethod', event.target.value)} placeholder="Consent method" />
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">Records authorized: {form.selectedRecordIds.length} · Receiving organization: {receivingOrganization?.name ?? '--'}</div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => (step === 1 ? onOpenChange(false) : setStep((step - 1) as TransferStep))}>{step === 1 ? 'Cancel' : 'Back'}</Button>
          {step < 4 ? <Button onClick={nextStep}>Continue</Button> : <Button className="bg-royal-700 text-white hover:bg-royal-800" onClick={submitTransfer}><Send className="mr-2 h-4 w-4" />Submit Transfer Request</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferBoard(props: { transfers: TransferRequest[]; activeOrganizationId: string; organizations: NetworkOrganization[]; selectedTransfer: TransferRequest | null; onSelect: (id: string) => void; canReview: boolean; infoRequest: string; setInfoRequest: (value: string) => void; declineReason: string; setDeclineReason: (value: string) => void; onAccept: (id: string) => void; onRequestInfo: (id: string) => void; onDecline: (id: string) => void; onArrived: (id: string) => void; onComplete: (id: string) => void; statusTone: (status: string) => string }) {
  const transfer = props.selectedTransfer ?? props.transfers[0] ?? null;
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
      <div className="space-y-3">
        {props.transfers.length === 0 && <EmptyState text="No incoming or outgoing transfers yet. Create one from the Network Directory." />}
        {props.transfers.map((item) => (
          <button key={item.id} onClick={() => props.onSelect(item.id)} className={cn('w-full rounded-2xl border bg-white/75 p-4 text-left shadow-soft dark:bg-slate-800/80', transfer?.id === item.id ? 'border-royal-300 ring-2 ring-royal-100 dark:border-blue-500 dark:ring-blue-900/50' : 'border-white/70 dark:border-slate-700')}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-900 dark:text-slate-50">{item.id}</p>
                <p className="text-xs text-slate-600 dark:text-slate-400">{item.patientName} · {item.specialtyRequired}</p>
              </div>
              <span className={cn('rounded-full border px-2 py-1 text-[11px]', props.statusTone(item.status))}>{item.status}</span>
            </div>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{item.urgency} · Consent: {item.consent.status} · Records: {item.selectedRecordIds.length}</p>
          </button>
        ))}
      </div>
      {transfer && (
        <div className="rounded-2xl border border-white/70 bg-white/80 p-5 shadow-soft space-y-5 dark:border-slate-700 dark:bg-slate-800/80">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-50">Transfer Details · {transfer.id}</h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">{transfer.currentFacility} to {props.organizations.find((item) => item.id === transfer.receivingFacilityId)?.name}</p>
            </div>
            <span className={cn('rounded-full border px-3 py-1 text-xs', props.statusTone(transfer.status))}>{transfer.status}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-sm">
            <InfoBox label="Patient" value={`${transfer.patientName} · ${transfer.patientId}`} />
            <InfoBox label="Urgency" value={transfer.urgency} />
            <InfoBox label="Consent" value={transfer.consent.status} />
            <InfoBox label="Specialty" value={transfer.specialtyRequired} />
            <InfoBox label="Insurance" value={transfer.insurance.coverageStatus} />
            <InfoBox label="Records Available" value={String(transfer.selectedRecordIds.length)} />
          </div>
          {props.canReview && transfer.receivingFacilityId === props.activeOrganizationId && transfer.status === 'Pending Receiving Hospital Review' && (
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 space-y-3 dark:border-slate-700 dark:bg-slate-900/50">
              <div className="flex flex-wrap gap-2">
                <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => props.onAccept(transfer.id)}><CheckCircle2 className="mr-2 h-4 w-4" />Accept Transfer</Button>
                <Button variant="outline" onClick={() => props.onRequestInfo(transfer.id)}>Request More Information</Button>
                <Button variant="outline" className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40" onClick={() => props.onDecline(transfer.id)}><XCircle className="mr-2 h-4 w-4" />Decline Transfer</Button>
              </div>
              <Textarea placeholder="Information needed, e.g. latest echocardiogram report" value={props.infoRequest} onChange={(event) => props.setInfoRequest(event.target.value)} />
              <select className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={props.declineReason} onChange={(event) => props.setDeclineReason(event.target.value)}>
                <option value="">Decline reason</option>
                {declineReasons.map((reason) => <option key={reason}>{reason}</option>)}
              </select>
            </div>
          )}
          {transfer.status === 'Records Transferred' && <Button onClick={() => props.onArrived(transfer.id)}>Mark Patient Arrived</Button>}
          {transfer.status === 'Patient Arrived' && <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => props.onComplete(transfer.id)}>Complete Transfer</Button>}
          <Timeline transfer={transfer} />
          <AuditTrail transfer={transfer} organizations={props.organizations} />
        </div>
      )}
    </div>
  );
}

function PortabilityPanel(props: { transfers: TransferRequest[]; selectedTransfer: TransferRequest | null; records: { id: string; type: string; date: string; status: string; sourceFacilityId: string }[]; activeRole: string; onSelect: (id: string) => void; onTransferRecords: () => void; progress: string; canTransfer: boolean; onVerifyInsurance: (id: string, status: InsuranceStatus) => void; canVerifyInsurance: boolean; receivedRecords: { id: string; type: string; date: string; sourceFacilityId: string }[]; organizations: NetworkOrganization[]; statusTone: (status: string) => string }) {
  const [insuranceStatus, setInsuranceStatus] = useState<InsuranceStatus>('Active Coverage');
  const transfer = props.selectedTransfer;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/70 bg-white/80 p-5 shadow-soft space-y-4 dark:border-slate-700 dark:bg-slate-800/80">
        <div className="flex flex-wrap items-center gap-2">
          <select className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={transfer?.id ?? ''} onChange={(event) => props.onSelect(event.target.value)}>
            <option value="">Select transfer</option>
            {props.transfers.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.patientName}</option>)}
          </select>
          <span className="text-xs text-slate-600 dark:text-slate-400">Role: {props.activeRole}</span>
        </div>
        {!transfer ? <EmptyState text="Create or select a transfer to view portability actions." /> : (
          <>
            <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
              Insurance coverage at the receiving facility is subject to plan eligibility, provider network status, authorization requirements, and insurer verification.
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <InfoBox label="Provider" value={transfer.insurance.provider} />
              <InfoBox label="Plan" value={transfer.insurance.plan} />
              <InfoBox label="Member ID" value={transfer.insurance.memberId} />
              <InfoBox label="Coverage Status" value={transfer.insurance.coverageStatus} />
            </div>
            <div className="flex flex-wrap gap-2">
              <select className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={insuranceStatus} onChange={(event) => setInsuranceStatus(event.target.value as InsuranceStatus)}>
                {insuranceOptions.map((item) => <option key={item}>{item}</option>)}
              </select>
              <Button variant="outline" disabled={!props.canVerifyInsurance} onClick={() => props.onVerifyInsurance(transfer.id, insuranceStatus)}>Verify Insurance</Button>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {props.records.map((record) => (
                <div key={record.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-50">
                  <div className="flex items-center justify-between">
                    <span>{record.type}</span>
                    <span className={cn('rounded-full border px-2 py-1 text-[11px]', props.statusTone(record.status))}>{record.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{record.date} · Source: {props.organizations.find((item) => item.id === record.sourceFacilityId)?.name}</p>
                </div>
              ))}
            </div>
            <Button disabled={!props.canTransfer || transfer.status !== 'Accepted — Awaiting Patient Transfer' || transfer.consent.status !== 'Patient consented'} className="bg-royal-700 text-white hover:bg-royal-800" onClick={props.onTransferRecords}>
              <FileLock2 className="mr-2 h-4 w-4" />
              Transfer Authorized Records
            </Button>
            {props.progress && <p className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300">{props.progress}</p>}
          </>
        )}
      </div>
      <div className="rounded-2xl border border-white/70 bg-white/80 p-5 shadow-soft dark:border-slate-700 dark:bg-slate-800/80">
        <h3 className="font-semibold text-slate-900 dark:text-slate-50">Received Patient Records</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">Transferred records are labelled as received via {BRAND.network}.</p>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          {props.receivedRecords.length === 0 && <EmptyState text="No records have been received by this organization yet." />}
          {props.receivedRecords.map((record) => (
            <div key={record.id} className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
              <p className="font-medium">{record.type}</p>
              <p className="text-xs">Received via {BRAND.network} · {record.date}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NetworkSettingsDialog({ open, onOpenChange, organization, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; organization: NetworkOrganization; onSave: (settings: OrganizationNetworkSettings) => void }) {
  const [settings, setSettings] = useState<OrganizationNetworkSettings>(() => ({
    organizationId: organization.id,
    joinedNetwork: organization.joinedNetwork,
    visibleInDirectory: organization.visibleInDirectory,
    specialties: organization.specialties,
    services: organization.services,
    location: `${organization.city}, ${organization.state}`,
    facilityType: organization.facilityType,
    emergencyAvailable: organization.emergencyAvailable,
    laboratory: organization.laboratory,
    imaging: organization.imaging,
    pharmacy: organization.pharmacy,
    telemedicine: organization.telemedicine,
    acceptingReferrals: organization.acceptingReferrals,
    acceptingTransfers: organization.acceptingTransfers,
    capacity: organization.capacity,
  }));
  const update = <K extends keyof OrganizationNetworkSettings>(key: K, value: OrganizationNetworkSettings[K]) => setSettings({ ...settings, [key]: value });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Join {BRAND.network}</DialogTitle>
          <DialogDescription>Join the VitaLink Network to connect with other healthcare organizations, receive referrals, coordinate patient transfers, and securely exchange authorized patient information.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Segmented value={settings.joinedNetwork} onChange={(value) => update('joinedNetwork', value)} trueLabel="Yes, Join Network" falseLabel="No, Continue Without Network" />
          {settings.joinedNetwork && (
            <>
              <div>
                <p className="mb-2 text-sm font-medium text-slate-900 dark:text-slate-50">Network Directory Visibility</p>
                <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">Would you like your organization to appear in the VitaLink Network Directory so other healthcare organizations can discover and refer patients to you?</p>
                <Segmented value={settings.visibleInDirectory} onChange={(value) => update('visibleInDirectory', value)} trueLabel="Yes, Make My Organization Visible" falseLabel="No, Keep My Organization Private" />
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Input value={settings.specialties.join(', ')} onChange={(event) => update('specialties', event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} placeholder="Specialties" />
                <Input value={settings.services.join(', ')} onChange={(event) => update('services', event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} placeholder="Services" />
                <Input value={settings.location} onChange={(event) => update('location', event.target.value)} placeholder="Location" />
                <Input value={settings.facilityType} onChange={(event) => update('facilityType', event.target.value)} placeholder="Facility type" />
                <select className="h-10 rounded-md border border-input bg-white px-3 text-sm text-slate-900 dark:bg-slate-900/50 dark:text-slate-50" value={settings.capacity} onChange={(event) => update('capacity', event.target.value as CapacityStatus)}>
                  {capacityOptions.map((item) => <option key={item}>{item}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {(['emergencyAvailable', 'laboratory', 'imaging', 'pharmacy', 'telemedicine', 'acceptingReferrals', 'acceptingTransfers'] as const).map((key) => (
                  <label key={key} className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs capitalize text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-50">
                    <input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => update(key, event.target.checked)} />
                    {key.replace(/([A-Z])/g, ' $1')}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onSave(settings)}>Save Network Settings</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Segmented({ value, onChange, trueLabel, falseLabel }: { value: boolean; onChange: (value: boolean) => void; trueLabel: string; falseLabel: string }) {
  return (
    <div className="grid grid-cols-1 gap-2 rounded-xl bg-gray-100 p-1 sm:grid-cols-2 dark:bg-slate-900/70">
      <button className={cn('rounded-lg px-3 py-2 text-sm', value ? 'bg-white text-royal-700 shadow-sm dark:bg-slate-800 dark:text-blue-300' : 'text-slate-600 dark:text-slate-400')} onClick={() => onChange(true)}>{trueLabel}</button>
      <button className={cn('rounded-lg px-3 py-2 text-sm', !value ? 'bg-white text-royal-700 shadow-sm dark:bg-slate-800 dark:text-blue-300' : 'text-slate-600 dark:text-slate-400')} onClick={() => onChange(false)}>{falseLabel}</button>
    </div>
  );
}

function Capability({ label, enabled }: { label: string; enabled: boolean }) {
  return <span className={cn('rounded-lg px-2 py-1', enabled ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-gray-100 text-slate-600 dark:bg-slate-900/50 dark:text-slate-400')}>{label}: {enabled ? 'Yes' : 'No'}</span>;
}

function ProfileRow({ label, value, badgeClass }: { label: string; value: string; badgeClass?: string }) {
  return (
    <div>
      <p className="text-xs text-slate-600 dark:text-slate-400">{label}</p>
      {badgeClass ? <span className={cn('inline-flex rounded-full border px-2 py-1 text-xs', badgeClass)}>{value}</span> : <p className="font-medium text-slate-900 dark:text-slate-50">{value}</p>}
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-900/50"><p className="text-xs text-slate-600 dark:text-slate-400">{label}</p><p className="font-medium text-slate-900 dark:text-slate-50">{value}</p></div>;
}

function Timeline({ transfer }: { transfer: TransferRequest }) {
  return (
    <div>
      <h4 className="mb-2 font-semibold text-slate-900 dark:text-slate-50">Transfer Timeline</h4>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {['Transfer Created', 'Sent to Receiving Hospital', 'Receiving Hospital Reviewing', 'Transfer Accepted', 'Patient Consent Recorded', 'Records Authorized', 'Records Transferred', 'Patient Arrived', 'Transfer Completed'].map((item) => (
          <div key={item} className={cn('rounded-lg border px-3 py-2 text-xs', transfer.timeline.includes(item) ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' : 'border-gray-100 bg-gray-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400')}>
            {transfer.timeline.includes(item) ? <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> : null}
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function AuditTrail({ transfer, organizations }: { transfer: TransferRequest; organizations: NetworkOrganization[] }) {
  return (
    <div>
      <h4 className="mb-2 font-semibold text-slate-900 dark:text-slate-50">Frontend Audit Trail</h4>
      <div className="max-h-48 space-y-2 overflow-auto rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
        {transfer.audit.map((event) => (
          <div key={event.id} className="rounded-lg bg-white p-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            <p className="font-medium text-slate-900 dark:text-slate-50">{event.action}</p>
            <p>{new Date(event.timestamp).toLocaleString()} · {event.userRole} · {organizations.find((item) => item.id === event.organizationId)?.name ?? event.organizationId} · {event.transferId}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-5 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
      <ClipboardList className="mx-auto mb-2 h-5 w-5 text-slate-400" />
      {text}
    </div>
  );
}
