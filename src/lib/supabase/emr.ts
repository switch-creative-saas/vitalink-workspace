// Connected EMRs: hospitals that already run another EMR see those patients and
// records in VitaLink (see supabase/functions/emr-sync, emr-ingest and the
// emr_* functions in the database).
import { requireSupabase, functionErrorMessage } from './client';
import type { EmrAuthType, EmrMethod } from '@/lib/emr/catalog';

export interface EmrConnection {
  id: string;
  system: string;
  method: EmrMethod;
  name: string;
  baseUrl: string | null;
  authType: EmrAuthType;
  username: string | null;
  clientId: string | null;
  tokenUrl: string | null;
  scope: string | null;
  pushKeyPrefix: string | null;
  autoSync: boolean;
  syncEveryMinutes: number;
  status: 'active' | 'paused' | 'error';
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  patientsLinked: number;
  initialSyncDone: boolean;
}

export interface EmrSyncRun {
  id: string;
  connectionId: string;
  trigger: 'manual' | 'schedule' | 'push' | 'file' | 'test';
  status: 'running' | 'success' | 'partial' | 'failed';
  counts: { patients?: number; created?: number; vitals?: number; labs?: number; records?: number; software?: string; patients_total?: number };
  errors: Array<{ patient?: string; error?: string; warning?: string }>;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface EmrRecord {
  id: string;
  sourceName: string;
  kind: 'encounter' | 'condition' | 'allergy' | 'medication' | 'immunization' | 'procedure' | 'note' | 'observation';
  recordedAt: string | null;
  title: string;
  detail: string | null;
  status: string | null;
}

const COLUMNS = 'id, system, method, name, base_url, auth_type, username, client_id, token_url, scope, push_key_prefix, auto_sync, sync_every_minutes, status, cursor, last_sync_at, last_success_at, last_error';

export async function listEmrConnections(organizationId: string): Promise<EmrConnection[]> {
  const db = requireSupabase();
  const { data, error } = await db.from('emr_connections').select(COLUMNS).eq('organization_id', organizationId).order('created_at');
  if (error) throw new Error(error.message);
  const linked = new Map<string, number>();
  await Promise.all((data ?? []).map(async (c) => {
    const { count } = await db.from('emr_patient_links').select('patient_id', { count: 'exact', head: true }).eq('connection_id', c.id);
    linked.set(c.id, count ?? 0);
  }));
  return (data ?? []).map((c) => ({
    id: c.id, system: c.system, method: c.method, name: c.name, baseUrl: c.base_url, authType: c.auth_type, username: c.username,
    clientId: c.client_id, tokenUrl: c.token_url, scope: c.scope, pushKeyPrefix: c.push_key_prefix, autoSync: c.auto_sync,
    syncEveryMinutes: c.sync_every_minutes, status: c.status, lastSyncAt: c.last_sync_at, lastSuccessAt: c.last_success_at,
    lastError: c.last_error, patientsLinked: linked.get(c.id) ?? 0, initialSyncDone: Boolean((c.cursor as { since?: string } | null)?.since),
  }));
}

export interface SaveEmrConnection {
  id?: string;
  system: string;
  method: EmrMethod;
  name: string;
  baseUrl?: string;
  authType?: EmrAuthType;
  username?: string;
  clientId?: string;
  tokenUrl?: string;
  scope?: string;
  /** Password, token or client secret. Blank keeps the saved one. */
  secret?: string;
  autoSync?: boolean;
  syncEveryMinutes?: number;
}

export async function saveEmrConnection(organizationId: string, input: SaveEmrConnection): Promise<string> {
  const { data, error } = await requireSupabase().rpc('emr_save_connection', {
    p_id: input.id ?? null, p_org: organizationId, p_system: input.system, p_method: input.method, p_name: input.name,
    p_base_url: input.baseUrl ?? null, p_auth_type: input.authType ?? 'none', p_username: input.username ?? null,
    p_client_id: input.clientId ?? null, p_token_url: input.tokenUrl ?? null, p_scope: input.scope ?? null,
    p_secret: input.secret ?? null, p_auto_sync: input.autoSync ?? true, p_sync_every_minutes: input.syncEveryMinutes ?? 60,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function deleteEmrConnection(id: string) {
  const { error } = await requireSupabase().rpc('emr_delete_connection', { p_id: id });
  if (error) throw new Error(error.message);
}

export async function setEmrConnectionPaused(id: string, paused: boolean) {
  const { error } = await requireSupabase().rpc('emr_set_status', { p_id: id, p_status: paused ? 'paused' : 'active' });
  if (error) throw new Error(error.message);
}

/** Shown once; only its hash is stored. */
export async function createEmrPushKey(id: string): Promise<string> {
  const { data, error } = await requireSupabase().rpc('emr_create_push_key', { p_id: id });
  if (error) throw new Error(error.message);
  return data as string;
}

export const EMR_PUSH_URL = `${(import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''}/functions/v1/emr-ingest`;

export interface EmrTestResult { ok: boolean; error?: string; software?: string; fhirVersion?: string; patients?: number | null; supports?: string[] }

export async function testEmrConnection(id: string): Promise<EmrTestResult> {
  const { data, error } = await requireSupabase().functions.invoke('emr-sync', { body: { action: 'test', connectionId: id } });
  if (error) return { ok: false, error: await functionErrorMessage(error) };
  return data as EmrTestResult;
}

/** Starts a sync in the background; follow it with listEmrRuns. */
export async function startEmrSync(id: string): Promise<string> {
  const { data, error } = await requireSupabase().functions.invoke('emr-sync', { body: { action: 'sync', connectionId: id } });
  if (error) throw new Error(await functionErrorMessage(error));
  return (data as { runId: string }).runId;
}

export async function listEmrRuns(connectionId: string, limit = 10): Promise<EmrSyncRun[]> {
  const { data, error } = await requireSupabase().from('emr_sync_runs')
    .select('id, connection_id, trigger, status, counts, errors, error, started_at, finished_at')
    .eq('connection_id', connectionId).order('started_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id, connectionId: r.connection_id, trigger: r.trigger, status: r.status, counts: r.counts ?? {}, errors: r.errors ?? [],
    error: r.error, startedAt: r.started_at, finishedAt: r.finished_at,
  }));
}

/** File import: rows already turned into the normalised patient format. */
export async function importEmrPatients(connectionId: string, patients: Array<Record<string, unknown>>,
  onProgress?: (done: number) => void): Promise<{ status: string; counts: EmrSyncRun['counts']; errors: EmrSyncRun['errors'] }> {
  const db = requireSupabase();
  const { data: runId, error } = await db.rpc('emr_begin_run', { p_connection: connectionId, p_trigger: 'file' });
  if (error) throw new Error(error.message);
  try {
    for (let i = 0; i < patients.length; i += 50) {
      const { error: batchError } = await db.rpc('emr_apply_import', { p_run: runId, p_payload: { patients: patients.slice(i, i + 50) } });
      if (batchError) throw new Error(batchError.message);
      onProgress?.(Math.min(i + 50, patients.length));
    }
  } catch (e) {
    await db.rpc('emr_finish_run', { p_run: runId, p_error: (e as Error).message, p_cursor: null });
    throw e;
  }
  const { data: result, error: finishError } = await db.rpc('emr_finish_run', { p_run: runId, p_error: null, p_cursor: null });
  if (finishError) throw new Error(finishError.message);
  return result as { status: string; counts: EmrSyncRun['counts']; errors: EmrSyncRun['errors'] };
}

export async function listEmrRecords(patientId: string): Promise<EmrRecord[]> {
  const { data, error } = await requireSupabase().from('emr_records')
    .select('id, source_name, kind, recorded_at, title, detail, status')
    .eq('patient_id', patientId).order('recorded_at', { ascending: false, nullsFirst: false }).limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ id: r.id, sourceName: r.source_name, kind: r.kind, recordedAt: r.recorded_at, title: r.title, detail: r.detail, status: r.status }));
}

/** EMRs this patient is linked to, with their id in each. */
export async function listPatientEmrLinks(patientId: string): Promise<Array<{ connectionId: string; externalId: string }>> {
  const { data, error } = await requireSupabase().from('emr_patient_links').select('connection_id, external_id').eq('patient_id', patientId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((l) => ({ connectionId: l.connection_id, externalId: l.external_id }));
}
