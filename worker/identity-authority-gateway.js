/**
 * MAOMAO existing-account identity gateway (server-to-server only).
 *
 * This Worker has no public route or workers.dev hostname. It owns NO users,
 * passwords, sessions or databases. A Cloudflare service binding lets the
 * isolated QA Worker reach the original 2026-11-11 founder preview's Durable
 * Object through an explicit, audited namespace binding.
 *
 * Never change MAO_ORIGINAL_AUTH_DB to the production/old-founder namespace.
 */
const INTERNAL_ORIGIN = 'https://mao520.com';
const BRIDGE_HEADER = 'x-mao-identity-bridge';
const OPERATIONS = new Set([
  'GET /api/admin/bootstrap/status',
  'POST /api/accounts/login',
  'GET /api/accounts/me',
  'POST /api/accounts/logout'
]);
const OBJECT_NAME = 'maomao-global';

function error(status, code) {
  return new Response(JSON.stringify({ok:false,error:{code}}), {
    status, headers:{'content-type':'application/json','cache-control':'no-store'}
  });
}
async function authorized(configured, supplied) {
  if (configured.length < 32 || supplied.length < 32) return false;
  const encoder = new TextEncoder();
  const values = await Promise.all([configured, supplied].map(secret =>
    crypto.subtle.digest('SHA-256',encoder.encode('mao-identity-gateway|' + secret))
  ));
  const a=new Uint8Array(values[0]), b=new Uint8Array(values[1]);
  if (a.length !== b.length) return false;
  let difference=0;
  for(let i=0;i<a.length;i++) difference|=a[i]^b[i];
  return difference===0;
}
export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    const route=request.method.toUpperCase()+' '+url.pathname;
    if(url.origin !== INTERNAL_ORIGIN || url.search || !OPERATIONS.has(route)) {
      return error(404,'IDENTITY_GATEWAY_ROUTE_DENIED');
    }
    const supplied=String(request.headers.get(BRIDGE_HEADER)||'');
    const configured=String(env.MAO_IDENTITY_BRIDGE_SECRET||'');
    if(!await authorized(configured,supplied)) {
      return error(403,'IDENTITY_GATEWAY_FORBIDDEN');
    }
    if(typeof env.MAO_ORIGINAL_AUTH_DB?.get !== 'function' ||
       typeof env.MAO_ORIGINAL_AUTH_DB?.idFromName !== 'function') {
      return error(503,'IDENTITY_GATEWAY_STORAGE_UNAVAILABLE');
    }
    const headers=new Headers(request.headers);
    headers.delete(BRIDGE_HEADER);
    // Never expose gateway's secret to the underlying account application.
    const forwarded=new Request(request,{headers});
    const objectId=env.MAO_ORIGINAL_AUTH_DB.idFromName(OBJECT_NAME);
    return env.MAO_ORIGINAL_AUTH_DB.get(objectId).fetch(forwarded);
  }
};