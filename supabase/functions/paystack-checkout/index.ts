// Starts a Paystack checkout for a workspace plan, an add-on (VitaLink Sentinel) or a VitaCard
// order, or verifies one after the redirect back. Platform admins skip payment (their request comps
// the plan or add-on) unless they send pay: true to test the real checkout.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  HttpError,
  applyTransaction,
  corsHeaders,
  json,
  markNfcOrderPaid,
  paystack,
  priceFor,
  serviceClient,
  type AddonRow,
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

    // ---- Platform admins: is Paystack configured, and in which mode? (never returns the key) ----
    if (body.action === 'status') {
      const { data: isPlatformAdmin } = await asUser.rpc('am_i_platform_admin');
      if (!isPlatformAdmin) throw new HttpError(403, 'Platform admins only.');
      const key = Deno.env.get('PAYSTACK_SECRET_KEY') ?? '';
      return json({ configured: Boolean(key), mode: key.startsWith('sk_test_') ? 'test' : key.startsWith('sk_live_') ? 'live' : key ? 'unknown' : null });
    }

    // ---- VitaCard orders ----
    if (body.action === 'nfc-order') {
      const callbackUrl = String(body.callbackUrl ?? '');
      if (!ALLOWED_ORIGINS.some((origin) => callbackUrl.startsWith(`${origin}/`))) {
        throw new HttpError(400, 'Callback URL is not an allowed VitaLink origin.');
      }
      const { data: order } = await db.from('nfc_card_orders')
        .select('id, organization_id, order_number, quantity, total_kobo, status, payment_method')
        .eq('id', String(body.orderId ?? '')).maybeSingle();
      if (!order) throw new HttpError(404, 'Order not found.');
      const { data: member } = await db.from('memberships').select('role')
        .eq('organization_id', order.organization_id).eq('user_id', user.id).eq('status', 'active').maybeSingle();
      if (!member || !ADMIN_ROLES.includes(member.role)) throw new HttpError(403, 'Only workspace admins can pay for card orders.');
      if (order.status !== 'processing') throw new HttpError(400, 'This order is no longer awaiting payment.');

      const reference = `vlnfc_${order.id.slice(0, 8)}_${Date.now()}`;
      const { error: refError } = await db.from('nfc_card_orders')
        .update({ paystack_reference: reference, payment_method: 'paystack' }).eq('id', order.id);
      if (refError) throw new HttpError(500, refError.message);
      const checkout = await paystack<{ authorization_url: string }>('/transaction/initialize', {
        method: 'POST',
        body: {
          email: user.email,
          amount: order.total_kobo,
          currency: 'NGN',
          reference,
          callback_url: callbackUrl,
          metadata: {
            vitalink: 'nfc_order',
            order_id: order.id,
            custom_fields: [{ display_name: 'VitaCard order', variable_name: 'order', value: `${order.order_number} (${order.quantity} cards)` }],
          },
        },
      });
      return json({ authorizationUrl: checkout.authorization_url, reference });
    }
    if (body.action === 'verify-nfc') {
      const reference = String(body.reference ?? '');
      const { data: order } = await db.from('nfc_card_orders').select('organization_id').eq('paystack_reference', reference).maybeSingle();
      if (!order) throw new HttpError(404, 'Order payment not found.');
      const { data: member } = await db.from('memberships').select('id')
        .eq('organization_id', order.organization_id).eq('user_id', user.id).eq('status', 'active').maybeSingle();
      if (!member) throw new HttpError(403, 'Not a member of this workspace.');
      const tx = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
      return json(await markNfcOrderPaid(db, tx));
    }

    if (body.action === 'verify') {
      const reference = String(body.reference ?? '');
      const { data: payment } = await db.from('payments').select('organization_id').eq('reference', reference).maybeSingle();
      if (!payment) throw new HttpError(404, 'Payment not found.');
      const { data: member } = await db.from('memberships').select('id')
        .eq('organization_id', payment.organization_id).eq('user_id', user.id).eq('status', 'active').maybeSingle();
      if (!member) throw new HttpError(403, 'Not a member of this workspace.');
      const tx = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`);
      const result = await applyTransaction(db, tx);
      return json(result);
    }

    // ---- Add-ons (VitaLink Sentinel full access) ----
    if (body.action === 'addon') {
      const organizationId = String(body.organizationId ?? '');
      const addonId = String(body.addonId ?? '');
      const callbackUrl = String(body.callbackUrl ?? '');
      if (!ALLOWED_ORIGINS.some((origin) => callbackUrl.startsWith(`${origin}/`))) {
        throw new HttpError(400, 'Callback URL is not an allowed VitaLink origin.');
      }
      const { data: member } = await db.from('memberships').select('role')
        .eq('organization_id', organizationId).eq('user_id', user.id).eq('status', 'active').maybeSingle();
      if (!member || !ADMIN_ROLES.includes(member.role)) throw new HttpError(403, 'Only workspace admins can add Sentinel.');
      const { data: addon } = await db.from('plan_addons').select('*').eq('id', addonId).maybeSingle<AddonRow>();
      if (!addon) throw new HttpError(400, 'Unknown add-on.');

      const { data: entitlements, error: entError } = await asUser.rpc('workspace_entitlements', { p_organization_id: organizationId });
      if (entError) throw new HttpError(400, entError.message);
      const effectivePlan = String(entitlements?.effectivePlanId ?? 'free');
      if (addon.id === 'sentinel' && entitlements?.sentinelAccess === 'full') throw new HttpError(400, 'This workspace already has full Sentinel access.');
      if (!addon.eligible_plans.includes(effectivePlan)) {
        throw new HttpError(400, effectivePlan === 'free'
          ? `${addon.name} is available on Starter and Growth. Upgrade your plan first.`
          : `${addon.name} isn't available on your plan.`);
      }

      const { data: isPlatformAdmin } = await asUser.rpc('am_i_platform_admin');
      if (isPlatformAdmin && !body.pay) {
        const { error } = await db.from('subscription_addons').upsert({
          organization_id: organizationId, addon_id: addon.id, status: 'comped', current_period_end: null, comped_by: user.id, updated_at: new Date().toISOString(),
        }, { onConflict: 'organization_id,addon_id' });
        if (error) throw new HttpError(500, error.message);
        return json({ comped: true });
      }

      const reference = `vladd_${organizationId.slice(0, 8)}_${Date.now()}`;
      const { error: insertError } = await db.from('payments').insert({
        organization_id: organizationId, reference, kind: 'addon', addon_id: addon.id, plan_id: effectivePlan, billing_cycle: 'monthly',
        amount_kobo: addon.monthly_price_kobo, setup_fee_kobo: 0, created_by: user.id,
      });
      if (insertError) throw new HttpError(500, insertError.message);
      const checkout = await paystack<{ authorization_url: string }>('/transaction/initialize', {
        method: 'POST',
        body: {
          email: user.email,
          amount: addon.monthly_price_kobo,
          currency: 'NGN',
          reference,
          callback_url: callbackUrl,
          metadata: {
            vitalink: 'addon',
            organization_id: organizationId,
            addon_id: addon.id,
            custom_fields: [{ display_name: 'Add-on', variable_name: 'addon', value: `${addon.name} (monthly)` }],
          },
        },
      });
      await db.from('subscription_addons').upsert({ organization_id: organizationId, addon_id: addon.id, status: 'pending_payment', updated_at: new Date().toISOString() },
        { onConflict: 'organization_id,addon_id', ignoreDuplicates: true });
      return json({ authorizationUrl: checkout.authorization_url, reference, amountKobo: addon.monthly_price_kobo });
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
    if (isPlatformAdmin && !body.pay) {
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
            ...(setupFee ? [{ display_name: 'Setup fee (NGN)', variable_name: 'setup_fee', value: String(setupFee / 100) }] : []),
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
