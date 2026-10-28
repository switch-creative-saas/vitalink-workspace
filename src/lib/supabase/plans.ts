// Subscription plans, add-ons and what a workspace is entitled to (public.plans, public.plan_addons,
// workspace_entitlements). Payments go through the paystack-checkout Edge Function.
import { functionErrorMessage, requireSupabase } from './client';

export type SentinelAccess = 'none' | 'read_only' | 'full';

export interface PlanInfo {
  id: string;
  name: string;
  tagline: string;
  monthlyPrice: number;
  annualPrice: number | null;
  selfServe: boolean;
  features: string[];
  modules: string[];
  sentinelAccess: SentinelAccess;
  limits: { staff: number | null; patients: number | null; drugSkus: number | null; nfcCardsIncluded: number };
}

export interface AddonInfo {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  eligiblePlans: string[];
}

export interface Entitlements {
  planId: string;
  effectivePlanId: string;
  status: 'active' | 'trialing' | 'pending_payment' | 'past_due' | 'cancelled' | 'comped';
  billingCycle: 'monthly' | 'annual';
  currentPeriodEnd: string | null;
  renews: boolean;
  limits: { staff: number | null; patients: number | null; drugSkus: number | null; nfcCardsIncluded: number; smsReminders: boolean };
  usage: { staff: number; patients: number; drugSkus: number };
  sentinelAccess: SentinelAccess;
  sentinelAddon: { status: string; currentPeriodEnd: string | null; renews: boolean } | null;
}

const naira = (kobo: number | null) => (kobo == null ? null : Math.round(Number(kobo) / 100));

export async function listPlans(): Promise<PlanInfo[]> {
  const { data, error } = await requireSupabase().from('plans')
    .select('id, name, tagline, monthly_price_kobo, annual_price_kobo, self_serve, features, modules, sentinel_access, max_staff, max_patients, max_drug_skus, nfc_cards_included, sort_order')
    .order('sort_order');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id, name: row.name, tagline: row.tagline ?? '', monthlyPrice: naira(row.monthly_price_kobo) ?? 0, annualPrice: naira(row.annual_price_kobo),
    selfServe: row.self_serve, features: row.features ?? [], modules: row.modules ?? [], sentinelAccess: row.sentinel_access,
    limits: { staff: row.max_staff, patients: row.max_patients, drugSkus: row.max_drug_skus, nfcCardsIncluded: row.nfc_cards_included },
  }));
}

export async function listAddons(): Promise<AddonInfo[]> {
  const { data, error } = await requireSupabase().from('plan_addons').select('id, name, description, monthly_price_kobo, eligible_plans');
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, name: row.name, description: row.description, monthlyPrice: naira(row.monthly_price_kobo) ?? 0, eligiblePlans: row.eligible_plans ?? [] }));
}

export async function getEntitlements(organizationId: string): Promise<Entitlements> {
  const { data, error } = await requireSupabase().rpc('workspace_entitlements', { p_organization_id: organizationId });
  if (error) throw error;
  return data as Entitlements;
}

/** Returns a Paystack URL to redirect to, or { comped: true } for platform admins. */
export async function startAddonCheckout(organizationId: string, addonId: string) {
  const { data, error } = await requireSupabase().functions.invoke('paystack-checkout', {
    body: { action: 'addon', organizationId, addonId, callbackUrl: `${window.location.origin}/payment-callback` },
  });
  if (error) throw new Error(await functionErrorMessage(error));
  return data as { authorizationUrl?: string; reference?: string; comped?: boolean };
}

/**
 * "Open Sentinel": the Sentinel organisation to open for this workspace (created the first time),
 * or why it can't be opened yet.
 */
export async function openWorkspaceSentinel(organizationId: string) {
  const { data, error } = await requireSupabase().rpc('open_workspace_sentinel', { p_organization_id: organizationId });
  if (error) throw error;
  return data as { access: SentinelAccess; sentinelOrgId?: string; own?: boolean; needsAdmin?: boolean };
}
