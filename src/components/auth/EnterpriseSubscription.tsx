import { Check, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { FREE_PLAN, FREE_TRIAL, PRICING_TIERS, type PricingTierId } from '@/data/pricingTiers';
import { saveWorkspacePlan } from '@/hooks/usePlan';

interface EnterpriseSubscriptionProps {
  onSelect: (planId: PricingTierId | 'free' | 'trial', billingCycle: 'monthly' | 'annual') => void;
  onContactSales: () => void;
}

export function EnterpriseSubscription({ onSelect, onContactSales }: EnterpriseSubscriptionProps) {
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('annual');
  const [selectedPlan, setSelectedPlan] = useState<PricingTierId>('growth');
  const selectPlan = () => {
    const tier = PRICING_TIERS.find((item) => item.id === selectedPlan)!;
    saveWorkspacePlan({ tierId: tier.id, tierName: tier.name, billingCycle, price: billingCycle === 'annual' ? tier.annualPrice : tier.monthlyPrice, modules: tier.modules, sentinelIncluded: tier.sentinelIncluded });
    onSelect(tier.id, billingCycle);
  };
  const startTrial = () => {
    saveWorkspacePlan({
      tierId: 'trial', tierName: FREE_TRIAL.name, billingCycle: 'trial', price: 0,
      modules: FREE_TRIAL.modules, sentinelIncluded: false, isTrialActive: true,
      trialEndDate: new Date(Date.now() + FREE_TRIAL.durationDays * 24 * 60 * 60 * 1000).toISOString(),
    });
    onSelect('trial', 'monthly');
  };
  const startFree = () => {
    saveWorkspacePlan({ tierId: 'free', tierName: FREE_PLAN.name, billingCycle: 'monthly', price: 0, modules: FREE_PLAN.modules, sentinelIncluded: false });
    onSelect('free', 'monthly');
  };

  return <div className="w-full animate-[auth-form-slide-up_0.5s_ease-out_both]">
    <div className="mb-4 flex items-center justify-center gap-1 rounded-lg bg-[var(--auth-input-bg)] p-1">
      {(['monthly', 'annual'] as const).map((cycle) => <button key={cycle} type="button" onClick={() => setBillingCycle(cycle)} className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors ${billingCycle === cycle ? 'bg-[var(--auth-accent)] text-white' : 'text-[var(--auth-text-secondary)] hover:text-[var(--auth-text-primary)]'}`}>{cycle === 'monthly' ? 'Monthly' : 'Annual (save 15%)'}</button>)}
    </div>
    <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-500"><Sparkles className="h-4 w-4" /></span><div><p className="text-sm font-semibold text-[var(--auth-text-primary)]">Start with a 14-day free trial</p><p className="text-[11px] text-[var(--auth-text-secondary)]">Full Growth Corridor access, then the Free plan unless you upgrade. No card required.</p></div></div>
      <button type="button" onClick={startTrial} className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500">Start Free Trial</button>
    </div>
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[var(--auth-border)] bg-[var(--auth-input-bg)] p-3">
      <div className="flex min-w-0 items-center gap-3"><div><p className="text-sm font-semibold text-[var(--auth-text-primary)]">Or start on the Free plan</p><p className="text-[11px] text-[var(--auth-text-secondary)]">{FREE_PLAN.description} No card required.</p></div></div>
      <button type="button" onClick={startFree} className="shrink-0 rounded-lg border border-[var(--auth-border)] px-3 py-2 text-xs font-semibold text-[var(--auth-text-primary)] transition-colors hover:bg-[var(--auth-border)]">Continue Free</button>
    </div>
    <div className="grid items-start gap-3 md:grid-cols-3">
      {PRICING_TIERS.map((tier) => {
        const selected = tier.id === selectedPlan;
        const price = billingCycle === 'annual' ? tier.monthlyEffective : tier.monthlyPrice;
        return <div key={tier.id} className="relative h-full pt-3">
          {tier.highlighted && <span className="absolute left-1/2 top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--auth-accent)] px-3 py-1 text-[8px] font-bold uppercase tracking-wider text-white">Most popular</span>}
          <div className={`flex h-full min-w-0 flex-col rounded-xl border p-3 pt-5 text-left transition-all ${selected ? 'border-[var(--auth-accent)] bg-[var(--auth-accent)]/10' : 'border-[var(--auth-border)] bg-[var(--auth-input-bg)]'} ${tier.id === 'enterprise' ? '' : 'cursor-pointer hover:border-[var(--auth-accent)]/40'}`} onClick={() => tier.id !== 'enterprise' && setSelectedPlan(tier.id)}>
            <h3 className="text-xs font-semibold text-[var(--auth-text-primary)]">{tier.name}</h3><p className="mt-1 min-h-8 text-[10px] text-[var(--auth-text-secondary)]">{tier.tagline}</p>
            <div className="my-2"><span className="text-lg font-bold text-[var(--auth-text-primary)]">{price ? `N${price.toLocaleString()}` : 'Custom'}</span><span className="ml-1 text-[9px] text-[var(--auth-text-secondary)]">/mo</span><p className="text-[9px] text-[var(--auth-text-secondary)]">+ N{tier.hardwareFee.toLocaleString()} setup</p></div>
            <div className="space-y-1">{tier.features.slice(0, 5).map((feature) => <div key={feature.name} className="flex gap-1.5 text-[10px] leading-relaxed text-[var(--auth-text-secondary)]">{feature.included ? <Check className="mt-0.5 h-3 w-3 shrink-0 text-[var(--auth-accent)]" /> : <X className="mt-0.5 h-3 w-3 shrink-0 opacity-40" />}<span>{feature.name}</span></div>)}</div>
            <button type="button" onClick={(event) => { event.stopPropagation(); tier.id === 'enterprise' ? onContactSales() : setSelectedPlan(tier.id); }} className={`mt-auto pt-3 text-left text-[10px] font-medium ${tier.id === 'enterprise' ? 'text-purple-500 hover:underline' : 'text-[var(--auth-accent)] hover:underline'}`}>+ {tier.features.length - 5} more features</button>
            {tier.id === 'enterprise' ? <button type="button" onClick={onContactSales} className="mt-2 w-full rounded-lg border border-purple-500/50 py-2 text-[10px] font-semibold text-purple-500 transition-colors hover:bg-purple-500/10">Contact Sales</button> : <button type="button" onClick={() => setSelectedPlan(tier.id)} className={`mt-2 w-full rounded-lg py-2 text-[10px] font-semibold ${selected ? 'bg-[var(--auth-accent)] text-white' : 'bg-[var(--auth-border)] text-[var(--auth-text-primary)] hover:bg-[var(--auth-accent)]/15'}`}>{selected ? 'Selected' : tier.ctaLabel}</button>}
          </div>
        </div>;
      })}
    </div>
    <p className="mt-3 text-center text-[10px] text-[var(--auth-text-secondary)]">NFC VitaCards: N2,500 per bulk card. Minimum 100 cards for Starter/Growth and 500 for Enterprise.</p>
    <button type="button" onClick={selectPlan} className="mt-3 h-10 w-full rounded-xl bg-[var(--auth-accent)] text-xs font-bold text-white transition-colors hover:bg-[var(--auth-accent-hover)]">Continue to payment: {PRICING_TIERS.find((tier) => tier.id === selectedPlan)?.name}</button>
    <p className="mt-2 text-center text-[10px] text-[var(--auth-text-secondary)]">You'll pay the first {billingCycle === 'annual' ? 'year' : 'month'} plus the one-time setup fee securely with Paystack after your workspace is created.</p>
  </div>;
}
