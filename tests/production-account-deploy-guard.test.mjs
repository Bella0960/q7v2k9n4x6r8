import test from 'node:test';
import assert from 'node:assert/strict';
import { auditProductionAccountReadiness } from '../scripts/verify-production-account-readiness.mjs';

const example = () => ({
  production: {
    compatibility_date: '2026-10-27',
    compatibility_flags: ['nodejs_compat'],
    bindings: [
      { name: 'ASSETS', type: 'assets' },
      { name: 'CLOUD_DB', type: 'durable_object_namespace', class_name: 'CloudDatabase', namespace_id: 'production_unique_id' }
    ]
  },
  preview: {
    bindings: [{ name: 'CLOUD_DB', type: 'durable_object_namespace', namespace_id: 'preview_unique_id' }]
  },
  secrets: [
    { name: 'DEVICE_SECRET_PEPPER' },
    { name: 'MAO_SUPER_ADMIN_BOOTSTRAP_SECRET' }
  ],
  domains: [{ hostname: 'app.mao520.com', service: 'mao', environment: 'production', enabled: true }],
  hostname: 'app.mao520.com',
  online: { httpStatus: 200, body: { configured: true, initialized: true } }
});

test('ready production only passes with distinct SQLite namespace and initialized 001', () => {
  assert.deepEqual(auditProductionAccountReadiness(example()), []);
});

test('current ASSETS-only production cannot ship account-gated app', () => {
  const data = example();
  data.production.bindings = [{ name: 'ASSETS', type: 'assets' }];
  data.production.compatibility_flags = [];
  data.secrets = [];
  data.online = { httpStatus: 404, body: {} };
  const errors = auditProductionAccountReadiness(data);
  assert.ok(errors.includes('PROD_CLOUD_DB_NOT_READY'));
  assert.ok(errors.includes('NODE_CRYPTO_COMPAT_MISSING'));
  assert.ok(errors.includes('PROD_SECRET_MISSING_DEVICE_SECRET_PEPPER'));
  assert.ok(errors.includes('PROD_SECRET_MISSING_MAO_SUPER_ADMIN_BOOTSTRAP_SECRET'));
  assert.ok(errors.includes('LIVE_ACCOUNT_STATUS_NOT_200'));
});

test('production must not accidentally point to preview admin/account database', () => {
  const data = example();
  data.production.bindings[1].namespace_id = data.preview.bindings[0].namespace_id;
  assert.ok(auditProductionAccountReadiness(data).includes('PRODUCTION_REUSES_PREVIEW_DATABASE'));
});

test('unknown preview DB binding cannot silently bypass isolation check', () => {
  const data = example();
  data.preview.bindings = [];
  assert.ok(auditProductionAccountReadiness(data).includes('PREVIEW_DB_ID_UNAVAILABLE'));
});

test('incorrect database class and missing namespace do not qualify as production-ready', () => {
  const data = example();
  data.production.bindings[1].class_name = 'SomeOtherClass';
  delete data.production.bindings[1].namespace_id;
  assert.ok(auditProductionAccountReadiness(data).includes('PROD_CLOUD_DB_NOT_READY'));
});

test('Node crypto runtime flag and date are both mandatory', () => {
  const data = example();
  data.production.compatibility_date = '2024-07-01';
  data.production.compatibility_flags = [];
  const errors = auditProductionAccountReadiness(data);
  assert.ok(errors.includes('NODE_CRYPTO_COMPAT_MISSING'));
  assert.ok(errors.includes('NODE_CRYPTO_COMPAT_DATE_TOO_OLD'));
});

test('configured but uninitialized production must not recreate a surprise founder', () => {
  const data = example();
  data.online.body.initialized = false;
  assert.ok(auditProductionAccountReadiness(data).includes('FOUNDER_001_NOT_INITIALIZED'));
});

test('failure or redirect of live readiness endpoint blocks production rollout', () => {
  for (const status of [302, 404, 429, 500, 503]) {
    const data = example();
    data.online = { httpStatus: status, body: {} };
    assert.ok(auditProductionAccountReadiness(data).includes('LIVE_ACCOUNT_STATUS_NOT_200'));
  }
});

test('secret binding names are required but no secret values are accessed', () => {
  const data = example();
  data.secrets = [{ name: 'DEVICE_SECRET_PEPPER' }];
  const errors = auditProductionAccountReadiness(data);
  assert.ok(errors.includes('PROD_SECRET_MISSING_MAO_SUPER_ADMIN_BOOTSTRAP_SECRET'));
});


test('production custom domain cannot point at an unrelated Worker', () => {
  const data = example();
  data.domains[0].service = 'curly-dream-324c';
  assert.ok(auditProductionAccountReadiness(data).includes('PRODUCTION_DOMAIN_TARGET_MISMATCH'));
});

test('missing or duplicate custom-domain assignment blocks risky production rollout', () => {
  const data = example();
  data.domains = [];
  assert.ok(auditProductionAccountReadiness(data).includes('PRODUCTION_DOMAIN_MAPPING_NOT_UNIQUE'));
  data.domains = [
    { hostname: 'app.mao520.com', service: 'mao', environment: 'production' },
    { hostname: 'app.mao520.com', service: 'mao', environment: 'production' }
  ];
  assert.ok(auditProductionAccountReadiness(data).includes('PRODUCTION_DOMAIN_MAPPING_NOT_UNIQUE'));
});

test('even the right script with a non-production route is blocked', () => {
  const data = example();
  data.domains[0].environment = 'preview';
  assert.ok(auditProductionAccountReadiness(data).includes('PRODUCTION_DOMAIN_TARGET_MISMATCH'));
});

test('disabled custom-domain record cannot count as a production mapping', () => {
  const data = example();
  data.domains[0].enabled = false;
  assert.ok(auditProductionAccountReadiness(data).includes('PRODUCTION_DOMAIN_TARGET_MISMATCH'));
});
