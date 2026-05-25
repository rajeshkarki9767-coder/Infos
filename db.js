// IndexedDB storage for Infos.
// Async, structured, no 5MB ceiling. Falls back to localStorage if IDB fails.
// Public API:
//   await Storage.ready()
//   await Storage.load()   -> returns the full state object (or {})
//   await Storage.save(patch) -> merges and persists
//   await Storage.replace(fullState) -> replaces whole state
//   await Storage.clear()
//   Storage.usingFallback() -> true if running on localStorage
//   Storage.stats() -> { driver, sizeApprox, lastSavedAt }
(function() {
  const DB_NAME = 'infos-v3';
  const DB_VERSION = 1;
  const STORE = 'kv';
  const STATE_KEY = 'state';
  const LS_KEY_V2 = 'infos-state-v2';
  const LS_KEY_FALLBACK = 'infos-state-v3-fallback';

  let db = null;
  let driver = 'idb';
  let lastSavedAt = 0;
  let cachedState = null;
  let saveQueue = Promise.resolve();

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no-idb'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('idb-open-failed'));
      req.onblocked = () => reject(new Error('idb-blocked'));
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

  async function init() {
    try {
      db = await openDB();
      driver = 'idb';
    } catch (err) {
      console.warn('IndexedDB unavailable, falling back to localStorage:', err);
      driver = 'localStorage';
    }
    // Migration: if IDB has nothing but old v2 localStorage exists, migrate.
    if (driver === 'idb') {
      const existing = await idbGet(STATE_KEY);
      if (!existing) {
        const v2 = readLS(LS_KEY_V2);
        if (v2) {
          await idbSet(STATE_KEY, v2);
          // Don't remove v2 — keep it as a safety backup. User can clear from Settings.
          console.log('Migrated v2 localStorage → IndexedDB');
        }
      }
    }
  }

  function readLS(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
  function writeLS(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }

  async function load() {
    if (cachedState) return cachedState;
    let s = null;
    if (driver === 'idb') {
      try { s = await idbGet(STATE_KEY); } catch { s = null; }
    }
    if (!s) {
      // Try fallback location, then v2 backup
      s = readLS(LS_KEY_FALLBACK) || readLS(LS_KEY_V2) || {};
    }
    cachedState = s || {};
    return cachedState;
  }

  async function save(patch) {
    // Queue saves so they don't race
    saveQueue = saveQueue.then(async () => {
      if (!cachedState) await load();
      cachedState = { ...cachedState, ...patch };
      if (driver === 'idb') {
        try { await idbSet(STATE_KEY, cachedState); lastSavedAt = Date.now(); return true; }
        catch (e) { console.warn('IDB save failed, falling back:', e); driver = 'localStorage'; }
      }
      const ok = writeLS(LS_KEY_FALLBACK, cachedState);
      lastSavedAt = Date.now();
      return ok;
    });
    return saveQueue;
  }

  async function replace(fullState) {
    saveQueue = saveQueue.then(async () => {
      cachedState = fullState || {};
      if (driver === 'idb') {
        try { await idbSet(STATE_KEY, cachedState); lastSavedAt = Date.now(); return; }
        catch (e) { driver = 'localStorage'; }
      }
      writeLS(LS_KEY_FALLBACK, cachedState);
      lastSavedAt = Date.now();
    });
    return saveQueue;
  }

  async function clear() {
    saveQueue = saveQueue.then(async () => {
      cachedState = {};
      if (driver === 'idb') { try { await idbDel(STATE_KEY); } catch {} }
      try { localStorage.removeItem(LS_KEY_FALLBACK); } catch {}
      try { localStorage.removeItem(LS_KEY_V2); } catch {}
    });
    return saveQueue;
  }

  function stats() {
    let size = 0;
    try { size = JSON.stringify(cachedState || {}).length; } catch {}
    return { driver, sizeApprox: size, lastSavedAt };
  }
  function usingFallback() { return driver !== 'idb'; }
  function ready() { return readyPromise; }

  const readyPromise = init();

  window.Storage = { ready, load, save, replace, clear, stats, usingFallback };
})();
