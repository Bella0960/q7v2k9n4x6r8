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
  MAO_IDENTITY_BRIDGE_SECRET: secret,
  MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: 'test-only-original-founder-setup-secret-2026'
};
const previewOpts = {
  MAO_IDENTITY_MODE: 'delegated_preview',
  MAO_IDENTITY_BRIDGE_SECRET: secret
};

async function makePair({ existingWorker = false } = {}) {
  const issuerDB = openTestDb();
  const issuer = setupTestStore(issuerDB, existingWorker
    ? { ...issuerOpts, MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: 'test-only-initialized-founder-secret-2026-01-01' }
    : issuerOpts);
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
    ...previewOpts,
    ...(existingWorker ? { MAO_IDENTITY_AUTHORITY_MODE: 'existing_worker' } : {}),
    MAO_IDENTITY_AUTHORITY: authorityBinding
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
  assert.equal(bootstrap.payload.initialized, true, 'status mirrors the existing central founder');
  assert.equal(bootstrap.payload.identityAuthorityConnected, true);
  assert.equal(preview.query('SELECT COUNT(*) AS n FROM mao_accounts')[0].n, 0,
    'read-only status must not clone a founder into the preview');
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

test('read-only authority probe finds the real founder without creating a preview founder', async t => {
  const db = openTestDb();
  t.after(() => db.db.close());
  let observed;
  const app = setupTestStore(db, {
    MAO_IDENTITY_MODE: 'delegated_preview',
    MAO_IDENTITY_AUTHORITY: {
      async fetch(request) {
        observed = { path: new URL(request.url).pathname, method: request.method };
        return Response.json({ ok: true, initialized: true, configured: true });
      }
    }
  });
  const status = await app.asJson('/api/admin/bootstrap/status');
  assert.equal(status.status, 200);
  assert.equal(status.payload.initialized, true);
  assert.equal(status.payload.bootstrapAllowed, false);
  assert.equal(status.payload.identityAuthorityConnected, true);
  assert.equal(status.payload.identityAuthorityInitialized, true);
  assert.equal(status.payload.signInReady, false, 'read-only connection alone does not enable password prompts');
  assert.deepEqual(observed, { path: '/api/admin/bootstrap/status', method: 'GET' });
  assert.equal(app.query('SELECT COUNT(*) AS n FROM mao_accounts')[0].n, 0);
});

test('malformed or unreachable authority never causes a founder bootstrap or login-ready claim', async t => {
  const db = openTestDb();
  t.after(() => db.db.close());
  const preview = setupTestStore(db, {
    MAO_IDENTITY_MODE: 'delegated_preview',
    MAO_IDENTITY_AUTHORITY: { async fetch() {
      return Response.json({ ok: true, initialized: 'yes', configured: true });
    }},
    MAO_IDENTITY_BRIDGE_SECRET: secret
  });
  const status = await preview.asJson('/api/admin/bootstrap/status');
  assert.equal(status.payload.identityAuthorityConnected, false);
  assert.equal(status.payload.signInReady, false);
  assert.equal(status.payload.bootstrapAllowed, false);
});

test('same founder 001 logs into the isolated preview using EXISTING authority Worker login and session', async t => {
  const pair = await makePair({ existingWorker: true });
  t.after(pair.close);
  const { issuer, preview } = pair;
  const status = await preview.asJson('/api/admin/bootstrap/status');
  assert.equal(status.status, 200);
  assert.equal(status.payload.identityAuthorityConnected, true);
  assert.equal(status.payload.identityAuthorityInitialized, true);
  assert.equal(status.payload.bootstrapAllowed, false);
  assert.equal(status.payload.signInReady, true);
  assert.equal(preview.query('SELECT COUNT(*) AS n FROM mao_accounts')[0].n, 0);

  const response = await preview.fetchTo('/api/accounts/login', {
    method: 'POST', body: { identifier: 'CentralOwner', password: founderPass }
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.account.id, founderId);
  assert.equal(payload.account.founderNumber, '001');
  assert.equal(payload.account.role, 'super_admin');
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^MAO_SESSION=[A-Za-z0-9_-]{32,128};/);
  assert.match(cookie, /; HttpOnly;/);
  assert.match(cookie, /; Secure/);
  assert.equal(preview.query("SELECT COUNT(*) AS n FROM mao_accounts WHERE role = 'super_admin'")[0].n, 1);
  assert.equal(issuer.query('SELECT COUNT(*) AS n FROM mao_account_sessions')[0].n, 1);
  assert.equal(preview.query('SELECT COUNT(*) AS n FROM mao_account_sessions')[0].n, 1);
  assert.equal(
    issuer.query('SELECT token_hash FROM mao_account_sessions')[0].token_hash,
    preview.query('SELECT token_hash FROM mao_account_sessions')[0].token_hash,
    'Preview session must be the actual authority session, never a second standalone login'
  );
  assert.notEqual(
    issuer.query('SELECT password_hash FROM mao_accounts WHERE id = ?', founderId)[0].password_hash,
    preview.query('SELECT password_hash FROM mao_accounts WHERE id = ?', founderId)[0].password_hash,
    'Never copy the official password hash into a test database'
  );

  const me = await preview.asJson('/api/accounts/me', { headers: { cookie } });
  assert.equal(me.status, 200);
  assert.equal(me.payload.account.founderNumber, '001');

  const loggedOut = await preview.asJson('/api/accounts/logout', {
    method: 'POST', headers: { cookie }
  });
  assert.equal(loggedOut.status, 200);
  assert.equal(loggedOut.payload.authoritySessionRevoked, true);
  assert.equal(issuer.query('SELECT COUNT(*) AS n FROM mao_account_sessions WHERE revoked_at IS NOT NULL')[0].n, 1);
  const refused = await preview.asJson('/api/accounts/me', { headers: { cookie } });
  assert.equal(refused.status, 401);
});

test('existing authority wrong password cannot create an account in a Preview', async t => {
  const pair = await makePair({ existingWorker: true });
  t.after(pair.close);
  const { preview, issuer } = pair;
  const failed = await preview.asJson('/api/accounts/login', {
    method: 'POST', body: { identifier: 'CentralOwner', password: 'wrong-passphrase' }
  });
  assert.equal(failed.status, 401);
  assert.equal(preview.query('SELECT COUNT(*) AS n FROM mao_accounts')[0].n, 0);
  assert.equal(issuer.query('SELECT COUNT(*) AS n FROM mao_account_sessions')[0].n, 0);
});

test('revoking the ORIGINAL session immediately revokes preview access', async t => {
  const pair = await makePair({ existingWorker: true });
  t.after(pair.close);
  const { preview, issuer, issuerDB } = pair;
  const response = await preview.fetchTo('/api/accounts/login', {
    method: 'POST', body: { identifier: 'CentralOwner', password: founderPass }
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  const first = await preview.asJson('/api/accounts/me', { headers: { cookie } });
  assert.equal(first.status, 200);
  issuerDB.exec('UPDATE mao_account_sessions SET revoked_at = ? WHERE account_id = ?',
    Date.now(), founderId);
  const denied = await preview.asJson('/api/accounts/me', { headers: { cookie } });
  assert.equal(denied.status, 401);
  assert.equal(denied.payload.error.code, 'LOGIN_REQUIRED');
});

test('missing or unauthenticated Worker cookie prevents session minting', async t => {
  const issuerDB = openTestDb(), previewDB = openTestDb();
  t.after(() => { issuerDB.db.close(); previewDB.db.close(); });
  const preview = setupTestStore(previewDB, {
    MAO_IDENTITY_MODE: 'delegated_preview',
    MAO_IDENTITY_AUTHORITY_MODE: 'existing_worker',
    MAO_IDENTITY_AUTHORITY: { async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/api/admin/bootstrap/status') {
        return Response.json({ ok: true, initialized: true, configured: true });
      }
      return Response.json({ ok: true, account: {
        id: founderId, username: 'CentralOwner', role: 'super_admin',
        status: 'active', founderNumber: '001'
      } });
    } }
  });
  const response = await preview.asJson('/api/accounts/login', {
    method: 'POST', body: { identifier: 'CentralOwner', password: founderPass }
  });
  assert.equal(response.status, 503);
  assert.equal(response.payload.error.code, 'IDENTITY_AUTHORITY_SESSION_INVALID');
  assert.equal(previewDB.query('SELECT COUNT(*) AS n FROM mao_accounts')[0].n, 0);
});

test('existing Worker binding uses verified authority host and same-origin POST, not public fetch', async () => {
  const token = 'a'.repeat(43);
  let forwarded;
  const env = {
    MAO_IDENTITY_MODE: 'delegated_preview',
    MAO_IDENTITY_AUTHORITY_MODE: 'existing_worker',
    MAO_IDENTITY_AUTHORITY: { async fetch(request) {
      forwarded = request;
      return Response.json({ ok: true, account: {
        id: founderId, username: 'CentralOwner', role: 'super_admin',
        status: 'active', founderNumber: '001'
      } }, {
        headers: { 'set-cookie': 'MAO_SESSION=' + token +
          '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure' }
      });
    }}
  };
  const identity = await callIdentityAuthority(env, 'authenticate', {
    identifier: 'CentralOwner', password: founderPass
  });
  assert.equal(new URL(forwarded.url).origin, 'https://mao520.com');
  assert.equal(forwarded.headers.get('origin'), 'https://mao520.com');
  assert.equal(forwarded.headers.get('content-type'), 'application/json');
  assert.equal(identity.authoritySessionToken, token);
  assert.equal(identity.role, 'super_admin');
});

test('conflicting preview founder revokes the authority session issued by a refused login', async t => {
  const pair = await makePair({ existingWorker: true });
  t.after(pair.close);
  const { preview, issuer } = pair;
  assert.equal(preview.store.createMaoSuperAdminAccountIfEmpty({
    id: 'MAO-CCCCCCCCCCCC',
    username: 'OtherFounder', usernameKey: 'otherfounder',
    passwordSalt: randomToken(16),
    passwordHash: '0'.repeat(64),
    now: Date.now()
  }), true);
  const result = await preview.asJson('/api/accounts/login', {
    method: 'POST', body: { identifier: 'CentralOwner', password: founderPass }
  });
  assert.equal(result.status, 409);
  assert.equal(result.payload.error.code, 'DELEGATED_IDENTITY_CONFLICT');
  assert.equal(preview.query('SELECT COUNT(*) AS n FROM mao_account_sessions')[0].n, 0);
  assert.equal(
    issuer.query('SELECT COUNT(*) AS n FROM mao_account_sessions WHERE revoked_at IS NOT NULL')[0].n,
    1,
    'refused preview login must not leave an active central session'
  );
});


test('canonical admin lock rejects any other existing founder without creating an alternative 001',async t=>{
  const pair=await makePair({existingWorker:true});t.after(pair.close);
  const {preview,issuer}=pair;
  // The authority's existing fixture founder is deliberately NOT the approved ID.
  preview.env.MAO_IDENTITY_CANONICAL_ADMIN_REQUIRED='true';
  preview.env.MAO_EXPECTED_FOUNDER_ID='MAO-OXHBDBWCOIHPBBYN';
  const result=await preview.asJson('/api/accounts/login',{
    method:'POST',body:{identifier:'CentralOwner',password:founderPass}
  });
  assert.equal(result.status,403);
  assert.equal(result.payload.error.code,'CANONICAL_ADMIN_MISMATCH');
  assert.equal(preview.query('SELECT COUNT(*) AS n FROM mao_accounts')[0].n,0);
  assert.equal(issuer.query('SELECT COUNT(*) AS n FROM mao_account_sessions WHERE revoked_at IS NULL')[0].n,0);
});
