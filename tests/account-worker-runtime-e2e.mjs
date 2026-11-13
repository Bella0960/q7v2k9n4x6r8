/**
 * E2E against a locally isolated Wrangler Durable Object, not production.
 *
 * Run AFTER npm run build:
 *   node tests/account-worker-runtime-e2e.mjs
 *
 * Uses Wrangler's local SQLite storage in a fresh temporary directory.
 * Generates disposable credentials and never logs or commits their values.
 * No public Worker deployment or production Cloudflare bindings are involved.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VARS_PATH = path.join(ROOT, '.dev.vars');
const PASSWORD = 'Temp-account-test-123456!';
const WRANGLER_VERSION = '4.161.0';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function cookieHeader(response) {
  const value = response.headers.get('set-cookie') || '';
  const cookie = value.split(';')[0];
  assert.match(cookie, /^MAO_SESSION=[A-Za-z0-9_-]{32,128}$/);
  return cookie;
}

async function main() {
  if (existsSync(VARS_PATH)) {
    throw new Error('Refusing to overwrite existing .dev.vars; run from an isolated checkout.');
  }
  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    throw new Error('Missing dist/index.html; run npm run build before this test.');
  }
  const secret = randomBytes(40).toString('base64url');
  const pepper = randomBytes(40).toString('base64url');
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'maomao-auth-e2e-'));
  let child = null;
  const checks = [];
  try {
    await writeFile(VARS_PATH,
      'MAO_SUPER_ADMIN_BOOTSTRAP_SECRET=' + secret + '\n' +
      'DEVICE_SECRET_PEPPER=' + pepper + '\n',
      { mode: 0o600, flag: 'wx' });
    const port = await freePort();
    const base = 'http://127.0.0.1:' + port;
    let output = '';
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    child = spawn(npx, [
      '--yes', 'wrangler@' + WRANGLER_VERSION,
      'dev', '--config', 'wrangler.preview.jsonc',
      '--local', '--ip', '127.0.0.1', '--port', String(port),
      '--persist-to', stateDir
    ], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' }
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', text => { output = (output + text).slice(-12000); });
    }
    let status = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(base + '/api/admin/bootstrap/status',
          { signal: AbortSignal.timeout(2000) });
        if (response.status === 200) {
          status = { response, body: await response.json() };
          break;
        }
      } catch {}
      await sleep(500);
    }
    if (!status) {
      // Keep log excerpts short and remove any randomly generated test keys.
      const safeOutput = output.replaceAll(secret, '[redacted]').replaceAll(pepper, '[redacted]');
      throw new Error('Local Wrangler worker did not become ready: ' + safeOutput.slice(-1800));
    }

    function pass(name) {
      checks.push(name);
      console.log('PASS - ' + name);
    }
    async function request(endpoint, { method = 'GET', body, cookie, accountId, follow = false } = {}) {
      const headers = { accept: 'application/json' };
      if (method !== 'GET') {
        headers.origin = base;
        headers['sec-fetch-site'] = 'same-origin';
        headers['content-type'] = 'application/json';
      }
      if (cookie) headers.cookie = cookie;
      if (accountId) headers['x-mao-account-context'] = accountId;
      const response = await fetch(base + endpoint, {
        method, headers, redirect: follow ? 'follow' : 'manual',
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000)
      });
      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json')
        ? await response.json()
        : await response.text();
      return { response, status: response.status, payload };
    }
    const post = (endpoint, body, auth = {}) => request(endpoint, { method: 'POST', body, ...auth });

    assert.equal(status.body.configured, true, 'local test secrets must be configured');
    assert.equal(status.body.initialized, false, 'fresh isolated database must be uninitialized');
    pass('isolated sqlite Durable Object starts without a founder and with disposable secrets');

    const anonymous = await request('/index.html');
    assert.equal(anonymous.status, 302);
    assert.equal(new URL(anonymous.response.headers.get('location'), base).pathname, '/account/index.html');
    pass('anonymous visitors cannot open private app HTML');

    const founder = await post('/api/admin/bootstrap', {
      bootstrapSecret: secret, username: 'qa_founder',
      password: PASSWORD, confirmPassword: PASSWORD
    });
    assert.equal(founder.status, 200, 'bootstrap failed: ' + JSON.stringify(founder.payload));
    assert.equal(founder.payload.account.role, 'super_admin');
    assert.equal(founder.payload.account.founderNumber, '001');
    const founderId = founder.payload.account.id;
    const founderCookie = cookieHeader(founder.response);
    pass('founder bootstrap returns one server-authorized 001 session');

    const duplicateBootstrap = await post('/api/admin/bootstrap', {
      bootstrapSecret: secret, username: 'another_admin',
      password: PASSWORD, confirmPassword: PASSWORD
    });
    assert.equal(duplicateBootstrap.status, 409);
    pass('second founder bootstrap is forbidden');

    const registrations = [];
    for (const username of ['qa_alice', 'qa_bob']) {
      const result = await post('/api/accounts/register', {
        username, password: PASSWORD, confirmPassword: PASSWORD
      });
      assert.equal(result.status, 201, username + ': ' + JSON.stringify(result.payload));
      assert.equal(result.payload.account.role, 'user');
      assert.equal(result.payload.account.status, 'pending_invite');
      assert.equal(Object.hasOwn(result.payload.account, 'founderNumber'), false);
      registrations.push(result.payload.account);
    }
    const [alice, bob] = registrations;
    assert.notEqual(alice.id, bob.id);
    pass('two different users register as pending, neither can claim founder 001');

    const userCookies = [];
    for (const username of ['qa_alice', 'qa_bob']) {
      const login = await post('/api/accounts/login', { identifier: username, password: PASSWORD });
      assert.equal(login.status, 200, username + ': ' + JSON.stringify(login.payload));
      userCookies.push(cookieHeader(login.response));
    }
    const [aliceCookie, bobCookie] = userCookies;
    const aliceMe = await request('/api/accounts/me', { cookie: aliceCookie, accountId: alice.id });
    const bobMe = await request('/api/accounts/me', { cookie: bobCookie, accountId: bob.id });
    assert.equal(aliceMe.status, 200);
    assert.equal(bobMe.status, 200);
    assert.equal(aliceMe.payload.account.id, alice.id);
    assert.equal(bobMe.payload.account.id, bob.id);
    pass('separate login cookies each resolve to their own durable account identity');

    const switchedContext = await request('/api/accounts/me', { cookie: bobCookie, accountId: alice.id });
    assert.equal(switchedContext.status, 409);
    assert.equal(switchedContext.payload.error.code, 'ACCOUNT_CONTEXT_CHANGED');
    const switchedSecurity = await request('/api/accounts/security', { cookie: bobCookie, accountId: alice.id });
    assert.equal(switchedSecurity.status, 409);
    pass('stale account A tab under B session cannot read account A or security data');

    const aliceBeforeInvite = await request('/index.html', { cookie: aliceCookie });
    assert.equal(aliceBeforeInvite.status, 302);
    pass('uninvited registered account cannot enter the private app');

    const invite = await post('/api/admin/invites', { targetAccountId: alice.id, ttlHours: 1 },
      { cookie: founderCookie, accountId: founderId });
    assert.equal(invite.status, 201, 'invite creation failed: ' + JSON.stringify(invite.payload));
    assert.match(invite.payload.invite.code, /^[A-Za-z0-9_-]{32,128}$/);
    const redeem = await post('/api/accounts/invites/redeem',
      { inviteCode: invite.payload.invite.code },
      { cookie: aliceCookie, accountId: alice.id });
    assert.equal(redeem.status, 200, 'invite redemption failed: ' + JSON.stringify(redeem.payload));
    assert.equal(redeem.payload.account.status, 'active');
    pass('admin issues one-time targeted invite, only alice becomes active');

    const bobReuse = await post('/api/accounts/invites/redeem',
      { inviteCode: invite.payload.invite.code },
      { cookie: bobCookie, accountId: bob.id });
    assert.equal(bobReuse.status, 403);
    const bobBlocked = await request('/index.html', { cookie: bobCookie });
    assert.equal(bobBlocked.status, 302);
    pass('bob cannot redeem alice invite or access private app before authorization');

    const aliceIndex = await request('/index.html', { cookie: aliceCookie });
    assert.equal(aliceIndex.status, 200);
    assert.match(aliceIndex.payload, new RegExp('meta name="mao-account-id" content="' + alice.id + '"'));
    assert.match(aliceIndex.payload, /meta name="mao-account-role" content="user"/);
    assert.equal(aliceIndex.response.headers.get('cache-control'), 'private, no-store, max-age=0');
    pass('active alice receives account-scoped HTML without shared caching');

    const userAdmin = await request('/admin/admin-center.html', { cookie: aliceCookie });
    assert.equal(userAdmin.status, 302);
    const founderAdmin = await request('/admin/admin-center.html', { cookie: founderCookie });
    assert.equal(founderAdmin.status, 200);
    assert.match(founderAdmin.payload, /meta name="mao-account-role" content="super_admin"/);
    pass('admin HTML is server-gated to authenticated super_admin');

    const userDirectory = await request('/api/admin/accounts',
      { cookie: aliceCookie, accountId: alice.id });
    assert.equal(userDirectory.status, 403);
    assert.equal(userDirectory.payload.error.code, 'ADMIN_ONLY');
    const founderDirectory = await request('/api/admin/accounts',
      { cookie: founderCookie, accountId: founderId });
    assert.equal(founderDirectory.status, 200);
    pass('regular users cannot call the administrator account directory API');

    console.log('ALL PASS: ' + checks.length + ' isolated Wrangler/SQLite Worker runtime assertions');
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    await rm(VARS_PATH, { force: true });
    await rm(stateDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

main().catch(error => {
  const message = String(error?.stack || error?.message || error).replace(/MAO_SESSION=[A-Za-z0-9_-]+/g, 'MAO_SESSION=[redacted]');
  console.error('FAIL - isolated account Worker runtime: ' + message.slice(0, 5000));
  process.exitCode = 1;
});
