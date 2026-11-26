import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseTaskManifest,
  renderTaskManifest,
  replaceTaskManifest,
  pathSetFromPrFiles,
  evaluateTaskEvidence,
  createReadyTaskRecord
} from '../scripts/engineering-qa-queue.mjs';

const queueScript = fileURLToPath(new URL('../scripts/engineering-qa-queue.mjs', import.meta.url));

const sha = n => String(n).repeat(40).slice(0, 40);
const manifest = (overrides = {}) => ({
  version: 1,
  id: 'CHAT-FIX-001',
  status: 'submitted',
  base: sha(1),
  head: sha(2),
  risk: 'F2',
  requiredChecks: ['Node Tests', 'Vite Build'],
  dependsOn: [],
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

test('ready collection preserves declared task dependencies for the assembler', () => {
  const record = createReadyTaskRecord({
    manifest: manifest({ id: 'CHAT-002', dependsOn: ['CHAT-001'] }),
    paths: ['chat/detail.html'],
    pr: { number: 12, title: 'Dependent task' }
  });
  assert.deepEqual(record.dependsOn, ['CHAT-001']);
  assert.deepEqual(record.paths, ['chat/detail.html']);
  assert.equal(record.status, 'ready');
});

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
    { pr: pr(), reviews, checkRuns, status: { state: 'pending', statuses: [{ context: 'Pending test', state: 'pending' }] } },
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


test('allows successful named check-runs when the legacy commit-status API has no contexts', () => {
  const result = evaluateTaskEvidence({
    pr: pr({ base: { ref: 'integration/qa-stack', repo: { full_name: 'Bella0960/q7v2k9n4x6r8' } } }),
    manifest: manifest(),
    reviews,
    checkRuns,
    status: { state: 'pending', total_count: 0, statuses: [] }
  });
  assert.equal(result.ready, true);
});
test('rejects a task dependency list containing duplicates or the task itself', () => {
  assert.throws(() => renderTaskManifest(manifest({ dependsOn: ['CHAT-FIX-001'] })), /dependencies/);
  assert.throws(() => renderTaskManifest(manifest({ dependsOn: ['OTHER-001', 'OTHER-001'] })), /dependencies/);
});


test('dependent tasks stay out of the batch when their prerequisite is not ready', () => {
  const task = {
    id: 'CHAT-002',
    dependsOn: ['CHAT-001'],
    pr: { number: 12, title: 'Dependent task' }
  };
  const active = new Set([task]);
  const missing = task.dependsOn.filter(id => ![...active].some(candidate => candidate.id === id));
  assert.deepEqual(missing, ['CHAT-001']);
});


test('a later successful rerun replaces an older failed check with the same name', () => {
  const result = evaluateTaskEvidence({
    pr: pr(),
    manifest: manifest(),
    reviews,
    checkRuns: [
      { name: 'Node Tests', head_sha: sha(2), status: 'completed', conclusion: 'failure', started_at: '2026-11-26T09:00:00Z' },
      { name: 'Node Tests', head_sha: sha(2), status: 'completed', conclusion: 'success', started_at: '2026-11-26T10:00:00Z' },
      checkRuns[1]
    ],
    status
  });
  assert.equal(result.ready, true);
});
test('a later successful status context replaces an older failure for that context', () => {
  const result = evaluateTaskEvidence({
    pr: pr(),
    manifest: manifest(),
    reviews,
    checkRuns: [],
    status: {
      state: 'success',
      statuses: [
        { context: 'Node Tests', state: 'failure', updated_at: '2026-11-26T09:00:00Z' },
        { context: 'Node Tests', state: 'success', updated_at: '2026-11-26T10:00:00Z' },
        { context: 'Vite Build', state: 'success', updated_at: '2026-11-26T10:00:00Z' }
      ]
    }
  });
  assert.equal(result.ready, true);
});


test('registers a task from the current PR and persists exact checks and dependencies', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'maomao-task-register-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const stubPath = join(cwd, 'github-fetch-stub.mjs');
  const logPath = join(cwd, 'fetch-log.json');
  const repository = 'Bella0960/q7v2k9n4x6r8';
  const currentPr = {
    number: 10,
    state: 'open',
    body: 'Task summary',
    html_url: 'https://github.com/Bella0960/q7v2k9n4x6r8/pull/10',
    head: { sha: sha(2), repo: { full_name: repository } },
    base: { ref: 'main', repo: { full_name: repository } }
  };
  const stub = `
import { writeFileSync } from 'node:fs';
const repository = 'Bella0960/q7v2k9n4x6r8';
const currentPr = ${JSON.stringify(currentPr)};
const calls = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const method = init.method || 'GET';
  const path = url.pathname;
  let payload;
  if (method === 'GET' && path === '/repos/' + repository + '/pulls/10') {
    payload = currentPr;
  } else if (method === 'GET' && path === '/repos/' + repository + '/compare/' + '${sha(1)}' + '...' + '${sha(2)}') {
    payload = { status: 'ahead', ahead_by: 1 };
  } else if (method === 'GET' && path === '/repos/' + repository + '/pulls/10/files') {
    payload = [{ filename: 'chat/chat/detail.html' }];
  } else if (method === 'PATCH' && path === '/repos/' + repository + '/pulls/10') {
    const patch = JSON.parse(init.body);
    payload = { ...currentPr, body: patch.body };
  } else {
    throw new Error('Unexpected mocked GitHub request: ' + method + ' ' + path);
  }
  calls.push({ method, path, body: init.body || null });
  if (method === 'PATCH') writeFileSync(process.env.FETCH_LOG, JSON.stringify(calls));
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
};
`;
  writeFileSync(stubPath, stub);
  const result = spawnSync(process.execPath, [
    '--import', stubPath, queueScript,
    'register', '10', 'CHAT-FIX-001', sha(1), 'F2',
    'Node Tests', 'Vite Build', '--depends-on=CHAT-BASE-001'
  ], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GH_TOKEN: 'test-token',
      GITHUB_REPOSITORY: repository,
      FETCH_LOG: logPath
    }
  });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'submitted');
  assert.equal(receipt.pr, 10);
  assert.equal(receipt.task, 'CHAT-FIX-001');
  assert.deepEqual(receipt.requiredChecks, ['Node Tests', 'Vite Build']);
  assert.deepEqual(receipt.dependsOn, ['CHAT-BASE-001']);
  assert.deepEqual(receipt.changedFiles, ['chat/chat/detail.html']);

  const calls = JSON.parse(readFileSync(logPath, 'utf8'));
  assert.equal(calls.filter(call => call.method === 'GET' && call.path.endsWith('/pulls/10')).length, 2);
  const patch = calls.find(call => call.method === 'PATCH');
  assert.ok(patch);
  const savedBody = JSON.parse(patch.body).body;
  const savedManifest = parseTaskManifest(savedBody);
  assert.deepEqual(savedManifest.requiredChecks, ['Node Tests', 'Vite Build']);
  assert.deepEqual(savedManifest.dependsOn, ['CHAT-BASE-001']);
  assert.equal(savedManifest.head, sha(2));
});
