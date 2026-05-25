# App store screenshots

The files in `icons/screenshot-wide.png` and `icons/screenshot-narrow.png` are placeholder gradients. For Play Store and App Store submission, you need actual screenshots of the running app. This guide tells you what to capture and how.

## What stores want

### Google Play Store

- Phone: minimum 2 screenshots, max 8. Sizes between 320px and 3,840px. Aspect ratio between 1:2 and 2:1. PNG or JPEG. 16:9 (e.g. 1080×1920 portrait or 1920×1080 landscape) is a safe bet.
- Tablet (7-inch and 10-inch): same rules, optional but improves listing quality.
- Feature graphic: 1024×500 PNG, mandatory.

### Apple App Store

- 6.7-inch (iPhone 14/15 Pro Max): 1290×2796 portrait
- 5.5-inch (older iPhones): 1242×2208 portrait
- 12.9-inch iPad Pro: 2048×2732 portrait

You need 3–10 screenshots per device class. App Store Connect lets you upload one set and copy across, but the first device class is mandatory.

## What to capture

Aim for these screens in order — they tell the product story without anyone reading copy:

1. **Notices tab with content** — first impression. Sign in as the owner, leave the Acme Corp demo data, scroll so a few items are visible. Both the pinned section and a normal item should be in frame.
2. **Business detail page** — shows the differentiator. Open Acme Corp from the Businesses tab. The cover gradient, sign-in credentials, tags, and assigned items count all visible.
3. **Command palette** — shows the productivity surface. Press ⌘K, type `tag:engineering`, capture the filtered results dropdown.
4. **System tab** — shows the data visualization. The animated counters and bar charts are eye-catching.
5. **Business view-only mode** — shows the sharing angle. Sign out, sign back in as `team@acme.com` / `demo123`. Capture the Notices tab — the "View only" badge in the header and the absence of the Businesses tab tell the story.
6. **Dark mode** — captures a mode preference. Settings → Theme → Dark, then go back to the Notices tab. Some reviewers spot-check theme support.
7. **Settings — encryption section** — for privacy-conscious audiences. Settings, scroll to Encryption.

## How to capture

### Option A: Real device (best fidelity)

Install the PWA on your phone via PWA Builder or browser "Add to home screen". Open it, use the system screenshot shortcut (volume + power on most Androids and iPhones), transfer to your computer.

### Option B: Browser DevTools (fastest)

1. Open the app in Chrome.
2. DevTools → top-left device toolbar icon (Cmd+Shift+M / Ctrl+Shift+M).
3. Choose a device preset matching the target size (e.g. "iPhone 14 Pro Max" for 6.7-inch shots), or set a custom width.
4. Take a screenshot: in the device toolbar's overflow menu, "Capture screenshot" or "Capture full size screenshot".
5. For exact pixel dimensions, set device pixel ratio to 1 or 2 to match the target, then scale in an image editor if needed.

### Option C: Headless browser script

```js
// capture.js — run with: node capture.js
const puppeteer = require('puppeteer');

const shots = [
  { name: 'notices', url: 'http://localhost:8080', vp: { width: 1290, height: 2796, deviceScaleFactor: 1, isMobile: true } },
  { name: 'biz-detail', url: 'http://localhost:8080/#biz-detail', vp: { width: 1290, height: 2796, deviceScaleFactor: 1, isMobile: true } },
  // ...
];

(async () => {
  const browser = await puppeteer.launch();
  for (const s of shots) {
    const page = await browser.newPage();
    await page.setViewport(s.vp);
    await page.goto(s.url);
    await page.waitForTimeout(2000); // let everything render
    await page.screenshot({ path: `screenshots/${s.name}.png` });
    await page.close();
  }
  await browser.close();
})();
```

Run `python3 -m http.server 8080` in the Infos folder first.

## Where to put them

Don't overwrite the placeholders in `icons/` unless you also want them shown in the manifest's `screenshots[]` array (those are the PWA install prompt screenshots, separate from store submission). For store submission, upload directly via:

- **Google Play Console**: Store presence → Main store listing → Graphics
- **App Store Connect**: My Apps → [your app] → App Store tab → [version] → screenshots section

## Feature graphic for Play Store

You need a 1024×500 PNG that visually represents the app. The simplest approach: take the app icon at large size, set it on a brand gradient background with the app name and a one-line tagline next to it. Tools like Figma, Sketch, or even Canva work fine. Try to mirror your in-app aesthetic — don't use stock photos.

## Localized screenshots

If you list the app in multiple languages, the stores let you upload localized screenshots per language. Right now Infos is English-only, so a single set suffices. If you localize later, capture each set in the target language by setting `navigator.language` (browser DevTools → Sensors → Locale) before the screenshot pass.
