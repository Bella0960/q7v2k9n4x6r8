import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditAccountStagingInfrastructure,
  CURRENT_LIVE_SCRIPT,
  LIVE_HOSTNAME
} from '../scripts/verify-account-staging-readiness.mjs';

function fixture() {
  return {
    staging: {
      compatibility_date: '2026-10-27',
      compatibility_flags: ['nodejs_compat'],
      bindings: [
        { name: 'ASSETS', type: 'assets' },
        { name: 'CLOUD_DB', type: 'durable_object_namespace', class_name: 'CloudDatabase', namespace_id: 'new_account_namespace' }
      ]
    },
    preview: {
      bindings: [
        { name: 'CLOUD_DB', type: 'durable_object_namespace', class_name: 'CloudDatabase', namespace_id: 'old_preview_namespace' }
      ]
    },
    secrets: [
      { name: 'DEVICE_SECRET_PEPPER', type: 'secret_text' },
      { name: 'MAO_SUPER_ADMIN_BOOTSTRAP_SECRET', type: 'secret_text' }
    ],
    subdomain: { enabled: true },
    domains: [{ hostname: LIVE_HOSTNAME, service: CURRENT_LIVE_SCRIPT, environment: 'production', enabled: true }],
    namespaces: [
      { id: 'new_account_namespace', name: 'mao_CloudDatabase', script: 'mao', class: 'CloudDatabase' },
      { id: 'old_preview_namespace', name: 'mao-auth-preview_CloudDatabase', script: 'mao-auth-preview', class: 'CloudDatabase' }
    ]
  };
}

test('isolated, fully configured staging is ready without touching the live site', () => {
  assert.deepEqual(auditAccountStagingInfrastructure(fixture()), []);
});

test('the current ASSETS-only mao Worker cannot stage accounts', () => {
  const input = fixture();
  input.staging.bindings = [{ name: 'ASSETS', type: 'assets' }];
  input.staging.compatibility_flags = [];
  input.secrets = [];
  const issues = auditAccountStagingInfrastructure(input);
  assert.ok(issues.includes('STAGING_SQLITE_BINDING_NOT_READY'));
  assert.ok(issues.includes('STAGING_NODE_CRYPTO_NOT_READY'));
  assert.ok(issues.includes('STAGING_SECRET_MISSING_DEVICE_SECRET_PEPPER'));
  assert.ok(issues.includes('STAGING_SECRET_MISSING_MAO_SUPER_ADMIN_BOOTSTRAP_SECRET'));
});

test('staging must not borrow the old auth-preview namespace', () => {
  const input = fixture();
  input.staging.bindings[1].namespace_id = input.preview.bindings[0].namespace_id;
  assert.ok(auditAccountStagingInfrastructure(input).includes('STAGING_REUSES_PREVIEW_NAMESPACE'));
});

test('cross-worker Durable Object binding is not an isolated SQLite namespace', () => {
  const input = fixture();
  input.staging.bindings[1].script_name = 'mao-auth-preview';
  assert.ok(auditAccountStagingInfrastructure(input).includes('STAGING_SQLITE_BINDING_NOT_READY'));
});

test('missing namespace identity or disabled workers.dev staging URL blocks readiness', () => {
  const input = fixture();
  delete input.preview.bindings[0].namespace_id;
  input.subdomain.enabled = false;
  const issues = auditAccountStagingInfrastructure(input);
  assert.ok(issues.includes('PREVIEW_NAMESPACE_UNAVAILABLE'));
  assert.ok(issues.includes('STAGING_WORKERS_DEV_DISABLED'));
});

test('staging audit fails if app.mao520.com was switched or disabled too early', () => {
  for (const mapping of [
    { hostname: LIVE_HOSTNAME, service: 'mao', environment: 'production', enabled: true },
    { hostname: LIVE_HOSTNAME, service: CURRENT_LIVE_SCRIPT, environment: 'production', enabled: false }
  ]) {
    const input = fixture();
    input.domains = [mapping];
    assert.ok(auditAccountStagingInfrastructure(input).includes('LIVE_DOMAIN_ALREADY_CHANGED_OR_DISABLED'));
  }
});

test('missing and duplicate production mappings cannot pass staging audit', () => {
  const input = fixture();
  input.domains = [];
  assert.ok(auditAccountStagingInfrastructure(input).includes('LIVE_DOMAIN_MAPPING_AMBIGUOUS'));
  input.domains = [fixture().domains[0], fixture().domains[0]];
  assert.ok(auditAccountStagingInfrastructure(input).includes('LIVE_DOMAIN_MAPPING_AMBIGUOUS'));
});

test('staging cannot point at historical branch-preview namespace even when its ID is different', () => {
  const input = fixture();
  input.staging.bindings[1].namespace_id = 'qa_branch_namespace';
  input.namespaces.push({
    id: 'qa_branch_namespace',
    name: 'mao_integration-account-001-current-main-20261111_CloudDatabase',
    script: 'mao',
    class: 'CloudDatabase'
  });
  assert.ok(auditAccountStagingInfrastructure(input).includes('STAGING_NAMESPACE_NOT_CANONICAL'));
});

test('missing inventory and misidentified preview namespace block readiness', () => {
  const missing = fixture();
  delete missing.namespaces;
  assert.ok(auditAccountStagingInfrastructure(missing).includes('STAGING_NAMESPACE_INVENTORY_UNAVAILABLE'));
  const mismatch = fixture();
  mismatch.namespaces[1].script = 'mao';
  assert.ok(auditAccountStagingInfrastructure(mismatch).includes('PREVIEW_NAMESPACE_INVENTORY_MISMATCH'));
});
