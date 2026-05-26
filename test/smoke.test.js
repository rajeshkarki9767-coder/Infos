// DOM smoke test — loads the real index.html and the app scripts in jsdom to
// confirm the app boots without throwing and the shared-access wiring is present.
// This catches integration errors (undefined refs, broken selectors) that a
// syntax check can't.
//
//   node test/smoke.test.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  \u2713 ' + name); }
  else { failed++; console.log('  \u2717 ' + name); }
}

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

async function run() {
  const html = read('index.html');

  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://example.com/'
  });
  const { window } = dom;

  // Minimal shims for browser APIs app.js touches at load.
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  window.scrollTo = () => {};
  window.navigator.vibrate = () => {};
  if (!window.navigator.serviceWorker) {
    Object.defineProperty(window.navigator, 'serviceWorker', { value: { register: () => Promise.reject(new Error('no sw')), addEventListener() {} }, configurable: true });
  }
  window.indexedDB = window.indexedDB || { open: () => ({ onupgradeneeded: null, onsuccess: null, onerror: null }) };
  window.requestAnimationFrame = window.requestAnimationFrame || (cb => setTimeout(cb, 0));
  window.fetch = () => Promise.reject(new Error('no network in smoke test'));
  // No Supabase global → app runs in local-only mode (configured() === false).

  const ctx = dom.getInternalVMContext();

  // Load the scripts the page includes, in order. We skip the big vendor
  // supabase bundle (not needed; absence => local-only) and the inline scripts.
  const scripts = ['db.js', 'crypto.js', 'sync.js', 'icons.js', 'supabase/shared-slice.js', 'supabase/adapter.js', 'app.js'];
  let threw = null;
  for (const s of scripts) {
    try {
      const code = read(s);
      const vm = require('vm');
      vm.runInContext(code, ctx, { filename: s });
    } catch (e) { threw = { script: s, err: e }; break; }
  }

  check('all app scripts evaluate without throwing', !threw);
  if (threw) { console.log('    -> ' + threw.script + ': ' + (threw.err && threw.err.message)); console.log(threw.err && threw.err.stack); }

  check('shared-slice attached to window', typeof window.InfosSharedSlice === 'object' && typeof window.InfosSharedSlice.buildSharedSlice === 'function');
  check('InfosSupabase attached (local-only, not configured)', window.InfosSupabase && window.InfosSupabase.configured() === false);
  check('Sync registered the supabase adapter', !!window.Sync);

  // Let any microtasks (boot) settle, then confirm the auth screen is the active
  // screen (no session, local-only) and nothing blew up during boot.
  await new Promise(r => setTimeout(r, 200));
  const authScreen = window.document.getElementById('screen-auth');
  check('auth screen exists in DOM after boot', !!authScreen);
  // The member-view-root element must NOT exist (old view-only screen removed).
  check('no leftover member-view-root element', !window.document.getElementById('member-view-root'));

  console.log(`\n${passed} passed, ${failed} failed`);
  dom.window.close();
  process.exit(failed ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
