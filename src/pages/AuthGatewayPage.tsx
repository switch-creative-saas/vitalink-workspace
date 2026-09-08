import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { 
  GoogleButton, 
  AppleButton, 
  MicrosoftButton, 
  EmailButton, 
  AuthDivider 
} from '@/components/auth/SocialButtons';
import { AuthField, AuthPrimaryButton, TrustIndicator } from '@/components/auth/AuthForm';
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
import { PUBLIC_HEALTH_ROLES, defaultRoleForOrganizationType } from '@/lib/workspace/roles';
import { AlertCircle, ArrowLeft, ArrowRight, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
  | 'workspace-select';

type AuthUser = {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  passwordHash?: string;
  provider: 'email' | 'google' | 'microsoft' | 'apple';
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
      'human-resources', 'administration', 'subscription', 'audit-logs', 'settings', 'help'
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
  const [authError, setAuthError] = useState('');
  
  const [pendingUser, setPendingUser] = useState<AuthUser | null>(null);
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

    if (window.location.pathname.replace(/\/+$/, '') === '/register') {
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
    provider: 'email' as 'email' | 'google' | 'microsoft' | 'apple',
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
  const [networkForm, setNetworkForm] = useState({
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

  const handleLogin = async () => {
    setAuthError('');
    if (!validateEmail(loginForm.email)) return setAuthError('Please enter a valid work email address');
    if (!loginForm.password) return setAuthError('Password is required');
    setLoading(true);
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

  const authenticateSuccess = (user: AuthUser) => {
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
  const handleOAuth = async (provider: 'google' | 'microsoft' | 'apple') => {
    setLoading(true);
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
    
    const users = getUsers();
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
    setStage('subscription');
  };

  /* ─────────────────────────────────────────────────────────
     ORG SIGNUP FLOW (Step 3: Subscription & Verification)
     ───────────────────────────────────────────────────────── */
  const handleSubscriptionSelect = async (planId: string) => {
    setOrgForm({ ...orgForm, plan: planId });
    setStage('workspace-url');
  };

  const handleWorkspaceURL = (slug: string) => {
    setOrgForm({ ...orgForm, name: orgForm.name }); // keep name
    // Store slug for provisioning
    localStorage.setItem('vitalink-pending-slug', slug);
    setStage('verify-email');
  };

  const handleVerifyOTP = async (otp: string) => {
    if (otp.length !== 6) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1000));
    setLoading(false);
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
    const subscriptionTier = orgForm.plan === 'starter' || orgForm.plan === 'trial' ? 'free' : orgForm.plan === 'enterprise' ? 'premium' : 'standard';
    const orgCreatedAt = new Date().toISOString();
    const createdUser: AuthUser = {
      id: `usr-${Date.now()}`,
      fullName: `${signupForm.firstName} ${signupForm.lastName}`,
      email: signupForm.email,
      role: defaultRoleForOrganizationType(organizationType),
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
        {stage !== 'login' && stage !== 'org-signup-start' && stage !== 'provisioning' && stage !== 'welcome' && stage !== 'email-sent' && stage !== 'checking-session' && (
          <button 
            onClick={() => {
              setAuthError('');
              if (stage === 'org-signup-details') setStage('org-signup-start');
              if (stage === 'org-info') setStage(signupForm.provider === 'email' ? 'org-signup-details' : 'org-signup-start');
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
          <h1 className="text-[32px] md:text-[38px] font-semibold tracking-[-0.03em] mb-[20px] text-[var(--auth-text-primary)] font-inter animate-[auth-form-slide-up_0.4s_ease-out_both]">
            {stage === 'login' && 'Sign In'}
            {stage === 'org-signup-start' && 'Create Workspace'}
            {stage === 'org-signup-details' && 'Administrator Info'}
            {stage === 'org-info' && 'Organization Details'}
            {stage === 'subscription' && 'Choose Plan'}
            {stage === 'workspace-url' && 'Choose Your URL'}
            {stage === 'verify-email' && 'Verify Work Email'}
            {stage === 'welcome' && 'Workspace Ready'}
            {stage === 'forgot-password' && 'Reset your password'}
            {stage === 'reset-password' && 'Create new password'}
            {stage === 'email-sent' && 'Check your email'}
            {stage === 'workspace-select' && 'Choose Workspace'}
          </h1>
        )}

        {authError && <ErrorText text={authError} />}

        {/* ── Login Flow ─────────────────────────────────────────── */}
        {stage === 'login' && (
          <div className="animate-[auth-form-slide-up_0.5s_ease-out_both] flex flex-col gap-3">
            {detectedOrgName && (
              <div className="text-xs text-[var(--auth-accent)] bg-[var(--auth-accent)]/10 px-3 py-1.5 rounded-lg border border-[var(--auth-accent)]/20 mb-1 text-center animate-pulse">
                Signing into workspace: <span className="font-semibold">{detectedOrgName}</span>
              </div>
            )}
            <AuthField 
              value={loginForm.email} 
              onChange={(v) => setLoginForm(f => ({...f, email: v}))} 
              type="email" 
              placeholder="Work email address" 
            />
            <AuthField 
              value={loginForm.password} 
              onChange={(v) => setLoginForm(f => ({...f, password: v}))} 
              type="password" 
              placeholder="Password" 
            />
            
            <div className="flex justify-between items-center px-1 mt-[-2px]">
              <label className="flex items-center text-sm text-[var(--auth-text-secondary)] cursor-pointer hover:text-[var(--auth-text-primary)]">
                <input type="checkbox" className="mr-2 rounded border-[var(--auth-border)] bg-[var(--auth-input-bg)] text-[var(--auth-accent)] focus:ring-[var(--auth-accent)]" />
                Remember Me
              </label>
              <button 
                className="text-[14px] text-[var(--auth-text-secondary)] hover:text-[var(--auth-text-primary)] transition-colors"
                onClick={() => { setAuthError(''); setStage('forgot-password'); }}
              >
                Forgot Password?
              </button>
            </div>

            <div className="mt-[6px]">
              <AuthPrimaryButton 
                label="Sign In" 
                onClick={handleLogin} 
                loading={loading} 
              />
            </div>

            <TrustIndicator />
            <AuthDivider />

            <MicrosoftButton onClick={() => handleOAuth('microsoft')} disabled={loading} />
            <GoogleButton onClick={() => handleOAuth('google')} disabled={loading} />
            <AppleButton onClick={() => handleOAuth('apple')} disabled={loading} />

            <FooterLinks 
              primaryText="Registering a new organization?"
              actionText="Create Workspace"
              onAction={() => { setAuthError(''); setStage('org-signup-start'); }}
            />
          </div>
        )}

        {/* ── Org Signup 1: Auth Options ─────────────────────────── */}
        {stage === 'org-signup-start' && (
          <div className="animate-[auth-form-slide-up_0.5s_ease-out_both] flex flex-col gap-3">
            <p className="text-[var(--auth-text-secondary)] mb-1">Start setting up your enterprise workspace.</p>
            
            <MicrosoftButton onClick={() => handleOAuth('microsoft')} disabled={loading} />
            <GoogleButton onClick={() => handleOAuth('google')} disabled={loading} />
            <AppleButton onClick={() => handleOAuth('apple')} disabled={loading} />
            
            <AuthDivider />
            
            <EmailButton 
              label="Continue with work email"
              onClick={() => { 
                setAuthError(''); 
                setSignupForm(s => ({...s, provider: 'email'})); 
                setStage('org-signup-details'); 
              }} 
              disabled={loading} 
            />

            <TrustIndicator />

            <FooterLinks 
              primaryText="Already have an account?"
              actionText="Sign In"
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
            ) : (
            <div className="rounded-xl border border-[var(--auth-input-border)] bg-[var(--auth-input-bg)] p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div><p className="text-sm font-semibold text-[var(--auth-text-primary)]">{BRAND.network}</p><p className="text-[11px] text-[var(--auth-text-secondary)]">Referrals, transfers, and authorized exchange.</p></div>
                <button type="button" aria-pressed={networkForm.joinedNetwork} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${networkForm.joinedNetwork ? 'bg-[var(--auth-accent)] text-white' : 'bg-black/10 text-[var(--auth-text-secondary)]'}`} onClick={() => setNetworkForm((form) => ({ ...form, joinedNetwork: !form.joinedNetwork }))}>{networkForm.joinedNetwork ? 'Joined' : 'Join Network'}</button>
              </div>
              {networkForm.joinedNetwork && (
                <div className="space-y-3">
                  <label className="flex items-center justify-between gap-3 rounded-lg bg-black/5 px-3 py-2 text-xs text-[var(--auth-text-secondary)]"><span><span className="block font-medium text-[var(--auth-text-primary)]">Directory listing</span>Let other organizations find your facility.</span><input type="checkbox" className="h-4 w-4 accent-[var(--auth-accent)]" checked={networkForm.visibleInDirectory} onChange={(event) => setNetworkForm((form) => ({ ...form, visibleInDirectory: event.target.checked }))} /></label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <AuthField value={networkForm.specialties} onChange={(v) => setNetworkForm((form) => ({ ...form, specialties: v }))} placeholder="Specialties" />
                    <AuthField value={networkForm.services} onChange={(v) => setNetworkForm((form) => ({ ...form, services: v }))} placeholder="Services" />
                    <AuthField value={networkForm.location} onChange={(v) => setNetworkForm((form) => ({ ...form, location: v }))} placeholder="Location" />
                    <AuthField value={networkForm.facilityType} onChange={(v) => setNetworkForm((form) => ({ ...form, facilityType: v }))} placeholder="Facility type" />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {(['emergencyAvailable', 'laboratory', 'imaging', 'pharmacy', 'telemedicine', 'acceptingReferrals', 'acceptingTransfers'] as const).map((key) => (
                      <label key={key} className="flex items-center gap-1.5 rounded-lg bg-black/5 px-2 py-1.5 text-[11px] text-[var(--auth-text-secondary)] capitalize">
                        <input type="checkbox" checked={networkForm[key]} onChange={(event) => setNetworkForm((form) => ({ ...form, [key]: event.target.checked }))} />
                        {key.replace(/([A-Z])/g, ' $1')}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            )}

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
              Didn't receive the code? <button className="text-[var(--auth-text-primary)] hover:underline">Resend OTP</button>
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
              Your {workspaceLabel(pendingUser.workspaceType ?? 'healthcare').toLowerCase()} is ready. You are signed in as the {pendingUser.role.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}.
            </p>
            
            <AuthPrimaryButton 
              label="Enter Workspace" 
              onClick={() => authenticateSuccess(pendingUser)} 
            />
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
                await new Promise(r => setTimeout(r, 600));
                setLoading(false);
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
            <AuthPrimaryButton label="Simulate Opening Link" onClick={() => setStage('reset-password')} />
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
