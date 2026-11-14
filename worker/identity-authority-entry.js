/**
 * Dedicated permanent MAOMAO identity authority.
 *
 * An account is never created here by the gateway; its existing salted
 * verifier and account history are restored through an audited migration.
 * This Worker has no public routes once migration is completed and exposes
 * only original session authentication over a private Cloudflare binding.
 */
import { CloudDatabase } from '../worker.js';
export { CloudDatabase };

const AUTHORITY_ORIGIN = 'https://mao520.com';
const BRIDGE_HEADER = 'x-mao-identity-bridge';
const OBJECT_NAME = 'maomao-global';
const ROUTES = new Set([
  'GET /api/admin/bootstrap/status',
  'POST /api/accounts/login',
  'GET /api/accounts/me',
  'POST /api/accounts/logout'
]);

function deny(status, code) {
  return Response.json({ ok: false, error: { code } }, {
    status, headers: { 'cache-control': 'no-store' }
  });
}

async function acceptsSecret(expected, supplied) {
  if (expected.length < 32 || supplied.length < 32) return false;
  const encoder = new TextEncoder();
  const hashes = await Promise.all([expected, supplied].map(secret =>
    crypto.subtle.digest('SHA-256', encoder.encode('mao-identity-authority|' + secret))
  ));
  const a = new Uint8Array(hashes[0]), b = new Uint8Array(hashes[1]);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function handlePermanentIdentityRequest(request, env) {
  const url = new URL(request.url);
  const route = request.method.toUpperCase() + ' ' + url.pathname;
  const storage = env.CLOUD_DB;
  if (typeof storage?.idFromName !== 'function' || typeof storage?.get !== 'function') {
    return deny(503, 'IDENTITY_STORAGE_UNAVAILABLE');
  }
  // Temporary initialization probe for an otherwise private Worker. The
  // deployment disables this flag and workers.dev immediately afterwards.
  if (route === 'GET /__identity_storage_init' &&
      env.MAO_IDENTITY_ALLOW_INIT_PROBE === 'true' &&
      !url.search) {
    const stub = storage.get(storage.idFromName(OBJECT_NAME));
    const response = await stub.fetch(new Request(
      AUTHORITY_ORIGIN + '/api/admin/bootstrap/status'
    ));
    return Response.json({ ready: response.ok }, {
      status: response.ok ? 200 : 503,
      headers: { 'cache-control': 'no-store' }
    });
  }
  if (url.origin !== AUTHORITY_ORIGIN || url.search || !ROUTES.has(route)) {
    return deny(404, 'IDENTITY_ROUTE_DENIED');
  }
  const supplied = String(request.headers.get(BRIDGE_HEADER) || '');
  const expected = String(env.MAO_IDENTITY_BRIDGE_SECRET || '');
  if (!await acceptsSecret(expected, supplied)) {
    return deny(403, 'IDENTITY_BINDING_FORBIDDEN');
  }
  const headers = new Headers(request.headers);
  headers.delete(BRIDGE_HEADER);
  const originalRequest = new Request(request, { headers });
  const stub = storage.get(storage.idFromName(OBJECT_NAME));
  const response = await stub.fetch(originalRequest);
  if (route !== 'GET /api/admin/bootstrap/status' || !response.ok) return response;
  const status = await response.json().catch(() => null);
  if (status?.ok !== true || typeof status.initialized !== 'boolean') {
    return deny(503, 'IDENTITY_STORAGE_STATUS_INVALID');
  }
  // An initialized permanent authority is usable without an additional
  // creator/bootstrap secret. There is no public bootstrap endpoint here.
  return Response.json({
    ok: true,
    initialized: status.initialized,
    configured: status.initialized,
    bootstrapAllowed: false,
    identityMode: 'local'
  }, { headers: { 'cache-control': 'no-store' } });
}

export default {
  fetch(request, env) {
    return handlePermanentIdentityRequest(request, env);
  }
};