// A balance entry deleted on one login must chime on the other — both owner and
// business sides. chimeForArrivals runs on all four sync-apply paths; verify it
// detects balance removals (beforeSet minus current live set) and plays the
// distinct delete sound, respecting the mute preference.
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let failed = 0;
const check = (n, c) => { console.log((c ? '  \u2713 ' : '  \u2717 ') + n); if (!c) failed++; };

check('distinct delete sound defined', /function playBalanceDeleteSound\(\)/.test(app));
check('distinct descending delete sound', /playBalanceDeleteSound\(\) \{ playChord\(\[523\.25, 392\.00, 261\.63\]/.test(app));

const cf = app.slice(app.indexOf('function chimeForArrivals'), app.indexOf('function chimeForArrivals') + 1900);
check('diffs beforeSet against current live set', /const afterSet = itemIdSnapshot\(\);/.test(cf));
check('detects balance removals', /key\.indexOf\('balance:'\) === 0\) gotBalanceDelete = true/.test(cf));
check('plays delete sound when no arrival overlaps', /gotBalanceDelete && !gotReminder && !gotBalance && !gotOther\) playBalanceDeleteSound\(\)/.test(cf));
check('still gated by sound preference', /if \(!soundsOn\(\)\) return;/.test(cf));
check('chimeForArrivals runs on all 4 apply paths', (app.match(/chimeForArrivals\(/g) || []).length >= 4);

if (failed) { console.log('\n  ' + failed + ' failed'); process.exit(1); }
console.log('  7 passed, 0 failed');
