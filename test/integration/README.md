# Integration tests (real browser + real Supabase)

The suites in `/test/*.test.js` are fast static/logic checks (Node, no browser).
They do NOT exercise a real browser, real Supabase, or cross-device sync — which
is exactly where every sync bug in this project was found (on real devices).

These Playwright tests close that gap: they drive two real browser contexts
(owner + business member) against a live deployment and assert that an edit on
one actually appears on the other.

## Setup

```bash
npm init -y                 # if no package.json
npm i -D @playwright/test
npx playwright install chromium
```

Set env vars for a THROWAWAY test Supabase project + test accounts:

```bash
export INFOS_URL="https://infos-infos.vercel.app"
export INFOS_OWNER_EMAIL="owner-test@example.com"
export INFOS_OWNER_PASSWORD="..."
export INFOS_BIZ_EMAIL="stark-test@example.com"     # a shared business login
export INFOS_BIZ_PASSWORD="..."
```

## Run

```bash
npx playwright test test/integration
```

## What they cover (the previously-untested paths)

1. Owner adds a Games entry → business member sees it within a few seconds (no reload).
2. Owner deletes a balance entry → member no longer sees it.
3. Member adds a balance entry → owner sees it (this is the realtime path that
   was silently failing — see the v170 stale-timer fix).
4. The `shared_state` version does not climb while both clients sit idle
   (regression guard for the write-loop saga).

These are the assertions that would have caught the stuck-member bug automatically.
