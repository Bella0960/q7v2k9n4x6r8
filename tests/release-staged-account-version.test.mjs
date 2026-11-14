import test from 'node:test';
import assert from 'node:assert/strict';
import { auditStagedAccountVersion } from '../scripts/release/verify-staged-account-version.mjs';

const ACTIVE = '74bcc286-11b7-43fb-a09c-3f5d2e5310d8';
const CANDIDATE = '4a5aff67-c93e-4dae-add5-8541fbd0755a';
const PROBE = '6650e7be-3937-48fe-8d32-466d40dae643';
const nsId = 'de73581323904befa8640be3f63db9b0';
const secretNames = [
  'DEVICE_SECRET_PEPPER', 'MAO_SUPER_ADMIN_BOOTSTRAP_SECRET',
  'VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_SUBJECT',
  'AUTONOMY_LEASE_MS'
];
const version = id => ({
  id, main_module: 'worker.js', compatibility_flags: ['nodejs_compat'],
  assets: { config: { run_worker_first: true } },
  bindings: [
    { name: 'ASSETS', type: 'assets' },
    { name: 'CLOUD_DB', type: 'durable_object_namespace', namespace_id: nsId },
    ...secretNames.map(name => ({ name, type: 'secret_text' }))
  ]
});

function fixture() {
  return {
    deployments: { deployments: [{ versions: [{ version_id: ACTIVE, percentage: 100 }] }] },
    active: version(ACTIVE),
    candidate: version(CANDIDATE),
    candidateVersionId: CANDIDATE,
    expectedActiveVersionId: ACTIVE
  };
}

test('explicit complete candidate keeps original app, database and all live secrets', () => {
  assert.deepEqual(auditStagedAccountVersion(fixture()), []);
});

test('latest uploaded incomplete checkpoint probe can never become a release candidate', () => {
  const data = fixture();
  data.candidate = version(PROBE);
  data.candidateVersionId = PROBE;
  data.candidate.bindings = data.candidate.bindings.filter(b => b.name !== 'ASSETS');
  delete data.candidate.assets;
  assert.ok(auditStagedAccountVersion(data).includes('STAGED_APP_ASSETS_MISSING'));
});

test('explicit candidate cannot silently fall back to the newest upload', () => {
  const data = fixture();
  data.candidateVersionId = PROBE;
  assert.ok(auditStagedAccountVersion(data).includes('EXPLICIT_CANDIDATE_VERSION_REQUIRED'));
});

test('changing or losing the original database namespace blocks release', () => {
  for (const value of [null, 'another-namespace']) {
    const data = fixture();
    data.candidate.bindings[1].namespace_id = value;
    assert.ok(auditStagedAccountVersion(data).includes('STAGED_DATABASE_NAMESPACE_CHANGED'));
  }
});

test('missing original login, device or push secrets always blocks release', () => {
  for (const name of secretNames) {
    const data = fixture();
    data.candidate.bindings = data.candidate.bindings.filter(b => b.name !== name);
    assert.ok(auditStagedAccountVersion(data).includes('STAGED_SECRET_MISSING_' + name));
  }
});

test('staged worker must retain the public app assets and worker-first routing', () => {
  const data = fixture();
  data.candidate.assets.config.run_worker_first = false;
  assert.ok(auditStagedAccountVersion(data).includes('STAGED_APP_ASSETS_MISSING'));
});

test('split, missing or unexpectedly changed live deployment blocks release', () => {
  const data = fixture();
  data.deployments = { deployments: [{ versions: [
    { version_id: ACTIVE, percentage: 50 },
    { version_id: CANDIDATE, percentage: 50 }
  ] }] };
  assert.deepEqual(auditStagedAccountVersion(data), ['ACTIVE_DEPLOYMENT_UNAVAILABLE_OR_SPLIT']);
  data.deployments = fixture().deployments;
  data.expectedActiveVersionId = PROBE;
  assert.ok(auditStagedAccountVersion(data).includes('ACTIVE_DEPLOYMENT_CHANGED'));
});

test('matching live and candidate versions is not a staged release', () => {
  const data = fixture();
  data.candidate = version(ACTIVE);
  data.candidateVersionId = ACTIVE;
  assert.ok(auditStagedAccountVersion(data).includes('CANDIDATE_IS_ALREADY_LIVE'));
});

test('staged worker must retain node crypto and original entrypoint', () => {
  const data = fixture();
  data.candidate.compatibility_flags = [];
  data.candidate.main_module = 'other.js';
  assert.ok(auditStagedAccountVersion(data).includes('NODE_CRYPTO_COMPAT_MISSING'));
  assert.ok(auditStagedAccountVersion(data).includes('WORKER_ENTRYPOINT_MISMATCH'));
});
