// Vercel Serverless Function — GET /api/config
// ---------------------------------------------------------------------------
// Returns the PUBLIC Supabase config (project URL + anon key) from Vercel
// environment variables, so the keys live in Vercel's settings rather than in
// the committed repo. The anon key is public-safe by design — its exposure is
// fine; real protection comes from Row-Level Security on the database.
//
// IMPORTANT: only ever read SUPABASE_URL and SUPABASE_ANON_KEY here.
// NEVER read or return the service_role key. It must not exist in any
// client-reachable code path.
//
// Set these in: Vercel project → Settings → Environment Variables
//   SUPABASE_URL       = https://YOUR-PROJECT.supabase.co
//   SUPABASE_ANON_KEY  = your public anon key
// ---------------------------------------------------------------------------

export default function handler(req, res) {
  // Only GET; reject anything else.
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const url = process.env.SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';

  // Don't cache — keeps rotation easy.
  res.setHeader('Cache-Control', 'no-store');

  // If unset, return an empty (but valid) config so the app falls back to
  // local-only mode instead of erroring.
  res.status(200).json({
    configured: !!(url && anonKey),
    url,
    anonKey
  });
}
