import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDb, setupTestStore } from './helpers/cloud-helpers.mjs';

const canonicalId = 'MAO-AAAAAAAAAAAA'; // Synthetic fixture, not the owner's personal ID.
const unrelatedId = 'MAO-BBBBBBBBBBBB';

function fixture(env = {}, id = canonicalId) {
  const db = openTestDb();
  const app = setupTestStore(db, env);
  const created = app.store.createMaoSuperAdminAccountIfEmpty({
    id, username: 'TestFounder', usernameKey: 'testfounder',
    passwordSalt: 'AAAAAAAAAAAAAAAAAAAAAA',
    passwordHash: '0'.repeat(64), qqEmail: null, now: Date.now()
  });
  assert.equal(created, true);
  return { db, app };
}

test('selected original account ID permits normal read-only account status, without re-bootstrap', async t => {
  const { db, app } = fixture({
    MAO_CANONICAL_FOUNDER_REQUIRED: 'true',
    MAO_CANONICAL_FOUNDER_ID: canonicalId
  });
  t.after(() => db.db.close());
  const status = await app.asJson('/api/admin/bootstrap/status');
  assert.equal(status.status, 200);
  assert.equal(status.payload.initialized, true);
  assert.equal(app.query('SELECT COUNT(*) AS n FROM mao_accounts')[0].n, 1);
});

test('a different founder in a different namespace fails closed before login or data writes', async t => {
  const { db, app } = fixture({
    MAO_CANONICAL_FOUNDER_REQUIRED: 'true',
    MAO_CANONICAL_FOUNDER_ID: canonicalId
  }, unrelatedId);
  t.after(() => db.db.close());
  const cases = [
    ['/api/admin/bootstrap/status', 'GET'],
    ['/api/accounts/me', 'GET'],
    ['/api/accounts/register', 'POST'],
    ['/api/accounts/login', 'POST'],
    ['/api/health', 'GET']
  ];
  for (const [path, method] of cases) {
    const response = await app.asJson(path, {
      method, ...(method === 'POST' ? { body: { username: 'test', password: 'wrong' } } : {})
    });
    assert.equal(response.status, 503, path);
    assert.equal(response.payload.error.code, 'CANONICAL_FOUNDER_MISMATCH', path);
  }
  assert.equal(app.query('SELECT COUNT(*) AS n FROM mao_accounts')[0].n, 1);
  assert.equal(app.query('SELECT COUNT(*) AS n FROM mao_account_sessions')[0].n, 0);
  assert.equal(app.query('SELECT COUNT(*) AS n FROM mao_social_messages')[0].n, 0);
});

test('required but missing/invalid founder pin fails closed, never creates another 001', async t => {
  const { db, app } = fixture({ MAO_CANONICAL_FOUNDER_REQUIRED: 'true' });
  t.after(() => db.db.close());
  const blocked = await app.asJson('/api/admin/bootstrap/status');
  assert.equal(blocked.status, 503);
  assert.equal(blocked.payload.error.code, 'CANONICAL_FOUNDER_NOT_CONFIGURED');
  const bootstrap = await app.asJson('/api/admin/bootstrap', {
    method: 'POST', body: { username: 'SecondFounder', password: 'test-pass' }
  });
  assert.equal(bootstrap.status, 503);
  assert.equal(app.query('SELECT COUNT(*) AS n FROM mao_accounts')[0].n, 1);
});

test('explicit identity pin rejects delegated preview mirrors instead of mislabeling them canonical', async t => {
  const { db, app } = fixture({
    MAO_CANONICAL_FOUNDER_ID: canonicalId,
    MAO_IDENTITY_MODE: 'delegated_preview'
  });
  t.after(() => db.db.close());
  const response = await app.asJson('/api/admin/bootstrap/status');
  assert.equal(response.status, 503);
  assert.equal(response.payload.error.code, 'CANONICAL_FOUNDER_WRONG_MODE');
});

test('preexisting unrelated test environments remain unchanged when no pin was configured', async t => {
  const { db, app } = fixture();
  t.after(() => db.db.close());
  const status = await app.asJson('/api/admin/bootstrap/status');
  assert.equal(status.status, 200);
  assert.equal(status.payload.initialized, true);
});
