// supabase/functions/revoke-my-session/index.ts
//
// Edge Function that signs out one specific Supabase auth session
// belonging to the caller. The app calls this when the user taps
// "Sign out" on a specific device in Settings → Data → Devices.
//
// =====================================================================
// DEPLOY
// =====================================================================
//
// 1. Save this file at:
//      supabase/functions/revoke-my-session/index.ts
//
// 2. Deploy (after `supabase link` per the list-my-sessions instructions):
//      supabase functions deploy revoke-my-session
//
// 3. Verify in Dashboard → Edge Functions → revoke-my-session
//    is listed and shows "Active".
//
// 4. Test from the app: Settings → Data → Devices section. Sign out
//    a non-current device — it should disappear from the list. The
//    user on that device gets signed out within ~1 hour (Supabase's
//    refresh-token TTL) or the next time their access token expires.
//
// =====================================================================
// SECURITY
// =====================================================================
//
// - Requires the caller to be authenticated (we verify their JWT).
// - Only revokes sessions OWNED BY the caller — checks that the
//   target session.user_id == caller.user_id BEFORE deleting. Refuses
//   silently with 404 otherwise (so attackers can't probe for valid
//   session IDs).
// - Uses the service-role key (loaded from env, never exposed).
//
// =====================================================================
// REQUEST SHAPE
// =====================================================================
//
//   POST /functions/v1/revoke-my-session
//   Authorization: Bearer <caller-jwt>
//   Content-Type: application/json
//
//   { "sessionId": "<uuid-of-session-to-revoke>" }
//
// =====================================================================
// RESPONSE SHAPE
// =====================================================================
//
//   200 OK   → { ok: true, revoked: "<session-uuid>" }
//   400      → { ok: false, error: "missing_session_id" }
//   401      → { ok: false, error: "missing_authorization" | "invalid_token" }
//   404      → { ok: false, error: "session_not_found_or_not_yours" }
//   500      → { ok: false, error: "...", detail: "..." }
//
// =====================================================================

// @ts-ignore: Deno-style import (only valid inside Supabase runtime)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// @ts-ignore: Deno global (available in Supabase Edge runtime)
declare const Deno: any;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;

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
    // Verify caller JWT
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    if (!token) {
      return new Response(
        JSON.stringify({ ok: false, error: 'missing_authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    // Parse body
    let body: any = {};
    try { body = await req.json(); }
    catch (_) {
      return new Response(
        JSON.stringify({ ok: false, error: 'invalid_json_body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // The app sends 'session_id' (snake_case) but we accept either form
    // to keep the API tolerant. Trim and validate as a UUID-shaped string.
    const sessionId = String(body?.session_id || body?.sessionId || '').trim();
    if (!sessionId) {
      return new Response(
        JSON.stringify({ ok: false, error: 'missing_session_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // Basic UUID shape check (Supabase session IDs are UUIDv4). Reject
    // garbage before we hit the database — also prevents accidental
    // injection if the DB layer ever stops parameterizing.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
      return new Response(
        JSON.stringify({ ok: false, error: 'invalid_session_id_format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service-role client (with SQL access) to verify ownership
    // and delete the session.
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Ownership check + delete in one RPC. The SECURITY DEFINER
    // function does both atomically so we can never accidentally
    // delete a session that doesn't belong to the caller.
    const { data: rpcResult, error: rpcErr } = await adminClient.rpc(
      'revoke_user_auth_session',
      { p_user_id: userId, p_session_id: sessionId }
    );

    if (rpcErr) {
      console.error('revoke_user_auth_session failed:', rpcErr);
      return new Response(
        JSON.stringify({ ok: false, error: 'revoke_failed', detail: rpcErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // RPC returns the number of rows deleted. 0 means either the
    // session didn't exist or didn't belong to the caller — either
    // way, refuse silently with 404 to avoid leaking info about
    // other users' sessions.
    const deletedCount = typeof rpcResult === 'number' ? rpcResult : 0;
    if (deletedCount === 0) {
      return new Response(
        JSON.stringify({ ok: false, error: 'session_not_found_or_not_yours' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Also clean up app_device_names rows pointing at this session
    // so the device disappears from the list. Use adminClient (NOT
    // userClient) because if the caller just revoked their OWN current
    // session, the userClient's JWT is now invalid and the cleanup
    // would silently fail. We still explicitly filter by user_id +
    // session_id to ensure we never delete someone else's row.
    try {
      await adminClient
        .from('app_device_names')
        .delete()
        .eq('user_id', userId)
        .eq('session_id', sessionId);
    } catch (cleanupErr) {
      // Non-fatal — the row will just have a stale session_id.
      console.warn('app_device_names cleanup failed (continuing):', cleanupErr);
    }

    console.log(`Revoked session ${sessionId} for user ${userId}`);
    return new Response(
      JSON.stringify({ ok: true, revoked: sessionId }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    console.error('revoke-my-session error:', e);
    return new Response(
      JSON.stringify({ ok: false, error: 'unexpected', detail: e?.message || String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
