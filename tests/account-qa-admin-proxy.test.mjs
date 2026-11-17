import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountAuth } from '../worker/lib/account-auth.js';

const FOUNDER_ID = 'MAO-SYNTHFOUNDER001';
const TOKEN = 'syntheticQaTokenForContractTests123456789012345';
const ORIGIN = 'https://mao520.com';

function fixture({ role = 'super_admin', disabled = false, wrongAuthority = false, authorityError = '', revokedSession = false } = {}) {
  const calls = [];
  const account = {
    id: role === 'super_admin' ? FOUNDER_ID : 'MAO-SYNTHACCOUNT001',
    username: 'testcreator',
    role,
    status: 'active',
    ...(role === 'super_admin' ? { founderNumber: '001' } : {})
  };
  const store = {
    getMaoAccountSession: () => ({
      session_id: 'syntheticSession',
      account_id: account.id,
      username: account.username,
      role: account.role,
      status: 'active',
      session_revoked_at: revokedSession ? Date.now() : null,
      expires_at: Date.now() + 86400000
    }),
    touchMaoAccountSession: () => true
  };
  const binding = {
    async fetch(request) {
      const url = new URL(request.url);
      calls.push({
        path: url.pathname, search: url.search, method: request.method,
        authorization: request.headers.get('authorization'),
        cookie: request.headers.get('cookie'),
        origin: request.headers.get('origin'),
        body: request.method === 'POST' ? await request.text() : ''
      });
      if (url.pathname.startsWith('/api/admin/') && authorityError === 'forbidden') {
        return Response.json({ ok: false, error: { code: 'DELEGATED_ACCOUNT_MANAGED_CENTRALLY',
          message: '管理权限尚未接通' } }, {
          status: 403, headers: { 'set-cookie': 'MAO_SESSION=forbidden-cookie; HttpOnly' }
        });
      }
      if (url.pathname.startsWith('/api/admin/') && authorityError === 'invalid') {
        return new Response('not-json', { status: 200, headers: { 'content-type': 'text/plain' } });
      }
      if (url.pathname.startsWith('/api/admin/') && authorityError === 'offline') {
        throw new Error('synthetic QA identity connection loss');
      }
      if (url.pathname === '/api/accounts/me') {
        return Response.json({ ok: true, account });
      }
      if (url.pathname === '/api/admin/bootstrap/status') {
        return Response.json({
          ok: true, identityMode: 'local',
          initialized: true, configured: true, bootstrapAllowed: true,
          qaIsolatedAuthority: !wrongAuthority, qaExpectedFounderId: FOUNDER_ID
        });
      }
      if (url.pathname === '/api/admin/accounts') {
        return Response.json({
          ok: true, accounts: [{ id: FOUNDER_ID, username: 'testcreator' }],
          page: { totalCount: 1, hasMore: false }, summary: { total: 1 }
        });
      }
      if (url.pathname === '/api/admin/invites' && request.method === 'POST') {
        return Response.json({ ok: true, inviteCode: 'synthetic-invite-only' }, { status: 201 });
      }
      return Response.json({ ok: false, error: { code: 'NO_ROUTE' } }, { status: 404 });
    }
  };
  const env = {
    MAO_IDENTITY_MODE: 'delegated_preview',
    MAO_IDENTITY_AUTHORITY_MODE: 'existing_worker',
    MAO_QA_AUTHORITY_WORKER: 'maomao-identity-core',
    MAO_DELEGATED_ADMIN_MANAGEMENT_ENABLED: disabled ? 'false' : 'true',
    MAO_EXPECTED_FOUNDER_ID: FOUNDER_ID,
    MAO_IDENTITY_AUTHORITY: binding
  };
  const auth = createAccountAuth({ store, env });
  async function invoke(path, method = 'GET', body) {
    const url = 'https://preview.mao520.com' + path;
    const request = new Request(url, {
      method,
      headers: {
        cookie: 'MAO_SESSION=' + TOKEN,
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return auth.handle(request, new URL(url).pathname, method);
  }
  return { calls, invoke };
}

test('isolated QA account directory uses server binding and never leaks authority cookies', async () => {
  const { calls, invoke } = fixture();
  const response = await invoke('/api/admin/accounts?limit=50');
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.accounts[0].id, FOUNDER_ID);
  assert.deepEqual(calls.map(call => call.path), [
    '/api/accounts/me', '/api/admin/bootstrap/status', '/api/admin/accounts'
  ]);
  const adminCall = calls[2];
  assert.equal(adminCall.search, '?limit=50');
  assert.equal(adminCall.authorization, 'Bearer ' + TOKEN);
  assert.equal(adminCall.cookie, null);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('isolated QA admin write requires founder session and is forwarded exactly once', async () => {
  const { calls, invoke } = fixture();
  const body = { targetAccountId: 'MAO-SYNTHACCOUNT001' };
  const response = await invoke('/api/admin/invites', 'POST', body);
  assert.equal(response.status, 201);
  assert.equal((await response.json()).inviteCode, 'synthetic-invite-only');
  const writes = calls.filter(call => call.path === '/api/admin/invites');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].authorization, 'Bearer ' + TOKEN);
  assert.equal(writes[0].cookie, null);
  assert.equal(writes[0].origin, ORIGIN);
  assert.deepEqual(JSON.parse(writes[0].body), body);
});

test('delegated management switch and unlisted routes always fail closed', async () => {
  const disabled = fixture({ disabled: true });
  await assert.rejects(disabled.invoke('/api/admin/accounts'), error =>
    error.code === 'DELEGATED_ACCOUNT_MANAGED_CENTRALLY');
  assert.equal(disabled.calls.length, 0);
  const unlisted = fixture();
  await assert.rejects(unlisted.invoke('/api/admin/bootstrap/unknown'), error =>
    error.code === 'DELEGATED_ACCOUNT_MANAGED_CENTRALLY');
  assert.equal(unlisted.calls.length, 0);
});

test('an authority without the isolated QA founder proof cannot access admin data', async () => {
  const { calls, invoke } = fixture({ wrongAuthority: true });
  await assert.rejects(invoke('/api/admin/accounts'), error =>
    error.code === 'QA_ADMIN_AUTHORITY_UNAVAILABLE');
  assert.deepEqual(calls.map(call => call.path), [
    '/api/accounts/me', '/api/admin/bootstrap/status'
  ]);
});

test('a non-super-admin session never reaches an admin directory or mutation', async () => {
  const { calls, invoke } = fixture({ role: 'user' });
  await assert.rejects(invoke('/api/admin/accounts'), error =>
    error.code === 'ADMIN_ONLY');
  assert.deepEqual(calls.map(call => call.path), ['/api/accounts/me']);
});

test('a forwarded QA 403 stays an API permission error, never a login redirect', async () => {
  const { invoke } = fixture({ authorityError: 'forbidden' });
  const response = await invoke('/api/admin/accounts?limit=50');
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'DELEGATED_ACCOUNT_MANAGED_CENTRALLY');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('location'), null);
});

test('malformed identity-core response fails closed instead of inventing admin data', async () => {
  const { invoke } = fixture({ authorityError: 'invalid' });
  await assert.rejects(invoke('/api/admin/accounts'), error =>
    error.code === 'QA_ADMIN_RESPONSE_INVALID');
});

test('ambiguous failure on a delegated admin write is not retried automatically', async () => {
  const { calls, invoke } = fixture({ authorityError: 'offline' });
  await assert.rejects(invoke('/api/admin/invites', 'POST', { targetAccountId: 'MAO-SYNTHACCOUNT001' }),
    error => error.code === 'QA_ADMIN_RESULT_UNCONFIRMED');
  assert.equal(calls.filter(call => call.path === '/api/admin/invites').length, 1);
});

test('revoked QA session cannot reach the central admin service', async () => {
  const { calls, invoke } = fixture({ revokedSession: true });
  await assert.rejects(invoke('/api/admin/accounts'), error =>
    error.code === 'ACCOUNT_SESSION_REQUIRED');
  assert.equal(calls.length, 0);
});
