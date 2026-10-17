// Emails a staff invitation link. The caller must be able to read the invitation,
// which RLS limits to admins of that workspace. Without RESEND_API_KEY and
// INVITE_FROM_EMAIL the link is returned unsent so the admin can share it another
// way (e.g. WhatsApp).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { NOT_CONFIGURED, emailConfigured, sendEmail, supportEmail } from '../_shared/sendEmail.ts';

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
    if (!emailConfigured()) return json({ sent: false, link, reason: NOT_CONFIGURED });

    const orgName = (invite.organization as { name?: string } | null)?.name ?? 'your workspace';
    const roleLabel = ROLE_LABELS[invite.role] ?? invite.role;
    const inviter = (user.user_metadata?.full_name as string | undefined) || user.email || 'A workspace admin';
    const expires = new Date(invite.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    const result = await sendEmail({
      to: invite.email,
      subject: `${inviter} invited you to ${orgName} on VitaLink`,
      content: {
        preheader: `Join ${orgName} as ${roleLabel}. The invitation expires on ${expires}.`,
        eyebrow: 'Staff invitation',
        title: `Join ${orgName} on VitaLink`,
        paragraphs: [
          `${inviter} has invited you to work in ${orgName}'s VitaLink workspace, where the team manages patients, appointments, labs, pharmacy and billing in one place.`,
        ],
        details: [
          ['Workspace', orgName],
          ['Your role', roleLabel + (invite.department ? ` · ${invite.department}` : '')],
          ['Sign in with', invite.email],
          ['Expires', expires],
        ],
        button: { label: 'Accept invitation', url: link },
        note: `Sign in or create your account with ${invite.email} so the invitation matches. If you weren't expecting this, you can ignore this email.`,
        reason: `You received this because ${inviter} invited ${invite.email} to a VitaLink workspace.`,
        supportEmail: await supportEmail(asUser),
      },
    });
    if (!result.sent) return json({ sent: false, link, reason: result.reason });
    return json({ sent: true, link });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500);
  }
});
