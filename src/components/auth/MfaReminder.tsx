// Standing reminder at the top of the workspace for anyone without two-step verification. It is
// optional, so nobody is blocked, but it stays until it's set up (it can't be dismissed).
import { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { getMfaStatus, MFA_CHANGED_EVENT } from '@/lib/supabase/mfa';

export function MfaReminder() {
  const [show, setShow] = useState(false);
  const check = useCallback(() => {
    getMfaStatus().then((status) => setShow(!status.enrolled)).catch(() => setShow(false));
  }, []);

  useEffect(() => {
    const first = window.setTimeout(check, 0);
    window.addEventListener(MFA_CHANGED_EVENT, check);
    return () => { window.clearTimeout(first); window.removeEventListener(MFA_CHANGED_EVENT, check); };
  }, [check]);

  if (!show) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-200 bg-amber-50 px-[var(--page-padding)] py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">Set up two-step verification (2FA) to further protect your account.</span>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { path: '/settings?tab=security' } }))}
        className="shrink-0 rounded-full bg-amber-600 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-amber-700"
      >
        Set up 2FA
      </button>
    </div>
  );
}
