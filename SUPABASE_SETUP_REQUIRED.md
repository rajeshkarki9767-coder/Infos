# ⚠️ IMPORTANT — Supabase configuration required before v89.23 works

The OTP code is in place, but the **Supabase email templates must be
updated** to send 6-digit codes instead of magic links. **Until you do
this, users will not see the code** — they'll see a link that won't
work with the new modal.

## Step-by-step

### 1. Open Supabase dashboard
- Go to your project → **Authentication** → **Email Templates**

### 2. Update 3 templates

For each of these three templates, you'll change the **Message body**:

#### a) Confirm signup
Current default uses `{{ .ConfirmationURL }}` (link).
Replace with something like:

```html
<h2>Confirm your signup</h2>
<p>Your verification code is:</p>
<h1 style="font-size:2rem;letter-spacing:0.3rem;font-family:monospace;">{{ .Token }}</h1>
<p>This code expires in 1 hour.</p>
```

#### b) Magic Link
Same change. `{{ .Token }}` is the 6-digit code:

```html
<h2>Sign in to Hisabs</h2>
<p>Your verification code is:</p>
<h1 style="font-size:2rem;letter-spacing:0.3rem;font-family:monospace;">{{ .Token }}</h1>
<p>This code expires in 1 hour.</p>
```

#### c) Change Email Address
Same change:

```html
<h2>Confirm your new email</h2>
<p>Your verification code is:</p>
<h1 style="font-size:2rem;letter-spacing:0.3rem;font-family:monospace;">{{ .Token }}</h1>
<p>This code expires in 1 hour.</p>
```

### 3. (Optional) Configure SMTP

Without SMTP configured, emails come from `noreply@mail.supabase.io`.

To use your own domain:
- Authentication → Email Templates → SMTP Settings
- Add SMTP credentials from your provider (SendGrid, AWS SES, Resend, Gmail, etc.)
- Set sender as `noreply@yourdomain.com` or similar

### 4. Save and test

After saving the templates, sign up a new test account from the app.
You should receive a 6-digit code via email instead of a link.

## What happens if you skip this step?

- The OTP modal in the app will open and wait for a code
- The email Supabase sends will contain a LINK (not a code)
- The user has nothing to type into the OTP boxes
- **The user is stuck.**

So **do this BEFORE deploying v89.23** to production.

