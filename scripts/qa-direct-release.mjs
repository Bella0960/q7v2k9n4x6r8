/**
 * Direct, QA-only MAOMAO release (bypasses GitHub Actions / Cloudflare Builds).
 *
 * Validate without deployment:
 *   node scripts/qa-direct-release.mjs
 *
 * Deploy ONLY existing QA workers, after complete regression and preflight:
 *   MAOMAO_QA_DEPLOY_CONFIRM=maomao-aw-qa-20261114 node scripts/qa-direct-release.mjs --deploy
 *
 * Requires a full checkout of the existing #299 integration branch, Node 22,
 * npm, Playwright Chromium, CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.
 * Never touches main, mao, mao-auth-preview, curly-dream-324c or app.mao520.com.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const QA = 'maomao-aw-qa-20261114';
const CORE = 'maomao-identity-core';
const FOUNDER = 'MAO-OXHBDBWCOIHPBBYN';
const QA_DB = '4a24ce58079f468c87c2f75e107c4d1c';
const CORE_DB = 'e1b78d3813ae4a819841e8c5c3e9e8ec';
const QA_DO = '4a10d3dab4e16639445f4afdb0b7e5e2462cf06894cb4ae85f0ac3cd3cdba101';
const CORE_DO = 'dba114c7b0abd8e53d1d78e579924852b8e40907e50213634aeeaeb41ab51a98';
const BRANCH = 'integration/account-fanwai-stack-20261115';
const QA_SETUP_OPEN = 'isolated_authority';
const QA_SETUP_CLOSED = 'disabled';
const TESTS = [
  ['npm', ['ci', '--no-audit', '--no-fund']],
  ['npm', ['run', 'test:account:ui-candidate']],
  ['npm', ['run', 'test:integration:account-fanwai']],
  ['npm', ['run', 'test:tutorial']],
  ['npm', ['run', 'test:chat:contract']],
  ['npm', ['run', 'test:pwa:navigation']],
  ['npm', ['run', 'build']],
  // A full Node suite catches regressions outside the narrower account/chat scripts.
  ['node', ['--test']],
  ['npx', ['playwright', 'install', 'chromium']],
  ['npm', ['run', 'test:fanwai:browser:build']]
];

function run(command, args, quiet = false) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    stdio: quiet ? 'pipe' : 'inherit',
    shell: false
  });
  if (result.status !== 0 || result.error) {
    throw new Error(command + ' ' + args.join(' ') + ' failed (exit ' +
      result.status + '): ' + (result.error?.message || (quiet ? result.stderr?.slice(0, 240) : '')));
  }
  return quiet ? String(result.stdout || '').trim() : '';
}

function assertLatestGitHead() {
  // Remote #299 may advance while tests run: verify again immediately before uploads.
  const localSha = run('git', ['rev-parse', 'HEAD'], true);
  const remoteLine = run('git', ['ls-remote', '--heads', 'origin', BRANCH], true);
  const [remoteSha, remoteRef] = remoteLine.split(/\s+/);
  assert.match(remoteSha || '', /^[a-f0-9]{40}$/, 'Cannot verify remote #299 HEAD');
  assert.equal(remoteRef, 'refs/heads/' + BRANCH, 'Unexpected remote branch ref');
  assert.equal(localSha, remoteSha, 'Local #299 HEAD is stale: fetch the latest before QA release');
}

function preflightCheckout() {
  assert.equal(run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], true), BRANCH,
    'Only the original #299 integration branch may be used for the QA release');
  const origin = run('git', ['remote', 'get-url', 'origin'], true);
  assert.match(origin, /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)Bella0960\/MAOMAO(?:\.git)?\/?$/, 'Unexpected repository origin');
  // A clean local branch can still be stale: never release an older #299 HEAD.
  assertLatestGitHead();
  assert.equal(run('git', ['status', '--porcelain'], true), '', 'Checkout must be clean');
  for (const path of ['package-lock.json', 'worker.js', 'vite.config.js']) {
    assert.ok(existsSync(path), 'Missing complete repository file: ' + path);
  }
  const qa = JSON.parse(readFileSync('wrangler.qa.jsonc', 'utf8'));
  const core = JSON.parse(readFileSync('wrangler.qa-identity-core.jsonc', 'utf8'));
  assert.equal(qa.name, QA);
  assert.equal(core.name, CORE);
  for (const config of [qa, core]) {
    assert.equal(config.main, 'worker.js');
    assert.equal(config.compatibility_date, '2026-10-27');
    assert.equal(config.keep_vars, true);
    assert.deepEqual(config.durable_objects?.bindings,
      [{ name: 'CLOUD_DB', class_name: 'CloudDatabase' }]);
    assert.equal(config.migrations?.[0]?.tag, 'v1');
    assert.ok(!['mao', 'mao-auth-preview', 'curly-dream-324c'].includes(config.name));
    assert.equal(config.routes, undefined, 'Custom routes are forbidden for QA');
    assert.equal(config.route, undefined, 'Custom routes are forbidden for QA');
    assert.equal(config.custom_domains, undefined, 'Custom domains are forbidden for QA');
    assert.equal(config.zone_id, undefined, 'Production zone bindings are forbidden for QA');
    assert.equal(config.zone_name, undefined, 'Production zone bindings are forbidden for QA');
    assert.ok(!JSON.stringify(config).toLowerCase().includes('mao520.com'), 'Production domains are forbidden for QA');
  }
  assert.equal(qa.assets?.binding, 'ASSETS');
  assert.equal(qa.assets?.run_worker_first, true);
  assert.equal(core.assets, undefined);
  assert.deepEqual(qa.services, [{ binding: 'MAO_IDENTITY_AUTHORITY', service: CORE }]);
  assert.equal(qa.vars?.MAO_IDENTITY_MODE, 'delegated_preview');
  assert.equal(qa.vars?.MAO_IDENTITY_AUTHORITY_MODE, 'existing_worker');
  assert.equal(qa.vars?.MAO_QA_AUTHORITY_WORKER, CORE);
  assert.ok([QA_SETUP_OPEN, QA_SETUP_CLOSED].includes(qa.vars?.MAO_QA_IDENTITY_SETUP),
    'QA setup must be explicitly opened for first bootstrap or disabled afterward');
  assert.equal(core.vars?.MAO_IDENTITY_MODE, 'local');
  assert.equal(core.vars?.MAO_QA_ISOLATED_IDENTITY_CORE, 'true');
  assert.equal(core.vars?.MAO_QA_FOUNDER_ID, FOUNDER);
}

async function cloudflare(path, body) {
  const account = String(process.env.CLOUDFLARE_ACCOUNT_ID || '');
  const token = String(process.env.CLOUDFLARE_API_TOKEN || '');
  assert.match(account, /^[0-9a-f]{32}$/, 'Cloudflare account ID is required');
  assert.ok(token.length >= 20, 'Cloudflare API token is required');
  const response = await fetch(
    'https://api.cloudflare.com/client/v4/accounts/' + account + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: 'Bearer ' + token,
        ...(body ? { 'content-type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  const result = await response.json();
  if (!response.ok || result.success !== true) {
    throw new Error('Read-only Cloudflare preflight failed at ' + path +
      ' (HTTP ' + response.status + ')');
  }
  return result.result;
}

async function cloudflarePreflight() {
  const [qa, core] = await Promise.all([
    cloudflare('/workers/scripts/' + QA + '/settings'),
    cloudflare('/workers/scripts/' + CORE + '/settings')
  ]);
  const binding = (settings, name) => settings.bindings?.find(x => x.name === name);
  assert.equal(binding(qa, 'CLOUD_DB')?.namespace_id, QA_DB);
  assert.equal(binding(core, 'CLOUD_DB')?.namespace_id, CORE_DB);
  assert.equal(binding(qa, 'MAO_EXPECTED_FOUNDER_ID')?.type, 'secret_text');
  assert.equal(binding(qa, 'MAO_IDENTITY_BRIDGE_SECRET')?.type, 'secret_text');
  assert.equal(binding(qa, 'DEVICE_SECRET_PEPPER')?.type, 'secret_text');
  assert.equal(binding(qa, 'VAPID_PRIVATE_KEY')?.type, 'secret_text');
  for (const name of ['MAO_SUPER_ADMIN_BOOTSTRAP_SECRET', 'DEVICE_SECRET_PEPPER']) {
    assert.equal(binding(core, name)?.type, 'secret_text',
      'Isolated core missing QA-only ' + name + '; configure securely before deployment');
  }
  const qaSetupState = JSON.parse(readFileSync('wrangler.qa.jsonc', 'utf8')).vars?.MAO_QA_IDENTITY_SETUP;
  const currentService = binding(qa, 'MAO_IDENTITY_AUTHORITY')?.service;
  assert.ok([CORE, 'maomao-001-identity-gateway-20261114'].includes(currentService),
    'Unexpected identity service binding');
  for (const [name, namespace, object] of [
    [QA, QA_DB, QA_DO], [CORE, CORE_DB, CORE_DO]
  ]) {
    const result = await cloudflare(
      '/workers/durable_objects/namespaces/' + namespace + '/query/v2',
      { durable_object_id: object, queries: [{
        sql: 'SELECT COUNT(*), SUM(CASE WHEN id=? AND role=? AND status=? THEN 1 ELSE 0 END), SUM(CASE WHEN role=? AND status=? THEN 1 ELSE 0 END) FROM mao_accounts',
        params: [FOUNDER, 'super_admin', 'active', 'super_admin', 'active']
      }] });
    const item = result?.results?.[0];
    assert.equal(Number(item?.meta?.rows_written || 0), 0);
    const [total, matches, admins] = (item?.rows?.[0] || []).map(x => Number(x || 0));
    assert.ok(Number.isSafeInteger(total), 'Cannot verify accounts: ' + name);
    if (name === QA) {
      assert.ok(total >= 1 && matches === 1 && admins === 1,
        'The original QA founder/admin no longer matches');
    } else {
      assert.ok(total <= 1 && (total === 0 || (matches === 1 && admins === 1)),
        'The isolated identity core contains conflicting accounts');
      // Once the QA founder exists, subsequent deployments must close the
      // one-time setup switch instead of silently re-opening that route.
      assert.equal(qaSetupState, total === 0 ? QA_SETUP_OPEN : QA_SETUP_CLOSED,
        'QA bootstrap lifecycle mismatch: close setup after the founder is initialized');
    }
    console.log('Read-only verified ' + name + ': accounts=' + total +
      ', founder matches=' + matches + ', active admins=' + admins);
  }
}

async function main() {
  const deploy = process.argv.includes('--deploy');
  assert.ok(process.argv.slice(2).every(x => x === '--deploy'), 'Unsupported arguments');
  preflightCheckout();
  console.log('Validating original MAOMAO QA candidate; production is never targeted.');
  for (const [command, args] of TESTS) run(command, args);
  console.log('Node, Vite and Chromium tests passed.');
  if (!deploy) {
    console.log('Validation only. No Cloudflare release attempted.');
    return;
  }
  assert.equal(process.env.MAOMAO_QA_DEPLOY_CONFIRM, QA,
    'Set MAOMAO_QA_DEPLOY_CONFIRM to the exact existing QA Worker name');
  await cloudflarePreflight();
  assertLatestGitHead();
  run('npx', ['--yes', 'wrangler@4', 'deploy', '--config', 'wrangler.qa-identity-core.jsonc']);
  const core = await cloudflare('/workers/scripts/' + CORE + '/settings');
  const coreBinding = name => core.bindings?.find(x => x.name === name);
  assert.equal(coreBinding('CLOUD_DB')?.namespace_id, CORE_DB);
  assert.equal(coreBinding('MAO_IDENTITY_MODE')?.text, 'local', 'Core identity mode did not deploy');
  assert.equal(coreBinding('MAO_QA_ISOLATED_IDENTITY_CORE')?.text, 'true', 'Isolated QA identity mode did not deploy');
  assert.equal(coreBinding('MAO_QA_FOUNDER_ID')?.text, FOUNDER, 'QA founder continuity config did not deploy');
  for (const name of ['MAO_SUPER_ADMIN_BOOTSTRAP_SECRET', 'DEVICE_SECRET_PEPPER']) {
    assert.equal(coreBinding(name)?.type, 'secret_text', 'Core QA-only secret lost after deploy: ' + name);
  }
  // Do not switch QA's old authority until the isolated core is configured.
  // The second remote check prevents an old PR build from switching QA.
  assertLatestGitHead();
  run('npx', ['--yes', 'wrangler@4', 'deploy', '--config', 'wrangler.qa.jsonc']);
  const qa = await cloudflare('/workers/scripts/' + QA + '/settings');
  const qaBinding = name => qa.bindings?.find(x => x.name === name);
  assert.equal(qaBinding('CLOUD_DB')?.namespace_id, QA_DB);
  assert.equal(qaBinding('MAO_IDENTITY_AUTHORITY')?.service, CORE);
  assert.equal(qaBinding('MAO_IDENTITY_MODE')?.text, 'delegated_preview');
  assert.equal(qaBinding('MAO_IDENTITY_AUTHORITY_MODE')?.text, 'existing_worker');
  assert.equal(qaBinding('MAO_QA_AUTHORITY_WORKER')?.text, CORE);
  assert.equal(qaBinding('MAO_QA_IDENTITY_SETUP')?.text,
    JSON.parse(readFileSync('wrangler.qa.jsonc', 'utf8')).vars?.MAO_QA_IDENTITY_SETUP);
  console.log('QA deployed to the EXISTING Worker. Test bootstrap/login and disable one-time setup.');
}

main().catch(error => {
  console.error('QA release stopped:', error.message);
  process.exitCode = 1;
});
