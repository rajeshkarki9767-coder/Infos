// Per-account storage keying (db.js v177).
// Verifies that two accounts on one device get isolated blobs, that a legacy
// single-key blob migrates to the correct account on first bind, and that one
// account's data cannot bleed into another's key.
//
// db.js targets the browser (IndexedDB + localStorage + window). We emulate the
// minimum: a window with a localStorage shim, and force the localStorage driver
// (no IndexedDB in node) — the keying/migration logic is driver-independent.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  \u2713 ' + msg); passed++; };

// --- Minimal browser-ish sandbox -------------------------------------------
function makeLocalStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
    key: i => Array.from(map.keys())[i],
    get length() { return map.size; },
    _dump: () => Object.fromEntries(map)
  };
}

function loadStorage() {
  const code = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
  const localStorage = makeLocalStorage();
  const win = {};
  const sandbox = {
    window: win,
    localStorage,
    // No indexedDB → db.js falls back to the localStorage driver, which exercises
    // the exact same keying/migration code paths (rawGet/rawSet/lsKeyFor).
    console: { warn() {}, log() {} },
    setTimeout, clearTimeout,
    Promise
  };
  win.localStorage = localStorage;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return { Storage: win.Storage, localStorage };
}

(async () => {
  console.log('Storage per-account keying:');

  // 1. Legacy single-key blob migrates to the first account that binds.
  {
    const { Storage, localStorage } = loadStorage();
    await Storage.ready();
    // Simulate an existing single-account install: legacy blob with owner A's data.
    await Storage.replace({ items: { notices: [{ id: 'a1' }] }, __activeOwnerEmail: 'a@x.com', user: { email: 'a@x.com' } });
    // Owner A signs in → binds.
    await Storage.useAccount('a@x.com');
    const a = await Storage.load();
    ok(a && a.items && a.items.notices && a.items.notices[0].id === 'a1',
      'legacy blob migrates to first account on bind');
    ok(/state::a_x_com/.test(Storage.activeKey()), 'active key is per-account after bind');
  }

  // 2. A second account on the same device gets an ISOLATED, empty blob —
  //    account A's data does not bleed into account B's key.
  {
    const { Storage } = loadStorage();
    await Storage.ready();
    await Storage.useAccount('a@x.com');
    await Storage.replace({ items: { notices: [{ id: 'AA' }] }, __activeOwnerEmail: 'a@x.com' });
    // Switch to account B.
    await Storage.useAccount('b@y.com');
    const b = await Storage.load();
    const bItems = (b && b.items && b.items.notices) || [];
    ok(!bItems.some(i => i.id === 'AA'), "account B does NOT see account A's data");
    // Write B's own data, switch back to A, confirm A is intact and unmixed.
    await Storage.replace({ items: { notices: [{ id: 'BB' }] }, __activeOwnerEmail: 'b@y.com' });
    await Storage.useAccount('a@x.com');
    const a2 = await Storage.load();
    const aItems = (a2 && a2.items && a2.items.notices) || [];
    ok(aItems.some(i => i.id === 'AA') && !aItems.some(i => i.id === 'BB'),
      'switching back to A restores A only (no B bleed)');
  }

  // 3. A legacy blob stamped for owner A must NOT migrate under owner B's key.
  {
    const { Storage } = loadStorage();
    await Storage.ready();
    await Storage.replace({ items: { notices: [{ id: 'ONLY_A' }] }, __activeOwnerEmail: 'a@x.com' });
    // Owner B binds first this time — should NOT inherit A's stamped blob.
    await Storage.useAccount('b@y.com');
    const b = await Storage.load();
    const bItems = (b && b.items && b.items.notices) || [];
    ok(!bItems.some(i => i.id === 'ONLY_A'),
      "owner B does not inherit a blob stamped for owner A");
  }

  // 4. clear() wipes only the active account, leaving others intact.
  {
    const { Storage } = loadStorage();
    await Storage.ready();
    await Storage.useAccount('a@x.com');
    await Storage.replace({ items: { notices: [{ id: 'A_DATA' }] }, __activeOwnerEmail: 'a@x.com' });
    await Storage.useAccount('b@y.com');
    await Storage.replace({ items: { notices: [{ id: 'B_DATA' }] }, __activeOwnerEmail: 'b@y.com' });
    // Clear B (the active account).
    await Storage.clear();
    const bAfter = await Storage.load();
    ok(!((bAfter.items && bAfter.items.notices) || []).length, 'clear() empties the active account');
    // A must still have its data.
    await Storage.useAccount('a@x.com');
    const aAfter = await Storage.load();
    ok(((aAfter.items && aAfter.items.notices) || []).some(i => i.id === 'A_DATA'),
      "clear() on B does NOT affect A's data");
  }

  console.log('\n  ' + passed + ' passed');
})().catch(e => { console.error('  \u2717 ' + e.message); process.exit(1); });
