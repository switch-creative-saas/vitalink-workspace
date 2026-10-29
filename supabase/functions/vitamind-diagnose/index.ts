// VitaMind AI (paid tier) API: the browser calls this; it checks the user and
// the workspace's plan, assembles a de-identified EMR snapshot, records a
// vitamind_sessions row and forwards to the Python service (apps/vitamind-ai).
//
//   { action: 'status', organizationId }                         -> { access, configured }
//   { action: 'diagnose', organizationId, patientId?, chiefComplaint } -> result
//   { action: 'feedback', organizationId, resultId, feedback: 'confirm'|'override'|'partial', actualDiagnosis?, notes? }
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
// Spend protection (the service has its own token budgets too; see apps/vitamind-ai/README.md).
const DAILY_LIMIT = Number(Deno.env.get('VITAMIND_DAILY_LIMIT') ?? '300'); // per workspace per day
const GLOBAL_DAILY_LIMIT = Number(Deno.env.get('VITAMIND_GLOBAL_DAILY_LIMIT') ?? '1000'); // whole platform
const USER_PER_MINUTE = 3;
const USER_PER_HOUR = 30;
const MAX_COMPLAINT = 2000;
const CLINICAL = ['super-admin', 'hospital-admin', 'doctor', 'nurse', 'lab-scientist', 'lab-technician', 'pharmacist'];
const DOCTORS = ['super-admin', 'hospital-admin', 'doctor'];

async function callService(path: string, body: unknown) {
  const res = await fetch(`${SERVICE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-VitaMind-Token': SERVICE_TOKEN },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'VitaMind AI is unavailable right now.');
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
  const { data: membership } = await asUser.from('memberships').select('role, status')
    .eq('organization_id', organizationId).eq('user_id', user.id).maybeSingle();
  if (!membership || membership.status !== 'active' || !CLINICAL.includes(membership.role)) {
    return json({ error: 'Only clinical staff of this workspace can use VitaMind AI.' }, 403);
  }
  const { data: access } = await asUser.rpc('vitamind_access', { p_organization_id: organizationId });
  const configured = Boolean(SERVICE_URL && SERVICE_TOKEN);

  if (body.action === 'status') return json({ access: Boolean(access), configured });
  if (!access) return json({ error: 'VitaMind AI is part of a higher plan. Upgrade to use it.', code: 'upgrade_required' }, 402);
  if (!configured) return json({ error: 'VitaMind AI is not connected yet. A VitaLink admin needs to deploy the service.', code: 'not_configured' }, 503);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  try {
    if (body.action === 'feedback') {
      if (!DOCTORS.includes(membership.role)) return json({ error: 'Only doctors can confirm or override a result.' }, 403);
      // RLS: the result must belong to this workspace.
      const { data: result } = await asUser.from('vitamind_results').select('id, organization_id').eq('id', String(body.resultId)).maybeSingle();
      if (!result || result.organization_id !== organizationId) return json({ error: 'Result not found.' }, 404);
      const saved = await callService('/feedback', {
        result_id: result.id, clinician_id: user.id, action: body.feedback, actual_diagnosis: body.actualDiagnosis ?? null, notes: body.notes ?? null,
      });
      return json(saved);
    }

    if (body.action !== 'diagnose') return json({ error: 'Unknown action.' }, 400);
    const chiefComplaint = String(body.chiefComplaint ?? '').trim();
    if (chiefComplaint.length < 3) return json({ error: 'Describe the presenting complaint.' }, 400);
    if (chiefComplaint.length > MAX_COMPLAINT) return json({ error: `Keep the complaint under ${MAX_COMPLAINT} characters.` }, 400);

    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    const sessions = () => admin.from('vitamind_sessions').select('id', { count: 'exact', head: true });
    const [{ count: lastMinute }, { count: lastHour }, { count: workspaceDay }, { count: platformDay }] = await Promise.all([
      sessions().eq('created_by', user.id).gte('created_at', ago(60_000)),
      sessions().eq('created_by', user.id).gte('created_at', ago(3_600_000)),
      sessions().eq('organization_id', organizationId).gte('created_at', ago(86_400_000)),
      sessions().gte('created_at', ago(86_400_000)),
    ]);
    if ((lastMinute ?? 0) >= USER_PER_MINUTE) return json({ error: 'Too many analyses in a row. Wait a minute and try again.' }, 429);
    if ((lastHour ?? 0) >= USER_PER_HOUR) return json({ error: `You've run ${USER_PER_HOUR} analyses this hour. Try again later.` }, 429);
    if ((workspaceDay ?? 0) >= DAILY_LIMIT) return json({ error: `Daily VitaMind AI limit reached (${DAILY_LIMIT} analyses). Try again tomorrow.` }, 429);
    if ((platformDay ?? 0) >= GLOBAL_DAILY_LIMIT) return json({ error: 'VitaMind AI is paused for today. VitaLink has been alerted.' }, 503);

    let snapshot: Record<string, unknown> = {};
    const patientId = body.patientId ? String(body.patientId) : null;
    if (patientId) {
      // Read through RLS so the patient must be in a workspace the user can see.
      const { data: visible } = await asUser.from('patients').select('id').eq('id', patientId).eq('organization_id', organizationId).maybeSingle();
      if (!visible) return json({ error: 'Patient not found in this workspace.' }, 404);
      snapshot = (await emrSnapshot(admin, patientId)) ?? {};
    } else {
      snapshot = { age: body.age ?? null, sex: body.sex ?? null };
    }

    const { data: session, error: sessionError } = await asUser.from('vitamind_sessions')
      .insert({ organization_id: organizationId, patient_id: patientId, created_by: user.id, chief_complaint: chiefComplaint, structured_emr_snapshot: snapshot })
      .select('id').single();
    if (sessionError) return json({ error: sessionError.message }, 400);

    const result = await callService('/diagnose', { session_id: session.id, chief_complaint: chiefComplaint, emr_snapshot: snapshot });
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'VitaMind AI failed.' }, 502);
  }
});
