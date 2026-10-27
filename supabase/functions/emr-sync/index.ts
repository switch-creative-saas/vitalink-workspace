// Pulls patients and their records from a hospital's existing EMR into VitaLink.
//
//   POST /functions/v1/emr-sync   { action: "test" | "sync", connectionId }   (workspace admin's session)
//   POST /functions/v1/emr-sync   { action: "scheduled" } + x-emr-cron        (pg_cron, every 15 minutes)
//
// Connectors:
//   fhir      any FHIR R4 server (OpenEMR, HAPI, commercial EMRs with a FHIR API)
//   openmrs   OpenMRS-based EMRs: NMRS, Bahmni, OpenMRS 2.x/3.x (FHIR2 module at /ws/fhir2/R4)
//   lamisplus LAMISPlus (patient demographics; its clinical endpoints aren't published)
//
// The first sync walks every patient; later syncs fetch only what changed since the last
// one. Each run works for under a minute, saving its place after every page; a first sync
// that isn't finished hands over to a fresh run straight away.
// Everything is written through emr_apply_import, so re-importing never duplicates.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { addResource, emptyPatient, fromFhirPatient, fromFhirResources, type NormalisedPatient, type Resource, type Row } from '../_shared/emrFhir.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const service = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

// Edge functions are stopped after about a minute of background work, so each run takes a
// short slice, saves its place after every page and hands the next slice to a fresh run.
const RUN_BUDGET_MS = 45_000;
const REQUEST_TIMEOUT_MS = 25_000;
const BATCH = 25;
const CLINICAL_TYPES = ['Observation', 'Condition', 'AllergyIntolerance', 'MedicationRequest', 'Encounter', 'Immunization', 'Procedure'];

interface Connection {
  id: string; organization_id: string; system: string; method: 'fhir' | 'openmrs' | 'lamisplus' | 'push' | 'file'; name: string;
  base_url: string; auth_type: string; username: string | null; client_id: string | null; token_url: string | null; scope: string | null;
  secret: string | null; cursor: Record<string, unknown>;
}

class SyncError extends Error {}

// ---------------------------------------------------------------------------
// HTTP to the hospital's EMR

/** Only public https hosts; never this platform's own network or a private address. */
function assertSafeUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new SyncError('The EMR address must start with https://');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host === '0.0.0.0' ||
      /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.startsWith('[')) {
    throw new SyncError('That address is on a private network. The EMR must be reachable over the internet (ask its IT team for a secure public URL or VPN gateway).');
  }
}

class EmrClient {
  private token: string | null = null;
  readonly origin: string;
  constructor(readonly conn: Connection, readonly base: string) {
    assertSafeUrl(base);
    this.origin = new URL(base).origin;
  }

  private async authHeader(): Promise<Record<string, string>> {
    const { conn } = this;
    switch (conn.auth_type) {
      case 'basic': return { Authorization: `Basic ${btoa(`${conn.username ?? ''}:${conn.secret ?? ''}`)}` };
      case 'bearer': return { Authorization: `Bearer ${conn.secret ?? ''}` };
      case 'oauth2_client':
      case 'oauth2_password': {
        if (!this.token) {
          if (!conn.token_url) throw new SyncError('Add the OAuth token URL for this EMR.');
          assertSafeUrl(conn.token_url);
          const form = new URLSearchParams(conn.auth_type === 'oauth2_client'
            ? { grant_type: 'client_credentials', client_id: conn.client_id ?? '', client_secret: conn.secret ?? '' }
            // OpenEMR's password grant also needs user_role.
            : { grant_type: 'password', client_id: conn.client_id ?? '', username: conn.username ?? '', password: conn.secret ?? '', user_role: 'users' });
          if (conn.scope) form.set('scope', conn.scope);
          const res = await fetch(conn.token_url, { method: 'POST', body: form, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || !body.access_token) throw new SyncError(`The EMR refused the sign-in (${res.status}${body.error_description ? `: ${body.error_description}` : body.error ? `: ${body.error}` : ''}).`);
          this.token = body.access_token;
        }
        return { Authorization: `Bearer ${this.token}` };
      }
      case 'lamisplus': {
        if (!this.token) {
          const res = await fetch(`${this.base}/core/api/v1/auth/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: conn.username, password: conn.secret }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok || !body.accessToken) throw new SyncError(`LAMISPlus refused the sign-in (${res.status}). Check the email and password.`);
          this.token = body.accessToken;
        }
        return { Authorization: `Bearer ${this.token}` };
      }
      default: return {};
    }
  }

  /** GET a URL on the EMR. Links the EMR hands back (paging) are pinned to its configured address. */
  async get(pathOrUrl: string, accept = 'application/fhir+json, application/json'): Promise<{ status: number; body: Resource | null }> {
    const url = new URL(pathOrUrl.startsWith('http') ? pathOrUrl : `${this.base}/${pathOrUrl.replace(/^\//, '')}`);
    if (url.origin !== this.origin) { const pinned = new URL(this.origin); url.protocol = pinned.protocol; url.host = pinned.host; }
    const res = await fetch(url, { headers: { Accept: accept, ...(await this.authHeader()) }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (res.status === 401 || res.status === 403) throw new SyncError(`The EMR rejected VitaLink's credentials (${res.status}). Check the username, password or token.`);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }
}

const fhirBase = (conn: Connection) => {
  const base = conn.base_url.replace(/\/+$/, '');
  if (conn.method !== 'openmrs' || /\/ws\/fhir2\/R4$/i.test(base)) return base;
  // Accept https://host, https://host/openmrs or the full FHIR address.
  return /\/openmrs$/i.test(base) ? `${base}/ws/fhir2/R4` : `${base}/openmrs/ws/fhir2/R4`;
};

const nextLink = (bundle: Resource | null): string | null => bundle?.link?.find((l: Resource) => l.relation === 'next')?.url ?? null;
const entries = (bundle: Resource | null): Resource[] => (bundle?.entry ?? []).map((e: Resource) => e.resource).filter(Boolean);

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const n = i++; out[n] = await fn(items[n]); }
  }));
  return out;
}

// ---------------------------------------------------------------------------
// Connectors: each yields batches of normalised patients and returns the next cursor

type Emit = (patients: NormalisedPatient[]) => Promise<void>;
type SaveCursor = (cursor: Record<string, unknown>) => Promise<void>;
interface PullResult { cursor: Record<string, unknown>; finished: boolean; warnings: string[] }

/** Everything recorded for one patient (each resource type is optional on the server). */
async function patientRecords(client: EmrClient, patient: Resource, warnings: Set<string>): Promise<NormalisedPatient> {
  const normalised = fromFhirPatient(patient);
  const vitals = new Map<string, Row>();
  await Promise.all(CLINICAL_TYPES.map(async (type) => {
    try {
      const { status, body } = await client.get(`${type}?patient=${encodeURIComponent(patient.id)}&_count=100`);
      if (status >= 400) { warnings.add(`${type} isn't available on this EMR (${status})`); return; }
      for (const r of entries(body)) addResource(normalised, r, vitals);
    } catch (error) {
      if (error instanceof SyncError) throw error;
      warnings.add(`${type}: ${(error as Error).message}`);
    }
  }));
  return normalised;
}

async function pullFhir(conn: Connection, deadline: number, emit: Emit, save: SaveCursor): Promise<PullResult> {
  const client = new EmrClient(conn, fhirBase(conn));
  const warnings = new Set<string>();
  const cursor = { ...conn.cursor } as { since?: string; next?: string; initialStartedAt?: string };
  const startedAt = new Date(Date.now() - 2 * 60_000).toISOString(); // small overlap for clock skew

  if (!cursor.since) {
    // First sync: every patient, page by page.
    cursor.initialStartedAt ??= startedAt;
    let url: string | null = cursor.next ?? 'Patient?_count=10';
    while (url && Date.now() < deadline) {
      const { status, body } = await client.get(url);
      if (status >= 400) throw new SyncError(`The EMR's Patient list returned ${status}. Is this the FHIR R4 address?`);
      const patients = entries(body).filter((r) => r.resourceType === 'Patient' && r.id);
      const records = await mapLimit(patients, 4, (p) => patientRecords(client, p, warnings));
      for (let i = 0; i < records.length; i += BATCH) await emit(records.slice(i, i + BATCH));
      url = nextLink(body);
      cursor.next = url ?? undefined;
      await save(cursor);
    }
    if (url) return { cursor, finished: false, warnings: [...warnings] };
    return { cursor: { since: cursor.initialStartedAt }, finished: true, warnings: [...warnings] };
  }

  // Later syncs: whatever changed since the last complete one.
  const resources: Resource[] = [];
  for (const type of ['Patient', ...CLINICAL_TYPES]) {
    let url: string | null = `${type}?_lastUpdated=gt${encodeURIComponent(cursor.since)}&_count=100`;
    while (url && Date.now() < deadline) {
      const { status, body } = await client.get(url);
      if (status >= 400) { warnings.add(`${type} changes aren't searchable on this EMR (${status})`); break; }
      resources.push(...entries(body));
      url = nextLink(body);
    }
    if (url) break;
  }
  const finished = Date.now() < deadline;
  const { patients } = fromFhirResources(resources);
  // Patients whose details didn't change still need a name and date of birth if VitaLink hasn't seen them.
  await mapLimit(patients.filter((p) => !p.first_name), 5, async (p) => {
    const { status, body } = await client.get(`Patient/${encodeURIComponent(p.external_id)}`);
    if (status < 400 && body?.resourceType === 'Patient') Object.assign(p, { ...fromFhirPatient(body), ...pickClinical(p) });
  });
  for (let i = 0; i < patients.length; i += BATCH) await emit(patients.slice(i, i + BATCH));
  return { cursor: finished ? { since: startedAt } : cursor, finished, warnings: [...warnings] };
}

function pickClinical(p: NormalisedPatient) {
  const { allergies, conditions, medications, vitals, labs, encounters, notes, immunizations, procedures, observations } = p;
  return { allergies, conditions, medications, vitals, labs, encounters, notes, immunizations, procedures, observations };
}

/** LAMISPlus person record → normalised patient (field names vary between LAMISPlus versions). */
function fromLamis(p: Resource): NormalisedPatient | null {
  const id = p.uuid ?? p.id ?? p.personUuid;
  if (!id) return null;
  const contacts: Resource[] = p.contactPoint?.contactPoint ?? p.contactPoints ?? [];
  const identifiers: Resource[] = p.identifier?.identifier ?? p.identifiers ?? [];
  const address = (p.address?.address ?? p.addresses ?? [])[0] ?? {};
  const sex = typeof p.sex === 'object' ? p.sex?.display : p.sex ?? (typeof p.gender === 'object' ? p.gender?.display : p.gender);
  return {
    ...emptyPatient(String(id)),
    first_name: p.firstName ?? p.first_name ?? p.givenName,
    middle_name: p.otherName ?? p.middleName,
    last_name: p.surname ?? p.lastName ?? p.familyName,
    date_of_birth: p.dateOfBirth ?? p.dob,
    gender: sex,
    phone: contacts.find((c) => /phone/i.test(c.type ?? ''))?.value ?? p.phoneNumber,
    email: contacts.find((c) => /email/i.test(c.type ?? ''))?.value,
    address: [...(address.line ?? []), address.city].filter(Boolean).join(', ') || undefined,
    national_id: identifiers.find((i) => /nin|national/i.test(i.type ?? ''))?.value,
  };
}

async function pullLamis(conn: Connection, deadline: number, emit: Emit, save: SaveCursor): Promise<PullResult> {
  const client = new EmrClient(conn, conn.base_url.replace(/\/+$/, ''));
  let page = Number(conn.cursor.page ?? 0);
  const size = 100;
  while (Date.now() < deadline) {
    const { status, body } = await client.get(`plugin/ehr/api/v1/patient?page=${page}&size=${size}`, 'application/json');
    if (status >= 400) throw new SyncError(`LAMISPlus returned ${status} for the patient list.`);
    const list: Resource[] = body?.data?.patients ?? body?.content ?? body?.data ?? (Array.isArray(body) ? body : []);
    const patients = list.map(fromLamis).filter((p): p is NormalisedPatient => p !== null);
    for (let i = 0; i < patients.length; i += BATCH) await emit(patients.slice(i, i + BATCH));
    if (list.length < size) return { cursor: { page: 0, lastFullScan: new Date().toISOString() }, finished: true, warnings: [] };
    page += 1;
    await save({ page });
  }
  return { cursor: { page }, finished: false, warnings: [] };
}

// ---------------------------------------------------------------------------
// Running a sync

async function loadConnection(id: string): Promise<Connection> {
  const { data, error } = await service.rpc('emr_sync_config', { p_id: id });
  if (error || !data) throw new SyncError(error?.message ?? 'Connection not found');
  return data as Connection;
}

/** Returns true when there's more to fetch (a first sync that didn't finish in this slice). */
async function runSync(connectionId: string, runId: string, deadline: number): Promise<boolean> {
  let cursor: Record<string, unknown> | null = null;
  try {
    const conn = await loadConnection(connectionId);
    const emit: Emit = async (patients) => {
      if (!patients.length) return;
      const { error } = await service.rpc('emr_apply_import', { p_run: runId, p_payload: { patients } });
      if (error) throw new SyncError(error.message);
    };
    const save: SaveCursor = async (next) => {
      cursor = next;
      await service.from('emr_connections').update({ cursor: next }).eq('id', connectionId);
    };
    const result = conn.method === 'lamisplus' ? await pullLamis(conn, deadline, emit, save)
      : conn.method === 'fhir' || conn.method === 'openmrs' ? await pullFhir(conn, deadline, emit, save)
      : null;
    if (!result) throw new SyncError('This connection receives records; it has nothing to pull.');
    cursor = result.cursor;
    if (result.warnings.length) {
      // Added after the per-patient errors emr_apply_import recorded, not in place of them.
      const { data: run } = await service.from('emr_sync_runs').select('errors').eq('id', runId).single();
      const errors = [...((run?.errors as unknown[]) ?? []), ...result.warnings.slice(0, 20).map((w) => ({ warning: w }))];
      await service.from('emr_sync_runs').update({ errors }).eq('id', runId);
    }
    await service.rpc('emr_finish_run', { p_run: runId, p_error: null, p_cursor: cursor });
    return !result.finished;
  } catch (error) {
    const message = error instanceof SyncError ? error.message
      : error instanceof DOMException && error.name === 'TimeoutError' ? "The EMR didn't answer in time. It may be offline or very slow."
      : error instanceof TypeError ? `Couldn't reach the EMR: ${error.message}`
      : (error as Error).message;
    await service.rpc('emr_finish_run', { p_run: runId, p_error: message, p_cursor: cursor });
    return false;
  }
}

/** Starts the next slice in a fresh function run (each run is short-lived). */
async function continueLater(connectionId: string) {
  const { data: secret } = await service.rpc('emr_cron_secret');
  await fetch(`${SUPABASE_URL}/functions/v1/emr-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-emr-cron': String(secret) },
    body: JSON.stringify({ action: 'continue', connectionId }),
  }).catch(() => undefined);
}

async function syncAndContinue(connectionId: string, runId: string, deadline: number) {
  if (await runSync(connectionId, runId, deadline)) await continueLater(connectionId);
}

/** Checks the address and credentials and reports what the EMR is, without importing anything. */
async function testConnection(conn: Connection): Promise<Row> {
  if (conn.method === 'lamisplus') {
    const client = new EmrClient(conn, conn.base_url.replace(/\/+$/, ''));
    const { status, body } = await client.get('plugin/ehr/api/v1/patient?page=0&size=1', 'application/json');
    if (status >= 400) throw new SyncError(`LAMISPlus answered ${status} for the patient list.`);
    return { software: 'LAMISPlus', patients: body?.data?.totalRecords ?? body?.totalElements ?? null };
  }
  const client = new EmrClient(conn, fhirBase(conn));
  const meta = await client.get('metadata');
  if (meta.status >= 400 || meta.body?.resourceType !== 'CapabilityStatement') {
    throw new SyncError(`No FHIR server answered at ${fhirBase(conn)} (${meta.status}).${conn.method === 'openmrs' ? ' Check that the FHIR2 module is installed in OpenMRS.' : ''}`);
  }
  const sample = await client.get('Patient?_count=1&_summary=count');
  const supported = (meta.body.rest?.[0]?.resource ?? []).map((r: Resource) => r.type) as string[];
  return {
    software: [meta.body.software?.name, meta.body.software?.version].filter(Boolean).join(' ') || meta.body.publisher || 'FHIR server',
    fhirVersion: meta.body.fhirVersion,
    patients: sample.body?.total ?? null,
    supports: ['Patient', ...CLINICAL_TYPES].filter((t) => supported.length === 0 || supported.includes(t)),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const body = await req.json().catch(() => ({}));
  const started = Date.now();

  if (body.action === 'scheduled' || body.action === 'continue') {
    const { data: secret } = await service.rpc('emr_cron_secret');
    if (!secret || req.headers.get('x-emr-cron') !== secret) return json({ error: 'Forbidden' }, 403);
    if (body.action === 'continue') {
      const { data: runId, error } = await service.rpc('emr_begin_run', { p_connection: String(body.connectionId), p_trigger: 'schedule' });
      if (error) return json({ error: error.message }, 400);
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil(syncAndContinue(String(body.connectionId), runId as string, started + RUN_BUDGET_MS));
      return json({ runId });
    }
    const { data: due } = await service.rpc('emr_due_connections');
    const ran: string[] = [];
    for (const id of (due ?? []) as string[]) {
      if (Date.now() - started > RUN_BUDGET_MS - 15_000) break;
      const { data: runId, error } = await service.rpc('emr_begin_run', { p_connection: id, p_trigger: 'schedule' });
      if (error) continue;
      if (await runSync(id, runId as string, started + RUN_BUDGET_MS)) await continueLater(id);
      ran.push(id);
    }
    return json({ ran: ran.length });
  }

  // Manual actions: the caller must be an admin of the connection's workspace (checked by emr_begin_run).
  const authorization = req.headers.get('Authorization') ?? '';
  const user: SupabaseClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
  });
  const connectionId = String(body.connectionId ?? '');
  if (!connectionId || !['test', 'sync'].includes(body.action)) return json({ error: 'Send action "test" or "sync" with a connectionId.' }, 400);
  const { data: runId, error } = await user.rpc('emr_begin_run', { p_connection: connectionId, p_trigger: body.action === 'test' ? 'test' : 'manual' });
  if (error) return json({ error: error.message }, error.code === '42501' ? 403 : 400);

  if (body.action === 'test') {
    try {
      const info = await testConnection(await loadConnection(connectionId));
      await service.from('emr_sync_runs').update({ counts: info }).eq('id', runId);
      await service.rpc('emr_finish_run', { p_run: runId, p_error: null, p_cursor: null });
      return json({ ok: true, ...info });
    } catch (e) {
      const message = e instanceof SyncError ? e.message : e instanceof DOMException ? "The EMR didn't answer in time." : `Couldn't reach the EMR: ${(e as Error).message}`;
      await service.rpc('emr_finish_run', { p_run: runId, p_error: message, p_cursor: null });
      return json({ ok: false, error: message });
    }
  }

  // Sync carries on after the reply; the app follows progress in emr_sync_runs.
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil(syncAndContinue(connectionId, runId as string, started + RUN_BUDGET_MS));
  return json({ runId });
});
