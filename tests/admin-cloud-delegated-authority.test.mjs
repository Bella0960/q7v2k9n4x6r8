/** ADMIN-CLOUD-001 delegated identity integration test (real app, auth, sessions and SQLite).
 * Replaces ONLY the Cloudflare Worker Service Binding with a synthetic issuer.
 * No live credentials, secrets, accounts or remote data are involved.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createHarness, fullEnv } from './fixtures/admin-cloud-harness.mjs';

function authorityHarness(role = 'super_admin') {
  const id = role === 'super_admin' ? 'MAO-TESTADMIN000001' : 'MAO-TESTUSER0000001';
  const state = { role, active: true, revoked: false, reachable: true, requests: [] };
  const token = randomBytes(32).toString('base64url');
  const account = () => ({
    id, username: role === 'super_admin' ? 'cloud_admin_test' : 'cloud_user_test',
    status: 'active', role: state.role,
    ...(state.role === 'super_admin' ? { founderNumber: '001' } : {})
  });
  const binding = {
    async fetch(request) {
      state.requests.push({ pathname: new URL(request.url).pathname, method: request.method });
      if (!state.reachable) throw new Error('synthetic authority offline');
      const pathname = new URL(request.url).pathname;
      if (pathname === '/api/admin/bootstrap/status') {
        return Response.json({ ok: true, initialized: true, configured: true });
      }
      if (pathname === '/api/accounts/login' && request.method === 'POST') {
        const input = await request.json();
        if (input.identifier !== 'synthetic_identity' || input.password !== 'synthetic-password-only') {
          return Response.json({ ok: false, error: { code: 'LOGIN_FAILED' } }, { status: 401 });
        }
        return Response.json({ ok: true, account: account() }, {
          headers: { 'set-cookie': 'MAO_SESSION=' + token + '; Path=/; Secure; HttpOnly; SameSite=Lax' }
        });
      }
      if (pathname === '/api/accounts/me' && request.method === 'GET') {
        if (state.revoked || request.headers.get('authorization') !== 'Bearer ' + token) {
          return Response.json({ ok: false, error: { code: 'LOGIN_REQUIRED' } }, { status: 401 });
        }
        return Response.json({ ok: true, account: account() });
      }
      if (pathname === '/api/accounts/logout' && request.method === 'POST') {
        state.revoked = true;
        return Response.json({ ok: true, loggedOut: true });
      }
      return Response.json({ ok: false }, { status: 404 });
    }
  };
  const h = createHarness({
    env: fullEnv({
      MAO_IDENTITY_MODE: 'delegated_preview',
      MAO_IDENTITY_AUTHORITY_MODE: 'existing_worker',
      MAO_IDENTITY_AUTHORITY: binding,
      MAO_IDENTITY_CANONICAL_ADMIN_REQUIRED: 'true'
    })
  });
  return { h, state, id };
}

async function login(h) {
  const result = await h.call('/api/accounts/login', {
    method: 'POST',
    body: { identifier: 'synthetic_identity', password: 'synthetic-password-only' }
  });
  assert.equal(result.status, 200, 'local preview uses central issuer login');
  const cookie = h.cookieFrom(result);
  assert.match(cookie, /^MAO_SESSION=[A-Za-z0-9_-]{32,128}$/);
  return { cookie, accountId: result.json.account.id };
}

test('delegated positive: real super_admin account session reads every read-only cloud route', async () => {
  const { h, state, id } = authorityHarness();
  const bootstrap = await h.call('/api/admin/bootstrap', {
    method: 'POST', body: { bootstrapSecret: 'synthetic-no-bootstrap' }
  });
  assert.equal(bootstrap.status, 403, 'no second founder in delegated preview');
  const session = await login(h);
  assert.equal(session.accountId, id);
  const targets = ['/api/admin/cloud', '/api/admin/cloud/overview', '/api/admin/cloud/health',
    '/api/admin/cloud/tasks', '/api/admin/cloud/errors?limit=5', '/api/admin/cloud/sections'];
  for (const path of targets) {
    const res = await h.admin(path, session);
    assert.equal(res.status, 200, path);
    assert.equal(res.json.ok, true, path);
    assert.equal(res.headers.get('cache-control'), 'no-store', path);
  }
  const bad = await h.admin('/api/admin/cloud/tasks', session, { method: 'DELETE', body: {} });
  assert.equal(bad.status, 405);
  assert.equal(bad.headers.get('allow'), 'GET');
  const misrouted = await h.admin('/api/admin/accounts', session);
  assert.equal(misrouted.status, 403, 'delegated account administrator routes remain centrally managed');
  assert.ok(state.requests.filter(x => x.pathname === '/api/accounts/me').length >= targets.length,
    'central authority revalidates each private request');
});

test('delegated account context is compulsory and cannot be exchanged for another account', async () => {
  const { h } = authorityHarness();
  const session = await login(h);
  const missing = await h.call('/api/admin/cloud/errors', { cookie: session.cookie });
  assert.equal(missing.status, 409);
  assert.equal(missing.json.error.code, 'ACCOUNT_CONTEXT_REQUIRED');
  const wrong = await h.call('/api/admin/cloud/errors', {
    cookie: session.cookie, accountId: 'MAO-ANOTHERUSER000'
  });
  assert.equal(wrong.status, 409);
  assert.equal(wrong.json.error.code, 'ACCOUNT_CONTEXT_CHANGED');
});

test('delegated authority revocation immediately blocks protected cloud diagnostics', async () => {
  const { h, state } = authorityHarness();
  const session = await login(h);
  assert.equal((await h.admin('/api/admin/cloud/health', session)).status, 200);
  state.revoked = true;
  const result = await h.admin('/api/admin/cloud/health', session);
  assert.notEqual(result.status, 200);
  assert.ok([401, 403].includes(result.status));
});

test('delegated authority role downgrade or disconnection fails closed', async () => {
  const { h, state } = authorityHarness();
  const session = await login(h);
  assert.equal((await h.admin('/api/admin/cloud/health', session)).status, 200);
  state.role = 'user';
  const downgraded = await h.admin('/api/admin/cloud/health', session);
  assert.equal(downgraded.status, 403);
  state.role = 'super_admin';
  state.reachable = false;
  const offline = await h.admin('/api/admin/cloud/health', session);
  assert.notEqual(offline.status, 200, 'offline authority is never treated as logged in');
});

test('delegated normal user cannot access cloud endpoints despite valid central session', async () => {
  const { h } = authorityHarness('user');
  const session = await login(h);
  for (const path of ['/api/admin/cloud', '/api/admin/cloud/health', '/api/admin/cloud/errors']) {
    const result = await h.admin(path, session);
    assert.equal(result.status, 403, path);
    assert.equal(result.json.error.code, 'ADMIN_ONLY');
  }
});
