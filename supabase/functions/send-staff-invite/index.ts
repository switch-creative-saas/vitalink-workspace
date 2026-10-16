// Emails a staff invitation link. The caller must be able to read the invitation,
// which RLS limits to admins of that workspace. Without RESEND_API_KEY the link is
// returned unsent so the admin can share it another way (e.g. WhatsApp).
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const ALLOWED_ORIGINS = (Deno.env.get('APP_ORIGINS') ?? 'http://127.0.0.1:5175,http://localhost:5175')
  .split(',').map((origin) => origin.trim()).filter(Boolean);

const ROLE_LABELS: Record<string, string> = {
  'hospital-admin': 'Hospital Admin', doctor: 'Doctor', nurse: 'Nurse', receptionist: 'Receptionist',
  'lab-scientist': 'Lab Scientist', 'lab-technician': 'Lab Technician', pharmacist: 'Pharmacist',
  'billing-officer': 'Billing Officer', 'insurance-officer': 'Insurance Officer', 'it-officer': 'IT Officer',
};

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false },
    });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json({ error: 'Sign in first.' }, 401);

    const { invitationId, appOrigin } = await req.json().catch(() => ({}));
    if (!ALLOWED_ORIGINS.includes(String(appOrigin))) return json({ error: 'App origin is not allowed.' }, 400);

    // RLS: only admins of the invite's workspace can read it.
    const { data: invite } = await asUser
      .from('staff_invitations')
      .select('email, role, department, token, accepted, expires_at, organization:organizations(name)')
      .eq('id', String(invitationId))
      .maybeSingle();
    if (!invite) return json({ error: 'Invitation not found.' }, 404);
    if (invite.accepted || new Date(invite.expires_at) <= new Date()) return json({ error: 'This invitation is no longer valid.' }, 400);

    const link = `${appOrigin}/invite?token=${encodeURIComponent(invite.token)}`;
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return json({ sent: false, link, reason: 'Email is not configured (RESEND_API_KEY missing).' });

    const orgName = (invite.organization as { name?: string } | null)?.name ?? 'your workspace';
    const roleLabel = ROLE_LABELS[invite.role] ?? invite.role;
    const inviter = (user.user_metadata?.full_name as string | undefined) || user.email || 'A workspace admin';
    const expires = new Date(invite.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('INVITE_FROM_EMAIL') ?? 'VitaLink <onboarding@resend.dev>',
        to: [invite.email],
        subject: `You're invited to join ${orgName} on VitaLink`,
        html: `<p>${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(orgName)}</strong> on VitaLink as <strong>${escapeHtml(roleLabel)}</strong>${invite.department ? ` (${escapeHtml(invite.department)})` : ''}.</p>
<p><a href="${link}">Accept the invitation</a></p>
<p>Use this email address (${escapeHtml(invite.email)}) to sign in or create your account. The link expires on ${expires}.</p>`,
        text: `${inviter} invited you to join ${orgName} on VitaLink as ${roleLabel}.\nAccept: ${link}\nUse ${invite.email} to sign in or create your account. Expires ${expires}.`,
      }),
    });
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      return json({ sent: false, link, reason: `Email provider error: ${detail.message ?? res.statusText}` });
    }
    return json({ sent: true, link });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500);
  }
});
