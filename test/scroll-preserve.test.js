// Verifies the scroll-preservation behavior used by "Load more / View more":
// after a re-render that resets scrollTop to 0 (as setActive does), the helper
// must restore the user's previous scroll position so the page doesn't jump.
//
//   node test/scroll-preserve.test.js
//
// app.js's rerenderPreservingScroll is inside a closure, so we replicate its
// exact algorithm here against a fake scroll container + fake requestAnimationFrame,
// and assert the contract. (The source is also grep-checked so the real handler
// is wired to the helper and not to the old jump-to-top path.)

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(n, c) { if (c) { passed++; console.log('  \u2713 ' + n); } else { failed++; console.log('  \u2717 ' + n); } }

// ---- Replicate the helper's algorithm (kept in sync with app.js) ----
function makeHelper(pageContent, raf) {
  return function rerenderPreservingScroll(doRerender) {
    const prevTop = pageContent ? pageContent.scrollTop : 0;
    const prevBehavior = pageContent ? pageContent.style.scrollBehavior : '';
    if (pageContent) pageContent.style.scrollBehavior = 'auto';
    try { doRerender(); } catch (e) {}
    const restore = () => { if (pageContent) pageContent.scrollTop = prevTop; };
    raf(() => { restore(); raf(() => { restore(); if (pageContent) pageContent.style.scrollBehavior = prevBehavior; }); });
  };
}

console.log('\nscroll preservation algorithm:');
{
  // Fake rAF that runs callbacks synchronously in order (simulates two frames).
  const queue = [];
  const raf = (cb) => queue.push(cb);
  const flush = () => { while (queue.length) { const cb = queue.shift(); cb(); } };

  const pageContent = { scrollTop: 850, style: { scrollBehavior: 'smooth' } };
  const helper = makeHelper(pageContent, raf);

  // Simulate "view more": the re-render resets scroll to 0 (like setActive does).
  helper(() => { pageContent.scrollTop = 0; });
  check('scrollBehavior set to auto during re-render', pageContent.style.scrollBehavior === 'auto');
  check('immediately after re-render scrollTop was reset to 0 (by the re-render)', pageContent.scrollTop === 0);
  flush();
  check('after frames, scrollTop is restored to the previous position (850)', pageContent.scrollTop === 850);
  check('scrollBehavior restored to original (smooth)', pageContent.style.scrollBehavior === 'smooth');
}
{
  // Edge: starting at top (0) stays at top.
  const queue = []; const raf = (cb) => queue.push(cb); const flush = () => { while (queue.length) queue.shift()(); };
  const pageContent = { scrollTop: 0, style: { scrollBehavior: '' } };
  const helper = makeHelper(pageContent, raf);
  helper(() => { pageContent.scrollTop = 0; });
  flush();
  check('top stays at top (0)', pageContent.scrollTop === 0);
}

console.log('\nsource wiring (handlers use the helper, not jump-to-top):');
{
  const src = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');
  check('rerenderPreservingScroll helper exists in app.js', /function rerenderPreservingScroll\(/.test(src));
  // The "View more" handler must use the helper.
  const moreIdx = src.indexOf("$('#biz-activity-more')");
  const moreBlock = src.slice(moreIdx, moreIdx + 260);
  check('"View more" handler wrapped in rerenderPreservingScroll', /rerenderPreservingScroll/.test(moreBlock));
  check('"View more" no longer uses the jump-causing fade re-render', !/setActive\('biz-detail','fade'/.test(moreBlock));
  // The inline activity delete must too.
  const delIdx = src.indexOf('data-activity-del]');
  const delBlock = src.slice(delIdx, delIdx + 400);
  check('inline activity delete preserves scroll', /rerenderPreservingScroll/.test(delBlock));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
