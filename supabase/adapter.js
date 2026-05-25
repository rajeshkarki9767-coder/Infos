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
        // false → clicking the email confirmation link verifies the account but
        // does NOT auto-create a session. The app routes the user to the sign-in
        // page, where they enter email + password (per product requirement).
        detectSessionInUrl: false
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
      // With email confirmation ON, Supabase returns a user but NO session
      // (session is null) until the user clicks the email link. We surface that
      // so the app can show "check your email" and route to sign-in instead of
      // auto-logging-in an unconfirmed account.
      return {
        user: data.user || null,
        session: data.session || null,
        needsConfirmation: !!(data.user && !data.session)
      };
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

    // STAGE 2: create a hidden member account for a business login via the
    // server function. Owner-only; the server verifies ownership. Returns the
    // new member's uid. Requires api/create-member.js deployed.
    async createMember(businessId, memberEmail, memberPassword, allowedTabs) {
      const c = getClient(); if (!c) throw new Error('Supabase not configured');
      const { data } = await c.auth.getSession();
      const tk = data && data.session && data.session.access_token;
      if (!tk) throw new Error('Not signed in');
      const res = await fetch('/api/create-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
        body: JSON.stringify({
          business_id: businessId,
          member_email: String(memberEmail || '').toLowerCase(),
          member_password: memberPassword,
          allowed_tabs: Array.isArray(allowedTabs) ? allowedTabs : []
        })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Could not create member');
      return out.member_uid;
    },

    // Permanently delete the signed-in user's auth account via the server
    // function (needs api/delete-account.js + SUPABASE_SERVICE_ROLE_KEY set).
    // Falls back gracefully if the endpoint isn't deployed.
    async deleteAccount() {
      const c = getClient(); if (!c) throw new Error('Supabase not configured');
      const { data } = await c.auth.getSession();
      const token = data && data.session && data.session.access_token;
      if (!token) throw new Error('Not signed in');
      const res = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        let detail = ''; try { detail = (await res.json()).error || ''; } catch {}
        throw new Error(detail || 'Account deletion not available');
      }
      return true;
    },

    async currentUser() {
      const c = getClient(); if (!c) return null;
      const { data } = await c.auth.getUser();
      return data?.user || null;
    },

    // ---- STAGE 4: member read path ----
    // Detect whether the signed-in user is a team MEMBER (a hidden business
    // login). We don't trust user_metadata alone; the authoritative signal is
    // having a row in business_members (RLS lets a member read only their own).
    async getMembership() {
      const c = getClient(); if (!c) return null;
      const user = await Auth.currentUser();
      if (!user) return null;
      const { data, error } = await c.from('business_members')
        .select('business_id, allowed_tabs')
        .eq('member_uid', user.id);
      if (error || !data || !data.length) return null;
      // A member login is linked to exactly one business in this model.
      return { businessId: data[0].business_id, allowedTabs: data[0].allowed_tabs || [] };
    },

    // Fetch the business + shared items a member is allowed to read. RLS scopes
    // this to exactly their allowed business/tabs, so even a crafted query can't
    // over-read. Returns { business, itemsByTab } or null.
    async fetchMemberView() {
      const c = getClient(); if (!c) return null;
      const m = await Auth.getMembership();
      if (!m) return null;
      const { data: bizRows } = await c.from('businesses')
        .select('id, name, color').eq('id', m.businessId);
      const business = (bizRows && bizRows[0]) || { id: m.businessId, name: 'Shared business', color: '#378ADD' };
      const { data: itemRows } = await c.from('shared_items')
        .select('tab, data').eq('business_id', m.businessId);
      const itemsByTab = {};
      (itemRows || []).forEach(r => { (itemsByTab[r.tab] = itemsByTab[r.tab] || []).push(r.data); });
      return { business, allowedTabs: m.allowedTabs, itemsByTab };
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
    },

    // Delete the current user's own cloud data row. RLS ensures a user can only
    // delete their own row. NOTE: this removes the stored DATA, not the auth
    // user itself — deleting the auth account requires a server-side function
    // with the service_role key (see api/delete-account.js).
    async deleteOwnData() {
      const c = getClient(); if (!c) throw new Error('Supabase not configured');
      const user = await Auth.currentUser();
      if (!user) throw new Error('Not signed in');
      const { error } = await c.from('app_state').delete().eq('user_id', user.id);
      if (error) throw error;
      return true;
    },

    // ---- STAGE 3: owner publishes the view-only slice for team members ----
    // Create or update a cloud `businesses` row for one of the owner's
    // businesses. Returns the cloud UUID (caller stores it to map local→cloud).
    // `cloudId` is the existing UUID if we've published this biz before.
    async publishBusiness({ cloudId, name, color }) {
      const c = getClient(); if (!c) throw new Error('Supabase not configured');
      const user = await Auth.currentUser();
      if (!user) throw new Error('Not signed in');
      if (cloudId) {
        const { error } = await c.from('businesses')
          .update({ name: name || '', color: color || '#378ADD' })
          .eq('id', cloudId).eq('owner_id', user.id);
        if (error) throw error;
        return cloudId;
      }
      const { data, error } = await c.from('businesses')
        .insert({ owner_id: user.id, name: name || '', color: color || '#378ADD' })
        .select('id').single();
      if (error) throw error;
      return data.id;
    },

    // Replace the published items for a business's allowed tabs. We delete the
    // existing shared_items for this business then insert the current allowed
    // slice — simple and correct (members are read-only; volume is small).
    // `itemsByTab` = { notices: [ {..}, ... ], balance: [...] } (allowed tabs only)
    async publishItems(cloudBusinessId, itemsByTab) {
      const c = getClient(); if (!c) throw new Error('Supabase not configured');
      const user = await Auth.currentUser();
      if (!user) throw new Error('Not signed in');
      // Clear existing published items for this business (RLS scopes to owner).
      const { error: delErr } = await c.from('shared_items').delete().eq('business_id', cloudBusinessId);
      if (delErr) throw delErr;
      const rows = [];
      Object.keys(itemsByTab || {}).forEach(tab => {
        (itemsByTab[tab] || []).forEach(item => {
          rows.push({ business_id: cloudBusinessId, tab, data: item });
        });
      });
      if (rows.length) {
        const { error: insErr } = await c.from('shared_items').insert(rows);
        if (insErr) throw insErr;
      }
      return rows.length;
    },

    // Remove a published business (and its items/members cascade) from the cloud.
    async unpublishBusiness(cloudBusinessId) {
      const c = getClient(); if (!c) throw new Error('Supabase not configured');
      const user = await Auth.currentUser();
      if (!user) throw new Error('Not signed in');
      const { error } = await c.from('businesses').delete()
        .eq('id', cloudBusinessId).eq('owner_id', user.id);
      if (error) throw error;
      return true;
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
  // `ready` resolves once config has been fetched (from globals or /api/config),
  // so the app can await it before deciding auth state.
  const ready = init();
  window.InfosSupabase = { Auth, adapter, init, ready, configured: () => !!getClient() };
  if (window.Sync && typeof window.Sync.register === 'function') {
    window.Sync.register('supabase', adapter);
  }
})();
