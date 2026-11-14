import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { randomToken } from '../worker/lib/crypto.js';
import { passwordDigest } from '../worker/lib/account-auth.js';
import { handleGatewayRequest } from '../worker/identity-authority-gateway.js';
import { isDelegatedAdminManagementRoute } from '../worker/lib/delegated-admin-routes.js';
import { openTestDb, setupTestStore } from './helpers/cloud-helpers.mjs';

const FOUNDER = 'MAO-AAAAAAAAAAAA';
const MEMBER = 'MAO-BBBBBBBBBBBB';
const PENDING = 'MAO-CCCCCCCCCCCC';
const PASS = 'the-existing-founder-password-for-a-test';
const SECRET = 'only-synthetic-gateway-secret-xxxxxxxxxxxxxxx';

function gatewayOpts() { return { MAO_IDENTITY_BRIDGE_SECRET: SECRET }; }

async function addAccount(store, id, username, password, role = 'user') {
  const salt = randomToken(16);
  const hash = await passwordDigest(password, salt);
  if (role === 'super_admin') {
    assert.equal(store.createMaoSuperAdminAccountIfEmpty({
      id, username, usernameKey: username.toLowerCase(),
      passwordSalt: salt, passwordHash: hash, now: Date.now()
    }), true);
  } else {
    const inserted = store.createMaoAccount({
      id, username, usernameKey: username.toLowerCase(),
      passwordSalt: salt, passwordHash: hash, registrationIpHash: 'test-ip-' + id,
      now: Date.now()
    });
    assert.ok(inserted);
  }
}

async function makePair({ enabled = true } = {}) {
  const originDb = openTestDb();
  const origin = setupTestStore(originDb, {
    MAO_SUPER_ADMIN_BOOTSTRAP_SECRET: 'synthetic-bootstrap-secret-for-pure-tests',
  });
  await addAccount(origin.store, FOUNDER, 'CentralOwner', PASS, 'super_admin');
  await addAccount(origin.store, PENDING, 'PendingMember', 'other-test-password', 'user');
  const previewDb = openTestDb();
  const outbound = [];
  const bridge = {
    async fetch(request) {
      return handleGatewayRequest(request, gatewayOpts(), async forwarded => {
        outbound.push({ method: forwarded.method, path: new URL(forwarded.url).pathname,
          header: forwarded.headers.get('authorization'),
          bridge: forwarded.headers.get('x-mao-identity-bridge'),
          cookie: forwarded.headers.get('cookie') });
        return origin.app(forwarded);
      });
    }
  };
  const preview = setupTestStore(previewDb, {
    MAO_IDENTITY_MODE: 'delegated_preview',
    MAO_IDENTITY_AUTHORITY_MODE: 'existing_worker',
    MAO_IDENTITY_CANONICAL_ADMIN_REQUIRED: 'true',
    MAO_EXPECTED_FOUNDER_ID: FOUNDER,
    MAO_IDENTITY_BRIDGE_SECRET: SECRET,
    ...(enabled ? { MAO_DELEGATED_ADMIN_MANAGEMENT_ENABLED: 'true' } : {}),
    MAO_IDENTITY_AUTHORITY: bridge
  });
  const login = await preview.fetchTo('/api/accounts/login', {
    method: 'POST', body: { identifier: 'CentralOwner', password: PASS }
  });
  assert.equal(login.status, 200, 'source founder authenticates with original password');
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /^MAO_SESSION=/);
  return { originDb, previewDb, origin, preview, outbound, cookie,
    close() { originDb.db.close(); previewDb.db.close(); } };
}

test('route allowlist cannot expose bootstrap, social, wallet, unlisted methods or arbitrary IDs', () => {
  for (const [method, path] of [
    ['GET', '/api/admin/accounts'], ['GET', '/api/admin/invites'],
    ['GET', '/api/admin/audit'], ['GET', '/api/admin/accounts/' + FOUNDER + '/detail'],
    ['GET', '/api/admin/accounts/' + FOUNDER + '/active-invite'],
    ['GET', '/api/admin/accounts/' + FOUNDER + '/audit'],
    ['POST', '/api/admin/invites'], ['POST', '/api/admin/accounts/' + FOUNDER + '/action'],
    ['POST', '/api/admin/invites/' + 'a'.repeat(32) + '/revoke']
  ]) assert.equal(isDelegatedAdminManagementRoute(method, path), true, path);
  for (const [method, path] of [
    ['POST', '/api/admin/bootstrap'], ['GET', '/api/admin/social/friend-approvals'],
    ['POST', '/api/admin/accounts'], ['GET', '/api/admin/accounts/../bootstrap'],
    ['GET', '/api/admin/accounts/INVALID/detail'], ['DELETE', '/api/admin/accounts'],
    ['POST', '/api/accounts/register'], ['GET', '/api/wallet/balance']
  ]) assert.equal(isDelegatedAdminManagementRoute(method, path), false, path);
});

test('gateway denies admin requests without original bearer session despite correct service secret', async () => {
  let upstream = 0;
  const fetcher = async () => { upstream++; return Response.json({ ok: true }); };
  for (const raw of ['', 'Bearer invalid', 'Bearer ' + 'a'.repeat(31)]) {
    const r = await handleGatewayRequest(new Request(
      'https://mao520.com/api/admin/accounts?limit=10',
      { headers: { 'x-mao-identity-bridge': SECRET, authorization: raw } }
    ), gatewayOpts(), fetcher);
    assert.equal(r.status, 401);
  }
  const forbidden = await handleGatewayRequest(
    new Request('https://mao520.com/api/admin/accounts', {
      headers: { 'x-mao-identity-bridge': 'wrong-secret', authorization: 'Bearer ' + 'A'.repeat(43) }
    }), gatewayOpts(), fetcher
  );
  assert.equal(forbidden.status, 403);
  assert.equal(upstream, 0);
});

test('source owner admin list and audit come through gateway without copying source account records', async t => {
  const pair = await makePair();
  t.after(() => pair.close());
  const accounts = await pair.preview.asJson('/api/admin/accounts?limit=5', {
    headers: { cookie: pair.cookie }
  });
  assert.equal(accounts.status, 200);
  assert.ok(accounts.payload.accounts.some(account => account.id === FOUNDER));
  assert.ok(accounts.payload.accounts.some(account => account.id === PENDING));
  assert.equal(pair.preview.query('SELECT COUNT(*) AS n FROM mao_accounts')[0].n, 1,
    'delegated account list must NOT mirror accounts into the QA database');

  const audit = await pair.preview.asJson('/api/admin/audit', { headers: { cookie: pair.cookie } });
  assert.equal(audit.status, 200);
  assert.ok(Array.isArray(audit.payload.records));
  const remoteAdmin = pair.outbound.filter(x => x.path.startsWith('/api/admin/'));
  assert.equal(remoteAdmin.length, 2);
  assert.equal(remoteAdmin.every(x => x.bridge === null && x.cookie === null), true,
    'internal bridge secret and QA cookie must never leak to origin');
  assert.equal(remoteAdmin.every(x => /^Bearer [A-Za-z0-9_-]{32,128}$/.test(x.header)), true);
});

test('001 creates one original-authority invite with server audit, not a local duplicate', async t => {
  const pair = await makePair();
  t.after(() => pair.close());
  const result = await pair.preview.asJson('/api/admin/invites', {
    method: 'POST', headers: { cookie: pair.cookie, 'content-type': 'application/json' },
    body: { targetAccountId: PENDING, ttlHours: 12, maxUses: 1 }
  });
  assert.equal(result.status, 201);
  assert.equal(result.payload.invite.targetAccountId, PENDING);
  assert.equal(pair.origin.query('SELECT COUNT(*) AS n FROM mao_invite_codes')[0].n, 1);
  assert.equal(pair.preview.query('SELECT COUNT(*) AS n FROM mao_invite_codes')[0].n, 0);
  assert.equal(pair.origin.query("SELECT COUNT(*) AS n FROM mao_account_audit WHERE action = 'invite_create'")[0].n, 1);
});

test('management stays disabled until two-sided gateway release; does not mutate original source', async t => {
  const pair = await makePair({ enabled: false });
  t.after(() => pair.close());
  const before = pair.outbound.filter(x => x.path.startsWith('/api/admin/')).length;
  const result = await pair.preview.asJson('/api/admin/accounts', { headers: { cookie: pair.cookie } });
  assert.equal(result.status, 403);
  assert.equal(result.payload.error.code, 'DELEGATED_ACCOUNT_MANAGED_CENTRALLY');
  assert.equal(pair.outbound.filter(x => x.path.startsWith('/api/admin/')).length, before);
});

test('unauthenticated requests never reach original owner admin source when management is enabled', async t => {
  const pair = await makePair();
  t.after(() => pair.close());
  const before = pair.outbound.filter(x => x.path.startsWith('/api/admin/')).length;
  const result = await pair.preview.asJson('/api/admin/accounts', { headers: {} });
  assert.equal(result.status, 401);
  assert.equal(pair.outbound.filter(x => x.path.startsWith('/api/admin/')).length, before);
});

test('private gateway deployment config cannot become a public login or overwrite the QA Worker', () => {
  const cfg=JSON.parse(readFileSync(new URL('../wrangler.identity-gateway.jsonc', import.meta.url),'utf8'));
  assert.equal(cfg.name,'maomao-001-identity-gateway-20261114');
  assert.equal(cfg.main,'worker/identity-authority-gateway.js');
  assert.equal(cfg.workers_dev,false);
  assert.equal(cfg.preview_urls,false);
  assert.equal(cfg.keep_vars,true);
  assert.equal(cfg.routes,undefined);
  assert.equal(cfg.route,undefined);
  assert.equal(cfg.vars,undefined);
  assert.equal(cfg.assets,undefined);
  assert.equal(cfg.durable_objects,undefined);
});
