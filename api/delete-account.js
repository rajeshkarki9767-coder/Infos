// Vercel Serverless Function — POST /api/delete-account
// ---------------------------------------------------------------------------
// Permanently deletes the CURRENTLY-AUTHENTICATED user's Supabase auth account.
//
// WHY THIS NEEDS A SERVER FUNCTION:
//   Deleting an auth user requires admin privileges (the service_role key),
//   which must NEVER be exposed in the browser. This function runs server-side
//   on Vercel, verifies the caller's identity from their own access token, then
//   deletes only that user. The service_role key is read from a Vercel env var
//   and never reaches the client.
//
// SETUP (required before this works):
//   1. Add to Vercel → Settings → Environment Variables:
//        SUPABASE_URL              = https://YOUR-PROJECT.supabase.co
//        SUPABASE_SERVICE_ROLE_KEY = your service_role key  (KEEP SECRET)
//      (SUPABASE_SERVICE_ROLE_KEY is separate from the anon key. Never commit it,
//       never put it in client code. It lives only in Vercel env vars.)
//   2. Install the Supabase admin client for the function. Easiest path: add a
//      package.json with "@supabase/supabase-js" as a dependency so Vercel
//      installs it for the serverless runtime. (If you skip this, the function
//      falls back to a direct REST call, below, which needs no dependency.)
//
// The app calls this with the user's access token in the Authorization header.
// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    res.status(500).json({ error: 'Server not configured for account deletion' });
    return;
  }

  // 1) Identify the caller from their bearer token (their own session).
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: 'Missing access token' });
    return;
  }

  try {
    // Verify the token and get the user id by calling Supabase's auth endpoint.
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${token}` }
    });
    if (!userRes.ok) {
      res.status(401).json({ error: 'Invalid or expired session' });
      return;
    }
    const user = await userRes.json();
    const userId = user && user.id;
    if (!userId) {
      res.status(401).json({ error: 'Could not identify user' });
      return;
    }

    // 1b) A BUSINESS LOGIN (member) must not self-delete the shared account — the
    //     owner manages those credentials. Refuse and tell them to ask the owner.
    const md = (user.user_metadata || {});
    const am = (user.app_metadata || {});
    if (md.role === 'member' || am.role === 'member') {
      res.status(403).json({ error: 'A business login cannot be deleted here. Ask the business owner to remove this login.' });
      return;
    }

    const adminHeaders = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` };

    // 2) Clean up the member auth accounts this OWNER created, so they don't
    //    orphan when the owner is deleted. We find every business this owner owns,
    //    then every member_uid linked to those businesses, and delete those auth
    //    users. (The businesses + shared_state + business_members rows themselves
    //    cascade-delete when the owner auth user is removed in step 4.)
    try {
      const bizRes = await fetch(
        `${SUPABASE_URL}/rest/v1/businesses?owner_id=eq.${userId}&select=id`,
        { headers: { ...adminHeaders, 'Content-Type': 'application/json' } }
      );
      const businesses = bizRes.ok ? await bizRes.json() : [];
      const bizIds = Array.isArray(businesses) ? businesses.map(b => b.id) : [];
      if (bizIds.length) {
        const inList = bizIds.map(encodeURIComponent).join(',');
        const memRes = await fetch(
          `${SUPABASE_URL}/rest/v1/business_members?business_id=in.(${inList})&select=member_uid`,
          { headers: { ...adminHeaders, 'Content-Type': 'application/json' } }
        );
        const members = memRes.ok ? await memRes.json() : [];
        const memberUids = Array.from(new Set((Array.isArray(members) ? members : []).map(m => m.member_uid).filter(Boolean)));
        // Delete each hidden member auth account (best-effort; don't fail the whole
        // request if one delete errors — the owner delete is what matters).
        for (const uid of memberUids) {
          try {
            await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: adminHeaders });
          } catch (_) { /* best-effort cleanup */ }
        }
      }
    } catch (_) { /* cleanup is best-effort; proceed to delete the owner */ }

    // 3) Delete the user's data row (admin REST call, bypasses RLS but scoped by us).
    await fetch(`${SUPABASE_URL}/rest/v1/app_state?user_id=eq.${userId}`, {
      method: 'DELETE',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        Prefer: 'return=minimal'
      }
    });

    // 4) Delete the auth user itself (admin endpoint, requires service_role).
    //    This cascades to businesses / shared_state / business_members owned by
    //    this user (on delete cascade in the schema).
    const delRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` }
    });
    if (!delRes.ok) {
      const body = await delRes.text();
      res.status(500).json({ error: 'Failed to delete account', detail: body });
      return;
    }

    res.status(200).json({ deleted: true });
  } catch (e) {
    res.status(500).json({ error: 'Unexpected error', detail: String(e && e.message || e) });
  }
}
