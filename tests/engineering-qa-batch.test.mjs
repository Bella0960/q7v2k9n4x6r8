import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orderReadyTasks } from '../scripts/engineering-qa-batch.mjs';

const script = fileURLToPath(new URL('../scripts/engineering-qa-batch.mjs', import.meta.url));

test('assembles separate ready tasks into an isolated create-only batch', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'maomao-qa-batch-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = (bin, args) => execFileSync(bin, args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const git = (...args) => run('git', args);
  const write = (path, contents) => writeFileSync(join(cwd, path), contents);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'QA Test');
  git('config', 'user.email', 'qa@example.invalid');
  write('baseline.txt', 'existing QA');
  git('add', 'baseline.txt');
  git('commit', '-qm', 'Baseline');
  const baseline = git('rev-parse', 'HEAD');
  mkdirSync(join(cwd, 'records'));

  function task(id, file) {
    git('switch', '-qc', id.toLowerCase(), baseline);
    write(file, id);
    git('add', file);
    git('commit', '-qm', id);
    return { id, status: 'ready', base: baseline, head: git('rev-parse', 'HEAD'), paths: [file] };
  }

  const first = { ...task('TASK-01', 'one.txt'), dependsOn: [] };
  const second = { ...task('TASK-02', 'two.txt'), dependsOn: ['TASK-01'] };
  write('records/first.json', JSON.stringify(first));
  write('records/second.json', JSON.stringify(second));
  write('records/pending.json', JSON.stringify({ id: 'TASK-03', status: 'in-progress' }));
  git('switch', '-q', 'main');
  write('baseline.txt', 'unsaved work');
  const qaSourceReceipt = {
    repository: 'Bella0960/web-runtime-lab',
    workflow: '.github/workflows/reusable-qa-request.yml',
    runId: 45785677703,
    runNumber: 91,
    runHeadSha: '9'.repeat(40),
    sourceSha: baseline,
    releasedAt: '2026-11-26T09:02:40Z'
  };
  const receiptJson = JSON.stringify(qaSourceReceipt);
  const release = name => spawnSync(process.execPath, [
    script, 'records', baseline, 'integration/' + name, receiptJson
  ], { cwd, encoding: 'utf8' });

  const assembled = release('batch-01');
  assert.equal(assembled.status, 0, assembled.stderr);
  const receipt = JSON.parse(assembled.stdout);
  assert.equal(receipt.candidate, git('rev-parse', 'integration/batch-01'));
  assert.deepEqual(receipt.qaSourceReceipt, qaSourceReceipt);
  const candidateMessage = git('show', '-s', '--format=%B', receipt.candidate);
  assert.ok(candidateMessage.includes('QA-Source-SHA: ' + baseline));
  assert.ok(candidateMessage.includes('QA-Release-Run: ' + qaSourceReceipt.runId));
  assert.match(candidateMessage, /\n\nQA-Source-SHA: [0-9a-f]{40}\nQA-Release-Run: \d+\nQA-Release-Request-SHA: [0-9a-f]{40}/);
  assert.deepEqual(receipt.tasks, [
    { id: 'TASK-01', base: baseline, head: first.head, dependsOn: [], paths: ['one.txt'] },
    { id: 'TASK-02', base: baseline, head: second.head, dependsOn: ['TASK-01'], paths: ['two.txt'] }
  ]);
  assert.equal(git('show', receipt.candidate + ':one.txt'), first.id);
  assert.equal(git('show', receipt.candidate + ':two.txt'), second.id);
  assert.equal(git('show', receipt.candidate + ':baseline.txt'), 'existing QA');
  assert.equal(git('rev-parse', 'HEAD'), baseline);
  assert.match(git('diff', '--', 'baseline.txt'), /unsaved work/);
  assert.equal(release('batch-01').status, 1);
  assert.equal(git('rev-parse', 'integration/batch-01'), receipt.candidate);

  write('records/second.json', JSON.stringify({ ...first, id: 'TASK-02' }));
  assert.match(release('conflict').stderr, /both own "one.txt"/);
  assert.equal(git('branch', '--list', 'integration/conflict'), '');
});


test('reports file-directory merge conflicts and preserves all refs', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'maomao-qa-batch-conflict-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = (bin, args) => execFileSync(bin, args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const git = (...args) => run('git', args);
  const write = (path, contents) => writeFileSync(join(cwd, path), contents);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'QA Test');
  git('config', 'user.email', 'qa@example.invalid');
  write('baseline.txt', 'existing QA');
  git('add', 'baseline.txt');
  git('commit', '-qm', 'Baseline');
  const baseline = git('rev-parse', 'HEAD');
  mkdirSync(join(cwd, 'records'));

  git('switch', '-qc', 'task-01', baseline);
  write('collision', 'file');
  git('add', '-A');
  git('commit', '-qm', 'File path');
  const first = {
    id: 'TASK-01', status: 'ready', base: baseline,
    head: git('rev-parse', 'HEAD'), paths: ['collision']
  };

  git('switch', '-qc', 'task-02', baseline);
  mkdirSync(join(cwd, 'collision'));
  write('collision/child.txt', 'nested file');
  git('add', '-A');
  git('commit', '-qm', 'Directory path');
  const second = {
    id: 'TASK-02', status: 'ready', base: baseline,
    head: git('rev-parse', 'HEAD'), paths: ['collision/child.txt']
  };

  write('records/first.json', JSON.stringify(first));
  write('records/second.json', JSON.stringify(second));
  git('switch', '-q', 'main');
  const qaSourceReceipt = {
    repository: 'Bella0960/web-runtime-lab', workflow: '.github/workflows/reusable-qa-request.yml',
    runId: 45785677703, runNumber: 91, runHeadSha: '9'.repeat(40),
    sourceSha: baseline, releasedAt: '2026-11-26T09:02:40Z'
  };
  const result = spawnSync(process.execPath, [script, 'records', baseline, 'integration/conflict', JSON.stringify(qaSourceReceipt)],
    { cwd, encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CONFLICT \(file\/directory\)/);
  assert.match(result.stderr, /collision/);
  assert.equal(git('branch', '--list', 'integration/conflict'), '');
  assert.equal(git('rev-parse', 'HEAD'), baseline);
});


test('orders dependent tasks before their dependants regardless of Task ID', () => {
  const tasks = [
    { id: 'TASK-02', dependsOn: ['TASK-10'] },
    { id: 'TASK-10', dependsOn: [] },
    { id: 'TASK-03', dependsOn: ['TASK-02'] }
  ];
  assert.deepEqual(orderReadyTasks(tasks).map(task => task.id), ['TASK-10', 'TASK-02', 'TASK-03']);
});
test('rejects missing dependencies and dependency cycles before candidate creation', () => {
  assert.throws(() => orderReadyTasks([{ id: 'TASK-01', dependsOn: ['TASK-02'] }]), /not ready/);
  assert.throws(() => orderReadyTasks([
    { id: 'TASK-01', dependsOn: ['TASK-02'] },
    { id: 'TASK-02', dependsOn: ['TASK-01'] }
  ]), /cycle/);
});


test('requires an exact successful QA source receipt before creating a candidate', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'maomao-qa-batch-receipt-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = (bin, args) => execFileSync(bin, args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const git = (...args) => run('git', args);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'QA Test');
  git('config', 'user.email', 'qa@example.invalid');
  writeFileSync(join(cwd, 'baseline.txt'), 'deployed QA');
  git('add', 'baseline.txt');
  git('commit', '-qm', 'Baseline');
  const baseline = git('rev-parse', 'HEAD');
  mkdirSync(join(cwd, 'records'));
  git('switch', '-qc', 'task-01', baseline);
  writeFileSync(join(cwd, 'task.txt'), 'task');
  git('add', 'task.txt');
  git('commit', '-qm', 'Task');
  const task = { id: 'TASK-01', status: 'ready', base: baseline, head: git('rev-parse', 'HEAD'), paths: ['task.txt'] };
  writeFileSync(join(cwd, 'records/task.json'), JSON.stringify(task));
  git('switch', '-q', 'main');

  const missing = spawnSync(process.execPath, [script, 'records', baseline, 'integration/no-receipt'],
    { cwd, encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /verified-qa-source-receipt-json/i);
  assert.equal(git('branch', '--list', 'integration/no-receipt'), '');

  const mismatchedReceipt = {
    repository: 'Bella0960/web-runtime-lab',
    workflow: '.github/workflows/reusable-qa-request.yml',
    runId: 123, runNumber: 91, runHeadSha: '8'.repeat(40),
    sourceSha: '7'.repeat(40), releasedAt: '2026-11-26T09:02:40Z'
  };
  const mismatched = spawnSync(process.execPath, [
    script, 'records', baseline, 'integration/mismatch', JSON.stringify(mismatchedReceipt)
  ], { cwd, encoding: 'utf8' });
  assert.equal(mismatched.status, 1);
  assert.match(mismatched.stderr, /receipt matching the exact baseline SHA/i);
  assert.equal(git('branch', '--list', 'integration/mismatch'), '');
});
