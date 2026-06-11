// IndexedDB storage for Infos.
// Async, structured, no 5MB ceiling. Falls back to localStorage if IDB fails.
//
// PER-ACCOUNT KEYING (v176→v177):
//   Historically all state lived under one key ('state'). That meant two
//   different accounts on the SAME device shared one slot — the root of the old
//   cross-account contamination class of bug (mitigated at the app layer, now
//   fixed at the storage layer too).
//
//   Now each account's blob is stored under a per-account key: 'state::<id>',
//   where <id> is derived from the account email. A tiny account-INDEPENDENT
//   index lives at 'state' and remembers which account key is active (so boot,
//   which runs BEFORE we know the identity, can load the right blob).
//
//   BOOTSTRAP NOTE: at boot we don't yet know the account (its identity lives
//   inside the blob / the Supabase session). So load() returns the LAST ACTIVE
//   account's blob by default; once the app confirms the real identity it calls
//   Storage.useAccount(email) — which, if different, re-points subsequent
//   load/save to that account's key.
//
// Public API:
//   await Storage.ready()
//   await Storage.load()              -> full state object for the active key (or {})
//   await Storage.save(patch)         -> merge + persist to the active key
//   await Storage.replace(fullState)  -> replace whole state at the active key
//   await Storage.clear()             -> clear ONLY the active account's blob
//   await Storage.useAccount(email)   -> set the active account key (migrates legacy on first bind)
//   Storage.activeKey()               -> current storage key (debug)
//   Storage.usingFallback()           -> true if on localStorage
//   Storage.stats()                   -> { driver, sizeApprox, lastSavedAt, key }
(function() {
  const DB_NAME = 'infos-v3';
  const DB_VERSION = 1;
  const STORE = 'kv';
  // Account-independent index key. Also the LEGACY single-state key — existing
  // installs have their whole state here, which we migrate on first useAccount().
  const INDEX_KEY = 'state';
  const LS_KEY_V2 = 'infos-state-v2';
  const LS_KEY_FALLBACK = 'infos-state-v3-fallback';
  // Per-account blob keys look like: state::<accountId>
  const ACCT_PREFIX = 'state::';

  let db = null;
  let driver = 'idb';
  let lastSavedAt = 0;
  let cachedState = null;
  let saveQueue = Promise.resolve();

  // The key currently being read/written. Until an account is bound, this is the
  // legacy INDEX_KEY so existing single-account installs keep working untouched.
  let activeKey = INDEX_KEY;
  let activeAccountId = null; // null = not yet bound to a specific account

  // Derive a safe, stable storage id from an email. Lowercased, non-alnum → '_'.
  // (Not for security — just a filesystem/keyspace-safe token.)
  function accountIdFromEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return null;
    return e.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || null;
  }
  function keyForAccount(id) { return id ? (ACCT_PREFIX + id) : INDEX_KEY; }

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no-idb'));
      // HARD TIMEOUT: if IDB doesn't open within 1.5s (another tab blocking it,
      // or it's stuck), give up and fall back to localStorage so boot can't hang.
      let settled = false;
      const tid = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('idb-timeout'));
      }, 1500);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = () => { if (settled) return; settled = true; clearTimeout(tid); resolve(req.result); };
      req.onerror = () => { if (settled) return; settled = true; clearTimeout(tid); reject(req.error || new Error('idb-open-failed')); };
      req.onblocked = () => { if (settled) return; settled = true; clearTimeout(tid); reject(new Error('idb-blocked')); };
    });
  }

  async function idbGet(key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbSet(key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbDel(key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // Low-level raw read/write that respect the current driver, used by both the
  // index and the per-account blobs.
  async function rawGet(key) {
    if (driver === 'idb') {
      try { return await idbGet(key); } catch { return null; }
    }
    return readLS(lsKeyFor(key));
  }
  async function rawSet(key, value) {
    if (driver === 'idb') {
      try { await idbSet(key, value); return true; }
      catch (e) { console.warn('IDB set failed, falling back:', e); driver = 'localStorage'; }
    }
    return writeLS(lsKeyFor(key), value);
  }
  async function rawDel(key) {
    if (driver === 'idb') { try { await idbDel(key); } catch {} }
    try { localStorage.removeItem(lsKeyFor(key)); } catch {}
  }
  // localStorage fallback key namespacing: the legacy fallback stays at its
  // historical name; per-account blobs get a suffix so they don't collide.
  function lsKeyFor(key) {
    if (key === INDEX_KEY) return LS_KEY_FALLBACK;
    return LS_KEY_FALLBACK + '::' + key;
  }

  async function init() {
    try {
      db = await openDB();
      driver = 'idb';
    } catch (err) {
      console.warn('IndexedDB unavailable, falling back to localStorage:', err);
      driver = 'localStorage';
    }
    // Legacy v2 → IDB migration (unchanged): if nothing at the index key but old
    // v2 localStorage exists, seed it so existing users keep their data.
    if (driver === 'idb') {
      const existing = await idbGet(INDEX_KEY);
      if (!existing) {
        const v2 = readLS(LS_KEY_V2);
        if (v2) {
          await idbSet(INDEX_KEY, v2);
          // Keep v2 as a backup; user can clear from Settings.
        }
      }
    }
  }

  function readLS(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
  function writeLS(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }

  // Bind subsequent load/save to a specific account's key. Called by the app
  // AFTER it has confirmed the active identity (owner email or shared email).
  //   - First bind MIGRATES the legacy single-key blob to this account's key if
  //     the account key is empty and the legacy key holds this account's data.
  //   - Switching to a DIFFERENT account drops the in-memory cache so the next
  //     load() reads that account's own blob (no cross-account bleed).
  async function useAccount(email) {
    // v228: guard the whole bind against a hung IndexedDB. Several rawGet/rawSet
    // calls below have no internal timeout; on some Android WebViews / low-storage
    // / private-mode cases an IDB request can hang and never settle, which froze
    // the (awaited) login boot on its loading screen forever. Race the real work
    // against a timeout so a stuck DB degrades to in-memory instead of hanging.
    const _real = _useAccountInner(email);
    const _to = new Promise(res => setTimeout(() => res('__TO__'), 4000));
    try {
      const r = await Promise.race([_real, _to]);
      if (r === '__TO__') { try { console.warn('useAccount timed out; continuing in-memory'); } catch {} }
    } catch (e) { /* swallow — caller proceeds */ }
  }
  async function _useAccountInner(email) {
    const id = accountIdFromEmail(email);
    if (!id) return; // nothing to bind to (e.g. local-only with no email yet)
    if (id === activeAccountId) return; // already bound to this account
    const newKey = keyForAccount(id);

    // Ensure we know the current cache (so a migration can use it if appropriate).
    if (cachedState === null) { try { await load(); } catch {} }

    // MIGRATION: if this account has no blob yet, but the legacy index key holds
    // data that belongs to THIS account, copy it across. We only migrate when the
    // legacy blob's recorded active-owner matches this email (or there's no
    // recorded owner — single-account install), to avoid copying account A's data
    // under account B's key.
    let acctBlob = await rawGet(newKey);
    if (!acctBlob) {
      const legacy = await rawGet(INDEX_KEY);
      if (legacy && typeof legacy === 'object') {
        const legacyOwner = String(legacy.__activeOwnerEmail || (legacy.user && legacy.user.email) || '').toLowerCase();
        const sharedEmail = String(legacy.__sharedEmail || '').toLowerCase();
        const target = String(email).toLowerCase();
        // Migrate only if the legacy blob clearly belongs to this account, or it's
        // ambiguous (no identity stamp) — the classic single-account upgrade case.
        if (!legacyOwner && !sharedEmail) {
          acctBlob = legacy; // single-account install → take it over
        } else if (legacyOwner === target || sharedEmail === target) {
          acctBlob = legacy;
        }
        if (acctBlob) {
          await rawSet(newKey, acctBlob);
        }
      }
    }

    activeAccountId = id;
    activeKey = newKey;
    // Drop the cache; the next load() reads this account's own blob.
    cachedState = (acctBlob && typeof acctBlob === 'object') ? acctBlob : null;
    // Record the active account in the index so boot can preload it next time.
    try {
      const idx = (await rawGet(INDEX_KEY)) || {};
      idx.__lastActiveAccount = id;
      idx.__lastActiveEmail = String(email).toLowerCase();
      await rawSet(INDEX_KEY, idx);
    } catch {}
  }

  async function load() {
    if (cachedState) return cachedState;
    let s = null;
    // If we haven't bound to a specific account yet, prefer the LAST ACTIVE
    // account's blob (recorded in the index), so a refresh restores the right
    // account before the app re-confirms identity. Falls back to the legacy key.
    if (activeKey === INDEX_KEY && activeAccountId === null) {
      try {
        const idx = await rawGet(INDEX_KEY);
        const lastId = idx && idx.__lastActiveAccount;
        if (lastId) {
          const blob = await rawGet(keyForAccount(lastId));
          if (blob && typeof blob === 'object') {
            activeAccountId = lastId;
            activeKey = keyForAccount(lastId);
            s = blob;
          }
        }
      } catch {}
    }
    if (!s) {
      s = await rawGet(activeKey);
    }
    if (!s && activeKey === INDEX_KEY && activeAccountId === null) {
      // Last-resort legacy fallbacks — ONLY when no account is bound yet. Once an
      // account is explicitly bound, an empty per-account blob must STAY empty;
      // falling back to the shared legacy blob here would leak another account's
      // data (a freshly-bound account would inherit whoever was last in the
      // shared slot). Bound + empty = genuinely new account on this device.
      s = readLS(LS_KEY_FALLBACK) || readLS(LS_KEY_V2) || {};
    }
    cachedState = s || {};
    return cachedState;
  }

  async function save(patch) {
    saveQueue = saveQueue.then(async () => {
      if (!cachedState) await load();
      cachedState = { ...cachedState, ...patch };
      const ok = await rawSet(activeKey, cachedState);
      lastSavedAt = Date.now();
      return ok;
    });
    return saveQueue;
  }

  async function replace(fullState) {
    saveQueue = saveQueue.then(async () => {
      cachedState = fullState || {};
      await rawSet(activeKey, cachedState);
      lastSavedAt = Date.now();
    });
    return saveQueue;
  }

  // Clear ONLY the active account's blob (not other accounts on this device).
  async function clear() {
    saveQueue = saveQueue.then(async () => {
      cachedState = {};
      await rawDel(activeKey);
      // If we cleared the legacy/index slot directly, also clear legacy LS keys.
      if (activeKey === INDEX_KEY) {
        try { localStorage.removeItem(LS_KEY_FALLBACK); } catch {}
        try { localStorage.removeItem(LS_KEY_V2); } catch {}
      }
    });
    return saveQueue;
  }

  function stats() {
    let size = 0;
    try { size = JSON.stringify(cachedState || {}).length; } catch {}
    return { driver, sizeApprox: size, lastSavedAt, key: activeKey };
  }
  function usingFallback() { return driver !== 'idb'; }
  function activeKeyName() { return activeKey; }
  function ready() { return readyPromise; }

  const readyPromise = init();

  window.Storage = { ready, load, save, replace, clear, useAccount, activeKey: activeKeyName, stats, usingFallback };
})();
