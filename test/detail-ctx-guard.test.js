// Regression test for the v108 blank-page crash:
//   "TypeError: Cannot read properties of undefined (reading 'itemTab')"
// A sync-triggered re-render called renderItemDetail without a ctx, which threw,
// blanked the page, and aborted the sync apply. These checks ensure the detail
// renderers fall back to the stored ctx (and bail safely) instead of throwing,
// and that rerenderCurrentTab passes the stored ctx.
//
//   node test/detail-ctx-guard.test.js

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  \u2713 ' + name); }
  else { failed++; console.log('  \u2717 ' + name); }
}

const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

// setActive must persist the ctx so re-renders can reuse it.
check('setActive stores current ctx', /state\.__currentCtx = ctx \|\| null/.test(app));

// rerenderCurrentTab must pass the stored ctx (not call render with no ctx).
check('rerenderCurrentTab passes stored ctx',
  /def\.render\(pageContent, state\.__currentCtx/.test(app));

// renderItemDetail must guard a missing ctx before reading ctx.itemTab.
const itemDetail = app.slice(app.indexOf('function renderItemDetail'));
const itemHead = itemDetail.slice(0, 600);
check('renderItemDetail falls back to stored ctx', /if \(!ctx\) ctx = state\.__currentCtx/.test(itemHead));
check('renderItemDetail bails safely on no ctx (no throw)', /if \(!ctx \|\| ctx\.itemId == null\)/.test(itemHead));
// The unguarded access must NOT come before the guard.
const guardIdx = itemHead.indexOf('if (!ctx)');
const accessIdx = itemHead.indexOf('ctx.itemTab');
check('renderItemDetail guard precedes ctx.itemTab access', guardIdx !== -1 && accessIdx !== -1 && guardIdx < accessIdx);

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
