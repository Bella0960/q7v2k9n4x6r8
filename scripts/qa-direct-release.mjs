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
  // The PWA navigation suite reads dist/index.html and dist/pwa-pages.json.
  // Build first so this works on a clean checkout, not only after an older build.
  ['npm', ['run', 'build']],
  ['npm', ['run', 'test:pwa:navigation']],
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

function assertReadyForUpload() {
  // npm/Vite/browser tests must not silently alter tracked source files.
  assertLatestGitHead();
  assert.equal(run('git', ['status', '--porcelain'], true), '',
    'Tests altered the checkout: refusing to upload uncommitted source');
  // Wrangler serves the Vite build, not the unbuilt checkout.
  for (const path of [
    'dist/index.html', 'dist/account/index.html',
    'dist/account/bootstrap.html', 'dist/account/account.js',
    'dist/account/bootstrap.js', 'dist/account/ivory-entry.css',
    'dist/chat/chat/chat-detail.html'
  ]) {
    assert.ok(existsSync(path), 'QA Vite asset missing after build: ' + path);
  }
}

function secretNames(settings) {
  return (settings?.bindings || [])
    .filter(binding => binding.type === 'secret_text')
    .map(binding => binding.name)
    .sort();
}

function verifyQaRuntimeVars(bindings, plannedVars, { allowClosingSetup = false } = {}) {
  const live = (bindings || []).filter(binding => binding.type === 'plain_text');
  const seen = new Set();
  for (const setting of live) {
    assert.ok(!seen.has(setting.name), 'Duplicated QA runtime variable: ' + setting.name);
    seen.add(setting.name);
    assert.ok(Object.prototype.hasOwnProperty.call(plannedVars, setting.name),
      'An existing QA runtime variable is missing from the release config: ' + setting.name);
    const next = plannedVars[setting.name];
    const canClose = allowClosingSetup &&
      setting.name === 'MAO_QA_IDENTITY_SETUP' &&
      setting.text === QA_SETUP_OPEN && next === QA_SETUP_CLOSED;
    if (!canClose) {
      assert.equal(next, setting.text,
        'Release would unexpectedly change the existing QA runtime variable: ' + setting.name);
    }
  }
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
  assert.equal(qa.workers_dev, true,
    'The sole QA testing URL must remain enabled on workers.dev');
  assert.equal(core.workers_dev, false,
    'The isolated identity core must never acquire a public workers.dev URL');
  assert.equal(qa.preview_urls, false, 'QA must not generate extra preview URLs');
  assert.equal(core.preview_urls, false, 'Identity core preview URLs must remain disabled');
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

async function liveWorkerVersion(name) {
  const result = await cloudflare('/workers/scripts/' + name + '/deployments');
  const deployments = Array.isArray(result?.deployments) ? result.deployments :
    Array.isArray(result) ? result : [];
  const latest = deployments[0];
  const versions = latest?.versions;
  assert.ok(Array.isArray(versions) && versions.length === 1 &&
    Number(versions[0].percentage) === 100,
    'Cannot verify a single fully active deployment for ' + name);
  const versionId = String(versions[0].version_id || '');
  assert.match(versionId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'Cloudflare returned an invalid deployed version for ' + name);
  return { versionId, source: String(latest.source || '') };
}

async function qaHttpSmoke(coreInitialized) {
  // Check the exact URL used by the owner, not merely Cloudflare metadata.
  // These requests are anonymous, read-only, and never transmit credentials.
  const origin = 'https://maomao-aw-qa-20261114.miamor520000.workers.dev';
  const paths = [
    '/api/admin/bootstrap/status',
    '/account/index.html',
    '/account/account.js?v=20261116-qa1',
    '/account/ivory-entry.css?v=20261116-qa1',
    '/account/bootstrap.html',
    '/account/bootstrap.js?v=20261116-qa1'
  ];
  const responses = await Promise.all(paths.map((path, index) =>
    fetch(origin + path, {
      method: 'GET', redirect: 'manual', cache: 'no-store',
      headers: { accept: index === 0 ? 'application/json' : '*/*' },
      signal: AbortSignal.timeout(15000)
    })
  ));
  const [statusResponse, loginResponse, loginJsResponse, loginCssResponse,
    bootstrapHtmlResponse, bootstrapJsResponse] = responses;
  assert.equal(statusResponse.status, 200, 'QA status endpoint did not return HTTP 200');
  const status = await statusResponse.json();
  assert.equal(status?.ok, true, 'QA status endpoint did not confirm success');
  assert.equal(status.identityMode, 'delegated', 'QA account mode mismatch');
  assert.equal(status.qaIdentityCore, true,
    'QA login page is not linked to the isolated identity core');
  assert.equal(status.identityAuthorityConnected, true, 'QA core is not reachable');
  assert.equal(status.identityAuthorityInitialized, coreInitialized,
    'QA identity initialization did not match the pre-deployment DB check');
  assert.equal(status.initialized, coreInitialized, 'QA bootstrap status is inconsistent');
  assert.equal(status.configured, true, 'QA identity core did not report ready configuration');
  assert.equal(status.signInReady, coreInitialized,
    'QA login readiness does not match the initialized identity core');
  assert.equal(status.qaSetupAllowed, !coreInitialized,
    'QA one-time setup state does not match the identity core');
  assert.equal(loginResponse.status, 200, 'QA login document did not return HTTP 200');
  const loginHtml = await loginResponse.text();
  assert.ok(/<form\b[^>]*\bid=["']loginForm["']/i.test(loginHtml),
    'The existing QA login form is missing from the served HTML');
  assert.ok(loginHtml.includes('/account/account.js?v=20261116-qa1'),
    'QA login HTML is still referencing cached older JavaScript');
  // Vite may fingerprint or merge stylesheets. Verify what the login HTML
  // actually loads rather than requiring the pre-build CSS href to survive.
  const cssRefs = [...loginHtml.matchAll(
    /<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/gi
  )].map(match => match[1]);
  assert.ok(cssRefs.length > 0, 'QA login HTML does not load a stylesheet');
  const renderedCss = await Promise.all(cssRefs.map(async href => {
    const url = new URL(href, origin + '/account/index.html');
    assert.equal(url.origin, origin, 'QA login stylesheet must be same-origin');
    assert.ok(url.pathname.toLowerCase().endsWith('.css'),
      'QA login stylesheet URL is not CSS');
    const response = await fetch(url.href, {
      method: 'GET', redirect: 'manual', cache: 'no-store',
      signal: AbortSignal.timeout(15000)
    });
    assert.equal(response.status, 200, 'QA linked stylesheet did not return HTTP 200');
    return response.text();
  }));
  for (const [response, label] of [
    [loginJsResponse, 'QA login JavaScript'],
    [loginCssResponse, 'QA login stylesheet'],
    [bootstrapHtmlResponse, 'QA founder setup HTML'],
    [bootstrapJsResponse, 'QA founder setup JavaScript']
  ]) {
    assert.equal(response.status, 200, label + ' did not return HTTP 200');
  }
  const [loginJs, loginCss, bootstrapHtml, bootstrapJs] = await Promise.all([
    loginJsResponse.text(), loginCssResponse.text(),
    bootstrapHtmlResponse.text(), bootstrapJsResponse.text()
  ]);
  assert.ok(loginJs.includes("subtitle.classList.toggle('qa-login-hint'"),
    'QA-only password warning JavaScript is stale or missing');
  assert.ok(loginCss.includes('#loginPanel>.lead.qa-login-hint'),
    'QA login source stylesheet is stale or missing');
  assert.ok(renderedCss.some(css => css.includes('qa-login-hint')),
    'QA login HTML does not actually load the password warning style');
  assert.ok(bootstrapHtml.includes('id="bootstrapUsernameLabel"') &&
    bootstrapHtml.includes('./bootstrap.js?v=20261116-qa1'),
    'QA founder setup form or versioned script is stale or missing');
  assert.ok(bootstrapJs.includes('usernameField.maxLength = qaSetup ? 28 : 24'),
    'QA setup cannot accept the existing founder permanent ID');
  console.log('Original QA login/setup HTML, scripts, CSS and identity status verified.');
}

function verifiedAccountCounts(item, name) {
  // Missing/invalid Cloudflare SQL evidence is NOT evidence of an empty DB.
  assert.equal(item?.meta?.rows_written, 0,
    'Cannot prove Cloudflare account query was read-only: ' + name);
  const row = item?.rows?.[0];
  assert.ok(Array.isArray(row) && row.length === 3,
    'Cloudflare account query returned incomplete SQL counts: ' + name);
  const [total, matchCell, adminCell] = row;
  const matches = total === 0 && matchCell === null ? 0 : matchCell;
  const admins = total === 0 && adminCell === null ? 0 : adminCell;
  assert.ok(Number.isSafeInteger(total) && total >= 0 &&
    Number.isSafeInteger(matches) && matches >= 0 && matches <= total &&
    Number.isSafeInteger(admins) && admins >= 0 && admins <= total,
    'Cloudflare account counts are invalid or unverified: ' + name);
  return { total, matches, admins };
}

async function verifyWorkerPublicRoutes() {
  const [qa, core] = await Promise.all([
    cloudflare('/workers/scripts/' + QA + '/subdomain'),
    cloudflare('/workers/scripts/' + CORE + '/subdomain')
  ]);
  assert.equal(qa?.enabled, true,
    'The original QA workers.dev test entry is disabled');
  assert.equal(qa?.previews_enabled, false,
    'Unexpected extra QA preview URLs are enabled');
  assert.equal(core?.enabled, false,
    'The isolated identity core is unexpectedly public on workers.dev');
  assert.equal(core?.previews_enabled, false,
    'The isolated identity core is unexpectedly public through preview URLs');
}

async function cloudflarePreflight() {
  await verifyWorkerPublicRoutes();
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
  const originalQaSecrets = secretNames(qa);
  const originalCoreSecrets = secretNames(core);
  const qaSetupState = JSON.parse(readFileSync('wrangler.qa.jsonc', 'utf8')).vars?.MAO_QA_IDENTITY_SETUP;
  const currentService = binding(qa, 'MAO_IDENTITY_AUTHORITY')?.service;
  assert.ok([CORE, 'maomao-001-identity-gateway-20261114'].includes(currentService),
    'Unexpected identity service binding');
  let coreInitialized = null;
  for (const [name, namespace, object] of [
    [QA, QA_DB, QA_DO], [CORE, CORE_DB, CORE_DO]
  ]) {
    const result = await cloudflare(
      '/workers/durable_objects/namespaces/' + namespace + '/query/v2',
      { durable_object_id: object, queries: [{
        sql: 'SELECT COUNT(*), SUM(CASE WHEN id=? AND role=? AND status=? THEN 1 ELSE 0 END), SUM(CASE WHEN role=? AND status=? THEN 1 ELSE 0 END) FROM mao_accounts',
        params: [FOUNDER, 'super_admin', 'active', 'super_admin', 'active']
      }] });
    const { total, matches, admins } =
      verifiedAccountCounts(result?.results?.[0], name);
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
      coreInitialized = total === 1;
    }
    console.log('Read-only verified ' + name + ': accounts=' + total +
      ', founder matches=' + matches + ', active admins=' + admins);
  }
  assert.equal(typeof coreInitialized, 'boolean', 'Cannot verify QA identity core state');
  verifyQaRuntimeVars(qa.bindings,
    JSON.parse(readFileSync('wrangler.qa.jsonc', 'utf8')).vars,
    { allowClosingSetup: coreInitialized });
  return { coreInitialized, originalQaSecrets, originalCoreSecrets };
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
  const { coreInitialized, originalQaSecrets, originalCoreSecrets } =
    await cloudflarePreflight();
  const corePrevious = await liveWorkerVersion(CORE);
  const qaPrevious = await liveWorkerVersion(QA);
  assertReadyForUpload();
  run('npx', ['--yes', 'wrangler@4', 'deploy', '--config', 'wrangler.qa-identity-core.jsonc']);
  const coreVersion = await liveWorkerVersion(CORE);
  await verifyWorkerPublicRoutes();
  assert.notEqual(coreVersion.versionId, corePrevious.versionId,
    'Identity core deployment version did not advance');
  assert.equal(coreVersion.source, 'wrangler',
    'Identity core latest deployment is not a Wrangler release');
  const core = await cloudflare('/workers/scripts/' + CORE + '/settings');
  const coreBinding = name => core.bindings?.find(x => x.name === name);
  assert.deepEqual(secretNames(core), originalCoreSecrets,
    'QA identity core secrets changed during deployment');
  assert.equal(coreBinding('CLOUD_DB')?.namespace_id, CORE_DB);
  assert.equal(coreBinding('MAO_IDENTITY_MODE')?.text, 'local', 'Core identity mode did not deploy');
  assert.equal(coreBinding('MAO_QA_ISOLATED_IDENTITY_CORE')?.text, 'true', 'Isolated QA identity mode did not deploy');
  assert.equal(coreBinding('MAO_QA_FOUNDER_ID')?.text, FOUNDER, 'QA founder continuity config did not deploy');
  for (const name of ['MAO_SUPER_ADMIN_BOOTSTRAP_SECRET', 'DEVICE_SECRET_PEPPER']) {
    assert.equal(coreBinding(name)?.type, 'secret_text', 'Core QA-only secret lost after deploy: ' + name);
  }
  // Do not switch QA's old authority until the isolated core is configured.
  // The second remote check prevents an old PR build from switching QA.
  assertReadyForUpload();
  run('npx', ['--yes', 'wrangler@4', 'deploy', '--config', 'wrangler.qa.jsonc']);
  const qaVersion = await liveWorkerVersion(QA);
  await verifyWorkerPublicRoutes();
  assert.notEqual(qaVersion.versionId, qaPrevious.versionId,
    'QA deployment version did not advance');
  assert.equal(qaVersion.source, 'wrangler',
    'QA latest deployment is not a Wrangler release');
  const qa = await cloudflare('/workers/scripts/' + QA + '/settings');
  const qaBinding = name => qa.bindings?.find(x => x.name === name);
  verifyQaRuntimeVars(qa.bindings,
    JSON.parse(readFileSync('wrangler.qa.jsonc', 'utf8')).vars);
  assert.deepEqual(secretNames(qa), originalQaSecrets,
    'Existing QA secrets changed during deployment: keep the original push and account credentials');
  assert.equal(qaBinding('AI')?.type, 'ai', 'Existing QA AI binding was lost');
  assert.equal(qaBinding('ASSETS')?.type, 'assets', 'Existing QA web assets binding was lost');
  assert.equal(qaBinding('CLOUD_DB')?.namespace_id, QA_DB);
  assert.equal(qaBinding('MAO_IDENTITY_AUTHORITY')?.service, CORE);
  assert.equal(qaBinding('MAO_IDENTITY_MODE')?.text, 'delegated_preview');
  assert.equal(qaBinding('MAO_IDENTITY_AUTHORITY_MODE')?.text, 'existing_worker');
  assert.equal(qaBinding('MAO_QA_AUTHORITY_WORKER')?.text, CORE);
  assert.equal(qaBinding('MAO_QA_IDENTITY_SETUP')?.text,
    JSON.parse(readFileSync('wrangler.qa.jsonc', 'utf8')).vars?.MAO_QA_IDENTITY_SETUP);
  await qaHttpSmoke(coreInitialized);
  console.log('Cloudflare active QA identity core version: ' + coreVersion.versionId);
  console.log('Cloudflare active QA Worker version: ' + qaVersion.versionId);
  console.log('QA deployed to the EXISTING Worker. Test bootstrap/login and disable one-time setup.');
}

main().catch(error => {
  console.error('QA release stopped:', error.message);
  process.exitCode = 1;
});
