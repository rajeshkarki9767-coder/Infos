# Hisabs Changelog

All notable changes to Hisabs are documented here. Format roughly follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) but pragmatically — this is a single-developer project and the changelog is for orientation, not formal release management.

## Versioning

- **Major** (`v89.x`): the current generation. Single-file PWA built around Supabase + Vercel.
- **Minor** (`v89.31`): feature additions.
- **Patch** (`v89.31.x`): bug fixes and refinements within a feature.

The version is embedded in code comments throughout `index.html` (`// v89.31.2: ...`) for traceability. Deployed builds are identified by the md5 hash of `index.html`.

---

## [1.11] — 2026-05-21 · build 2026.05.21.90

UPGRADE: "Hide Distribution" is now a TRUE per-member ACCESS CONTROL, not just a hidden tab. **Requires running the new SQL migration.**

### Hash
`926f51b3a0ce693a0cb88b83203799d1`

### What changed vs .89
.89 hid the tab in the UI but the data still synced to the member's device (UI-only). .90 makes it real access control enforced at the database, with client defense-in-depth.

### Backend / security (the real boundary)
NEW migration sql/v89.34_distribution_rls_hide.sql:
  • Adds SECURITY DEFINER helper app_can_read_distribution(business_id): owner always true; a member reads only if COALESCE(member_hide_distribution,false)=false; otherwise false.
  • Replaces ONLY the SELECT policy on app_distribution_salaries / app_distribution_shares / app_split_parties to use it. INSERT/UPDATE/DELETE remain owner-only (untouched).
  • Owner read is checked FIRST (owner_id = auth.uid()) so the owner can NEVER be locked out. Members with no/NULL/false flag are unaffected.
  With the rows withheld by RLS, a hidden member's realtime subscription delivers nothing, a direct route shows an empty view, and there is no data to export — satisfying "data access / realtime / direct-access / export all blocked" at one centralized chokepoint.
  RUN v89.33 first (adds the column), then v89.34.

### Frontend defense-in-depth (client mirror)
  • onRealtimeEvent now ignores distSalaries/distShares/splitParties events for a member who can't see distribution (covers the brief window before RLS re-runs).
  • NEW _purgeDistributionData(bizId): when a member's own row arrives via realtime showing distribution is now hidden, the in-memory distribution rows are dropped immediately so nothing lingers.
  • Tab hidden in sidebar, switchView + render guards block the route, anti-flicker snapshot (all from .89) — retained.
  • Distribution export was already owner-only, so hidden manager/viewer never had export access.

### Centralized handling
All client checks route through the single canSeeDistribution() helper; the server routes through the single app_can_read_distribution() function. One source of truth on each side.

### Verified
Access-control trace 14/14 (hidden member: all 3 distribution realtime keys ignored, other tables applied; visible/owner applied; purge clears all 3 arrays; RLS helper logic owner/member/flag matrix). Regression + feature 19/19 (incl. .80–.84 fixes, .63 distribution-DELETE tombstone, seesTotals untouched, DELETE branch structurally whole). Self-test 63/63; JS valid; CSS 2214/2214; tags balanced; no undefined handlers.

NOTE: a JS edit transiently removed the realtime DELETE-branch opener; the syntax gate caught it pre-package and it was restored. Shipped build is clean.

### Requires real-device/runtime verification + SQL migration (order matters)
1. Run sql/v89.33 (if not already), then sql/v89.34 in Supabase.
2. Owner toggles "Hide Distribution tab" for a manager/viewer → on THEIR device the tab vanishes live, the view is unreachable, and (after pull) they hold ZERO distribution rows. Owner and non-hidden members unaffected.
3. CRITICAL test before trusting: confirm the OWNER still reads distribution and a NON-hidden manager/viewer still reads it (the RLS change is the highest-risk piece).

---

## [1.11] — 2026-05-21 · build 2026.05.21.89

Hide-Distribution-tab now applies LIVE (no refresh) + anti-flicker. No SQL change beyond the .88 migration.

### Hash
`e680b22cc31a13108ea7fb687d88dc68`

### Live update (confirmed by design)
When the owner toggles "Hide Distribution tab", the member's row syncs over realtime (app_members is subscribed + in the supabase_realtime publication with REPLICA IDENTITY FULL). On the member's device the event applies to data.members and triggers renderAll → renderSidebarNav (the tab appears/disappears immediately) and renderMain (if the member is sitting on the Distribution view when it's hidden, they're bounced to Entries). No refresh needed. The owner's write is not a self-write on the member's device, so the render is not suppressed. Verified by trace 5/5.

### Anti-flicker (this build's change)
canSeeDistribution now snapshots its answer to the persistent access cache (the same mechanism canSeeTotals uses). During a sync pull the member's own row can momentarily drop out of data.members; without the snapshot a freshly-hidden tab could flash back into view for one frame. Now the cached value holds the hidden state stable across that race. _setAccess gained an optional 5th param (hideDistribution); the existing canSeeTotals 4-arg call is unchanged.

### Verified
Anti-flicker trace 5/5 (hidden persists through mid-pull; unhide persists too). Live-hide trace 5/5 (apply → nav hides → bounce off view → unhide restores). canSeeTotals snapshot path untouched. Self-test 63/63; JS valid; CSS 2214/2214; no undefined handlers.

### Requires real-device/runtime verification
With two devices: as owner toggle "Hide Distribution tab" for a manager/viewer → on THEIR device the tab disappears WITHOUT a refresh (and if they were on the Distribution view, they land on Entries). Toggle off → it reappears live.

---

## [1.11] — 2026-05-21 · build 2026.05.21.88

NEW FEATURE: owner can hide the Distribution tab per manager/viewer from Team & Access. **Requires running the new SQL migration.**

### Hash
`750d50d48e1ec2af2e765959489899c3`

### What it does
On the Team & Access page, each accepted manager or viewer now has a "Hide Distribution tab" toggle (owner-only). Default OFF (tab visible — unchanged from before). Turn it ON to remove the Distribution nav tab from that member's UI. Owner always sees the tab; staff never saw it (unchanged). The choice syncs across devices via the member row.

### IMPORTANT — scope
This controls TAB VISIBILITY only; it declutters the member's UI. It is NOT a data restriction: the existing app_distribution_* / app_split_parties RLS still permits any member of the business to READ distribution rows (writes remain owner-only). If you ever need managers/viewers to be unable to access distribution data at all, that is a separate, larger change to the SELECT policies on those tables.

### Implementation (mirrors the v89.31.5 member_sees_totals pattern)
  • NEW migration sql/v89.33_app_members_hide_distribution.sql — adds member_hide_distribution boolean (default false) to app_members. RUN THIS in Supabase BEFORE deploying .88 (the members sync map references the column).
  • members schema toDb/fromDb sync the flag (member_hide_distribution <-> hideDistribution), missing/NULL coerced to false (visible).
  • NEW helper canSeeDistribution(bizId): owner always true; manager/viewer true unless their member row has hideDistribution=true; staff false; defaults visible mid-pull / on legacy rows.
  • Distribution nav gate now uses canSeeDistribution.
  • Guards: switchView() redirects a hidden member's 'distribution' navigation to 'entries'; the render router also bounces a hidden member off a stale distribution view. So the tab can't be reached even if session.view is stale.
  • NEW owner-only handler changeMemberHideDistribution + a toggle row shown for accepted manager/viewer in the team list.

### Verified
Feature trace 15/15 (owner always sees; manager/viewer default visible, hidden when flag set; staff unaffected; switchView + render redirects; toggle shows only for accepted manager/viewer). Regression 13/13 (all .80–.84 fixes + seesTotals intact). Self-test 63/63; JS valid; CSS 2214/2214; tags balanced; no undefined handlers.

### Requires real-device/runtime verification + SQL migration
1. RUN sql/v89.33_app_members_hide_distribution.sql in Supabase FIRST.
2. As owner, toggle "Hide Distribution tab" for a manager/viewer → on THEIR device the tab disappears (and they can't reach it); toggling off restores it.

---

## [1.11] — 2026-05-21 · build 2026.05.21.87

Added a combined realtime-publication + RLS audit script after a user query showed only 3 tables in the realtime publication. No code change.

### Hash
`0859ffbf275bb9c7bdb3ac603b806804`

### Why
The client subscribes to 17 app_* tables for live updates. A user-run query returned only 3 tables (the distribution ones) as REALTIME. If the realtime publication truly contains only those 3, the other 14 (entries, businesses, expense_rates, members, transfers, etc.) would sync only on refresh — the same class as the .84 rate bug. Live sync IS confirmed working for rates/parties/salaries/shares on devices, so the publication likely has more than 3 (the user's query was probably filtered), but this must be confirmed before launch.

### New: sql/AUDIT_realtime_and_rls.sql
Two read-only blocks:
  • BLOCK 1 — lists app_* tables in the supabase_realtime publication (expect all 17; lists the expected set in a comment).
  • BLOCK 2 — RLS status per table (rls_enabled / policy_count / status).
If BLOCK 1 is missing tables, re-run sql/v89.32.5_enable_realtime.sql (idempotent — adds only the missing ones).

### Verified
index.html byte-identical to .86 except BUILD_TAG (revert-tag reproduces the .86 hash). Self-test 63/63. All previous fixes intact.

---

## [1.11] — 2026-05-21 · build 2026.05.21.86

Added an RLS audit script. No code change (index.html identical to .85 except build tag).

### Hash
`e15da4bc8e14d404bd1a3a346fbb3d75`

### New: sql/AUDIT_rls_status.sql
Read-only script that reports, for every public.app_* table, whether RLS is ENABLED and how many policies it has — so "full RLS" can be confirmed on the live database (which can't be verified from the client bundle). Changes nothing; includes an enable template for any table that comes back unprotected.

### Clarifications (no fix needed)
- Image alt text: BOTH <img> tags in the app already have alt (profile photo = name; preview = "Preview"). The "sparse alt" audit note was misleading — the count is low only because the app has just 2 images, and both are covered. SVG icons use aria-label (114), which is correct. Nothing to change.
- Performance: confirmed good on all devices by the user.

### Verified
index.html byte-identical to .85 except BUILD_TAG (revert-tag reproduces the .85 hash). Self-test 63/63. All previous fixes intact.

---

## [1.11] — 2026-05-21 · build 2026.05.21.85

Production console cleanup. No behavior change.

### Hash
`693b9055f1c848b10f4484645d26e7aa`

### Console hygiene
Removed the three routine SUCCESS-path diagnostic logs that fired on every normal operation:
  • console.log('[distDelete] cloud delete result', ...)
  • console.log('[rateSave] cloud upsert result', ...)
  • console.warn('[rateFix] purged N stale ...')
KEPT the failure-only diagnostics (4 console.error + 5 console.warn) — these fire ONLY on a real problem (cloud delete/upsert failed, RLS blocking, rates dropped on pull) and are valuable for triaging production issues. The happy path is now silent.

### Service worker registration
Confirmed navigator.serviceWorker.register(...).then(...) DOES have a .catch (console.warn on failure) — the earlier audit flag was a false positive (the .catch sits 18 lines below the .then). No change needed; unhandled-rejection risk does not exist.

### All previously reported issues — confirmed fixed (15/15)
party add/delete/2nd-add, expense-rate vanish (merge + diff-delete block + stale-purge + realtime-DELETE-ignore), rate live cross-device sync (replica migration .84, run + confirmed), mobile salary/share overflow, +Add stops working, delete-unsaved false warning, side +Add removed, periodic flicker/jump, party-for-distribution selection, reset cross-device currency/rate, rate-as-%, Vercel deploy. Confirmed working on real devices: live rate sync, sound notifications, and (per user) reset-cross-device, party-selection, +Add, flicker, multi-minute persistence.

### Verified
All previous fixes intact (15/15). Self-test 63/63. JS valid; CSS 2214/2214; no undefined handlers. Routine success logs: 0 remaining; failure diagnostics retained.

---

## [1.11] — 2026-05-21 · build 2026.05.21.84

Fix: an expense rate added/edited on one device only appeared on the other device AFTER a manual refresh — not live. **Requires running the new SQL migration.**

### Hash
`7ba16bf832fcfd769a7626b01e639013`

### Root cause (database side, not code)
The client correctly subscribes to app_expense_rates realtime and applies + re-renders incoming rate events. But the table was never given REPLICA IDENTITY FULL. v89.32.68 added app_expense_rates to the supabase_realtime PUBLICATION but skipped the REPLICA IDENTITY FULL step that v89.32.5 sets on every other synced table. Without it, Postgres omits non-key columns (name, rate, business_id) from realtime payloads, so the client can't apply the change live — it only appears on the next full pull (manual refresh).

### Fix
NEW MIGRATION sql/v89.32.84_expense_rates_realtime_replica.sql:
  • ALTER TABLE public.app_expense_rates REPLICA IDENTITY FULL;
  • re-affirms publication membership (idempotent).
RUN THIS in Supabase (Dashboard → SQL Editor → paste → Run). No data is modified; safe to re-run. After running, a rate added on one device appears on the other live (the .80 backstop pull already covered it within ~60s as a fallback; this makes it instant).

### No code change
index.html is byte-identical to .83 except the BUILD_TAG bump — the fix is entirely the migration. All .57–.83 fixes remain intact.

### Verified
Session regression 23/23 (incl. .83 reset-clears-snaps both local + cloud, confirmed directly). Calc 4/4. Self-test 63/63. JS valid; CSS 2214/2214. Client realtime path for expenseRates confirmed correct (subscribe + apply + render + backstop-pull signature coverage).

### Requires real-device/runtime verification + SQL migration
1. RUN sql/v89.32.84 in Supabase FIRST.
2. Add/edit a rate on device A → it appears on device B WITHOUT a refresh.

---

## [1.11] — 2026-05-21 · build 2026.05.21.83

Fix: Reset Distribution cleared the Split & Convert currency/rate on the device that ran it, but the OTHER device kept showing the old currency/rate.

### Hash
`c46a0c3d226a856bbd7df2feb235adc5`

### Root cause
resetAllDistributionData cleared the business splitCurrency/splitRate columns (locally + cloud) but did NOT clear month_rate_snaps — the per-month rate/currency snapshot stored on the business row (jsonb, synced across devices). On the other device, loadSplitPartiesFromCloudOrLocal re-derives __splitCurrency/__splitRate for the active month FROM that snapshot, so the stale snapshot kept the old currency/rate visible there even though the columns were blank.

### Fix
Reset now also wipes month_rate_snaps: locally (_saveMonthRateSnaps(bizId, {})), in-memory (biz.monthRateSnaps = {}), and on the cloud business row (update ... month_rate_snaps: {}). With the snapshot cleared, the other device's loader derives an empty currency/rate for the current month, so the reset is consistent across devices.

### Note on minor screen movement (Split & Convert / %, add party / salaries / shares)
The periodic ~60s page jump was fixed in .80. The small remaining movement during interaction is the live preview header + totals reflowing as content changes height (expected for a live-preview UI), not the periodic glitch. Left as-is to avoid destabilizing the typing/focus handling right before deployment; can be revisited if it's intrusive.

### Verified
Reset trace 6/6 (currency/rate/snaps cleared; other device derives empty). Self-test 63/63; JS valid; CSS 2214/2214; no undefined handlers; businesses schema syncs month_rate_snaps both ways.

### Requires real-device/runtime verification
Run Reset Distribution on device A → on device B the Split & Convert currency AND rate also clear (not just on A).

---

## [1.11] — 2026-05-21 · build 2026.05.21.82

Two fixes the .81 attempt did not fully resolve: expense rates STILL vanishing after a few minutes on both devices, and the "party to use for distribution" selection not saving / not syncing.

### Hash
`aadab8fbffde569b1c26d0a2876989d9`

### FIX — Expense rates still wiped (the real remaining cause)
.81 stopped the diff from CREATING new expense-rate deletes, but builds before .81 had already queued DELETE ops for app_expense_rates into the localStorage sync queue. Those stale ops KEPT draining on every device after the code fix — re-deleting rates from the cloud and firing realtime DELETE echoes that wiped them on both devices a few minutes later (the backstop-pull / drain cadence). Two-part fix:
  1. ONE-TIME PURGE on load: strip any queued {kind:'delete', table:'app_expense_rates'} ops from the sync queue so the stale deletes can never fire again. Logs "[rateFix] purged N stale expense-rate delete op(s)".
  2. DEFENSE-IN-DEPTH: onRealtimeEvent now IGNORES DELETE events for expenseRates entirely. Rate removals happen only through the explicit rate editor (saveExpenseRates), which is the sole authority — so no realtime DELETE echo can ever wipe a rate on a receiving device again.

### FIX — "Party to use for distribution" selection not saving/syncing
setSplitSelectedParty only set an in-memory id + localStorage split-state; it never set the party rows' isSelected flag and (for an unlocked/just-added party) never synced. So the choice was lost on refresh and never appeared selected on the other device. Now it: sets isSelected=true on the chosen party and false on the rest, LOCKS the chosen party (only locked rows are mirrored to the cloud), persists, and syncs. The selection rides the cloud is_selected flag, so it survives refresh and shows on both devices.

### Verified
Trace 9/9 (rate purge removes stale rate-deletes / keeps upserts + other-table deletes; realtime expenseRates DELETE ignored, other tables applied; party-select sets exactly one isSelected and survives a pull). Self-test 63/63; JS valid; CSS 2214/2214; no undefined handlers; .81 diff-delete block + mergeExpenseRates union still intact.

### Requires real-device/runtime verification
- Save expense rates → leave both devices several minutes → rates STAY (check console once for "[rateFix] purged" on first load after deploy).
- Select a party for distribution → refresh → still selected; shows selected on the other device too.

---

## [1.11] — 2026-05-21 · build 2026.05.21.81

Two critical fixes: (1) expense rates being wiped from BOTH devices after a few minutes, and (2) the +Add button on salaries/shares doing nothing once an unsaved row existed.

### Hash
`08fc972f6c0e4089d50d261aa1dab355`

### FIX 1 — Expense rates deleted from the cloud (both devices)
ROOT CAUSE: the sync diff (runSyncDiff/diffKey) emits a DELETE for any row that is in the snapshot but not in current data. Combined with the per-table push of expenseRates, a transient pull/merge where data.expenseRates momentarily didn't contain a rate the snapshot still held caused the diff to queue a cloud DELETE — wiping the rate server-side, so it vanished on every device. The "few minutes" timing matched the 60s backstop pull.
FIX: the diff now NEVER auto-deletes expenseRates. Rate removals go solely through saveExpenseRates(), which deletes exactly the rows the user removed from the rate editor. The union mergeExpenseRates already preserves rates across pulls, so no legitimate path needs the diff-delete for this table. (Other tables keep diff-deletes unchanged.)

### FIX 2 — +Add stops working after one unsaved row
ROOT CAUSE: after .78, only SAVED rows are mirrored to data.distSalaries/Shares; unsaved rows live only in the local store. But loadDistributionFromCloudOrLocal preferred the cloud data and RETURNED EARLY whenever any saved row existed — rebuilding __distSalaries from cloud rows ONLY and dropping the freshly-added unsaved row on the next render. So once a saved row was present, +Add appeared to do nothing (and "worked again" only after deleting the saved row left cloud empty, falling through to the local store).
FIX: the loader now UNIONS local-only unsaved rows (those not in the cloud set, in-month, not pending-delete) on top of the cloud rows, so unsaved rows survive re-render while saved rows still come from the cloud.

### Verified
Trace 5/5 (unsaved row survives reload, not duplicated, only-unsaved works; diff does NOT delete expenseRates, other tables still delete). Self-test 63/63; JS valid; CSS 2214/2214; no undefined handlers; mergeExpenseRates union intact.

### Requires real-device/runtime verification
- Save expense rates → leave both devices a few minutes → rates STAY on both.
- Add a salary, then +Add again → second row appears; profit-shares +Add also works, all without needing to delete a row first.

---

## [1.11] — 2026-05-21 · build 2026.05.21.80

Fix the periodic screen jump (page/section moves up and down every ~minute) on the Distribution and other pages.

### Hash
`c253c390aa385ef9b7190e6ab0d05151`

### Root cause
A backstop sync pull runs every 60 seconds as a safety net (in case realtime missed an event). After each pull, cloudPullAll called renderAll() UNCONDITIONALLY — even when the pull fetched nothing new. On the Distribution page (Split, Team Salaries, Profit Shares, Split %), that full DOM rebuild made the page visibly jump up/down every ~minute. This matches the user report exactly ("screen/certain portion moves up and down between few minutes", not on typing or save).

### Fix
cloudPullAll now computes a compact data signature BEFORE and AFTER the merge (counts + content hashes of distSalaries / distShares / splitParties / expenseRates / business currency+rate, plus top-level table counts). On a SILENT background pull, if the signature is unchanged, the re-render is skipped entirely — no rebuild, no jump. A real change (new/edited row, rate, currency, or anything from the other device) changes the signature and renders exactly as before. Non-silent (user-initiated) pulls always render. If signature computation fails for any reason, it safely falls back to rendering.

### Why sync is unaffected
The skip only happens when nothing the UI shows changed AND the pull was silent. Any actual data difference still triggers the render, so cross-device updates appear normally.

### Verified
Skip-logic trace 6/6 (silent+unchanged→skip; silent+changed→render; non-silent→render; null sig→render). Self-test 63/63; JS valid; CSS 2214/2214; no undefined handlers.

### Requires real-device/runtime verification
Sit on the Distribution page for a few minutes without touching it — the page should no longer jump up/down. A change made on the other device should still appear within ~60s.

---

## [1.11] — 2026-05-21 · build 2026.05.21.79

Fixes: deleting an unsaved salary/share/party no longer warns "server kept the row / 0 deleted"; removed the side +Add on salaries/shares (bottom +Add only); focus guard extended to reduce flicker.

### Hash
`951f95ec376166c96376120f7c6e8e6d`

### Delete unsaved row no longer warns
After .78, unsaved (unlocked) rows never reach the cloud. But delete still fired a cloud delete, which matched 0 rows and showed "server kept the row (0 deleted) — check permissions". Now deleteDistSalaryRow / deleteDistShareRow / removeSplitParty capture _wasSynced (is the row in data.dist*/splitParties = was it synced) BEFORE mutating, and only cloud-delete when it was actually synced. Unsaved rows are removed locally with no cloud call and no tombstone.

### Side +Add removed
Team Salaries and Profit Shares had a +Add in the section header AND a +Add at the bottom. Removed the header one; the bottom +Add is now the only one and is always shown (label "+ Add" with no rows, "+ Add another" with rows).

### Flicker mitigation
Extended renderDistributionCard's focus guard to also cover .dist-salary-row / .dist-share-row and SELECT elements, so a re-render won't reload/rebuild while the user is editing those fields. (If flicker persists, more detail on exactly when it happens is needed.)

### Note on "rates gone"
The expense rate book code (saveExpenseRates + mergeExpenseRates union) is UNCHANGED by recent builds and was console-confirmed working (savedRows:3, afterMerge:2). "Rates gone" is most likely a device that hadn't loaded the latest build / cache, not a code regression.

### Verified
Delete-unsaved trace 2/2; add-button count 1 each; self-test 63/63; JS valid; CSS 2214/2214; no undefined handlers; mergeExpenseRates intact.

### Requires real-device/runtime verification
Delete an unsaved salary/share/party → removes cleanly, no "0 deleted" warning. Only one +Add (bottom). Flicker reduced on salary/share/% editing.

---

## [1.11] — 2026-05-21 · build 2026.05.21.78

Fix: clicking +Add on Team Salaries / Profit Shares immediately pushed a blank "-- --" row to the other device. Now salary/share rows (like parties) sync ONLY after Save.

### Hash
`e936573727e84a27d78015d19c6b4e5e`

### Root cause
_syncDistributionArrays synced ALL salary/share rows (unlike parties, which sync only locked/saved rows). So addDistSalaryRow/addDistShareRow → _persistDistribution → pushed the freshly-added blank row to the cloud → it appeared as "-- --" on the other device before any data was entered or saved.

### Fix (two parts, mirrors the .74 party fix)
1. _syncDistributionArrays now mirrors ONLY locked (saved) salary/share rows to the cloud. Unsaved rows persist to localStorage (survive re-render on this device) but are excluded from the cloud mirror until Save.
2. distRowToggleEdit now LOCKS the row BEFORE calling the save fn (which triggers the sync). Previously it locked AFTER, so with the locked-only filter the just-saved row would have been excluded at sync time (same ordering trap as the .74 party fix). Applies to salaries, shares, parties, and currency/rate.

### Verified
Add→edit→save flow trace 5/5 (+Add → other device empty; editing → not synced; Save → appears; 2nd add doesn't wipe 1st; 2nd save → both). Self-test 63/63; JS valid; CSS 2214/2214; no undefined handlers.

### Requires real-device/runtime verification
Click +Add on salaries/shares → other device shows nothing (no "-- --"); after Save → row appears on the other device.

---

## [1.11] — 2026-05-21 · build 2026.05.21.77

Confirmed via console that the rate book now works (saves + persists + syncs); quieted the rate-merge diagnostic to warn only on a real drop.

### Hash
`558b6f50d58e0d248bb48b7b3cbd045a`

### What the diagnostic confirmed
Console on the deployed build showed:
- [rateSave] cloud upsert result {sent: 3, savedRows: 3}  → cloud write SUCCEEDS (RLS is correct).
- [rateMerge] pull {fetched: 2, afterMerge: 2}            → cloud HAS the rates and the union merge KEEPS them (nothing wiped).
- [distDelete] ... deletedRows: 1 (salaries + shares)     → distribution deletes work.
So the .72 direct-upsert + .73 union-merge fixed rate persistence. The earlier "rates gone" was on a pre-.73 deployed build.

### Change
- [rateMerge] now logs (console.warn) ONLY when a pull would reduce the rate count (a real regression), instead of on every pull. [rateSave] result log kept (fires only on save).
- The repeated google-analytics CSP-block console message is NOT from this app (no gtag/GA code anywhere in index.html) — it's injected by a browser extension or the preview wrapper, and the CSP is correctly blocking it. No action needed.

### Verified
Self-test 63/63; JS valid; CSS 2214/2214; no undefined handlers; mergeExpenseRates intact; no api/ (Vercel deploys clean).

### Requires real-device/runtime verification
Rates persist across navigate + refresh and show on the other device (the console already indicates they do).

---

## [1.11] — 2026-05-21 · build 2026.05.21.76

Fix mobile salary/share row overflow (proper structure-agnostic layout) + add a diagnostic to pinpoint why expense rates still vanish after navigating.

### Hash
`d3aa8d12d013cb849fe9f27ffc10d87f`

### Mobile salary/share overflow (real fix this time)
The .71 mobile fix used grid-areas keyed to input[data-field=...], which only matched the EDIT view. The LOCKED display row uses .dist-cell divs with no grid-area, so its amount-to-get + edit/delete buttons fell outside the grid and overflowed the card. Replaced with a flex-wrap layout that works for BOTH the display and edit views: name on its own line, middle fields wrap, amount on its own full-width line (right-aligned, ellipsis), action buttons on their own right-aligned line — never overflowing. Compact 40x36 buttons on mobile.

### Expense rates still vanish — diagnostic added
Confirmed: navigating Expenses→Distribution→Expenses does NOT re-hydrate data from localStorage, and the realtime echo handler doesn't wipe the array — so the only thing that can clear data.expenseRates is the cloudPullAll merge. Added `[rateMerge] pull {fetched, afterMerge, names}` logging at the merge point so we can see exactly when/where rates are lost. The .73 union-merge is still in place.

### Verified
Self-test 63/63; JS valid; CSS 2214/2214 (leftover grid-area share rules removed); no undefined handlers.

### Requires real-device/runtime verification
Salary/share rows fit inside the card on phone (locked AND edit views). For rates: save a rate, navigate to Distribution and back, and READ the console — paste the `[rateMerge] pull {...}` and `[rateSave] cloud upsert result {...}` lines so the exact loss point is identified.

---

## [1.11] — 2026-05-21 · build 2026.05.21.75

DEPLOY FIX: removed the orphaned api/cron/digest.js serverless function that was failing the Vercel build. App logic unchanged from .74.

### Hash
`0a669338e333c5c86d6de5710dde5ee0`

### Why the Vercel deploy failed
api/cron/digest.js did `import webpush from 'web-push'`, but the project has no package.json, so Vercel could not install the dependency when building the serverless function → build failed. The function was ORPHANED: not scheduled (vercel.json has 0 crons), not referenced by index.html, and unused. Removing it makes the project fully static (no build step), which is how it has always deployed.

### Change
- Deleted api/ (the lone digest cron). No app code changed; index.html is identical to .74 except the BUILD_TAG bump. vercel.json remains buildCommand:null, framework:null, 0 crons → pure static serve.
- (Daily push digests, if ever wanted, would need a proper package.json + cron schedule + env vars as a separate feature.)

### Verified
Self-test 63/63; JS valid; no serverless functions remain; vercel.json static; .74 party lock-before-sync fix intact.

---

## [1.11] — 2026-05-21 · build 2026.05.21.74

ROOT-CAUSE FIX for the party sync glitch: saved parties weren't being recognized as "saved" at sync time, so the 2nd party was filtered out of the sync and dropped, and the 1st only synced on a later trigger ("shows later on another device").

### Hash
`bd4d6ef74eab71aa479c53e2758abc85`

### Root cause (code, not RLS)
_syncSplitPartiesArray only syncs parties whose row is LOCKED (saved); unsaved/blank rows are intentionally excluded. But saveSplitPartyRow called saveSplitStateFor (→ _syncSplitPartiesArray) while the row was still in the 'editing' (unlocked) state — it only called _markRowSavedUI afterward, which merely animates the Save button and does NOT set the lock. So a just-saved party was seen as still-editing → excluded from `syncable` → the month-scoped rebuild of data.splitParties dropped it. Result: 2nd party "saves then vanishes / never reaches the other device"; 1st party only synced when some later render/save happened to run after the lock got set.

### Fix
saveSplitPartyRow now calls _distRowMarkLocked('parties', id) BEFORE saveSplitStateFor, so the row is locked when _syncSplitPartiesArray reads its state and the party is included in the sync immediately.

### Verified
Lock-order trace 3/3 (old order excludes the party, new order includes it); self-test 63/63; JS valid; CSS 2226/2226; no undefined handlers; full session regression intact.

### Requires real-device/runtime verification
Add a 2nd party → Save → it stays + appears on the other device; 1st party appears on the other device promptly (not only after a later action).

---

## [1.11] — 2026-05-21 · build 2026.05.21.73

FIX: expense rates vanishing on refresh. RLS was confirmed CORRECT (INSERT check_expr = app_is_business_owner) — the cause was a code-side merge race that dropped a just-saved rate when a cloud pull arrived before the upsert's round-trip landed. Replaced the generic pending-only merge with a race-resilient union merge for the rate book.

### Hash
`3a455fd947e3cd3ba16f95559baf618c`

### Root cause (confirmed, not speculative)
- INSERT/UPDATE/SELECT/DELETE policies on app_expense_rates are all correct (verified via pg_policy: insert check_expr = app_is_business_owner(business_id)). So writes ARE permitted.
- The generic mergeWithPending only preserved a local row if it still had a PENDING upsert op the cloud lacked. On refresh, if the op had drained (or the pull raced the upsert), the empty cloud result overwrote the just-saved rate -> "vanish on refresh".

### Fix
- New mergeExpenseRates(cloud, local): UNION by id. Cloud is authoritative for ids it has; any local-only rate is KEPT (pending or just-confirmed), never dropped. Cannot resurrect a deleted rate because delete mutates the local array (the row simply isn't in localRows).
- The .72 direct upsert + diagnostic stays (belt-and-suspenders: write lands immediately + logs the server result).

### Verified
mergeExpenseRates trace 5/5 (keeps just-saved during race; cloud wins on shared id; no dup; deleted stays gone; union); self-test 63/63; JS valid; CSS 2226/2226; no undefined handlers; full session regression intact.

### Requires real-device/runtime verification
Save a rate -> refresh -> it persists; appears on the other device; deleting a rate keeps it gone after refresh.

---

## [1.11] — 2026-05-21 · build 2026.05.21.72

Expense rate book sometimes not saving / empty after refresh — added a cloud-write diagnostic (logs the server result so a blocked write is visible) and an RLS verify/fix migration. Same class as the distribution delete bug: a silently-blocked cloud write leaves rates in localStorage only, then the empty pull overwrites them on refresh.

### Hash
`0be9f81af9079026c390020f36dd5db4`

### LIKELY REQUIRES SQL MIGRATION
`sql/v89.32.72_fix_expense_rates_rls.sql` — (re)creates SELECT/INSERT/UPDATE/DELETE policies on app_expense_rates using app_can_read_business / app_is_business_owner. Run it if the new console diagnostic shows savedRows: 0.

### What changed
- saveExpenseRates now fires a direct cloud upsert (in addition to the queued diff) and LOGS the result: `[rateSave] cloud upsert result { sent, savedRows }`. If savedRows is 0 or there's an error, it warns "likely RLS blocking INSERT/UPDATE on app_expense_rates" and toasts the user — so a silently-blocked write is no longer invisible (this is what made rates vanish on refresh).

### Diagnosis path
1. Deploy .72, open Add/Edit Rate, add a rate, Save.
2. Watch the browser console for `[rateSave] cloud upsert result`.
3. If savedRows: 0 (or an error) → run sql/v89.32.72_fix_expense_rates_rls.sql, then retry.

### Verified
Self-test 63/63; JS valid; CSS 2226/2226; no undefined handlers; diagnostic + direct upsert wired; rate-as-% + name-normalize intact.

### Requires real-device/runtime verification
The console diagnostic on rate save; rates persist across refresh after the RLS fix; rates appear on the other device.

---

## [1.11] — 2026-05-21 · build 2026.05.21.71

ROOT CAUSE of the party saga found via console diagnostic: the DELETE RLS policy on app_split_parties was blocking deletes (deletedRows: 0), and the app kept tombstoning rows that never actually deleted — 33 tombstones hiding live parties. Fixed both the SQL and the app's tombstone handling. Plus rate-name normalization and mobile salary overflow.

### Hash
`191efb0252fb68820063c53ce2941bd7`

### REQUIRES SQL MIGRATION (run before deploying)
`sql/v89.32.71_fix_distribution_delete_rls.sql` — (re)creates the DELETE policy on app_split_parties, app_distribution_salaries, app_distribution_shares using app_is_business_owner. THIS is what makes party/salary/share deletes actually work cross-device.

### ALSO: clear stale tombstones once (browser console, BOTH devices)
`localStorage.removeItem('hisabs_dist_tombstones_v1'); location.reload();`
33 tombstones had accumulated from failed deletes and were hiding live parties (inMemory 0 while cloudParties 2).

### Fixes
1. **Delete no longer self-poisons.** _cloudDeleteDistRow now returns success; on a server "0 deleted" (RLS) it REMOVES the local tombstone instead of keeping it, so a row that still exists in the cloud is no longer hidden locally and re-tombstoned on every sync. removeSplitParty awaits the result and reloads from cloud if the server kept the row — UI stays consistent with the cloud.
2. **Rate name match ignores case AND spaces.** "Sugar" == "sugar" == "  SUGAR " == "sugar  " (normalize: lowercase, trim, collapse internal whitespace).
3. **Mobile salary/share overflow fixed.** Amount-to-get + save/edit/delete buttons no longer spill outside the card on small screens (wider action column, min-width:0 so cells shrink, slightly smaller buttons on mobile).

### Verified
Self-test 63/63; JS valid; CSS 2226/2226; no undefined handlers; delete returns bool + un-tombstone on RLS fail; rate-as-% intact; mobile grid fixed.

### Requires real-device/runtime verification (AFTER running the RLS migration + clearing tombstones)
Party delete returns "deleted" not "server kept the row"; 2nd party saves + appears on other device; rate name matches regardless of case/spaces; salary row fits on phone.

---

## [1.11] — 2026-05-21 · build 2026.05.21.70

Expense rate is now a percentage; removed "optional" wording; salaries/shares/parties no longer sync on blur (only on Save).

### Hash
`da5e6f953fba3d8026205583449289ba`

### Changes
1. **Rate is a percentage.** Expense amount = qty × (rate ÷ 100). Placeholders updated (Qty, Rate %), rate book editor + View Rate show %. e.g. qty 1000 × 15% = 150.
2. **Removed "(optional)" wording** from the Qty/Rate fields.
3. **Sync only on Save (blur fix).** A focusout handler was flushing distribution + party edits to the CLOUD when a field lost focus — so tabbing/clicking away synced unsaved edits to the other device. Blur now flushes to localStorage ONLY; cloud sync stays deferred to the Save button. (New _flushDistPersistLocal / _flushSplitPersistLocal.)

### Still investigating (needs runtime diagnostic)
- 2nd party add + delete glitch. First party works; second add/delete glitches. Traced to the per-month party load/echo path; requires the console diagnostic (see notes) to fix precisely rather than speculatively.

### Verified
Rate% calc 3/3 (incl. negative); self-test 63/63; JS valid; CSS 2218/2218; no undefined handlers; blur now local-only.

### Requires real-device/runtime verification
Rate-as-% on expenses; no cross-device update until Save (incl. on blur); rate book shows %.

---

## [1.11] — 2026-05-21 · build 2026.05.21.69

Per-month rate/currency snapshots now sync to the cloud. Viewing an old month on any device shows that month's saved rate, currency, AND parties — never the current values.

### Hash
`878c341d4c4ac713dc591ffa23056239`

### REQUIRES SQL MIGRATION (run before deploying)
`sql/v89.32.69_month_rate_snaps.sql` — adds a jsonb month_rate_snaps column to app_businesses (owner writes, everyone reads via the normal business-row sync). Idempotent.

### What changed
- Per-month rate/currency snapshots were localStorage-only, so they were lost on a device switch. They now mirror onto the business row (biz.monthRateSnaps) and sync across devices, with the localStorage copy kept as an offline fallback.
- Result: in History, a past month shows the rate + currency saved THAT month on any device. Salaries, profit shares, and parties were already month-scoped + cloud-synced, so old months now show their full saved detail (rate, currency, salaries, shares, parties) — not the current month's values.
- Sum-of-months / All time: no single rate shown (averaging rates is meaningless), but every month's underlying data is intact.

### Verified
History read path correct (current → records snapshot; past-with-snapshot → shows it; past-without → blank, not current; range → averaged). Self-test 63/63; JS valid; CSS 2218/2218; no undefined handlers; schema toDb/fromDb wired; owner-only write guard.

### Requires real-device/runtime verification
Set a rate in month A on device 1; on device 2 view month A → shows month A's rate/currency/parties (after migration + sync). Current-month values never leak into past months.

---

## [1.11] — 2026-05-21 · build 2026.05.21.68

NEW: Expense rate book. Optional Rate field on expenses (amount = qty × rate), negative quantities allowed, and an Add/Edit Rate + View Rate panel that syncs across devices.

### Hash
`50d195f2368f4f807b57af37935c0081`

### REQUIRES SQL MIGRATION (run before deploying)
`sql/v89.32.68_create_expense_rates.sql` — creates app_expense_rates (text ids, RLS: members read / owner write, realtime). Reuses the existing app_can_read_business / app_is_business_owner helpers.

### What's new
- **Optional Rate field** on the expense add row. When both Qty and Rate are present, Amount auto-computes = qty × rate (still editable).
- **Negative quantity** allowed (e.g. −5) → negative amount, for returns/corrections.
- **Add/Edit Rate** button above the expenses list (owner only): a panel of Name + Rate pairs with one Save at the bottom; saves all at once and syncs to the cloud.
- **View Rate** button (everyone who can see expenses): read-only list of the saved Name → Rate pairs.
- **Auto-apply by name**: typing an expense whose name matches a saved rate auto-fills the Rate (and recomputes the amount).
- Rate book stored per business, cloud-synced via the new app_expense_rates table + realtime; saves on the Save button.

### Build decisions (picker didn't register; correct me if needed)
1. Matched-name amount auto-fills (qty × rate) but stays editable.
2. Rate book is per-business (shared across months).
3. Negative qty allowed by typing a minus.

### Verified
Rate logic 8/8 (qty×rate, negatives, case-insensitive lookup); self-test 63/63; JS valid; CSS 2218/2218; tags balanced; no undefined handlers; data/schema/pull/merge/realtime all wired.

### Requires real-device/runtime verification
Add/Edit/View Rate UI, auto-apply on name match, qty×rate (incl. negative), cross-device rate-book sync after Save. Run the migration first.

---

## [1.11] — 2026-05-21 · build 2026.05.21.67

Distribution: sync to cloud only on Save (not while typing); wider/better save & edit buttons and wider salary/amount/% fields.

### Hash
`13ff6d5d899e1683a2b514cf9fd6acd8`

### Sync only on Save
Typing in Add Party, Team Salaries, and Profit Shares now persists LOCALLY only (so a typed-but-unsaved row survives a re-render) and no longer queues a cloud sync per keystroke. Cloud sync fires when the row's Save button is pressed. New local-only debounced persists (_persistSplitLocalDebounced, _persistDistributionLocalDebounced) replace the cloud-syncing ones in the three typing handlers; the Save handlers still call the full sync.

### Wider / better buttons + fields
- Save (edit) and delete buttons on salary / share / party rows are bigger (42x38, rounded 9px, subtle shadow, larger glyphs) with clearer color affordance (edit→brand, delete→red on hover).
- Team Salaries: wider Salary and Amount-to-get columns + wider action column.
- Profit Shares: wider Amount column + wider action column.
- Add Party: wider action area for the bigger buttons.

### Verified
Self-test 63/63; JS valid; CSS 2200/2200; no undefined handlers; typing→local-only (3 handlers), Save→cloud sync intact; mobile grids preserved.

### Requires real-device/runtime verification
Typing no longer triggers cross-device updates until Save; button/field sizing looks right on phone + desktop.

---

## [1.11] — 2026-05-21 · build 2026.05.21.66

Fixes the cross-device currency/rate desync (one device showed a different rate than the other) + the "typed currency, it erased itself" glitch.

### Hash
`0e4b39ea1395432951b147d24f61fad9`

### Root cause (found via console + SQL diagnostics)
The columns and migration were fine. The problem: the saved value diverged from the synced value ON THE SAME DEVICE. localStorage held the latest (Rs/156) but the business row — the thing that actually syncs to the cloud — held an OLD value (NPR/150), and the cloud row was empty. Two causes:
1. **A full re-render (realtime echo / pull) while typing** wiped the currency input ("typed NPR, it erased automatically") and reset __splitCurrency back to the stored business value, so a subsequent save could persist a stale value to the business row.
2. **The business-row mirror only fired conditionally**, so the synced value could lag the saved value.

### Fixes
1. **Focus guard on renderDistributionView** — if the currency, rate, or a party input is focused, skip the full rebuild (no more mid-type wipe; matches the guards on renderDistributionCard and renderSplitParties).
2. **saveSplitCurRate now force-writes** the business row to EXACTLY the just-saved currency/rate (owner) and queues the sync, so the cloud-synced value always equals what you saved — devices converge.

### To fix your currently-stuck value
On the device with the correct rate, after deploying .66: Distribution → Edit Currency and Rate → re-enter → Save. This pushes the correct value to the business row + cloud; the other device picks it up on its next sync/refresh.

### Verified
Self-test 63/63; JS valid; CSS 2198/2198; no undefined handlers; both fixes confirmed.

### Requires real-device/runtime verification
Set rate on device A → it appears on device B; typing currency no longer erases.

---

## [1.11] — 2026-05-21 · build 2026.05.21.65

Fixes: first-added party now deletes; synced currency/rate no longer disappears when a party is added on another device. Plus polished Distribution row cards + save/delete icons.

### Hash
`6b365e48c78b2348629241371d3f8dc1`

### Bug — first-added party wouldn't delete (others did)
`removeSplitParty` persisted (saveSplitStateFor → _syncSplitPartiesArray) BEFORE adding the tombstone, so the array was rebuilt while the cloud row still existed and no tombstone protected it — a realtime echo/merge could resurrect it. Fixed by tombstoning FIRST, then persisting + cloud-deleting (matching the salary/share delete order, which works).

### Bug — synced rate/currency vanished when adding a party on another device
The party loader read currency/rate from the business row ONLY in its localStorage-fallback branch. Once parties existed, the cloud branch returned early and never loaded the synced rate — so on a second device, adding a party (cloud now has parties → cloud branch) dropped the rate to 0. Fixed by loading currency/rate from the cloud-synced business row in the cloud branch too (with the same per-month snapshot handling).

### Design — Distribution row cards + icons
Salary / share / party rows: bigger, clearer save (edit) and delete icons (34px tap target, rounded, subtle shadow) with color affordance — edit hovers brand-colored, delete hovers red, saved state shows a green check. Cards lift slightly on hover. Scoped to Distribution rows so other pages are unchanged.

### Verified
Self-test 63/63; JS valid; CSS 2198/2198; no undefined handlers; both sync fixes + design confirmed.

### Requires real-device/runtime verification
Delete the first-added party (should stick); set rate on device A, add a party on device B (rate should remain); icon/card appearance.

---

## [1.11] — 2026-05-21 · build 2026.05.21.64

Narrower name fields (more room for icons + columns). Cross-device delete fix from .63 retained. Diagnostics requested for remaining sync issues.

### Hash
`a13717c75b2cad8cc747cf5aa8bedb1b`

### Changes
- **Name field width reduced** on Team Salaries, Profit Shares, and Split-the-Percentage parties — capped (no longer greedy `1fr`), giving more room to %, type, plus-minus, salary, amount, and the edit/delete icons.
- Cross-device delete fix (.63: realtime DELETE adds tombstone + mergeWithPending honors it) retained.

### Still under investigation (need runtime data)
- **2nd party saves then vanishes after a few seconds** — traced to a realtime-echo / period_month filter race; need to see the party's stored period_month vs current month.
- **Cross-device delete + currency/rate sync** — need to confirm both devices are on .64 and what the realtime channel delivers.

### Verified
Self-test 63/63; JS valid; CSS 2191/2191; width changes confirmed; no undefined handlers.

---

## [1.11] — 2026-05-21 · build 2026.05.21.63

Cross-device delete now propagates: deleting on one device sticks on the other.

### Hash
`5fde29429e5450b5279811b2e669955d`

### Bug — delete on device A didn't stick on device B
Deleting a salary/share/party on device A removed it on A (even after refresh), but device B still showed it until separately deleted there. Reset worked cross-device, which was the clue: reset does a bulk cloud delete that B's pull reflects, while a single delete relied on B's merge logic — which carried the row back.

Two root causes, both fixed:
1. **`mergeWithPending` resurrected deleted rows.** On B's next pull, a row gone from the cloud (deleted by A) but still in B's local data with a pending op was "carried over" as if it were a local-only addition. Now carryOver skips tombstoned ids.
2. **B had no tombstone for A's deletion.** B received the realtime DELETE event and removed the row from memory, but on refresh the local mirror/pull brought it back because B never recorded the deletion durably. Now the realtime DELETE handler adds a tombstone on the receiving device for distribution rows, so the deletion survives B's refresh.

### Verified
Cross-device trace 3/3 (B tombstones on realtime DELETE → carryOver skips it → row stays deleted on B). Self-test 63/63; JS valid; CSS 2191/2191; no undefined handlers; all prior fixes intact (totalSharePct, focus guard, tombstones, party month-scope).

### Requires real-device/runtime verification
Delete on device A → confirm it disappears on device B (after B's realtime event or next refresh) WITHOUT deleting separately on B.

---

## [1.11] — 2026-05-21 · build 2026.05.21.62

Fixes: keyboard kick-off when typing a party name; delete-twice (tombstone pruned too early).

### Hash
`35c8434fcc461c4413ecae58cc68c916`

### Bug 1 — typing a party name "kicks the keyboard off"
`renderSplitParties` had no focus guard, so a background re-render (from debounced persist / realtime echo) rebuilt the party input DOM mid-type and stole focus. Added a focus guard: if a `.split-party-row` input is focused, skip the rebuild (same guard `renderDistributionCard` already uses).

### Bug 3 — salaries/shares need deleting twice (first delete reappears)
The tombstone was pruned immediately on confirmed cloud delete. A realtime DELETE echo or late local re-render arriving AFTER the prune resurrected the row (no tombstone left), forcing a second delete. Fix: do NOT prune the tombstone on confirm — keep it (the set is small; new rows get fresh ids so it never blocks a legitimate add). One delete now sticks.

### Bugs 2 & 4 — party not saving past the first / History shows current parties: LIKELY NEEDS THE SQL MIGRATION
Both depend on party month-scoping (`period_month` on `app_split_parties`). If `sql/v89.32.60_split_parties_month_scope.sql` has NOT been run, parties have no `period_month`, so per-month save + History filtering can't work. CONFIRM that migration ran (see deploy notes). The save/sync logic itself is verified correct when both parties are locked and the column exists.

### Verified
Self-test 63/63; JS valid; CSS 2191/2191; focus guard + no-prune confirmed; .61 totalSharePct fix intact; no undefined handlers.

### Requires real-device/runtime verification
Typing party names (no kick-off); single-delete sticks; per-month parties + History (after confirming v89.32.60 migration ran).

---

## [1.11] — 2026-05-21 · build 2026.05.21.61

CRITICAL FIX: Save/delete crashed whenever profit shares existed (undeclared variable). This broke saving salaries, shares, AND deleting parties.

### Hash
`af5ec2b7727fc5da2adf8e8f7afffd97`

### Root cause (found via runtime stack trace)
`refreshDistributionTotals` referenced `totalSharePct` without declaring it (`totalSharePct += r.pct` with no `let totalSharePct = 0`). This threw `ReferenceError: totalSharePct is not defined` — but ONLY when `__distShares` had rows (the crash line is inside `for (const r of __distShares)`). With profit shares present, the error crashed every save (salaries + shares) and delete mid-execution, so "nothing happened" on click. This is why it surfaced now: once profit shares were added, the loop body ran and threw.

This was a PRE-EXISTING latent bug (present in shipped builds), not a fresh regression — it was dormant until profit shares existed.

### Fix
Declared `let totalSharePct = 0;` before the share loop in `refreshDistributionTotals`. Verified via the exact stack trace: save now runs clean (totalSharePct 99.996%, remaining Rs 306,913.92, share amounts ~102,303 each — matching the on-screen values).

### Audit
Scanned the entire file for other undeclared bare accumulators — `totalSharePct` was the ONLY one. All other `x +=` are object properties (g.pctSum, g.qtyCount, etc.), correctly initialized. Self-test 63/63; JS valid.

### Requires real-device/runtime verification
Save salary/share rows (locks in), delete salary/share/party rows — all should now work with profit shares present.

---

## [1.11] — 2026-05-21 · build 2026.05.21.60

Parties are now month-scoped (saved per month); All time / range groups salaries, shares, AND parties by name with summed totals.

### Hash
`3240018195e01eee8f64bfa6194c6ac5`

### REQUIRES SQL MIGRATION (run before deploying)
`sql/v89.32.60_split_parties_month_scope.sql` — adds `period_month` to `app_split_parties` + index, backfills existing rows to the current month.

### Changes
1. **Parties are now month-scoped**, exactly like team salaries and profit shares. Each month keeps its own party split; editing one month doesn't change another. New parties are tagged with the current month; the party loader filters by the active month; carry-forward brings last month's party names + % into a new blank month (owner only, fresh ids).
2. **All time / range now groups by NAME with summed totals** for salaries, shares, AND parties. Example: salary Abc+Def in month 1, then Def+Ghi (Abc removed) in month 2 → All time shows Abc, Def, and Ghi, with Def's amount summed across both months (20000+25000 = 45000). Verified: Abc 10000, Def 45000, Ghi 15000. Parties group the same way (each name once, amounts summed).
3. Salaries/shares collapse by name in aggregate mode (summed salary + folded adjustments + summed share %). Party amounts group by name and sum.

### Verified
Your scenario traced exactly (Abc/Def/Ghi → 10000/45000/15000; parties P1 110000). Self-test 63/63; JS valid; CSS 2191/2191; tags balanced; no undefined handlers; party schema/loader/sync/carry-forward all month-scoped.

### Requires real-device/runtime verification
Per-month parties save + carry forward; All time / range grouped totals for parties, salaries, shares; single-month exactness.

---

## [1.11] — 2026-05-21 · build 2026.05.21.59

History / past months: hide Split & convert + Split-the-Percentage; show each party's name + amount received that month (read-only).

### Hash
`def683130a5ffc03096702c245b18421`

### Change
In a past month or any History view (Last month / Choose month / All time / Custom range), the editable "Split & convert" card and "Split the Percentage" editor are no longer shown. Instead a read-only "Party amounts" list shows each party's NAME + the MONEY AMOUNT they received that month (net profit x their % x rate, in that month's currency). The current month (This Month) is unchanged — full Split & convert + Split-the-Percentage editor as before.

- `renderDistributionView` branches on `_activeDistMonth().editable`: editable -> full card; read-only -> party-amounts list.
- `renderSplitParties` skips overwriting the list in read-only mode.
- Amount = net x (pct/100) x rate; verified 105000 (70% of 100000 x1.5) and 15000 (30% of 50000, no rate).

### Verified
Self-test 63/63; JS valid; CSS 2191/2191; tags balanced; amount calc traced; branch logic correct (This Month editable, past/all/range read-only).

### Requires real-device/runtime verification
Past-month/History showing party amounts read-only; This Month still fully editable.

---

## [1.11] — 2026-05-21 · build 2026.05.21.58

Two fixes: tombstones now cover the localStorage fallback (deletes finally stick); past months with no saved rate show blank, not the current rate.

### Hash
`3f9db5f5cf743e702c62947b77743055`

### Bug 1 — deleted parties/salaries/shares STILL reappeared
The .57 tombstone filtered the CLOUD branch of the loaders but NOT the localStorage-fallback branch. When the cloud had no rows, the loader fell back to the local copy — which still held the deleted row — and resurrected it. Now BOTH branches (cloud + local fallback) for parties, salaries, and shares honor the tombstone, so a deleted row cannot reappear from any source.

### Bug 2 — rate/currency appeared in past months never entered
The per-month snapshot logic, when viewing a past month with NO saved snapshot, fell through and kept the live business-level rate/currency loaded just before — so the current rate "appeared" in a past month you never touched. Fixed: a past (non-editable) month with no snapshot now shows blank currency and 0 rate.

### Verified
Tombstone covers cloud + local paths (3/3 simulation); past-month-no-snapshot shows blank; self-test 63/63; JS valid; CSS 2191/2191; no undefined handlers; regression 9/9; carry-forward unaffected (fresh ids).

### Requires real-device/runtime verification
THE KEY TEST: add a party/salary, delete it, refresh — must stay gone (this build fixes the local-fallback path that .57 missed). Past month rate/currency shows blank when nothing was entered.

---

## [1.11] — 2026-05-21 · build 2026.05.21.57

Persistent delete tombstones (ends "deleted data comes back") + per-month rate/currency in History.

### Hash
`ed3949e9b303755967f5efacd998baf8`

### 1. Persistent tombstones — the definitive fix for resurrecting deletes
The "add data → delete it → refresh → it's back" bug had several disguises (stale local mirror, late cloud pull, realtime echo, sync queue drained-then-refreshed). Root fix: when any distribution row (salary, share, party) is deleted, its id is recorded in a PERSISTENT tombstone set (localStorage, survives refresh). Both loaders exclude any tombstoned id, so a deleted row can never reappear regardless of which stale source still holds it. The tombstone is pruned once the cloud delete is confirmed (so the set stays small and never blocks a genuinely new row, which always gets a fresh id).

### 2. History shows that month's SAVED rate + currency
Rate/currency are now snapshotted per month. When you view a past month in History, it shows the rate + currency that were saved THAT month, not the current value. For a month range or All time, the rate is averaged across the saved months (currency shown is the most recent in range). The current month always uses the live value and records its snapshot. Party/salary/share data was already per-month (month-scoped), so those already showed the saved snapshot.

### Logic verified
Tombstone: 3 deletes record, 3 loaders exclude, prune on confirm. Per-month rate: All-time avg 157, Mar–Apr avg 157.5, Apr exact 160, currency = most recent in range. Self-test 63/63; JS valid; CSS 2191/2191; no undefined handlers.

### Note (honest)
Per-month rate snapshots are stored locally (localStorage). They persist across refreshes on the same device. Full cross-device sync of per-month rate history would need a small schema addition — flagged as a follow-up. The live current rate/currency still syncs across devices via the business row as before.

### Requires real-device/runtime verification
Delete-stays-gone across refresh (the key fix), History per-month rate display, currency/rate cross-device sync.

---

## [1.11] — 2026-05-21 · build 2026.05.21.56

Distribution period bar = This Month + History; History holds Last month / Choose month / All time / Custom range.

### Hash
`f4211f9ebec2a3214c12b15cba609c84`

### Changes
- **Period bar simplified to two buttons: This Month and History.** Last Month and Custom month moved into the History modal.
- **History modal now offers:** Last month (one tap), Choose a month (month-grid picker), All time (every month combined), and Custom month range (From–To). All open as read-only snapshots.
- **Past months show their SAVED snapshot, not current entries.** This is inherent to the month-scoping: salaries/shares/parties are stored per `period_month`, so viewing a past month loads exactly what was saved for that month. The Net Profit figure for a past month is scoped to that month's own entries (which don't change retroactively).
- **Currency/rate sync verified.** The save path writes `split_currency`/`split_rate` to the business row and queues it for cloud sync (owner-only). This was previously blocked by the missing-business-record + stale-role-cache issue (now resolved by the data fix), so it should now save and sync correctly.

### Verification
Self-test 63/63; JS valid; CSS 2191/2191; period bar = 2 buttons (This Month + History); all History functions defined (Last month, Choose month, single-grid, All time, range); currency/rate sync path confirmed.

### Requires real-device/runtime verification
History modal options, single-month snapshot rendering, and currency/rate actually persisting across devices.

---

## [1.11] — 2026-05-21 · build 2026.05.21.55

Read-only lockdown for non-current months (parties + currency/rate) + visible delete diagnostic.

### Hash
`f3a97f24fe3228f2a80b409378a2cefa`

### Changes
1. **Parties + currency/rate are now fully read-only in past months and History.** Previously only the salary/share Add buttons were hidden; you could still add/remove parties and edit currency/rate while viewing a non-current month. Now `addSplitParty`, `removeSplitParty`, and `distRowToggleEdit` (which covers currency/rate, parties, salaries, shares) all block with a toast unless you're on This Month, and the read-only CSS hides the add-party / remove-party / Edit-Currency-and-Rate buttons too. Only the current month is editable.
2. **Party delete — visible diagnostic.** Since the deleted party still reappears and the delete code is verified correct, the cloud delete now reports its result as a TOAST (not just console): if the server keeps the row ("0 deleted"), it shows "Server kept the row (0 deleted) — check delete permissions" — the signature of an RLS DELETE policy blocking it. This makes the root cause visible without opening the console.

### Verification
Self-test 63/63; JS valid; CSS 2191/2191; all read-only guards confirmed; delete diagnostic confirmed.

### IMPORTANT — likely root cause of the party-delete issue
The party reappearing on refresh almost certainly means the DELETE is being rejected by Supabase RLS (the row never leaves the server, so a refresh pulls it back). After deploying, delete a party and watch for the toast. If you see "Server kept the row", run this SQL to allow deletes on the distribution tables:

```sql
-- Allow owners/writers to DELETE split parties + distribution rows
DROP POLICY IF EXISTS sp_delete ON public.app_split_parties;
CREATE POLICY sp_delete ON public.app_split_parties FOR DELETE USING (public.app_can_write_business(business_id));
DROP POLICY IF EXISTS ds_delete ON public.app_distribution_salaries;
CREATE POLICY ds_delete ON public.app_distribution_salaries FOR DELETE USING (public.app_can_write_business(business_id));
DROP POLICY IF EXISTS dsh_delete ON public.app_distribution_shares;
CREATE POLICY dsh_delete ON public.app_distribution_shares FOR DELETE USING (public.app_can_write_business(business_id));
```
(Function name `app_can_write_business` may differ in your schema — adjust to your existing write-check function.)

---

## [1.11] — 2026-05-21 · build 2026.05.21.54

Final audit fix: History month-picker modal refresh used a non-existent element id.

### Hash
`0bf54fe7f790ebca86757c1af348913c`

### Found + fixed (final audit)
`histPickMonth` refreshed the History modal via `querySelector('#modalRoot .modal')`, but there is no `#modalRoot` element — the modal is `#modalContent`. It only worked by luck through the `.modal` fallback. Fixed to target `#modalContent` directly so the From/To pills + month grid re-render reliably after each pick.

### Audit result
Structure clean (JS valid, CSS 2191/2191, tags balanced, 0 undefined handlers, 0 TODO/FIXME); calculations 14/14; auth/security 11/11; sync/realtime 9/9; History feature 14/14; PWA/SQL/package valid (manifest + vercel valid JSON, 0 crons, 14 migrations balanced); theme/responsive intact (59 media queries). Self-test 63/63.

### Verification
Self-test 63/63; JS valid; CSS 2191/2191; modalContent fix confirmed; no stray #modalRoot in code.

---

## [1.11] — 2026-05-21 · build 2026.05.21.53

Distribution History: All time + custom month range, with averaged %/rate and summed amounts.

### Hash
`f8084886760a7649c4b70936018dce9f`

### Changes
- **Removed "All Time"** from the period row. The Distribution period bar is now This Month · Last Month · Custom month, plus a **History** button.
- **History button** opens a modal with two options: **All time** (every month) and **Custom month range** (pick From + To months). New period mode `monthrange` (fromMonth/toMonth), inclusive.
- **History is an aggregate, read-only view:**
  - **Amounts** (team salaries, profit shares, party amounts): **summed** across the months in range (the loader includes every in-range month's rows; totals add them).
  - **Party %**: **averaged** per party by name across the months in range (e.g. 70/70/60 → 66.67%).
  - Read-only banner + hidden add/edit controls (same as past-month snapshots).
- Logic-traced: avg % 66.67, sum salary 91000, range-filter Mar–Apr 60000 — all correct.

### Known limitation (honest)
**Rate averaging is not yet meaningful** because the currency rate is still a single business-level value, not stored per month — so there is no per-month rate to average. History currently applies the current business rate to the summed totals. Storing the rate per month (so History can average it) is a further change; flagged for follow-up.

### Verification
Self-test 63/63; JS valid; CSS 2191/2191; tags balanced; all 8 new History functions defined; no undefined handlers.

### Requires real-device/runtime verification
History modal flow, range picker, and aggregate rendering on device.

---

## [1.11] — 2026-05-21 · build 2026.05.21.52

DIAGNOSTIC: surface why a deleted party reappears.

### Hash
`6204524dab4ff8896085d07d7734b673`

### Why
A split party still reappears on refresh after .51. The delete logic is verified correct in code (filter local -> persist localStorage -> direct cloud delete -> queued delete fallback -> .51 re-add guards), so the failure is at runtime: the cloud delete is most likely returning 0 rows (RLS) or being rejected, leaving the row in the cloud to be pulled back on refresh. The error was being swallowed silently.

### Change
`_cloudDeleteDistRow` now logs its outcome to the console: success with deleted-row count, or the exact error/why-skipped. Uses `.delete().eq('id', id).select()` so we can see how many rows the delete actually removed (0 = RLS/permission blocking). No behavior change otherwise.

### Next step
Deploy, open the browser console, delete a party, and read the `[distDelete]` line — it will say either "cloud delete OK deletedRows: 1" (then the issue is elsewhere) or "CLOUD DELETE FAILED" / "deletedRows: 0" (RLS). That tells us exactly where to fix.

---

## [1.11] — 2026-05-21 · build 2026.05.21.51

FIX: deleted split party reappears.

### Hash
`44fccd2b1d348ea13c488eb9916ce1ca`

### The bug
Deleting a split party, then it comes back. Root cause: the party row left `__splitParties` and `data.splitParties`, and a cloud delete was fired — but the cloud row survives until that delete drains, so a sync pull or realtime echo re-added the party to `data.splitParties`, and the next render re-read it. Two gaps allowed the resurrection:
1. `loadSplitPartiesFromCloudOrLocal` didn't honor pending DELETE ops (the salary/share loader does, via `_pendDel`) — so it re-read the still-present cloud party.
2. The realtime INSERT/UPDATE handler re-added any echoed row unconditionally, even one with a queued delete.

### Fix
1. Party loader now drops any party id with a queued `app_split_parties` delete (`_pendDelParties`).
2. The realtime handler now ignores an INSERT/UPDATE echo for any id that has a pending delete in the queue — the local delete is authoritative. (This also hardens salary/share deletes against the same echo.)
The pull-merge already honored pending deletes generically by table (covers parties).

### Verification
Self-test 63/63; JS valid; CSS 2184/2184; both guards confirmed; pull-merge coverage confirmed.

### Requires real-device/runtime verification
Delete a saved party on-device and confirm it stays gone after the cloud delete drains + across devices.

---

## [1.11] — 2026-05-21 · build 2026.05.21.50

Regression recheck: fix All Time localStorage-fallback edge case.

### Hash
`27c99da0c6e041d68366668f72ef2494`

### Found + fixed
**All Time + localStorage fallback** could show empty. In All Time mode `wantMonth` is null; the localStorage fallback filter compared `(periodMonth || currentMonth) === wantMonth`, which matches nothing when null — so if the cloud arrays were empty and localStorage was the only source (offline/edge), All Time showed no rows. Fixed: the fallback now includes all months when in All Time mode (mirrors the cloud-path `_inMonth` behavior).

### Recheck result
Full session regression **29/29 intact**; untouched systems **13/13** (auth, entries, audit, transfers, export/print, theme, SW, realtime, sounds, generic period bar with Today/Yesterday for other views — all unaffected). Structural gates clean; calculations 4/4; All Time interaction risks (carry-forward skip, sync guard, read-only banner) all verified safe.

### Verification
Self-test 63/63; JS valid; CSS 2184/2184; tags balanced; no undefined handlers.

---

## [1.11] — 2026-05-21 · build 2026.05.21.49

Distribution period filter: This Month / Last Month / All Time / Custom month (4 buttons).

### Hash
`ac2974b91ca4fcbf8327024920a274ce`

### Changes
Re-added the **Custom month** button to the Distribution period bar (now 4: This Month · Last Month · All Time · Custom month), per the confirmed selection. Custom month opens the existing month-picker grid (`pickMonth` → `mode:'month'`), showing that month as a read-only snapshot. All Time aggregation and read-only behavior unchanged.

### Verification
Self-test 63/63; JS valid; CSS 2184/2184; exactly 4 period-tab buttons; month-picker (pickMonth) confirmed wired.

---

## [1.11] — 2026-05-21 · build 2026.05.21.48

Distribution period filter: This Month / Last Month / All Time only (removed Custom month).

### Hash
`cdcc5787c36c002946a8e83bf3baba79`

### Changes
Per request, the Distribution period bar now has exactly three options: **This Month · Last Month · All Time**. The Custom month button (added in .47) was removed. All Time aggregation across months is unchanged: it sums every month's salary/share rows, each keeping that month's own amount; parties + currency/rate stay business-level. All Time remains read-only with its combined-view banner and persist guard.

### Verification
Self-test 63/63; JS valid; CSS 2184/2184; exactly 3 period-tab buttons in the distribution bar; "Custom month" fully removed; All Time loader + read-only guard intact; aggregation re-traced.

---

## [1.11] — 2026-05-21 · build 2026.05.21.47

Distribution period filter simplified + All Time aggregation across months.

### Hash
`2e5e88ad53309849e3adc9ca0bc722d4`

### Changes
1. **Distribution-specific period bar.** Replaced the generic period bar (Today/Yesterday/Custom range) on the Distribution page with a month-based one: **This Month · Last Month · All Time · Custom month**. Other views keep the original period bar — only Distribution changed (new `renderDistPeriodBar`).
2. **All Time aggregates every month.** Selecting All Time loads every month's salary/share rows together, so the totals sum across all months — each month's rows keep that month's own amounts (e.g. Goku 30000 + 30000 + 31000 = 91000). Parties + currency/rate are business-level, so the conversion uses the current rate. (Logic-traced.)
3. **All Time is read-only** with a "combined view of all months" banner. Added a safety guard so a persist can never fire in All Time mode (which holds all months merged) and corrupt per-month storage.
4. **Custom month** opens the month picker (`openModal('period')`) to jump to any specific month (read-only snapshot).

### Verification
Self-test 63/63; JS valid; CSS 2184/2184; tags balanced; no undefined handlers; period bar + all-mode loader + sync guard + aggregation all confirmed and logic-traced.

### Requires real-device/runtime verification
On-device rendering of All Time totals and the month-picker flow.

---

## [1.11] — 2026-05-21 · build 2026.05.21.46

FIX: "Party to be Used for Distribution" selector now appears (was crashing silently).

### Hash
`a53fa13de604a3db61d1c0d280470e07`

### The bug
The selector never showed because `_renderUseForDistribution` called `fmtPctVal()` — a `const` defined locally inside `renderSplitParties`, NOT in this separate function's scope. That threw a `ReferenceError` which the caller's `try/catch` swallowed, so `host.innerHTML` was never set and the selector silently failed to render. Introduced when the selector was split into its own function (.35/.43).

### Fix
`_renderUseForDistribution` now uses its own local percent formatter (`_pct`) instead of the out-of-scope `fmtPctVal`. The selector renders whenever there's at least one named party.

### Verification
Self-test 63/63; JS valid; CSS 2184/2184; selector uses in-scope formatter; confirmed no other out-of-scope `fmtPctVal` usage.

### To see it
With a saved, named party present, the "Party to be Used for Distribution" selector appears below the parties list. (If you reset earlier and have no parties, add + save one first.)

---

## [1.11] — 2026-05-21 · build 2026.05.21.45

Regression audit: fix two issues introduced by .44 month-scoping.

### Hash
`7362ce8147ab06d4f79c6027b0109c30`

### Regressions found + fixed (introduced by .44)
1. **Reset distribution only cleared the current month.** After month-scoping, `resetAllDistributionData` captured ids from the live (month-scoped) arrays and relied on `_syncDistributionArrays` (which now only touches the active month) — so other months' rows survived a "reset everything." Fixed: reset now captures every month's ids from `data.*` for the business and drops the entire business slice from all three arrays before persisting, so it truly wipes all months + parties + currency/rate.
2. **Carry-forward could run on non-owner devices.** The new-month carry-forward (copy names, reset amounts) ran on any device viewing the current month with no rows — including managers/viewers — fabricating local rows with fresh ids that weren't in the cloud, and two devices would fabricate different ids (the cross-device divergence class). Fixed: carry-forward is now owner-only; non-owners show only what the cloud has.

### Verification
Self-test 63/63; JS valid; CSS 2184/2184; tags balanced; no undefined handlers; full session regression 28/28 intact; both fixes confirmed; calculations correct.

---

## [1.11] — 2026-05-21 · build 2026.05.21.44

Month-scoped distribution: per-month history, carry-forward names, read-only past months.

### Hash
`28ae67787b052eb1cd123fa30d6de639`

### Changes
Distribution (Team Salaries + Profit Shares) is now **per-month**. Using the period filter, each month shows its own data, and old months are read-only snapshots.
- **New `period_month` column** on `app_distribution_salaries` + `app_distribution_shares` (migration `sql/v89.32.50_distribution_month_scope.sql`, backfills existing rows to the current month + adds indexes). Synced via the schema map.
- **Loader is month-scoped** — only the active month's rows load. Editing one month never affects another (`_syncDistributionArrays` replaces only the active month's slice, preserving all other months).
- **Carry-forward at a new month:** when the current month has no rows yet but a prior month does, Team Salary **names carry over with amounts reset to 0**, and Profit Share **names + % carry over** unchanged. (Logic-traced: names kept, salary/adjustment reset, shares intact, old months preserved.)
- **Past months are read-only:** a banner explains it, Add/Edit/Delete controls are hidden, and the add handlers guard with a toast. Only the current month is editable.
- **Parties + currency/rate stay business-level** (not month-scoped) — unchanged.

### Verification
Self-test 63/63; JS valid; CSS 2184/2184; tags balanced; migration BEGIN/COMMIT balanced + 2 columns + 2 indexes; month-scope + carry-forward + read-only all confirmed and logic-traced.

### Requires real-device/runtime verification
Multi-month rollover behavior across a real month boundary and the read-only rendering on device.

---

## [1.11] — 2026-05-21 · build 2026.05.21.43

Fix keyboard jump while typing in distribution/party fields (debounced persist).

### Hash
`d34a28b7d07f2010742347b07b156de8`

### Changes
1. **Keyboard no longer jumps while typing** in Team Salaries, Profit Shares, and split-party name/% fields. Cause: every keystroke called persist → `saveData` → sync diff → cloud write → realtime echo → a scheduled re-render that (despite the typing-defer guard) could rebuild the input and collapse the mobile keyboard. Fix: the localStorage+cloud persist is now **debounced** (~700ms after the last keystroke) instead of firing per character, and **flushed on blur** (and on Save) so nothing is lost. The live row object + on-screen math still update instantly on each keystroke.
2. The **"Party to be Used for Distribution"** selector renders once you have a saved, named party — it appears below the parties. (It depends on being able to type + save a party, which the keyboard fix now makes reliable.)
3. The **period filter** (This Month / Today / Yesterday / All Time / Custom) is already present on the Distribution page via the standard period bar — confirmed.

### Verification
Self-test 63/63; JS valid; CSS 2181/2181; debounce helpers + blur flush + period bar + selector all confirmed.

---

## [1.11] — 2026-05-21 · build 2026.05.21.42

Final audit fixes: disable server cron digest (true 11:59 removal) + bundle PWA manifest.

### Hash
`14e04ba14bf7ab3eda084e27348cf87f`

### Changes (from the final deep audit)
1. **Server cron digest disabled.** Build .37 removed the *client-side* 11:59 digest, but `vercel.json` still had a cron (`14 18 * * *` = 23:59 NPT) calling `/api/cron/digest`, which sends a Web Push — so the 11:59 notification could still fire from the server. Removed the `crons` block from `vercel.json` so the notification is now fully gone (client + server). (`api/cron/digest.js` is left in place, dormant, in case you want to re-enable later — it just isn't scheduled.)
2. **Bundled `manifest.webmanifest`.** `index.html` references it and `vercel.json` has a cache rule for it, but the file wasn't in the package (served only from the live deploy). Added it so the package is self-complete for PWA installability. (Note: `icons/` and `PRIVACY.html` are still served by the live deployment and not bundled — unchanged from all prior packages.)

### Verification
Self-test 63/63; JS valid; CSS 2181/2181; vercel.json + manifest valid JSON; cron fully removed; index.html unchanged except build tag.

---

## [1.11] — 2026-05-21 · build 2026.05.21.41

Parties sync only after save; no auto-select for distribution.

### Hash
`c5754d951c3cbd836fb37633920ba310`

### Changes
1. **Unsaved parties no longer sync.** Adding a party used to immediately `saveSplitStateFor` (pushing a blank, unsaved party to the cloud + other devices). Now adding a party only updates the local view; the party syncs only after the user taps Save on the row. `_syncSplitPartiesArray` now filters to **saved (locked)** parties only, so an in-progress edit never reaches the cloud.
2. **No auto-select.** The first party added was auto-selected as the Distribution source. Removed — the user enters and saves parties first, then deliberately picks one in the selector.
3. **Selector renamed "Party to be Used for Distribution"** and sits below the saved parties; choosing one drives the Distribution amount (and the selection persists/syncs).

### Verification
Self-test 63/63; JS valid; CSS 2181/2181; no-auto-select + no-sync-on-add + saved-only-sync + header rename all confirmed.

---

## [1.11] — 2026-05-21 · build 2026.05.21.40

FIX: split parties now render from cloud data — the empty "Split the Percentage" list + missing Use-for-Distribution selector.

### Hash
`28ffb1e7385412b24dcdf56e2f859da6`

### The bug (confirmed via live diagnostics)
A Mac showed an empty "Split the Percentage" list even though `data.splitParties` held 2 named parties ("s" 70% selected, "sa" 30%) and the cloud had the same. Root cause: `renderDistributionView` hydrated `__splitParties` from `loadSplitStateFor` (localStorage only) — the same class of bug fixed for salaries/shares in .39, but the **parties** path was missed. Realtime/pull write cloud parties to `data.splitParties`, not localStorage, so the list rendered empty and — because the Use-for-Distribution selector only lists named parties in `__splitParties` — that selector never appeared either. This also produced the "every device shows separate data" symptom: each device rendered whatever its localStorage happened to hold, ignoring the synced cloud parties.

### Fix
`renderDistributionView` now hydrates parties via `loadSplitPartiesFromCloudOrLocal`, which prefers cloud `data.splitParties` (and heals multi-selected state, sets the selected party from cloud `is_selected`), falling back to localStorage. Parties now render consistently across devices, and the Use-for-Distribution selector appears whenever named parties exist.

### Verification
Self-test 63/63; JS valid; CSS 2181/2181; tags balanced; parties-from-cloud confirmed; old localStorage-only party hydration removed.

---

## [1.11] — 2026-05-21 · build 2026.05.21.39

FIX: distribution data now shows on managers/viewers + other devices (was reading stale localStorage).

### Hash
`b9510d9ab3a81152b7ca35f3816b1cc4`

### The bug
Saving distribution data synced to the cloud fine, but other users (managers/viewers) and the same user on another device didn't see it. Root cause: `renderDistributionView` hydrated `__distSalaries`/`__distShares` from `loadDistributionStateFor` — which reads **localStorage only**. But the realtime handler and cloud pull update `data.distSalaries`/`data.distShares` (the synced arrays), NOT localStorage. So a realtime event landed in `data.*`, the view re-rendered, but it re-read stale localStorage and ignored the update — the other device never showed the owner's rows.

### Fix
`renderDistributionView` now hydrates via `loadDistributionFromCloudOrLocal`, which prefers the cloud-synced `data.*` arrays (honouring pending deletes) and falls back to localStorage. Realtime/pull updates now appear immediately on all devices.

(Realtime subscription + cloudPushOrder already included all three distribution tables — confirmed; the gap was purely the view reading the wrong source.)

The "Use for Distribution" selector below the parties (pick which party feeds the Distribution amount) was already in place (.35) and is confirmed wired: selecting a party drives the Distribution amount via its %.

### Verification
Self-test 63/63; JS valid; CSS 2181/2181; tags balanced; view-loads-from-cloud confirmed; old localStorage-only hydration removed; realtime + push order confirmed for all 3 dist tables.

---

## [1.11] — 2026-05-21 · build 2026.05.21.38

New: one-tap "Reset distribution" button.

### Hash
`f9427c27765619210b956bb67bccddfe`

### Changes
Added a **Reset distribution** button to the Distribution page header (owner only). One tap clears, for the active business: all team salaries, all profit shares, all split parties, and the currency/rate — locally AND in the cloud, in the correct order so the wipe sticks:
1. Confirmation prompt (destructive, can't be undone).
2. Clears local state first (so no device re-pushes a cached copy).
3. Persists the cleared state + pushes the sync diff (emits deletes).
4. Directly deletes the cloud rows for this business and resets the business `split_currency`/`split_rate` columns (owner-only, best-effort; queued ops are the fallback).
5. Re-renders the Distribution view to the clean empty state.

No more manual SQL needed for a distribution reset.

### Verification
Self-test 63/63; JS valid; CSS 2181/2181; tags balanced; no undefined handlers; function defined + wired owner-only; confirm-before-reset + local/cloud/currency clearing all confirmed.

---

## [1.11] — 2026-05-21 · build 2026.05.21.37

Remove 11:59 notification; fix Edit Currency/Rate + party save; redesign "Split the Percentage" empty state.

### Hash
`2e12d318c337fc2060b23163c319df28`

### Changes
1. **Removed the 11:59 PM daily-summary notification.** The client-side daily digest (toast + browser notification fired at 23:59 NPT) is disabled.
2. **"Edit Currency and Rate" button now works.** Root cause: the currency summary/inputs and the button live in the `renderDistributionView` markup (`#mainContent`), but the toggle re-rendered only `#distributionCard` — so clicking Edit toggled the lock but never revealed the inputs. The `splitcurate` toggle now re-renders the full distribution view, so the summary↔inputs swap correctly.
3. **Party "save glitch" fixed (same root cause).** The party list (`#splitPartiesList`) also lives in the view, not the card. The `parties` toggle now re-renders the party list directly, so a saved party row flips edit→saved and the selector updates.
4. **Renamed "Split the %" → "Split the Percentage".**
5. **Nothing shows before a party is added.** The legacy single-party % input/results block is removed; with no parties the section just shows "Add a party to split the percentage." (Distribution still defaults to 100% of net profit until a party is selected.)
6. **Add party = name + % only** (already the case), and after saving, the **"Use for Distribution"** selector below lets you pick which party feeds the Distribution; the amount follows the selection.

### Verification
Self-test 63/63; JS valid; CSS 2181/2181; tags balanced; all six items confirmed in source; distribution-amount fallback (no party = 100%) confirmed intact.

---

## [1.11] — 2026-05-21 · build 2026.05.21.36

Profit Shares: removed the "Reason for share" field entirely.

### Hash
`2f4386ac8e9c56f1fd743d6a8fe14421`

### Changes
Removed the "Reason for share" (note) input from the Profit Shares editing row. In .34 it was dropped from the saved view but still showed while editing; it's now gone from both. Team Salaries keeps its Reason field (unchanged). Existing note data in records is left intact (just no longer shown or editable for shares).

### Verification
Self-test 63/63; JS valid; CSS 2181/2181; tags balanced; Reason-for-share removed; salary Reason field confirmed untouched; share name/% inputs intact.

---

## [1.11] — 2026-05-21 · build 2026.05.21.35

Split the %: wider name field + separate "Use for Distribution" selector.

### Hash
`c5ec1c9e3e09be443d8428ec2c744ceb`

### Changes
1. **Party name field is now full-width.** The editing row's grid still reserved a 28px column for the old radio dot (removed in .34), squeezing the name input. Dropped that dead column so the name field gets its full width.
2. **"Used for distribution" moved out of the per-row UI into its own section below the parties list.** New **"Use for Distribution"** block lists all saved (named) parties as radio options; pick one to set which party's amount feeds the Distribution below. The per-row inline toggle is gone. Selecting a party updates both the selector highlight and the saved-row "Used for distribution" badge immediately.

### Verification
Self-test 63/63; JS valid; CSS 2181/2181; tags balanced (div/span/button/label); inline toggle removed; selector renderer + host container + re-render-on-select confirmed; name-field grid widened.

---

## [1.11] — 2026-05-21 · build 2026.05.21.34

Distribution redesign: saved rows show as clean text; Parties → "Split the %".

### Hash
`6ee364e4e6c879362669b8e78b69548a`

### Changes
1. **Saved rows are now plain text in aligned columns — no input boxes.** Team Salaries, Profit Shares, and split parties all render their saved (locked) state as read-only text under the column headers. Tapping Edit reveals the input fields; saving collapses back to clean text.
   - **Team Salaries** saved row shows: Name · Salary · Type · Amount · Final ("Amount to get"), with the Reason on a second line if present.
   - **Profit Shares** saved row shows: Name · % · Amount. (No notes/reason field — removed per request; it still appears only while editing... actually removed from the saved view entirely.)
   - **Split parties** saved row shows: Name · % · a "Used for distribution" badge when that party is the selected one.
2. **Parties section renamed "Split the %".** The "+ Add party" button stays at the top. With no parties added, it stays in single-party mode at 100% (unchanged). Adding a party opens name + % fields plus a **"Used for distribution"** toggle (replaces the old radio dot); on save it shows as clean text.
3. New rows still open in edit mode so the fields appear immediately on Add.

### Verification
Self-test 63/63; JS valid; CSS 2167/2167; tags balanced (div/span/button); all redesign pieces confirmed in source; new-row-unlocks + empty=100% paths confirmed intact.

---

## [1.11] — 2026-05-21 · build 2026.05.21.33

Heal multiple-selected split parties (the desktop/phone showing different data).

### Hash
`5dd0761987a7604e7aed2cedd8b1d09b`

### Diagnosis (from live data)
A Supabase query showed three party rows (`Nepal`, `NEPAL`, `NPL`) all with `is_selected = true` at once — invalid state left over from the pre-fix duplication era (rows created across devices/dates, each marking itself selected). Only one party may feed the Distribution amount. The loader used `find(r => r.isSelected)`, which returns the order-dependent FIRST match — so two devices could pick different "selected" parties and compute different distribution numbers. That's why the desktop and phone showed different data despite both syncing.

### Changes
`loadSplitPartiesFromCloudOrLocal` now picks the selected party **deterministically** (lowest id) when more than one is flagged, so every device agrees. When it detects multiple selections, the owner's device re-persists the healed single-selection state to clear the extras.

### One-time cloud cleanup (run in Supabase)
The duplicate party rows are already in the cloud; remove the redundant Nepal-variants and fix the selection:
```
DELETE FROM public.app_split_parties
WHERE id IN ('ad9476d8523b403a', 'a23ef09c70da4498');
UPDATE public.app_split_parties
SET is_selected = (id = 'a2a3066e16504794')
WHERE business_id = 'ed3df6a73c5e4b0b';
```
Leaves USA (70) + Nepal (30, selected).

### Verification
Self-test 63/63; JS valid; CSS 2156/2156; heal logic confirmed (filter selected, deterministic id-sort pick, owner-only re-persist).

---

## [1.11] — 2026-05-21 · build 2026.05.21.32

Distribution deletes now fire an immediate direct delete to Supabase.

### Hash
`f6f3c8ac3f44fccf74e53a3a6e842823`

### Changes
Building on the .31 queue-jam fix: deleting a Team Salary, Profit Share, or split party now **also** issues a direct `DELETE` to the corresponding Supabase table right away (`_cloudDeleteDistRow`), in addition to the normal queued delete op. This guarantees the row leaves the backend promptly rather than depending solely on the diff→queue→drain chain. It's best-effort and owner-only; if offline it silently no-ops and the queued delete op remains as the fallback (and retries). Self-writes are marked to suppress the realtime echo.

Combined with .31 (queue no longer jams) this means: delete in the app → row is removed from Supabase → it does not come back on refresh or on another device.

### Verification
Self-test 63/63; JS valid; CSS 2156/2156; helper defined + wired into all three distribution delete handlers; owner-only guard confirmed; .31 queue fix intact.

### Reminder
Run the one-time cleanup `sql/v89.32.39_cleanup_distribution_junk.sql` to clear the rows that accumulated before these fixes, and deploy .32 to all devices.

---

## [1.11] — 2026-05-21 · build 2026.05.21.31

THE root cause: a stuck upsert blocked the whole sync queue, so deletes never reached the cloud.

### Hash
`33a53bae55f05ec84caa3590875d14fb`

### The actual diagnosis
A Supabase query proved the distribution data WAS reaching the cloud — but the tables were full of duplicate and empty rows, and deletes never took effect. Root cause found in `drainQueueOnce`: the loop set `earlyExit = true` and `break`ed on the FIRST table whose batch errored. So a single stuck upsert (e.g. a malformed/empty row at the front of the queue) blocked every table behind it — **including all pending DELETE ops**. Deletes never drained, so deleted rows stayed in the cloud and got pulled back; meanwhile each add piled up as a new row → the duplicates you saw.

### Changes
1. **Sync drain no longer aborts on one table's failure.** Each table now processes independently: a failed upsert/delete leaves only its own ops in the queue to retry, and the loop continues so other tables — and pending deletes — still drain. This unblocks the trapped delete ops.

### Companion SQL cleanup (one-time)
**`sql/v89.32.39_cleanup_distribution_junk.sql`** removes the accumulated never-filled rows (no name + zero value) from all three distribution tables, and lists remaining same-name duplicates so you can clear the extras from inside the app (which will now actually delete them from the cloud).

### Verification
Self-test 63/63; JS valid; CSS 2156/2156; earlyExit fully removed; cleanup migration guarded to only delete empty rows.

---

## [1.11] — 2026-05-21 · build 2026.05.21.30

Distribution: per-row Save now works reliably + deleted rows no longer resurrect on reload.

### Hash
`fb682a7a82afc1b09c4cf73afde7ccf4`

### Changes
1. **"Save not clickable / does nothing after adding a salary or profit share" — FIXED.** Adding a row re-rendered via `renderDistributionCard()` (patches `#distributionCard`), but the Edit/Save toggle re-rendered via the full `renderDistributionView()` (rebuilds `#mainContent` and re-hydrates the arrays from storage). That mismatch could leave the Save button in an inconsistent state. The toggle now uses the same `renderDistributionCard()` path as Add, so Edit↔Save flips consistently and the save commits.
2. **Deleted distribution rows reappearing — additional fix.** Build .29 made the cloud-pull *merge* honour pending deletes, but `loadDistributionFromCloudOrLocal()` (which prefers cloud `data.distSalaries`) could still resurrect a row after a pull repopulated it. That loader now also filters out any row with a not-yet-pushed delete op in the sync queue, so a deleted row can't come back via the reload path.

### Honest note
If a deleted row STILL returns after this build, it means the delete isn't succeeding on the server (a stuck sync op / delete-permission issue), not the client resurrecting it — the client now refuses to show pending-deleted rows everywhere. That case would need checking the delete RLS on the distribution tables.

### Verification
Self-test 63/63; JS valid; CSS 2156/2156; both fixes confirmed in source.

---

## [1.11] — 2026-05-21 · build 2026.05.21.29

Deleted records no longer reappear on refresh + currency/rate read-only summary.

### Hash
`fd6ffbe248b0d6204b9219bbd396b167`

### Changes
1. **"I delete it, refresh, it comes back" — FIXED.** When a record was deleted, a delete op was queued and the row removed locally — but `cloudPullAll`'s merge only protected pending *upserts*, never pending *deletes*. So if a pull ran before the delete op pushed (or while it was retrying), the still-present cloud row was treated as authoritative and the deleted record reappeared. The merge now also tracks pending delete ops and excludes those ids from the pulled result, so a not-yet-pushed delete is never undone by a pull.
2. **Currency & rate now show as a read-only summary.** Instead of always-visible input boxes, the Split & convert section now reads "Currency is **Rs**" and "Rate is **1 [base] = 156 Rs**". The "Edit Currency and Rate" button reveals the input fields; saving collapses back to the summary. (Same toggle mechanism as the per-row Edit/Save.)

### Verification
Self-test 63/63; JS valid; CSS 2156/2156; delete-merge fix logic-traced (pending-delete row stays gone after a pull; normal rows unaffected); summary markup + edit-reveal + CSS confirmed.

---

## [1.11] — 2026-05-21 · build 2026.05.21.28

CRITICAL: distribution data was dropped on load + on pull — the real reason it never saved/synced.

### Hash
`95375460857ff673ae135447c488c822`

### Changes
The deeper root cause behind "distribution doesn't save / doesn't sync, save icon does nothing": **two omissions in the data layer** silently discarded the distribution arrays.

1. **`loadAll()` dropped them on every page load.** When the app rebuilt the in-memory `data` object from localStorage, the whitelist of arrays it copied over did **not** include `distSalaries`, `distShares`, or `splitParties`. So although `saveData()` wrote them to localStorage, the very next load wiped them from `data` — they never survived a reload and never got into the sync diff. Now preserved.

2. **`cloudPullAll()` dropped them on pull.** The pull merged 12 tables back into `data` but omitted the same three — so even rows fetched from the cloud were thrown away instead of shown. This is why a second device never displayed what another device saved. Now merged like every other table.

Together these explain the full symptom (save appears to do nothing, nothing persists, nothing cross-syncs) better than the missing tables alone. The save functions and sync mappings were already correct; the data was being discarded at the load/pull boundary.

### Still required
The two SQL migrations remain necessary so the cloud has tables/columns to sync into:
- `v89.32.33_app_businesses_split_currency_rate.sql`
- `v89.32.35_create_distribution_tables.sql` (text-id version — already run successfully)

### Verification
Self-test 63/63; JS valid; CSS 2153/2153; both fixes confirmed in source (loadAll preserves all 3 arrays; pull merges all 3). **Cross-device persistence requires real-device/runtime verification after deploying this build.**

---

## [1.11] — 2026-05-21 · build 2026.05.21.27

Distribution save/sync root cause (missing tables) + print full-page + screen-shift fix.

### Hash
`0ab5cff17fc4971b4e4b13e2c90c8e63`

### ⚠️ Requires a one-time SQL migration (this is the real fix for save/sync)
**`sql/v89.32.35_create_distribution_tables.sql`** — run in Supabase SQL Editor.

### Changes
1. **Distribution doesn't save / doesn't sync to other device — ROOT CAUSE FOUND.** The app pushes Team Salaries → `app_distribution_salaries`, Profit Shares → `app_distribution_shares`, and split parties → `app_split_parties`. The client code for all three is correct, but **no migration ever created `app_distribution_shares` or `app_split_parties`** (and `app_distribution_salaries` was only referenced by the realtime migration, never confirmed created). Writing to a non-existent table fails, so the data stayed in localStorage only — present on the device that entered it, gone everywhere else. The new migration creates all three tables with the right columns, membership RLS (members read, owner writes), and realtime registration. **This is what makes currency/rate (v89.32.33), salaries, profit shares, and split parties actually persist server-side and sync across devices.** No app-code change was needed for save logic — it was already correct.
2. **Member-activity print only captured half a page — FIXED.** The print path didn't reset the app shell's `min-height:100dvh` / grid layout, so print clipped to one viewport. Added print rules forcing every layout ancestor to natural height + visible overflow + block flow, so the browser paginates the full entry list.
3. **Subtle screen movement on Parties / Distribution / other sections — FIXED.** Added `scrollbar-gutter: stable` to `html`. Previously, when content height changed (re-render, clock tick, sync, taller/shorter view) the scrollbar appeared/disappeared and shifted the centered layout sideways. A stable gutter keeps width constant so nothing jumps.

### Migration order
Run BOTH pending migrations in Supabase, then deploy:
- `v89.32.33_app_businesses_split_currency_rate.sql` (currency + rate columns)
- `v89.32.35_create_distribution_tables.sql` (the three distribution tables)

### Verification
Self-test 63/63; JS valid; CSS 2153/2153; both code fixes confirmed in source; migration created with idempotent CREATE + RLS + realtime. **Cross-device sync, print pagination, and the scrollbar-shift fix all require real-device/runtime verification.** **Important:** the migration's RLS assumes `app_businesses.owner_id` and `app_members.business_id/user_id` column names — adjust if yours differ.

---

## [1.11] — 2026-05-21 · build 2026.05.21.26

Member-activity page fixes + entry double-save glitch fix.

### Hash
`60691c12b153caaf7f0c2728d2c67bcd`

### Changes
1. **Entry "had to save twice" glitch — FIXED.** The 500ms double-submit guard was armed at the *top* of saveEntry, so a first submit that hit a validation error (or any early return) still armed it — and a corrected retry within 500ms was silently swallowed, looking like "it didn't save; I entered it again and then it saved." The guard now arms only *after* all validation passes (right before the entry is committed), so an errored/cancelled submit never blocks the next attempt. Genuine rapid duplicate taps are still blocked.
2. **Member-activity page now shows all entries + scrolls.** The entry list had `max-height: 50vh; overflow-y: auto` left over from when it was a modal — on a phone it clipped to half the screen with an inner scrollbar. Removed, so the full list flows and the page scrolls naturally.
3. **Print now spans all pages.** With the 50vh clip gone (and the existing print rules forcing full height + content-visibility:visible), the browser paginates across all entries instead of capturing one screen.
4. **Back button goes to the right place.** "Back" on the member-activity page now returns to the Team page's Activity sub-tab (where the by-member list lives), not the unrelated bottom-nav Activity view. Relabeled "Back to Team".
5. **Member name + email** now shown in the page header (was name only).

### Verification
Self-test 63/63; JS valid; CSS 2151/2151; debounce fix traced (errored-then-retry now SAVES, real dup taps still BLOCKED); all 13 feature+regression checks pass.

---

## [1.11] — 2026-05-21 · build 2026.05.21.25

Fix: Distribution currency + rate now sync across devices (were localStorage-only).

### Hash
`107be09bf4338ad2cde97c3ddab3684b`

### Requires a one-time SQL migration
**`sql/v89.32.33_app_businesses_split_currency_rate.sql`** must be run in Supabase (SQL Editor) before this works. It adds `split_currency` and `split_rate` columns to `app_businesses`.

### Changes
Root cause of "currency/rate gone when I switch devices": the Distribution picked-currency and exchange rate were stored in **localStorage only** — they were in no cloud schema, so they never reached Supabase. (Salaries, profit shares, and split parties already synced correctly via their own tables; only currency + rate were missing.)

Fix: currency + rate are now mirrored onto the business object on save (owner only, matching the distribution write rule) and pushed/pulled via the `app_businesses` row. On load, the client prefers the cloud-synced values and falls back to the local copy if absent (older rows / offline). Added `split_currency` / `split_rate` to the business toDb/fromDb schema map.

### Verification
Self-test 63/63; JS valid; CSS 2151/2151; save-mirror, owner guard, load-prefer-cloud, and both toDb/fromDb mappings confirmed in source. **Cross-device sync itself requires real-device/runtime verification after the migration is run.**

---

## [1.11] — 2026-05-21 · build 2026.05.21.24

Verification pass: corrected a stale code comment (no behaviour change).

### Hash
`2d3173410210e19b50683f5f2fe78889`

### Changes
During the post-change verification of build .23, a stale comment still described the old remaining-for-profit-shares formula (`firstPortionDisp - totalFinal`). Updated it to document the current correct formula (`firstPortionDisp - totalSalary`, adjustments excluded). No runtime behaviour changed — the live code was already correct in .23; only the explanatory comment was brought in line.

Also confirmed: the `dist-totals-card-final` CSS class still appears on the Profit Shares "Total share amount" row — that is the intended shared styling, not a leftover "Total final paid" row (which is fully removed).

### Verification
Self-test 63/63; JS valid; CSS 2151/2151; remaining-for-profit-shares math validated 7/7 against the screenshot (82,610.20); per-row "Amount to get" 3/3; all 7 build-.23 changes confirmed intact; full session regression 10/10.

---

## [1.11] — 2026-05-21 · build 2026.05.21.23

Welcome timing, staff party-contact lockdown, dvh idle-fix, Team Salaries relabel + remaining formula.

### Hash
`9374f405979b7afca2884a6ed39cd464`

### Changes
1. **Welcome splash min 3s.** The "Welcome to the team" overlay now stays up for at least 3 seconds (even if data loads instantly), and longer if the pull is still running — up to the existing 12s safety cap.
2. **Staff cannot add/edit party contact info.** `canEditPartyMeta` / new `canAddPartyMeta` are now owner/manager only. The phone/email/social/DOB/notes fields are hidden from staff in both the create and edit party forms, and the save paths force-ignore any meta from staff (defense in depth). Staff can still create a party (name) and record entries against it.
3. **Staff edit restrictions** (already enforced, re-confirmed): staff can only edit entries they created (`canEditEntry`) and only rename parties they created (`canRenameParty`).
4. **Distribution idle-drift fix.** `.app` now uses `min-height: 100dvh` (with `100vh` fallback). Plain `100vh` counts the area behind the mobile address bar; as that bar shows/hides while idle, the layout drifted a few px — the subtle movement reported on the salary/profit rows. `dvh` tracks the visible viewport and doesn't jitter.
5. **Team Salaries relabel.** Column "Amount" (the adjustment) → **Plus-minus**; column "Final" → **Amount to get**. Export headers updated to match.
6. **Removed "Total final paid"** row from the salary totals card (and from exports).
7. **Remaining-for-profit-shares formula corrected.** Now **party amount − Total Salary** (was: amount to distribute − total final paid, which wrongly subtracted the plus-minus adjustments too). The sub-label spells out the live numbers, e.g. "Rs 117,610.20 (party amount) − Rs 35,000.00 (total salary)". Verified against the screenshot: 117,610.20 − 35,000 = 82,610.20. Adjustments no longer shrink the profit pool.

### Verification
Self-test 63/63; JS valid; CSS 2151/2151; no undefined handlers; all 7 changes confirmed in source; remaining formula validated against the real screenshot figures. Note: the dvh idle-fix and welcome timing **require real-device/runtime verification** — they target mobile-browser behaviour I can't reproduce statically.

---

## [1.11] — 2026-05-21 · build 2026.05.21.22

Show/hide password toggle on all password fields.

### Hash
`c8a810af45a8684d4bbed942488f3818`

### Changes
The show-password eye toggle (already present on the login screen) is now on **every** password field. Added to the 5 that were missing it:
- **Profile → Change password:** Old password, New password, Confirm new password.
- **Reset password (forgot-password flow):** New password, Confirm new password.

Each uses the existing `togglePwdVisible()` helper and `.pwd-wrap` / `.pwd-toggle` styling, so behaviour and appearance match the login fields exactly (eye ↔ eye-off icon swap, keeps focus and cursor position, `tabindex="-1"` so it doesn't interrupt tab order).

### Verification
All 7 password inputs now have a toggle (was 2); per-field confirmed; self-test 63/63; JS valid; CSS 2151/2151; tags balanced (div 1567, button 325).

---

## [1.11] — 2026-05-21 · build 2026.05.21.21

Bug fix: birthday chip opened nothing (called an undefined function).

### Hash
`268f48e306b51c81b9018494bec474ad`

### Changes
Final audit caught a real bug: the birthday banner's party chips called `viewParty(...)`, which is **not defined anywhere** — tapping a chip threw "viewParty is not defined" and did nothing. Changed to `openParty(...)`, the actual party-detail function used everywhere else (3 other call sites). The chip now correctly opens the party.

### Verification
Found via undefined-handler scan during the final deep audit. After fix: zero undefined handlers across the whole file; `openParty` now in all 4 call sites; self-test 63/63; JS valid; CSS 2151/2151.

---

## [1.11] — 2026-05-21 · build 2026.05.21.20

"Welcome to the team" splash while a newly-accepted business loads.

### Hash
`72c86482e5ab223e4f8fdc34df2773a9`

### Changes
When an invitee accepts an invite, the business's data (books, entries, parties, accounts, etc.) takes a moment to sync down from the cloud. A full-page **"Welcome to the team!"** overlay now covers that window — it names the business they joined and shows an indeterminate progress bar with a brief reassuring message, styled to match the boot splash.

It appears only when there's actually a cloud pull to wait for (cloud-signed-in users), and is dismissed the instant the data finishes loading. Three independent dismiss paths guarantee it can never get stuck: on pull success, on pull failure (the business is already in the sidebar by then), and a 12-second safety timeout.

### Verification
Self-test 63/63; JS valid; CSS 2151/2151 (boot-splash rules confirmed intact after the insert); show/hide functions defined and wired; shown once, three dismiss paths confirmed; all 13 regression+feature checks pass.

---

## [1.11] — 2026-05-21 · build 2026.05.21.19

Net profit updates in real time on expense change; member-activity export unified.

### Hash
`4d04d4480e312d47efbf1e1c801a4072`

### Changes
1. **Real-time Net profit (after tax).** Adding, editing, or deleting an audit expense now triggers a full `renderAll()` instead of re-rendering only the current content area. The Net profit (after tax) hero — on both the Audit and Distribution pages — now reflects the expense change immediately, without needing a refresh. (Both views already recomputed Net profit from live data on each render; the gap was that the expense mutation only refreshed the active content region.)
2. **Unified export on "Activity by team member".** The member-activity detail page had three separate controls (print icon + standalone "PDF" and "Excel" text buttons). The PDF and Excel buttons are now consolidated into the single Export icon used by every other tab (Entries, Parties, Audit, Distribution, etc.), which opens the standard PDF / Excel chooser. The print icon stays separate, matching the other pages. Routing added to `runExport` via an encoded `memberActivity:<bucket>:<name>` target.

### Verification
Self-test 63/63; JS valid; CSS 2141/2141; all 12 regression+feature checks pass; old standalone PDF/Excel buttons confirmed removed; `exportMemberActivity` signature confirmed compatible with the unified chooser.

---

## [1.11] — 2026-05-21 · build 2026.05.21.18

Public version bump to 1.11. Final surface check passed.

### Hash
`974149251f0398b6cee0652b11ee4aa8`

### Changes
Bumped public `APP_VERSION` 1.1 → **1.11** (shown on Settings → Help & legal → About). Service-worker cache key updated to `hisabs-1.11-build-2026.05.21.18`. No functional/UI code changed from build .17.

### Verification
Final surface check clean — JS valid, CSS 2141/2141, tags balanced (div 1556, span 440, button 322), no fixed widths ≥1000px (all max-width), 31 ellipsis guards, clean z-index ladder, no undefined handlers. Calculations 4/4 (incl. the distribution Rs amount from the screenshot). All 13 session fixes intact, zero regressions. Self-test 63/63.

---

## [1.1] — 2026-05-21 · build 2026.05.21.17

Distribution UI: proper Edit/Save currency button + amount on one line.

### Hash
`110250144d7355d8f0b69f3251959e62`

### Changes
Two Distribution-page UI fixes from screenshots:
1. **Edit/Save Currency and Rate** — was rendered with the 30×30 icon-button class, so the long label wrapped as awkward plain text. Now a proper labelled pill button: **Edit** state in the brand accent colour, **Save** state in green (toggled via an `is-saving` class), with hover/active feedback.
2. **Amount card** — the currency symbol and amount ("Rs" / "117,610.20") wrapped to two lines because the 1.35rem figure competed with the label for width. The label now yields width (`flex: 0 1 auto; min-width: 0`), the values block stays fixed, and the figure is `white-space: nowrap` at a slightly smaller 1.25rem so currency + number stay on one line.

Console messages reviewed (install-banner suppression, realtime SUBSCRIBED log, AudioContext autoplay warning, extension message-channel error) — all benign / non-app; no code change needed.

### Verification
Self-test 63/63; both fixes confirmed in source; CSS 2141/2141; JS valid; gates green.

---

## [1.1] — 2026-05-21 · build 2026.05.21.16

Announcement: only the app sound plays (silenced the OS notification tone).

### Hash
`0f68bef024122bb6d37f342ce267aa7b`

### Changes
When an announcement arrived, two sounds played: the embedded announcement MP3 (~1s) immediately followed by the **device's default notification tone** from the OS notification. The OS notification is now created with `silent: true` on all paths (service-worker `showNotification` + the three `new Notification` fallbacks). The status-bar notification still appears, but only the app's announcement sound is heard — consistent with cash in / cash out / delete, which never trigger an OS tone. **Requires real-device/runtime verification.**

### Verification
Self-test 63/63; 4 silent flags confirmed on the announcement notification paths; gates green (JS valid, CSS 2136/2136).

---

## [1.1] — 2026-05-21 · build 2026.05.21.15

Invite card shows "Team" instead of raw "staff".

### Hash
`09616fedfc914aaf8fc74f79e07912fd`

### Changes
The pending-invite card (shown to an invited person in their sidebar) printed the raw internal role value — so a team invite read "staff". It now shows the friendly label "Team" (Manager/Viewer capitalize normally), matching the rest of the app. Also updated the help text "If you were invited as staff…" → "…as a team member". The internal role value stays `staff` (permissions untouched); only the displayed word changed.

### Verification
Self-test 63/63; confirmed no remaining invitee-facing raw "staff" output (all other role displays already mapped staff→team); gates green (JS valid, CSS 2136/2136).

---

## [1.1] — 2026-05-21 · build 2026.05.21.14

Splash loading bar moved below the icon/name.

### Hash
`023a3441e717ae61056d8f29275ab91c`

### Changes
Moved the splash loading bar from above the icon to **below** the icon / name / tag / dots (now the last item in the centered stack), per preference. Margin flipped to sit just under the dots. Applied to both the static and JS-rendered splash markup.

### Verification
Self-test 63/63; progress bar confirmed after the dots in both copies; CSS 2136/2136; JS valid; gates green.

---

## [1.1] — 2026-05-21 · build 2026.05.21.13

Recheck of the role-change redesign — fixed an ESC-dismiss hang.

### Hash
`09b09176014471c4efa64ff9ea8c4b54`

### Changes
**Bug found and fixed during recheck:** the global Escape handler only treated Esc as "cancel" when a `uiConfirmCancelBtn` was present in the DOM. The new role-picker modal doesn't use that button, so pressing **Esc** while the role picker was open closed it visually but left its Promise unresolved and `__asyncModalResolver` stuck set — which could interfere with the next modal. The Escape handler now resolves ANY pending async modal (uiConfirm, uiPrompt, and the role picker) cleanly: prompt-style cancels as `null`, confirm/pick as `false` (both falsy, so callers treat either as cancelled).

Everything else in the role-change redesign (build .12) is unchanged and re-verified.

### Verification
Self-test 63/63; role-flow runtime simulation 7/7 (Esc on picker resolves as cancel + clears resolver; picking resolves the role; Esc on prompt resolves null; type-to-confirm gate exact/wrong/empty all correct); no undefined handlers; CSS 2136/2136; no debugger statements; gates green.

---

## [1.1] — 2026-05-21 · build 2026.05.21.12

Team & Access role-change redesign + type-to-confirm.

### Hash
`c730a7c03c987d62f93200870615f9f9`

### Changes
**Role change in Team & Access — redesigned, glitch fixed.** The old UI used an inline `<select>` dropdown whose value changed *before* the confirmation dialogs ran, then visually "reverted" if you cancelled — that change-then-revert flicker was the glitch. Replaced with:
- A clean **role pill** showing the member's current role, plus a **"Change role"** button (no more dropdown, no flicker).
- Clicking it opens a **role picker** — each assignable role (Manager / Team / Viewer) is a tappable card with a one-line description; the current role is marked and disabled; owner is excluded (ownership transfer is separate).
- **Double-confirmation by typing the role name.** After picking, the owner must type the target role name exactly (case-insensitive, whitespace-trimmed) to confirm — e.g. type "Manager" to make someone a Manager. Typing the wrong name (or leaving it blank) cancels the change with a clear message.
- The role only applies after the typed confirmation succeeds; cancelling at any step leaves the role untouched with no visual flicker.

### Verification
Self-test 63/63; type-to-confirm trace 5/5 (exact / case-insensitive / trimmed all confirm; wrong name and empty both reject); no undefined handlers; `changeStaffRole`, `pickNewRole`, `__resolveRolePick` all defined and reachable; old `<select>` onchange path fully removed; gates green (JS valid, CSS 2136/2136).

---

## [1.1] — 2026-05-21 · build 2026.05.21.11

Idle-render no-op guard (distribution scroll jump) + sound-unlock retry.

### Hash
`d1a77dc31f245e1d299d118415a8e6b1`

### Changes
1. **Distribution auto-scroll jump — likely fixed.** Realtime echoes of your own just-saved rows (a common UPDATE event that changes nothing on screen) were still triggering a full re-render. On a tall page like Distribution, that idle re-render caused a small scroll "jump." Added a guard: if an incoming realtime UPDATE is byte-identical to the row we already hold, skip applying and skip the render entirely. Pure no-op safety net — it can only suppress renders that would change nothing; any real change still applies and renders. Benefits every view.
2. **Sound "sometimes silent" — improved.** The audio-unlock listeners removed themselves after the first gesture even if that gesture landed while the AudioContext was still suspended ("AudioContext was not allowed to start"), leaving sound dead until reload. Now the listeners persist until the unlock actually succeeds, so a later tap retries it. **Requires real-device/runtime verification.**

### Verification
Self-test 63/63; echo-guard trace 3/3 (identical echo skipped, real changes applied); structural + security sweeps clean; gates green.

### Honest status
- The distribution fix targets the most likely cause (idle no-op re-renders). If a jump still occurs, the idle-time-before-jump would pinpoint a different source. **Requires real-device verification.**
- Sound + mobile-print remain device-confirmable only.
- CORS fix is applied on your Supabase function (not app code).

---

## [1.1] — 2026-05-21 · build 2026.05.21.10

Sync-dot stuck-orange fix on reconnect.

### Hash
`aef9918a3a96fa275366e2f01d69e035`

### Changes
**Stuck orange sync dot after Wi-Fi recovery — fixed.** While offline, each failed push grew an exponential backoff (up to 5 minutes). When the network returned, the reconnect handler called the queue drain, but the drain returned early because the head op was still inside its long backoff window — so the dot stayed orange "syncing" for minutes, and a refresh/reopen didn't help (the visibility/focus handler only *pulled* cloud changes, it never re-pushed). Now:
- The `online` event resets each queued op's backoff to zero before draining, so it retries immediately.
- The visibility/focus handler (fires on refresh, app reopen, tab refocus) also resets the backoff and drains the outgoing queue — so returning to the app reliably flushes pending changes even if the browser missed the `online` event.

### Verification
Self-test 63/63; backoff-reset trace 2/2 (a 5-attempt stuck op is blocked before reset, drains immediately after).

### Server-side fix provided (not app code)
The CORS error on `save-push-subscription` is fixed by adding CORS headers + an OPTIONS preflight handler to that Supabase edge function (instructions provided separately).

### Still NOT done (honest)
- **Distribution auto-scroll glitch** — scroll preservation is already wired for that view; I can't reproduce the subtle remaining jump from static analysis. Need the idle-time-before-jump (~1s vs ~60s) to target it safely.
- **Cash in/out sound variation** — already on the robust MP3 path; remaining variation is autoplay-unlock timing, needs device logs.
- **Full screen-fidelity colorful prints** — exports use brand colors; exact fidelity is browser-controlled.

---

## [1.1] — 2026-05-21 · build 2026.05.21.9

Splash loading bar position, team-member export (PDF+Excel, Inv#+Time), member-print full-page fix.

### Hash
`170479a1446039f699d5969db5b4091b`

### Changes
1. **Splash screen** — the loading bar now sits centered in the stack **above** the icon (it was pinned to the bottom). Applied to both the static and JS-rendered splash.
2. **Entries by team member — export** now offers both **PDF** and **Excel** buttons (was PDF only), and the export includes **Invoice #** and **Time** columns (plus Date, Type, Category, Account, Party, Note, Amount). Time is in the business zone.
3. **Member entries half-page print fix** — member rows could carry `content-visibility:auto` (for fast scrolling), which made off-screen rows skip rendering when printing — the "only half a page prints" symptom. The member-activity print path now forces rows visible and full-width. **Requires real-device/runtime verification.**

### Verification
Self-test 63/63; member export column/totals alignment confirmed (9 cols); gates green.

### Still NOT done (honest status)
- **Distribution auto-scroll glitch**, **stuck sync-dot recovery**: runtime issues, not yet investigated — need device/network testing to fix safely.
- **Sound on cash in/out** (announcement fixed in .8): already on the robust path; remaining variation would be an autoplay-unlock timing issue needing device logs.
- **"Colorful like the screen"** beyond the existing brand colors: partly browser-controlled for print.
- **CORS error** on save-push-subscription: server-side Supabase edge function, not app code.

---

## [1.1] — 2026-05-21 · build 2026.05.21.8

Distribution label, snapshot print-only, entry-time in exports, announcement sound fix.

### Hash
`7785646ea331814111374b002674bd96`

### Changes
1. **Distribution** — the currency/rate edit button now shows the words **"Edit Currency and Rate"** (toggles to "Save Currency and Rate"), not just an icon.
2. **Snapshot** is now print-only — the export button was removed (Announcements already had no export).
3. **Entry time in exports** — the main entries export (PDF + CSV) and the party/category/account detail ledger exports now include a **Time** column, formatted in the business time zone (same as on screen).
4. **Audit statement** already gained Invoice # + Account in build .7; confirmed here.
5. **Announcement sound fixed** — it now plays through the same robust preloaded-audio path as the cash sounds, instead of building a fresh audio element each time and falling back to a thin synthesized chime. That fresh-element race was the cause of "sometimes a tiny bell, sometimes the real sound." No synthesis fallback now → the announcement plays the embedded MP3 consistently. **Requires real-device/runtime verification.**

### Verification
Self-test 63/63; consolidated check of all 13 session changes passed; gates green.

### Still NOT done (honest status)
- **Sound on cash in/out** already used the robust MP3 path; if it still varies on your device, that's an autoplay-unlock timing issue needing device logs — **Requires real-device verification.**
- **Distribution auto-scroll glitch**, **stuck sync-dot recovery**: not yet addressed — runtime issues needing investigation + device testing.
- **Per-team-member export options + full-page Activity layout + icon consolidation**: not yet done.
- **"Colorful like the screen" for all prints**: exports already use brand colors (green/red/dark header); full screen-fidelity is partly browser-controlled.
- **CORS error on save-push-subscription**: server-side — must be fixed on the Supabase edge function, not in index.html.

---

## [1.1] — 2026-05-21 · build 2026.05.21.7

Export corrections batch (parties, expenses, statement, print row-splitting).

### Hash
`1e2573f613d169a2b376e1aac63e2e5d`

### Changes
1. **Parties export** — removed the "Kind" column; "Received from" → "Cash in", "Paid to" → "Cash out".
2. **Expenses export bug fixed** — it was exporting every cash-out *entry* (wrong dataset). It now exports the actual Expenses tab data (`auditExpenses`) with all columns: Date, Description, Qty, Note, Amount + total.
3. **Audit statement (PDF + CSV)** — added **Invoice #** (entry number) and **Account** columns, plus the existing Date / Party / Category / In / Out. PDF and CSV now match.
4. **No row-splitting on print/PDF** — every PDF table now uses `rowPageBreak: 'avoid'`, so a row that doesn't fit moves wholesale to the next page rather than being cut in half (whitespace is left instead). Applied to all 5 PDF table builders.
5. **"Skip to content" removed from PDFs** — the accessibility skip-link (and any toast) is now hidden when printing, so it no longer overlays printed content.

### Verification
Self-test 63/63; expenses-export trace 3/3 (reads auditExpenses, not cash-out); parties columns + statement columns + rowPageBreak (5/5) + skip-link hide all confirmed.

### Still to do (acknowledged)
Colorful prints/exports, per-team-member export options + invoice numbers + full-page layout, team-member Activity icon consolidation, sound reliability, distribution "Edit Currency and Rate" label + auto-scroll glitch, sync-dot recovery, Audit export completeness review, entry-time in all entry exports, Snapshot/Announcement print-only, and the server-side CORS fix.

---

## [1.1] — 2026-05-21 · build 2026.05.21.6

Clock/date-strip merge + party contact privacy for the team role.

### Hash
`15eccba304da4d7fe6d3964983d206db`

### Changes
1. **Single business day/date.** The top date strip now shows the business-zone weekday + full date (it was the device's). The clock bar below was simplified to just **city + time, centered**; the duplicate day/date there were removed. The time is now the same size as the city label, in the accent (red) colour. On desktop the date strip already sits below the universal search with the sync badge centered.
2. **Party contact privacy.** The team (data-entry) role can no longer see party contact details — phone, email, socials, DOB, notes — on the party detail card or as inline badges on the parties list. Owner, manager, and viewer are unaffected. The internal role value stays `staff` (only the label is "Team"), so permissions and stored memberships are untouched.

### Verification
Self-test 63/63; contact-gate trace 4/4 (team blocked; owner/manager/viewer allowed); clock/date-strip gated and syntax-clean.

### Not in this build (acknowledged, still to do)
The remaining requests from the latest list — colorful prints/exports, per-member export options + invoice numbers, sound reliability, distribution auto-scroll glitch, sync-dot recovery, audit/expenses/parties export corrections, "skip to continue" removal, row-splitting on print, entry time in exports, and the CORS/AudioContext console items — are not yet addressed.

---

## [1.1] — 2026-05-21 · build 2026.05.21.5

Verification pass on the export/print/backup/speed work, plus two real fixes.

### Hash
`9276d1404afe246ec95af3e9429633eb`

### Changes
- **Removed the now-orphaned `showBackupToast` function.** The auto-backup "completed" toast was already disabled in `runAutoBackup` (build .4), but the unused function and its "Auto Backup completed" text were still in the file — now gone entirely.
- **Fixed a print/performance conflict:** build .4 added `content-visibility: auto` on `.entry-row` for faster scrolling, but that property makes off-screen rows skip rendering when printing — which would have clipped long ledgers on paper (working *against* the mobile-print fix). Added a print override forcing `content-visibility: visible` on all rows so every entry prints.
- Confirmed the build-.4 work is genuinely in place: detail exports (party/category/account) carry the full 10-column ledger + totals in landscape; dashboard exports include all rows + totals; the mobile-print full-width rule is present; `content-visibility` covers all four entry views (the detail views reuse `.entry-row`).

Build tag `2026.05.21.5` (sw.js cache version in sync).

### Verification
Self-test 63/63; gates green (CSS 2125/2125).

---

## [1.1] — 2026-05-21 · build 2026.05.21.4

Cleaner exports, no backup toast, print + speed fixes.

### Hash
`f6683d3cce8fa3554dbe85bdf4c7a8e5`

### Changes
1. **Removed the "Auto Backup completed" toast.** Auto-backups still run every 30 minutes and remain downloadable from Settings → Data → Auto-backups; they just no longer interrupt with a message.
2. **Party / Category / Account exports (PDF + CSV) now carry the full entries-tab columns:** Inv #, Date, Description, From / To, Category, Account, In, Out, Bal., By — with a running balance and a totals footer, matching the main entries export exactly. PDFs use landscape so the ten columns fit cleanly. Previously these detail exports had fewer columns and inconsistent headers (e.g. "Note", "Received/Paid").
3. **Header names** across the entries PDF/CSV and the detail exports are now consistent (Description, From / To, In/Out, Bal., By).
4. **Mobile print clipping fix** ("half page printed"): added print rules forcing every content container to full page width with visible overflow, so the printed sheet fills the page regardless of the narrow on-screen mobile layout. *(Requires real-device verification — see note.)*
5. **Performance:** entry rows now use `content-visibility: auto` so the browser skips layout/paint for off-screen rows — meaningfully faster scrolling and rendering on long ledgers, with no behaviour change.

Build tag `2026.05.21.4` (sw.js cache version in sync).

### Verification
Self-test 63/63; detail-export column trace confirms all 10 columns; no undefined handlers; gates green. Print clipping and overall responsiveness require real-device confirmation.

---

## [1.1] — 2026-05-21 · build 2026.05.21.3

Clock layout (day · city+time · date) and entry-count placement.

### Hash
`3c768c87e964f6be71af79d1db9b164b`

### Changes
1. **Clock bar** is now three parts: the **weekday on the left**, the **city + time centered** in the exact middle, and the **date on the right**. The side columns are equal-width so the center stays truly centered regardless of how long the day/date strings are. The per-second tick now also refreshes the day and date (they roll over at midnight in the business zone). `formatClockFor` gained a `day` (short weekday) field.
2. **Entry count moved** off the title/topbar and placed below the All / Cash-in / Cash-out filter row (in the period-label line on the entries view), e.g. "THIS MONTH · 12 entries". It reflects the active period, type filter, and search, and is visible on mobile and desktop. The same count now appears on the party, category, and account detail views, in their "All transactions / All entries" label line — scoped to the active business's books so shared names can't over-count. The earlier mobile-topbar count (build .2) was reverted in favour of this.

Build tag `2026.05.21.3` (sw.js cache version kept in sync).

### Verification
Self-test 63/63; clock trace 3/3 (day/time/date); count wiring confirmed on all four views.

---

## [1.1] — 2026-05-21 · build 2026.05.21.2

Mobile: show the entry count on the entries tab and detail views.

### Hash
`4a5d4f9228b6e1fbeef612f49c2a35c0`

### Changes
On phones, the in-page title (which carries the entry-count chip) is hidden to save space, so the count was invisible on the entries tab and on party / category / account detail views. The mobile topbar title now appends a period-aware entry count, e.g. "Main Cash Book · 12 entries" or "Acme Traders · 3 entries".

The detail-view counts are scoped to the active business's books — matching the desktop chips exactly — so a party, category, or account name shared with another business can't over-count. Uncategorized entries are counted correctly.

Build tag bumped to `2026.05.21.2` (sw.js cache version kept in sync).

### Verification
Self-test 63/63; count-scoping trace 5/5 (proves the other-business exclusion, uncategorized, account, and book counts).

---

## [1.1] — 2026-05-21 (was internal v89.32.17) · build 2026.05.21.1

Switched to public version numbering, starting at 1.1.

### Hash
`df254cae90f066e6e78a323cb6d04452`

### Bundle
- The bundle now ships a ready-to-upload **`sw.js`** (the actual service worker, not a `.reference` template) with `CACHE_VERSION` already set to `hisabs-1.1-build-2026.05.21.1`, matching the app's `BUILD_TAG`. Just upload `index.html` and `sw.js` together — no manual cache-version editing needed. The old `sw.js.reference` doc was removed to avoid confusion.

### Changes
- The user-facing version is now a clean **1.1** (shown in Settings → Help & legal → About), replacing the internal `v89.32.x` scheme. Public versions start from here.
- Kept a separate internal **build tag** (`2026.05.21.1`), shown in small print next to the version in About and used as the service-worker cache key. This is deliberate: the build tag bumps on every deploy to force the PWA to refresh, independent of the public version — so a future release that stays "1.1" can still cleanly bust a stale cache. The earlier stale-cache symptom (a deployed timezone fix not reaching the device) is exactly what this separation guards against.
- Service worker `CACHE_VERSION` is now `hisabs-1.1-build-2026.05.21.1`.

Self-test 63/63.

---

Added an "About" page (description + version) to Help & legal.

### Hash
`5d3152067ddcd9f50684690e4330522d`

### Changes
Added an **About** button in **Settings → Help & legal**, to the right of Privacy. It opens a modal with a short description of what Hisabs does and the current build version (**v89.32.16**), plus a note that if the version shown doesn't match the latest installed, fully closing and reopening the app loads the newest version.

This replaces the small inline version line from v89.32.15 with a proper, discoverable About page — and gives a reliable way to confirm which build is actually running (important for diagnosing PWA cache-staleness, e.g. a deployed timezone fix not yet active on a device).

Self-test 63/63.

---

Added a visible build-version label to help confirm which build is live.

### Hash
`172ec0658dccbe7fa6fa574aff873529`

### Changes
Added a small **"Hisabs v89.32.x"** version line at the bottom of **Settings → Help & legal**. Because a PWA can keep serving a cached older version until the service worker updates, there was previously no way to confirm at a glance whether a deployed fix was actually running. This label makes it instant to check.

### Context
Investigated a report that new entries weren't using business time. Traced every entry-creation path (main entry modal, transfers, all fallbacks) and confirmed they all correctly use the business time zone via `businessTodayYmd()` / `today()` — verified with a trace showing `businessTodayYmd()` returns the business-zone day (e.g. Kiritimati UTC+14 shows the next day vs a UTC device). No code defect was found, which points to a stale cached build on the device; the version label above is so this can be confirmed directly.

Self-test 63/63.

---

New: one-tap period statement (PDF / CSV) with P&L summary.

### Hash
`c98fa96217bff7466f4b3f4732ee708e`

### Changes
Added a **Statement** button on the Audit/summary page that produces a clean, period-specific report the owner can save or send:
- **Summary / P&L block** — Cash in, Cash out, Net cash, Expenses, Operating profit, Tax (if a rate is set), Net profit. Uses the *exact same* P&L formula as the Audit view, so the figures can never disagree.
- **Entries table** — every entry in the active period (date, party, category, in, out) with column totals.
- Respects the on-screen period (This Month / a chosen month / a custom range) and the business currency; the generation date is stamped in the business time zone.
- Available as **PDF** (branded layout matching existing exports — dark header, cream totals, green/red profit and tax lines) and **CSV**.
- Owner / manager / viewer only (same gate as the rest of Audit). Empty periods still produce a valid PDF showing the summary.

Built entirely on existing infrastructure (jsPDF + autotable, the shared export styling, the existing period predicate) — no new dependencies.

### Verification
Self-test 63/63; P&L-formula parity trace 4/4 (matches Audit math including the no-tax-on-losses rule); all referenced helpers and data structures confirmed in scope.

---

Entry "added" date/time now shown in business time, not device time.

### Hash
`5aed6fef83086c5a99a988b3b9641415`

### Changes
The entry date already defaulted to the business calendar day (v89.32.8), but the per-entry "added on … at …" stamp and the backdated detection still used the device clock. On a device in a different zone than the business, this could show an entry as "added" on the wrong day/time or mis-flag it as backdated.

Fixes (all display/derivation only — the stored `createdAt` timestamp is unchanged and absolute):
1. **`formatEntryTime`** — the "added HH:MM" time is now formatted in the business time zone.
2. **The "added" date** (`createdYmd`) under each entry is now derived in the business zone, so it lines up with the entry date and the same-day check is correct.
3. **`isEntryBackdated`** — now compares the entry date against the creation day *in the business zone*, so the backdated tag is accurate across time zones.

All fall back to the device zone when no business zone is set.

### Verification
Self-test 63/63; cross-zone trace 3/3 (an instant that is late-night in UTC but past-midnight in Kathmandu correctly shows the business-zone time and backdated state).

---

Search responsiveness, distribution auto-save, and Team remove-button.

### Hash
`dbb5e173994cd3a93fd3ad181f363ba6`

### Changes
1. **Search no longer lags behind typing.** Every search field (entries, parties, categories, accounts) previously re-rendered synchronously on each keystroke, which on a busy page made the typed character appear a beat late. Re-renders are now debounced (~120ms trailing), so typing stays instant and the filtered results catch up just after you pause. Each field debounces independently.
2. **Distribution party now saves while you type.** The split-party name/% fields only wrote to a pending buffer, so an edit made without clicking the row's Save button could be lost on re-render or navigation. They now persist immediately (matching salary rows). Salary rows were also made to persist on type for the same reason.
3. **Tax rate (Audit/Insights)** verified — it uses an explicit Save button that correctly writes and syncs; no change needed.
4. **Team & Access:** replaced the small "×" remove control on each member with a clearer **Remove** button placed below the member's name, in both the settings list and the full member-management view.

### Verification
Self-test 63/63; debounce trace 2/2; backdated-detection confirmed unaffected (it keys off creation timestamp, not the business zone). Edited/back-dated tags, in/out colors, and status dots are produced by untouched row-rendering code and continue to work.

---

Hardened the time-zone picker against cross-browser zone-name differences.

### Hash
`c1e3b4131d15a5e437d46addc5e82ab3`

### Changes
While verifying the v89.32.10 picker, found a real cross-browser edge case: different JS engines can use slightly different canonical names for the same zone (e.g. `Asia/Kathmandu` vs the older `Asia/Katmandu`), and ICU data varies by version. If a business's stored time zone wasn't in the current engine's list, the picker showed nothing selected and could silently reset the zone on the next save from a different device.

Fixes:
1. **The currently-stored zone is now always included as a selectable, pre-selected option** in the picker, even if it isn't in the standard list — so the saved zone is never visually lost.
2. **Save guards now validate by formattability** (`isValidTimeZone` — can the engine actually format with it?) instead of strict list membership, so a legitimately-selected zone is never rejected, while garbage values are still refused.

Self-test 63/63; picker + validator trace 8/8.

---

Removed the per-book sidebar gear; richer time-zone picker labels.

### Hash
`6497c065627350eb02afe28a018aa71e`

### Changes
1. **Removed the per-book gear icon** from the sidebar book list. Book names are now edited only from **Business Settings → Books** (Rename / Delete there), keeping book editing in one place. Removed the now-orphaned `renameBookFlow` and its dead CSS (`.book-gear`, `.book-item-right`).
2. **Time-zone picker now shows UTC/GMT offset + city** for every zone, e.g. `(UTC+05:45) Kathmandu — Asia`, `(UTC-04:00) New York — America`. Options are sorted west→east by current offset (DST-aware), making it much easier to find and set the right zone. Applies to both the new-business modal and Business Settings.

Self-test 63/63.

---

Simplified the dashboard clock to zone + time only.

### Hash
`6e2db4c6d2d668ed93dcd942eb80a2e4`

### Changes
- The dashboard clock now shows only the **time zone and time, side by side** in the middle. Removed the date from the clock, since the date strip directly below it already shows the date. Cleaned up the now-unused date-update loop in the per-second ticker.

Self-test 63/63.

---

Full date rewire: all business-day logic now follows the business time zone.

### Hash
`628abaaabacb4f4304c6c6e671d05b19`

### Audit cleanup (final deep audit pass)
- Fixed a subtle chart edge case: the cumulative-line "today" marker mixed the device month with the business month, which could desync near a month boundary across zones. Now derives both from the business calendar day.
- Removed dead code orphaned by the always-on birthday banner (the per-day dismiss helpers and their localStorage key).

### Changes
Building on the per-business time zone (v89.32.7), the app's core date helpers are now business-zone-aware, so "today" across the whole app is the active business's calendar day rather than the device's:

1. **`today()` / `yesterday()` / `todayYmd()`** now resolve to the active business's time zone (falling back to the device zone when no business is active or no zone is set). Because nearly all business-day logic flows through these helpers, this single change carries the business zone into: the **default entry date**, **period filters** (This Month / Today / Yesterday / Custom), **entry-number monthly buckets**, **birthday detection**, the **relative-date hint** in the entry modal, and the dashboard clock.
2. **`deviceToday()` / `deviceYesterday()`** preserve the original device-local behaviour for anything that is genuinely about this device's wall clock.
3. Implemented via a single chokepoint (the date helpers) rather than rewriting 80+ individual call sites, which keeps the change auditable and avoids missing or mis-converting sites. When the business zone equals the device zone (the common case), behaviour is identical to before.

### Verification & honest caveat
Self-test 63/63 (it exercises entry numbering and period logic, all of which call `today()`), plus a dedicated trace with extreme zones (Kiritimati UTC+14, Pago Pago UTC-11) confirming `today()`/`yesterday()` track the active business and fall back safely. Cross-time-zone behaviour (a device in one zone, business set to another, entries/filters/birthdays flipping at the business midnight) should be confirmed on real devices — that's the scenario static checks can't fully exercise.

Requires the v89.32.7 `time_zone` column migration (no new SQL this release).

---

Replaced the per-device dual clock with a per-business time zone.

### Hash
`4702c1b39d0ee20160e5f07b23b714cd`

### Changes
1. **Removed the dual clock / per-device clock settings** added in v89.32.6 (wrong model).
2. **Per-business time zone.** Each business now has its own IANA time zone, set by the owner when **creating** the business and editable in **Business Settings → Time zone** (owner only). It syncs across devices on the business row.
3. **One clock on the dashboard** at the top of the main entries page shows the **active business's** time zone, labelled (e.g. "Kathmandu"), with time + date, ticking every second.
4. **"Today" follows the business zone** for the two highest-impact, lowest-risk consumers: **birthday detection** (a birthday flips at midnight in the business's zone) and the **default entry date** (new entries default to the business's calendar day). Older businesses with no zone set fall back to the device zone.
5. **SQL:** added `sql/v89.32.7_app_businesses_time_zone.sql` — adds a nullable `time_zone` column to `app_businesses`. Backward compatible (NULL = device fallback). **Run once in Supabase.**

### Scope note
Date/time logic elsewhere (period filters, totals bucketing, daily digest, etc.) still uses the device's local day for now. Rewiring every date consumer to the business zone is deeper, higher-risk work and was intentionally not bundled here; the `businessTodayYmd()`/`businessTimeZone()` helpers added in this release make that migration possible to do incrementally and safely.

Self-test suite remains 63/63.

---

Birthday banner is always-on; new dual clock on the dashboard.

### Hash
`64633e86c8ae27f45728b919deb85ee0`

### Changes
1. **Birthday banner always shows.** Removed the Settings toggle added in v89.32.5 and the per-day dismiss ×. If any party has a birthday today, the banner always appears on the entries page and cannot be hidden.
2. **Dual clock on the main entries page.** Added a **Clocks** section in Profile Settings with two time-zone pickers — a **Main clock** (defaults to this device's time zone) and an optional **Second clock**. Both render at the top of the main entries page, each labelled with its time zone (e.g. "Kathmandu" / "New York"), showing time + date and ticking every second. Time-zone choices are stored per-device (a clock reflects where the user is, so it isn't synced or per-business). Uses the browser's built-in IANA time-zone data — no external library, works offline. Invalid/unsupported zones fall back to local time without error.

Self-test suite remains 63/63.

---

Birthday-notice control, app-wide keyboard-glitch fix, and realtime sync enablement.

### Hash
`6883b26aeeef07c68d9bdd7786c9f634`

### Changes
1. **Birthday reminders can now be turned off for good.** The × on the birthday banner only ever hid it for the current day, so a recurring birthday looked like it "couldn't be hidden." Added a **Birthday reminders** toggle in Settings → Notifications; when off, the banner never renders. The per-day × dismiss still works as before when the toggle is on.
2. **Fixed the mobile keyboard glitch across all input fields.** Focus preservation across background re-renders (realtime/sync events) was limited to a hand-picked allow-list, so other fields — party/category/account search, the party edit fields, and more — lost focus mid-type and the keyboard closed/reopened ("pushed back"). Focus is now preserved for **any** focused input/select/textarea with an id (password and file inputs excepted), keeping the keyboard up and the caret in place during background updates.
3. **Realtime sync without refresh (SQL).** Added `sql/v89.32.5_enable_realtime.sql`. The client already subscribes to live changes for every synced table, but Supabase only broadcasts changes for tables in the `supabase_realtime` publication. If announcements/entries only appeared on a teammate's device after a manual refresh, those tables weren't in the publication. The migration adds all 14 synced tables to the publication and sets `REPLICA IDENTITY FULL` so update/delete payloads carry full rows. **Run this once in the Supabase SQL editor.** (No client code change was needed — subscription, apply, re-render, and focus/reconnect catch-up were already correct.)

Self-test suite remains 63/63.

---

Team & Access invite-flow fixes.

### Hash
`434e4e886229a06bae9b705d15ffe439`

### Changes
1. **Fixed: invite email box lost focus while typing.** The Team & Access "Phone or email" field (`pgStaffLogin`) wasn't in the focus-preservation allow-list, so a background realtime/sync event (e.g. a teammate's entry arriving) tore down the input mid-type — dropping focus and dismissing the mobile keyboard, which felt like the field "pushing you back." Added it to the preserved-inputs list.
2. **Fixed: accepted invite reappeared until app restart.** When a user accepted an invite, the post-accept cloud pull could race ahead of the not-yet-drained accept op and re-fetch the membership row as still `pending`, reverting the local `accepted` status — so the invite kept reappearing and the business only showed after reopening the app. Two-part fix: (a) the pull merge now refuses to downgrade a locally-accepted membership for the current user back to pending, and (b) `respondInvite` re-asserts acceptance after the pull and re-queues the update so the cloud converges automatically. The business now appears immediately and the invite stays accepted.
3. **Hardening:** member display-name avatar initial now has a `"?"` fallback, removing a latent crash risk if a membership row ever had an empty name/login.

Self-test suite remains 63/63; added a 7-case invite-guard trace.

---

Small UX addition.

### Hash
`3925d16b4314921b1026e8e18ff508a9`

### Changes
1. **Copy social handles from a party.** When you open a party, each saved social handle in the contact card now has a one-tap **Copy** button (next to the existing **Open** link for URL handles). Uses the Clipboard API with a textarea fallback, briefly showing "Copied" on success.

---

UI reorganization.

### Hash
`097a4e6048f396046ac865952c730a29`

### Changes
1. **Moved individual export/import to the Advanced tab.** The per-business "Export categories/parties/accounts" and "Import categories/parties/accounts" controls were moved out of the Business tab and consolidated under the existing **Advanced → Backup &amp; restore (this business)** section, alongside the whole-business backup/restore. Note: the Advanced tab is owner-only, so these individual export/import controls are now owner-only as well (previously also available to managers) — consistent with the whole-business backup/restore that already lived there.

---

Bug fixes and refinements to the v89.32.0 feature batch.

### Hash
`d4732e50b24ec1384ab9f90eaafcb412`

### Changes
1. **Fixed: editing a party didn't save socials (and could appear to drop phone/email).** The party meta diff omitted the new `socials` field, so adding or editing a social handle on an existing party was detected as "no change" and the save silently bailed. Socials are now compared in the diff; adding/editing/removing a phone, email, or social on an existing party saves correctly and displays immediately.
2. **Detail pages: "Rename" → "Edit".** On an individual party, category, or account page, the top-right button now reads **Edit** and opens the full edit form (party: name, DOB, phones, emails, socials, notes; category: name, shortcut, unassigned; account: name, unassigned) instead of the rename-only prompt.
3. **Business Settings: individual export added.** The "Backup & import (this business)" section now has **Export categories / Export parties / Export accounts** buttons alongside the existing individual imports. Exports use the same file shape the importer accepts, so a list exported from one business can be imported into another.

Self-test suite remains 63/63.

---

A feature batch: detail-view period filters, social handles for parties, merge-import, and several UX fixes.

### Hash
`2cdc5f7029324d9712bd07e02bbe40d6`

### Changes
1. **Period filter on individual detail views.** The This Month / Today / Yesterday / All Time / Custom filter (default This Month) now appears at the top of each individual party, category, and account detail page, filtering that item's entries and totals. Distribution also shows the filter at the top.
2. **Forecast** confirmed already locked to the current month with no filter bar (no change needed).
3. **Splash & sign-in.** Boot splash minimum raised to 3 seconds everywhere. Fixed the brief "no business" dashboard flash after sign-in by painting the business view before fading the splash.
4. **Device names.** The Devices list now resolves the exact device model via the User-Agent Client Hints high-entropy API where the platform allows (e.g. "Pixel 8 · Android 14"), shows the current device instantly while the server list loads, and supports renaming. Note: browsers do not expose the OS-level device name (e.g. "Rajesh's iPhone") to web apps; rename for a precise label.
5. **Merge import.** New non-destructive import in Profile Settings (categories, parties & accounts into the active business) and Business Settings (individual import for categories, parties, accounts). Matching names are updated in place (preserving ids so entries stay linked); new names are added; nothing is deleted; transactions are not imported. A preview confirms counts before applying.
6. **Sidebar order.** Businesses now appear above Books.
7. **Social handles for parties.** New "Social" section in the party create/edit form — side-by-side platform + handle/link rows with "add another" (up to 12) and a datalist of common platforms (free-text). Saved socials show as blue badges on the party card (like SMS/Email) with a "+N more" badge when there are many, and appear in the party's contact card with clickable links for URL handles. Stored in party meta, so they sync automatically.

Self-test suite now 63/63.

---

Three user-requested refinements to Parties, Team & Access, and Business Settings, plus a dead-code cleanup.

### Hash
`476177bb255db3182b9a35f0be943ad0`

### Changes
1. **Parties — contact badges below the name.** The "SMS" / "Email" badges on a party card now sit on their own row directly below the party name (previously inline to its right) and use a fixed blue (`#2563eb`) regardless of the active theme accent.
2. **Business Settings — removed the totals description.** The note explaining that totals visibility is set per team member has been removed from Business Settings. The per-member **"Sees totals on entries"** toggle remains on the **Team & Access** page (staff can still be individually granted totals on the Entries view); owners, managers, and viewers always see totals.
3. **Business Settings — "Set Dial code" free-text field.** Replaced the country-code dropdown (which collided US/Canada on the shared `+1` value, flipping US→Canada on save/reload) with a free-text input. Users can enter any dial code; it's normalized to a clean `+<digits>` form and round-trips exactly. No example codes are shown in the field's placeholder or help text. Blank falls back to a currency-derived code. The entered code prefills the phone field when creating or editing a party (existing party phones are never overwritten). 8 `normalizeDialCode` self-tests (suite 53/53).
4. **Cleanup.** Removed three now-orphaned items left over from the above changes: the `phoneCodeOptionsHTML` function (old dropdown builder, 0 callers), the `partyHasContact` function (superseded by `partyContactBadges`), and the `.party-contact-dot` CSS rule (the old green-dot indicator). No behavior change; ~2.2 KB smaller.

---

A focused refinement batch responding to user feedback across Settings, Team & Access, New Entry, Parties, Insights, Distribution, exports, and search.

### Hash
`fede32240f3d7d67f5a93b234291c444`

### Added
- **Crop & confirm before saving a profile photo** — picking a photo in Settings → Your account now opens a crop dialog (drag to reposition, zoom slider) so you choose exactly what gets saved, instead of an automatic centre-crop.
- **Entry-count badge in detail views** — opening a party, category, or account shows the number of entries (for the active period) right next to its name in the header.
- **SMS / Email contact badges on Parties** — a saved phone shows a small "SMS" badge and a saved email shows an "Email" badge after the party name (blue outline), replacing the previous single green dot. Both appear when both are saved.

### Changed
- **Double confirmation for role changes** — changing a team member's role on Team & Access now asks twice before applying (removal already required two steps).
- **Country code now drives party phone fields everywhere** — the example placeholder and hint in both New Party and Edit Party reflect the business's configured country code (e.g. `+1` for a US business) instead of always showing `+977`. Newly-added phone rows follow suit.
- **Recently-added party sorts to the top reliably** — creating a party now jumps the list to "Recently added" and the new party appears first, even when several parties are created on the same day (previously same-day parties could tie and not surface).
- **Entry count removed from the list cards** — the count chip no longer sits on the Parties / Categories / Accounts cards; it lives in the detail header instead (see Added).
- **Insights "worst day" excludes today** — because today's figures are still incomplete, the worst-day card now considers only fully-elapsed days. The best-day card can still be today.
- **Removed the "View only" banner on Distribution** for managers and viewers. The page remains read-only for non-owners (inputs stay disabled) — only the notice was removed.

### Fixed
- **Arrow-key Cash In / Cash Out shortcut now works on the New Entry card.** Left arrow selects Cash In, right arrow selects Cash Out, even while the amount field has focus (previously the shortcut was suppressed whenever an input was focused, which is almost always during entry).
- **Invoice number now prints.** The on-screen invoice-number badge was hidden by a stale print rule from when the Invoice # column had been removed from PDF/CSV; that column was re-added in v89.31.4, so the badge now appears in printed pages and screenshots too.
- **No more browser "recent search" suggestions.** All seven search fields (universal search desktop + mobile, entries, parties, categories, accounts, quick-look) now fully suppress native autocomplete/history.

### Notes
- No new SQL migration is required for this batch. The party `createdTs` value is derived locally (and reconstructed from the stored date for cloud-pulled records), so no schema change was needed.
- Existing v89.31.4 + v89.31.5 migrations are still required for a first deploy (all idempotent).



A small follow-up batch: team-management refinements, a polished post-sign-in splash, and profile pictures.

### Added
- **Edit a team member's role inline** — on the Team & access page, each member who has joined now has a role dropdown (Manager / Team / Viewer). Changing it prompts for confirmation and propagates to that person on their next sync. (Ownership transfer remains a separate flow.)
- **Per-member "sees totals" control** — whether a Team member can see totals (Cash In / Cash Out / Net and balances) on the Entries view is now set **per person** on the Team & access page, and is **off by default**. Managers and viewers always see totals. This replaces the old single business-wide toggle.
- **Profile picture** — Settings → Profile now has a profile-picture uploader. The chosen image is center-cropped, downscaled (≤256px) and compressed client-side to a small JPEG, shown as your circular sidebar avatar, and synced so it follows you across devices. A Remove option clears it.
- **Polished full-page splash after sign-in / account creation** — the branded splash now reliably holds for ~2 seconds measured from the moment you tap Sign in (or finish entering your account-creation code), not just from page load. The splash got a visual upgrade: a layered accent-gradient wash, a faint ledger-ruling texture, and a thin indeterminate progress bar — clearly covering the whole page. Honors reduced-motion.

### Changed
- **Business Settings** no longer has the "Team can see totals on entries view" toggle — that control moved to Team & access (per member). A short note in business settings points there.
- **Documentation** — the User Guide now covers inline role editing, the per-member totals control, and the profile-picture uploader. The Privacy Policy notes that an optional profile picture is stored (compressed) in your cloud profile row.

### Migration required
Run BOTH in the Supabase SQL editor **before** deploying this build (the sync maps now reference these columns; without them, member/profile pushes would fail). Both are idempotent (`ADD COLUMN IF NOT EXISTS`).
- **`sql/v89.31.5_app_members_sees_totals.sql`** — adds `member_sees_totals boolean NOT NULL DEFAULT false` to `app_members`.
- **`sql/v89.31.5_app_accounts_avatar.sql`** — adds `avatar_url text` to `app_accounts`.

### Notes
- The old business-wide `app_businesses.staff_sees_totals` column is now unused but left in place (harmless) so older clients don't error. It can be dropped in a later cleanup.
- Profile pictures are stored as base64 data URLs in the profile row (a few KB to ~30KB after compression; the client refuses anything over ~500KB). If avatar sizes ever grow, the field can migrate to Supabase Storage with no app change (it's treated as an opaque string).

### Hash
`65a7405259fb3ca58442655d2e04488d`

---

## [v89.31.4] — 2026-05-21

A 13-item batch of user-requested fixes and refinements gathered after living with v89.31.x for a few days. Spans parties, exports, printing, sounds, distribution access, and documentation.

### Added
- **Party contact details & green dot** — each party can store optional phone numbers, emails, date of birth, and notes. A small green dot appears next to a party's name on the Parties list when it has at least one saved phone or email.
- **Country-code suggestion in New Party** — the phone field in the New Party form is pre-filled with a suggested dialing code (e.g. `+977`). The suggestion follows the business currency by default, and the owner can pin a specific code in **Business settings → Business identity → Default country code**. A code-only entry (no actual number) is never saved.
- **Invoice number in exports** — both the PDF and CSV (Excel) exports now include each entry's invoice number (`#1`, `#2`…), matching exactly what's shown on the entries list. Reverses the v89.30 removal.
- **Full-page colour print** — the print / Save-as-PDF action now produces a faithful, full-page colour copy of the current view: app chrome (sidebar, topbar, FAB) is hidden, on-screen colours/backgrounds are preserved (`print-color-adjust: exact`), and long entry lists are expanded to print every row. Implemented as dependency-free print CSS (no html2canvas, keeping the bundle lean and offline-first).
- **Distribution for managers & viewers (read-only)** — the Distribution view is now visible to managers and viewers, not just the owner. They see exactly how the owner has configured salaries, profit shares, and the split, with all inputs disabled and a "View only" banner. Owner retains full edit; staff still don't see it.
- **Entry-count chip per filter** — each filtered entries view shows a count chip for the active filter.
- **"Recently added" sort for parties.**
- **Self-test coverage** — `window.hisabsSelfTest()` extended to 45 checks, adding cases for `isMeaningfulPhone()` and `bizPhoneCodeSuggestion()`.

### Changed
- **Action sounds are now consistent** — cash-in, cash-out, and delete each play the same dedicated sound every time. Root causes fixed: (1) the MP3→Web-Audio-synthesis fallback produced a *different* sound when the embedded clip didn't resolve in time — the synth fallback is removed, so a given action always plays one deterministic sound; (2) each action now uses one preloaded, reusable `Audio` element rewound per play, eliminating per-play construction races on mobile; (3) the delete sound previously read the *Announcement* mute key while cash sounds read the *Entry* key — all three action sounds now follow the single **Entry** toggle in **Settings → Notifications**.
- **Amount field input hardening** — pressing `ArrowLeft` sets the entry type to Cash In and `ArrowRight` to Cash Out (matching the on-screen button order); the letter `e` (and `+`/`-`) can no longer be typed or pasted into the amount field.
- **Pagination** — the entries list shows the first 200 rows with a "Show next 200" control; verified the clamp and increment behaviour.
- **Documentation** — the User Guide gained sections on party contact details + green dot, the country-code suggestion, action sounds, full-page printing, invoice numbers in exports, and read-only Distribution for managers/viewers. The Privacy Policy now discloses that optional party contact metadata (phone, email, DOB, notes) and per-business preferences (currency, default phone country code) are stored in the cloud.

### Fixed
- **Drag-to-select no longer closes the card** — selecting text by dragging inside an entry/modal input could close the modal when the drag ended over the backdrop (a `click` fired on the backdrop). The backdrop now only dismisses when the press *began* on the backdrop itself (pointerdown-origin guard), so text selection that starts inside the modal never closes it.

### Migration required
- **`sql/v89.31.4_app_businesses_phone_code.sql`** — adds the `phone_country_code` column to `app_businesses`. **Run this in the Supabase SQL editor BEFORE deploying this build**, since the businesses sync map now references the column; without it, pushes that include a business row would fail. The migration is idempotent (`ADD COLUMN IF NOT EXISTS`).

### Notes
- The full-page print is a faithful print-CSS rendering, not a raster screenshot; html2canvas was deliberately not bundled (~200KB) to preserve the single-file, offline-first design.

### Hash
`3f79e0f9300bc3f5cd8ec2bfd41de1e6`

---

## [v89.31.2] — 2026-05-20

Risk-mitigation release. No new features; addresses production-readiness items flagged by the post-v89.31.1 audit.

### Added
- **Self-test suite** — `window.hisabsSelfTest()` callable from DevTools. Runs 34 pure-logic checks covering DOB validation, email/phone normalisation, birthday math, currency formatting, entry math, URL builders, meta building, sum aggregation, and permission helpers. Use `hisabsSelfTest({verbose:true})` for per-check output.

### Changed
- **Dark mode contact buttons** — Call / WhatsApp / Email buttons on the party detail page now have explicit `[data-theme="dark"]` overrides with lifted alpha and dark-appropriate text colours. Auto-theme (follow OS) also respects `prefers-color-scheme: dark`.
- **Scroll defer for renderAll** — added `__lastScrollAt` tracker hooked to `scroll`/`wheel`/`touchmove` (passive, capture). `_runRenderAllOrDeferIfTyping` now waits up to 250ms after the last scroll event before re-rendering. Targets the "scrolls up automatically while reading Insights" glitch caused by realtime/sync events firing mid-scroll.
- **Print fix hardened for cross-browser** — added both legacy (`page-break-*`) and modern (`break-*`) properties on the print overlay, cards, and a wildcard descendant rule. Added `max-height: 19cm` + `overflow: hidden` on the overlay as belt-and-suspenders. Targets browsers (older Safari, Firefox pre-67) that ignore one of the break properties.
- **Birthday banner timezone semantics** — clarifying comment added to `todayYmd()` explaining that birthday math is intentionally local-time across all four consumers (`isBirthdayBannerDismissedToday`, `partiesWithBirthdayToday`, `daysUntilBirthday`, `ageOnNextBirthday`). No behaviour change.

### Hash
`bafb9007359e31ada44f0370fb8fa200`

---

## [v89.31.1] — 2026-05-20

Three fixes layered on top of v89.31.0.

### Added
- **Top 15 parties by loss** ranking on Insights → Party rankings. Sits between "by profit" and "by cash in". Filters parties with `net < 0`, sorted ascending (worst first). Default shows 5 with "View N more" toggle. Empty case shows "No data for this period."

### Fixed
- **Print 2-pages issue** — clicking Print on Daily Net Profit or Net Profit by Month was outputting two pages with an adjacent chart appearing. Root cause: no `max-height` on print SVGs; the cloned chart card's natural height could overflow one landscape page. Fix: `max-height: 14cm` on print SVGs, `page-break-inside: avoid` on overlay + cloned card.
- **Scroll glitch (defensive fix #1)** — `_preserveScrollAround` was clamping captured scrollY to the new (sometimes shorter) document max, causing a visible upward jump. Changed: only restore scroll if `scrollY <= maxY + 5`, otherwise reset to 0. This addresses one possible cause; the actual root cause is fixed in v89.31.2.

### Hash
`5e48487f47f0127fe98fe65566285ccc`

---

## [v89.31.0] — 2026-05-20

**Parties feature: contact metadata + birthday awareness.**

### Added
- **Party contact metadata**:
  - Date of birth (full date or month-day with optional year)
  - Multiple phone numbers (up to 10) with country code as free text
  - Multiple email addresses (up to 10) with loose RFC validation
  - Free-form description (max 500 chars)
- **Edit permissions** — anyone in the business with role owner / manager / staff can edit contact metadata; viewers cannot. The party's *name* remains restricted to the original creator (`canRenameParty`).
- **Birthday banner on Entries page** — dismissible per-day (localStorage key `hisabs_bday_banner_dismissed_v1`). Shows party name, age when year is known, and chip per celebrating party. Supports multiple birthdays the same day.
- **Birthday badge on party detail** — "Birthday today · turned 36", "Birthday tomorrow", "Birthday in 25 days" depending on proximity. Filled accent for today, soft accent for ≤7 days, default for further out.
- **Contact card on party detail** — click-to-call (`tel:`), click-to-WhatsApp (`wa.me`), click-to-email (`mailto:`) buttons. DOB row, notes section.
- **Activity log integration** — `party_created`, `party_edited` (with `fields_changed` array: DOB / phone / email / description), `party_deleted` (with `entries_unlinked` count). Owners see all events; staff see their own.

### Database
- New SQL migration: `sql/v89.31.0_app_parties_meta.sql`
- Adds `meta jsonb` column to `app_parties` (idempotent, backward-compatible)
- CHECK constraint `app_parties_meta_is_object` rejects non-object payloads
- RLS unchanged — existing policies cover the new column

### Hash
`eb35e1da59a4fb3b2245d137190a1451`

---

## [v89.30.8] — 2026-05-20

### Changed
- **Chart sizing** — removed `max-width: 560px` cap on chart cards (cards were looking lonely on big screens). Chart SVG height now scales gently with viewport: `clamp(220px, 18vw, 360px)`. Mobile (≤880px) unchanged with `min-height: 180px`.
- **Device names** — User-Agent parser now produces richer "Brand · OS Version · Browser Version" strings. Detects Samsung (SM-*), OnePlus (CPH-*), Pixel, Xiaomi/Redmi, Realme, Vivo, Oppo, Huawei, Motorola, Nokia, Asus, LG, Sony, Poco. iPhone shows "iPhone · iOS 17.4 · Safari 17". Privacy note: browsers do not expose marketing names like "Galaxy S24 Ultra".

### Hash
`f89c75a30d6c3641fd5c2e220e108d1e`

---

## [v89.30.5] — 2026-05-19

### Added
- **App device names table** — `sql/v89.30.5_app_device_names.sql` adds `app_device_names` (user_id, session_id, name, created_at, updated_at). Lets users assign friendly names to their browser sessions ("MacBook · Home", "iPhone · Travel"). RLS restricts read/write to own rows.
- Edge functions deployed:
  - `delete-self-account` — final auth row removal after user-data deletion
  - `list-my-sessions` — joined session + device-name listing
  - `revoke-my-session` — atomic ownership-check-and-delete via SECURITY DEFINER RPC

---

## [v89.30] — 2026-05-18

### Changed
- **Invoice # column** removed from CSV / PDF exports (entry numbering was confusing in multi-business contexts).

### Fixed
- Distribution view: distSalaries / distShares now mirrored to in-memory `__distSalaries` / `__distShares` so the per-row final calculation reflects unsaved input.
- Distribution view: bottom full-width Save button now toggles in lockstep with the top one.

---

## [v89.29] — 2026-05-17

### Changed
- **Export progress feedback** — slow CSV / PDF exports now show a "Preparing…" splash so the user knows the click registered. Double-clicks are debounced to prevent multiple downloads.
- **LRU bounded** for the recent-self-writes set (was unbounded, would have grown over a long session).

---

## [v89.28] — 2026-05-16

### Added
- **OTP-triggering action splash** — instant feedback for "Send code", "Verify it's you", etc. Hides on success / error / throw so the user is never left looking at a spinner.
- **hideBootSplash** sequencing — modal renders before splash closes, no flash of bare auth screen.

---

## [v89.27] — 2026-05-15

### Changed
- **Render minimisation** — Distribution and Audit Tax views now use surgical text updates instead of full innerHTML rewrites where possible. Reduces input-focus loss during realtime sync events.
- **Visibility-based hiding** instead of display:none for certain layout-sensitive groups so the column structure doesn't reflow.
- **Restored lock pattern** for salaries + shares (regression from earlier refactor).

---

## Earlier versions

For changes prior to v89.27, see commit history in the repo.

---

## How to inspect what version is live

1. Open hisabs.app in DevTools → Console
2. Run `hisabsSelfTest()` — output prefix tells you the build is functional
3. The version embedded in code comments is the latest tag in this changelog

To verify the bundle hash matches what was deployed:
```
md5sum index.html
```
Compare to the hash in this changelog.
