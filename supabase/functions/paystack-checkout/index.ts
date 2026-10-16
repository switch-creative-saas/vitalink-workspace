// Starts a Paystack checkout for a workspace plan, or verifies one after the
// redirect back. Platform admins skip payment: their request comps the plan.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  HttpError,
  activateFromTransaction,
  corsHeaders,
  json,
  paystack,
  priceFor,
  serviceClient,
  type BillingCycle,
  type PlanRow,
} from '../_shared/paystack.ts';

const ADMIN_ROLES = ['super-admin', 'hospital-admin', 'ngo-admin', 'government-admin'];
const ALLOWED_ORIGINS = (Deno.env.get('APP_ORIGINS') ?? 'http://127.0.0.1:5175,http://localhost:5175')
  .split(',').map((origin) => origin.trim()).filter(Boolean);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

    const authHeader = req.headers.get('Authorization') ?? '';
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) throw new HttpError(401, 'Sign in first.');

    const body = await req.json().catch(() => ({}));
    const db = serviceClient();

    if (body.action === 'verify') {
      const reference = String(body.reference ?? '');
      const { data: payment } = await db.from('payments').select('organization_id').eq('reference', reference).maybeSingle();
      if (!payment) throw new HttpError(404, 'Payment not found.');
      const { data: member } = await db.from('memberships').select('id')
        .eq('organization_id', payment.organization_id).eq('user_id', user.id).eq('status', 'active').maybeSingle();
      if (!member) throw new HttpError(403, 'Not a member of this workspace.');
      const tx = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
      const result = await activateFromTransaction(db, tx);
      return json(result);
    }

    // action: 'initialize'
    const organizationId = String(body.organizationId ?? '');
    const planId = String(body.planId ?? '');
    const cycle: BillingCycle = body.billingCycle === 'annual' ? 'annual' : 'monthly';
    const callbackUrl = String(body.callbackUrl ?? '');
    if (!ALLOWED_ORIGINS.some((origin) => callbackUrl.startsWith(`${origin}/`))) {
      throw new HttpError(400, 'Callback URL is not an allowed VitaLink origin.');
    }

    const { data: member } = await db.from('memberships').select('role')
      .eq('organization_id', organizationId).eq('user_id', user.id).eq('status', 'active').maybeSingle();
    if (!member || !ADMIN_ROLES.includes(member.role)) throw new HttpError(403, 'Only workspace admins can change the plan.');

    const { data: plan } = await db.from('plans').select('*').eq('id', planId).maybeSingle<PlanRow>();
    if (!plan) throw new HttpError(400, 'Unknown plan.');

    const { data: isPlatformAdmin } = await asUser.rpc('am_i_platform_admin');
    if (isPlatformAdmin) {
      const { error } = await asUser.rpc('comp_subscription', {
        p_organization_id: organizationId, p_plan_id: plan.id, p_billing_cycle: cycle,
      });
      if (error) throw new HttpError(400, error.message);
      return json({ comped: true });
    }

    if (!plan.self_serve) throw new HttpError(403, `${plan.name} is arranged through sales.`);
    if (plan.id === 'free') throw new HttpError(400, 'The Free plan needs no payment.');

    // Setup fee is charged once per workspace.
    const { count: paidBefore } = await db.from('payments').select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId).eq('status', 'success');
    const setupFee = paidBefore ? 0 : plan.setup_fee_kobo;
    const amount = priceFor(plan, cycle) + setupFee;
    const reference = `vl_${organizationId.slice(0, 8)}_${Date.now()}`;

    const { error: insertError } = await db.from('payments').insert({
      organization_id: organizationId, reference, kind: 'initial', plan_id: plan.id, billing_cycle: cycle,
      amount_kobo: amount, setup_fee_kobo: setupFee, created_by: user.id,
    });
    if (insertError) throw new HttpError(500, insertError.message);

    const checkout = await paystack<{ authorization_url: string; reference: string }>('/transaction/initialize', {
      method: 'POST',
      body: {
        email: user.email,
        amount,
        currency: 'NGN',
        reference,
        callback_url: callbackUrl,
        metadata: {
          vitalink: 'initial',
          organization_id: organizationId,
          plan_id: plan.id,
          billing_cycle: cycle,
          custom_fields: [
            { display_name: 'Plan', variable_name: 'plan', value: `${plan.name} (${cycle})` },
            { display_name: 'Setup fee (NGN)', variable_name: 'setup_fee', value: String(setupFee / 100) },
          ],
        },
      },
    });

    await db.from('subscriptions').update({ plan_id: plan.id, billing_cycle: cycle, status: 'pending_payment' })
      // Never downgrade a paid-up or comped workspace just because a checkout was opened.
      .eq('organization_id', organizationId).in('status', ['pending_payment', 'past_due', 'cancelled']);

    return json({ authorizationUrl: checkout.authorization_url, reference, amountKobo: amount, setupFeeKobo: setupFee });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, status);
  }
});
