import { useCallback, useEffect, useMemo, useState } from 'react';
import { FREE_PLAN, FREE_TRIAL, PRICING_TIERS, type PricingTierId } from '@/data/pricingTiers';
import { isSupabaseConfigured } from '@/lib/supabase/client';

export type WorkspacePlan = { tierId: PricingTierId | 'trial' | 'free'; tierName: string; billingCycle: 'monthly' | 'annual' | 'trial'; status?: string; price: number | null; modules: string[]; sentinelIncluded: boolean; sentinelAddon?: boolean; isTrialActive?: boolean; trialEndDate?: string };
const PLAN_CHANGE_EVENT = 'vitalink:workspace-plan-changed';

function readPlan(): WorkspacePlan | null {
  try { return JSON.parse(localStorage.getItem('workspace_plan') ?? 'null') as WorkspacePlan | null; } catch { return null; }
}

export function saveWorkspacePlan(plan: WorkspacePlan) {
  localStorage.setItem('workspace_plan', JSON.stringify(plan));
  window.dispatchEvent(new Event(PLAN_CHANGE_EVENT));
}

export function usePlan() {
  const [plan, setPlan] = useState<WorkspacePlan | null>(readPlan);
  useEffect(() => {
    const refresh = () => setPlan(readPlan());
    window.addEventListener(PLAN_CHANGE_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener(PLAN_CHANGE_EVENT, refresh); window.removeEventListener('storage', refresh); };
  }, []);
  const tier = useMemo(() => PRICING_TIERS.find((item) => item.id === (plan?.tierId === 'trial' ? 'growth' : plan?.tierId)) ?? PRICING_TIERS[0], [plan?.tierId]);
  const isTrialActive = Boolean(plan?.isTrialActive && plan.trialEndDate && new Date(plan.trialEndDate).getTime() > Date.now());
  const isFree = plan?.tierId === 'free';
  // With Supabase the module list comes from the workspace's plan row (synced at sign-in).
  const liveModules = isSupabaseConfigured ? plan?.modules : undefined;
  const hasModule = useCallback(
    (moduleId: string) => (liveModules ?? (isTrialActive ? FREE_TRIAL.modules : isFree ? FREE_PLAN.modules : tier.modules)).includes(moduleId),
    [liveModules, isTrialActive, isFree, tier.modules],
  );
  // Full Sentinel access: Enterprise, or the add-on (both synced from the server when Supabase is on).
  const hasSentinel = useCallback(
    () => (isSupabaseConfigured ? plan?.sentinelIncluded === true : !isFree && tier.sentinelIncluded) || plan?.sentinelAddon === true,
    [isFree, plan?.sentinelAddon, plan?.sentinelIncluded, tier.sentinelIncluded],
  );
  return { tier, plan, hasModule, hasSentinel, encounterLimit: tier.encountersPerMonth, isTrialActive };
}
