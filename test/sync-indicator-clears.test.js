// v220: the "Syncing…" indicator must ALWAYS settle after a push, on success or
// failure — otherwise a STALE_VERSION (or any error) leaves the business device
// stuck on "Syncing…" forever. We assert the source uses a finally block / an
// unconditional clear in both push paths.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
let pass=0, fail=0;
const ok=(c,m)=>{if(c){pass++;console.log('  \u2713 '+m);}else{fail++;console.log('  \u2717 '+m);}};

// Member push: the doPush try/catch must have a finally that clears the indicator.
const memberPush = src.slice(src.indexOf('function pushSharedState'), src.indexOf('function pushSharedState') + 4000);
ok(/finally\s*{[\s\S]*__InfosSyncDone[\s\S]*}/.test(memberPush), 'member push clears indicator in a finally block');

// Owner push: the unconditional (no "pushedAny &&") clear must be present.
ok(!/if \(pushedAny && window\.__InfosSyncDone\)/.test(src), 'owner push no longer gates the clear on pushedAny');
ok(/v220 FIX: always settle the sync indicator/.test(src), 'owner push has the unconditional settle');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
