import type { UserRole } from '@/contexts/AuthContext';
import type { User } from '@supabase/supabase-js';
import type { OrganizationType } from '@/lib/workspace/organizationTypes';
import { requireSupabase, functionErrorMessage, storedSessionUser } from './client';
import { offlineUserId, wipeOfflineData } from '@/lib/offline/sync';

// Google only for now; Microsoft and Apple can be added back when they're configured in Supabase.
export type OAuthProvider = 'google';
export type BillingCycle = 'monthly' | 'annual';

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  organization_type: OrganizationType;
  workspace_type: 'healthcare' | 'public-health';
  sector: string | null;
  state: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  joined_network: boolean;
  subscription_tier: 'free' | 'standard' | 'premium';
  created_at: string;
}

export interface WorkspaceMembership {
  role: UserRole;
  organization: OrganizationRow;
}

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
}

function toSessionUser(user: User): SessionUser {
  // Email signups set full_name; Google/Microsoft/Apple provide name.
  const meta = user.user_metadata ?? {};
  return { id: user.id, email: user.email ?? '', fullName: (meta.full_name ?? meta.name ?? '') as string };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const { data, error } = await requireSupabase().auth.getUser();
  if (data.user) return toSessionUser(data.user);
  // Offline: keep the person signed in on a device they already used online,
  // where their encrypted offline data is still present.
  const unreachable = !navigator.onLine || error?.name === 'AuthRetryableFetchError';
  const stored = unreachable ? storedSessionUser() : null;
  if (stored && stored.id === (await offlineUserId())) return toSessionUser(stored as User);
  return null;
}

export async function signIn(email: string, password: string): Promise<SessionUser> {
  const { data, error } = await requireSupabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
  return toSessionUser(data.user);
}

/** Redirects to the provider; on return the gateway's session check picks the user up. */
export async function signInWithProvider(provider: OAuthProvider, returnPath: string) {
  const { error } = await requireSupabase().auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}${returnPath}`,
    },
  });
  if (error) throw error;
}

/** Starts signup; Supabase emails a 6-digit code (the "Confirm signup" template must use {{ .Token }}). */
export async function signUp(email: string, password: string, fullName: string, returnPath = '/register') {
  const { data, error } = await requireSupabase().auth.signUp({
    email,
    password,
    // If the email template sends a link, bring the user back here rather than to the project's Site URL.
    options: { data: { full_name: fullName }, emailRedirectTo: `${window.location.origin}${returnPath}` },
  });
  if (error) throw error;
  // Supabase returns a user with no identities when the email is already registered.
  if (data.user && data.user.identities?.length === 0) throw new Error('An account with this email already exists.');
}

export async function verifySignupCode(email: string, token: string) {
  const { error } = await requireSupabase().auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
}

export async function resendSignupCode(email: string) {
  const { error } = await requireSupabase().auth.resend({ type: 'signup', email });
  if (error) throw error;
}

export async function sendPasswordReset(email: string) {
  const { error } = await requireSupabase().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
  if (error) throw error;
}

export async function updatePassword(password: string) {
  const { error } = await requireSupabase().auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut() {
  // Logged first, while the session can still write to the audit trail.
  await requireSupabase().rpc('security_log_event', { p_action: 'sign_out' }).then(() => undefined, () => undefined);
  // This device only. Supabase's default ('global') would end every session the user has,
  // so an idle sign-out on one computer would sign them out everywhere.
  await requireSupabase().auth.signOut({ scope: 'local' });
  return wipeOfflineData();
}

export function onPasswordRecovery(callback: () => void) {
  const { data } = requireSupabase().auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') callback();
  });
  return () => data.subscription.unsubscribe();
}

export function onSignedIn(callback: () => void) {
  const { data } = requireSupabase().auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_IN') callback();
  });
  return () => data.subscription.unsubscribe();
}

export async function listMemberships(userId: string): Promise<WorkspaceMembership[]> {
  const { data, error } = await requireSupabase()
    .from('memberships')
    .select('role, organization:organizations(*)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as WorkspaceMembership[];
}

export async function createWorkspace(params: {
  name: string;
  slug: string;
  organizationType: OrganizationType;
  state?: string;
  contactPhone?: string;
  joinedNetwork?: boolean;
  planId: string;
  billingCycle: BillingCycle;
}): Promise<OrganizationRow> {
  const { data, error } = await requireSupabase().rpc('create_workspace', {
    p_name: params.name,
    p_slug: params.slug,
    p_organization_type: params.organizationType,
    p_state: params.state ?? null,
    p_contact_phone: params.contactPhone ?? null,
    p_joined_network: params.joinedNetwork ?? false,
    p_plan_id: params.planId,
    p_billing_cycle: params.billingCycle,
  });
  if (error) throw error;
  return data as OrganizationRow;
}

export async function isSlugAvailable(slug: string): Promise<boolean> {
  const { data, error } = await requireSupabase().rpc('is_slug_available', { p_slug: slug });
  if (error) throw error;
  return Boolean(data);
}

export interface WorkspaceSubscription {
  planId: string;
  billingCycle: BillingCycle;
  status: 'active' | 'trialing' | 'pending_payment' | 'past_due' | 'cancelled' | 'comped';
  currentPeriodEnd: string | null;
  /** The plan the workspace can use right now (Free until a paid plan is paid for). */
  effectivePlanId: string;
  modules: string[];
  planName: string;
}

export async function getSubscription(organizationId: string): Promise<WorkspaceSubscription | null> {
  const db = requireSupabase();
  const { data, error } = await db
    .from('subscriptions')
    .select('plan_id, billing_cycle, status, current_period_end')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const graceOk = !data.current_period_end || new Date(data.current_period_end).getTime() > Date.now() - 3 * 86_400_000;
  const trialOk = data.status === 'trialing' && !!data.current_period_end && new Date(data.current_period_end).getTime() > Date.now();
  const effectivePlanId = data.status === 'comped' || trialOk || (data.status === 'active' && graceOk) ? data.plan_id : 'free';
  const { data: plan } = await db.from('plans').select('name, modules').eq('id', effectivePlanId).single();
  return {
    planId: data.plan_id,
    billingCycle: data.billing_cycle,
    status: data.status,
    currentPeriodEnd: data.current_period_end,
    effectivePlanId,
    modules: (plan?.modules as string[] | undefined) ?? [],
    planName: (plan?.name as string | undefined) ?? 'Free',
  };
}

export async function amIPlatformAdmin(): Promise<boolean> {
  const { data } = await requireSupabase().rpc('am_i_platform_admin');
  return Boolean(data);
}

async function invokeCheckout<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke('paystack-checkout', { body });
  if (error) {
    // Surface the function's own error message instead of the generic one.
    throw new Error(await functionErrorMessage(error));
  }
  return data as T;
}

/** Returns a Paystack URL to redirect to, or { comped: true } for platform admins. */
export function startCheckout(organizationId: string, planId: string, billingCycle: BillingCycle) {
  return invokeCheckout<{ authorizationUrl?: string; reference?: string; comped?: boolean }>({
    action: 'initialize',
    organizationId,
    planId,
    billingCycle,
    callbackUrl: `${window.location.origin}/payment-callback`,
  });
}

export function verifyPayment(reference: string) {
  return invokeCheckout<{ outcome: 'activated' | 'already_applied' | 'not_successful' | 'unknown_reference'; kind?: 'plan' | 'addon' }>({ action: 'verify', reference });
}
