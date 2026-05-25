# Infos — branded email templates

Three HTML email templates styled to match the Infos app (logo + brand color
#378ADD). They're written email-client-safe: table layout, inline styles, the
logo drawn in HTML (no external image needed), and Supabase's Go template
variables ({{ .ConfirmationURL }}, {{ .NewEmail }}).

## How to install (Supabase dashboard)
1. Go to **Authentication → Email Templates**.
2. Pick the template on the left and paste the matching file into the body:
   - **Confirm signup**  ← confirm-signup.html   (Subject: Confirm your Infos account)
   - **Reset password**  ← reset-password.html   (Subject: Reset your Infos password)
   - **Change Email Address** ← change-email.html (Subject: Confirm your new Infos email address)
3. Set the Subject line for each (suggestions above), then **Save**.

## Notes
- The logo is built with HTML/CSS so it works without hosting an image. If you'd
  rather use a real image, `infos-logo.png` (240×240) is included — host it and
  swap the logo `<td>` for: <img src="YOUR-URL/infos-logo.png" width="56" height="56" alt="Infos" style="border-radius:15px;display:block;">
- Test by triggering each flow (sign up, reset password, change email) after
  pasting, and check how it looks in your own inbox — clients vary slightly.
- Keep the {{ .ConfirmationURL }} variable intact; Supabase replaces it with the
  real secure link when sending.
