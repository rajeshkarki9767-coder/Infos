// ============================================================================
//  Infos — Supabase backend adapter
// ----------------------------------------------------------------------------
//  This wires the app's existing pluggable Sync system (sync.js) to a real
//  Supabase project. It provides:
//    • Supabase Auth (email/password) for the OWNER account
//    • Cloud storage of the full app-state snapshot in a per-user row,
//      protected by Row-Level Security so a user can ONLY read/write their own
//    • push()/pull()/status() implementing the Sync adapter contract
//
//  SECURITY MODEL (read this):
//    - The anon key below is PUBLIC by design — it is safe to ship in the client.
//      Real protection comes from Row-Level Security (RLS) policies on the
//      database (see supabase-schema.sql), NOT from hiding the key.
//    - NEVER put the service_role key in this file or anywhere in the client.
//      It bypasses RLS and would be a critical leak.
//    - Each authenticated user can read/write ONLY the row where user_id =
//      auth.uid(). RLS enforces this server-side; the client cannot override it.
//
//  SETUP: see SUPABASE_SETUP.md. You must (1) create a Supabase project,
//  (2) run supabase-schema.sql in the SQL editor, (3) paste your project URL
//  and anon key below, (4) load the Supabase JS client (see index.html note).
// ============================================================================

(function () {
  'use strict';

  // ---- CONFIG ----
  // Two ways to configure, in priority order:
  //   1) Runtime fetch from /api/config (recommended for Vercel — keys stay in
  //      Vercel env vars, never in the committed repo). Call InfosSupabase.init().
  //   2) Globals set in index.html (window.__INFOS_SUPABASE_URL__ / ANON_KEY).
  // The anon key is public-safe; protection comes from RLS, not from hiding it.
  let SUPABASE_URL = window.__INFOS_SUPABASE_URL__ || '';
  let SUPABASE_ANON_KEY = window.__INFOS_SUPABASE_ANON_KEY__ || '';

  // Fetch public config from the Vercel serverless function (if deployed).
  // Safe to call always; on a non-Vercel host it just fails quietly and we fall
  // back to the globals (or local-only mode).
  async function init() {
    if (SUPABASE_URL && SUPABASE_ANON_KEY) return true; // already configured via globals
    try {
      const res = await fetch('/api/config', { cache: 'no-store' });
      if (res.ok) {
        const cfg = await res.json();
        if (cfg && cfg.url && cfg.anonKey) {
          SUPABASE_URL = cfg.url;
          SUPABASE_ANON_KEY = cfg.anonKey;
          client = null; // force re-create with new config
          return true;
        }
      }
    } catch (_) { /* no /api/config (e.g. local file server) — stay local-only */ }
    return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
  }

  // The Supabase JS client must be available as window.supabase (loaded via the
  // official CDN <script> in index.html — see SUPABASE_SETUP.md).
  function makeClient() {
    if (!window.supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,        // keeps the session in storage (managed by Supabase)
        autoRefreshToken: true,      // rotates the short-lived access token automatically
        detectSessionInUrl: true     // handles magic-link / OAuth redirects
      }
    });
  }

  let client = null;
  function getClient() { if (!client) client = makeClient(); return client; }

  // ----- Auth helpers (used by the app's sign-in screen when Supabase is on) -----
  const Auth = {
    available() { return !!getClient(); },

    async signUp(email, password, name) {
      const c = getClient(); if (!c) throw new Error('Supabase not configured');
      const { data, error } = await c.auth.signUp({
        email, password,
        options: { data: { name: name || '' } }
      });
      if (error) throw error;
      return data.user;
    },

    async signIn(email, password) {
      const c = getClient(); if (!c) throw new Error('Supabase not configured');
      const { data, error } = await c.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data.user;
    },

    // Passwordless / MFA-friendly: emails a one-time magic link.
    async sendMagicLink(email) {
      const c = getClient(); if (!c) throw new Error('Supabase not configured');
      const { error } = await c.auth.signInWithOtp({ email });
      if (error) throw error;
      return true;
    },

    async signOut() {
      const c = getClient(); if (!c) return;
      await c.auth.signOut();
    },

    async currentUser() {
      const c = getClient(); if (!c) return null;
      const { data } = await c.auth.getUser();
      return data?.user || null;
    },

    async resetPassword(email) {
      const c = getClient(); if (!c) throw new Error('Supabase not configured');
      const { error } = await c.auth.resetPasswordForEmail(email);
      if (error) throw error;
      return true;
    },

    onAuthChange(cb) {
      const c = getClient(); if (!c) return () => {};
      const { data } = c.auth.onAuthStateChange((_event, session) => cb(session?.user || null));
      return () => data?.subscription?.unsubscribe?.();
    }
  };

  // ----- The Sync adapter: snapshot push / pull into one RLS-protected row -----
  // Table `app_state`: (user_id uuid PK, state jsonb, updated_at timestamptz, version int)
  const adapter = {
    async status() {
      const c = getClient();
      if (!c) return { connected: false, message: 'Supabase not configured' };
      const user = await Auth.currentUser();
      if (!user) return { connected: false, message: 'Not signed in' };
      return { connected: true, message: 'Connected as ' + (user.email || user.id) };
    },

    // Upload the full state snapshot to the current user's row (upsert).
    async push(state) {
      const c = getClient(); if (!c) throw new Error('Supabase not configured');
      const user = await Auth.currentUser();
      if (!user) throw new Error('Not signed in');
      // Strip device-local / sensitive-in-transit fields we don't want stored server-side.
      const snapshot = sanitizeForCloud(state);
      const { error } = await c.from('app_state').upsert({
        user_id: user.id,
        state: snapshot,
        updated_at: new Date().toISOString(),
        version: (state.__cloudVersion || 0) + 1
      }, { onConflict: 'user_id' });
      if (error) throw error;
      return true;
    },

    // Download the current user's snapshot (or null if none yet).
    async pull() {
      const c = getClient(); if (!c) throw new Error('Supabase not configured');
      const user = await Auth.currentUser();
      if (!user) throw new Error('Not signed in');
      const { data, error } = await c.from('app_state')
        .select('state, version, updated_at')
        .eq('user_id', user.id)   // RLS also enforces this server-side
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const s = data.state || {};
      s.__cloudVersion = data.version || 0;
      s.__cloudUpdatedAt = data.updated_at || null;
      return s;
    }
  };

  // Never send these to the cloud: passwords should not live server-side in
  // plaintext. With Supabase Auth the OWNER password is managed by Supabase, so
  // we strip the local plaintext `accounts[].password` before upload.
  function sanitizeForCloud(state) {
    const clone = JSON.parse(JSON.stringify(state || {}));
    if (Array.isArray(clone.accounts)) {
      clone.accounts = clone.accounts.map(a => { const { password, ...rest } = a; return rest; });
    }
    // Member/business logins also carry plaintext passwords locally — strip them.
    if (Array.isArray(clone.businesses)) {
      clone.businesses = clone.businesses.map(b => { const { password, ...rest } = b; return rest; });
    }
    if (clone.user && clone.user.password) delete clone.user.password;
    return clone;
  }

  // Expose for the app + register with the Sync system if present.
  window.InfosSupabase = { Auth, adapter, init, configured: () => !!getClient() };
  if (window.Sync && typeof window.Sync.register === 'function') {
    window.Sync.register('supabase', adapter);
  }
})();
