import { useState, useEffect } from 'react';
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
import { AlertCircle, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
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
};

interface AuthGatewayPageProps {
  onAuthenticated: (payload: { role: UserRole; name: string; email: string; redirectPage: PageType }) => void;
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

function roleRedirect(_role: UserRole): PageType {
  // All roles land on dashboard; the dashboard renders role-specific content
  return 'dashboard';
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
  const [stage, setStage] = useState<Stage>('checking-session');
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  
  const [pendingUser, setPendingUser] = useState<AuthUser | null>(null);
  const [pendingUsers, setPendingUsers] = useState<AuthUser[]>([]);
  const [detectedOrgName, setDetectedOrgName] = useState<string | null>(null);

  // ── Mount: Check for existing session ─────────────────────────────
  useEffect(() => {
    // Detect URL workspace slug
    const urlSlug = getActiveSlugFromURL();
    if (urlSlug) {
      const name = getOrgFromSlug(urlSlug);
      setDetectedOrgName(name || urlSlug.toUpperCase());
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
          setTimeout(() => {
            onAuthenticated({
              role: sessionUser.role,
              name: sessionUser.fullName,
              email: sessionUser.email,
              redirectPage: roleRedirect(sessionUser.role),
            });
          }, 700);
          return;
        }
      }
    }

    // No valid session — show the login page
    setStage('login');
  }, [onAuthenticated]);

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
    
    window.dispatchEvent(new CustomEvent('vitalink:notify', { detail: { module: 'auth', type: 'login-success', message: 'Secure enterprise session started' } }));
    onAuthenticated({ role: user.role, name: user.fullName, email: user.email, redirectPage: roleRedirect(user.role) });
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
    const tenantId = `tenant-${Math.random().toString(36).substr(2, 9)}`;
    const createdUser: AuthUser = {
      id: `usr-${Date.now()}`,
      fullName: `${signupForm.firstName} ${signupForm.lastName}`,
      email: signupForm.email,
      role: 'super-admin',
      passwordHash: await hashPassword(signupForm.password),
      provider: signupForm.provider,
      onboardingComplete: true,
      tenantId,
      orgSlug,
    };
    
    setUsers([createdUser, ...getUsers()]);
    setPendingUser(createdUser);
    localStorage.removeItem('vitalink-pending-slug');
    setStage('welcome');
    toast.success('Workspace created successfully!');
  };

  return (
    <AuthLayout wide={stage === 'subscription'}>
      {/* ── Session Check Loading ─────────────────────────── */}
      {stage === 'checking-session' && <SessionCheckScreen />}

      <div className="flex flex-col w-full h-full justify-center">
        
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
                {['Hospital', 'Clinic', 'NGO', 'HMO', 'Insurance', 'Laboratory', 'Pharmacy', 'Government', 'Corporate Healthcare', 'University'].map(o => (
                  <option key={o} value={o}>{o}</option>
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

            <Button 
              className="w-full h-[48px] rounded-full bg-[var(--auth-accent)] hover:bg-[var(--auth-accent-hover)] text-white mt-2 font-semibold text-[14px] shadow-[0_0_15px_rgba(123,77,255,0.25)]"
              onClick={handleOrgInfo}
            >
              Continue to Plans <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </div>
        )}

        {/* ── Org Signup 4: Subscription ─────────────────────────── */}
        {stage === 'subscription' && (
          <div className="w-full">
            <EnterpriseSubscription onSelect={handleSubscriptionSelect} />
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
              Your enterprise workspace is ready. You are signed in as the Super Administrator.
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
                setLoading(true);
                await new Promise(r => setTimeout(r, 600));
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
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
