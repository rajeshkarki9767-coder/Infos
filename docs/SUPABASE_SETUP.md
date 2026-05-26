# Connecting Infos to a Supabase backend

This adds **cloud accounts + cross-device sync** to Infos using [Supabase](https://supabase.com).
It's an **opt-in layer**: the app keeps working locally as-is until you turn this on.

> **What this gives you (and what it doesn't, honestly):**
> This first integration syncs your whole app state as one encrypted-in-transit
> snapshot per user, protected by Row-Level Security so nobody can read anyone
> else's data. It gives you **real authentication, secure password storage
> (handled by Supabase, not plaintext), and cross-device sync.**
> For **shared business access** — where a business login gets the full app on
> the same live data as the owner — also run `supabase/schema-shared.sql`
> (Step 2b). That adds the per-business shared row + RLS that powers it.

---

## Step 1 — Create a Supabase project
1. Sign up at https://supabase.com and create a new project.
2. Wait for it to provision (~2 min).

## Step 2 — Create the database schema (this is the security layer)
1. In your project: **SQL Editor → New query**.
2. Paste the entire contents of **`supabase/schema.sql`** and click **Run**.
3. This creates the `app_state` table and **enables Row-Level Security** with
   policies so each user can only ever read/write their own row. This is what
   prevents one user from accessing another's data — it's enforced by the
   database server, not the browser.

## Step 2b — Enable shared business access
1. New query → paste the entire contents of **`supabase/schema-shared.sql`** → **Run**.
2. This adds `businesses`, `business_members`, and the shared `shared_state`
   table, with RLS so the owner AND linked business logins read+write the same
   per-business row (delete is owner-only). It also adds those tables to the
   realtime publication so edits sync live.
3. (Older deployments only) If you previously ran `schema-members.sql`, you can
   drop the now-unused `shared_items` table — see the commented cleanup block at
   the bottom of `schema-shared.sql`.
4. To verify isolation locally without touching production, run
   `node test/run-all.js` (uses an in-memory Postgres).

## Step 3 — Get your keys
1. **Project Settings → API.**
2. Copy the **Project URL** and the **anon / public** key.
3. **Do NOT copy the `service_role` key.** It bypasses all security and must
   never be placed in client code. If you ever expose it, rotate it immediately.

## Step 4 — Add the keys + Supabase client to the app
In `index.html`, just before the existing app scripts, add:

```html
<!-- Supabase client (official CDN) -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
  // Public anon config — safe to ship. Real protection is the RLS policies.
  window.__INFOS_SUPABASE_URL__ = 'https://YOUR-PROJECT.supabase.co';
  window.__INFOS_SUPABASE_ANON_KEY__ = 'YOUR-ANON-KEY';
</script>
<script src="supabase/adapter.js"></script>
```

> Note: this loads the Supabase client from a CDN. If you want zero external
> origins (stronger supply-chain posture, and to satisfy a strict CSP), download
> `@supabase/supabase-js` and self-host it instead of using the CDN, then add
> Subresource Integrity (`integrity=`) to the script tag.

## Step 5 — Turn on sync in the app
Once loaded, the adapter registers itself as `'supabase'` with the app's Sync
system. To enable it (e.g. from a settings button or the console):

```js
await Sync.enable('supabase');
await Sync.syncNow(state);   // push local → pull remote → merge
```

Auth helpers are available on `window.InfosSupabase.Auth`:

```js
await InfosSupabase.Auth.signUp(email, password, name);
await InfosSupabase.Auth.signIn(email, password);
await InfosSupabase.Auth.sendMagicLink(email);   // passwordless
await InfosSupabase.Auth.signOut();
```

---

## Security checklist (what's now real vs. still local)

| Concern | Status with this integration |
|---|---|
| Password storage | ✅ Handled by Supabase Auth (hashed, never plaintext) for the owner account. Strip local plaintext once migrated. |
| Cross-user data isolation (IDOR) | ✅ Enforced by RLS server-side. |
| Session tokens | ✅ Short-lived JWT + auto-refresh, managed by the Supabase client. |
| Transport encryption | ✅ HTTPS to Supabase. |
| Brute-force / rate limiting | ⚠️ Supabase Auth has built-in limits; tune them in Auth settings. Add Supabase's CAPTCHA option for sign-in if exposed publicly. |
| MFA | ⚠️ Supabase supports TOTP MFA — enable in Auth settings and add the enrollment UI. |
| Service-role key exposure | ✅ Never shipped (only anon key is). |
| Live multi-user collaboration | ❌ Not in the snapshot model — needs the normalized tables migration. |
| Offline editing | ⚠️ App still works offline locally; sync reconciles on next push/pull (last-write-wins per snapshot). For field-level merge you'd move to normalized tables + per-record timestamps. |

## Recommended hardening once you go public
- Turn on **email confirmation** in Supabase Auth (Settings → Auth) so accounts must verify.
- Enable **MFA (TOTP)** and add the enrollment flow.
- Enable **CAPTCHA** on auth endpoints (Supabase supports hCaptcha/Turnstile).
- Set a strict **CSP** header (and self-host the Supabase JS with SRI).
- Review Supabase **Auth rate limits** and **leaked-password protection** (Settings → Auth → Password security).
- Keep the **service_role** key only in server-side functions, never the client.
