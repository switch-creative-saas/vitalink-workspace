// Two-step verification screens. <MfaGate /> sits above the app (and the console) and appears
// whenever a sign-in flow is waiting in waitForMfa(): the code prompt for people with an
// authenticator app, or mandatory set-up for roles that require it. <TotpSetup /> is also used
// from Settings.
import { useEffect, useState } from 'react';
import { Copy, KeyRound, Loader2, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { requireSupabase } from '@/lib/supabase/client';
import { cancelMfa, finishMfa, onMfaRequest, startTotpEnrollment, verifySignInCode, verifyTotp, type MfaNeed, type MfaReason, type TotpEnrollment } from '@/lib/supabase/mfa';

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

export function CodeInput({ value, onChange, onSubmit, autoFocus = true }: { value: string; onChange: (v: string) => void; onSubmit: () => void; autoFocus?: boolean }) {
  return (
    <input
      autoFocus={autoFocus}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      aria-label="6-digit code"
      placeholder="000000"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      onKeyDown={(e) => { if (e.key === 'Enter' && value.length === 6) onSubmit(); }}
      className="h-14 w-full rounded-2xl border border-slate-200 bg-white text-center font-mono text-2xl tracking-[0.5em] text-slate-900 outline-none focus:border-[#1E4ED8] focus:ring-2 focus:ring-[#1E4ED8]/15 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
    />
  );
}

/** Scan, then confirm a code. Calls onDone once the new authenticator is verified. */
export function TotpSetup({ onDone, compact = false }: { onDone: () => void; compact?: boolean }) {
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    let cancelled = false;
    startTotpEnrollment()
      .then((e) => { if (!cancelled) setEnrollment(e); })
      .catch((error) => { if (!cancelled) setFailed(errorText(error, 'Could not start set-up')); });
    return () => { cancelled = true; };
  }, []);

  const confirm = async () => {
    if (!enrollment || code.length !== 6) return;
    setBusy(true);
    try {
      await verifyTotp(enrollment.factorId, code);
      toast.success('Two-step verification is on');
      onDone();
    } catch (error) {
      toast.error(errorText(error, 'Could not verify the code'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (failed) return <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{failed}</p>;
  if (!enrollment) return <div className="grid place-items-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;

  return (
    <div className={cn('grid gap-6', !compact && 'sm:grid-cols-[200px_1fr]')}>
      <div className="mx-auto">
        <img src={enrollment.qrCode} alt="QR code for your authenticator app" className="h-48 w-48 rounded-2xl border border-slate-200 bg-white p-2" />
      </div>
      <div className="space-y-4">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-600 dark:text-slate-300">
          <li>Open an authenticator app: Google Authenticator, Microsoft Authenticator or Authy.</li>
          <li>Add an account and scan this QR code.</li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
        <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <p className="mb-1 font-medium">Can’t scan? Enter this key instead:</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all font-mono text-[11px]">{enrollment.secret}</code>
            <button type="button" aria-label="Copy key" onClick={() => void navigator.clipboard?.writeText(enrollment.secret).then(() => toast.success('Key copied'))} className="rounded-lg p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700"><Copy className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        <CodeInput value={code} onChange={setCode} onSubmit={() => void confirm()} />
        <button type="button" disabled={busy || code.length !== 6} onClick={() => void confirm()}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#1E4ED8] text-sm font-semibold text-white transition hover:bg-[#1A43BD] disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}Turn on two-step verification
        </button>
      </div>
    </div>
  );
}

function SignInCode({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (code.length !== 6) return;
    setBusy(true);
    try {
      await verifySignInCode(code);
      onDone();
    } catch (error) {
      toast.error(errorText(error, 'Could not verify the code'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <CodeInput value={code} onChange={setCode} onSubmit={() => void submit()} />
      <button type="button" disabled={busy || code.length !== 6} onClick={() => void submit()}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#1E4ED8] text-sm font-semibold text-white transition hover:bg-[#1A43BD] disabled:opacity-50">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}Verify
      </button>
      <p className="text-center text-xs text-slate-500">This browser will be remembered, so you won’t be asked again here unless it goes unused for 14 days.</p>
      <p className="text-center text-xs text-slate-500">Lost your phone? Ask your workspace admin (or VitaLink support) to reset two-step verification for your account.</p>
    </div>
  );
}

/** Full-screen step shown while a sign-in waits on two-step verification. */
export function MfaGate() {
  const [need, setNeed] = useState<MfaNeed>('none');
  const [reason, setReason] = useState<MfaReason>('signin');
  useEffect(() => onMfaRequest((next, why) => { setNeed(next); setReason(why); }), []);
  if (need === 'none') return null;
  const title = need === 'enroll' ? 'Set up two-step verification'
    : reason === 'idle' ? 'Welcome back' : reason === 'records' ? 'Verify to open patient records' : 'Enter your verification code';
  const intro = need === 'enroll'
    ? 'Your role can see patient records, so VitaLink requires a code from your phone as well as your password.'
    : reason === 'idle' ? 'You were away for a while. Enter the 6-digit code from your authenticator app to keep working with patient records.'
    : reason === 'records' ? 'Patient records need the 6-digit code from your authenticator app. You stay verified while you keep working.'
    : 'Open your authenticator app and enter the 6-digit code for VitaLink.';

  const signOut = async () => {
    await requireSupabase().auth.signOut({ scope: 'local' }).catch(() => undefined);
    cancelMfa();
  };

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-[#f4f6fb] dark:bg-slate-950">
      <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-5 py-10">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#1E4ED8] text-white">{need === 'enroll' ? <ShieldCheck className="h-6 w-6" /> : <Smartphone className="h-6 w-6" />}</div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">{title}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">{intro}</p>
          </div>
        </div>
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          {need === 'enroll' ? <TotpSetup onDone={finishMfa} /> : <SignInCode onDone={finishMfa} />}
        </div>
        <div className="mt-5 flex items-center justify-center gap-6">
          {reason !== 'signin' && (
            <button type="button" onClick={() => cancelMfa('declined')} className="text-sm font-medium text-[#1E4ED8] hover:underline">
              Not now
            </button>
          )}
          <button type="button" onClick={() => void signOut()} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
            <LogOut className="h-4 w-4" />Sign out
          </button>
        </div>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400"><KeyRound className="h-3.5 w-3.5" />Codes change every 30 seconds and work only on this account.</p>
      </div>
    </div>
  );
}
