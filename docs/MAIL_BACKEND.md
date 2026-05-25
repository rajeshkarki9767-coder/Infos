# Real email backend for forgot-password

In the demo, the forgot-password flow accepts the hardcoded OTP `123456`. To send real codes, you need a backend — Infos is a frontend-only PWA and can't send email directly.

## What you need

1. A backend endpoint your app can call (your own server, a serverless function, etc.)
2. An email-sending service (Resend, SendGrid, Mailgun, Postmark, AWS SES, or your own SMTP)

## Minimal backend (Node + Resend)

```js
// server.js
const express = require('express');
const { Resend } = require('resend');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const resend = new Resend(process.env.RESEND_API_KEY);
const codes = new Map(); // { email: { code, expiresAt } }

app.post('/api/forgot/send', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  codes.set(email, { code, expiresAt: Date.now() + 10 * 60 * 1000 });
  try {
    await resend.emails.send({
      from: 'Infos <noreply@yourdomain.com>',
      to: email,
      subject: 'Your Infos verification code',
      html: `<p>Your code is <strong>${code}</strong>. It expires in 10 minutes.</p>`
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Send failed' });
  }
});

app.post('/api/forgot/verify', (req, res) => {
  const { email, code } = req.body;
  const rec = codes.get(email);
  if (!rec) return res.status(400).json({ error: 'No code requested' });
  if (rec.expiresAt < Date.now()) { codes.delete(email); return res.status(400).json({ error: 'Code expired' }); }
  if (rec.code !== code) return res.status(400).json({ error: 'Invalid code' });
  codes.delete(email);
  res.json({ ok: true });
});

app.listen(3001);
```

In production, put codes in a database with TTLs (Redis is great for this), rate-limit by IP and email, and use a dedicated email domain with SPF/DKIM configured.

## Wire the frontend

Open `app.js`, find the `forgot-send` and `forgot-verify` button handlers (search for `#forgot-send` and `#forgot-verify`). Replace the demo logic:

```js
$('#forgot-send').onclick = async () => {
  const email = $('#forgot-email').value.trim();
  if (!email.includes('@')) { /* show error */ return; }
  $('#forgot-send').disabled = true;
  try {
    const r = await fetch('https://your-backend.com/api/forgot/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!r.ok) throw new Error('Send failed');
    $('#forgot-email-display').textContent = email;
    showForgotStep(2);
    startResend();
  } catch (e) {
    $('#forgot-error-1').textContent = 'Could not send code';
    $('#forgot-error-1').hidden = false;
  } finally { $('#forgot-send').disabled = false; }
};

$('#forgot-verify').onclick = async () => {
  const code = $$('.otp-input').map(i => i.value).join('');
  if (code.length !== 6) { /* show error */ return; }
  try {
    const r = await fetch('https://your-backend.com/api/forgot/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('#forgot-email-display').textContent, code })
    });
    if (!r.ok) throw new Error('Invalid code');
    showForgotStep(3);
  } catch (e) {
    $('#forgot-error-2').textContent = e.message;
    $('#forgot-error-2').hidden = false;
  }
};
```

The hardcoded `code !== '123456'` check goes away.

## Drop-in services

- **Resend** (cleanest API): https://resend.com — `npm i resend`
- **SendGrid**: https://sendgrid.com — Free tier 100/day
- **Mailgun**: https://mailgun.com — Free tier 5,000/month for 3 months
- **Postmark**: https://postmarkapp.com — Best deliverability, paid
- **AWS SES**: cheap at scale, fiddly to set up

For deliverability you'll need a verified sending domain with SPF and DKIM records. Don't send from a Gmail address.

## Stretch: passwordless sign-in

While you're adding email, consider replacing passwords entirely with magic links. The current Infos design assumes password-based sign-in, but it's straightforward to swap: the same email/code flow above can be used to sign in directly. Then store no passwords at all, only emails — which sidesteps the entire E2E encryption layer for the owner account (business view-only sign-ins still benefit from it).
