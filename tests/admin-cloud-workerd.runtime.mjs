/**
 * ADMIN-CLOUD-001 isolated Workerd/Durable Object acceptance.
 * Runs Wrangler locally with temporary SQLite state and synthetic credentials.
 * Never connects to production, real Cloudflare auth, or the shared phone QA.
 * Run after npm ci + npm run build: node tests/admin-cloud-workerd.runtime.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = await mkdtemp(join(tmpdir(), 'maomao-admin-workerd-'));
const boot = randomBytes(32).toString('hex');
const pepper = randomBytes(32).toString('hex');
const version = '4.135.0';
const password = 'local-synthetic-password-12345';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let worker = null;
let logfile = null;

async function start(port, vars = {}) {
  const args = [
    '--yes', 'wrangler@' + version, 'dev', '--local',
    '--config', 'wrangler.jsonc', '--ip', '127.0.0.1',
    '--port', String(port), '--persist-to', join(temp, 'database-' + port),
    '--var', 'MAO_SUPER_ADMIN_BOOTSTRAP_SECRET:' + boot,
    '--var', 'DEVICE_SECRET_PEPPER:' + pepper,
    ...Object.entries(vars).flatMap(([key, value]) => ['--var', key + ':' + value])
  ];
  logfile = await open(join(temp, 'workerd-' + port + '.log'), 'w');
  const environment = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' };
  delete environment.CLOUDFLARE_API_TOKEN;
  delete environment.CLOUDFLARE_ACCOUNT_ID;
  worker = spawn('npx', args, {
    cwd: process.cwd(), env: environment, detached: true,
    stdio: ['ignore', logfile.fd, logfile.fd]
  });
  const origin = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) {
    if (worker.exitCode !== null || worker.signalCode) break;
    try {
      const res = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(1200) });
      if (res.ok) return origin;
    } catch { /* Wrangler is still booting. */ }
    await sleep(1500);
  }
  const raw = await readFile(join(temp, 'workerd-' + port + '.log'), 'utf8').catch(() => '');
  const signatures = [
    ['WRANGLER_PACKAGE_VERSION', /No matching version found|ETARGET/i],
    ['NPM_NETWORK_FAILURE', /ENETUNREACH|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i],
    ['UNSUPPORTED_NODE_ENGINE', /Unsupported engine|requires Node\.js|EBADENGINE/i],
    ['WRANGLER_CLI_FLAGS', /Unknown argument|Unknown option|unexpected argument/i],
    ['WRANGLER_BUILD_ERROR', /Could not resolve|Unable to resolve|Failed to resolve|Build failed/i],
    ['WORKERD_SQLITE_INIT', /Durable Object|SqliteError|SQLITE_ERROR|migration/i],
    ['WORKERD_MODULE_ERROR', /SyntaxError|TypeError|ReferenceError/i]
  ];
  const category = signatures.find(([, re]) => re.test(raw))?.[0] || 'UNCLASSIFIED';
  console.error('WORKERD_START_CATEGORY=' + category + ' code=' + (worker.exitCode ?? 'unknown'));
  const safeLines = raw.split(/\r?\n/)
    .map(line => line.replace(/\x1B\[[0-9;]*m/g, ''))
    .filter(line => /(?:\[ERROR\]|npm error|error:|failed|invalid|unsupported|could not|cannot|not found|unknown argument)/i.test(line))
    .slice(-6)
    .map(line => line
      .replace(/[A-Fa-f0-9]{24,}/g, '[HEX_REDACTED]')
      .replace(/MAO_SESSION=[^\s;]+/gi, 'MAO_SESSION=[REDACTED]')
      .replace(/(?:MAO_SUPER_ADMIN_BOOTSTRAP_SECRET|DEVICE_SECRET_PEPPER)\s*[:=]\s*\S+/gi, '[SYNTH_SECRET_REDACTED]')
      .replace(/(?:https?:\/\/)[^\s]+/gi, '[URL_REDACTED]')
      .slice(0, 170));
  safeLines.forEach((line, i) => console.error('WORKERD_SANITIZED_LINE_' + i + ' ' + line));
  throw new Error('WORKERD_LOCAL_START_FAILED');
}

async function stop() {
  if (worker?.pid) {
    try { process.kill(-worker.pid, 'SIGTERM'); } catch { /* Already exited. */ }
  }
  worker = null;
  if (logfile) { await logfile.close(); logfile = null; }
}

async function request(origin, path, { method = 'GET', cookie = '', account = '', payload } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (account) headers['x-mao-account-context'] = account;
  if (method !== 'GET' && method !== 'HEAD') {
    headers.origin = origin;
    if (payload !== undefined) headers['content-type'] = 'application/json';
  }
  const response = await fetch(origin + path, {
    method, headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
    redirect: 'manual', signal: AbortSignal.timeout(10000)
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* HTML response. */ }
  return { status: response.status, headers: response.headers, text, json };
}

try {
  const origin = await start(8788);
  console.log('WORKERD_PASS native Durable Object and migrations');
  const anon = await request(origin, '/api/admin/cloud/health');
  assert.equal(anon.status, 401, 'anonymous diagnostics must fail');
  const anonPage = await request(origin, '/admin/cloud.html');
  assert.equal(anonPage.status, 302, 'anonymous admin HTML must redirect');

  const created = await request(origin, '/api/admin/bootstrap', {
    method: 'POST',
    payload: {
      bootstrapSecret: boot, username: 'runtime_test_admin',
      password, confirmPassword: password,
      qqEmail: '87654321@qq.com'
    }
  });
  assert.equal(created.status, 200, 'local synthetic founder bootstrap');
  const account = created.json?.account?.id;
  assert.match(account, /^MAO-[A-Z0-9]{12,24}$/, 'valid synthetic account ID');
  const cookie = (created.headers.get('set-cookie') || '').match(/MAO_SESSION=[^;]+/)?.[0];
  assert.ok(cookie, 'founder session cookie returned');

  const missing = await request(origin, '/api/admin/cloud/health', { cookie });
  assert.equal(missing.status, 409, 'account context mandatory');
  const wrong = await request(origin, '/api/admin/cloud/health', { cookie, account: 'MAO-AAAAAAAAAAAA' });
  assert.equal(wrong.status, 409, 'cross-account context blocked');
  const paths = [
    '/api/admin/cloud', '/api/admin/cloud/overview',
    '/api/admin/cloud/health', '/api/admin/cloud/tasks',
    '/api/admin/cloud/errors?window=24h&limit=5', '/api/admin/cloud/sections'
  ];
  for (const path of paths) {
    const result = await request(origin, path, { cookie, account });
    assert.equal(result.status, 200, 'admin GET ' + path);
    assert.equal(result.json?.ok, true, 'JSON response envelope ' + path);
    assert.ok(!result.text.includes(boot), 'secrets never reflected');
  }
  const post = await request(origin, '/api/admin/cloud/health', {
    method: 'POST', cookie, account, payload: {}
  });
  assert.equal(post.status, 405, 'only GET allowed');
  assert.equal(post.headers.get('allow'), 'GET');
  const unknown = await request(origin, '/api/admin/cloud/not-a-section', { cookie, account });
  assert.equal(unknown.status, 404, 'unknown section remains unauthorized to writes');
  const page = await request(origin, '/admin/cloud.html', { cookie });
  assert.equal(page.status, 200, 'admin HTML served by real static asset handler');
  assert.ok(page.text.includes('name="mao-account-id"'), 'account scope injected');
  assert.ok(page.text.includes('cloud-admin-core.js'), 'admin assets built');
  assert.match(page.headers.get('cache-control') || '', /no-store/, 'private HTML not cached');
  console.log('WORKERD_PASS super_admin login, protected HTML, GET and 405, account context');
  await stop();

  const delegated = await start(8790, { MAO_IDENTITY_MODE: 'delegated_preview' });
  const refused = await request(delegated, '/api/admin/bootstrap', {
    method: 'POST', payload: {
      bootstrapSecret: boot, username: 'fake_founder',
      password, confirmPassword: password,
      qqEmail: '87654322@qq.com'
    }
  });
  assert.equal(refused.status, 403, 'delegated mode must refuse local founder creation');
  const delegateAnon = await request(delegated, '/api/admin/cloud/health');
  assert.equal(delegateAnon.status, 401, 'delegated mode without authority must reject anonymous request');
  console.log('WORKERD_PASS delegated-preview fail-closed without central identity');
  await stop();
  console.log('WORKERD_ACCEPTANCE_PASS no shared QA or production writes');
} catch (error) {
  console.error('WORKERD_ACCEPTANCE_FAIL', String(error?.message || error).slice(0,170));
  process.exitCode = 1;
} finally {
  await stop();
  await rm(temp, { recursive: true, force: true });
}
