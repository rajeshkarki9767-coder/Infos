// Unit tests for the shared-state methods in supabase/adapter.js.
//
//   node test/adapter.test.js
//
// The adapter is an IIFE that reads window.supabase + window globals and exposes
// window.InfosSupabase. We build a minimal fake `window` with a chainable
// Supabase-style client that records calls and returns canned data, load the
// adapter into that context, then exercise loadSharedState / saveSharedState /
// ensureSharedBusiness / getMembership and assert on the recorded calls.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  \u2713 ' + name); }
  else { failed++; console.log('  \u2717 ' + name); }
}

// ---- Build a fake Supabase client ----------------------------------------
// Records every table query as a chain and resolves to a configured result.
function makeFakeClient(opts) {
  const calls = [];
  const o = opts || {};
  const user = o.user || { id: 'owner-uid', email: 'owner@x.com' };

  function makeQuery(table) {
    const record = { table, filters: [], op: null, payload: null, onConflict: null, single: false, maybeSingle: false };
    calls.push(record);
    const chain = {
      select(cols) { record.op = record.op || 'select'; record.select = cols; return chain; },
      insert(p) { record.op = 'insert'; record.payload = p; return chain; },
      update(p) { record.op = 'update'; record.payload = p; return chain; },
      upsert(p, opt) { record.op = 'upsert'; record.payload = p; record.onConflict = opt && opt.onConflict; return chain; },
      delete() { record.op = 'delete'; return chain; },
      eq(col, val) { record.filters.push([col, val]); return chain; },
      single() { record.single = true; return resolveSelect(record); },
      maybeSingle() { record.maybeSingle = true; return resolveSelect(record); },
      then(res, rej) { return resolveSelect(record).then(res, rej); }
    };
    return chain;
  }
  function resolveSelect(record) {
    // Return canned results keyed by table + op.
    const key = record.table + ':' + (record.op || 'select');
    const canned = (o.results && o.results[key]);
    if (canned instanceof Error) return Promise.resolve({ data: null, error: canned });
    if (record.single || record.maybeSingle) {
      return Promise.resolve({ data: (canned && canned[0]) || null, error: null });
    }
    return Promise.resolve({ data: canned || [], error: null });
  }

  const client = {
    __calls: calls,
    from(table) { return makeQuery(table); },
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel() {},
    auth: {
      async getUser() { return { data: { user }, error: null }; },
      async getSession() { return { data: { session: { access_token: 'tok' } }, error: null }; },
      async signInWithPassword() { return { data: { user }, error: null }; },
      async signUp() { return { data: { user, session: null }, error: null }; },
      async signOut() {},
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
    }
  };
  return client;
}

function loadAdapter(client) {
  const code = fs.readFileSync(path.resolve(__dirname, '../supabase/adapter.js'), 'utf8');
  const win = {
    __INFOS_SUPABASE_URL__: 'https://test.supabase.co',
    __INFOS_SUPABASE_ANON_KEY__: 'anon-key',
    supabase: { createClient: () => client },
    Sync: { register() {} },
    fetch: async () => ({ ok: false })
  };
  const ctx = { window: win, fetch: win.fetch, console };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return win.InfosSupabase;
}

async function run() {
  console.log('\nAdapter — ensureSharedBusiness:');
  {
    const client = makeFakeClient({ results: { 'businesses:insert': [{ id: 'cloud-123' }] } });
    const S = loadAdapter(client);
    const id = await S.adapter.ensureSharedBusiness({ name: 'Acme', color: '#111' });
    check('returns the new cloud id from insert', id === 'cloud-123');
    const insertCall = client.__calls.find(c => c.table === 'businesses' && c.op === 'insert');
    check('inserts into businesses with owner_id + name + color', !!insertCall &&
      insertCall.payload.owner_id === 'owner-uid' && insertCall.payload.name === 'Acme' && insertCall.payload.color === '#111');
  }
  {
    const client = makeFakeClient({});
    const S = loadAdapter(client);
    const id = await S.adapter.ensureSharedBusiness({ cloudId: 'existing-9', name: 'Renamed' });
    check('with cloudId returns same id (update path)', id === 'existing-9');
    const upd = client.__calls.find(c => c.table === 'businesses' && c.op === 'update');
    check('update scoped by id AND owner_id', !!upd &&
      upd.filters.some(f => f[0] === 'id' && f[1] === 'existing-9') &&
      upd.filters.some(f => f[0] === 'owner_id' && f[1] === 'owner-uid'));
  }

  console.log('\nAdapter — loadSharedState:');
  {
    const client = makeFakeClient({ results: { 'shared_state:select': [{ data: { hello: 'world' }, version: 7, updated_at: 'T' }] } });
    const S = loadAdapter(client);
    const r = await S.adapter.loadSharedState('cloud-123');
    check('returns data/version/updatedAt', r && r.data.hello === 'world' && r.version === 7 && r.updatedAt === 'T');
    const sel = client.__calls.find(c => c.table === 'shared_state' && c.op === 'select');
    check('filters by business_cloud_id', !!sel && sel.filters.some(f => f[0] === 'business_cloud_id' && f[1] === 'cloud-123'));
  }
  {
    const client = makeFakeClient({ results: { 'shared_state:select': [] } });
    const S = loadAdapter(client);
    const r = await S.adapter.loadSharedState('cloud-xyz');
    check('returns null when no row exists', r === null);
  }

  console.log('\nAdapter — saveSharedState:');
  {
    const client = makeFakeClient({});
    const S = loadAdapter(client);
    const v = await S.adapter.saveSharedState('cloud-123', { a: 1 }, 4);
    check('bumps version to expectedVersion+1', v === 5);
    const up = client.__calls.find(c => c.table === 'shared_state' && c.op === 'upsert');
    check('upserts on business_cloud_id', !!up && up.onConflict === 'business_cloud_id');
    check('payload carries business_cloud_id, data, version, updated_by', !!up &&
      up.payload.business_cloud_id === 'cloud-123' && up.payload.data.a === 1 &&
      up.payload.version === 5 && up.payload.updated_by === 'owner-uid');
  }
  {
    const client = makeFakeClient({});
    const S = loadAdapter(client);
    const v = await S.adapter.saveSharedState('cloud-123', {}, undefined);
    check('version starts at 1 when none provided', v === 1);
  }

  console.log('\nAdapter — getMembership / getMemberBusiness:');
  {
    const client = makeFakeClient({
      results: {
        'business_members:select': [{ business_id: 'biz-A', allowed_tabs: ['notices', 'balance'] }],
        'businesses:select': [{ id: 'biz-A', name: 'Acme', color: '#222' }]
      }
    });
    const S = loadAdapter(client);
    const m = await S.Auth.getMembership();
    check('getMembership returns businessId + allowedTabs', m && m.businessId === 'biz-A' && m.allowedTabs.length === 2);
    const b = await S.Auth.getMemberBusiness();
    check('getMemberBusiness returns business name/color + allowedTabs', b && b.name === 'Acme' && b.color === '#222' && b.allowedTabs.length === 2);
  }
  {
    const client = makeFakeClient({ results: { 'business_members:select': [] } });
    const S = loadAdapter(client);
    const m = await S.Auth.getMembership();
    check('getMembership returns null for a non-member (owner)', m === null);
  }

  console.log('\nAdapter — memberInfo HARD GATE (prevents owner-path fallthrough):');
  {
    // A business login: server-stamped metadata role=member + business_id.
    const client = makeFakeClient({
      user: { id: 'mem-uid', email: 'team@acme.com', user_metadata: { role: 'member', business_id: 'biz-A' } },
      results: { 'business_members:select': [] } // table read FAILS to return rows
    });
    const S = loadAdapter(client);
    const info = await S.Auth.memberInfo();
    check('memberInfo detects member from metadata even when table read is empty', info.isMember === true && info.businessId === 'biz-A');
    // getMembership must still resolve via metadata fallback.
    const m = await S.Auth.getMembership();
    check('getMembership falls back to metadata business_id', m && m.businessId === 'biz-A');
  }
  {
    // A real owner: no member metadata.
    const client = makeFakeClient({
      user: { id: 'owner-uid', email: 'owner@x.com', user_metadata: { name: 'Owner' } },
      results: { 'business_members:select': [] }
    });
    const S = loadAdapter(client);
    const info = await S.Auth.memberInfo();
    check('memberInfo returns isMember=false for an owner', info.isMember === false);
  }

  console.log('\nAdapter — old view-only methods are gone:');
  {
    const client = makeFakeClient({});
    const S = loadAdapter(client);
    check('publishBusiness removed', typeof S.adapter.publishBusiness === 'undefined');
    check('publishItems removed', typeof S.adapter.publishItems === 'undefined');
    check('fetchMemberView removed', typeof S.Auth.fetchMemberView === 'undefined');
    check('subscribeMemberView removed', typeof S.Auth.subscribeMemberView === 'undefined');
    check('new subscribeSharedState present', typeof S.adapter.subscribeSharedState === 'function');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
