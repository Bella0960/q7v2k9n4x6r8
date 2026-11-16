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
