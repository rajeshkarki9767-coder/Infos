// End-to-end shared-access flow test.
//
//   node test/e2e.test.js
//
// This wires the REAL adapter.js and REAL shared-slice.js to a REAL Postgres
// (pglite) running the REAL schema + RLS, via a small Supabase-shaped client
// shim that translates the adapter's query-builder calls into SQL executed as
// the impersonated user (so RLS applies). It then walks the actual product
// flow:
//
//   1. Owner creates a business locally, shares it (ensureSharedBusiness +
//      saveSharedState pushes the slice).
//   2. Member signs in (getMemberBusiness), loads the shared slice
//      (loadSharedState), gets a FULL editable state (sliceToMemberState).
//   3. Member adds + edits entries, pushes back (memberStateToSlice +
//      saveSharedState).
//   4. Owner pulls the shared row and applies it (applySliceToOwnerState) —
//      and sees the member's edits, with secrets + other businesses intact.
//   5. Isolation: a second member (other business) cannot read this data.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { PGlite } = require('@electric-sql/pglite');

const Slice = require('../supabase/shared-slice.js');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  \u2713 ' + name); }
  else { failed++; console.log('  \u2717 ' + name); }
}

function loadSchema(file) {
  let sql = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
  sql = sql.replace(/-- 10\) realtime[\s\S]*?end \$\$;/m, '');
  return sql;
}

// ---- A Supabase-shaped client backed by pglite, scoped to a current user. ----
// Implements just the chain the adapter uses: from().select()/insert()/update()
// /upsert()/delete().eq().maybeSingle()/single(), plus auth.getUser/getSession.
function makeDbClient(db, getUid) {
  function runAs(fn) {
    // Each call runs in its own tx with the impersonated claims + app_user role.
    return (async () => {
      await db.exec('begin');
      const uid = getUid();
      const claims = uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : JSON.stringify({ role: 'anon' });
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
      await db.exec('set local role app_user');
      try { const r = await fn(); await db.exec('commit'); return r; }
      catch (e) { try { await db.exec('rollback'); } catch {} throw e; }
    })();
  }

  function query(table) {
    const q = { table, op: 'select', cols: '*', set: null, filters: [], onConflict: null };
    const builder = {
      select(cols) { q.op = q.op === 'select' ? 'select' : q.op; q.cols = cols || '*'; return builder; },
      insert(payload) { q.op = 'insert'; q.set = payload; return builder; },
      update(payload) { q.op = 'update'; q.set = payload; return builder; },
      upsert(payload, opt) { q.op = 'upsert'; q.set = payload; q.onConflict = opt && opt.onConflict; return builder; },
      delete() { q.op = 'delete'; return builder; },
      eq(col, val) { q.filters.push([col, val]); return builder; },
      single() { q._single = true; return exec(); },
      maybeSingle() { q._maybe = true; return exec(); },
      then(res, rej) { return exec().then(res, rej); }
    };
    function whereSQL(params) {
      if (!q.filters.length) return '';
      const parts = q.filters.map(([c, v]) => { params.push(v); return `${c} = $${params.length}`; });
      return ' where ' + parts.join(' and ');
    }
    function exec() {
      return runAs(async () => {
        const params = [];
        let sql, res;
        if (q.op === 'select') {
          sql = `select ${q.cols} from public.${q.table}${whereSQL(params)}`;
          res = await db.query(sql, params);
          if (q._single) return { data: res.rows[0] || null, error: res.rows.length ? null : { message: 'no rows' } };
          if (q._maybe) return { data: res.rows[0] || null, error: null };
          return { data: res.rows, error: null };
        }
        if (q.op === 'insert' || q.op === 'upsert') {
          const rows = Array.isArray(q.set) ? q.set : [q.set];
          const cols = Object.keys(rows[0]);
          const tuples = rows.map(r => '(' + cols.map(c => { params.push(serialize(r[c])); return `$${params.length}`; }).join(',') + ')');
          sql = `insert into public.${q.table} (${cols.join(',')}) values ${tuples.join(',')}`;
          if (q.op === 'upsert' && q.onConflict) {
            const updates = cols.filter(c => c !== q.onConflict).map(c => `${c}=excluded.${c}`).join(',');
            sql += ` on conflict (${q.onConflict}) do update set ${updates}`;
          }
          if (/select/.test(q.cols) || q._single) sql += ` returning ${q.cols && q.cols !== '*' ? q.cols : '*'}`;
          else sql += ` returning *`;
          try { res = await db.query(sql, params); }
          catch (e) { return { data: null, error: { message: e.message } }; }
          if (q._single) return { data: res.rows[0] || null, error: null };
          return { data: res.rows, error: null };
        }
        if (q.op === 'update') {
          const cols = Object.keys(q.set);
          const sets = cols.map(c => { params.push(serialize(q.set[c])); return `${c}=$${params.length}`; });
          sql = `update public.${q.table} set ${sets.join(',')}${whereSQL(params)}`;
          try { res = await db.query(sql, params); } catch (e) { return { data: null, error: { message: e.message } }; }
          return { data: null, error: null };
        }
        if (q.op === 'delete') {
          sql = `delete from public.${q.table}${whereSQL(params)}`;
          try { res = await db.query(sql, params); } catch (e) { return { data: null, error: { message: e.message } }; }
          return { data: null, error: null };
        }
      });
    }
    return builder;
  }
  function serialize(v) { return (v && typeof v === 'object') ? JSON.stringify(v) : v; }

  return {
    from: query,
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
    removeChannel() {},
    auth: {
      async getUser() { const id = getUid(); return { data: { user: id ? { id } : null }, error: null }; },
      async getSession() { return { data: { session: { access_token: 'tok-' + getUid() } }, error: null }; },
      async signOut() {}
    }
  };
}

function loadAdapter(client) {
  const code = fs.readFileSync(path.resolve(__dirname, '../supabase/adapter.js'), 'utf8');
  const win = {
    __INFOS_SUPABASE_URL__: 'https://test.supabase.co',
    __INFOS_SUPABASE_ANON_KEY__: 'anon',
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
  const db = await PGlite.create();
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid; $$;
    do $$ begin if not exists (select 1 from pg_roles where rolname='app_user') then create role app_user nologin; end if; end $$;
  `);
  await db.exec(loadSchema('../supabase/schema.sql'));
  await db.exec(loadSchema('../supabase/schema-shared.sql'));
  await db.exec(`
    grant usage on schema public, auth to app_user;
    grant select, insert, update, delete on public.businesses, public.business_members, public.shared_state, public.app_state to app_user;
    grant execute on function public.can_access_business(uuid), public.is_member_of(uuid) to app_user;
    grant select on auth.users to app_user;
  `);

  // Seed auth users: owner, member (team for biz A), member2 (team for biz B).
  const owner = (await db.query(`insert into auth.users(email) values ('owner@x.com') returning id`)).rows[0].id;
  const memberUid = (await db.query(`insert into auth.users(email) values ('team@acme.com') returning id`)).rows[0].id;
  const member2Uid = (await db.query(`insert into auth.users(email) values ('team@other.com') returning id`)).rows[0].id;

  // A mutable "current user" the client shim reads.
  let CURRENT = owner;
  const client = makeDbClient(db, () => CURRENT);
  const S = loadAdapter(client);

  // ---- The OWNER's local app state (full app, two businesses) ----
  const ownerState = {
    businesses: [
      { id: 'b1', name: 'Acme', color: '#378ADD', email: 'team@acme.com', password: 'hunter2', devices: [{ fingerprint: 'd1' }] },
      { id: 'b2', name: 'Other', color: '#D85A30', email: 'team@other.com', password: 'pw2' }
    ],
    items: {
      notices: [
        { id: 1, name: 'Welcome', bizIds: ['b1'], deleted: false },
        { id: 2, name: 'B2 only', bizIds: ['b2'], deleted: false }
      ],
      balance: [{ id: 3, name: 'Float', bizIds: ['b1'], amount: 500, password: 'SECRET', pin: '1234' }],
      games: [], system: [], schedule: [], 'idpass-system': [], 'idpass-accounts': []
    },
    itemOrder: { b1: {} },
    bizAllowedTabs: {}, bizTabOrder: {}, customTabs: [], globalActivity: [],
    bizCloudMap: {}, bizCloudVersions: {}
  };

  console.log('\n1) Owner shares business b1:');
  CURRENT = owner;
  const cloudId = await S.adapter.ensureSharedBusiness({ name: 'Acme', color: '#378ADD' });
  ownerState.bizCloudMap.b1 = cloudId;
  // Link the member account (this is what api/create-member does server-side).
  await db.query(`insert into public.business_members(business_id, member_uid, allowed_tabs) values ($1,$2,$3)`,
    [cloudId, memberUid, ['notices', 'balance']]);
  // Link member2 to a DIFFERENT business for the isolation check.
  const cloudId2 = await S.adapter.ensureSharedBusiness({ name: 'Other', color: '#D85A30' });
  ownerState.bizCloudMap.b2 = cloudId2;
  await db.query(`insert into public.business_members(business_id, member_uid, allowed_tabs) values ($1,$2,$3)`,
    [cloudId2, member2Uid, ['notices']]);
  // Push b1's slice to the shared row.
  const sliceA = Slice.buildSharedSlice(ownerState, 'b1', cloudId);
  const v1 = await S.adapter.saveSharedState(cloudId, sliceA, 0);
  ownerState.bizCloudVersions[cloudId] = v1;
  check('owner pushed shared slice, version = 1', v1 === 1);
  check('shared slice stripped item secrets', !('password' in sliceA.items.balance[0]) && !('pin' in sliceA.items.balance[0]));

  console.log('\n2) Member signs in and loads the FULL app on shared data:');
  CURRENT = memberUid;
  const biz = await S.Auth.getMemberBusiness();
  check('getMemberBusiness resolves to the shared business', biz && biz.id === cloudId && biz.name === 'Acme');
  const snap = await S.adapter.loadSharedState(biz.id);
  check('member can read the shared row', snap && snap.data && snap.data.business.id === cloudId);
  const memberState = Slice.sliceToMemberState(snap.data, { email: 'team@acme.com' });
  check('member gets a full editable state (1 business, items present)',
    memberState.businesses.length === 1 && memberState.items.notices.length === 1 && memberState.items.balance.length === 1);
  check('member does NOT receive secrets', !('password' in memberState.items.balance[0]));
  check('member nextItemId is beyond existing (3 -> 4)', memberState.nextItemId === 4);

  console.log('\n3) Member edits: renames an entry + adds a new one, pushes back:');
  memberState.items.notices[0].name = 'Welcome (edited by team)';
  memberState.items.notices.push({ id: memberState.nextItemId++, name: 'Added by team', bizIds: [cloudId], deleted: false });
  // REGRESSION GUARD: the owner only put ['notices','balance'] in allowed_tabs,
  // but a shared login is a FULL editor — they must be able to add on ANY tab
  // (e.g. 'games', 'system') and have it survive. Confirm the member state is
  // NOT tab-restricted, then add a games entry.
  check('member state is NOT tab-restricted (full editor)', !memberState.bizAllowedTabs || !memberState.bizAllowedTabs[cloudId]);
  memberState.items.games = memberState.items.games || [];
  memberState.items.games.push({ id: memberState.nextItemId++, name: 'Game by team', bizIds: [cloudId], deleted: false });
  // The business login records a BALANCE entry — this is the exact scenario the
  // owner must see (view-only, deletable, not editable) on their Balance tab.
  memberState.items.balance = memberState.items.balance || [];
  memberState.items.balance.push({ id: memberState.nextItemId++, name: 'Cash drawer', balance: '500',
    recordedBy: 'Team Cashier', batchId: 'teambatch1', bizIds: [cloudId], createdByBiz: cloudId, deleted: false });
  const backSlice = Slice.memberStateToSlice(memberState);
  check('member-added games entry is in the pushed slice', backSlice.items.games && backSlice.items.games.some(i => i.name === 'Game by team'));
  check('member-added BALANCE entry is in the pushed slice', backSlice.items.balance && backSlice.items.balance.some(i => i.name === 'Cash drawer'));
  const v2 = await S.adapter.saveSharedState(cloudId, backSlice, snap.version);
  check('member write succeeds, version bumped to 2', v2 === 2);

  console.log('\n4) Owner pulls + applies the shared row, sees member edits:');
  CURRENT = owner;
  const snap2 = await S.adapter.loadSharedState(cloudId);
  check('owner reads updated shared row (version 2)', snap2.version === 2);
  Slice.applySliceToOwnerState(ownerState, snap2.data, 'b1');
  const notices = ownerState.items.notices;
  check('owner sees the member rename', notices.some(i => i.name === 'Welcome (edited by team)'));
  check('owner sees the member-added entry', notices.some(i => i.name === 'Added by team'));
  check('owner sees the member-added entry on a NON-allowed tab (games)', (ownerState.items.games || []).some(i => i.name === 'Game by team'));
  // The owner MUST see the business-entered Balance entry on their Balance tab.
  check('owner sees the business-entered BALANCE entry', (ownerState.items.balance || []).some(i => i.name === 'Cash drawer' && i.recordedBy === 'Team Cashier'));
  // It must be remapped to the owner's LOCAL business id (b1), not the cloud id,
  // so it shows under the b1 filter on the owner's Balance tab.
  {
    const teamBal = (ownerState.items.balance || []).find(i => i.name === 'Cash drawer');
    const bizIds = teamBal && (Array.isArray(teamBal.bizIds) ? teamBal.bizIds : []);
    check('business Balance entry is assigned to the owner local biz id (b1)', !!bizIds && bizIds.includes('b1'));
    check('business Balance entry carries createdByBiz (marks it business-entered)', !!teamBal && !!teamBal.createdByBiz);
  }
  check('owner still has the b2-only notice', notices.some(i => i.id === 2 && i.name === 'B2 only'));
  const b1 = ownerState.businesses.find(b => b.id === 'b1');
  check('owner business b1 secrets intact (password/email/devices)',
    b1.password === 'hunter2' && b1.email === 'team@acme.com' && Array.isArray(b1.devices));
  // The local balance item must keep its secret (member never had it; apply must not wipe it).
  const bal = ownerState.items.balance.find(i => i.id === 3);
  check('owner-local balance entry still present after apply', !!bal);

  console.log('\n5) Isolation — member2 (other business) cannot read b1 data:');
  CURRENT = member2Uid;
  const snapForM2 = await S.adapter.loadSharedState(cloudId); // b1's row
  check('member2 reading b1 shared row gets null (RLS blocks)', snapForM2 === null);
  // And a write attempt by member2 to b1 must not change it.
  let m2blocked = false;
  try {
    await db.exec('begin');
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: member2Uid, role: 'authenticated' })]);
    await db.exec('set local role app_user');
    const r = await db.query(`update public.shared_state set data='{"x":"hacked"}' where business_cloud_id=$1`, [cloudId]);
    m2blocked = (r.affectedRows === 0);
    await db.exec('rollback');
  } catch (e) { m2blocked = true; try { await db.exec('rollback'); } catch {} }
  check('member2 UPDATE on b1 row affects 0 rows (RLS)', m2blocked);

  console.log('\n6) Owner-side concurrent push uses version guard:');
  CURRENT = owner;
  // Owner edits something for b1 and pushes; version should advance from 2 -> 3.
  ownerState.items.notices.push({ id: 'x' + 1, name: 'Owner note', bizIds: ['b1'], deleted: false });
  const ownerSlice = Slice.buildSharedSlice(ownerState, 'b1', cloudId);
  const v3 = await S.adapter.saveSharedState(cloudId, ownerSlice, snap2.version);
  check('owner push advances version to 3', v3 === 3);
  CURRENT = memberUid;
  const snap3 = await S.adapter.loadSharedState(cloudId);
  check('member now sees the owner-added note live', snap3.data.items.notices.some(i => i.name === 'Owner note'));

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.close();
  process.exit(failed ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
