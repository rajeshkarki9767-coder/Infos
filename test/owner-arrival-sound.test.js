// Balance (and other) entries a member adds must chime on the owner. The owner's
// realtime apply path previously applied silently — verify it now snapshots
// arrivals and calls chimeForArrivals, and that chimeForArrivals plays the balance
// sound for new balance-tab items.
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let failed = 0;
const check = (n, c) => { console.log((c ? '  \u2713 ' : '  \u2717 ') + n); if (!c) failed++; };

// owner realtime branch snapshots + chimes
check('owner realtime path snapshots arrivals', /const __beforeOwnerRT = itemIdSnapshot\(\);/.test(app));
check('owner realtime path chimes', /chimeForArrivals\(__beforeOwnerRT\)/.test(app));

// chimeForArrivals maps balance arrivals to the balance sound, respects mute
const cf = app.slice(app.indexOf('function chimeForArrivals'), app.indexOf('function chimeForArrivals') + 1100);
check('balance arrival -> playBalanceSound', /gotBalance = true/.test(cf) && /playBalanceSound\(\)/.test(cf));
check('chime respects sound preference', /if \(!soundsOn\(\)\) return;/.test(cf));

// all four apply paths chime (member realtime + member poll + owner poll + owner realtime)
check('four apply paths call chimeForArrivals', (app.match(/chimeForArrivals\(/g) || []).length >= 4);

if (failed) { console.log('\n  ' + failed + ' failed'); process.exit(1); }
console.log('  5 passed, 0 failed');
