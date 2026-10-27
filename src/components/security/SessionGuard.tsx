// Enforces the workspace security policy in the browser: records the sign-in
// once per session, signs out after the idle timeout (with a one-minute
// warning), and returns to sign-in when this session is ended elsewhere.
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { requireSupabase } from '@/lib/supabase/client';
import { getSecurityPolicy, recordSignInOnce } from '@/lib/supabase/security';

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;
const WARN_BEFORE_MS = 60_000;

export function SessionGuard({ organizationId, onSignOut }: { organizationId: string; onSignOut: (reason: string) => void }) {
  const signOutRef = useRef(onSignOut);
  useEffect(() => { signOutRef.current = onSignOut; }, [onSignOut]);

  useEffect(() => { void recordSignInOnce().catch(() => undefined); }, []);

  // Ended from another device or by an admin: the next token refresh fails and Supabase signs out.
  useEffect(() => {
    const { data } = requireSupabase().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') signOutRef.current('Your session has ended. Please sign in again.');
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let idleMs = 0;
    let lastActivity = Date.now();
    let warned = false;
    let cancelled = false;
    let timer: number | undefined;

    const onActivity = () => {
      lastActivity = Date.now();
      if (warned) { warned = false; toast.dismiss('idle-warning'); }
    };
    const tick = () => {
      if (!idleMs) return;
      const idle = Date.now() - lastActivity;
      if (idle >= idleMs) {
        toast.dismiss('idle-warning');
        signOutRef.current('You were signed out after a period of inactivity.');
        return;
      }
      if (!warned && idle >= idleMs - WARN_BEFORE_MS) {
        warned = true;
        toast.warning('You will be signed out in a minute for inactivity. Move the mouse or press a key to stay signed in.', { id: 'idle-warning', duration: WARN_BEFORE_MS });
      }
    };

    getSecurityPolicy(organizationId).then((policy) => {
      if (cancelled || !policy?.idleTimeoutMinutes) return;
      idleMs = policy.idleTimeoutMinutes * 60_000;
      ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
      timer = window.setInterval(tick, 15_000);
    }).catch(() => undefined);

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [organizationId]);

  return null;
}
