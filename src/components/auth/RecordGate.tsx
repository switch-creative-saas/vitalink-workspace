// Wraps pages that show patient records. For people who use two-step verification, the code is
// asked the first time records are opened in a sign-in (and after a long break); everyone else
// goes straight in. "Not now" goes back to the dashboard. The database enforces the same rule.
import { useEffect, useState, type ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ensureRecordAccess, RECORDS_DECLINED_EVENT } from '@/lib/supabase/mfa';

export function RecordGate({ children, onDecline }: { children: ReactNode; onDecline: () => void }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ensureRecordAccess()
      .then(() => { if (!cancelled) setReady(true); })
      .catch(() => { if (!cancelled) onDecline(); });
    // Declining the code after a long break, while on a records page, also leaves it.
    const declined = () => onDecline();
    window.addEventListener(RECORDS_DECLINED_EVENT, declined);
    return () => { cancelled = true; window.removeEventListener(RECORDS_DECLINED_EVENT, declined); };
  }, [onDecline]);

  if (!ready) {
    return (
      <div className="grid place-items-center py-24 text-sm text-slate-500">
        <ShieldCheck className="mb-2 h-6 w-6 text-slate-300" />
        Checking access to patient records…
      </div>
    );
  }
  return <>{children}</>;
}
