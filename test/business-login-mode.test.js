// Locks in the corrected business-login model:
//  - A business login runs as a VIEW-ONLY bizContext session (behaves like the
//    owner's view of that one business: view everything, entries only on Balance,
//    no business creation) — NOT a full editor.
//  - The welcome splash is shown BEFORE the dashboard renders (no glitch where
//    the dashboard flashes first, then the welcome screen).
//
//   node test/business-login-mode.test.js
//
// app.js is a closure, so we assert against the source for the structural
// guarantees, plus a behavioral check of the gating helpers' intent.

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

let passed = 0, failed = 0;
function check(n, c) { if (c) { passed++; console.log('  \u2713 ' + n); } else { failed++; console.log('  \u2717 ' + n); } }

// Isolate enterSharedBusiness.
const esbStart = src.indexOf('async function enterSharedBusiness');
const esb = src.slice(esbStart, src.indexOf('\n  function subscribeShared', esbStart));

console.log('\nbusiness login = view-only bizContext session:');
check('enterSharedBusiness sets bizContext = biz.id (view-only scope)', /state\.bizContext\s*=\s*biz\.id/.test(esb));
check('does NOT null out bizContext (old full-editor model removed)', !/state\.bizContext\s*=\s*null/.test(esb));
check('still marks __sharedMode (cloud-backed) for sync', /state\.__sharedMode\s*=\s*true/.test(esb));
check('scopes activeBizId to the business', /state\.activeBizId\s*=\s*biz\.id/.test(esb));
check('business login display name is the business name, NOT "<name> team"', !/\+\s*' team'/.test(esb) && /name:\s*\(biz\.name\s*\|\|\s*'Business'\)/.test(esb));

console.log('\nno user-visible "team" wording for a business login:');
check('login() splash subtitle does not say "team"', !/\$\{bizById\(asBizId\)\?\.name\} team/.test(src));
check('switch-account list shows business name without " team"', !/name:\s*b\.name\s*\+\s*' team'/.test(src));
check('settings profile shows business name without " team"', !/bizCtx\.name\s*\+\s*' team'/.test(src));

console.log('\nlogin glitch fix (splash opaque instantly, shown before dashboard render):');
const splashFn = src.slice(src.indexOf('function showLoadingSplash'), src.indexOf('function hideLoadingSplash'));
check('splash forces opacity:1 immediately (no transparent fade-in)', /el\.style\.opacity\s*=\s*'1'/.test(splashFn));
check('splash no longer reveals via requestAnimationFrame fade', !/requestAnimationFrame\(\(\)\s*=>\s*el\.classList\.add\('visible'\)\)/.test(splashFn));

console.log('\nlogout fix — business login does NOT auto-re-login:');
const logoutFn = src.slice(src.indexOf('function logout'), src.indexOf('function logout') + 4200);
check('logout awaits Supabase signOut before reload', /await Promise\.race\(\[[\s\S]{0,140}Auth\.signOut\(\)/.test(logoutFn));
check('logout scrubs lingering auth token before reload', /auth-token\$?\/\.test\(k\)|removeItem\(k\)/.test(logoutFn));
check('reload happens inside the async IIFE (after signOut resolves)', /location\.reload\(\);[\s\S]{0,30}\}\)\(\);/.test(logoutFn));

console.log('\nwording — business name, not "Shared business" / "team":');
check('profile card label uses the business name, not hardcoded "Shared business"', !/section-label">Shared business</.test(src));
check('no "full app ... sync to everyone" wording in profile card', !/full app and your changes sync live to everyone/.test(src));

console.log('\nno orphaned entries — new owner items always get an assignment:');
check('no "Myself"/self-assign option (items assign to businesses only)', !/data-assign-self/.test(src) && /let assignSelf = false;/.test(src));
check('item save requires a business assignment', /toast\('Assign this to a business'\)/.test(src));

console.log('\nBALANCE: only the business login adds; owner is view-only on Balance:');
check('Balance "Add entry" button only shown to business login (canAddBalance = isViewOnly())', /const canAddBalance = isViewOnly\(\)/.test(src));
check('openBalanceModal refuses the owner (hard gate)', /Balance entries are added by the business login'\); return; \}/.test(src));
check('owner cannot EDIT Balance batches', /const canEditBatch = \(b\) => \{\s*if \(!isViewOnly\(\)\) return false;/.test(src));
check('owner CAN DELETE Balance batches (view + delete, no edit)', /const canDeleteBatch = \(b\) => \{\s*if \(!isViewOnly\(\)\) return true;/.test(src));
check('Cmd+N on Balance restricted to business login', /state\.items\.balance && isViewOnly\(\)\) openBalanceModal\(\)/.test(src));

console.log('\naccount switch — leaving a business (shared) session reloads cleanly (no stuck splash):');
const pas = src.slice(src.indexOf('function performAccountSwitch'), src.indexOf('function performAccountSwitch') + 2200);
check('performAccountSwitch handles __sharedMode by signing out + reloading', /if \(state\.__sharedMode\)/.test(pas) && /location\.reload\(\)/.test(pas));
check('shared switch awaits signOut before reload', /await Promise\.race/.test(pas));

console.log('\nview-only gating is driven by bizContext (so it behaves like owner business view):');
check('isViewOnly() is true when bizContext set', /function isViewOnly\(\)\s*\{\s*return\s*!!state\.bizContext/.test(src));
// The "New entry" button on list tabs is hidden when isViewOnly() — non-Balance
// tabs are owner-only for adding. Confirm that gate still exists.
check('list "New entry" button gated behind !isViewOnly()', /if \(!isViewOnly\(\)\) \{[\s\S]{0,200}tab-add-btn/.test(src));
check('Balance entry assigns to bizContext for the business user', /const targetBizIds = isBizUser \? \[state\.bizContext\]/.test(src));
// Businesses tab is owner-only and hidden for view-only sessions.
check('Businesses tab is ownerOnly (hidden for business logins)', /businesses:\s*\{[^}]*ownerOnly:\s*true/.test(src));

console.log('\nCONFIRMED — non-Balance tabs: only the OWNER adds (business login view-only there):');
// openItemModal (the create/edit path for ALL non-Balance tabs) must hard-return
// for a view-only session, so System/Games/Schedule/ID&Pass/custom can't be edited.
const oim = src.slice(src.indexOf('function openItemModal'), src.indexOf('function openItemModal') + 120);
check('openItemModal returns early for view-only (business login cannot add on non-Balance tabs)', /if \(isViewOnly\(\)\) return;/.test(oim));
check('Balance add path keyed on isViewOnly (business user)', /const isBizUser = isViewOnly\(\)/.test(src));

console.log('\nCONFIRMED REQ 2 — business login sees ALL data on ALL tabs of its business:');
// The member slice must NOT carry a tab-restriction, so every tab is visible.
const slice = fs.readFileSync(path.resolve(__dirname, '../supabase/shared-slice.js'), 'utf8');
const s2m = slice.slice(slice.indexOf('function sliceToMemberState'), slice.indexOf('function memberStateToSlice'));
check('sliceToMemberState leaves bizAllowedTabs EMPTY (no tab hidden)', /var bizAllowedTabs = \{\};/.test(s2m) && !/bizAllowedTabs\[biz\.id\]\s*=/.test(s2m));
// Nav + filter default to "all allowed" when there's no list.
check('isTabAllowed defaults to all tabs when no allowed list', /function isTabAllowed\(key\)[\s\S]{0,180}if \(!allowed\) return true;/.test(src));
check('isTabAllowedForBiz defaults to all tabs when no allowed list', /function isTabAllowedForBiz[\s\S]{0,160}if \(!allowed\) return true;/.test(src));

console.log('\nlogin glitch fix (splash before dashboard render):');
// In login(), showLoadingSplash must appear BEFORE setActive('notices').
const loginStart = src.indexOf('function login(name, email, asBizId)');
const loginBody = src.slice(loginStart, src.indexOf('\n  function recordBizDeviceLogin', loginStart));
const splashIdx = loginBody.indexOf('showLoadingSplash');
const setActiveIdx = loginBody.indexOf("setActive('notices')");
check('login(): showLoadingSplash present', splashIdx !== -1);
check('login(): splash shown BEFORE setActive(notices) renders dashboard', splashIdx !== -1 && setActiveIdx !== -1 && splashIdx < setActiveIdx);
const screenActiveIdx = loginBody.indexOf("screenMain.classList.add('screen-active')");
check('login(): splash shown BEFORE main screen becomes active', splashIdx < screenActiveIdx);

// enterSharedBusiness: same ordering (splash before setActive).
const esbSplash = esb.indexOf('showLoadingSplash');
const esbSetActive = esb.indexOf("setActive('notices')");
check('enterSharedBusiness: splash shown before dashboard render', esbSplash !== -1 && esbSetActive !== -1 && esbSplash < esbSetActive);

console.log('\nactivity log + owner real-time Balance (v63+):');
check('activity log skips "created" (only edits/deletes/restores logged)', /if \(action === 'created'\) return;/.test(src));
check('owner does NOT echo-push while applying a remote update (prevents missed live updates)', /!state\.__sharedMode && !\(typeof sharedApplyingRemote !== 'undefined' && sharedApplyingRemote\)/.test(src));
check('autoShareBusiness starts owner live sync after sharing (real-time without reload)', /__cloudShareOk = true;[\s\S]{0,320}startOwnerSharedSync\(\)/.test(src));
check('owner CAN delete Balance entries but cannot edit them', /canDeleteBatch = \(b\) => \{\s*if \(!isViewOnly\(\)\) return true;/.test(src) && /canEditBatch = \(b\) => \{\s*if \(!isViewOnly\(\)\) return false;/.test(src));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
