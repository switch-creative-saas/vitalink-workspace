// VitaLink Sentinel partner API: other healthcare systems (lab systems, DHIS2
// bridges, other EMRs) push de-identified case reports here.
//
//   POST /functions/v1/sentinel-ingest
//   Authorization: Bearer vlsk_...   (key created in Sentinel → Settings → Data sources)
//
// Body, either:
//   { "cases": [ { "external_id": "...", "disease": "cholera" | "A00.1" | "Cholera",
//                  "status": "suspected|probable|confirmed|recovered|deceased",
//                  "patient_id": "partner's own id (hashed, never stored)", "age": 34, "sex": "female",
//                  "state": "Lagos", "lga": "Ajeromi", "facility": "...", "onset_date": "2026-10-20",
//                  "report_date": "2026-10-22", "lab_confirmed": true, "hospitalized": false,
//                  "symptoms": ["fever"], "notes": "..." } ] }
// or a FHIR R4 Bundle with Condition resources (plus their Patient and, optionally,
// positive Observation resources). Names, phone numbers and addresses are ignored.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type Case = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
type Resource = Record<string, any>;

const POSITIVE = /(positive|detected|reactive|\bseen\b)/i;
const NEGATIVE = /(negative|not detected|non-?reactive|not seen)/i;

function ageFrom(birthDate?: string): number | undefined {
  if (!birthDate) return undefined;
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return undefined;
  return Math.floor((Date.now() - born.getTime()) / (365.25 * 86400000));
}

function codeOf(concept: Resource | undefined): string | undefined {
  if (!concept) return undefined;
  const icd = (concept.coding ?? []).find((c: Resource) => /icd-?10/i.test(c.system ?? ''));
  return icd?.code ?? concept.text ?? concept.coding?.[0]?.display ?? concept.coding?.[0]?.code;
}

function textOf(concept: Resource | undefined): string {
  return [concept?.text, ...(concept?.coding ?? []).map((c: Resource) => c.display)].filter(Boolean).join(' ');
}

/** FHIR R4 Bundle → the normalised case list sentinel_ingest expects. */
function fromFhir(bundle: Resource): Case[] {
  const resources: Resource[] = (bundle.entry ?? []).map((e: Resource) => ({ ...e.resource, _fullUrl: e.fullUrl })).filter(Boolean);
  const patients = new Map<string, Resource>();
  for (const r of resources.filter((r) => r.resourceType === 'Patient')) {
    if (r.id) patients.set(`Patient/${r.id}`, r);
    if (r._fullUrl) patients.set(r._fullUrl, r);
  }
  // Patients with a positive lab Observation get their conditions marked lab-confirmed.
  const labPositive = new Set<string>();
  for (const o of resources.filter((r) => r.resourceType === 'Observation')) {
    const value = [o.valueString, textOf(o.valueCodeableConcept), ...(o.interpretation ?? []).map(textOf)].filter(Boolean).join(' ');
    if (POSITIVE.test(value) && !NEGATIVE.test(value) && o.subject?.reference) labPositive.add(o.subject.reference);
  }

  return resources.filter((r) => r.resourceType === 'Condition').map((c) => {
    const ref: string | undefined = c.subject?.reference;
    const p = ref ? patients.get(ref) : undefined;
    const verification = c.verificationStatus?.coding?.[0]?.code as string | undefined;
    const clinical = c.clinicalStatus?.coding?.[0]?.code as string | undefined;
    const deceased = Boolean(p?.deceasedBoolean || p?.deceasedDateTime);
    const status = deceased ? 'deceased'
      : clinical === 'resolved' || clinical === 'remission' ? 'recovered'
      : verification === 'confirmed' ? 'confirmed'
      : verification === 'provisional' ? 'probable' : 'suspected';
    const address = p?.address?.[0] ?? {};
    return {
      external_id: c.identifier?.[0]?.value ?? c.id,
      disease: codeOf(c.code),
      status,
      patient_id: p?.identifier?.[0]?.value ?? p?.id ?? ref,
      age: ageFrom(p?.birthDate),
      sex: p?.gender,
      state: address.state,
      lga: address.district ?? address.city,
      onset_date: (c.onsetDateTime ?? c.onsetPeriod?.start ?? '').slice(0, 10) || undefined,
      report_date: (c.recordedDate ?? '').slice(0, 10) || undefined,
      lab_confirmed: ref ? labPositive.has(ref) : false,
      symptoms: (c.evidence ?? []).flatMap((e: Resource) => (e.code ?? []).map(textOf)).filter(Boolean),
      notes: (c.note ?? []).map((n: Resource) => n.text).join(' ').slice(0, 1000) || undefined,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  const key = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!key.startsWith('vlsk_')) return json({ error: 'Missing API key. Send "Authorization: Bearer vlsk_…".' }, 401);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Body must be JSON' }, 400);
  let cases: Case[];
  if (body.resourceType === 'Bundle') cases = fromFhir(body);
  else if (Array.isArray(body.cases)) cases = body.cases;
  else return json({ error: 'Send { "cases": [...] } or a FHIR R4 Bundle' }, 400);
  if (cases.length === 0) return json({ error: 'No cases in the request' }, 400);
  if (cases.length > 500) return json({ error: 'Send at most 500 cases per request' }, 413);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc('sentinel_ingest', { p_key: key, p_cases: cases });
  if (error) {
    if (/api key/i.test(error.message)) return json({ error: 'Invalid or revoked API key' }, 401);
    return json({ error: error.message }, 400);
  }
  const results = (data?.results ?? []) as Array<{ result: string }>;
  return json({
    ...data,
    accepted: results.filter((r) => r.result === 'accepted').length,
    updated: results.filter((r) => r.result === 'updated').length,
    rejected: results.filter((r) => r.result === 'rejected').length,
  });
});
