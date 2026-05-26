// Tests for the Vercel serverless handlers: create-member + delete-account.
// These are pure request handlers, so we drive them with mock req/res and a
// stubbed global fetch that simulates Supabase's auth + REST + admin endpoints.
//
//   node test/api.test.js

const path = require('path');

let passed = 0, failed = 0;
function check(n, c) { if (c) { passed++; console.log('  \u2713 ' + n); } else { failed++; console.log('  \u2717 ' + n); } }

// Load an ESM-style handler (export default) from a CJS test. The handlers use
// `export default async function`, so we read + wrap them.
const fs = require('fs');
const vm = require('vm');
function loadHandler(file) {
  let code = fs.readFileSync(path.resolve(__dirname, file), 'utf8');
  code = code.replace(/export\s+default\s+async\s+function\s+handler/, 'module.exports = async function handler');
  const mod = { exports: {} };
  const ctx = { module: mod, exports: mod.exports, process, console, URL,
    // Read fetch dynamically so a stub installed AFTER load still applies.
    get fetch() { return globalThis.fetch; } };
  vm.createContext(ctx);
  vm.runInContext(code, ctx, { filename: file });
  return mod.exports;
}

function mockRes() {
  return {
    statusCode: 0, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

// Build a fetch stub from a route table. Each entry: matcher(url, opts) -> {ok, json|text}.
function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    for (const r of routes) {
      if (r.match(String(url), opts || {})) {
        return {
          ok: r.ok !== false,
          status: r.status || (r.ok === false ? 400 : 200),
          async json() { return r.json !== undefined ? r.json : {}; },
          async text() { return r.text !== undefined ? r.text : JSON.stringify(r.json || {}); }
        };
      }
    }
    return { ok: false, status: 404, async json() { return {}; }, async text() { return 'no route'; } };
  };
  globalThis.fetch.__calls = calls;
  return calls;
}

async function run() {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc-role';

  console.log('\ncreate-member — auth + ownership gates:');
  {
    const createMember = loadHandler('../api/create-member.js');
    // Missing token → 401
    let res = mockRes();
    await createMember({ method: 'POST', headers: {}, body: {} }, res);
    check('rejects missing access token (401)', res.statusCode === 401);
  }
  {
    const createMember = loadHandler('../api/create-member.js');
    let res = mockRes();
    await createMember({ method: 'GET', headers: {}, body: {} }, res);
    check('rejects non-POST (405)', res.statusCode === 405);
  }
  {
    const createMember = loadHandler('../api/create-member.js');
    let res = mockRes();
    await createMember({ method: 'POST', headers: { authorization: 'Bearer tok' },
      body: { business_id: 'not-a-uuid', member_email: 'a@b.com', member_password: 'secret1' } }, res);
    check('rejects non-UUID business_id (400)', res.statusCode === 400 && /UUID/i.test(res.body.error));
  }
  {
    const createMember = loadHandler('../api/create-member.js');
    let res = mockRes();
    await createMember({ method: 'POST', headers: { authorization: 'Bearer tok' },
      body: { business_id: '11111111-1111-1111-1111-111111111111', member_email: 'bad-email', member_password: 'secret1' } }, res);
    check('rejects malformed email (400)', res.statusCode === 400 && /email/i.test(res.body.error));
  }
  {
    // Caller is authenticated but does NOT own the target business → 403.
    const createMember = loadHandler('../api/create-member.js');
    stubFetch([
      { match: u => u.includes('/auth/v1/user'), json: { id: 'owner-1' } },
      { match: u => u.includes('/rest/v1/businesses'), json: [{ id: 'biz-1', owner_id: 'someone-else' }] }
    ]);
    let res = mockRes();
    await createMember({ method: 'POST', headers: { authorization: 'Bearer tok' },
      body: { business_id: '11111111-1111-1111-1111-111111111111', member_email: 'a@b.com', member_password: 'secret1' } }, res);
    check('rejects when caller does not own the business (403)', res.statusCode === 403);
  }
  {
    // Happy path: owns business, member created + linked.
    const createMember = loadHandler('../api/create-member.js');
    stubFetch([
      { match: u => u.includes('/auth/v1/user'), json: { id: 'owner-1' } },
      { match: u => u.includes('/rest/v1/businesses'), json: [{ id: 'biz-1', owner_id: 'owner-1' }] },
      { match: u => u.includes('/auth/v1/admin/users'), json: { id: 'new-member-uid' } },
      { match: u => u.includes('/rest/v1/business_members'), ok: true, json: {} }
    ]);
    let res = mockRes();
    await createMember({ method: 'POST', headers: { authorization: 'Bearer tok' },
      body: { business_id: '11111111-1111-1111-1111-111111111111', member_email: 'a@b.com', member_password: 'secret1', allowed_tabs: ['notices'] } }, res);
    check('creates member on happy path (200 + member_uid)', res.statusCode === 200 && res.body.member_uid === 'new-member-uid');
    const createCall = globalThis.fetch.__calls.find(c => c.url.includes('/auth/v1/admin/users') && (c.opts.method === 'POST'));
    check('stamps role=member metadata on the new account', !!createCall && /"role":"member"/.test(createCall.opts.body));
  }
  {
    // Idempotent path: member already exists -> look up + UPDATE password (the fix
    // for "account shows in Supabase Auth but sign-in says incorrect password").
    const createMember = loadHandler('../api/create-member.js');
    stubFetch([
      { match: (u, o) => u.includes('/auth/v1/user') && (!o.method || o.method === 'GET') && !u.includes('admin'), json: { id: 'owner-1' } },
      { match: u => u.includes('/rest/v1/businesses'), json: [{ id: 'biz-1', owner_id: 'owner-1' }] },
      // POST create -> fails as duplicate
      { match: (u, o) => u.includes('/auth/v1/admin/users') && o.method === 'POST', ok: false, status: 422, text: 'email address has already been registered' },
      // GET lookup by email -> returns existing user
      { match: (u, o) => u.includes('/auth/v1/admin/users?email=') && (!o.method || o.method === 'GET'), json: { users: [{ id: 'existing-uid', email: 'a@b.com' }] } },
      // PUT update -> ok
      { match: (u, o) => /\/auth\/v1\/admin\/users\/existing-uid/.test(u) && o.method === 'PUT', ok: true, json: { id: 'existing-uid' } },
      { match: u => u.includes('/rest/v1/business_members'), ok: true, json: {} }
    ]);
    let res = mockRes();
    await createMember({ method: 'POST', headers: { authorization: 'Bearer tok' },
      body: { business_id: '11111111-1111-1111-1111-111111111111', member_email: 'a@b.com', member_password: 'newpass2', allowed_tabs: ['notices'] } }, res);
    check('existing member: returns 200 (idempotent, not an error)', res.statusCode === 200);
    const putCall = globalThis.fetch.__calls.find(c => /\/auth\/v1\/admin\/users\/existing-uid/.test(c.url) && c.opts.method === 'PUT');
    check('existing member: PUTs a password update', !!putCall && /"password":"newpass2"/.test(putCall.opts.body));
    check('existing member: re-confirms email + role metadata', !!putCall && /"email_confirm":true/.test(putCall.opts.body) && /"role":"member"/.test(putCall.opts.body));
  }

  console.log('\ndelete-account — member self-delete guard:');
  {
    // A MEMBER account tries to delete itself → must be refused (403).
    const deleteAccount = loadHandler('../api/delete-account.js');
    stubFetch([
      { match: u => u.includes('/auth/v1/user'), json: { id: 'mem-1', user_metadata: { role: 'member', business_id: 'biz-1' } } }
    ]);
    let res = mockRes();
    await deleteAccount({ method: 'POST', headers: { authorization: 'Bearer tok' } }, res);
    check('refuses member self-delete (403)', res.statusCode === 403);
    const adminDelete = globalThis.fetch.__calls.find(c => c.url.includes('/auth/v1/admin/users/') && c.opts.method === 'DELETE');
    check('does NOT call admin delete for a member', !adminDelete);
  }
  {
    // An OWNER deletes → cleans up member accounts, then deletes self (200).
    const deleteAccount = loadHandler('../api/delete-account.js');
    stubFetch([
      { match: (u) => u.includes('/auth/v1/user'), json: { id: 'owner-1', user_metadata: { name: 'Owner' } } },
      { match: (u) => u.includes('/rest/v1/businesses'), json: [{ id: 'biz-1' }, { id: 'biz-2' }] },
      { match: (u) => u.includes('/rest/v1/business_members'), json: [{ member_uid: 'mem-1' }, { member_uid: 'mem-2' }] },
      { match: (u) => u.includes('/rest/v1/app_state'), ok: true },
      { match: (u) => u.includes('/auth/v1/admin/users/'), ok: true }
    ]);
    let res = mockRes();
    await deleteAccount({ method: 'POST', headers: { authorization: 'Bearer tok' } }, res);
    check('owner delete succeeds (200)', res.statusCode === 200 && res.body.deleted === true);
    const memberDeletes = globalThis.fetch.__calls.filter(c => /\/auth\/v1\/admin\/users\/mem-/.test(c.url) && c.opts.method === 'DELETE');
    check('deletes the 2 orphaned member accounts', memberDeletes.length === 2);
    const ownerDelete = globalThis.fetch.__calls.find(c => c.url.includes('/auth/v1/admin/users/owner-1') && c.opts.method === 'DELETE');
    check('deletes the owner account itself', !!ownerDelete);
  }
  {
    const deleteAccount = loadHandler('../api/delete-account.js');
    let res = mockRes();
    await deleteAccount({ method: 'POST', headers: {} }, res);
    check('rejects missing token (401)', res.statusCode === 401);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
