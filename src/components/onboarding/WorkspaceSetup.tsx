// First-run setup for a new workspace, before the dashboard: confirm the facility's details, add
// its departments, (optionally) invite the team and choose whether to join the VitaLink Network.
// Uses the same backend as Administration, Staff and Network settings (facility_save,
// department_save, staff invitations, network_save_settings), so it works on every plan.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, Copy, Layers, Loader2, Mail, Network, Plus, Sparkles, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAuth, type UserRole } from '@/contexts/AuthContext';
import { useGuidedTour } from '@/contexts/GuidedTourContext';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import { getAdministrationOverview, saveDepartment, saveFacility, type AdminDepartment, type FacilityInput, type WorkingDay } from '@/lib/supabase/administration';
import { createInvitation, inviteLink, roleLabel, sendInvitationEmail } from '@/lib/supabase/staff';
import { saveSettings as saveNetworkSettings, type NetworkSettings } from '@/lib/supabase/network';
import { BRAND } from '@/config/brand';
import { roleOptionsForOrganizationType } from '@/lib/workspace/roles';

const STATES = ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT',
  'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau',
  'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'];
const SUGGESTED_DEPARTMENTS = ['General Outpatient', 'Emergency', 'Laboratory', 'Pharmacy', 'Maternity', 'Paediatrics', 'Surgery', 'Radiology', 'Nursing', 'Front Desk', 'Billing', 'Administration'];
const DEFAULT_HOURS: WorkingDay[] = Array.from({ length: 7 }, (_, day) => ({
  day, open: day === 0 || day === 6 ? '09:00' : '08:00', close: day === 0 || day === 6 ? '13:00' : '17:00', closed: day === 0,
}));
const codeFrom = (name: string) => {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(' ').filter(Boolean);
  const code = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 4);
  return code.length >= 2 ? code.slice(0, 6) : `${code}X`.slice(0, 2);
};
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

type Step = 'facility' | 'departments' | 'team' | 'network' | 'done';
const STEPS: Array<{ id: Step; title: string; hint: string; icon: typeof Building2 }> = [
  { id: 'facility', title: 'Your facility', hint: 'Name, address and contact details', icon: Building2 },
  { id: 'departments', title: 'Departments', hint: 'How your facility is organised', icon: Layers },
  { id: 'team', title: 'Your team', hint: 'Invite the people you work with', icon: Users },
  { id: 'network', title: 'VitaLink Network', hint: 'Referrals and transfers with other facilities', icon: Network },
  { id: 'done', title: 'Ready to go', hint: 'A quick look around', icon: Sparkles },
];

const FACILITY_TYPES = ['Hospital', 'Clinic', 'Primary Health Centre', 'Specialist Centre', 'Diagnostic Centre', 'Maternity Home', 'Dental Clinic', 'Eye Clinic'];
const SUGGESTED_SERVICES = ['Outpatient', 'Inpatient', 'Emergency', 'Surgery', 'Maternity', 'Paediatrics', 'Laboratory', 'Radiology', 'Pharmacy', 'Dialysis', 'Physiotherapy', 'Antenatal'];
const CAPABILITIES: Array<{ key: 'emergency' | 'laboratory' | 'imaging' | 'pharmacy' | 'telemedicine'; label: string }> = [
  { key: 'emergency', label: 'Emergency care' }, { key: 'laboratory', label: 'Laboratory' }, { key: 'imaging', label: 'Imaging / X-ray' },
  { key: 'pharmacy', label: 'Pharmacy' }, { key: 'telemedicine', label: 'Video visits' },
];
const splitList = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);

const input = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#1E4ED8] focus:ring-2 focus:ring-[#1E4ED8]/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50';
const primary = 'inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#1E4ED8] px-6 text-sm font-semibold text-white shadow-[0_10px_24px_-12px_rgba(30,78,216,0.7)] transition hover:bg-[#1A43BD] disabled:opacity-50';
const secondary = 'inline-flex h-11 items-center justify-center gap-2 rounded-full border border-slate-200 px-5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800';

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={cn('block space-y-1.5', className)}><span className="text-[13px] font-medium text-slate-700 dark:text-slate-300">{label}</span>{children}</label>;
}

interface InviteRow { email: string; role: UserRole; department: string }
interface SentInvite { email: string; sent: boolean; link: string }

export function WorkspaceSetup() {
  const { organization, setActiveOrganization, userName } = useAuth();
  const { finishSetup } = useGuidedTour();
  const roleOptions = useMemo(() => roleOptionsForOrganizationType(organization.organizationType).filter((role) => role !== 'super-admin'), [organization.organizationType]);
  const [step, setStep] = useState<Step>('facility');
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [busy, setBusy] = useState(false);
  const [facility, setFacility] = useState<FacilityInput>({
    name: organization.name, address: '', state: organization.state ?? '', contactPhone: organization.contactPhone ?? '', contactEmail: organization.contactEmail ?? '',
    website: '', maxPatientsPerDay: null, appointmentBufferMinutes: 10, emergency24x7: false,
  });
  const [departments, setDepartments] = useState<AdminDepartment[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [invites, setInvites] = useState<InviteRow[]>([{ email: '', role: roleOptions[0] ?? 'doctor', department: '' }]);
  const [sent, setSent] = useState<SentInvite[]>([]);
  const [network, setNetwork] = useState<NetworkSettings>({
    joined: true, visibleInDirectory: true, facilityType: '', city: '', state: organization.state ?? '', description: '',
    specialties: [], services: [], emergency: false, laboratory: false, imaging: false, pharmacy: false, telemedicine: false,
    acceptingReferrals: true, acceptingTransfers: true, capacity: 'not_reported', referralEmail: organization.contactEmail ?? '',
    referralPhone: organization.contactPhone ?? '', verified: false,
  });
  const [specialtiesText, setSpecialtiesText] = useState('');

  const load = useCallback(() => {
    if (!isSupabaseConfigured) return;
    getAdministrationOverview(organization.id, 30)
      .then((overview) => {
        const f = overview.facility;
        setFacility({
          name: f.name, address: f.address, state: f.state, contactPhone: f.contactPhone, contactEmail: f.contactEmail, website: f.website,
          maxPatientsPerDay: f.maxPatientsPerDay, appointmentBufferMinutes: f.appointmentBufferMinutes, emergency24x7: f.emergency24x7,
        });
        setDepartments(overview.departments);
      })
      .catch((error) => toast.error(errorText(error, 'Could not load your facility')))
      .finally(() => setLoading(false));
  }, [organization.id]);

  useEffect(() => { load(); }, [load]);

  const existingNames = useMemo(() => new Set(departments.map((d) => d.name.toLowerCase())), [departments]);
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const firstName = userName.trim().split(/\s+/)[0];

  const saveFacilityStep = async () => {
    if (facility.name.trim().length < 2) { toast.error('Enter your facility’s name'); return; }
    if (!facility.state) { toast.error('Choose the state your facility is in'); return; }
    setBusy(true);
    try {
      if (isSupabaseConfigured) await saveFacility(organization.id, { ...facility, name: facility.name.trim() });
      if (facility.name.trim() !== organization.name) setActiveOrganization({ ...organization, name: facility.name.trim() });
      // The network listing starts from the facility's details.
      setNetwork((n) => ({
        ...n, state: n.state || facility.state, emergency: n.emergency || facility.emergency24x7,
        referralEmail: n.referralEmail || facility.contactEmail, referralPhone: n.referralPhone || facility.contactPhone,
        city: n.city || facility.address.split(',').map((part) => part.trim()).filter(Boolean).pop() || '',
      }));
      setStep('departments');
    } catch (error) {
      toast.error(errorText(error, 'Could not save your facility'));
    } finally {
      setBusy(false);
    }
  };

  const saveDepartmentsStep = async () => {
    const names = [...picked, ...(custom.trim() ? [custom.trim()] : [])].filter((name) => !existingNames.has(name.toLowerCase()));
    if (!names.length && !departments.length) { toast.error('Add at least one department'); return; }
    setBusy(true);
    try {
      const used = new Set(departments.map((d) => d.code));
      for (const name of names) {
        let code = codeFrom(name);
        for (let n = 2; used.has(code); n += 1) code = `${codeFrom(name).slice(0, 4)}${n}`;
        used.add(code);
        if (isSupabaseConfigured) {
          await saveDepartment(organization.id, null, {
            name, code, description: '', location: '', headMembershipId: null, workingHours: DEFAULT_HOURS,
            linkedServices: ['Appointments', 'EMR'], rooms: 0, equipment: 0, beds: 0, isActive: true,
          });
        }
      }
      if (names.length) toast.success(`${names.length} department${names.length === 1 ? '' : 's'} added`);
      const all = [...departments.map((d) => d.name), ...names].map((name) => name.toLowerCase());
      setNetwork((n) => ({
        ...n, laboratory: n.laboratory || all.includes('laboratory'), pharmacy: n.pharmacy || all.includes('pharmacy'),
        imaging: n.imaging || all.includes('radiology'), emergency: n.emergency || all.includes('emergency'),
        services: n.services.length ? n.services : SUGGESTED_SERVICES.filter((service) => all.some((name) => name.includes(service.toLowerCase()))),
      }));
      setPicked([]);
      setCustom('');
      load();
      setStep('team');
    } catch (error) {
      toast.error(errorText(error, 'Could not add departments'));
      load();
    } finally {
      setBusy(false);
    }
  };

  const sendInvites = async () => {
    const rows = invites.filter((row) => row.email.trim());
    const bad = rows.find((row) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email.trim()));
    if (bad) { toast.error(`${bad.email} isn't a valid email`); return; }
    if (!rows.length) { setStep('network'); return; }
    setBusy(true);
    const results: SentInvite[] = [];
    for (const row of rows) {
      try {
        if (!isSupabaseConfigured) { results.push({ email: row.email.trim(), sent: false, link: '' }); continue; }
        const invite = await createInvitation(organization.id, row.email, row.role, row.department);
        const delivery = await sendInvitationEmail(invite.id).catch(() => ({ sent: false, link: inviteLink(invite.token) }));
        results.push({ email: invite.email, sent: delivery.sent, link: delivery.link });
      } catch (error) {
        toast.error(`${row.email}: ${errorText(error, 'could not invite')}`);
      }
    }
    setBusy(false);
    setSent((current) => [...current, ...results]);
    setInvites([{ email: '', role: roleOptions[0] ?? 'doctor', department: '' }]);
    if (results.length) toast.success(`${results.length} invitation${results.length === 1 ? '' : 's'} created`);
  };

  const saveNetworkStep = async () => {
    if (network.joined && !network.facilityType) { toast.error('Choose your facility type'); return; }
    if (network.joined && !network.state) { toast.error('Choose the state your facility is in'); return; }
    setBusy(true);
    try {
      if (isSupabaseConfigured) await saveNetworkSettings(organization.id, { ...network, specialties: splitList(specialtiesText) });
      setActiveOrganization({ ...organization, joinedNetwork: network.joined });
      if (network.joined) toast.success(`Joined the ${BRAND.network}`);
      setStep('done');
    } catch (error) {
      toast.error(errorText(error, 'Could not save your network settings'));
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => { void navigator.clipboard?.writeText(text).then(() => toast.success('Invite link copied')); };

  return (
    <div className="fixed inset-0 z-[70] flex overflow-hidden bg-white dark:bg-slate-950">
      {/* Steps */}
      <aside className="relative hidden w-[380px] shrink-0 overflow-hidden p-4 lg:block">
        <div className="relative flex h-full flex-col overflow-hidden rounded-[28px] bg-[#05060f] p-8 text-white">
          <img src="/auth-poster.png" alt="" className="absolute inset-0 h-full w-full object-cover object-[50%_30%] opacity-45" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#05060f]/40 to-[#05060f]/90" />
          <div className="relative flex items-center gap-2.5"><img src="/vitalink-icon.png" alt="" className="h-9 w-9" /><span className="text-lg font-semibold">VitaLink</span></div>
          <div className="relative mt-12">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">Set up your workspace</p>
            <h2 className="mt-3 text-[26px] font-semibold leading-tight">A few details, then you’re ready to see patients.</h2>
          </div>
          <ol className="relative mt-10 space-y-2">
            {STEPS.map((s, i) => {
              const done = i < stepIndex;
              const active = i === stepIndex;
              return (
                <li key={s.id} className={cn('flex items-center gap-3.5 rounded-2xl px-3 py-3 transition', active && 'bg-white/10 backdrop-blur')}>
                  <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full border text-sm font-semibold', done ? 'border-emerald-400 bg-emerald-400 text-[#05060f]' : active ? 'border-white bg-white text-[#05060f]' : 'border-white/25 text-white/60')}>
                    {done ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  <span><span className={cn('block text-sm font-semibold', !active && !done && 'text-white/70')}>{s.title}</span><span className="block text-xs text-white/55">{s.hint}</span></span>
                </li>
              );
            })}
          </ol>
          <p className="relative mt-auto text-xs text-white/45">You can change all of this later in Administration, Staff and Network settings.</p>
        </div>
      </aside>

      {/* Step content */}
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto px-5 py-6 sm:px-10">
        <div className="mx-auto flex w-full max-w-[640px] items-center justify-between">
          <p className="text-sm text-slate-500 dark:text-slate-400">Step {stepIndex + 1} of {STEPS.length}</p>
          {step !== 'done' && <button type="button" onClick={() => finishSetup(false)} className="text-sm font-medium text-slate-500 underline-offset-4 hover:text-slate-900 hover:underline dark:text-slate-400 dark:hover:text-white">Finish later</button>}
        </div>
        <div className="mx-auto mt-2 h-1 w-full max-w-[640px] overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className="h-full rounded-full bg-[#1E4ED8] transition-all duration-500" style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }} />
        </div>

        <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col justify-center py-10">
          {loading ? <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div> : <>
            {step === 'facility' && (
              <section data-tour-id="setup-facility" className="animate-[auth-form-slide-up_0.4s_ease-out_both]">
                <h1 className="text-[28px] font-semibold tracking-tight text-slate-900 dark:text-white">{firstName ? `Welcome, ${firstName}. ` : ''}Let’s set up your facility</h1>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">This appears on invoices, referrals and the VitaLink Network. Check it’s right.</p>
                <div className="mt-8 grid gap-4 sm:grid-cols-2">
                  <Field label="Facility name" className="sm:col-span-2"><input className={input} value={facility.name} onChange={(e) => setFacility({ ...facility, name: e.target.value })} placeholder="e.g. Lagos Central Hospital" /></Field>
                  <Field label="Address" className="sm:col-span-2"><input className={input} value={facility.address} onChange={(e) => setFacility({ ...facility, address: e.target.value })} placeholder="Street, town" /></Field>
                  <Field label="State">
                    <select className={input} value={facility.state} onChange={(e) => setFacility({ ...facility, state: e.target.value })}>
                      <option value="">Choose a state</option>
                      {[...new Set([...STATES, ...(facility.state && !STATES.includes(facility.state) ? [facility.state] : [])])].map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                  <Field label="Phone"><input className={input} type="tel" value={facility.contactPhone} onChange={(e) => setFacility({ ...facility, contactPhone: e.target.value })} placeholder="0803 000 0000" /></Field>
                  <Field label="Email"><input className={input} type="email" value={facility.contactEmail} onChange={(e) => setFacility({ ...facility, contactEmail: e.target.value })} placeholder="info@hospital.com" /></Field>
                  <Field label="Website (optional)"><input className={input} value={facility.website} onChange={(e) => setFacility({ ...facility, website: e.target.value })} placeholder="https://" /></Field>
                  <Field label="Patients you can see a day (optional)"><input className={input} type="number" min={1} value={facility.maxPatientsPerDay ?? ''} onChange={(e) => setFacility({ ...facility, maxPatientsPerDay: e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : null })} placeholder="No limit" /></Field>
                  <label className="flex items-center gap-3 self-end rounded-xl border border-slate-200 px-3.5 py-3 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
                    <input type="checkbox" className="h-4 w-4 accent-[#1E4ED8]" checked={facility.emergency24x7} onChange={(e) => setFacility({ ...facility, emergency24x7: e.target.checked })} />
                    Open for emergencies 24/7
                  </label>
                </div>
                <div className="mt-10 flex justify-end"><button type="button" className={primary} disabled={busy} onClick={() => void saveFacilityStep()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save and continue<ArrowRight className="h-4 w-4" /></button></div>
              </section>
            )}

            {step === 'departments' && (
              <section data-tour-id="setup-departments" className="animate-[auth-form-slide-up_0.4s_ease-out_both]">
                <h1 className="text-[28px] font-semibold tracking-tight text-slate-900 dark:text-white">Which departments do you have?</h1>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Pick the ones you run. Appointments, staff and reports are grouped by department. You can add rooms, beds and opening hours later.</p>
                {departments.length > 0 && (
                  <div className="mt-6">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Already set up</p>
                    <div className="mt-2 flex flex-wrap gap-2">{departments.map((d) => <span key={d.id} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200"><CheckCircle2 className="h-4 w-4" />{d.name}</span>)}</div>
                  </div>
                )}
                <div className="mt-6 flex flex-wrap gap-2">
                  {SUGGESTED_DEPARTMENTS.filter((name) => !existingNames.has(name.toLowerCase())).map((name) => {
                    const on = picked.includes(name);
                    return <button key={name} type="button" onClick={() => setPicked((current) => (on ? current.filter((n) => n !== name) : [...current, name]))}
                      className={cn('inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition', on ? 'border-[#1E4ED8] bg-[#1E4ED8] text-white' : 'border-slate-200 text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-200')}>
                      {on ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{name}
                    </button>;
                  })}
                </div>
                <Field label="Something else?" className="mt-6"><input className={input} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. Dental clinic" /></Field>
                <div className="mt-10 flex justify-between">
                  <button type="button" className={secondary} onClick={() => setStep('facility')}><ArrowLeft className="h-4 w-4" />Back</button>
                  <button type="button" className={primary} disabled={busy || (!departments.length && !picked.length && !custom.trim())} onClick={() => void saveDepartmentsStep()}>
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}{picked.length || custom.trim() ? `Add ${picked.length + (custom.trim() ? 1 : 0)} and continue` : 'Continue'}<ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </section>
            )}

            {step === 'team' && (
              <section data-tour-id="setup-team" className="animate-[auth-form-slide-up_0.4s_ease-out_both]">
                <h1 className="text-[28px] font-semibold tracking-tight text-slate-900 dark:text-white">Invite your team</h1>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Each person gets an email to join. Their role decides what they can see and do. You can skip this and invite people later from Staff.</p>
                <div className="mt-6 space-y-3">
                  {invites.map((row, index) => (
                    <div key={index} className="grid gap-2 sm:grid-cols-[1fr_170px_170px_auto]">
                      <input className={input} type="email" value={row.email} placeholder="colleague@hospital.com" onChange={(e) => setInvites((rows) => rows.map((r, i) => (i === index ? { ...r, email: e.target.value } : r)))} />
                      <select className={input} value={row.role} onChange={(e) => setInvites((rows) => rows.map((r, i) => (i === index ? { ...r, role: e.target.value as UserRole } : r)))}>
                        {roleOptions.map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}
                      </select>
                      <select className={input} value={row.department} onChange={(e) => setInvites((rows) => rows.map((r, i) => (i === index ? { ...r, department: e.target.value } : r)))}>
                        <option value="">No department</option>
                        {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                      </select>
                      <button type="button" aria-label="Remove" disabled={invites.length === 1} onClick={() => setInvites((rows) => rows.filter((_, i) => i !== index))} className="grid h-11 w-11 place-items-center rounded-xl text-slate-400 hover:bg-slate-50 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-800"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setInvites((rows) => [...rows, { email: '', role: roleOptions[0] ?? 'doctor', department: '' }])} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1E4ED8] hover:underline"><Plus className="h-4 w-4" />Add another</button>
                </div>
                {sent.length > 0 && (
                  <div className="mt-6 space-y-2 rounded-2xl border border-slate-100 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
                    {sent.map((invite) => (
                      <div key={invite.email} className="flex items-center gap-2 text-sm">
                        <Mail className="h-4 w-4 text-emerald-600" />
                        <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{invite.email}</span>
                        <span className="text-xs text-slate-500">{invite.sent ? 'Email sent' : 'Share the link'}</span>
                        {invite.link && <button type="button" onClick={() => copy(invite.link)} className="inline-flex items-center gap-1 text-xs font-medium text-[#1E4ED8] hover:underline"><Copy className="h-3.5 w-3.5" />Copy link</button>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-10 flex flex-wrap justify-between gap-3">
                  <button type="button" className={secondary} onClick={() => setStep('departments')}><ArrowLeft className="h-4 w-4" />Back</button>
                  <div className="flex gap-2">
                    {invites.some((row) => row.email.trim())
                      ? <button type="button" className={primary} disabled={busy} onClick={() => void sendInvites()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Send invitations</button>
                      : <button type="button" className={primary} onClick={() => setStep('network')}>{sent.length ? 'Continue' : 'Skip for now'}<ArrowRight className="h-4 w-4" /></button>}
                  </div>
                </div>
              </section>
            )}

            {step === 'network' && (
              <section data-tour-id="setup-network" className="animate-[auth-form-slide-up_0.4s_ease-out_both]">
                <h1 className="text-[28px] font-semibold tracking-tight text-slate-900 dark:text-white">Join the {BRAND.network}?</h1>
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Connected facilities refer and transfer patients to each other and, with the patient’s consent, share records securely. Only what you enter here is listed; patient data is never public.</p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {([true, false] as const).map((value) => (
                    <button key={String(value)} type="button" onClick={() => setNetwork((n) => ({ ...n, joined: value }))}
                      className={cn('rounded-2xl border p-4 text-left transition', network.joined === value ? 'border-[#1E4ED8] bg-[#1E4ED8]/5 ring-2 ring-[#1E4ED8]/15' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700')}>
                      <span className="block text-sm font-semibold text-slate-900 dark:text-white">{value ? 'Yes, join the network' : 'Not now'}</span>
                      <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{value ? 'Receive referrals and transfers; appear in the facility directory.' : 'You can join any time from VitaLink Network settings.'}</span>
                    </button>
                  ))}
                </div>
                {network.joined && (
                  <div className="mt-6 space-y-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Facility type">
                        <select className={input} value={network.facilityType} onChange={(e) => setNetwork({ ...network, facilityType: e.target.value })}>
                          <option value="">Choose one</option>
                          {FACILITY_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                        </select>
                      </Field>
                      <Field label="Current capacity">
                        <select className={input} value={network.capacity} onChange={(e) => setNetwork({ ...network, capacity: e.target.value as NetworkSettings['capacity'] })}>
                          <option value="available">Taking patients</option>
                          <option value="limited">Limited space</option>
                          <option value="unavailable">Full right now</option>
                          <option value="not_reported">Don’t show</option>
                        </select>
                      </Field>
                      <Field label="City / town"><input className={input} value={network.city} onChange={(e) => setNetwork({ ...network, city: e.target.value })} placeholder="e.g. Ikeja" /></Field>
                      <Field label="State">
                        <select className={input} value={network.state} onChange={(e) => setNetwork({ ...network, state: e.target.value })}>
                          <option value="">Choose a state</option>
                          {[...new Set([...STATES, ...(network.state && !STATES.includes(network.state) ? [network.state] : [])])].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </Field>
                      <Field label="About your facility (optional)" className="sm:col-span-2">
                        <textarea className={cn(input, 'h-20 py-2.5')} value={network.description} maxLength={400} onChange={(e) => setNetwork({ ...network, description: e.target.value })} placeholder="What you’re known for, who you serve" />
                      </Field>
                    </div>
                    <div>
                      <p className="text-[13px] font-medium text-slate-700 dark:text-slate-300">Services</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {SUGGESTED_SERVICES.map((service) => {
                          const on = network.services.includes(service);
                          return <button key={service} type="button" onClick={() => setNetwork((n) => ({ ...n, services: on ? n.services.filter((x) => x !== service) : [...n.services, service] }))}
                            className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition', on ? 'border-[#1E4ED8] bg-[#1E4ED8] text-white' : 'border-slate-200 text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-200')}>
                            {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}{service}
                          </button>;
                        })}
                      </div>
                    </div>
                    <Field label="Specialties (comma separated, optional)"><input className={input} value={specialtiesText} onChange={(e) => setSpecialtiesText(e.target.value)} placeholder="e.g. Cardiology, Obstetrics" /></Field>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {CAPABILITIES.map((c) => (
                        <label key={c.key} className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
                          <input type="checkbox" className="h-4 w-4 accent-[#1E4ED8]" checked={network[c.key]} onChange={(e) => setNetwork({ ...network, [c.key]: e.target.checked })} />{c.label}
                        </label>
                      ))}
                      <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
                        <input type="checkbox" className="h-4 w-4 accent-[#1E4ED8]" checked={network.acceptingReferrals} onChange={(e) => setNetwork({ ...network, acceptingReferrals: e.target.checked })} />Accepting referrals
                      </label>
                      <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-200">
                        <input type="checkbox" className="h-4 w-4 accent-[#1E4ED8]" checked={network.acceptingTransfers} onChange={(e) => setNetwork({ ...network, acceptingTransfers: e.target.checked })} />Accepting transfers
                      </label>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Referral email"><input className={input} type="email" value={network.referralEmail} onChange={(e) => setNetwork({ ...network, referralEmail: e.target.value })} placeholder="referrals@hospital.com" /></Field>
                      <Field label="Referral phone"><input className={input} type="tel" value={network.referralPhone} onChange={(e) => setNetwork({ ...network, referralPhone: e.target.value })} placeholder="0803 000 0000" /></Field>
                    </div>
                    <label className="flex items-start gap-3 rounded-xl bg-slate-50 px-3.5 py-3 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#1E4ED8]" checked={network.visibleInDirectory} onChange={(e) => setNetwork({ ...network, visibleInDirectory: e.target.checked })} />
                      <span><span className="block font-medium">List us in the facility directory</span><span className="text-xs text-slate-500">Other facilities can find you and send referrals. Turn off to only receive referrals from facilities you already work with.</span></span>
                    </label>
                  </div>
                )}
                <div className="mt-10 flex justify-between">
                  <button type="button" className={secondary} onClick={() => setStep('team')}><ArrowLeft className="h-4 w-4" />Back</button>
                  <button type="button" className={primary} disabled={busy} onClick={() => void saveNetworkStep()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{network.joined ? 'Join and continue' : 'Continue'}<ArrowRight className="h-4 w-4" /></button>
                </div>
              </section>
            )}

            {step === 'done' && (
              <section className="animate-[auth-form-slide-up_0.4s_ease-out_both] text-center">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15"><CheckCircle2 className="h-8 w-8" /></div>
                <h1 className="mt-6 text-[28px] font-semibold tracking-tight text-slate-900 dark:text-white">{facility.name || 'Your workspace'} is ready</h1>
                <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
                  {departments.length} department{departments.length === 1 ? '' : 's'} set up{sent.length ? ` and ${sent.length} colleague${sent.length === 1 ? '' : 's'} invited` : ''}. Next, we’ll take two minutes to show you around your dashboard.
                </p>
                <button type="button" className={cn(primary, 'mt-8')} onClick={() => finishSetup(true)}>Go to my dashboard<ArrowRight className="h-4 w-4" /></button>
              </section>
            )}
          </>}
        </div>
      </main>
    </div>
  );
}
