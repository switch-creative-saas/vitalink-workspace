// Subscription & billing on live data: the workspace's plan and usage against its limits, every
// plan (upgrades go through Paystack), and the VitaLink Sentinel add-on for Starter and Growth.
import { useCallback, useEffect, useState } from 'react';
import { Activity, CheckCircle2, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { BRAND } from '@/config/brand';
import { useAuth } from '@/contexts/AuthContext';
import { startCheckout } from '@/lib/supabase/auth';
import { getEntitlements, listAddons, listPlans, startAddonCheckout, type AddonInfo, type Entitlements, type PlanInfo } from '@/lib/supabase/plans';
import { syncWorkspacePlan } from '@/lib/workspace/planSync';

const ADMIN_ROLES = ['super-admin', 'hospital-admin', 'ngo-admin', 'government-admin'];
const naira = (amount: number) => `₦${amount.toLocaleString('en-NG')}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

const STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: 'Active', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  trialing: { label: 'Free trial', tone: 'bg-sky-50 text-sky-700 border-sky-200' },
  comped: { label: 'Complimentary', tone: 'bg-violet-50 text-violet-700 border-violet-200' },
  pending_payment: { label: 'Awaiting payment', tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  past_due: { label: 'Payment overdue', tone: 'bg-red-50 text-red-700 border-red-200' },
  cancelled: { label: 'Cancelled', tone: 'bg-slate-100 text-slate-600 border-slate-200' },
};

function Usage({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const unlimited = limit == null;
  const pct = unlimited || limit === 0 ? 0 : Math.min(100, (used / limit) * 100);
  const full = !unlimited && used >= (limit ?? 0);
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs"><span className="text-slate-600 dark:text-slate-400">{label}</span>
        <span className={cn('font-semibold', full ? 'text-red-600' : 'text-slate-900 dark:text-slate-50')}>{used.toLocaleString()} / {unlimited ? 'Unlimited' : limit === 0 ? 'Not included' : limit?.toLocaleString()}</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={cn('h-full rounded-full', full ? 'bg-red-500' : pct > 80 ? 'bg-amber-500' : 'bg-[#1E4ED8]')} style={{ width: unlimited ? '100%' : `${pct}%`, opacity: unlimited ? 0.25 : 1 }} />
      </div>
    </div>
  );
}

export function LiveSubscription() {
  const { organization, currentRole } = useAuth();
  const isAdmin = ADMIN_ROLES.includes(currentRole);
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [addons, setAddons] = useState<AddonInfo[]>([]);
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [busy, setBusy] = useState<string | null>(null);
  const [highlightSentinel] = useState(() => new URLSearchParams(window.location.search).get('addon') === 'sentinel');

  const load = useCallback(() => {
    Promise.all([listPlans(), listAddons(), getEntitlements(organization.id)])
      .then(([p, a, e]) => { setPlans(p); setAddons(a); setEnt(e); if (e.billingCycle === 'annual') setCycle('annual'); })
      .catch((error) => toast.error(errorText(error, 'Could not load your subscription')));
  }, [organization.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!highlightSentinel || !ent) return;
    document.getElementById('sentinel-addon')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightSentinel, ent]);

  const refresh = async () => { await syncWorkspacePlan(organization.id).catch(() => null); load(); };

  const choosePlan = async (plan: PlanInfo) => {
    setBusy(plan.id);
    try {
      const result = await startCheckout(organization.id, plan.id, cycle);
      if (result.comped) { toast.success(`${plan.name} activated (platform admin).`); await refresh(); return; }
      if (result.authorizationUrl) window.location.assign(result.authorizationUrl); // returns to /payment-callback
    } catch (error) {
      toast.error(errorText(error, 'Could not start the payment'));
    } finally {
      setBusy(null);
    }
  };

  const addSentinel = async () => {
    setBusy('sentinel');
    try {
      const result = await startAddonCheckout(organization.id, 'sentinel');
      if (result.comped) { toast.success('Sentinel added (platform admin).'); await refresh(); return; }
      if (result.authorizationUrl) window.location.assign(result.authorizationUrl);
    } catch (error) {
      toast.error(errorText(error, 'Could not start the payment'));
    } finally {
      setBusy(null);
    }
  };

  if (!ent) return <div className="grid min-h-[50vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>;

  const current = plans.find((p) => p.id === ent.effectivePlanId);
  const currentIndex = plans.findIndex((p) => p.id === ent.effectivePlanId);
  const status = STATUS[ent.status] ?? STATUS.active;
  const sentinel = addons.find((a) => a.id === 'sentinel');
  const sentinelEligible = sentinel?.eligiblePlans.includes(ent.effectivePlanId) ?? false;
  const pendingPlan = ent.status === 'pending_payment' && ent.planId !== ent.effectivePlanId ? plans.find((p) => p.id === ent.planId) : null;

  return (
    <div className="w-full space-y-6 page-transition">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Subscription & Billing</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Your plan, what you’re using, and add-ons. Payments are processed securely by Paystack.</p>
        </div>
        <div className="flex rounded-full border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
          {(['monthly', 'annual'] as const).map((value) => (
            <button key={value} type="button" onClick={() => setCycle(value)} className={cn('rounded-full px-4 py-1.5 text-sm font-semibold transition', cycle === value ? 'bg-[#1E4ED8] text-white' : 'text-slate-600 dark:text-slate-300')}>
              {value === 'monthly' ? 'Monthly' : 'Annual · 2 months free'}
            </button>
          ))}
        </div>
      </div>

      <section data-tour-id="subscription-current" className="grid gap-6 rounded-2xl border border-slate-200 bg-white p-6 lg:grid-cols-[1fr_1.2fr] dark:border-slate-700 dark:bg-slate-900">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Current plan</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{current?.name ?? 'Free'}</h2>
            <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-semibold', status.tone)}>{status.label}</span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{current?.tagline}</p>
          <p className="mt-3 text-sm text-slate-700 dark:text-slate-300">
            {ent.status === 'trialing' && ent.currentPeriodEnd && <>Trial ends {day(ent.currentPeriodEnd)}. After that the workspace moves to Free unless you choose a plan.</>}
            {ent.status === 'active' && ent.currentPeriodEnd && <>{ent.renews ? 'Renews' : 'Paid until'} {day(ent.currentPeriodEnd)} · billed {ent.billingCycle}.</>}
            {ent.status === 'active' && !ent.currentPeriodEnd && ent.effectivePlanId === 'free' && <>Free forever. Upgrade any time.</>}
            {ent.status === 'comped' && <>Provided by VitaLink at no charge.</>}
            {ent.status === 'past_due' && <>Your last renewal didn’t go through. Pay again below to keep your plan.</>}
          </p>
          {pendingPlan && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{pendingPlan.name} is waiting for payment. Choose it below to pay and activate it.</p>}
        </div>
        <div className="space-y-3">
          <Usage label="Staff accounts (including pending invitations)" used={ent.usage.staff} limit={ent.limits.staff} />
          <Usage label="Patient records" used={ent.usage.patients} limit={ent.limits.patients} />
          <Usage label="Pharmacy drug SKUs" used={ent.usage.drugSkus} limit={ent.limits.drugSkus} />
          <p className="text-xs text-slate-500">{ent.limits.smsReminders ? 'SMS appointment reminders included.' : 'SMS appointment reminders are not included on this plan.'}{ent.limits.nfcCardsIncluded ? ` ${ent.limits.nfcCardsIncluded} NFC cards included.` : ''}</p>
        </div>
      </section>

      {!isAdmin && <p className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300"><Lock className="h-4 w-4" />Only workspace admins can change the plan or add Sentinel.</p>}

      <section data-tour-id="subscription-plans" className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-4">
        {plans.map((plan, index) => {
          const isCurrent = plan.id === ent.effectivePlanId && ent.status !== 'trialing';
          const price = cycle === 'annual' && plan.annualPrice ? plan.annualPrice : plan.monthlyPrice;
          const popular = plan.id === 'growth';
          return (
            <article key={plan.id} className={cn('relative flex flex-col rounded-2xl border p-6 sm:p-7', isCurrent ? 'border-[#1E4ED8] bg-[#1E4ED8]/5' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900')}>
              {popular && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#1E4ED8] px-3 py-1 text-[11px] font-bold text-white">Most popular</span>}
              <h3 className="text-xl font-bold text-slate-900 dark:text-slate-50">{plan.name}</h3>
              <p className="mt-1 min-h-10 text-sm text-slate-600 dark:text-slate-400">{plan.tagline}</p>
              <div className="my-4">
                {plan.id === 'enterprise'
                  ? <><span className="text-2xl font-bold text-slate-900 dark:text-slate-50">Custom</span><p className="mt-1 text-xs text-slate-500">From {naira(plan.annualPrice ?? 0)}/year, invoiced annually</p></>
                  : <><span className="text-2xl font-bold text-slate-900 dark:text-slate-50">{plan.monthlyPrice ? naira(price) : '₦0'}</span><span className="ml-1 text-sm text-slate-500">{plan.monthlyPrice ? (cycle === 'annual' ? '/year' : '/month') : '/month'}</span>
                    {plan.monthlyPrice > 0 && cycle === 'annual' && <p className="mt-1 text-xs text-emerald-700">2 months free vs monthly</p>}</>}
              </div>
              <ul className="grid gap-x-6 gap-y-2 lg:grid-cols-2 2xl:grid-cols-1">
                {plan.features.map((feature) => (
                  <li key={feature} className={cn('flex gap-2 text-sm', feature.endsWith(':') ? 'font-semibold lg:col-span-2 2xl:col-span-1 text-slate-900 dark:text-slate-50' : feature.startsWith('No ') ? 'text-slate-400' : 'text-slate-700 dark:text-slate-300')}>
                    {!feature.endsWith(':') && <CheckCircle2 className={cn('mt-0.5 h-4 w-4 shrink-0', feature.startsWith('No ') ? 'opacity-30' : 'text-emerald-600')} />}{feature}
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-5">
                {isCurrent ? <button type="button" disabled className="w-full rounded-full bg-slate-100 py-2.5 text-sm font-semibold text-slate-500 dark:bg-slate-800">Current plan</button>
                  : plan.id === 'enterprise' ? <a href={`mailto:${BRAND.supportEmail}?subject=${encodeURIComponent(`Enterprise plan for ${organization.name}`)}`} className="flex w-full items-center justify-center gap-2 rounded-full border border-[#1E4ED8] py-2.5 text-sm font-semibold text-[#1E4ED8] hover:bg-[#1E4ED8]/5"><Mail className="h-4 w-4" />Contact sales</a>
                  : plan.id === 'free' ? <p className="text-center text-xs text-slate-500">To move to Free, cancel your plan’s renewal; you keep it until the end of the period.</p>
                  : <button type="button" disabled={!isAdmin || busy !== null} onClick={() => void choosePlan(plan)} className="flex w-full items-center justify-center gap-2 rounded-full bg-[#1E4ED8] py-2.5 text-sm font-semibold text-white transition hover:bg-[#1A43BD] disabled:opacity-50">
                      {busy === plan.id && <Loader2 className="h-4 w-4 animate-spin" />}{ent.status === 'trialing' && plan.id === ent.effectivePlanId ? `Keep ${plan.name} after trial` : index > currentIndex ? `Upgrade to ${plan.name}` : `Switch to ${plan.name}`}
                    </button>}
              </div>
            </article>
          );
        })}
      </section>

      {sentinel && (
        <section id="sentinel-addon" className={cn('rounded-2xl border p-6 transition-colors', highlightSentinel ? 'border-purple-500 bg-purple-50 dark:bg-purple-500/10' : 'border-purple-200 bg-purple-50/60 dark:border-purple-500/30 dark:bg-purple-500/5')}>
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
            <div className="flex gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-500/15 text-purple-700 dark:text-purple-300"><Activity className="h-5 w-5" /></div>
              <div>
                <h2 className="font-bold text-slate-900 dark:text-slate-50">{sentinel.name} <span className="ml-1 rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-semibold text-purple-700 dark:text-purple-200">Add-on</span></h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">{sentinel.description}</p>
                <p className="mt-2 text-xs text-purple-700 dark:text-purple-300">Included in Enterprise. Growth includes a read-only view.</p>
              </div>
            </div>
            <div className="shrink-0 lg:text-right">
              {ent.sentinelAccess === 'full' ? (
                <p className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700">
                  <ShieldCheck className="h-4 w-4" />
                  {ent.effectivePlanId === 'enterprise' ? 'Included in your plan' : ent.sentinelAddon?.status === 'comped' ? 'Active (complimentary)' : `Active${ent.sentinelAddon?.currentPeriodEnd ? ` · ${ent.sentinelAddon.renews ? 'renews' : 'until'} ${day(ent.sentinelAddon.currentPeriodEnd)}` : ''}`}
                </p>
              ) : sentinelEligible ? (
                <>
                  <p className="text-2xl font-bold text-slate-900 dark:text-slate-50">{naira(sentinel.monthlyPrice)}<span className="ml-1 text-sm font-normal text-slate-500">/month</span></p>
                  <button type="button" disabled={!isAdmin || busy !== null} onClick={() => void addSentinel()} className="mt-3 inline-flex items-center gap-2 rounded-full bg-purple-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-purple-500 disabled:opacity-50">
                    {busy === 'sentinel' && <Loader2 className="h-4 w-4 animate-spin" />}Add Sentinel
                  </button>
                  {ent.sentinelAddon?.status === 'past_due' && <p className="mt-2 text-xs text-red-600">Your last Sentinel renewal didn’t go through.</p>}
                </>
              ) : (
                <p className="max-w-xs text-sm text-slate-600 dark:text-slate-400">Available on Starter and Growth. Upgrade your plan first, then add Sentinel for {naira(sentinel.monthlyPrice)}/month.</p>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
