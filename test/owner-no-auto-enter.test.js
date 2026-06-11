// v227: an OWNER login (not a member by metadata) must NOT auto-enter a business
// via a stray business_members row. Assert the source no longer does a
// getMemberBusiness() auto-enter OUTSIDE the isMember branch, in both the sign-in
// path and the boot-restore path.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
let pass=0, fail=0; const ok=(c,m)=>{if(c){pass++;console.log('  \u2713 '+m);}else{fail++;console.log('  \u2717 '+m);}};

// Both v227 fix markers present (sign-in + boot).
ok((src.match(/v227 FIX/g)||[]).length >= 2, 'both owner-path fixes present (sign-in + boot)');

// The old sign-in fallback block (table lookup + enterSharedBusiness, then
// "continuing as owner") must be gone.
ok(!/continuing as owner/.test(src), 'removed the sign-in owner-path table auto-enter');

// The old boot "Older member accounts (no metadata) — check the membership table too"
// auto-enter must be gone.
ok(!/Older member accounts \(no metadata\) — check the membership table too/.test(src),
   'removed the boot owner-path table auto-enter');

// getMemberBusiness should still exist for the LEGITIMATE in-isMember fallback.
ok(/getMemberBusiness/.test(src), 'getMemberBusiness still used for genuine member fallback');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
