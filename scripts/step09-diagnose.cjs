// GET /rest/v1/ only. No SQL, table row reads, credentials or arbitrary response bodies logged.
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const root = path.resolve(__dirname, '..');
function classify(body) {
  const text = `${body?.message || ''} ${body?.error_description || ''} ${body?.error || ''}`.toLowerCase();
  const code = /^[A-Z][A-Z0-9_]{0,31}$/.test(body?.code || '') ? body.code : null;
  return { code, category: text.includes('invalid api key') ? 'invalid_api_key' :
    text.includes('no api key') ? 'missing_api_key' : text.includes('expired') ? 'expired_token' :
    text.includes('jwt') || text.includes('token') ? 'token_error' : text.includes('permission') ? 'permission_error' : 'unclassified' };
}
async function main() {
  const front = dotenv.parse(fs.readFileSync(path.join(root, 'frontend/.env')));
  const back = dotenv.parse(fs.readFileSync(path.join(root, 'backend/.env')));
  const url = new URL(front.REACT_APP_SUPABASE_URL);
  const key = front.REACT_APP_SUPABASE_ANON_KEY;
  const jwt = key?.split('.').length === 3;
  let claims = {};
  try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')); } catch {}
  console.log(JSON.stringify({ https: url.protocol === 'https:', rootPath: url.pathname === '/',
    standardProjectHost: /^[a-z0-9]+\.supabase\.co$/.test(url.hostname), sameBackendUrl: url.href.replace(/\/$/, '') === (back.SUPABASE_URL || '').replace(/\/$/, ''),
    keyFormat: jwt ? 'jwt' : key?.startsWith('sb_publishable_') ? 'publishable' : 'other',
    anonClaim: claims.role === 'anon', projectRefMatchesHost: claims.ref ? url.hostname.startsWith(`${claims.ref}.`) : null,
    expiredNow: claims.exp ? claims.exp * 1000 <= Date.now() : null,
    envOverridesPresent: ['.env.local', '.env.development', '.env.development.local'].filter((file) => fs.existsSync(path.join(root, 'frontend', file))),
  }));
  const endpoint = url.href.replace(/\/$/, '') + '/rest/v1/';
  for (const mode of jwt ? ['apikey-only', 'apikey-and-anon-bearer'] : ['apikey-only']) {
    const headers = { apikey: key, Accept: 'application/openapi+json' };
    if (mode.includes('bearer')) headers.Authorization = `Bearer ${key}`;
    try {
      const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(15000) });
      let body = {}; if (!response.ok) { try { body = await response.json(); } catch {} }
      console.log(JSON.stringify({ mode, status: response.status, ...classify(body) }));
    } catch (error) { console.log(JSON.stringify({ mode, networkError: error.cause?.code || error.name })); process.exitCode = 2; }
  }
  // Observe supabase-js headers with an in-process fake fetch; no row request is sent.
  const client = createClient(url.href, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (request, options) => {
      const headers = new Headers(options?.headers);
      console.log(JSON.stringify({ sdkOfflineHeaderCheck: true, apiKeyMatches: headers.get('apikey') === key,
        anonymousBearerMatches: headers.get('authorization') === `Bearer ${key}` }));
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    } } });
  await client.from('__offline_header_probe__').select('id');
}

module.exports = { classify };

if (require.main === module) {
  main().catch((error) => {
    console.error("Diagnostic failed:", {
      name: error?.name ?? "UnknownError",
      code: error?.code ?? null,
      causeCode: error?.cause?.code ?? null,
    });

    process.exitCode = 2;
  });
}

