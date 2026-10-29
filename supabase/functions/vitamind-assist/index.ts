// VitaMind tools that sit beside the workflow (paid plans). The browser calls this; it checks the
// user, their role, the workspace plan and rate limits, then forwards to the VitaMind AI service
// (apps/vitamind-ai), which holds the Anthropic and OpenAI keys and its own daily budgets.
//
//   { action: 'status', organizationId }                              -> { ocr, scribe, configured }
//   { action: 'extract_patients', organizationId, images: [{ mediaType, data }] }   (Starter and up)
//        -> { document_type, patients: [...], notes }   photos of paper records → patient details
//   { action: 'scribe_start', organizationId, patientId, consent: true }           (Growth and up)
//        -> { id }                                        the patient's consent is recorded here
//   { action: 'scribe_transcribe', organizationId, scribeId, audio, mimeType, seconds } -> { text, transcript }
//   { action: 'scribe_draft', organizationId, scribeId, transcript? }  -> { draft, analysis }
//        drafts the note, and opens a VitaMind Dx analysis with the symptoms heard, so the doctor's
//        signed diagnosis is learned from (private.dx_learn_from_note).
//   { action: 'scribe_discard', organizationId, scribeId }
// Audio is never stored: each segment is transcribed and dropped.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { emrSnapshot } from '../_shared/emrSnapshot.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const SERVICE_URL = (Deno.env.get('VITAMIND_AI_URL') ?? '').replace(/\/$/, '');
const SERVICE_TOKEN = Deno.env.get('VITAMIND_SERVICE_TOKEN') ?? '';

// Who may use what (the database enforces the same for the records themselves).
const OCR_ROLES = ['super-admin', 'hospital-admin', 'doctor', 'nurse', 'receptionist'];
const SCRIBE_ROLES = ['super-admin', 'hospital-admin', 'doctor'];

// Spend protection on top of the service's platform-wide budgets.
const LIMITS = {
  ocr: { perHour: 60, workspacePerDay: 800 },             // photos
  transcribe: { minutesPerDay: 240, workspaceMinutesPerDay: 2400, perScribeMinutes: 90 },
  scribe_draft: { perHour: 20, workspacePerDay: 300 },
};
const MAX_IMAGES = 4;
const MAX_IMAGE_BASE64 = 1_000_000;
// The AI service runs on Vercel, which refuses request bodies over 4.5 MB.
const MAX_IMAGES_TOTAL_BASE64 = 4_000_000;
const MAX_AUDIO_BASE64 = 3_500_000;

async function callService(path: string, body: unknown) {
  const res = await fetch(`${SERVICE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-VitaMind-Token': SERVICE_TOKEN },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(typeof data.detail === 'string' ? data.detail : 'VitaMind AI is unavailable right now.') as Error & { status?: number };
    error.status = res.status === 429 ? 429 : 502;
    throw error;
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'Sign in first.' }, 401);

  const body = await req.json().catch(() => ({}));
  const organizationId = String(body.organizationId ?? '');
  const action = String(body.action ?? '');

  // Read through RLS: also requires a verified two-step sign-in for roles that need one.
  const { data: membership } = await asUser.from('memberships').select('role, status')
    .eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle();
  if (!membership || membership.status !== 'active') return json({ error: 'You are not a member of this workspace.' }, 403);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const hasModule = async (module: string) => {
    const { data } = await asUser.rpc('workspace_has_module', { p_organization_id: organizationId, p_module: module });
    return data === true;
  };
  const configured = Boolean(SERVICE_URL && SERVICE_TOKEN);

  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  /** Units of `kind` used in the last `sinceMs` by this user (mine) or the whole workspace. */
  const used = async (kind: string, mine: boolean, sinceMs: number) => {
    const query = admin.from('ai_tool_usage').select('units').eq('kind', kind).gte('created_at', ago(sinceMs)).limit(5000);
    const { data } = await (mine ? query.eq('user_id', user.id) : query.eq('organization_id', organizationId));
    return ((data ?? []) as Array<{ units: number }>).reduce((total, row) => total + row.units, 0);
  };
  const logUse = (kind: string, units = 1) => admin.from('ai_tool_usage').insert({ organization_id: organizationId, user_id: user.id, kind, units });

  try {
    if (action === 'status') {
      const [ocr, scribe] = await Promise.all([hasModule('ocr-intake'), hasModule('ai-scribe')]);
      return json({ ocr: ocr && OCR_ROLES.includes(membership.role), scribe: scribe && SCRIBE_ROLES.includes(membership.role), configured });
    }

    // ---------- paper records ----------
    if (action === 'extract_patients') {
      if (!OCR_ROLES.includes(membership.role)) return json({ error: 'Your role cannot register patients.' }, 403);
      if (!(await hasModule('ocr-intake'))) return json({ error: 'Scanning paper records is included from the Starter plan. Upgrade to use it.', code: 'upgrade_required' }, 402);
      if (!configured) return json({ error: 'VitaMind AI is not connected yet.', code: 'not_configured' }, 503);
      const images = Array.isArray(body.images) ? body.images : [];
      if (images.length < 1 || images.length > MAX_IMAGES) return json({ error: `Add between 1 and ${MAX_IMAGES} photos.` }, 400);
      for (const image of images) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(image?.mediaType) || typeof image?.data !== 'string' || image.data.length > MAX_IMAGE_BASE64) {
          return json({ error: 'Each photo must be a JPEG, PNG or WebP under about 700 KB. Update the app and try again.' }, 400);
        }
      }
      if (images.reduce((total: number, image: { data: string }) => total + image.data.length, 0) > MAX_IMAGES_TOTAL_BASE64) {
        return json({ error: 'These photos are too large together. Send fewer at a time.' }, 400);
      }
      if ((await used('ocr', true, 3_600_000)) + images.length > LIMITS.ocr.perHour) return json({ error: `You've scanned ${LIMITS.ocr.perHour} photos this hour. Try again later.` }, 429);
      if ((await used('ocr', false, 86_400_000)) + images.length > LIMITS.ocr.workspacePerDay) return json({ error: 'Your workspace has reached today’s scanning limit. Try again tomorrow.' }, 429);
      await logUse('ocr', images.length);
      const result = await callService('/extract-patients', { images: images.map((image: { mediaType: string; data: string }) => ({ media_type: image.mediaType, data: image.data })) });
      return json(result);
    }

    // ---------- consultation scribe ----------
    if (!action.startsWith('scribe_')) return json({ error: 'Unknown action.' }, 400);
    if (!SCRIBE_ROLES.includes(membership.role)) return json({ error: 'Only doctors can use the consultation scribe.' }, 403);
    if (!(await hasModule('ai-scribe'))) return json({ error: 'The consultation scribe is included from the Growth plan. Upgrade to use it.', code: 'upgrade_required' }, 402);
    if (!configured) return json({ error: 'VitaMind AI is not connected yet.', code: 'not_configured' }, 503);

    if (action === 'scribe_start') {
      if (body.consent !== true) return json({ error: 'Record the patient’s agreement before listening.' }, 400);
      // Through RLS: the patient must be visible to this user in this workspace.
      const { data: patient } = await asUser.from('patients').select('id').eq('id', String(body.patientId ?? '')).eq('organization_id', organizationId).maybeSingle();
      if (!patient) return json({ error: 'Patient not found in this workspace.' }, 404);
      const { data, error } = await admin.from('consultation_scribes')
        .insert({ organization_id: organizationId, patient_id: patient.id, created_by: user.id }).select('id').single();
      if (error) throw error;
      return json({ id: data.id });
    }

    const { data: scribe } = await admin.from('consultation_scribes').select('*')
      .eq('id', String(body.scribeId ?? '')).eq('organization_id', organizationId).maybeSingle();
    if (!scribe || scribe.created_by !== user.id) return json({ error: 'Scribe session not found.' }, 404);
    if (scribe.status === 'discarded') return json({ error: 'This scribe session was discarded.' }, 409);

    if (action === 'scribe_discard') {
      await admin.from('consultation_scribes').update({ status: 'discarded', transcript: '', draft: null, updated_at: new Date().toISOString() }).eq('id', scribe.id);
      return json({ ok: true });
    }

    if (action === 'scribe_transcribe') {
      const audio = String(body.audio ?? '');
      const seconds = Math.max(1, Math.min(300, Math.round(Number(body.seconds) || 0)));
      if (audio.length < 100 || audio.length > MAX_AUDIO_BASE64) return json({ error: 'That recording segment is too large.' }, 400);
      if (scribe.audio_seconds + seconds > LIMITS.transcribe.perScribeMinutes * 60) return json({ error: `A consultation can be listened to for up to ${LIMITS.transcribe.perScribeMinutes} minutes.` }, 429);
      if ((await used('transcribe', true, 86_400_000)) + seconds > LIMITS.transcribe.minutesPerDay * 60) return json({ error: 'You’ve reached today’s listening time. It resets tomorrow.' }, 429);
      if ((await used('transcribe', false, 86_400_000)) + seconds > LIMITS.transcribe.workspaceMinutesPerDay * 60) return json({ error: 'Your workspace has reached today’s listening time.' }, 429);
      await logUse('transcribe', seconds);
      const { text } = await callService('/transcribe', {
        audio, mime_type: String(body.mimeType ?? 'audio/webm').slice(0, 60), seconds, previous_text: String(scribe.transcript ?? '').slice(-400),
      });
      const transcript = [scribe.transcript, text].filter(Boolean).join(' ').slice(0, 200_000);
      await admin.from('consultation_scribes').update({ transcript, audio_seconds: scribe.audio_seconds + seconds, updated_at: new Date().toISOString() }).eq('id', scribe.id);
      return json({ text, transcript });
    }

    if (action === 'scribe_draft') {
      // The doctor may have corrected the transcript before drafting.
      const transcript = String(body.transcript ?? scribe.transcript ?? '').trim().slice(0, 120_000);
      if (transcript.length < 20) return json({ error: 'Not enough of the conversation was heard to draft a note.' }, 400);
      if ((await used('scribe_draft', true, 3_600_000)) >= LIMITS.scribe_draft.perHour) return json({ error: 'Too many drafts this hour. Try again later.' }, 429);
      if ((await used('scribe_draft', false, 86_400_000)) >= LIMITS.scribe_draft.workspacePerDay) return json({ error: 'Your workspace has reached today’s drafting limit.' }, 429);
      await logUse('scribe_draft');
      const [snapshot, { data: findings }] = await Promise.all([
        emrSnapshot(admin, scribe.patient_id),
        admin.from('dx_findings').select('id, label').order('sort'),
      ]);
      const draft = await callService('/scribe-note', { transcript, emr_snapshot: snapshot ?? {}, findings: findings ?? [] });

      // Symptoms heard → VitaMind Dx analysis, saved as an open session for this patient. When the
      // doctor signs a note with their diagnosis, the engine learns this case (dx_learn_from_note).
      let analysis: unknown = null;
      if (Array.isArray(draft.findings_present) && draft.findings_present.length) {
        const { data, error } = await asUser.rpc('dx_analyze', {
          p_organization_id: organizationId, p_patient_id: scribe.patient_id, p_age: null, p_sex: null,
          p_present: draft.findings_present, p_absent: draft.findings_absent ?? [],
          p_text: [draft.chief_complaint, draft.history_of_present_illness].filter(Boolean).join('. ').slice(0, 2000), p_save: true,
        });
        if (!error) analysis = data;
      }
      const sessionId = (analysis as { sessionId?: string } | null)?.sessionId ?? null;
      await admin.from('consultation_scribes').update({
        transcript, draft, status: 'drafted', dx_session_id: sessionId, updated_at: new Date().toISOString(),
      }).eq('id', scribe.id);
      return json({ draft, analysis });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (error) {
    const status = (error as { status?: number }).status ?? 502;
    return json({ error: error instanceof Error ? error.message : 'VitaMind AI failed.' }, status);
  }
});
