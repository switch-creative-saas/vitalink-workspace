// Sends queued emails from notification_outbox through Resend: console alerts to
// VitaLink platform admins and support replies to customers. The database pokes
// this function whenever mail is queued (pg_net) and pg_cron retries every 10
// minutes, so it takes no input and only ever sends what is already queued.
//
// Without RESEND_API_KEY / INVITE_FROM_EMAIL the emails stay queued (the console
// shows why) and go out once email is configured; anything older than 3 days by
// then is skipped rather than sent late.
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { EmailContent } from '../_shared/email.ts';
import { NOT_CONFIGURED, emailConfigured, sendEmail, supportEmail } from '../_shared/sendEmail.ts';

const MAX_ATTEMPTS = 5;
const STALE_MS = 3 * 24 * 60 * 60 * 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type OutboxRow = {
  id: number;
  recipient: string;
  subject: string;
  body_text: string;
  event_id: number | null;
  payload: Record<string, string> | null;
  attempts: number;
  created_at: string;
};

type EventRow = {
  category: 'signups' | 'subscriptions' | 'payments' | 'orders' | 'support';
  title: string;
  body: string;
  organization_id: string | null;
  ticket_id: string | null;
  amount_kobo: number | null;
  actor_email: string;
  created_at: string;
  organization: { name: string } | null;
};

const EYEBROW: Record<EventRow['category'], string> = {
  payments: 'Payment', orders: 'VitaCard order', subscriptions: 'Subscription', signups: 'New sign-up', support: 'Help & Support',
};

// Where links in emails point: PUBLIC_APP_URL, else the first APP_ORIGINS entry.
const APP_URL = (Deno.env.get('PUBLIC_APP_URL') || (Deno.env.get('APP_ORIGINS') ?? '').split(',')[0] || '').trim().replace(/\/$/, '');

const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const lagosTime = (iso: string) => new Date(iso).toLocaleString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos',
}) + ' WAT';

function alertContent(event: EventRow, support: string | undefined): EmailContent {
  const lines = event.body ? event.body.split('\n').filter(Boolean) : [];
  const path = event.ticket_id ? `/console/inbox/${event.ticket_id}`
    : event.organization_id ? `/console/workspaces/${event.organization_id}` : '/console/notifications';
  const isMoney = event.amount_kobo !== null && event.category === 'payments';
  return {
    preheader: lines[0] ?? event.title,
    eyebrow: EYEBROW[event.category],
    title: event.title,
    amount: isMoney ? { value: naira(event.amount_kobo as number), caption: event.organization?.name } : undefined,
    paragraphs: event.category === 'support' ? lines.slice(0, 1) : lines,
    quote: event.category === 'support' && lines.length > 1 ? { author: 'Message', text: lines.slice(1).join('\n') } : undefined,
    details: [
      ...(event.organization ? [['Workspace', event.organization.name] as [string, string]] : []),
      ...(event.amount_kobo !== null && !isMoney ? [['Amount', naira(event.amount_kobo)] as [string, string]] : []),
      ['When', lagosTime(event.created_at)],
      ...(event.actor_email ? [['By', event.actor_email] as [string, string]] : []),
    ],
    button: APP_URL ? { label: event.ticket_id ? 'Reply in the console' : 'Open in VitaLink Console', url: `${APP_URL}${path}` } : undefined,
    reason: 'You get this because you are a VitaLink platform admin. Choose which alerts you get in VitaLink Console → Settings.',
    supportEmail: support,
  };
}

function supportReplyContent(payload: Record<string, string>, support: string | undefined): EmailContent {
  return {
    preheader: payload.body.slice(0, 120),
    eyebrow: `Support · ${payload.number}`,
    title: `Re: ${payload.subject}`,
    greeting: payload.customer_name ? `Hello ${payload.customer_name.split(' ')[0]},` : undefined,
    paragraphs: ['The VitaLink support team replied to your request:'],
    quote: { author: 'VitaLink Support', text: payload.body },
    button: APP_URL ? { label: 'View conversation', url: `${APP_URL}/help` } : undefined,
    note: 'Reply from Help & Support in your VitaLink workspace so your whole conversation stays in one place.',
    reason: `You received this because you contacted VitaLink Support (${payload.number}).`,
    supportEmail: support,
  };
}

function networkContent(payload: Record<string, string>, support: string | undefined): EmailContent {
  const lines = (payload.body ?? '').split('\n').filter(Boolean);
  const urgent = payload.urgency === 'emergency' ? 'Emergency' : payload.urgency === 'urgent' ? 'Urgent' : '';
  return {
    preheader: lines[0] ?? payload.title,
    eyebrow: `VitaLink Network · ${payload.number}${urgent ? ` · ${urgent}` : ''}`,
    title: payload.title,
    paragraphs: lines,
    button: APP_URL ? { label: 'Open VitaLink Network', url: `${APP_URL}/switch-network` } : undefined,
    note: 'Patient details stay inside VitaLink. Open the network page to review, reply or share records.',
    reason: 'You get this as an admin or referral contact of your workspace on the VitaLink Network.',
    supportEmail: support,
  };
}

function fallbackContent(row: OutboxRow, support: string | undefined): EmailContent {
  const [first, ...rest] = row.body_text.split('\n').filter(Boolean);
  return {
    preheader: first ?? row.subject,
    title: row.subject.replace(/^\[VitaLink\]\s*/, ''),
    paragraphs: rest.length ? rest : first ? [first] : [],
    reason: 'You received this from VitaLink.',
    supportEmail: support,
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  if (!emailConfigured()) {
    await admin.from('notification_outbox').update({ last_error: NOT_CONFIGURED }).eq('status', 'pending').is('last_error', null);
    return json({ sent: 0, reason: NOT_CONFIGURED });
  }

  const { data: rows, error } = await admin.rpc('claim_outbox', { p_limit: 25 });
  if (error) return json({ error: error.message }, 500);
  const batch = (rows ?? []) as OutboxRow[];
  if (!batch.length) return json({ sent: 0, failed: 0 });

  const support = await supportEmail(admin);
  const eventIds = batch.map((row) => row.event_id).filter((id): id is number => id !== null);
  const events = new Map<number, EventRow>();
  if (eventIds.length) {
    const { data } = await admin
      .from('platform_events')
      .select('id, category, title, body, organization_id, ticket_id, amount_kobo, actor_email, created_at, organization:organizations(name)')
      .in('id', eventIds);
    for (const event of (data ?? []) as Array<EventRow & { id: number }>) events.set(event.id, event);
  }

  let sent = 0;
  let failed = 0;
  for (const row of batch) {
    if (Date.now() - new Date(row.created_at).getTime() > STALE_MS) {
      await admin.from('notification_outbox')
        .update({ status: 'skipped', last_error: 'Not sent: older than 3 days by the time email was available.' })
        .eq('id', row.id);
      continue;
    }

    const event = row.event_id !== null ? events.get(row.event_id) : undefined;
    const content = event ? alertContent(event, support)
      : row.payload?.kind === 'support_reply' ? supportReplyContent(row.payload, support)
      : row.payload?.kind === 'network' ? networkContent(row.payload, support)
      : fallbackContent(row, support);
    const result = await sendEmail({ to: row.recipient, subject: row.subject, content });

    if (!result.sent) {
      failed += 1;
      await admin.from('notification_outbox').update({
        status: row.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        last_error: result.reason,
        claimed_at: null,
      }).eq('id', row.id);
    } else {
      sent += 1;
      await admin.from('notification_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null })
        .eq('id', row.id);
    }
  }

  return json({ sent, failed });
});
