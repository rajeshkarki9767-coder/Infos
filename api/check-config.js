// Vercel Serverless Function — GET /api/check-config
// ---------------------------------------------------------------------------
// DIAGNOSTIC ONLY. Reports whether the server-side env vars needed for account
// deletion are visible to the serverless runtime — WITHOUT exposing their
// values. Safe to deploy; returns only booleans and lengths.
//
// Visit: https://YOUR-APP.vercel.app/api/check-config
// Expected when healthy: {"hasUrl":true,"hasServiceRole":true,...}
//
// You can delete this file once deletion is confirmed working.
// ---------------------------------------------------------------------------

export default function handler(req, res) {
  const url = process.env.SUPABASE_URL || '';
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const anon = process.env.SUPABASE_ANON_KEY || '';

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    hasUrl: !!url,
    urlLength: url.length,
    hasServiceRole: !!serviceRole,
    serviceRoleLength: serviceRole.length,          // ~200+ chars if real
    serviceRoleLooksValid: serviceRole.startsWith('eyJ'),
    hasAnon: !!anon,
    // The two booleans below are what the delete function checks.
    deleteFunctionWouldRun: !!(url && serviceRole)
  });
}
