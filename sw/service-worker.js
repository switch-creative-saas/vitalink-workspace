/* VitaLink app shell for offline use. Built into dist/sw.js by the offlineShell
 * plugin in vite.config.ts, which fills in the build's file lists and version.
 *
 * It only stores the app itself (HTML, scripts, styles, images), so VitaLink
 * opens with no connection. Patient data never goes through here: the app keeps
 * it encrypted in IndexedDB (src/lib/offline).
 *
 * Installing downloads only the core (PRECACHE), so the app opens fast. Right
 * after sign-in the app asks for everything else (message "warm",
 * src/lib/offline/prepare.ts): every page is downloaded, one file at a time so
 * it never competes with real work on a slow line, and the app can then work
 * offline without any page having been opened first. "status" reports how many
 * of the app's files are saved. Both reply on the message's port. */
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

let warming = null;
function warm() {
  if (!warming) {
    warming = (async () => {
      const cache = await caches.open(CACHE);
      for (const file of WARM) {
        const url = scoped(file);
        if (await cache.match(url)) continue;
        try {
          const response = await fetch(url);
          if (response.ok) await cache.put(url, response);
        } catch {
          return; // went offline or the connection dropped: carry on next time
        }
      }
    })().finally(() => { warming = null; });
  }
  return warming;
}

async function status() {
  const cache = await caches.open(CACHE);
  const all = [...PRECACHE, ...WARM];
  let cached = 0;
  for (const file of all) if (await cache.match(scoped(file))) cached += 1;
  return { cached, total: all.length };
}

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type !== 'warm' && type !== 'status') return;
  const reply = (type === 'warm' ? warm() : Promise.resolve()).then(status).then((result) => event.ports[0] && event.ports[0].postMessage(result));
  event.waitUntil(reply);
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
  // VitaCard links load their own page (card.html) and need the network: leave them alone, so the
  // card page is never saved in place of the app.
  if (url.pathname.startsWith('/card/') || url.pathname === '/card.html' || url.hostname.startsWith('card.')) return;
  if (request.mode === 'navigate') event.respondWith(navigation(request));
  else event.respondWith(asset(request));
});
