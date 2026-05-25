# Hisabs v89.28 — Setup notes for 4 follow-up items

This release fixes one thing in code (#1) and requires three Supabase
dashboard / setup steps from you (#2, #3, #4).

```
File hash: c3614c2a9d620843cad1513dfd85cf40
Prior:     a7f797254beade420c9c15de9277767b (v89.27.1)
```

---

## 1. OTP screen now appears instantly with sending splash ✅ FIXED IN CODE

**Problem:** When you click "Create account" / "Forgot password" / "Change email",
there was a 0.5-2 second delay before the OTP modal appeared — the screen
seemed frozen. This was the network roundtrip to Supabase to send the
verification email.

**Fix:** Added a distinct "Sending verification code" splash that appears
**instantly** when you click. Once Supabase confirms the email was sent
(typically <2s), the splash is replaced by the OTP entry screen.

**Visual:** Branded envelope SVG with a pulsing terracotta dot + sliding
progress bar. Distinct from the boot splash. Centered, animated.

**Covered actions:**
- Forgot password from sign-in screen → splash → OTP
- Forgot password from Profile → splash → OTP
- Change email → splash → OTP
- Signup → already had the boot splash (unchanged — was already correct)

No deploy action needed beyond updating the file.

---

## 2. Email template — "with logo" vs "without logo" inconsistency 🛠️ SUPABASE SETUP

**Your question:** *"On email there is long email with logo and I with
no logo as before. I need with logo only. Show OTP on both above and
below as well. Same OTP. On reset/forgot password only. Is it because
I added same thing on magic link and reset password? How can I fix it?"*

**Answer:** Yes — exactly that. Here's why:

Hisabs uses Supabase's `signInWithOtp()` API for **both forgot-password
and magic-link sign-in**. Supabase has SEPARATE email templates for these:

| Action in app | Template Supabase uses |
|---|---|
| Sign up | **Confirm signup** |
| Forgot password (via OTP) | **Magic Link** |
| Change email | **Change Email Address** |

If you edited the "Magic Link" template AND the "Reset Password" template
to look the same, but Hisabs only uses the **Magic Link** one for forgot
password (Hisabs does NOT use `resetPasswordForEmail` anymore as of
v89.23), then:

- The **Reset Password** template you edited is **never used by Hisabs**
- Whatever you see in the email comes from the **Magic Link** template
- If two templates "look different," check which one Supabase is actually
  sending — likely Magic Link (with logo) and the other unused one
  has different content from before you matched them

### How to fix the inconsistency

1. Open Supabase Dashboard → **Authentication → Email Templates**
2. Identify which 3 templates Hisabs actually uses:
   - **Confirm signup** ← used on signup
   - **Magic Link** ← used on forgot password (NOT "Reset Password")
   - **Change Email Address** ← used on email change
3. Make all 3 templates use the SAME branded layout (logo + OTP shown
   both above AND below)

### Recommended template body for all 3

```html
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px 28px;box-shadow:0 2px 12px rgba(0,0,0,0.04);">
          <!-- Header with logo -->
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <img src="https://hisabs.vercel.app/icons/icon-512.png" alt="Hisabs" width="64" height="64" style="border-radius:14px;display:block;">
            </td>
          </tr>
          <!-- OTP shown ABOVE -->
          <tr>
            <td align="center" style="padding-bottom:16px;">
              <div style="font-size:32px;font-weight:700;letter-spacing:0.4em;color:#b8482a;font-family:'SF Mono',Monaco,Consolas,monospace;padding:14px 18px;background:rgba(184,72,42,0.08);border-radius:10px;display:inline-block;">
                {{ .Token }}
              </div>
            </td>
          </tr>
          <!-- Headline + body -->
          <tr>
            <td align="center" style="padding-bottom:8px;">
              <h2 style="margin:0 0 8px 0;font-size:20px;font-weight:600;color:#1a1a1a;">Your verification code</h2>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <p style="margin:0;font-size:14px;line-height:1.55;color:#666;">
                Enter this 6-digit code in the Hisabs app to continue. This code expires in 1 hour.
              </p>
            </td>
          </tr>
          <!-- OTP shown BELOW (per your request) -->
          <tr>
            <td align="center" style="padding-bottom:8px;">
              <div style="font-size:28px;font-weight:700;letter-spacing:0.4em;color:#b8482a;font-family:'SF Mono',Monaco,Consolas,monospace;padding:12px 16px;background:rgba(184,72,42,0.08);border-radius:10px;display:inline-block;">
                {{ .Token }}
              </div>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#999;line-height:1.5;">
                Didn't request this code? You can safely ignore this email — someone may have typed your address by mistake.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0 0;font-size:11px;color:#aaa;">Hisabs · हिसाब</p>
      </td>
    </tr>
  </table>
</body>
</html>
```

The key changes that fix your two issues:
- **Logo always shown** at top (referenced from your deployed app icon)
- **Same OTP shown twice** — once above headline, once below
- **Same `{{ .Token }}`** in both spots — guaranteed to match

### Per-template subject lines

Use these in the "Subject" field of each template:
- Confirm signup → `Welcome to Hisabs — your verification code`
- Magic Link → `Your Hisabs verification code`
- Change Email Address → `Confirm your new Hisabs email`

### Save and test

1. Paste the body into each of the 3 templates
2. Change only the headline text per template if you want them to feel
   distinct (the code grid stays the same)
3. Save each template
4. Test by triggering each flow:
   - Signup with a fresh email
   - Forgot password from sign-in
   - Change email from Profile

You should see the same logo + same OTP-above + same OTP-below format
in all three emails.

### About the unused "Reset Password" template

You can leave it as default. Hisabs **does not use** Supabase's
`resetPasswordForEmail` (that path was removed in v89.23). If Supabase
ever decides to send via that template, the default content is safe.

---

## 3. Account deletion now removes auth.users row 🛠️ DEPLOY EDGE FUNCTION

**Problem:** When a user deletes their account, the business data is
removed but the auth.users entry (email + password hash) stays. They
can't re-register with the same email without contacting support.

**Why this happens:** Supabase client-side JS **cannot** delete an
auth user — that requires the service-role key, which must never be
exposed in browser code. The existing Hisabs code attempts to call a
server-side Edge Function `delete-self-account` to do this. **If that
function isn't deployed, the deletion silently fails for auth user only.**

**Fix:** Deploy the Edge Function in this bundle at
`supabase/functions/delete-self-account/index.ts`.

### Deploy steps

1. Install Supabase CLI (if you haven't):
   ```bash
   npm install -g supabase
   supabase login
   ```

2. From your repo root, link to your Supabase project:
   ```bash
   supabase link --project-ref sdovwbxqxvbbtpndrohd
   ```
   (Replace with your project ref from Dashboard → Settings → General.)

3. Copy the file from this bundle into your repo:
   ```bash
   mkdir -p supabase/functions/delete-self-account
   cp /path/to/hisabs_v89_27_final/supabase/functions/delete-self-account/index.ts \
      supabase/functions/delete-self-account/index.ts
   ```

4. Deploy:
   ```bash
   supabase functions deploy delete-self-account
   ```

5. Verify in Dashboard → Edge Functions: `delete-self-account` listed
   as "Active".

### Test

1. Create a throwaway account
2. Delete it from Profile → Delete account
3. Try to sign UP with the same email — should work fresh (auth user
   was removed by the Edge Function)

If signup with the same email says "User already exists," the Edge
Function isn't reachable. Check Dashboard → Edge Functions → Logs
for errors.

### Security notes

- The function verifies the caller's JWT before doing anything
- Only deletes the caller's OWN user — not arbitrary users
- Uses `auth.admin.deleteUser()` with the service-role key (loaded
  from env, never exposed to the browser)
- CORS allows the request from any origin (you can tighten this to
  your domain in the function file if you want)

The existing code in `index.html` at L25667 already calls this
function — no code change needed when you deploy.

---

## 4. Welcome email after OTP verification 🛠️ NEW EDGE FUNCTION (optional)

**Your question:** *"Can we send email to users when they create account
successfully after OTP verification, like Welcome to Hisabs, and user guide?"*

**Yes — but it's a separate piece.** Here's how:

### Option A (Easiest) — Modify the "Confirm signup" template

Make the verification email ITSELF welcoming. The user sees it when they
sign up; it can include your welcome message + user guide link alongside
the OTP.

Replace the body in the **Confirm signup** template with this combined
version:

```html
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px 28px;box-shadow:0 2px 12px rgba(0,0,0,0.04);">
        <tr><td align="center" style="padding-bottom:20px;">
          <img src="https://hisabs.vercel.app/icons/icon-512.png" alt="Hisabs" width="72" height="72" style="border-radius:16px;display:block;">
        </td></tr>
        <tr><td align="center" style="padding-bottom:8px;">
          <h2 style="margin:0;font-size:22px;font-weight:700;color:#1a1a1a;">Welcome to Hisabs 🎉</h2>
        </td></tr>
        <tr><td align="center" style="padding-bottom:24px;">
          <p style="margin:0;font-size:14px;line-height:1.55;color:#666;">
            Your business ledger, in your pocket. Enter the code below to finish creating your account.
          </p>
        </td></tr>
        <tr><td align="center" style="padding-bottom:24px;">
          <div style="font-size:32px;font-weight:700;letter-spacing:0.4em;color:#b8482a;font-family:'SF Mono',Monaco,Consolas,monospace;padding:14px 18px;background:rgba(184,72,42,0.08);border-radius:10px;display:inline-block;">
            {{ .Token }}
          </div>
        </td></tr>
        <tr><td style="padding:24px 0 0 0;border-top:1px solid #eee;">
          <h3 style="margin:0 0 12px 0;font-size:15px;font-weight:600;color:#1a1a1a;">Getting started</h3>
          <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.7;color:#555;">
            <li><strong>Create a business</strong> — sidebar → + business → name + currency.</li>
            <li><strong>Add parties & accounts</strong> — your customers, suppliers, and cash sources.</li>
            <li><strong>Record entries</strong> — Cash In / Cash Out from the big + button.</li>
            <li><strong>Invite team</strong> — Business settings → Members → invite manager or staff.</li>
            <li><strong>Insights</strong> — see profit, trends, and forecast in real time.</li>
          </ul>
        </td></tr>
        <tr><td align="center" style="padding-top:20px;">
          <p style="margin:0;font-size:12px;color:#999;">
            Open <a href="https://hisabs.vercel.app/" style="color:#b8482a;text-decoration:none;font-weight:600;">hisabs.vercel.app</a> to enter your code.
          </p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0 0;font-size:11px;color:#aaa;">Hisabs · हिसाब</p>
    </td></tr>
  </table>
</body>
</html>
```

Subject: `Welcome to Hisabs — your verification code`

**This is the simplest approach.** No Edge Function needed. Welcome
message + user guide reaches the user in the email they already get.

### Option B (Advanced) — Send a separate welcome email after OTP verify

If you want a SECOND email (post-verification) you'd need:

1. A new Edge Function `send-welcome-email` triggered by a Postgres
   trigger on `auth.users` insert OR called from the app after
   `verifyOtp` succeeds
2. SMTP credentials (you have Resend configured) for the function to
   send via
3. A separate HTML template for the "Welcome" email body

This is more complex (writing the trigger or modifying the app to call
the function on OTP success, plus SMTP integration in the function).
Worth doing if you want a clean separation; not worth it if Option A
covers what you need.

If you want me to implement Option B, tell me — I can write the
`send-welcome-email` function + the trigger + the app-side call.

---

## Deploy

```bash
cd ~/Documents/GitHub/hisabs
cp ~/Downloads/hisabs_v89_27_final/index.html ./index.html
md5sum index.html
# expected: c3614c2a9d620843cad1513dfd85cf40
```

For the Edge Function:

```bash
mkdir -p supabase/functions/delete-self-account
cp ~/Downloads/hisabs_v89_27_final/supabase/functions/delete-self-account/index.ts \
   supabase/functions/delete-self-account/index.ts

# Then deploy:
supabase functions deploy delete-self-account
```

Commit, push, deploy. Then update the 3 email templates in Supabase
Dashboard.

---

## Summary of what each fix needs

| # | Item | Who does what |
|---|---|---|
| 1 | OTP send splash | **Code change** — already in v89.28 |
| 2 | Email template logo consistency | **You** — paste new HTML into 3 Supabase templates |
| 3 | Account deletion removes auth user | **You** — deploy `delete-self-account` Edge Function |
| 4 | Welcome email | **You** — use combined template (Option A) or ask me for Option B |
