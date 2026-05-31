// Regression: the member's incoming-update apply must not be deferred forever by a
// stale sharedSaveTimer. A fired setTimeout id stays truthy, so the timer MUST be
// reset to null when the push runs (and at signout/switch), otherwise the member
// detects "NEWER" every poll but never applies — showing "Synced" with no content.
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let failed = 0;
function check(name, cond) { console.log((cond ? '  \u2713 ' : '  \u2717 ') + name); if (!cond) failed++; }

// doPush resets the timer to null when it starts running
const doPushIdx = app.indexOf('const doPush = async () => {');
const doPushBody = app.slice(doPushIdx, doPushIdx + 700);
check('doPush resets sharedSaveTimer = null on run', /sharedSaveTimer = null;/.test(doPushBody));

// pushSharedState nulls the timer right after clearTimeout (pre-schedule)
check('pushSharedState nulls timer after clearTimeout', /clearTimeout\(sharedSaveTimer\);\s*\n\s*sharedSaveTimer = null;/.test(app));

// signout/switch clearTimeout sites also null it
const nulledSites = (app.match(/clearTimeout\(sharedSaveTimer\);\s*sharedSaveTimer = null;/g) || []).length;
check('signout/switch sites null the timer (>=2)', nulledSites >= 2);

// the deferral guard still exists (we fixed the lifecycle, not removed the guard)
check('deferral guard intact', /modalOpen \|\| fsmOpen \|\| \(typeof sharedSaveTimer/.test(app));

if (failed) { console.log('\n  ' + failed + ' failed'); process.exit(1); }
console.log('  4 passed, 0 failed');
