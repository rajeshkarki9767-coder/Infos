# Deploying Infos — GitHub + Vercel + Supabase

This is the full path to put Infos online with a real backend. Read the
**security notes** — they matter for a public repo.

---

## TL;DR of the security model
- The **anon key is public-safe** — it's fine in client code. Real protection
  is **Row-Level Security (RLS)** in Supabase. You MUST run `supabase/schema.sql`.
- **NEVER commit the `service_role` key.** It bypasses RLS = full data access.
  It should only ever live in server-side Supabase functions, never here.
- Keys are read from **Vercel environment variables** at runtime via
  `/api/config`, so they don't have to be hardcoded in the repo.
- `.gitignore` blocks `.env` files and anything that looks like a secret.

---

## Step 1 — Supabase
1. Create a project at https://supabase.com.
2. **SQL Editor → New query →** paste all of `supabase/schema.sql` → **Run**.
   This creates the `app_state` table and enables RLS. (Without this, the app
   has no real data protection.)
3. **Settings → API:** copy the **Project URL** and the **anon / public** key.
   Do **not** copy the `service_role` key.
4. **Settings → Auth:** turn on **Confirm email** (recommended), and review
   **rate limits** and **leaked-password protection**.

## Step 2 — GitHub
1. Push this folder to a new GitHub repo.
2. The included `.gitignore` keeps secrets out. Double-check before pushing:
   ```
   git status        # make sure no .env or key file is staged
   ```
3. It's safe to commit `vercel.json`, `api/config.js`, and all the source —
   none contain secrets. The placeholder keys in `index.html` are just
   placeholders; leave them or remove the commented block.

## Step 3 — Vercel
1. Import the GitHub repo at https://vercel.com (New Project → import).
2. **Framework preset:** "Other" (this is a static site + one serverless
   function; no build step needed).
3. **Settings → Environment Variables**, add:
   ```
   SUPABASE_URL       = https://YOUR-PROJECT.supabase.co
   SUPABASE_ANON_KEY  = your-anon-key
   ```
   (Set them for Production — and Preview if you want previews to work too.)
4. Deploy. Vercel serves the static files, runs `/api/config` from the env
   vars, and applies the security headers in `vercel.json` (CSP, HSTS, etc.).

## Step 4 — Supabase redirect URLs
In Supabase **Auth → URL Configuration**, add your Vercel URLs so email
confirmation / magic links redirect back correctly:
```
https://your-app.vercel.app
https://your-app.vercel.app/*
```

## Step 5 — Turn on cloud mode in the app
The app calls `/api/config` on boot. When it returns real keys, the Supabase
adapter activates automatically and sign-in/sign-up route through Supabase Auth.

> If you'd rather hardcode keys instead of using `/api/config` (simpler, fine
> for a private repo), uncomment the Supabase block in `index.html` and paste
> your URL + anon key there. Both approaches work; the adapter checks globals
> first, then falls back to `/api/config`.

---

## Security checklist before going public
- [ ] `supabase/schema.sql` was run and RLS is **enabled** (verify in Table Editor → app_state → RLS shows "Enabled").
- [ ] `service_role` key is **nowhere** in the repo or client.
- [ ] Email confirmation is **on** in Supabase Auth.
- [ ] Reviewed Supabase Auth **rate limits**; enabled **CAPTCHA** if exposed broadly.
- [ ] (Recommended) Enable **MFA (TOTP)** in Supabase and add the enrollment UI.
- [ ] `.env` files are gitignored and not committed.
- [ ] After first deploy, open DevTools → Network → confirm `/api/config`
      returns your config and the security headers are present on the page.

## Known limitations (honest)
- **Snapshot sync, not live collaboration.** The whole app state syncs as one
  JSON blob per user (last-write-wins). Two devices editing the *same* account
  simultaneously can overwrite each other. For true concurrent multi-user
  editing, migrate to the normalized tables sketched in `supabase/schema.sql`.
- **Business-member logins are still local** in this version; the cloud account
  is the owner. Members syncing through the cloud needs the normalized model.
- **CSP uses `'unsafe-inline'` for scripts** because index.html has small inline
  bootstrap scripts. To reach a strict nonce-based CSP, move those four inline
  `<script>` blocks into an external file and drop `'unsafe-inline'`.
- **This deployment has not been tested live by the author of the code** — the
  integration is verified against a mock backend and is structurally correct,
  but watch your first real sign-up/sync and check the browser console.
