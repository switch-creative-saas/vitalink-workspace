// Offline support for every Supabase data call, installed as the client's fetch.
//
// Reads: tried on the network first. Successful responses are saved (encrypted)
// on this device; with no connection the saved copy is returned instead, with
// any changes still waiting to sync applied on top.
//
// Writes, for the workflows that work offline (patient registration, clinical
// notes and vitals, appointments, lab and pharmacy): sent straight away when
// online. Without a connection they are queued on the device, the screen gets
// the same answer it would have got, and the queue is sent in order once the
// connection returns. Every queued change can be sent twice without being
// applied twice: inserts carry an id made on this device (a repeat is a
// duplicate-key error) and functions go through `offline_replay` with a request id.
//
// Everything else (sign-in, uploads, edge functions, admin actions) behaves as
// before and fails with a clear message while offline.
import { cacheGet, cachePut, cacheScan, clearCache, hashKey, outboxAll, outboxCountAll, outboxDelete, outboxPut, pruneCache, userKey, wipeVault } from './vault';
import { refreshInterval } from '@/lib/network/dataSaver';

type Row = Record<string, unknown>;

/** Table writes that may be queued offline, by method. */
const OFFLINE_TABLES: Record<string, ReadonlyArray<string>> = {
  patients: ['POST', 'PATCH'],
  clinical_notes: ['POST', 'PATCH'],
  vitals: ['POST'],
  lab_results: ['POST', 'PATCH'],
  lab_orders: ['PATCH'],
  appointments: ['POST', 'PATCH'],
  prescriptions: ['POST', 'PATCH'],
};
/** Functions that may be queued offline (always sent through offline_replay). */
const OFFLINE_RPCS = new Set(['create_lab_order', 'save_lab_results', 'dispense_prescription']);
/** Functions that only read, so a saved answer may be shown offline. */
const READ_RPCS = new Set([
  'administration_overview', 'am_i_platform_admin', 'analytics_overview', 'console_admins', 'console_feed', 'console_inbox',
  'console_my_prefs', 'console_outbox_status', 'console_overview', 'console_payments', 'console_ticket', 'console_workspace',
  'console_workspace_crm', 'console_workspaces', 'dashboard_summary', 'dx_active_outbreaks', 'dx_model_stats', 'dx_patient_insights',
  'global_search', 'network_directory', 'network_patient_received_records', 'network_patient_records',
  'patient_care_flags', 'preview_unbilled_items', 'recent_activity', 'security_audit_feed', 'security_policy', 'security_sessions',
  'telemedicine_visit', 'vitalink_sentinel_links',
]);
const LABELS: Record<string, string> = {
  'POST patients': 'Register patient', 'PATCH patients': 'Update patient record',
  'POST clinical_notes': 'Save clinical note', 'PATCH clinical_notes': 'Update clinical note',
  'POST vitals': 'Record vitals', 'POST lab_results': 'Add lab result', 'PATCH lab_results': 'Update lab result',
  'PATCH lab_orders': 'Update lab order', 'POST appointments': 'Book appointment', 'PATCH appointments': 'Update appointment',
  'POST prescriptions': 'Write prescription', 'PATCH prescriptions': 'Update prescription',
  create_lab_order: 'Order lab tests', save_lab_results: 'Save lab results', dispense_prescription: 'Dispense prescription',
};

/** Column defaults the database would fill in, so rows made offline look like the real thing. */
const DEFAULTS: Record<string, Row> = {
  patients: { status: 'active', country: 'Nigeria', address: '', state: '', tags: [], nfc_active: false, emergency_contact_name: '', emergency_phone: '', emergency_relationship: '' },
  clinical_notes: { status: 'draft', content: {}, chief_complaint: '', primary_diagnosis: '', risk_level: 'moderate', version: 1 },
  appointments: { status: 'pending', check_in_status: 'not-arrived', department: '', duration_minutes: 30, history: [], insurance_type: 'self-pay', priority: 'routine', type: 'Consultation', visit_reason: '', queue_number: null },
  lab_results: { department: 'Laboratory', flag: 'Normal', reference_range: '', status: 'Pending', test_type: 'General', unit: '', value: '' },
  prescriptions: { status: 'active', dosage: '', frequency: '', route: 'oral', dispensed_at: null, dispensed_quantity: null },
  vitals: {},
};

const READ_TIMEOUT_MS = 12_000;
const LAST_USER_KEY = 'vitalink-offline-user';

/** What a queued change does to local data until it reaches the server. */
type Effect =
  | { op: 'insert'; table: string; row: Row }
  | { op: 'patch'; table: string; id: string; fields: Row; decrement?: Record<string, number>; lines?: Array<{ id: string; fields: Row }> };

export interface OutboxEntry {
  id: string;
  seq: number;
  userId: string;
  createdAt: string;
  label: string;
  /** Table name, or `rpc:<function>` */
  target: string;
  method: 'POST' | 'PATCH';
  path: string;
  headers: Record<string, string>;
  body: unknown;
  effects: Effect[];
  status: 'pending' | 'failed';
  error?: string;
  attempts: number;
}

export interface OfflineStatus {
  online: boolean;
  /** Changes waiting to be sent. */
  pending: number;
  /** Changes the server refused; they need someone to retry or discard them. */
  failed: OutboxEntry[];
  syncing: boolean;
  /** Some data on screen came from this device rather than the server. */
  showingSaved: boolean;
  lastSyncedAt: number | null;
}

const nativeFetch: typeof fetch = (...args) => globalThis.fetch(...args);
let restUrl = '';
let apiKey = '';
let getAccessToken: () => Promise<string | null> = async () => null;

let entries: OutboxEntry[] = [];
let loadedFor: string | null = null;
let loading: Promise<void> | null = null;
let seqCounter = 0;
let flushing = false;

let status: OfflineStatus = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: 0, failed: [], syncing: false, showingSaved: false, lastSyncedAt: null,
};
const listeners = new Set<() => void>();

function setStatus(patch: Partial<OfflineStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((listener) => listener());
}
function refreshCounts() {
  setStatus({ pending: entries.filter((e) => e.status === 'pending').length, failed: entries.filter((e) => e.status === 'failed') });
}
export const subscribeOffline = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getOfflineStatus = () => status;

const markOnline = () => { if (!status.online || status.showingSaved) setStatus({ online: true, showingSaved: false }); };
const markOffline = () => { if (status.online) setStatus({ online: false }); };

// ---------------------------------------------------------------------------
// Users

function jwtUser(authorization: string | null): string | null {
  const token = authorization?.replace(/^Bearer\s+/i, '');
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string; role?: string };
    return claims.role === 'authenticated' && claims.sub ? claims.sub : null;
  } catch {
    return null;
  }
}

function lastUser(): string | null {
  try { return localStorage.getItem(LAST_USER_KEY); } catch { return null; }
}
function rememberUser(userId: string) {
  try { if (localStorage.getItem(LAST_USER_KEY) !== userId) localStorage.setItem(LAST_USER_KEY, userId); } catch { /* storage unavailable */ }
  void loadQueue(userId);
}

/** The user who last signed in on this device, if their offline data is still here. */
export async function offlineUserId(): Promise<string | null> {
  const userId = lastUser();
  return userId && (await userKey(userId, false)) ? userId : null;
}

function loadQueue(userId: string): Promise<void> {
  if (loadedFor === userId && loading) return loading;
  loadedFor = userId;
  loading = outboxAll<OutboxEntry>(userId).then((stored) => {
    if (loadedFor !== userId) return;
    entries = stored.sort((a, b) => a.seq - b.seq);
    refreshCounts();
    if (entries.some((e) => e.status === 'pending')) void flushOutbox();
  }).catch(() => undefined);
  return loading;
}

// ---------------------------------------------------------------------------
// Request helpers

interface Parsed {
  url: URL;
  method: string;
  headers: Headers;
  body: string | undefined;
  table: string;
  rpc: string | null;
  signal: AbortSignal | undefined;
}

function parse(input: RequestInfo | URL, init?: RequestInit): Parsed | null {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!restUrl || !href.startsWith(restUrl)) return null;
  const url = new URL(href);
  const path = url.pathname.replace(/^.*\/rest\/v1\//, '');
  const rpc = path.startsWith('rpc/') ? path.slice(4) : null;
  return {
    url,
    method: (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase(),
    headers: new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)),
    body: typeof init?.body === 'string' ? init.body : undefined,
    table: rpc ? '' : path.split('/')[0],
    rpc,
    signal: init?.signal ?? undefined,
  };
}

const isNetworkError = (error: unknown) => error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError');

function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-vitalink-offline': '1', ...init.headers },
  });
}

const offlineError = () => json(
  { code: 'OFFLINE', message: "You're offline, and this hasn't been opened on this device before. It will load when you reconnect.", details: null, hint: null },
  { status: 503 },
);

/** Single-row (`.single()`) requests ask for an object instead of an array. */
const wantsObject = (headers: Headers) => (headers.get('accept') ?? '').includes('vnd.pgrst.object');

// ---------------------------------------------------------------------------
// Reads

async function handleRead(req: Parsed, input: RequestInfo | URL, init: RequestInit | undefined, userId: string | null): Promise<Response> {
  const cacheId = userId ? await hashKey([userId, req.method, req.url.pathname + req.url.search, req.body ?? '', req.headers.get('accept') ?? '', req.headers.get('prefer') ?? ''].join('|')) : null;

  if (navigator.onLine) {
    const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
    try {
      const response = await nativeFetch(input, { ...init, signal: req.signal ? AbortSignal.any([req.signal, timeout]) : timeout });
      markOnline();
      if (response.ok && userId && cacheId) void saveResponse(response.clone(), userId, cacheId, req.rpc ? `rpc:${req.rpc}` : req.table);
      return response;
    } catch (error) {
      if (req.signal?.aborted || !isNetworkError(error)) throw error;
      markOffline();
    }
  } else {
    markOffline();
  }

  const offlineUser = userId ?? lastUser();
  if (!offlineUser) return offlineError();
  if (loadedFor !== offlineUser) await loadQueue(offlineUser);
  const id = cacheId ?? await hashKey([offlineUser, req.method, req.url.pathname + req.url.search, req.body ?? '', req.headers.get('accept') ?? '', req.headers.get('prefer') ?? ''].join('|'));
  const saved = await cacheGet<{ body: unknown; range: string | null }>(offlineUser, id);
  if (req.rpc) {
    if (!saved) return offlineError();
    setStatus({ showingSaved: true });
    return json(saved.value.body);
  }

  // Never asked exactly this before: answer from every row of the table saved on this device.
  const local = saved ? undefined : await localQuery(offlineUser, req);
  const queuedHere = activeEffects(req.table).some((effect) => effect.op === 'insert') || pendingIds(req.table)(req.url);
  if (!saved && local === undefined && !queuedHere) return offlineError();
  setStatus({ showingSaved: true });
  const base = saved ? saved.value.body : local ?? [];
  const body = await overlay(offlineUser, req, wantsObject(req.headers) && Array.isArray(base) ? base[0] ?? null : base);
  if (req.method === 'HEAD') return json(undefined, { headers: saved?.value.range ? { 'content-range': saved.value.range } : {} });
  if (wantsObject(req.headers) && (body === null || body === undefined)) {
    return json({ code: 'PGRST116', message: 'The result contains 0 rows', details: null, hint: null }, { status: 406 });
  }
  return json(body, { headers: saved?.value.range ? { 'content-range': saved.value.range } : {} });
}

async function saveResponse(response: Response, userId: string, cacheId: string, table: string) {
  try {
    const text = await response.text();
    if (text.length > 2_000_000) return;
    await cachePut(userId, cacheId, table, { body: text ? JSON.parse(text) : null, range: response.headers.get('content-range') });
  } catch {
    // Not JSON, or storage full: just don't keep it.
  }
}

// ---------------------------------------------------------------------------
// Applying queued changes to saved data

type Filter = (row: Row) => boolean;
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'columns', 'on_conflict', 'or', 'and']);

function filtersFor(url: URL): Filter[] {
  const filters: Filter[] = [];
  url.searchParams.forEach((raw, column) => {
    if (RESERVED.has(column)) return;
    const dot = raw.indexOf('.');
    const op = raw.slice(0, dot);
    const value = raw.slice(dot + 1);
    filters.push((row) => {
      if (!(column in row)) return true;
      const cell = row[column];
      const text = cell === null || cell === undefined ? null : String(cell);
      switch (op) {
        case 'eq': return text === value;
        case 'neq': return text !== value;
        case 'gt': return text !== null && text > value;
        case 'gte': return text !== null && text >= value;
        case 'lt': return text !== null && text < value;
        case 'lte': return text !== null && text <= value;
        case 'is': return value === 'null' ? text === null : String(cell) === value;
        case 'in': return text !== null && value.replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, '')).includes(text);
        case 'like':
        case 'ilike': {
          const pattern = value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[%*]/g, '.*').replace(/_/g, '.');
          return text !== null && new RegExp(`^${pattern}$`, op === 'ilike' ? 'i' : '').test(text);
        }
        default: return true;
      }
    });
  });
  return filters;
}

const activeEffects = (table: string) => entries
  .filter((e) => e.status === 'pending')
  .flatMap((e) => e.effects)
  .filter((effect) => effect.table === table);

/** True when a request asks about a record that so far only exists in the queue. */
function pendingIds(table: string) {
  const ids = new Set(entries.filter((e) => e.status === 'pending').flatMap((e) => e.effects).filter((e) => e.op === 'insert').map((e) => String((e as { row: Row }).row.id)));
  return (url: URL) => {
    let hit = false;
    url.searchParams.forEach((value) => { if (value.startsWith('eq.') && ids.has(value.slice(3))) hit = true; });
    return hit && Boolean(table);
  };
}

function applyPatch(row: Row, effect: Extract<Effect, { op: 'patch' }>): Row {
  const next: Row = { ...row, ...effect.fields };
  for (const [column, amount] of Object.entries(effect.decrement ?? {})) next[column] = Number(row[column] ?? 0) - amount;
  if (effect.lines && Array.isArray(row.lines)) {
    next.lines = (row.lines as Row[]).map((line) => {
      const change = effect.lines!.find((l) => l.id === line.id);
      return change ? { ...line, ...change.fields } : line;
    });
  }
  return next;
}

/** Embedded relations in a select, e.g. `patient:patients!fk(first_name)` -> { alias: 'patient', table: 'patients' }. */
function embedsOf(url: URL) {
  const select = url.searchParams.get('select') ?? '';
  return Array.from(select.matchAll(/(?:^|,)\s*(\w+):(\w+)(?:!\w+)?\(/g), (m) => ({ alias: m[1], table: m[2] }));
}

async function findRow(userId: string, table: string, id: string): Promise<Row | null> {
  for (const effect of activeEffects(table)) if (effect.op === 'insert' && effect.row.id === id) return effect.row;
  for (const saved of await cacheScan<{ body: unknown }>(userId, table)) {
    const rows = Array.isArray(saved.body) ? saved.body as Row[] : saved.body ? [saved.body as Row] : [];
    const match = rows.find((row) => row && row.id === id);
    if (match) return match;
  }
  return null;
}

async function withEmbeds(userId: string, url: URL, row: Row): Promise<Row> {
  const filled: Row = { ...row };
  for (const { alias, table } of embedsOf(url)) {
    if (alias in filled) continue;
    if (table === 'patients' && typeof row.patient_id === 'string') filled[alias] = await findRow(userId, 'patients', row.patient_id);
    else if (table === 'profiles') filled[alias] = alias === 'dispenser' || alias === 'signer' ? null : { full_name: 'You (not yet synced)', email: '' };
    else filled[alias] = alias === 'lines' ? [] : null;
  }
  return filled;
}

/**
 * Runs a simple query against the rows saved from earlier responses for the same table.
 * Undefined when it can't be answered faithfully (or/and conditions, nothing saved).
 */
async function localQuery(userId: string, req: Parsed): Promise<Row[] | undefined> {
  if (req.method !== 'GET' || req.url.searchParams.has('or') || req.url.searchParams.has('and')) return undefined;
  const byId = new Map<string, Row>();
  for (const saved of await cacheScan<{ body: unknown }>(userId, req.table)) {
    const rows = Array.isArray(saved.body) ? saved.body as Row[] : saved.body ? [saved.body as Row] : [];
    for (const row of rows) if (row && typeof row.id === 'string' && !byId.has(row.id)) byId.set(row.id, row);
  }
  if (!byId.size) return undefined;
  const filters = filtersFor(req.url);
  let rows = [...byId.values()].filter((row) => filters.every((match) => match(row)));
  const order = req.url.searchParams.get('order');
  if (order) {
    const [column, direction] = order.split(',')[0].split('.');
    rows.sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * (direction === 'desc' ? -1 : 1));
  }
  const offset = Number(req.url.searchParams.get('offset') ?? 0);
  const limit = Number(req.url.searchParams.get('limit') ?? rows.length);
  rows = rows.slice(offset, offset + limit);
  return Promise.all(rows.map((row) => withEmbeds(userId, req.url, row)));
}

async function overlay(userId: string, req: Parsed, base: unknown): Promise<unknown> {
  const effects = activeEffects(req.table);
  if (!effects.length) return base;
  const single = !Array.isArray(base);
  let rows: Row[] = Array.isArray(base) ? [...base as Row[]] : base ? [base as Row] : [];
  const filters = filtersFor(req.url);
  for (const effect of effects) {
    if (effect.op === 'insert') {
      if (rows.some((row) => row.id === effect.row.id) || !filters.every((match) => match(effect.row))) continue;
      rows = [await withEmbeds(userId, req.url, effect.row), ...rows];
    } else {
      rows = rows.map((row) => (row.id === effect.id ? applyPatch(row, effect) : row));
    }
  }
  return single ? rows[0] ?? null : rows;
}

// ---------------------------------------------------------------------------
// Writes

const isPlainRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Gives every inserted row (and lab order) an id made on this device. */
function withClientIds(req: Parsed, body: unknown): { url: URL; body: unknown } {
  const url = new URL(req.url);
  if (req.rpc === 'create_lab_order' && isPlainRow(body)) {
    const tests = Array.isArray(body.p_tests) ? body.p_tests.map((t) => (isPlainRow(t) && !t.id ? { ...t, id: crypto.randomUUID() } : t)) : body.p_tests;
    return { url, body: { ...body, p_order_id: body.p_order_id ?? crypto.randomUUID(), p_tests: tests } };
  }
  if (req.rpc || req.method !== 'POST') return { url, body };
  const rows = (Array.isArray(body) ? body : [body]).map((row) => (isPlainRow(row) && !row.id ? { ...row, id: crypto.randomUUID() } : row));
  const columns = url.searchParams.get('columns');
  if (columns && !columns.split(',').some((c) => c.replace(/"/g, '') === 'id')) url.searchParams.set('columns', `${columns},"id"`);
  return { url, body: Array.isArray(body) ? rows : rows[0] };
}

const idFilter = (url: URL) => url.searchParams.get('id')?.match(/^eq\.(.+)$/)?.[1] ?? null;

async function effectsFor(req: Parsed, body: unknown, userId: string): Promise<{ effects: Effect[]; reply: unknown }> {
  const now = new Date().toISOString();
  if (req.rpc === 'create_lab_order' && isPlainRow(body)) {
    const patient = await findRow(userId, 'patients', String(body.p_patient_id));
    const tests = (Array.isArray(body.p_tests) ? body.p_tests : []) as Row[];
    const row: Row = {
      id: body.p_order_id, organization_id: patient?.organization_id, order_number: 'Not yet synced', patient_id: body.p_patient_id,
      ordered_by: userId, priority: body.p_priority ?? 'routine', sample_type: body.p_sample_type ?? 'blood',
      status: tests.every((t) => String(t.value ?? '').trim()) ? 'completed' : 'pending', notes: body.p_notes ?? '', critical: false,
      created_at: now, completed_at: null, draft_saved_at: null,
      lines: tests.map((t) => ({
        id: t.id, test_name: t.name, value: t.value ?? '', unit: t.unit ?? '', reference_range: t.referenceRange ?? '',
        interpretation: null, flag: t.flag ?? 'Normal', status: String(t.value ?? '').trim() ? 'Completed' : 'Pending', ordered_at: now,
      })),
    };
    const lineRows: Effect[] = (row.lines as Row[]).map((line) => ({
      op: 'insert', table: 'lab_results',
      row: { ...line, organization_id: row.organization_id, patient_id: row.patient_id, order_id: row.id, created_at: now },
    }));
    return { effects: [{ op: 'insert', table: 'lab_orders', row }, ...lineRows], reply: body.p_order_id };
  }
  if (req.rpc === 'save_lab_results' && isPlainRow(body)) {
    const lines = ((Array.isArray(body.p_lines) ? body.p_lines : []) as Row[]).map((line) => ({
      id: String(line.id),
      fields: {
        ...(line.value !== undefined ? { value: line.value } : {}),
        ...(line.unit !== undefined ? { unit: line.unit } : {}),
        ...(line.referenceRange !== undefined ? { reference_range: line.referenceRange } : {}),
        ...(line.interpretation !== undefined ? { interpretation: line.interpretation } : {}),
        ...(line.critical !== undefined ? { flag: line.critical ? 'Critical' : 'Normal' } : {}),
        ...(body.p_complete ? { status: 'Completed' } : {}),
      },
    }));
    const order: Effect = {
      op: 'patch', table: 'lab_orders', id: String(body.p_order_id), lines,
      fields: body.p_complete ? { status: 'completed', completed_at: now } : { draft_saved_at: now },
    };
    return { effects: [order, ...lines.map((line): Effect => ({ op: 'patch', table: 'lab_results', id: line.id, fields: line.fields }))], reply: null };
  }
  if (req.rpc === 'dispense_prescription' && isPlainRow(body)) {
    const quantity = Number(body.p_quantity);
    const prescription = await findRow(userId, 'prescriptions', String(body.p_prescription_id));
    const fields = { status: 'dispensed', dispensed_at: now, dispensed_quantity: quantity, inventory_id: body.p_inventory_id, dispensed_by: userId };
    return {
      effects: [
        { op: 'patch', table: 'prescriptions', id: String(body.p_prescription_id), fields },
        { op: 'patch', table: 'drug_inventory', id: String(body.p_inventory_id), fields: {}, decrement: { quantity_in_stock: quantity } },
      ],
      reply: { ...(prescription ?? { id: body.p_prescription_id }), ...fields },
    };
  }

  if (req.method === 'POST') {
    const rows = (Array.isArray(body) ? body : [body]).filter(isPlainRow).map((row) => ({
      created_at: now, updated_at: now, created_by: userId, updated_by: userId,
      ...DEFAULTS[req.table],
      ...(req.table === 'patients' ? { switch_id: `PENDING-${String(row.id).slice(0, 8).toUpperCase()}` } : {}),
      ...(req.table === 'clinical_notes' ? { author_id: userId, signed_at: row.status === 'signed' ? now : null } : {}),
      ...(req.table === 'vitals' ? { recorded_at: now, recorded_by: userId } : {}),
      ...(req.table === 'prescriptions' ? { prescriber_id: userId } : {}),
      ...row,
    }));
    return { effects: rows.map((row) => ({ op: 'insert', table: req.table, row })), reply: Array.isArray(body) ? rows : rows[0] };
  }

  // PATCH ...?id=eq.<id>
  const id = idFilter(req.url);
  const fields: Row = { ...(isPlainRow(body) ? body : {}), updated_at: now };
  if (req.table === 'clinical_notes' && fields.status === 'signed') fields.signed_at = now;
  const existing = id ? await findRow(userId, req.table, id) : null;
  return { effects: id ? [{ op: 'patch', table: req.table, id, fields }] : [], reply: { ...(existing ?? { id }), ...fields } };
}

function writeReply(req: Parsed, reply: unknown): Response {
  if (req.rpc) return json(reply ?? null);
  const prefer = req.headers.get('prefer') ?? '';
  if (!prefer.includes('return=representation')) return new Response(null, { status: req.method === 'POST' ? 201 : 204, headers: { 'x-vitalink-offline': '1' } });
  const rows = Array.isArray(reply) ? reply : [reply];
  return json(wantsObject(req.headers) ? rows[0] : rows, { status: req.method === 'POST' ? 201 : 200 });
}

/** Headers worth keeping for the replay (auth is added fresh when it's sent). */
function replayHeaders(headers: Headers): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of ['content-type', 'prefer', 'content-profile', 'accept-profile']) {
    const value = headers.get(name);
    if (value) kept[name] = value;
  }
  kept.prefer = (kept.prefer ?? '').split(',').filter((p) => p.trim() && !p.includes('return=')).concat('return=minimal').join(',');
  return kept;
}

async function handleWrite(req: Parsed, input: RequestInfo | URL, init: RequestInit | undefined, userId: string | null): Promise<Response> {
  const owner = userId ?? lastUser();
  if (!owner) return nativeFetch(input, init);
  if (loadedFor !== owner) await loadQueue(owner);

  let parsedBody: unknown = null;
  try { parsedBody = req.body ? JSON.parse(req.body) : null; } catch { return nativeFetch(input, init); }
  const { url, body } = withClientIds(req, parsedBody);
  const requestId = crypto.randomUUID();
  const target = req.rpc ? `rpc:${req.rpc}` : req.table;
  // Functions always go through offline_replay so a lost reply can be resent safely.
  const sendUrl = req.rpc ? `${restUrl}rpc/offline_replay` : url.href;
  const sendBody = req.rpc ? { p_request_id: requestId, p_fn: req.rpc, p_args: body } : body;

  const queued = entries.some((e) => e.status === 'pending');
  if (navigator.onLine && !queued) {
    try {
      const response = await nativeFetch(sendUrl, { ...init, body: JSON.stringify(sendBody) });
      markOnline();
      return response;
    } catch (error) {
      if (req.signal?.aborted || !isNetworkError(error)) throw error;
      markOffline();
    }
  }

  const { effects, reply } = await effectsFor({ ...req, url }, body, owner);
  const entry: OutboxEntry = {
    id: requestId,
    seq: Date.now() * 1000 + (seqCounter++ % 1000),
    userId: owner,
    createdAt: new Date().toISOString(),
    label: LABELS[req.rpc ?? `${req.method} ${req.table}`] ?? 'Saved change',
    target,
    method: req.method as 'POST' | 'PATCH',
    path: sendUrl.slice(restUrl.length),
    headers: replayHeaders(req.headers),
    body: sendBody,
    effects,
    status: 'pending',
    attempts: 0,
  };
  await outboxPut(owner, entry);
  entries = [...entries, entry];
  refreshCounts();
  if (navigator.onLine) void flushOutbox();
  return writeReply({ ...req, url }, reply);
}

// ---------------------------------------------------------------------------
// Sending the queue

/** Sends queued changes in order. Stops at the first connection problem; refused changes are set aside for review. */
export async function flushOutbox(): Promise<void> {
  if (flushing || !navigator.onLine || !restUrl) return;
  const queue = entries.filter((e) => e.status === 'pending');
  if (!queue.length) return;
  const token = await getAccessToken().catch(() => null);
  if (!token) return;
  flushing = true;
  setStatus({ syncing: true });
  let sent = 0;
  try {
    for (const entry of queue) {
      let response: Response;
      try {
        response = await nativeFetch(`${restUrl}${entry.path}`, {
          method: entry.method,
          headers: { ...entry.headers, apikey: apiKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(entry.body),
        });
      } catch {
        markOffline();
        break;
      }
      markOnline();
      const problem = response.ok ? null : await response.json().catch(() => ({})) as { code?: string; message?: string };
      // Already there: an earlier attempt reached the server but its reply was lost.
      const alreadyApplied = problem && response.status === 409 && problem.code === '23505' && entry.method === 'POST' && !entry.target.startsWith('rpc:');
      if (!problem || alreadyApplied) {
        await outboxDelete(entry.id);
        entries = entries.filter((e) => e.id !== entry.id);
        sent += 1;
        refreshCounts();
        continue;
      }
      // Expired sign-in: wait for the session to refresh and try again later.
      if (response.status === 401 || problem.code === 'PGRST301' || problem.code === 'PGRST303') break;
      const failed: OutboxEntry = { ...entry, status: 'failed', attempts: entry.attempts + 1, error: problem.message || `The server refused this change (${response.status}).` };
      await outboxPut(entry.userId, failed);
      entries = entries.map((e) => (e.id === entry.id ? failed : e));
      refreshCounts();
    }
  } finally {
    flushing = false;
    setStatus({ syncing: false, ...(sent ? { lastSyncedAt: Date.now() } : {}) });
  }
  if (sent) window.dispatchEvent(new CustomEvent('vitalink:offline-synced', { detail: { sent } }));
}

export async function retryEntry(id: string) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  const retried: OutboxEntry = { ...entry, status: 'pending', error: undefined };
  await outboxPut(entry.userId, retried);
  entries = entries.map((e) => (e.id === id ? retried : e));
  refreshCounts();
  await flushOutbox();
}

export async function discardEntry(id: string) {
  await outboxDelete(id);
  entries = entries.filter((e) => e.id !== id);
  refreshCounts();
}

/** Changes not yet on the server (waiting or refused). */
export const unsyncedCount = () => entries.length;

/**
 * Signing out: deletes the patient data saved on this device. Changes that haven't
 * reached the server yet stay queued (still encrypted) and are sent the next time
 * the same person signs in here; everything else, the key included, is deleted.
 * Returns how many changes were kept.
 */
export async function wipeOfflineData(): Promise<number> {
  const kept = entries.length;
  entries = [];
  loadedFor = null;
  loading = null;
  try { localStorage.removeItem(LAST_USER_KEY); } catch { /* storage unavailable */ }
  // Someone's changes (this user's, or a colleague's who signed out offline) are still waiting.
  const queuedHere = kept || await outboxCountAll().catch(() => 0);
  if (queuedHere) await clearCache().catch(() => undefined);
  else await wipeVault();
  setStatus({ pending: 0, failed: [], showingSaved: false });
  return kept;
}

// ---------------------------------------------------------------------------
// Set-up

/** The Supabase client's fetch. */
export async function offlineFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const req = parse(input, init);
  if (!req) return nativeFetch(input, init);
  const userId = jwtUser(req.headers.get('authorization'));
  if (userId) rememberUser(userId);

  const isRead = req.method === 'GET' || req.method === 'HEAD' || (req.rpc !== null && READ_RPCS.has(req.rpc));
  if (isRead) return handleRead(req, input, init, userId);
  const isQueueable = req.rpc ? OFFLINE_RPCS.has(req.rpc) : (OFFLINE_TABLES[req.table] ?? []).includes(req.method);
  if (isQueueable) return handleWrite(req, input, init, userId);
  return nativeFetch(input, init);
}

let started = false;
export function startOfflineSync(options: { supabaseUrl: string; apiKey: string; accessToken: () => Promise<string | null> }) {
  restUrl = `${options.supabaseUrl.replace(/\/$/, '')}/rest/v1/`;
  apiKey = options.apiKey;
  getAccessToken = options.accessToken;
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('online', () => { setStatus({ online: true }); void flushOutbox(); });
  window.addEventListener('offline', () => setStatus({ online: false }));
  window.setInterval(() => { if (!document.hidden) void flushOutbox(); }, refreshInterval(30_000));
  const userId = lastUser();
  if (userId) void loadQueue(userId);
  void pruneCache().catch(() => undefined);
}
