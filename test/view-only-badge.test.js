// v207: the View-only header badge logic must remain null-safe and consistent.
// The badge ELEMENT was removed from the DOM in this version (user request:
// remove "View only" everywhere). Since $('#header-badge') now returns null,
// every assignment must be guarded so the app never throws.
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'app.js'), 'utf8');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  \u2713 ' + m); } else { fail++; console.log('  \u2717 ' + m); } };

// 1. The badge element/text is gone from the DOM.
ok(!/View only/.test(html), 'index.html no longer contains "View only" text');
ok(!/id="header-badge"/.test(html), 'header-badge element removed from index.html');

// 2. Every headerBadge.hidden write is null-guarded (won't throw if element absent).
const writes = src.match(/headerBadge\.hidden = /g) || [];
const guarded = src.match(/if \(headerBadge\) headerBadge\.hidden = /g) || [];
ok(writes.length > 0, 'headerBadge assignments still present (' + writes.length + ')');
ok(writes.length === guarded.length, 'all headerBadge writes are guarded (' + guarded.length + '/' + writes.length + ')');

// 3. The fast-path switch-to-owner still clears bizContext (the real view-only state).
const fastPath = src.slice(src.indexOf('Detect: currently owner-viewing-biz'),
                          src.indexOf("toast('Switched to '"));
ok(/state\.bizContext = null;/.test(fastPath), 'fast-path still clears bizContext on switch-to-owner');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
