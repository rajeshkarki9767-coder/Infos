# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: test/integration/sync.spec.js >> cross-device sync >> owner add → member sees it without reload
- Location: test/integration/sync.spec.js:32:3

# Error details

```
TimeoutError: page.waitForSelector: Timeout 20000ms exceeded.
Call log:
  - waiting for locator('text=Notices') to be visible
    43 × locator resolved to 3 elements. Proceeding with the first one: <p>Inside each business, create tags for departments…</p>

```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic:
    - generic:
      - generic:
        - generic:
          - generic:
            - img
        - heading "Manage businesses" [level=2]
        - paragraph: Create as many businesses as you need. Each one has its own credentials, brand color, tags, and assigned items.
      - generic:
        - button "Skip"
        - button "Next"
  - generic [ref=e4]:
    - generic [ref=e5]:
      - img "Infos logo" [ref=e7]
      - heading "Welcome to Infos" [level=1] [ref=e14]
      - paragraph [ref=e15]: Sign in to continue
    - generic [ref=e17]:
      - generic [ref=e18]:
        - generic [ref=e19]: Email
        - textbox "you@example.com" [ref=e20]: REAL_owner_email_here
      - generic [ref=e22]:
        - generic [ref=e23]:
          - generic [ref=e24]: Password
          - button "Forgot?" [ref=e25] [cursor=pointer]
        - generic [ref=e26]:
          - textbox "••••••••" [ref=e27]: REAL_owner_password_here
          - button "Show password" [ref=e28] [cursor=pointer]:
            - img [ref=e30]
      - generic [ref=e33]: Enter a valid email
      - button "Sign in" [active] [ref=e34] [cursor=pointer]
      - generic [ref=e35]:
        - generic [ref=e36]: Don't have an account?
        - button "Create new account" [ref=e37] [cursor=pointer]
  - generic:
    - complementary:
      - generic:
        - img
        - generic: Infos
      - generic:
        - button "Search":
          - generic:
            - img
          - generic: Search
      - generic:
        - generic:
          - generic:
            - generic:
              - img
          - generic: All businesses
          - generic:
            - img
      - navigation
      - generic:
        - generic:
          - generic:
            - img
          - generic: Settings
        - generic:
          - generic:
            - img
          - generic: Switch account
        - generic:
          - generic:
            - img
          - generic: Sign out
    - main:
      - generic:
        - generic:
          - heading "Notices" [level=2]
          - generic: Recent updates
        - generic:
          - button "Switch account":
            - generic:
              - img
            - generic:
              - img
      - generic:
        - generic:
          - img
        - generic: Pull to refresh
```

# Test source

```ts
  1   | // Real cross-device sync integration tests (Playwright).
  2   | // These drive TWO browser contexts — an owner and a business member — against a
  3   | // live deployment, and assert that changes on one actually reach the other.
  4   | //
  5   | // This is the layer the static tests can't cover, and where every sync bug in
  6   | // this project actually lived. See test/integration/README.md for setup.
  7   | //
  8   | // Run: npx playwright test test/integration
  9   | 
  10  | const { test, expect } = require('@playwright/test');
  11  | 
  12  | const URL = process.env.INFOS_URL || 'https://infos-infos.vercel.app';
  13  | const OWNER_EMAIL = process.env.INFOS_OWNER_EMAIL;
  14  | const OWNER_PW = process.env.INFOS_OWNER_PASSWORD;
  15  | const BIZ_EMAIL = process.env.INFOS_BIZ_EMAIL;
  16  | const BIZ_PW = process.env.INFOS_BIZ_PASSWORD;
  17  | 
  18  | const haveCreds = OWNER_EMAIL && OWNER_PW && BIZ_EMAIL && BIZ_PW;
  19  | 
  20  | test.describe('cross-device sync', () => {
  21  |   test.skip(!haveCreds, 'Set INFOS_* env vars (see README) to run integration tests.');
  22  | 
  23  |   async function signIn(page, email, pw) {
  24  |     await page.goto(URL);
  25  |     await page.fill('input[type="email"]', email);
  26  |     await page.fill('input[type="password"]', pw);
  27  |     await page.click('button:has-text("Sign in")');
  28  |     // Wait for the main app shell (nav) to appear.
> 29  |     await page.waitForSelector('text=Notices', { timeout: 20000 });
      |                ^ TimeoutError: page.waitForSelector: Timeout 20000ms exceeded.
  30  |   }
  31  | 
  32  |   test('owner add → member sees it without reload', async ({ browser }) => {
  33  |     const ownerCtx = await browser.newContext();
  34  |     const bizCtx = await browser.newContext();
  35  |     const owner = await ownerCtx.newPage();
  36  |     const member = await bizCtx.newPage();
  37  | 
  38  |     await signIn(owner, OWNER_EMAIL, OWNER_PW);
  39  |     await signIn(member, BIZ_EMAIL, BIZ_PW);
  40  | 
  41  |     const marker = 'E2E-' + Date.now();
  42  |     // Owner adds a Games entry with a unique name.
  43  |     await owner.click('text=Games');
  44  |     await owner.click('button:has-text("New")');
  45  |     await owner.fill('input[name="name"], #m-name', marker);
  46  |     await owner.fill('input[type="url"], #m-link', 'https://example.com/' + marker);
  47  |     await owner.click('button:has-text("Save")');
  48  | 
  49  |     // Member should see it appear within the realtime/poll window — NO reload.
  50  |     await member.click('text=Games');
  51  |     await expect(member.locator('text=' + marker)).toBeVisible({ timeout: 15000 });
  52  | 
  53  |     await ownerCtx.close();
  54  |     await bizCtx.close();
  55  |   });
  56  | 
  57  |   test('member balance add → owner sees it (realtime path)', async ({ browser }) => {
  58  |     const ownerCtx = await browser.newContext();
  59  |     const bizCtx = await browser.newContext();
  60  |     const owner = await ownerCtx.newPage();
  61  |     const member = await bizCtx.newPage();
  62  | 
  63  |     await signIn(owner, OWNER_EMAIL, OWNER_PW);
  64  |     await signIn(member, BIZ_EMAIL, BIZ_PW);
  65  | 
  66  |     const amount = String(1000 + Math.floor(Math.random() * 8999));
  67  |     await member.click('text=Balance');
  68  |     await member.click('button:has-text("New")');
  69  |     await member.fill('#m-amount, input[name="amount"]', amount);
  70  |     await member.click('button:has-text("Save")');
  71  | 
  72  |     await owner.click('text=Balance');
  73  |     await expect(owner.locator('text=' + amount)).toBeVisible({ timeout: 15000 });
  74  | 
  75  |     await ownerCtx.close();
  76  |     await bizCtx.close();
  77  |   });
  78  | 
  79  |   test('shared_state version is stable while idle (write-loop regression guard)', async ({ browser }) => {
  80  |     // Open owner + member, then sit idle and confirm the diagnostics "applied
  81  |     // version" does not keep climbing on its own.
  82  |     const ownerCtx = await browser.newContext();
  83  |     const owner = await ownerCtx.newPage();
  84  |     await signIn(owner, OWNER_EMAIL, OWNER_PW);
  85  | 
  86  |     // Open Settings → About → Sync Diagnostics.
  87  |     await owner.click('text=Settings');
  88  |     await owner.click('text=About');
  89  |     await owner.click('button:has-text("Sync Diagnostics")');
  90  | 
  91  |     // Read the most recent cloudV, wait 20s idle, read again.
  92  |     const readCloudV = async () => {
  93  |       const txt = await owner.locator('text=/cloudV=\\d+/').first().textContent();
  94  |       const m = txt && txt.match(/cloudV=(\d+)/);
  95  |       return m ? parseInt(m[1], 10) : null;
  96  |     };
  97  |     const v1 = await readCloudV();
  98  |     await owner.waitForTimeout(20000);
  99  |     const v2 = await readCloudV();
  100 | 
  101 |     // Allow a tiny tolerance, but it must not run away (was climbing ~6-40/min).
  102 |     if (v1 != null && v2 != null) expect(v2 - v1).toBeLessThanOrEqual(2);
  103 | 
  104 |     await ownerCtx.close();
  105 |   });
  106 | });
  107 | 
```