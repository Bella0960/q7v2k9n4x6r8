import test from 'node:test';
import assert from 'node:assert/strict';
import { auditProductionAccountReadiness, auditCanonicalFounderEvidence, auditBackupEvidence } from '../scripts/verify-production-account-readiness.mjs';

const example = () => ({
  production: {
    compatibility_date: '2026-10-27',
    compatibility_flags: ['nodejs_compat'],
    bindings: [
      { name: 'ASSETS', type: 'assets' },
      { name: 'CLOUD_DB', type: 'durable_object_namespace', class_name: 'CloudDatabase', namespace_id: 'production_unique_id' },
      { name: 'MAO_CANONICAL_FOUNDER_REQUIRED', type: 'plain_text', text: 'true' }
    ]
  },
  preview: {
    bindings: [{ name: 'CLOUD_DB', type: 'durable_object_namespace', namespace_id: 'preview_unique_id' }]
  },
  secrets: [
    { name: 'DEVICE_SECRET_PEPPER' },
    { name: 'MAO_SUPER_ADMIN_BOOTSTRAP_SECRET' },
    { name: 'MAO_CANONICAL_FOUNDER_ID' },
    { name: 'MAO_CANONICAL_FOUNDER_CREATED_AT' }
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

test('original founder database requires verified independent restorable backup before production', () => {
  const originalId = 'MAO-AAAAAAAAAAAA'; // Synthetic, not actual user data.
  const sourceNamespace = 'a'.repeat(32);
  const expectedCreatedAt = 1770000000000;
  const verified = {
    status: 'verified',
    schema_count: 77,
    table_count: 29,
    row_count: 56,
    content_digest: 'f'.repeat(64),
    verified_at: '2026-11-13T12:00:00.000Z',
    source_namespace: sourceNamespace,
    founder_id: originalId,
    founder_created_at: expectedCreatedAt
  };
  const audit = backup => auditBackupEvidence({
    backup, expectedId: originalId, expectedCreatedAt, sourceNamespace
  });
  assert.deepEqual(audit(verified), []);
  for (const invalid of [
    null,
    {...verified,status:'schema_only_not_recoverable'},
    {...verified,status:'copied_pending_independent_readback'},
    {...verified,content_digest:''},
    {...verified,verified_at:null},
    {...verified,row_count:0},
    {...verified,table_count:0}
  ]) {
    assert.ok(audit(invalid).includes('RESTORABLE_BACKUP_NOT_VERIFIED'));
  }
  for (const invalid of [
    {...verified,source_namespace:'b'.repeat(32)},
    {...verified,founder_id:'MAO-BBBBBBBBBBBB'},
    {...verified,founder_created_at:expectedCreatedAt-86400000}
  ]) {
    assert.ok(audit(invalid).includes('BACKUP_ORIGIN_MISMATCH'));
  }
});



test('production requires explicit strict founder enforcement, not just identity secret names', () => {
  for (const replacement of [null, {type:'plain_text',text:'false'}, {type:'plain_text',text:'TRUE'}, {type:'secret_text',text:'true'}]) {
    const data = example();
    data.production.bindings = data.production.bindings.filter(item => item.name !== 'MAO_CANONICAL_FOUNDER_REQUIRED');
    if (replacement) data.production.bindings.push({name:'MAO_CANONICAL_FOUNDER_REQUIRED', ...replacement});
    assert.ok(auditProductionAccountReadiness(data).includes('PROD_FOUNDER_GUARD_NOT_REQUIRED'));
  }
  const duplicate = example();
  duplicate.production.bindings.push({name:'MAO_CANONICAL_FOUNDER_REQUIRED',type:'plain_text',text:'true'});
  assert.ok(auditProductionAccountReadiness(duplicate).includes('PROD_FOUNDER_GUARD_NOT_REQUIRED'));
});

test('missing original creation-time secret blocks production even with correct founder ID', () => {
  const data = example();
  data.secrets = data.secrets.filter(item => item.name !== 'MAO_CANONICAL_FOUNDER_CREATED_AT');
  assert.ok(auditProductionAccountReadiness(data).includes('PROD_SECRET_MISSING_MAO_CANONICAL_FOUNDER_CREATED_AT'));
});

test('malformed or impossible restore verification dates cannot qualify as backup evidence', () => {
  const sourceNamespace = 'a'.repeat(32);
  const expectedId = 'MAO-AAAAAAAAAAAA';
  const expectedCreatedAt = 1770000000000;
  for (const verified_at of ['2026-11-13Tgarbage', '2026-02-30T12:00:00.000Z', '2026-13-01T12:00:00.000Z', '2026-11-13T25:00:00.000Z', {}, 1]) {
    const backup = {status:'verified',schema_count:77,table_count:29,row_count:56,content_digest:'f'.repeat(64),verified_at,source_namespace:sourceNamespace,founder_id:expectedId,founder_created_at:expectedCreatedAt};
    assert.ok(auditBackupEvidence({backup,expectedId,expectedCreatedAt,sourceNamespace}).includes('RESTORABLE_BACKUP_NOT_VERIFIED'));
  }
});
