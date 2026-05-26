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

    // Fetch the business row (name/color) a member is linked to. RLS scopes the
    // read to exactly the member's business. Returns { id, name, color } or null.
    async getMemberBusiness() {
      const c = getClient(); if (!c) return null;
      const m = await Auth.getMembership();
      if (!m) return null;
      const { data: bizRows } = await c.from('businesses')
        .select('id, name, color').eq('id', m.businessId);
      const business = (bizRows && bizRows[0]) || { id: m.businessId, name: 'Shared business', color: '#378ADD' };
      return { ...business, allowedTabs: m.allowedTabs };
    },

    async resetPassword(email) {
      const c = getClient(); if (!c) throw new Error('Supabase not configured');
      const { error } = await c.auth.resetPasswordForEmail(email);
      if (error) throw error;
      return true;
    },

    // Change the signed-in user's password directly (no sign-out needed).
    async updatePassword(newPassword) {
      const c = getClient(); if (!c) throw new Error('Supabase not configured');
      const { error } = await c.auth.updateUser({ password: newPassword });
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

    // ---- SHARED BUSINESS ACCESS: register + read + write the shared row ----
    // The owner registers a business in the cloud (creates the `businesses` row)
    // so it can be shared. Returns the cloud UUID. `cloudId` updates an existing
    // row (rename/recolor) instead of creating a duplicate.
    async ensureSharedBusiness({ cloudId, name, color }) {
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

    // Read the live shared snapshot for a business. RLS lets only the owner or a
    // linked member read it. Returns { data, version, updatedAt } or null if no
    // row exists yet. Works for both owner and member callers.
    async loadSharedState(businessCloudId) {
      const c = getClient(); if (!c) throw new Error('Supabase not configured');
      if (!businessCloudId) throw new Error('businessCloudId required');
      const { data, error } = await c.from('shared_state')
        .select('data, version, updated_at')
        .eq('business_cloud_id', businessCloudId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { data: data.data || {}, version: data.version || 0, updatedAt: data.updated_at || null };
    },

    // Write the live shared snapshot for a business (upsert). RLS lets only the
    // owner or a linked member write it. `expectedVersion` is the version the
    // caller last observed. To avoid writing a stale-low version (which would
    // break realtime de-dupe) we read the current row version first and advance
    // past whichever is higher — so the stored version is monotonic even across
    // reloads or concurrent writers. (Last-write-wins on data is intentional and
    // documented; this only keeps the version counter honest.)
    async saveSharedState(businessCloudId, data, expectedVersion) {
      const c = getClient(); if (!c) throw new Error('Supabase not configured');
      const user = await Auth.currentUser();
      if (!user) throw new Error('Not signed in');
      if (!businessCloudId) throw new Error('businessCloudId required');
      let baseVersion = Number(expectedVersion) || 0;
      try {
        const { data: cur } = await c.from('shared_state')
          .select('version').eq('business_cloud_id', businessCloudId).maybeSingle();
        if (cur && typeof cur.version === 'number' && cur.version > baseVersion) baseVersion = cur.version;
      } catch (_) { /* if the pre-read fails, fall back to expectedVersion */ }
      const nextVersion = baseVersion + 1;
      const row = {
        business_cloud_id: businessCloudId,
        data: data || {},
        version: nextVersion,
        updated_at: new Date().toISOString(),
        updated_by: user.id
      };
      const { error } = await c.from('shared_state').upsert(row, { onConflict: 'business_cloud_id' });
      if (error) throw error;
      return nextVersion;
    },

    // Live updates: subscribe to the shared row for a business. `onChange` fires
    // (with the new row payload when available) whenever the shared snapshot or
    // the business record changes. Returns an unsubscribe function. RLS still
    // applies to the realtime stream, so only authorized devices receive events.
    subscribeSharedState(businessCloudId, onChange) {
      const c = getClient(); if (!c || !businessCloudId) return () => {};
      let channel;
      try {
        channel = c.channel('shared-' + businessCloudId)
          .on('postgres_changes',
            { event: '*', schema: 'public', table: 'shared_state', filter: `business_cloud_id=eq.${businessCloudId}` },
            (payload) => { try { onChange && onChange(payload && payload.new); } catch {} })
          .on('postgres_changes',
            { event: '*', schema: 'public', table: 'businesses', filter: `id=eq.${businessCloudId}` },
            () => { try { onChange && onChange(null); } catch {} })
          .subscribe();
      } catch (e) {
        // Realtime unavailable — shared access still works, just not live.
        return () => {};
      }
      return () => { try { c.removeChannel(channel); } catch {} };
    },

    // Remove a shared business from the cloud (owner only; cascades to
    // shared_state + business_members). Used when the owner unshares/deletes.
    async removeSharedBusiness(businessCloudId) {
      const c = getClient(); if (!c) throw new Error('Supabase not configured');
      const user = await Auth.currentUser();
      if (!user) throw new Error('Not signed in');
      const { error } = await c.from('businesses').delete()
        .eq('id', businessCloudId).eq('owner_id', user.id);
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
