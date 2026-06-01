// ============================================================================
//  Infos — send-push Edge Function (Stage 4)
// ----------------------------------------------------------------------------
//  Sends a Web Push notification to every device subscribed to a given business.
//
//  Called by the app (Stage 5) after an owner saves/edits an entry. It:
//    1. Authenticates the caller (must be a signed-in user who can access the biz)
//    2. Looks up all push_subscriptions for that business (service role)
//    3. Sends each one a Web Push signed with the PRIVATE VAPID key (a secret)
//    4. Cleans up subscriptions the push service reports as gone (410/404)
//
//  SECRETS required (set via: supabase secrets set ...):
//    - VAPID_PUBLIC_KEY     (same public key shipped in the app)
//    - VAPID_PRIVATE_KEY    (the secret half — NEVER in the repo/app)
//    - VAPID_SUBJECT        (a "mailto:you@example.com" contact, required by spec)
//  Auto-provided by Supabase:
//    - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import webpush from 'https://esm.sh/web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
    const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')!;
    const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')!;
    const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:notify@infos.app';

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

    const body = await req.json().catch(() => ({}));
    const businessId = body.business_cloud_id;
    const title = (body.title || 'Infos').toString().slice(0, 80);
    const message = (body.body || 'New update').toString().slice(0, 180);
    const url = (body.url || '/').toString();
    if (!businessId) {
      return new Response(JSON.stringify({ error: 'business_cloud_id required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // 1) AUTH: verify the caller is signed in AND can access this business.
    //    We use the caller's JWT (from the Authorization header) with the ANON
    //    client so RLS/can_access_business applies — a caller cannot trigger
    //    pushes for a business they don't belong to.
    const authHeader = req.headers.get('Authorization') || '';
    const callerClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    // Confirm access: try to read the business row under the caller's RLS.
    const { data: bizRow } = await callerClient
      .from('businesses').select('id').eq('id', businessId).maybeSingle();
    if (!bizRow) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // 2) Read ALL subscriptions for the business with the SERVICE ROLE (bypasses
    //    RLS so we can see every member's device, not just the caller's).
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: subs, error: subErr } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('business_cloud_id', businessId);
    if (subErr) {
      return new Response(JSON.stringify({ error: subErr.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    const payload = JSON.stringify({ title, body: message, url, tag: 'infos-' + businessId });
    let sent = 0, removed = 0;
    const stale: string[] = [];

    // 3) Send to each subscription.
    await Promise.all((subs || []).map(async (s) => {
      const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
      try {
        await webpush.sendNotification(subscription, payload);
        sent++;
      } catch (err: any) {
        const code = err?.statusCode;
        // 404/410 = subscription no longer valid; mark for cleanup.
        if (code === 404 || code === 410) stale.push(s.id);
      }
    }));

    // 4) Clean up dead subscriptions.
    if (stale.length) {
      await admin.from('push_subscriptions').delete().in('id', stale);
      removed = stale.length;
    }

    return new Response(JSON.stringify({ ok: true, sent, removed, total: (subs || []).length }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
