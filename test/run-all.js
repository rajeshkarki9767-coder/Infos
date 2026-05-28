#!/usr/bin/env node
// Runs all Infos shared-access test suites in sequence and reports a summary.
//   node test/run-all.js
const { execSync } = require('child_process');
const path = require('path');

const suites = [
  ['RLS isolation (pglite)', 'rls.test.js'],
  ['Adapter (mock Supabase)', 'adapter.test.js'],
  ['API handlers (create-member, delete-account)', 'api.test.js'],
  ['Slice helpers', 'slice.test.js'],
  ['Cross-tab sync round-trip', 'cross-tab-sync.test.js'],
  ['Persistence (cloud map/versions)', 'persistence.test.js'],
  ['Scroll preservation (Load more)', 'scroll-preserve.test.js'],
  ['Business login mode (view-only + glitch fix)', 'business-login-mode.test.js'],
  ['Detail-view ctx guard (v108 blank-page crash)', 'detail-ctx-guard.test.js'],
  ['End-to-end shared flow (pglite)', 'e2e.test.js'],
  ['DOM smoke (jsdom)', 'smoke.test.js'],
  ['Version (About ↔ SW match)', 'version.test.js']
];

let allOk = true;
for (const [label, file] of suites) {
  console.log('\n========================================');
  console.log('  ' + label);
  console.log('========================================');
  try {
    execSync('node ' + path.join(__dirname, file), { stdio: 'inherit' });
  } catch (e) {
    allOk = false;
    console.log('  !! suite FAILED');
  }
}
console.log('\n' + (allOk ? 'ALL SUITES PASSED' : 'SOME SUITES FAILED'));
process.exit(allOk ? 0 : 1);
