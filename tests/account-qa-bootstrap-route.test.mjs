import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the deployed route guard from its actual source, rather than a
// copied condition that could drift from the auth handler.
const source = readFileSync(new URL('../worker/lib/account-auth.js', import.meta.url), 'utf8');
const guard = source.match(/      if \(delegated && \([\s\S]*?throw new ApiError\(403, 'DELEGATED_ACCOUNT_MANAGED_CENTRALLY'[\s\S]*?\n      \}/)?.[0];
assert.ok(guard, 'account router must preserve its delegated-admin guard');
assert.match(source.slice(source.indexOf(guard) + guard.length),
  /if \(path === '\/api\/admin\/bootstrap' && method === 'POST'\) return await bootstrap\(request\)/,
  'approved QA bootstrap must remain reachable after the delegated guard');

const runGuard = vm.runInNewContext(
  '(function (delegated, path, method, qaEnabled) {\n' +
  '  const env = {};\n' +
  '  const qaIsolatedSetupEnabled = () => qaEnabled;\n' +
  '  class ApiError extends Error { constructor(status, code) { super(code); this.status=status; this.code=code; } }\n' +
  guard + '\nreturn "allowed";\n})'
);

test('QA bootstrap POST reaches handler only if isolated QA is enabled', () => {
  assert.equal(runGuard(true, '/api/admin/bootstrap', 'POST', true), 'allowed');
  for (const enabled of [false, null, undefined, 0, '']) {
    assert.throws(() => runGuard(true, '/api/admin/bootstrap', 'POST', enabled),
      error => error.code === 'DELEGATED_ACCOUNT_MANAGED_CENTRALLY');
  }
});

test('QA flag does not reopen other delegated admin and account management APIs', () => {
  const guarded = [
    ['POST', '/api/accounts/register'],
    ['POST', '/api/accounts/password/change'],
    ['POST', '/api/accounts/invites/redeem'],
    ['GET', '/api/admin/accounts'],
    ['POST', '/api/admin/accounts'],
    ['POST', '/api/admin/bootstrap/secret'],
    ['GET', '/api/admin/bootstrap'],
    ['POST', '/api/admin/invites']
  ];
  for (const [method, path] of guarded) {
    assert.throws(() => runGuard(true, path, method, true),
      error => error.code === 'DELEGATED_ACCOUNT_MANAGED_CENTRALLY',
      'must block ' + method + ' ' + path);
  }
});

test('social admin endpoints and ordinary non-delegated mode keep existing dispatch', () => {
  assert.equal(runGuard(true, '/api/admin/social/friends', 'GET', true), 'allowed');
  assert.equal(runGuard(true, '/api/admin/social/friends', 'POST', false), 'allowed');
  assert.equal(runGuard(false, '/api/admin/accounts', 'GET', false), 'allowed');
  assert.equal(runGuard(false, '/api/admin/bootstrap', 'POST', false), 'allowed');
});

 
// Run the actual account-auth bootstrap STATUS route, with only its service
// bindings and data store simulated. This covers readiness after QA setup closes.
const statusStart = source.indexOf("      if ((path === '/api/admin/bootstrap/status'");
const statusEnd = source.indexOf("\n      if (path === '/api/internal/identity/authenticate'", statusStart);
assert.ok(statusStart >= 0 && statusEnd > statusStart,
  'the real bootstrap status route must remain accessible');
const statusRoute = source.slice(statusStart, statusEnd);

function runStatusRoute(env, authority, delegated = true) {
  const run = vm.runInNewContext(`(async function (env, authority, delegated) {
    const path = '/api/admin/bootstrap/status', method = 'GET', request = {};
    const store = { hasMaoSuperAdminAccount() { return false; } };
    const probeExistingIdentityAuthority = async () => authority;
    const usesExistingAccountAuthority = () =>
      delegated && env.MAO_IDENTITY_AUTHORITY_MODE === 'existing_worker';
    const qaIsolatedSetupEnabled = () =>
      env.MAO_QA_IDENTITY_SETUP === 'isolated_authority';
    const isolatedQaAuthorityFounderId = () => null;
    const ok = result => result;
    ${statusRoute}
    return null;
  })`);
  return run(env, authority, delegated);
}

test('QA core remains configured for login after one-time setup is closed', async () => {
  const env = {
    MAO_IDENTITY_AUTHORITY_MODE: 'existing_worker',
    MAO_QA_AUTHORITY_WORKER: 'maomao-identity-core',
    MAO_QA_IDENTITY_SETUP: 'disabled',
    MAO_IDENTITY_AUTHORITY: { fetch() {} }
  };
  const status = await runStatusRoute(env, {
    connected: true, initialized: true, configured: true
  });
  assert.equal(status.configured, true);
  assert.equal(status.signInReady, true);
  assert.equal(status.initialized, true);
  assert.equal(status.bootstrapAllowed, false);
  assert.equal(status.qaSetupAllowed, false);
});

test('QA identity status fails closed if its authority is offline', async () => {
  const env = {
    MAO_IDENTITY_AUTHORITY_MODE: 'existing_worker',
    MAO_QA_AUTHORITY_WORKER: 'maomao-identity-core',
    MAO_QA_IDENTITY_SETUP: 'disabled',
    MAO_IDENTITY_AUTHORITY: { fetch() {} }
  };
  const status = await runStatusRoute(env, {
    connected: false, initialized: false, configured: false
  });
  assert.equal(status.configured, false);
  assert.equal(status.signInReady, false);
});

test('legacy gateway and ordinary local account status behavior stays unchanged', async () => {
  const legacy = {
    MAO_IDENTITY_AUTHORITY_MODE: 'existing_worker',
    MAO_QA_AUTHORITY_WORKER: 'legacy-gateway',
    MAO_IDENTITY_BRIDGE_SECRET: 'b'.repeat(40),
    MAO_IDENTITY_AUTHORITY: { fetch() {} }
  };
  const oldResult = await runStatusRoute(legacy, {
    connected: true, initialized: true, configured: true
  });
  assert.equal(oldResult.configured, false);
  assert.equal(oldResult.bootstrapAllowed, false);
  const local = await runStatusRoute({
    MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: 'a'.repeat(40),
    DEVICE_SECRET_PEPPER: 'b'.repeat(40)
  }, null, false);
  assert.equal(local.configured, true);
  assert.equal(local.bootstrapAllowed, true);
});
