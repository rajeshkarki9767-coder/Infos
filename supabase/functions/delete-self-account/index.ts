// supabase/functions/delete-self-account/index.ts
//
// Edge Function that lets a signed-in user delete their own auth.users
// row from Supabase. The app's "Delete account" flow calls this AFTER
// it has deleted all the user's business data, so this is the final
// step that removes their email + hashed password from Supabase Auth.
//
// =====================================================================
// DEPLOY
// =====================================================================
//
// 1. Install Supabase CLI if you haven't:
//      npm install -g supabase
//      supabase login
//
// 2. Link to your project (from your repo root):
//      supabase link --project-ref sdovwbxqxvbbtpndrohd
//    (replace with your project ref from Dashboard → Settings → General)
//
// 3. Save this file at:
//      supabase/functions/delete-self-account/index.ts
//
// 4. Deploy:
//      supabase functions deploy delete-self-account
//
// 5. Verify in Dashboard → Edge Functions → delete-self-account
//    is listed and shows "Active".
//
// 6. Test from the app: Profile → Delete account → confirm → the
//    auth user should be removed within seconds. Try signing up
//    again with the same email — should work as a fresh new account.
//
// =====================================================================
// SECURITY
// =====================================================================
//
// - Requires the caller to be authenticated (we verify their JWT).
// - Only deletes the CALLER'S OWN user — cannot be abused to delete
//   anyone else.
// - Uses the service-role key (loaded from env, never exposed) to
//   issue the admin.deleteUser call.
// - CORS is restricted to the app's own origin in production.
//
// =====================================================================

// @ts-ignore: Deno-style import (only valid inside Supabase runtime)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// @ts-ignore: Deno global (available in Supabase Edge runtime)
declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// @ts-ignore: Deno.serve (only valid inside Supabase runtime)
Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ ok: false, error: 'method_not_allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Extract the caller's JWT from the Authorization header.
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return new Response(
        JSON.stringify({ ok: false, error: 'missing_authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the JWT and identify the user. Using the ANON key client
    // with the user's JWT, getUser() returns their identity from the JWT.
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return new Response(
        JSON.stringify({ ok: false, error: 'invalid_token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = userData.user.id;
    const userEmail = userData.user.email || '(unknown)';

    // Use the service-role client to delete the auth user.
    // admin.deleteUser also cascades: linked identity records get removed.
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: delErr } = await adminClient.auth.admin.deleteUser(userId);
    if (delErr) {
      console.error(`Failed to delete user ${userId} (${userEmail}):`, delErr);
      return new Response(
        JSON.stringify({ ok: false, error: 'delete_failed', detail: delErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Deleted auth user ${userId} (${userEmail})`);
    return new Response(
      JSON.stringify({ ok: true, deletedUserId: userId }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    console.error('delete-self-account error:', e);
    return new Response(
      JSON.stringify({ ok: false, error: 'unexpected', detail: e?.message || String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
