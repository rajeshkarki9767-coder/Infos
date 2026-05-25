// Pluggable backend sync for Infos.
//
// Public API:
//   Sync.register(name, adapter)
//   await Sync.enable(name)        — turns on for this device
//   await Sync.disable()
//   Sync.status()                  — { enabled, adapter, lastSyncAt, lastError, pending }
//   await Sync.pushNow(state)
//   await Sync.pullNow()           — returns remote state or null
//   await Sync.syncNow(state)      — push then pull, returns merged state
//   Sync.onChange(cb)              — fires when sync status changes
//
// Adapter shape:
//   {
//     async push(state) {}     // upload full state snapshot
//     async pull() {}          // download remote state snapshot (or null)
//     async status() {}        // { connected: bool, message: str }
//   }
//
// Ships with a local-loopback adapter that round-trips via a separate IDB store,
// useful for demoing the sync flow. Real adapters (Supabase, Firebase, custom REST)
// implement the same 3 methods.
(function() {
  const adapters = {};
  let active = null;
  let activeName = null;
  let enabled = false;
  let lastSyncAt = 0;
  let lastError = null;
  let pending = 0;
  const listeners = [];

  function register(name, adapter) {
    if (!adapter || typeof adapter.push !== 'function' || typeof adapter.pull !== 'function') {
      console.warn('Invalid sync adapter:', name); return;
    }
    adapters[name] = adapter;
  }

  function notify() { listeners.forEach(cb => { try { cb(status()); } catch {} }); }

  async function enable(name) {
    if (!adapters[name]) throw new Error('Unknown adapter: ' + name);
    active = adapters[name]; activeName = name; enabled = true;
    lastError = null;
    notify();
  }
  async function disable() {
    active = null; activeName = null; enabled = false;
    notify();
  }
  function status() {
    return { enabled, adapter: activeName, lastSyncAt, lastError, pending };
  }
  function onChange(cb) { listeners.push(cb); }

  async function pushNow(state) {
    if (!enabled || !active) return false;
    pending++; notify();
    try { await active.push(state); lastSyncAt = Date.now(); lastError = null; return true; }
    catch (err) { lastError = err.message || String(err); console.warn('Push failed:', err); return false; }
    finally { pending--; notify(); }
  }
  async function pullNow() {
    if (!enabled || !active) return null;
    pending++; notify();
    try { const remote = await active.pull(); lastSyncAt = Date.now(); lastError = null; return remote; }
    catch (err) { lastError = err.message || String(err); console.warn('Pull failed:', err); return null; }
    finally { pending--; notify(); }
  }

  // Simple merge: prefer newer of each top-level object, deep-merge businesses by id and items by id.
  function mergeStates(local, remote) {
    if (!remote) return local;
    if (!local) return remote;
    const merged = { ...remote, ...local };
    // Items: union by id, keep version with most recent activity
    if (local.items && remote.items) {
      merged.items = {};
      const tabs = new Set([...Object.keys(local.items), ...Object.keys(remote.items)]);
      tabs.forEach(t => {
        const l = local.items[t] || [];
        const r = remote.items[t] || [];
        const byId = {};
        r.forEach(it => byId[it.id] = it);
        l.forEach(it => {
          const other = byId[it.id];
          if (!other) { byId[it.id] = it; return; }
          const lTs = (it.history && it.history[0]?.ts) || 0;
          const rTs = (other.history && other.history[0]?.ts) || 0;
          byId[it.id] = (lTs >= rTs) ? it : other;
        });
        merged.items[t] = Object.values(byId);
      });
    }
    // Businesses: union by id, prefer local for now (could add a per-biz updated_at later)
    if (local.businesses && remote.businesses) {
      const byId = {};
      remote.businesses.forEach(b => byId[b.id] = b);
      local.businesses.forEach(b => byId[b.id] = b);
      merged.businesses = Object.values(byId);
    }
    return merged;
  }

  async function syncNow(state) {
    if (!enabled || !active) return state;
    pending++; notify();
    try {
      const remote = await active.pull();
      const merged = mergeStates(state, remote);
      await active.push(merged);
      lastSyncAt = Date.now(); lastError = null;
      return merged;
    } catch (err) {
      lastError = err.message || String(err);
      console.warn('Sync failed:', err);
      return state;
    } finally { pending--; notify(); }
  }

  // --- Built-in: local-loopback adapter (uses IDB to simulate a "remote") ---
  const LOOP_DB = 'infos-sync-loopback';
  const LOOP_STORE = 'snapshots';
  let loopDB = null;
  function openLoop() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no-idb'));
      const req = indexedDB.open(LOOP_DB, 1);
      req.onupgradeneeded = (e) => { e.target.result.createObjectStore(LOOP_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function loopGet() {
    if (!loopDB) loopDB = await openLoop();
    return new Promise((resolve, reject) => {
      const tx = loopDB.transaction(LOOP_STORE, 'readonly');
      const r = tx.objectStore(LOOP_STORE).get('latest');
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  }
  async function loopPut(value) {
    if (!loopDB) loopDB = await openLoop();
    return new Promise((resolve, reject) => {
      const tx = loopDB.transaction(LOOP_STORE, 'readwrite');
      tx.objectStore(LOOP_STORE).put(value, 'latest');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  register('loopback', {
    async push(state) {
      // Simulate small network delay
      await new Promise(r => setTimeout(r, 300));
      await loopPut({ at: Date.now(), state });
    },
    async pull() {
      await new Promise(r => setTimeout(r, 250));
      const rec = await loopGet();
      return rec ? rec.state : null;
    },
    async status() {
      return { connected: true, message: 'Local loopback (round-trips through a separate IDB store)' };
    }
  });

  // --- Example stub: drop-in REST adapter (commented; ready to wire up) ---
  // To use a real backend, register an adapter from your own code or uncomment:
  // register('rest', {
  //   async push(state) { await fetch('/api/state', { method: 'PUT', body: JSON.stringify(state), headers: { 'Content-Type': 'application/json' } }); },
  //   async pull() { const r = await fetch('/api/state'); return r.ok ? r.json() : null; },
  //   async status() { return { connected: true, message: 'REST backend' }; }
  // });

  window.Sync = { register, enable, disable, status, pushNow, pullNow, syncNow, onChange };
})();
