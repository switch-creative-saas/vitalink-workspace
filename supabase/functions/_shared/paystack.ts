// Shared Paystack + database helpers for the billing Edge Functions.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const PAYSTACK_API = 'https://api.paystack.co';

export type BillingCycle = 'monthly' | 'annual';

export interface PlanRow {
  id: string;
  name: string;
  monthly_price_kobo: number;
  annual_price_kobo: number | null;
  setup_fee_kobo: number;
  self_serve: boolean;
  paystack_plan_monthly: string | null;
  paystack_plan_annual: string | null;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export function secretKey(): string {
  const key = Deno.env.get('PAYSTACK_SECRET_KEY');
  if (!key) throw new HttpError(500, 'Payments are not configured yet (PAYSTACK_SECRET_KEY is missing).');
  return key;
}

// deno-lint-ignore no-explicit-any
export async function paystack<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${PAYSTACK_API}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${secretKey()}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.status === false) {
    throw new HttpError(502, `Paystack ${path} failed: ${payload.message ?? res.statusText}`);
  }
  return payload.data as T;
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function priceFor(plan: PlanRow, cycle: BillingCycle): number {
  const price = cycle === 'annual' ? plan.annual_price_kobo : plan.monthly_price_kobo;
  if (price == null) throw new HttpError(400, `${plan.name} has no ${cycle} billing.`);
  return price;
}

export function addPeriod(from: Date, cycle: BillingCycle): Date {
  const next = new Date(from);
  if (cycle === 'annual') next.setUTCFullYear(next.getUTCFullYear() + 1);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

/** Returns the Paystack plan code for a plan/cycle, creating it in Paystack on first use. */
export async function ensurePaystackPlan(db: SupabaseClient, plan: PlanRow, cycle: BillingCycle): Promise<string> {
  const column = cycle === 'annual' ? 'paystack_plan_annual' : 'paystack_plan_monthly';
  const existing = plan[column];
  if (existing) return existing;
  const created = await paystack<{ plan_code: string }>('/plan', {
    method: 'POST',
    body: {
      name: `VitaLink ${plan.name} (${cycle})`,
      interval: cycle === 'annual' ? 'annually' : 'monthly',
      amount: priceFor(plan, cycle),
      currency: 'NGN',
    },
  });
  await db.from('plans').update({ [column]: created.plan_code }).eq('id', plan.id);
  return created.plan_code;
}

// deno-lint-ignore no-explicit-any
type PaystackTransaction = any;

/**
 * Idempotently applies a successful first payment: marks it paid, activates the
 * subscription for one period and schedules the recurring Paystack subscription
 * to start when that period ends (the setup fee is only in the first charge).
 */
export async function activateFromTransaction(db: SupabaseClient, tx: PaystackTransaction) {
  const { data: payment } = await db.from('payments').select('*').eq('reference', tx.reference).maybeSingle();
  if (!payment) return { outcome: 'unknown_reference' as const };
  if (payment.status === 'success') return { outcome: 'already_applied' as const, organizationId: payment.organization_id };

  const amountMatches = Number(tx.amount) === Number(payment.amount_kobo) && tx.currency === 'NGN';
  if (tx.status !== 'success' || !amountMatches) {
    await db.from('payments').update({
      status: tx.status === 'abandoned' ? 'abandoned' : 'failed',
      paystack_payload: tx,
    }).eq('id', payment.id);
    return { outcome: 'not_successful' as const, organizationId: payment.organization_id };
  }

  await db.from('payments').update({ status: 'success', paid_at: new Date().toISOString(), paystack_payload: tx }).eq('id', payment.id);

  const cycle = payment.billing_cycle as BillingCycle;
  const periodEnd = addPeriod(new Date(), cycle);
  const { data: plan } = await db.from('plans').select('*').eq('id', payment.plan_id).single();
  const { data: current } = await db.from('subscriptions').select('*').eq('organization_id', payment.organization_id).single();

  // Replace any previous recurring subscription (plan change).
  if (current?.paystack_subscription_code && current?.paystack_email_token) {
    await paystack('/subscription/disable', {
      method: 'POST',
      body: { code: current.paystack_subscription_code, token: current.paystack_email_token },
    }).catch((error) => console.error('disable old subscription failed', error));
  }

  let subscriptionCode: string | null = null;
  let emailToken: string | null = null;
  if (tx.authorization?.reusable && plan) {
    try {
      const planCode = await ensurePaystackPlan(db, plan as PlanRow, cycle);
      const sub = await paystack<{ subscription_code: string; email_token: string }>('/subscription', {
        method: 'POST',
        body: {
          customer: tx.customer.customer_code,
          plan: planCode,
          authorization: tx.authorization.authorization_code,
          start_date: periodEnd.toISOString(),
        },
      });
      subscriptionCode = sub.subscription_code;
      emailToken = sub.email_token;
    } catch (error) {
      // The org is still paid up for this period; renewal can be set up again later.
      console.error('creating recurring subscription failed', error);
    }
  }

  await db.from('subscriptions').update({
    plan_id: payment.plan_id,
    billing_cycle: cycle,
    status: 'active',
    current_period_end: periodEnd.toISOString(),
    paystack_customer_code: tx.customer?.customer_code ?? null,
    paystack_subscription_code: subscriptionCode,
    paystack_email_token: emailToken,
    comped_by: null,
  }).eq('organization_id', payment.organization_id);

  return { outcome: 'activated' as const, organizationId: payment.organization_id };
}
