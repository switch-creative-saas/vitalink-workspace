// Mirrors the server-side subscription (and Sentinel access) into the local plan store the UI
// gates modules on. Called at sign-in, after payments and when the Subscription page loads.
import { saveWorkspacePlan } from '@/hooks/usePlan';
import { getSubscription } from '@/lib/supabase/auth';
import { getEntitlements } from '@/lib/supabase/plans';

export async function syncWorkspacePlan(organizationId: string) {
  const sub = await getSubscription(organizationId);
  if (!sub) return null;
  const entitlements = await getEntitlements(organizationId).catch(() => null);
  const trialActive = sub.status === 'trialing' && sub.effectivePlanId !== 'free';
  const sentinelFull = entitlements?.sentinelAccess === 'full';
  saveWorkspacePlan({
    tierId: trialActive ? 'trial' : sub.effectivePlanId as 'free' | 'starter' | 'growth' | 'enterprise',
    tierName: trialActive ? '14-Day Free Trial' : sub.planName,
    billingCycle: trialActive ? 'trial' : sub.billingCycle,
    price: null,
    modules: sub.modules,
    sentinelIncluded: sub.effectivePlanId === 'enterprise',
    sentinelAddon: sentinelFull && sub.effectivePlanId !== 'enterprise',
    status: sub.status,
    isTrialActive: trialActive,
    trialEndDate: trialActive ? sub.currentPeriodEnd ?? undefined : undefined,
  });
  return sub;
}
