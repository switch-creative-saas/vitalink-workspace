// Records pushed to VitaLink by a hospital's existing EMR (Helium Health, LafiaLink,
// ClinikEHR, CarePlus, a lab system, an integration engine...).
//
//   POST /functions/v1/emr-ingest
//   Authorization: Bearer vlek_...   (Administration → Connected EMRs → Create push key)
//
// Body, either:
//   - a FHIR R4 Bundle (batch, transaction or collection), a single resource, or an array
//     of resources: Patient, Observation, Condition, AllergyIntolerance, MedicationRequest,
//     MedicationStatement, Encounter, Immunization, Procedure, DocumentReference, DiagnosticReport
//   - VitaLink's simple JSON: { "patients": [ { "external_id": "MRN-1001", "first_name": "...",
//       "last_name": "...", "date_of_birth": "1985-03-12", "gender": "female", "phone": "...",
//       "vitals": [...], "labs": [...], "conditions": [...], ... } ] }  (see emr_apply_import)
//
// Clinical resources for a patient VitaLink hasn't seen yet need that Patient in the same
// request (or an earlier one). Up to 500 patients per request.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { fromFhirResources, resourcesOf, type Resource } from '../_shared/emrFhir.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const MAX_PATIENTS = 500;
const BATCH = 50;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const key = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!key.startsWith('vlek_')) return json({ error: 'Send your VitaLink push key as "Authorization: Bearer vlek_..."' }, 401);
  const { data: conn } = await service.rpc('emr_push_connection', { p_key: key });
  if (!conn) return json({ error: 'Unknown or revoked push key' }, 401);
  if (conn.status === 'paused') return json({ error: 'This connection is paused in VitaLink' }, 423);

  let body: Resource;
  try { body = await req.json(); } catch { return json({ error: 'Body must be JSON' }, 400); }

  const fhir = resourcesOf(body);
  const { patients, skipped } = fhir.length ? fromFhirResources(fhir) : { patients: (body.patients ?? []) as Resource[], skipped: 0 };
  if (!patients.length) return json({ error: 'Nothing to import: send a FHIR Bundle/resource or { "patients": [...] }' }, 400);
  if (patients.length > MAX_PATIENTS) return json({ error: `Send at most ${MAX_PATIENTS} patients per request` }, 413);

  const { data: runId, error: runError } = await service.rpc('emr_begin_run', { p_connection: conn.id, p_trigger: 'push' });
  if (runError) return json({ error: runError.message }, 500);

  try {
    for (let i = 0; i < patients.length; i += BATCH) {
      const { error } = await service.rpc('emr_apply_import', { p_run: runId, p_payload: { patients: patients.slice(i, i + BATCH) } });
      if (error) throw new Error(error.message);
    }
    const { data: result } = await service.rpc('emr_finish_run', { p_run: runId, p_error: null, p_cursor: null });
    return json({ ...(result as Resource), skippedResources: skipped, runId });
  } catch (error) {
    await service.rpc('emr_finish_run', { p_run: runId, p_error: (error as Error).message, p_cursor: null });
    return json({ error: (error as Error).message, runId }, 500);
  }
});
