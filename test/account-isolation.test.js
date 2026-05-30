// Regression test for the cross-account data contamination P1 (release gate).
// Verifies the owner sign-in path resets a previous owner's workspace data
// before merging a different owner's cloud state.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
let failed = 0;
function check(name, cond) { console.log((cond ? '  \u2713 ' : '  \u2717 ') + name); if (!cond) failed++; }

check('resetOwnerDataBaseline helper exists', /function resetOwnerDataBaseline\(\)/.test(src));
check('reset clears items', /function resetOwnerDataBaseline[\s\S]*?state\.items = \{\};/.test(src));
check('reset clears businesses', /function resetOwnerDataBaseline[\s\S]*?state\.businesses = \[\];/.test(src));
check('reset clears bizPasswords', /function resetOwnerDataBaseline[\s\S]*?state\.bizPasswords = \{\};/.test(src));
check('sign-in compares previous owner email', /const prevOwner = \(state\.__activeOwnerEmail \|\| ''\)\.toLowerCase\(\);/.test(src));
check('sign-in resets when owner differs', /if \(prevOwner && prevOwner !== email\.toLowerCase\(\)\) \{\s*\n\s*resetOwnerDataBaseline\(\);/.test(src));
check('sign-in records active owner after merge', /state\.__activeOwnerEmail = email;/.test(src));
check('__activeOwnerEmail persisted in savePrefs', /__activeOwnerEmail: state\.__activeOwnerEmail,/.test(src));
check('__activeOwnerEmail in both restore allowlists', (src.match(/'__activeOwnerEmail'/g) || []).length >= 2);

if (failed) { console.log('\n  ' + failed + ' check(s) failed'); process.exit(1); }
console.log('  9 passed, 0 failed');
