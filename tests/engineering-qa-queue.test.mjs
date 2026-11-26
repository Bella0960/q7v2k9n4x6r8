import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTaskManifest,
  renderTaskManifest,
  replaceTaskManifest,
  pathSetFromPrFiles,
  evaluateTaskEvidence
} from '../scripts/engineering-qa-queue.mjs';

const sha = n => String(n).repeat(40).slice(0, 40);
const manifest = (overrides = {}) => ({
  version: 1,
  id: 'CHAT-FIX-001',
  status: 'submitted',
  base: sha(1),
  head: sha(2),
  risk: 'F2',
  requiredChecks: ['Node Tests', 'Vite Build'],
  ...overrides
});
const pr = (overrides = {}) => ({
  number: 10,
  state: 'open',
  draft: false,
  user: { login: 'author' },
  head: { sha: sha(2), ref: 'CHAT-FIX-001/fix', repo: { full_name: 'Bella0960/q7v2k9n4x6r8' } },
  base: { ref: 'main', repo: { full_name: 'Bella0960/q7v2k9n4x6r8' } },
  ...overrides
});
const reviews = [{ user: { login: 'reviewer' }, state: 'APPROVED', commit_id: sha(2), submitted_at: '2026-11-26T10:00:00Z' }];
const checkRuns = [
  { name: 'Node Tests', head_sha: sha(2), status: 'completed', conclusion: 'success', completed_at: '2026-11-26T10:00:00Z' },
  { name: 'Vite Build', head_sha: sha(2), status: 'completed', conclusion: 'success', completed_at: '2026-11-26T10:00:00Z' }
];
const status = { state: 'success', statuses: [] };

test('parses one valid machine-readable task manifest', () => {
  const body = 'Description\n\n' + renderTaskManifest(manifest());
  assert.deepEqual(parseTaskManifest(body), manifest());
});
test('rejects duplicate, malformed, unsafe, and incomplete task manifests', () => {
  const block = renderTaskManifest(manifest());
  assert.throws(() => parseTaskManifest(block + '\n' + block), /exactly one/);
  assert.throws(() => parseTaskManifest('<!-- MAOMAO_TASK_V1\nnope\n-->'), /valid JSON/);
  assert.throws(() => renderTaskManifest(manifest({ id: '../unsafe' })), /Invalid MAOMAO/);
  assert.throws(() => renderTaskManifest(manifest({ requiredChecks: [] })), /Invalid MAOMAO/);
  assert.throws(() => renderTaskManifest(manifest({ requiredChecks: ['Deploy Preview'] })), /exact GitHub/);
});
test('updates the existing registry block without duplicating it', () => {
  const original = 'Task summary\n\n' + renderTaskManifest(manifest());
  const updated = replaceTaskManifest(original, manifest({ head: sha(3) }));
  assert.equal((updated.match(/MAOMAO_TASK_V1/g) || []).length, 1);
  assert.equal(parseTaskManifest(updated).head, sha(3));
});
test('renamed PR paths include both old and new names for ownership comparison', () => {
  assert.deepEqual(pathSetFromPrFiles([
    { filename: 'chat/new.js', previous_filename: 'chat/old.js', status: 'renamed' },
    { filename: 'chat/detail.html', status: 'modified' }
  ]), ['chat/detail.html', 'chat/new.js', 'chat/old.js']);
  assert.throws(() => pathSetFromPrFiles([{ filename: '../outside.js' }]), /unsafe path/);
});
test('ready evidence requires current-head approval and every named test/build check', () => {
  const result = evaluateTaskEvidence({ pr: pr(), manifest: manifest(), reviews, checkRuns, status });
  assert.deepEqual(result, { ready: true, reasons: [] });
});
test('stale approvals, draft PRs, pending statuses, and failed checks block integration', () => {
  const cases = [
    { pr: pr({ draft: true }), reviews, checkRuns, status },
    { pr: pr(), reviews: [{ ...reviews[0], commit_id: sha(3) }], checkRuns, status },
    { pr: pr(), reviews, checkRuns, status: { state: 'pending', statuses: [] } },
    { pr: pr(), reviews, checkRuns: [{ ...checkRuns[0], conclusion: 'failure' }, checkRuns[1]], status },
    { pr: pr(), reviews, checkRuns: [checkRuns[0]], status }
  ];
  for (const item of cases) {
    assert.equal(evaluateTaskEvidence({ manifest: manifest(), ...item }).ready, false);
  }
});
test('a latest change-request review blocks an older approval', () => {
  const result = evaluateTaskEvidence({
    pr: pr(),
    manifest: manifest(),
    reviews: [
      ...reviews,
      { user: { login: 'reviewer' }, state: 'CHANGES_REQUESTED', commit_id: sha(2), submitted_at: '2026-11-26T11:00:00Z' }
    ],
    checkRuns,
    status
  });
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some(reason => reason.includes('requested changes')));
});
test('only required check contexts that actually passed count as evidence', () => {
  const result = evaluateTaskEvidence({
    pr: pr(),
    manifest: manifest(),
    reviews,
    checkRuns: [],
    status: { state: 'success', statuses: [{ context: 'Node Tests', state: 'success' }, { context: 'Vite Build', state: 'success' }] }
  });
  assert.equal(result.ready, true);
});
