// Two-step verification (TOTP authenticator apps) on Supabase Auth.
//
// Optional for workspace staff (the app shows a standing reminder until it's set up, see
// <MfaReminder />); required for VitaLink platform admins. For people who use it, the code is asked
// at the point of need, not at sign-in: the first time they open patient records
// (ensureRecordAccess, called by record pages), and again when they come back after 30 minutes
// away. The database enforces the first part: until the session is verified (aal2) or on a
// remembered browser, clinical records stay closed (private.records_ok). The console still asks
// at sign-in (waitForMfa('console')). <MfaGate /> collects the code.
//
// A browser where a code was entered is remembered: later sign-ins there skip the code until the
// device goes 14 days unused (or 30 days after it was first trusted). Only a hash of the device
// token is stored on the server.
import { requireSupabase } from './client';

export type MfaNeed = 'none' | 'challenge' | 'enroll';
/** Why the code is being asked for: signing in (console), opening records, or coming back after a break. */
export type MfaReason = 'signin' | 'records' | 'idle';

export interface MfaStatus { required: boolean; recommended: boolean; enrolled: boolean; recordsUnlocked: boolean; aal: 'aal1' | 'aal2' }

/** Fired on window whenever this user's two-step setup changes (turned on or off). */
export const MFA_CHANGED_EVENT = 'vitalink:mfa-changed';
const announceChange = () => window.dispatchEvent(new Event(MFA_CHANGED_EVENT));
export interface TotpFactor { id: string; name: string; createdAt: string }
export interface TotpEnrollment { factorId: string; qrCode: string; secret: string }

const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

export async function getMfaStatus(): Promise<MfaStatus> {
  const { data, error } = await requireSupabase().rpc('mfa_status');
  if (error) throw new Error(error.message);
  return data as MfaStatus;
}

/**
 * What this session still needs before loading data. Workspace sign-in ('signin') needs nothing
 * more (records ask later), except that VitaLink platform admins must have it set up; a remembered
 * browser is checked so records open without a code. The console ('console') needs the code now.
 */
export async function mfaNeed(scope: 'signin' | 'console' = 'signin'): Promise<MfaNeed> {
  const db = requireSupabase();
  if (scope === 'signin') {
    const token = await storedDeviceToken();
    if (token) await db.rpc('mfa_check_device', { p_token: token }).then(() => undefined, () => undefined);
    const status = await getMfaStatus().catch(() => null);
    return status?.required && !status.enrolled ? 'enroll' : 'none';
  }
  const { data, error } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return 'none';
  const token = await storedDeviceToken();
  if (data.currentLevel === 'aal2') {
    // Verified here: keep this browser remembered while it's in use (or remember it now).
    if (token) void db.rpc('mfa_check_device', { p_token: token });
    else if (data.nextLevel === 'aal2') void rememberThisDevice().catch(() => undefined);
    return 'none';
  }
  if (data.nextLevel === 'aal2') {
    // A remembered browser vouches for this sign-in, so no code is needed.
    if (token) {
      const { data: trusted } = await db.rpc('mfa_check_device', { p_token: token });
      if (trusted === true) return 'none';
    }
    return 'challenge';
  }
  const status = await getMfaStatus().catch(() => null);
  return status?.required ? 'enroll' : 'none';
}

export async function listTotpFactors(): Promise<TotpFactor[]> {
  const { data, error } = await requireSupabase().auth.mfa.listFactors();
  if (error) throw new Error(error.message);
  return (data?.totp ?? []).filter((f) => f.status === 'verified')
    .map((f) => ({ id: f.id, name: f.friendly_name ?? 'Authenticator app', createdAt: f.created_at }));
}

/** Starts enrolment: returns the QR code and setup key to put in the authenticator app. */
export async function startTotpEnrollment(): Promise<TotpEnrollment> {
  const db = requireSupabase();
  // Abandoned set-ups block a new one with the same name; clear them first.
  const { data: existing } = await db.auth.mfa.listFactors();
  for (const factor of existing?.all ?? []) {
    if (factor.factor_type === 'totp' && factor.status !== 'verified') await db.auth.mfa.unenroll({ factorId: factor.id }).catch(() => undefined);
  }
  const { data, error } = await db.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16).replace('T', ' ')}` });
  if (error || !data) throw new Error(message(error, 'Could not start two-step verification'));
  const raw = data.totp.qr_code;
  const qrCode = raw.startsWith('data:') ? raw : `data:image/svg+xml;utf-8,${encodeURIComponent(raw)}`;
  return { factorId: data.id, qrCode, secret: data.totp.secret };
}

/** Confirms a code from the app; the session becomes verified (aal2) and this browser is remembered. */
export async function verifyTotp(factorId: string, code: string) {
  const { error } = await requireSupabase().auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
  if (error) throw new Error(/invalid|expired/i.test(error.message) ? 'That code didn’t match. Check the time on your phone and try the newest code.' : error.message);
  await rememberThisDevice().catch(() => undefined);
  announceChange();
}

// ---------------------------------------------------------------------------
// Remembered devices

const deviceKey = (userId: string) => `vitalink-trusted-device:${userId}`;

async function currentUserId() {
  return (await requireSupabase().auth.getSession()).data.session?.user.id ?? null;
}

async function storedDeviceToken(): Promise<string | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  try { return localStorage.getItem(deviceKey(userId)); } catch { return null; }
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'device';
  return `${browser} on ${os}`;
}

/** Called after a code is accepted: this browser skips the code on later sign-ins for a while. */
export async function rememberThisDevice() {
  const userId = await currentUserId();
  if (!userId) return;
  let token: string | null = null;
  try { token = localStorage.getItem(deviceKey(userId)); } catch { /* storage blocked: just don't remember */ }
  if (!token) token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  const { error } = await requireSupabase().rpc('mfa_trust_device', { p_token: token, p_label: deviceLabel() });
  if (error) throw new Error(error.message);
  try { localStorage.setItem(deviceKey(userId), token); } catch { /* not remembered */ }
}

export interface TrustedDevice { id: string; label: string; lastSeenAt: string; expiresAt: string; thisDevice: boolean }

export async function listTrustedDevices(): Promise<TrustedDevice[]> {
  const { data, error } = await requireSupabase().rpc('mfa_devices', { p_token: await storedDeviceToken() });
  if (error) throw new Error(error.message);
  return (data as Array<{ id: string; label: string; last_seen_at: string; expires_at: string; this_device: boolean }>)
    .map((d) => ({ id: d.id, label: d.label, lastSeenAt: d.last_seen_at, expiresAt: d.expires_at, thisDevice: d.this_device }));
}

/** Stops a device skipping the code; for this browser the local token is cleared too. */
export async function forgetTrustedDevice(device: TrustedDevice) {
  const { error } = await requireSupabase().rpc('mfa_forget_device', { p_id: device.id });
  if (error) throw new Error(error.message);
  if (device.thisDevice) {
    const userId = await currentUserId();
    if (userId) try { localStorage.removeItem(deviceKey(userId)); } catch { /* ignore */ }
  }
}

/** Verifies this session with the user's (first) authenticator app. */
export async function verifySignInCode(code: string) {
  const factors = await listTotpFactors();
  if (!factors.length) throw new Error('No authenticator app is set up for this account.');
  await verifyTotp(factors[0].id, code);
}

export async function removeTotpFactor(factorId: string) {
  const { error } = await requireSupabase().auth.mfa.unenroll({ factorId });
  if (error) throw new Error(error.message);
  announceChange();
}

/** Workspace admins: clears a staff member's authenticator so they can set it up again (lost phone). */
export async function resetMemberMfa(membershipId: string) {
  const { error } = await requireSupabase().rpc('mfa_reset_member', { p_membership_id: membershipId });
  if (error) throw new Error(error.message);
}

/** VitaLink platform admins (console): clears any account's authenticator by email. */
export async function resetMfaByEmail(email: string) {
  const { data, error } = await requireSupabase().rpc('console_reset_mfa', { p_email: email.trim() });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

// ---------------------------------------------------------------------------
// Coordination between sign-in flows and the <MfaGate /> overlay.

type Waiter = { resolve: () => void; reject: (error: Error) => void };
const waiters: Waiter[] = [];
const listeners = new Set<(need: MfaNeed, reason: MfaReason) => void>();
let showing: { need: MfaNeed; reason: MfaReason } | null = null;

export function onMfaRequest(listener: (need: MfaNeed, reason: MfaReason) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function ask(need: MfaNeed, reason: MfaReason): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    waiters.push({ resolve, reject });
    // An idle prompt already on screen also covers a record page opening underneath it.
    if (!showing || (showing.reason === 'idle' && reason !== 'idle')) {
      showing = { need, reason: showing?.reason === 'idle' ? 'idle' : reason };
      listeners.forEach((listener) => listener(need, showing!.reason));
    }
  });
}

/**
 * Resolves once this session may load workspace data: at once if nothing more is needed,
 * otherwise after the user completes the step shown by <MfaGate />. Rejects if they sign out.
 */
export async function waitForMfa(scope: 'signin' | 'console' = 'signin'): Promise<void> {
  const need = await mfaNeed(scope);
  if (need === 'none') return;
  return ask(need, 'signin');
}

/** Fired on window when patient records were unlocked (the code was entered). */
export const RECORDS_UNLOCKED_EVENT = 'vitalink:records-unlocked';
/** Fired on window when someone chose "Not now" instead of entering the code. */
export const RECORDS_DECLINED_EVENT = 'vitalink:records-declined';

export function finishMfa() {
  idleLocked = false;
  markActive();
  showing = null;
  waiters.splice(0).forEach((w) => w.resolve());
  listeners.forEach((listener) => listener('none', 'signin'));
  window.dispatchEvent(new Event(RECORDS_UNLOCKED_EVENT));
}

export function cancelMfa(reason: 'signed-out' | 'declined' = 'signed-out') {
  showing = null;
  waiters.splice(0).forEach((w) => w.reject(new Error(reason === 'declined' ? 'Not verified' : 'Signed out')));
  listeners.forEach((listener) => listener('none', 'signin'));
  if (reason === 'declined') window.dispatchEvent(new Event(RECORDS_DECLINED_EVENT));
}

// ---------------------------------------------------------------------------
// Patient records: the code once per sign-in, and again after a long break.

const IDLE_MS = 30 * 60_000;
const ACTIVE_KEY = 'vitalink-last-active';
let idleLocked = false;
let lastActive = Date.now();

function markActive() {
  lastActive = Date.now();
  try { localStorage.setItem(ACTIVE_KEY, String(lastActive)); } catch { /* storage blocked */ }
}

/** Does opening patient records need the code now? Never offline (it can't be checked there). */
export async function recordsNeedCode(): Promise<boolean> {
  if (!navigator.onLine) return false;
  const status = await getMfaStatus().catch(() => null);
  if (!status?.enrolled) return false;
  return idleLocked || !status.recordsUnlocked;
}

/** Called by pages that show patient records. Resolves when they may load; rejects on "Not now". */
export async function ensureRecordAccess(): Promise<void> {
  if (!(await recordsNeedCode())) return;
  return ask('challenge', idleLocked ? 'idle' : 'records');
}

/**
 * Watches for use of the app (signed-in workspace only). Coming back after 30 minutes or more
 * asks for the code again, straight away, for people who use two-step verification.
 * Returns a stop function.
 */
export function startIdleWatch(): () => void {
  try {
    const saved = Number(localStorage.getItem(ACTIVE_KEY));
    if (saved && Date.now() - saved > IDLE_MS) idleLocked = true;
  } catch { /* storage blocked */ }
  markActive();
  let throttle = 0;
  const activity = () => {
    const now = Date.now();
    if (now - throttle < 5000) return;
    throttle = now;
    const away = now - lastActive > IDLE_MS;
    markActive();
    if (!away) return;
    idleLocked = true;
    void getMfaStatus().then((status) => { if (status.enrolled && navigator.onLine) void ask('challenge', 'idle').catch(() => undefined); }).catch(() => undefined);
  };
  const visible = () => { if (!document.hidden) activity(); };
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
  events.forEach((e) => window.addEventListener(e, activity, { passive: true }));
  document.addEventListener('visibilitychange', visible);
  // Opened after a long break (or the app was closed): ask once the workspace has loaded.
  if (idleLocked) void getMfaStatus().then((status) => { if (status.enrolled && navigator.onLine) void ask('challenge', 'idle').catch(() => undefined); }).catch(() => undefined);
  return () => {
    events.forEach((e) => window.removeEventListener(e, activity));
    document.removeEventListener('visibilitychange', visible);
  };
}
