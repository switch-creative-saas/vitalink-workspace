// Emails a patient a reminder for one appointment. The caller must be able to read
// the appointment (RLS: members of its workspace). Without RESEND_API_KEY and
// INVITE_FROM_EMAIL nothing is sent and the reason is returned, so staff can
// remind the patient by phone or WhatsApp instead.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { NOT_CONFIGURED, emailConfigured, sendEmail } from '../_shared/sendEmail.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

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

    const { appointmentId } = await req.json().catch(() => ({}));
    const { data: appt } = await asUser
      .from('appointments')
      .select(`starts_at, department, type, status,
        patient:patients(first_name, last_name, email),
        clinician:profiles!appointments_clinician_profile_fk(full_name),
        organization:organizations(name, contact_phone)`)
      .eq('id', String(appointmentId))
      .maybeSingle();
    if (!appt) return json({ error: 'Appointment not found.' }, 404);
    if (['cancelled', 'completed', 'no-show'].includes(appt.status)) {
      return json({ sent: false, reason: `This appointment is ${appt.status}.` });
    }

    const patient = appt.patient as { first_name: string; last_name: string; email: string | null } | null;
    if (!patient?.email) return json({ sent: false, reason: 'The patient has no email address on file.' });

    if (!emailConfigured()) return json({ sent: false, reason: NOT_CONFIGURED });

    const org = appt.organization as { name: string; contact_phone: string | null } | null;
    const orgName = org?.name ?? 'your clinic';
    const clinician = (appt.clinician as { full_name: string } | null)?.full_name;
    const start = new Date(appt.starts_at);
    const day = start.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });
    const time = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });

    const result = await sendEmail({
      to: patient.email,
      subject: `Reminder: your appointment at ${orgName} on ${day}`,
      content: {
        preheader: `${day} at ${time} with ${clinician ?? orgName}`,
        eyebrow: 'Appointment reminder',
        title: `See you on ${day}`,
        greeting: `Hello ${patient.first_name},`,
        paragraphs: [`This is a reminder of your upcoming appointment at ${orgName}. Please arrive 10 minutes early.`],
        details: [
          ['Date', day],
          ['Time', `${time} (WAT)`],
          ['Visit', `${appt.type}${appt.department ? ` · ${appt.department}` : ''}`],
          ...(clinician ? [['With', clinician] as [string, string]] : []),
          ['Clinic', orgName],
          ...(org?.contact_phone ? [['To reschedule', `Call ${org.contact_phone}`] as [string, string]] : []),
        ],
        note: 'If you can no longer make it, please let the clinic know so someone else can have the slot.',
        reason: `You received this because ${orgName} booked an appointment for you on VitaLink.`,
      },
    });
    if (!result.sent) return json({ sent: false, reason: result.reason });
    return json({ sent: true, to: patient.email });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500);
  }
});
