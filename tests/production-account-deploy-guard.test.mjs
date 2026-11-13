import test from 'node:test';
import assert from 'node:assert/strict';
import { auditProductionAccountReadiness, auditCanonicalFounderEvidence } from '../scripts/verify-production-account-readiness.mjs';

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
    { name: 'MAO_SUPER_ADMIN_BOOTSTRAP_SECRET' },
    { name: 'MAO_CANONICAL_FOUNDER_ID' }
  ],
  domains: [{ hostname: 'app.mao520.com', service: 'mao', environment: 'production', enabled: true }],
  hostname: 'app.mao520.com',
  online: { httpStatus: 200, body: { configured: true, initialized: true } },
  namespaces: [
    { id: 'production_unique_id', name: 'mao_CloudDatabase', script: 'mao', class: 'CloudDatabase' },
    { id: 'preview_unique_id', name: 'mao-auth-preview_CloudDatabase', script: 'mao-auth-preview', class: 'CloudDatabase' }
  ]
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

test('historical branch QA namespace must not qualify as the production database', () => {
  const data = example();
  data.production.bindings[1].namespace_id = 'old_qa_id';
  data.namespaces.push({
    id: 'old_qa_id',
    name: 'mao_integration-account-001-current-main-20261111_CloudDatabase',
    script: 'mao',
    class: 'CloudDatabase'
  });
  assert.ok(auditProductionAccountReadiness(data).includes('PROD_NAMESPACE_NOT_CANONICAL'));
});

test('cross-Worker binding cannot pose as an independent production SQLite database', () => {
  const data = example();
  data.production.bindings[1].script_name = 'mao-auth-preview';
  assert.ok(auditProductionAccountReadiness(data).includes('PROD_CLOUD_DB_NOT_READY'));
});

test('unknown and mismatched inventories must block production rollout', () => {
  const absent = example();
  delete absent.namespaces;
  assert.ok(auditProductionAccountReadiness(absent).includes('PROD_NAMESPACE_INVENTORY_UNAVAILABLE'));
  const mismatch = example();
  mismatch.namespaces[1].script = 'mao';
  assert.ok(auditProductionAccountReadiness(mismatch).includes('PREVIEW_NAMESPACE_INVENTORY_MISMATCH'));
});

test('duplicate canonical namespace names fail closed, even when one ID matches', () => {
  const data = example();
  data.namespaces.push({
    id: 'other_production_id',
    name: 'mao_CloudDatabase',
    script: 'mao',
    class: 'CloudDatabase'
  });
  assert.ok(auditProductionAccountReadiness(data).includes('PROD_NAMESPACE_NOT_CANONICAL'));
});

test('production must expose a configured server-only canonical founder pin', () => {
  const data = example();
  data.secrets = data.secrets.filter(item => item.name !== 'MAO_CANONICAL_FOUNDER_ID');
  assert.ok(auditProductionAccountReadiness(data).includes('PROD_SECRET_MISSING_MAO_CANONICAL_FOUNDER_ID'));
});

test('database proof accepts only the exact original ID, role, status and creation timestamp', () => {
  const evidence = {
    expectedId: 'MAO-AAAAAAAAAAAA',
    expectedCreatedAt: 1794416935305,
    rows: [{ id: 'MAO-AAAAAAAAAAAA', role: 'super_admin', status: 'active', created_at: 1794416935305 }]
  };
  assert.deepEqual(auditCanonicalFounderEvidence(evidence), []);
  for (const change of [
    { rows: [{ ...evidence.rows[0], id: 'MAO-BBBBBBBBBBBB' }] },
    { rows: [{ ...evidence.rows[0], role: 'user' }] },
    { rows: [{ ...evidence.rows[0], created_at: 1794338978643 }] },
    { rows: [{ ...evidence.rows[0], status: 'revoked' }] },
    { rows: [] },
    { rows: [evidence.rows[0], evidence.rows[0]] }
  ]) {
    assert.ok(auditCanonicalFounderEvidence({ ...evidence, ...change }).includes('FOUNDER_ORIGIN_MISMATCH'));
  }
  assert.ok(auditCanonicalFounderEvidence({ ...evidence, expectedId: '' }).includes('FOUNDER_ORIGIN_PIN_INVALID'));
  assert.ok(auditCanonicalFounderEvidence({ ...evidence, expectedCreatedAt: 'NaN' }).includes('FOUNDER_ORIGIN_PIN_INVALID'));
});
