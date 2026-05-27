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
  // Validate business_id is a UUID (it flows into a REST query) and email looks valid.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(String(business_id))) {
    res.status(400).json({ error: 'business_id must be a valid UUID' });
    return;
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(member_email))) {
    res.status(400).json({ error: 'member_email must be a valid email address' });
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

    let memberUid;
    if (createRes.ok) {
      const created = await createRes.json();
      memberUid = created && (created.id || (created.user && created.user.id));
    } else {
      // The account likely already exists (created on a previous share). Make this
      // IDEMPOTENT: find the existing user and UPDATE its password to the current
      // one, so the owner can re-set the business password and it actually takes
      // effect. (Without this, the auth account keeps its original password and
      // sign-in fails with "incorrect email or password" forever.)
      const detail = await createRes.text();
      const looksDuplicate = /already|exists|registered|duplicate|been registered/i.test(detail);
      if (!looksDuplicate) {
        res.status(400).json({ error: 'Could not create member login', detail });
        return;
      }
      // Look up the existing user by email. The admin list endpoint's ?email=
      // filter isn't honored on every GoTrue version, so we match explicitly
      // against the returned list rather than blindly taking the first row.
      const wantEmail = String(member_email).toLowerCase();
      const lookup = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(wantEmail)}`,
        { headers: adminHeaders }
      );
      const lk = lookup.ok ? await lookup.json() : null;
      const userList = lk && (Array.isArray(lk.users) ? lk.users : (Array.isArray(lk) ? lk : []));
      const existing = (userList || []).find(u => String(u.email || '').toLowerCase() === wantEmail) || null;
      memberUid = existing && existing.id;
      if (!memberUid) {
        res.status(400).json({ error: 'Member already exists but could not be located to update', detail });
        return;
      }
      // Update password + re-stamp metadata + keep email confirmed.
      const upd = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${memberUid}`, {
        method: 'PUT',
        headers: adminHeaders,
        body: JSON.stringify({
          password: String(member_password),
          email_confirm: true,
          user_metadata: { role: 'member', business_id }
        })
      });
      if (!upd.ok) {
        const ud = await upd.text();
        res.status(500).json({ error: 'Could not update existing member password', detail: ud });
        return;
      }
    }
    if (!memberUid) { res.status(500).json({ error: 'Member created but id missing' }); return; }

    // 5) Link the member to the business with allowed tabs. Use an upsert keyed
    //    on the (business_id, member_uid) unique constraint so re-sharing doesn't
    //    fail on a duplicate. If the row already exists, that's success (the link
    //    is what we wanted). Update allowed_tabs on conflict.
    const linkRes = await fetch(`${SUPABASE_URL}/rest/v1/business_members?on_conflict=business_id,member_uid`, {
      method: 'POST',
      headers: { ...adminHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ business_id, member_uid: memberUid, allowed_tabs })
    });
    if (!linkRes.ok) {
      const detail = await linkRes.text();
      // If it failed because the link already exists, that's fine — the member is
      // linked, which is the goal. Only treat genuine errors as failures.
      if (/duplicate|already exists|conflict/i.test(detail)) {
        // already linked — proceed
      } else {
        res.status(500).json({ error: 'Could not link member to business', detail });
        return;
      }
    }

    res.status(200).json({ created: true, member_uid: memberUid });
  } catch (e) {
    res.status(500).json({ error: 'Unexpected error', detail: String(e && e.message || e) });
  }
}
