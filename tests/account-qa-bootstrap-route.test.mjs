import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountAuth } from '../worker/lib/account-auth.js';

const ORIGIN = 'https://preview.mao520.com';

function dispatch(path, method, { setup, delegated = true } = {}) {
  const env = {
    MAO_IDENTITY_MODE: delegated ? 'delegated_preview' : 'local',
    MAO_IDENTITY_AUTHORITY_MODE: 'existing_worker',
    MAO_QA_IDENTITY_SETUP: setup,
    MAO_QA_AUTHORITY_WORKER: 'maomao-identity-core',
    MAO_EXPECTED_FOUNDER_ID: 'MAO-SYNTHFOUNDER001',
    MAO_IDENTITY_AUTHORITY: {
      fetch: async () => assert.fail('unverified request must not reach the identity authority')
    }
  };
  const store = {
    getMaoAccountById: () => null,
    hasMaoSuperAdminAccount: () => true
  };
  return createAccountAuth({ store, env }).handle(new Request(ORIGIN + path, { method }), path, method);
}

test('QA bootstrap POST reaches the isolated setup handler only with the exact QA flag', async () => {
  await assert.rejects(dispatch('/api/admin/bootstrap', 'POST', { setup: 'isolated_authority' }),
    error => error.code === 'QA_SHADOW_IDENTITY_MISMATCH');
  for (const setup of [false, null, undefined, 0, '']) {
    await assert.rejects(dispatch('/api/admin/bootstrap', 'POST', { setup }),
      error => error.code === 'DELEGATED_ACCOUNT_MANAGED_CENTRALLY');
  }
});

test('QA setup flag alone does not reopen delegated admin and account management APIs', async () => {
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
    await assert.rejects(dispatch(path, method, { setup: 'isolated_authority' }),
      error => error.code === 'DELEGATED_ACCOUNT_MANAGED_CENTRALLY',
      'must block ' + method + ' ' + path);
  }
});

test('social admin endpoints and ordinary non-delegated mode keep existing dispatch', async () => {
  for (const method of ['GET', 'POST']) {
    assert.equal(await dispatch('/api/admin/social/friends', method, { setup: 'isolated_authority' }), null);
  }
  await assert.rejects(dispatch('/api/admin/accounts', 'GET', { delegated: false }),
    error => error.code === 'ACCOUNT_SESSION_REQUIRED');
  await assert.rejects(dispatch('/api/admin/bootstrap', 'POST', { delegated: false }),
    error => error.code === 'ADMIN_ALREADY_INITIALIZED');
});
