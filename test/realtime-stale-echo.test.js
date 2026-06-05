// v212: the realtime apply path must ignore a payload whose version is <= the
// version already applied (stale self-echo), which caused new entries to flicker
// (appear, disappear, reappear) even on a single device. Mirrors the guard.
function shouldApply(incomingV, appliedV) {
  if (incomingV && appliedV && incomingV <= appliedV) return false; // stale/dup
  return true;
}
let pass=0, fail=0;
const ok=(c,m)=>{if(c){pass++;console.log('  \u2713 '+m);}else{fail++;console.log('  \u2717 '+m);}};

ok(shouldApply(5, 4) === true,  'newer version applies');
ok(shouldApply(4, 5) === false, 'older version (stale echo) is ignored');
ok(shouldApply(5, 5) === false, 'same version (duplicate echo) is ignored');
ok(shouldApply(1, 0) === true,  'first real payload applies when nothing applied yet');
ok(shouldApply(0, 5) === true,  'versionless payload falls through to content guard (not blocked)');
ok(shouldApply(6, 5) === true,  'monotonic increase keeps applying');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
