# Infos — Shared Business Access tests

These prove the shared-business rework: business logins get the **full editable
app** on **shared, live-synced data**, with strict per-business isolation.

## Run

```
npm install      # installs @electric-sql/pglite + jsdom (dev only)
npm test         # runs all suites (node test/run-all.js)
```

Or individually: `npm run test:rls | test:adapter | test:slice | test:e2e | test:smoke`.

## What each suite covers

| Suite | What it proves | How |
|---|---|---|
| `rls.test.js` | RLS isolation: a member reads/writes only their business's shared row; cross-business read/write/insert is blocked; delete is owner-only. | Runs the real `schema.sql` + `schema-shared.sql` in an in-memory Postgres (pglite), emulating Supabase's `auth.uid()`, querying as a non-superuser so RLS actually fires. |
| `adapter.test.js` | The adapter builds the right queries and handles versions/conflicts; old view-only methods are gone. | Mock Supabase client recording calls. |
| `slice.test.js` | `buildSharedSlice` / `sliceToMemberState` / `memberStateToSlice` / `applySliceToOwnerState`: secrets stripped, other businesses untouched, local-id↔cloud-id normalization, activity merge. | Pure functions, no DB. |
| `e2e.test.js` | Full flow end-to-end: owner shares → member loads full app → member edits → owner sees them (secrets + other businesses intact) → cross-business isolation → version guard. | Real adapter + real slice helpers over a Supabase-shaped client backed by pglite with RLS. |
| `smoke.test.js` | The app boots in a DOM without throwing and the shared-access wiring is present (no leftover view-only screen). | jsdom loads `index.html` + the app scripts in local-only mode. |

## Note

`pglite` provides a genuine Postgres engine (WASM), so the RLS tests exercise the
exact policies you run in Supabase — not a mock. The only emulated piece is the
`auth.uid()` function and the `auth.users` table, which mirror Supabase's
contract (uid comes from the `request.jwt.claims` `sub` claim).
