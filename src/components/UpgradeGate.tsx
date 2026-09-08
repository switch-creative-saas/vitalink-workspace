import { Lock, ArrowLeft } from 'lucide-react';

interface UpgradeGateProps { moduleName: string; requiredPlan: string; description: string; features: string[]; onBack?: () => void; }

export function UpgradeGate({ moduleName, requiredPlan, description, features, onBack }: UpgradeGateProps) {
  const openSubscription = () => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { path: '/subscription?upgrade=true' } }));
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300"><Lock className="h-7 w-7" /></div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-slate-50">{moduleName}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{description}</p>
        <div className="mt-6 space-y-2 rounded-xl bg-slate-50 p-4 text-left dark:bg-slate-800/60">
          {features.map((feature) => <div key={feature} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><span className="font-semibold text-indigo-600 dark:text-indigo-300">+</span>{feature}</div>)}
        </div>
        <p className="mt-5 text-sm text-slate-600 dark:text-slate-400">Available on <span className="rounded-full bg-indigo-600 px-3 py-1 text-xs font-bold text-white">{requiredPlan}</span> and above</p>
        <button type="button" onClick={openSubscription} className="mt-6 w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-indigo-500">Upgrade plan</button>
        {onBack && <button type="button" onClick={onBack} className="mt-3 inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"><ArrowLeft className="h-4 w-4" />Go back</button>}
      </section>
    </div>
  );
}
