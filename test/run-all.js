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
  ['Account isolation (cross-account contamination P1)', 'account-isolation.test.js'],
  ['Storage per-account keying (db.js v177)', 'storage-account-keying.test.js'],
  ['Sync echo write-loop prevention', 'sync-echo-loop.test.js'],
  ['Shared refresh deferral (stale timer)', 'shared-refresh-deferral.test.js'],
  ['Entry link required by tab', 'entry-link-required.test.js'],
  ['Owner arrival sound (balance)', 'owner-arrival-sound.test.js'],
  ['Balance delete sound (both sides)', 'balance-delete-sound.test.js'],
  ['Account switch (passwordless session restore)', 'account-switch-session.test.js'],
  ['All-businesses reorder mirrors last biz filter (v208)', 'reorder-all-view.test.js'],
  ['View-only badge removed + null-safe (v208)', 'view-only-badge.test.js'],
  ['Balance new-entry name pre-fill (v209)', 'balance-prefill.test.js'],
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
