import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const preview = JSON.parse(readFileSync(new URL('../wrangler.preview.jsonc', import.meta.url), 'utf8'));
function parseJsonc(source) {
  const withoutLineComments = source.replace(/^\\s*\\/\\/.*$/gm, '');
  return JSON.parse(withoutLineComments);
}

const production = parseJsonc(
  readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
);
const workflow = readFileSync(
  new URL('../.github/workflows/deploy-mao-auth-preview.yml', import.meta.url),
  'utf8'
);

test('preview uses a different Worker script name from production', () => {
  assert.notEqual(preview.name, production.name);
  assert.equal(preview.name, 'mao-auth-preview');
  assert.equal(preview.main, production.main);
  assert.equal(preview.workers_dev, true);
  assert.equal(preview.preview_urls, false);
});

test('preview owns its SQLite Durable Object binding and bootstrap migration', () => {
  assert.deepEqual(preview.durable_objects.bindings, [
    { name: 'CLOUD_DB', class_name: 'CloudDatabase' }
  ]);
  assert.deepEqual(preview.migrations, [
    { tag: 'v1', new_sqlite_classes: ['CloudDatabase'] }
  ]);
  assert.deepEqual(
    preview.durable_objects.bindings,
    production.durable_objects.bindings,
    'same class code is expected, but the different Worker name creates a separate Worker-owned namespace'
  );
});

test('preview has the same protected app asset behavior and no production routes or cron', () => {
  assert.deepEqual(preview.assets, production.assets);
  assert.equal(Object.hasOwn(preview, 'routes'), false);
  assert.equal(Object.hasOwn(preview, 'triggers'), false,
    'preview does not start scheduled autonomous activity or maintenance jobs');
});

test('preview workflow only deploys the account-auth branch with dedicated credentials', () => {
  assert.match(workflow, /branches:\s*\n\s*- feat\/mao-account-auth-foundation/);
  assert.match(workflow, /CLOUDFLARE_PREVIEW_API_TOKEN/);
  assert.doesNotMatch(workflow, /secrets\.CLOUDFLARE_API_TOKEN/,
    'the production deployment token must not be reused');
  assert.match(workflow, /MAO_PREVIEW_DEVICE_SECRET_PEPPER/);
  assert.match(workflow, /MAO_PREVIEW_SUPER_ADMIN_BOOTSTRAP_SECRET/);
  assert.match(workflow, /wrangler\.preview\.jsonc/);
  assert.doesNotMatch(workflow, /wrangler\.jsonc(?!\w)/,
    'the preview workflow must not deploy the production config');
});

test('preview secrets are validated before Wrangler deploy is called', () => {
  const validateIndex = workflow.indexOf('Validate isolated preview configuration');
  const deployIndex = workflow.indexOf('Deploy only the isolated preview Worker');
  assert.ok(validateIndex >= 0 && deployIndex > validateIndex);
  assert.match(workflow, /test "\$\{#MAO_PREVIEW_DEVICE_SECRET_PEPPER\}" -ge 32/);
  assert.match(workflow, /test "\$\{#MAO_PREVIEW_SUPER_ADMIN_BOOTSTRAP_SECRET\}" -ge 32/);
  assert.match(workflow, /MAO_SUPER_ADMIN_BOOTSTRAP_SECRET/);
});
