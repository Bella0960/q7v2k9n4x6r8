import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const readJson = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const readText = path => readFileSync(new URL(path, root), 'utf8');

test('mao520.com uses original live Worker, with no new production namespace or account store', () => {
  const official = readJson('wrangler.production.jsonc');
  const oldAuthority = readJson('wrangler.preview.jsonc');
  assert.equal(official.name, 'mao-auth-preview');
  assert.equal(official.main, 'worker.js');
  assert.equal(official.keep_vars, true);
  assert.equal(official.assets.run_worker_first, true);
  assert.deepEqual(official.durable_objects, oldAuthority.durable_objects);
  assert.deepEqual(official.migrations, oldAuthority.migrations);
  assert.equal(official.vars?.MAO_IDENTITY_MODE, undefined);
  assert.equal(official.services, undefined);
});

test('app.mao520.com uses the ONE existing isolated QA Worker with test switch initially off', () => {
  const trial = readJson('wrangler.app.cutover.jsonc');
  const qa = readJson('wrangler.qa.jsonc');
  assert.equal(trial.name, 'curly-dream-324c');
  assert.equal(trial.main, 'worker-app-cutover.js');
  assert.equal(trial.keep_vars, true);
  assert.deepEqual(trial.services, [{
    binding: 'MAO_APP_BACKEND', service: qa.name
  }]);
  assert.equal(trial.vars.MAO_APP_CUTOVER_ENABLED, 'false');
  assert.equal(trial.durable_objects, undefined);
  assert.equal(qa.durable_objects.bindings[0].name, 'CLOUD_DB');
  assert.notEqual(qa.name, 'mao-auth-preview');
});

test('release workflow is manual only, deploys original official service and checks official root', () => {
  const workflow = readText('.github/workflows/deploy-cloudflare-worker.yml');
  assert.match(workflow, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+push:\s*$/m);
  assert.match(workflow, /MAOMAO_PRODUCTION_ORIGIN: https:\/\/mao520\.com/);
  assert.match(workflow, /deploy --config wrangler\.production\.jsonc --keep-vars/);
  assert.match(workflow, /node scripts\/verify-production-account-readiness\.mjs/);
  assert.match(workflow, /node tests\/production-official-auth-smoke\.browser\.mjs/);
  assert.doesNotMatch(workflow, /deploy --config wrangler\.app\.jsonc/);
});

test('trial cutover script cannot act on the official production hostname', () => {
  const adapter = readText('worker-app-cutover.js');
  assert.match(adapter, /TRIAL_HOST = 'app\.mao520\.com'/);
  assert.match(adapter, /url\.hostname !== TRIAL_HOST/);
  assert.match(adapter, /MAO_APP_CUTOVER_ENABLED !== 'true'/);
  assert.match(adapter, /env\.MAO_APP_BACKEND\.fetch\(request\)/);
});
