# Service Worker Verification

The Hisabs app at `index.html` registers a service worker at `./sw.js`. This file is not in the bundle I (Claude) deliver — it lives in your repo root next to `index.html`.

## What the app expects from sw.js

Based on the registration code in `index.html` (lines 7378-7400), the service worker MUST:

1. **Listen for the `SKIP_WAITING` message** and call `self.skipWaiting()` when it receives it. Without this, new versions never activate.
2. **Pre-cache `index.html`** (and ideally the manifest + icons) so the PWA loads offline.
3. **Use network-first for navigation requests** so users see the latest deploy when online. Offline → cached index.html.
4. **Use cache-first or stale-while-revalidate for static assets** (icons, vendor scripts).
5. **Clean up old caches** in the `activate` event so storage doesn't bloat over time.

## How to verify yours does these things

Open a browser, go to `https://hisabs.app`, open DevTools → Application → Service Workers. You should see:

- **Status: "activated and running"** (not "redundant")
- **Scope: `https://hisabs.app/`**
- **Update on reload** toggle available

Click "Inspect" on the service worker to open it in DevTools sources. Then check for each of these:

| Check | What to look for | If missing |
|---|---|---|
| SKIP_WAITING handler | `self.addEventListener('message', ...skipWaiting()...)` | Update notifications never apply until all tabs close. **Critical.** |
| Cache install | `self.addEventListener('install', ...caches.open...)` | App doesn't work offline. |
| Network-first nav | Fetch handler that calls `fetch()` first for `mode === 'navigate'` | Users see stale builds. |
| Cache version cleanup | `activate` event drops old caches | Storage bloats over time. |
| clients.claim() | In `activate` handler | New SW won't control existing pages until reload. |

## If yours is missing things

I've placed a reference template at `sw.js.reference` in this bundle. It implements all 5 strategies above. You can:

1. Compare yours line-by-line and add missing pieces, OR
2. Replace yours entirely with `sw.js.reference` renamed to `sw.js`

**WARNING about replacement**: if your current `sw.js` has a different cache key (e.g. `hisabs-v89.20-shell`), replacing it will trigger a one-time cache rebuild for every user. This is generally safe — they'll just see a brief network fetch on next load — but expect a small bandwidth spike on the day of deploy.

## How to verify cache-busting works

After deploying a new `index.html`:

1. Open hisabs.app in a regular browser tab
2. DevTools → Network → reload the page
3. The request for `index.html` should show **200 OK** (not 304 Not Modified)
4. Open DevTools → Application → Service Workers → click "Update"
5. The waiting worker should activate within ~1 second (because of SKIP_WAITING)
6. Reload the page; the new version should be live

## If users report "old version" persisting

This is the #1 PWA gotcha. Causes ranked by likelihood:

1. **Service worker cached old index.html forever** — your `sw.js` is using a cache-first strategy for navigation. Fix: switch to network-first (see template).
2. **HTTP cache headers** on Vercel — verify `vercel.json` has cache-control rules that allow `index.html` to revalidate.
3. **CDN edge cache** — for a site on Vercel hosted on a custom domain, Vercel's edge may serve a stale copy. Typically resolves within minutes.
4. **User's browser cache** — Cmd+Shift+R clears it.

## To audit your current sw.js right now

Open hisabs.app in a browser. In the address bar, paste:

```
https://hisabs.app/sw.js
```

That serves the actual deployed service worker. View the source. Compare to the template's structure. If it has the SKIP_WAITING handler and a fetch handler that handles navigation, you're fine.

If you want me to audit it specifically, paste the full contents of your sw.js in chat and I'll review line by line.
