// RLS isolation tests for the shared-business model, run against a real
// Postgres engine (pglite/WASM). This proves the security boundary the spec
// flagged as mandatory: a member of business A cannot read or write business B,
// and members CAN read+write their own business (the new shared-edit behavior).
//
//   node test/rls.test.js
//
// We emulate Supabase's auth.uid() exactly: it reads the 'sub' claim from the
// 'request.jwt.claims' GUC, which is how Supabase scopes RLS per request. We
// set that GUC to impersonate the owner / member / anon, then run queries as a
// NON-superuser role so RLS is actually enforced (the bootstrap superuser
// bypasses RLS, so the test would be meaningless without switching roles).

const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');

const SCHEMA_BASE   = path.resolve(__dirname, '../supabase/schema.sql');
const SCHEMA_SHARED = path.resolve(__dirname, '../supabase/schema-shared.sql');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  \u2713 ' + name); }
  else { failed++; console.log('  \u2717 ' + name); }
}

// Strip the trailing Supabase-editor isolation DO block + realtime publication
// statements that pglite can't run (no supabase_realtime publication, and the
// commented examples are harmless but the realtime DO block references a
// publication that doesn't exist here). We run schema DDL only.
function loadSchema(file) {
  let sql = fs.readFileSync(file, 'utf8');
  // Drop the realtime publication block (depends on supabase_realtime publication).
  sql = sql.replace(/-- 10\) realtime[\s\S]*?end \$\$;/m, '');
  return sql;
}

async function run() {
  const db = await PGlite.create();

  // --- Emulate the Supabase auth schema just enough for RLS to work ---
  await db.exec(`
    create schema if not exists auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text
    );
    -- Supabase-compatible auth.uid(): pull 'sub' from the JWT claims GUC.
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid;
    $$;
    -- A non-superuser role to actually trigger RLS (superuser bypasses it).
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='app_user') then
        create role app_user nologin;
      end if;
    end $$;
  `);

  // Load our schemas (base app_state + the new shared model).
  await db.exec(loadSchema(SCHEMA_BASE));
  await db.exec(loadSchema(SCHEMA_SHARED));

  // Grant the app_user role table privileges (RLS still constrains rows).
  await db.exec(`
    grant usage on schema public, auth to app_user;
    grant select, insert, update, delete on
      public.businesses, public.business_members, public.shared_state, public.app_state to app_user;
    grant execute on function public.can_access_business(uuid) to app_user;
    grant execute on function public.is_member_of(uuid) to app_user;
    grant select on auth.users to app_user;
  `);

  // Seed two owners and one member account.
  const owres = await db.query(`insert into auth.users(email) values ('ownerA@x.com') returning id`);
  const ownerA = owres.rows[0].id;
  const owB = await db.query(`insert into auth.users(email) values ('ownerB@x.com') returning id`);
  const ownerB = owB.rows[0].id;
  const mem = await db.query(`insert into auth.users(email) values ('member@x.com') returning id`);
  const member = mem.rows[0].id;

  // Helper: run a function impersonating a uid (or anon when uid is null) as the
  // non-superuser app_user role, so RLS applies. We set the claims + role inside
  // one transaction and reset afterwards.
  async function asUser(uid, fn) {
    await db.exec('begin');
    const claims = uid ? JSON.stringify({ sub: uid, role: 'authenticated' }) : JSON.stringify({ role: 'anon' });
    // set_config local to the tx; switch to the unprivileged role.
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
    await db.exec(`set local role app_user`);
    try { return await fn(); }
    finally { await db.exec('rollback'); }
  }

  // We need persistent seed data across the impersonated (rolled-back) reads, so
  // seed as superuser OUTSIDE asUser first. RLS is bypassed for this seeding,
  // which is fine — it's the equivalent of the owner's own inserts that we test
  // separately below.
  const bizAq = await db.query(
    `insert into public.businesses(owner_id,name,color) values ($1,'Biz A','#111') returning id`, [ownerA]);
  const bizA = bizAq.rows[0].id;
  const bizBq = await db.query(
    `insert into public.businesses(owner_id,name,color) values ($1,'Biz B','#222') returning id`, [ownerB]);
  const bizB = bizBq.rows[0].id;
  await db.query(`insert into public.shared_state(business_cloud_id,data) values ($1,'{"v":"A"}')`, [bizA]);
  await db.query(`insert into public.shared_state(business_cloud_id,data) values ($1,'{"v":"B"}')`, [bizB]);
  // Link member to Biz A only.
  await db.query(`insert into public.business_members(business_id,member_uid) values ($1,$2)`, [bizA, member]);

  console.log('\nRLS isolation — shared_state read:');
  await asUser(member, async () => {
    const r = await db.query(`select business_cloud_id, data from public.shared_state`);
    check('member sees exactly 1 shared row (their business)', r.rows.length === 1);
    check('member sees Biz A data, not Biz B', r.rows.length === 1 && r.rows[0].data.v === 'A');
  });
  await asUser(ownerA, async () => {
    const r = await db.query(`select data from public.shared_state`);
    check('ownerA sees exactly their 1 business row', r.rows.length === 1 && r.rows[0].data.v === 'A');
  });
  await asUser(null, async () => {
    const r = await db.query(`select * from public.shared_state`);
    check('anon (no session) sees 0 shared rows', r.rows.length === 0);
  });

  console.log('\nRLS isolation — shared_state WRITE (the new shared-edit behavior):');
  await asUser(member, async () => {
    await db.query(`update public.shared_state set data='{"v":"A-edited-by-member"}' where business_cloud_id=$1`, [bizA]);
    const r = await db.query(`select data from public.shared_state where business_cloud_id=$1`, [bizA]);
    check('member CAN write their own business shared row', r.rows.length === 1 && r.rows[0].data.v === 'A-edited-by-member');
  });
  await asUser(member, async () => {
    // RLS makes the row invisible, so the UPDATE matches 0 rows (no error, no effect).
    const upd = await db.query(`update public.shared_state set data='{"v":"HACKED"}' where business_cloud_id=$1`, [bizB]);
    check('member UPDATE on Biz B affects 0 rows (RLS hides it)', upd.affectedRows === 0);
  });
  // Verify, as a privileged read, that Biz B was untouched.
  {
    const r = await db.query(`select data from public.shared_state where business_cloud_id=$1`, [bizB]);
    check('Biz B data unchanged after member write attempt', r.rows[0].data.v === 'B');
  }

  console.log('\nRLS isolation — member cannot insert a shared row for someone else\'s biz:');
  await asUser(member, async () => {
    let blocked = false;
    try {
      await db.query(`insert into public.shared_state(business_cloud_id,data) values ($1,'{"v":"X"}')`, [bizB]);
    } catch (e) { blocked = true; }
    check('member INSERT into Biz B is rejected by RLS', blocked);
  });

  console.log('\nRLS isolation — delete is owner-only (member cannot wipe the business):');
  await asUser(member, async () => {
    const del = await db.query(`delete from public.shared_state where business_cloud_id=$1`, [bizA]);
    check('member DELETE of their business shared row affects 0 rows', del.affectedRows === 0);
  });
  await asUser(ownerA, async () => {
    const del = await db.query(`delete from public.shared_state where business_cloud_id=$1`, [bizA]);
    check('owner CAN delete their business shared row', del.affectedRows === 1);
  });

  console.log('\nRLS isolation — businesses + business_members:');
  await asUser(member, async () => {
    const b = await db.query(`select id,name from public.businesses`);
    check('member can read only Biz A business row', b.rows.length === 1 && b.rows[0].name === 'Biz A');
    const m = await db.query(`select * from public.business_members`);
    check('member reads only their own membership row', m.rows.length === 1);
  });
  await asUser(ownerB, async () => {
    const b = await db.query(`select name from public.businesses`);
    check('ownerB sees only Biz B', b.rows.length === 1 && b.rows[0].name === 'Biz B');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await db.close();
  process.exit(failed ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
