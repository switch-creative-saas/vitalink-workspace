// Paystack webhook: confirms first payments, extends periods on renewals, and
// downgrades on failed/cancelled subscriptions. Authenticated by Paystack's
// HMAC-SHA512 signature, so it is deployed with JWT verification off.
import {
  activateFromTransaction,
  addPeriod,
  paystack,
  secretKey,
  serviceClient,
  type BillingCycle,
} from '../_shared/paystack.ts';

async function validSignature(rawBody: string, signature: string | null) {
  if (!signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secretKey()), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('');
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const rawBody = await req.text();
  if (!(await validSignature(rawBody, req.headers.get('x-paystack-signature')))) {
    return new Response('Invalid signature', { status: 401 });
  }

  const event = JSON.parse(rawBody);
  const data = event.data ?? {};
  const db = serviceClient();

  try {
    switch (event.event) {
      case 'charge.success': {
        if (data.metadata?.vitalink === 'initial') {
          // Re-fetch from Paystack rather than trusting the payload.
          const tx = await paystack(`/transaction/verify/${encodeURIComponent(data.reference)}`);
          await activateFromTransaction(db, tx);
          break;
        }
        // Recurring charge created by a Paystack subscription.
        const customerCode = data.customer?.customer_code;
        if (!customerCode || !data.plan?.plan_code) break;
        const { data: sub } = await db.from('subscriptions').select('*').eq('paystack_customer_code', customerCode).maybeSingle();
        if (!sub) break;
        const { data: existing } = await db.from('payments').select('id').eq('reference', data.reference).maybeSingle();
        if (existing) break;
        const cycle = sub.billing_cycle as BillingCycle;
        const base = sub.current_period_end && new Date(sub.current_period_end) > new Date() ? new Date(sub.current_period_end) : new Date();
        await db.from('payments').insert({
          organization_id: sub.organization_id, reference: data.reference, kind: 'renewal', plan_id: sub.plan_id,
          billing_cycle: cycle, amount_kobo: data.amount, status: 'success', paid_at: new Date().toISOString(), paystack_payload: data,
        });
        await db.from('subscriptions').update({ status: 'active', current_period_end: addPeriod(base, cycle).toISOString() })
          .eq('organization_id', sub.organization_id);
        break;
      }
      case 'subscription.create': {
        if (data.subscription_code && data.customer?.customer_code) {
          await db.from('subscriptions')
            .update({ paystack_subscription_code: data.subscription_code, paystack_email_token: data.email_token })
            .eq('paystack_customer_code', data.customer.customer_code).is('paystack_subscription_code', null);
        }
        break;
      }
      case 'invoice.payment_failed': {
        if (data.subscription?.subscription_code) {
          await db.from('subscriptions').update({ status: 'past_due' })
            .eq('paystack_subscription_code', data.subscription.subscription_code).neq('status', 'comped');
        }
        break;
      }
      case 'subscription.disable': {
        if (data.subscription_code) {
          await db.from('subscriptions').update({ status: 'cancelled' })
            .eq('paystack_subscription_code', data.subscription_code).neq('status', 'comped');
        }
        break;
      }
      // subscription.not_renew: keep access until current_period_end; nothing to do.
    }
  } catch (error) {
    console.error(`webhook ${event.event} failed`, error);
    return new Response('Handler error', { status: 500 }); // Paystack retries
  }
  return new Response('ok');
});
