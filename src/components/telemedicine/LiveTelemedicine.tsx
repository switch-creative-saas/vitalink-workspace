// Telemedicine for a live (Supabase) workspace: video visits with patients (they
// join from a link) and doctor-to-doctor specialist conferences, with the
// patient's record beside the call.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Copy, FileUp, FlaskConical, Link2, MessageSquare, Mic, MicOff, MonitorUp, PhoneCall, PhoneOff, ShieldCheck,
  Stethoscope, Timer, UserCheck, Users, Video, VideoOff, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useAppointments } from '@/contexts/AppointmentContext';
import { LiveOrderLabDialog, PatientSearch } from '@/components/dashboard/LiveQuickActions';
import { requireSupabase } from '@/lib/supabase/client';
import { findPatientBySwitchId, type RegistryPatient } from '@/lib/patientRegistry';
import { listLabs, listVitals, formatVitals, type LabResult } from '@/lib/supabase/clinical';
import { createPrescriptions, parsePrescriptionLines } from '@/lib/supabase/pharmacy';
import { uploadDocument } from '@/lib/supabase/documents';
import { listCliniciansRemote } from '@/lib/supabase/appointments';
import type { AppointmentDoctor } from '@/contexts/AppointmentContext';
import {
  createSession, listExternalConferences, listNetworkSpecialists, listSessions, saveExternalSummary, subscribeToMyInvitations,
  subscribeToSessions, updateSession, visitLink, type NetworkSpecialist, type TeleSession,
} from '@/lib/supabase/telemedicine';
import { listDirectory, type NetworkFacility } from '@/lib/supabase/network';
import { openCameraAndMic, VideoCall, type CallState } from '@/lib/telemedicine/videoCall';
import { TELEMEDICINE_HANDOFF_KEY } from '@/lib/handoffs';
import { timeAgo } from '@/lib/timeAgo';
import { BRAND } from '@/config/brand';

type Tab = 'consultation' | 'conference';
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
const minutesSince = (iso: string | null, now: number) => (iso ? Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000)) : 0);
const isWaitingNow = (session: TeleSession, now: number) =>
  session.status === 'waiting' && Boolean(session.patientWaitingAt) && now - new Date(session.patientWaitingAt as string).getTime() < 70_000;

async function copyText(text: string, label: string) {
  const ok = await Promise.race([
    navigator.clipboard?.writeText(text).then(() => true, () => false) ?? Promise.resolve(false),
    new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), 1500)),
  ]);
  if (ok) toast.success(`${label} copied`);
  else toast.message(label, { description: text, duration: 20000 });
}

function whatsappLink(phone: string, text: string) {
  const digits = phone.replace(/\D/g, '').replace(/^0(?=\d{10}$)/, '234');
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

// ---------------------------------------------------------------------------

export function LiveTelemedicine() {
  const { currentRole, organization } = useAuth();
  const { appointments } = useAppointments();
  const organizationId = organization.id;
  const [tab, setTab] = useState<Tab>('consultation');
  const [sessions, setSessions] = useState<TeleSession[]>([]);
  const [invitations, setInvitations] = useState<TeleSession[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [active, setActive] = useState<{ session: TeleSession; role: 'host' | 'guest' } | null>(null);

  const canRun = ['doctor', 'nurse', 'hospital-admin', 'super-admin'].includes(currentRole);
  const canConference = ['doctor', 'hospital-admin', 'super-admin'].includes(currentRole);

  const reload = useCallback(() => {
    listSessions(organizationId).then(setSessions).catch((error) => toast.error(errorText(error, 'Could not load telemedicine sessions')));
    // Conferences other network hospitals invited me to.
    listExternalConferences(organizationId).then(setInvitations).catch(() => setInvitations([]));
  }, [organizationId]);

  useEffect(() => {
    reload();
    const unsubscribe = subscribeToSessions(organizationId, reload);
    void requireSupabase().auth.getSession().then(({ data }) => setMe(data.session?.user.id ?? null));
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [organizationId, reload]);

  useEffect(() => (me ? subscribeToMyInvitations(me, reload) : undefined), [me, reload]);

  // Keep the open call's session row fresh (status, consent, summary).
  const activeSession = active ? [...sessions, ...invitations].find((item) => item.id === active.session.id) ?? active.session : null;

  // "Join Telemedicine" on an appointment hands over the appointment id.
  // Cleared once used (not here: StrictMode runs initializers twice).
  const [handoff, setHandoff] = useState<string | null>(() => sessionStorage.getItem(TELEMEDICINE_HANDOFF_KEY));
  const clearHandoff = useCallback(() => {
    sessionStorage.removeItem(TELEMEDICINE_HANDOFF_KEY);
    setHandoff(null);
  }, []);

  const consultations = sessions.filter((item) => item.kind === 'consultation');
  const waitingRoom = consultations.filter((item) => item.status === 'scheduled' || item.status === 'waiting');
  const finished = consultations.filter((item) => item.status === 'ended').slice(0, 6);
  const conferences = sessions.filter((item) => item.kind === 'conference');

  const join = (session: TeleSession, role: 'host' | 'guest') => setActive({ session, role });

  if (active && activeSession) {
    return (
      <CallRoom
        session={activeSession}
        role={active.role}
        organizationId={organizationId}
        now={now}
        onClose={() => { setActive(null); reload(); }}
      />
    );
  }

  return (
    <div className="space-y-4 page-transition">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Telemedicine Suite</h1>
          <p className="text-sm text-gray-500">Video visits with patients and specialist conferences, with the patient record alongside.</p>
        </div>
        <div className="rounded-xl px-3 py-2 bg-green-50 text-green-700 text-xs flex items-center gap-2">
          <ShieldCheck className="w-4 h-4" />
          Encrypted peer-to-peer video · not recorded · sessions audited
        </div>
      </div>

      <div data-tour-id="telemedicine-modes" className="flex gap-2 p-1 bg-gray-100 rounded-xl w-fit dark:bg-slate-800">
        {[
          { id: 'consultation' as const, label: 'Patient Consultation', count: waitingRoom.filter((item) => isWaitingNow(item, now)).length },
          { id: 'conference' as const, label: 'Specialist Conference', count: [...conferences.filter((item) => item.guestId === me), ...invitations].filter((item) => item.status !== 'ended' && item.status !== 'cancelled').length },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn('px-4 py-2 rounded-lg text-sm flex items-center gap-2', tab === item.id ? 'bg-white text-royal-700 shadow-sm dark:bg-slate-900' : 'text-gray-600 dark:text-slate-400')}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.count > 0 && <span className="rounded-full bg-emerald-500 text-white text-[10px] px-1.5">{item.count}</span>}
          </button>
        ))}
      </div>

      {tab === 'consultation' && (
        <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4 lg:gap-6">
          <NewVisitCard
            canRun={canRun}
            appointments={appointments}
            handoffAppointmentId={handoff}
            onHandoffUsed={clearHandoff}
            onCreated={reload}
          />
          <aside className="rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-4 shadow-soft space-y-3 min-w-0 dark:border-slate-700 dark:bg-slate-800/80">
            <h3 data-tour-id="telemedicine-waiting" className="font-semibold text-gray-900 dark:text-slate-50">Waiting Room</h3>
            {waitingRoom.length === 0 && <p className="text-xs text-gray-500">No open visits. Create one and send the patient their link.</p>}
            {waitingRoom.map((session) => {
              const here = isWaitingNow(session, now);
              return (
                <div key={session.id} className={cn('rounded-xl border p-3 space-y-2', here ? 'border-emerald-200 bg-emerald-50/60' : 'border-gray-100 dark:border-slate-700')}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-slate-50 truncate">{session.patientName}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {here ? `Waiting now · ${minutesSince(session.patientWaitingAt, now) || '<1'} min`
                          : session.status === 'waiting' ? `Was waiting ${timeAgo(session.patientWaitingAt as string)}; may have left`
                            : `Link sent ${timeAgo(session.createdAt)}`}
                        {session.appointmentAt ? ` · booked ${new Date(session.appointmentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
                      </p>
                    </div>
                    {here && <span className="h-2.5 w-2.5 mt-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={!canRun} onClick={() => join(session, 'host')}>
                      <UserCheck className="w-3.5 h-3.5 mr-1" />{here ? 'Admit' : 'Open room'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void copyText(visitLink(session.roomToken), 'Patient link')}><Copy className="w-3.5 h-3.5 mr-1" />Link</Button>
                    <Button size="sm" variant="ghost" disabled={!canRun} onClick={() => void updateSession(session.id, { status: 'cancelled' }).then(reload).catch((error) => toast.error(errorText(error, 'Could not cancel')))}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
            {finished.length > 0 && (
              <div className="pt-2 space-y-2">
                <h4 className="text-xs font-semibold text-gray-500 uppercase">Recent visits</h4>
                {finished.map((session) => (
                  <div key={session.id} className="rounded-lg bg-gray-50 p-2 text-xs dark:bg-slate-900/50">
                    <p className="font-medium text-gray-900 dark:text-slate-50">{session.patientName} · {session.startedAt && session.endedAt ? `${Math.max(1, Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 60_000))} min` : ''}</p>
                    <p className="text-gray-500 line-clamp-2">{session.summary || 'No summary recorded.'}</p>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}

      {tab === 'conference' && (
        <ConferencePanel
          me={me}
          canConference={canConference}
          organizationId={organizationId}
          conferences={conferences}
          invitations={invitations}
          onJoin={join}
          onChanged={reload}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function NewVisitCard({ canRun, appointments, handoffAppointmentId, onHandoffUsed, onCreated }: {
  canRun: boolean;
  appointments: ReturnType<typeof useAppointments>['appointments'];
  handoffAppointmentId: string | null;
  onHandoffUsed: () => void;
  onCreated: () => void;
}) {
  const [patient, setPatient] = useState<RegistryPatient | null>(null);
  const [appointmentId, setAppointmentId] = useState('');
  const [created, setCreated] = useState<{ token: string; patient: RegistryPatient } | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchKey, setSearchKey] = useState(0);

  // Coming from an appointment's "Join Telemedicine": preselect its patient and booking.
  useEffect(() => {
    if (!handoffAppointmentId) return;
    const appointment = appointments.find((item) => item.id === handoffAppointmentId);
    if (!appointment) return;
    onHandoffUsed();
    findPatientBySwitchId(appointment.patientSwitchId).then((found) => {
      if (found) { setPatient(found); setAppointmentId(appointment.id); }
    }).catch(() => undefined);
  }, [handoffAppointmentId, appointments, onHandoffUsed]);

  const patientAppointments = useMemo(
    () => (patient ? appointments.filter((item) => item.patientSwitchId === patient.switchId && !['cancelled', 'completed', 'no-show'].includes(item.status)) : []),
    [appointments, patient],
  );

  const create = async () => {
    if (!patient) return;
    setSaving(true);
    try {
      const result = await createSession({ patientId: patient.id, kind: 'consultation', appointmentId: appointmentId || null });
      setCreated({ token: result.room_token, patient });
      setPatient(null);
      setAppointmentId('');
      setSearchKey((value) => value + 1);
      onCreated();
    } catch (error) {
      toast.error(errorText(error, 'Could not create the visit'));
    } finally {
      setSaving(false);
    }
  };

  const link = created ? visitLink(created.token) : '';
  return (
    <div className="rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-4 sm:p-6 shadow-soft min-w-0 space-y-4 dark:border-slate-700 dark:bg-slate-800/80">
      <div className="rounded-2xl bg-gradient-to-br from-royal-800/90 to-royal-600/90 text-white p-4 sm:p-5 flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center"><Video className="w-5 h-5" /></div>
        <div>
          <p data-tour-id="telemedicine-start" className="text-sm font-semibold">Start a video visit</p>
          <p className="text-xs text-white/70">The patient joins from a link on their phone or computer. No app or account needed.</p>
        </div>
      </div>

      {created && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-2">
          <p className="text-sm font-medium text-emerald-800">Visit ready for {created.patient.firstName} {created.patient.lastName}</p>
          <p className="text-xs text-emerald-700 break-all">{link}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void copyText(link, 'Patient link')}><Copy className="w-3.5 h-3.5 mr-1" />Copy link</Button>
            {created.patient.phone && (
              <Button size="sm" variant="outline" onClick={() => window.open(whatsappLink(created.patient.phone, `Hello ${created.patient.firstName}, join your video visit here: ${link}`), '_blank', 'noopener')}>
                <MessageSquare className="w-3.5 h-3.5 mr-1" />Send on WhatsApp
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>Done</Button>
          </div>
          <p className="text-[11px] text-emerald-700">They appear in the waiting room when they open it.</p>
        </div>
      )}

      {canRun ? (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">Patient</label>
            <PatientSearch key={searchKey} value={patient} onChange={(next) => { setPatient(next); setAppointmentId(''); }} />
          </div>
          {patient && patientAppointments.length > 0 && (
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">Link to appointment (optional)</label>
              <select className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white dark:border-slate-700 dark:bg-slate-900/50" value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)}>
                <option value="">Not linked</option>
                {patientAppointments.map((item) => <option key={item.id} value={item.id}>{item.date} {item.time} · {item.type} · {item.doctor}</option>)}
              </select>
            </div>
          )}
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={!patient || saving} onClick={() => void create()}>
            <Link2 className="w-4 h-4 mr-2" />{saving ? 'Creating...' : 'Create visit & get patient link'}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-amber-700">Your role can view telemedicine sessions but not run them.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ConferencePanel({ me, canConference, organizationId, conferences, invitations, onJoin, onChanged }: {
  me: string | null;
  canConference: boolean;
  organizationId: string;
  conferences: TeleSession[];
  invitations: TeleSession[];
  onJoin: (session: TeleSession, role: 'host' | 'guest') => void;
  onChanged: () => void;
}) {
  const [patient, setPatient] = useState<RegistryPatient | null>(null);
  const [colleagues, setColleagues] = useState<AppointmentDoctor[]>([]);
  const [guestId, setGuestId] = useState('');
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  // Specialists can come from this hospital or any network hospital that offers telemedicine.
  const [source, setSource] = useState<'internal' | 'network'>('internal');
  const [directory, setDirectory] = useState<NetworkFacility[] | null>(null);
  const [facilityId, setFacilityId] = useState('');
  const [specialists, setSpecialists] = useState<NetworkSpecialist[] | null>(null);
  const [caseNote, setCaseNote] = useState('');

  useEffect(() => {
    listCliniciansRemote(organizationId).then(setColleagues).catch(() => setColleagues([]));
    listDirectory().then(setDirectory).catch(() => setDirectory([]));
  }, [organizationId]);

  const onNetwork = Boolean(directory?.some((item) => item.isMine));
  const hospitals = (directory ?? []).filter((item) => !item.isMine && item.telemedicine);
  const facility = hospitals.find((item) => item.organizationId === facilityId) ?? null;

  const chooseFacility = (id: string) => {
    setFacilityId(id);
    setGuestId('');
    setSpecialists(null);
    if (id) listNetworkSpecialists(id).then(setSpecialists).catch((error) => { toast.error(errorText(error, 'Could not load specialists')); setSpecialists([]); });
  };

  const external = source === 'network';
  const ready = Boolean(patient && guestId && consent && (!external || (facilityId && caseNote.trim().length >= 10)));

  const invite = async () => {
    if (!patient || !ready) return;
    setSaving(true);
    try {
      const result = await createSession({
        patientId: patient.id, kind: 'conference', guestId,
        guestOrganizationId: external ? facilityId : null, caseSummary: caseNote,
      });
      await updateSession(result.id, { consent: true });
      toast.success('Specialist invited', {
        description: external ? `They see it in their own VitaLink workspace at ${facility?.name ?? 'their hospital'}. Start it when ready.` : 'They see it under Specialist Conference; start it when ready.',
      });
      setPatient(null); setGuestId(''); setConsent(false); setCaseNote('');
      onChanged();
    } catch (error) {
      toast.error(errorText(error, 'Could not create the conference'));
    } finally {
      setSaving(false);
    }
  };

  const open = conferences.filter((item) => item.status !== 'ended' && item.status !== 'cancelled');
  const openInvitations = invitations.filter((item) => item.status !== 'ended' && item.status !== 'cancelled');
  const others = colleagues.filter((item) => item.id !== me);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4 lg:gap-6">
      <div className="rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-4 sm:p-6 shadow-soft space-y-4 min-w-0 dark:border-slate-700 dark:bg-slate-800/80">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <h3 className="font-semibold text-gray-900 dark:text-slate-50">Doctor ↔ Doctor Specialist Conference</h3>
          <div className="text-xs rounded-lg bg-blue-50 text-blue-700 px-2.5 py-1.5 shrink-0">Patient consent required</div>
        </div>
        {canConference ? (
          <>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">Patient being discussed</label>
              <PatientSearch value={patient} onChange={setPatient} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">Invite a specialist from</label>
              <div className="flex gap-1 rounded-lg bg-gray-100 p-1 w-fit dark:bg-slate-900/60">
                {([['internal', 'This hospital'], ['network', 'Another hospital']] as const).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => { setSource(id); setGuestId(''); }} className={cn('rounded-md px-3 py-1.5 text-sm', source === id ? 'bg-white text-royal-700 shadow-sm dark:bg-slate-800 dark:text-blue-300' : 'text-gray-600 hover:text-gray-900 dark:text-slate-400')}>{label}</button>
                ))}
              </div>
            </div>
            {!external ? (
              <div>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">Specialist to invite</label>
                <select className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white dark:border-slate-700 dark:bg-slate-900/50" value={guestId} onChange={(e) => setGuestId(e.target.value)}>
                  <option value="">{others.length ? 'Select a colleague' : 'No other clinicians in this workspace yet'}</option>
                  {others.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.department}</option>)}
                </select>
              </div>
            ) : directory === null ? (
              <p className="text-sm text-gray-500">Loading the network directory…</p>
            ) : !onNetwork ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">Your hospital isn’t on the {BRAND.network} yet. A workspace admin can join from the Network page; then you can invite specialists from other hospitals.</p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">Hospital</label>
                    <select className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white dark:border-slate-700 dark:bg-slate-900/50" value={facilityId} onChange={(e) => chooseFacility(e.target.value)}>
                      <option value="">{hospitals.length ? 'Select a hospital' : 'No network hospitals offer telemedicine yet'}</option>
                      {hospitals.map((item) => <option key={item.organizationId} value={item.organizationId}>{item.name}{item.city || item.state ? ` · ${[item.city, item.state].filter(Boolean).join(', ')}` : ''}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">Specialist</label>
                    <select className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white dark:border-slate-700 dark:bg-slate-900/50" disabled={!facilityId} value={guestId} onChange={(e) => setGuestId(e.target.value)}>
                      <option value="">{!facilityId ? 'Choose a hospital first' : specialists === null ? 'Loading…' : specialists.length ? 'Select a specialist' : 'No specialists available'}</option>
                      {(specialists ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}{item.title || item.department ? ` · ${item.title || item.department}` : ''}</option>)}
                    </select>
                  </div>
                </div>
                {facility && facility.specialties.length > 0 && <p className="text-xs text-gray-500">Specialties: {facility.specialties.join(', ')}</p>}
              </>
            )}
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">Case note for the specialist{external ? '' : ' (optional)'}</label>
              <Textarea rows={3} maxLength={4000} value={caseNote} onChange={(e) => setCaseNote(e.target.value)} placeholder="Presenting problem, key findings and what you’d like advice on" />
              {external && <p className="mt-1 text-[11px] text-gray-500">A specialist at another hospital sees this note and the patient’s name, age and sex, not your hospital’s records. Share anything else on the call.</p>}
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              {external
                ? 'The patient has agreed to their case being discussed with a specialist at another hospital. (Recorded with your name and the time.)'
                : 'The patient has agreed to their record being discussed with this specialist. (Recorded with your name and the time.)'}
            </label>
            <Button className="bg-royal-700 hover:bg-royal-800 text-white" disabled={!ready || saving} onClick={() => void invite()}>
              <Users className="w-4 h-4 mr-2" />{saving ? 'Inviting...' : 'Invite specialist'}
            </Button>
          </>
        ) : (
          <p className="text-xs text-amber-700">Only doctors and admins can start specialist conferences.</p>
        )}
      </div>

      <aside className="rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-4 shadow-soft space-y-3 min-w-0 dark:border-slate-700 dark:bg-slate-800/80">
        <h3 className="font-semibold text-gray-900 dark:text-slate-50">Conferences</h3>
        {open.length === 0 && openInvitations.length === 0 && <p className="text-xs text-gray-500">No open conferences.</p>}
        {openInvitations.map((session) => (
          <div key={session.id} className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 space-y-2 dark:border-blue-500/30 dark:bg-blue-500/10">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">Invitation from {session.external?.hostFacility}</p>
            <p className="text-sm font-medium text-gray-900 dark:text-slate-50">About {session.patientName}</p>
            <p className="text-xs text-gray-500">{session.hostName} · {session.status === 'live' ? 'in progress' : `sent ${timeAgo(session.createdAt)}`}</p>
            {session.caseSummary && <p className="whitespace-pre-wrap text-xs text-gray-700 dark:text-slate-300">{session.caseSummary}</p>}
            <Button size="sm" className="bg-royal-700 text-white" onClick={() => onJoin(session, 'guest')}><PhoneCall className="w-3.5 h-3.5 mr-1" />Join</Button>
          </div>
        ))}
        {open.map((session) => {
          const iAmGuest = session.guestId === me;
          const iAmHost = session.hostId === me;
          return (
            <div key={session.id} className={cn('rounded-xl border p-3 space-y-2', iAmGuest ? 'border-blue-200 bg-blue-50/60' : 'border-gray-100 dark:border-slate-700')}>
              <p className="text-sm font-medium text-gray-900 dark:text-slate-50">About {session.patientName}</p>
              <p className="text-xs text-gray-500">{session.hostName} → {session.guestName || 'specialist'}{session.guestFacility && session.guestFacility !== '' ? ` (${session.guestFacility})` : ''} · {session.status === 'live' ? 'in progress' : `created ${timeAgo(session.createdAt)}`}</p>
              <p className="text-[11px] text-gray-400">Consent recorded {session.consentAt ? new Date(session.consentAt).toLocaleString() : '—'}</p>
              <div className="flex gap-1.5">
                {(iAmHost || iAmGuest) && (
                  <Button size="sm" className="bg-royal-700 text-white" onClick={() => onJoin(session, iAmHost ? 'host' : 'guest')}>
                    <PhoneCall className="w-3.5 h-3.5 mr-1" />{iAmHost ? 'Start' : 'Join'}
                  </Button>
                )}
                {iAmHost && (
                  <Button size="sm" variant="ghost" onClick={() => void updateSession(session.id, { status: 'cancelled' }).then(onChanged).catch((error) => toast.error(errorText(error, 'Could not cancel')))}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CallRoom({ session, role, organizationId, now, onClose }: {
  session: TeleSession;
  role: 'host' | 'guest';
  organizationId: string;
  now: number;
  onClose: () => void;
}) {
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [state, setState] = useState<CallState>('idle');
  const [error, setError] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [summary, setSummary] = useState(session.summary);
  const [ending, setEnding] = useState(false);
  const callRef = useRef<VideoCall | null>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Status changes while in the call (e.g. becoming live) must not restart the camera.
  const startedLive = useRef(session.status === 'live');

  useEffect(() => { if (localVideo.current) localVideo.current.srcObject = local; }, [local]);
  useEffect(() => { if (remoteVideo.current) remoteVideo.current.srcObject = remote; }, [remote]);

  // Open camera → join the room → mark the session live (host).
  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    openCameraAndMic()
      .then(async ({ stream: media, note }) => {
        if (cancelled) { media.getTracks().forEach((track) => track.stop()); return; }
        stream = media;
        setLocal(media);
        if (note) setError(note);
        const call = new VideoCall({ roomToken: session.roomToken, role, onRemoteStream: setRemote, onState: setState });
        callRef.current = call;
        await call.start(media);
        if (role === 'host' && !startedLive.current) await updateSession(session.id, { status: 'live' }).catch((err) => toast.error(errorText(err, 'Could not start the session')));
      })
      .catch((err) => setError(errorText(err, 'Could not open the camera')));
    return () => {
      cancelled = true;
      void callRef.current?.hangUp();
      callRef.current = null;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [session.id, session.roomToken, role]);

  const leave = async (endForEveryone: boolean) => {
    setEnding(true);
    try {
      if (endForEveryone) await updateSession(session.id, { status: 'ended', summary });
      else if (summary !== session.summary) await saveSummary(summary);
      toast.success(endForEveryone ? 'Visit ended and summary saved' : 'You left the call');
    } catch (err) {
      toast.error(errorText(err, 'Could not save the session'));
    } finally {
      await callRef.current?.hangUp(endForEveryone);
      local?.getTracks().forEach((track) => track.stop());
      onClose();
    }
  };

  // A specialist from another hospital can only add to the summary of the inviting hospital's session.
  const saveSummary = (text: string) => (session.external ? saveExternalSummary(session.id, text) : updateSession(session.id, { summary: text }));

  const toggleShare = async () => {
    const call = callRef.current;
    if (!call) return;
    try {
      if (sharing) { await call.stopScreen(); setSharing(false); }
      else { await call.shareScreen(() => setSharing(false)); setSharing(true); }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'NotAllowedError')) toast.error(errorText(err, 'Could not share the screen'));
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      for (const file of Array.from(files)) await uploadDocument(organizationId, session.patientId, file, 'External reports');
      toast.success(`${files.length === 1 ? 'File' : `${files.length} files`} added to the patient's documents`);
    } catch (err) {
      toast.error(errorText(err, 'Upload failed'));
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const minutes = minutesSince(session.startedAt, now);
  const connected = state === 'connected';
  const peerLabel = session.kind === 'conference' ? (role === 'host' ? session.guestName || 'Specialist' : session.hostName || 'Colleague') : session.patientName;
  const stateText: Record<CallState, string> = {
    idle: 'Opening camera...',
    'waiting-for-peer': session.kind === 'conference' ? `Waiting for ${peerLabel} to join...` : `Waiting for ${session.patientName} to open their link...`,
    connecting: 'Connecting...',
    connected: 'Connected',
    reconnecting: `${peerLabel} left or lost connection. Waiting for them to rejoin...`,
    ended: 'Call ended',
    failed: 'Could not connect. A firewall may be blocking direct video; a TURN server fixes this (see setup notes).',
  };

  return (
    <div className="space-y-4 page-transition">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-50">{session.kind === 'conference' ? `Specialist conference · ${session.patientName}` : `Video visit · ${session.patientName}`}</h1>
          {session.external && <p className="text-xs text-blue-700 dark:text-blue-300">Hosted by {session.hostName} at {session.external.hostFacility}</p>}
          <p className="text-xs text-gray-500">{stateText[state]}</p>
        </div>
        <div className="flex items-center gap-2 text-xs bg-gray-100 px-2.5 py-1.5 rounded-lg dark:bg-slate-800"><Timer className="w-3.5 h-3.5" />{session.startedAt ? `${minutes} min` : 'not started'}</div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4">
        <div className="space-y-3 min-w-0">
          <div className="relative aspect-video w-full rounded-2xl bg-slate-950 overflow-hidden">
            <video ref={remoteVideo} autoPlay playsInline className={connected ? 'w-full h-full object-cover' : 'hidden'} />
            {!connected && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-white/80 gap-2 p-6">
                <Video className="w-8 h-8 text-white/40" />
                <p className="text-sm">{stateText[state]}</p>
                {error && <p className="text-xs text-amber-300">{error}</p>}
                {session.kind === 'consultation' && state === 'waiting-for-peer' && (
                  <Button size="sm" variant="outline" className="bg-white/10 border-white/20 text-white" onClick={() => void copyText(visitLink(session.roomToken), 'Patient link')}><Copy className="w-3.5 h-3.5 mr-1" />Copy patient link</Button>
                )}
              </div>
            )}
            {local && <video ref={localVideo} autoPlay playsInline muted className="absolute bottom-3 right-3 w-32 sm:w-44 aspect-video rounded-xl border border-white/20 object-cover bg-slate-800 -scale-x-100" />}
            {connected && <span className="absolute top-3 left-3 rounded-lg bg-black/40 px-2 py-1 text-xs text-white">{peerLabel}</span>}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => { const next = !micOn; setMicOn(next); callRef.current?.setAudio(next); }}>{micOn ? <Mic className="w-4 h-4 mr-1" /> : <MicOff className="w-4 h-4 mr-1" />}{micOn ? 'Mute' : 'Unmute'}</Button>
            <Button variant="outline" onClick={() => { const next = !camOn; setCamOn(next); callRef.current?.setVideo(next); }}>{camOn ? <Video className="w-4 h-4 mr-1" /> : <VideoOff className="w-4 h-4 mr-1" />}{camOn ? 'Camera off' : 'Camera on'}</Button>
            <Button variant="outline" disabled={!connected || !navigator.mediaDevices?.getDisplayMedia} onClick={() => void toggleShare()}><MonitorUp className="w-4 h-4 mr-1" />{sharing ? 'Stop sharing' : 'Share screen'}</Button>
            {!session.external && <Button variant="outline" onClick={() => fileInput.current?.click()}><FileUp className="w-4 h-4 mr-1" />Add file to record</Button>}
            <input ref={fileInput} type="file" multiple accept=".pdf,image/*,.doc,.docx,.txt" className="hidden" onChange={(e) => void upload(e.target.files)} />
            {role === 'host' ? (
              <Button className="bg-red-600 hover:bg-red-700 text-white" disabled={ending} onClick={() => void leave(true)}><PhoneOff className="w-4 h-4 mr-1" />End {session.kind === 'conference' ? 'conference' : 'visit'}</Button>
            ) : (
              <Button className="bg-red-600 hover:bg-red-700 text-white" disabled={ending} onClick={() => void leave(false)}><PhoneOff className="w-4 h-4 mr-1" />Leave</Button>
            )}
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white/70 p-4 space-y-2 dark:border-slate-700 dark:bg-slate-800/80">
            <label className="text-sm font-semibold text-gray-900 dark:text-slate-50">{session.kind === 'conference' ? 'Case discussion summary' : 'Visit summary'}</label>
            <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} placeholder="Findings, advice given, follow-up plan..." />
            <div className="flex justify-between items-center gap-2">
              <p className="text-[11px] text-gray-500">Saved with the session when the visit ends{role === 'guest' ? ' or when you leave' : ''}.{session.external ? ` ${session.external.hostFacility} keeps it with the patient's record.` : ' Write the full SOAP note in the EMR.'}</p>
              <Button size="sm" variant="outline" onClick={() => void saveSummary(summary).then(() => toast.success('Summary saved')).catch((err) => toast.error(errorText(err, 'Could not save')))}>Save now</Button>
            </div>
          </div>
        </div>

        {session.external ? <ExternalCasePanel session={session} /> : <PatientContextPanel organizationId={organizationId} session={session} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ExternalCasePanel({ session }: { session: TeleSession }) {
  const details = [session.external?.patientAge != null ? `${session.external.patientAge} years` : '', session.external?.patientSex ?? ''].filter(Boolean).join(' · ');
  return (
    <aside className="rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-4 space-y-4 min-w-0 dark:border-slate-700 dark:bg-slate-800/80">
      <div>
        <h3 className="font-semibold text-gray-900 dark:text-slate-50">{session.patientName}</h3>
        {details && <p className="text-xs capitalize text-gray-500">{details}</p>}
      </div>
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Case note from {session.hostName || 'the referring doctor'}</p>
        <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-slate-200">{session.caseSummary || 'No case note was added. Ask the referring doctor to share the details on the call.'}</p>
      </div>
      <p className="rounded-lg bg-slate-50 p-2.5 text-[11px] text-slate-600 dark:bg-slate-900/60 dark:text-slate-400">
        This patient is registered at {session.external?.hostFacility}. Their records stay with that hospital; the doctor can share their screen to show results. Consent recorded {session.consentAt ? new Date(session.consentAt).toLocaleString() : '—'}.
      </p>
    </aside>
  );
}

function PatientContextPanel({ organizationId, session }: { organizationId: string; session: TeleSession }) {
  const [patient, setPatient] = useState<RegistryPatient | null>(null);
  const [vitals, setVitals] = useState('');
  const [labs, setLabs] = useState<LabResult[]>([]);
  const [labOpen, setLabOpen] = useState(false);
  const [rxText, setRxText] = useState('');
  const [rxSaving, setRxSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    findPatientBySwitchId(session.patientSwitchId).then((found) => { if (!cancelled) setPatient(found); }).catch(() => undefined);
    listVitals(organizationId, session.patientId, 1).then((rows) => { if (!cancelled) setVitals(formatVitals(rows[0])); }).catch(() => undefined);
    listLabs(organizationId, session.patientId).then((rows) => { if (!cancelled) setLabs(rows.slice(0, 5)); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [organizationId, session.patientId, session.patientSwitchId]);

  const prescribe = async () => {
    const lines = parsePrescriptionLines(rxText);
    if (!lines.length) return;
    setRxSaving(true);
    try {
      const count = await createPrescriptions(organizationId, session.patientId, lines);
      toast.success(`${count} prescription${count === 1 ? '' : 's'} sent to the pharmacy`);
      setRxText('');
    } catch (err) {
      toast.error(errorText(err, 'Could not create the prescription'));
    } finally {
      setRxSaving(false);
    }
  };

  const list = (value?: string) => (value ?? '').split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean);
  return (
    <aside className="rounded-3xl border border-white/70 bg-white/70 backdrop-blur-xl p-4 shadow-soft space-y-4 min-w-0 dark:border-slate-700 dark:bg-slate-800/80">
      <LiveOrderLabDialog key={patient?.id ?? 'none'} open={labOpen} onClose={() => setLabOpen(false)} initialPatient={patient} />
      <div>
        <h3 className="font-semibold text-gray-900 dark:text-slate-50">{session.patientName}</h3>
        <p className="text-xs text-gray-500">{session.patientSwitchId}{patient?.dateOfBirth ? ` · born ${patient.dateOfBirth}` : ''}{patient?.gender ? ` · ${patient.gender}` : ''}</p>
      </div>
      <div className="space-y-1 text-sm">
        <p><span className="text-gray-500">Allergies:</span> <span className={cn(list(patient?.allergies).length ? 'text-red-700 font-medium' : '')}>{list(patient?.allergies).join(', ') || 'None recorded'}</span></p>
        <p><span className="text-gray-500">Conditions:</span> {list(patient?.chronicConditions).join(', ') || 'None recorded'}</p>
        <p><span className="text-gray-500">Medications:</span> {patient?.currentMedications || 'None recorded'}</p>
        <p><span className="text-gray-500">Last vitals:</span> {vitals || 'Not recorded'}</p>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Recent labs</h4>
        {labs.length === 0 && <p className="text-xs text-gray-500">No lab results.</p>}
        {labs.map((lab) => (
          <p key={lab.id} className="text-xs">
            <span className="font-medium">{lab.testName}</span>: {lab.status === 'Completed' ? `${lab.patientValue}${lab.flag !== 'Normal' ? ` (${lab.flag})` : ''}` : 'pending'} <span className="text-gray-400">{lab.date}</span>
          </p>
        ))}
      </div>
      <div className="space-y-2">
        <Button size="sm" variant="outline" className="w-full justify-start" disabled={!patient} onClick={() => setLabOpen(true)}><FlaskConical className="w-4 h-4 mr-2" />Order lab tests</Button>
        <div className="space-y-1">
          <Textarea value={rxText} onChange={(e) => setRxText(e.target.value)} rows={2} placeholder={'Prescribe, one per line, e.g.\nParacetamol 500mg TDS x5 days qty 15'} />
          <Button size="sm" variant="outline" className="w-full justify-start" disabled={!rxText.trim() || rxSaving} onClick={() => void prescribe()}><Stethoscope className="w-4 h-4 mr-2" />{rxSaving ? 'Sending...' : 'Send prescription to pharmacy'}</Button>
        </div>
        <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => window.open(`/emr/${session.patientSwitchId}`, '_blank', 'noopener')}>
          <Link2 className="w-4 h-4 mr-2" />Open full EMR in a new tab
        </Button>
      </div>
    </aside>
  );
}
