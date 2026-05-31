// Verifies the echo write-loop is broken: pushes are content-deduped and applies
// record the dedup baseline so a received update can't be echoed back.
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let failed = 0;
function check(name, cond) { console.log((cond ? '  \u2713 ' : '  \u2717 ') + name); if (!cond) failed++; }

// Member push dedup
check('member push computes a content signature', /sig = stableStringify\(slice\.items \|\| \{\}\) \+ '\|' \+ stableStringify\(slice\.business/.test(app));
check('member push skips identical content', /sig === window\.__lastSharedContentSig\) return;/.test(app));
check('member push records sig only after successful save', /state\.__sharedVersion = v;\s*\n\s*if \(sig != null\) window\.__lastSharedContentSig = sig;/.test(app));

// Apply records baseline (member, both paths)
const applies = (app.match(/window\.__lastSharedContentSig = stableStringify\(sl\.items/g) || []).length;
check('member apply records baseline in BOTH realtime + poll paths', applies >= 2);

// Owner apply records push-sig (both paths)
const ownerSig = (app.match(/window\.__ownerPushSig\[cloudBusinessId\] = stableStringify\(sl\.items/g) || []).length;
check('owner apply records push-sig in BOTH realtime + poll paths', ownerSig >= 2);

// Owner push still has its change-detection
check('owner push change-detection intact', /window\.__ownerPushSig\[cloudId\] !== sig/.test(app));
check('uses key-order-independent stableStringify for sync sigs', /function stableStringify/.test(app) && !/JSON\.stringify\(slice\.items/.test(app));

if (failed) { console.log('\n  ' + failed + ' failed'); process.exit(1); }
console.log("  " + 7 + " passed, 0 failed");

// v161: owner must record the realtime-guard signature on push so it recognizes
// and skips its OWN echo (owner is subscribed to its businesses' realtime).
(function(){
  const fs2 = require('fs'); const path2 = require('path');
  const app2 = fs2.readFileSync(path2.join(__dirname, '..', 'app.js'), 'utf8');
  let f2 = 0; const ck2 = (n,x)=>{ console.log((x?'  \u2713 ':'  \u2717 ')+n); if(!x)f2++; };
  ck2('owner push records __ownerSliceSig (echo recognition)', /window\.__ownerSliceSig\[p\.cloudId\] = stableStringify\(\(p\.slice && p\.slice\.items\)/.test(app2));
  ck2('formula matches realtime guard owner-branch sig', /stableStringify\(snap\.data\.items \|\| \{\}\) \+ '\|' \+ stableStringify\(snap\.data\.business/.test(app2));
  ck2('owner push still records __ownerPushSig (self-heal dedup)', /window\.__ownerPushSig\[p\.cloudId\] = p\.sig;/.test(app2));
  if (f2) { console.log('\n  '+f2+' failed'); process.exit(1); }
  console.log('  3 passed (v161 owner echo guard)');
})();
