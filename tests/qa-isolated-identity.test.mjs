import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAccountAuth } from '../worker/lib/account-auth.js';
import { createStore } from '../worker/lib/store.js';
import { applyMigrations } from '../worker/lib/migrations.js';
import { sha256Hex } from '../worker/lib/crypto.js';
import { openTestDb } from './helpers/cloud-helpers.mjs';
import {
  isQaLocalAccount, assertIsolatedQaOrigin, usesIsolatedQaIdentity
} from '../worker/lib/qa-local-identity.js';

const QA_ORIGIN = 'https://maomao-aw-qa-20261114.miamor520000.workers.dev';
const PASSWORD = 'synthetic-qa-account-password-123456';
const PEPPER = 'only-for-node-contract-synthetic-qa-pepper-123456';
const SIGNUP = {
  username: 'qa_contract_user',
  password: PASSWORD,
  confirmPassword: PASSWORD
};

function fixture(override = {}) {
  const testDb = openTestDb();
  const store = createStore(testDb.exec);
  applyMigrations(testDb.exec);
  let externalCalls = 0;
  const env = {
    DEVICE_SECRET_PEPPER: PEPPER,
    MAO_IDENTITY_MODE: 'isolated_qa',
    MAO_QA_ALLOWED_ORIGIN: QA_ORIGIN,
    // Even a retained stale binding must not be called by isolated test auth.
    MAO_IDENTITY_AUTHORITY: {
      fetch() {
        externalCalls++;
        throw new Error('QA authentication must never call production identity');
      }
    },
    ...override
  };
  const auth = createAccountAuth({ store, env });
  return {
    store,
    auth,
    query: testDb.query,
    close: () => testDb.db.close(),
    externalCalls: () => externalCalls
  };
}

function req(path, { method = 'GET', body, origin = QA_ORIGIN, cookie } = {}) {
  return new Request(origin + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.42',
      ...(cookie ? { cookie } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

function handle(f, path, options = {}) {
  return f.auth.handle(req(path, options), path, options.method || 'GET');
}

test('QA-only mode is explicit and rejects production/custom domain origins', () => {
  assert.equal(usesIsolatedQaIdentity({}), false);
  assert.equal(usesIsolatedQaIdentity({ MAO_IDENTITY_MODE: 'delegated_preview' }), false);
  assert.equal(usesIsolatedQaIdentity({ MAO_IDENTITY_MODE: 'isolated_qa' }), true);
  assert.doesNotThrow(() => assertIsolatedQaOrigin(req('/'), {
    MAO_IDENTITY_MODE: 'isolated_qa',
    MAO_QA_ALLOWED_ORIGIN: QA_ORIGIN
  }));
  for (const origin of ['https://mao520.com', 'https://app.mao520.com',
    'https://maomao-aw-qa-20261114.other.workers.dev']) {
    const bad = () => assertIsolatedQaOrigin(req('/', { origin }), {
      MAO_IDENTITY_MODE: 'isolated_qa',
      MAO_QA_ALLOWED_ORIGIN: QA_ORIGIN
    });
    assert.throws(bad, e => e.code === 'QA_ORIGIN_NOT_ISOLATED');
  }
  assert.throws(() => assertIsolatedQaOrigin(req('/'), {
    MAO_IDENTITY_MODE: 'isolated_qa',
    MAO_QA_ALLOWED_ORIGIN: 'https://app.mao520.com'
  }), e => e.code === 'QA_ORIGIN_NOT_ISOLATED');
});

test('isolated QA can register a real local test user, log in and resume session without authority calls', async t => {
  const f = fixture();
  t.after(f.close);
  const registered = await handle(f, '/api/accounts/register', {
    method: 'POST', body: SIGNUP
  });
  const data = await registered.json();
  assert.equal(registered.status, 201);
  assert.equal(data.nextStep, 'login');
  assert.equal(data.account.status, 'active');
  assert.equal(data.account.role, 'user');
  assert.match(data.account.id, /^MAO-QA[A-Z0-9]{16}$/);
  assert.ok(isQaLocalAccount(data.account));
  assert.equal(f.query('SELECT status FROM mao_accounts WHERE id = ?', data.account.id)[0].status, 'active');

  const logged = await handle(f, '/api/accounts/login', {
    method: 'POST', body: { identifier: SIGNUP.username, password: PASSWORD }
  });
  assert.equal(logged.status, 200);
  const cookie = logged.headers.get('set-cookie')?.split(';')[0];
  assert.match(cookie || '', /^MAO_SESSION=[A-Za-z0-9_-]{32,128}$/);
  assert.doesNotMatch(logged.headers.get('set-cookie') || '', /(?:^|;)\s*Domain=/i);

  const me = await handle(f, '/api/accounts/me', { cookie });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).account.id, data.account.id);
  assert.equal(f.externalCalls(), 0, 'production identity must never be contacted');
});

test('old delegated/real identity sessions cannot be promoted into isolated QA sessions', async t => {
  const f = fixture();
  t.after(f.close);
  const legacyId = 'MAO-LEGACYTESTUSER1234';
  const timestamp = Date.now();
  f.store.createMaoAccount({
    id: legacyId, username: 'legacyuser', usernameKey: 'legacyuser',
    passwordSalt: 'legacy-synthetic-salt', passwordHash: 'legacy-synthetic-hash',
    registrationIpHash: 'synthetic-legacy-IP', now: timestamp
  });
  const token = 'LegacySessionSyntheticToken0123456789012345';
  assert.equal(f.store.createMaoAccountSession({
    id: 'legacy-session-abc', accountId: legacyId,
    tokenHash: await sha256Hex(token),
    now: timestamp, expiresAt: timestamp + 600000
  }), true);
  await assert.rejects(
    handle(f, '/api/accounts/me', { cookie: 'MAO_SESSION=' + token }),
    error => error.code === 'ACCOUNT_SESSION_REQUIRED'
  );
  assert.equal(f.query('SELECT COUNT(*) AS total FROM mao_accounts WHERE id = ?', legacyId)[0].total, 1,
    'old QA records must not be deleted');
  assert.equal(f.externalCalls(), 0);
});

test('QA registration rejects a production-origin request before changing any account data', async t => {
  const f = fixture();
  t.after(f.close);
  await assert.rejects(handle(f, '/api/accounts/register', {
    method: 'POST', body: SIGNUP, origin: 'https://app.mao520.com'
  }), error => error.code === 'QA_ORIGIN_NOT_ISOLATED');
  assert.equal(f.query('SELECT COUNT(*) AS total FROM mao_accounts')[0].total, 0);
});

test('QA cannot initialize a new founder even if database has none', async t => {
  const f = fixture();
  t.after(f.close);
  await assert.rejects(handle(f, '/api/admin/bootstrap', {
    method: 'POST', body: { username: 'founder', password: PASSWORD }
  }), error => error.code === 'QA_FOUNDER_BOOTSTRAP_DISABLED');
  const status = await handle(f, '/api/admin/bootstrap/status');
  const body = await status.json();
  assert.equal(body.identityMode, 'isolated_qa');
  assert.equal(body.bootstrapAllowed, false);
  assert.equal(body.signInReady, true);
  assert.equal(f.externalCalls(), 0);
});

test('normal production/local registration is still pending invite and cannot create QA IDs', async t => {
  const f = fixture({ MAO_IDENTITY_MODE: undefined });
  t.after(f.close);
  const response = await handle(f, '/api/accounts/register', {
    method: 'POST', body: SIGNUP
  });
  const account = (await response.json()).account;
  assert.equal(response.status, 201);
  assert.equal(account.status, 'pending_invite');
  assert.equal(isQaLocalAccount(account), false);
});

test('only existing QA config selects isolated identity; no direct authority service in deployment config', () => {
  const raw = readFileSync(new URL('../wrangler.qa.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(raw);
  assert.equal(config.name, 'maomao-aw-qa-20261114');
  assert.equal(config.vars.MAO_IDENTITY_MODE, 'isolated_qa');
  assert.equal(config.vars.MAO_QA_ALLOWED_ORIGIN, QA_ORIGIN);
  assert.ok(!(config.services || []).some(service => service.binding === 'MAO_IDENTITY_AUTHORITY'));
});
