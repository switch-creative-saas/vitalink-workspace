import { useMemo, useState } from 'react';
import { Clock3, FileUp, Mic, MonitorUp, PhoneCall, ShieldCheck, Timer, Upload, Users, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { LiveTelemedicine } from '@/components/telemedicine/LiveTelemedicine';

type TeleTab = 'patient-consultation' | 'specialist-conference';

export function TelemedicinePage() {
  return isSupabaseConfigured ? <LiveTelemedicinePage /> : <DemoTelemedicinePage />;
}

/** Live workspaces: real video visits, gated like the demo page. */
function LiveTelemedicinePage() {
  const { canView } = useAuth();
  const { hasAccess } = useSubscription();
  if (!canView('Appointments')) {
    return <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-red-700">Your role does not have access to telemedicine.</div>;
  }
  if (!hasAccess('telemedicine')) {
    return <div className="rounded-2xl border border-amber-100 bg-amber-50 p-6 text-amber-800">Telemedicine is not included in your current plan.</div>;
  }
  return <LiveTelemedicine />;
}

/** Offline demo (no Supabase). */
function DemoTelemedicinePage() {
  const { currentRole, canCreate, canView } = useAuth();
  const { hasAccess } = useSubscription();
  const [activeTab, setActiveTab] = useState<TeleTab>('patient-consultation');
  const [waiting, setWaiting] = useState(['Adebayo Johnson', 'Chioma Okonkwo']);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionTimer, setSessionTimer] = useState(0);
  const [consentGranted, setConsentGranted] = useState(false);

  const canStartConsult = canCreate('Appointments') && (currentRole === 'doctor' || currentRole === 'nurse' || currentRole === 'hospital-admin');
  const canSpecialistConference = currentRole === 'doctor' || currentRole === 'hospital-admin';
  const canRecord = currentRole === 'hospital-admin' || currentRole === 'super-admin';

  const controls = useMemo(
    () => [
      { id: 'screen', label: 'Share Screen', icon: MonitorUp },
      { id: 'upload', label: 'Upload File', icon: FileUp },
      { id: 'voice', label: 'Voice Notes', icon: Mic },
    ],
    [],
  );

  if (!canView('Appointments')) {
    return <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-red-700">Access denied by server RBAC policy.</div>;
  }
  if (!hasAccess('telemedicine')) {
    return <div className="rounded-2xl border border-amber-100 bg-amber-50 p-6 text-amber-800">Telemedicine is locked on your current plan. Upgrade to Enterprise.</div>;
  }

  return (
    <div className="space-y-4 page-transition">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Telemedicine Suite</h1>
          <p className="text-sm text-gray-500">Secure WebRTC architecture with encrypted virtual care and specialist conferencing.</p>
        </div>
        <div className="rounded-xl px-3 py-2 bg-green-50 text-green-700 text-xs flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" />
          E2E Encryption, Session Audit, Tenant Isolation Active
        </div>
      </div>

      <div className="flex gap-2 p-1 bg-gray-100 rounded-xl w-fit">
        {[
          { id: 'patient-consultation', label: 'Patient Consultation' },
          { id: 'specialist-conference', label: 'Specialist Conference' },
        ].map((tab) => (
          <button
            key={tab.id}
            className={cn('px-4 py-2 rounded-lg text-sm', activeTab === tab.id ? 'bg-white text-royal-700 shadow-sm' : 'text-gray-600')}
            onClick={() => setActiveTab(tab.id as TeleTab)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'patient-consultation' && (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] xl:grid-cols-[2fr_1fr] gap-4 lg:gap-6">
          <div className="rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-4 sm:p-6 shadow-soft min-w-0 overflow-hidden">
            <div className="rounded-2xl bg-gradient-to-br from-royal-800/90 to-royal-600/90 text-white p-4 sm:p-5 relative overflow-hidden">
              <div className="absolute inset-0 bg-white/5 backdrop-blur-[2px]" />
              <div className="relative z-10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center"><Video className="w-5 h-5" /></div>
                  <div>
                    <p className="text-sm font-semibold">Virtual Consultation Room</p>
                    <p className="text-xs text-white/70">HD adaptive streaming + in-call EMR panel</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs bg-black/20 px-2.5 py-1.5 rounded-lg">
                  <Timer className="w-3.5 h-3.5" />
                  {sessionTimer} min
                </div>
              </div>
              <div className="relative z-10 mt-4 flex flex-wrap gap-2">
                {controls.map((control) => (
                  <Button key={control.id} variant="outline" className="bg-white/10 border-white/25 text-white hover:bg-white/20 min-w-0">
                    <control.icon className="w-4 h-4 mr-2 shrink-0" />
                    <span className="truncate">{control.label}</span>
                  </Button>
                ))}
                <Button variant="outline" className="bg-white/10 border-white/25 text-white hover:bg-white/20 min-w-0">
                  <Upload className="w-4 h-4 mr-2 shrink-0" />
                  <span className="truncate">Live Prescription</span>
                </Button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={!canStartConsult}
                onClick={() => {
                  setSessionStarted(true);
                  setSessionTimer((v) => v + 1);
                  toast.success('Patient admitted from waiting room; secure tele-session started.');
                }}
              >
                <PhoneCall className="w-4 h-4 mr-2" />
                Admit & Start Session
              </Button>
              <Button variant="outline" onClick={() => toast.success('AI session summary generated and attached to EMR timeline.')}>Generate AI Session Summary</Button>
              <Button variant="outline" disabled={!canRecord} onClick={() => toast.info('Session recording policy applied (admin controlled).')}>Start Recording</Button>
            </div>
            {!canStartConsult ? <p className="text-xs text-amber-700 mt-2">Your role has view-only telemedicine access.</p> : null}
            {sessionStarted ? <p className="text-xs text-green-700 mt-2">Consultation summary will auto-save to EMR and patient receives digital report.</p> : null}
          </div>

          <aside className="rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-4 shadow-soft space-y-3 min-w-0 overflow-hidden">
            <h3 className="font-semibold text-gray-900 truncate">Waiting Room</h3>
            <div className="space-y-2">
              {waiting.map((patient) => (
                <div key={patient} className="rounded-xl border border-gray-100 p-3 flex justify-between items-center gap-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{patient}</p>
                    <p className="text-xs text-gray-500 truncate">Appointment-linked auto-launch ready</p>
                  </div>
                  <Button size="sm" className="shrink-0" onClick={() => setWaiting((prev) => prev.filter((p) => p !== patient))}>Admit</Button>
                </div>
              ))}
            </div>
            <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600">
              <p className="font-medium">In-call EMR Side Panel</p>
              <p className="mt-1">Doctor can place lab orders, create prescriptions, and write live diagnosis notes.</p>
            </div>
          </aside>
        </div>
      )}

      {activeTab === 'specialist-conference' && (
        <div className="rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-4 sm:p-6 shadow-soft space-y-4 min-w-0 overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <h3 className="font-semibold text-gray-900 truncate">Doctor ↔ Doctor Specialist Conference</h3>
            <div className="text-xs rounded-lg bg-blue-50 text-blue-700 px-2.5 py-1.5 shrink-0">Patient Consent Required</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input placeholder="Invite by email" className="min-w-0" />
            <Input placeholder="Internal staff ID" className="min-w-0" />
            <Input placeholder="Hospital directory search" className="min-w-0" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Button variant="outline" className="min-w-0"><Users className="w-4 h-4 mr-2 shrink-0" /><span className="truncate">Share labs, imaging, history</span></Button>
            <Button variant="outline" className="min-w-0"><Clock3 className="w-4 h-4 mr-2 shrink-0" /><span className="truncate">Case discussion notes</span></Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="bg-royal-700 hover:bg-royal-800 text-white min-w-0"
              disabled={!canSpecialistConference || !consentGranted}
              onClick={() => toast.success('Specialist conference started; audit trail and EMR case notes enabled.')}
            >
              Start Conference
            </Button>
            <Button variant="outline" className="min-w-0" onClick={() => setConsentGranted((value) => !value)}>
              {consentGranted ? 'Consent Captured' : 'Capture Patient Consent'}
            </Button>
            <Button variant="outline" className="min-w-0" onClick={() => toast.success('Recorded case summary attached to patient EMR.')}>Save Case Summary</Button>
          </div>
          {!canSpecialistConference ? <p className="text-xs text-amber-700">Only doctors/admin can initiate specialist conference.</p> : null}
        </div>
      )}
    </div>
  );
}
