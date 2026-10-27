// Encrypted on-device storage for offline use (IndexedDB + AES-GCM).
//
// Each signed-in user gets their own 256-bit key, created on this device and
// stored as a non-extractable CryptoKey: page scripts can use it but can never
// read its bytes. Everything holding patient data (cached responses and queued
// changes) is encrypted with it. Signing out deletes the database, key included.

const DB_NAME = 'vitalink-offline';
const DB_VERSION = 1;
/** Cached responses older than this are never shown, and are deleted on start-up. */
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface KeyRecord { userId: string; key: CryptoKey }
interface Sealed { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }
interface CacheRecord extends Sealed { id: string; userId: string; table: string; savedAt: number }
interface OutboxRecord extends Sealed { id: string; userId: string; seq: number }

let dbPromise: Promise<IDBDatabase> | null = null;
const keys = new Map<string, CryptoKey>();

const done = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('keys', { keyPath: 'userId' });
      const cache = db.createObjectStore('cache', { keyPath: 'id' });
      cache.createIndex('byTable', ['userId', 'table']);
      cache.createIndex('bySavedAt', 'savedAt');
      const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
      outbox.createIndex('byUser', ['userId', 'seq']);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = null; reject(request.error); };
    request.onblocked = () => reject(new Error('Offline storage is blocked by another tab.'));
  });
  return dbPromise;
}

async function store(name: 'keys' | 'cache' | 'outbox', mode: IDBTransactionMode) {
  return (await openDb()).transaction(name, mode).objectStore(name);
}

/** The user's key, created on first use. `create: false` returns null when this device has none. */
export async function userKey(userId: string, create: boolean): Promise<CryptoKey | null> {
  const cached = keys.get(userId);
  if (cached) return cached;
  const existing = await done((await store('keys', 'readonly')).get(userId)) as KeyRecord | undefined;
  if (existing) { keys.set(userId, existing.key); return existing.key; }
  if (!create) return null;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await done((await store('keys', 'readwrite')).put({ userId, key } satisfies KeyRecord));
  keys.set(userId, key);
  return key;
}

async function seal(key: CryptoKey, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { iv, data };
}

async function open<T>(key: CryptoKey, sealed: Sealed): Promise<T | null> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, key, sealed.data);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}

/** Opaque id for a request: hashing keeps search terms and names out of the index. */
export async function hashKey(parts: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Cached responses

export async function cachePut(userId: string, id: string, table: string, value: unknown) {
  const key = await userKey(userId, true);
  if (!key) return;
  const record: CacheRecord = { id, userId, table, savedAt: Date.now(), ...(await seal(key, value)) };
  await done((await store('cache', 'readwrite')).put(record));
}

export async function cacheGet<T>(userId: string, id: string): Promise<{ value: T; savedAt: number } | null> {
  const key = await userKey(userId, false);
  if (!key) return null;
  const record = await done((await store('cache', 'readonly')).get(id)) as CacheRecord | undefined;
  if (!record || record.userId !== userId || Date.now() - record.savedAt > CACHE_MAX_AGE_MS) return null;
  const value = await open<T>(key, record);
  return value === null ? null : { value, savedAt: record.savedAt };
}

/** Every cached response for one table (to find a row by id). */
export async function cacheScan<T>(userId: string, table: string): Promise<T[]> {
  const key = await userKey(userId, false);
  if (!key) return [];
  const records = await done((await store('cache', 'readonly')).index('byTable').getAll([userId, table])) as CacheRecord[];
  const fresh = records.filter((r) => Date.now() - r.savedAt <= CACHE_MAX_AGE_MS).sort((a, b) => b.savedAt - a.savedAt);
  const values = await Promise.all(fresh.map((r) => open<T>(key, r)));
  return values.filter((v): v is Awaited<T> => v !== null) as T[];
}

export async function pruneCache() {
  const cutoff = Date.now() - CACHE_MAX_AGE_MS;
  const index = (await store('cache', 'readwrite')).index('bySavedAt');
  await new Promise<void>((resolve, reject) => {
    const cursor = index.openCursor(IDBKeyRange.upperBound(cutoff));
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) { resolve(); return; }
      c.delete();
      c.continue();
    };
    cursor.onerror = () => reject(cursor.error);
  });
}

// ---------------------------------------------------------------------------
// Queued changes

export async function outboxPut<T extends { id: string; seq: number }>(userId: string, entry: T) {
  const key = await userKey(userId, true);
  if (!key) return;
  const record: OutboxRecord = { id: entry.id, userId, seq: entry.seq, ...(await seal(key, entry)) };
  await done((await store('outbox', 'readwrite')).put(record));
}

export async function outboxDelete(id: string) {
  await done((await store('outbox', 'readwrite')).delete(id));
}

export async function outboxAll<T>(userId: string): Promise<T[]> {
  const key = await userKey(userId, false);
  if (!key) return [];
  const range = IDBKeyRange.bound([userId, 0], [userId, Number.MAX_SAFE_INTEGER]);
  const records = await done((await store('outbox', 'readonly')).index('byUser').getAll(range)) as OutboxRecord[];
  const values = await Promise.all(records.map((r) => open<T>(key, r)));
  return values.filter((v): v is Awaited<T> => v !== null) as T[];
}

/** Queued changes on this device, for anyone who has signed in here. */
export async function outboxCountAll(): Promise<number> {
  return done((await store('outbox', 'readonly')).count());
}

/** Deletes the saved responses but keeps queued changes (and the key that opens them). */
export async function clearCache() {
  await done((await store('cache', 'readwrite')).clear());
}

/** Deletes everything stored for offline use on this device, keys included. */
export async function wipeVault() {
  keys.clear();
  const db = await dbPromise?.catch(() => null);
  db?.close();
  dbPromise = null;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}
