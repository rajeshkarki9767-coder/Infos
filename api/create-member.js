// Vercel Serverless Function — POST /api/create-member
// ---------------------------------------------------------------------------
// STAGE 2 of member cloud sync.
//
// Creates a HIDDEN Supabase auth account for a "business login" and links it to
// one of the CALLER's businesses with a set of allowed tabs. The team member
// will later sign in with this email + password (which the owner sets and hands
// to them) and — thanks to the Stage 1 RLS — can read ONLY that business's
// allowed tabs, read-only.
//
// SECURITY MODEL
//   • The caller must be signed in (owner). We verify their token.
//   • We verify the caller actually OWNS the target business before linking.
//   • Creating an auth user requires admin rights → service_role, server-side
//     only. Never exposed to the client.
//
// REQUEST (JSON body):
//   { business_id, member_email, member_password, allowed_tabs: [..] }
//
// RESPONSE:
//   { created: true, member_uid }  or  { error, detail }
//
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (already set).
// ---------------------------------------------------------------------------

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    res.status(500).json({ error: 'Server not configured for member creation' });
    return;
  }

  // 1) Identify + verify the caller (the owner).
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) { res.status(401).json({ error: 'Missing access token' }); return; }

  // 2) Parse + validate input.
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { business_id, member_email, member_password } = body || {};
  let allowed_tabs = (body && body.allowed_tabs) || [];
  if (!Array.isArray(allowed_tabs)) allowed_tabs = [];
  if (!business_id || !member_email || !member_password) {
    res.status(400).json({ error: 'business_id, member_email and member_password are required' });
    return;
  }
  if (String(member_password).length < 6) {
    res.status(400).json({ error: 'Member password must be at least 6 characters' });
    return;
  }

  const adminHeaders = { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' };

  try {
    // Verify caller token → owner uid.
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${token}` }
    });
    if (!who.ok) { res.status(401).json({ error: 'Invalid or expired session' }); return; }
    const owner = await who.json();
    const ownerId = owner && owner.id;
    if (!ownerId) { res.status(401).json({ error: 'Could not identify caller' }); return; }

    // 3) Verify the caller OWNS the target business (defense in depth — RLS also
    //    enforces this, but we check explicitly before any admin action).
    const bizRes = await fetch(
      `${SUPABASE_URL}/rest/v1/businesses?id=eq.${encodeURIComponent(business_id)}&select=id,owner_id`,
      { headers: adminHeaders }
    );
    const biz = bizRes.ok ? await bizRes.json() : [];
    if (!Array.isArray(biz) || biz.length === 0 || biz[0].owner_id !== ownerId) {
      res.status(403).json({ error: 'You do not own this business' });
      return;
    }

    // 4) Create the hidden member auth account (email auto-confirmed so the
    //    member can sign in immediately with the credentials the owner gives).
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        email: String(member_email).toLowerCase(),
        password: String(member_password),
        email_confirm: true,
        user_metadata: { role: 'member', business_id }
      })
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      // Most common: email already in use.
      res.status(400).json({ error: 'Could not create member login', detail });
      return;
    }
    const created = await createRes.json();
    const memberUid = created && (created.id || (created.user && created.user.id));
    if (!memberUid) { res.status(500).json({ error: 'Member created but id missing' }); return; }

    // 5) Link the member to the business with allowed tabs.
    const linkRes = await fetch(`${SUPABASE_URL}/rest/v1/business_members`, {
      method: 'POST',
      headers: { ...adminHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ business_id, member_uid: memberUid, allowed_tabs })
    });
    if (!linkRes.ok) {
      const detail = await linkRes.text();
      // Roll back the orphaned auth account so we don't leave junk.
      try { await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${memberUid}`, { method: 'DELETE', headers: adminHeaders }); } catch {}
      res.status(500).json({ error: 'Could not link member to business', detail });
      return;
    }

    res.status(200).json({ created: true, member_uid: memberUid });
  } catch (e) {
    res.status(500).json({ error: 'Unexpected error', detail: String(e && e.message || e) });
  }
}
