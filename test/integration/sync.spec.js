// Real cross-device sync integration tests (Playwright).
// These drive TWO browser contexts — an owner and a business member — against a
// live deployment, and assert that changes on one actually reach the other.
//
// This is the layer the static tests can't cover, and where every sync bug in
// this project actually lived. See test/integration/README.md for setup.
//
// Run: npx playwright test test/integration

const { test, expect } = require('@playwright/test');

const URL = process.env.INFOS_URL || 'https://infos-infos.vercel.app';
const OWNER_EMAIL = process.env.INFOS_OWNER_EMAIL;
const OWNER_PW = process.env.INFOS_OWNER_PASSWORD;
const BIZ_EMAIL = process.env.INFOS_BIZ_EMAIL;
const BIZ_PW = process.env.INFOS_BIZ_PASSWORD;

const haveCreds = OWNER_EMAIL && OWNER_PW && BIZ_EMAIL && BIZ_PW;

test.describe('cross-device sync', () => {
  test.skip(!haveCreds, 'Set INFOS_* env vars (see README) to run integration tests.');

  async function signIn(page, email, pw) {
    await page.goto(URL);
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', pw);
    await page.click('button:has-text("Sign in")');
    // Wait for the main app shell (nav) to appear.
    await page.waitForSelector('text=Notices', { timeout: 20000 });
  }

  test('owner add → member sees it without reload', async ({ browser }) => {
    const ownerCtx = await browser.newContext();
    const bizCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    const member = await bizCtx.newPage();

    await signIn(owner, OWNER_EMAIL, OWNER_PW);
    await signIn(member, BIZ_EMAIL, BIZ_PW);

    const marker = 'E2E-' + Date.now();
    // Owner adds a Games entry with a unique name.
    await owner.click('text=Games');
    await owner.click('button:has-text("New")');
    await owner.fill('input[name="name"], #m-name', marker);
    await owner.fill('input[type="url"], #m-link', 'https://example.com/' + marker);
    await owner.click('button:has-text("Save")');

    // Member should see it appear within the realtime/poll window — NO reload.
    await member.click('text=Games');
    await expect(member.locator('text=' + marker)).toBeVisible({ timeout: 15000 });

    await ownerCtx.close();
    await bizCtx.close();
  });

  test('member balance add → owner sees it (realtime path)', async ({ browser }) => {
    const ownerCtx = await browser.newContext();
    const bizCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    const member = await bizCtx.newPage();

    await signIn(owner, OWNER_EMAIL, OWNER_PW);
    await signIn(member, BIZ_EMAIL, BIZ_PW);

    const amount = String(1000 + Math.floor(Math.random() * 8999));
    await member.click('text=Balance');
    await member.click('button:has-text("New")');
    await member.fill('#m-amount, input[name="amount"]', amount);
    await member.click('button:has-text("Save")');

    await owner.click('text=Balance');
    await expect(owner.locator('text=' + amount)).toBeVisible({ timeout: 15000 });

    await ownerCtx.close();
    await bizCtx.close();
  });

  test('shared_state version is stable while idle (write-loop regression guard)', async ({ browser }) => {
    // Open owner + member, then sit idle and confirm the diagnostics "applied
    // version" does not keep climbing on its own.
    const ownerCtx = await browser.newContext();
    const owner = await ownerCtx.newPage();
    await signIn(owner, OWNER_EMAIL, OWNER_PW);

    // Open Settings → About → Sync Diagnostics.
    await owner.click('text=Settings');
    await owner.click('text=About');
    await owner.click('button:has-text("Sync Diagnostics")');

    // Read the most recent cloudV, wait 20s idle, read again.
    const readCloudV = async () => {
      const txt = await owner.locator('text=/cloudV=\\d+/').first().textContent();
      const m = txt && txt.match(/cloudV=(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    };
    const v1 = await readCloudV();
    await owner.waitForTimeout(20000);
    const v2 = await readCloudV();

    // Allow a tiny tolerance, but it must not run away (was climbing ~6-40/min).
    if (v1 != null && v2 != null) expect(v2 - v1).toBeLessThanOrEqual(2);

    await ownerCtx.close();
  });
});
