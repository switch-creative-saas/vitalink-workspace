import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, LockKeyhole, Plus, Search, Sun } from 'lucide-react';
import { SButton as Button } from '@/components/standalone/SButton';
import { SSelect as Select } from '@/components/standalone/SSelect';
import { mockFacilities } from '@/data/mockSentinelData';
import { syncLiveSession, useSentinelStore } from '@/store/useSentinelStore';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import {
  AccountExistsError, createOrganization, requestFacilityLink, resendEmailCode, searchVitalinkFacilities, signIn, signUp, verifyEmailCode,
  type SentinelOrgType, type VitalinkFacility,
} from '@/lib/supabase/sentinel';

type AuthMode = 'login' | 'register';
type RegistrationStep = 1 | 2 | 3 | 4;
type Handoff = { email: string; fullName: string; orgName: string; orgType: string; state: string; phone: string; sector: string; joinedNetwork: boolean };

const inputClass = 'sentinel-input h-11 w-full rounded-xl px-3 text-sm';
const focusAreas = ['Malaria', 'Cholera', 'Lassa Fever', 'Measles', 'NTDs', 'Maternal health', 'Tuberculosis', 'Community surveillance'];

function getHandoff(): Handoff | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get('handoff') !== 'true') return null;
  return {
    email: params.get('email') ?? '', fullName: params.get('fullName') ?? '', orgName: params.get('orgName') ?? '',
    orgType: params.get('orgType') ?? 'ngo', state: params.get('state') ?? 'National', phone: params.get('phone') ?? '',
    sector: params.get('sector') ?? 'NGO', joinedNetwork: params.get('joinedNetwork') === 'true',
  };
}

// Registration form values → sentinel_organizations.type
function liveOrgType(value: string): SentinelOrgType {
  const key = value.toLowerCase();
  if (key.includes('ministry')) return 'Ministry';
  if (key.includes('government') || key.includes('agency')) return 'Government';
  if (key.includes('international') || key.includes('who')) return 'International';
  if (key.includes('research')) return 'Research';
  if (key.includes('academic')) return 'Academic';
  return 'NGO';
}

const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

export function LoginPage() {
  const { organizations, login, pendingAccount } = useSentinelStore();
  const handoff = useMemo(() => getHandoff(), []);
  const live = isSupabaseConfigured;
  // Live: signed in already (e.g. stopped half-way through registration) → finish setting up.
  const [mode, setMode] = useState<AuthMode>(handoff || pendingAccount ? 'register' : 'login');
  const [step, setStep] = useState<RegistrationStep>(pendingAccount ? 2 : 1);
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? '');
  const [email, setEmail] = useState(pendingAccount?.email ?? handoff?.email ?? '');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState(pendingAccount?.fullName ?? handoff?.fullName ?? '');
  const [orgName, setOrgName] = useState(handoff?.orgName ?? '');
  const [orgType, setOrgType] = useState(handoff?.orgType ?? 'ngo');
  const [stateName, setStateName] = useState(handoff?.state ?? 'National');
  const [phone, setPhone] = useState(handoff?.phone ?? '');
  const [focus, setFocus] = useState<string[]>([]);
  const [linkedFacilities, setLinkedFacilities] = useState<string[]>([]);
  const [error, setError] = useState('');
  // Live-only state
  const [busy, setBusy] = useState(false);
  const [accountReady, setAccountReady] = useState(Boolean(pendingAccount));
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [code, setCode] = useState('');
  const [codeNotice, setCodeNotice] = useState('');
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);
  const [facilityQuery, setFacilityQuery] = useState('');
  const [liveFacilities, setLiveFacilities] = useState<VitalinkFacility[]>([]);

  const resetError = () => setError('');
  const toggleFocus = (item: string) => setFocus((current) => current.includes(item) ? current.filter((value) => value !== item) : [...current, item]);
  const toggleFacility = (id: string) => setLinkedFacilities((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  // Live step 4: VitaLink facilities this organisation can ask for data.
  useEffect(() => {
    if (!live || step !== 4 || !createdOrgId) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      searchVitalinkFacilities(createdOrgId, facilityQuery).then((rows) => { if (alive) setLiveFacilities(rows); }).catch(() => undefined);
    }, 250);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [live, step, createdOrgId, facilityQuery]);

  // ---------------------------------------------------------------------------
  // Offline demo: accounts kept in this browser only.

  const submitDemoLogin = () => {
    const users = JSON.parse(localStorage.getItem('sentinel_registered_users') ?? '[]') as Array<{ email: string; password: string; organizationId: string }>;
    const user = users.find((item) => item.email.toLowerCase() === email.trim().toLowerCase() && item.password === password);
    if (users.length > 0 && !user) { setError('Invalid email or password.'); return; }
    login(user?.organizationId ?? organizationId);
  };

  const submitDemoRegistration = () => {
    if (!fullName.trim() || !email.trim() || password.length < 8 || !orgName.trim()) { setError('Complete the required fields before continuing.'); return; }
    const users = JSON.parse(localStorage.getItem('sentinel_registered_users') ?? '[]') as Array<{ email: string; password: string; organizationId: string }>;
    if (users.some((item) => item.email.toLowerCase() === email.trim().toLowerCase())) { setError('An account with this email already exists.'); return; }
    const id = `sentinel-org-${Date.now()}`;
    const organization = { id, name: orgName.split(/\s+/).map((word) => word[0]).join('').toUpperCase().slice(0, 4), fullName: orgName, type: orgType, state: stateName || 'National', sector: handoff?.sector ?? 'NGO', contactPhone: phone, joinedNetwork: handoff?.joinedNetwork ?? false, createdAt: new Date().toISOString(), subscriptionTier: 'free' };
    localStorage.setItem('sentinel_registered_users', JSON.stringify([...users, { email: email.trim().toLowerCase(), password, organizationId: id }]));
    localStorage.setItem('sentinel_org', JSON.stringify(organization));
    localStorage.setItem('sentinel_auth', JSON.stringify({ isAuthenticated: true, orgId: id, orgType }));
    localStorage.setItem('sentinel_focus_areas', JSON.stringify(focus));
    localStorage.setItem('sentinel_linked_facilities', JSON.stringify(linkedFacilities.map((facilityId) => ({ facilityId, linkedAt: new Date().toISOString(), dataConsent: true, vitaLinkConnected: true }))));
    window.history.replaceState({}, '', '/');
    window.location.reload();
  };

  // ---------------------------------------------------------------------------
  // Live (Supabase)

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError('');
    try { await action(); } catch (err) { setError(message(err, fallback)); } finally { setBusy(false); }
  };

  const submitLiveLogin = () => run(async () => {
    await signIn(email, password);
    const me = await syncLiveSession();
    // Signed in without a Sentinel organisation yet: carry on with registration.
    if (!me) { setAccountReady(true); setMode('register'); setStep(2); }
  }, 'Sign in failed.');

  const createLiveAccount = () => run(async () => {
    if (!fullName.trim() || !email.trim() || password.length < 8) { setError('Enter your name, work email and a password of at least 8 characters.'); return; }
    try {
      const { needsConfirmation } = await signUp(email, password, fullName);
      if (needsConfirmation) { setAwaitingCode(true); setCodeNotice(`We sent a 6-digit code to ${email.trim()}.`); return; }
      setAccountReady(true);
      setStep(2);
    } catch (err) {
      if (err instanceof AccountExistsError) { setError('An account with this email already exists. Sign in to continue setting up Sentinel.'); return; }
      throw err;
    }
  }, 'Could not create your account.');

  const verifyLiveCode = () => run(async () => {
    await verifyEmailCode(email, code);
    setAwaitingCode(false);
    setAccountReady(true);
    setStep(2);
  }, 'Could not verify the code.');

  const createLiveOrganization = () => run(async () => {
    if (!orgName.trim()) { setError('Enter your organisation name.'); setStep(2); return; }
    const id = await createOrganization({ name: orgName, type: liveOrgType(orgType), state: stateName, contactEmail: email, contactPhone: phone, focusDiseases: focus });
    setCreatedOrgId(id);
    setStep(4);
  }, 'Could not create your organisation.');

  const finishLive = () => run(async () => {
    if (createdOrgId) {
      for (const facilityId of linkedFacilities) await requestFacilityLink(createdOrgId, facilityId);
    }
    window.history.replaceState({}, '', '/');
    await syncLiveSession();
  }, 'Could not finish setting up.');

  const next = () => {
    resetError();
    if (!live) { if (step < 4) setStep((step + 1) as RegistrationStep); else submitDemoRegistration(); return; }
    if (step === 1) { if (accountReady) setStep(2); else if (awaitingCode) void verifyLiveCode(); else void createLiveAccount(); return; }
    if (step === 2) { if (!orgName.trim()) { setError('Enter your organisation name.'); return; } setStep(3); return; }
    if (step === 3) { void createLiveOrganization(); return; }
    void finishLive();
  };
  // Live: the account (step 1) and organisation (step 3) can't be undone by going back.
  const canGoBack = step > 1 && !(live && ((step === 2 && accountReady) || step === 4));

  const renderLogin = () => <>
    <h2 className="text-2xl font-bold text-slate-950 dark:text-white">Sign in</h2>
    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Access your public health intelligence workspace.</p>
    <div className="mt-6 space-y-3">
      {!live && <Select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} className="w-full">{organizations.map((org) => <option key={org.id} value={org.id}>{org.fullName}</option>)}</Select>}
      <input className={inputClass} type="email" autoComplete="email" placeholder="Work email address" value={email} onChange={(event) => setEmail(event.target.value)} />
      <input className={inputClass} type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && email.trim() && password.trim()) { if (live) void submitLiveLogin(); else submitDemoLogin(); } }} />
      <Button className="h-11 w-full" disabled={busy || !email.trim() || !password.trim()} onClick={() => (live ? void submitLiveLogin() : submitDemoLogin())}>{busy ? 'Signing in…' : 'Sign In'}</Button>
    </div>
    <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">Registering a new organization? <button className="font-semibold text-indigo-600 dark:text-indigo-300" onClick={() => { resetError(); setMode('register'); }}>Create Sentinel Workspace</button></p>
  </>;

  const renderLiveFacilities = () => <div>
    <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Ask VitaLink hospitals and clinics to share de-identified disease reports with you. Each facility's admins approve the request in VitaLink. You can add more later.</p>
    <div className="relative mb-3"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className={`${inputClass} pl-9`} placeholder="Search by facility name or state" value={facilityQuery} onChange={(event) => setFacilityQuery(event.target.value)} /></div>
    <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
      {liveFacilities.length === 0 ? <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">No VitaLink facilities match. You can skip this step.</p>
        : liveFacilities.map((facility) => <button key={facility.id} type="button" onClick={() => toggleFacility(facility.id)} className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left ${linkedFacilities.includes(facility.id) ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/15' : 'border-slate-200 dark:border-slate-700'}`}><span><span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{facility.name}</span><span className="text-xs text-slate-500 dark:text-slate-400">{facility.state ?? 'Nigeria'} · VitaLink {facility.type}</span></span>{linkedFacilities.includes(facility.id) && <Check className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />}</button>)}
    </div>
  </div>;

  const renderRegistration = () => <>
    <div className="mb-5 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">Step {step} of 4</p><h2 className="mt-1 text-2xl font-bold text-slate-950 dark:text-white">{step === 1 ? (awaitingCode ? 'Confirm your email' : 'Create your account') : step === 2 ? 'Organization details' : step === 3 ? 'Select focus areas' : 'Link partner facilities'}</h2></div><span className="text-xs text-slate-500 dark:text-slate-400">Sentinel setup</span></div>
    {step === 1 && !awaitingCode && <div className="space-y-3"><input className={inputClass} placeholder="Full name" value={fullName} onChange={(event) => setFullName(event.target.value)} /><input className={inputClass} type="email" autoComplete="email" placeholder="Work email address" value={email} onChange={(event) => setEmail(event.target.value)} /><input className={inputClass} type="password" autoComplete="new-password" placeholder="Create password (min 8 characters)" value={password} onChange={(event) => setPassword(event.target.value)} /></div>}
    {step === 1 && awaitingCode && <div className="space-y-3">
      <p className="text-sm text-slate-500 dark:text-slate-400">{codeNotice} Enter it below to confirm your email.</p>
      <input className={`${inputClass} text-center text-lg tracking-[0.5em]`} inputMode="numeric" maxLength={6} placeholder="••••••" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} />
      <p className="text-xs text-slate-500 dark:text-slate-400">Didn't get it? Check spam, or <button type="button" className="font-semibold text-indigo-600 dark:text-indigo-300" onClick={() => void resendEmailCode(email).then(() => setCodeNotice(`A new code is on its way to ${email.trim()}.`)).catch((err) => setError(message(err, 'Could not resend the code.')))}>send a new code</button>.</p>
    </div>}
    {step === 2 && <div className="grid gap-3 sm:grid-cols-2">{live && accountReady && <p className="text-sm text-slate-500 dark:text-slate-400 sm:col-span-2">Signed in as {email}. Now set up your organization.</p>}<input className={`${inputClass} sm:col-span-2`} placeholder="Organization name" value={orgName} onChange={(event) => setOrgName(event.target.value)} /><Select value={orgType} onChange={(event) => setOrgType(event.target.value)}><option value="ngo">NGO</option><option value="government">Government agency</option><option value="ministry">Ministry of Health</option><option value="international">International organization</option></Select><input className={inputClass} placeholder="State / region" value={stateName} onChange={(event) => setStateName(event.target.value)} /><input className={`${inputClass} sm:col-span-2`} placeholder="Contact phone" value={phone} onChange={(event) => setPhone(event.target.value)} /></div>}
    {step === 3 && <div><p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Choose the programs that should shape your dashboard and alerts.</p><div className="grid grid-cols-2 gap-2">{focusAreas.map((item) => <button key={item} type="button" onClick={() => toggleFocus(item)} className={`rounded-xl border px-3 py-2 text-left text-sm ${focus.includes(item) ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'}`}>{focus.includes(item) ? '✓ ' : ''}{item}</button>)}</div></div>}
    {step === 4 && (live ? renderLiveFacilities() : <div><p className="mb-3 text-sm text-slate-500 dark:text-slate-400">Select reporting facilities that can contribute clinical surveillance data. You can change this later.</p><div className="max-h-64 space-y-2 overflow-y-auto pr-1">{mockFacilities.filter((facility) => facility.type === 'hospital' || facility.type === 'clinic' || facility.type === 'PHC').slice(0, 12).map((facility) => <button key={facility.id} type="button" onClick={() => toggleFacility(facility.id)} className={`flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left ${linkedFacilities.includes(facility.id) ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/15' : 'border-slate-200 dark:border-slate-700'}`}><span><span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{facility.name}</span><span className="text-xs text-slate-500 dark:text-slate-400">{facility.state} · {facility.type}</span></span>{linkedFacilities.includes(facility.id) && <Check className="h-4 w-4 text-indigo-600 dark:text-indigo-300" />}</button>)}</div></div>)}
    {error && <p className="mt-3 text-sm text-red-500">{error}{live && /already exists/.test(error) && <> <button type="button" className="font-semibold text-indigo-600 dark:text-indigo-300" onClick={() => { resetError(); setMode('login'); }}>Sign in</button></>}</p>}
    <div className="mt-5 flex gap-3">{canGoBack && <button type="button" onClick={() => { resetError(); setStep((step - 1) as RegistrationStep); }} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200"><ArrowLeft className="mr-1 inline h-4 w-4" />Back</button>}<Button className="h-11 flex-1" disabled={busy || (awaitingCode && code.length !== 6)} onClick={next}>{busy ? 'Please wait…' : step === 1 && awaitingCode ? 'Confirm email' : live && step === 3 ? 'Create Workspace' : step === 4 ? (live ? (linkedFacilities.length ? `Send ${linkedFacilities.length} request${linkedFacilities.length === 1 ? '' : 's'} & finish` : 'Skip & finish') : 'Create Workspace') : 'Continue'} <ArrowRight className="ml-1 inline h-4 w-4" /></Button></div>
    {mode === 'register' && step === 1 && !awaitingCode && <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">Already have an account? <button className="font-semibold text-indigo-600 dark:text-indigo-300" onClick={() => { resetError(); setMode('login'); }}>Sign in</button></p>}
    {live && <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400"><LockKeyhole className="h-3 w-3" />Sentinel only ever receives de-identified case data.</p>}
  </>;

  return <main className="grid min-h-screen lg:grid-cols-[42%_58%] bg-white text-slate-950 dark:bg-slate-950 dark:text-slate-50">
    <section className="hidden min-h-screen flex-col items-center justify-center bg-[#0F1629] p-12 text-center lg:flex"><div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-2xl"><Plus className="h-8 w-8" /></div><h1 className="mt-6 text-3xl font-bold text-white">VitaLink Sentinel</h1><p className="mt-2 text-sm text-indigo-300">Public Health Intelligence Platform</p><div className="mt-12 space-y-4 text-left text-sm text-indigo-200"><p>◉ Real-time outbreak detection</p><p>◉ Nigeria disease surveillance heatmaps</p><p>◉ NCDC-compatible case reporting</p><p>◉ Partner hospital data integration</p><p>◉ NTD program monitoring</p></div></section>
    <section className="relative flex min-h-screen items-center justify-center overflow-y-auto px-6 py-16 sm:px-10"><button type="button" onClick={() => document.documentElement.classList.toggle('dark')} className="absolute right-6 top-6 rounded-lg border border-slate-200 p-2 text-slate-500 dark:border-slate-800 dark:text-slate-300" title="Toggle theme"><Sun className="h-4 w-4" /></button><div className="w-full max-w-[480px]">{mode === 'login' ? renderLogin() : renderRegistration()}{error && mode === 'login' && <p className="mt-3 text-center text-sm text-red-500">{error}</p>}{mode === 'login' && <p className="mt-10 text-center text-xs text-slate-400">By continuing, you agree to VitaLink's Terms of Service and Privacy Policy.</p>}</div></section>
  </main>;
}
