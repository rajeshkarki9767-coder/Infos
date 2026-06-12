// v231: dropped (stale-echo) realtime payloads must NOT mark realtime as healthy,
// otherwise the poll fallback is starved and missed member updates don't show.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
let pass=0, fail=0; const ok=(c,m)=>{if(c){pass++;console.log('  \u2713 '+m);}else{fail++;console.log('  \u2717 '+m);}};

// Exactly ONE stamp site, located AFTER the version gate inside applySharedSnapshotDirect.
ok((src.match(/__lastRealtimeApply = Date\.now\(\)/g)||[]).length === 1, 'exactly one __lastRealtimeApply stamp');
const fn = src.slice(src.indexOf('function applySharedSnapshotDirect'));
const gateIdx = fn.indexOf('stale or duplicate echo');
const stampIdx = fn.indexOf('__lastRealtimeApply = Date.now()');
ok(gateIdx > -1 && stampIdx > gateIdx, 'stamp sits AFTER the stale-echo version gate (only genuine applies count)');

// Behavioral: simulate gate — a dropped echo must not refresh the timestamp.
function makeApply() {
  let lastApply = 0, appliedV = 100;
  return {
    receive(v) { if (v <= appliedV) return 'dropped'; lastApply = Date.now(); appliedV = v; return 'applied'; },
    last() { return lastApply; }
  };
}
const a = makeApply();
ok(a.receive(100) === 'dropped' && a.last() === 0, 'stale echo dropped without stamping');
ok(a.receive(101) === 'applied' && a.last() > 0, 'genuinely newer payload stamps');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
