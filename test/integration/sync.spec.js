// Real cross-device sync integration tests (Playwright).
// Drives TWO browser contexts — an owner and a business member — against a live
// deployment, and asserts that changes on one actually reach the other.
// See test/integration/README.md for setup. Run from project root:
//   npx playwright test test/integration

const { test, expect } = require('@playwright/test');

const URL = process.env.INFOS_URL || 'https://infos-infos.vercel.app';
const OWNER_EMAIL = process.env.INFOS_OWNER_EMAIL;
const OWNER_PW = process.env.INFOS_OWNER_PASSWORD;
const BIZ_EMAIL = process.env.INFOS_BIZ_EMAIL;
const BIZ_PW = process.env.INFOS_BIZ_PASSWORD;

// Guard: detect unset or placeholder credentials so failures are obvious.
const looksReal = v => v && !/REAL_|your-|example\.com|_here/.test(v);
const haveCreds = looksReal(OWNER_EMAIL) && OWNER_PW && looksReal(BIZ_EMAIL) && BIZ_PW;

test.describe('cross-device sync', () => {
  test.skip(!haveCreds,
    'Set REAL INFOS_* env vars (not the placeholder values). See test/integration/README.md.');

  // Sign in and wait for the app shell (a nav-item) — NOT visible text "Notices",
  // which also appears in the user guide and matches before login completes.
  async function signIn(page, email, pw) {
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.fill('#auth-email', email);
    await page.fill('#auth-password', pw);
    await page.click('#auth-submit');
    await page.waitForSelector('.nav-item[data-tab]', { timeout: 20000 });
  }

  async function goTab(page, key) {
    await page.click(`.nav-item[data-tab="${key}"]`);
    await page.waitForTimeout(300);
  }

  test('owner add -> member sees it without reload', async ({ browser }) => {
    const ownerCtx = await browser.newContext();
    const bizCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    const member = await bizCtx.newPage();
    await signIn(owner, OWNER_EMAIL, OWNER_PW);
    await signIn(member, BIZ_EMAIL, BIZ_PW);

    const marker = 'E2E-' + Date.now();
    await goTab(owner, 'games');
    await owner.click('button:has-text("New entry")');
    await owner.fill('#if-name', marker);
    await owner.fill('#if-link', 'https://example.com/' + marker);
    await owner.click('button:has-text("Save")');

    await goTab(member, 'games');
    await expect(member.locator(`text=${marker}`)).toBeVisible({ timeout: 15000 });
    await ownerCtx.close();
    await bizCtx.close();
  });

  test('member balance add -> owner sees it (realtime path)', async ({ browser }) => {
    const ownerCtx = await browser.newContext();
    const bizCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    const member = await bizCtx.newPage();
    await signIn(owner, OWNER_EMAIL, OWNER_PW);
    await signIn(member, BIZ_EMAIL, BIZ_PW);

    const amount = String(1000 + Math.floor(Math.random() * 8999));
    await goTab(member, 'balance');
    await member.click('button:has-text("New entry")');
    await member.locator('#modal-content input').first().fill(amount);
    await member.click('button:has-text("Save")');

    await goTab(owner, 'balance');
    await expect(owner.locator(`text=${amount}`)).toBeVisible({ timeout: 15000 });
    await ownerCtx.close();
    await bizCtx.close();
  });

  test('shared_state version stable while idle (write-loop regression guard)', async ({ browser }) => {
    const ownerCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    await signIn(owner, OWNER_EMAIL, OWNER_PW);

    await goTab(owner, 'settings');
    await owner.click('text=About');
    await owner.click('button:has-text("Sync Diagnostics")');
    await owner.waitForSelector('text=/cloudV=\\d+/', { timeout: 10000 });

    const readCloudV = async () => {
      const txt = await owner.locator('text=/cloudV=\\d+/').first().textContent();
      const m = txt && txt.match(/cloudV=(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    };
    const v1 = await readCloudV();
    await owner.waitForTimeout(20000);
    const v2 = await readCloudV();
    if (v1 != null && v2 != null) expect(v2 - v1).toBeLessThanOrEqual(2);
    await ownerCtx.close();
  });
});
