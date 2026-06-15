const CACHE_VERSION = 'infos-v233.0.0';
const RUNTIME_CACHE = 'infos-runtime-v233';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/db.js',
  '/crypto.js',
  '/sync.js',
  '/icons.js',
  '/vendor/supabase-js.min.js',
  '/supabase/shared-slice.js',
  '/supabase/adapter.js',
  '/manifest.json',
  '/privacy.html',
  '/terms.html',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.ico',
  '/icons/widget-template.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_VERSION && k !== RUNTIME_CACHE)
            .map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // API routes (e.g. /api/config) and /.well-known/ (assetlinks.json for TWA)
  // must always hit the network — never cache, so they stay correct & fresh.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.well-known/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Core app code (HTML/JS/CSS) → NETWORK-FIRST so code changes appear on the
  // next load instead of being served stale from cache. Falls back to cache
  // when offline. Everything else (icons, images) stays cache-first.
  const isCode = /\.(js|css|html)$/i.test(url.pathname) || url.pathname === '/' ;
  if (isCode) {
    event.respondWith(
      fetch(req).then(fresh => {
        if (fresh && fresh.status === 200) {
          const copy = fresh.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(req, copy));
        }
        return fresh;
      }).catch(() => caches.match(req).then(c => c || caches.match('/index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) {
        fetch(req).then(fresh => {
          if (fresh && fresh.status === 200) {
            caches.open(RUNTIME_CACHE).then(cache => cache.put(req, fresh));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then(fresh => {
        if (fresh && fresh.status === 200) {
          const copy = fresh.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(req, copy));
        }
        return fresh;
      }).catch(() => caches.match('/index.html'));
    })
  );
});

self.addEventListener('push', event => {
  let data = { title: 'Infos', body: 'You have a new notice' };
  if (event.data) {
    try { data = event.data.json(); } catch (e) { data.body = event.data.text(); }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-96.png',
      tag: data.tag || 'infos-notice',
      data: data.url || '/',
      vibrate: [100, 50, 100],
      actions: [
        { action: 'open', title: 'Open' },
        { action: 'dismiss', title: 'Dismiss' }
      ]
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const url = event.notification.data || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

self.addEventListener('sync', event => {
  if (event.tag === 'sync-data') {
    event.waitUntil(Promise.resolve());
  }
});

// Periodic Background Sync — lets the app refresh data in the background
// when the OS grants the permission. No-op data refresh in this local-first app,
// but the handler is required for the capability to be available.
self.addEventListener('periodicsync', event => {
  if (event.tag === 'refresh-data') {
    event.waitUntil(
      (async () => {
        // In a backend-connected build this would re-fetch and cache fresh data.
        // Local-first: notify any open clients so they can re-render from storage.
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        clients.forEach(c => c.postMessage({ type: 'PERIODIC_SYNC', tag: event.tag, ts: Date.now() }));
      })()
    );
  }
});

// Widgets (Windows 11 widget board) lifecycle. Renders the Adaptive Card template
// with current data when the widget is installed or asked to refresh.
self.addEventListener('widgetinstall', event => {
  event.waitUntil(renderWidget(event.widget));
});
self.addEventListener('widgetresume', event => {
  event.waitUntil(renderWidget(event.widget));
});
self.addEventListener('widgetclick', event => {
  if (event.action === 'open-app') {
    event.waitUntil(self.clients.openWindow('/index.html?tab=notices'));
  }
});
async function renderWidget(widget) {
  if (!widget || !self.widgets) return;
  try {
    const tmpl = await (await fetch(widget.definition.msAcTemplate)).text();
    const data = JSON.stringify({ title: 'Open Infos to view your latest notices.' });
    await self.widgets.updateByTag(widget.definition.tag, { template: tmpl, data });
  } catch (e) { /* widget host not available */ }
}


self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }
});
