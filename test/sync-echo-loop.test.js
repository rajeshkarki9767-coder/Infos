// Verifies the echo write-loop is broken: pushes are content-deduped and applies
// record the dedup baseline so a received update can't be echoed back.
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let failed = 0;
function check(name, cond) { console.log((cond ? '  \u2713 ' : '  \u2717 ') + name); if (!cond) failed++; }

// Member push dedup
check('member push computes a content signature', /sig = JSON\.stringify\(slice\.items \|\| \{\}\) \+ '\|' \+ JSON\.stringify\(slice\.business/.test(app));
check('member push skips identical content', /sig === window\.__lastSharedContentSig\) return;/.test(app));
check('member push records sig only after successful save', /state\.__sharedVersion = v;\s*\n\s*if \(sig != null\) window\.__lastSharedContentSig = sig;/.test(app));

// Apply records baseline (member, both paths)
const applies = (app.match(/window\.__lastSharedContentSig = JSON\.stringify\(sl\.items/g) || []).length;
check('member apply records baseline in BOTH realtime + poll paths', applies >= 2);

// Owner apply records push-sig (both paths)
const ownerSig = (app.match(/window\.__ownerPushSig\[cloudBusinessId\] = JSON\.stringify\(sl\.items/g) || []).length;
check('owner apply records push-sig in BOTH realtime + poll paths', ownerSig >= 2);

// Owner push still has its change-detection
check('owner push change-detection intact', /window\.__ownerPushSig\[cloudId\] !== sig/.test(app));

if (failed) { console.log('\n  ' + failed + ' failed'); process.exit(1); }
console.log('  ' + 6 + ' passed, 0 failed');
