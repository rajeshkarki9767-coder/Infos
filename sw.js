// =====================================================================
// Hisabs Service Worker
// =====================================================================
//
// Provides offline-capable caching for the single-file Hisabs PWA.
// Strategy:
//   - Pre-cache the app shell on install (index.html, manifest, icons,
//     supabase client bundle)
//   - On fetch, prefer network for navigation requests so users always
//     get the latest deployed version when online
//   - Fall back to cache for offline scenarios
//   - Use stale-while-revalidate for static assets (icons, vendor)
//
// Update flow:
//   1. New sw.js is detected by the browser (different bytes)
//   2. Browser installs it in "waiting" state
//   3. App posts SKIP_WAITING message → SW calls self.skipWaiting()
//   4. New SW activates, replacing the old one
//   5. Next page load picks up the new index.html (now via the new SW)
//
// Cache versioning: bump CACHE_VERSION on EVERY deploy. It is kept in
// sync with the BUILD_TAG shown in the app's About page so a stale cache
// can never silently serve old code. Old caches are cleaned up in
// `activate`.
//
// =====================================================================
// DEPLOY: upload this file to your repo/site root alongside index.html.
// On each new release, change CACHE_VERSION below (match the BUILD_TAG in
// index.html's About page) so devices reliably pick up the new code.
// =====================================================================

const CACHE_VERSION = 'hisabs-1.11-build-2026.05.21.117';
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Files to pre-cache on install. Keep this list lean — the bigger it
// is, the longer install takes and the more aggressive the eviction.
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
];

// -----------------------------------------------------------------
// install: pre-cache the shell, then skip waiting only if the app
// asked us to (via postMessage). Without the postMessage, we wait
// until all old tabs close before activating — that prevents the
// running app from suddenly seeing a different SW mid-session.
// -----------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .catch((e) => {
        // A shell file 404 is non-fatal — we still want the SW to
        // install and handle runtime caching. Just log it.
        console.warn('[SW] Shell pre-cache partial fail:', e.message);
      })
  );
});

// -----------------------------------------------------------------
// activate: drop any old-version caches. Claim clients so the SW
// starts controlling pages that were loaded before activation.
// -----------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n !== SHELL_CACHE && n !== RUNTIME_CACHE)
        .map((n) => caches.delete(n))
    );
    // Take control of any open pages immediately. Without this, the
    // first page load after SW install doesn't go through the SW.
    await self.clients.claim();
  })());
});

// -----------------------------------------------------------------
// message: the app posts SKIP_WAITING to ask us to activate now.
// -----------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// -----------------------------------------------------------------
// fetch: network-first for navigation, cache-first for static assets
// -----------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Skip non-GET (POST to Supabase, etc) — let them go through normally
  if (req.method !== 'GET') return;

  // Skip cross-origin (Supabase API, Vercel functions, fonts CDN, etc)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigation requests (the user opening the app or reloading):
  // network-first so they always see the latest deploy when online.
  // Fall back to cached index.html when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        // Cache a copy for offline use
        const cache = await caches.open(SHELL_CACHE);
        cache.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch (_) {
        // Offline: serve cached index.html
        const cached = await caches.match('./index.html');
        if (cached) return cached;
        // No cached fallback — let the browser handle the network error
        throw _;
      }
    })());
    return;
  }

  // Static assets (icons, manifest, vendored scripts):
  // stale-while-revalidate so the user gets a fast cached response
  // immediately, and the cache updates in the background.
  if (/\.(?:js|css|png|jpg|jpeg|svg|webp|gif|ico|woff2?|ttf|webmanifest)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req);
      const networkPromise = fetch(req).then((resp) => {
        // Only cache successful responses
        if (resp && resp.status === 200) cache.put(req, resp.clone()).catch(() => {});
        return resp;
      }).catch(() => null);
      return cached || (await networkPromise) || Response.error();
    })());
    return;
  }

  // Anything else: pass-through, no caching
});
