// Verifies the passwordless multi-account switch (session-token stash + restore).
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const adapter = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'adapter.js'), 'utf8');
let failed = 0;
function check(name, cond) { console.log((cond ? '  \u2713 ' : '  \u2717 ') + name); if (!cond) failed++; }

// Adapter / Auth — methods must live in the Auth object AND be called via Auth.*
check('Auth exposes getSessionTokens', /async getSessionTokens\(\)/.test(adapter));
check('Auth exposes restoreSession', /async restoreSession\(access_token, refresh_token\)/.test(adapter));
check('restoreSession uses setSession', /c\.auth\.setSession\(\{ access_token, refresh_token \}\)/.test(adapter));
// Namespace correctness: getSessionTokens/restoreSession sit inside the Auth
// object literal (before `const adapter =`), and callers use Auth.*, not adapter.*
(() => {
  const authStart = adapter.indexOf('const Auth = {');
  const adapterStart = adapter.indexOf('const adapter = {');
  const gst = adapter.indexOf('async getSessionTokens');
  const rs = adapter.indexOf('async restoreSession');
  check('session methods are inside the Auth object', authStart >= 0 && adapterStart > authStart && gst > authStart && gst < adapterStart && rs > authStart && rs < adapterStart);
})();
check('callers use Auth.getSessionTokens (not adapter)', /window\.InfosSupabase\.Auth\.getSessionTokens/.test(app) && !/window\.InfosSupabase\.adapter\.getSessionTokens/.test(app));
check('callers use Auth.restoreSession (not adapter)', /window\.InfosSupabase\.Auth\.restoreSession/.test(app) && !/window\.InfosSupabase\.adapter\.restoreSession/.test(app));

// App helpers
check('stashAccountSession helper', /async function stashAccountSession\(email, kind, bizId\)/.test(app));
check('getStashedSession helper', /function getStashedSession\(email\)/.test(app));
check('forgetAccountSession helper', /function forgetAccountSession\(email\)/.test(app));
check('sessions stored device-local (not cloud)', /ACCOUNT_SESSIONS_KEY = 'infos-account-sessions'/.test(app));
check('stash stores tokens not password', /access_token: tokens\.access_token/.test(app) && !/password: pw/.test(app.split('stashAccountSession')[1] || ''));

// Switch flow
check('switch tries passwordless restore first', /if \(stashed && stashed\.access_token && stashed\.refresh_token && !isOwnLocalBiz/.test(app));
check('switch re-stashes current account before leaving', /await stashAccountSession\(curEmail/.test(app));
check('switch falls back to password on expired token', /Session restore failed; falling back to password sign-in/.test(app));
check('fallback pre-fills email', /localStorage\.setItem\('infos-pending-signin-email', email \|\| ''\)/.test(app));

// Stash call sites
check('stash on auth sign-in', /try \{ stashAccountSession\(email\); \} catch \{\}/.test(app));
check('stash inside enterSharedBusiness', /stashAccountSession\(email, 'business', biz\.id\)/.test(app));
check('stash on owner login', /stashAccountSession\(email, 'owner', null\)/.test(app));

// Forget clears session
check('forgetDeviceAccount clears stashed session', /forgetAccountSession\(email\);/.test(app));

if (failed) { console.log('\n  ' + failed + ' failed'); process.exit(1); }
console.log("  " + 18 + " passed, 0 failed");
