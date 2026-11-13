import test from 'node:test';
import assert from 'node:assert/strict';
import { randomToken } from '../worker/lib/crypto.js';
import { passwordDigest } from '../worker/lib/account-auth.js';
import {
  openTestDb, setupTestStore
} from './helpers/cloud-helpers.mjs';
import {
  usesDelegatedIdentity, callIdentityAuthority, validateAuthorityAccount
} from '../worker/lib/identity-bridge.js';

const secret = 'test-only-identity-bridge-secret-very-long-2026';
const founderId = 'MAO-AAAAAAAAAAAA';
const founderPass = 'local-test-founder-passphrase-123';
const issuerOpts = {
  MAO_IDENTITY_ISSUER_ENABLED: 'true',
  MAO_IDENTITY_BRIDGE_SECRET: secret
};
const previewOpts = {
  MAO_IDENTITY_MODE: 'delegated_preview',
  MAO_IDENTITY_BRIDGE_SECRET: secret
};

async function makePair() {
  const issuerDB = openTestDb();
  const issuer = setupTestStore(issuerDB, issuerOpts);
  const passwordSalt = randomToken(16);
  const passwordHash = await passwordDigest(founderPass, passwordSalt);
  const created = issuer.store.createMaoSuperAdminAccountIfEmpty({
    id: founderId,
    username: 'CentralOwner',
    usernameKey: 'centralowner',
    passwordSalt, passwordHash, qqEmail: null, now: Date.now()
  });
  assert.equal(created, true);
  const previewDB = openTestDb();
  let calls = 0;
  const authorityBinding = {
    async fetch(request) {
      calls++;
      return issuer.app(request);
    }
  };
  const preview = setupTestStore(previewDB, {
    ...previewOpts, MAO_IDENTITY_AUTHORITY: authorityBinding
  });
  const close = () => { issuerDB.db.close(); previewDB.db.close(); };
  return { issuer, preview, issuerDB, previewDB, close, get calls() { return calls; } };
}

test('delegated mode is explicit; plain local production stays unchanged', () => {
  assert.equal(usesDelegatedIdentity({}), false);
  assert.equal(usesDelegatedIdentity({ MAO_IDENTITY_MODE: 'delegated_preview' }), true);
  assert.throws(() => validateAuthorityAccount({
    id: founderId, username: 'CentralOwner',
    role: 'super_admin', status: 'active'
  }), /身份状态无效/);
  assert.deepEqual(validateAuthorityAccount({
    id: founderId, username: 'CentralOwner',
    role: 'super_admin', status: 'active', founderNumber: '001'
  }), { id: founderId, username: 'CentralOwner', role: 'super_admin', status: 'active' });
  assert.throws(() => validateAuthorityAccount({
    id: founderId, username: 'CentralOwner',
    role: 'user', status: 'active', founderNumber: '001'
  }), /身份状态无效/);
});

test('without binding/secrets, delegated login fails closed before any local account is made', async t => {
  const db = openTestDb();
  t.after(() => db.db.close());
  const preview = setupTestStore(db, { MAO_IDENTITY_MODE: 'delegated_preview' });
  const status = await preview.asJson('/api/admin/bootstrap/status');
  assert.equal(status.payload.signInReady, false);
  const response = await preview.asJson('/api/accounts/login', {
    method: 'POST', body: { identifier: 'CentralOwner', password: founderPass }
  });
  assert.equal(response.status, 503);
  assert.equal(response.payload.error.code, 'IDENTITY_BRIDGE_NOT_READY');
  assert.equal(preview.query('SELECT COUNT(*) AS n FROM mao_accounts')[0].n, 0);
});

test('only server-confirmed central 001 can log into a preview, without an invite or new founder', async t => {
  const pair = await makePair();
  t.after(pair.close);
  const { issuer, preview } = pair;

  const bootstrap = await preview.asJson('/api/admin/bootstrap/status');
  assert.equal(bootstrap.payload.identityMode, 'delegated');
  assert.equal(bootstrap.payload.bootstrapAllowed, false);
  assert.equal(bootstrap.payload.signInReady, true);
  assert.equal(bootstrap.payload.initialized, false);
  const register = await preview.asJson('/api/accounts/register', {
    method: 'POST', body: { username: 'another', password: founderPass, confirmPassword: founderPass }
  });
  assert.equal(register.status, 403);
  assert.equal(register.payload.error.code, 'DELEGATED_ACCOUNT_MANAGED_CENTRALLY');
  const noFounder = await preview.asJson('/api/admin/bootstrap', {
    method: 'POST', body: { bootstrapSecret: secret, username: 'duplicate', password: founderPass }
  });
  assert.equal(noFounder.status, 403);
  assert.equal(preview.query('SELECT COUNT(*) AS n FROM mao_accounts')[0].n, 0);

  const loginResponse = await preview.fetchTo('/api/accounts/login', {
    method: 'POST', body: { identifier: 'CentralOwner', password: founderPass }
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  assert.equal(login.account.id, founderId);
  assert.equal(login.account.role, 'super_admin');
  assert.equal(login.account.founderNumber, '001');
  assert.equal(login.account.status, 'active');
  const cookie = loginResponse.headers.get('set-cookie');
  assert.match(cookie, /^MAO_SESSION=[A-Za-z0-9_-]+;/);
  assert.equal(preview.query('SELECT COUNT(*) AS n FROM mao_accounts')[0].n, 1);
  assert.equal(preview.query("SELECT COUNT(*) AS n FROM mao_accounts WHERE role = 'super_admin'")[0].n, 1);
  assert.equal(issuer.query('SELECT COUNT(*) AS n FROM mao_account_sessions')[0].n, 0, 'issuer must not make an orphan login session');
  const issuerHash = issuer.query('SELECT password_hash FROM mao_accounts WHERE id = ?', founderId)[0].password_hash;
  const previewHash = preview.query('SELECT password_hash FROM mao_accounts WHERE id = ?', founderId)[0].password_hash;
  assert.notEqual(issuerHash, previewHash, 'real password hash must never cross into preview SQLite');

  const me = await preview.asJson('/api/accounts/me', { headers: { cookie } });
  assert.equal(me.status, 200);
  assert.equal(me.payload.account.id, founderId);
  assert.equal(me.payload.account.founderNumber, '001');

  const managedOnlyCentrally = await preview.asJson('/api/admin/accounts', { headers: { cookie } });
  assert.equal(managedOnlyCentrally.status, 403);
  assert.equal(managedOnlyCentrally.payload.error.code, 'DELEGATED_ACCOUNT_MANAGED_CENTRALLY');
  const sessionCount = preview.query('SELECT COUNT(*) AS n FROM mao_account_sessions')[0].n;
  assert.equal(sessionCount, 1);
});

test('forged/disabled central identity and wrong password never grant local admin', async t => {
  const pair = await makePair();
  t.after(pair.close);
  const { preview, issuer, issuerDB } = pair;
  const wrong = await preview.asJson('/api/accounts/login', {
    method: 'POST', body: { identifier: 'CentralOwner', password: 'wrong password' }
  });
  assert.equal(wrong.status, 401);
  assert.equal(preview.query('SELECT COUNT(*) AS n FROM mao_accounts')[0].n, 0);
  const bypass = await issuer.asJson('/api/internal/identity/status', {
    method: 'POST', body: { accountId: founderId },
    headers: {
      'x-mao-identity-bridge': 'attacker-known-token-with-no-authorization-123'
    }
  });
  assert.notEqual(bypass.status, 200);

  const loginResponse = await preview.fetchTo('/api/accounts/login', {
    method: 'POST', body: { identifier: 'CentralOwner', password: founderPass }
  });
  const cookie = loginResponse.headers.get('set-cookie');
  issuerDB.exec("UPDATE mao_accounts SET status = 'disabled' WHERE id = ?", founderId);
  const denied = await preview.asJson('/api/accounts/me', { headers: { cookie } });
  assert.notEqual(denied.status, 200, 'central revocation denies an existing preview cookie');
});

test('authority identity conflict never overwrites a local founder or stale different account', async t => {
  const pair = await makePair();
  t.after(pair.close);
  const { preview } = pair;
  const existing = preview.store.createMaoSuperAdminAccountIfEmpty({
    id: 'MAO-BBBBBBBBBBBB',
    username: 'OtherFounder',
    usernameKey: 'otherfounder',
    passwordSalt: randomToken(16),
    passwordHash: '0'.repeat(64),
    now: Date.now()
  });
  assert.equal(existing, true);
  const response = await preview.asJson('/api/accounts/login', {
    method: 'POST', body: { identifier: 'CentralOwner', password: founderPass }
  });
  assert.equal(response.status, 409);
  assert.equal(response.payload.error.code, 'DELEGATED_IDENTITY_CONFLICT');
  assert.equal(preview.query("SELECT COUNT(*) AS n FROM mao_accounts WHERE role = 'super_admin'")[0].n, 1);
  assert.equal(preview.query('SELECT COUNT(*) AS n FROM mao_accounts WHERE id = ?', founderId)[0].n, 0);
});

test('authority calls reject unsupported operations without making any network request', async () => {
  const requests = [];
  const env = { ...previewOpts, MAO_IDENTITY_AUTHORITY: {
    async fetch(req) { requests.push(req); return Response.json({ ok: true }); }
  }};
  await assert.rejects(callIdentityAuthority(env, 'bootstrap', {}), /统一身份认证未就绪/);
  assert.equal(requests.length, 0);
});
