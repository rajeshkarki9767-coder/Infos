(function() {
  'use strict';

  // Global error catcher: surfaces otherwise-silent runtime errors (render or
  // click-handler exceptions) as a small on-screen banner, so problems that only
  // happen on a real device can be reported precisely instead of failing quietly.
  try {
    window.addEventListener('error', function (ev) {
      try {
        var msg = (ev && ev.message) ? ev.message : 'Unknown error';
        var where = (ev && ev.filename ? (' @ ' + String(ev.filename).split('/').pop()) : '') + (ev && ev.lineno ? (':' + ev.lineno) : '');
        showRuntimeError('Error: ' + msg + where);
      } catch (e) {}
    });
    window.addEventListener('unhandledrejection', function (ev) {
      try {
        var r = ev && ev.reason;
        var msg = (r && r.message) ? r.message : String(r);
        // Include the top of the stack trace so a recursion/stack-overflow points
        // us at the offending function instead of just saying "stack exceeded".
        var stack = (r && r.stack) ? String(r.stack).split('\n').slice(0, 4).join(' | ') : '';
        showRuntimeError('Async error: ' + msg + (stack ? '  [' + stack + ']' : ''));
      } catch (e) {}
    });
  } catch (e) {}
  function showRuntimeError(text) {
    try {
      var id = 'infos-runtime-error';
      var box = document.getElementById(id);
      if (!box) {
        box = document.createElement('div');
        box.id = id;
        box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:99999;background:#7E281F;color:#fff;font:12px/1.4 system-ui,sans-serif;padding:10px 12px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-height:40vh;overflow:auto;';
        box.onclick = function () { box.remove(); };
        (document.body || document.documentElement).appendChild(box);
      }
      box.textContent = text + '  (tap to dismiss)';
    } catch (e) {}
  }

  // Live indicator: tiny dot in the corner that says whether the realtime
  // websocket is actually connected. Green = live sync is on; gray = falling back
  // to polling only. Hidden if the cloud isn't configured. This makes it obvious
  // whether updates SHOULD appear instantly or only after the next poll.
  // Remembers the steady connection state ('live' | 'error' | null) so transient
  // upload states ('uploading' → 'synced') can settle back to the right label.
  window.__InfosSyncBase = window.__InfosSyncBase || null;
  window.__InfosRealtimeStatus = function (state) {
    try {
      var id = 'infos-rt-status';
      var pill = document.getElementById(id);
      if (!pill) {
        pill = document.createElement('div');
        pill.id = id;
        pill.style.cssText = 'position:fixed;top:14px;right:64px;z-index:99998;display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;font:600 11px/1 system-ui,-apple-system,sans-serif;background:rgba(255,255,255,.92);box-shadow:0 1px 4px rgba(0,0,0,.15);border:1px solid rgba(0,0,0,.06);opacity:.9;user-select:none;';
        var dot = document.createElement('span');
        dot.id = 'infos-rt-dot';
        dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#9aa0a6;flex:none;transition:background .2s;';
        var lbl = document.createElement('span');
        lbl.id = 'infos-rt-label';
        lbl.style.cssText = 'color:#444;letter-spacing:.2px;';
        lbl.textContent = 'Connecting…';
        pill.appendChild(dot); pill.appendChild(lbl);
        (document.body || document.documentElement).appendChild(pill);
      }
      var d = document.getElementById('infos-rt-dot');
      var l = document.getElementById('infos-rt-label');
      // Track the steady connection state separately from transient upload states.
      if (state === 'live' || state === 'error') window.__InfosSyncBase = state;

      function applyBase() {
        var base = window.__InfosSyncBase;
        if (base === 'live') {
          if (d) d.style.background = '#1D9E75';
          if (l) { l.textContent = 'Live sync'; l.style.color = '#137a55'; }
          pill.title = 'Realtime connected — changes sync instantly';
        } else if (base === 'error') {
          if (d) d.style.background = '#D85A30';
          if (l) { l.textContent = 'Sync: offline'; l.style.color = '#b1471f'; }
          pill.title = 'Realtime not connected — updates sync on a short delay';
        } else {
          if (d) d.style.background = '#9aa0a6';
          if (l) { l.textContent = 'Connecting…'; l.style.color = '#444'; }
          pill.title = 'Connecting…';
        }
      }

      if (state === 'uploading') {
        if (d) d.style.background = '#BA7517';
        if (l) { l.textContent = 'Syncing…'; l.style.color = '#8a560f'; }
        pill.title = 'Syncing your change…';
      } else if (state === 'synced') {
        if (d) d.style.background = '#1D9E75';
        if (l) { l.textContent = 'Synced'; l.style.color = '#137a55'; }
        pill.title = 'Your change is saved to the cloud';
        // After a moment, settle back to the steady connection label.
        clearTimeout(window.__InfosSyncSettleTimer);
        window.__InfosSyncSettleTimer = setTimeout(applyBase, 1800);
      } else {
        applyBase();
      }
    } catch (e) {}
  };
  // Convenience helpers the push paths call.
  window.__InfosSyncUploading = function () { try { window.__InfosRealtimeStatus('uploading'); } catch (e) {} };
  window.__InfosSyncDone = function () { try { window.__InfosRealtimeStatus('synced'); } catch (e) {} };

  // Keep v7 key — v8 adds the optional `recentSignins` field but is otherwise shape-compatible
  // with v7, so we want existing users to keep their data.
  const STORAGE_KEY = 'infos-state-v7';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const BIZ_COLORS = ['#378ADD', '#1D9E75', '#7F77DD', '#D85A30', '#BA7517', '#D4537E'];
  const haptic = (ms) => { try { navigator.vibrate && navigator.vibrate(ms || 10); } catch {} };

  // Cached prefs object. Loaded from Storage at startup, written back on every change.
  let cachedPrefs = {};
  let saveTimer = null;

  // ---------- Service Worker ----------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.protocol === 'http:')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then(async (reg) => {
        // Try to register Periodic Background Sync (granted by the OS/browser when supported)
        try {
          if ('periodicSync' in reg) {
            const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
            if (status.state === 'granted') {
              await reg.periodicSync.register('refresh-data', { minInterval: 24 * 60 * 60 * 1000 });
            }
          }
        } catch (e) { /* not supported — fine */ }
      }).catch(err => console.warn('SW failed:', err));
    });
    // React to background sync messages (re-render from local storage)
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'PERIODIC_SYNC') {
        try { if (state.user) setActive(state.currentTab || 'notices', 'fade'); } catch {}
      }
    });
  }

  // ---------- Install prompt ----------
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    if (!loadPrefs().installDismissed && !isStandalone()) {
      const b = $('#install-banner'); if (b) b.hidden = false;
    }
  });
  window.addEventListener('appinstalled', () => { deferredInstall = null; if ($('#install-banner')) $('#install-banner').hidden = true; toast('Infos installed'); });
  function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; }

  // ---------- Persistence ----------
  function loadPrefs() { return cachedPrefs; }
  function savePrefs(patch) {
    cachedPrefs = { ...cachedPrefs, ...patch };
    // Synchronous boot hint: the real state lives in IndexedDB (async to read),
    // so on refresh the auth screen would briefly flash before the async load
    // finishes. Write a tiny instantly-readable flag to localStorage marking
    // whether someone is signed in, so boot can show the main screen immediately.
    try {
      const signedIn = !!(cachedPrefs.user || cachedPrefs.bizContext || state.__sharedMode);
      if (signedIn) localStorage.setItem('infos-boot-hint', '1');
      else localStorage.removeItem('infos-boot-hint');
      // Also remember the current tab synchronously, so a refresh keeps the user
      // on the tab they were on (System, Games, etc.) instead of snapping back to
      // Notices. The async IndexedDB write may not have flushed yet on a quick
      // refresh; this localStorage value is read instantly at boot.
      const t = state.currentTab;
      if (t && !['item-detail','biz-detail','change-password','idpass-system','idpass-accounts'].includes(t)) {
        localStorage.setItem('infos-last-tab', t);
      }
    } catch {}
    // Debounce — many calls during interactions
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        const ok = await window.Storage.save(cachedPrefs);
        // writeLS returns false on quota errors; toast once so we don't spam
        if (ok === false && !state.__quotaWarned) {
          state.__quotaWarned = true;
          if (typeof toast === 'function') toast('Storage is full — export data and remove old photos');
        }
      } catch (e) { console.warn('save failed', e); }
      // Push to sync if enabled
      try { if (window.Sync && window.Sync.status().enabled) window.Sync.pushNow(cachedPrefs); } catch {}
    }, 250);
  }
  function persistAll() {
    // SHARED ACCESS: a business login's data lives ONLY in the shared cloud row,
    // never in this device's local prefs (which may belong to an owner account
    // on the same device). Persist just the lightweight device prefs locally and
    // push the real data to the shared row.
    if (state.__sharedMode) {
      savePrefs({ theme: app.dataset.theme, accent: app.dataset.accent, customAccent: state.customAccent });
      if (state.__sharedBusinessId) pushSharedState(false);
      return;
    }
    savePrefs({
      theme: app.dataset.theme, accent: app.dataset.accent,
      sidebarCollapsed: state.sidebarCollapsed,
      customAccent: state.customAccent,
      user: state.user, bizContext: state.bizContext, activeBizId: state.activeBizId,
      activeTagId: state.activeTagId,
      businesses: state.businesses, nextBizId: state.nextBizId, nextItemId: state.nextItemId, nextTabId: state.nextTabId,
      globalRenames: state.globalRenames, items: state.items,
      hiddenTabs: state.hiddenTabs,
      customTabs: state.customTabs, tabOrder: state.tabOrder,
      onboarded: state.onboarded, pushPermissionAsked: state.pushPermissionAsked,
      soundEnabled: state.soundEnabled,
      templates: state.templates,
      cryptoMeta: state.cryptoMeta,
      syncAdapter: state.syncAdapter,
      bizAllowedTabs: state.bizAllowedTabs,
      bizTabOrder: state.bizTabOrder,
      bizCloudMap: state.bizCloudMap,
      bizCloudVersions: state.bizCloudVersions,
      accounts: state.accounts,
      recentSignins: state.recentSignins,
      currentTab: state.currentTab,
      globalActivity: state.globalActivity,
      itemOrder: state.itemOrder,
      __lastBalNames: state.__lastBalNames,
      __lastBalRecorder: state.__lastBalRecorder
    });
    // If cloud sync is on, debounce-push the snapshot (avoids a request per keystroke).
    // For a business login, the personal app_state is NOT used — its data lives
    // in the shared row, pushed via pushSharedState below.
    if (window.Sync && window.Sync.status && window.Sync.status().enabled && !state.__sharedMode) {
      clearTimeout(window.__cloudPushTimer);
      window.__cloudPushTimer = setTimeout(() => { try { window.Sync.pushNow(state); } catch {} }, 1500);
    }
    // SHARED ACCESS: a business login writes every change to the shared cloud
    // row so the owner and all other devices stay in sync (debounced).
    if (state.__sharedMode && state.__sharedBusinessId) {
      pushSharedState(false);
    }
    // OWNER: if any of the owner's businesses are shared with a team, mirror
    // their slices to the shared cloud rows (debounced) so members see edits.
    // BUT skip this when we're applying a remote update — otherwise the owner
    // immediately echoes the business's own change back to the cloud, which can
    // advance the version and cause the NEXT real business update to be skipped
    // by the version guard (i.e. live updates silently stop arriving).
    if (!state.__sharedMode && !state.__suppressOwnerPush && !(typeof sharedApplyingRemote !== 'undefined' && sharedApplyingRemote) &&
        state.bizCloudMap && Object.keys(state.bizCloudMap).length &&
        window.InfosSupabase && window.InfosSupabase.configured()) {
      clearTimeout(window.__sharePublishTimer);
      window.__sharePublishTimer = setTimeout(() => { try { pushOwnerSharedBusinesses(); } catch {} }, 200);
    }
  }

  // OWNER side: for each shared business, push its current slice to the shared
  // cloud row. Safe to call often (debounced). Skips when not cloud-connected.
  async function pushOwnerSharedBusinesses() {
    if (state.__sharedMode) return;
    if (!state.bizCloudMap || !window.InfosSupabase || !window.InfosSupabase.configured()) return;
    if (typeof sharedApplyingRemote !== 'undefined' && sharedApplyingRemote) return;
    const Slice = window.InfosSharedSlice;
    let pushedAny = false;
    try { if (window.__InfosSyncUploading) window.__InfosSyncUploading(); } catch {}
    for (const localId of Object.keys(state.bizCloudMap)) {
      const cloudId = state.bizCloudMap[localId];
      if (!cloudId || !bizById(localId)) continue;
      try {
        const slice = Slice.buildSharedSlice(state, localId, cloudId);
        const expected = (state.bizCloudVersions && state.bizCloudVersions[cloudId]) || 0;
        const v = await window.InfosSupabase.adapter.saveSharedState(cloudId, slice, expected);
        if (!state.bizCloudVersions) state.bizCloudVersions = {};
        state.bizCloudVersions[cloudId] = v;
        pushedAny = true;
      } catch (e) { /* leave for next save; not fatal */ }
    }
    try { if (pushedAny && window.__InfosSyncDone) window.__InfosSyncDone(); } catch {}
  }

  // ---------- DOM refs ----------
  const app = $('#app');
  const screenAuth = $('#screen-auth');
  const screenMain = $('#screen-main');
  const screenOnb = $('#screen-onboarding');
  const pageTitle = $('#page-title');
  const pageSubtitle = $('#page-subtitle');
  const pageContent = $('#page-content');
  const pageViewport = $('#page-viewport');
  const toastEl = $('#toast');
  const fab = $('#fab');
  const backBtn = $('#back-btn');
  const headerBadge = $('#header-badge');
  const headerSwitchBtn = $('#header-switch-account');
  const bulkToggleBtn = $('#bulk-toggle');
  const bulkBar = $('#bulk-bar');
  const modal = $('#modal');
  const modalContent = $('#modal-content');
  const iconPickerEl = $('#icon-picker');
  const bizPicker = $('#biz-picker');
  const navList = $('#nav-list');
  const bottomTabs = $('#bottom-tabs');
  const pullIndicator = $('#pull-indicator');
  const pullText = $('#pull-text');
  const shortcutsModal = $('#shortcuts-modal');

  // ---------- App version ----------
  // Single source of truth for the human-visible version, shown on Settings → About.
  // Keep this in sync with sw.js CACHE_VERSION when cutting a build.
  const APP_VERSION = '95.0.0';

  // ---------- State ----------
  const state = {
    user: null,
    history: [],
    activeBizId: 'all',
    bizContext: null,
    activeTagId: null,
    sidebarCollapsed: false,
    // Optional custom accent color (overrides preset accent). Stored per device.
    customAccent: null,
    // v15: cross-tab activity feed shown on the Notices "Activity Log" sub-tab.
    // Records create/edit/delete of items on System / Games / ID&Pass / custom tabs.
    globalActivity: [],
    // v15: per-business custom ordering of items on each tab. Shape: { bizId: { tabKey: [itemId, ...] } }.
    itemOrder: {},
    // v15: Notices sub-tab state: 'reminders' (default) | 'activity'.
    noticesSubtab: 'reminders',
    onboarded: false,
    pushPermissionAsked: false,
    bulkMode: false,
    bulkSelected: new Set(),
    listSearch: {}, // ephemeral { tabKey: 'query' } — not persisted
    bizItemsView: 'assigned', // ephemeral: 'assigned' | 'unassigned' for biz detail toggle
    currentTab: 'notices',
    businesses: [],
    nextBizId: 1, nextItemId: 1, nextTabId: 100,
    globalRenames: {},
    hiddenTabs: [],
    customTabs: [],
    tabOrder: ['notices', 'games', 'system', 'idpass', 'balance', 'schedule', 'businesses', 'trash'],
    templates: [
      { id: 'tpl-saas', name: 'SaaS company', desc: 'Engineering, Product, Sales tags', kind: 'business',
        biz: { color: '#378ADD', tags: ['Engineering', 'Product', 'Sales'] }, starters: [] },
      { id: 'tpl-agency', name: 'Creative agency', desc: 'Editorial, Design, Clients tags', kind: 'business',
        biz: { color: '#D4537E', tags: ['Editorial', 'Design', 'Clients'] }, starters: [] },
      { id: 'tpl-personal', name: 'Personal projects', desc: 'Hobby, Learning tags', kind: 'business',
        biz: { color: '#1D9E75', tags: ['Hobby', 'Learning'] }, starters: [] }
    ],
    cryptoMeta: null,
    syncAdapter: null,
    // bizAllowedTabs: { bizId: ['notices','games',...] } — which tabs a business sees when signed in.
    // Missing entry = all tabs allowed (default for new businesses).
    bizAllowedTabs: {},
    // bizCloudMap: { localBizId: cloudUUID } — maps a local business to its
    // published cloud row (Stage 4b), so re-sharing updates instead of duplicating.
    bizCloudMap: {},
    // bizTabOrder: { bizId: ['notices','system',...] } — per-business custom ordering shown to the biz user.
    bizTabOrder: {},
    // Registered owner accounts. { email, name, password, createdAt, termsAcceptedAt }
    accounts: [],
    // Recent sign-ins for quick-switch. { email, name, kind: 'owner'|'business', bizId?, lastSignIn }
    recentSignins: [],
    items: {
      notices: [],
      system: [],
      games: [],
      schedule: [],
      balance: [],
      'idpass-system': [],
      'idpass-accounts': []
    }
  };

  // Restore prefs
  const prefs = loadPrefs();
  if (prefs.theme) app.dataset.theme = prefs.theme;
  if (prefs.accent) app.dataset.accent = prefs.accent;
  // v13: sidebarCollapsed UI is gone — force-clear any old saved value so users
  // who had it toggled on previously don't stay stuck in icon-only mode.
  state.sidebarCollapsed = false;
  app.classList.remove('collapsed');
  ['user','bizContext','activeBizId','activeTagId','businesses','nextBizId','nextItemId','nextTabId',
   'globalRenames','items','customTabs','tabOrder','onboarded','pushPermissionAsked','soundEnabled',
   'templates','cryptoMeta','syncAdapter','bizAllowedTabs','bizCloudMap','bizCloudVersions','bizTabOrder','accounts','recentSignins','customAccent','currentTab','globalActivity','itemOrder','__lastBalNames','__lastBalRecorder','hiddenTabs'].forEach(k => {
    if (prefs[k] !== undefined) state[k] = prefs[k];
  });

  // Custom accent colors removed — migrate any existing value off.
  if (state.customAccent) { state.customAccent = null; try { clearCustomAccent(); } catch {} }

  // v10 migration: ensure 'schedule' (now displayed as Attachments) is in tabOrder + items map
  // for users coming from earlier versions. The internal key stays 'schedule' for data compatibility.
  if (!state.tabOrder.includes('schedule')) {
    const gamesIdx = state.tabOrder.indexOf('games');
    if (gamesIdx >= 0) state.tabOrder.splice(gamesIdx + 1, 0, 'schedule');
    else state.tabOrder.push('schedule');
  }
  if (!state.items.schedule) state.items.schedule = [];

  // v16 migration: ensure 'balance' is in tabOrder + items map for users coming from earlier versions
  // Balance sits just above Attachments (schedule).
  if (!state.tabOrder.includes('balance')) {
    const schedIdx = state.tabOrder.indexOf('schedule');
    if (schedIdx >= 0) state.tabOrder.splice(schedIdx, 0, 'balance');
    else state.tabOrder.push('balance');
  }
  if (!state.items.balance) state.items.balance = [];

  // Migrate items if needed (older data may lack new fields)
  Object.keys(state.items).forEach(k => {
    (state.items[k] || []).forEach(it => {
      if (it.pinned === undefined) it.pinned = false;
      if (it.notes === undefined) it.notes = '';
      if (!it.attachments) it.attachments = [];
      if (!it.history) it.history = [];
      if (it.deleted === undefined) it.deleted = false;
    });
  });

  // Purge trash items older than 30 days
  const PURGE_MS = 30 * 24 * 60 * 60 * 1000;
  Object.keys(state.items).forEach(k => {
    state.items[k] = (state.items[k] || []).filter(it => !it.deleted || (Date.now() - (it.deletedAt || 0) < PURGE_MS));
  });

  // Ensure trash is in tabOrder
  if (!state.tabOrder.includes('trash')) state.tabOrder.push('trash');

  // ---------- Helpers ----------
  function isViewOnly() { return !!state.bizContext; }
  // A SHARED LOGIN is a business-login user: full editable app, but scoped to
  // one shared business. They get every DATA tab (and can add/edit/reorder), but
  // not owner-account surfaces (managing other businesses, owner profile/delete).
  function isSharedLogin() { return !!state.__sharedMode; }
  // "Restricted" = either a legacy view-only biz session OR a shared login, for
  // the purpose of hiding owner-account-management tabs (Businesses, etc.).
  function hideOwnerOnly() { return isViewOnly() || isSharedLogin(); }
  function isTabAllowed(key) {
    if (!isViewOnly()) return true;
    const allowed = state.bizAllowedTabs && state.bizAllowedTabs[state.bizContext];
    if (!allowed) return true; // default: all allowed
    // Container key 'idpass' is allowed if any subtab is allowed
    if (key === 'idpass') return allowed.includes('idpass-system') || allowed.includes('idpass-accounts') || allowed.includes('idpass');
    return allowed.includes(key);
  }
  function bizById(id) { return state.businesses.find(b => b.id === id); }
  function bizPasswordPlain(b) {
    if (!b) return null;
    if (b.password !== undefined && b.password !== null) return b.password;
    return null;
  }
  async function bizPasswordDecrypt(b) {
    // Encryption removed — passwords are stored as plaintext and always readable.
    if (!b) return null;
    return b.password != null ? b.password : null;
  }
  async function bizSetPassword(b, plaintext) {
    // Always store plaintext (encryption feature removed).
    b.password = plaintext;
    delete b.passwordEnc;
    // BULLETPROOF BACKUP: also write to a synchronous localStorage map keyed by
    // business id. The in-memory b.password can momentarily be lost if state is
    // rehydrated mid-flight (async IndexedDB write racing a sync pull), which made
    // the password flash then blank. The render falls back to this map so the
    // password is ALWAYS shown once set.
    try {
      const map = JSON.parse(localStorage.getItem('infos-biz-pw') || '{}');
      if (plaintext) map[b.id] = plaintext; else delete map[b.id];
      localStorage.setItem('infos-biz-pw', JSON.stringify(map));
    } catch {}
  }
  // Read a business password, falling back to the synchronous backup map if the
  // in-memory copy is missing.
  function bizPasswordValue(b) {
    if (!b) return '';
    if (b.password) return b.password;
    try {
      const map = JSON.parse(localStorage.getItem('infos-biz-pw') || '{}');
      if (map[b.id]) { b.password = map[b.id]; return map[b.id]; } // heal in-memory too
    } catch {}
    return '';
  }
  function bizPasswordMasked(b) {
    if (b.password) return '•'.repeat(Math.min(b.password.length, 10));
    return '';
  }
  function tagById(biz, tagId) { return biz?.tags.find(t => t.id === tagId); }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]); }

  // The exact app logo (matches icons/icon.svg). `mono` renders the glyph only,
  // inheriting currentColor (used where the logo sits on a tinted background).
  function appLogoSVG(size, opts) {
    const s = size || 40;
    const mono = opts && opts.mono;
    if (mono) {
      // Glyph-only, single-color version that follows currentColor.
      return `<svg width="${s}" height="${s}" viewBox="0 0 512 512" fill="none" aria-hidden="true">
        <rect x="234" y="148" width="44" height="44" rx="11" fill="currentColor"/>
        <rect x="206" y="220" width="100" height="20" rx="10" fill="currentColor" opacity="0.55"/>
        <rect x="206" y="268" width="100" height="96" rx="18" fill="currentColor"/>
        <rect x="234" y="296" width="44" height="12" rx="6" fill="var(--logo-notch, rgba(0,0,0,0.25))"/>
        <rect x="234" y="324" width="44" height="12" rx="6" fill="var(--logo-notch, rgba(0,0,0,0.25))"/>
      </svg>`;
    }
    // Full-color logo exactly as the app icon.
    return `<svg width="${s}" height="${s}" viewBox="0 0 512 512" aria-hidden="true">
      <rect x="0" y="0" width="512" height="512" rx="128" fill="#378ADD"/>
      <rect x="234" y="148" width="44" height="44" rx="11" fill="#FFFFFF"/>
      <rect x="206" y="220" width="100" height="20" rx="10" fill="#FFFFFF" opacity="0.55"/>
      <rect x="206" y="268" width="100" height="96" rx="18" fill="#FFFFFF"/>
      <rect x="234" y="296" width="44" height="12" rx="6" fill="#378ADD"/>
      <rect x="234" y="324" width="44" height="12" rx="6" fill="#378ADD"/>
    </svg>`;
  }
  function isAppDark() {
    if (app.dataset.theme === 'dark') return true;
    if (app.dataset.theme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  // Parse a #rgb/#rrggbb color to {r,g,b}; returns null if unparseable.
  function parseHex(hex) {
    if (!hex) return null;
    let h = String(hex).trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return null;
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
  }
  // Relative luminance (0=black, 1=white).
  function luminance(rgb) {
    const f = v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
    return 0.2126*f(rgb.r) + 0.7152*f(rgb.g) + 0.0722*f(rgb.b);
  }
  // Returns a version of `hex` guaranteed readable as TEXT on the current theme's
  // surface. Dark text on dark bg → lighten; light text on light bg → darken.
  // Falls back to the accent text color if the input can't be parsed.
  function readableColor(hex) {
    const rgb = parseHex(hex);
    if (!rgb) return 'var(--text-primary)';
    const dark = isAppDark();
    const lum = luminance(rgb);
    // Mix the colour toward white (dark mode) or black (light mode) only when it
    // is genuinely too low/high in contrast, keeping normal brand colours intact.
    if (dark && lum < 0.14) {
      const pct = lum < 0.06 ? 62 : 42;
      return `color-mix(in srgb, ${hex} ${100-pct}%, #ffffff)`;
    }
    if (!dark && lum > 0.72) {
      const pct = lum > 0.85 ? 58 : 38;
      return `color-mix(in srgb, ${hex} ${100-pct}%, #000000)`;
    }
    return hex;
  }
  // Test hook (harmless): lets the audit verify contrast math directly.
  window.__InfosColor = { readableColor, luminance, parseHex };
  function relTime(ts) {
    const d = Date.now() - ts;
    if (d < 60000) return 'just now';
    if (d < 3600000) return Math.floor(d/60000) + 'm ago';
    if (d < 86400000) return Math.floor(d/3600000) + 'h ago';
    if (d < 2592000000) return Math.floor(d/86400000) + 'd ago';
    return new Date(ts).toLocaleDateString();
  }
  function recordHistory(item, action) {
    if (!item.history) item.history = [];
    item.history.unshift({ ts: Date.now(), action });
    if (item.history.length > 50) item.history.length = 50;
  }
  function recordActivity(biz, action, label) {
    if (!biz) return;
    if (!biz.activity) biz.activity = [];
    biz.activity.unshift({ id: 'a' + Date.now(), ts: Date.now(), action, label });
    if (biz.activity.length > 100) biz.activity.length = 100;
  }
  // v15: Cross-tab activity feed shown under Notices → Activity Log.
  // Records what changed across System / Games / ID&Pass / custom tabs.
  // Notices itself is excluded (it has its own kind of "what" — the reminder content).
  function recordGlobalActivity(tabKey, action, item) {
    if (!tabKey || tabKey === 'notices') return;
    // The activity log records CHANGES to existing data — edits and deletions —
    // not the creation of brand-new entries. New entries are visible on their own
    // tab; logging every creation just makes the log noisy. (Restores are kept
    // since they represent recovering previously-deleted data.)
    if (action === 'created') return;
    if (!state.globalActivity) state.globalActivity = [];
    const title = item?.title || item?.name || item?.label || 'Untitled';
    const tabName = tabDisp(tabKey).name;
    const bizIds = item ? itemBizIds(item) : [];
    state.globalActivity.unshift({
      id: 'ga' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      ts: Date.now(),
      action,        // 'created' | 'edited' | 'trashed' | 'restored'
      tabKey,
      tabName,
      itemId: item?.id,
      title,
      bizIds
    });
    if (state.globalActivity.length > 200) state.globalActivity.length = 200;
  }

  // v15: Move an item up or down in the per-business order for a tab.
  function reorderItemForBiz(bizId, tabKey, itemId, dir) {
    if (!state.itemOrder) state.itemOrder = {};
    if (!state.itemOrder[bizId]) state.itemOrder[bizId] = {};

    // Build the current effective order from what's visible (filtered + not deleted, biz-assigned, unpinned).
    // We only reorder UNPINNED items (pinned ones are visually grouped above and aren't touched).
    const items = (state.items[tabKey] || []).filter(i => !i.deleted && itemHasBiz(i, bizId) && !i.pinned);
    const saved = state.itemOrder[bizId][tabKey] || [];
    const ranked = new Map(saved.map((id, i) => [id, i]));
    items.sort((a, b) => {
      const ai = ranked.has(a.id) ? ranked.get(a.id) : 1e9;
      const bi = ranked.has(b.id) ? ranked.get(b.id) : 1e9;
      if (ai !== bi) return ai - bi;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
    const idx = items.findIndex(i => i.id === itemId);
    if (idx < 0) return;
    const newIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= items.length) return;
    [items[idx], items[newIdx]] = [items[newIdx], items[idx]];
    state.itemOrder[bizId][tabKey] = items.map(i => i.id);
    persistAll();
    // Re-render whatever tab the user is on
    state.history.pop(); setActive(state.currentTab || tabKey, 'fade');
  }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(() => { toastEl.hidden = true; }, 2200);
  }

  // ---------- Per-business theme tint ----------
  // Always on: when a business is the active filter (or context), apply its color as the accent.
  function applyPerBizTheme() {
    let bizColor = null;
    if (state.bizContext) bizColor = bizById(state.bizContext)?.color;
    else if (state.activeBizId && state.activeBizId !== 'all' && state.activeBizId !== 'none') bizColor = bizById(state.activeBizId)?.color;
    if (bizColor) {
      app.style.setProperty('--accent-solid', bizColor);
      app.style.setProperty('--accent-bg', bizColor + (isAppDark() ? '33' : '1F'));
      app.style.setProperty('--accent-text', bizColor);
      app.classList.add('biz-themed');
    } else if (state.customAccent) {
      // Fall back to the user's custom accent when no biz is filtered
      applyCustomAccent(state.customAccent);
    } else {
      app.style.removeProperty('--accent-solid');
      app.style.removeProperty('--accent-bg');
      app.style.removeProperty('--accent-text');
      app.classList.remove('biz-themed');
    }
  }

  // Apply a freeform hex accent. Computes appropriate bg + text per theme.
  function applyCustomAccent(hex) {
    if (!hex) return;
    app.style.setProperty('--accent-solid', hex);
    // For the soft background, fade the hex toward the surface tone (dark or light).
    const alpha = isAppDark() ? '33' : '1F';
    app.style.setProperty('--accent-bg', hex + alpha);
    app.style.setProperty('--accent-text', hex);
    app.classList.add('biz-themed');
  }
  function clearCustomAccent() {
    app.style.removeProperty('--accent-solid');
    app.style.removeProperty('--accent-bg');
    app.style.removeProperty('--accent-text');
    app.classList.remove('biz-themed');
  }

  function bizAvatarHTML(b, size) {
    const s = size || 40, isLg = s >= 36;
    if (b.logo) return `<div class="biz-avatar" style="width:${s}px;height:${s}px;border-radius:${isLg ? 'var(--radius-md)' : '50%'};background:${b.color}33;"><img src="${b.logo}" alt=""/></div>`;
    return `<div class="biz-avatar" style="width:${s}px;height:${s}px;border-radius:${isLg ? 'var(--radius-md)' : '50%'};background:${b.color}33;color:${readableColor(b.color)};font-size:${Math.round(s*0.42)}px;font-weight:500;">${esc(b.name.charAt(0).toUpperCase())}</div>`;
  }
  function bizChipHTML(bizId, small) {
    if (!bizId) return '';
    const b = bizById(bizId); if (!b) return '';
    const isDark = isAppDark();
    return `<span class="biz-chip ${small ? 'biz-chip-sm' : ''}" data-biz-chip="${b.id}" style="background:${b.color}${isDark ? '33' : '22'}; color:${readableColor(b.color)}; border:1px solid ${b.color}${isDark ? '66' : '55'};"><span class="biz-color-dot" style="background:${b.color}; width:6px; height:6px;"></span>${esc(b.name)}</span>`;
  }
  // Render multiple business chips from an array of IDs. If empty, returns ''.
  function bizChipsHTML(bizIds, small) {
    if (!bizIds || !bizIds.length) return '';
    // Business members (view-only) must NOT see which businesses an item is assigned to.
    // They only ever see items assigned to their own business, and revealing the full
    // assignment list would leak other businesses' names.
    if (isViewOnly()) return '';
    return bizIds.map(id => bizChipHTML(id, small)).join('');
  }
  // Render chips for an item, normalizing legacy bizId vs bizIds.
  function itemBizChipsHTML(it, small) {
    const ids = itemBizIds(it);
    return bizChipsHTML(ids, small);
  }
  function tagChipsHTML(bizId, tagIds) {
    if (!bizId || !tagIds || !tagIds.length) return '';
    const b = bizById(bizId); if (!b) return '';
    const isDark = isAppDark();
    return b.tags.filter(t => tagIds.includes(t.id)).map(t => `<span class="tag-chip" data-tag-chip="${t.id}" data-biz="${bizId}" style="background:${t.color}${isDark ? '2A' : '18'}; color:${readableColor(t.color)}; border:1px solid ${t.color}${isDark ? '55' : '40'};"><i class="ti ti-tag" style="font-size:9px;"></i>${esc(t.name)}</span>`).join('');
  }

  // Normalize an item's assignments to a bizIds array, regardless of whether
  // it was saved as single `bizId` (legacy) or `bizIds` (v7+).
  function itemBizIds(it) {
    if (Array.isArray(it.bizIds)) return it.bizIds;
    if (it.bizId) return [it.bizId];
    return [];
  }
  function itemHasBiz(it, bizId) {
    return itemBizIds(it).includes(bizId);
  }
  function itemIsUnassigned(it) {
    return itemBizIds(it).length === 0;
  }

  function filterByBiz(arr) {
    let out = arr.filter(i => !i.deleted);
    if (state.bizContext) out = out.filter(i => itemHasBiz(i, state.bizContext));
    else if (state.activeBizId === 'all') {} // no-op
    else if (state.activeBizId === 'none') out = out.filter(i => itemIsUnassigned(i));
    else out = out.filter(i => itemHasBiz(i, state.activeBizId));
    if (state.activeTagId) out = out.filter(i => i.tagIds && i.tagIds.includes(state.activeTagId));
    // v12: when viewing as owner, hide items belonging to a biz that has disabled
    // the current tab in its business settings. Items assigned to multiple businesses
    // are kept if at least one of those businesses still has the tab enabled.
    // A SHARED LOGIN is a full editor of its own business, so this UI-scoping must
    // NOT apply to them — they always see/edit all of their data.
    if (!state.bizContext && !isSharedLogin()) {
      const curTab = state.currentTab;
      if (curTab && TAB_DEFS[curTab]) {
        out = out.filter(i => {
          const bids = itemBizIds(i);
          if (!bids.length) return true; // unassigned items always show
          // Keep if at least one of its businesses still allows this tab
          return bids.some(bid => isTabAllowedForBiz(bid, curTab));
        });
      }
    }
    return out;
  }

  // Check if a tab is allowed for a specific business (used for owner-side filtering).
  function isTabAllowedForBiz(bizId, tabKey) {
    const allowed = state.bizAllowedTabs?.[bizId];
    if (!allowed) return true; // no explicit list = all allowed
    // ID & Pass container is allowed if either sub-tab (or the container key) is allowed
    if (tabKey === 'idpass') {
      return allowed.includes('idpass') || allowed.includes('idpass-system') || allowed.includes('idpass-accounts');
    }
    return allowed.includes(tabKey);
  }

  function bindChipClicks(c) {
    $$('[data-biz-chip]', c).forEach(el => el.onclick = (e) => {
      e.stopPropagation();
      if (isViewOnly()) return;
      state.activeBizId = el.dataset.bizChip;
      state.activeTagId = null;
      updateActiveBizDisplay(); buildNav(); updateBadges(); persistAll();
      const cur = state.history[state.history.length-1]?.split(':')[0];
      if (cur && TAB_DEFS[cur]) { state.history.pop(); setActive(cur, 'fade'); }
      haptic();
    });
    $$('[data-tag-chip]', c).forEach(el => el.onclick = (e) => {
      e.stopPropagation();
      const tagId = el.dataset.tagChip, bizId = el.dataset.biz;
      if (!isViewOnly() && state.activeBizId !== bizId) state.activeBizId = bizId;
      state.activeTagId = state.activeTagId === tagId ? null : tagId;
      updateActiveBizDisplay(); updateBadges(); persistAll();
      const cur = state.history[state.history.length-1]?.split(':')[0];
      if (cur && TAB_DEFS[cur]) { state.history.pop(); setActive(cur, 'fade'); }
      haptic();
    });
  }

  // ---------- Tabs ----------
  const TAB_DEFS = {
    notices: { name: 'Notices', icon: 'bell', render: renderNotices, fab: true, kind: 'list' },
    system: { name: 'System', icon: 'server-cog', render: renderSystemList, fab: true, kind: 'list' },
    games: { name: 'Games', icon: 'device-gamepad-2', render: renderGames, fab: true, kind: 'list' },
    schedule: { name: 'Attachments', icon: 'paperclip', render: renderScheduleList, fab: true, kind: 'list' },
    balance: { name: 'Balance', icon: 'wallet', render: renderBalanceList, fab: true, kind: 'list' },
    idpass: { name: 'ID & Pass', icon: 'key', render: renderIdPassOverview, kind: 'parent' },
    'idpass-system': { name: 'System', icon: 'server-cog', render: renderIdPassSystem, fab: true, kind: 'list' },
    'idpass-accounts': { name: 'Accounts', icon: 'user-circle', render: renderIdPassAccounts, fab: true, kind: 'list' },
    businesses: { name: 'Businesses', icon: 'building-store', render: renderBusinesses, fab: true, ownerOnly: true },
    trash: { name: 'Trash', icon: 'trash', render: renderTrash, ownerOnly: true },
    'biz-detail': { name: '', icon: '', render: renderBizDetail, hidden: true },
    'item-detail': { name: '', icon: '', render: renderItemDetail, hidden: true },
    'balance-detail': { name: '', icon: '', render: renderBalanceDetail, hidden: true },
    'user-guide': { name: 'User guide', icon: 'book-2', render: renderUserGuide, hidden: true },
    about: { name: 'About', icon: 'info-square-rounded', render: renderAbout, hidden: true },
    privacy: { name: 'Privacy', icon: 'shield-lock', render: renderPrivacy, hidden: true },
    profile: { name: 'Profile', icon: 'user', render: renderProfile, hidden: true },
    'change-password': { name: 'Change password', icon: 'key', render: renderChangePassword, hidden: true },
    settings: { name: 'Settings', icon: 'settings', render: renderSettings, hidden: true }
  };

  function customTabDef(id) {
    const ct = state.customTabs.find(t => t.id === id);
    return ct ? { name: ct.name, icon: ct.icon, render: renderCustomTab, fab: true, kind: 'list', custom: true, customId: id } : null;
  }
  function getTabDef(key) { return TAB_DEFS[key] || customTabDef(key); }

  function tabDisp(key) {
    const def = getTabDef(key); if (!def) return { name: key, icon: 'point' };
    if (state.bizContext) {
      const b = bizById(state.bizContext);
      if (b && b.tabRenames && b.tabRenames[key]) return { name: b.tabRenames[key].name || def.name, icon: b.tabRenames[key].icon || def.icon };
    }
    if (state.globalRenames[key]) return { name: state.globalRenames[key].name || def.name, icon: state.globalRenames[key].icon || def.icon };
    return { name: def.name, icon: def.icon };
  }

  function buildNav() {
    const isBiz = isViewOnly();
    let html = '<div class="nav-section">';
    // Ensure order has all known
    const known = ['notices', 'system', 'games', 'idpass', 'businesses', 'trash'];
    known.forEach(k => { if (!state.tabOrder.includes(k)) state.tabOrder.push(k); });

    // Use per-business tab order if the user is signed in as a business.
    let orderToUse = state.tabOrder;
    if (isBiz && state.bizContext && state.bizTabOrder?.[state.bizContext]?.length) {
      const perBiz = state.bizTabOrder[state.bizContext];
      // Map per-biz keys back to top-level navigable keys (idpass-system/accounts collapse to idpass).
      const perBizTopLevel = [];
      perBiz.forEach(k => {
        if (k === 'idpass-system' || k === 'idpass-accounts') {
          if (!perBizTopLevel.includes('idpass')) perBizTopLevel.push('idpass');
        } else if (!perBizTopLevel.includes(k)) perBizTopLevel.push(k);
      });
      // Append any tabs not covered by the saved order
      state.tabOrder.forEach(k => { if (!perBizTopLevel.includes(k)) perBizTopLevel.push(k); });
      orderToUse = perBizTopLevel;
    }

    orderToUse.forEach(key => {
      if (!isTabAllowed(key)) return;
      // Owner-hidden (deleted) built-in tabs are skipped. businesses/trash can't be hidden.
      if (!isBiz && (state.hiddenTabs || []).includes(key) && key !== 'businesses' && key !== 'trash') return;
      const def = getTabDef(key); if (!def) return;
      if (def.ownerOnly && (isBiz || isSharedLogin())) return;
      const disp = tabDisp(key);
      if (def.expandable) {
        // v14: render as a flat single row, no expandable children.
        // Sub-tabs (System / Accounts) live as horizontal segmented controls inside the page body.
        html += `<div class="nav-item" data-tab="${key}"><i class="ti ti-${disp.icon} nav-icon"></i><span class="label">${esc(disp.name)}</span></div>`;
      } else if (key === 'notices') {
        html += `<div class="nav-item" data-tab="${key}"><i class="ti ti-${disp.icon} nav-icon"></i><span class="label">${esc(disp.name)}</span></div>`;
      } else if (key === 'businesses') {
        html += `<div class="nav-item" data-tab="${key}"><i class="ti ti-${disp.icon} nav-icon"></i><span class="label">${esc(disp.name)}</span></div>`;
      } else if (key === 'trash') {
        const trashCount = Object.values(state.items).flat().filter(i => i.deleted).length;
        html += `<div class="nav-item" data-tab="${key}"><i class="ti ti-${disp.icon} nav-icon"></i><span class="label">${esc(disp.name)}</span>${trashCount ? `<span class="label badge" style="background:var(--surface-1);color:var(--text-secondary);">${trashCount}</span>` : ''}</div>`;
      } else {
        html += `<div class="nav-item" data-tab="${key}"><i class="ti ti-${disp.icon} nav-icon"></i><span class="label">${esc(disp.name)}</span></div>`;
      }
    });
    html += '</div>';

    const visibleCustom = state.customTabs.filter(ct => isTabAllowed(ct.id));
    if (visibleCustom.length) {
      html += '<div class="nav-divider"></div><div class="nav-section"><div class="nav-section-title label">Custom</div>';
      visibleCustom.forEach(ct => {
        const disp = tabDisp(ct.id);
        html += `<div class="nav-item" data-tab="${ct.id}"><i class="ti ti-${disp.icon} nav-icon"></i><span class="label">${esc(disp.name)}</span></div>`;
      });
      html += '</div>';
    }

    navList.innerHTML = html;
    bindNavItems();
    bindNavDrag();
    updateBadges();
    $('#biz-filter-wrap').style.display = isBiz ? 'none' : 'block';
    buildBottomTabs();
    if (typeof refreshHeaderSwitchVisibility === 'function') refreshHeaderSwitchVisibility();
  }

  function bindNavItems() {
    $$('.nav-item[data-tab]').forEach(item => {
      item.onclick = () => {
        // The "Profile" shortcut opens Settings on the Profile tab specifically.
        if (item.dataset.profileShortcut) settingsActiveTab = 'appearance';
        setActive(item.dataset.tab); haptic();
        if (window.innerWidth <= 768) app.classList.remove('drawer-open');
      };
    });
    // Switch-account: open the in-app picker (no confirmation, no sign-in screen).
    $$('.nav-item[data-action="switch-account"]').forEach(item => {
      item.onclick = () => { openSwitchAccountPicker(); haptic(); };
    });
  }

  // v7: tab reordering moved to Settings → Management. No drag in sidebar.
  function bindNavDrag() { /* no-op */ }

  function buildBottomTabs() {
    const isBiz = isViewOnly();
    const tabs = [];
    if (isBiz) {
      // Business view: Notices, System, Games, ID & Pass (no Profile — switch-account in header)
      if (isTabAllowed('notices')) tabs.push({ key: 'notices', icon: tabDisp('notices').icon, label: tabDisp('notices').name });
      if (isTabAllowed('system')) tabs.push({ key: 'system', icon: tabDisp('system').icon, label: tabDisp('system').name });
      if (isTabAllowed('games')) tabs.push({ key: 'games', icon: tabDisp('games').icon, label: tabDisp('games').name });
      if (isTabAllowed('idpass')) tabs.push({ key: 'idpass', icon: tabDisp('idpass').icon, label: tabDisp('idpass').name });
    } else {
      // Owner: Notices, ID & Pass, Businesses, Settings (Profile lives inside Settings)
      tabs.push({ key: 'notices', icon: tabDisp('notices').icon, label: tabDisp('notices').name });
      tabs.push({ key: 'idpass', icon: tabDisp('idpass').icon, label: tabDisp('idpass').name });
      tabs.push({ key: 'businesses', icon: tabDisp('businesses').icon, label: tabDisp('businesses').name });
      tabs.push({ key: 'settings', icon: 'settings', label: 'Settings' });
    }
    bottomTabs.innerHTML = tabs.map(t =>
      `<button class="tab-btn ${state.currentTab === t.key ? 'active' : ''}" data-tab="${t.key}"><i class="ti ti-${t.icon}"></i><span class="tab-label">${esc(t.label)}</span></button>`
    ).join('');
    $$('.tab-btn').forEach(btn => btn.onclick = () => { setActive(btn.dataset.tab); haptic(); });
    bottomTabs.hidden = false;
  }

  function updateBadges() {
    const b = $('#notices-badge');
    if (b) {
      const n = filterByBiz(state.items.notices).length;
      b.textContent = n;
      b.style.display = n > 0 ? '' : 'none';
    }
  }

  function setActive(tab, direction, ctx) {
    if (tab === 'logout') return doLogout();
    const def = getTabDef(tab); if (!def) return;
    if (def.ownerOnly && hideOwnerOnly()) { toast('Not available for a business login'); return; }

    exitBulkMode();

    const allKeys = [...Object.keys(TAB_DEFS), ...state.customTabs.map(t => t.id)];
    const curKey = state.history.length ? state.history[state.history.length-1].split(':')[0] : null;
    const curIdx = curKey ? allKeys.indexOf(curKey) : -1;
    const nextIdx = allKeys.indexOf(tab);
    if (!direction) direction = nextIdx > curIdx ? 'right' : (nextIdx < curIdx ? 'left' : 'fade');

    state.currentTab = tab;
    // Persist so a refresh keeps the user on this tab. Skip detail/transient tabs
    // that need ctx — restoring those without ctx would mis-render.
    if (state.user && !['item-detail','biz-detail','change-password'].includes(tab)) {
      persistAll();
    }
    $$('.nav-item').forEach(n => {
      const dt = n.dataset.tab;
      n.classList.toggle('active', dt === tab || (tab === 'biz-detail' && dt === 'businesses'));
    });
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    // v14: idpass-system / idpass-accounts are now sub-views within the parent idpass page.
    // If the user lands directly on a sub-route (e.g. via search), redirect to idpass and
    // pre-select the right segmented control.
    if (tab === 'idpass-system' || tab === 'idpass-accounts') {
      state.idpassSubtab = tab;
      tab = 'idpass';
      state.currentTab = tab;
      $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === tab));
    }

    const disp = tabDisp(tab);
    const detailTabs = (tab === 'biz-detail' || tab === 'item-detail' || tab === 'balance-detail');
    pageTitle.textContent = detailTabs ? (ctx?.title || '') : (def.hidden ? def.name : disp.name);
    pageSubtitle.textContent = detailTabs ? (ctx?.sub || '') : (state.activeTagId ? renderActiveFilters() : '');
    pageContent.className = '';
    pageContent.innerHTML = '';
    def.render(pageContent, ctx);
    bindChipClicks(pageContent);
    void pageContent.offsetWidth;
    pageContent.className = direction === 'right' ? 'page-enter-right' : (direction === 'left' ? 'page-enter-left' : 'page-enter-fade');
    pageContent.scrollTop = 0;

    fab.hidden = true; // FAB replaced by fixed top entry button on each list tab

    bulkToggleBtn.hidden = !(def.kind === 'list' && !isViewOnly());

    const key = ctx?.bizId ? `${tab}:${ctx.bizId}` : (ctx?.itemId ? `${tab}:${ctx.itemTab || 'balance'}:${ctx.itemId}` : tab);
    if (state.history[state.history.length-1] !== key) state.history.push(key);
    if (state.history.length > 30) state.history.shift();
    // The back arrow only appears on detail / sub-pages that are reached from a
    // list (item, business, balance entry, change-password). Main tabs never
    // show it — switching tabs is done via the sidebar / bottom bar.
    const detailRoutes = ['biz-detail', 'item-detail', 'balance-detail', 'change-password'];
    backBtn.hidden = !detailRoutes.includes(tab);

    if (app.classList.contains('drawer-open')) app.classList.remove('drawer-open');
  }

  function renderActiveFilters() {
    if (!state.activeTagId) return '';
    // Find tag in any biz
    let tag = null;
    state.businesses.forEach(b => { if (!tag) tag = b.tags.find(t => t.id === state.activeTagId); });
    return tag ? `Filtered by tag: ${tag.name}` : '';
  }

  function onFab(tab) {
    if (isViewOnly()) return;
    if (tab === 'businesses') openBusinessModal();
    else if (state.items[tab]) openItemModal(tab);
    else {
      const ct = state.customTabs.find(t => t.id === tab);
      if (ct) { if (!state.items[tab]) state.items[tab] = []; openItemModal(tab); }
    }
  }

  function goBack() {
    if (state.history.length < 2) return;
    state.history.pop();
    const prev = state.history.pop();
    const parts = prev.split(':');
    const tab = parts[0];
    if (tab === 'biz-detail') { const b = bizById(parts[1]); if (b) setActive('biz-detail','left',{bizId:b.id,title:b.name,sub:b.email}); else setActive('businesses','left'); }
    else if (tab === 'item-detail') {
      const itemTab = parts[1], itemId = parts[2];
      const it = (state.items[itemTab] || []).find(x => x.id === itemId);
      if (it) setActive('item-detail','left',{itemTab,itemId,title:it.title||it.name||it.label||'Item'});
      else setActive('notices','left');
    }
    else if (tab === 'balance-detail') {
      const itemId = parts[2];
      const it = (state.items.balance || []).find(x => x.id === itemId);
      if (it) setActive('balance-detail','left',{itemId,title:it.name||'Entry',sub:`Recorded by ${it.recordedBy||'Unknown'}`});
      else setActive('balance','left');
    }
    else setActive(tab, 'left');
  }
  backBtn.onclick = goBack;

  // ---------- Sidebar/drawer ----------
  // v13: The collapsed sidebar toggle button was removed — on desktop the sidebar is always full,
  // on mobile it's a drawer. The collapsed state still functions internally (for legacy users
  // who had it on), but there's no UI to flip it any more.
  $('#mobile-menu').onclick = () => { app.classList.toggle('drawer-open'); haptic(); };
  $('#close-drawer').onclick = () => app.classList.remove('drawer-open');
  $('#sidebar-overlay').onclick = () => app.classList.remove('drawer-open');
  // Keep the body scroll-lock class in sync with the drawer state, no matter
  // which code path opens/closes it (button, swipe, overlay tap, nav click).
  (() => {
    const sync = () => document.body.classList.toggle('drawer-locked', app.classList.contains('drawer-open'));
    new MutationObserver(sync).observe(app, { attributes: true, attributeFilter: ['class'] });
    sync();
  })();

  // v11: Slide-right gesture opens the sidebar drawer on phones.
  // Works from anywhere in the left half of the screen (not just the edge).
  // To avoid stealing horizontal scrolls or interfering with form inputs, we ignore
  // touches that start inside scrollable elements, inputs, buttons, or the bottom-tab bar.
  (function attachEdgeSwipe() {
    let startX = 0, startY = 0, tracking = false, decided = false;
    const SWIPE_THRESHOLD_PX = 80; // travel needed to open drawer
    const VERTICAL_TOLERANCE_PX = 50; // perpendicular slop
    const MAX_START_X_RATIO = 0.85; // touch may start anywhere in the left 85% (incl. the middle)

    function isInteractive(el) {
      // Walk up to find any element we shouldn't fight with.
      let n = el;
      while (n && n !== document.body) {
        const tag = n.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A') return true;
        // Skip cards (taps + long-press belong to them), the bottom tabs, modals, FAB, search trigger
        if (n.classList?.contains('card-row')) return true;
        if (n.classList?.contains('tab-btn')) return true;
        if (n.classList?.contains('fab')) return true;
        if (n.id === 'modal') return true;
        if (n.classList?.contains('photo-lightbox')) return true;
        if (n.classList?.contains('switch-splash')) return true;
        if (n.classList?.contains('loading-splash')) return true;
        // Any horizontally scrollable container
        try {
          const cs = window.getComputedStyle(n);
          if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && n.scrollWidth > n.clientWidth) return true;
        } catch {}
        n = n.parentNode;
      }
      return false;
    }

    document.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      if (app.classList.contains('drawer-open')) return;
      const t = e.touches[0];
      // Must start within the left portion of the screen (now includes the middle)
      if (t.clientX > window.innerWidth * MAX_START_X_RATIO) return;
      // Don't fight with interactive / scrollable content
      if (isInteractive(e.target)) return;
      startX = t.clientX;
      startY = t.clientY;
      tracking = true;
      decided = false;
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      // Lock-in direction after a small initial movement so we don't trigger on vertical scrolls
      if (!decided && (absDx > 12 || absDy > 12)) {
        decided = true;
        // If the user is clearly scrolling vertically, abort.
        if (absDy > absDx) { tracking = false; return; }
      }
      if (!decided) return;

      // Trigger on sustained rightward travel.
      if (dx > SWIPE_THRESHOLD_PX && absDy < VERTICAL_TOLERANCE_PX) {
        app.classList.add('drawer-open');
        tracking = false;
        haptic(20);
      }
    }, { passive: true });

    document.addEventListener('touchend', () => { tracking = false; decided = false; }, { passive: true });
    document.addEventListener('touchcancel', () => { tracking = false; decided = false; }, { passive: true });
  })();

  // v11: When the drawer is open, swiping left closes it.
  (function attachDrawerCloseSwipe() {
    let startX = 0, startY = 0, tracking = false;
    document.addEventListener('touchstart', (e) => {
      if (!app.classList.contains('drawer-open')) return;
      if (!e.touches || e.touches.length !== 1) return;
      const t = e.touches[0];
      startX = t.clientX; startY = t.clientY; tracking = true;
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = Math.abs(t.clientY - startY);
      if (dx < -60 && dy < 50) {
        app.classList.remove('drawer-open');
        tracking = false;
        haptic(15);
      }
    }, { passive: true });
    document.addEventListener('touchend', () => { tracking = false; }, { passive: true });
  })();

  // ---------- Biz picker ----------
  $('#active-biz').onclick = (e) => {
    if (isViewOnly()) return;
    e.stopPropagation();
    if (!bizPicker.hidden) { bizPicker.hidden = true; return; }
    renderBizPicker(); bizPicker.hidden = false;
  };
  document.addEventListener('click', e => {
    if (!bizPicker.contains(e.target) && !$('#active-biz').contains(e.target)) bizPicker.hidden = true;
  });

  // Global delegated password-eye toggle: any button with data-pw-eye="<inputId>"
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-pw-eye]');
    if (!btn) return;
    e.preventDefault();
    const inp = document.getElementById(btn.dataset.pwEye);
    if (!inp) return;
    const isPw = inp.type === 'password';
    inp.type = isPw ? 'text' : 'password';
    // Rebuild the icon as a fresh <i> (the icon lib may have swapped it to <svg>)
    btn.innerHTML = `<i class="ti ${isPw ? 'ti-eye-off' : 'ti-eye'}"></i>`;
    window.__InfosIcons?.replaceIcons(btn);
  });

  function renderBizPicker() {
    const cur = state.activeBizId;
    const opts = [
      { id: 'all', name: 'All businesses', icon: 'building-community' },
      ...state.businesses.map(b => ({ id: b.id, name: b.name, biz: b }))
    ];
    bizPicker.innerHTML = opts.map(o => `
      <div class="biz-pick-item ${cur === o.id ? 'selected' : ''}" data-id="${o.id}">
        ${o.biz ? `<div style="width:18px;height:18px;display:flex;align-items:center;justify-content:center;">${bizAvatarHTML(o.biz, 18)}</div>` : `<i class="ti ti-${o.icon}" style="font-size:14px;"></i>`}
        <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(o.name)}</span>
        ${cur === o.id ? '<i class="ti ti-check" style="font-size:14px;"></i>' : ''}
      </div>
    `).join('');
    $$('.biz-pick-item', bizPicker).forEach(el => el.onclick = () => {
      state.activeBizId = el.dataset.id;
      state.activeTagId = null;
      updateActiveBizDisplay();
      bizPicker.hidden = true;
      updateBadges();
      persistAll();
      const cur = state.history[state.history.length-1]?.split(':')[0];
      if (cur && getTabDef(cur)) { state.history.pop(); setActive(cur, 'fade'); }
      haptic();
    });
  }

  function updateActiveBizDisplay() {
    const lbl = $('#active-biz-label'), ic = $('#active-biz-icon');
    if (state.bizContext) {
      const b = bizById(state.bizContext);
      lbl.textContent = b ? b.name : 'Business';
      ic.innerHTML = b ? bizAvatarHTML(b, 18) : '';
    } else if (state.activeBizId === 'all') {
      lbl.textContent = 'All businesses';
      ic.innerHTML = '<i class="ti ti-filter" style="font-size:14px;color:var(--text-secondary);"></i>';
    } else if (state.activeBizId === 'none') {
      lbl.textContent = 'Unassigned';
      ic.innerHTML = '<i class="ti ti-minus" style="font-size:14px;color:var(--text-secondary);"></i>';
    } else {
      const b = bizById(state.activeBizId);
      lbl.textContent = b ? b.name : 'All';
      ic.innerHTML = b ? bizAvatarHTML(b, 18) : '';
    }
    applyPerBizTheme();
  }

  // ---------- Command palette ----------
  const searchModal = $('#search-modal');
  const searchInput = $('#search-input');
  const searchResults = $('#search-results');
  let focusedResultIdx = -1;

  function openSearch() { searchModal.hidden = false; searchInput.value = ''; focusedResultIdx = -1; renderSearchResults(''); setTimeout(() => searchInput.focus(), 50); haptic(); }
  function closeSearch() { searchModal.hidden = true; }
  $('#search-trigger').onclick = openSearch;
  $('#search-close').onclick = closeSearch;
  let searchDownOnBackdrop = false;
  searchModal.onmousedown = e => { searchDownOnBackdrop = (e.target === searchModal); };
  searchModal.ontouchstart = e => { searchDownOnBackdrop = (e.target === searchModal); };
  searchModal.onclick = e => { if (e.target === searchModal && searchDownOnBackdrop) closeSearch(); searchDownOnBackdrop = false; };
  searchInput.oninput = e => { focusedResultIdx = -1; renderSearchResults(e.target.value); };

  function parseSearch(q) {
    const tokens = q.trim().split(/\s+/).filter(Boolean);
    const filters = { tag: null, biz: null, text: '' };
    const textParts = [];
    tokens.forEach(t => {
      if (t.toLowerCase().startsWith('tag:')) filters.tag = t.substring(4).toLowerCase();
      else if (t.toLowerCase().startsWith('biz:')) filters.biz = t.substring(4).toLowerCase();
      else textParts.push(t.toLowerCase());
    });
    filters.text = textParts.join(' ');
    return filters;
  }

  function renderSearchResults(q) {
    const f = parseSearch(q);
    const all = [];

    // Universal data search. For the OWNER this spans every business and the
    // unassigned pool regardless of the active business filter. For a view-only
    // member it stays scoped to their own business.
    const scope = (arr) => {
      const live = arr.filter(i => !i.deleted);
      if (state.bizContext) return live.filter(i => itemHasBiz(i, state.bizContext));
      return live; // owner: search everything, ignore the active filter
    };

    const matchText = (it, tabKey) => {
      if (!f.text) return true;
      const hay = [
        it.title, it.name, it.label, it.shortName, it.message, it.description,
        it.username, it.link, it.notes, it.recordedBy,
        // balance amount as text so "500" finds an entry of 500
        (tabKey === 'balance' ? String(it.balance ?? '') : '')
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(f.text);
    };

    const bizLabel = (it) => {
      const ids = itemBizIds(it);
      if (!ids.length) return 'Unassigned';
      return ids.map(id => bizById(id)?.name).filter(Boolean).join(', ');
    };

    Object.keys(state.items).forEach(tabKey => {
      scope(state.items[tabKey]).forEach(it => {
        const title = it.title || it.name || it.label || '(untitled)';
        const matchesBiz = !f.biz || itemBizIds(it).some(id => bizById(id)?.name.toLowerCase().includes(f.biz));
        const matchesTag = !f.tag || (it.tagIds || []).some(tid => state.businesses.flatMap(b => b.tags).find(t => t.id === tid && t.name.toLowerCase().includes(f.tag)));
        if (matchesBiz && matchesTag && matchText(it, tabKey)) {
          // Build a sub-line: tab name + which business(es) it belongs to.
          const where = bizLabel(it);
          const sub = state.bizContext ? tabDisp(tabKey).name : `${tabDisp(tabKey).name} · ${where}`;
          const run = () => {
            closeSearch();
            if (tabKey === 'balance') {
              setActive('balance-detail', 'right', { itemId: it.id, title, sub: `Recorded by ${it.recordedBy || 'Unknown'}` });
            } else if (isViewOnly()) {
              openItemDetailModal(tabKey, it.id);
            } else {
              setActive('item-detail', 'right', { itemTab: tabKey, itemId: it.id, title });
            }
          };
          all.push({ kind: 'item', title, sub, icon: tabDisp(tabKey).icon, section: tabDisp(tabKey).name, run });
        }
      });
    });

    if (!all.length) { searchResults.innerHTML = `<div class="result-empty">No results for "${esc(q)}"</div>`; return; }
    // Group by section (tab), show a total count, cap each section at 8 with an overflow note.
    const grouped = {};
    all.forEach(r => { if (!grouped[r.section]) grouped[r.section] = []; grouped[r.section].push(r); });
    let html = `<div class="result-count">${all.length} result${all.length === 1 ? '' : 's'}</div>`;
    Object.keys(grouped).forEach(section => {
      const list = grouped[section];
      html += `<div class="result-section">${esc(section)}${list.length > 8 ? ` <span class="result-section-count">${list.length}</span>` : ''}</div>`;
      list.slice(0, 8).forEach((r) => {
        const idx = all.indexOf(r);
        html += `<div class="result-item" data-idx="${idx}"><i class="ti ti-${r.icon}"></i><div class="result-body"><div>${esc(r.title)}</div>${r.sub ? `<div class="result-sub">${esc(r.sub)}</div>` : ''}</div></div>`;
      });
      if (list.length > 8) html += `<div class="result-more">+${list.length - 8} more — refine your search</div>`;
    });
    searchResults.innerHTML = html;
    $$('.result-item', searchResults).forEach(el => el.onclick = () => all[parseInt(el.dataset.idx)].run());
  }
  function updateFocused() {
    const items = $$('.result-item', searchResults);
    items.forEach((el, i) => el.classList.toggle('focused', i === focusedResultIdx));
    if (items[focusedResultIdx]) items[focusedResultIdx].scrollIntoView({ block: 'nearest' });
  }

  // ---------- Keyboard shortcuts ----------
  let gKeyMode = false, gKeyTimer = null;
  document.addEventListener('keydown', e => {
    // Modal escape
    if (e.key === 'Escape') {
      closeSearch();
      modal.hidden = true;
      iconPickerEl.hidden = true;
      shortcutsModal.hidden = true;
      bizPicker.hidden = true;
      if (app.classList.contains('drawer-open')) app.classList.remove('drawer-open');
      return;
    }

    // Don't trigger shortcuts when typing in inputs (unless cmd/ctrl)
    const inInput = ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName);

    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (state.user) openSearch();
      return;
    }
    if (!state.user) return;

    if ((e.metaKey || e.ctrlKey) && e.key === 'n' && !inInput) {
      e.preventDefault();
      if (state.currentTab === 'balance') {
        // Balance entries are added ONLY by the business login (view-only session).
        if (state.items.balance && isViewOnly()) openBalanceModal();
      } else if (state.items[state.currentTab] && !isViewOnly()) {
        openItemModal(state.currentTab);
      }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'b' && !inInput) {
      e.preventDefault();
      const def = getTabDef(state.currentTab);
      if (def?.kind === 'list' && !isViewOnly()) toggleBulkMode();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'd' && !inInput) {
      e.preventDefault();
      toggleTheme();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === '[' && !inInput) {
      e.preventDefault();
      goBack();
      return;
    }
    if (e.key === '?' && !inInput) {
      e.preventDefault();
      shortcutsModal.hidden = false;
      return;
    }

    // g-prefix shortcuts
    if (!inInput && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (e.key === 'g' && !gKeyMode) {
        gKeyMode = true;
        clearTimeout(gKeyTimer);
        gKeyTimer = setTimeout(() => { gKeyMode = false; }, 800);
        return;
      }
      if (gKeyMode) {
        gKeyMode = false; clearTimeout(gKeyTimer);
        if (e.key === 'n') { e.preventDefault(); setActive('notices'); return; }
        if (e.key === 's') { e.preventDefault(); setActive('system'); return; }
        if (e.key === 'b' && !isViewOnly()) { e.preventDefault(); setActive('businesses'); return; }
        if (e.key === ',') { e.preventDefault(); setActive('settings'); return; }
      }
    }

    // Search modal navigation
    if (!searchModal.hidden) {
      const items = $$('.result-item', searchResults);
      if (e.key === 'ArrowDown') { e.preventDefault(); focusedResultIdx = Math.min(items.length - 1, focusedResultIdx + 1); updateFocused(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); focusedResultIdx = Math.max(0, focusedResultIdx - 1); updateFocused(); }
      if (e.key === 'Enter' && items[focusedResultIdx]) { e.preventDefault(); items[focusedResultIdx].click(); }
    }
  });

  function toggleTheme() {
    const order = ['auto','light','dark'];
    const next = order[(order.indexOf(app.dataset.theme) + 1) % order.length];
    app.dataset.theme = next; persistAll(); applyPerBizTheme(); toast('Theme: ' + next);
    const cur = state.history[state.history.length-1]?.split(':')[0];
    if (cur === 'settings') { state.history.pop(); setActive('settings','fade'); }
  }

  // Shortcuts close
  $('#shortcuts-close').onclick = () => shortcutsModal.hidden = true;
  shortcutsModal.onclick = e => { if (e.target === shortcutsModal) shortcutsModal.hidden = true; };

  // ---------- Modal helpers ----------
  function openModal(html) {
    modalContent.innerHTML = html;
    modal.hidden = false;
    // Close on backdrop click — but only if the press STARTED on the backdrop too.
    // This prevents a text-selection drag that ends on the backdrop from closing the modal.
    let downOnBackdrop = false;
    modal.onmousedown = e => { downOnBackdrop = (e.target === modal); };
    modal.ontouchstart = e => { downOnBackdrop = (e.target === modal); };
    modal.onclick = e => { if (e.target === modal && downOnBackdrop) modal.hidden = true; downOnBackdrop = false; };
  }
  function closeModal() { modal.hidden = true; }

  // In-app confirmation dialog. Replaces all native confirm() calls.
  // opts: { title, message, confirmLabel, cancelLabel, danger, requireTwice, typeToConfirm, typeToConfirmLabel, onConfirm }
  // typeToConfirm: a string the user must type exactly (e.g. an email) to enable the confirm button.
  function confirmAction(opts) {
    const danger = opts.danger !== false;
    const confirmLabel = opts.confirmLabel || (danger ? 'Delete' : 'Confirm');
    const cancelLabel = opts.cancelLabel || 'Cancel';
    const needsType = !!opts.typeToConfirm;
    const typeLabel = opts.typeToConfirmLabel || `Type "${opts.typeToConfirm}" to confirm`;
    openModal(`
      <div class="modal-head"><h3>${esc(opts.title || 'Confirm')}</h3><button id="m-close" class="btn-icon"><i class="ti ti-x"></i></button></div>
      <div class="modal-body">
        <div style="font-size:14px;line-height:1.6;color:var(--text-primary);">${esc(opts.message || '')}</div>
        ${needsType ? `
          <div class="field" style="margin-top:14px;">
            <label style="font-size:12px;color:var(--text-secondary);">${esc(typeLabel)}</label>
            <input id="cf-type" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${esc(opts.typeToConfirm)}" style="font-family:var(--font-mono);"/>
          </div>` : ''}
        ${opts.requireTwice && !needsType ? '<div class="info-banner" style="margin-top:14px;background:var(--danger-bg);color:var(--danger-fg);"><i class="ti ti-alert-triangle"></i><span>This action requires a second confirmation.</span></div>' : ''}
      </div>
      <div class="modal-foot"><button class="btn-outline" id="cf-cancel">${esc(cancelLabel)}</button><button class="${danger ? 'btn-danger' : 'btn-primary'}" id="cf-ok" ${needsType ? 'disabled' : ''}>${esc(confirmLabel)}</button></div>
    `);
    $('#m-close').onclick = closeModal;
    $('#cf-cancel').onclick = closeModal;
    if (needsType) {
      const typeInp = $('#cf-type');
      const okBtn = $('#cf-ok');
      const target = String(opts.typeToConfirm).trim().toLowerCase();
      typeInp.oninput = () => {
        const match = typeInp.value.trim().toLowerCase() === target;
        okBtn.disabled = !match;
      };
      setTimeout(() => typeInp.focus(), 50);
    }
    $('#cf-ok').onclick = () => {
      if (needsType) {
        const v = ($('#cf-type')?.value || '').trim().toLowerCase();
        if (v !== String(opts.typeToConfirm).trim().toLowerCase()) return;
      }
      closeModal();
      if (opts.requireTwice && !needsType) {
        // Open second confirmation after a tick
        setTimeout(() => {
          openModal(`
            <div class="modal-head"><h3>${esc(opts.title2 || 'Are you absolutely sure?')}</h3><button id="m-close" class="btn-icon"><i class="ti ti-x"></i></button></div>
            <div class="modal-body">
              <div class="info-banner" style="background:var(--danger-bg);color:var(--danger-fg);"><i class="ti ti-alert-triangle"></i><span><strong>Final confirmation:</strong> ${esc(opts.message2 || opts.message || 'This cannot be undone.')}</span></div>
            </div>
            <div class="modal-foot"><button class="btn-outline" id="cf-cancel">${esc(cancelLabel)}</button><button class="btn-danger" id="cf-ok">${esc(opts.confirmLabel2 || 'Delete permanently')}</button></div>
          `);
          $('#m-close').onclick = closeModal;
          $('#cf-cancel').onclick = closeModal;
          $('#cf-ok').onclick = () => { closeModal(); try { opts.onConfirm && opts.onConfirm(); } catch (e) { console.error(e); } };
        }, 60);
      } else {
        try { opts.onConfirm && opts.onConfirm(); } catch (e) { console.error(e); }
      }
    };
  }

  // ---------- Icon picker ----------
  $('#icon-picker-close').onclick = () => iconPickerEl.hidden = true;
  let iconDownOnBackdrop = false;
  iconPickerEl.onmousedown = e => { iconDownOnBackdrop = (e.target === iconPickerEl); };
  iconPickerEl.ontouchstart = e => { iconDownOnBackdrop = (e.target === iconPickerEl); };
  iconPickerEl.onclick = e => { if (e.target === iconPickerEl && iconDownOnBackdrop) iconPickerEl.hidden = true; iconDownOnBackdrop = false; };
  function openIconPicker(current, callback) {
    iconPickerEl.hidden = false;
    const grid = $('#icon-grid');
    const search = $('#icon-search');
    search.value = '';
    function renderG(filter) {
      const all = window.__InfosIcons?.names || [];
      const list = filter ? all.filter(n => n.includes(filter.toLowerCase())) : all;
      grid.innerHTML = list.map(n => `<div class="icon-cell ${n === current ? 'selected' : ''}" data-icon="${n}" title="${n}"><i class="ti ti-${n}"></i></div>`).join('');
      $$('.icon-cell', grid).forEach(el => el.onclick = () => { iconPickerEl.hidden = true; callback(el.dataset.icon); });
    }
    renderG('');
    search.oninput = e => renderG(e.target.value.trim());
    setTimeout(() => search.focus(), 50);
  }

  // ---------- Business modal ----------
  // Automatically set up SHARED ACCESS for a business: register its cloud row,
  // ensure the team login (hidden Supabase account) exists, and push the current
  // slice to the shared row. Called silently after saving a business (when cloud
  // is configured). Safe to call repeatedly — idempotent on the member account.
  async function autoShareBusiness(b, plainPw) {
    if (!b || !window.InfosSupabase || !window.InfosSupabase.configured()) return;
    let pwPlain = plainPw || b.password || '';
    if (!b.email || !pwPlain) return; // need both to create the login
    try {
      const existingCloudId = (state.bizCloudMap && state.bizCloudMap[b.id]) || null;
      const cloudId = await window.InfosSupabase.adapter.ensureSharedBusiness({ cloudId: existingCloudId, name: b.name, color: b.color });
      if (!state.bizCloudMap) state.bizCloudMap = {};
      state.bizCloudMap[b.id] = cloudId;
      // Create OR update the hidden member account. create-member is idempotent:
      // if it already exists it UPDATES the password to the current one, so
      // re-saving the business password actually takes effect (fixes stale
      // "incorrect email or password"). Let real errors propagate to the catch.
      const allowed = (state.bizAllowedTabs && state.bizAllowedTabs[b.id]) || Object.keys(state.items);
      await window.InfosSupabase.Auth.createMember(cloudId, b.email, pwPlain, allowed);
      // Push the current shared slice so the business login has live data to load.
      const Slice = window.InfosSharedSlice;
      const slice = Slice.buildSharedSlice(state, b.id, cloudId);
      const expected = (state.bizCloudVersions && state.bizCloudVersions[cloudId]) || 0;
      const v = await window.InfosSupabase.adapter.saveSharedState(cloudId, slice, expected);
      if (!state.bizCloudVersions) state.bizCloudVersions = {};
      state.bizCloudVersions[cloudId] = v;
      persistAll();
      state.__cloudShareOk = true;
      // Start (or restart) the owner's live subscription to this business's shared
      // row NOW, so business-login entries appear in real time without the owner
      // needing to reload. Without this, a business shared mid-session had no live
      // subscription until the next app boot.
      try { startOwnerSharedSync(); } catch {}
    } catch (e) {
      console.warn('autoShareBusiness error:', e);
      // Surface the failure — otherwise sharing silently no-ops and the business
      // login never receives data, with no clue why. The most common cause is the
      // shared-access SQL schema not being applied to the deployed database.
      const msg = String(e && e.message || e || '');
      const schemaLikely = /relation|does not exist|schema|businesses|shared_state|business_members|404|Not Found|PGRST/i.test(msg);
      state.__cloudShareErr = schemaLikely
        ? 'Cloud sharing isn’t set up on the server yet (database schema not applied), so this business can’t sync to its login yet. Your local data is safe.'
        : ('Couldn’t set up cloud sharing for this business: ' + msg);
      // Make this impossible to miss — if the login can't be created, signing in
      // as the business will fail with "incorrect email or password", which is
      // confusing. Tell the owner explicitly.
      try {
        if (typeof confirmAction === 'function') {
          confirmAction({
            title: 'Business login not set up',
            message: state.__cloudShareErr + (schemaLikely
              ? '\n\nUntil this is fixed, signing in with the business email/password will say “incorrect email or password,” because the login account couldn’t be created.'
              : ''),
            confirmLabel: 'OK',
            onConfirm: () => {}
          });
        } else { toast(state.__cloudShareErr); }
      } catch { try { toast(state.__cloudShareErr); } catch {} }
      // Non-fatal: local data is intact; will retry on next save.
    }
  }

  // Explicit "Share with team" action: set up SHARED EDITING for a business so
  // the team can sign in on their own devices and get the FULL app on the SAME
  // live data (not view-only). Registers the cloud row, creates the team login,
  // and pushes the current slice.
  async function shareBusinessWithTeam(bizId) {
    const b = bizById(bizId);
    if (!b) return;
    if (!(window.InfosSupabase && window.InfosSupabase.configured())) {
      toast('Cloud is not configured — cannot share.');
      return;
    }
    // Need the business login email + password to create the member account.
    let pwPlain = b.password || '';
    if (!b.email || !pwPlain) {
      toast('Set a business email and password first (in Edit business).');
      return;
    }
    confirmAction({
      title: 'Enable business login',
      message: `This lets "${b.name}" sign in on any device using the email (${b.email}) and password you set. On every device they'll see exactly what you see for this business — live and synced. They can VIEW everything but can't create or manage businesses; they can only add entries on entry tabs (like Balance). Continue?`,
      confirmLabel: 'Enable',
      onConfirm: async () => {
        showFullScreenMessage({ icon: 'ti-cloud-share', title: 'Setting up business login…', message: 'Publishing this business and setting up the login. One moment.', spinner: true });
        try {
          const existingCloudId = (state.bizCloudMap && state.bizCloudMap[bizId]) || null;
          const cloudId = await window.InfosSupabase.adapter.ensureSharedBusiness({ cloudId: existingCloudId, name: b.name, color: b.color });
          if (!state.bizCloudMap) state.bizCloudMap = {};
          state.bizCloudMap[bizId] = cloudId;
          // Create (or refresh) the hidden member account from the business login.
          const allowed = (state.bizAllowedTabs && state.bizAllowedTabs[bizId]) || Object.keys(state.items);
          let memberMsg = '';
          try {
            await window.InfosSupabase.Auth.createMember(cloudId, b.email, pwPlain, allowed);
            memberMsg = 'The business login is ready.';
          } catch (memErr) {
            // Most common: the member already exists from a previous share.
            memberMsg = /already|exists|registered/i.test(String(memErr && memErr.message))
              ? 'The business login already existed (data updated).'
              : 'Set up, but the business login could not be created: ' + (memErr && memErr.message || 'error');
          }
          // Push the current shared slice up.
          const Slice = window.InfosSharedSlice;
          const slice = Slice.buildSharedSlice(state, bizId, cloudId);
          const expected = (state.bizCloudVersions && state.bizCloudVersions[cloudId]) || 0;
          const v = await window.InfosSupabase.adapter.saveSharedState(cloudId, slice, expected);
          if (!state.bizCloudVersions) state.bizCloudVersions = {};
          state.bizCloudVersions[cloudId] = v;
          persistAll();
          const fsm = document.getElementById('fullscreen-message'); if (fsm) fsm.remove();
          confirmAction({
            title: 'Business login enabled',
            message: `"${b.name}" can now be signed in to on any device. ${memberMsg}\n\nSign in with:\nEmail: ${b.email}\nPassword: (the business password you set)\n\nThat login sees this business exactly as you do — view-only, with entries allowed on entry tabs like Balance. It can't create or manage businesses.`,
            confirmLabel: 'Done',
            onConfirm: () => {}
          });
        } catch (e) {
          const fsm = document.getElementById('fullscreen-message'); if (fsm) fsm.remove();
          confirmAction({ title: 'Could not share', message: 'Sharing failed: ' + (e && e.message || 'Unknown error') + '\n\nYour local data is unchanged.', confirmLabel: 'OK', onConfirm: () => {} });
        }
      }
    });
  }

  async function openBusinessModal(editId) {
    if (isViewOnly()) return;
    const editing = editId ? bizById(editId) : null;
    let logoData = editing ? editing.logo : null;
    let chosenColor = editing ? editing.color : BIZ_COLORS[state.businesses.length % BIZ_COLORS.length];

    // If encrypted-and-locked, prompt user to unlock first
    let editingPwPlain = '';
    if (editing) {
      editingPwPlain = editing.password || '';
    }
    openModal(`
      <div class="modal-head"><h3>${editing ? 'Edit business' : 'New business'}</h3><button id="m-close" class="btn-icon" aria-label="Close"><i class="ti ti-x"></i></button></div>
      <div class="modal-body">
        <div style="display:flex;gap:14px;margin-bottom:14px;">
          <div id="logo-upload-zone" class="logo-upload">
            <div id="logo-preview" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;${logoData ? '' : `background:${chosenColor}33;color:${chosenColor};font-size:24px;font-weight:500;`}">${logoData ? `<img src="${logoData}" alt=""/>` : (editing ? esc(editing.name.charAt(0).toUpperCase()) : `<i class="ti ti-photo" style="font-size:22px;color:var(--text-tertiary);"></i>`)}</div>
            <input type="file" id="logo-input" accept="image/*" style="display:none;"/>
          </div>
          <div style="flex:1;">
            <div style="font-size:11px;color:var(--text-secondary);margin-bottom:4px;">Logo (optional)</div>
            <div style="font-size:11px;color:var(--text-tertiary);line-height:1.5;margin-bottom:8px;">PNG, JPG, or SVG. Max 1MB.</div>
            <button id="logo-pick" class="btn-outline btn-sm">Choose file</button>
            ${logoData ? `<button id="logo-clear" class="btn-icon" aria-label="Clear"><i class="ti ti-trash"></i></button>` : ''}
          </div>
        </div>
        <div class="field" style="margin-bottom:10px;"><label>Business name</label><input id="m-name" placeholder="e.g. Acme Corp" value="${editing ? esc(editing.name) : ''}"/></div>
        <div class="field" style="margin-bottom:10px;"><label>Email</label><input id="m-email" type="email" placeholder="team@example.com" value="${editing ? esc(editing.email) : ''}"/></div>
        <div class="field" style="margin-bottom:10px;"><label>Password</label><div class="input-wrap"><input id="m-pw" type="password" value="${editing ? esc(editingPwPlain) : ''}"/><button type="button" class="input-icon-btn" data-pw-eye="m-pw" aria-label="Show password"><i class="ti ti-eye"></i></button></div></div>
        <div class="field" style="margin-bottom:10px;"><label>Confirm password</label><div class="input-wrap"><input id="m-pw2" type="password" value="${editing ? esc(editingPwPlain) : ''}"/><button type="button" class="input-icon-btn" data-pw-eye="m-pw2" aria-label="Show password"><i class="ti ti-eye"></i></button></div></div>
        <div class="field" style="margin-bottom:12px;">
          <label>Brand color</label>
          <div class="color-picker-row">
            <input id="m-color-picker" type="color" value="${chosenColor}" aria-label="Pick a color"/>
            <input id="m-color-hex" type="text" value="${chosenColor}" maxlength="7" placeholder="#3B82F6"/>
          </div>
          <div class="color-swatches" id="m-color-swatches">${BIZ_COLORS.map(c => `<button type="button" class="color-swatch ${chosenColor.toUpperCase() === c.toUpperCase() ? 'selected' : ''}" data-c="${c}" style="background:${c};" aria-label="${c}"></button>`).join('')}</div>
        </div>
        <div id="m-error" class="error-msg" hidden></div>
      </div>
      <div class="modal-foot">
        <button class="btn-outline" id="m-cancel">Cancel</button>
        <button class="btn-primary" id="m-save">${editing ? 'Save' : 'Create'}</button>
      </div>
    `);
    const refreshPreview = () => {
      const prev = $('#logo-preview');
      if (logoData) prev.innerHTML = `<img src="${logoData}" alt=""/>`;
      else { const name = $('#m-name').value.trim(); prev.style.background = chosenColor + '33'; prev.style.color = chosenColor; prev.style.fontSize = '24px'; prev.style.fontWeight = '500'; prev.innerHTML = name ? esc(name.charAt(0).toUpperCase()) : `<i class="ti ti-photo" style="font-size:22px;color:var(--text-tertiary);"></i>`; }
    };
    $('#logo-pick').onclick = () => $('#logo-input').click();
    $('#logo-upload-zone').onclick = () => $('#logo-input').click();
    $('#logo-input').onchange = e => {
      const file = e.target.files[0]; if (!file) return;
      if (file.size > 1024 * 1024) { toast('Image too large (max 1MB)'); return; }
      const reader = new FileReader(); reader.onload = ev => { logoData = ev.target.result; refreshPreview(); }; reader.readAsDataURL(file);
    };
    if ($('#logo-clear')) $('#logo-clear').onclick = () => { logoData = null; refreshPreview(); };
    $('#m-name').oninput = () => { if (!logoData) refreshPreview(); };
    // Color picker (native + hex + swatches)
    const colorPickEl = $('#m-color-picker');
    const colorHexEl = $('#m-color-hex');
    function setColor(c, source) {
      // Normalize to #RRGGBB
      let v = (c || '').trim();
      if (!v) return;
      if (v[0] !== '#') v = '#' + v;
      if (!/^#[0-9a-fA-F]{6}$/.test(v)) {
        // Try 3-char hex like #abc -> #aabbcc
        if (/^#[0-9a-fA-F]{3}$/.test(v)) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
        else return;
      }
      chosenColor = v.toUpperCase();
      if (source !== 'picker' && colorPickEl) colorPickEl.value = chosenColor.toLowerCase();
      if (source !== 'hex' && colorHexEl) colorHexEl.value = chosenColor;
      $$('.color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.c.toUpperCase() === chosenColor));
      if (!logoData) refreshPreview();
    }
    if (colorPickEl) colorPickEl.oninput = e => setColor(e.target.value, 'picker');
    if (colorHexEl) colorHexEl.oninput = e => setColor(e.target.value, 'hex');
    $$('.color-swatch').forEach(el => el.onclick = () => setColor(el.dataset.c, 'swatch'));
    $('#m-close').onclick = closeModal;
    $('#m-cancel').onclick = closeModal;
    $('#m-save').onclick = async () => {
      const name = $('#m-name').value.trim(), email = $('#m-email').value.trim().toLowerCase();
      const pw = $('#m-pw').value, pw2 = $('#m-pw2').value;
      const err = $('#m-error'); const fail = m => { err.textContent = m; err.hidden = false; };
      if (!name) return fail('Enter a business name');
      if (!email.includes('@')) return fail('Enter a valid email');
      if (pw.length < 6) return fail('Password must be at least 6 characters');
      if (pw !== pw2) return fail('Passwords do not match');
      // Email collision checks
      const otherBiz = state.businesses.find(b => b.email.toLowerCase() === email && b.id !== (editing && editing.id));
      if (otherBiz) return fail('Another business is already using this email');
      if ((state.accounts || []).find(a => a.email === email)) return fail('This email is used by an owner account. Use a different email.');
      if (editing) {
        editing.name = name; editing.email = email; editing.color = chosenColor; editing.logo = logoData;
        await bizSetPassword(editing, pw);
        recordActivity(editing, 'edited', 'Business details updated');
      } else {
        const newBiz = { id: 'b' + (state.nextBizId++), name, email, color: chosenColor, logo: logoData, createdAt: Date.now(), tags: [], nextTagId: 1, tabRenames: {}, activity: [] };
        await bizSetPassword(newBiz, pw);
        state.businesses.push(newBiz);
        recordActivity(newBiz, 'created', 'Business created');
      }
      const savedBiz = editing || state.businesses[state.businesses.length - 1];
      closeModal(); buildNav(); updateActiveBizDisplay(); persistAll();
      const cur = state.history[state.history.length-1]?.split(':')[0];
      if (cur === 'businesses' || cur === 'biz-detail') {
        state.history.pop();
        if (cur === 'biz-detail' && editing) setActive('biz-detail','fade',{bizId:editing.id,title:editing.name,sub:editing.email});
        else setActive('businesses','fade');
      }
      toast(editing ? 'Saved' : 'Created'); haptic();
      // Automatically publish this business to the cloud so the team can sign in
      // with its email + password — no separate "Share" step needed. Runs in the
      // background; failures are non-fatal (local data is unaffected).
      if (savedBiz && window.InfosSupabase && window.InfosSupabase.configured() && !state.__sharedMode) {
        autoShareBusiness(savedBiz, pw).catch(e => console.warn('Auto-share failed:', e));
      }
    };
  }

  // ---------- Template chooser (deprecated in v10 — kept only for createBusinessFromTemplate) ----------

  async function createBusinessFromTemplate(tplId) {
    const tpl = state.templates.find(t => t.id === tplId);
    if (!tpl) return;
    const newBiz = {
      id: 'b' + (state.nextBizId++),
      name: tpl.name + ' (rename me)',
      email: 'team@example.com',
      color: tpl.biz.color,
      logo: null,
      createdAt: Date.now(),
      tags: tpl.biz.tags.map((t, i) => ({ id: 't' + (i + 1), name: t, color: BIZ_COLORS[i % BIZ_COLORS.length] })),
      nextTagId: tpl.biz.tags.length + 1,
      tabRenames: {},
      activity: [{ id: 'a' + Date.now(), ts: Date.now(), action: 'created', label: `Created from template: ${tpl.name}` }]
    };
    await bizSetPassword(newBiz, 'changeme');
    state.businesses.push(newBiz);
    (tpl.starters || []).forEach(s => {
      const tab = s.tab;
      if (!state.items[tab]) state.items[tab] = [];
      const obj = { id: 'x' + (state.nextItemId++), bizId: newBiz.id, tagIds: [], pinned: false, notes: '', attachments: [], history: [{ ts: Date.now(), action: 'created' }] };
      Object.assign(obj, s);
      delete obj.tab;
      state.items[tab].push(obj);
    });
    persistAll(); buildNav();
    toast(`Created "${newBiz.name}" — edit details next`);
    setActive('biz-detail', 'right', { bizId: newBiz.id, title: newBiz.name, sub: newBiz.email });
    setTimeout(() => openBusinessModal(newBiz.id), 200);
    haptic();
  }

  // ---------- Item modal ----------
  // Item shapes:
  // notices:       title, message, link
  // games:         name, shortName, link, description
  // idpass-system: name, shortName, link, description
  // idpass-accounts: name, shortName, link, description
  // custom:        title, message, link  (notice-style)
  function fieldsFor(tabKey) {
    if (tabKey === 'notices') return [
      { k: 'title', lbl: 'Title', required: true },
      { k: 'message', lbl: 'Message', type: 'textarea', required: true },
      { k: 'link', lbl: 'Link (optional)', type: 'url', placeholder: 'https://…' }
    ];
    // ID & Pass tabs: include username + password (both copyable)
    if (tabKey === 'idpass-system' || tabKey === 'idpass-accounts') return [
      { k: 'name', lbl: 'Name', required: true },
      { k: 'shortName', lbl: 'Short name (optional)' },
      { k: 'username', lbl: 'Username', placeholder: 'user@example.com', copyable: true },
      { k: 'password', lbl: 'Password', type: 'password', copyable: true },
      { k: 'description', lbl: 'Description (optional)', type: 'textarea' }
    ];
    // Attachments: photo-only (one image — e.g. a schedule, document, signage, anything)
    if (tabKey === 'schedule') return [
      { k: 'title', lbl: 'Title', required: true, placeholder: 'e.g. October roster' },
      { k: 'photo', lbl: 'Attachment', type: 'photo', required: true },
      { k: 'description', lbl: 'Notes (optional)', type: 'textarea' }
    ];
    // Custom tabs: same shape plus an optional photo
    const isCustomTab = state.customTabs.some(t => t.id === tabKey);
    if (isCustomTab) return [
      { k: 'name', lbl: 'Name', required: true },
      { k: 'shortName', lbl: 'Short name (optional)' },
      { k: 'photo', lbl: 'Picture (optional)', type: 'photo' },
      { k: 'link', lbl: 'Link (optional)', type: 'url', placeholder: 'https://…' },
      { k: 'description', lbl: 'Description (optional)', type: 'textarea' }
    ];
    // System / Games: shared shape
    return [
      { k: 'name', lbl: 'Name', required: true },
      { k: 'shortName', lbl: 'Short name (optional)' },
      { k: 'link', lbl: 'Link (optional)', type: 'url', placeholder: 'https://…' },
      { k: 'description', lbl: 'Description (optional)', type: 'textarea' }
    ];
  }

  function openItemModal(tabKey, editId) {
    if (isViewOnly()) return;
    const editing = editId ? state.items[tabKey].find(i => i.id === editId) : null;
    const fields = fieldsFor(tabKey);
    const hasBusinesses = state.businesses.length > 0;

    // Item can now be assigned to multiple businesses (bizIds array).
    // Backward-compat: if old single bizId exists, treat as single-element array.
    let chosenBizIds = editing ? (editing.bizIds ? [...editing.bizIds] : (editing.bizId ? [editing.bizId] : [])) :
                                 (state.activeBizId && state.activeBizId !== 'all' && state.activeBizId !== 'none' ? [state.activeBizId] : []);
    let chosenTagIds = editing ? [...(editing.tagIds || [])] : (state.activeTagId ? [state.activeTagId] : []);
    // Items are assigned to BUSINESSES only — there is no "assign to myself"
    // concept. (assignSelf is kept internally as always-false so existing save
    // logic that references it still works, but it is never shown or set.)
    let assignSelf = false;

    function renderBizAssign() {
      const wrap = $('#if-biz');
      if (!wrap) return;
      const allSelected = chosenBizIds.length === state.businesses.length && state.businesses.length > 0;
      wrap.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
          ${state.businesses.map(b => {
            const sel = chosenBizIds.includes(b.id);
            return `<span class="assign-pill ${sel ? 'selected' : ''}" data-bid="${b.id}"><span class="biz-color-dot" style="background:${b.color}"></span>${esc(b.name)}${sel ? ' <i class="ti ti-check" style="font-size:11px;"></i>' : ''}</span>`;
          }).join('')}
        </div>
        ${state.businesses.length ? `<button type="button" class="btn-outline btn-sm" id="if-assign-all">${allSelected ? 'Unassign all businesses' : 'Assign to all businesses'}</button>` : ''}
      `;
      wrap.querySelectorAll('[data-bid]').forEach(el => el.onclick = () => {
        const id = el.dataset.bid;
        if (chosenBizIds.includes(id)) chosenBizIds = chosenBizIds.filter(x => x !== id);
        else chosenBizIds.push(id);
        // Tags only apply if exactly one business selected
        if (chosenBizIds.length !== 1) chosenTagIds = [];
        renderBizAssign(); renderTags();
      });
      const allBtn = $('#if-assign-all');
      if (allBtn) allBtn.onclick = () => {
        if (allSelected) chosenBizIds = [];
        else chosenBizIds = state.businesses.map(b => b.id);
        chosenTagIds = [];
        renderBizAssign(); renderTags();
      };
    }
    function renderTags() {
      const wrap = $('#if-tags-wrap');
      if (!wrap) return;
      // Only show tag selector if exactly one business is selected AND that business has tags
      if (chosenBizIds.length !== 1) { wrap.style.display = 'none'; return; }
      const b = bizById(chosenBizIds[0]);
      if (!b || !b.tags.length) { wrap.style.display = 'none'; return; }
      wrap.style.display = '';
      const isDark = isAppDark();
      $('#if-tags').innerHTML = b.tags.map(t => {
        const sel = chosenTagIds.includes(t.id);
        const bg = sel ? t.color + (isDark ? '44' : '22') : 'var(--surface-1)';
        const fg = sel ? t.color : 'var(--text-primary)';
        return `<span class="assign-pill" data-tag="${t.id}" style="background:${bg};color:${fg};border-color:${sel ? t.color : 'transparent'};"><span class="biz-color-dot" style="background:${t.color}"></span>${esc(t.name)}</span>`;
      }).join('');
      $('#if-tags').querySelectorAll('.assign-pill').forEach(el => el.onclick = () => {
        const tid = el.dataset.tag;
        if (chosenTagIds.includes(tid)) chosenTagIds = chosenTagIds.filter(x => x !== tid);
        else chosenTagIds.push(tid);
        renderTags();
      });
    }

    function fieldInput(f) {
      const rawVal = editing ? (editing[f.k] || '') : '';
      const val = esc(rawVal);
      if (f.type === 'textarea') {
        return `<textarea id="if-${f.k}" placeholder="${esc(f.placeholder || f.lbl)}" rows="3">${val}</textarea>`;
      }
      if (f.type === 'password') {
        return `<div class="input-wrap"><input id="if-${f.k}" type="password" placeholder="${esc(f.placeholder || f.lbl)}" value="${val}" autocomplete="off"/><button type="button" class="input-icon-btn" data-pw-toggle="if-${f.k}"><i class="ti ti-eye"></i></button></div>`;
      }
      if (f.type === 'photo') {
        const existing = editing?.[f.k];
        return `<div class="photo-picker" id="if-${f.k}-wrap">
          ${existing ? `<div class="photo-preview"><img src="${existing}" alt="Attachment"/><button type="button" class="btn-icon photo-remove" id="if-${f.k}-remove" aria-label="Remove"><i class="ti ti-x"></i></button></div>` : ''}
          <input type="file" id="if-${f.k}-file" accept="image/*" style="display:none;"/>
          <button type="button" class="btn-outline btn-block" id="if-${f.k}-btn"><i class="ti ti-camera" style="font-size:14px;vertical-align:-2px;margin-right:8px;"></i>${existing ? 'Replace photo' : 'Choose photo'}</button>
          <input type="hidden" id="if-${f.k}" value="${existing ? esc(existing) : ''}"/>
        </div>`;
      }
      const type = f.type || 'text';
      return `<input id="if-${f.k}" type="${type}" placeholder="${esc(f.placeholder || f.lbl)}" value="${val}"/>`;
    }

    openModal(`
      <div class="modal-head"><h3>${editing ? 'Edit' : 'Add'} ${esc(tabDisp(tabKey).name)}</h3><button id="m-close" class="btn-icon" aria-label="Close"><i class="ti ti-x"></i></button></div>
      <div class="modal-body">
        ${fields.map(f => `<div class="field" style="margin-bottom:12px;"><label>${esc(f.lbl)}${f.required ? ' <span style="color:var(--danger-fg);">*</span>' : ''}</label>${fieldInput(f)}</div>`).join('')}
        ${hasBusinesses ? `<div class="field" style="margin-bottom:12px;"><label>Assign to business${state.businesses.length === 1 ? '' : 'es'}</label><div id="if-biz"></div></div>` : '<div class="info-pill" style="margin-bottom:12px;font-size:12px;">No businesses yet. Create one to assign items.</div>'}
        <div class="field" id="if-tags-wrap" style="display:none;"><label>Tags</label><div id="if-tags" style="display:flex;flex-wrap:wrap;gap:6px;"></div></div>
      </div>
      <div class="modal-foot ${editing ? 'between' : ''}">${editing ? `<button class="btn-danger" id="m-delete"><i class="ti ti-trash" style="font-size:13px;vertical-align:-2px;"></i> Delete</button>` : ''}<div style="display:flex;gap:8px;"><button class="btn-outline" id="m-cancel">Cancel</button><button class="btn-primary" id="m-save">${editing ? 'Save' : 'Add'}</button></div></div>
    `);
    if (hasBusinesses) { renderBizAssign(); renderTags(); }
    $('#m-close').onclick = closeModal;
    $('#m-cancel').onclick = closeModal;
    // Password show/hide toggles
    document.querySelectorAll('[data-pw-toggle]').forEach(btn => btn.onclick = () => {
      const target = document.getElementById(btn.dataset.pwToggle);
      if (!target) return;
      const isPw = target.type === 'password';
      target.type = isPw ? 'text' : 'password';
      btn.innerHTML = `<i class="ti ${isPw ? 'ti-eye-off' : 'ti-eye'}"></i>`;
      window.__InfosIcons?.replaceIcons(btn);
    });
    // Photo upload handler (Attachments tab)
    fields.filter(f => f.type === 'photo').forEach(f => {
      const btn = document.getElementById(`if-${f.k}-btn`);
      const fileInp = document.getElementById(`if-${f.k}-file`);
      const hidden = document.getElementById(`if-${f.k}`);
      const removeBtn = document.getElementById(`if-${f.k}-remove`);
      if (btn) btn.onclick = () => fileInp.click();
      if (fileInp) fileInp.onchange = e => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.size > 3 * 1024 * 1024) { toast('Photo too large (max 3 MB)'); return; }
        const reader = new FileReader();
        reader.onload = ev => {
          hidden.value = ev.target.result;
          // Re-render the modal so the preview appears
          const wrap = document.getElementById(`if-${f.k}-wrap`);
          if (wrap) {
            wrap.innerHTML = `<div class="photo-preview"><img src="${ev.target.result}" alt="Attachment"/><button type="button" class="btn-icon photo-remove" id="if-${f.k}-remove" aria-label="Remove"><i class="ti ti-x"></i></button></div>
              <input type="file" id="if-${f.k}-file" accept="image/*" style="display:none;"/>
              <button type="button" class="btn-outline btn-block" id="if-${f.k}-btn"><i class="ti ti-camera" style="font-size:14px;vertical-align:-2px;margin-right:8px;"></i>Replace photo</button>
              <input type="hidden" id="if-${f.k}" value="${ev.target.result}"/>`;
            window.__InfosIcons?.replaceIcons(wrap);
            // Re-bind handlers
            const newBtn = document.getElementById(`if-${f.k}-btn`);
            const newFile = document.getElementById(`if-${f.k}-file`);
            const newRm = document.getElementById(`if-${f.k}-remove`);
            const newHidden = document.getElementById(`if-${f.k}`);
            if (newBtn) newBtn.onclick = () => newFile.click();
            if (newFile) newFile.onchange = fileInp.onchange;
            if (newRm) newRm.onclick = () => {
              newHidden.value = '';
              wrap.innerHTML = `<input type="file" id="if-${f.k}-file" accept="image/*" style="display:none;"/>
                <button type="button" class="btn-outline btn-block" id="if-${f.k}-btn"><i class="ti ti-camera" style="font-size:14px;vertical-align:-2px;margin-right:8px;"></i>Choose photo</button>
                <input type="hidden" id="if-${f.k}" value=""/>`;
              window.__InfosIcons?.replaceIcons(wrap);
              const fb = document.getElementById(`if-${f.k}-btn`); const ff = document.getElementById(`if-${f.k}-file`);
              if (fb) fb.onclick = () => ff.click();
              if (ff) ff.onchange = fileInp.onchange;
            };
          }
        };
        reader.readAsDataURL(file);
      };
      if (removeBtn) removeBtn.onclick = () => {
        hidden.value = '';
        const wrap = document.getElementById(`if-${f.k}-wrap`);
        if (wrap) {
          wrap.innerHTML = `<input type="file" id="if-${f.k}-file" accept="image/*" style="display:none;"/>
            <button type="button" class="btn-outline btn-block" id="if-${f.k}-btn"><i class="ti ti-camera" style="font-size:14px;vertical-align:-2px;margin-right:8px;"></i>Choose photo</button>
            <input type="hidden" id="if-${f.k}" value=""/>`;
          window.__InfosIcons?.replaceIcons(wrap);
          const fb = document.getElementById(`if-${f.k}-btn`); const ff = document.getElementById(`if-${f.k}-file`);
          if (fb) fb.onclick = () => ff.click();
          if (ff) ff.onchange = fileInp.onchange;
        }
      };
    });
    $('#m-save').onclick = () => {
      const values = {};
      fields.forEach(f => values[f.k] = $('#if-' + f.k).value.trim());
      const missing = fields.filter(f => f.required && !values[f.k]);
      if (missing.length) { toast(`${missing[0].lbl} is required`); return; }
      // Require a business assignment (notices are the global feed, exempt). If
      // the owner has no businesses yet, the item is simply unassigned.
      let effectiveAssignSelf = false;
      if (tabKey !== 'notices' && state.businesses.length > 0 && chosenBizIds.length === 0) {
        toast('Assign this to a business');
        return;
      }
      const wasNew = !editing;
      const now = Date.now();
      const obj = editing || { id: 'x' + (state.nextItemId++), pinned: false, notes: '', attachments: [], history: [], createdAt: now };
      Object.assign(obj, values);
      // Always store bizIds as the canonical array
      obj.bizIds = [...chosenBizIds];
      obj.ownerAssigned = !!effectiveAssignSelf;
      delete obj.bizId; // drop legacy field
      obj.tagIds = chosenTagIds;
      if (wasNew) { obj.createdAt = now; obj.updatedAt = now; }
      else obj.updatedAt = now;
      if (tabKey === 'notices' && !obj.icon) { obj.icon = 'info-circle'; obj.tone = 'info'; }
      if (wasNew) { if (!state.items[tabKey]) state.items[tabKey] = []; state.items[tabKey].push(obj); recordHistory(obj, 'created'); }
      else recordHistory(obj, 'edited');
      // v15: cross-tab activity feed (for Notices → Activity Log)
      recordGlobalActivity(tabKey, wasNew ? 'created' : 'edited', obj);
      // Play a distinct chime when YOU add a new entry: balance has its own
      // sound; all other tabs share the self-entry sound.
      if (wasNew) {
        if (tabKey === 'balance') playBalanceSound();
        else playSelfEntrySound();
      }
      // Activity log on each assigned business
      chosenBizIds.forEach(bid => {
        recordActivity(bizById(bid), wasNew ? 'added' : 'edited', `${wasNew ? 'Added' : 'Edited'} ${tabDisp(tabKey).name.toLowerCase()}: ${obj.title || obj.name}`);
      });
      closeModal(); persistAll();
      const cur = state.history[state.history.length-1]?.split(':')[0];
      // v14: if the user is in the idpass seg-tab UI and we just saved to idpass-system/accounts,
      // re-render the idpass overview so the new card appears.
      if ((tabKey === 'idpass-system' || tabKey === 'idpass-accounts') && cur === 'idpass') {
        state.idpassSubtab = tabKey;
        state.history.pop(); setActive('idpass', 'fade');
      } else if (cur === tabKey) {
        state.history.pop(); setActive(tabKey, 'fade');
      } else if (cur === 'item-detail') {
        const editedId = editing ? editing.id : null;
        if (editedId) {
          const newTitle = editing.title || editing.name || 'Item';
          state.history.pop();
          setActive('item-detail', 'fade', { itemTab: tabKey, itemId: editedId, title: newTitle });
        }
      }
      updateBadges();
      toast(wasNew ? 'Added' : 'Saved'); haptic();
    };
    if (editing) $('#m-delete').onclick = () => {
      confirmAction({
        title: 'Move to trash?',
        message: 'You can restore this item within 30 days.',
        confirmLabel: 'Move to trash',
        danger: true,
        onConfirm: () => {
          editing.deleted = true; editing.deletedAt = Date.now(); editing.deletedFromTab = tabKey;
          recordHistory(editing, 'trashed');
          recordGlobalActivity(tabKey, 'trashed', editing);
          itemBizIds(editing).forEach(bid => recordActivity(bizById(bid), 'deleted', `Trashed: ${editing.title || editing.name}`));
          closeModal(); persistAll();
          const cur = state.history[state.history.length-1]?.split(':')[0];
          if (cur === tabKey) { state.history.pop(); setActive(tabKey, 'fade'); }
          else if (cur === 'item-detail') goBack();
          updateBadges(); buildNav();
          toast('Moved to trash'); haptic();
        }
      });
    };
  }

  // ---------- Tag modal ----------
  function openTagModal(bizId, editTagId) {
    if (isViewOnly()) return;
    const b = bizById(bizId); if (!b) return;
    if (!b.nextTagId) b.nextTagId = b.tags.length + 1;
    const editing = editTagId ? b.tags.find(t => t.id === editTagId) : null;
    let chosenColor = editing ? editing.color : BIZ_COLORS[b.tags.length % BIZ_COLORS.length];
    openModal(`
      <div class="modal-head"><h3>${editing ? 'Edit tag' : 'New tag'}</h3><button id="m-close" class="btn-icon"><i class="ti ti-x"></i></button></div>
      <div class="modal-body">
        <div class="field" style="margin-bottom:12px;"><label>Tag name</label><input id="t-name" placeholder="e.g. Engineering" value="${editing ? esc(editing.name) : ''}"/></div>
        <div class="field"><label>Color</label><div class="color-row">${BIZ_COLORS.map(c => `<div class="color-swatch t-color" data-c="${c}" style="background:${c};${chosenColor === c ? 'border-color:var(--text-primary);' : ''}"></div>`).join('')}</div></div>
      </div>
      <div class="modal-foot ${editing ? 'between' : ''}">${editing ? `<button class="btn-danger" id="t-delete">Delete</button>` : ''}<div style="display:flex;gap:8px;"><button class="btn-outline" id="m-cancel">Cancel</button><button class="btn-primary" id="t-save">${editing ? 'Save' : 'Create'}</button></div></div>
    `);
    $$('.t-color').forEach(el => el.onclick = () => { chosenColor = el.dataset.c; $$('.t-color').forEach(x => x.style.borderColor = 'transparent'); el.style.borderColor = 'var(--text-primary)'; });
    $('#m-close').onclick = closeModal;
    $('#m-cancel').onclick = closeModal;
    $('#t-save').onclick = () => {
      const name = $('#t-name').value.trim();
      if (!name) { toast('Enter a tag name'); return; }
      if (editing) { editing.name = name; editing.color = chosenColor; }
      else { b.tags.push({ id: 't' + (b.nextTagId++), name, color: chosenColor }); }
      recordActivity(b, editing ? 'edited' : 'added', `${editing ? 'Edited' : 'Added'} tag: ${name}`);
      closeModal(); persistAll();
      const cur = state.history[state.history.length-1];
      if (cur && cur.startsWith('biz-detail')) { state.history.pop(); setActive('biz-detail','fade',{bizId:b.id,title:b.name,sub:b.email}); }
      toast(editing ? 'Saved' : 'Created'); haptic();
    };
    if (editing) $('#t-delete').onclick = () => {
      confirmAction({
        title: 'Delete tag?',
        message: `"${editing.name}" will be removed from all items it's assigned to.`,
        confirmLabel: 'Delete',
        onConfirm: () => {
          b.tags = b.tags.filter(t => t.id !== editing.id);
          Object.values(state.items).flat().forEach(it => { if (it.tagIds) it.tagIds = it.tagIds.filter(tid => tid !== editing.id); });
          closeModal(); persistAll();
          state.history.pop(); setActive('biz-detail','fade',{bizId:b.id,title:b.name,sub:b.email});
          toast('Tag deleted');
        }
      });
    };
  }

  // ---------- Custom tab delete (shared by modal + management header) ----------
  function deleteCustomTab(id) {
    state.customTabs = state.customTabs.filter(t => t.id !== id);
    delete state.items[id];
    state.tabOrder = state.tabOrder.filter(k => k !== id);
    if (state.globalRenames) delete state.globalRenames[id];
    if (state.bizAllowedTabs) {
      Object.keys(state.bizAllowedTabs).forEach(bid => {
        state.bizAllowedTabs[bid] = state.bizAllowedTabs[bid].filter(k => k !== id);
      });
    }
    if (state.bizTabOrder) {
      Object.keys(state.bizTabOrder).forEach(bid => {
        state.bizTabOrder[bid] = state.bizTabOrder[bid].filter(k => k !== id);
      });
    }
    if (state.itemOrder) {
      Object.keys(state.itemOrder).forEach(bid => {
        if (state.itemOrder[bid] && state.itemOrder[bid][id]) delete state.itemOrder[bid][id];
      });
    }
    // Also remove any per-business tabRenames for this tab
    (state.businesses || []).forEach(b => { if (b.tabRenames) delete b.tabRenames[id]; });
    if (state.currentTab === id) state.currentTab = 'notices';
    buildNav(); persistAll();
  }

  // ---------- Custom tab modal ----------
  function openTabModal(editTabId) {
    if (isViewOnly()) return;
    const ct = editTabId ? state.customTabs.find(t => t.id === editTabId) : null;
    let chosenIcon = ct ? ct.icon : 'star';
    openModal(`
      <div class="modal-head"><h3>${ct ? 'Edit tab' : 'New custom tab'}</h3><button id="m-close" class="btn-icon"><i class="ti ti-x"></i></button></div>
      <div class="modal-body">
        <div style="display:flex;gap:12px;align-items:flex-end;margin-bottom:12px;">
          <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px;">Icon</label><button id="tab-icon-btn" class="btn-outline" style="width:44px;height:42px;padding:0;display:flex;align-items:center;justify-content:center;"><i class="ti ti-${chosenIcon}" style="font-size:18px;"></i></button></div>
          <div class="field" style="flex:1;"><label>Tab name</label><input id="ct-name" placeholder="e.g. Invoices" value="${ct ? esc(ct.name) : ''}"/></div>
        </div>
        <div style="font-size:11px;color:var(--text-tertiary);line-height:1.5;">Custom tabs work like Notices or Games. Items can be assigned to businesses and tagged.</div>
      </div>
      <div class="modal-foot ${ct ? 'between' : ''}">${ct ? `<button class="btn-danger" id="ct-delete">Delete</button>` : ''}<div style="display:flex;gap:8px;"><button class="btn-outline" id="m-cancel">Cancel</button><button class="btn-primary" id="ct-save">${ct ? 'Save' : 'Create'}</button></div></div>
    `);
    $('#tab-icon-btn').onclick = () => openIconPicker(chosenIcon, icon => { chosenIcon = icon; $('#tab-icon-btn').innerHTML = `<i class="ti ti-${icon}" style="font-size:18px;"></i>`; });
    $('#m-close').onclick = closeModal;
    $('#m-cancel').onclick = closeModal;
    $('#ct-save').onclick = () => {
      const name = $('#ct-name').value.trim();
      if (!name) { toast('Enter a tab name'); return; }
      if (ct) { ct.name = name; ct.icon = chosenIcon; }
      else { const id = 'ct' + (state.nextTabId++); state.customTabs.push({ id, name, icon: chosenIcon }); state.items[id] = []; }
      closeModal(); buildNav(); persistAll();
      // Re-render whatever page we're on (settings, biz-detail, or the tab itself)
      const entry = state.history[state.history.length-1] || '';
      const cur = entry.split(':')[0];
      if (cur === 'biz-detail') {
        const bizId = entry.split(':')[1];
        const b = bizById(bizId);
        state.history.pop();
        setActive('biz-detail', 'fade', b ? { bizId: b.id, title: b.name, sub: b.email } : {});
      } else if (cur) {
        state.history.pop(); setActive(cur, 'fade');
      }
      toast(ct ? 'Saved' : 'Created'); haptic();
    };
    if (ct) $('#ct-delete').onclick = () => {
      confirmAction({
        title: 'Delete custom tab?',
        message: `Delete tab "${ct.name}" and all its items? This cannot be undone.`,
        danger: true,
        confirmLabel: 'Delete',
        onConfirm: () => {
          deleteCustomTab(ct.id);
          closeModal();
          // Re-render whatever page the user was on (settings, biz-detail, etc.)
          const cur = state.history[state.history.length-1]?.split(':')[0];
          if (cur) { state.history.pop(); setActive(cur, 'fade'); }
          toast('Tab deleted');
        }
      });
    };
  }

  // ---------- E2E encryption modals ----------
  function openCryptoSetupModal() {
    openModal(`
      <div class="modal-head"><h3>Enable encryption</h3><button id="m-close" class="btn-icon"><i class="ti ti-x"></i></button></div>
      <div class="modal-body">
        <div class="info-banner" style="margin-bottom:14px;background:var(--warning-bg);color:var(--warning-fg);"><i class="ti ti-alert-triangle"></i><span><strong>Read carefully:</strong> your master password is never stored. If you forget it, encrypted business passwords are permanently unrecoverable. Write it down somewhere safe.</span></div>
        <div class="field" style="margin-bottom:10px;"><label>Master password</label><input id="mp" type="password" placeholder="At least 8 characters" autocomplete="new-password"/></div>
        <div class="field" style="margin-bottom:10px;"><label>Confirm</label><input id="mp2" type="password" placeholder="Re-enter" autocomplete="new-password"/></div>
        <div id="mp-err" class="error-msg" hidden></div>
      </div>
      <div class="modal-foot"><button class="btn-outline" id="m-cancel">Cancel</button><button class="btn-primary" id="mp-save">Enable</button></div>
    `);
    $('#m-close').onclick = closeModal;
    $('#m-cancel').onclick = closeModal;
    $('#mp-save').onclick = async () => {
      const pw = $('#mp').value, cf = $('#mp2').value;
      const err = $('#mp-err'); const fail = m => { err.textContent = m; err.hidden = false; };
      if (pw.length < 8) return fail('Master password must be at least 8 characters');
      if (pw !== cf) return fail('Passwords do not match');
      try {
        const meta = await window.Crypto.setup(pw);
        state.cryptoMeta = meta;
        // Encrypt all existing business passwords
        for (const b of state.businesses) {
          if (b.password && !b.passwordEnc) {
            b.passwordEnc = await window.Crypto.encrypt(b.password);
            delete b.password;
          }
        }
        persistAll();
        closeModal();
        toast('Encryption enabled');
        state.history.pop(); setActive('settings','fade');
      } catch (e) { fail(e.message); }
    };
    setTimeout(() => $('#mp').focus(), 50);
  }
  function openCryptoUnlockModal() {
    openModal(`
      <div class="modal-head"><h3>Unlock</h3><button id="m-close" class="btn-icon"><i class="ti ti-x"></i></button></div>
      <div class="modal-body">
        <div class="field" style="margin-bottom:10px;"><label>Master password</label><input id="mp" type="password" placeholder="Enter master password" autocomplete="current-password"/></div>
        <div id="mp-err" class="error-msg" hidden></div>
      </div>
      <div class="modal-foot"><button class="btn-outline" id="m-cancel">Cancel</button><button class="btn-primary" id="mp-unlock">Unlock</button></div>
    `);
    $('#m-close').onclick = closeModal;
    $('#m-cancel').onclick = closeModal;
    const run = async () => {
      const pw = $('#mp').value;
      try {
        await window.Crypto.unlock(pw, state.cryptoMeta);
        closeModal();
        toast('Unlocked');
        state.history.pop(); setActive('settings','fade');
      } catch (e) { $('#mp-err').textContent = e.message; $('#mp-err').hidden = false; $('#mp').select(); }
    };
    $('#mp-unlock').onclick = run;
    $('#mp').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    setTimeout(() => $('#mp').focus(), 50);
  }

  // ---------- Rename modal (per-tab) ----------
  function openRenameModal(tabKey, scope) {
    const def = getTabDef(tabKey); if (!def) return;
    const target = scope === 'biz' ? bizById(state.bizContext || state.activeBizId) : null;
    if (scope === 'biz' && target && !target.tabRenames) target.tabRenames = {};
    const cur = scope === 'biz' ? (target?.tabRenames?.[tabKey] || {}) : (state.globalRenames[tabKey] || {});
    let chosenIcon = cur.icon || def.icon;
    const scopeLbl = scope === 'biz' ? `for ${target.name}` : 'globally';
    // Where to return after save: biz scope → that business's detail page; else settings
    const goBack = () => {
      if (scope === 'biz' && target) {
        state.history.pop(); setActive('biz-detail','fade',{bizId:target.id,title:target.name,sub:target.email});
      } else {
        state.history.pop(); setActive('settings','fade');
      }
    };
    openModal(`
      <div class="modal-head"><h3>Rename "${esc(def.name)}" ${esc(scopeLbl)}</h3><button id="m-close" class="btn-icon"><i class="ti ti-x"></i></button></div>
      <div class="modal-body">
        <div style="display:flex;gap:12px;align-items:flex-end;margin-bottom:12px;">
          <div><label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px;">Icon</label><button id="ren-icon-btn" class="btn-outline" style="width:44px;height:42px;padding:0;"><i class="ti ti-${chosenIcon}" style="font-size:18px;"></i></button></div>
          <div class="field" style="flex:1;"><label>Display name</label><input id="ren-name" placeholder="${esc(def.name)}" value="${esc(cur.name || '')}"/></div>
        </div>
        <div style="font-size:11px;color:var(--text-tertiary);line-height:1.5;">Leave empty to use default. ${scope === 'biz' ? `Only affects appearance for ${esc(target.name)}.` : 'Applies everywhere unless a business has its own rename.'}</div>
      </div>
      <div class="modal-foot between">
        <button class="btn-outline" id="ren-reset">Reset</button>
        <div style="display:flex;gap:8px;"><button class="btn-outline" id="m-cancel">Cancel</button><button class="btn-primary" id="ren-save">Save</button></div>
      </div>
    `);
    $('#ren-icon-btn').onclick = () => openIconPicker(chosenIcon, icon => { chosenIcon = icon; $('#ren-icon-btn').innerHTML = `<i class="ti ti-${icon}" style="font-size:18px;"></i>`; });
    $('#m-close').onclick = closeModal;
    $('#m-cancel').onclick = closeModal;
    $('#ren-reset').onclick = () => {
      if (scope === 'biz') { if (target.tabRenames) delete target.tabRenames[tabKey]; } else delete state.globalRenames[tabKey];
      closeModal(); buildNav(); persistAll();
      goBack();
      toast('Reset');
    };
    $('#ren-save').onclick = () => {
      const name = $('#ren-name').value.trim();
      const rec = { name: name || null, icon: chosenIcon !== def.icon ? chosenIcon : null };
      if (!rec.name && !rec.icon) {
        if (scope === 'biz') { if (target.tabRenames) delete target.tabRenames[tabKey]; } else delete state.globalRenames[tabKey];
      } else {
        if (scope === 'biz') { target.tabRenames = target.tabRenames || {}; target.tabRenames[tabKey] = rec; } else state.globalRenames[tabKey] = rec;
      }
      closeModal(); buildNav(); persistAll();
      goBack();
      toast('Saved');
    };
  }

  // ---------- Bulk select ----------
  function toggleBulkMode() {
    state.bulkMode = !state.bulkMode;
    state.bulkSelected.clear();
    bulkBar.hidden = !state.bulkMode;
    updateBulkBar();
    rerenderCurrentTab();
  }
  function exitBulkMode() { if (state.bulkMode) { state.bulkMode = false; state.bulkSelected.clear(); bulkBar.hidden = true; } }
  function updateBulkBar() { $('#bulk-count').textContent = state.bulkSelected.size + ' selected'; }
  // Re-render the current tab in place without going through setActive
  // (which calls exitBulkMode and would undo our state changes).
  function rerenderCurrentTab() {
    const cur = state.currentTab;
    const def = getTabDef(cur);
    if (def && def.render) {
      pageContent.innerHTML = '';
      def.render(pageContent);
      bindChipClicks(pageContent);
    }
  }

  // Re-render the current view (via the given callback) WITHOUT losing the
  // user's scroll position. Used for in-page "Load more / View more / Show less"
  // and inline deletes, so the page doesn't jump to the top and force the user
  // to scroll all the way back down. We snapshot scrollTop, run the re-render,
  // then restore scrollTop on the next frame (after layout settles). We also
  // suppress the slide/fade transition so it doesn't visually flash.
  function rerenderPreservingScroll(doRerender) {
    const prevTop = pageContent ? pageContent.scrollTop : 0;
    const prevBehavior = pageContent ? pageContent.style.scrollBehavior : '';
    if (pageContent) pageContent.style.scrollBehavior = 'auto'; // no smooth-scroll animation
    try { doRerender(); } catch (e) { console.warn('rerenderPreservingScroll failed:', e); }
    // Restore after the new DOM is laid out. rAF twice = after paint, robustly.
    const restore = () => { if (pageContent) pageContent.scrollTop = prevTop; };
    requestAnimationFrame(() => { restore(); requestAnimationFrame(() => {
      restore();
      if (pageContent) pageContent.style.scrollBehavior = prevBehavior;
    }); });
  }
  bulkToggleBtn.onclick = () => toggleBulkMode();
  if (headerSwitchBtn) headerSwitchBtn.onclick = () => { openSwitchAccountPicker(); haptic(); };
  // Hide the header switch button when there's nothing to switch to.
  function refreshHeaderSwitchVisibility() {
    if (!headerSwitchBtn) return;
    // For a business (view-only) login, always offer Switch account in the header
    // top-right — the member needs a way to leave/switch even if no other accounts
    // are saved on this device. For the owner, show it only when there are other
    // saved accounts to switch to.
    if (isViewOnly()) { headerSwitchBtn.hidden = false; return; }
    const accs = (typeof listSwitchableAccounts === 'function') ? listSwitchableAccounts() : [];
    headerSwitchBtn.hidden = accs.length === 0;
  }
  $('#bulk-cancel').onclick = () => toggleBulkMode();
  $('#bulk-all').onclick = () => {
    const list = state.items[state.currentTab] ? filterByBiz(state.items[state.currentTab]) : [];
    if (state.bulkSelected.size === list.length) state.bulkSelected.clear(); else list.forEach(it => state.bulkSelected.add(it.id));
    updateBulkBar(); rerenderCurrentTab();
  };
  $('#bulk-delete').onclick = () => {
    if (!state.bulkSelected.size) return;
    const n = state.bulkSelected.size;
    confirmAction({
      title: `Move ${n} item${n === 1 ? '' : 's'} to trash?`,
      message: 'You can restore them within 30 days.',
      confirmLabel: 'Move to trash',
      onConfirm: () => {
        const tab = state.currentTab;
        (state.items[tab] || []).forEach(it => {
          if (state.bulkSelected.has(it.id)) {
            it.deleted = true; it.deletedAt = Date.now(); it.deletedFromTab = tab;
            recordHistory(it, 'trashed');
            recordGlobalActivity(tab, 'trashed', it);
          }
        });
        toggleBulkMode(); persistAll(); updateBadges(); buildNav();
        toast('Moved to trash');
      }
    });
  };
  $('#bulk-pin').onclick = () => {
    const tab = state.currentTab;
    (state.items[tab] || []).forEach(it => { if (state.bulkSelected.has(it.id)) it.pinned = !it.pinned; });
    toggleBulkMode(); persistAll();
    toast('Pinned state toggled');
  };
  $('#bulk-assign').onclick = () => {
    if (!state.bulkSelected.size) return;
    openBulkAssign();
  };
  $('#bulk-move').onclick = () => {
    if (!state.bulkSelected.size) return;
    openBulkMove();
  };
  // Move selected items to a different tab. Lists every list-type tab except the
  // current one (and except idpass sub-tabs, which have a special structure).
  function openBulkMove() {
    const cur = state.currentTab;
    // Build the set of valid destination tabs: built-in list tabs + custom tabs,
    // excluding the current tab and non-list tabs.
    const builtins = ['notices', 'games', 'system', 'schedule'];
    const dests = [];
    builtins.forEach(k => { if (k !== cur && TAB_DEFS[k]) dests.push({ id: k, name: tabDisp(k).name, icon: tabDisp(k).icon }); });
    (state.customTabs || []).forEach(t => { if (t.id !== cur) dests.push({ id: t.id, name: t.name, icon: t.icon || 'point' }); });
    if (!dests.length) { toast('No other tab to move to'); return; }
    let chosen = '';
    openModal(`
      <div class="modal-head"><h3>Move ${state.bulkSelected.size} item${state.bulkSelected.size === 1 ? '' : 's'}</h3><button id="m-close" class="btn-icon"><i class="ti ti-x"></i></button></div>
      <div class="modal-body">
        <div class="field"><label>Move to tab</label>
          <div id="move-dest" style="display:flex;flex-direction:column;gap:6px;">
            ${dests.map(d => `<button class="move-dest-row" data-dest="${esc(d.id)}"><i class="ti ti-${esc(d.icon)}"></i><span>${esc(d.name)}</span><i class="ti ti-check move-dest-check"></i></button>`).join('')}
          </div>
          <div class="settings-hint" style="margin-top:8px;">Business assignment and tags are kept. Tab-specific fields that don't exist on the destination are preserved but hidden.</div>
        </div>
      </div>
      <div class="modal-foot"><button class="btn-outline" id="m-cancel">Cancel</button><button class="btn-primary" id="m-save" disabled>Move</button></div>
    `);
    const saveBtn = $('#m-save');
    $$('#move-dest .move-dest-row').forEach(el => el.onclick = () => {
      $$('#move-dest .move-dest-row').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected'); chosen = el.dataset.dest;
      saveBtn.disabled = false;
    });
    $('#m-close').onclick = closeModal;
    $('#m-cancel').onclick = closeModal;
    saveBtn.onclick = () => {
      if (!chosen) return;
      const fromTab = state.currentTab;
      const moving = (state.items[fromTab] || []).filter(it => state.bulkSelected.has(it.id));
      if (!moving.length) { closeModal(); return; }
      state.items[chosen] = state.items[chosen] || [];
      moving.forEach(it => {
        state.items[fromTab] = state.items[fromTab].filter(x => x.id !== it.id);
        recordHistory(it, 'moved');
        state.items[chosen].push(it);
      });
      const n = moving.length;
      closeModal(); toggleBulkMode(); persistAll(); updateBadges(); buildNav();
      toast(`Moved ${n} item${n === 1 ? '' : 's'} to ${tabDisp(chosen).name}`);
    };
  }
  function openBulkAssign() {
    let chosenBiz = '';
    openModal(`
      <div class="modal-head"><h3>Assign ${state.bulkSelected.size} item(s)</h3><button id="m-close" class="btn-icon"><i class="ti ti-x"></i></button></div>
      <div class="modal-body">
        <div class="field"><label>Business</label>
          <div id="if-biz" style="display:flex;flex-wrap:wrap;gap:6px;">
            <span class="assign-pill selected" data-id="">Unassigned</span>
            ${state.businesses.map(b => `<span class="assign-pill" data-id="${b.id}"><span class="biz-color-dot" style="background:${b.color}"></span>${esc(b.name)}</span>`).join('')}
          </div>
        </div>
      </div>
      <div class="modal-foot"><button class="btn-outline" id="m-cancel">Cancel</button><button class="btn-primary" id="m-save">Apply</button></div>
    `);
    $$('#if-biz .assign-pill').forEach(el => el.onclick = () => {
      $$('#if-biz .assign-pill').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected'); chosenBiz = el.dataset.id;
    });
    $('#m-close').onclick = closeModal;
    $('#m-cancel').onclick = closeModal;
    $('#m-save').onclick = () => {
      const tab = state.currentTab;
      (state.items[tab] || []).forEach(it => {
        if (state.bulkSelected.has(it.id)) {
          const newBizIds = chosenBiz ? [chosenBiz] : [];
          it.bizIds = newBizIds;
          delete it.bizId;
          if (!chosenBiz) it.tagIds = [];
          recordHistory(it, 'reassigned');
        }
      });
      closeModal(); toggleBulkMode(); persistAll();
      toast('Reassigned');
    };
  }

  // ---------- Export / Import ----------
  function exportAll() {
    const payload = {
      _meta: { app: 'Infos', version: 16, exportedAt: Date.now() },
      businesses: state.businesses,
      customTabs: state.customTabs,
      tabOrder: state.tabOrder,
      bizAllowedTabs: state.bizAllowedTabs,
      bizTabOrder: state.bizTabOrder,
      globalRenames: state.globalRenames,
      items: state.items,
      // v15: include item ordering and activity log so an export → import round-trip preserves them
      itemOrder: state.itemOrder,
      globalActivity: state.globalActivity,
      customAccent: state.customAccent,
      accounts: state.accounts
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `infos-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Exported');
  }
  function exportBusiness(bizId) {
    const b = bizById(bizId); if (!b) return;
    const items = {};
    Object.keys(state.items).forEach(k => { items[k] = state.items[k].filter(i => itemHasBiz(i, bizId)); });
    const payload = { _meta: { app: 'Infos', version: 7, exportedAt: Date.now(), kind: 'business' }, business: b, items };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${b.name.replace(/\s+/g, '-').toLowerCase()}-export.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Exported');
  }
  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (data._meta?.kind === 'business' && data.business) {
          // import single business
          const oldId = data.business.id;
          const newId = 'b' + (state.nextBizId++);
          data.business.id = newId;
          data.business.name = data.business.name + ' (imported)';
          state.businesses.push(data.business);
          Object.keys(data.items || {}).forEach(tk => {
            if (!state.items[tk]) state.items[tk] = [];
            data.items[tk].forEach(it => { it.id = 'x' + (state.nextItemId++); it.bizIds = [newId]; delete it.bizId; state.items[tk].push(it); });
          });
        } else if (data.businesses && data.items) {
          // full export, merge
          (data.businesses || []).forEach(b => { if (!bizById(b.id)) { state.businesses.push(b); state.nextBizId = Math.max(state.nextBizId, parseInt(b.id.replace('b','')) + 1); } });
          (data.customTabs || []).forEach(ct => { if (!state.customTabs.find(t => t.id === ct.id)) state.customTabs.push(ct); });
          Object.keys(data.items || {}).forEach(tk => {
            if (!state.items[tk]) state.items[tk] = [];
            data.items[tk].forEach(it => { if (!state.items[tk].find(x => x.id === it.id)) state.items[tk].push(it); });
          });
          // v15: merge orderings, activity log, custom accent, accounts
          if (data.bizAllowedTabs) {
            state.bizAllowedTabs = state.bizAllowedTabs || {};
            Object.assign(state.bizAllowedTabs, data.bizAllowedTabs);
          }
          if (data.bizTabOrder) {
            state.bizTabOrder = state.bizTabOrder || {};
            Object.assign(state.bizTabOrder, data.bizTabOrder);
          }
          if (data.itemOrder) {
            state.itemOrder = state.itemOrder || {};
            Object.assign(state.itemOrder, data.itemOrder);
          }
          if (Array.isArray(data.globalActivity)) {
            state.globalActivity = (state.globalActivity || []).concat(data.globalActivity)
              .filter((e, i, arr) => arr.findIndex(x => x.id === e.id) === i)
              .sort((a, b) => b.ts - a.ts)
              .slice(0, 200);
          }
          if (data.customAccent && !state.customAccent) state.customAccent = data.customAccent;
          if (Array.isArray(data.accounts)) {
            state.accounts = state.accounts || [];
            data.accounts.forEach(a => {
              if (!state.accounts.find(x => x.email === a.email)) state.accounts.push(a);
            });
          }
        } else { toast('Invalid file'); return; }
        persistAll(); buildNav();
        toast('Imported successfully'); haptic();
      } catch (err) { toast('Could not parse file'); }
    };
    reader.readAsText(file);
  }

  // ---------- Push notifications UI (permission only — no real push server) ----------
  async function requestPushPermission() {
    if (!('Notification' in window)) { toast('Notifications not supported'); return; }
    state.pushPermissionAsked = true; persistAll();
    if (Notification.permission === 'granted') { toast('Already enabled'); return; }
    if (Notification.permission === 'denied') { toast('Permission previously denied. Enable in browser settings.'); return; }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      toast('Notifications enabled');
      new Notification('Infos', { body: "You'll get reminders here. (Demo — no real server connected yet.)", icon: 'icons/icon-192.png' });
    } else toast('Permission denied');
  }

  // ---------- Launch params: deep-link tab, note-taking, file open, widget ----------
  function handleLaunchParams() {
    if (!state.user) return;
    const u = new URL(location.href);
    const tab = u.searchParams.get('tab');
    const action = u.searchParams.get('action');
    const open = u.searchParams.get('open');
    let consumed = false;

    // Deep-link to a tab (manifest shortcuts use ?tab=)
    if (tab && (TAB_DEFS[tab] || state.customTabs.some(t => t.id === tab))) {
      setActive(tab); consumed = true;
    }
    // Note-taking: ?tab=notices&action=new → open a new notice
    if (action === 'new' && !isViewOnly()) {
      const target = (tab && state.items[tab]) ? tab : 'notices';
      setTimeout(() => { setActive(target); setTimeout(() => openItemModal(target), 250); }, 100);
      consumed = true;
    }
    // File handler: ?open=file → import the launched JSON file
    if (open === 'file' && 'launchQueue' in window) {
      try {
        window.launchQueue.setConsumer(async (launchParams) => {
          if (!launchParams.files || !launchParams.files.length) return;
          const fh = launchParams.files[0];
          const file = await fh.getFile();
          if (!isViewOnly() && typeof importJSON === 'function') importJSON(file);
          else toast('Opened file: ' + file.name);
        });
      } catch {}
      consumed = true;
    }
    if (consumed) history.replaceState({}, '', location.pathname);
  }

  // ---------- Share Target — pre-populate notice modal if URL params present ----------
  function handleShareTarget() {
    const u = new URL(location.href);
    const title = u.searchParams.get('title'), text = u.searchParams.get('text'), url = u.searchParams.get('url');
    if (title || text || url) {
      const combined = [title, text, url].filter(Boolean).join(' — ');
      // If not signed in, stash for after login
      if (!state.user) {
        window.__pendingShare = { title, text, url, combined };
        history.replaceState({}, '', location.pathname);
        return;
      }
      setActive('notices');
      setTimeout(() => {
        if (isViewOnly()) return;
        const it = { id: 'x' + (state.nextItemId++), bizId: null, tagIds: [], title: title || 'Shared', meta: text || url || '', icon: 'info-circle', tone: 'info', pinned: false, notes: combined, attachments: [], history: [{ ts: Date.now(), action: 'shared' }] };
        state.items.notices.push(it);
        persistAll(); state.history.pop(); setActive('notices','fade'); toast('Shared item added');
      }, 300);
      history.replaceState({}, '', location.pathname);
    }
  }

  function flushPendingShare() {
    const p = window.__pendingShare;
    if (!p || !state.user || isViewOnly()) return;
    delete window.__pendingShare;
    setActive('notices');
    setTimeout(() => {
      const it = { id: 'x' + (state.nextItemId++), bizId: null, tagIds: [], title: p.title || 'Shared', meta: p.text || p.url || '', icon: 'info-circle', tone: 'info', pinned: false, notes: p.combined, attachments: [], history: [{ ts: Date.now(), action: 'shared' }] };
      state.items.notices.push(it);
      persistAll(); state.history.pop(); setActive('notices','fade'); toast('Shared item added');
    }, 300);
  }

  // ---------- Auth ----------
  let authMode = 'signin';
  function setAuthMode(mode) {
    authMode = mode;
    $('#field-name').hidden = authMode !== 'signup';
    $('#pw-strength').hidden = authMode !== 'signup';
    $('#auth-terms-wrap').hidden = authMode !== 'signup';
    const cpw = $('#field-confirm-pw'); if (cpw) cpw.hidden = authMode !== 'signup';
    $('#auth-submit').textContent = authMode === 'signup' ? 'Create account' : 'Sign in';
    $('#auth-title').textContent = authMode === 'signup' ? 'Create your account' : 'Welcome to Infos';
    $('#auth-sub').textContent = authMode === 'signup' ? "It takes about a minute" : 'Sign in to continue';
    $('#auth-password').autocomplete = authMode === 'signup' ? 'new-password' : 'current-password';
    // Toggle the "Don't have an account? / Already have an account?" prompt
    const promptEl = $('#auth-switch-prompt');
    const switchBtn = $('#auth-switch-mode');
    if (promptEl) promptEl.textContent = authMode === 'signup' ? 'Already have an account?' : "Don't have an account?";
    if (switchBtn) switchBtn.textContent = authMode === 'signup' ? 'Sign in' : 'Create new account';
    // The Forgot? link only makes sense for sign-in
    const forgot = $('#forgot-link'); if (forgot) forgot.style.visibility = authMode === 'signup' ? 'hidden' : 'visible';
    $('#auth-error').hidden = true;
    renderRecentSignins();
  }
  // The link below the Sign in button flips between modes.
  $('#auth-switch-mode').onclick = () => setAuthMode(authMode === 'signin' ? 'signup' : 'signin');

  function renderRecentSignins() {
    const wrap = $('#recent-signins-wrap');
    const list = $('#recent-signins-list');
    if (!wrap || !list) return;
    const items = (state.recentSignins || []);
    if (authMode !== 'signin' || !items.length) {
      wrap.hidden = true;
      list.innerHTML = ''; // clear stale entries so they don't reappear on next toggle
      return;
    }
    wrap.hidden = false;
    list.innerHTML = items.map(it => {
      const initial = (it.name || it.email).charAt(0).toUpperCase();
      const kindLabel = it.kind === 'business' ? 'Business' : 'Owner';
      return `<button type="button" class="recent-signin-chip" data-signin-email="${esc(it.email)}">
        <span class="recent-avatar recent-avatar-${it.kind}">${esc(initial)}</span>
        <span class="recent-meta">
          <span class="recent-name">${esc(it.name || it.email)}</span>
          <span class="recent-sub">${kindLabel} · ${esc(it.email)}</span>
        </span>
        <span class="recent-forget" data-forget-email="${esc(it.email)}" role="button" aria-label="Forget"><i class="ti ti-x"></i></span>
      </button>`;
    }).join('');
    list.querySelectorAll('[data-signin-email]').forEach(el => el.onclick = (e) => {
      // If the X (forget) was clicked, handle that and stop.
      if (e.target.closest('[data-forget-email]')) return;
      const email = el.dataset.signinEmail;
      $('#auth-email').value = email;
      $('#auth-password').value = '';
      $('#auth-password').focus();
      $('#auth-error').hidden = true;
    });
    list.querySelectorAll('[data-forget-email]').forEach(el => el.onclick = (e) => {
      e.stopPropagation();
      forgetSignin(el.dataset.forgetEmail);
      renderRecentSignins();
    });
    // Replace any new icons that just rendered
    window.__InfosIcons?.replaceIcons(document);
  }
  // Password visibility toggles use the global [data-pw-eye] delegated handler.
  function pwScore(v) {
    let s = 0;
    if (v.length >= 8) s++; if (/[A-Z]/.test(v)) s++; if (/[0-9]/.test(v)) s++; if (/[^a-zA-Z0-9]/.test(v)) s++;
    return s;
  }
  function pwVis(s) { return { pct: [0,25,50,75,100][s], color: ['#888780','#E24B4A','#EF9F27','#97C459','#1D9E75'][s] }; }
  $('#auth-password').oninput = () => { if (authMode !== 'signup') return; const { pct, color } = pwVis(pwScore($('#auth-password').value)); $('#pw-strength-bar').style.width = pct + '%'; $('#pw-strength-bar').style.background = color; };
  function showAuthError(m) { $('#auth-error').textContent = m; $('#auth-error').hidden = false; }
  // ============================================================================
  //  SHARED BUSINESS ACCESS  (replaces the old view-only member screen)
  // ----------------------------------------------------------------------------
  //  A business login is a real (hidden) Supabase account linked to one business.
  //  When it signs in, we DON'T show a special screen — we load the FULL app
  //  pointed at that business's SHARED cloud row. The member can add/edit
  //  everything; saves write the shared row; realtime keeps every device live.
  //  The owner edits the same row for that business, so it's one shared workspace.
  // ============================================================================
  const Slice = window.InfosSharedSlice;
  let sharedRealtimeUnsub = null;     // realtime subscription teardown
  let sharedApplyingRemote = false;   // guard: don't echo a remote apply back up
  let sharedSaveTimer = null;

  // Enter the full app as a business-login user, backed by the shared cloud row.
  // `biz` = { id (cloud uuid), name, color, allowedTabs }. Loads the shared
  // snapshot, hydrates state, renders the normal app, and goes live.
  async function enterSharedBusiness(biz, email, opts) {
    opts = opts || {};
    const isBootRestore = !!opts.bootRestore;
    if (!biz || !biz.id) {
      showAuthError('This business login is not linked to any data yet. Ask the owner to set it up.');
      try { await window.InfosSupabase.Auth.signOut(); } catch {}
      return;
    }
    let snap = null;
    try { snap = await window.InfosSupabase.adapter.loadSharedState(biz.id); } catch (e) { console.warn('loadSharedState failed:', e); }

    // First-ever sign-in before the owner has pushed anything: start from an
    // empty slice carrying just the business identity, so the member still gets
    // a working (empty) app and can add entries that sync up.
    const slice = (snap && snap.data && snap.data.business)
      ? snap.data
      : { schema: Slice.SCHEMA, business: { id: biz.id, name: biz.name || 'Shared business', color: biz.color || '#378ADD' },
          items: {}, itemOrder: {}, allowedTabs: biz.allowedTabs || null, tabOrder: null, customTabs: [], activity: [] };

    // Hydrate local state from the slice. The business login runs as a VIEW-ONLY
    // session scoped to this one business — exactly like the owner's view when
    // filtered to that business: view everything, no business creation, and the
    // only place it can add is the Balance entry path (createdByBiz). We achieve
    // that by setting state.bizContext (the established view-only flag), so ALL
    // the existing owner-business gating applies automatically. __sharedMode just
    // marks that this bizContext session is backed by the cloud shared row (for
    // live cross-device sync + pushing Balance entries up).
    const ms = Slice.sliceToMemberState(slice, { email });
    Object.assign(state, ms);
      if (!state.bulkSelected || typeof state.bulkSelected.has !== "function") state.bulkSelected = new Set();
    state.__sharedMode = true;
    state.__sharedBusinessId = biz.id;
    state.__sharedVersion = (snap && snap.version) || 0;
    state.__sharedEmail = email;
    // VIEW-ONLY scoped to this business (this is what makes it behave like the
    // owner's Business view: view-only everywhere, entries only on Balance).
    state.bizContext = biz.id;
    state.activeBizId = biz.id;
    state.user = { name: (biz.name || 'Business'), email };
    // Drop any owner-only collections that the member slice doesn't define, so a
    // previous owner session on this device leaves nothing in memory during the
    // business session. (Disk prefs are untouched — see persistAll's shared-mode
    // branch — so the owner's real data is restored intact on next owner login.)
    state.accounts = [];
    state.recentSignins = [];
    state.globalRenames = state.globalRenames || {};
    state.cryptoMeta = null;
    state.hiddenTabs = [];

    // Reveal the main app. IMPORTANT ORDER (fixes the login glitch): show the
    // welcome splash FIRST (covering the screen), THEN build/render underneath it,
    // so the user never sees the dashboard flash before the welcome screen.
    try {
      const bs = document.getElementById('boot-splash'); if (bs) bs.remove();
    } catch {}
    if (!state.__switchInProgress && !isBootRestore) {
      showLoadingSplash(biz.name || 'Business', { action: 'signing-in', subtitle: `Signing in to ${biz.name || 'your business'}`, color: biz.color || null });
    }
    try {
      const auth = document.getElementById('screen-auth'); if (auth) auth.classList.remove('screen-active');
    } catch {}
    screenMain.classList.add('screen-active');
    state.history = [];
    recordSignin({ email, name: state.user.name, kind: 'business', bizId: biz.id });
    buildNav(); updateActiveBizDisplay();
    let bizRestoreTab = null;
    if (isBootRestore) { try { bizRestoreTab = localStorage.getItem('infos-last-tab'); } catch {} }
    // A business login can't see owner-only tabs (Businesses); guard the restore.
    if (bizRestoreTab && getTabDef(bizRestoreTab) && !(getTabDef(bizRestoreTab).ownerOnly)) {
      setActive(bizRestoreTab);
    } else {
      setActive('notices');
    }

    // Go live: any change to the shared row re-hydrates this device.
    subscribeShared(biz.id);

    if (!state.__switchInProgress && !isBootRestore) {
      const shownName = (state.businesses && state.businesses[0] && state.businesses[0].name) || biz.name || 'your business';
      setTimeout(() => { hideLoadingSplash(); toast(`Signed in to ${shownName}`); }, 250);
    }
  }

  // Subscribe to the shared row; on remote change, pull + re-apply without
  // bouncing the change straight back to the cloud. The callback is debounced so
  // a burst of realtime events coalesces into a single refresh (less flicker).
  function subscribeShared(cloudBusinessId) {
    try { if (sharedRealtimeUnsub) sharedRealtimeUnsub(); } catch {}
    sharedRealtimeUnsub = null;
    if (!(window.InfosSupabase && window.InfosSupabase.adapter.subscribeSharedState)) return;
    sharedRealtimeUnsub = window.InfosSupabase.adapter.subscribeSharedState(cloudBusinessId, () => {
      clearTimeout(window.__sharedRefreshDebounce);
      window.__sharedRefreshDebounce = setTimeout(() => refreshSharedFromCloud(cloudBusinessId), 80);
    });
    // POLLING FALLBACK (same as the owner side): realtime websockets don't always
    // deliver, so poll the shared row every 5s. The owner pushing an entry to this
    // business will then appear within ~5s even if realtime is silent. Version-
    // guarded, so it's a no-op when nothing changed.
    try { clearInterval(window.__sharedPoll); } catch {}
    window.__sharedPoll = setInterval(() => {
      if (!state.__sharedMode) return;
      try { refreshSharedFromCloud(cloudBusinessId); } catch {}
    }, 1500);
  }

  // Pull the latest shared snapshot and re-render. Used by realtime + on resume.
  async function refreshSharedFromCloud(cloudBusinessId) {
    try {
      const snap = await window.InfosSupabase.adapter.loadSharedState(cloudBusinessId);
      if (!snap || !snap.data) return;
      // Ignore versions we've already applied (including our OWN just-written
      // version) to avoid render churn / echo loops. The "last applied version"
      // lives in different places for the two modes:
      //   - business login (__sharedMode): state.__sharedVersion
      //   - owner viewing a shared biz:    state.bizCloudVersions[cloudId]
      const appliedVersion = state.__sharedMode
        ? (state.__sharedVersion || 0)
        : ((state.bizCloudVersions && state.bizCloudVersions[cloudBusinessId]) || 0);
      if ((snap.version || 0) <= appliedVersion) return;
      // Don't yank the UI out from under an open modal or an in-progress edit —
      // that's what causes the flicker. Defer the refresh until the user is idle.
      const modalOpen = (function () { const m = document.getElementById('modal'); return m && !m.hidden; })();
      const fsmOpen = !!document.getElementById('fullscreen-message');
      if (modalOpen || fsmOpen || (typeof sharedSaveTimer !== 'undefined' && sharedSaveTimer)) {
        clearTimeout(window.__sharedRefreshRetry);
        window.__sharedRefreshRetry = setTimeout(() => refreshSharedFromCloud(cloudBusinessId), 1200);
        return;
      }
      sharedApplyingRemote = true;
      if (state.__sharedMode) {
        const __before = itemIdSnapshot();
        const ms = Slice.sliceToMemberState(snap.data, { email: state.__sharedEmail });
        Object.assign(state, ms);
      if (!state.bulkSelected || typeof state.bulkSelected.has !== "function") state.bulkSelected = new Set();
        state.__sharedMode = true;
        state.__sharedBusinessId = cloudBusinessId;
        state.__sharedVersion = snap.version || 0;
        state.user = state.user || { name: (snap.data.business && snap.data.business.name || 'Business'), email: state.__sharedEmail };
        // Chime for any entries that just arrived from the owner via sync.
        try { chimeForArrivals(__before); } catch (e) {}
        // We only get here AFTER passing the version guard above — i.e. the cloud
        // genuinely has a newer version than we last applied, so SOMETHING changed
        // (on any tab). Re-render the current view unconditionally (unless a modal
        // or edit is open). Relying on a current-tab signature missed changes made
        // on other tabs and edits, which is why owner→business updates needed a
        // manual refresh. The version guard already prevents needless churn.
        const modalNow = (function () { const m = document.getElementById('modal'); return m && !m.hidden; })();
        if (!modalNow && !document.getElementById('fullscreen-message')) {
          rerenderCurrentTab();
          try { updateBadges(); buildNav(); } catch (e) {}
        }
      } else {
        // Owner viewing this shared business: merge the slice into full state.
        // Map the cloud id back to the owner's local business id.
        let localBizId = null;
        if (state.bizCloudMap) {
          for (const lid of Object.keys(state.bizCloudMap)) {
            if (state.bizCloudMap[lid] === cloudBusinessId) { localBizId = lid; break; }
          }
        }
        // Snapshot the CURRENT tab's visible items before applying, so we only
        // re-render if something the user can actually see changed. Polling that
        // touches nothing visible must NOT re-render (that churn was causing
        // entries to appear to flicker/disappear).
        // Past the version guard ⇒ the cloud genuinely changed. Map cloud id back
        // to the local business id and merge.
        const __beforeOwner = itemIdSnapshot();
        Slice.applySliceToOwnerState(state, snap.data, localBizId);
        if (!state.bizCloudVersions) state.bizCloudVersions = {};
        state.bizCloudVersions[cloudBusinessId] = snap.version || 0;
        // Persist locally without echoing a push back (breaks the poll→push loop).
        state.__suppressOwnerPush = true;
        try { persistAll(); } finally { state.__suppressOwnerPush = false; }
        // Chime for entries that just arrived from the business via sync.
        try { chimeForArrivals(__beforeOwner); } catch (e) {}
        // Re-render unconditionally (a confirmed version bump means real change on
        // some tab); the version guard prevents needless churn. Skip only when a
        // modal/edit is open so we don't yank the UI mid-interaction.
        const modalNow = (function () { const m = document.getElementById('modal'); return m && !m.hidden; })();
        if (!modalNow && !document.getElementById('fullscreen-message')) {
          rerenderCurrentTab();
          try { updateBadges(); buildNav(); } catch (e) {}
        }
        sharedApplyingRemote = false;
        return;
      }
    } catch (e) { console.warn('refreshSharedFromCloud failed:', e); }
    finally { sharedApplyingRemote = false; }
  }

  // Push the current shared-business slice up to the cloud (debounced). Called
  // from persistAll when in shared mode, or by the owner after editing a shared
  // business. Last-write-wins on the version (documented).
  function pushSharedState(immediate) {
    if (sharedApplyingRemote) return;            // don't echo a remote apply
    if (!(window.InfosSupabase && window.InfosSupabase.configured())) return;
    clearTimeout(sharedSaveTimer);
    const doPush = async () => {
      try {
        if (state.__sharedMode) {
          try { if (window.__InfosSyncUploading) window.__InfosSyncUploading(); } catch {}
          const slice = Slice.memberStateToSlice(state);
          if (!slice) return;
          const v = await window.InfosSupabase.adapter.saveSharedState(
            state.__sharedBusinessId, slice, state.__sharedVersion || 0);
          state.__sharedVersion = v;
          try { if (window.__InfosSyncDone) window.__InfosSyncDone(); } catch {}
        }
      } catch (e) { console.warn('pushSharedState failed:', e); }
    };
    if (immediate) doPush(); else sharedSaveTimer = setTimeout(doPush, 900);
  }

  // OWNER side: subscribe to live changes on every business the owner has shared
  // and pull their current shared rows once, so the owner's app reflects members'
  // edits live. Called after owner sign-in / boot when cloud is configured.
  let ownerSharedUnsubs = [];
  async function startOwnerSharedSync() {
    // Tear down any prior subscriptions first.
    ownerSharedUnsubs.forEach(fn => { try { fn(); } catch {} });
    ownerSharedUnsubs = [];
    if (state.__sharedMode) return; // a business login handles its own sync
    if (!(window.InfosSupabase && window.InfosSupabase.configured())) return;
    if (!state.bizCloudMap) return;
    for (const localId of Object.keys(state.bizCloudMap)) {
      const cloudId = state.bizCloudMap[localId];
      if (!cloudId || !bizById(localId)) continue;
      // Initial pull: apply whatever members have done since we were last on.
      try {
        const snap = await window.InfosSupabase.adapter.loadSharedState(cloudId);
        if (snap && snap.data && (snap.version || 0) > ((state.bizCloudVersions && state.bizCloudVersions[cloudId]) || 0)) {
          sharedApplyingRemote = true;
          Slice.applySliceToOwnerState(state, snap.data, localId);
          if (!state.bizCloudVersions) state.bizCloudVersions = {};
          state.bizCloudVersions[cloudId] = snap.version || 0;
          sharedApplyingRemote = false;
          persistAll();
        }
      } catch (e) { sharedApplyingRemote = false; }
      // Live subscription.
      try {
        const unsub = window.InfosSupabase.adapter.subscribeSharedState(cloudId, () => {
          refreshSharedFromCloud(cloudId);
        });
        ownerSharedUnsubs.push(unsub);
      } catch {}
    }
    // POLLING FALLBACK: realtime websockets don't always deliver (table not in the
    // realtime publication, free-tier limits, dropped sockets, backgrounded tab).
    // Poll each shared business every few seconds so the owner sees business
    // entries "without a refresh" even when realtime is silent. refreshSharedFromCloud
    // is cheap (version-guarded: it no-ops when nothing changed).
    try { clearInterval(window.__ownerSharedPoll); } catch {}
    window.__ownerSharedPoll = setInterval(() => {
      if (state.__sharedMode) return;
      if (!state.bizCloudMap) return;
      Object.keys(state.bizCloudMap).forEach(lid => {
        const cid = state.bizCloudMap[lid];
        if (cid && bizById(lid)) { try { refreshSharedFromCloud(cid); } catch {} }
      });
    }, 1500);
    ownerSharedUnsubs.push(() => { try { clearInterval(window.__ownerSharedPoll); } catch {} });
    // Re-render in case the initial pull changed anything (silent — no flash).
    try { if (state.user) rerenderCurrentTab(); } catch {}
  }

  function mergeCloudState(remote) {
    if (!remote || typeof remote !== 'object') return;
    const keep = new Set(['theme', 'accent', 'sidebarCollapsed', 'customAccent', 'onboarded', 'currentTab']);
    Object.keys(remote).forEach(k => {
      if (keep.has(k)) return;
      if (k.startsWith('__cloud')) { state[k] = remote[k]; return; }
      if (remote[k] !== undefined) state[k] = remote[k];
    });
    // Defensive: ensure core collections exist after merge.
    state.items = state.items || {};
    state.businesses = state.businesses || [];
    state.accounts = state.accounts || [];
    state.tabOrder = state.tabOrder || ['notices','games','system','idpass','balance','schedule','businesses','trash'];
    persistAll();
  }

  function friendlyAuthError(e) {
    const msg = (e && (e.message || e.error_description || e.error)) || 'Authentication failed';
    if (/already registered|already exists|User already/i.test(msg)) return 'An account with this email already exists. Please sign in.';
    if (/invalid login|invalid credentials|Invalid login/i.test(msg)) return 'Incorrect email or password.';
    if (/email not confirmed|not confirmed/i.test(msg)) return 'Please confirm your email first (check your inbox).';
    if (/rate|too many/i.test(msg)) return 'Too many attempts. Please wait a moment and try again.';
    if (/network|fetch|Failed to fetch/i.test(msg)) return 'Network error reaching the server. Check your connection.';
    return msg;
  }

  async function authSubmit() {
    $('#auth-error').hidden = true;
    const email = $('#auth-email').value.trim().toLowerCase();
    const pw = $('#auth-password').value;
    if (!email.includes('@')) return showAuthError('Enter a valid email');
    if (pw.length < 6) return showAuthError('Password must be at least 6 characters');
    if (authMode === 'signup') {
      if (!$('#auth-name').value.trim()) return showAuthError('Enter your name');
      const pw2 = $('#auth-password2') ? $('#auth-password2').value : pw;
      if (pw !== pw2) return showAuthError('Passwords do not match');
      if (!$('#auth-terms').checked) return showAuthError('Please accept the Terms & Conditions and Privacy Policy');
      // Local-only duplicate checks (Supabase enforces its own uniqueness server-side).
      if (!(window.InfosSupabase && window.InfosSupabase.configured())) {
        if ((state.accounts || []).find(a => a.email === email)) return showAuthError('An account with this email already exists. Please sign in.');
        if ((state.businesses || []).find(b => b.email.toLowerCase() === email)) return showAuthError('This email is used by a business. Use a different email.');
      }
    }
    const btn = $('#auth-submit'); const original = btn.textContent;
    btn.textContent = authMode === 'signup' ? 'Creating…' : 'Signing in…'; btn.disabled = true;

    // ---- Cloud path: if Supabase is configured, authenticate against it ----
    // Wait for config to load (from /api/config) so we don't fall to local by race.
    if (window.InfosSupabase && window.InfosSupabase.ready) {
      try { await window.InfosSupabase.ready; } catch {}
    }
    if (window.InfosSupabase && window.InfosSupabase.configured()) {
      try {
        const name = authMode === 'signup' ? $('#auth-name').value.trim() : '';
        if (authMode === 'signup') {
          const result = await window.InfosSupabase.Auth.signUp(email, pw, name);
          btn.textContent = original; btn.disabled = false;
          // Do NOT auto-login. Show a dedicated confirmation screen so the user
          // clearly sees the "check your email" message. The only button is
          // "Back to sign in" (not "Sign in") so they don't skip confirmation by
          // habit. Clicking the email link later brings them to the sign-in page.
          const needsConfirm = !!(result && result.needsConfirmation);
          showFullScreenMessage({
            icon: 'ti-mail-check',
            title: needsConfirm ? 'Check your email' : 'Account created',
            message: needsConfirm
              ? `We've sent a confirmation link to ${email}. Open your inbox and click the link to verify your account. After confirming, come back here to sign in.`
              : `Your account is ready. Tap "Back to login" below to sign in with your email and password.`,
            button: {
              label: 'Back to login',
              onClick: () => {
                const fsm = document.getElementById('fullscreen-message'); if (fsm) fsm.remove();
                setAuthMode('signin');
                const ef = $('#auth-email'); if (ef) ef.value = email;
                const pf = $('#auth-password'); if (pf) pf.value = '';
              }
            }
          });
          return;
        }
        // Sign-in path
        const sbUser = await window.InfosSupabase.Auth.signIn(email, pw);
        if (!sbUser) {
          showAuthError('Could not sign in. Check your credentials.');
          btn.textContent = original; btn.disabled = false;
          return;
        }
        // Is this a business login (a member account linked to a shared
        // business)? If so, load the FULL editable app pointed at the shared
        // cloud row — not a special screen, and not view-only.
        //
        // HARD GATE: we first ask whether the account is a member at all (via
        // server-stamped metadata). A member account must NEVER fall through to
        // the owner path, because that path would load/overwrite owner data and
        // leak it to the business login. If the account is a member but we can't
        // resolve its business, we stop with an error rather than degrade to owner.
        // FAST PATH: signIn already returned the user object, which carries the
        // member metadata. Compute member status from it directly — no extra
        // auth.getUser() round-trip. If it's a member, enter the shared session
        // immediately using the business id from metadata; the business name/color
        // arrive with the shared-state load inside enterSharedBusiness. We avoid
        // the separate business_members + businesses queries on the sign-in
        // critical path (they were 2 extra sequential round-trips).
        const memberInfo = window.InfosSupabase.Auth.memberInfoFromUser(sbUser);
        if (memberInfo.isMember) {
          btn.textContent = original; btn.disabled = false;
          if (memberInfo.businessId) {
            await enterSharedBusiness({ id: memberInfo.businessId, name: '', color: '#378ADD' }, email);
          } else {
            // Member flag but no business id in metadata — fall back to the table
            // lookup once; if that also fails, stop (don't degrade to owner).
            let biz = null;
            try { biz = await window.InfosSupabase.Auth.getMemberBusiness(); } catch {}
            if (biz) { await enterSharedBusiness(biz, email); }
            else {
              showAuthError('This business login is not fully set up yet. Ask the owner to re-share the business, then try again.');
              try { await window.InfosSupabase.Auth.signOut(); } catch {}
            }
          }
          return;
        }
        // Not a member → also check the membership table directly (covers older
        // member accounts created before role metadata, or if memberInfo missed).
        try {
          const biz = await window.InfosSupabase.Auth.getMemberBusiness();
          if (biz) {
            btn.textContent = original; btn.disabled = false;
            await enterSharedBusiness(biz, email);
            return;
          }
        } catch (memErr) {
          console.warn('Business-login check failed, continuing as owner:', memErr);
        }
        // Turn on sync and pull any existing cloud state for this user.
        try {
          await Sync.enable('supabase');
          const remote = await Sync.pullNow();
          if (remote && typeof remote === 'object') {
            mergeCloudState(remote);
          }
        } catch (syncErr) {
          // Auth succeeded but sync failed — continue locally, surface a soft note.
          console.warn('Sync after auth failed:', syncErr);
        }
        const displayName = (sbUser.user_metadata && sbUser.user_metadata.name) || name || email.split('@')[0];
        // Mirror a local owner account so the rest of the app keeps working.
        if (!state.accounts) state.accounts = [];
        if (!state.accounts.find(a => a.email === email)) {
          state.accounts.push({ email, name: displayName, cloud: true, createdAt: Date.now(), termsAcceptedAt: Date.now() });
        }
        persistAll();
        state.__nextSplashAction = authMode === 'signup' ? 'creating' : 'signing-in';
        login(displayName, email, null);
        try { await Sync.pushNow(state); } catch {}
        btn.textContent = original; btn.disabled = false;
        return;
      } catch (e) {
        showAuthError(friendlyAuthError(e));
        btn.textContent = original; btn.disabled = false;
        return;
      }
    }

    // ---- Local path (no backend configured) — unchanged ----
    if (authMode === 'signup') {
      // Register the owner account
      const name = $('#auth-name').value.trim();
      const acc = { email, name, password: pw, createdAt: Date.now(), termsAcceptedAt: Date.now() };
      if (!state.accounts) state.accounts = [];
      state.accounts.push(acc);
      persistAll();
      state.__nextSplashAction = 'creating';
      setTimeout(() => { login(name, email, null); btn.textContent = original; btn.disabled = false; }, 200);
      return;
    }

    // Sign-in: try owner account first, then business
    const ownerAcc = (state.accounts || []).find(a => a.email === email);
    let bizMatch = null;
    for (const b of state.businesses) {
      if (b.email.toLowerCase() !== email) continue;
      if (b.password === pw) { bizMatch = b; break; }
      if (b.passwordEnc && window.Crypto.isUnlocked()) {
        try { const plain = await window.Crypto.decrypt(b.passwordEnc); if (plain === pw) { bizMatch = b; break; } } catch {}
      }
    }
    setTimeout(() => {
      if (ownerAcc && ownerAcc.password === pw) {
        state.__nextSplashAction = 'signing-in';
        login(ownerAcc.name, email, null);
      } else if (bizMatch) {
        state.__nextSplashAction = 'signing-in';
        login(bizMatch.name, email, bizMatch.id);
      } else {
        showAuthError('No account found with that email and password. If you haven\u2019t signed up yet, choose Create account.');
      }
      btn.textContent = original; btn.disabled = false;
    }, 200);
  }
  $('#auth-submit').onclick = authSubmit;
  ['#auth-email','#auth-password','#auth-name'].forEach(s => $(s).addEventListener('keydown', e => { if (e.key === 'Enter') authSubmit(); }));

  // Terms & Privacy preview modals from auth screen
  $('#show-terms').onclick = (e) => { e.preventDefault(); openTermsModal(); };
  $('#show-privacy-link').onclick = (e) => { e.preventDefault(); openPrivacyPreviewModal(); };

  // Popup shown right after a successful signup. Uses the standard modal (which
  // has the blurred backdrop). Tells the user to confirm via email, then sign in.
  function openTermsModal() {
    openModal(`
      <div class="modal-head"><h3>Terms &amp; Conditions</h3><button id="m-close" class="btn-icon"><i class="ti ti-x"></i></button></div>
      <div class="modal-body" style="line-height:1.7;font-size:13px;color:var(--text-secondary);">
        <p style="margin:0 0 12px;color:var(--text-primary);"><strong>Effective: ${new Date().toLocaleDateString()}</strong></p>
        <h4 class="guide-h3" style="margin-top:0;">1. Your account &amp; data</h4>
        <p>When you sign in with a cloud account, your account is managed by our authentication provider (Supabase) and your app data is stored on its servers so it can sync across your devices. If the app is used without cloud sign-in, data is kept locally on your device.</p>
        <h4 class="guide-h3">2. Account security</h4>
        <p>You're responsible for keeping your sign-in credentials safe. Use a strong, unique password. You can reset your password by email.</p>
        <h4 class="guide-h3">3. Business sharing</h4>
        <p>When you create a business, the credentials you set for it allow that business's users read-only access to items you assign to them. Choose those credentials carefully and share them only with people you intend to grant access.</p>
        <h4 class="guide-h3">4. Acceptable use</h4>
        <p>You agree not to use Infos to store or share content that is illegal, harmful, or infringes on others' rights.</p>
        <h4 class="guide-h3">5. Data deletion</h4>
        <p>You can delete your account at any time from Settings, which removes your account and associated data from the backend. Deletion is permanent.</p>
        <h4 class="guide-h3">6. No warranty</h4>
        <p>Infos is provided "as is" without warranties of any kind. We make no guarantees about availability, accuracy, or fitness for any purpose.</p>
        <h4 class="guide-h3">7. Limitation of liability</h4>
        <p>To the extent permitted by law, we are not liable for any loss of data or damages arising from use of the app. Keep your own backups of important information.</p>
        <h4 class="guide-h3">8. Changes</h4>
        <p>We may update these terms. Continued use after changes constitutes acceptance.</p>
      </div>
      <div class="modal-foot"><div></div><button class="btn-primary" id="m-cancel">Got it</button></div>
    `);
    $('#m-close').onclick = closeModal;
    $('#m-cancel').onclick = closeModal;
  }

  function openPrivacyPreviewModal() {
    openModal(`
      <div class="modal-head"><h3>Privacy Policy</h3><button id="m-close" class="btn-icon"><i class="ti ti-x"></i></button></div>
      <div class="modal-body" style="line-height:1.7;font-size:13px;color:var(--text-secondary);">
        <p style="margin:0 0 12px;color:var(--text-primary);"><strong>How your data is handled.</strong></p>
        <p>When you use a cloud account, your data — businesses, items, balances, attachments, and preferences — is stored on our backend (Supabase) so it can sync across your devices. Authentication is handled by Supabase; your password is securely hashed and never stored in plain text on the server.</p>
        <h4 class="guide-h3">What we store</h4>
        <p>Your account email and the app data you create. We don't sell your data or use it for advertising.</p>
        <h4 class="guide-h3">Data isolation</h4>
        <p>Access is restricted per account at the database level (row-level security), so one account cannot read another account's data.</p>
        <h4 class="guide-h3">Business sign-in</h4>
        <p>When someone signs in with a business's email and password, they get read-only access to <strong>only</strong> items you have assigned to that business. They cannot see other businesses, your owner account, or any unassigned data.</p>
        <h4 class="guide-h3">Your control</h4>
        <p>You can export your data, or delete your account and its data permanently from Settings. Local-only use (without cloud sign-in) keeps data on your device.</p>
      </div>
      <div class="modal-foot"><div></div><button class="btn-primary" id="m-cancel">Got it</button></div>
    `);
    $('#m-close').onclick = closeModal;
    $('#m-cancel').onclick = closeModal;
  }

  // Forgot password
  const forgotSteps = [1,2,3,4].map(i => $(`#forgot-step-${i}`));
  let resendId = null;
  function showForgotStep(n) {
    forgotSteps.forEach((el, i) => { el.hidden = (i !== n-1); if (i === n-1) { el.classList.remove('auth-step'); void el.offsetWidth; el.classList.add('auth-step'); } });
    ['#forgot-error-1','#forgot-error-2','#forgot-error-3'].forEach(s => $(s).hidden = true);
    $('#forgot-back').hidden = (n === 4);
  }
  $('#forgot-link').onclick = () => {
    $('#auth-mode-signin').hidden = true; $('#auth-mode-forgot').hidden = false;
    $('#auth-title').textContent = 'Reset password'; $('#auth-sub').textContent = "We'll help you back in";
    showForgotStep(1);
  };
  $('#forgot-back').onclick = () => { $('#auth-mode-forgot').hidden = true; $('#auth-mode-signin').hidden = false; $('#auth-title').textContent = 'Welcome to Infos'; $('#auth-sub').textContent = 'Sign in to continue'; };
  function startResend() {
    let s = 30; $('#otp-resend').disabled = true;
    $('#otp-timer').textContent = `Resend in 0:${s.toString().padStart(2,'0')}`;
    clearInterval(resendId);
    resendId = setInterval(() => { s--; if (s <= 0) { clearInterval(resendId); $('#otp-resend').disabled = false; $('#otp-timer').textContent = 'Code expired'; } else $('#otp-timer').textContent = `Resend in 0:${s.toString().padStart(2,'0')}`; }, 1000);
  }
  $('#forgot-send').onclick = async () => {
    const email = $('#forgot-email').value.trim().toLowerCase();
    if (!email.includes('@')) { $('#forgot-error-1').textContent = 'Enter a valid email'; $('#forgot-error-1').hidden = false; return; }
    const cloud = !!(window.InfosSupabase && window.InfosSupabase.configured());
    if (cloud) {
      // Cloud accounts: send a real Supabase password-reset email (uses the
      // branded reset template). We don't reveal whether the email exists.
      const sendBtn = $('#forgot-send'); const orig = sendBtn.textContent;
      sendBtn.textContent = 'Sending…'; sendBtn.disabled = true;
      try { await window.InfosSupabase.Auth.resetPassword(email); } catch (e) { console.warn('reset email error:', e); }
      sendBtn.textContent = orig; sendBtn.disabled = false;
      // Always show the same confirmation (avoid leaking which emails exist).
      showFullScreenMessage({
        icon: 'ti-mail-check',
        title: 'Check your email',
        message: `If an account exists for ${email}, we've sent a password-reset link. Open it to choose a new password, then come back here to sign in.`,
        button: {
          label: 'Back to login',
          onClick: () => {
            const fsm = document.getElementById('fullscreen-message'); if (fsm) fsm.remove();
            $('#auth-mode-forgot').hidden = true; $('#auth-mode-signin').hidden = false;
            $('#auth-title').textContent = 'Welcome to Infos'; $('#auth-sub').textContent = 'Sign in to continue';
            const ef = $('#auth-email'); if (ef) { ef.value = email; ef.focus(); }
          }
        }
      });
      return;
    }
    // Local mode: keep the existing in-app reset flow (no external email).
    const acc = (state.accounts || []).find(a => a.email === email);
    if (!acc) { $('#forgot-error-1').textContent = 'No account found with that email'; $('#forgot-error-1').hidden = false; return; }
    $('#forgot-email-display').textContent = email; showForgotStep(2);
    $$('.otp-input')[0].focus(); startResend();
  };
  $('#otp-resend').onclick = () => { if ($('#otp-resend').disabled) return; $$('.otp-input').forEach(i => { i.value = ''; i.classList.remove('filled'); }); $$('.otp-input')[0].focus(); toast('New code sent'); startResend(); };
  $$('.otp-input').forEach((input, idx) => {
    input.addEventListener('input', e => {
      const v = e.target.value.replace(/\D/g, ''); e.target.value = v;
      if (v) e.target.classList.add('filled'); else e.target.classList.remove('filled');
      if (v && idx < 5) $$('.otp-input')[idx + 1].focus();
    });
    input.addEventListener('keydown', e => { if (e.key === 'Backspace' && !e.target.value && idx > 0) $$('.otp-input')[idx - 1].focus(); });
    input.addEventListener('paste', e => {
      e.preventDefault();
      const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      t.split('').forEach((ch, i) => { if ($$('.otp-input')[i]) { $$('.otp-input')[i].value = ch; $$('.otp-input')[i].classList.add('filled'); } });
    });
  });
  $('#forgot-verify').onclick = () => {
    const code = $$('.otp-input').map(i => i.value).join('');
    if (code.length !== 6) { $('#forgot-error-2').textContent = 'Enter all 6 digits'; $('#forgot-error-2').hidden = false; return; }
    if (code !== '123456') { $('#forgot-error-2').textContent = 'Invalid code. Try 123456 for this demo.'; $('#forgot-error-2').hidden = false; $$('.otp-input').forEach(i => { i.value = ''; i.classList.remove('filled'); }); $$('.otp-input')[0].focus(); return; }
    showForgotStep(3); $('#new-password').focus();
  };
  // #new-password visibility uses the global [data-pw-eye] handler.
  $('#new-password').oninput = () => { const { pct, color } = pwVis(pwScore($('#new-password').value)); $('#new-pw-bar').style.width = pct + '%'; $('#new-pw-bar').style.background = color; };
  $('#forgot-reset').onclick = () => {
    const pw = $('#new-password').value, cf = $('#confirm-password').value;
    if (pw.length < 6) { $('#forgot-error-3').textContent = 'Password must be at least 6 characters'; $('#forgot-error-3').hidden = false; return; }
    if (pw !== cf) { $('#forgot-error-3').textContent = 'Passwords do not match'; $('#forgot-error-3').hidden = false; return; }
    if (pwScore(pw) < 2) { $('#forgot-error-3').textContent = 'Choose a stronger password'; $('#forgot-error-3').hidden = false; return; }
    // Persist new password to the registered account
    const email = $('#forgot-email-display').textContent.trim().toLowerCase();
    const acc = (state.accounts || []).find(a => a.email === email);
    if (acc) { acc.password = pw; persistAll(); }
    showForgotStep(4);
  };
  $('#forgot-done').onclick = () => {
    $('#auth-mode-forgot').hidden = true; $('#auth-mode-signin').hidden = false;
    $('#auth-title').textContent = 'Welcome to Infos'; $('#auth-sub').textContent = 'Sign in to continue';
    $('#auth-email').value = $('#forgot-email-display').textContent; $('#auth-email').focus();
    toast('Password reset successful');
  };

  function login(name, email, asBizId) {
    state.user = { name, email };
    state.bizContext = asBizId;
    if (asBizId) state.activeBizId = asBizId; else state.activeBizId = 'all';
    state.activeTagId = null;
    { const am = $('#avatar-mini'); if (am) am.textContent = name.charAt(0).toUpperCase(); }
    headerBadge.hidden = true;
    // GLITCH FIX: put up the welcome splash BEFORE switching to / rendering the
    // main screen, so the dashboard never flashes before the welcome screen.
    if (!state.__switchInProgress) {
      const action = state.__nextSplashAction || 'signing-in';
      const displayName = asBizId ? bizById(asBizId)?.name : name;
      const subtitle = action === 'creating'
        ? "Setting up your workspace"
        : asBizId ? `Signing in to ${bizById(asBizId)?.name}` : `Welcome, ${name}`;
      const splashColor = asBizId ? (bizById(asBizId)?.color || null) : null;
      showLoadingSplash(displayName, { action, subtitle, color: splashColor });
    }
    screenAuth.classList.remove('screen-active');
    screenMain.classList.add('screen-active');
    state.history = [];
    // OWNER: if this is a cloud owner with shared businesses, go live on their
    // shared rows so members' edits appear without a manual refresh.
    if (!asBizId && window.InfosSupabase && window.InfosSupabase.configured()) {
      try { startOwnerSharedSync(); } catch {}
    }
    // Record this sign-in for the quick-switch list on the auth screen.
    recordSignin({ email, name, kind: asBizId ? 'business' : 'owner', bizId: asBizId || null });
    if (asBizId) recordActivity(bizById(asBizId), 'signin', `${name} signed in`);
    if (asBizId) recordBizDeviceLogin(asBizId);
    // Start the heartbeat loop for this device so the owner can see it as "active now"
    if (asBizId && !window.__bizHeartbeatId) {
      window.__bizHeartbeatId = setInterval(() => {
        if (!state.bizContext) return;
        const b2 = bizById(state.bizContext);
        const fp2 = getDeviceFingerprint();
        const d2 = b2?.devices?.find(x => x.fingerprint === fp2);
        if (d2 && d2.revokedAt && d2.revokedAt > (d2.lastSeen || 0)) {
          clearInterval(window.__bizHeartbeatId); window.__bizHeartbeatId = null;
          toast('This device was signed out by the owner');
          setTimeout(() => logout(), 400);
          return;
        }
        heartbeatBizDevice(); persistAll();
      }, 30_000);
    }
    buildNav(); updateActiveBizDisplay(); persistAll();
    setActive('notices');
    if (!state.__switchInProgress) {
      state.__nextSplashAction = null;
      setTimeout(() => {
        hideLoadingSplash();
        if (asBizId) toast(`Signed in to ${bizById(asBizId)?.name}`); else toast(`Welcome, ${name}`);
      }, 600);
    }
    flushPendingShare();
  }

  // Record this device's sign-in to a business (for the owner's "Devices" view).
  // Also marks the device as having an ACTIVE session — clears any prior signedOutAt.
  function recordBizDeviceLogin(bizId) {
    const b = bizById(bizId); if (!b) return;
    if (!b.devices) b.devices = [];
    const fingerprint = getDeviceFingerprint();
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : 'Unknown';
    const existing = b.devices.find(d => d.fingerprint === fingerprint);
    if (existing) {
      existing.lastSeen = Date.now();
      existing.userAgent = ua;
      // A fresh sign-in clears any pending revoke / prior sign-out on this device.
      existing.signedOutAt = null;
      existing.revokedAt = null;
    } else {
      b.devices.push({
        fingerprint,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        userAgent: ua,
        signedOutAt: null,
        revokedAt: null
      });
    }
  }

  // Mark a device's session as ended (this device only).
  function endBizDeviceSessionLocal(bizId) {
    const b = bizById(bizId); if (!b || !b.devices) return;
    const fp = getDeviceFingerprint();
    const d = b.devices.find(x => x.fingerprint === fp);
    if (d) d.signedOutAt = Date.now();
  }

  // Heartbeat: bump lastSeen so an open tab shows up as "active now" in the device list.
  // Skipped if the local device has been revoked (we don't want to resurrect a revoked session).
  function heartbeatBizDevice() {
    if (!state.bizContext) return;
    const b = bizById(state.bizContext); if (!b || !b.devices) return;
    const fp = getDeviceFingerprint();
    const d = b.devices.find(x => x.fingerprint === fp);
    if (!d) return;
    if (d.revokedAt && d.revokedAt > (d.lastSeen || 0)) return; // don't refresh a revoked device
    d.lastSeen = Date.now();
  }

  // A device is "currently signed in" if its lastSeen is more recent than any signedOutAt/revokedAt
  // AND was active within the recent threshold (last 60s, since each open tab heartbeats every 30s).
  function isDeviceActive(d) {
    if (!d) return false;
    const lastSeen = d.lastSeen || 0;
    const ended = Math.max(d.signedOutAt || 0, d.revokedAt || 0);
    if (ended >= lastSeen) return false;
    return (Date.now() - lastSeen) < 60_000;
  }

  // Stable device fingerprint for this browser+device combo.
  // Cached in localStorage so reloads don't generate a new one.
  function getDeviceFingerprint() {
    try {
      let fp = localStorage.getItem('infos-device-fp');
      if (!fp) {
        fp = 'd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('infos-device-fp', fp);
      }
      return fp;
    } catch { return 'd_unknown'; }
  }

  // ---- Sound library (Web Audio, no audio files shipped) ----
  // Distinct chimes for distinct events so the user can tell them apart by ear:
  //   self-entry      : you added something (any tab except balance)
  //   balance         : a balance entry was added
  //   incoming        : a NEW entry arrived from sync (other login added it)
  //   reminder        : a reminder/notice arrived for a business
  // Each respects the user's sound preference (state.soundEnabled, default on).
  function soundsOn() { return state.soundEnabled !== false; }
  // Reuse ONE AudioContext for all sounds. Creating a fresh context per sound can
  // hit browser limits (some cap concurrent contexts at ~6) and is wasteful; a
  // single shared, resumed context is more robust and avoids overlap glitches.
  function getAudioCtx() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!window.__infosAudioCtx) window.__infosAudioCtx = new AC();
      const ctx = window.__infosAudioCtx;
      if (ctx.state === 'suspended') { try { ctx.resume(); } catch {} }
      return ctx;
    } catch { return null; }
  }
  function playChord(notes, opts) {
    try {
      if (!soundsOn()) return;
      const ctx = getAudioCtx();
      if (!ctx) return;
      const now = ctx.currentTime;
      const gap = (opts && opts.gap) != null ? opts.gap : 0.12;
      const dur = (opts && opts.dur) != null ? opts.dur : 0.32;
      const vol = (opts && opts.vol) != null ? opts.vol : 0.12;
      const type = (opts && opts.type) || 'sine';
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        const start = now + i * gap;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(vol, start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + dur + 0.02);
        // Free the nodes when done (the context stays alive and reused).
        osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch {} };
      });
    } catch {}
  }
  // Backwards-compatible name used elsewhere.
  function playNoticeChime() { playSelfEntrySound(); }
  // You added an entry yourself (ascending two-note, bright).
  function playSelfEntrySound() { playChord([659.25, 880.00], { gap: 0.10, dur: 0.30, type: 'sine' }); }
  // You added a BALANCE entry (lower, two-note "coin"-ish, triangle wave).
  function playBalanceSound() { playChord([523.25, 392.00], { gap: 0.09, dur: 0.26, vol: 0.13, type: 'triangle' }); }
  // A NEW entry arrived from another login via sync (three soft rising notes).
  function playIncomingSound() { playChord([587.33, 740.00, 932.33], { gap: 0.10, dur: 0.30, vol: 0.11, type: 'sine' }); }
  // A reminder arrived for a business (distinct double-pulse, slightly urgent).
  function playReminderSound() { playChord([880.00, 880.00], { gap: 0.16, dur: 0.22, vol: 0.14, type: 'square' }); }

  // Snapshot of all live item ids per tab — used to detect entries that ARRIVED
  // from sync (so we can chime for them). Returns a Set of "tab:id" keys.
  function itemIdSnapshot() {
    const s = new Set();
    try {
      Object.keys(state.items || {}).forEach(function (tab) {
        (state.items[tab] || []).forEach(function (it) {
          if (it && !it.deleted && it.id != null) s.add(tab + ':' + it.id);
        });
      });
    } catch {}
    return s;
  }
  // Given a before-snapshot, find tabs that gained NEW items and chime accordingly.
  // Reminders/notices get the reminder sound; everything else the incoming sound.
  function chimeForArrivals(beforeSet) {
    try {
      if (!soundsOn()) return;
      let gotReminder = false, gotOther = false, gotBalance = false;
      Object.keys(state.items || {}).forEach(function (tab) {
        (state.items[tab] || []).forEach(function (it) {
          if (!it || it.deleted || it.id == null) return;
          if (beforeSet.has(tab + ':' + it.id)) return; // not new
          if (tab === 'notices') gotReminder = true;
          else if (tab === 'balance') gotBalance = true;
          else gotOther = true;
        });
      });
      // Priority: reminder > balance > other (one sound per refresh, no overlap).
      if (gotReminder) playReminderSound();
      else if (gotBalance) playBalanceSound();
      else if (gotOther) playIncomingSound();

      // Fire a browser/push notification too (if the user granted permission),
      // so arrivals are noticed even when the app isn't focused.
      try {
        if ((gotReminder || gotBalance || gotOther) && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          var title = gotReminder ? 'New reminder' : (gotBalance ? 'New balance entry' : 'New entry');
          var body = gotReminder ? 'A new reminder just arrived.' : (gotBalance ? 'A balance entry was just added.' : 'A new entry was just added.');
          var n = new Notification('Infos — ' + title, { body: body, icon: 'icons/icon-192.png', tag: 'infos-arrival' });
          setTimeout(function () { try { n.close(); } catch (e) {} }, 6000);
        }
      } catch (e) {}
    } catch {}
  }

  // A full-screen, opaque message overlay (no app content shows behind it).
  // Used for the "check your email" confirmation, password-reset notice, and the
  // account-deletion "thank you" screen.
  // opts: { icon, title, message, button: {label, onClick}, spinner: bool }
  //
  // NOTE: this overlay is appended to document.body, which is OUTSIDE #app. The
  // accent CSS variables (--accent-solid / --accent-bg) are only defined as
  // descendants of #app, so they resolve to nothing here. We therefore resolve a
  // concrete accent color in JS and inline it, so the button + icon are always
  // visible regardless of where the overlay mounts.
  function showFullScreenMessage(opts) {
    const o = opts || {};
    let el = document.getElementById('fullscreen-message');
    if (el) el.remove();
    // Resolve a concrete accent color (computed style of #app falls back to blue).
    let accent = '#378ADD';
    try {
      const c = getComputedStyle(app).getPropertyValue('--accent-solid').trim();
      if (c) accent = c;
      if (state.customAccent) accent = state.customAccent;
    } catch {}
    const accentSoft = hexToRgba(accent, 0.14);
    const isDark = (typeof isAppDark === 'function') ? isAppDark() : false;
    const titleColor = isDark ? '#F5F5F2' : '#1A1A17';
    const subColor = isDark ? '#A8A8A2' : '#6B6B64';

    el = document.createElement('div');
    el.id = 'fullscreen-message';
    el.className = 'loading-splash visible';
    // Force fully-opaque + interactive immediately (don't rely on the .visible
    // CSS transition, which can leave the panel/buttons looking faint).
    el.style.cssText = 'flex-direction:column;opacity:1;pointer-events:auto;transition:none;z-index:2147483600;';
    const iconHTML = o.icon
      ? `<div style="width:72px;height:72px;border-radius:50%;background:${accentSoft};display:flex;align-items:center;justify-content:center;margin-bottom:20px;"><i class="ti ${esc(o.icon)}" style="font-size:34px;color:${accent};"></i></div>`
      : '';
    const spinnerHTML = o.spinner
      ? `<div style="width:26px;height:26px;margin-top:22px;border-radius:50%;border:3px solid ${accentSoft};border-top-color:${accent};animation:bootspin .8s linear infinite;"></div>`
      : '';
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;text-align:center;padding:32px;max-width:380px;">
        ${iconHTML}
        <div style="font-size:21px;font-weight:700;color:${titleColor};line-height:1.3;">${esc(o.title || '')}</div>
        <div style="font-size:14px;line-height:1.6;color:${subColor};margin-top:12px;">${esc(o.message || '')}</div>
        ${o.button ? `<button id="fsm-btn" type="button" style="margin-top:24px;min-width:160px;padding:13px 22px;font-size:14px;font-weight:700;background:${accent};color:#fff;border:none;border-radius:10px;cursor:pointer;opacity:1;box-shadow:0 2px 8px ${hexToRgba(accent,0.35)};">${esc(o.button.label || 'OK')}</button>` : ''}
        ${spinnerHTML}
      </div>`;
    document.body.appendChild(el);
    if (o.button) {
      const b = el.querySelector('#fsm-btn');
      if (b) b.onclick = () => { try { if (o.button.onClick) o.button.onClick(); } catch {} };
    }
    return el;
  }

  // Small helper: convert #RRGGBB (or #RGB) to an rgba() string with the given alpha.
  function hexToRgba(hex, alpha) {
    let h = String(hex || '').trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6) return `rgba(55,138,221,${alpha})`;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function showLoadingSplash(displayName, opts) {
    let el = document.getElementById('loading-splash');
    if (el) el.remove();
    el = document.createElement('div');
    el.id = 'loading-splash';
    el.className = 'loading-splash';
    const initial = (displayName || 'I').charAt(0).toUpperCase();
    const o = opts || {};
    const action = o.action || 'signing-in'; // 'signing-in' | 'creating' | 'switching'
    const actionVerb = action === 'creating' ? 'Creating your account' : action === 'switching' ? 'Switching account' : 'Welcome';
    const subtitle = o.subtitle ||
      (action === 'creating' ? 'Setting up your private workspace' :
       action === 'switching' ? 'Preparing your view' :
       'Loading your workspace');
    // Splash tint follows the current theme's accent color. The overlay lives on
    // <body> (outside #app where the accent var is defined), so read the accent
    // from #app's computed style. A business/owner color override may be passed in.
    let tint = o.color;
    if (!tint) {
      try {
        const appEl = document.getElementById('app');
        tint = (appEl ? getComputedStyle(appEl).getPropertyValue('--accent-solid').trim() : '') ||
               getComputedStyle(document.documentElement).getPropertyValue('--accent-solid').trim() || '#378ADD';
      } catch { tint = '#378ADD'; }
    }
    el.style.setProperty('--splash-tint', tint);

    // Stage messages that advance during the load — feels like progress is happening
    const stages = action === 'creating' ? [
      'Securing your data',
      'Personalizing your space',
      'Ready'
    ] : action === 'switching' ? [
      'Saving current view',
      'Loading data',
      'Ready'
    ] : [
      'Verifying credentials',
      'Loading workspace',
      'Ready'
    ];

    el.innerHTML = `
      <div class="splash-bg-mesh">
        <div class="splash-orb splash-orb-1"></div>
        <div class="splash-orb splash-orb-2"></div>
        <div class="splash-orb splash-orb-3"></div>
      </div>
      <div class="splash-particles" aria-hidden="true">
        ${Array.from({length: 12}, (_, i) => `<div class="splash-particle p${i}"></div>`).join('')}
      </div>
      <div class="splash-content">
        <div class="splash-brand">
          ${appLogoSVG(22)}
          <span>Infos</span>
        </div>

        <div class="splash-stage">
          <svg class="splash-avatar-ring" width="148" height="148" viewBox="0 0 148 148" aria-hidden="true">
            <defs>
              <linearGradient id="splash-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="var(--accent-solid)"/>
                <stop offset="100%" stop-color="var(--accent-solid)" stop-opacity="0.3"/>
              </linearGradient>
            </defs>
            <circle class="splash-ring-track" cx="74" cy="74" r="68" fill="none" stroke="currentColor" stroke-width="2" stroke-opacity="0.08"/>
            <circle class="splash-ring-progress" cx="74" cy="74" r="68" fill="none" stroke="url(#splash-grad)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="427" stroke-dashoffset="427" transform="rotate(-90 74 74)"/>
          </svg>
          <div class="splash-avatar-glow"></div>
          <div class="splash-avatar splash-avatar-logo">
            ${appLogoSVG(64)}
          </div>
        </div>

        <div class="splash-action-label">${esc(actionVerb)}</div>
        <div class="splash-display-name">${esc(displayName || 'Infos')}</div>
        <div class="splash-subtitle">${esc(subtitle)}</div>

        <div class="splash-stages" role="status" aria-live="polite">
          ${stages.map((s, i) => `
            <div class="splash-stage-step" data-stage="${i}">
              <div class="splash-stage-icon">
                <svg class="splash-stage-check" viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 12.5L9 17.5L20 6.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
                <div class="splash-stage-pulse"></div>
              </div>
              <span class="splash-stage-label">${esc(s)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(el);

    // Drive the stage progression on a timeline so it feels purposeful, not random
    const totalMs = o.totalMs || 2800;
    const stepEls = el.querySelectorAll('.splash-stage-step');
    stepEls[0]?.classList.add('active');
    setTimeout(() => {
      stepEls[0]?.classList.remove('active');
      stepEls[0]?.classList.add('done');
      stepEls[1]?.classList.add('active');
    }, Math.floor(totalMs * 0.35));
    setTimeout(() => {
      stepEls[1]?.classList.remove('active');
      stepEls[1]?.classList.add('done');
      stepEls[2]?.classList.add('active');
    }, Math.floor(totalMs * 0.7));
    setTimeout(() => {
      stepEls[2]?.classList.remove('active');
      stepEls[2]?.classList.add('done');
    }, Math.floor(totalMs * 0.95));

    // Make the splash fully opaque IMMEDIATELY (no fade-in). The fade-in left the
    // splash transparent for the first frames, so the dashboard underneath showed
    // through — the "dashboard, then welcome" glitch. We force opacity:1 inline so
    // it covers the screen the instant it's added, before any dashboard render.
    el.style.opacity = '1';
    el.style.pointerEvents = 'auto';
    el.classList.add('visible');
    // (No requestAnimationFrame fade — the inline opacity above wins instantly.)
  }
  function hideLoadingSplash() {
    const el = document.getElementById('loading-splash');
    if (!el) return;
    el.classList.add('exiting');
    setTimeout(() => el.parentNode && el.parentNode.removeChild(el), 450);
  }

  // Track the last 6 sign-ins for one-tap re-auth on the sign-in screen.
  function recordSignin(entry) {
    if (!entry.email) return;
    if (!state.recentSignins) state.recentSignins = [];
    state.recentSignins = state.recentSignins.filter(e => e.email !== entry.email);
    state.recentSignins.unshift({ ...entry, lastSignIn: Date.now() });
    if (state.recentSignins.length > 6) state.recentSignins = state.recentSignins.slice(0, 6);
  }

  // Remove a recent sign-in (e.g. from "forget" button on the chip).
  function forgetSignin(email) {
    state.recentSignins = (state.recentSignins || []).filter(e => e.email !== email);
    persistAll();
  }
  function doLogout() {
    const isBiz = !!state.bizContext;
    confirmAction({
      title: 'Sign out?',
      message: isBiz ? "You'll be returned to the sign-in screen. Sign in again with your business credentials to view items." : "You'll be returned to the sign-in screen. Your data stays saved on this device.",
      confirmLabel: 'Sign out',
      danger: false,
      onConfirm: () => logout()
    });
  }

  // ---------- Switch-account picker ----------
  // Build the list of accounts this device knows about. Owner accounts from state.accounts,
  // plus each business (since the owner can switch into any of their businesses' read-only view).
  // The currently-signed-in account is filtered out.
  function listSwitchableAccounts() {
    const out = [];
    const currentEmail = state.user?.email?.toLowerCase();
    const currentBizId = state.bizContext || null;
    (state.accounts || []).forEach(a => {
      if (a.email.toLowerCase() === currentEmail && !currentBizId) return;
      out.push({ kind: 'owner', email: a.email, name: a.name });
    });
    (state.businesses || []).forEach(b => {
      if (b.id === currentBizId) return;
      out.push({ kind: 'business', email: b.email, name: b.name, bizId: b.id });
    });
    return out;
  }

  function openSwitchAccountPicker() {
    const accounts = listSwitchableAccounts();
    if (!accounts.length) {
      toast('No other accounts on this device yet');
      return;
    }
    const rows = accounts.map(a => {
      const initial = (a.name || a.email).charAt(0).toUpperCase();
      const kindLabel = a.kind === 'business' ? 'Business' : 'Owner';
      return `<button type="button" class="switch-account-row" data-switch-email="${esc(a.email)}" data-switch-kind="${a.kind}" data-switch-bizid="${esc(a.bizId || '')}">
        <span class="recent-avatar recent-avatar-${a.kind}">${esc(initial)}</span>
        <span class="recent-meta">
          <span class="recent-name">${esc(a.name)}</span>
          <span class="recent-sub">${kindLabel} · ${esc(a.email)}</span>
        </span>
        <i class="ti ti-arrow-right" style="font-size:16px;color:var(--text-tertiary);"></i>
      </button>`;
    }).join('');
    openModal(`
      <div class="modal-head">
        <h3>Switch account</h3>
        <button id="m-close" class="btn-icon" aria-label="Close"><i class="ti ti-x"></i></button>
      </div>
      <div class="modal-body">
        <div class="form-hint" style="margin-bottom:14px;">Tap any account to switch instantly. No password needed — all accounts are saved on this device.</div>
        <div class="switch-account-list">${rows}</div>
      </div>
    `);
    $('#m-close').onclick = closeModal;
    document.querySelectorAll('[data-switch-email]').forEach(btn => btn.onclick = () => {
      const email = btn.dataset.switchEmail;
      const kind = btn.dataset.switchKind;
      const bizId = btn.dataset.switchBizid || null;
      closeModal();
      performAccountSwitch({ email, kind, bizId });
    });
  }

  // Show a 2-second splash, then complete the switch.
  function performAccountSwitch({ email, kind, bizId }) {
    // If we're currently in a BUSINESS (shared cloud) session, we cannot hot-swap
    // identities in place — the business holds a live Supabase session and the
    // owner/other account needs its own real sign-in. Sign out cleanly and reload;
    // the device restores its own owner state, then the user picks the account.
    // (Trying to login() over a shared session is what left the switch splash
    // stuck on "Ready" forever.)
    if (state.__sharedMode) {
      showSwitchSplash(kind === 'business' ? (bizById(bizId)?.name || 'Business') : 'your account',
                       email || '', kind, null);
      state.__switchInProgress = true;
      (async () => {
        try {
          if (sharedRealtimeUnsub) sharedRealtimeUnsub();
        } catch {}
        sharedRealtimeUnsub = null;
        clearTimeout(sharedSaveTimer);
        state.__sharedMode = false; state.__sharedBusinessId = null; state.__sharedVersion = 0;
        try {
          if (window.InfosSupabase && window.InfosSupabase.Auth) {
            await Promise.race([
              window.InfosSupabase.Auth.signOut(),
              new Promise(r => setTimeout(r, 2500))
            ]);
          }
        } catch {}
        try {
          Object.keys(localStorage).forEach(k => {
            if (/^sb-.*-auth-token$/.test(k) || /supabase\.auth\.token/.test(k)) localStorage.removeItem(k);
          });
        } catch {}
        location.reload();
      })();
      return;
    }

    let displayName, sub, switchColor = null;
    if (kind === 'business') {
      const b = bizById(bizId);
      if (!b) { toast("That business is no longer available"); return; }
      displayName = b.name;
      sub = b.email;
      switchColor = b.color || null;
    } else {
      const acc = (state.accounts || []).find(a => a.email.toLowerCase() === email.toLowerCase());
      if (!acc) { toast("That account is no longer available"); return; }
      displayName = acc.name;
      sub = acc.email;
      switchColor = state.customAccent || null;
    }
    showSwitchSplash(displayName, sub, kind, switchColor);
    state.__switchInProgress = true;
    // Sign out current session silently, then sign in as the chosen account.
    setTimeout(() => {
      // Quiet sign-out: don't show toast or reset auth screen
      state.user = null; state.bizContext = null; state.activeBizId = 'all'; state.activeTagId = null;
      state.history = [];
      if (window.Crypto) window.Crypto.lock();
      // Sign in as the chosen account
      if (kind === 'business') {
        const b = bizById(bizId);
        login(b.name, b.email, b.id);
      } else {
        const acc = (state.accounts || []).find(a => a.email.toLowerCase() === email.toLowerCase());
        login(acc.name, acc.email, null);
      }
      state.__switchInProgress = false;
      hideSwitchSplash();
      toast(`Switched to ${displayName}`);
    }, 1800); // 2s total counting fade-in
  }

  function showSwitchSplash(name, sub, kind, color) {
    let splash = document.getElementById('switch-splash');
    if (splash) splash.remove();
    splash = document.createElement('div');
    splash.id = 'switch-splash';
    splash.className = 'switch-splash';
    const kindLabel = kind === 'business' ? 'Business workspace' : 'Personal account';
    const tint = color || getComputedStyle(document.documentElement).getPropertyValue('--accent-solid').trim() || '#378ADD';
    splash.style.setProperty('--splash-tint', tint);
    splash.innerHTML = `
      <div class="splash-bg-mesh">
        <div class="splash-orb splash-orb-1"></div>
        <div class="splash-orb splash-orb-2"></div>
        <div class="splash-orb splash-orb-3"></div>
      </div>
      <div class="splash-particles" aria-hidden="true">
        ${Array.from({length: 12}, (_, i) => `<div class="splash-particle p${i}"></div>`).join('')}
      </div>
      <div class="splash-content">
        <div class="splash-brand">
          ${appLogoSVG(22)}
          <span>Infos</span>
        </div>

        <div class="splash-stage">
          <svg class="splash-avatar-ring" width="148" height="148" viewBox="0 0 148 148" aria-hidden="true">
            <defs>
              <linearGradient id="switch-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="var(--accent-solid)"/>
                <stop offset="100%" stop-color="var(--accent-solid)" stop-opacity="0.3"/>
              </linearGradient>
            </defs>
            <circle class="splash-ring-track" cx="74" cy="74" r="68" fill="none" stroke="currentColor" stroke-width="2" stroke-opacity="0.08"/>
            <circle class="splash-ring-progress" cx="74" cy="74" r="68" fill="none" stroke="url(#switch-grad)" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="427" stroke-dashoffset="427" transform="rotate(-90 74 74)"/>
          </svg>
          <div class="splash-avatar-glow"></div>
          <div class="splash-avatar splash-avatar-logo recent-avatar-${esc(kind || 'owner')}">
            ${appLogoSVG(64)}
          </div>
        </div>

        <div class="splash-action-label">Switching to ${esc(kindLabel.toLowerCase())}</div>
        <div class="splash-display-name">${esc(name)}</div>
        <div class="splash-subtitle">${esc(sub)}</div>

        <div class="splash-stages" role="status" aria-live="polite">
          <div class="splash-stage-step active" data-stage="0">
            <div class="splash-stage-icon">
              <svg class="splash-stage-check" viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 12.5L9 17.5L20 6.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <div class="splash-stage-pulse"></div>
            </div>
            <span class="splash-stage-label">Saving current view</span>
          </div>
          <div class="splash-stage-step" data-stage="1">
            <div class="splash-stage-icon">
              <svg class="splash-stage-check" viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 12.5L9 17.5L20 6.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <div class="splash-stage-pulse"></div>
            </div>
            <span class="splash-stage-label">Switching identity</span>
          </div>
          <div class="splash-stage-step" data-stage="2">
            <div class="splash-stage-icon">
              <svg class="splash-stage-check" viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 12.5L9 17.5L20 6.5" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <div class="splash-stage-pulse"></div>
            </div>
            <span class="splash-stage-label">Ready</span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(splash);

    const totalMs = 1800;
    const stepEls = splash.querySelectorAll('.splash-stage-step');
    setTimeout(() => {
      stepEls[0]?.classList.remove('active');
      stepEls[0]?.classList.add('done');
      stepEls[1]?.classList.add('active');
    }, Math.floor(totalMs * 0.35));
    setTimeout(() => {
      stepEls[1]?.classList.remove('active');
      stepEls[1]?.classList.add('done');
      stepEls[2]?.classList.add('active');
    }, Math.floor(totalMs * 0.7));
    setTimeout(() => {
      stepEls[2]?.classList.remove('active');
      stepEls[2]?.classList.add('done');
    }, Math.floor(totalMs * 0.95));

    requestAnimationFrame(() => splash.classList.add('switch-splash-in'));
    window.__InfosIcons?.replaceIcons(splash);
  }
  function hideSwitchSplash() {
    const splash = document.getElementById('switch-splash');
    if (!splash) return;
    splash.classList.remove('switch-splash-in');
    splash.classList.add('switch-splash-out');
    setTimeout(() => { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 450);
  }

  function logout() {
    // Clear the synchronous boot hint so a refresh after logout correctly shows
    // the sign-in screen (not a flash of the app).
    try { localStorage.removeItem('infos-boot-hint'); } catch {}
    try { localStorage.removeItem('infos-last-tab'); } catch {}
    // SHARED ACCESS: tear down the shared session cleanly. Flush any pending
    // edit to the shared row FIRST, then stop realtime and clear shared flags so
    // the emptied state isn't pushed up and local owner data isn't touched.
    const wasShared = !!state.__sharedMode;
    if (wasShared) {
      try { pushSharedState(true); } catch {}
      try { if (sharedRealtimeUnsub) sharedRealtimeUnsub(); } catch {}
      sharedRealtimeUnsub = null;
      clearTimeout(sharedSaveTimer);
    }
    // Push any final local changes to the cloud, then sign out of Supabase.
    if (window.InfosSupabase && window.InfosSupabase.configured()) {
      try {
        if (!wasShared && window.Sync && Sync.status().enabled) { Sync.pushNow(state).catch(() => {}); }
        window.InfosSupabase.Auth.signOut().catch(() => {});
        if (window.Sync) Sync.disable();
      } catch {}
    }
    // Stop the heartbeat and mark this device's session ended for the biz it was in
    if (state.bizContext) endBizDeviceSessionLocal(state.bizContext);
    if (window.__bizHeartbeatId) { clearInterval(window.__bizHeartbeatId); window.__bizHeartbeatId = null; }
    try { clearInterval(window.__sharedPoll); } catch {}
    try { clearInterval(window.__ownerSharedPoll); } catch {}
    // OWNER: tear down any shared-business realtime subscriptions opened for this
    // owner so they don't leak across sign-out / account switch.
    try { ownerSharedUnsubs.forEach(fn => { try { fn(); } catch {} }); } catch {}
    ownerSharedUnsubs = [];
    // A business login holds only the shared business's data in memory; reload to
    // restore this device's own (owner/local) state cleanly from storage.
    if (wasShared) {
      // Capture what we need to flush the final save BEFORE clearing shared flags.
      const flushCloudId = state.__sharedBusinessId;
      const flushSlice = (() => { try { return Slice.memberStateToSlice(state); } catch { return null; } })();
      const flushExpected = state.__sharedVersion || 0;
      state.__sharedMode = false; state.__sharedBusinessId = null; state.__sharedVersion = 0;
      (async () => {
        // CRITICAL: await the final data write so the last entry isn't lost to a
        // reload that races the debounced push.
        try {
          if (flushCloudId && flushSlice && window.InfosSupabase && window.InfosSupabase.configured()) {
            await Promise.race([
              window.InfosSupabase.adapter.saveSharedState(flushCloudId, flushSlice, flushExpected),
              new Promise(r => setTimeout(r, 2500))
            ]);
          }
        } catch {}
        // Then wait for Supabase to clear its session token BEFORE we reload, so
        // boot doesn't detect a still-valid session and auto-restore the business.
        try {
          if (window.InfosSupabase && window.InfosSupabase.Auth) {
            await Promise.race([
              window.InfosSupabase.Auth.signOut(),
              new Promise(r => setTimeout(r, 2500))
            ]);
          }
        } catch {}
        // Belt-and-suspenders: scrub any lingering Supabase auth token so boot
        // can't find a session to restore, even if signOut was slow/failed.
        try {
          Object.keys(localStorage).forEach(k => {
            if (/^sb-.*-auth-token$/.test(k) || /supabase\.auth\.token/.test(k)) localStorage.removeItem(k);
          });
        } catch {}
        location.reload();
      })();
      return;
    }
    state.user = null; state.bizContext = null; state.activeBizId = 'all'; state.activeTagId = null;
    state.history = [];
    headerBadge.hidden = true;
    screenAuth.classList.add('screen-active'); screenMain.classList.remove('screen-active');
    $('#auth-mode-forgot').hidden = true; $('#auth-mode-signin').hidden = false;
    // Reset auth screen to sign-in mode (in case user was in signup)
    setAuthMode('signin');
    // Clear all auth inputs
    ['#auth-name','#auth-email','#auth-password'].forEach(s => { const el = document.querySelector(s); if (el) el.value = ''; });
    const terms = document.querySelector('#auth-terms'); if (terms) terms.checked = false;
    const errEl = document.querySelector('#auth-error'); if (errEl) errEl.hidden = true;
    applyPerBizTheme();
    if (window.Crypto) window.Crypto.lock();
    persistAll(); toast('Signed out');
    renderRecentSignins();
  }

  // ---------- Onboarding ----------
  let onbSlide = 1;
  function showOnbSlide(n) {
    onbSlide = n;
    $$('.onb-slide', screenOnb).forEach(el => el.hidden = (parseInt(el.dataset.slide) !== n));
    $$('.onb-dot', screenOnb).forEach(el => el.classList.toggle('active', parseInt(el.dataset.go) === n));
    $('#onb-next').textContent = n === 4 ? 'Get started' : 'Next';
  }
  $('#onb-next').onclick = () => { if (onbSlide < 4) showOnbSlide(onbSlide + 1); else { state.onboarded = true; persistAll(); screenOnb.hidden = true; haptic(); } };
  $('#onb-skip').onclick = () => { state.onboarded = true; persistAll(); screenOnb.hidden = true; };
  $$('.onb-dot', screenOnb).forEach(d => d.onclick = () => showOnbSlide(parseInt(d.dataset.go)));

  // ---------- Renderers ----------
  function viewOnlyBanner() {
    // v7: hidden — business users see no badges or banners
    return '';
  }
  function activeTagBanner() {
    if (!state.activeTagId) return '';
    let tag = null;
    state.businesses.forEach(b => { if (!tag) tag = b.tags.find(t => t.id === state.activeTagId); });
    if (!tag) return '';
    return `<div class="info-banner" style="margin-bottom:14px;background:${tag.color}22;color:${readableColor(tag.color)};border:1px solid ${tag.color}55;"><i class="ti ti-tag"></i><span>Filtered by tag: <strong>${esc(tag.name)}</strong></span><button class="btn-icon" id="clear-tag-filter" style="margin-left:auto;color:inherit;"><i class="ti ti-x"></i></button></div>`;
  }
  function bindClearTagFilter() {
    const btn = $('#clear-tag-filter');
    if (btn) btn.onclick = () => { state.activeTagId = null; persistAll(); const cur = state.history[state.history.length-1]?.split(':')[0]; if (cur && getTabDef(cur)) { state.history.pop(); setActive(cur,'fade'); } };
  }

  function emptyState(icon, title, sub, ctaLabel, ctaFn) {
    return `<div class="empty-state">
      <div class="empty-icon"><i class="ti ti-${icon}"></i></div>
      <h3>${title}</h3>
      <p>${sub}</p>
      ${ctaLabel ? `<button class="cta-button" id="empty-cta"><i class="ti ti-plus"></i>${esc(ctaLabel)}</button>` : ''}
    </div>`;
  }
  function bindEmptyCTA(fn) { const b = $('#empty-cta'); if (b) b.onclick = fn; }

  function skeletonList(n) {
    let html = '';
    for (let i = 0; i < (n || 4); i++) {
      html += `<div class="skeleton-card">
        <div class="skeleton skeleton-avatar"></div>
        <div class="skeleton-body">
          <div class="skeleton skeleton-line medium"></div>
          <div class="skeleton skeleton-line short"></div>
        </div>
      </div>`;
    }
    return html;
  }
  function showSkeleton(n) {
    pageContent.innerHTML = skeletonList(n);
  }

  function renderItemCard(it, tabKey, opts) {
    opts = opts || {};
    // Safety: bulkSelected must be a Set. If state was rehydrated from storage or
    // a shared snapshot, a Set can come back as a plain array/object without
    // .has()/.add(), which would throw here and abort the entire list render
    // (causing blank tabs). Normalize defensively.
    if (!state.bulkSelected || typeof state.bulkSelected.has !== 'function') {
      state.bulkSelected = new Set(Array.isArray(state.bulkSelected) ? state.bulkSelected : []);
    }
    const checkable = state.bulkMode && !isViewOnly();
    const checked = state.bulkSelected.has(it.id);
    const isNotice = tabKey === 'notices';
    const isCreds = tabKey === 'idpass-system' || tabKey === 'idpass-accounts';
    const primaryText = it.title || it.name || 'Untitled';
    const secondaryText = isNotice ? (it.message || '') : (it.shortName || it.description || '');

    // v15: number badge for non-notice tabs
    const numberBadge = (opts.number != null)
      ? `<div class="card-number" aria-label="Item ${opts.number}">${opts.number}</div>`
      : '';

    // v15: reorder controls — only shown when an owner has filtered to a specific biz on a numbered tab
    const reorderControls = opts.reorder
      ? `<div class="card-reorder-stack" onclick="event.stopPropagation();">
           <button class="card-reorder-btn" data-reorder="up" data-reorder-id="${esc(it.id)}" ${opts.reorder.canMoveUp ? '' : 'disabled'} aria-label="Move up" title="Move up"><i class="ti ti-chevron-up"></i></button>
           <button class="card-reorder-btn" data-reorder="down" data-reorder-id="${esc(it.id)}" ${opts.reorder.canMoveDown ? '' : 'disabled'} aria-label="Move down" title="Move down"><i class="ti ti-chevron-down"></i></button>
         </div>`
      : '';

    let iconHTML = '';
    if (isNotice) {
      const tone = it.tone || 'info';
      iconHTML = `<div style="width:34px;height:34px;border-radius:var(--radius-md);background:var(--${tone}-bg);color:var(--${tone}-fg);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="ti ti-${it.icon || 'info-circle'}" style="font-size:17px;"></i></div>`;
    } else if (tabKey === 'schedule' && it.photo) {
      iconHTML = `<div class="schedule-thumb" data-schedule-photo="${esc(it.id)}" style="width:46px;height:46px;border-radius:var(--radius-sm);background:var(--surface-1);overflow:hidden;flex-shrink:0;cursor:zoom-in;"><img src="${esc(it.photo)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;"/></div>`;
    } else if (it.photo && state.customTabs.some(t => t.id === tabKey)) {
      // Custom-tab item with an optional picture → show thumbnail
      iconHTML = `<div class="schedule-thumb" data-schedule-photo="${esc(it.id)}" style="width:46px;height:46px;border-radius:var(--radius-sm);background:var(--surface-1);overflow:hidden;flex-shrink:0;cursor:zoom-in;"><img src="${esc(it.photo)}" alt="" style="width:100%;height:100%;object-fit:cover;display:block;"/></div>`;
    }
    // For all other tabs (Games, System, ID & Pass, Balance, custom tabs without a
    // photo) NO generic placeholder icon is shown to the left of the entry name —
    // only meaningful imagery (notice tones, photo thumbnails) remains.

    // Credentials row (username + password) for ID & Pass tabs
    let credsHTML = '';
    if (isCreds && (it.username || it.password)) {
      const parts = [];
      if (it.username) parts.push(`<div class="cred-row"><span class="cred-label">user</span><span class="cred-value">${esc(it.username)}</span><button class="btn-icon copy-link-btn" data-copy="${esc(it.username)}" data-copy-label="Username" aria-label="Copy username" title="Copy username"><i class="ti ti-copy"></i></button></div>`);
      if (it.password) {
        parts.push(`<div class="cred-row"><span class="cred-label">pass</span><span class="cred-value cred-password" data-show="1" data-real="${esc(it.password)}">${esc(it.password)}</span><button class="btn-icon copy-link-btn" data-copy="${esc(it.password)}" data-copy-label="Password" aria-label="Copy password" title="Copy password"><i class="ti ti-copy"></i></button></div>`);
      }
      credsHTML = `<div class="cred-stack">${parts.join('')}</div>`;
    }

    const linkBtn = it.link ? `<button class="btn-icon copy-link-btn" data-copy="${esc(it.link)}" data-copy-label="Link" aria-label="Copy link" title="Copy link"><i class="ti ti-copy"></i></button>` : '';
    // Quick-delete button on every entry card (owner only; members are view-only).
    // Trash items use a "delete forever" variant.
    const isTrashItem = !!it.deleted;
    const deleteBtn = !isViewOnly()
      ? `<button class="btn-icon btn-icon-danger card-delete-btn" data-card-delete="${esc(it.id)}" data-card-tab="${esc(tabKey)}" aria-label="Delete entry" title="${isTrashItem ? 'Delete forever' : 'Delete'}"><i class="ti ti-trash"></i></button>`
      : '';

    // Timestamps
    const created = itemCreatedAt(it);
    const updated = itemUpdatedAt(it);
    const wasEdited = !!(it.history || []).find(e => e.action === 'edited');
    const tsLine = `<div class="item-meta-line">Created ${formatDateTime(created)}${wasEdited ? ` · Edited ${formatDateTime(updated)}` : ''}</div>`;

    return `<div class="card-row clickable ${it.pinned ? 'pinned' : ''} ${checked ? 'selected' : ''} ${opts.number != null ? 'has-number' : ''} ${opts.reorder ? 'has-reorder' : ''}" data-item="${it.id}">
      <div style="display:flex;align-items:flex-start;gap:12px;">
        ${checkable ? `<div class="card-checkbox ${checked ? 'checked' : ''}" data-check="${it.id}">${checked ? '<i class="ti ti-check"></i>' : ''}</div>` : ''}
        ${numberBadge}
        ${iconHTML}
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
            ${it.pinned ? '<i class="ti ti-pin-filled" style="font-size:12px;color:var(--accent-solid);"></i>' : ''}
            <strong class="item-title" style="font-size:14px;font-weight:600;color:var(--text-primary);">${esc(primaryText)}</strong>
          </div>
          ${secondaryText ? `<div class="item-secondary" style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;line-height:1.5;">${esc(secondaryText)}</div>` : ''}
          ${credsHTML}
          ${it.link ? `<a class="item-link-line" href="${esc(safeUrl(it.link))}" target="_blank" rel="noopener noreferrer" data-stop-card="1"><i class="ti ti-link" style="font-size:12px;"></i><span>${esc(linkDisplay(it.link))}</span></a>` : ''}
          ${(() => {
            const bids = itemBizIds(it);
            const hasTags = it.tagIds && it.tagIds.length;
            if (!bids.length && !hasTags) return '';
            const tagScope = bids[0] || null;
            return `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">${bizChipsHTML(bids, true)}${tagScope ? tagChipsHTML(tagScope, it.tagIds) : ''}</div>`;
          })()}
          ${tsLine}
        </div>
        ${reorderControls}
        <div class="card-action-stack" onclick="event.stopPropagation();">
          ${linkBtn}
          ${deleteBtn}
        </div>
      </div>
    </div>`;
  }

  // ---------- Link display helper ----------
  function linkDisplay(url) {
    if (!url) return '';
    let s = String(url).trim();
    s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
    if (s.length > 42) s = s.slice(0, 40) + '…';
    return s;
  }
  // Neutralize dangerous URL schemes for href attributes (defense-in-depth).
  // Allows http(s), mailto, tel; anything else (javascript:, data:, etc.) becomes inert.
  function safeUrl(url) {
    const s = String(url || '').trim();
    if (/^(https?:|mailto:|tel:)/i.test(s)) return s;
    // Bare domain like "example.com/x" → assume https
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return 'https://' + s;
    return '#';
  }

  // ---------- Item timestamps ----------
  function itemCreatedAt(it) {
    if (it.createdAt) return it.createdAt;
    const h = it.history && it.history.find(e => e.action === 'created');
    return h ? h.ts : (it.history?.[0]?.ts || 0);
  }
  function itemUpdatedAt(it) {
    if (it.updatedAt) return it.updatedAt;
    const h = it.history && [...it.history].reverse().find(e => e.action === 'edited');
    return h ? h.ts : itemCreatedAt(it);
  }
  function formatDateTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay) return `Today, ${time}`;
    const yesterday = new Date(today.getTime() - 86400000);
    if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }) + ', ' + time;
  }

  // Wire the inline search + business filter at top of any list tab.
  // Debounces typing and only re-renders the affected tab.
  let listSearchTimer = null;
  function wireListToolbar(c, tabKey) {
    const inp = $('#list-search-input');
    if (inp) {
      inp.oninput = () => {
        const v = inp.value;
        state.listSearch[tabKey] = v;
        clearTimeout(listSearchTimer);
        listSearchTimer = setTimeout(() => {
          state.history.pop(); setActive(tabKey, 'fade');
          // Refocus the input after re-render so typing feels uninterrupted
          requestAnimationFrame(() => {
            const again = document.getElementById('list-search-input');
            if (again) { again.focus(); again.setSelectionRange(v.length, v.length); }
          });
        }, 180);
      };
      inp.onkeydown = (e) => { if (e.key === 'Escape') { inp.value = ''; state.listSearch[tabKey] = ''; state.history.pop(); setActive(tabKey, 'fade'); } };
    }
    const clr = $('#list-search-clear');
    if (clr) clr.onclick = () => { state.listSearch[tabKey] = ''; state.history.pop(); setActive(tabKey, 'fade'); };
    const sel = $('#list-biz-filter');
    if (sel) sel.onchange = () => {
      state.activeBizId = sel.value;
      state.activeTagId = null;
      updateActiveBizDisplay();
      persistAll();
      state.history.pop(); setActive(tabKey, 'fade');
    };
  }

  function renderListTab(c, tabKey, emptyIcon, emptyTitle, emptySub) {
    // v15: tabs other than 'notices' get numbering + per-biz reorder.
    const isNumbered = tabKey !== 'notices';

    // Apply biz/tag filter, then inline search query
    let all = filterByBiz(state.items[tabKey] || []);

    // v15: apply per-business custom order when an owner is filtered to a specific biz.
    // Order is stored at state.itemOrder[bizId][tabKey] = [itemId, ...].
    const orderingBizId = (state.bizContext) ? state.bizContext
                       : (state.activeBizId && state.activeBizId !== 'all' && state.activeBizId !== 'none') ? state.activeBizId
                       : null;
    const canReorder = isNumbered && !isViewOnly() && !!orderingBizId;
    if (canReorder) {
      const saved = state.itemOrder?.[orderingBizId]?.[tabKey] || [];
      const indexed = new Map(saved.map((id, i) => [id, i]));
      // Anything saved comes first in saved-order; new items append in their natural order.
      all = [...all].sort((a, b) => {
        const ai = indexed.has(a.id) ? indexed.get(a.id) : 1e9;
        const bi = indexed.has(b.id) ? indexed.get(b.id) : 1e9;
        if (ai !== bi) return ai - bi;
        return (a.createdAt || 0) - (b.createdAt || 0);
      });
    }

    const q = (state.listSearch && state.listSearch[tabKey] || '').toLowerCase().trim();
    if (q) {
      all = all.filter(it => {
        const hay = [it.title, it.name, it.shortName, it.message, it.description, it.username, it.link]
          .filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      });
    }
    let html = viewOnlyBanner();

    // Universal search bar + business filter — always on top of the list
    const hasBiz = state.businesses.length > 0;
    html += `
      <div class="list-toolbar">
        <div class="list-search-wrap">
          <i class="ti ti-search list-search-icon"></i>
          <input id="list-search-input" type="search" placeholder="Search ${esc(tabDisp(tabKey).name.toLowerCase())}…" value="${esc(q)}" autocomplete="off"/>
          ${q ? '<button class="input-icon-btn" id="list-search-clear" type="button" aria-label="Clear"><i class="ti ti-x"></i></button>' : ''}
        </div>
        ${!isViewOnly() && hasBiz ? `
          <select id="list-biz-filter" class="list-biz-filter">
            <option value="all" ${state.activeBizId === 'all' ? 'selected' : ''}>All businesses</option>
            ${state.businesses.map(b => `<option value="${b.id}" ${state.activeBizId === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
          </select>
        ` : ''}
      </div>
    `;
    html += activeTagBanner();

    if (canReorder) {
      const bizName = bizById(orderingBizId)?.name || '';
      html += `<div class="reorder-banner"><i class="ti ti-arrows-sort"></i><span>You can reorder items for <strong>${esc(bizName)}</strong> using the arrows on each card.</span></div>`;
    }

    if (!isViewOnly()) {
      const verb = tabKey === 'notices' ? 'New notice' : 'New entry';
      html += `<div class="tab-actions-bar"><button class="btn-primary btn-block tab-add-btn" id="tab-add-btn"><i class="ti ti-plus" style="font-size:15px;vertical-align:-3px;"></i> ${esc(verb)}</button></div>`;
    }

    if (!all.length) {
      if (q) {
        html += emptyState('search', 'No matches', `No ${tabDisp(tabKey).name.toLowerCase()} match "${esc(q)}".`);
      } else {
        html += emptyState(emptyIcon, emptyTitle, emptySub);
      }
      c.innerHTML = html;
      wireListToolbar(c, tabKey);
      bindClearTagFilter();
      const ab = $('#tab-add-btn'); if (ab) ab.onclick = () => openItemModal(tabKey);
      return;
    }
    const pinned = all.filter(i => i.pinned);
    const regular = all.filter(i => !i.pinned);
    // v15: numbering is a single ascending sequence across pinned + regular (top to bottom).
    let counter = 0;
    const numberFor = (it) => isNumbered ? (++counter) : null;
    const cardOpts = (it, totalUnpinnedIdx, totalLen) => ({
      number: isNumbered ? numberFor(it) : null,
      reorder: canReorder ? {
        bizId: orderingBizId,
        canMoveUp: totalUnpinnedIdx > 0,
        canMoveDown: totalUnpinnedIdx < totalLen - 1
      } : null
    });

    if (pinned.length) {
      html += `<div class="section-header"><i class="ti ti-pin-filled" style="font-size:12px;color:var(--accent-solid);"></i><span class="section-header-label">Pinned</span></div>`;
      pinned.forEach((it, i) => {
        html += renderItemCard(it, tabKey, cardOpts(it, i, pinned.length));
      });
    }
    if (regular.length) {
      if (pinned.length) html += `<div class="section-header"><span class="section-header-label">All</span></div>`;
      regular.forEach((it, i) => {
        html += renderItemCard(it, tabKey, cardOpts(it, i, regular.length));
      });
    }
    c.innerHTML = html;
    wireListToolbar(c, tabKey);
    bindClearTagFilter();
    const ab = $('#tab-add-btn'); if (ab) ab.onclick = () => openItemModal(tabKey);
    // v15: wire reorder buttons
    if (canReorder) {
      c.querySelectorAll('[data-reorder]').forEach(btn => btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.reorderId;
        const dir = btn.dataset.reorder; // 'up' | 'down'
        reorderItemForBiz(orderingBizId, tabKey, id, dir);
        haptic();
      });
    }
    // Copy-link buttons
    c.querySelectorAll('.copy-link-btn[data-copy]').forEach(btn => btn.onclick = (e) => {
      e.stopPropagation();
      const text = btn.dataset.copy;
      const label = btn.dataset.copyLabel || 'Link';
      navigator.clipboard?.writeText(text);
      toast(`${label} copied`);
      haptic();
    });
    c.querySelectorAll('[data-pw-show]').forEach(btn => btn.onclick = (e) => {
      e.stopPropagation();
      const span = btn.parentElement.querySelector('.cred-password');
      if (!span) return;
      const showing = span.dataset.show === '1';
      const real = span.dataset.real;
      span.dataset.show = showing ? '0' : '1';
      span.textContent = showing ? '•'.repeat(Math.min(real.length, 10)) : real;
      btn.innerHTML = `<i class="ti ${showing ? 'ti-eye' : 'ti-eye-off'}"></i>`;
      window.__InfosIcons?.replaceIcons(btn);
    });
    $$('.card-row[data-item]', c).forEach(el => {
      const id = el.dataset.item;
      let longPressTimer = null;
      let longPressFired = false;
      const startLongPress = () => {
        longPressFired = false;
        longPressTimer = setTimeout(() => {
          longPressFired = true;
          const it = state.items[tabKey].find(x => x.id === id);
          if (it) {
            openLongPressDetail(tabKey, it);
            haptic(30);
          }
        }, 500);
      };
      const cancelLongPress = () => {
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      };
      el.addEventListener('touchstart', startLongPress, { passive: true });
      el.addEventListener('touchend', cancelLongPress, { passive: true });
      el.addEventListener('touchmove', cancelLongPress, { passive: true });
      el.addEventListener('touchcancel', cancelLongPress, { passive: true });
      // Desktop right-click also triggers quick-view (nice for testing without touch)
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const it = state.items[tabKey].find(x => x.id === id);
        if (it) openLongPressDetail(tabKey, it);
      });

      el.onclick = (e) => {
        if (longPressFired) { longPressFired = false; return; }
        if (e.target.closest('.copy-link-btn') || e.target.closest('[data-pw-show]') || e.target.closest('[data-card-delete]')) return;
        if (state.bulkMode) {
          if (state.bulkSelected.has(id)) state.bulkSelected.delete(id); else state.bulkSelected.add(id);
          updateBulkBar(); rerenderCurrentTab();
          haptic();
          return;
        }
        const it = state.items[tabKey].find(x => x.id === id);
        if (!it) return;
        // Clicking the visible link opens it in a new tab, not the item detail.
        if (e.target.closest('[data-stop-card]')) return;
        // Attachment / custom-tab items: tap thumbnail = open photo lightbox; tap body = open detail.
        if (e.target.closest('.schedule-thumb') && it.photo) {
          openPhotoLightbox(it.photo, it.title || it.name);
          return;
        }
        // Business members see a compact, blurred-backdrop detail modal (only populated fields).
        if (isViewOnly()) { openItemDetailModal(tabKey, id); return; }
        setActive('item-detail','right',{itemTab:tabKey,itemId:id,title:it.title||it.name||'Item'});
      };
    });
    // Quick-delete from any list card → confirm, then move to trash.
    $$('[data-card-delete]', c).forEach(btn => btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.dataset.cardDelete;
      const dtab = btn.dataset.cardTab;
      const it = (state.items[dtab] || []).find(x => x.id === id);
      if (!it) return;
      const label = it.title || it.name || 'this entry';
      confirmAction({
        title: 'Move to trash?',
        message: `"${label}" will be moved to Trash. You can restore it within 30 days.`,
        confirmLabel: 'Move to trash',
        danger: true,
        onConfirm: () => {
          it.deleted = true; it.deletedAt = Date.now(); it.deletedFromTab = dtab;
          recordHistory(it, 'trashed');
          recordGlobalActivity(dtab, 'trashed', it);
          persistAll(); updateBadges(); buildNav(); rerenderCurrentTab();
          toast('Moved to trash');
        }
      });
    });
  }

  // Long-press / right-click on a list card pops a quick-view with copy actions.
  function openLongPressDetail(tabKey, it) {
    const rows = [];
    const add = (label, value, copyable) => {
      if (!value) return;
      rows.push(`<div class="long-press-row">
        <span class="long-press-label">${esc(label)}</span>
        <span class="long-press-value">${esc(value)}</span>
        ${copyable ? `<button class="btn-icon copy-link-btn" data-copy="${esc(value)}" data-copy-label="${esc(label)}" aria-label="Copy ${esc(label)}"><i class="ti ti-copy"></i></button>` : ''}
      </div>`);
    };
    add('Title', it.title || it.name || it.label, true);
    add('Short', it.shortName, true);
    add('Username', it.username, true);
    if (it.password) add('Password', it.password, true);
    add('Link', it.link, true);
    add('Message', it.message);
    add('Description', it.description);
    if (it.createdAt) add('Created', new Date(it.createdAt).toLocaleString());
    if (it.updatedAt && it.updatedAt !== it.createdAt) add('Last edited', new Date(it.updatedAt).toLocaleString());
    const bizIds = itemBizIds(it);
    if (bizIds.length && !isViewOnly()) add('Assigned to', bizIds.map(id => bizById(id)?.name).filter(Boolean).join(', '));
    openModal(`
      <div class="modal-head">
        <h3>${esc(it.title || it.name || it.label || 'Detail')}</h3>
        <button id="m-close" class="btn-icon" aria-label="Close"><i class="ti ti-x"></i></button>
      </div>
      <div class="modal-body long-press-detail">
        ${tabKey === 'schedule' && it.photo ? `<div style="margin-bottom:12px;border-radius:var(--radius-md);overflow:hidden;cursor:zoom-in;" id="lp-photo"><img src="${esc(it.photo)}" alt="" style="width:100%;display:block;"/></div>` : ''}
        ${rows.join('')}
      </div>
    `);
    $('#m-close').onclick = closeModal;
    document.querySelectorAll('.long-press-detail [data-copy]').forEach(btn => btn.onclick = () => {
      const v = btn.dataset.copy;
      navigator.clipboard?.writeText(v).then(() => toast(`Copied ${btn.dataset.copyLabel || 'value'}`));
    });
    const lpPhoto = $('#lp-photo');
    if (lpPhoto) lpPhoto.onclick = () => { closeModal(); openPhotoLightbox(it.photo, it.title || it.name); };
  }

  // Full-screen photo viewer
  function openPhotoLightbox(src, filename) {
    let box = document.getElementById('photo-lightbox');
    if (box) box.remove();
    box = document.createElement('div');
    box.id = 'photo-lightbox';
    box.className = 'photo-lightbox';
    const safeName = (filename || 'attachment').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60) || 'attachment';
    box.innerHTML = `
      <div class="photo-lightbox-actions">
        <a class="photo-lightbox-btn" href="${esc(src)}" download="${esc(safeName)}.png" aria-label="Download" title="Download"><i class="ti ti-download"></i></a>
        <button class="photo-lightbox-btn photo-lightbox-close" aria-label="Close" title="Close"><i class="ti ti-x"></i></button>
      </div>
      <img src="${esc(src)}" alt="Photo"/>`;
    document.body.appendChild(box);
    window.__InfosIcons?.replaceIcons(box);
    const close = () => box.remove();
    // Clicks on the backdrop close; clicks on the action buttons or image don't
    box.onclick = (e) => {
      if (e.target.closest('.photo-lightbox-actions') || e.target.tagName === 'IMG') return;
      close();
    };
    box.querySelector('.photo-lightbox-close').onclick = (e) => { e.stopPropagation(); close(); };
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  }

  function renderNotices(c) {
    if (!state.noticesSubtab) state.noticesSubtab = 'reminders';
    const active = state.noticesSubtab;
    const remindCount = filterByBiz(state.items.notices || []).length;
    // For biz users (view-only) and biz-filtered owner views, count only the activity that touches that biz
    const activityCount = (() => {
      const all = state.globalActivity || [];
      if (state.bizContext) return all.filter(e => (e.bizIds || []).includes(state.bizContext)).length;
      if (state.activeBizId && state.activeBizId !== 'all' && state.activeBizId !== 'none') {
        return all.filter(e => (e.bizIds || []).includes(state.activeBizId)).length;
      }
      if (state.activeBizId === 'none') return all.filter(e => !(e.bizIds || []).length).length;
      return all.length;
    })();
    c.innerHTML = `
      <div class="idpass-segtabs" role="tablist" aria-label="Notices view">
        <button class="${active === 'reminders' ? 'active' : ''}" data-notices-sub="reminders" role="tab"><i class="ti ti-bell"></i> Reminder</button>
        <button class="${active === 'activity' ? 'active' : ''}" data-notices-sub="activity" role="tab"><i class="ti ti-history"></i> Activity Log</button>
      </div>
      <div id="notices-sub-container"></div>
    `;
    c.querySelectorAll('[data-notices-sub]').forEach(btn => btn.onclick = () => {
      state.noticesSubtab = btn.dataset.noticesSub;
      renderNotices(c);
    });
    const sub = $('#notices-sub-container');
    if (sub) {
      if (active === 'activity') renderActivityLog(sub);
      else renderListTab(sub, 'notices', 'bell-off', 'No notices', isViewOnly() ? 'Nothing assigned to you yet.' : 'Tap the button below to add one.');
    }
  }

  // v15: Activity Log under Notices — shows cross-tab edits (System, Games, ID&Pass, custom tabs).
  // Wire the in-page activity business-filter chips.
  function renderActivityLog(c) {
    // Filter by the SAME global business filter the Reminder tab uses (#active-biz dropdown).
    // Owner: 'all' | 'none' (unassigned/owner) | <bizId>. Member: scoped to their business.
    const af = state.bizContext ? state.bizContext : (state.activeBizId || 'all');

    const feed = (state.globalActivity || []).filter(e => {
      if (state.bizContext) return (e.bizIds || []).includes(state.bizContext);
      if (af === 'all') return true;
      if (af === 'none') return !(e.bizIds || []).length;
      return (e.bizIds || []).includes(af);
    });

    // Business filter dropdown — identical control to the one on the Reminder tab.
    const hasBiz = (state.businesses || []).length > 0;
    const filterBar = (!isViewOnly() && hasBiz)
      ? `<div class="list-toolbar activity-filter-toolbar">
          <select id="activity-biz-filter" class="list-biz-filter">
            <option value="all" ${af === 'all' ? 'selected' : ''}>All businesses</option>
            ${state.businesses.map(b => `<option value="${b.id}" ${af === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
          </select>
        </div>`
      : '';

    // Wire the filter dropdown (called after innerHTML is set).
    const wireFilter = () => {
      const sel = $('#activity-biz-filter');
      if (sel) sel.onchange = () => {
        state.activeBizId = sel.value;
        updateActiveBizDisplay();
        renderActivityLog(c);
      };
    };

    if (!feed.length) {
      const empty = (af === 'all')
        ? emptyState('history', 'No activity yet', 'Edits to items on System, Games, ID & Pass, and custom tabs will show up here.')
        : emptyState('history', 'No activity for this business', 'Switch the business filter above to see other activity.');
      c.innerHTML = filterBar + empty;
      wireFilter();
      return;
    }
    const isFiltered = af !== 'all';
    const filterName = af === 'none' ? 'Unassigned' : (af !== 'all' ? (bizById(af)?.name || '') : '');
    const clearHeader = !isViewOnly()
      ? `<div class="activity-log-toolbar"><button class="btn-link-sm" id="activity-clear" style="color:var(--danger);"><i class="ti ti-trash" style="font-size:12px;vertical-align:-2px;margin-right:3px;"></i>Clear ${isFiltered ? esc(filterName) + ' activity' : 'all activity'}</button></div>`
      : '';
    const groupBy = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); (m[k] = m[k] || []).push(x); return m; }, {});
    const groups = groupBy(feed, e => {
      const d = new Date(e.ts);
      const today = new Date();
      const yest = new Date(today.getTime() - 86400000);
      if (d.toDateString() === today.toDateString()) return 'Today';
      if (d.toDateString() === yest.toDateString()) return 'Yesterday';
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    });
    let html = filterBar + clearHeader + '<div class="activity-log-wrap">';
    Object.keys(groups).forEach(date => {
      html += `<div class="activity-date-header"><span>${esc(date)}</span></div>`;
      groups[date].forEach(e => {
        const verbColor = { created: 'success', edited: 'info', trashed: 'danger', restored: 'success' }[e.action] || 'info';
        const verbIcon = { created: 'plus', edited: 'edit', trashed: 'trash', restored: 'arrow-back-up' }[e.action] || 'point';
        const verbLabel = { created: 'Created', edited: 'Edited', trashed: 'Trashed', restored: 'Restored' }[e.action] || e.action;
        const bizChips = (e.bizIds || []).map(bid => {
          const b = bizById(bid);
          return b ? `<span class="biz-chip" style="background:${b.color}1F;color:${readableColor(b.color)};">${esc(b.name)}</span>` : '';
        }).join('');
        html += `<div class="activity-row" data-go-tab="${esc(e.tabKey)}" data-go-item="${esc(e.itemId || '')}">
          <div class="activity-icon" style="background:var(--${verbColor}-bg);color:var(--${verbColor}-fg);"><i class="ti ti-${verbIcon}"></i></div>
          <div class="activity-body">
            <div class="activity-title"><strong>${esc(verbLabel)}</strong> in ${esc(e.tabName)} · <span class="activity-item-name">${esc(e.title)}</span></div>
            ${bizChips ? `<div class="activity-chips">${bizChips}</div>` : ''}
            <div class="activity-time">${esc(relTime(e.ts))}</div>
          </div>
        </div>`;
      });
    });
    html += '</div>';
    c.innerHTML = html;
    wireFilter();
    // Clear activity log (owner only). Respects the global business filter.
    const clearBtn = $('#activity-clear');
    if (clearBtn) clearBtn.onclick = () => {
      confirmAction({
        title: isFiltered ? `Clear ${filterName} activity?` : 'Clear all activity?',
        message: isFiltered
          ? `This removes the activity-log entries for ${filterName}. Your items are not affected. This cannot be undone.`
          : 'This removes every entry from the activity log. Your items are not affected. This cannot be undone.',
        confirmLabel: 'Clear',
        danger: true,
        onConfirm: () => {
          if (!isFiltered) {
            state.globalActivity = [];
          } else if (af === 'none') {
            state.globalActivity = (state.globalActivity || []).filter(e => (e.bizIds || []).length > 0);
          } else {
            state.globalActivity = (state.globalActivity || []).filter(e => !(e.bizIds || []).includes(af));
          }
          persistAll();
          state.history.pop(); setActive('notices', 'fade');
          toast('Activity cleared');
        }
      });
    };
    // Click an activity row → jump to the item (if it still exists and is accessible)
    c.querySelectorAll('.activity-row[data-go-item]').forEach(row => {
      row.onclick = () => {
        const tab = row.dataset.goTab;
        const id = row.dataset.goItem;
        if (!tab || !id) return;
        const item = (state.items[tab] || []).find(x => x.id === id);
        if (!item) { toast('Item no longer exists'); return; }
        if (item.deleted) { toast('Item is in trash'); return; }
        // Security: don't let a business user navigate to a tab that's been disabled for them.
        if (isViewOnly() && !isTabAllowed(tab === 'idpass-system' || tab === 'idpass-accounts' ? tab : tab)) {
          toast('Not available'); return;
        }
        // For idpass-* go via parent
        if (tab === 'idpass-system' || tab === 'idpass-accounts') {
          state.idpassSubtab = tab;
          setActive('item-detail', 'right', { itemTab: tab, itemId: id, title: item.title || item.name || 'Item' });
        } else {
          setActive('item-detail', 'right', { itemTab: tab, itemId: id, title: item.title || item.name || 'Item' });
        }
      };
    });
  }
  function renderGames(c) { renderListTab(c, 'games', 'device-gamepad-2', 'Nothing here', isViewOnly() ? 'Nothing assigned.' : 'Tap the button below to add.'); }
  function renderScheduleList(c) { renderListTab(c, 'schedule', 'paperclip', 'No attachments', isViewOnly() ? 'Nothing assigned to you yet.' : 'Tap the button below to upload an image attachment.'); }
  function renderIdPassSystem(c) { renderListTab(c, 'idpass-system', 'key', 'No credentials', isViewOnly() ? 'Nothing assigned.' : 'Tap the button below to add.'); }
  function renderIdPassAccounts(c) { renderListTab(c, 'idpass-accounts', 'user-circle', 'No accounts', isViewOnly() ? 'Nothing assigned.' : 'Tap the button below to add.'); }
  function renderCustomTab(c) { const tabKey = state.currentTab; renderListTab(c, tabKey, 'star', 'No items', isViewOnly() ? 'Nothing assigned.' : 'Tap the button below to add.'); }

  // ============================================================
  // Balance tab — players (or anyone) make entries with a Name and Balance.
  // Owners can also create, but the typical user is the business team member.
  // Owners can delete entries. Recent on top. No reorder, no numbering.
  // ============================================================
  function renderBalanceList(c) {
    const tabKey = 'balance';
    const all = (state.items[tabKey] || []).filter(i => !i.deleted);
    const filtered = filterByBiz(all);

    // Balance entries are added ONLY by the business login (the business records
    // its own balances). The owner is view-only here — they review/filter entries
    // but don't add them. (This is the inverse of the other tabs, where only the
    // owner adds.) isViewOnly() is true for a business login, false for the owner.
    const canAddBalance = isViewOnly();
    const fabHTML = canAddBalance
      ? `<div class="tab-actions-bar"><button class="btn-primary btn-block tab-add-btn" id="tab-add-btn"><i class="ti ti-plus" style="font-size:15px;vertical-align:-3px;"></i> Add entry</button></div>`
      : '';

    if (!filtered.length) {
      const emptySub = canAddBalance
        ? 'Tap "Add entry" to record balances under a recorder\'s name.'
        : 'Balance entries are added by the business login. They\'ll appear here once recorded.';
      c.innerHTML = `${fabHTML}<div class="empty-state-inline"><i class="ti ti-wallet"></i><div><div style="font-weight:600;color:var(--text-primary);">No balance entries yet</div><div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${emptySub}</div></div></div>`;
      const ab = $('#tab-add-btn'); if (ab) ab.onclick = () => openBalanceModal();
      return;
    }

    // Group entries by their batchId — one card per "Add entry" submission.
    // Each card = "Entry Made by [recorder]" holding all the name/balance rows
    // saved together. Newest submission on top.
    const origIndex = new Map(all.map((it, i) => [it.id, i]));
    const batchMap = new Map();
    filtered.forEach(it => {
      const bid = it.batchId || ('solo_' + it.id);
      if (!batchMap.has(bid)) batchMap.set(bid, []);
      batchMap.get(bid).push(it);
    });
    const batches = [...batchMap.entries()].map(([bid, items]) => {
      items.sort((a, b) => (origIndex.get(a.id) || 0) - (origIndex.get(b.id) || 0));
      const created = Math.max(...items.map(i => itemCreatedAt(i) || 0));
      const edited = items.some(i => (i.history || []).some(e => e.action === 'edited'));
      const editedAt = edited ? Math.max(...items.map(i => itemUpdatedAt(i) || 0)) : null;
      return { bid, items, recorder: items[0].recordedBy || 'Unknown', created, edited, editedAt,
               sumIndex: Math.max(...items.map(i => origIndex.get(i.id) || 0)) };
    });
    batches.sort((a, b) => (b.created - a.created) || (b.sumIndex - a.sumIndex));

    // Balance permissions:
    //  - Business login (view-only session): manages its own entries — edit + delete.
    //  - Owner: view-only for EDITING (cannot edit business-entered balances), but
    //    CAN DELETE them. So the owner reviews business entries and can remove them,
    //    but not change their contents.
    const canEditBatch = (b) => {
      if (!isViewOnly()) return false; // owner never edits Balance entries
      return b.items.every(it => itemBizIds(it).includes(state.bizContext));
    };
    const canDeleteBatch = (b) => {
      if (!isViewOnly()) return true; // owner CAN delete (any business's entries)
      return b.items.every(it => itemBizIds(it).includes(state.bizContext));
    };

    let html = fabHTML;
    // Low-balance alert: if the LATEST entry has any row whose balance is below the
    // threshold, warn at the top of the tab so it's seen immediately.
    const LOW_BALANCE_THRESHOLD = 750;
    if (batches.length) {
      const latest = batches[0];
      const lows = latest.items.filter(it => {
        const n = parseFloat(it.balance);
        return !isNaN(n) && n < LOW_BALANCE_THRESHOLD;
      });
      if (lows.length) {
        const names = lows.map(it => `${esc(it.name || '(unnamed)')} (${esc(formatBalanceAmount(it.balance))})`).join(', ');
        html += `<div class="balance-low-alert" role="alert">
          <i class="ti ti-alert-triangle"></i>
          <div>
            <strong>Low balance in latest entry</strong>
            <div class="balance-low-alert-detail">${lows.length === 1 ? 'This balance is' : 'These balances are'} below ${formatBalanceAmount(LOW_BALANCE_THRESHOLD)}: ${names}</div>
          </div>
        </div>`;
      }
    }
    html += '<div class="balance-flat-list">';
    batches.forEach(b => {
      const createdStr = formatBalanceStamp(b.created);
      const editedStr = b.edited ? formatBalanceStamp(b.editedAt) : null;
      const showEdit = canEditBatch(b);
      const showDel = canDeleteBatch(b);
      html += `<div class="balance-row balance-row-clickable" data-balance-view="${esc(b.bid)}">
        <div class="balance-row-main">
          <div class="balance-row-body">
            <div class="balance-row-name">Entry Made by ${esc(b.recorder)}</div>
            <div class="balance-row-meta">
              <span class="balance-row-stamp"><i class="ti ti-clock" style="font-size:11px;vertical-align:-1px;"></i> ${esc(createdStr)}</span>
              ${editedStr ? `<span class="balance-row-stamp balance-row-edited"><i class="ti ti-pencil" style="font-size:11px;vertical-align:-1px;"></i> Edited ${esc(editedStr)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="balance-row-actions" onclick="event.stopPropagation();">
          ${showEdit ? `<button class="btn-icon" data-bal-edit="${esc(b.bid)}" aria-label="Edit entry" title="Edit"><i class="ti ti-edit"></i></button>` : ''}
          ${showDel ? `<button class="btn-icon btn-icon-danger" data-bal-del="${esc(b.bid)}" aria-label="Delete entry" title="Delete"><i class="ti ti-trash"></i></button>` : ''}
        </div>
      </div>`;
    });
    html += '</div>';
    c.innerHTML = html;

    const ab = $('#tab-add-btn'); if (ab) ab.onclick = () => openBalanceModal();

    const batchById = (bid) => batches.find(b => b.bid === bid);

    // Edit a whole batch → opens the entry panel pre-filled with all its rows.
    c.querySelectorAll('[data-bal-edit]').forEach(btn => btn.onclick = (e) => {
      e.stopPropagation();
      const b = batchById(btn.dataset.balEdit);
      if (!b) return;
      if (!isViewOnly() && b.items.some(it => it.createdByBiz)) {
        toast('Business-entered records can only be deleted, not edited');
        return;
      }
      openBalanceModal(b.bid);
    });

    // Delete a whole batch (all rows saved together).
    c.querySelectorAll('[data-bal-del]').forEach(btn => btn.onclick = (e) => {
      e.stopPropagation();
      const b = batchById(btn.dataset.balDel);
      if (!b) return;
      const n = b.items.length;
      confirmAction({
        title: 'Delete this entry?',
        message: `This permanently deletes the entry made by ${b.recorder} (${n} ${n === 1 ? 'record' : 'records'}). This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
        onConfirm: () => {
          const ids = new Set(b.items.map(i => i.id));
          const touched = new Set(); b.items.forEach(it => itemBizIds(it).forEach(x => touched.add(x)));
          b.items.forEach(it => recordGlobalActivity(tabKey, 'trashed', it));
          // SOFT-delete (not a hard array removal). buildSharedSlice emits a
          // tombstone for items with deleted=true, which is how the deletion
          // propagates to the other side (owner ↔ business). A hard removal would
          // just make the item ABSENT from the slice, and the non-destructive
          // merge would keep it — so the entry would linger on the other device.
          const now = Date.now();
          state.items[tabKey].forEach(x => {
            if (ids.has(x.id)) { x.deleted = true; x.deletedAt = now; x.deletedFromTab = tabKey; }
          });
          touched.forEach(bid => { const biz = bizById(bid); if (biz) recordActivity(biz, 'deleted', `Deleted balance entry by ${b.recorder}`); });
          persistAll();
          state.history.pop(); setActive(tabKey, 'fade');
          toast('Entry deleted');
        }
      });
    });

    // Tapping a card opens the read-only View Entry modal (X + Cancel).
    c.querySelectorAll('[data-balance-view]').forEach(row => row.onclick = (e) => {
      e.stopPropagation();
      const b = batchById(row.dataset.balanceView);
      if (b) openBalanceViewModal(b);
    });
  }

  // Read-only "View Entry" modal: recorder + timestamps + numbered name/amount
  // list. X top-right and Cancel bottom; no edit/delete here.
  function openBalanceViewModal(b) {
    const createdStr = formatBalanceStamp(b.created);
    const editedStr = b.edited ? formatBalanceStamp(b.editedAt) : null;
    const rows = b.items.map((it, i) => `
      <div class="balance-view-row">
        <span class="balance-view-num">${i + 1}</span>
        <span class="balance-view-name">${esc(it.name || '(unnamed)')}</span>
        <span class="balance-view-amount">${esc(formatBalanceAmount(it.balance))}</span>
      </div>`).join('');
    openModal(`
      <div class="modal-head"><h3>View Entry</h3><button id="m-close" class="btn-icon" aria-label="Close"><i class="ti ti-x"></i></button></div>
      <div class="modal-body">
        <div class="balance-view-recorder">Recorded by: <strong>${esc(b.recorder)}</strong></div>
        <div class="balance-view-stamp">${esc(createdStr)}${editedStr ? ` · Edited ${esc(editedStr)}` : ''}</div>
        <div class="balance-view-list">${rows}</div>
        <div class="balance-view-total"><span>Total</span><strong>${esc(formatBalanceAmount(b.items.reduce((s, it) => s + (parseFloat(it.balance) || 0), 0)))}</strong></div>
      </div>
      <div class="modal-foot"><button class="btn-outline" id="m-cancel">Cancel</button></div>
    `);
    $('#m-close').onclick = closeModal;
    $('#m-cancel').onclick = closeModal;
  }

  // Read-only detail page (legacy single-entry route, kept for deep links).
  function renderBalanceDetail(c, ctx) {
    const tabKey = 'balance';
    const it = (state.items[tabKey] || []).find(x => x.id === ctx.itemId);
    if (!it) { c.innerHTML = emptyState('alert-circle', 'Entry not found', 'It may have been deleted.'); return; }
    const created = itemCreatedAt(it);
    const updated = itemUpdatedAt(it);
    const edited = (it.history || []).some(e => e.action === 'edited');
    c.innerHTML = `
      <div class="detail-section">
        <div class="balance-detail-hero">
          <div class="balance-detail-name">${esc(it.name || '(unnamed)')}</div>
          <div class="balance-detail-amount">${esc(formatBalanceAmount(it.balance))}</div>
        </div>
      </div>
      <div class="detail-section">
        <div class="section-label">Details</div>
        <div class="info-pill">
          <div class="detail-meta-row"><i class="ti ti-user" style="font-size:13px;"></i><span style="width:96px;">Recorded by</span><strong>${esc(it.recordedBy || 'Unknown')}</strong></div>
          <div class="detail-meta-row"><i class="ti ti-wallet" style="font-size:13px;"></i><span style="width:96px;">Balance</span><strong>${esc(formatBalanceAmount(it.balance))}</strong></div>
          <div class="detail-meta-row"><i class="ti ti-clock" style="font-size:13px;"></i><span style="width:96px;">Created</span><strong>${formatDateTime(created)}</strong></div>
          ${edited ? `<div class="detail-meta-row"><i class="ti ti-pencil" style="font-size:13px;"></i><span style="width:96px;">Edited</span><strong>${formatDateTime(updated)}</strong></div>` : ''}
        </div>
      </div>`;
  }

  // Format date in the style: "Mon, Jan 15 · 3:42 PM"
  function formatBalanceStamp(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const day = d.toLocaleDateString(undefined, { weekday: 'short' });
    const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${day}, ${date} · ${time}`;
  }

  // Format a balance amount: keep raw if it has currency text, else just trim trailing zeros
  function formatBalanceAmount(v) {
    if (v == null || v === '') return '—';
    if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    const s = String(v).trim();
    const n = parseFloat(s);
    if (!isNaN(n) && /^[+\-]?[\d,.]+$/.test(s.replace(/\s/g, ''))) {
      return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return s; // keeps things like "$100" or "₹500" as-is
  }

  // Open the Add/Edit Balance modal. Allows biz users (view-only) to create entries,
  // and lets them add multiple rows in one shot via "Add more".
  function openBalanceModal(editId) {
    const tabKey = 'balance';
    // Balance entries are added/edited ONLY by the business login (a view-only
    // session). The owner is view-only on Balance, so refuse to open the editor
    // for them — defense in depth behind the hidden Add button.
    if (!isViewOnly()) { toast('Balance entries are added by the business login'); return; }
    // editId may be a single item id (legacy) OR a batchId (a whole submission).
    let editingBatch = null;
    let editing = null;
    if (editId) {
      const byBatch = (state.items[tabKey] || []).filter(i => i.batchId === editId && !i.deleted);
      if (byBatch.length) {
        editingBatch = byBatch;
        editing = byBatch[0];
      } else {
        editing = state.items[tabKey].find(i => i.id === editId) || null;
        if (editing) editingBatch = [editing];
      }
    }
    // For new entries: pre-fill the NAME of each row from the last-used set of names
    // (so recurring players don't get retyped), but leave the BALANCE empty.
    // For edit: one row per existing entry in the batch.
    let rows;
    if (editingBatch) {
      rows = editingBatch.map(it => ({ name: it.name || '', balance: it.balance || '', _id: it.id }));
    } else if (Array.isArray(state.__lastBalNames) && state.__lastBalNames.length) {
      rows = state.__lastBalNames.map(n => ({ name: n, balance: '' }));
    } else {
      rows = [{ name: '', balance: '' }];
    }

    function renderRows() {
      const wrap = document.getElementById('bal-rows');
      if (!wrap) return;
      wrap.innerHTML = rows.map((r, i) => `
        <div class="balance-form-row" data-bal-row="${i}">
          <div class="balance-form-row-num">${i + 1}</div>
          <input type="text" class="balance-input-name" placeholder="Name" data-bal-name="${i}" value="${esc(r.name)}" autocomplete="off"/>
          <input type="text" class="balance-input-amount" placeholder="Balance" data-bal-amt="${i}" inputmode="decimal" value="${esc(r.balance)}" autocomplete="off"/>
          ${rows.length > 1 ? `<button type="button" class="btn-icon balance-form-remove" data-bal-rm="${i}" aria-label="Remove row"><i class="ti ti-x"></i></button>` : ''}
        </div>
      `).join('');
      // Bind name/amount inputs to keep `rows` in sync as user types
      wrap.querySelectorAll('[data-bal-name]').forEach(inp => {
        inp.oninput = () => { rows[parseInt(inp.dataset.balName)].name = inp.value; };
      });
      wrap.querySelectorAll('[data-bal-amt]').forEach(inp => {
        inp.oninput = () => { rows[parseInt(inp.dataset.balAmt)].balance = inp.value; };
      });
      wrap.querySelectorAll('[data-bal-rm]').forEach(btn => btn.onclick = () => {
        const i = parseInt(btn.dataset.balRm);
        rows.splice(i, 1);
        renderRows();
      });
      window.__InfosIcons?.replaceIcons(wrap);
    }

    // For biz users, the bizId is fixed (state.bizContext).
    // For owners creating, they can pick businesses (re-use the assign UI from item modal).
    const isBizUser = isViewOnly();
    const ownerHasBiz = !isBizUser && state.businesses.length > 0;
    let ownerChosenBizIds = editing
      ? (editing.bizIds ? [...editing.bizIds] : [])
      : (state.activeBizId && state.activeBizId !== 'all' && state.activeBizId !== 'none' ? [state.activeBizId] : []);

    function renderOwnerBizAssign() {
      const wrap = document.getElementById('bal-biz');
      if (!wrap) return;
      const allSelected = ownerChosenBizIds.length === state.businesses.length && state.businesses.length > 0;
      wrap.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
          ${state.businesses.map(b => {
            const sel = ownerChosenBizIds.includes(b.id);
            return `<span class="assign-pill ${sel ? 'selected' : ''}" data-bal-biz="${esc(b.id)}"><span class="biz-color-dot" style="background:${esc(b.color || '#888')}"></span>${esc(b.name)}${sel ? ' <i class="ti ti-check" style="font-size:11px;"></i>' : ''}</span>`;
          }).join('')}
        </div>
        <button type="button" class="btn-outline btn-sm" id="bal-biz-all">${allSelected ? 'Unassign all' : 'Assign to all'}</button>
      `;
      wrap.querySelectorAll('[data-bal-biz]').forEach(el => el.onclick = () => {
        const bid = el.dataset.balBiz;
        if (ownerChosenBizIds.includes(bid)) ownerChosenBizIds = ownerChosenBizIds.filter(x => x !== bid);
        else ownerChosenBizIds.push(bid);
        renderOwnerBizAssign();
      });
      const allBtn = document.getElementById('bal-biz-all');
      if (allBtn) allBtn.onclick = () => {
        if (ownerChosenBizIds.length === state.businesses.length) ownerChosenBizIds = [];
        else ownerChosenBizIds = state.businesses.map(b => b.id);
        renderOwnerBizAssign();
      };
      window.__InfosIcons?.replaceIcons(wrap);
    }

    openModal(`
      <div class="modal-head"><h3>${editing ? 'Edit Balance Entry' : 'New Balance Entries'}</h3><button id="m-close" class="btn-icon"><i class="ti ti-x"></i></button></div>
      <div class="modal-body">
        <div class="settings-hint" style="margin-bottom:10px;">${editing ? 'Edit this entry.' : 'Type who is recording these entries, then add one or more name + balance rows.'}</div>
        <div class="field" style="margin-bottom:12px;">
          <label>Recorded by</label>
          <input id="bal-recorder" type="text" placeholder="Who is recording this?" value="${esc(editing ? (editing.recordedBy || '') : '')}" autocomplete="off"/>
        </div>
        <div id="bal-rows"></div>
        <button type="button" class="btn-outline btn-sm balance-form-add" id="bal-add-row" style="margin-bottom:12px;"><i class="ti ti-plus" style="font-size:13px;vertical-align:-2px;"></i> Add more</button>
        ${ownerHasBiz ? `<div class="field" style="margin-bottom:10px;"><label>Assign to business${state.businesses.length === 1 ? '' : 'es'}</label><div id="bal-biz"></div></div>` : ''}
      </div>
      <div class="modal-foot"><button class="btn-outline" id="m-cancel">Cancel</button><button class="btn-primary" id="bal-save">${editing ? 'Save' : 'Add'}</button></div>
    `);
    renderRows();
    if (ownerHasBiz) renderOwnerBizAssign();

    const addRowBtn = document.getElementById('bal-add-row');
    if (addRowBtn) addRowBtn.onclick = () => {
      rows.push({ name: '', balance: '' });
      renderRows();
      // Focus the newly-added name input
      setTimeout(() => {
        const inputs = document.querySelectorAll('[data-bal-name]');
        inputs[inputs.length - 1]?.focus();
      }, 30);
    };

    document.getElementById('bal-save').onclick = () => {
      const recorder = (document.getElementById('bal-recorder')?.value || '').trim();
      if (!recorder) { toast('Recorded by field is empty'); document.getElementById('bal-recorder')?.focus(); return; }
      // Validate: every row must have a name AND a balance
      const cleaned = rows.map(r => ({ name: (r.name || '').trim(), balance: (r.balance || '').trim() }));
      const valid = cleaned.filter(r => r.name && r.balance);
      if (!valid.length) { toast('Enter a name and balance for at least one row'); return; }
      const skipped = cleaned.length - valid.length;
      // Owner must assign the entry to at least one business, otherwise it's
      // orphaned: it only shows in the "All" view, disappears under any business
      // filter, and (critically) never syncs to a business login because the
      // shared slice for a business only includes items assigned to it. If the
      // owner has businesses but picked none, default to the business they're
      // currently viewing; if they're in "All", ask them to choose.
      let ownerTarget = ownerChosenBizIds;
      if (!isBizUser && state.businesses.length > 0 && ownerTarget.length === 0) {
        if (state.activeBizId && state.activeBizId !== 'all' && state.activeBizId !== 'none') {
          ownerTarget = [state.activeBizId];
        } else {
          toast('Choose which business this balance entry is for');
          return;
        }
      }
      const targetBizIds = isBizUser ? [state.bizContext] : ownerTarget;
      const now = Date.now();
      state.__lastBalRecorder = recorder;

      if (editingBatch) {
        // Edit a whole batch: reconcile the modal rows against existing items.
        const batchId = editing.batchId || ('bb' + now + '_' + Math.random().toString(36).slice(2, 6));
        const existingById = new Map(editingBatch.map(it => [it.id, it]));
        const keptIds = new Set();
        const validRows = rows.map(r => ({ name: (r.name || '').trim(), balance: (r.balance || '').trim(), _id: r._id }))
                              .filter(r => r.name && r.balance);
        validRows.forEach(r => {
          if (r._id && existingById.has(r._id)) {
            // update in place
            const it = existingById.get(r._id);
            it.name = r.name; it.balance = r.balance; it.recordedBy = recorder;
            it.bizIds = targetBizIds.length ? targetBizIds.slice() : (it.bizIds || []);
            recordHistory(it, 'edited');
            keptIds.add(r._id);
          } else {
            // a newly added row within this batch
            const newItem = {
              id: 'x' + (state.nextItemId++),
              name: r.name, balance: r.balance,
              bizIds: targetBizIds.slice(), recordedBy: recorder, batchId,
              createdByBiz: isViewOnly() ? (state.bizContext || true) : false,
              history: [{ ts: now, action: 'created', label: `Created by ${recorder}` }]
            };
            state.items[tabKey].push(newItem);
            keptIds.add(newItem.id);
          }
        });
        // Remove rows the user deleted from the batch
        editingBatch.forEach(it => { if (!keptIds.has(it.id)) state.items[tabKey] = state.items[tabKey].filter(x => x.id !== it.id); });
        // If the recorder name changed, apply to all kept rows (already set above)
        const touched = new Set(); targetBizIds.forEach(b => touched.add(b)); editingBatch.forEach(it => itemBizIds(it).forEach(b => touched.add(b)));
        touched.forEach(bid => { const b = bizById(bid); if (b) recordActivity(b, 'edited', `Edited balance entry by ${recorder}`); });
        state.items[tabKey].filter(x => x.batchId === batchId).forEach(it => recordGlobalActivity(tabKey, 'edited', it));
        state.__lastBalRecorder = recorder;
        persistAll();
        closeModal();
        state.history.pop(); setActive(tabKey, 'fade');
        toast('Entry updated');
      } else {
        // Create new — one per row, all sharing one batch + recorder
        const batchId = 'bb' + now + '_' + Math.random().toString(36).slice(2, 6);
        const created = [];
        valid.forEach(r => {
          const newItem = {
            id: 'x' + (state.nextItemId++),
            name: r.name,
            balance: r.balance,
            bizIds: targetBizIds.slice(),
            recordedBy: recorder,
            batchId,
            // Track who actually created the entry: the owner, or a business member.
            // Owners can DELETE business-created entries but must NOT edit them.
            createdByBiz: isViewOnly() ? (state.bizContext || true) : false,
            history: [{ ts: now, action: 'created', label: `Created by ${recorder}` }]
          };
          state.items[tabKey].push(newItem);
          created.push(newItem);
        });
        // Remember the set of names just used so the next "Add entry" pre-fills them
        // (balances stay empty). De-duplicate while preserving order.
        state.__lastBalNames = [...new Set(valid.map(r => r.name))];
        // Activity per business
        targetBizIds.forEach(bid => {
          const b = bizById(bid);
          if (!b) return;
          if (created.length === 1) {
            recordActivity(b, 'added', `Added balance: ${created[0].name} (${formatBalanceAmount(created[0].balance)})`);
          } else {
            recordActivity(b, 'added', `${recorder} added ${created.length} balance entries`);
          }
        });
        // Global activity (one entry per item)
        created.forEach(it => recordGlobalActivity(tabKey, 'created', it));
        if (created.length) playBalanceSound();
        persistAll();
        closeModal();
        state.history.pop(); setActive(tabKey, 'fade');
        toast(skipped > 0
          ? `Added ${valid.length}; skipped ${skipped} empty`
          : (valid.length === 1 ? 'Entry added' : `${valid.length} entries added`));
      }
    };

    document.getElementById('m-cancel').onclick = closeModal;
    const balClose = document.getElementById('m-close'); if (balClose) balClose.onclick = closeModal;
  }

  function renderSystemList(c) {
    renderListTab(c, 'system', 'server-cog', 'No system entries', isViewOnly() ? 'Nothing assigned to you yet.' : 'Tap "New entry" above to add one.');
  }

  function renderIdPassOverview(c) {
    if (!state.idpassSubtab) state.idpassSubtab = 'idpass-system';
    const active = state.idpassSubtab;
    c.innerHTML = `
      <div class="idpass-segtabs">
        <button class="${active === 'idpass-system' ? 'active' : ''}" data-sub="idpass-system"><i class="ti ti-server-cog"></i> ${esc(tabDisp('idpass-system').name)}</button>
        <button class="${active === 'idpass-accounts' ? 'active' : ''}" data-sub="idpass-accounts"><i class="ti ti-user-circle"></i> ${esc(tabDisp('idpass-accounts').name)}</button>
      </div>
      <div id="idpass-sub-container"></div>
    `;
    c.querySelectorAll('[data-sub]').forEach(btn => btn.onclick = () => {
      state.idpassSubtab = btn.dataset.sub;
      renderIdPassOverview(c);
    });
    const sub = $('#idpass-sub-container');
    if (sub) {
      if (active === 'idpass-system') renderIdPassSystem(sub);
      else renderIdPassAccounts(sub);
    }
  }

  function renderBusinesses(c) {
    let html = '';
    if (!isViewOnly()) {
      html += `<div class="tab-actions-bar"><button class="btn-primary btn-block tab-add-btn" id="biz-add-btn"><i class="ti ti-plus" style="font-size:15px;vertical-align:-3px;"></i> New business</button></div>`;
    }
    if (!state.businesses.length) {
      html += `<div class="empty-state-inline"><i class="ti ti-building-store"></i><div><div style="font-weight:600;color:var(--text-primary);">No businesses yet</div><div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">Tap "New business" above to add one.</div></div></div>`;
      c.innerHTML = html;
      const ab = $('#biz-add-btn');
      if (ab) ab.onclick = () => openBusinessModal();
      return;
    }
    html += `<div class="biz-list-wrap"></div>`;
    c.innerHTML = html;
    const ab = $('#biz-add-btn');
    if (ab) ab.onclick = () => openBusinessModal();
    const wrap = c.querySelector('.biz-list-wrap');
    state.businesses.forEach(b => {
      const el = document.createElement('div');
      el.className = 'card-row clickable';
      el.innerHTML = `<div style="display:flex;align-items:flex-start;gap:12px;">${bizAvatarHTML(b, 44)}<div style="flex:1;min-width:0;"><div style="font-size:14px;font-weight:600;margin-bottom:4px;color:var(--text-primary);">${esc(b.name)}</div><div style="font-size:12px;color:var(--text-secondary);line-height:1.7;"><div><i class="ti ti-mail" style="font-size:12px;vertical-align:-1px;"></i> ${esc(b.email)}</div><div><i class="ti ti-lock" style="font-size:12px;vertical-align:-1px;"></i> ${(() => { const pw = bizPasswordValue(b); return pw ? esc(pw) : (b.__needsPasswordReset ? "<span style=\"color:var(--danger-fg);\">Re-set password (was encrypted)</span>" : "—"); })()}</div></div></div><i class="ti ti-chevron-right" style="font-size:16px;color:var(--text-tertiary);margin-top:12px;"></i></div>`;
      el.onclick = () => setActive('biz-detail','right',{bizId:b.id,title:b.name,sub:b.email});
      wrap.appendChild(el);
    });
  }

  function renderBizDetail(c, ctx) {
    const b = bizById(ctx?.bizId); if (!b) { c.innerHTML = emptyState('alert-circle', 'Not found', ''); return; }
    const isDark = isAppDark();
    const cats = [{key:'notices',icon:'bell'},{key:'games',icon:'device-gamepad-2'},{key:'idpass-system',icon:'server-cog'},{key:'idpass-accounts',icon:'user-circle'},...state.customTabs.map(ct => ({key:ct.id,icon:ct.icon}))];
    const allowed = state.bizAllowedTabs?.[b.id];
    c.innerHTML = `
      <div class="biz-detail-head-v4">
        ${bizAvatarHTML(b, 64)}
        <div style="flex:1;min-width:0;">
          <div class="biz-detail-name">${esc(b.name)}</div>
          <div class="biz-detail-sub">Created ${new Date(b.createdAt).toLocaleDateString()}</div>
        </div>
        ${!isViewOnly() ? `<button class="btn-outline btn-sm" id="biz-edit"><i class="ti ti-edit" style="font-size:13px;vertical-align:-2px;"></i> Edit</button>` : ''}
      </div>
      <div class="info-pill" style="margin-bottom:20px;">
        <div class="section-label" style="margin-bottom:10px;">Sign-in credentials</div>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:13px;">
          <div style="display:flex;align-items:center;gap:8px;"><i class="ti ti-mail" style="font-size:13px;color:var(--text-secondary);"></i><span style="width:64px;color:var(--text-secondary);">Email</span><strong style="color:var(--text-primary);font-family:var(--font-mono);font-weight:500;">${esc(b.email || '—')}</strong></div>
          <div style="display:flex;align-items:center;gap:8px;"><i class="ti ti-lock" style="font-size:13px;color:var(--text-secondary);"></i><span style="width:64px;color:var(--text-secondary);">Password</span><strong id="biz-pw" data-show="1" data-real="${esc(bizPasswordValue(b))}" style="color:var(--text-primary);font-family:var(--font-mono);font-weight:500;">${bizPasswordValue(b) ? esc(bizPasswordValue(b)) : '—'}</strong>${bizPasswordValue(b) ? `<button class="btn-icon copy-link-btn" data-copy="${esc(bizPasswordValue(b))}" data-copy-label="Password" style="padding:2px;margin-left:auto;" aria-label="Copy password" title="Copy password"><i class="ti ti-copy" style="font-size:13px;"></i></button>` : ''}</div>
        </div>
      </div>
      <div class="biz-items-section">
        <div class="biz-items-head">
          <div class="section-label">Items</div>
        </div>
        <div class="settings-hint" style="margin:0 0 10px;font-size:11.5px;">Tabs currently turned <strong>on</strong> for this business, with item counts.</div>
        ${(() => {
          const tabKeys = [];
          (state.tabOrder || []).forEach(k => {
            if (k === 'businesses' || k === 'trash') return;
            const def = getTabDef(k); if (!def || def.hidden) return;
            // Show ID & Pass as one tab, not its two sub-tabs
            tabKeys.push(k);
          });
          (state.customTabs || []).forEach(t => tabKeys.push(t.id));
          const onTabs = tabKeys.filter(k => isTabAllowedForBiz(b.id, k));
          if (!onTabs.length) {
            return `<div class="empty-state-inline" style="padding:14px;color:var(--text-tertiary);font-size:12.5px;">
              No tabs are turned on for this business yet. Turn some on below.
            </div>`;
          }
          return onTabs.map(k => {
            const disp = tabDisp(k);
            // For ID & Pass, count items across both sub-tabs
            let itemCount;
            if (k === 'idpass') {
              const sys = (state.items['idpass-system'] || []).filter(i => !i.deleted && itemHasBiz(i, b.id)).length;
              const acc = (state.items['idpass-accounts'] || []).filter(i => !i.deleted && itemHasBiz(i, b.id)).length;
              itemCount = sys + acc;
            } else {
              const all = (state.items[k] || []).filter(i => !i.deleted);
              itemCount = all.filter(i => itemHasBiz(i, b.id)).length;
            }
            return `<div class="card-row clickable biz-items-row" data-go="${k}" data-biz-go-view="assigned"><div style="display:flex;align-items:center;gap:10px;"><i class="ti ti-${disp.icon}" style="font-size:16px;color:var(--text-secondary);"></i><strong style="flex:1;font-size:13px;font-weight:600;">${esc(disp.name)}</strong><span class="biz-items-count">${itemCount}</span><i class="ti ti-chevron-right" style="font-size:13px;color:var(--text-tertiary);"></i></div></div>`;
          }).join('');
        })()}
      </div>
      ${!isViewOnly() ? `
        <div class="section-label" style="margin-bottom:10px;">Manage tabs</div>
        <div class="settings-hint" style="margin-bottom:10px;">Rename, reorder, and turn tabs on/off for this business — all here. When a tab is off, items assigned to this business are hidden on that tab. Arrows set the order tabs appear for the business team.</div>
        <div class="biz-tab-manager" id="biz-tab-manager">
          ${(() => {
            const tabKeys = [];
            (state.tabOrder || []).forEach(k => {
              if (k === 'businesses' || k === 'trash') return;
              const def = getTabDef(k);
              if (!def || def.hidden) return;
              // ID & Pass shown as a single tab (no sub-tabs)
              tabKeys.push(k);
            });
            (state.customTabs || []).forEach(t => tabKeys.push(t.id));
            const perBizOrder = state.bizTabOrder?.[b.id] || [];
            const sorted = [];
            perBizOrder.forEach(k => { if (tabKeys.includes(k)) sorted.push(k); });
            tabKeys.forEach(k => { if (!sorted.includes(k)) sorted.push(k); });
            return sorted.map((k, i) => {
              const isAllowed = isTabAllowedForBiz(b.id, k);
              const isCustom = state.customTabs.some(t => t.id === k);
              return `<div class="biz-tab-row">
                <div class="biz-tab-info">
                  <i class="ti ti-${tabDisp(k).icon}" style="font-size:16px;color:var(--text-secondary);flex-shrink:0;"></i>
                  <span class="biz-tab-name">${esc(tabDisp(k).name)}</span>
                </div>
                <button class="btn-icon biz-tab-arrow" data-biz-tab-rename="${k}" aria-label="Rename tab" title="Rename"><i class="ti ti-pencil"></i></button>
                <label class="biz-tab-switch" title="${isAllowed ? 'Tab is on' : 'Tab is off'}">
                  <input type="checkbox" data-tab-toggle="${k}" ${isAllowed ? 'checked' : ''}/>
                  <span class="biz-tab-switch-track"></span>
                </label>
                <button class="btn-icon biz-tab-arrow" data-biz-reorder-up="${k}" ${i === 0 ? 'disabled' : ''} aria-label="Move up"><i class="ti ti-chevron-up"></i></button>
                <button class="btn-icon biz-tab-arrow" data-biz-reorder-down="${k}" ${i === sorted.length - 1 ? 'disabled' : ''} aria-label="Move down"><i class="ti ti-chevron-down"></i></button>
                ${isCustom ? `<button class="btn-icon biz-tab-arrow" data-biz-tab-edit="${k}" aria-label="Edit custom tab" title="Edit tab"><i class="ti ti-edit"></i></button><button class="btn-icon biz-tab-arrow btn-icon-danger" data-biz-tab-delete="${k}" aria-label="Delete custom tab" title="Delete tab"><i class="ti ti-trash"></i></button>` : ''}
              </div>`;
            }).join('');
          })()}
        </div>
        <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
          <button class="btn-link-sm" id="biz-tab-order-reset">Reset to default order</button>
        </div>

        <div class="section-label" style="margin-bottom:10px;">
          Devices signed in
          ${(() => {
            const devs = b.devices || [];
            const activeCount = devs.filter(isDeviceActive).length;
            return activeCount > 0
              ? `<span class="active-devices-pill"><span class="pulse-dot"></span> ${activeCount} active now</span>`
              : `<span class="active-devices-pill inactive">0 active</span>`;
          })()}
        </div>
        <div class="settings-hint" style="margin-bottom:10px;">Devices that have ever signed in to this business as the team member. Sign out a device to force it back to the sign-in screen on its next heartbeat.</div>
        <div style="margin-bottom:20px;" id="biz-devices-list">
          ${(() => {
            const devices = (b.devices || []).slice().sort((a, c) => (c.lastSeen||0) - (a.lastSeen||0));
            if (!devices.length) return '<div style="font-size:12px;color:var(--text-tertiary);">No devices have signed in yet.</div>';
            const myFp = getDeviceFingerprint();
            const active = devices.filter(isDeviceActive);
            const past = devices.filter(d => !isDeviceActive(d));
            const row = (d, isActive) => {
              const browser = (d.userAgent || '').match(/(Chrome|Safari|Firefox|Edge|Opera)\/[\d.]+/)?.[0] || 'Unknown browser';
              const os = (d.userAgent || '').match(/Windows NT [\d.]+|Mac OS X [\d_]+|Android [\d.]+|iPhone OS [\d_]+|Linux/)?.[0] || '';
              const isMe = d.fingerprint === myFp;
              const first = d.firstSeen ? new Date(d.firstSeen).toLocaleString() : '—';
              const last = d.lastSeen ? new Date(d.lastSeen).toLocaleString() : '—';
              const endedAt = Math.max(d.signedOutAt || 0, d.revokedAt || 0);
              const signedOutLine = (!isActive && endedAt) ? `<div style="font-size:11px;color:var(--text-tertiary);">Signed out: ${esc(new Date(endedAt).toLocaleString())}${d.revokedAt && d.revokedAt >= (d.signedOutAt||0) ? ' (by owner)' : ''}</div>` : '';
              const icon = /Mobile|iPhone|Android/i.test(d.userAgent || '') ? 'device-mobile' : 'device-desktop';
              return `<div class="device-row ${isActive ? 'device-row-active' : ''}" data-device-fp="${esc(d.fingerprint)}">
                <i class="ti ti-${icon}" style="font-size:20px;color:${isActive ? 'var(--success)' : 'var(--text-secondary)'};"></i>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:600;color:var(--text-primary);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    <span>${esc(browser)}${os ? ` · ${esc(os)}` : ''}</span>
                    ${isMe ? '<span class="this-device-tag">This device</span>' : ''}
                    ${isActive ? '<span class="active-tag"><span class="pulse-dot"></span>Active</span>' : ''}
                  </div>
                  <div style="font-size:11px;color:var(--text-secondary);">First seen: ${esc(first)}</div>
                  <div style="font-size:11px;color:var(--text-secondary);">Last seen: ${esc(last)}${isActive ? ' · checking in every 30s' : ''}</div>
                  ${signedOutLine}
                </div>
                ${!isViewOnly() && isActive ? `<button class="btn-icon-danger" data-device-signout="${esc(d.fingerprint)}" aria-label="Sign out this device" title="Sign out this device"><i class="ti ti-logout"></i></button>` : ''}
                ${!isViewOnly() && !isActive ? `<button class="btn-icon" data-device-forget="${esc(d.fingerprint)}" aria-label="Remove from history" title="Remove from history"><i class="ti ti-x"></i></button>` : ''}
              </div>`;
            };
            let html = '';
            if (active.length) {
              html += `<div style="font-size:11px;font-weight:700;color:var(--success);text-transform:uppercase;letter-spacing:0.5px;margin:0 0 6px;">Active now (${active.length})</div>`;
              html += active.map(d => row(d, true)).join('');
            }
            if (past.length) {
              html += `<div style="font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.5px;margin:${active.length ? '14px' : '0'} 0 6px;">Past sign-ins (${past.length})</div>`;
              html += past.map(d => row(d, false)).join('');
            }
            return html;
          })()}
        </div>

        <div class="section-label" style="margin-bottom:10px;">Data</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px;">
          <button class="btn-outline btn-sm" id="biz-export"><i class="ti ti-download" style="font-size:13px;vertical-align:-2px;"></i> Export</button>
          <button class="btn-outline btn-sm" id="biz-import"><i class="ti ti-upload" style="font-size:13px;vertical-align:-2px;"></i> Import</button>
          <input type="file" id="biz-import-input" accept=".json,application/json" style="display:none;"/>
          <button class="btn-outline btn-sm" id="biz-clear"><i class="ti ti-trash" style="font-size:13px;vertical-align:-2px;"></i> Clear data</button>
        </div>
      ` : ''}
      <div class="section-label" style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;">
        <span>Activity</span>
        ${(b.activity || []).length > 0 && !isViewOnly() ? `<button class="btn-link-sm" id="biz-activity-clear-all" style="color:var(--danger);"><i class="ti ti-trash" style="font-size:12px;vertical-align:-2px;margin-right:3px;"></i>Clear all</button>` : ''}
      </div>
      <div style="margin-bottom:20px;" id="biz-activity-wrap">
        ${(() => {
          const acts = b.activity || [];
          if (!acts.length) return '<div style="font-size:12px;color:var(--text-tertiary);">No activity yet.</div>';
          const expanded = !!state.__bizActivityExpanded?.[b.id];
          const shown = expanded ? acts : acts.slice(0, 10);
          let html = shown.map(a => {
            const d = new Date(a.ts);
            const stamp = `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
            const delBtn = !isViewOnly() ? `<button class="biz-activity-del" data-activity-del="${esc(a.id)}" aria-label="Delete entry" title="Delete entry"><i class="ti ti-x"></i></button>` : '';
            return `<div class="biz-activity-row">
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;color:var(--text-primary);line-height:1.4;">${esc(a.label)}</div>
                <div style="font-size:11px;color:var(--text-tertiary);margin-top:2px;">${esc(stamp)} · ${esc(relTime(a.ts))}</div>
              </div>
              ${delBtn}
            </div>`;
          }).join('');
          if (!expanded && acts.length > 10) {
            html += `<button class="btn-link-sm" id="biz-activity-more" style="margin-top:6px;">View ${acts.length - 10} more</button>`;
          } else if (expanded && acts.length > 10) {
            html += `<button class="btn-link-sm" id="biz-activity-less" style="margin-top:6px;">Show less</button>`;
          }
          return html;
        })()}
      </div>
      ${!isViewOnly() ? `<button class="btn-danger" id="biz-delete" style="font-size:12px;font-weight:500;"><i class="ti ti-trash" style="font-size:13px;vertical-align:-2px;"></i> Delete business</button>` : ''}
    `;
    if (!isViewOnly()) $('#biz-edit').onclick = () => openBusinessModal(b.id);
    const pwToggleBtn = $('#biz-pw-toggle');
    if (pwToggleBtn) pwToggleBtn.onclick = async () => {
      const el = $('#biz-pw'), showing = el.dataset.show === '1';
      el.dataset.show = showing ? '0' : '1';
      if (showing) {
        el.textContent = bizPasswordMasked(b);
      } else {
        const plain = await bizPasswordDecrypt(b);
        el.textContent = (plain != null && plain !== '') ? plain : bizPasswordMasked(b);
      }
      pwToggleBtn.innerHTML = `<i class="ti ${showing ? 'ti-eye' : 'ti-eye-off'}"></i>`;
      window.__InfosIcons?.replaceIcons(pwToggleBtn);
    };
    if (!isViewOnly()) {
      // Allowed tabs toggles (checkbox change)
      c.querySelectorAll('[data-tab-toggle]').forEach(el => el.onchange = () => {
        const k = el.dataset.tabToggle;
        // Compute the default-allowed set (all tabs the biz could see)
        const defaultAllowed = [];
        (state.tabOrder || []).forEach(ok => {
          if (ok === 'businesses' || ok === 'trash') return;
          const def = getTabDef(ok); if (!def || def.hidden) return;
          if (ok === 'idpass') { defaultAllowed.push('idpass-system', 'idpass-accounts'); }
          else defaultAllowed.push(ok);
        });
        (state.customTabs || []).forEach(t => defaultAllowed.push(t.id));
        let cur = state.bizAllowedTabs[b.id];
        if (!cur) cur = [...defaultAllowed];
        // The 'idpass' toggle controls BOTH sub-tabs together
        const keys = k === 'idpass' ? ['idpass-system', 'idpass-accounts'] : [k];
        keys.forEach(kk => {
          if (el.checked && !cur.includes(kk)) cur.push(kk);
          else if (!el.checked) cur = cur.filter(x => x !== kk);
        });
        state.bizAllowedTabs[b.id] = cur;
        persistAll();
        state.history.pop(); setActive('biz-detail','fade',{bizId:b.id,title:b.name,sub:b.email});
      });
      // Per-business tab reordering (up/down arrows)
      function reorderBizTab(k, direction) {
        if (!state.bizTabOrder) state.bizTabOrder = {};
        const tabKeys = [];
        (state.tabOrder || []).forEach(ok => {
          if (ok === 'businesses' || ok === 'trash') return;
          const def = getTabDef(ok); if (!def || def.hidden) return;
          // ID & Pass is a single reorderable unit
          tabKeys.push(ok);
        });
        (state.customTabs || []).forEach(t => tabKeys.push(t.id));
        const existing = state.bizTabOrder[b.id] || [];
        const sorted = [];
        existing.forEach(x => { if (tabKeys.includes(x)) sorted.push(x); });
        tabKeys.forEach(x => { if (!sorted.includes(x)) sorted.push(x); });
        const idx = sorted.indexOf(k);
        if (idx < 0) return;
        const newIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (newIdx < 0 || newIdx >= sorted.length) return;
        [sorted[idx], sorted[newIdx]] = [sorted[newIdx], sorted[idx]];
        state.bizTabOrder[b.id] = sorted;
        persistAll();
        state.history.pop(); setActive('biz-detail','fade',{bizId:b.id,title:b.name,sub:b.email});
      }
      c.querySelectorAll('[data-biz-reorder-up]').forEach(el => el.onclick = () => reorderBizTab(el.dataset.bizReorderUp, 'up'));
      c.querySelectorAll('[data-biz-reorder-down]').forEach(el => el.onclick = () => reorderBizTab(el.dataset.bizReorderDown, 'down'));
      c.querySelectorAll('[data-biz-tab-edit]').forEach(el => el.onclick = () => openTabModal(el.dataset.bizTabEdit));
      // Delete a custom tab from within business settings
      c.querySelectorAll('[data-biz-tab-delete]').forEach(el => el.onclick = () => {
        const k = el.dataset.bizTabDelete;
        const ct = state.customTabs.find(t => t.id === k);
        if (!ct) return;
        const count = (state.items[k] || []).filter(i => !i.deleted).length;
        confirmAction({
          title: `Delete "${ct.name}"?`,
          message: `This permanently deletes the "${ct.name}" tab${count ? ` and its ${count} item${count === 1 ? '' : 's'}` : ''} for all businesses. This cannot be undone.`,
          confirmLabel: 'Delete tab',
          danger: true,
          onConfirm: () => {
            deleteCustomTab(k);
            state.history.pop(); setActive('biz-detail', 'fade', { bizId: b.id, title: b.name, sub: b.email });
            toast('Tab deleted');
          }
        });
      });
      // Rename any tab for this business (built-in or custom) — uses biz scope
      c.querySelectorAll('[data-biz-tab-rename]').forEach(el => el.onclick = () => {
        const k = el.dataset.bizTabRename;
        // For ID & Pass container, rename the container key
        openRenameModal(k, 'biz');
      });
      const resetBtn = $('#biz-tab-order-reset');
      if (resetBtn) resetBtn.onclick = () => {
        if (state.bizTabOrder) delete state.bizTabOrder[b.id];
        persistAll();
        state.history.pop(); setActive('biz-detail','fade',{bizId:b.id,title:b.name,sub:b.email});
        toast('Tab order reset');
      };
      // Per-business data tools
      $('#biz-export').onclick = () => exportBusiness(b.id);
      $('#biz-import').onclick = () => $('#biz-import-input').click();
      $('#biz-import-input').onchange = e => { if (e.target.files[0]) importBusinessData(b.id, e.target.files[0]); };
      $('#biz-clear').onclick = () => {
        confirmAction({
          title: `Clear all data for "${b.name}"?`,
          message: 'Items, tags, and activity for this business will be removed. The business itself stays. This cannot be undone.',
          confirmLabel: 'Continue',
          danger: true,
          requireTwice: true,
          title2: 'Clear business data permanently?',
          message2: `All items and tags for "${b.name}" will be permanently deleted.`,
          confirmLabel2: 'Clear data forever',
          onConfirm: () => {
            Object.keys(state.items).forEach(k => {
              state.items[k] = state.items[k].map(it => {
                const bids = itemBizIds(it).filter(id => id !== b.id);
                if (bids.length === 0 && (itemBizIds(it).length > 0)) {
                  // Was assigned to this biz only — remove the item entirely
                  return null;
                }
                it.bizIds = bids; delete it.bizId;
                return it;
              }).filter(Boolean);
            });
            b.tags = []; b.nextTagId = 1; b.activity = [{ id: 'a' + Date.now(), ts: Date.now(), action: 'cleared', label: 'Business data cleared' }];
            persistAll();
            state.history.pop(); setActive('biz-detail','fade',{bizId:b.id,title:b.name,sub:b.email});
            toast('Business data cleared');
          }
        });
      };
      // Device sign-out (active device → revoke session)
      c.querySelectorAll('[data-device-signout]').forEach(btn => btn.onclick = () => {
        const fp = btn.dataset.deviceSignout;
        const d = (b.devices || []).find(x => x.fingerprint === fp);
        if (!d) return;
        const browser = (d.userAgent || '').match(/(Chrome|Safari|Firefox|Edge|Opera)\/[\d.]+/)?.[0] || 'Unknown browser';
        const isMe = fp === getDeviceFingerprint();
        confirmAction({
          title: isMe ? 'Sign out this device?' : `Sign out ${browser}?`,
          message: isMe
            ? "You're using this device right now. Signing out will return you to the sign-in screen."
            : "That device will be signed out automatically. It can sign in again with the business credentials.",
          confirmLabel: 'Sign out device',
          danger: true,
          onConfirm: () => {
            d.revokedAt = Date.now();
            recordActivity(b, 'device-revoked', `${browser} signed out by owner`);
            persistAll();
            if (isMe) { setTimeout(() => logout(), 200); return; }
            state.history.pop(); setActive('biz-detail','fade',{bizId:b.id,title:b.name,sub:b.email});
            toast('Device signed out');
          }
        });
      });
      // Forget a past device (remove from history list)
      c.querySelectorAll('[data-device-forget]').forEach(btn => btn.onclick = () => {
        const fp = btn.dataset.deviceForget;
        confirmAction({
          title: 'Remove this device from history?',
          message: 'It will disappear from the list. If it signs in again, it will reappear as a new entry.',
          confirmLabel: 'Remove',
          danger: false,
          onConfirm: () => {
            b.devices = (b.devices || []).filter(x => x.fingerprint !== fp);
            persistAll();
            state.history.pop(); setActive('biz-detail','fade',{bizId:b.id,title:b.name,sub:b.email});
            toast('Removed from history');
          }
        });
      });
    }
    // Activity controls: view more / less, delete one, clear all.
    // These re-render the biz-detail page; wrap in rerenderPreservingScroll so
    // the page stays where the user was (load below, don't jump to top).
    const moreBtn = $('#biz-activity-more');
    if (moreBtn) moreBtn.onclick = () => {
      state.__bizActivityExpanded = state.__bizActivityExpanded || {};
      state.__bizActivityExpanded[b.id] = true;
      rerenderPreservingScroll(() => { state.history.pop(); setActive('biz-detail','none',{bizId:b.id,title:b.name,sub:b.email}); });
    };
    const lessBtn = $('#biz-activity-less');
    if (lessBtn) lessBtn.onclick = () => {
      if (state.__bizActivityExpanded) state.__bizActivityExpanded[b.id] = false;
      rerenderPreservingScroll(() => { state.history.pop(); setActive('biz-detail','none',{bizId:b.id,title:b.name,sub:b.email}); });
    };
    if (!isViewOnly()) {
      c.querySelectorAll('[data-activity-del]').forEach(btn => btn.onclick = () => {
        const id = btn.dataset.activityDel;
        b.activity = (b.activity || []).filter(a => a.id !== id);
        persistAll();
        rerenderPreservingScroll(() => { state.history.pop(); setActive('biz-detail','none',{bizId:b.id,title:b.name,sub:b.email}); });
      });
      const clearAll = $('#biz-activity-clear-all');
      if (clearAll) clearAll.onclick = () => {
        confirmAction({
          title: 'Clear all activity?',
          message: `All ${(b.activity || []).length} activity entries for "${b.name}" will be deleted. The items themselves stay.`,
          confirmLabel: 'Clear activity',
          danger: true,
          onConfirm: () => {
            b.activity = [];
            if (state.__bizActivityExpanded) delete state.__bizActivityExpanded[b.id];
            persistAll();
            state.history.pop(); setActive('biz-detail','fade',{bizId:b.id,title:b.name,sub:b.email});
            toast('Activity cleared');
          }
        });
      };
    }
    c.querySelectorAll('[data-go]').forEach(el => el.onclick = () => {
      const view = el.dataset.bizGoView || 'assigned';
      state.activeBizId = view === 'unassigned' ? 'none' : b.id;
      state.activeTagId = null;
      updateActiveBizDisplay();
      setActive(el.dataset.go);
      persistAll();
    });
    if (!isViewOnly()) $('#biz-delete').onclick = () => {
      confirmAction({
        title: `Delete "${b.name}"?`,
        message: `This permanently deletes the business and any items assigned only to it. Items shared with other businesses stay. To confirm, type the business email address below.`,
        confirmLabel: 'Delete business',
        danger: true,
        typeToConfirm: b.email,
        typeToConfirmLabel: `Type the business email (${b.email}) to confirm`,
        onConfirm: () => {
          Object.keys(state.items).forEach(k => {
            state.items[k] = state.items[k].map(it => {
              const oldBids = itemBizIds(it);
              if (!oldBids.includes(b.id)) return it;
              const newBids = oldBids.filter(id => id !== b.id);
              if (newBids.length === 0) return null; // was assigned only to this biz → drop
              it.bizIds = newBids; delete it.bizId;
              return it;
            }).filter(Boolean);
          });
          state.businesses = state.businesses.filter(x => x.id !== b.id);
          if (state.bizAllowedTabs && state.bizAllowedTabs[b.id]) delete state.bizAllowedTabs[b.id];
          if (state.bizTabOrder && state.bizTabOrder[b.id]) delete state.bizTabOrder[b.id];
          if (state.itemOrder && state.itemOrder[b.id]) delete state.itemOrder[b.id];
          if (state.activeBizId === b.id) state.activeBizId = 'all';
          updateActiveBizDisplay(); setActive('businesses','left'); buildNav(); persistAll();
          toast('Business deleted');
        }
      });
    };
  }

  // Import a JSON file into a single business (replaces items for that biz)
  function importBusinessData(bizId, file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (data._meta?.kind !== 'business' || !data.business) { toast('This file is not a business export'); return; }
        // Remove existing items for this biz (the biz-only ones; multi-biz items: just strip this biz)
        Object.keys(state.items).forEach(k => {
          state.items[k] = state.items[k].map(it => {
            const oldBids = itemBizIds(it);
            if (!oldBids.includes(bizId)) return it;
            const newBids = oldBids.filter(id => id !== bizId);
            if (newBids.length === 0) return null;
            it.bizIds = newBids; delete it.bizId;
            return it;
          }).filter(Boolean);
        });
        // Add imported items, retargeted to this biz
        Object.keys(data.items || {}).forEach(tk => {
          if (!state.items[tk]) state.items[tk] = [];
          data.items[tk].forEach(it => {
            it.id = 'x' + (state.nextItemId++); it.bizIds = [bizId]; delete it.bizId;
            state.items[tk].push(it);
          });
        });
        persistAll();
        state.history.pop(); setActive('biz-detail','fade',{bizId,title:bizById(bizId)?.name,sub:bizById(bizId)?.email});
        toast('Imported successfully');
      } catch { toast('Could not parse file'); }
    };
    reader.readAsText(file);
  }

  // View-only (business member) item detail — opens as a centered, blurred-backdrop
  // modal that shows ONLY the fields that actually have content.
  function openItemDetailModal(tabKey, itemId) {
    const it = state.items[tabKey]?.find(x => x.id === itemId);
    if (!it) { toast('Item not found'); return; }
    const title = it.title || it.name || 'Item';
    const isCreds = tabKey === 'idpass-system' || tabKey === 'idpass-accounts';
    const createdAt = itemCreatedAt(it);
    const updatedAt = itemUpdatedAt(it);
    const edited = (it.history || []).some(e => e.action === 'edited');
    const sections = [];

    // Short name
    if (it.shortName) {
      sections.push(`<div class="detail-section"><div class="section-label">Short name</div><div class="info-pill">${esc(it.shortName)}</div></div>`);
    }
    // Credentials
    if (isCreds && (it.username || it.password)) {
      sections.push(`<div class="detail-section">
        <div class="section-label">Credentials</div>
        <div class="info-pill">
          ${it.username ? `<div class="detail-meta-row"><i class="ti ti-user" style="font-size:13px;"></i><span style="width:78px;">Username</span><strong class="cred-mono">${esc(it.username)}</strong><button class="btn-icon copy-link-btn" data-copy="${esc(it.username)}" data-copy-label="Username" style="margin-left:auto;"><i class="ti ti-copy"></i></button></div>` : ''}
          ${it.password ? `<div class="detail-meta-row"><i class="ti ti-lock" style="font-size:13px;"></i><span style="width:78px;">Password</span><strong class="cred-mono cred-password" data-show="1" data-real="${esc(it.password)}">${esc(it.password)}</strong><button class="btn-icon copy-link-btn" data-copy="${esc(it.password)}" data-copy-label="Password" style="margin-left:auto;"><i class="ti ti-copy"></i></button></div>` : ''}
        </div>
      </div>`);
    }
    // Link
    if (it.link) {
      sections.push(`<div class="detail-section">
        <div class="section-label">Link</div>
        <div class="info-pill" style="display:flex;align-items:center;gap:8px;">
          <i class="ti ti-link" style="font-size:13px;color:var(--text-secondary);"></i>
          <a href="${esc(safeUrl(it.link))}" target="_blank" rel="noopener noreferrer" style="flex:1;min-width:0;color:var(--accent-text);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono);font-size:12px;">${esc(it.link)}</a>
          <button class="btn-icon copy-link-btn" data-copy="${esc(it.link)}" data-copy-label="Link"><i class="ti ti-copy"></i></button>
        </div>
      </div>`);
    }
    // Photo / attachment image
    if (tabKey === 'schedule' && it.photo) {
      sections.push(`<div class="detail-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div class="section-label" style="margin:0;">Attachment</div>
          <a class="btn-link-sm" href="${esc(it.photo)}" download="${esc((it.title || it.name || 'attachment').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60))}.png"><i class="ti ti-download" style="font-size:13px;vertical-align:-2px;margin-right:4px;"></i>Download</a>
        </div>
        <div style="border-radius:var(--radius-md);overflow:hidden;cursor:zoom-in;background:var(--surface-1);" id="dm-photo">
          <img src="${esc(it.photo)}" alt="${esc(title)}" style="width:100%;display:block;"/>
        </div>
      </div>`);
    }
    // Message / description
    if (it.description || it.message) {
      sections.push(`<div class="detail-section">
        <div class="section-label">${tabKey === 'notices' ? 'Message' : 'Description'}</div>
        <div class="info-pill" style="white-space:pre-wrap;line-height:1.6;color:var(--text-primary);">${esc(it.description || it.message)}</div>
      </div>`);
    }
    // Notes — only if present
    if (it.notes) {
      sections.push(`<div class="detail-section"><div class="section-label">Notes</div><div class="info-pill" style="white-space:pre-wrap;line-height:1.6;">${esc(it.notes)}</div></div>`);
    }
    // Attachments — only if any
    if ((it.attachments || []).length) {
      sections.push(`<div class="detail-section">
        <div class="section-label">Attachments · ${it.attachments.length}</div>
        <div>${it.attachments.map(a => `<div class="attachment-tile"><i class="ti ti-file"></i><div style="flex:1;min-width:0;"><div>${esc(a.name)}</div><div class="attachment-meta">${(a.size / 1024).toFixed(1)} KB</div></div><a href="${a.data}" download="${esc(a.name)}" class="btn-icon" style="text-decoration:none;"><i class="ti ti-download"></i></a></div>`).join('')}</div>
      </div>`);
    }
    // Meta footer: tab + created (+ edited). Always has at least tab + created.
    sections.push(`<div class="detail-section">
      <div class="info-pill">
        <div class="detail-meta-row"><i class="ti ti-folder" style="font-size:13px;"></i><span style="width:78px;">Tab</span><strong>${esc(tabDisp(tabKey).name)}</strong></div>
        <div class="detail-meta-row"><i class="ti ti-clock" style="font-size:13px;"></i><span style="width:78px;">Created</span><strong>${formatDateTime(createdAt)}</strong></div>
        ${edited ? `<div class="detail-meta-row"><i class="ti ti-pencil" style="font-size:13px;"></i><span style="width:78px;">Edited</span><strong>${formatDateTime(updatedAt)}</strong></div>` : ''}
      </div>
    </div>`);

    openModal(`
      <div class="modal-head"><h3 style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(title)}</h3><button id="m-close" class="btn-icon" aria-label="Close"><i class="ti ti-x"></i></button></div>
      <div class="modal-body detail-modal-body">${sections.join('')}</div>
    `);
    $('#m-close').onclick = closeModal;
    const modalEl = document.getElementById('modal');
    // Copy buttons
    modalEl.querySelectorAll('.copy-link-btn[data-copy]').forEach(btn => btn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(btn.dataset.copy);
      toast(`${btn.dataset.copyLabel || 'Link'} copied`); haptic();
    });
    // Password show/hide
    modalEl.querySelectorAll('[data-pw-show]').forEach(btn => btn.onclick = (e) => {
      e.stopPropagation();
      const span = btn.parentElement.querySelector('.cred-password');
      if (!span) return;
      const showing = span.dataset.show === '1';
      span.dataset.show = showing ? '0' : '1';
      span.textContent = showing ? '•'.repeat(Math.min(span.dataset.real.length, 10)) : span.dataset.real;
      btn.innerHTML = `<i class="ti ${showing ? 'ti-eye' : 'ti-eye-off'}"></i>`;
      window.__InfosIcons?.replaceIcons(btn);
    });
    const dmPhoto = document.getElementById('dm-photo');
    if (dmPhoto) dmPhoto.onclick = () => openPhotoLightbox(it.photo, title);
  }

  function renderItemDetail(c, ctx) {
    const tabKey = ctx.itemTab, itemId = ctx.itemId;
    const it = state.items[tabKey]?.find(x => x.id === itemId);
    if (!it) { c.innerHTML = emptyState('alert-circle', 'Not found', ''); return; }
    // Business members always see the compact, only-populated detail MODAL,
    // never the full editable page — regardless of how they reached here
    // (list tap, search, activity log, or swipe navigation).
    if (isViewOnly()) {
      c.innerHTML = '';
      // Drop the item-detail history entry so Back returns to the list, then show modal.
      if (state.history[state.history.length - 1]?.startsWith('item-detail')) state.history.pop();
      const prev = state.history[state.history.length - 1] || (tabKey.startsWith('idpass') ? 'idpass' : tabKey);
      setActive(prev.split(':')[0], 'fade');
      setTimeout(() => openItemDetailModal(tabKey, itemId), 60);
      return;
    }
    const title = it.title || it.name || 'Item';
    const bids = itemBizIds(it);
    const isCreds = tabKey === 'idpass-system' || tabKey === 'idpass-accounts';
    const createdAt = itemCreatedAt(it);
    const updatedAt = itemUpdatedAt(it);

    const credsSection = (isCreds && (it.username || it.password)) ? `
      <div class="detail-section">
        <div class="section-label" style="margin-bottom:8px;">Credentials</div>
        <div class="info-pill">
          ${it.username ? `<div class="detail-meta-row"><i class="ti ti-user" style="font-size:13px;"></i><span style="width:80px;">Username</span><strong class="cred-mono">${esc(it.username)}</strong><button class="btn-icon copy-link-btn" data-copy="${esc(it.username)}" data-copy-label="Username" style="margin-left:auto;"><i class="ti ti-copy"></i></button></div>` : ''}
          ${it.password ? `<div class="detail-meta-row"><i class="ti ti-lock" style="font-size:13px;"></i><span style="width:80px;">Password</span><strong class="cred-mono cred-password" data-show="1" data-real="${esc(it.password)}">${esc(it.password)}</strong><button class="btn-icon copy-link-btn" data-copy="${esc(it.password)}" data-copy-label="Password" style="margin-left:auto;"><i class="ti ti-copy"></i></button></div>` : ''}
        </div>
      </div>` : '';

    const linkSection = (it.link) ? `
      <div class="detail-section">
        <div class="section-label" style="margin-bottom:8px;">Link</div>
        <div class="info-pill" style="display:flex;align-items:center;gap:8px;">
          <i class="ti ti-link" style="font-size:13px;color:var(--text-secondary);"></i>
          <a href="${esc(safeUrl(it.link))}" target="_blank" rel="noopener" style="flex:1;min-width:0;color:var(--accent-text);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--font-mono);font-size:12px;">${esc(it.link)}</a>
          <button class="btn-icon copy-link-btn" data-copy="${esc(it.link)}" data-copy-label="Link"><i class="ti ti-copy"></i></button>
        </div>
      </div>` : '';

    // Photo section for schedule/attachment items — includes a download link for biz users too
    const photoSection = (tabKey === 'schedule' && it.photo) ? `
      <div class="detail-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div class="section-label">Attachment</div>
          <a class="btn-link-sm" href="${esc(it.photo)}" download="${esc((it.title || it.name || 'attachment').replace(/[^a-z0-9._-]+/gi, '_').slice(0, 60))}.png"><i class="ti ti-download" style="font-size:13px;vertical-align:-2px;margin-right:4px;"></i>Download</a>
        </div>
        <div style="border-radius:var(--radius-md);overflow:hidden;cursor:zoom-in;background:var(--surface-1);" id="d-photo">
          <img src="${esc(it.photo)}" alt="${esc(it.title || it.name || 'Attachment')}" style="width:100%;display:block;"/>
        </div>
      </div>` : '';

    const descSection = (it.description || it.message) ? `
      <div class="detail-section">
        <div class="section-label" style="margin-bottom:8px;">${tabKey === 'notices' ? 'Message' : 'Description'}</div>
        <div class="info-pill" style="white-space:pre-wrap;line-height:1.6;color:var(--text-primary);">${esc(it.description || it.message || '')}</div>
      </div>` : '';

    c.innerHTML = `
      <div class="detail-actions">
        ${!isViewOnly() ? `<button class="btn-outline btn-sm" id="d-edit"><i class="ti ti-edit" style="font-size:13px;vertical-align:-2px;"></i> Edit</button>` : ''}
        ${!isViewOnly() ? `<button class="btn-outline btn-sm" id="d-pin"><i class="ti ti-${it.pinned ? 'pin-filled' : 'pin'}" style="font-size:13px;vertical-align:-2px;"></i> ${it.pinned ? 'Unpin' : 'Pin'}</button>` : ''}
      </div>
      <div class="detail-section">
        <div class="section-label" style="margin-bottom:8px;">Details</div>
        <div class="info-pill">
          ${it.shortName ? `<div class="detail-meta-row"><i class="ti ti-letter-s" style="font-size:13px;"></i><span style="width:80px;">Short name</span><strong>${esc(it.shortName)}</strong></div>` : ''}
          <div class="detail-meta-row"><i class="ti ti-folder" style="font-size:13px;"></i><span style="width:80px;">Tab</span><strong>${esc(tabDisp(tabKey).name)}</strong></div>
          ${bids.length ? `<div class="detail-meta-row" style="align-items:flex-start;"><i class="ti ti-building-store" style="font-size:13px;margin-top:2px;"></i><span style="width:80px;">${bids.length === 1 ? 'Business' : 'Businesses'}</span><span style="display:flex;flex-wrap:wrap;gap:4px;">${bizChipsHTML(bids, false)}</span></div>` : ''}
          ${(it.tagIds && it.tagIds.length && bids.length) ? `<div class="detail-meta-row" style="align-items:flex-start;"><i class="ti ti-tags" style="font-size:13px;margin-top:2px;"></i><span style="width:80px;">Tags</span><span style="display:flex;flex-wrap:wrap;gap:4px;">${tagChipsHTML(bids[0], it.tagIds)}</span></div>` : ''}
          <div class="detail-meta-row"><i class="ti ti-clock" style="font-size:13px;"></i><span style="width:80px;">Created</span><strong>${formatDateTime(createdAt)}</strong></div>
          ${(it.history || []).find(e => e.action === 'edited') ? `<div class="detail-meta-row"><i class="ti ti-pencil" style="font-size:13px;"></i><span style="width:80px;">Edited</span><strong>${formatDateTime(updatedAt)}</strong></div>` : ''}
        </div>
      </div>
      ${credsSection}
      ${linkSection}
      ${photoSection}
      ${descSection}
      <div class="detail-section">
        <div class="section-label" style="margin-bottom:8px;">Notes</div>
        ${isViewOnly() ? `<div class="info-pill">${esc(it.notes || '(no notes)')}</div>` : `<textarea id="d-notes" placeholder="Add notes…">${esc(it.notes || '')}</textarea>`}
      </div>
      <div class="detail-section">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <div class="section-label">Attachments · ${(it.attachments || []).length}</div>
          ${isViewOnly() ? '' : `<button class="btn-link-sm" id="d-add-att"><i class="ti ti-paperclip" style="font-size:13px;vertical-align:-2px;"></i> Add file</button>`}
        </div>
        <input type="file" id="d-att-input" style="display:none;"/>
        <div id="d-att-list">${(it.attachments || []).map((a, i) => `<div class="attachment-tile"><i class="ti ti-file"></i><div style="flex:1;min-width:0;"><div>${esc(a.name)}</div><div class="attachment-meta">${(a.size / 1024).toFixed(1)} KB</div></div><a href="${a.data}" download="${esc(a.name)}" class="btn-icon" style="text-decoration:none;"><i class="ti ti-download"></i></a>${isViewOnly() ? '' : `<button class="btn-icon" data-att-rm="${i}"><i class="ti ti-x"></i></button>`}</div>`).join('') || '<div style="font-size:12px;color:var(--text-tertiary);">No attachments.</div>'}</div>
      </div>
      <div class="detail-section">
        <div class="section-label" style="margin-bottom:8px;">History</div>
        <div>${(it.history || []).length ? it.history.map(h => `<div class="history-row">${esc(h.action.charAt(0).toUpperCase() + h.action.slice(1))}<time>${formatDateTime(h.ts)}</time></div>`).join('') : '<div style="font-size:12px;color:var(--text-tertiary);">No history.</div>'}</div>
      </div>
      ${isViewOnly() ? '' : `<button class="btn-danger" id="d-delete" style="font-size:12px;margin-top:8px;"><i class="ti ti-trash" style="font-size:13px;vertical-align:-2px;"></i> Move to trash</button>`}
    `;
    // Copy buttons
    c.querySelectorAll('.copy-link-btn[data-copy]').forEach(btn => btn.onclick = (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(btn.dataset.copy);
      toast(`${btn.dataset.copyLabel || 'Link'} copied`);
      haptic();
    });
    // Password show/hide
    c.querySelectorAll('[data-pw-show]').forEach(btn => btn.onclick = (e) => {
      e.stopPropagation();
      const span = btn.parentElement.querySelector('.cred-password');
      if (!span) return;
      const showing = span.dataset.show === '1';
      const real = span.dataset.real;
      span.dataset.show = showing ? '0' : '1';
      span.textContent = showing ? '•'.repeat(Math.min(real.length, 10)) : real;
      btn.innerHTML = `<i class="ti ${showing ? 'ti-eye' : 'ti-eye-off'}"></i>`;
      window.__InfosIcons?.replaceIcons(btn);
    });
    // Schedule/attachment photo → tap to open lightbox (which has its own download)
    const dPhoto = $('#d-photo');
    if (dPhoto) dPhoto.onclick = () => openPhotoLightbox(it.photo, it.title || it.name);
    if (!isViewOnly()) {
      $('#d-edit').onclick = () => openItemModal(tabKey, itemId);
      $('#d-pin').onclick = () => { it.pinned = !it.pinned; recordHistory(it, it.pinned ? 'pinned' : 'unpinned'); persistAll(); state.history.pop(); setActive('item-detail','fade',{itemTab:tabKey,itemId,title}); };
      const notes = $('#d-notes');
      if (notes) notes.oninput = () => { it.notes = notes.value; persistAll(); };
      $('#d-add-att').onclick = () => $('#d-att-input').click();
      $('#d-att-input').onchange = e => {
        const file = e.target.files[0]; if (!file) return;
        if (file.size > 2 * 1024 * 1024) { toast('File too large (max 2MB)'); return; }
        const r = new FileReader();
        r.onload = ev => { it.attachments.push({ name: file.name, size: file.size, data: ev.target.result, ts: Date.now() }); recordHistory(it, 'attached file'); persistAll(); state.history.pop(); setActive('item-detail','fade',{itemTab:tabKey,itemId,title}); };
        r.readAsDataURL(file);
      };
      $$('[data-att-rm]').forEach(el => el.onclick = () => { it.attachments.splice(parseInt(el.dataset.attRm), 1); recordHistory(it, 'removed attachment'); persistAll(); state.history.pop(); setActive('item-detail','fade',{itemTab:tabKey,itemId,title}); });
      $('#d-delete').onclick = () => {
        confirmAction({
          title: 'Move to trash?',
          message: 'You can restore this item within 30 days.',
          confirmLabel: 'Move to trash',
          onConfirm: () => {
            it.deleted = true; it.deletedAt = Date.now(); it.deletedFromTab = tabKey;
            recordHistory(it, 'trashed');
            recordGlobalActivity(tabKey, 'trashed', it);
            persistAll(); updateBadges(); buildNav(); goBack(); toast('Moved to trash');
          }
        });
      };
    }
  }

  function renderTrash(c) {
    const all = [];
    Object.keys(state.items).forEach(tk => {
      (state.items[tk] || []).filter(i => i.deleted).forEach(it => all.push({ it, tab: tk }));
    });
    if (!all.length) { c.innerHTML = emptyState('trash', 'Trash is empty', 'Deleted items appear here for 30 days.'); return; }
    all.sort((a, b) => (b.it.deletedAt || 0) - (a.it.deletedAt || 0));
    let html = `<div class="info-pill" style="margin-bottom:14px;">Items in trash are permanently deleted after 30 days.</div>`;
    html += all.map(({ it, tab }) => {
      const title = it.title || it.name || it.label || 'Item';
      const days = Math.ceil((30 * 86400000 - (Date.now() - (it.deletedAt || 0))) / 86400000);
      return `<div class="card-row" data-tt="${tab}" data-ii="${it.id}">
        <div style="display:flex;align-items:center;gap:12px;">
          <i class="ti ti-trash" style="font-size:17px;color:var(--text-secondary);"></i>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:500;">${esc(title)}</div>
            <div style="font-size:11px;color:var(--text-secondary);">${esc(tabDisp(tab).name)} · ${days} day${days === 1 ? '' : 's'} left</div>
          </div>
          <button class="btn-icon" data-restore="${it.id}" data-rt="${tab}" aria-label="Restore"><i class="ti ti-restore"></i></button>
          <button class="btn-icon btn-danger-icon" data-purge="${it.id}" data-pt="${tab}" aria-label="Delete forever"><i class="ti ti-x"></i></button>
        </div>
      </div>`;
    }).join('');
    c.innerHTML = html;
    $$('[data-restore]', c).forEach(el => el.onclick = () => {
      const tab = el.dataset.rt, id = el.dataset.restore;
      const it = state.items[tab].find(x => x.id === id);
      if (it) { it.deleted = false; delete it.deletedAt; delete it.deletedFromTab; recordHistory(it, 'restored'); recordGlobalActivity(tab, 'restored', it); persistAll(); state.history.pop(); setActive('trash','fade'); updateBadges(); buildNav(); toast('Restored'); }
    });
    $$('[data-purge]', c).forEach(el => el.onclick = () => {
      const tab = el.dataset.pt, id = el.dataset.purge;
      confirmAction({
        title: 'Delete forever?',
        message: 'This item will be permanently removed and cannot be restored.',
        confirmLabel: 'Delete forever',
        onConfirm: () => {
          state.items[tab] = state.items[tab].filter(x => x.id !== id);
          persistAll(); state.history.pop(); setActive('trash','fade'); updateBadges(); buildNav(); toast('Deleted');
        }
      });
    });
  }

  function renderUserGuide(c) {
    const bizCtx = state.bizContext ? bizById(state.bizContext) : null;
    if (bizCtx) {
      // BUSINESS user guide
      c.innerHTML = viewOnlyBanner() + `
        <div style="max-width:600px;">
          <h2 class="page-h2">User guide for <strong>${esc(bizCtx.name)}</strong></h2>
          <p class="page-lead">You're signed in with view-only access to "${esc(bizCtx.name)}". Here's what you can do.</p>
          <div class="guide-section">
            <h3 class="guide-h3">What you can see</h3>
            <ul class="guide-list">
              <li>All <strong>Notices</strong>, <strong>System</strong> entries, <strong>Games</strong>, and <strong>ID & Pass</strong> records the owner has assigned to ${esc(bizCtx.name)}.</li>
              <li>Items the owner has not assigned to you are <strong>not visible</strong>.</li>
              <li>Tabs the owner has not enabled for your business are hidden.</li>
            </ul>
          </div>
          <div class="guide-section">
            <h3 class="guide-h3">What you cannot do</h3>
            <ul class="guide-list">
              <li>Create, edit, or delete any items.</li>
              <li>See other businesses or unassigned data.</li>
              <li>Change the owner's settings.</li>
            </ul>
          </div>
          <div class="guide-section">
            <h3 class="guide-h3">Useful actions</h3>
            <ul class="guide-list">
              <li><strong>Copy a link</strong> — tap the copy icon next to any item with a link.</li>
              <li><strong>Open an item</strong> is read-only — no editing actions appear.</li>
              <li><strong>Switch theme</strong> from Settings → Profile.</li>
              <li><strong>Sign out</strong> from the sidebar; you'll be asked to confirm.</li>
            </ul>
          </div>
        </div>`;
    } else {
      // OWNER user guide
      c.innerHTML = `
        <div style="max-width:640px;">
          <h2 class="page-h2">User guide</h2>
          <p class="page-lead">Infos manages multiple businesses you run, each with their own credentials and items.</p>
          <div class="guide-section">
            <h3 class="guide-h3">Getting started</h3>
            <ul class="guide-list">
              <li><strong>Create a business</strong> from the Businesses tab — give it a name, email, password, and brand color.</li>
              <li><strong>Add items</strong> in Notices / System / Games / ID & Pass using the "New" button at the top of each tab.</li>
              <li><strong>Assign items</strong> to one business, several businesses, or all of them.</li>
              <li><strong>Tag items</strong> within a single business for fine-grained filtering.</li>
            </ul>
          </div>
          <div class="guide-section">
            <h3 class="guide-h3">Sharing view-only access</h3>
            <ul class="guide-list">
              <li>Give a business's email + password to a teammate. They can sign in and view only that business's items.</li>
              <li>Control which tabs they can see in the business detail page → "Allowed tabs for this business".</li>
              <li>They cannot see items from other businesses, or anything left unassigned.</li>
            </ul>
          </div>
          <div class="guide-section">
            <h3 class="guide-h3">Productivity</h3>
            <ul class="guide-list">
              <li><strong>⌘K</strong> — command palette. Type <code>tag:name</code> or <code>biz:name</code> to scope.</li>
              <li><strong>?</strong> — show all keyboard shortcuts.</li>
              <li><strong>Drag tabs</strong> in the sidebar to reorder.</li>
              <li><strong>Bulk select</strong> — checkbox icon in the header for multi-edit.</li>
            </ul>
          </div>
          <div class="guide-section">
            <h3 class="guide-h3">Backup</h3>
            <ul class="guide-list">
              <li><strong>Export / import</strong> all data from Settings → Backup, or a single business from its detail page.</li>
              <li>Data is stored locally in IndexedDB. Optional E2E encryption protects business passwords.</li>
            </ul>
          </div>
        </div>`;
    }
  }
  function renderAbout(c) {
    c.innerHTML = viewOnlyBanner() + `<div style="max-width:480px;">
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:18px;">
        <svg viewBox="0 0 512 512" width="56" height="56" style="border-radius:14px;"><rect x="0" y="0" width="512" height="512" rx="128" fill="var(--accent-solid)"/><rect x="234" y="148" width="44" height="44" rx="11" fill="#FFFFFF"/><rect x="206" y="220" width="100" height="20" rx="10" fill="#FFFFFF" opacity="0.55"/><rect x="206" y="268" width="100" height="96" rx="18" fill="#FFFFFF"/><rect x="234" y="296" width="44" height="12" rx="6" fill="var(--accent-solid)"/><rect x="234" y="324" width="44" height="12" rx="6" fill="var(--accent-solid)"/></svg>
        <div>
          <div style="font-size:20px;font-weight:700;color:var(--text-primary);">Infos</div>
          <div style="font-size:13px;color:var(--text-secondary);">A Progressive Web App</div>
          <div style="font-size:12px;color:var(--text-tertiary);margin-top:3px;">Version ${esc(APP_VERSION)}</div>
        </div>
      </div>
      <p style="font-size:14px;color:var(--text-secondary);line-height:1.7;">Manage multiple businesses, their notices, credentials, and accounts. Business logins can view their business and add balance entries. Cloud sync across your devices, secured with per-account data isolation.</p>
      <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border);font-size:12px;color:var(--text-tertiary);">Infos v${esc(APP_VERSION)}</div>
    </div>`;
  }
  function renderPrivacy(c) {
    const bizCtx = state.bizContext ? bizById(state.bizContext) : null;
    if (bizCtx) {
      c.innerHTML = viewOnlyBanner() + `<div style="max-width:600px;">
        <h2 class="page-h2">Privacy notice for <strong>${esc(bizCtx.name)}</strong></h2>
        <p class="page-lead">What you see when signed in as a business user.</p>
        <div class="guide-section">
          <h3 class="guide-h3">What's visible to you</h3>
          <p class="guide-p">Only items the owner has explicitly assigned to "${esc(bizCtx.name)}". Items left unassigned, or assigned to other businesses, are completely hidden.</p>
        </div>
        <div class="guide-section">
          <h3 class="guide-h3">What's read-only</h3>
          <p class="guide-p">Everything. You cannot add, edit, or delete items. You cannot see the owner's data, other businesses, settings, or backup tools.</p>
        </div>
        <div class="guide-section">
          <h3 class="guide-h3">Sign-in security</h3>
          <p class="guide-p">If the owner has enabled encryption, your business password is stored as ciphertext on the owner's device. The owner must unlock with their master password before you can sign in.</p>
        </div>
        <div class="guide-section">
          <h3 class="guide-h3">Storage</h3>
          <p class="guide-p">When the owner uses a cloud account, data is stored securely on the backend (Supabase) and synced across devices. Without cloud sign-in, data stays on the device.</p>
        </div>
      </div>`;
    } else {
      c.innerHTML = `<div style="max-width:600px;">
        <h2 class="page-h2">Privacy policy</h2>
        <p class="page-lead">How Infos handles your data.</p>
        <div class="guide-section">
          <h3 class="guide-h3">Storage &amp; sync</h3>
          <p class="guide-p">When you sign in with a cloud account, your data — businesses, items, balances, tags, preferences, attachments — is stored on our backend (Supabase) so it syncs across your devices. If you use the app without a cloud account, data is kept locally on your device.</p>
        </div>
        <div class="guide-section">
          <h3 class="guide-h3">Authentication</h3>
          <p class="guide-p">Sign-in is handled by Supabase Auth. Your password is securely hashed by the provider and is never stored in plain text on the server. Sessions use short-lived tokens that refresh automatically.</p>
        </div>
        <div class="guide-section">
          <h3 class="guide-h3">Data isolation</h3>
          <p class="guide-p">Database row-level security restricts access so each account can only read and write its own data. One account cannot access another's.</p>
        </div>
        <div class="guide-section">
          <h3 class="guide-h3">Business sign-in</h3>
          <p class="guide-p">When someone signs in with a business's credentials they get read-only access to <strong>only</strong> items assigned to that business. They cannot see other businesses, unassigned items, or any settings.</p>
        </div>
        <div class="guide-section">
          <h3 class="guide-h3">What we don't do</h3>
          <p class="guide-p">We don't sell your data or use it for advertising.</p>
        </div>
        <div class="guide-section">
          <h3 class="guide-h3">Your rights</h3>
          <p class="guide-p">Export your data any time, or permanently delete your account and its backend data from Settings.</p>
        </div>
      </div>`;
    }
  }
  // Profile content (identity + name/security/danger for owner). Reused inside
  // the Settings → Profile tab. Returns HTML; handlers wired by wireProfileSection.
  function profileBodyHTML() {
    if (!state.user) return '';
    const bizCtx = state.bizContext ? bizById(state.bizContext) : null;
    const shared = isSharedLogin();
    // The signed-in business name for a shared login (its single business).
    const sharedBiz = shared ? (state.businesses && state.businesses[0]) : null;
    const displayName = bizCtx ? bizCtx.name
                      : shared ? (sharedBiz && sharedBiz.name ? sharedBiz.name : 'Business')
                      : state.user.name;
    const displayEmail = state.user.email;
    const showOwnerAccount = !bizCtx && !shared;
    return `
      <div class="profile-head">
        ${bizCtx ? bizAvatarHTML(bizCtx, 64) : sharedBiz ? bizAvatarHTML(sharedBiz, 64) : `<div class="profile-avatar">${displayName.charAt(0).toUpperCase()}</div>`}
        <div style="flex:1;min-width:0;">
          <div class="profile-name">${esc(displayName)}</div>
          <div class="profile-email">${esc(displayEmail)}</div>
        </div>
      </div>
      ${shared ? `
        <div class="profile-card">
          <div class="profile-card-head"><div class="section-label">${esc(sharedBiz && sharedBiz.name ? sharedBiz.name : displayName)}</div></div>
          <div style="font-size:13px;color:var(--text-secondary);line-height:1.55;">
            You're signed in to this business. You can view everything assigned to it, live, and add entries on entry tabs like Balance. The business owner manages the login and account.
          </div>
        </div>
      ` : ''}
      ${showOwnerAccount ? `
        <div class="profile-card">
          <div class="profile-card-head"><div class="section-label">Your name</div></div>
          <div class="field">
            <label for="pp-name">Full name</label>
            <input id="pp-name" type="text" value="${esc(state.user.name)}" autocomplete="name"/>
          </div>
          <div class="profile-card-foot">
            <button class="btn-primary btn-sm" id="pp-name-save">Save name</button>
          </div>
        </div>
        <div class="profile-card">
          <div class="profile-card-head"><div class="section-label">Security</div></div>
          <button class="profile-action-row" id="pp-change-email-btn">
            <i class="ti ti-mail" style="font-size:18px;color:var(--text-secondary);"></i>
            <div style="flex:1;text-align:left;">
              <div style="font-size:13.5px;font-weight:600;color:var(--text-primary);">Change email</div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:1px;">${esc(state.user.email)}</div>
            </div>
            <i class="ti ti-chevron-right" style="font-size:16px;color:var(--text-tertiary);"></i>
          </button>
          <button class="profile-action-row" id="pp-change-pw-btn">
            <i class="ti ti-key" style="font-size:18px;color:var(--text-secondary);"></i>
            <div style="flex:1;text-align:left;">
              <div style="font-size:13.5px;font-weight:600;color:var(--text-primary);">Change password</div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:1px;">Update the password for your account</div>
            </div>
            <i class="ti ti-chevron-right" style="font-size:16px;color:var(--text-tertiary);"></i>
          </button>
        </div>
        <div class="profile-card" style="border-color:var(--danger-bg);">
          <div class="profile-card-head"><div class="section-label" style="color:var(--danger-fg);">Danger zone</div></div>
          <div style="font-size:13px;color:var(--text-secondary);margin-bottom:10px;">Permanently delete your account and all data on this device. Your businesses, items, and settings will be gone. This cannot be undone.</div>
          <button class="btn-danger btn-block" id="pp-delete-account"><i class="ti ti-trash" style="font-size:14px;vertical-align:-2px;"></i> Delete my account</button>
        </div>
      ` : ''}
      <button class="btn-outline btn-block btn-signout" id="profile-signout"><i class="ti ti-logout" style="font-size:15px;vertical-align:-3px;"></i> Sign out</button>
    `;
  }

  function renderProfile(c) {
    if (!state.user) return;
    c.innerHTML = profileBodyHTML();
    wireProfileSection(c);
  }

  // Wire all profile handlers (name save, change email/password, delete account, signout).
  function wireProfileSection(c) {
    const bizCtx = state.bizContext ? bizById(state.bizContext) : null;
    const signout = c.querySelector('#profile-signout');
    if (signout) signout.onclick = () => doLogout();
    if (bizCtx || isSharedLogin()) return;
    const nameSave = c.querySelector('#pp-name-save');
    if (nameSave) nameSave.onclick = () => {
      const newName = c.querySelector('#pp-name').value.trim();
      if (!newName) { toast('Name cannot be empty'); return; }
      const acc = (state.accounts || []).find(a => a.email === state.user.email);
      if (acc) acc.name = newName;
      state.user.name = newName;
      const am = $('#avatar-mini'); if (am) am.textContent = newName.charAt(0).toUpperCase();
      persistAll();
      toast('Name updated');
      rerenderCurrentTab();
    };
    const cpBtn = c.querySelector('#pp-change-pw-btn');
    if (cpBtn) cpBtn.onclick = () => setActive('change-password', 'right');
    const ceBtn = c.querySelector('#pp-change-email-btn');
    if (ceBtn) ceBtn.onclick = () => openChangeEmailModal();
    const delBtn = c.querySelector('#pp-delete-account');
    if (delBtn) delBtn.onclick = () => openDeleteAccountFlow();
  }

  // Change email — verify password, ensure new email is unique, migrate account + recent signins.
  function openChangeEmailModal() {
    const oldEmail = state.user.email;
    openModal(`
      <div class="modal-head"><h3>Change email</h3><button id="m-close" class="btn-icon"><i class="ti ti-x"></i></button></div>
      <div class="modal-body">
        <div class="field" style="margin-bottom:10px;"><label>Current email</label><div class="info-pill" style="font-size:13px;">${esc(oldEmail)}</div></div>
        <div class="field" style="margin-bottom:10px;"><label>New email</label><input id="ce-new" type="email" placeholder="you@example.com" autocomplete="email" inputmode="email"/></div>
        <div class="field" style="margin-bottom:10px;"><label>Confirm password</label><div class="input-wrap"><input id="ce-pw" type="password" autocomplete="current-password"/><button type="button" class="input-icon-btn" data-pw-eye="ce-pw" aria-label="Show password"><i class="ti ti-eye"></i></button></div></div>
        <div id="ce-error" class="error-msg" hidden></div>
      </div>
      <div class="modal-foot"><button class="btn-outline" id="m-cancel">Cancel</button><button class="btn-primary" id="ce-save">Update email</button></div>
    `);
    $('#m-close').onclick = closeModal;
    $('#m-cancel').onclick = closeModal;
    const showErr = (m) => { const e = $('#ce-error'); e.textContent = m; e.hidden = false; };
    $('#ce-save').onclick = () => {
      const newEmail = ($('#ce-new').value || '').trim().toLowerCase();
      const pw = $('#ce-pw').value || '';
      const acc = (state.accounts || []).find(a => a.email === oldEmail);
      if (!newEmail.includes('@')) return showErr('Enter a valid email');
      if (newEmail === oldEmail) return showErr('That is already your email');
      if (!acc || acc.password !== pw) return showErr('Password is incorrect');
      if ((state.accounts || []).some(a => a.email === newEmail)) return showErr('An account with that email already exists');
      if ((state.businesses || []).some(b => b.email.toLowerCase() === newEmail)) return showErr('That email is used by a business');
      acc.email = newEmail;
      state.user.email = newEmail;
      (state.recentSignins || []).forEach(r => { if (r.email === oldEmail) r.email = newEmail; });
      persistAll();
      closeModal();
      toast('Email updated');
      rerenderCurrentTab();
    };
  }

  // Delete account — type your email to confirm, then a final confirmation.
  function openDeleteAccountFlow() {
    const myEmail = state.user.email;
    const cloud = !!(window.InfosSupabase && window.InfosSupabase.configured());
    confirmAction({
      title: 'Delete your account?',
      message: cloud
        ? `This permanently removes your account and all your data from this device and the cloud. There is no undo and no backup unless you exported one. To confirm, type your account email below.`
        : `This permanently removes your account, your businesses, and all items stored on this device. There is no undo and no backup unless you exported one. To confirm, type your account email below.`,
      confirmLabel: 'Continue',
      danger: true,
      typeToConfirm: myEmail,
      typeToConfirmLabel: `Type your account email (${myEmail}) to confirm`,
      onConfirm: () => {
        // Second confirmation — a deliberate "are you absolutely sure" gate.
        confirmAction({
          title: 'Are you absolutely sure?',
          message: `This is your last chance to cancel. Deleting removes everything permanently${cloud ? ', including your cloud data' : ''}. This cannot be undone.`,
          confirmLabel: 'Delete forever',
          danger: true,
          onConfirm: async () => {
            // Show an instant "processing" screen the moment delete is confirmed,
            // so there's immediate feedback even on a slow connection while the
            // server call runs.
            showFullScreenMessage({
              icon: 'ti-trash',
              title: 'Deleting your account…',
              message: 'Please wait while we permanently remove your account and data. This only takes a moment.',
              spinner: true
            });
            if (cloud) {
              // Full account deletion: removes the auth user + data via the
              // server function. If it fails, we STOP and show the real error
              // rather than silently leaving the auth user in place.
              try {
                if (!(window.InfosSupabase.Auth && window.InfosSupabase.Auth.deleteAccount)) {
                  throw new Error('Delete endpoint unavailable (deploy api/delete-account.js).');
                }
                await window.InfosSupabase.Auth.deleteAccount();
              } catch (e) {
                const fsm = document.getElementById('fullscreen-message'); if (fsm) fsm.remove();
                const msg = (e && e.message) || 'Unknown error';
                confirmAction({
                  title: 'Account not deleted',
                  message: `Your account could NOT be removed from the server, so nothing was deleted. Error: ${msg}\n\nThis usually means the SUPABASE_SERVICE_ROLE_KEY env var is missing on the server, or the delete function isn't deployed. Fix that and try again.`,
                  confirmLabel: 'OK',
                  onConfirm: () => {}
                });
                return; // do NOT wipe local — account still exists on the server
              }
              try { await window.InfosSupabase.Auth.signOut(); } catch {}
              try { if (window.Sync) window.Sync.disable(); } catch {}
            }
            // Account is gone from the server (or this is a local-only account).
            // Clear in-memory session so nothing re-persists a logged-in state.
            state.user = null;
            state.bizContext = null;
            state.syncAdapter = null;
            if (cloud) {
              state.accounts = [];
              state.recentSignins = [];
            } else {
              state.accounts = (state.accounts || []).filter(a => a.email !== myEmail);
              state.recentSignins = (state.recentSignins || []).filter(e => e.email !== myEmail);
            }
            // Properly wipe persisted storage (IndexedDB + localStorage fallbacks).
            try { if (window.Storage && window.Storage.clear) await window.Storage.clear(); } catch {}
            try { localStorage.removeItem('infos-state-v2'); } catch {}
            try { localStorage.removeItem('infos-state-v3-fallback'); } catch {}
            try { localStorage.removeItem(STORAGE_KEY); } catch {}
            try { localStorage.removeItem('infos-device-fp'); } catch {}
            // Show a graceful farewell screen, then reload to the sign-in screen.
            showFullScreenMessage({
              icon: 'ti-heart-handshake',
              title: 'Your account is being deleted',
              message: 'Thank you for being with us. We hope to see you again sometime. You can create a new account anytime.',
              spinner: true
            });
            if (cloud || (state.accounts || []).length === 0) {
              setTimeout(() => { location.reload(); }, 4000);
              return;
            }
            persistAll();
            setTimeout(() => { logout(); }, 4000);
          }
        });
      }
    });
  }

  // ---------- Change password (dedicated page) ----------
  function renderChangePassword(c) {
    if (!state.user || state.bizContext) {
      c.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="ti ti-key"></i></div><div class="empty-state-title">Not available</div></div>';
      return;
    }
    c.innerHTML = `
      <div class="profile-card" style="max-width:480px;margin:0 auto;">
        <div class="profile-card-head">
          <div class="section-label">Change password</div>
        </div>
        <div class="settings-hint" style="margin-bottom:16px;">Update the password for <strong>${esc(state.user.email)}</strong>. You will stay signed in.</div>
        <div class="field"${(window.InfosSupabase && window.InfosSupabase.configured()) ? ' hidden' : ''}>
          <label for="cp-old">Current password</label>
          <div class="input-wrap">
            <input id="cp-old" type="password" autocomplete="current-password"/>
            <button class="input-icon-btn" data-pw-eye="cp-old" type="button" aria-label="Show password"><i class="ti ti-eye"></i></button>
          </div>
        </div>
        <div class="field">
          <label for="cp-new">New password</label>
          <div class="input-wrap">
            <input id="cp-new" type="password" autocomplete="new-password"/>
            <button class="input-icon-btn" data-pw-eye="cp-new" type="button" aria-label="Show password"><i class="ti ti-eye"></i></button>
          </div>
          <div class="pw-bar" style="margin-top:6px;"><div id="cp-strength"></div></div>
        </div>
        <div class="field">
          <label for="cp-confirm">Confirm new password</label>
          <div class="input-wrap">
            <input id="cp-confirm" type="password" autocomplete="new-password"/>
            <button class="input-icon-btn" data-pw-eye="cp-confirm" type="button" aria-label="Show password"><i class="ti ti-eye"></i></button>
          </div>
        </div>
        <div id="cp-error" class="error-msg" hidden></div>
        <div class="profile-card-foot" style="margin-top:14px;">
          <button class="btn-link-sm" id="cp-forgot" type="button">Forgot current password?</button>
          <button class="btn-primary btn-sm" id="cp-save">Update password</button>
        </div>
      </div>
    `;
    // cp-old / cp-new / cp-confirm visibility use the global [data-pw-eye] handler.
    $('#cp-new').oninput = () => {
      const v = $('#cp-new').value;
      let s = 0; if (v.length >= 8) s++; if (/[A-Z]/.test(v)) s++; if (/[0-9]/.test(v)) s++; if (/[^a-zA-Z0-9]/.test(v)) s++;
      const pct = [0,25,50,75,100][s], color = ['#888780','#E24B4A','#EF9F27','#97C459','#1D9E75'][s];
      $('#cp-strength').style.width = pct + '%'; $('#cp-strength').style.background = color;
    };
    $('#cp-forgot').onclick = () => {
      const cloud = !!(window.InfosSupabase && window.InfosSupabase.configured());
      if (cloud && state.user && state.user.email) {
        // Send a reset email to the signed-in user WITHOUT signing them out.
        confirmAction({
          title: 'Email a reset link?',
          message: `We'll email a password-reset link to ${state.user.email}. You'll stay signed in here — just open the link when you want to set a new password.`,
          confirmLabel: 'Send link',
          onConfirm: async () => {
            try { await window.InfosSupabase.Auth.resetPassword(state.user.email); toast('Reset link sent — check your email'); }
            catch (e) { toast('Could not send reset link'); }
          }
        });
        return;
      }
      // Local mode: keep the old reset flow.
      confirmAction({
        title: 'Use forgot-password flow?',
        message: "You'll be signed out and taken to the reset flow on the sign-in screen.",
        confirmLabel: 'Continue',
        danger: false,
        onConfirm: () => { logout(); setTimeout(() => $('#forgot-link').click(), 200); }
      });
    };
    $('#cp-save').onclick = async () => {
      const oldPw = $('#cp-old').value, newPw = $('#cp-new').value, confirmPw = $('#cp-confirm').value;
      const err = $('#cp-error'); const fail = m => { err.textContent = m; err.hidden = false; };
      err.hidden = true;
      if (newPw.length < 6) return fail('New password must be at least 6 characters');
      if (newPw !== confirmPw) return fail('Passwords do not match');
      const cloud = !!(window.InfosSupabase && window.InfosSupabase.configured());
      if (cloud) {
        // Cloud account: update the password in Supabase (stays signed in).
        const saveBtn = $('#cp-save'); const orig = saveBtn.textContent;
        saveBtn.textContent = 'Updating…'; saveBtn.disabled = true;
        try {
          await window.InfosSupabase.Auth.updatePassword(newPw);
          // keep the local mirror in sync if present
          const acc = (state.accounts || []).find(a => a.email === state.user.email);
          if (acc) acc.password = newPw;
          if (state.user) state.user.password = newPw;
          persistAll();
          saveBtn.textContent = orig; saveBtn.disabled = false;
          toast('Password updated');
          settingsActiveTab = 'appearance';
          setActive('settings', 'right');
        } catch (e) {
          saveBtn.textContent = orig; saveBtn.disabled = false;
          fail((e && e.message) || 'Could not update password. Try signing out and using "Forgot password".');
        }
        return;
      }
      // Local mode (no backend): verify against locally stored password.
      const acc = (state.accounts || []).find(a => a.email === state.user.email);
      const currentPw = acc?.password || state.user.password;
      if (currentPw && oldPw !== currentPw) return fail('Current password is incorrect');
      if (acc) acc.password = newPw;
      state.user.password = newPw;
      persistAll();
      toast('Password updated');
      // Return to Settings → Profile (where account settings now live)
      settingsActiveTab = 'appearance';
      setActive('settings', 'fade');
    };
  }

  // ---------- Settings (4 tabs: Appearance, Management, Backup, About) ----------
  let settingsActiveTab = 'appearance';

  function renderSettings(c) {
    const bizCtx = state.bizContext ? bizById(state.bizContext) : null;
    // A legacy view-only business session OR a shared business login gets the
    // restricted Settings (Appearance + About) — no owner-level Management/Backup
    // (encryption, export/import/clear) that would act on the shared data.
    const isViewer = isViewOnly() || isSharedLogin();
    // Business users get only Profile and About
    const tabs = isViewer
      ? [['appearance','Profile','user'], ['about','About','info-circle']]
      : [['appearance','Profile','user'], ['management','Management','tool'], ['backup','Backup','database'], ['about','About','info-circle']];
    if (!tabs.find(t => t[0] === settingsActiveTab)) settingsActiveTab = 'appearance';
    const html = `
      <div class="settings-tabs-nav">
        ${tabs.map(([k,n,ic]) => `<button class="settings-tab-btn ${settingsActiveTab===k?'active':''}" data-stab="${k}"><i class="ti ti-${ic}"></i><span>${esc(n)}</span></button>`).join('')}
      </div>
      <div class="settings-tab-body">
        ${renderSettingsBody(settingsActiveTab, bizCtx, isViewer)}
      </div>
      <div class="settings-version-footer" style="margin-top:22px;padding-top:14px;border-top:1px solid var(--border);text-align:center;font-size:12px;color:var(--text-tertiary);">Infos · Version ${esc(APP_VERSION)}</div>
    `;
    c.innerHTML = html;
    // Tab switcher
    c.querySelectorAll('[data-stab]').forEach(b => b.onclick = () => {
      settingsActiveTab = b.dataset.stab;
      state.history.pop(); setActive('settings','fade');
    });
    // Wire body handlers per tab
    if (settingsActiveTab === 'appearance') wireAppearance(c);
    if (settingsActiveTab === 'management' && !isViewer) wireManagement(c);
    if (settingsActiveTab === 'backup' && !isViewer) wireBackup(c);
    if (settingsActiveTab === 'about') wireAbout(c);
  }

  function renderSettingsBody(tab, bizCtx, isViewer) {
    if (tab === 'appearance') return `
      ${profileBodyHTML()}
      <div class="settings-divider"></div>
      <div class="settings-group-title">Appearance</div>
      <div class="settings-section">
        <div class="section-label" style="margin-bottom:10px;">Theme</div>
        <div class="theme-pills">
          <button class="theme-pill" data-theme="auto"><i class="ti ti-device-laptop"></i>Auto</button>
          <button class="theme-pill" data-theme="light"><i class="ti ti-sun"></i>Light</button>
          <button class="theme-pill" data-theme="dark"><i class="ti ti-moon"></i>Dark</button>
        </div>
        <div class="settings-hint">Auto follows your system preference.</div>
      </div>
      <div class="settings-section">
        <div class="section-label" style="margin-bottom:10px;">Accent color</div>
        <div class="accent-row">${[['blue','#378ADD'],['teal','#1D9E75'],['emerald','#0E7C5A'],['purple','#7F77DD'],['indigo','#4F46B5'],['navy','#2A4A7F'],['coral','#D85A30'],['darkred','#B23A2E'],['maroon','#7E3045'],['amber','#BA7517'],['pink','#D4537E'],['slate','#4A5568']].map(([n,col]) => `<div class="accent-swatch" data-accent="${n}" style="background:${col};" title="${n}"></div>`).join('')}</div>
        <div class="settings-hint">When a business is filtered, the app tints to its brand color automatically.</div>
      </div>
      <div class="settings-section">
        <div class="section-label" style="margin-bottom:10px;">Notifications</div>
        <div class="settings-hint" style="margin-bottom:10px;">Browser permission to show reminders.</div>
        <button class="btn-outline btn-sm" id="enable-push"><i class="ti ti-bell" style="font-size:13px;vertical-align:-2px;"></i> ${('Notification' in window && Notification.permission === 'granted') ? 'Enabled' : 'Enable notifications'}</button>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;">
          <div>
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);">Sound effects</div>
            <div class="settings-hint" style="margin:2px 0 0;">Chimes for new entries, balance entries, reminders, and incoming syncs.</div>
          </div>
          <button id="toggle-sound" role="switch" aria-checked="${state.soundEnabled !== false}" style="flex:none;width:44px;height:26px;border-radius:999px;border:none;cursor:pointer;position:relative;transition:background .15s;background:${state.soundEnabled !== false ? 'var(--accent-solid, #378ADD)' : '#c4c8cc'};">
            <span style="position:absolute;top:3px;left:${state.soundEnabled !== false ? '21px' : '3px'};width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 2px rgba(0,0,0,.3);"></span>
          </button>
        </div>
      </div>
    `;
    if (tab === 'management' && !isViewer) {
      const currentBiz = bizCtx || (state.activeBizId !== 'all' && state.activeBizId !== 'none' ? bizById(state.activeBizId) : null);
      return `
        <div class="settings-section">
          <div class="settings-section-head">
            <div>
              <div class="section-label">Manage tabs</div>
              <div class="settings-hint">Reorder, rename, and remove tabs — all here. ${currentBiz ? `Renames apply to ${esc(currentBiz.name)}.` : 'Renames apply globally unless a business overrides them.'}</div>
            </div>
            <button class="btn-primary btn-sm" id="add-tab"><i class="ti ti-plus" style="font-size:13px;vertical-align:-2px;"></i> New tab</button>
          </div>
          <div class="biz-tab-manager" id="user-tab-manager">
            ${(() => {
              const allOrder = [];
              [...state.tabOrder].forEach(k => { const def = getTabDef(k); if (def && !def.hidden && k !== 'trash') allOrder.push(k); });
              state.customTabs.forEach(t => { if (!allOrder.includes(t.id)) allOrder.push(t.id); });
              const hidden = (state.hiddenTabs || []);
              return allOrder.map((k, i) => {
                const def = getTabDef(k); if (!def) return '';
                const disp = tabDisp(k);
                const isCustom = state.customTabs.some(t => t.id === k);
                const isFirst = i === 0, isLast = i === allOrder.length - 1;
                const over = currentBiz ? !!(currentBiz.tabRenames && currentBiz.tabRenames[k]) : !!state.globalRenames[k];
                const isHidden = hidden.includes(k);
                // businesses can never be deleted/hidden; everything else can.
                const canDelete = k !== 'businesses';
                return `<div class="biz-tab-row ${isHidden ? 'tab-row-hidden' : ''}">
                  <div class="biz-tab-info">
                    <i class="ti ti-${disp.icon}" style="font-size:16px;color:var(--text-secondary);flex-shrink:0;"></i>
                    <span class="biz-tab-name">${esc(disp.name)}${over ? ' <span class="rename-row-default" style="font-weight:400;">(renamed)</span>' : ''}${isHidden ? ' <span class="rename-row-default" style="font-weight:400;">(hidden)</span>' : ''}</span>
                  </div>
                  ${isHidden
                    ? `<button class="btn-icon biz-tab-arrow" data-restore-tab="${k}" aria-label="Restore tab" title="Restore"><i class="ti ti-arrow-back-up"></i></button>
                       ${isCustom ? `<button class="btn-icon biz-tab-arrow btn-icon-danger" data-delete-tab="${k}" aria-label="Delete tab permanently" title="Delete permanently"><i class="ti ti-trash"></i></button>` : ''}`
                    : `<button class="btn-icon biz-tab-arrow" data-rename="${k}" data-scope="${currentBiz ? 'biz' : 'global'}" aria-label="Rename tab" title="Rename"><i class="ti ti-pencil"></i></button>
                       <button class="btn-icon biz-tab-arrow" data-reorder-up="${k}" ${isFirst ? 'disabled' : ''} aria-label="Move up"><i class="ti ti-chevron-up"></i></button>
                       <button class="btn-icon biz-tab-arrow" data-reorder-down="${k}" ${isLast ? 'disabled' : ''} aria-label="Move down"><i class="ti ti-chevron-down"></i></button>
                       ${isCustom ? `<button class="btn-icon biz-tab-arrow" data-edit-tab="${k}" aria-label="Edit custom tab" title="Edit tab"><i class="ti ti-edit"></i></button>` : ''}
                       ${canDelete ? `<button class="btn-icon biz-tab-arrow btn-icon-danger" data-${isCustom ? 'delete' : 'hide'}-tab="${k}" aria-label="${isCustom ? 'Delete tab' : 'Remove tab'}" title="${isCustom ? 'Delete tab' : 'Remove tab'}"><i class="ti ti-trash"></i></button>` : '<span class="biz-tab-arrow" style="visibility:hidden;width:30px;"></span>'}`}
                </div>`;
              }).join('');
            })()}
          </div>
          ${state.customTabs.length === 0 ? '<div class="settings-hint" style="margin-top:8px;">Tip: use “New tab” to add your own tabs (they get rename, reorder, and delete here too).</div>' : ''}
        </div>
      `;
    }
    if (tab === 'backup' && !isViewer) {
      return `
        <div class="settings-section">
          <div class="section-label" style="margin-bottom:8px;">Export / Import all data</div>
          <div class="settings-hint" style="margin-bottom:12px;">All businesses, items, tags, and settings in one JSON file. Owner-level.</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            <button class="btn-outline btn-sm" id="export-all"><i class="ti ti-download" style="font-size:13px;vertical-align:-2px;"></i> Export everything</button>
            <button class="btn-outline btn-sm" id="import-btn"><i class="ti ti-upload" style="font-size:13px;vertical-align:-2px;"></i> Import</button>
            <input type="file" id="import-input" accept=".json,application/json" style="display:none;"/>
          </div>
          <div class="settings-hint" style="margin-top:10px;">For single-business export, open that business and use its Data section.</div>
        </div>
        <div class="settings-section">
          <div class="section-label" style="margin-bottom:8px;">Backend sync</div>
          <div class="settings-hint" style="margin-bottom:12px;">Optional. Adapters in SYNC.md.</div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
            <select id="sync-adapter" style="padding:9px 12px;border-radius:var(--radius-md);border:1px solid var(--border-soft);background:var(--surface-elevated);color:var(--text-primary);font-family:inherit;font-size:13px;">
              <option value="">Disabled</option>
              <option value="loopback" ${state.syncAdapter === 'loopback' ? 'selected' : ''}>Local loopback (demo)</option>
            </select>
            <button class="btn-outline btn-sm" id="sync-now" ${!state.syncAdapter ? 'disabled' : ''}><i class="ti ti-refresh" style="font-size:13px;vertical-align:-2px;"></i> Sync now</button>
          </div>
        </div>
        <div class="settings-section">
          <div class="section-label" style="margin-bottom:8px;">Storage</div>
          <div class="info-pill" style="font-size:12px;">
            <div style="margin-bottom:4px;"><strong style="color:var(--text-primary);">Driver:</strong> ${window.Storage ? window.Storage.stats().driver : 'localStorage'}</div>
            <div><strong style="color:var(--text-primary);">Size:</strong> ${window.Storage ? (window.Storage.stats().sizeApprox / 1024).toFixed(1) + ' KB' : 'unknown'}</div>
          </div>
        </div>
        <div class="settings-section">
          <div class="section-label" style="margin-bottom:8px;">Danger zone</div>
          <button class="btn-danger" id="clear-data" style="font-size:12px;"><i class="ti ti-trash" style="font-size:13px;vertical-align:-2px;"></i> Clear all data</button>
          <div class="settings-hint" style="margin-top:8px;">Removes all businesses, items, tags, and preferences. Signs you out.</div>
        </div>
      `;
    }
    if (tab === 'about') {
      const bizCtxLocal = bizCtx;
      const guideHTML = bizCtxLocal
        ? `<div class="guide-section">
            <h3 class="guide-h3">User guide for <strong>${esc(bizCtxLocal.name)}</strong></h3>
            <p class="guide-p">You're signed in with view-only access to "${esc(bizCtxLocal.name)}".</p>
            <ul class="guide-list">
              <li>You see only items the owner has assigned to ${esc(bizCtxLocal.name)}.</li>
              <li>Tap the copy icon next to any item with a link to copy it.</li>
              <li>You cannot create, edit, or delete items.</li>
              <li>Switch theme from the Appearance tab above.</li>
              <li>Sign out from Settings → Profile, or the sidebar.</li>
            </ul>
          </div>
          <div class="guide-section">
            <h3 class="guide-h3">Privacy</h3>
            <p class="guide-p">Only items the owner has explicitly assigned to "${esc(bizCtxLocal.name)}" are visible. Items left unassigned, or assigned to other businesses, are completely hidden.</p>
            <p class="guide-p">If the owner has enabled encryption, your business password is stored as ciphertext on the owner's device.</p>
          </div>`
        : `<div class="guide-section">
            <h3 class="guide-h3">User guide</h3>
            <ul class="guide-list">
              <li><strong>Create a business</strong> from the Businesses tab.</li>
              <li><strong>Add items</strong> with the "New" button at the top of each list tab.</li>
              <li><strong>Assign items</strong> to one business, several, or all using "Assign to all".</li>
              <li><strong>Tag items</strong> (single-business only) for fine-grained filtering.</li>
              <li><strong>Share view-only</strong>: give a business's email + password to a teammate.</li>
              <li><strong>Allowed tabs</strong>: control per-business which tabs they see.</li>
              <li><strong>⌘K</strong> opens the command palette. <strong>?</strong> shows keyboard shortcuts.</li>
            </ul>
          </div>
          <div class="guide-section">
            <h3 class="guide-h3">Privacy policy</h3>
            <p class="guide-p"><strong>Cloud sync.</strong> With a cloud account, your data is stored securely on the backend (Supabase) and synced across your devices. Used without sign-in, data stays on your device.</p>
            <p class="guide-p"><strong>Authentication.</strong> Handled by Supabase Auth — passwords are securely hashed, never stored in plain text on the server.</p>
            <p class="guide-p"><strong>Data isolation.</strong> Row-level security ensures each account can only access its own data.</p>
            <p class="guide-p"><strong>Business sign-in.</strong> A business user sees only items explicitly assigned to them — nothing else.</p>
            <p class="guide-p"><strong>Your rights.</strong> Export your data, or permanently delete your account and its backend data, from Settings.</p>
          </div>`;
      return `
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px;">
          <svg viewBox="0 0 512 512" width="56" height="56" style="border-radius:14px;"><rect x="0" y="0" width="512" height="512" rx="128" fill="var(--accent-solid)"/><rect x="234" y="148" width="44" height="44" rx="11" fill="#FFFFFF"/><rect x="206" y="220" width="100" height="20" rx="10" fill="#FFFFFF" opacity="0.55"/><rect x="206" y="268" width="100" height="96" rx="18" fill="#FFFFFF"/><rect x="234" y="296" width="44" height="12" rx="6" fill="var(--accent-solid)"/><rect x="234" y="324" width="44" height="12" rx="6" fill="var(--accent-solid)"/></svg>
          <div><div style="font-size:20px;font-weight:700;color:var(--text-primary);">Infos</div><div style="font-size:13px;color:var(--text-secondary);">A Progressive Web App for managing businesses</div></div>
        </div>
        ${guideHTML}
      `;
    }
    return '';
  }

  function wireAppearance(c) {
    // The Profile section now lives at the top of this tab — wire its handlers.
    wireProfileSection(c);
    const tp = c.querySelectorAll('.theme-pill');
    const updT = () => tp.forEach(p => p.classList.toggle('selected', p.dataset.theme === app.dataset.theme));
    updT();
    tp.forEach(p => p.onclick = () => { app.dataset.theme = p.dataset.theme; updT(); applyPerBizTheme(); persistAll(); updateActiveBizDisplay(); });
    const sw = c.querySelectorAll('.accent-swatch');
    const updS = () => sw.forEach(s => s.classList.toggle('selected', s.dataset.accent === app.dataset.accent && !state.customAccent));
    updS();
    sw.forEach(s => s.onclick = () => {
      state.customAccent = null;
      clearCustomAccent();
      app.dataset.accent = s.dataset.accent;
      updS();
      persistAll();
    });
    const ep = $('#enable-push');
    if (ep) ep.onclick = requestPushPermission;
    const ts = $('#toggle-sound');
    if (ts) ts.onclick = () => {
      state.soundEnabled = (state.soundEnabled === false) ? true : false;
      persistAll();
      // Play a sample when turning on, so the user hears it works.
      if (state.soundEnabled) { try { playSelfEntrySound(); } catch {} }
      rerenderCurrentTab();
    };
  }

  function wireManagement(c) {
    const at = $('#add-tab'); if (at) at.onclick = () => openTabModal();
    c.querySelectorAll('[data-edit-tab]').forEach(el => el.onclick = () => openTabModal(el.dataset.editTab));
    // Reorder arrows
    function applyReorder(allOrder) {
      state.tabOrder = allOrder.filter(k => TAB_DEFS[k] && !TAB_DEFS[k].hidden);
      const ctOrder = allOrder.filter(k => k.startsWith('ct'));
      state.customTabs.sort((a, b) => ctOrder.indexOf(a.id) - ctOrder.indexOf(b.id));
      persistAll();
      buildNav();
      state.history.pop(); setActive('settings','fade');
    }
    c.querySelectorAll('[data-reorder-up]').forEach(el => el.onclick = () => {
      const k = el.dataset.reorderUp;
      const allOrder = [...state.tabOrder, ...state.customTabs.map(t => t.id)];
      const idx = allOrder.indexOf(k);
      if (idx > 0) {
        [allOrder[idx-1], allOrder[idx]] = [allOrder[idx], allOrder[idx-1]];
        applyReorder(allOrder);
      }
    });
    c.querySelectorAll('[data-reorder-down]').forEach(el => el.onclick = () => {
      const k = el.dataset.reorderDown;
      const allOrder = [...state.tabOrder, ...state.customTabs.map(t => t.id)];
      const idx = allOrder.indexOf(k);
      if (idx < allOrder.length - 1 && idx >= 0) {
        [allOrder[idx+1], allOrder[idx]] = [allOrder[idx], allOrder[idx+1]];
        applyReorder(allOrder);
      }
    });
    const currentBiz = state.bizContext ? bizById(state.bizContext) : (state.activeBizId !== 'all' && state.activeBizId !== 'none' ? bizById(state.activeBizId) : null);
    c.querySelectorAll('[data-rename]').forEach(el => el.onclick = () => {
      if (el.dataset.scope === 'biz' && !currentBiz) { toast('Switch to a business first'); return; }
      openRenameModal(el.dataset.rename, el.dataset.scope);
    });
    // Delete a custom tab (and its items + per-biz settings) from the unified header
    c.querySelectorAll('[data-delete-tab]').forEach(el => el.onclick = () => {
      const id = el.dataset.deleteTab;
      const ct = state.customTabs.find(t => t.id === id);
      if (!ct) return;
      const count = (state.items[id] || []).filter(i => !i.deleted).length;
      confirmAction({
        title: `Delete "${ct.name}"?`,
        message: `This permanently deletes the "${ct.name}" tab${count ? ` and its ${count} item${count === 1 ? '' : 's'}` : ''}. This cannot be undone.`,
        confirmLabel: 'Delete tab',
        danger: true,
        onConfirm: () => {
          deleteCustomTab(id);
          if (state.hiddenTabs) state.hiddenTabs = state.hiddenTabs.filter(k => k !== id);
          state.history.pop(); setActive('settings', 'fade');
          toast('Tab deleted');
        }
      });
    });
    // Hide (remove) a built-in tab — non-destructive; can be restored.
    c.querySelectorAll('[data-hide-tab]').forEach(el => el.onclick = () => {
      const id = el.dataset.hideTab;
      const def = getTabDef(id); if (!def) return;
      const count = (state.items[id] || []).filter(i => !i.deleted).length;
      confirmAction({
        title: `Remove "${tabDisp(id).name}" tab?`,
        message: `This hides the "${tabDisp(id).name}" tab from your sidebar.${count ? ` Its ${count} item${count === 1 ? '' : 's'} are kept and reappear if you restore the tab.` : ''} You can restore it anytime from here.`,
        confirmLabel: 'Remove tab',
        danger: true,
        onConfirm: () => {
          if (!state.hiddenTabs) state.hiddenTabs = [];
          if (!state.hiddenTabs.includes(id)) state.hiddenTabs.push(id);
          if (state.currentTab === id) state.currentTab = 'notices';
          buildNav(); persistAll();
          state.history.pop(); setActive('settings', 'fade');
          toast('Tab removed');
        }
      });
    });
    // Restore a hidden built-in tab
    c.querySelectorAll('[data-restore-tab]').forEach(el => el.onclick = () => {
      const id = el.dataset.restoreTab;
      if (state.hiddenTabs) state.hiddenTabs = state.hiddenTabs.filter(k => k !== id);
      buildNav(); persistAll();
      state.history.pop(); setActive('settings', 'fade');
      toast('Tab restored');
    });
    const cE = $('#crypto-enable'); if (cE) cE.onclick = () => openCryptoSetupModal();
    const cU = $('#crypto-unlock'); if (cU) cU.onclick = () => openCryptoUnlockModal();
    const cL = $('#crypto-lock');
    if (cL) cL.onclick = () => {
      window.Crypto.lock(); toast('Locked');
      state.history.pop(); setActive('settings','fade');
    };
    const cD = $('#crypto-disable');
    if (cD) cD.onclick = () => {
      confirmAction({
        title: 'Disable encryption?',
        message: 'Business passwords will be decrypted and stored as plain text again. You must unlock first.',
        confirmLabel: 'Continue',
        danger: true,
        onConfirm: async () => {
          if (!window.Crypto.isUnlocked()) { toast('Unlock first'); return; }
          for (const b of state.businesses) {
            if (b.passwordEnc) {
              try { b.password = await window.Crypto.decrypt(b.passwordEnc); delete b.passwordEnc; } catch {}
            }
          }
          state.cryptoMeta = null; window.Crypto.lock(); persistAll();
          toast('Encryption disabled');
          state.history.pop(); setActive('settings','fade');
        }
      });
    };
  }

  function wireBackup(c) {
    const ea = $('#export-all'); if (ea) ea.onclick = exportAll;
    const ib = $('#import-btn'); if (ib) ib.onclick = () => $('#import-input').click();
    const ii = $('#import-input'); if (ii) ii.onchange = e => { if (e.target.files[0]) importJSON(e.target.files[0]); };
    const cd = $('#clear-data');
    if (cd) cd.onclick = () => {
      confirmAction({
        title: 'Clear all data?',
        message: 'This will delete every business, item, tag, and setting. You will be signed out.',
        confirmLabel: 'Continue',
        danger: true,
        requireTwice: true,
        title2: 'Delete everything permanently?',
        message2: 'All data will be unrecoverable.',
        confirmLabel2: 'Clear everything',
        onConfirm: async () => {
          try { await window.Storage.clear(); } catch {}
          try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem('infos-state-v3'); localStorage.removeItem('infos-state-v2'); } catch {}
          window.location.reload();
        }
      });
    };
    const sa = $('#sync-adapter');
    if (sa) sa.onchange = async () => {
      const val = sa.value;
      if (!val) { await window.Sync.disable(); state.syncAdapter = null; }
      else { try { await window.Sync.enable(val); state.syncAdapter = val; } catch (e) { toast(e.message); sa.value = state.syncAdapter || ''; return; } }
      persistAll();
      state.history.pop(); setActive('settings','fade');
    };
    const sn = $('#sync-now');
    if (sn) sn.onclick = async () => {
      sn.disabled = true; toast('Syncing…');
      const merged = await window.Sync.syncNow(cachedPrefs);
      if (merged && merged !== cachedPrefs) {
        await window.Storage.replace(merged);
        window.location.reload();
      } else { toast('Sync complete'); sn.disabled = false; }
    };
  }

  function wireAbout(c) {
    // Static content; nothing to wire
  }

  // ---------- Install banner ----------
  $('#install-btn').onclick = async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    const { outcome } = await deferredInstall.userChoice;
    $('#install-banner').hidden = true;
    if (outcome === 'accepted') toast('Installing Infos…');
    deferredInstall = null;
  };
  $('#install-dismiss').onclick = () => { $('#install-banner').hidden = true; savePrefs({ installDismissed: true }); };

  // ---------- Online/offline ----------
  function offlineEligible() { return 'serviceWorker' in navigator && navigator.serviceWorker.controller && !navigator.onLine; }
  window.addEventListener('online', () => { $('#offline-banner').hidden = true; });
  window.addEventListener('offline', () => { if (offlineEligible()) $('#offline-banner').hidden = false; });
  if (offlineEligible()) $('#offline-banner').hidden = false;

  // ---------- Pull to refresh ----------
  let pullY = 0, pullD = 0, pullA = false;
  pageViewport.addEventListener('touchstart', e => { if (pageContent.scrollTop === 0) { pullY = e.touches[0].clientY; pullA = true; } }, { passive: true });
  pageViewport.addEventListener('touchmove', e => {
    if (!pullA) return;
    const dy = e.touches[0].clientY - pullY;
    if (dy > 0 && pageContent.scrollTop === 0) { pullD = Math.min(dy * 0.5, 60); pullIndicator.style.height = pullD + 'px'; pullText.textContent = pullD > 50 ? 'Release to refresh' : 'Pull to refresh'; }
  }, { passive: true });
  pageViewport.addEventListener('touchend', () => {
    if (!pullA) return; pullA = false;
    if (pullD > 50) {
      pullIndicator.classList.add('refreshing'); pullText.textContent = 'Refreshing…';
      haptic(20);
      setTimeout(() => { pullIndicator.classList.remove('refreshing'); pullIndicator.style.height = '0'; const cur = state.history[state.history.length-1]?.split(':')[0]; if (cur) { state.history.pop(); setActive(cur, 'fade'); } toast('Refreshed'); }, 700);
    } else pullIndicator.style.height = '0';
    pullD = 0;
  });

  // ---------- Init ----------
  async function bootstrap() {
    // If the user arrived via an email confirmation / recovery link, Supabase
    // appends tokens to the URL hash. We do NOT auto-login from these (per
    // product requirement) — strip the fragment so the app lands cleanly on the
    // sign-in page where they enter email + password.
    try {
      if (location.hash && /access_token=|type=signup|type=recovery|type=email/i.test(location.hash)) {
        history.replaceState(null, '', location.pathname + location.search);
        sessionStorage.setItem('infos-just-confirmed', '1');
      }
    } catch {}
    // If we had a user before, show a skeleton immediately to avoid an auth-screen
    // flash. The real state is in IndexedDB (async), so we rely on a synchronous
    // localStorage hint written by savePrefs. Also check for a Supabase auth token
    // (a business login's session) which likewise means "show the app, not login".
    try {
      let wasSignedIn = localStorage.getItem('infos-boot-hint') === '1';
      if (!wasSignedIn) {
        const quickPeek = JSON.parse(localStorage.getItem('infos-state-v2') || localStorage.getItem('infos-state-v3-fallback') || 'null');
        wasSignedIn = !!(quickPeek && quickPeek.user);
      }
      if (!wasSignedIn) {
        // A signed-in Supabase session (e.g. a business login) lives in an
        // sb-*-auth-token localStorage key — its presence also means "show app".
        try { wasSignedIn = Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k)); } catch {}
      }
      if (wasSignedIn) {
        screenAuth.classList.remove('screen-active');
        screenMain.classList.add('screen-active');
        showSkeleton(4);
      }
    } catch {}
    // Wait for Storage to be ready, then load prefs into cachedPrefs. Both calls
    // are hard-capped at 2 seconds total: if IndexedDB is hung (e.g. blocked by
    // another tab of this app on an older schema), we proceed with whatever we
    // have rather than leaving the user staring at a skeleton for 30+ seconds.
    if (window.Storage) {
      try {
        const withTimeout = (p, ms, fallback) => Promise.race([
          p,
          new Promise(res => setTimeout(() => res(fallback), ms))
        ]);
        await withTimeout(window.Storage.ready(), 1500, null);
        cachedPrefs = (await withTimeout(window.Storage.load(), 1500, {})) || {};
      } catch (e) { console.warn('Storage init failed:', e); cachedPrefs = {}; }
    }
    // Re-apply prefs now that they're loaded
    const p = cachedPrefs;
    if (p.theme) app.dataset.theme = p.theme;
    if (p.accent) app.dataset.accent = p.accent;
    // v13: ignore any old sidebarCollapsed value
    state.sidebarCollapsed = false;
    app.classList.remove('collapsed');
    ['user','bizContext','activeBizId','activeTagId','businesses','nextBizId','nextItemId','nextTabId',
     'globalRenames','items','customTabs','tabOrder','onboarded','pushPermissionAsked','soundEnabled',
     'templates','cryptoMeta','syncAdapter','bizAllowedTabs','bizCloudMap','bizCloudVersions','bizTabOrder','accounts','recentSignins','customAccent','currentTab','globalActivity','itemOrder','__lastBalNames','__lastBalRecorder','hiddenTabs'].forEach(k => {
      if (p[k] !== undefined) state[k] = p[k];
    });
    // bulkSelected is transient UI state and must always be a Set (it's never
    // meant to be persisted; if an older build saved it, it'd come back as a
    // plain object/array without .has() and crash card rendering).
    if (!state.bulkSelected || typeof state.bulkSelected.has !== 'function') {
      state.bulkSelected = new Set();
    }

    // Legacy passwordEnc cleanup: encryption was removed, so any business that
    // still has an encrypted password but no plaintext one needs to have its
    // password re-set by the owner (we can't decrypt it without the master key,
    // which is gone). Strip the dead field so the UI clearly shows "no password
    // — re-set it" rather than acting like one exists.
    if (Array.isArray(state.businesses)) {
      state.businesses.forEach(function (b) {
        if (b && b.passwordEnc && !b.password) {
          delete b.passwordEnc;
          b.__needsPasswordReset = true;
        } else if (b && b.passwordEnc) {
          // We have both — keep the plaintext, drop the encrypted leftover.
          delete b.passwordEnc;
        }
      });
    }

    // Heal business passwords from the synchronous backup map (covers any case
    // where the in-memory/IndexedDB copy lost the password).
    try {
      const pwMap = JSON.parse(localStorage.getItem('infos-biz-pw') || '{}');
      if (Array.isArray(state.businesses)) {
        state.businesses.forEach(function (b) {
          if (b && !b.password && pwMap[b.id]) b.password = pwMap[b.id];
        });
      }
    } catch {}

    // Re-apply custom accent now that state is hydrated
    // Custom accent colors have been removed in favor of the preset accent
    // swatches. Migrate any existing custom value away so the user falls back to
    // their chosen accent cleanly.
    if (state.customAccent) { state.customAccent = null; try { clearCustomAccent(); } catch {} }

    // Re-run trash purge and item migration after real load
    Object.keys(state.items).forEach(k => {
      (state.items[k] || []).forEach(it => {
        if (it.pinned === undefined) it.pinned = false;
        if (it.notes === undefined) it.notes = '';
        if (!it.attachments) it.attachments = [];
        if (!it.history) it.history = [];
        if (it.deleted === undefined) it.deleted = false;
      });
      state.items[k] = (state.items[k] || []).filter(it => !it.deleted || (Date.now() - (it.deletedAt || 0) < PURGE_MS));
    });

    // Apply per-business theme tint if applicable
    applyPerBizTheme();

    // Restore sync adapter if previously enabled
    if (state.syncAdapter && window.Sync) {
      try { await window.Sync.enable(state.syncAdapter); } catch (e) { console.warn('Sync adapter restore failed:', e); }
    }

    // If Supabase is configured and a session is still valid, resume it and pull
    // the latest cloud snapshot before rendering.
    // Wait for Supabase config to load (from /api/config) before deciding auth.
    try { const sub = document.getElementById('boot-splash-sub'); if (sub) sub.textContent = 'Checking your session…'; } catch {}
    if (window.InfosSupabase && window.InfosSupabase.ready) {
      try { await window.InfosSupabase.ready; } catch {}
    }
    if (window.InfosSupabase && window.InfosSupabase.configured()) {
      try {
        const sbUser = await window.InfosSupabase.Auth.currentUser();
        if (sbUser) {
          // HARD GATE: if this Supabase session is a BUSINESS LOGIN (member),
          // load the shared app and never touch the owner data path. Compute
          // member status from the user we ALREADY fetched (no extra round-trip),
          // and enter directly from the metadata business id when present.
          const mInfo = window.InfosSupabase.Auth.memberInfoFromUser(sbUser);
          if (mInfo.isMember) {
            hideBootSplash();
            if (mInfo.businessId) {
              await enterSharedBusiness({ id: mInfo.businessId, name: '', color: '#378ADD' }, sbUser.email || '', { bootRestore: true });
              return;
            }
            // Member flag but no business id — one fallback table lookup.
            let biz = null;
            try { biz = await window.InfosSupabase.Auth.getMemberBusiness(); } catch {}
            if (biz) { await enterSharedBusiness(biz, sbUser.email || '', { bootRestore: true }); return; }
            // Can't resolve a business → don't degrade to owner; clean sign-in.
            try { await window.InfosSupabase.Auth.signOut(); } catch {}
            state.user = null; state.accounts = []; state.recentSignins = [];
            screenMain.classList.remove('screen-active'); screenAuth.classList.add('screen-active');
            return;
          }
          // Older member accounts (no metadata) — check the membership table too.
          try {
            const biz = await window.InfosSupabase.Auth.getMemberBusiness();
            if (biz) {
              hideBootSplash();
              await enterSharedBusiness(biz, sbUser.email || '', { bootRestore: true });
              return;
            }
          } catch (memErr) { console.warn('Business-login bootstrap check failed:', memErr); }
          try { const sub = document.getElementById('boot-splash-sub'); if (sub) sub.textContent = 'Syncing your data…'; } catch {}
          await window.Sync.enable('supabase');
          state.syncAdapter = 'supabase';
          const remote = await window.Sync.pullNow();
          if (remote && typeof remote === 'object') mergeCloudState(remote);
          // Ensure a local mirror of the owner so the app renders signed-in.
          const email = (sbUser.email || '').toLowerCase();
          const nm = (sbUser.user_metadata && sbUser.user_metadata.name) || (email ? email.split('@')[0] : 'You');
          if (email && !(state.accounts || []).find(a => a.email === email)) {
            state.accounts = state.accounts || [];
            state.accounts.push({ email, name: nm, cloud: true, createdAt: Date.now() });
          }
          if (!state.user && email) state.user = { name: nm, email };
          // OWNER: go live on any shared businesses so members' edits appear.
          try { await startOwnerSharedSync(); } catch (e) { console.warn('owner shared sync start failed', e); }
        } else {
          // CLOUD MODE, NO VALID SESSION → the user is NOT logged in. The Supabase
          // session is the source of truth here, so we must clear any stale local
          // owner session (this is what was causing deleted accounts to "come back"
          // and auto-log-in). Business (view-only) sessions are local and untouched.
          if (state.user && !state.bizContext) {
            state.user = null;
            state.accounts = [];
            state.recentSignins = [];
            try { if (window.Sync) window.Sync.disable(); } catch {}
            state.syncAdapter = null;
            persistAll();
          }
        }
      } catch (e) { console.warn('Supabase session restore failed:', e); }
    }

    if (state.user) {
      // If signed in as a business, check whether this device has been remotely revoked.
      if (state.bizContext) {
        const b = bizById(state.bizContext);
        const fp = getDeviceFingerprint();
        const d = b?.devices?.find(x => x.fingerprint === fp);
        if (d && d.revokedAt && d.revokedAt > (d.lastSeen || 0)) {
          // Owner clicked "Sign out" on this device from another browser. Honor that.
          toast('This device was signed out by the owner');
          // Defer logout slightly so the toast can render
          setTimeout(() => logout(), 400);
          return;
        }
      }
      { const am = $('#avatar-mini'); if (am) am.textContent = state.user.name.charAt(0).toUpperCase(); }
      headerBadge.hidden = !state.bizContext;
      screenAuth.classList.remove('screen-active');
      screenMain.classList.add('screen-active');
      buildNav(); updateActiveBizDisplay();
      let restoreTab = state.currentTab;
      if (!restoreTab) { try { restoreTab = localStorage.getItem('infos-last-tab'); } catch {} }
      setActive(restoreTab || 'notices');
      // Safety re-render: if the very first paint happened a beat before state
      // fully settled (async storage / initial cloud pull), re-render the current
      // tab once shortly after so the user never sees a blank tab that "needs a
      // few refreshes". Cheap and idempotent.
      setTimeout(() => { try { rerenderCurrentTab(); } catch {} }, 400);
      handleShareTarget();
      handleLaunchParams();
      // Heartbeat: mark this device "active now" every 30 seconds while a business session is open.
      if (state.bizContext) {
        heartbeatBizDevice();
        if (!window.__bizHeartbeatId) {
          window.__bizHeartbeatId = setInterval(() => {
            if (!state.bizContext) return;
            // Re-check revocation on every heartbeat
            const b2 = bizById(state.bizContext);
            const fp2 = getDeviceFingerprint();
            const d2 = b2?.devices?.find(x => x.fingerprint === fp2);
            if (d2 && d2.revokedAt && d2.revokedAt > (d2.lastSeen || 0)) {
              clearInterval(window.__bizHeartbeatId); window.__bizHeartbeatId = null;
              toast('This device was signed out by the owner');
              setTimeout(() => logout(), 400);
              return;
            }
            heartbeatBizDevice(); persistAll();
          }, 30_000);
        }
      }
    } else {
      // Capture any share-target URL params so they survive sign-in
      handleShareTarget();
      if (!state.onboarded) {
        screenOnb.hidden = false; showOnbSlide(1);
      }
      renderRecentSignins();
      // If the user just clicked an email confirmation link, show a clear
      // confirmation MESSAGE screen (not a redirect to the login form). They tap
      // the button when ready to sign in.
      try {
        if (sessionStorage.getItem('infos-just-confirmed')) {
          sessionStorage.removeItem('infos-just-confirmed');
          setAuthMode('signin');
          setTimeout(() => {
            try {
              showFullScreenMessage({
                icon: 'ti-circle-check',
                title: 'Email confirmed',
                message: 'Your email has been confirmed. You can now sign in with your email and password.',
                button: {
                  label: 'Go to sign in',
                  onClick: () => {
                    const fsm = document.getElementById('fullscreen-message'); if (fsm) fsm.remove();
                    setAuthMode('signin');
                  }
                }
              });
            } catch {}
          }, 200);
        }
      } catch {}
    }
    // Reapply per-biz tint when OS theme changes (only matters if theme is auto)
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => { if (app.dataset.theme === 'auto') applyPerBizTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange); // Safari fallback
    } catch {}
    // Boot finished — the correct screen (main or sign-in) is now set, so fade
    // out the boot splash. This is what prevents the brief login-screen flash on
    // refresh: the splash covers the whole async session check above.
    hideBootSplash();
  }

  function hideBootSplash() {
    try {
      const bs = document.getElementById('boot-splash');
      if (!bs) return;
      bs.classList.add('boot-hide');
      setTimeout(() => { try { bs.remove(); } catch {} }, 400);
    } catch {}
  }

  // Safety net: never let the splash get stuck if boot throws somewhere.
  setTimeout(() => { try { hideBootSplash(); } catch {} }, 8000);

  bootstrap();
})();
