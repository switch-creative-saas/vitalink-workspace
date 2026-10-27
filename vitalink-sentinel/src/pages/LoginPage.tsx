import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, Eye, EyeOff, Loader2, LockKeyhole, Search } from 'lucide-react';
import { mockFacilities } from '@/data/mockSentinelData';
import { BRAND } from '@/config/brand';
import { syncLiveSession, useSentinelStore } from '@/store/useSentinelStore';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import {
  AccountExistsError, createOrganization, requestFacilityLink, resendEmailCode, searchVitalinkFacilities, signIn, signInWithGoogle, signUp, verifyEmailCode,
  type SentinelOrgType, type VitalinkFacility,
} from '@/lib/supabase/sentinel';

type AuthMode = 'login' | 'register';
type RegistrationStep = 1 | 2 | 3 | 4;
type Handoff = { email: string; fullName: string; orgName: string; orgType: string; state: string; phone: string; sector: string; joinedNetwork: boolean };

// The sign-in card is always dark, whatever the dashboard theme.
const inputClass = 'h-12 w-full rounded-lg border border-white/5 bg-[#2a2838] px-4 text-sm text-white outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/30';
const primaryClass = 'flex h-12 w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-500 text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50';
const linkClass = 'font-medium text-indigo-300 underline underline-offset-4 hover:text-indigo-200';
const optionClass = (selected: boolean) => `rounded-lg border px-3 py-2.5 text-left text-sm transition ${selected ? 'border-indigo-400 bg-indigo-500/15 text-indigo-100' : 'border-white/10 text-slate-300 hover:border-white/20'}`;
const focusAreas = ['Malaria', 'Cholera', 'Lassa Fever', 'Measles', 'NTDs', 'Maternal health', 'Tuberculosis', 'Community surveillance'];
const taglines = ['Seeing outbreaks early, responding together', 'Every case reported, every community protected', 'From facility reports to national response'];
const websiteUrl = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) || BRAND.website;

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

function PasswordField({ value, onChange, placeholder, autoComplete, onEnter }: { value: string; onChange: (value: string) => void; placeholder: string; autoComplete: string; onEnter?: () => void }) {
  const [visible, setVisible] = useState(false);
  return <div className="relative">
    <input className={`${inputClass} pr-12`} type={visible ? 'text' : 'password'} autoComplete={autoComplete} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onEnter?.(); }} />
    <button type="button" onClick={() => setVisible((current) => !current)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-200" aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
  </div>;
}

function GoogleButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return <button type="button" onClick={onClick} disabled={busy} className="flex h-12 w-full items-center justify-center gap-2.5 rounded-lg border border-white/15 text-sm font-medium text-white transition hover:bg-white/5 disabled:opacity-50">
    {busy ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>}
    Google
  </button>;
}

// Original artwork: a surveillance "radar" over a dotted map grid.
function ShowcasePanel() {
  const [slide, setSlide] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSlide((current) => (current + 1) % taglines.length), 6000);
    return () => window.clearInterval(timer);
  }, []);
  const signals = [[118, 210, 7], [262, 150, 5], [310, 318, 9], [176, 392, 6], [388, 236, 4], [228, 268, 11], [96, 330, 4], [352, 420, 5]];
  return <section className="relative hidden overflow-hidden rounded-2xl lg:block">
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 480 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="sentinel-sky" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#312e81" /><stop offset="0.55" stopColor="#1e1b4b" /><stop offset="1" stopColor="#0b0a1f" /></linearGradient>
        <radialGradient id="sentinel-glow" cx="0.48" cy="0.44" r="0.5"><stop offset="0" stopColor="#818cf8" stopOpacity="0.55" /><stop offset="1" stopColor="#818cf8" stopOpacity="0" /></radialGradient>
        <linearGradient id="sentinel-sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#a5b4fc" stopOpacity="0" /><stop offset="1" stopColor="#a5b4fc" stopOpacity="0.35" /></linearGradient>
        <pattern id="sentinel-dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="#c7d2fe" fillOpacity="0.16" /></pattern>
        <linearGradient id="sentinel-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stopColor="#0b0a1f" stopOpacity="0" /><stop offset="1" stopColor="#0b0a1f" stopOpacity="0.9" /></linearGradient>
      </defs>
      <rect width="480" height="640" fill="url(#sentinel-sky)" />
      <rect width="480" height="640" fill="url(#sentinel-dots)" />
      <rect width="480" height="640" fill="url(#sentinel-glow)" />
      <g fill="none" stroke="#a5b4fc">
        {[60, 120, 180, 240, 300].map((radius, index) => <circle key={radius} cx="230" cy="282" r={radius} strokeOpacity={0.32 - index * 0.05} strokeDasharray={index % 2 ? '2 6' : undefined} />)}
        <path d="M230 -20 V600 M-20 282 H500" strokeOpacity="0.12" />
      </g>
      <g className="sentinel-sweep" style={{ transformOrigin: '230px 282px' }}><path d="M230 282 L530 282 A300 300 0 0 0 442 70 Z" fill="url(#sentinel-sweep)" /></g>
      {signals.map(([x, y, size], index) => <g key={index}>
        <circle cx={x} cy={y} r={size * 2.4} fill="#f472b6" fillOpacity="0.12"><animate attributeName="r" values={`${size};${size * 3};${size}`} dur={`${3 + (index % 3)}s`} repeatCount="indefinite" /><animate attributeName="fill-opacity" values="0.3;0;0.3" dur={`${3 + (index % 3)}s`} repeatCount="indefinite" /></circle>
        <circle cx={x} cy={y} r={size / 2.2 + 1.5} fill={size > 8 ? '#f472b6' : '#e0e7ff'} />
      </g>)}
      <rect width="480" height="640" fill="url(#sentinel-fade)" />
    </svg>
    <div className="relative flex h-full flex-col justify-between p-7">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5"><img src="/sentinel-logo.svg" alt="" className="h-9 w-9 rounded-lg bg-white p-0.5" /><span className="text-lg font-bold tracking-tight text-white">Sentinel</span></div>
        <a href={websiteUrl} className="flex items-center gap-1 rounded-full bg-white/10 px-4 py-2 text-xs font-medium text-white backdrop-blur transition hover:bg-white/20">Back to website <ArrowUpRight className="h-3.5 w-3.5" /></a>
      </div>
      <div className="text-center">
        <p key={slide} className="sentinel-fade-in mx-auto max-w-xs text-2xl font-semibold leading-snug text-white">{taglines[slide]}</p>
        <div className="mt-6 flex justify-center gap-2">{taglines.map((tagline, index) => <button key={tagline} type="button" onClick={() => setSlide(index)} aria-label={`Show message ${index + 1}`} className={`h-1 rounded-full transition-all ${index === slide ? 'w-8 bg-white' : 'w-5 bg-white/30 hover:bg-white/50'}`} />)}</div>
      </div>
    </div>
  </section>;
}

export function LoginPage() {
  const { organizations, login, pendingAccount } = useSentinelStore();
  const handoff = useMemo(() => getHandoff(), []);
  const live = isSupabaseConfigured;
  const initialName = (pendingAccount?.fullName ?? handoff?.fullName ?? '').trim();
  // Live: signed in already (e.g. stopped half-way through registration) → finish setting up.
  const [mode, setMode] = useState<AuthMode>(handoff || pendingAccount ? 'register' : 'login');
  const [step, setStep] = useState<RegistrationStep>(pendingAccount ? 2 : 1);
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? '');
  const [email, setEmail] = useState(pendingAccount?.email ?? handoff?.email ?? '');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState(initialName.split(/\s+/)[0] ?? '');
  const [lastName, setLastName] = useState(initialName.split(/\s+/).slice(1).join(' '));
  const [agreed, setAgreed] = useState(false);
  const [orgName, setOrgName] = useState(handoff?.orgName ?? '');
  const [orgType, setOrgType] = useState(handoff?.orgType ?? 'ngo');
  const [stateName, setStateName] = useState(handoff?.state ?? 'National');
  const [phone, setPhone] = useState(handoff?.phone ?? '');
  const [focus, setFocus] = useState<string[]>([]);
  const [linkedFacilities, setLinkedFacilities] = useState<string[]>([]);
  const [error, setError] = useState('');
  // Live-only state
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [accountReady, setAccountReady] = useState(Boolean(pendingAccount));
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [code, setCode] = useState('');
  const [codeNotice, setCodeNotice] = useState('');
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);
  const [facilityQuery, setFacilityQuery] = useState('');
  const [liveFacilities, setLiveFacilities] = useState<VitalinkFacility[]>([]);

  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();
  const resetError = () => setError('');
  const switchMode = (value: AuthMode) => { resetError(); setMode(value); };
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
    if (!fullName || !email.trim() || password.length < 8 || !orgName.trim()) { setError('Complete the required fields before continuing.'); return; }
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

  // Leaves the page for Google; the store picks the session up on return.
  const continueWithGoogle = async () => {
    if (!live) { setError('Google sign-in needs the live Sentinel backend.'); return; }
    setGoogleBusy(true);
    setError('');
    try { await signInWithGoogle(); } catch (err) { setError(message(err, 'Could not start Google sign-in.')); setGoogleBusy(false); }
  };

  const createLiveAccount = () => run(async () => {
    if (!fullName || !email.trim() || password.length < 8) { setError('Enter your name, work email and a password of at least 8 characters.'); return; }
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
    if (step === 1 && !awaitingCode && !accountReady && !agreed) { setError('Agree to the Terms & Conditions to create your account.'); return; }
    if (!live) { if (step < 4) setStep((step + 1) as RegistrationStep); else submitDemoRegistration(); return; }
    if (step === 1) { if (accountReady) setStep(2); else if (awaitingCode) void verifyLiveCode(); else void createLiveAccount(); return; }
    if (step === 2) { if (!orgName.trim()) { setError('Enter your organisation name.'); return; } setStep(3); return; }
    if (step === 3) { void createLiveOrganization(); return; }
    void finishLive();
  };
  // Live: the account (step 1) and organisation (step 3) can't be undone by going back.
  const canGoBack = step > 1 && !(live && ((step === 2 && accountReady) || step === 4));
  const submitLogin = () => { if (!email.trim() || !password.trim()) return; if (live) void submitLiveLogin(); else submitDemoLogin(); };

  const divider = (label: string) => <div className="my-6 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-white/10" />{label}<span className="h-px flex-1 bg-white/10" /></div>;
  const errorLine = error && <p className="mt-4 text-sm text-rose-400">{error}{live && /already exists/.test(error) && <> <button type="button" className={linkClass} onClick={() => switchMode('login')}>Sign in</button></>}</p>;

  const renderLogin = () => <>
    <h1 className="text-4xl font-semibold tracking-tight text-white">Welcome back</h1>
    <p className="mt-3 text-sm text-slate-400">New to Sentinel? <button type="button" className={linkClass} onClick={() => { switchMode('register'); setStep(1); }}>Create an account</button></p>
    <div className="mt-9 space-y-4">
      {!live && <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} className={inputClass}>{organizations.map((org) => <option key={org.id} value={org.id}>{org.fullName}</option>)}</select>}
      <input className={inputClass} type="email" autoComplete="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
      <PasswordField value={password} onChange={setPassword} autoComplete="current-password" placeholder="Enter your password" onEnter={submitLogin} />
    </div>
    <button type="button" className={`${primaryClass} mt-7`} disabled={busy || !email.trim() || !password.trim()} onClick={submitLogin}>{busy ? 'Signing in…' : 'Sign in'}</button>
    {errorLine}
    {divider('Or sign in with')}
    <GoogleButton onClick={() => void continueWithGoogle()} busy={googleBusy} />
  </>;

  const renderAccountStep = () => awaitingCode ? <div className="space-y-4">
    <p className="text-sm text-slate-400">{codeNotice} Enter it below to confirm your email.</p>
    <input className={`${inputClass} text-center text-lg tracking-[0.5em]`} inputMode="numeric" maxLength={6} placeholder="••••••" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} onKeyDown={(event) => { if (event.key === 'Enter' && code.length === 6) next(); }} />
    <p className="text-xs text-slate-400">Didn't get it? Check spam, or <button type="button" className={linkClass} onClick={() => void resendEmailCode(email).then(() => setCodeNotice(`A new code is on its way to ${email.trim()}.`)).catch((err) => setError(message(err, 'Could not resend the code.')))}>send a new code</button>.</p>
  </div> : <div className="space-y-4">
    <div className="grid gap-4 sm:grid-cols-2"><input className={inputClass} autoComplete="given-name" placeholder="First name" value={firstName} onChange={(event) => setFirstName(event.target.value)} /><input className={inputClass} autoComplete="family-name" placeholder="Last name" value={lastName} onChange={(event) => setLastName(event.target.value)} /></div>
    <input className={inputClass} type="email" autoComplete="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
    <PasswordField value={password} onChange={setPassword} autoComplete="new-password" placeholder="Enter your password" />
    <label className="flex cursor-pointer items-center gap-3 pt-1 text-sm text-slate-300">
      <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} className="peer sr-only" />
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-white/25 bg-[#2a2838] transition peer-checked:border-indigo-400 peer-checked:bg-indigo-500 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400">{agreed && <Check className="h-3.5 w-3.5 text-white" />}</span>
      <span>I agree to the <a href={`${BRAND.website}/terms`} target="_blank" rel="noreferrer" className={linkClass}>Terms &amp; Conditions</a></span>
    </label>
  </div>;

  const facilityRow = (id: string, name: string, detail: string) => <button key={id} type="button" onClick={() => toggleFacility(id)} className={`flex w-full items-center justify-between ${optionClass(linkedFacilities.includes(id))}`}><span><span className="block font-semibold text-white">{name}</span><span className="text-xs text-slate-400">{detail}</span></span>{linkedFacilities.includes(id) && <Check className="h-4 w-4 text-indigo-300" />}</button>;

  const renderFacilities = () => live ? <div>
    <p className="mb-4 text-sm text-slate-400">Ask VitaLink hospitals and clinics to share de-identified disease reports with you. Each facility's admins approve the request in VitaLink. You can add more later.</p>
    <div className="relative mb-3"><Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className={`${inputClass} pl-10`} placeholder="Search by facility name or state" value={facilityQuery} onChange={(event) => setFacilityQuery(event.target.value)} /></div>
    <div className="sentinel-auth-scroll max-h-60 space-y-2 overflow-y-auto pr-1">
      {liveFacilities.length === 0 ? <p className="rounded-lg border border-dashed border-white/15 p-4 text-center text-sm text-slate-400">No VitaLink facilities match. You can skip this step.</p>
        : liveFacilities.map((facility) => facilityRow(facility.id, facility.name, `${facility.state ?? 'Nigeria'} · VitaLink ${facility.type}`))}
    </div>
  </div> : <div>
    <p className="mb-4 text-sm text-slate-400">Select reporting facilities that can contribute clinical surveillance data. You can change this later.</p>
    <div className="sentinel-auth-scroll max-h-60 space-y-2 overflow-y-auto pr-1">{mockFacilities.filter((facility) => facility.type === 'hospital' || facility.type === 'clinic' || facility.type === 'PHC').slice(0, 12).map((facility) => facilityRow(facility.id, facility.name, `${facility.state} · ${facility.type}`))}</div>
  </div>;

  const stepTitle = step === 1 ? (awaitingCode ? 'Confirm your email' : 'Create an account') : step === 2 ? 'Your organisation' : step === 3 ? 'Focus areas' : 'Partner facilities';
  const actionLabel = busy ? 'Please wait…' : step === 1 ? (awaitingCode ? 'Confirm email' : accountReady ? 'Continue' : 'Create account') : live && step === 3 ? 'Create workspace' : step === 4 ? (live ? (linkedFacilities.length ? `Send ${linkedFacilities.length} request${linkedFacilities.length === 1 ? '' : 's'} & finish` : 'Skip & finish') : 'Create workspace') : 'Continue';

  const renderRegistration = () => <>
    {step > 1 && <div className="mb-5 flex gap-1.5">{[1, 2, 3, 4].map((value) => <span key={value} className={`h-1 flex-1 rounded-full ${value <= step ? 'bg-indigo-400' : 'bg-white/10'}`} />)}</div>}
    <h1 className="text-4xl font-semibold tracking-tight text-white">{stepTitle}</h1>
    {step === 1 && !awaitingCode && <p className="mt-3 text-sm text-slate-400">Already have an account? <button type="button" className={linkClass} onClick={() => switchMode('login')}>Log in</button></p>}
    {step === 2 && <p className="mt-3 text-sm text-slate-400">{live && accountReady ? `Signed in as ${email}. ` : ''}Tell us who you report for.</p>}
    {step === 3 && <p className="mt-3 text-sm text-slate-400">Choose the programmes that should shape your dashboard and alerts.</p>}
    <div className="mt-9">
      {step === 1 && renderAccountStep()}
      {step === 2 && <div className="grid gap-4 sm:grid-cols-2">
        <input className={`${inputClass} sm:col-span-2`} placeholder="Organisation name" value={orgName} onChange={(event) => setOrgName(event.target.value)} />
        <select value={orgType} onChange={(event) => setOrgType(event.target.value)} className={inputClass}><option value="ngo">NGO</option><option value="government">Government agency</option><option value="ministry">Ministry of Health</option><option value="international">International organisation</option></select>
        <input className={inputClass} placeholder="State / region" value={stateName} onChange={(event) => setStateName(event.target.value)} />
        <input className={`${inputClass} sm:col-span-2`} type="tel" placeholder="Contact phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
      </div>}
      {step === 3 && <div className="grid grid-cols-2 gap-2">{focusAreas.map((item) => <button key={item} type="button" onClick={() => toggleFocus(item)} className={`flex items-center justify-between ${optionClass(focus.includes(item))}`}>{item}{focus.includes(item) && <Check className="h-4 w-4 text-indigo-300" />}</button>)}</div>}
      {step === 4 && renderFacilities()}
    </div>
    <div className="mt-7 flex gap-3">
      {canGoBack && <button type="button" onClick={() => { resetError(); setStep((step - 1) as RegistrationStep); }} className="flex h-12 items-center gap-1 rounded-lg border border-white/15 px-5 text-sm font-medium text-slate-200 transition hover:bg-white/5"><ArrowLeft className="h-4 w-4" />Back</button>}
      <button type="button" className={primaryClass} disabled={busy || (awaitingCode && code.length !== 6)} onClick={next}>{actionLabel}{step > 1 && !busy && <ArrowRight className="h-4 w-4" />}</button>
    </div>
    {errorLine}
    {step === 1 && !awaitingCode && !accountReady && <>{divider('Or register with')}<GoogleButton onClick={() => void continueWithGoogle()} busy={googleBusy} /></>}
    {live && step > 1 && <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-500"><LockKeyhole className="h-3 w-3" />Sentinel only ever receives de-identified case data.</p>}
  </>;

  return <main className="min-h-screen bg-[#1c1a27]">
    <div className="grid min-h-screen w-full gap-3 lg:grid-cols-2 lg:p-3">
      <ShowcasePanel />
      <section className="flex items-center justify-center px-5 py-10 sm:px-10 lg:px-14">
        <div className="w-full max-w-[460px]">
          <div className="mb-8 flex items-center justify-between lg:hidden"><div className="flex items-center gap-2"><img src="/sentinel-logo.svg" alt="" className="h-8 w-8 rounded-lg bg-white p-0.5" /><span className="font-bold text-white">Sentinel</span></div><a href={websiteUrl} className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white">Website <ArrowUpRight className="h-3 w-3" /></a></div>
          {mode === 'login' ? renderLogin() : renderRegistration()}
        </div>
      </section>
    </div>
  </main>;
}
