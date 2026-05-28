# Infos — Audit & Auto-Fix Report (v118.0.0)

**Method:** code review + the project's automated test suite (221 checks / 12 suites
against in-memory Postgres + a simulated DOM). Per the audit's own rules, anything not
testable from this environment is marked NOT VERIFIABLE rather than given a fake pass. The
score is a code-review + test self-assessment, NOT an independent production certification.

## 1. Score (self-assessment)

Overall: 86 / 100 — code-review score, not a production certification. Held at 86: this
pass found and fixed another instance of the same chip-order bug class (the "Assigned to"
detail row had the same potential shuffle as the chips that were fixed in v117).

## 2. Category scores

| Category | Score | Basis |
|---|---|---|
| Stability | 90 | 221 checks pass; crash class fixed + regression-tested |
| Backend / Auth | 86 | local-session auth; idempotent member link |
| Database | 85 | RLS isolation tested vs real Postgres; REPLICA IDENTITY FULL enabled by user |
| Data integrity / Sync | 87 | realtime applies payload directly (verified working via user console) |
| Display stability | 88 | chip order stable; "Assigned to" order stable (this pass) |
| Notifications | 79 | wired, deduped, permission-gated; delivery NOT VERIFIABLE here |
| Sound system | 85 | autoplay unlock, shared ctx, node cleanup, distinct sounds; output NOT VERIFIABLE |
| Security | 76 | no client secrets, ~185 esc() sites, safeUrl, server-side RLS; no formal pen-test |
| Performance | 79 | poll backs off when realtime healthy; version pre-check; no profiling numbers |
| UI/UX | NOT SCORED | requires a real browser |
| Responsiveness | NOT SCORED | requires real devices/viewports |
| Accessibility | NOT SCORED | requires screen reader / audit tool |
| Code Quality | 72 | tested + functional; one ~7,400-line file — modularization advisable |
| Scalability | NOT VERIFIABLE | requires production-scale load testing |

## 3. Key findings & status

- **"Assigned to" order shuffle (FIXED this pass):** the detail-modal "Assigned to" line
  built its comma-separated business list from raw bizIds order — same bug class as the
  chip-order issue fixed in v117. Now sorts by canonical sidebar order (state.businesses)
  for stable display across syncs.
- **Chip order on cards (FIXED v117):** biz chips on item cards + activity log entries now
  sort by canonical sidebar order; verified intact.
- **Realtime sync delivery (verified via user console):** window.__infosRtPayloadLog showed
  hasData:true on every event and versions climbing live — the sync pipeline works. The
  intermittent "needs refresh" the user reported coincided with ERR_NAME_NOT_RESOLVED and
  failed WebSocket logs — i.e. NETWORK FAILURE reaching Supabase, not a code bug. The user
  was also shown an "EXCEEDING USAGE LIMITS" banner in their Supabase project, which would
  cause throttling. Marked NOT VERIFIABLE / REQUIRES external service status. No fabricated
  code "fix" was invented for it.
- **Carried fixes intact:** v116 segmented-tab visibility + splash hold + password mask;
  v115 password persistence; v114 offline detection; v113 manifest warnings; v108-112 crash
  fix + sync + search bar.

## 4. Changelog (this pass, v118)

- Display stability: "Assigned to" detail row now sorts by canonical sidebar order so the
  business list doesn't shuffle between syncs (matches the v117 chip-order fix).
- Verified (no change needed): tag-chip rendering iterates the business's own tag list
  (canonical to that business — does not shuffle on sync); only two render sites used raw
  bizIds; the other (chips) was already fixed in v117. No duplicate functions, no client
  secrets, no stray console.log.

(Carried: v117 chip-order stability; v116 segtab visibility / splash hold / pw mask; v115
biz pw persistence; v114 offline detection; v113 manifest warnings; v108-112 crash fix +
sync + search; older core fixes incl. realtime stack-overflow, audio unlock, accent
persistence, etc.)

## 5. NOT VERIFIABLE in this environment

- Real-browser rendering, dark/light correctness, responsive breakpoints
- iOS / Android / specific-browser behavior
- Actual notification delivery; actual audio output on real hardware
- **The user's Supabase project status** (the EXCEEDING USAGE LIMITS banner seen in a
  screenshot of their dashboard would cause sync throttling — REQUIRES the user to verify
  in Supabase → Settings → Billing/Usage)
- **The user's network reliability** (ERR_NAME_NOT_RESOLVED in console = device can't
  reach Supabase; REQUIRES testing on a stable connection)
- Concurrent multi-user, slow-network, offline recovery on real devices
- Formal security pen-test + dependency CVE audit; production-scale load metrics

## 6. Release status (honest)

MOSTLY READY. Passes everything testable here; sync pipeline verified working via user
console; display-stability bug class now closed in both render sites. Not "ENTERPRISE
READY" in the certification sense — that needs the real-device / multi-user /
security-audit / load validation in section 5, plus a stable Supabase project (not
exceeding limits) and stable network. Claiming it would be a fake validation.

## 7. Final export

Infos.zip (v118.0.0) accompanies this report — all 221 checks passing, version consistent,
no node_modules.

Self-assessment from code review + automated tests. No fabricated tests or validations.
