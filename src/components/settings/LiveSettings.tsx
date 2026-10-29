// Settings for live workspaces: your profile and photo, sign-in email and
// password, appearance that follows you between devices, which notifications
// you get, and your place in the workspace. Everything saves to Supabase.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell, Building2, Camera, Check, ChevronRight, KeyRound, Laptop, Loader2, LogOut, Mail, Moon, Monitor, Palette, Save, Send, Shield, Sun, Trash2, User,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TotpSetup } from '@/components/auth/MfaGate';
import { forgetTrustedDevice, getMfaStatus, listTotpFactors, listTrustedDevices, removeTotpFactor, type MfaStatus, type TotpFactor, type TrustedDevice } from '@/lib/supabase/mfa';
import { useAuth } from '@/contexts/AuthContext';
import { useGuidedTour } from '@/contexts/GuidedTourContext';
import { WELCOME_TOUR_ID } from '@/lib/tours/workspaceTours';
import { usePlan } from '@/hooks/usePlan';
import { initialsOf, useMyProfile } from '@/hooks/useMyProfile';
import { applyFontScale, applyTheme, getSavedTheme, type ThemeMode } from '@/lib/theme';
import { workspaceDescriptor } from '@/lib/workspace/workspace';
import {
  NOTIFICATION_KINDS, changeEmail, changePassword, removeAvatar, sendTestNotification, updateMyProfile, uploadAvatar, type MyProfile,
} from '@/lib/supabase/profile';
import { revokeAllSessions } from '@/lib/supabase/security';

const TABS = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'security', label: 'Sign-in & Security', icon: Shield },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'workspace', label: 'Workspace', icon: Building2 },
] as const;
type Tab = (typeof TABS)[number]['id'];

const go = (detail: { page?: string; path?: string }) => window.dispatchEvent(new CustomEvent('app:navigate', { detail }));
const roleLabel = (role: string) => role.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LiveSettings({ onLogout }: { onLogout: () => void }) {
  const profile = useMyProfile();
  const [tab, setTab] = useState<Tab>(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    return TABS.some((t) => t.id === requested) ? (requested as Tab) : 'profile';
  });

  // Links like /settings?tab=notifications (bell, profile menu) switch tabs while already here.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path ?? '';
      const requested = path.startsWith('/settings') ? new URLSearchParams(path.split('?')[1] ?? '').get('tab') : null;
      if (requested && TABS.some((t) => t.id === requested)) setTab(requested as Tab);
    };
    window.addEventListener('app:navigate', onNavigate);
    return () => window.removeEventListener('app:navigate', onNavigate);
  }, []);

  return (
    <div className="space-y-6 page-transition">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Your profile, sign-in, appearance and notifications.</p>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <nav data-tour-id="settings-tabs" className="premium-card h-fit p-2 lg:col-span-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={cn('flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium', tab === t.id ? 'bg-royal-50 text-royal-700' : 'text-gray-600 hover:bg-gray-50')}>
              <t.icon className="h-5 w-5 shrink-0" /><span className="truncate">{t.label}</span>
              <ChevronRight className={cn('ml-auto h-4 w-4 shrink-0', tab === t.id && 'rotate-90')} />
            </button>
          ))}
        </nav>
        <div className="min-w-0 space-y-6 lg:col-span-3">
          {!profile ? <div className="premium-card p-8 text-center text-sm text-gray-500">Loading your settings…</div> : (
            <>
              {tab === 'profile' && <ProfileTab profile={profile} />}
              {tab === 'security' && <SecurityTab profile={profile} onLogout={onLogout} />}
              {tab === 'appearance' && <AppearanceTab profile={profile} />}
              {tab === 'notifications' && <NotificationsTab profile={profile} />}
              {tab === 'workspace' && <WorkspaceTab />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="premium-card space-y-4 p-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------

function ProfileTab({ profile }: { profile: MyProfile }) {
  const { currentRole, organization } = useAuth();
  const [form, setForm] = useState({ fullName: profile.fullName, phone: profile.phone, jobTitle: profile.jobTitle });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirty = form.fullName !== profile.fullName || form.phone !== profile.phone || form.jobTitle !== profile.jobTitle;

  const save = async () => {
    if (form.fullName.trim().length < 2) { toast.error('Enter your full name'); return; }
    setBusy(true);
    try { await updateMyProfile(profile.id, form); toast.success('Profile saved'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not save your profile'); }
    finally { setBusy(false); }
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try { await uploadAvatar(profile.id, file); toast.success('Photo updated'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Upload failed'); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ''; }
  };

  return (
    <Section title="Profile" description="How colleagues see you across VitaLink.">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative">
          {profile.avatarUrl
            ? <img src={profile.avatarUrl} alt="" className="h-20 w-20 rounded-2xl object-cover" />
            : <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-vitalink-600 to-vitalink-700 text-2xl font-bold text-white">{initialsOf(profile.fullName || profile.email)}</div>}
          {uploading && <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40"><Loader2 className="h-5 w-5 animate-spin text-white" /></div>}
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold text-gray-900">{profile.fullName || profile.email}</p>
          <p className="text-sm text-gray-500">{roleLabel(currentRole)} · {organization.name}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileInput.current?.click()}><Camera className="mr-2 h-4 w-4" />{profile.avatarUrl ? 'Change photo' : 'Add photo'}</Button>
            {profile.avatarUrl && <Button size="sm" variant="outline" disabled={uploading} onClick={() => void removeAvatar(profile.id).then(() => toast.success('Photo removed'))}>Remove</Button>}
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void onPhoto(e.target.files?.[0])} />
          </div>
          <p className="mt-1 text-xs text-gray-400">PNG, JPG or WebP, up to 2 MB.</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div><Label htmlFor="name">Full name</Label><Input id="name" className="mt-1" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
        <div><Label htmlFor="title">Job title or specialty</Label><Input id="title" className="mt-1" placeholder="e.g. Consultant Paediatrician" value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} /></div>
        <div><Label htmlFor="phone">Phone</Label><Input id="phone" className="mt-1" placeholder="+234 …" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        <div><Label>Email</Label><Input className="mt-1" value={profile.email} readOnly disabled /><p className="mt-1 text-xs text-gray-400">Change it under Sign-in & Security.</p></div>
      </div>
      <div className="flex justify-end">
        <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save profile
        </Button>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------

function SecurityTab({ profile, onLogout }: { profile: MyProfile; onLogout: () => void }) {
  const { organization } = useAuth();
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<'pw' | 'email' | 'sessions' | null>(null);

  const strong = pw.next.length >= 8 && /[A-Za-z]/.test(pw.next) && /\d/.test(pw.next);
  const savePassword = async () => {
    if (!strong) { toast.error('Use at least 8 characters with letters and numbers'); return; }
    if (pw.next !== pw.confirm) { toast.error('The new passwords don\'t match'); return; }
    setBusy('pw');
    try { await changePassword(profile.email, pw.current, pw.next); setPw({ current: '', next: '', confirm: '' }); toast.success('Password changed'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not change your password'); }
    finally { setBusy(null); }
  };
  const saveEmail = async () => {
    if (!EMAIL.test(email.trim())) { toast.error('Enter a valid email address'); return; }
    if (email.trim().toLowerCase() === profile.email.toLowerCase()) { toast.error('That is already your email'); return; }
    setBusy('email');
    try { await changeEmail(email); toast.success(`Check ${email.trim()} and click the link to confirm the change.`); setEmail(''); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not change your email'); }
    finally { setBusy(null); }
  };
  const signOutOthers = async () => {
    setBusy('sessions');
    try { const n = await revokeAllSessions(organization.id, 'mine'); toast.success(n ? `Signed out of ${n} other device${n === 1 ? '' : 's'}` : 'You were not signed in anywhere else'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not sign out other devices'); }
    finally { setBusy(null); }
  };

  return (
    <>
      <Section title="Change password" description="You'll stay signed in on this device.">
        <div className="grid gap-4 md:grid-cols-3">
          <div><Label htmlFor="pw-current">Current password</Label><Input id="pw-current" type="password" autoComplete="current-password" className="mt-1" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></div>
          <div><Label htmlFor="pw-next">New password</Label><Input id="pw-next" type="password" autoComplete="new-password" className="mt-1" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></div>
          <div><Label htmlFor="pw-confirm">Confirm new password</Label><Input id="pw-confirm" type="password" autoComplete="new-password" className="mt-1" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></div>
        </div>
        <p className={cn('text-xs', pw.next && !strong ? 'text-amber-700' : 'text-gray-400')}>At least 8 characters, with letters and numbers.</p>
        <div className="flex justify-end">
          <Button className="bg-gradient-to-r from-royal-500 to-royal-700 text-white" disabled={busy !== null || !pw.current || !pw.next || !pw.confirm} onClick={() => void savePassword()}>
            {busy === 'pw' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}Change password
          </Button>
        </div>
      </Section>

      <TwoStepSection />

      <Section title="Sign-in email" description={`You sign in as ${profile.email}. We send a confirmation link to the new address; the change applies once you click it.`}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input type="email" placeholder="New email address" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button variant="outline" disabled={busy !== null || !email} onClick={() => void saveEmail()}>
            {busy === 'email' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}Send confirmation
          </Button>
        </div>
      </Section>

      <Section title="Devices" description="Sign out everywhere except this device if you used a shared or lost computer.">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy !== null} onClick={() => void signOutOthers()}>
            {busy === 'sessions' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Monitor className="mr-2 h-4 w-4" />}Sign out my other devices
          </Button>
          <Button variant="outline" onClick={() => go({ page: 'audit-logs' })}><Shield className="mr-2 h-4 w-4" />See all sessions</Button>
          <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50" onClick={onLogout}><LogOut className="mr-2 h-4 w-4" />Sign out</Button>
        </div>
      </Section>

      <Section title="Delete account" description="Your account is linked to clinical records and the audit trail, so deletion is handled by VitaLink Support to keep those records intact.">
        <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50" onClick={() => go({ page: 'help' })}><Trash2 className="mr-2 h-4 w-4" />Request account deletion</Button>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

const THEMES: Array<{ id: ThemeMode; label: string; icon: React.ElementType }> = [
  { id: 'light', label: 'Light', icon: Sun }, { id: 'dark', label: 'Dark', icon: Moon }, { id: 'system', label: 'Match device', icon: Laptop },
];
const SIZES = [{ value: 90, label: 'Small' }, { value: 100, label: 'Default' }, { value: 110, label: 'Large' }, { value: 120, label: 'Larger' }];

/** Two-step verification: required for admin, clinical and VitaLink roles; optional for everyone else. */
function TwoStepSection() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [settingUp, setSettingUp] = useState(false);
  const load = useCallback(() => {
    Promise.all([getMfaStatus(), listTotpFactors(), listTrustedDevices().catch(() => [])])
      .then(([s, f, d]) => { setStatus(s); setFactors(f); setDevices(d); })
      .catch(() => setStatus(null));
  }, []);
  const forget = async (device: TrustedDevice) => {
    try { await forgetTrustedDevice(device); toast.success(device.thisDevice ? 'This browser will ask for a code next sign-in' : `${device.label} forgotten`); load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not forget the device'); }
  };
  useEffect(() => { const t = window.setTimeout(load, 0); return () => window.clearTimeout(t); }, [load]);

  const remove = async (factor: TotpFactor) => {
    const last = factors.length === 1;
    if (last && status?.required) { toast.error('Your role requires two-step verification. Set up a new authenticator first, then remove this one.'); return; }
    if (!window.confirm(last ? 'Turn off two-step verification? Your account will be protected by your password only.' : `Remove ${factor.name}?`)) return;
    try { await removeTotpFactor(factor.id); toast.success(last ? 'Two-step verification turned off' : 'Authenticator removed'); load(); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not remove it'); }
  };

  return (
    <Section title="Two-step verification" description={status?.required
      ? 'Required for your role: signing in needs your password and a code from your authenticator app.'
      : 'Adds a code from your phone to your password, so a stolen password alone can’t open your account.'}>
      {status === null ? <p className="text-sm text-gray-500">Loading…</p> : settingUp ? (
        <div className="space-y-3">
          <TotpSetup onDone={() => { setSettingUp(false); load(); }} />
          <Button variant="outline" size="sm" onClick={() => setSettingUp(false)}>Cancel</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm">
            <span className={cn('h-2.5 w-2.5 rounded-full', factors.length ? 'bg-emerald-500' : 'bg-amber-500')} />
            {factors.length ? 'On' : 'Off'}{status.required && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700">Required for your role</span>}
          </p>
          {factors.map((f) => (
            <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
              <span>Authenticator app <span className="text-xs text-gray-500">· added {new Date(f.createdAt).toLocaleDateString()}</span></span>
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => void remove(f)}>Remove</Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setSettingUp(true)}>{factors.length ? 'Add or replace authenticator' : 'Set up two-step verification'}</Button>
          {factors.length > 0 && (
            <div className="space-y-2 pt-2">
              <p className="text-sm font-medium text-gray-900">Remembered devices</p>
              <p className="text-xs text-gray-500">Signing in on these skips the code until the device goes 14 days unused (at most 30 days). Forget any you don’t recognise or no longer use.</p>
              {devices.length === 0 && <p className="text-xs text-gray-500">None yet.</p>}
              {devices.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    {d.label}{d.thisDevice && <span className="ml-1.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">this browser</span>}
                    <span className="block text-xs text-gray-500">Last used {new Date(d.lastSeenAt).toLocaleDateString()} · code asked again after {new Date(d.expiresAt).toLocaleDateString()} if unused</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => void forget(d)}>Forget</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function AppearanceTab({ profile }: { profile: MyProfile }) {
  const { offerPageTours, setOfferPageTours, startTour, resetProgress } = useGuidedTour();
  const [theme, setTheme] = useState<ThemeMode>(() => getSavedTheme());
  const [size, setSize] = useState(profile.preferences.fontScale ?? 100);

  const persist = (patch: MyProfile['preferences']) =>
    updateMyProfile(profile.id, { preferences: { ...profile.preferences, ...patch } }).catch(() => toast.error('Saved on this device only; could not sync.'));

  const pickTheme = (mode: ThemeMode) => { setTheme(mode); applyTheme(mode); void persist({ theme: mode }); };
  const pickSize = (value: number) => { setSize(value); applyFontScale(value); void persist({ fontScale: value }); };

  return (
    <>
      <Section title="Theme" description="Saved to your account, so it follows you to other devices.">
        <div className="grid gap-3 sm:grid-cols-3">
          {THEMES.map((t) => (
            <button key={t.id} onClick={() => pickTheme(t.id)}
              className={cn('flex items-center gap-2 rounded-2xl border p-4 text-left', theme === t.id ? 'border-royal-400 ring-2 ring-royal-200' : 'border-gray-200 hover:border-gray-300')}>
              <t.icon className="h-4 w-4 text-royal-600" /><span className="font-medium text-gray-900">{t.label}</span>
              {theme === t.id && <Check className="ml-auto h-4 w-4 text-royal-600" />}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Text size" description="Makes all text in VitaLink larger or smaller.">
        <div className="flex flex-wrap gap-2">
          {SIZES.map((s) => (
            <Button key={s.value} variant={size === s.value ? 'default' : 'outline'} className={size === s.value ? 'bg-royal-600 text-white' : ''} onClick={() => pickSize(s.value)}>{s.label}</Button>
          ))}
        </div>
      </Section>
      <Section title="Guided tours" description="Short walkthroughs of each page. All tours are listed under Help & Support.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-3 text-sm text-gray-800"><Switch checked={offerPageTours} onCheckedChange={setOfferPageTours} />Offer a tour the first time I open a page</label>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => startTour(WELCOME_TOUR_ID)}>Replay getting started</Button>
            <Button variant="outline" size="sm" onClick={() => void resetProgress().then(() => toast.success('Tour progress cleared. Tours will be offered again.'))}>Start tours over</Button>
          </div>
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------

function NotificationsTab({ profile }: { profile: MyProfile }) {
  const { organization, currentRole } = useAuth();
  const [prefs, setPrefs] = useState<Record<string, boolean>>(profile.notificationPrefs);
  const [testing, setTesting] = useState(false);
  const isAdmin = ['super-admin', 'hospital-admin', 'ngo-admin', 'government-admin'].includes(currentRole);

  const toggle = (key: string, on: boolean) => {
    const next = { ...prefs, [key]: on };
    setPrefs(next);
    updateMyProfile(profile.id, { notificationPrefs: next }).catch((error) => { setPrefs(prefs); toast.error(error instanceof Error ? error.message : 'Could not save'); });
  };
  const test = async () => {
    setTesting(true);
    try { await sendTestNotification(organization.id); toast.success('Sent. Check the bell at the top of the page.'); }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Could not send a test'); }
    finally { setTesting(false); }
  };

  return (
    <>
      <Section title="In-app notifications" description="Shown in the bell at the top of every page as they happen. Changes save immediately.">
        <div className="divide-y divide-gray-100">
          {NOTIFICATION_KINDS.map((k) => (
            <label key={k.id} className="flex items-center justify-between gap-4 py-3">
              <span><span className="block text-sm font-medium text-gray-900">{k.label}</span><span className="text-xs text-gray-500">{k.description}</span></span>
              <Switch checked={prefs[k.id] !== false} onCheckedChange={(on) => toggle(k.id, on)} />
            </label>
          ))}
        </div>
        <Button variant="outline" size="sm" disabled={testing} onClick={() => void test()}><Send className="mr-2 h-4 w-4" />Send a test notification</Button>
      </Section>
      {isAdmin && (
        <Section title="Email" description="Emails that go to workspace admins.">
          <label className="flex items-center justify-between gap-4">
            <span><span className="block text-sm font-medium text-gray-900">VitaLink Network emails</span><span className="text-xs text-gray-500">Incoming referrals and updates on transfers</span></span>
            <Switch checked={prefs.email_network !== false} onCheckedChange={(on) => toggle('email_network', on)} />
          </label>
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function WorkspaceTab() {
  const { organization, currentRole, workspaceType } = useAuth();
  const { plan } = usePlan();
  const isAdmin = ['super-admin', 'hospital-admin', 'ngo-admin', 'government-admin'].includes(currentRole);
  return (
    <Section title={organization.name} description={workspaceDescriptor(organization)}>
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-xl bg-gray-50 p-3"><p className="text-xs text-gray-500">Your role</p><p className="font-medium text-gray-900">{roleLabel(currentRole)}</p></div>
        <div className="rounded-xl bg-gray-50 p-3"><p className="text-xs text-gray-500">Plan</p><p className="font-medium capitalize text-gray-900">{plan?.tierName ?? '—'}</p></div>
        <div className="rounded-xl bg-gray-50 p-3"><p className="text-xs text-gray-500">Type</p><p className="font-medium capitalize text-gray-900">{workspaceType.replace('-', ' ')}</p></div>
      </div>
      {isAdmin ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => go({ path: '/administration' })}><Building2 className="mr-2 h-4 w-4" />Facility profile & departments</Button>
          <Button variant="outline" onClick={() => go({ page: 'subscription' })}>Plan & billing</Button>
          <Button variant="outline" onClick={() => go({ page: 'audit-logs' })}><Shield className="mr-2 h-4 w-4" />Security policy</Button>
        </div>
      ) : <p className="text-sm text-gray-500">Workspace settings are managed by your admins.</p>}
    </Section>
  );
}
