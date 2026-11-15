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
