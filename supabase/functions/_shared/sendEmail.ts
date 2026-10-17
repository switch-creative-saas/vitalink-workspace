// Sends one branded email through Resend. Needs RESEND_API_KEY and
// INVITE_FROM_EMAIL (e.g. "VitaLink <no-reply@vitalink.africa>"). Replies go to
// the support email set in the VitaLink Console (platform_settings), if any.
import { renderEmail, renderText, type EmailContent } from './email.ts';

export type SendResult = { sent: true } | { sent: false; reason: string };

export function emailConfigured() {
  return Boolean(Deno.env.get('RESEND_API_KEY') && Deno.env.get('INVITE_FROM_EMAIL'));
}

export const NOT_CONFIGURED = 'Email is not configured (RESEND_API_KEY and INVITE_FROM_EMAIL are required).';

export async function sendEmail(params: { to: string; subject: string; content: EmailContent; replyTo?: string }): Promise<SendResult> {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('INVITE_FROM_EMAIL');
  if (!key || !from) return { sent: false, reason: NOT_CONFIGURED };
  const replyTo = params.replyTo || params.content.supportEmail;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        html: renderEmail(params.content),
        text: renderText(params.content),
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { sent: false, reason: `Email provider error: ${body.message ?? res.statusText}` };
    }
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Support email from the VitaLink Console settings (any client that can read platform_settings). */
// deno-lint-ignore no-explicit-any
export async function supportEmail(db: any): Promise<string | undefined> {
  const { data } = await db.from('platform_settings').select('support_email').maybeSingle();
  return (data?.support_email as string | undefined)?.trim() || undefined;
}
