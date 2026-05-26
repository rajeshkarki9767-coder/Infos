// Regression guard for a bug found in audit: the owner's local->cloud business
// mapping (bizCloudMap) and per-business shared version (bizCloudVersions) must
// be PERSISTED by persistAll and RESTORED on boot. If they aren't, owner->member
// sync silently breaks after a page reload (the share link is forgotten and the
// version counter resets, breaking realtime de-dupe).
//
//   node test/persistence.test.js
//
// app.js is a closure with no exports, so we assert against the source: the
// persistAll savePrefs block and both hydration lists must reference both keys.

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

let passed = 0, failed = 0;
function check(n, c) { if (c) { passed++; console.log('  \u2713 ' + n); } else { failed++; console.log('  \u2717 ' + n); } }

// Isolate the whole persistAll function (from its declaration to the next
// top-level "function " declaration).
const persistStart = src.indexOf('function persistAll');
const nextFn = src.indexOf('\n  function ', persistStart + 10);
const persistBlock = src.slice(persistStart, nextFn > 0 ? nextFn : persistStart + 4000);

console.log('\npersistAll persists cloud sync state:');
check('persistAll saves bizCloudMap', /bizCloudMap:\s*state\.bizCloudMap/.test(persistBlock));
check('persistAll saves bizCloudVersions', /bizCloudVersions:\s*state\.bizCloudVersions/.test(persistBlock));

console.log('\nhydration restores cloud sync state (both restore lists):');
const hydrationLines = src.split('\n').filter(l => l.includes("'bizCloudMap'"));
check('found 2 hydration lists referencing bizCloudMap', hydrationLines.length === 2);
check('both hydration lists include bizCloudVersions', hydrationLines.every(l => l.includes("'bizCloudVersions'")));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
