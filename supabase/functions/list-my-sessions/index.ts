// supabase/functions/list-my-sessions/index.ts
//
// Edge Function that returns the current user's active Supabase auth
// sessions, joined with any custom device names they've assigned in
// public.app_device_names. Powers the "Devices" section in the app's
// Settings → Data view.
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
//      supabase/functions/list-my-sessions/index.ts
//
// 4. Deploy:
//      supabase functions deploy list-my-sessions
//
// 5. Verify in Dashboard → Edge Functions → list-my-sessions
//    is listed and shows "Active".
//
// 6. Test from the app: Settings → Data → Devices section. It should
//    list each browser/device you've signed in from, with the current
//    one marked "THIS DEVICE".
//
// PRE-REQUISITE: Run sql/v89.30.5_app_device_names.sql first so the
// app_device_names table exists.
//
// =====================================================================
// SECURITY
// =====================================================================
//
// - Requires the caller to be authenticated (we verify their JWT).
// - Returns ONLY the caller's own sessions — uses admin.listUsers to
//   look up sessions filtered by the verified user_id from the JWT.
// - Uses the service-role key (loaded from env, never exposed in the
//   response). The service-role client is scoped to ONE call.
// - CORS allows any origin (so it works from the hisabs.app domain
//   AND from previews). Tighten to your domain in production if you
//   want to restrict.
//
// =====================================================================
// RESPONSE SHAPE
// =====================================================================
//
//   { ok: true, sessions: [
//       {
//         id:           "session-uuid",
//         user_agent:   "Mozilla/5.0 ...",
//         device_name:  "Anil's iPhone" | null,
//         created_at:   "2026-05-01T10:23:45Z",
//         updated_at:   "2026-05-19T14:22:00Z",
//         ip:           "203.0.113.5",         (omitted if missing)
//         city:         null,                  (reserved for future)
//         country:      null,                  (reserved for future)
//       },
//       ...
//   ] }
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

    // Use service-role to query auth.sessions for THIS user only.
    // We use the Postgres connection (via the admin client's REST API)
    // rather than admin.listUsers, because admin.listUsers doesn't
    // expose per-session detail in a clean shape.
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Query auth.sessions directly via the service-role REST endpoint.
    // The auth schema isn't directly exposed to PostgREST by default,
    // so we use the raw SQL endpoint via rpc OR fetch through the
    // admin REST API. Simpler: use a SECURITY DEFINER function or
    // direct PostgREST call to auth schema (requires exposing auth in
    // db settings). To avoid that requirement, we use a custom SQL
    // query through the admin client.
    //
    // Workaround: PostgREST cannot directly query auth.sessions, so we
    // create the query via a custom SQL function we install once. For
    // simplicity here, we query the table via the underlying Postgres
    // connection using the postgrest-js client's rpc to a tiny helper.
    //
    // Approach used: read auth.sessions via a dedicated SECURITY
    // DEFINER function defined alongside this Edge Function (see
    // sql/v89.30.5_app_device_names.sql which also adds it). The
    // function returns rows for the requesting user only.

    const { data: sessionsData, error: sessErr } = await adminClient.rpc(
      'list_user_auth_sessions',
      { p_user_id: userId }
    );

    if (sessErr) {
      console.error('list_user_auth_sessions failed:', sessErr);
      return new Response(
        JSON.stringify({ ok: false, error: 'sessions_query_failed', detail: sessErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const sessions = Array.isArray(sessionsData) ? sessionsData : [];

    // Join with app_device_names so the app can show custom labels.
    // Use the user client (RLS-scoped) so we never accidentally leak
    // other users' names.
    const { data: namesData, error: namesErr } = await userClient
      .from('app_device_names')
      .select('session_id, name')
      .eq('user_id', userId);

    if (namesErr) {
      console.warn('app_device_names read failed (continuing without names):', namesErr);
    }

    const nameBySession = new Map<string, string>();
    for (const row of (namesData || [])) {
      if (row?.session_id) nameBySession.set(row.session_id, row.name);
    }

    const merged = sessions.map((s: any) => ({
      id:          s.id,
      user_agent:  s.user_agent || null,
      device_name: nameBySession.get(s.id) || null,
      created_at:  s.created_at || null,
      updated_at:  s.updated_at || null,
      ip:          s.ip || null,
      city:        null,
      country:     null,
    }));

    // Sort: most recently updated first
    merged.sort((a, b) => {
      const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return tb - ta;
    });

    return new Response(
      JSON.stringify({ ok: true, sessions: merged }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e: any) {
    console.error('list-my-sessions error:', e);
    return new Response(
      JSON.stringify({ ok: false, error: 'unexpected', detail: e?.message || String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
