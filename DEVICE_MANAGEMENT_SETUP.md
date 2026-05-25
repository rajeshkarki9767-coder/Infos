# Device Management Setup

The "Devices" section in Settings → Data lets users see every browser/device
their account is signed in on, rename them ("Anil's iPhone"), and sign out
individual devices or all-others-at-once.

The UI is already built into the app. To make it functional, deploy these
3 pieces in order:

## 1. Run the SQL migration

In Supabase Dashboard → SQL Editor → New Query, paste the contents of:

```
sql/v89.30.5_app_device_names.sql
```

Click Run. This creates:
- `app_device_names` table (custom labels per device, RLS enabled)
- `list_user_auth_sessions(uuid)` SECURITY DEFINER function (reads auth.sessions)
- `revoke_user_auth_session(uuid, uuid)` SECURITY DEFINER function (deletes one session)

Verify with the queries at the bottom of the SQL file.

## 2. Deploy `list-my-sessions` Edge Function

From your repo root:

```bash
# One-time setup (skip if already done for delete-self-account):
npm install -g supabase
supabase login
supabase link --project-ref sdovwbxqxvbbtpndrohd

# Deploy:
supabase functions deploy list-my-sessions
```

The function source is at: `supabase/functions/list-my-sessions/index.ts`

Verify in Dashboard → Edge Functions → `list-my-sessions` shows "Active".

## 3. Deploy `revoke-my-session` Edge Function

```bash
supabase functions deploy revoke-my-session
```

Source: `supabase/functions/revoke-my-session/index.ts`

## 4. Test from the app

1. Sign in on two devices (e.g. laptop + phone, or two browsers).
2. On either device, open Settings → Data → scroll to "Devices".
3. You should see both sessions listed. The current one is marked
   "THIS DEVICE" with a green badge.
4. Tap "Rename" on the current device → enter a label like "Anil's iPhone".
5. Tap "Sign out" on a non-current device → confirm. Within ~1 hour
   that device gets signed out (Supabase's refresh-token expiry); on the
   next page load there it will redirect to sign-in.

## Security model

- **`list-my-sessions`**: verifies the caller's JWT, gets their user_id,
  then calls `list_user_auth_sessions(user_id)`. The user can only ever
  see their own sessions.
- **`revoke-my-session`**: verifies the caller's JWT, gets their user_id,
  then calls `revoke_user_auth_session(user_id, target_session_id)`. The
  database function physically checks both `id` AND `user_id` in the
  DELETE, so even a tampered request can never delete someone else's
  session. Returns 404 if no row matched (refuses silently to avoid
  leaking valid session IDs).
- **`app_device_names`**: RLS-protected so users can only read/write
  their own device labels.
- **Service-role key**: only used inside the Edge Functions (server-side).
  Never sent to the client.

## What happens if you skip this setup?

The app gracefully detects the missing functions and shows a placeholder
in the Devices section explaining that the feature isn't deployed yet.
No errors, no broken UI — just a soft "feature unavailable" state.
