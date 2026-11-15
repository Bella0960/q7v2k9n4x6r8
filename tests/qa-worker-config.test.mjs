import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('QA Worker is isolated from production and never aliases old account preview', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.qa.jsonc', import.meta.url), 'utf8'));
  const expectedName = 'maomao-aw-qa-20261114';
  assert.equal(config.name, expectedName);
  assert.notEqual(config.name, 'mao');
  assert.notEqual(config.name, 'mao-auth-preview');
  assert.notEqual(config.name, 'curly-dream-324c');
  assert.equal(config.main, 'worker.js');
  assert.ok(config.compatibility_flags.includes('nodejs_compat'));
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.equal(config.assets.directory, './dist');
  assert.equal(config.assets.binding, 'ASSETS');
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.assets.html_handling, 'none');
  assert.deepEqual(config.durable_objects.bindings, [
    { name: 'CLOUD_DB', class_name: 'CloudDatabase' }
  ]);
  assert.deepEqual(config.migrations, [
    { tag: 'v1', new_sqlite_classes: ['CloudDatabase'] }
  ]);
  assert.ok(!('routes' in config), 'QA must never bind production routes');
  assert.ok(!('route' in config), 'QA must never bind a production route');
  assert.ok(!('zone_id' in config), 'QA must never attach a production zone');
  assert.ok(!(config.services || []).some(s => s.binding === 'MAO_IDENTITY_AUTHORITY'),
    'isolated QA must never delegate login to the production identity gateway');
  assert.equal(config.vars.MAO_IDENTITY_MODE, 'isolated_qa');
  assert.equal(config.vars.MAO_QA_ALLOWED_ORIGIN,
    'https://maomao-aw-qa-20261114.miamor520000.workers.dev');
  assert.ok(!('MAO_IDENTITY_AUTHORITY_MODE' in config.vars));
  assert.ok(!('MAO_IDENTITY_CANONICAL_ADMIN_REQUIRED' in config.vars));
  assert.deepEqual(config.triggers, { crons: ['*/5 * * * *'] },
    'isolated QA must keep its cloud autonomy Cron through redeploys');
  assert.equal(config.keep_vars, true);
  assert.equal(config.ai.binding, 'AI');
  assert.equal(config.vars.AUTONOMY_MODEL_BACKEND, 'workers_ai');
  assert.equal(config.vars.MAO_SOCIAL_ENABLED, 'true');
  assert.equal(config.vars.MAO_SOCIAL_CHAT_ENABLED, 'false');
  assert.equal(config.vars.MAO_SOCIAL_E2EE_ENABLED, 'true');
  assert.equal(config.vars.MAO_DELEGATED_ADMIN_MANAGEMENT_ENABLED, undefined,
    'isolated test accounts cannot proxy privileged production account management');
  const prod=JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url),'utf8'));
  assert.equal(prod.vars?.MAO_DELEGATED_ADMIN_MANAGEMENT_ENABLED, undefined,
    'never enable delegated QA management implicitly in production');
  assert.ok(!JSON.stringify(config).includes('MAO-OXHBDBWCOIHPBBYN'),
    'permanent founder account ID belongs in a secret, not public repository config');
  assert.ok(!('MAO_IDENTITY_BRIDGE_SECRET' in config.vars));
  assert.ok(!('MAO_EXPECTED_FOUNDER_ID' in config.vars));
});
