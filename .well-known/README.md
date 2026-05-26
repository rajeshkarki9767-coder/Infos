# assetlinks.json — how to make it work

This file lives at `https://infos-infos.vercel.app/.well-known/assetlinks.json`
and is ONLY needed if you publish the app to the **Google Play Store** as a TWA
(Trusted Web Activity). It proves your website and Android app belong together,
so the app opens full-screen without a browser address bar.

## ⚠️ It does NOT work yet
The file currently has two PLACEHOLDERS that must be replaced with real values
that don't exist until you build the Android app:

1. `package_name` — the Android package id you choose (e.g. `com.rajeshkarki.infos`).
2. `sha256_cert_fingerprints` — the SHA-256 fingerprint of the key that signs
   your Android app. If you use **Google Play App Signing** (recommended), you
   get this from Play Console → your app → Setup → App integrity → App signing
   key certificate → SHA-256 fingerprint.

If you leave the placeholders, TWA verification FAILS and the app shows the
browser address bar. So fill them in before relying on it.

## Easiest path to get the real values: PWABuilder
1. Go to https://www.pwabuilder.com
2. Enter your URL: `https://infos-infos.vercel.app`
3. Choose **Package for stores → Android**.
4. It generates the Android app package AND shows you the exact
   `assetlinks.json` contents (with the real package name + fingerprint).
5. Copy those two values into THIS file (replace the placeholders), commit, and
   redeploy. Vercel will serve it at `/.well-known/assetlinks.json` automatically.
6. Verify it's live by visiting that URL in a browser — you should see the JSON.

## Alternative: Bubblewrap (CLI)
`npx @bubblewrap/cli init --manifest https://infos-infos.vercel.app/manifest.json`
generates the project and prints the fingerprint to put here.

## Verify after deploying
- Visit `https://infos-infos.vercel.app/.well-known/assetlinks.json` → must return the JSON.
- Google's tester: https://developers.google.com/digital-asset-links/tools/generator

If you don't plan to publish on the Play Store, you can ignore/delete this file —
it has no effect on the web app or normal PWA install.
