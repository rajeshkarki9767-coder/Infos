// v213: saveSharedState must REJECT a stale write (cloud ahead of base) instead
// of clobbering it. This is the core of the "member entry disappeared after the
// owner's self-heal re-push" data-loss fix. We mirror the decision logic.
function decide(expectedVersion, cloudVersion) {
  const baseVersion = Number(expectedVersion) || 0;
  if (cloudVersion > baseVersion) return { action: 'REJECT', code: 'STALE_VERSION' };
  return { action: 'WRITE', nextVersion: Math.max(baseVersion, cloudVersion) + 1 };
}
let pass=0, fail=0;
const ok=(c,m)=>{if(c){pass++;console.log('  \u2713 '+m);}else{fail++;console.log('  \u2717 '+m);}};

// Owner self-heal based on v5, but a member bumped cloud to v6 → must reject.
ok(decide(5, 6).action === 'REJECT', 'stale owner push (cloud ahead) is REJECTED, not clobbering member entry');
ok(decide(5, 6).code === 'STALE_VERSION', 'rejection carries STALE_VERSION code for caller to pull');

// Up-to-date push (base == cloud) → write, version increments.
let r = decide(6, 6);
ok(r.action === 'WRITE' && r.nextVersion === 7, 'in-sync push writes and increments');

// Base ahead of cloud (cloud row missing/reset) → write.
r = decide(3, 0);
ok(r.action === 'WRITE' && r.nextVersion === 4, 'first write / cloud-empty proceeds');

// Equal zero (fresh) → write v1.
ok(decide(0, 0).nextVersion === 1, 'fresh share writes version 1');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
