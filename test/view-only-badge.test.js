// Regression: the "View only" header badge (#header-badge) must always track
// isViewOnly() (i.e. !!state.bizContext). Two bugs were fixed in v206:
//   1. fast-path switch-to-owner cleared bizContext but left the badge visible.
//   2. login(asBizId) unconditionally hid the badge even when entering a biz view.
// This test asserts the badge-toggle expression used at each mutation site
// matches the invariant, by scanning the source for the known-good pattern.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  \u2713 ' + m); } else { fail++; console.log('  \u2717 ' + m); } };

// 1. The fast-path switch-to-owner block must hide the badge after nulling bizContext.
const fastPath = src.slice(src.indexOf('Detect: currently owner-viewing-biz'),
                          src.indexOf("toast('Switched to '"));
ok(/state\.bizContext = null;/.test(fastPath), 'fast-path clears bizContext');
ok(/headerBadge\.hidden = true;/.test(fastPath), 'fast-path hides View-only badge (bug #1 fixed)');

// 2. login() must set the badge from bizContext, not unconditionally hide it.
const loginFn = src.slice(src.indexOf('function login(name, email, asBizId)'),
                          src.indexOf('function login(name, email, asBizId)') + 600);
ok(/headerBadge\.hidden = !state\.bizContext;/.test(loginFn), 'login() badge tracks bizContext (bug #2 fixed)');
ok(!/headerBadge\.hidden = true;/.test(loginFn), 'login() no longer unconditionally hides badge');

// 3. boot still uses the invariant form.
ok(/headerBadge\.hidden = !state\.bizContext;/.test(src), 'boot uses invariant form');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
