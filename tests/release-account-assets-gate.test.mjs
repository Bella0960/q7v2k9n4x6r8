import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const worker = readFileSync(resolve(root, 'worker.js'), 'utf8');

test('release prerequisite: authenticated Worker account namespace asset must exist', () => {
  const tag = worker.match(/<script src="(\/shared\/js\/mao-account-scope\.js\?v=\d+)" data-mao-account-scope>/);
  assert.ok(tag, 'Worker must synchronously inject its existing account scope module before app scripts');
  const asset = tag[1].split('?')[0].slice(1);
  assert.ok(existsSync(resolve(root, asset)),
    asset + ' missing: integrate existing PR #290 before publishing the fanwai preview; do not create a second account system');
  const source = readFileSync(resolve(root, asset), 'utf8');
  assert.match(source, /__MAO_ACCOUNT_SCOPE__/,
    'the reused scope runtime must expose the expected account context');
});

test('release prerequisite: authenticated Worker redirects only to existing account entry pages', () => {
  for (const route of ['account/index.html', 'account/bootstrap.html']) {
    assert.ok(existsSync(resolve(root, route)),
      route + ' missing: integrate existing account front-end PR #290 before routing live login through this Worker');
  }
});

test('release prerequisite: fanwai never silently ignores a missing authenticated namespace', () => {
  const code = readFileSync(resolve(root, 'chat/chat/js/chat-fanwai.js'), 'utf8');
  assert.match(code, /trustedAccountScope\.ready !== true/);
  assert.match(code, /trustedAccountScope\.accountId !== accountId/);
});

test('release prerequisite: authenticated HTML must remain network-first after account integration', () => {
  const sw = readFileSync(resolve(root, 'sw.js'), 'utf8');
  assert.match(sw, /req\.mode === 'navigate' && !isPublicAccountPage/,
    'Protected app pages must pass the authenticated Worker gate on every visit; integrate the v238+ account PWA from PR #290, never overwrite with v206 fanwai cache-first logic');
  assert.match(sw, /if \(!isPublicAccountPage && \(url\.pathname === '\/'/,
    'Non-navigation HTML loads must also bypass legacy CacheStorage after integrating PR #290');
});


test('release prerequisite: actual chat HTML loads fanwai entry and Vite publishes both JS and CSS', () => {
  const html = readFileSync(resolve(root, 'chat/chat/chat-detail.html'), 'utf8');
  const extras = readFileSync(resolve(root, 'chat/chat/js/chat-extras.js'), 'utf8');
  const fanwai = readFileSync(resolve(root, 'chat/chat/js/chat-fanwai.js'), 'utf8');
  const vite = readFileSync(resolve(root, 'vite.config.js'), 'utf8');
  assert.match(html, /<script src="js\/chat-extras\.js\?t=20\d{6}fanwai\d+"/,
    'chat page must refresh the original extras loader after integrating fanwai');
  assert.match(extras, /fanwaiScript\.src = 'js\/chat-fanwai\.js\?v=20\d{6}v\d+'/,
    'existing plus menu must load the versioned fanwai script');
  assert.match(fanwai, /js\/chat-fanwai\.css\?v=20\d{6}softcore\d+/,
    'fanwai must request its own versioned stylesheet');
  assert.equal((html.match(/<script src="js\/chat-extras\.js\?t=/g) || []).length, 1,
    'chat detail must load exactly one versioned extras script');
  assert.equal((extras.match(/fanwaiScript\.src\s*=\s*'js\/chat-fanwai\.js\?v=/g) || []).length, 1,
    'the existing plus panel must load exactly one fanwai module');
  for (const asset of ['chat/chat/js/chat-fanwai.js', 'chat/chat/js/chat-fanwai.css']) {
    assert.ok(existsSync(resolve(root, asset)), asset + ' must exist before production build');
  }
  assert.match(vite, /'\.js'/);
  assert.match(vite, /'\.css'/);
});


test('release prerequisite: current production deployment remains manual-only and checks founder continuity', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/deploy-cloudflare-worker.yml'), 'utf8');
  assert.match(workflow, /^on:\s*\n  workflow_dispatch:/m,
    'production deployment must require an explicit workflow dispatch');
  assert.doesNotMatch(workflow, /^\s+push:/m,
    'merging this draft must not re-enable automatic deployment to app.mao520.com');
  assert.match(workflow, /verify-production-worker-source\.mjs/);
  assert.match(workflow, /test -f scripts\/verify-production-account-readiness\.mjs/,
    'missing founder continuity verification must fail closed');
  assert.match(workflow, /node scripts\/verify-production-account-readiness\.mjs/);
});
