import { useMemo, useState } from 'react';
import { Bell, Building2, CheckCircle2, Clock3, FileLock2, Filter, Globe2, Network, PhoneCall, Send, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { cn } from '@/lib/utils';
import { BRAND } from '@/config/brand';

type NetworkTab = 'directory' | 'referrals' | 'portability' | 'specialist-conference';

const hospitals = [
  { id: 'h1', name: 'Lagos Central Hospital', specialty: 'Cardiology', location: 'Lagos', rating: 4.7, telemedicine: true, services: ['EMR', 'Imaging', 'Lab'] },
  { id: 'h2', name: 'Abuja Specialist Hospital', specialty: 'Endocrinology', location: 'Abuja', rating: 4.5, telemedicine: true, services: ['EMR', 'Specialist Consult'] },
  { id: 'h3', name: 'Kano Teaching Hospital', specialty: 'Pediatrics', location: 'Kano', rating: 4.2, telemedicine: false, services: ['Lab', 'Emergency'] },
];

export function VitaLinkNetworkPage() {
  const { currentRole, canView, canCreate } = useAuth();
  const { hasAccess } = useSubscription();
  const [activeTab, setActiveTab] = useState<NetworkTab>('directory');
  const [filters, setFilters] = useState({ specialty: '', location: '', rating: '', service: '' });
  const [selectedHospital, setSelectedHospital] = useState<string>('');
  const [urgency, setUrgency] = useState<'routine' | 'urgent' | 'critical'>('routine');
  const [consent, setConsent] = useState(false);

  const canRefer = canCreate('Patients') || currentRole === 'doctor' || currentRole === 'hospital-admin';
  const canPortability = currentRole === 'doctor' || currentRole === 'hospital-admin' || currentRole === 'super-admin';

  const filteredHospitals = useMemo(() => {
    return hospitals.filter((hospital) => {
      const bySpecialty = filters.specialty ? hospital.specialty.toLowerCase().includes(filters.specialty.toLowerCase()) : true;
      const byLocation = filters.location ? hospital.location.toLowerCase().includes(filters.location.toLowerCase()) : true;
      const byRating = filters.rating ? hospital.rating >= Number(filters.rating) : true;
      const byService = filters.service ? hospital.services.join(' ').toLowerCase().includes(filters.service.toLowerCase()) : true;
      return bySpecialty && byLocation && byRating && byService;
    });
  }, [filters]);

  if (!canView('Administration')) {
    return <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-red-700">Access denied by RBAC policy.</div>;
  }
  if (!hasAccess('multi_hospital')) {
    return <div className="rounded-2xl border border-amber-100 bg-amber-50 p-6 text-amber-800">Multi-hospital networking is an Enterprise feature. Upgrade to continue.</div>;
  }

  return (
    <div className="space-y-4 page-transition">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{BRAND.network}</h1>
          <p className="text-sm text-gray-500">National inter-hospital ecosystem for secure referrals, record portability, and specialist collaboration.</p>
        </div>
        <div className="rounded-xl px-3 py-2 bg-green-50 text-green-700 text-xs flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" />
          Tokenized Transfer + Audit Trail + Tenant Boundary Enforcement
        </div>
      </div>

      <div className="flex gap-2 p-1 bg-gray-100 rounded-xl w-fit">
        {[
          { id: 'directory', label: 'Network Directory' },
          { id: 'referrals', label: 'Inter-Hospital Referrals' },
          { id: 'portability', label: 'Record Portability' },
          { id: 'specialist-conference', label: 'Cross-Hospital Conference' },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as NetworkTab)} className={cn('px-4 py-2 rounded-lg text-sm', activeTab === tab.id ? 'bg-white text-royal-700 shadow-sm' : 'text-gray-600')}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'directory' && (
        <div className="space-y-3">
          <div className="rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-4 shadow-soft dashboard-stat-grid">
            <Input placeholder="Specialty" value={filters.specialty} onChange={(e) => setFilters((p) => ({ ...p, specialty: e.target.value }))} />
            <Input placeholder="Location" value={filters.location} onChange={(e) => setFilters((p) => ({ ...p, location: e.target.value }))} />
            <Input placeholder="Minimum rating" value={filters.rating} onChange={(e) => setFilters((p) => ({ ...p, rating: e.target.value }))} />
            <Input placeholder="Service" value={filters.service} onChange={(e) => setFilters((p) => ({ ...p, service: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {filteredHospitals.map((hospital) => (
              <div key={hospital.id} className="rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-4 shadow-soft">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{hospital.name}</h3>
                    <p className="text-xs text-gray-500">{hospital.location} • {hospital.specialty}</p>
                  </div>
                  <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-lg">Rating {hospital.rating}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {hospital.services.map((service) => <span key={service} className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600">{service}</span>)}
                </div>
                <p className="mt-2 text-xs text-gray-500">{hospital.telemedicine ? 'Telemedicine Available' : 'Telemedicine Unavailable'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'referrals' && (
        <div className="rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-4 sm:p-6 shadow-soft space-y-4">
          <h3 className="font-semibold text-gray-900">Inter-Hospital Patient Referral</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input placeholder={`Patient ${BRAND.patientIdLabel}`} />
            <select className="h-10 rounded-md border border-input px-3 text-sm" value={selectedHospital} onChange={(e) => setSelectedHospital(e.target.value)}>
              <option value="">Select specialist hospital</option>
              {hospitals.map((hospital) => <option key={hospital.id} value={hospital.id}>{hospital.name}</option>)}
            </select>
            <textarea className="min-h-20 rounded-md border border-input p-3 text-sm md:col-span-2" placeholder="Referral notes" />
            <select className="h-10 rounded-md border border-input px-3 text-sm" value={urgency} onChange={(e) => setUrgency(e.target.value as 'routine' | 'urgent' | 'critical')}>
              <option value="routine">Routine</option>
              <option value="urgent">Urgent</option>
              <option value="critical">Critical</option>
            </select>
            <Button variant="outline"><Filter className="w-4 h-4 mr-2" />Attach EMR, labs, imaging, prescriptions</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="bg-royal-700 hover:bg-royal-800 text-white"
              disabled={!canRefer || !selectedHospital}
              onClick={() => toast.success('Referral sent. Receiving hospital notified for accept/reject workflow.')}
            >
              <Send className="w-4 h-4 mr-2" />
              Send Referral
            </Button>
            <Button variant="outline" onClick={() => toast.success('Referral accepted; secure mirrored record view activated.')}>
              <Bell className="w-4 h-4 mr-2" />
              Simulate Acceptance
            </Button>
          </div>
        </div>
      )}

      {activeTab === 'portability' && (
        <div className="rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-4 sm:p-6 shadow-soft space-y-4">
          <h3 className="font-semibold text-gray-900">Medical Record Portability Engine</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl p-3 border border-blue-100 bg-blue-50 text-blue-700">
              <p className="font-medium">Token-based transfer</p>
              <p className="mt-1">Time-limited access tokens with hospital-scoped authorization.</p>
            </div>
            <div className="rounded-xl p-3 border border-green-100 bg-green-50 text-green-700">
              <p className="font-medium">Encrypted tunnel</p>
              <p className="mt-1">End-to-end encrypted package transfer and signature verification.</p>
            </div>
            <div className="rounded-xl p-3 border border-purple-100 bg-purple-50 text-purple-700">
              <p className="font-medium">Hash-logged audit trail</p>
              <p className="mt-1">Immutable-style transfer fingerprints for compliance review.</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" disabled={!canPortability}><FileLock2 className="w-4 h-4 mr-2" />Generate Secure Transfer Token</Button>
            <Button variant="outline" onClick={() => setConsent((value) => !value)}>{consent ? 'Consent Captured' : 'Capture Patient Consent'}</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={!canPortability || !consent} onClick={() => toast.success('Encrypted portability transfer completed with full audit logs.')}>
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Execute Transfer
            </Button>
          </div>
        </div>
      )}

      {activeTab === 'specialist-conference' && (
        <div className="rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-4 sm:p-6 shadow-soft space-y-4">
          <h3 className="font-semibold text-gray-900">Cross-Hospital Specialist Conference</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input placeholder={`Patient ${BRAND.patientIdLabel}`} />
            <Input placeholder="Invite specialist hospital ID" />
            <Input placeholder="Invite specialist staff ID/email" />
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
            Real-time collaborative diagnosis with secure patient record sharing, referral context, and consultation logging.
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="bg-royal-700 hover:bg-royal-800 text-white" onClick={() => toast.success('Cross-hospital conference started with secure shared context.')}>
              <PhoneCall className="w-4 h-4 mr-2" />
              Start Specialist Call
            </Button>
            <Button variant="outline"><Clock3 className="w-4 h-4 mr-2" />Save collaborative note</Button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-white/70 bg-white/70 backdrop-blur-xl p-3 text-xs text-gray-600 flex flex-wrap gap-3">
        <span className="inline-flex items-center gap-1"><Network className="w-3.5 h-3.5" />National-scale tenant federation</span>
        <span className="inline-flex items-center gap-1"><Globe2 className="w-3.5 h-3.5" />Hospital isolation preserved</span>
        <span className="inline-flex items-center gap-1"><Building2 className="w-3.5 h-3.5" />Government-grade referral interoperability</span>
      </div>
    </div>
  );
}
