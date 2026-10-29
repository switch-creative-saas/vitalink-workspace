/* VitaLink app shell for offline use. Built into dist/sw.js by the offlineShell
 * plugin in vite.config.ts, which fills in the build's file lists and version.
 *
 * It only stores the app itself (HTML, scripts, styles, images), so VitaLink
 * opens with no connection. Patient data never goes through here: the app keeps
 * it encrypted in IndexedDB (src/lib/offline).
 *
 * Installing downloads only the core (PRECACHE). The other files (pages, charts,
 * maps) are cached the first time they're used, and all at once in the
 * background when the app says the connection is good (message "warm"), one
 * file at a time so it never competes with real work on a slow line. */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const WARM = __WARM__;
const CACHE = `vitalink-shell-${VERSION}`;
const NAVIGATION_TIMEOUT_MS = 4000;

const scoped = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map(scoped)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith('vitalink-shell-') && name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

let warming = false;
async function warm() {
  if (warming) return;
  warming = true;
  try {
    const cache = await caches.open(CACHE);
    for (const file of WARM) {
      const url = scoped(file);
      if (await cache.match(url)) continue;
      try {
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response);
      } catch {
        return; // went offline or the connection dropped: try again next time
      }
    }
  } finally {
    warming = false;
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'warm') event.waitUntil(warm());
});

async function navigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NAVIGATION_TIMEOUT_MS)),
    ]);
    if (response.ok) await cache.put(scoped('index.html'), response.clone());
    return response;
  } catch {
    // Every route of this single-page app is served by index.html.
    return (await cache.match(scoped('index.html'), { ignoreVary: true })) || Response.error();
  }
}

async function asset(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Supabase, payment and video providers are other origins and are left alone.
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') event.respondWith(navigation(request));
  else event.respondWith(asset(request));
});
