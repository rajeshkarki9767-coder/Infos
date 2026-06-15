// v233: Balance tab fully removed. Assert it's gone from the tab system and that
// stale references route safely.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
let pass=0, fail=0; const ok=(c,m)=>{if(c){pass++;console.log('  \u2713 '+m);}else{fail++;console.log('  \u2717 '+m);}};

ok(!/balance: \{[^}]*render:/.test(src), 'no balance tab render entry in TABS');
ok(!/'notices','games','system','idpass','balance'/.test(src), 'balance removed from default tabOrder');
ok(/filter\(t => t !== 'balance'\)/.test(src), 'existing users have balance stripped from tabOrder');
ok(!/'balance-detail': \{ name: '', icon: '', render: function/.test(src), 'balance-detail route removed');
ok(/Balance removed — route any stale balance-detail link to notices/.test(src), 'stale balance-detail links route to notices safely');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
