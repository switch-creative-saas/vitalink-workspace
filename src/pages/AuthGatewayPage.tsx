import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { AuthLayout } from '@/components/auth/AuthLayout';
import {
  GoogleButton,
  AuthDivider
} from '@/components/auth/SocialButtons';
import { AuthField, AuthPrimaryButton, TrustIndicator } from '@/components/auth/AuthForm';
import { LegalLink } from '@/components/auth/LegalLink';
import { markWorkspaceSetupPending } from '@/lib/workspace/setup';
import { FooterLinks } from '@/components/auth/FooterLinks';
import { EnterpriseSubscription } from '@/components/auth/EnterpriseSubscription';
import { ProvisioningScreen } from '@/components/auth/ProvisioningScreen';
import { OTPInput } from '@/components/auth/OTPInput';
import { WorkspaceURLPicker } from '@/components/auth/WorkspaceURLPicker';
import type { PageType } from '@/types';
import type { UserRole } from '@/contexts/AuthContext';
import { useSecurityAudit } from '@/contexts/SecurityAuditContext';
import { BRAND } from '@/config/brand';
import { mockNetworkService } from '@/features/network/services/networkService';
import type { CapacityStatus } from '@/features/network/types';
import {
  ORGANIZATION_TYPE_OPTIONS,
  createOrganizationProfile,
  normalizeOrganizationType,
  organizationTypeLabel,
  sectorForOrganizationType,
  workspaceForOrganizationType,
  workspaceLabel,
  type OrganizationProfile,
  type WorkspaceType,
} from '@/lib/workspace/organizationTypes';
import { defaultPageForWorkspace } from '@/lib/workspace/workspace';
import { PUBLIC_HEALTH_ROLES, WORKSPACE_OWNER_ROLE } from '@/lib/workspace/roles';
import { AlertCircle, ArrowLeft, ArrowRight, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import * as backend from '@/lib/supabase/auth';
import { acceptInvitation, getInvitation, roleLabel, type InvitationPreview } from '@/lib/supabase/staff';
import { syncWorkspacePlan } from '@/lib/workspace/planSync';
import { waitForMfa } from '@/lib/supabase/mfa';

type Stage =
  | 'checking-session'
  | 'login'
  | 'org-signup-start'
  | 'org-signup-details'
  | 'org-info'
  | 'subscription'
  | 'workspace-url'
  | 'verify-email'
  | 'provisioning'
  | 'welcome'
  | 'forgot-password'
  | 'reset-password'
  | 'email-sent'
  | 'workspace-select'
  | 'accept-invite';

type AuthUser = {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  passwordHash?: string;
  provider: 'email' | 'google';
  onboardingComplete: boolean;
  tenantId?: string;
  orgSlug?: string;
  orgName?: string;
  organizationType?: string;
  workspaceType?: WorkspaceType;
  orgSector?: string;
  orgState?: string;
  orgContactPhone?: string;
  joinedNetwork?: boolean;
  orgCreatedAt?: string;
  subscriptionTier?: 'free' | 'standard' | 'premium';
};

interface AuthGatewayPageProps {
  onAuthenticated: (payload: { role: UserRole; name: string; email: string; redirectPage: PageType; organization: OrganizationProfile }) => void;
  defaultTheme?: 'light' | 'dark';
}

function usersKey() { return 'vitalink-auth-users'; }
function sessionKey() { return 'vitalink-auth-session'; }

async function hashPassword(raw: string): Promise<string> {
  if (window.crypto?.subtle) {
    const encoded = new TextEncoder().encode(raw);
    const digest = await window.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return btoa(raw);
}

function organizationForUser(user: AuthUser): OrganizationProfile {
  const inferredType = user.organizationType ?? (PUBLIC_HEALTH_ROLES.includes(user.role) ? 'ngo' : undefined);
  const organizationType = normalizeOrganizationType(inferredType);
  return createOrganizationProfile({
    id: user.tenantId ?? user.orgSlug ?? user.id,
    name: user.orgName ?? user.orgSlug,
    slug: user.orgSlug,
    organizationType,
    workspaceType: user.workspaceType ?? workspaceForOrganizationType(organizationType),
    sector: user.orgSector ?? sectorForOrganizationType(organizationType),
    state: user.orgState,
    contactEmail: user.email,
    contactPhone: user.orgContactPhone,
    joinedNetwork: user.joinedNetwork,
    createdAt: user.orgCreatedAt,
    subscriptionTier: user.subscriptionTier,
  });
}

function roleRedirect(user: AuthUser): PageType {
  return defaultPageForWorkspace(organizationForUser(user).workspaceType);
}

function membershipToAuthUser(sessionUser: backend.SessionUser, membership: backend.WorkspaceMembership): AuthUser {
  const org = membership.organization;
  return {
    id: `${sessionUser.id}:${org.id}`,
    fullName: sessionUser.fullName || sessionUser.email,
    email: sessionUser.email,
    role: membership.role,
    provider: 'email',
    onboardingComplete: true,
    tenantId: org.id,
    orgSlug: org.slug,
    orgName: org.name,
    organizationType: org.organization_type,
    workspaceType: org.workspace_type,
    orgSector: org.sector ?? undefined,
    orgState: org.state ?? undefined,
    orgContactPhone: org.contact_phone ?? undefined,
    joinedNetwork: org.joined_network,
    orgCreatedAt: org.created_at,
    subscriptionTier: org.subscription_tier,
  };
}


function backendErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  if (/invalid login credentials/i.test(message)) return 'Invalid credentials';
  if (/email not confirmed/i.test(message)) return 'Please verify your email before signing in.';
  if (/organizations_slug_key|duplicate key/i.test(message)) return 'That workspace URL is already taken. Choose another.';
  if (/token has expired|otp.*invalid/i.test(message)) return 'That code is invalid or has expired.';
  return message || fallback;
}

function ErrorText({ text }: { text: string }) {
  return (
    <div className="rounded-[14px] bg-red-500/10 border border-red-500/20 px-4 py-3 text-[14px] text-red-400 flex items-start gap-2 animate-[auth-form-slide-up_0.3s_ease-out_both] mb-6">
      <AlertCircle className="w-5 h-5 mt-0.5 shrink-0" />
      {text}
    </div>
  );
}

// ── Session Check Loading Screen ─────────────────────────────────────
function SessionCheckScreen() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--auth-bg,#0B0617)] transition-colors">
      <img
        src="/vitalink-logo.png"
        alt="VitaLink"
        className="h-10 w-auto invert opacity-90 mb-6 animate-pulse"
      />
      <p className="text-sm text-gray-400 mb-6">Signing you in...</p>
      <div className="auth-progress-bar w-48 rounded-full overflow-hidden">
        <div className="auth-progress-indicator rounded-full" />
      </div>
    </div>
  );
}

// ── Workspace Subdomain & Path Detection ──────────────────────────────
function getActiveSlugFromURL(): string | null {
  const host = window.location.hostname;
  const path = window.location.pathname;

  // Case 1: Subdomain detection (e.g., lagosgeneral.vitalink.africa or lagosgeneral.localhost)
  const hostParts = host.split('.');
  if (hostParts.length > 1) {
    const sub = hostParts[0].toLowerCase();
    if (!['www', 'app', 'api', 'auth', 'vitalink', 'localhost', '127', '0'].includes(sub)) {
      return sub;
    }
  }

  // Case 2: Subfolder fallback detection (e.g., app.vitalink.africa/lagosgeneral)
  const pathParts = path.split('/').filter(Boolean);
  if (pathParts.length > 0) {
    const firstSegment = pathParts[0].toLowerCase();
    const excludedRoutes = [
      'login', 'register', 'dashboard', 'patient-identity', 'patients', 'emr',
      'telemedicine', 'ai-clinical-intelligence', 'switch-network', 'appointments',
      'laboratory', 'pharmacy', 'billing', 'analytics', 'switch-sentinel',
      'human-resources', 'administration', 'subscription', 'audit-logs', 'settings', 'help',
      'payment-callback', 'reset-password', 'invite'
    ];
    if (!excludedRoutes.includes(firstSegment)) {
      return firstSegment;
    }
  }

  return null;
}

function getOrgFromSlug(slug: string): string | null {
  try {
    const raw = localStorage.getItem('vitalink-auth-users');
    if (!raw) return null;
    const users = JSON.parse(raw) as AuthUser[];
    const match = users.find(u => u.orgSlug === slug);
    return match ? (match.orgName || match.orgSlug || null) : null;
  } catch {
    return null;
  }
}

export function AuthGatewayPage({ onAuthenticated }: AuthGatewayPageProps) {
  const { logLoginAttempt } = useSecurityAudit();
  const onAuthenticatedRef = useRef(onAuthenticated);
  const [stage, setStage] = useState<Stage>('checking-session');
  const [loading, setLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [authError, setAuthError] = useState('');

  const [pendingUser, setPendingUser] = useState<AuthUser | null>(null);

  // ── Staff invitation (/invite?token=...) ──────────────────────────
  const inviteToken = new URLSearchParams(window.location.search).get('token') ?? '';
  const [invite, setInvite] = useState<InvitationPreview | null | 'missing'>(null);
  const [inviteSessionEmail, setInviteSessionEmail] = useState<string | null>(null);
  const [inviteMode, setInviteMode] = useState<'signin' | 'signup'>('signin');
  const [inviteForm, setInviteForm] = useState({ fullName: '', password: '' });
  // After "Create account & join": Supabase emails a 6-digit code to confirm the address.
  const [inviteAwaitingCode, setInviteAwaitingCode] = useState(false);

  async function loadInvite() {
    try {
      const [preview, sessionUser] = await Promise.all([getInvitation(inviteToken), backend.getSessionUser()]);
      setInvite(preview ?? 'missing');
      setInviteSessionEmail(sessionUser?.email ?? null);
    } catch {
      setInvite('missing');
    }
  }

  const joinInvitedWorkspace = async () => {
    if (!invite || invite === 'missing') return;
    setAuthError('');
    setLoading(true);
    try {
      await acceptInvitation(inviteToken);
      localStorage.setItem('vitalink-last-workspace', invite.organizationSlug);
      toast.success(`Welcome to ${invite.organizationName}`);
      window.location.replace('/'); // session restore opens the new workspace
    } catch (error) {
      setAuthError(backendErrorMessage(error, 'Could not accept the invitation.'));
      setLoading(false);
    }
  };

  const signInForInvite = async () => {
    if (!invite || invite === 'missing') return;
    setAuthError('');
    setLoading(true);
    try {
      await backend.signIn(invite.email, inviteForm.password);
    } catch (error) {
      setLoading(false);
      // Created the account earlier but never entered the code: send a fresh one.
      if (/email not confirmed/i.test(error instanceof Error ? error.message : '')) {
        await backend.resendSignupCode(invite.email).catch(() => undefined);
        setInviteAwaitingCode(true);
        return;
      }
      return setAuthError(backendErrorMessage(error, 'Sign in failed.'));
    }
    await joinInvitedWorkspace();
  };

  const signUpForInvite = async () => {
    if (!invite || invite === 'missing') return;
    setAuthError('');
    if (!inviteForm.fullName.trim()) return setAuthError('Enter your full name.');
    if (inviteForm.password.length < 8) return setAuthError('Password must be at least 8 characters.');
    setLoading(true);
    try {
      await backend.signUp(invite.email, inviteForm.password, inviteForm.fullName.trim(), `/invite?token=${encodeURIComponent(inviteToken)}`);
      setInviteAwaitingCode(true);
    } catch (error) {
      setAuthError(backendErrorMessage(error, 'Could not create your account.'));
    } finally {
      setLoading(false);
    }
  };

  // Confirms the emailed code (which signs the new account in), then joins the workspace.
  const verifyInviteCode = async (code: string) => {
    if (!invite || invite === 'missing' || code.length !== 6) return;
    setAuthError('');
    setLoading(true);
    try {
      await backend.verifySignupCode(invite.email, code);
    } catch (error) {
      setLoading(false);
      return setAuthError(backendErrorMessage(error, 'That code is wrong or has expired. Check the latest email or send a new code.'));
    }
    await joinInvitedWorkspace();
  };

  const resendInviteCode = async () => {
    if (!invite || invite === 'missing') return;
    setAuthError('');
    try {
      await backend.resendSignupCode(invite.email);
      toast.success(`A new code is on its way to ${invite.email}.`);
    } catch (error) {
      setAuthError(backendErrorMessage(error, 'Could not resend the code.'));
    }
  };

  const signOutForInvite = async () => {
    await backend.signOut();
    setInviteSessionEmail(null);
  };
  const [pendingUsers, setPendingUsers] = useState<AuthUser[]>([]);
  const [detectedOrgName, setDetectedOrgName] = useState<string | null>(null);
  const [showEnterpriseEnquiry, setShowEnterpriseEnquiry] = useState(false);
  const [enterpriseEnquiry, setEnterpriseEnquiry] = useState({ name: '', email: '', organization: '', requirements: '' });

  useEffect(() => {
    onAuthenticatedRef.current = onAuthenticated;
  }, [onAuthenticated]);

  // ── Mount: Check for existing session ─────────────────────────────
  useEffect(() => {
    // Detect URL workspace slug
    const urlSlug = getActiveSlugFromURL();
    if (urlSlug) {
      const name = getOrgFromSlug(urlSlug);
      setDetectedOrgName(name || urlSlug.toUpperCase());
    }

    const isRegisterPath = window.location.pathname.replace(/\/+$/, '') === '/register';

    if (isSupabaseConfigured) {
      if (window.location.pathname.replace(/\/+$/, '') === '/invite') {
        setStage('accept-invite');
        void loadInvite();
        return;
      }
      if (window.location.pathname.replace(/\/+$/, '') === '/reset-password') {
        setStage('reset-password');
        return backend.onPasswordRecovery(() => setStage('reset-password'));
      }
      let cancelled = false;
      (async () => {
        try {
          // Also covers returning from the email confirmation link, which lands with a fresh session.
          const sessionUser = await backend.getSessionUser();
          if (!sessionUser) throw new Error('no session');
          // Two-step verification comes before any workspace data (the database requires it).
          await waitForMfa();
          if (window.location.pathname.replace(/\/+$/, '') === '/payment-callback') {
            const reference = new URLSearchParams(window.location.search).get('reference');
            window.history.replaceState({}, '', '/');
            if (reference) {
              try {
                const { outcome, kind } = await backend.verifyPayment(reference);
                const paid = outcome === 'activated' || outcome === 'already_applied';
                if (kind === 'addon') {
                  if (paid) toast.success('Payment received. VitaLink Sentinel is now active for your workspace.');
                  else toast.error('Payment was not completed, so Sentinel has not been added.');
                } else if (paid) toast.success('Payment received. Your plan is active.');
                else toast.error('Payment was not completed. Your plan has not changed.');
              } catch (error) {
                toast.error(backendErrorMessage(error, 'Could not confirm the payment yet.'));
              }
            }
          }
          const memberships = await backend.listMemberships(sessionUser.id);
          const lastWorkspaceSlug = urlSlug || localStorage.getItem('vitalink-last-workspace');
          const membership = memberships.find((m) => m.organization.slug === lastWorkspaceSlug) ?? memberships[0];
          if (cancelled) return;
          if (!membership) return resumeOnboarding(sessionUser);
          const sessionUserRecord = membershipToAuthUser(sessionUser, membership);
          await syncWorkspacePlan(membership.organization.id).catch(() => null);
          if (cancelled) return;
          onAuthenticatedRef.current({
            role: sessionUserRecord.role,
            name: sessionUserRecord.fullName,
            email: sessionUserRecord.email,
            redirectPage: roleRedirect(sessionUserRecord),
            organization: organizationForUser(sessionUserRecord),
          });
        } catch {
          if (!cancelled) setStage(isRegisterPath ? 'org-signup-start' : 'login');
        }
      })();
      return () => { cancelled = true; };
    }

    if (isRegisterPath) {
      setStage('org-signup-start');
      return;
    }

    const existingSession = localStorage.getItem(sessionKey());
    const users = getUsers();

    if (existingSession && users.length > 0) {
      const sessionEmail = (() => {
        try {
          const decoded = atob(existingSession.split('.jwt.')[1] ?? '');
          return decoded.split(':')[0];
        } catch {
          return null;
        }
      })();

      if (sessionEmail) {
        // Automatically reopen the last used workspace or match the current urlSlug
        const lastWorkspaceSlug = urlSlug || localStorage.getItem('vitalink-last-workspace');

        const sessionUser = users.find(u =>
          u.email.toLowerCase() === sessionEmail.toLowerCase() &&
          (!lastWorkspaceSlug || u.orgSlug === lastWorkspaceSlug)
        ) || users.find(u => u.email.toLowerCase() === sessionEmail.toLowerCase());

      if (sessionUser) {
          const organization = organizationForUser(sessionUser);
          setTimeout(() => {
            onAuthenticatedRef.current({
              role: sessionUser.role,
              name: sessionUser.fullName,
              email: sessionUser.email,
              redirectPage: roleRedirect(sessionUser),
              organization,
            });
          }, 700);
          return;
        }
      }
    }

    // No valid session — show the login page
    setStage('login');
  }, []);

  const [loginForm, setLoginForm] = useState({ email: '', password: '' });

  const [signupForm, setSignupForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    provider: 'email' as 'email' | 'google',
  });

  const [orgForm, setOrgForm] = useState({
    name: '',
    type: 'Hospital',
    level: 'Primary',
    ownership: 'Private',
    country: 'Nigeria',
    state: '',
    address: '',
    phone: '',
    website: '',
    plan: 'starter'
  });
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  // Live workspaces start blank so nothing invented ends up in the network directory.
  const [networkForm] = useState(() => isSupabaseConfigured ? {
    joinedNetwork: true,
    visibleInDirectory: true,
    specialties: '',
    services: '',
    location: '',
    facilityType: '',
    emergencyAvailable: false,
    laboratory: false,
    imaging: false,
    pharmacy: false,
    telemedicine: false,
    acceptingReferrals: true,
    acceptingTransfers: true,
    capacity: 'Not Reported' as CapacityStatus,
  } : {
    joinedNetwork: true,
    visibleInDirectory: true,
    specialties: 'General Medicine, Emergency Medicine',
    services: 'EMR, Laboratory, Pharmacy',
    location: 'Lagos, Lagos',
    facilityType: 'Hospital',
    emergencyAvailable: true,
    laboratory: true,
    imaging: false,
    pharmacy: true,
    telemedicine: true,
    acceptingReferrals: true,
    acceptingTransfers: true,
    capacity: 'Available' as CapacityStatus,
  });
  const [publicHealthSetup, setPublicHealthSetup] = useState({
    jurisdiction: 'Statewide',
    primaryFocus: 'Disease surveillance, outbreak response, community reporting',
    programs: 'Malaria, Cholera, Measles, NTDs',
    dataSharing: true,
    emergencyAlerts: true,
  });
  const selectedOrganizationType = normalizeOrganizationType(orgForm.type);
  const selectedWorkspaceType = workspaceForOrganizationType(selectedOrganizationType);
  const isPublicHealthSignup = selectedWorkspaceType === 'public-health';

  const getUsers = (): AuthUser[] => {
    const raw = localStorage.getItem(usersKey());
    if (!raw) return [];
    try {
      return JSON.parse(raw) as AuthUser[];
    } catch {
      return [];
    }
  };

  const setUsers = (users: AuthUser[]) => {
    localStorage.setItem(usersKey(), JSON.stringify(users));
  };

  const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  // Signed-in account with no workspace yet (e.g. confirmed via email link in another tab): finish setup.
  function resumeOnboarding(sessionUser: backend.SessionUser) {
    const [firstName = '', ...rest] = sessionUser.fullName.split(' ');
    setSignupForm((form) => ({ ...form, email: sessionUser.email, firstName, lastName: rest.join(' ') }));
    setStage('org-info');
  }

  // The confirmation email may carry a link instead of a code; once it's clicked
  // (in any tab, supabase-js syncs sessions across tabs) continue from here.
  useEffect(() => {
    if (!isSupabaseConfigured || stage !== 'verify-email') return;
    return backend.onSignedIn(() => setStage('provisioning'));
  }, [stage]);

  const handleLogin = async () => {
    setAuthError('');
    if (!validateEmail(loginForm.email)) return setAuthError('Please enter a valid work email address');
    if (!loginForm.password) return setAuthError('Password is required');
    setLoading(true);
    if (isSupabaseConfigured) {
      try {
        const sessionUser = await backend.signIn(loginForm.email.trim(), loginForm.password);
        await waitForMfa();
        logLoginAttempt('success', 'Password login');
        const memberships = await backend.listMemberships(sessionUser.id);
        if (memberships.length === 0) return resumeOnboarding(sessionUser);
        const users = memberships.map((membership) => membershipToAuthUser(sessionUser, membership));
        if (users.length > 1) {
          setPendingUsers(users);
          setStage('workspace-select');
        } else {
          authenticateSuccess(users[0]);
        }
      } catch (error) {
        if (error instanceof Error && error.message === 'Signed out') return; // left the two-step screen
        setAuthError(backendErrorMessage(error, 'Login failed. Check your network.'));
        logLoginAttempt('failed', 'Invalid credentials');
      } finally {
        setLoading(false);
      }
      return;
    }
    try {
      await new Promise((r) => setTimeout(r, 800));
      const users = getUsers();
      const matches = users.filter((user) => user.email.toLowerCase() === loginForm.email.toLowerCase());
      if (matches.length === 0 || !matches[0].passwordHash) {
        setAuthError('Invalid credentials or account disabled');
        logLoginAttempt('failed', 'Invalid credentials');
        return;
      }
      const providedHash = await hashPassword(loginForm.password);
      if (providedHash !== matches[0].passwordHash) {
        setAuthError('Invalid credentials');
        logLoginAttempt('failed', 'Invalid password');
        return;
      }

      logLoginAttempt('success', 'Password login');

      // If user belongs to multiple organizations
      if (matches.length > 1) {
        setPendingUsers(matches);
        setStage('workspace-select');
      } else {
        authenticateSuccess(matches[0]);
      }
    } catch {
      setAuthError('Login failed. Check your network.');
    } finally {
      setLoading(false);
    }
  };

  const authenticateSuccess = async (user: AuthUser) => {
    if (isSupabaseConfigured && user.tenantId) await syncWorkspacePlan(user.tenantId).catch(() => null);
    const token = `${BRAND.tokenPrefix}.jwt.${btoa(`${user.email}:${Date.now()}`)}`;
    localStorage.setItem(sessionKey(), token);

    // Store last workspace slug and automatically update path/history URL
    if (user.orgSlug) {
      localStorage.setItem('vitalink-last-workspace', user.orgSlug);
      // Simulate organization-based subdomain routing or subfolder mapping:
      const newPath = `/${user.orgSlug}`;
      if (window.location.pathname !== newPath) {
        window.history.pushState({}, '', newPath);
      }
    }

    const organization = organizationForUser(user);
    localStorage.setItem('vitalink-active-organization', JSON.stringify(organization));

    window.dispatchEvent(new CustomEvent('vitalink:notify', { detail: { module: 'auth', type: 'login-success', message: 'Secure enterprise session started' } }));
    onAuthenticated({ role: user.role, name: user.fullName, email: user.email, redirectPage: roleRedirect(user), organization });
  };

  /* ─────────────────────────────────────────────────────────
     OAUTH MOCK
     ───────────────────────────────────────────────────────── */
  const handleOAuth = async (provider: 'google') => {
    setLoading(true);
    if (isSupabaseConfigured) {
      setAuthError('');
      try {
        // Leaves the page; the session check on return signs in or resumes workspace setup.
        await backend.signInWithProvider(provider, stage === 'login' ? '/' : '/register');
      } catch (error) {
        setAuthError(backendErrorMessage(error, `Could not start ${provider} sign-in.`));
        setLoading(false);
      }
      return;
    }
    try {
      await new Promise((r) => setTimeout(r, 1200));
      // Simulate retrieving details automatically
      setSignupForm({
        ...signupForm,
        firstName: 'Sarah',
        lastName: 'Johnson',
        email: `sarah.j@${provider}-demo.com`,
        provider,
      });
      setStage('org-info');
    } finally {
      setLoading(false);
    }
  };

  /* ─────────────────────────────────────────────────────────
     ORG SIGNUP FLOW (Step 1: Admin Details)
     ───────────────────────────────────────────────────────── */
  const handleAdminDetails = () => {
    setAuthError('');
    if (!signupForm.firstName.trim() || !signupForm.lastName.trim()) return setAuthError('First and Last name required');
    if (!validateEmail(signupForm.email)) return setAuthError('Enter a valid work email');
    if (signupForm.password.length < 8) return setAuthError('Password must be at least 8 characters');
    if (signupForm.password !== signupForm.confirmPassword) return setAuthError('Passwords do not match');

    const users = isSupabaseConfigured ? [] : getUsers();
    if (users.some((u) => u.email.toLowerCase() === signupForm.email.toLowerCase())) {
      setAuthError('An account with this email already exists.');
      return;
    }
    setStage('org-info');
  };

  /* ─────────────────────────────────────────────────────────
     ORG SIGNUP FLOW (Step 2: Org Info)
     ───────────────────────────────────────────────────────── */
  const handleOrgInfo = () => {
    setAuthError('');
    if (!orgForm.name.trim()) return setAuthError('Organization Name is required');
    if (isPublicHealthSignup) {
      const sentinelUrl = new URL(import.meta.env.VITE_SENTINEL_WORKSPACE_URL ?? 'http://127.0.0.1:5173/');
      sentinelUrl.pathname = '/register';
      sentinelUrl.searchParams.set('handoff', 'true');
      sentinelUrl.searchParams.set('email', signupForm.email);
      sentinelUrl.searchParams.set('fullName', `${signupForm.firstName} ${signupForm.lastName}`.trim());
      sentinelUrl.searchParams.set('orgName', orgForm.name);
      sentinelUrl.searchParams.set('orgType', selectedOrganizationType);
      sentinelUrl.searchParams.set('state', orgForm.state || publicHealthSetup.jurisdiction);
      sentinelUrl.searchParams.set('phone', orgForm.phone);
      sentinelUrl.searchParams.set('sector', sectorForOrganizationType(selectedOrganizationType));
      sentinelUrl.searchParams.set('joinedNetwork', String(networkForm.joinedNetwork));
      localStorage.setItem('sentinel_registration_handoff', JSON.stringify({
        email: signupForm.email,
        fullName: `${signupForm.firstName} ${signupForm.lastName}`.trim(),
        password: signupForm.password,
        orgName: orgForm.name,
        orgType: selectedOrganizationType,
        state: orgForm.state || publicHealthSetup.jurisdiction,
        contactPhone: orgForm.phone,
        sector: sectorForOrganizationType(selectedOrganizationType),
        joinedNetwork: networkForm.joinedNetwork,
        source: 'hospital-dashboard-registration',
        timestamp: new Date().toISOString(),
      }));
      window.location.href = sentinelUrl.toString();
      return;
    }
    setStage('subscription');
  };

  /* ─────────────────────────────────────────────────────────
     ORG SIGNUP FLOW (Step 3: Subscription & Verification)
     ───────────────────────────────────────────────────────── */
  const handleSubscriptionSelect = async (planId: string, cycle: 'monthly' | 'annual') => {
    setOrgForm({ ...orgForm, plan: planId });
    setBillingCycle(cycle);
    setStage('workspace-url');
  };

  const handleWorkspaceURL = async (slug: string) => {
    setOrgForm({ ...orgForm, name: orgForm.name }); // keep name
    // Store slug for provisioning
    localStorage.setItem('vitalink-pending-slug', slug);
    if (isSupabaseConfigured) {
      setAuthError('');
      setLoading(true);
      try {
        // A resumed signup already has a session, so skip straight to provisioning.
        if (await backend.getSessionUser()) return setStage('provisioning');
        await backend.signUp(signupForm.email.trim(), signupForm.password, `${signupForm.firstName} ${signupForm.lastName}`.trim());
      } catch (error) {
        return setAuthError(backendErrorMessage(error, 'Could not start signup.'));
      } finally {
        setLoading(false);
      }
    }
    setStage('verify-email');
  };

  const handleVerifyOTP = async (otp: string) => {
    if (otp.length !== 6) return;
    setAuthError('');
    setLoading(true);
    try {
      if (isSupabaseConfigured) await backend.verifySignupCode(signupForm.email.trim(), otp);
      else await new Promise((r) => setTimeout(r, 1000));
    } catch (error) {
      return setAuthError(backendErrorMessage(error, 'Verification failed.'));
    } finally {
      setLoading(false);
    }
    setStage('provisioning');
  };

  /* ─────────────────────────────────────────────────────────
     ORG SIGNUP FLOW (Step 4: Provisioning & Finalize)
     ───────────────────────────────────────────────────────── */
  const finalizeWorkspace = async () => {
    const orgSlug = localStorage.getItem('vitalink-pending-slug') || orgForm.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const tenantId = `ORG-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const organizationType = normalizeOrganizationType(orgForm.type);
    const workspaceType = workspaceForOrganizationType(organizationType);
    const subscriptionTier = orgForm.plan === 'starter' || orgForm.plan === 'free' || orgForm.plan === 'trial' ? 'free' : orgForm.plan === 'enterprise' ? 'premium' : 'standard';
    if (isSupabaseConfigured) {
      try {
        const sessionUser = await backend.getSessionUser();
        if (!sessionUser) throw new Error('Your session expired. Please sign in again.');
        const org = await backend.createWorkspace({
          name: orgForm.name.trim(),
          slug: orgSlug,
          organizationType,
          state: orgForm.state || publicHealthSetup.jurisdiction || networkForm.location,
          contactPhone: orgForm.phone,
          // Healthcare workspaces join the network in the setup that follows sign-up.
          joinedNetwork: workspaceType === 'healthcare' ? false : networkForm.joinedNetwork,
          planId: ['starter', 'growth', 'trial'].includes(orgForm.plan) ? orgForm.plan : 'free',
          billingCycle,
        });
        // The owner is an admin, so two-step verification is set up before anything else.
        await waitForMfa();
        const createdUser = membershipToAuthUser(sessionUser, { role: WORKSPACE_OWNER_ROLE, organization: org });
        localStorage.setItem('vitalink-active-organization', JSON.stringify(organizationForUser(createdUser)));
        localStorage.setItem('vitalink-last-workspace', org.slug);
        // First sign-in goes through facility setup before the dashboard.
        markWorkspaceSetupPending(org.id);
        localStorage.removeItem('vitalink-pending-slug');
        const sub = await syncWorkspacePlan(org.id);
        if (sub?.status === 'pending_payment') {
          try {
            const checkout = await backend.startCheckout(org.id, sub.planId, sub.billingCycle);
            if (checkout.authorizationUrl) {
              window.location.href = checkout.authorizationUrl; // returns to /payment-callback
              return;
            }
          } catch (error) {
            toast.error(`${backendErrorMessage(error, 'Payment could not start.')} Your workspace is on the Free plan until payment completes.`);
          }
        } else if (sub?.status === 'comped') {
          toast.success(`Platform admin: ${sub.planName} activated without payment.`);
        }
        setPendingUser(createdUser);
        setStage('welcome');
        toast.success('Workspace created successfully!');
      } catch (error) {
        setAuthError(backendErrorMessage(error, 'Workspace setup failed.'));
        setStage('workspace-url');
      }
      return;
    }
    const orgCreatedAt = new Date().toISOString();
    const createdUser: AuthUser = {
      id: `usr-${Date.now()}`,
      fullName: `${signupForm.firstName} ${signupForm.lastName}`,
      email: signupForm.email,
      role: WORKSPACE_OWNER_ROLE,
      passwordHash: await hashPassword(signupForm.password),
      provider: signupForm.provider,
      onboardingComplete: true,
      tenantId,
      orgSlug,
      orgName: orgForm.name,
      organizationType,
      workspaceType,
      orgSector: sectorForOrganizationType(organizationType),
      orgState: orgForm.state || publicHealthSetup.jurisdiction || networkForm.location,
      orgContactPhone: orgForm.phone,
      joinedNetwork: networkForm.joinedNetwork,
      orgCreatedAt,
      subscriptionTier,
    };

    setUsers([createdUser, ...getUsers()]);
    markWorkspaceSetupPending(tenantId);
    const organizationProfile = createOrganizationProfile({
      id: tenantId,
      name: orgForm.name,
      slug: orgSlug,
      organizationType,
      workspaceType,
      sector: sectorForOrganizationType(organizationType),
      state: orgForm.state || publicHealthSetup.jurisdiction || networkForm.location,
      contactEmail: signupForm.email,
      contactPhone: orgForm.phone,
      joinedNetwork: networkForm.joinedNetwork,
      createdAt: orgCreatedAt,
      subscriptionTier,
    });
    localStorage.setItem('vitalink-active-organization', JSON.stringify(organizationProfile));
    localStorage.setItem('sentinel_org', JSON.stringify(organizationProfile));
    localStorage.setItem('sentinel_auth', JSON.stringify({
      isAuthenticated: true,
      orgId: tenantId,
      orgType: organizationType,
    }));
    if (workspaceType === 'healthcare') {
      const networkState = mockNetworkService.getState();
      mockNetworkService.updateOrganizationNetworkSettings({
        organizationId: networkState.activeOrganizationId,
        joinedNetwork: networkForm.joinedNetwork,
        visibleInDirectory: networkForm.visibleInDirectory,
        specialties: networkForm.specialties.split(',').map((item) => item.trim()).filter(Boolean),
        services: networkForm.services.split(',').map((item) => item.trim()).filter(Boolean),
        location: networkForm.location,
        facilityType: networkForm.facilityType,
        emergencyAvailable: networkForm.emergencyAvailable,
        laboratory: networkForm.laboratory,
        imaging: networkForm.imaging,
        pharmacy: networkForm.pharmacy,
        telemedicine: networkForm.telemedicine,
        acceptingReferrals: networkForm.acceptingReferrals,
        acceptingTransfers: networkForm.acceptingTransfers,
        capacity: networkForm.capacity,
      });
    }
    setPendingUser(createdUser);
    localStorage.removeItem('vitalink-pending-slug');
    setStage('welcome');
    toast.success('Workspace created successfully!');
  };

  return (
    <AuthLayout wide={stage === 'subscription'}>
      {/* ── Session Check Loading ─────────────────────────── */}
      {stage === 'checking-session' && <SessionCheckScreen />}

      <div className="flex w-full flex-col justify-center">

        {/* Back Button for multi-step */}
        {stage !== 'login' && stage !== 'org-signup-start' && stage !== 'provisioning' && stage !== 'welcome' && stage !== 'email-sent' && stage !== 'checking-session' && stage !== 'accept-invite' && (
          <button
            onClick={() => {
              setAuthError('');
              if (stage === 'org-signup-details') setStage('org-signup-start');
              if (stage === 'org-info') setStage('org-signup-start');
              if (stage === 'subscription') setStage('org-info');
              if (stage === 'workspace-url') setStage('subscription');
              if (stage === 'verify-email') setStage('workspace-url');
              if (stage === 'forgot-password' || stage === 'reset-password') setStage('login');
            }}
            className="flex items-center text-[var(--auth-text-secondary)] hover:text-[var(--auth-text-primary)] transition-colors mb-4 text-sm font-medium animate-[auth-page-fadein_0.3s_ease]"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </button>
        )}

        {/* Header */}
        {(stage !== 'provisioning' && stage !== 'checking-session') && (
          <h1 className="text-[26px] md:text-[30px] font-semibold tracking-[-0.02em] mb-1 text-[var(--auth-text-primary)] font-inter animate-[auth-form-slide-up_0.4s_ease-out_both]">
            {stage === 'login' && 'Welcome back'}
            {stage === 'org-signup-start' && 'Create your workspace'}
            {stage === 'org-signup-details' && 'Administrator Info'}
            {stage === 'org-info' && 'Organization Details'}
            {stage === 'subscription' && 'Choose Plan'}
            {stage === 'workspace-url' && 'Choose Your URL'}
            {stage === 'verify-email' && 'Verify Work Email'}
            {stage === 'welcome' && 'Workspace Ready'}
            {stage === 'forgot-password' && 'Reset your password'}
            {stage === 'accept-invite' && 'Join your team'}
            {stage === 'reset-password' && 'Create new password'}
            {stage === 'email-sent' && 'Check your email'}
            {stage === 'workspace-select' && 'Choose Workspace'}
          </h1>
        )}
        {(stage === 'login' || stage === 'org-signup-start') && (
          <p className="mb-6 text-sm text-[var(--auth-text-secondary)]">
            {stage === 'login' ? 'Sign in to your VitaLink workspace.' : 'Set up VitaLink for your hospital or clinic in a few minutes.'}
          </p>
        )}
        {stage !== 'login' && stage !== 'org-signup-start' && stage !== 'provisioning' && stage !== 'checking-session' && <div className="mb-4" />}

        {authError && <ErrorText text={authError} />}

        {/* ── Login Flow ─────────────────────────────────────────── */}
        {stage === 'login' && (
          <div className="animate-[auth-form-slide-up_0.5s_ease-out_both] flex flex-col gap-3">
            {detectedOrgName && (
              <div className="text-xs text-[var(--auth-accent)] bg-[var(--auth-accent)]/10 px-3 py-1.5 rounded-lg border border-[var(--auth-accent)]/20 mb-1 text-center">
                Signing into workspace: <span className="font-semibold">{detectedOrgName}</span>
              </div>
            )}
            <GoogleButton onClick={() => handleOAuth('google')} disabled={loading} />
            <AuthDivider />

            <AuthField
              label="Email"
              value={loginForm.email}
              onChange={(v) => setLoginForm(f => ({...f, email: v}))}
              type="email"
              autoComplete="email"
              placeholder="you@hospital.com"
            />
            <div className="relative">
              <button
                type="button"
                className="absolute right-1 top-0 z-10 text-[13px] font-medium text-[var(--auth-accent)] hover:underline"
                onClick={() => { setAuthError(''); setStage('forgot-password'); }}
              >
                Forgot password?
              </button>
              <AuthField
                label="Password"
                value={loginForm.password}
                onChange={(v) => setLoginForm(f => ({...f, password: v}))}
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
              />
            </div>

            <AuthPrimaryButton
              label="Sign in"
              onClick={handleLogin}
              loading={loading}
            />

            <TrustIndicator />

            <FooterLinks 
              primaryText="New to VitaLink?"
              actionText="Create a workspace"
              onAction={() => { setAuthError(''); setStage('org-signup-start'); }}
            />
          </div>
        )}

        {/* ── Org Signup 1: Auth Options ─────────────────────────── */}
        {stage === 'org-signup-start' && (
          <div className="animate-[auth-form-slide-up_0.5s_ease-out_both] flex flex-col gap-3">
            <GoogleButton onClick={() => handleOAuth('google')} disabled={loading} />
            <AuthDivider />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <AuthField label="First name" value={signupForm.firstName} onChange={(v) => setSignupForm(s => ({...s, firstName: v}))} autoComplete="given-name" placeholder="Adaeze" />
              <AuthField label="Last name" value={signupForm.lastName} onChange={(v) => setSignupForm(s => ({...s, lastName: v}))} autoComplete="family-name" placeholder="Okafor" />
            </div>
            <AuthField label="Work email" value={signupForm.email} onChange={(v) => setSignupForm(s => ({...s, email: v}))} type="email" autoComplete="email" placeholder="you@hospital.com" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <AuthField label="Password" value={signupForm.password} onChange={(v) => setSignupForm(s => ({...s, password: v}))} type="password" autoComplete="new-password" placeholder="At least 8 characters" />
              <AuthField label="Confirm password" value={signupForm.confirmPassword} onChange={(v) => setSignupForm(s => ({...s, confirmPassword: v}))} type="password" autoComplete="new-password" placeholder="Repeat password" />
            </div>
            <label className="mt-1 flex cursor-pointer items-center gap-2.5 text-sm text-[var(--auth-text-secondary)]">
              <input type="checkbox" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} className="h-4 w-4 rounded border-[var(--auth-input-border)] accent-[var(--auth-accent)]" />
              <span>I agree to the <LegalLink doc="terms" className="font-medium text-[var(--auth-text-primary)] underline underline-offset-2">Terms of Use</LegalLink> and <LegalLink doc="privacy" className="font-medium text-[var(--auth-text-primary)] underline underline-offset-2">Privacy Policy</LegalLink></span>
            </label>

            <AuthPrimaryButton
              label="Create account"
              onClick={() => {
                if (!termsAccepted) { setAuthError('Please agree to the Terms of Use and Privacy Policy to continue.'); return; }
                setSignupForm(s => ({...s, provider: 'email'}));
                handleAdminDetails();
              }}
              loading={loading}
            />

            <TrustIndicator />

            <FooterLinks
              primaryText="Already have an account?"
              actionText="Sign in"
              onAction={() => { setAuthError(''); setStage('login'); }}
            />
          </div>
        )}

        {/* ── Org Signup 2: Admin Details ────────────────────────── */}
        {stage === 'org-signup-details' && (
          <div className="animate-[auth-form-slide-up_0.5s_ease-out_both] flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <AuthField value={signupForm.firstName} onChange={(v) => setSignupForm(s => ({...s, firstName: v}))} placeholder="First Name" />
              <AuthField value={signupForm.lastName} onChange={(v) => setSignupForm(s => ({...s, lastName: v}))} placeholder="Last Name" />
            </div>
            <AuthField value={signupForm.email} onChange={(v) => setSignupForm(s => ({...s, email: v}))} type="email" placeholder="Work Email" />
            <AuthField value={signupForm.password} onChange={(v) => setSignupForm(s => ({...s, password: v}))} type="password" placeholder="Password (min 8 chars)" />
            <AuthField value={signupForm.confirmPassword} onChange={(v) => setSignupForm(s => ({...s, confirmPassword: v}))} type="password" placeholder="Confirm Password" />

            <Button
              className="w-full h-[52px] rounded-full bg-[var(--auth-accent)] hover:bg-[var(--auth-accent-hover)] text-white mt-2 font-semibold text-[14px] shadow-[0_0_15px_rgba(123,77,255,0.25)]"
              onClick={handleAdminDetails}
            >
              Continue <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </div>
        )}

        {/* ── Org Signup 3: Org Info ─────────────────────────────── */}
        {stage === 'org-info' && (
          <div className="animate-[auth-form-slide-up_0.5s_ease-out_both] flex flex-col gap-3">
            <AuthField value={orgForm.name} onChange={(v) => setOrgForm(s => ({...s, name: v}))} placeholder="Organization Name (e.g. Lagos Central)" />

            <div className="grid grid-cols-2 gap-3">
              <select
                className="w-full h-[48px] rounded-[14px] bg-[var(--auth-input-bg)] border border-[var(--auth-input-border)] text-[var(--auth-text-secondary)] focus:border-[var(--auth-accent)] px-4 text-sm"
                value={orgForm.type}
                onChange={(e) => setOrgForm(f => ({...f, type: e.target.value}))}
              >
                {ORGANIZATION_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>

              <select
                className="w-full h-[48px] rounded-[14px] bg-[var(--auth-input-bg)] border border-[var(--auth-input-border)] text-[var(--auth-text-secondary)] focus:border-[var(--auth-accent)] px-4 text-sm"
                value={orgForm.ownership}
                onChange={(e) => setOrgForm(f => ({...f, ownership: e.target.value}))}
              >
                {['Private', 'Public', 'Government', 'Faith Based', 'Military', 'University'].map(o => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>

            <AuthField value={orgForm.address} onChange={(v) => setOrgForm(s => ({...s, address: v}))} placeholder="Corporate Address" />

            <div className="grid grid-cols-2 gap-3">
              <AuthField value={orgForm.country} onChange={(v) => setOrgForm(s => ({...s, country: v}))} placeholder="Country" />
              <AuthField value={orgForm.phone} onChange={(v) => setOrgForm(s => ({...s, phone: v}))} placeholder="Contact Phone" />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--auth-accent)]/25 bg-[var(--auth-accent)]/10 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--auth-accent)]">{organizationTypeLabel(selectedOrganizationType)}</p>
                <p className="truncate text-sm font-semibold text-[var(--auth-text-primary)]">{workspaceLabel(selectedWorkspaceType)}</p>
              </div>
              <p className="max-w-[11rem] text-right text-[11px] leading-4 text-[var(--auth-text-secondary)]">{isPublicHealthSignup ? `${BRAND.sentinel} surveillance workspace` : 'Healthcare operations workspace'}</p>
            </div>

            {isPublicHealthSignup ? (
              <div className="rounded-[18px] border border-[var(--auth-input-border)] bg-[var(--auth-input-bg)] p-4 space-y-3">
                <div>
                  <p className="text-[14px] font-semibold text-[var(--auth-text-primary)]">Public Health Program Setup</p>
                  <p className="mt-1 text-xs text-[var(--auth-text-secondary)]">
                    Configure your surveillance scope without creating hospital services, wards, or patient-care departments.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <AuthField value={publicHealthSetup.jurisdiction} onChange={(v) => setPublicHealthSetup((setup) => ({ ...setup, jurisdiction: v }))} placeholder="Jurisdiction / Coverage" />
                  <AuthField value={publicHealthSetup.programs} onChange={(v) => setPublicHealthSetup((setup) => ({ ...setup, programs: v }))} placeholder="Programs / Diseases" />
                </div>
                <AuthField value={publicHealthSetup.primaryFocus} onChange={(v) => setPublicHealthSetup((setup) => ({ ...setup, primaryFocus: v }))} placeholder="Primary public health focus" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button type="button" className={`rounded-[14px] px-3 py-2 text-sm ${publicHealthSetup.dataSharing ? 'bg-[var(--auth-accent)] text-white' : 'bg-black/10 text-[var(--auth-text-secondary)]'}`} onClick={() => setPublicHealthSetup((setup) => ({ ...setup, dataSharing: !setup.dataSharing }))}>
                    Data Sharing {publicHealthSetup.dataSharing ? 'Enabled' : 'Disabled'}
                  </button>
                  <button type="button" className={`rounded-[14px] px-3 py-2 text-sm ${publicHealthSetup.emergencyAlerts ? 'bg-[var(--auth-accent)] text-white' : 'bg-black/10 text-[var(--auth-text-secondary)]'}`} onClick={() => setPublicHealthSetup((setup) => ({ ...setup, emergencyAlerts: !setup.emergencyAlerts }))}>
                    Emergency Alerts {publicHealthSetup.emergencyAlerts ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              </div>
            ) : null}

            <Button
              className="w-full h-[48px] rounded-full bg-[var(--auth-accent)] hover:bg-[var(--auth-accent-hover)] text-white mt-2 font-semibold text-[14px] shadow-[0_0_15px_rgba(123,77,255,0.25)]"
              onClick={handleOrgInfo}
            >
              Continue to Workspace Plan <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </div>
        )}

        {/* ── Org Signup 4: Subscription ─────────────────────────── */}
        {stage === 'subscription' && (
          <div className="w-full">
            <EnterpriseSubscription onSelect={handleSubscriptionSelect} onContactSales={() => setShowEnterpriseEnquiry(true)} />
          </div>
        )}

        {/* ── Org Signup 5: Workspace URL ──────────────────────── */}
        {stage === 'workspace-url' && (
          <WorkspaceURLPicker orgName={orgForm.name} onConfirm={handleWorkspaceURL} />
        )}

        {/* ── Org Signup 6: Verify Email ─────────────────────────── */}
        {stage === 'verify-email' && (
          <div className="animate-[auth-form-slide-up_0.5s_ease-out_both] flex flex-col items-center text-center">
            <div className="w-14 h-14 bg-[var(--auth-input-bg)] border border-[var(--auth-border)] rounded-xl flex items-center justify-center mb-4">
              <AlertCircle className="w-7 h-7 text-[var(--auth-accent)]" />
            </div>
            <p className="text-[14px] text-[var(--auth-text-secondary)] mb-1">
              Enter the 6-digit verification code sent to
            </p>
            <p className="text-[var(--auth-text-primary)] font-medium text-base mb-3">{signupForm.email}</p>

            <OTPInput onComplete={handleVerifyOTP} />

            {loading && <Loader2 className="w-5 h-5 animate-spin text-[var(--auth-accent)] mt-3" />}

            <p className="text-xs text-[var(--auth-text-secondary)] mt-4">
              Didn't receive the code? <button className="text-[var(--auth-text-primary)] hover:underline" onClick={async () => {
                if (!isSupabaseConfigured) return;
                try { await backend.resendSignupCode(signupForm.email.trim()); toast.success('A new code is on its way.'); }
                catch (error) { setAuthError(backendErrorMessage(error, 'Could not resend the code.')); }
              }}>Resend OTP</button>
            </p>
          </div>
        )}

        {/* ── Org Signup 6: Provisioning ─────────────────────────── */}
        {stage === 'provisioning' && (
          <ProvisioningScreen onComplete={finalizeWorkspace} />
        )}

        {/* ── Welcome ────────────────────────────────────────────── */}
        {stage === 'welcome' && pendingUser && (
          <div className="animate-[auth-form-slide-up_0.5s_ease-out_both] flex flex-col gap-3 text-center">
            <div className="p-4 rounded-xl bg-gradient-to-b from-[var(--auth-accent)]/15 to-transparent border border-[var(--auth-accent)]/25">
              <p className="text-[11px] text-[var(--auth-accent)] uppercase tracking-widest font-bold mb-1">Workspace URL</p>
              <p className="text-lg font-mono text-[var(--auth-text-primary)] break-all">
                {pendingUser.orgSlug}.vitalink.africa
              </p>
              <p className="text-[10px] text-[var(--auth-text-secondary)] mt-0.5">
                Also: app.vitalink.africa/{pendingUser.orgSlug}
              </p>
            </div>

              <p className="text-[14px] text-[var(--auth-text-secondary)]">
              Your {workspaceLabel(pendingUser.workspaceType ?? 'healthcare').toLowerCase()} is ready. You are signed in as the {pendingUser.role.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}. Next, a short setup of your facility, departments and team.
            </p>

            <AuthPrimaryButton
              label="Continue to setup"
              onClick={() => authenticateSuccess(pendingUser)}
            />
          </div>
        )}

        {/* ── Accept staff invitation ─────────────────────────────── */}
        {stage === 'accept-invite' && (
          <div className="animate-[auth-form-slide-up_0.5s_ease-out_both] flex flex-col gap-3">
            {invite === null && <p className="text-[14px] text-[var(--auth-text-secondary)]">Loading invitation…</p>}
            {(invite === 'missing' || (invite !== null && !invite.isValid)) && (
              <>
                <p className="text-[14px] text-[var(--auth-text-secondary)]">This invitation link is invalid, has already been used, or has expired. Ask your workspace admin for a new one.</p>
                <AuthPrimaryButton label="Go to Sign In" onClick={() => { window.history.replaceState({}, '', '/'); setStage('login'); }} />
              </>
            )}
            {invite && invite !== 'missing' && invite.isValid && (
              <>
                <div className="rounded-xl border border-[var(--auth-border)] bg-[var(--auth-input-bg)] p-4">
                  <p className="text-[15px] font-semibold text-[var(--auth-text-primary)]">{invite.organizationName}</p>
                  <p className="text-[13px] text-[var(--auth-text-secondary)]">
                    You're invited as <strong>{roleLabel(invite.role)}</strong>{invite.department ? ` · ${invite.department}` : ''}
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--auth-text-secondary)]">For {invite.email} · expires {new Date(invite.expiresAt).toLocaleDateString()}</p>
                </div>

                {inviteAwaitingCode ? (
                  <div className="flex flex-col items-center text-center">
                    <p className="text-[14px] text-[var(--auth-text-secondary)] mb-1">Enter the 6-digit code we emailed to</p>
                    <p className="text-[var(--auth-text-primary)] font-medium text-base mb-3">{invite.email}</p>
                    <OTPInput onComplete={verifyInviteCode} />
                    {loading && <Loader2 className="w-5 h-5 animate-spin text-[var(--auth-accent)] mt-3" />}
                    <p className="text-xs text-[var(--auth-text-secondary)] mt-4">
                      Didn't get it? Check spam, or{' '}
                      <button type="button" className="text-[var(--auth-text-primary)] hover:underline" onClick={resendInviteCode}>send a new code</button>
                    </p>
                  </div>
                ) : inviteSessionEmail && inviteSessionEmail.toLowerCase() === invite.email.toLowerCase() ? (
                  <AuthPrimaryButton label={`Join ${invite.organizationName}`} onClick={joinInvitedWorkspace} loading={loading} />
                ) : inviteSessionEmail ? (
                  <>
                    <p className="text-[13px] text-[var(--auth-text-secondary)]">You're signed in as {inviteSessionEmail}, but this invitation is for {invite.email}.</p>
                    <AuthPrimaryButton label="Sign out and continue" onClick={signOutForInvite} />
                  </>
                ) : (
                  <>
                    <div className="flex gap-1 rounded-lg bg-[var(--auth-input-bg)] p-1">
                      {(['signin', 'signup'] as const).map((mode) => (
                        <button key={mode} type="button" onClick={() => { setAuthError(''); setInviteMode(mode); }}
                          className={`flex-1 rounded-md px-3 py-1.5 text-[12px] font-semibold ${inviteMode === mode ? 'bg-[var(--auth-accent)] text-white' : 'text-[var(--auth-text-secondary)]'}`}>
                          {mode === 'signin' ? 'I have an account' : 'Create my account'}
                        </button>
                      ))}
                    </div>
                    {inviteMode === 'signup' && (
                      <AuthField value={inviteForm.fullName} onChange={(v) => setInviteForm((f) => ({ ...f, fullName: v }))} placeholder="Full name" />
                    )}
                    <AuthField value={inviteForm.password} onChange={(v) => setInviteForm((f) => ({ ...f, password: v }))} type="password" placeholder={inviteMode === 'signup' ? 'Create password (min 8 chars)' : 'Password'} />
                    <AuthPrimaryButton
                      label={inviteMode === 'signup' ? 'Create account & join' : 'Sign in & join'}
                      onClick={inviteMode === 'signup' ? signUpForInvite : signInForInvite}
                      loading={loading}
                    />
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Forgot Password ────────────────────────────────────── */}
        {stage === 'forgot-password' && (
          <div className="animate-[auth-form-slide-up_0.5s_ease-out_both] flex flex-col gap-3">
            <p className="text-[14px] text-[var(--auth-text-secondary)] mb-1">
              Enter your work email and we'll send a secure reset link.
            </p>
            <AuthField
              value={loginForm.email}
              onChange={(v) => setLoginForm(f => ({...f, email: v}))}
              type="email"
              placeholder="Email address"
            />

            <AuthPrimaryButton
              label="Send Reset Link"
              onClick={async () => {
                if (!validateEmail(loginForm.email)) return setAuthError('Enter a valid email');
                setLoading(true);
                try {
                  if (isSupabaseConfigured) await backend.sendPasswordReset(loginForm.email.trim());
                  else await new Promise(r => setTimeout(r, 600));
                } catch (error) {
                  return setAuthError(backendErrorMessage(error, 'Could not send the reset link.'));
                } finally {
                  setLoading(false);
                }
                setStage('email-sent');
              }}
              loading={loading}
            />
          </div>
        )}

        {stage === 'email-sent' && (
          <div className="animate-[auth-form-slide-up_0.5s_ease-out_both] flex flex-col gap-3 text-center">
            <p className="text-[14px] text-[var(--auth-text-secondary)] mb-4">
              We've sent a password reset link to <strong className="text-[var(--auth-text-primary)] font-medium">{loginForm.email}</strong>.
            </p>
            {isSupabaseConfigured
              ? <AuthPrimaryButton label="Back to Sign In" onClick={() => setStage('login')} />
              : <AuthPrimaryButton label="Simulate Opening Link" onClick={() => setStage('reset-password')} />}
          </div>
        )}

        {stage === 'reset-password' && (
          <div className="animate-[auth-form-slide-up_0.5s_ease-out_both] flex flex-col gap-3">
            <AuthField
              value={loginForm.password}
              onChange={(v) => setLoginForm(f => ({...f, password: v}))}
              type="password"
              placeholder="New password (min 8 chars)"
            />
            <AuthPrimaryButton
              label="Update Password"
              onClick={async () => {
                if (loginForm.password.length < 8) {
                  setAuthError('Password must be at least 8 characters');
                  return;
                }
                setLoading(true);
                if (isSupabaseConfigured) {
                  try {
                    await backend.updatePassword(loginForm.password);
                    await backend.signOut();
                  } catch (error) {
                    return setAuthError(backendErrorMessage(error, 'Could not update password.'));
                  } finally {
                    setLoading(false);
                  }
                  window.history.replaceState({}, '', '/');
                  toast.success('Password updated');
                  setStage('login');
                  return;
                }
                await new Promise(r => setTimeout(r, 600));
                const updatedHash = await hashPassword(loginForm.password);
                const users = getUsers();
                const updatedUsers = users.map((user) => user.email.toLowerCase() === loginForm.email.toLowerCase() ? { ...user, passwordHash: updatedHash } : user);
                setUsers(updatedUsers);
                setLoading(false);
                toast.success('Password updated');
                setStage('login');
              }}
              loading={loading}
            />
          </div>
        )}

        {/* ── Choose Workspace ────────────────────────────────────── */}
        {stage === 'workspace-select' && (
          <div className="animate-[auth-form-slide-up_0.5s_ease-out_both] flex flex-col gap-3">
            <p className="text-[13px] text-[var(--auth-text-secondary)] mb-1 text-center">
              Select an organization workspace to sign into:
            </p>
            <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1">
              {pendingUsers.map((user) => (
                <button
                  key={user.id}
                  onClick={() => authenticateSuccess(user)}
                  className="w-full p-4 rounded-xl border border-[var(--auth-border)] bg-[var(--auth-input-bg)] text-left hover:border-[var(--auth-accent)] transition-all flex flex-col gap-1 group"
                >
                  <span className="font-semibold text-[14px] text-[var(--auth-text-primary)] group-hover:text-[var(--auth-accent)] transition-colors">
                    {user.orgName || user.orgSlug || 'Healthcare Organization'}
                  </span>
                  <span className="text-[11px] font-mono text-[var(--auth-text-secondary)]">
                    {user.orgSlug}.vitalink.africa
                  </span>
                  <span className="text-[11px] text-[var(--auth-text-secondary)]">
                    {workspaceLabel(organizationForUser(user).workspaceType)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {showEnterpriseEnquiry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="enterprise-enquiry-title" className="w-full max-w-md rounded-2xl border border-[var(--auth-border)] bg-[var(--auth-bg)] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><div><h2 id="enterprise-enquiry-title" className="text-lg font-semibold text-[var(--auth-text-primary)]">Enterprise & NGO enquiry</h2><p className="mt-1 text-xs text-[var(--auth-text-secondary)]">Tell us what your organization needs and our team will prepare a tailored quote.</p></div><button type="button" onClick={() => setShowEnterpriseEnquiry(false)} className="text-[var(--auth-text-secondary)] hover:text-[var(--auth-text-primary)]" title="Close enquiry"><X className="h-5 w-5" /></button></div>
            <div className="mt-4 space-y-3"><AuthField value={enterpriseEnquiry.name} onChange={(name) => setEnterpriseEnquiry((form) => ({ ...form, name }))} placeholder="Your name" /><AuthField value={enterpriseEnquiry.email} onChange={(email) => setEnterpriseEnquiry((form) => ({ ...form, email }))} type="email" placeholder="Work email" /><AuthField value={enterpriseEnquiry.organization} onChange={(organization) => setEnterpriseEnquiry((form) => ({ ...form, organization }))} placeholder="Organization name" /><textarea value={enterpriseEnquiry.requirements} onChange={(event) => setEnterpriseEnquiry((form) => ({ ...form, requirements: event.target.value }))} placeholder="Special requirements" rows={3} className="w-full rounded-xl border border-[var(--auth-input-border)] bg-[var(--auth-input-bg)] px-4 py-3 text-sm text-[var(--auth-text-primary)] placeholder:text-[var(--auth-text-secondary)]/50 focus:border-[var(--auth-accent)] focus:outline-none" /></div>
            <div className="mt-5 flex gap-3"><Button variant="outline" className="flex-1 rounded-xl" onClick={() => setShowEnterpriseEnquiry(false)}>Cancel</Button><Button className="flex-1 rounded-xl bg-[var(--auth-accent)] text-white hover:bg-[var(--auth-accent-hover)]" onClick={() => { localStorage.setItem('enterprise_enquiry', JSON.stringify({ ...enterpriseEnquiry, id: `ENQ-${Date.now()}`, submittedAt: new Date().toISOString(), status: 'received' })); setShowEnterpriseEnquiry(false); toast.success('Enterprise enquiry submitted. Our team will contact you within 24 hours.'); }}>Submit Enquiry</Button></div>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
