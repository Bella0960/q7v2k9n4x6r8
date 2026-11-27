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
  const candidateHistory = git('log', '--format=%B', receipt.candidate);
  assert.ok(candidateMessage.includes('QA-Source-SHA: ' + baseline));
  assert.ok(candidateMessage.includes('QA-Release-Run: ' + qaSourceReceipt.runId));
  assert.match(candidateHistory, /\n\nTask-ID: TASK-01\nTask-PR-Merge-Base-SHA: [0-9a-f]{40}\nTask-PR-Head-SHA: [0-9a-f]{40}\nQA-Source-SHA: [0-9a-f]{40}\nQA-Release-Run: \d+\nQA-Release-Request-SHA: [0-9a-f]{40}/);
  assert.match(candidateHistory, /\n\nTask-ID: TASK-02\nTask-PR-Merge-Base-SHA: [0-9a-f]{40}\nTask-PR-Head-SHA: [0-9a-f]{40}\nQA-Source-SHA: [0-9a-f]{40}\nQA-Release-Run: \d+\nQA-Release-Request-SHA: [0-9a-f]{40}/);
  assert.equal(git('rev-list', '--parents', '-n', '1', receipt.candidate).trim().split(/\s+/).length, 2);
  assert.deepEqual(receipt.tasks, [
    { id: 'TASK-01', prMergeBase: baseline, head: first.head, dependsOn: [], paths: ['one.txt'] },
    { id: 'TASK-02', prMergeBase: baseline, head: second.head, dependsOn: ['TASK-01'], paths: ['two.txt'] }
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
  assert.match(result.stderr, /TASK-02 patch conflicts/);
  assert.match(result.stderr, /collision/);
  assert.equal(git('branch', '--list', 'integration/conflict'), '');
  assert.equal(git('rev-parse', 'HEAD'), baseline);
});



test('transplants only the PR delta onto a diverged QA baseline and preserves both sides', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'maomao-qa-batch-diverged-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = (bin, args) => execFileSync(bin, args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const git = (...args) => run('git', args);
  const write = (path, contents) => writeFileSync(join(cwd, path), contents);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'QA Test');
  git('config', 'user.email', 'qa@example.invalid');
  write('shared.txt', 'header\nslot-a\na1\na2\na3\na4\na5\na6\na7\nslot-b\nfooter\n');
  git('add', 'shared.txt');
  git('commit', '-qm', 'Common ancestor');
  const common = git('rev-parse', 'HEAD');

  git('switch', '-qc', 'source-main', common);
  write('shared.txt', 'header\nmain-a\na1\na2\na3\na4\na5\na6\na7\nslot-b\nfooter\n');
  write('main-only.txt', 'source main only');
  git('add', 'shared.txt', 'main-only.txt');
  git('commit', '-qm', 'Source main update');
  const prMergeBase = git('rev-parse', 'HEAD');

  write('shared.txt', 'header\nmain-a\na1\na2\na3\na4\na5\na6\na7\ntask-b\nfooter\n');
  write('task-only.txt', 'approved task content');
  git('add', 'shared.txt', 'task-only.txt');
  git('commit', '-qm', 'Approved task delta');
  const taskHead = git('rev-parse', 'HEAD');

  git('switch', '-qc', 'qa-deployed', common);
  write('shared.txt', 'header\nqa-a\na1\na2\na3\na4\na5\na6\na7\nslot-b\nfooter\n');
  write('deployed-only.txt', 'already deployed');
  git('add', 'shared.txt', 'deployed-only.txt');
  git('commit', '-qm', 'Deployed QA update');
  const qaBaseline = git('rev-parse', 'HEAD');

  mkdirSync(join(cwd, 'records'));
  write('records/task.json', JSON.stringify({
    id: 'GOV-006-P0-4',
    status: 'ready',
    prMergeBase,
    head: taskHead,
    paths: ['shared.txt', 'task-only.txt'],
    dependsOn: []
  }));
  git('switch', '-q', 'main');

  const qaSourceReceipt = {
    repository: 'Bella0960/web-runtime-lab',
    workflow: '.github/workflows/reusable-qa-request.yml',
    runId: 45785677703,
    runNumber: 91,
    runHeadSha: '9'.repeat(40),
    sourceSha: qaBaseline,
    releasedAt: '2026-11-26T09:02:40Z'
  };
  const result = spawnSync(process.execPath, [
    script, 'records', qaBaseline, 'integration/diverged-base', JSON.stringify(qaSourceReceipt)
  ], { cwd, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  const candidate = receipt.candidate;
  assert.equal(git('rev-parse', candidate + '^'), qaBaseline);
  assert.equal(git('show', candidate + ':shared.txt'), 'header\nqa-a\na1\na2\na3\na4\na5\na6\na7\ntask-b\nfooter');
  assert.equal(git('show', candidate + ':deployed-only.txt'), 'already deployed');
  assert.equal(git('show', candidate + ':task-only.txt'), 'approved task content');
  assert.notEqual(spawnSync('git', ['cat-file', '-e', candidate + ':main-only.txt'], { cwd }).status, 0);
  assert.deepEqual(receipt.tasks, [{
    id: 'GOV-006-P0-4',
    prMergeBase,
    head: taskHead,
    dependsOn: [],
    paths: ['shared.txt', 'task-only.txt']
  }]);
  const message = git('show', '-s', '--format=%B', candidate);
  assert.ok(message.includes('Task-PR-Merge-Base-SHA: ' + prMergeBase));
  assert.ok(message.includes('Task-PR-Head-SHA: ' + taskHead));
  assert.ok(message.includes('QA-Source-SHA: ' + qaBaseline));
});

test('uses single-parent QA provenance to skip an already deployed task after later QA edits', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'maomao-qa-batch-provenance-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = (bin, args) => execFileSync(bin, args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const git = (...args) => run('git', args);
  const write = (path, contents) => writeFileSync(join(cwd, path), contents);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'QA Test');
  git('config', 'user.email', 'qa@example.invalid');
  write('shared.txt', Array.from({ length: 12 }, (_, i) => 'line-' + (i + 1)).join('\n') + '\n');
  git('add', 'shared.txt');
  git('commit', '-qm', 'Common ancestor');
  const common = git('rev-parse', 'HEAD');

  git('switch', '-qc', 'task-one', common);
  write('shared.txt', ['task-one', ...Array.from({ length: 11 }, (_, i) => 'line-' + (i + 2))].join('\n') + '\n');
  git('add', 'shared.txt');
  git('commit', '-qm', 'Task one');
  const taskOneHead = git('rev-parse', 'HEAD');

  git('switch', '-qc', 'qa-deployed', common);
  write('deployed.txt', 'existing QA content');
  git('add', 'deployed.txt');
  git('commit', '-qm', 'Deployed QA baseline');
  const qaBaseline = git('rev-parse', 'HEAD');

  mkdirSync(join(cwd, 'records'));
  write('records/one.json', JSON.stringify({
    id: 'TASK-01', status: 'ready', prMergeBase: common,
    head: taskOneHead, paths: ['shared.txt'], dependsOn: []
  }));
  git('switch', '-q', 'main');

  const firstQaReceipt = {
    repository: 'Bella0960/web-runtime-lab',
    workflow: '.github/workflows/reusable-qa-request.yml',
    runId: 45785677703,
    runNumber: 91,
    runHeadSha: '9'.repeat(40),
    sourceSha: qaBaseline,
    releasedAt: '2026-11-26T09:02:40Z'
  };
  const first = spawnSync(process.execPath, [
    script, 'records', qaBaseline, 'integration/first-deploy', JSON.stringify(firstQaReceipt)
  ], { cwd, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  const firstCandidate = JSON.parse(first.stdout).candidate;
  assert.equal(git('rev-parse', firstCandidate + '^'), qaBaseline);
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', taskOneHead, firstCandidate], { cwd }).status, 1);

  // A later QA release edits the same file after the single-parent candidate.
  // Re-applying the original PR patch would now conflict.
  git('switch', '-q', 'integration/first-deploy');
  write('shared.txt', ['task-one', 'qa-later', ...Array.from({ length: 10 }, (_, i) => 'line-' + (i + 3))].join('\n') + '\n');
  git('add', 'shared.txt');
  git('commit', '-qm', 'Later QA edit to the same file');
  const laterQaBaseline = git('rev-parse', 'HEAD');

  git('switch', '-q', 'main');
  git('switch', '-qc', 'task-two', common);
  write('two.txt', 'new task');
  git('add', 'two.txt');
  git('commit', '-qm', 'Task two');
  const taskTwoHead = git('rev-parse', 'HEAD');
  git('switch', '-q', 'main');
  write('records/two.json', JSON.stringify({
    id: 'TASK-02', status: 'ready', prMergeBase: common,
    head: taskTwoHead, paths: ['two.txt'], dependsOn: []
  }));

  const secondQaReceipt = {
    ...firstQaReceipt,
    runId: 45785677704,
    runNumber: 92,
    runHeadSha: '8'.repeat(40),
    sourceSha: laterQaBaseline,
    releasedAt: '2026-11-27T00:00:00Z'
  };
  const second = spawnSync(process.execPath, [
    script, 'records', laterQaBaseline, 'integration/second-deploy', JSON.stringify(secondQaReceipt)
  ], { cwd, encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr);
  const candidate = JSON.parse(second.stdout).candidate;
  assert.equal(git('rev-parse', candidate + '^^'), laterQaBaseline);
  assert.equal(git('show', candidate + ':shared.txt'),
    ['task-one', 'qa-later', ...Array.from({ length: 10 }, (_, i) => 'line-' + (i + 3))].join('\n'));
  assert.equal(git('show', candidate + ':two.txt'), 'new task');
  assert.equal(git('show', candidate + ':deployed.txt'), 'existing QA content');
  const history = git('log', '--format=%B', laterQaBaseline + '..' + candidate);
  assert.ok(history.includes('Task-ID: TASK-01'));
  assert.ok(history.includes('Task-PR-Head-SHA: ' + taskOneHead));
  assert.ok(history.includes('Task-ID: TASK-02'));
  assert.ok(history.includes('Task-PR-Head-SHA: ' + taskTwoHead));
});

test('applies only commits added after a previously deployed PR head', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'maomao-qa-batch-incremental-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = (bin, args) => execFileSync(bin, args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const git = (...args) => run('git', args);
  const write = (path, contents) => writeFileSync(join(cwd, path), contents);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'QA Test');
  git('config', 'user.email', 'qa@example.invalid');
  write('shared.txt', Array.from({ length: 12 }, (_, i) => 'line-' + (i + 1)).join('\n') + '\n');
  git('add', 'shared.txt');
  git('commit', '-qm', 'Common ancestor');
  const common = git('rev-parse', 'HEAD');

  git('switch', '-qc', 'task-one', common);
  write('shared.txt', ['task-one', ...Array.from({ length: 11 }, (_, i) => 'line-' + (i + 2))].join('\n') + '\n');
  git('add', 'shared.txt');
  git('commit', '-qm', 'Task one');
  const firstTaskHead = git('rev-parse', 'HEAD');

  git('switch', '-qc', 'qa-deployed', common);
  write('deployed.txt', 'existing QA content');
  git('add', 'deployed.txt');
  git('commit', '-qm', 'Deployed QA baseline');
  const qaBaseline = git('rev-parse', 'HEAD');
  mkdirSync(join(cwd, 'records'));
  write('records/task.json', JSON.stringify({
    id: 'TASK-01', status: 'ready', prMergeBase: common,
    head: firstTaskHead, paths: ['shared.txt'], dependsOn: []
  }));
  git('switch', '-q', 'main');

  const qaReceipt = {
    repository: 'Bella0960/web-runtime-lab',
    workflow: '.github/workflows/reusable-qa-request.yml',
    runId: 45785677705,
    runNumber: 93,
    runHeadSha: '7'.repeat(40),
    sourceSha: qaBaseline,
    releasedAt: '2026-11-26T09:02:40Z'
  };
  const first = spawnSync(process.execPath, [
    script, 'records', qaBaseline, 'integration/incremental-first', JSON.stringify(qaReceipt)
  ], { cwd, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  const firstCandidate = JSON.parse(first.stdout).candidate;

  // QA later changes a nearby line in the already deployed file.
  git('switch', '-q', 'integration/incremental-first');
  write('shared.txt', ['task-one', 'qa-later', ...Array.from({ length: 10 }, (_, i) => 'line-' + (i + 3))].join('\n') + '\n');
  git('add', 'shared.txt');
  git('commit', '-qm', 'Later QA edit');
  const laterQaBaseline = git('rev-parse', 'HEAD');

  // The open PR advances from its deployed head with one new file.
  git('switch', '-q', 'task-one');
  write('incremental.txt', 'only the later PR commit');
  git('add', 'incremental.txt');
  git('commit', '-qm', 'Task one follow-up');
  const updatedTaskHead = git('rev-parse', 'HEAD');
  git('switch', '-q', 'main');
  write('records/task.json', JSON.stringify({
    id: 'TASK-01', status: 'ready', prMergeBase: common,
    head: updatedTaskHead, paths: ['incremental.txt', 'shared.txt'], dependsOn: []
  }));

  const nextReceipt = {
    ...qaReceipt,
    runId: 45785677706,
    runNumber: 94,
    runHeadSha: '6'.repeat(40),
    sourceSha: laterQaBaseline,
    releasedAt: '2026-11-27T00:01:00Z'
  };
  const second = spawnSync(process.execPath, [
    script, 'records', laterQaBaseline, 'integration/incremental-second', JSON.stringify(nextReceipt)
  ], { cwd, encoding: 'utf8' });
  assert.equal(second.status, 0, second.stderr);
  const candidate = JSON.parse(second.stdout).candidate;
  assert.equal(git('rev-parse', candidate + '^'), laterQaBaseline);
  assert.equal(git('show', candidate + ':shared.txt'),
    ['task-one', 'qa-later', ...Array.from({ length: 10 }, (_, i) => 'line-' + (i + 3))].join('\n'));
  assert.equal(git('show', candidate + ':incremental.txt'), 'only the later PR commit');
  const message = git('show', '-s', '--format=%B', candidate);
  assert.ok(message.includes('Task-PR-Merge-Base-SHA: ' + common));
  assert.ok(message.includes('Task-PR-Head-SHA: ' + updatedTaskHead));
  assert.notEqual(firstCandidate, candidate);
});

test('blocks a conflicting PR delta against deployed QA without creating a candidate ref', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'maomao-qa-batch-delta-conflict-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const run = (bin, args) => execFileSync(bin, args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  const git = (...args) => run('git', args);
  const write = (path, contents) => writeFileSync(join(cwd, path), contents);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'QA Test');
  git('config', 'user.email', 'qa@example.invalid');
  write('shared.txt', 'base value\n');
  git('add', 'shared.txt');
  git('commit', '-qm', 'Common ancestor');
  const common = git('rev-parse', 'HEAD');

  git('switch', '-qc', 'source-main', common);
  write('shared.txt', 'task value\n');
  git('add', 'shared.txt');
  git('commit', '-qm', 'Task changes shared line');
  const taskHead = git('rev-parse', 'HEAD');
  const prMergeBase = common;

  git('switch', '-qc', 'qa-deployed', common);
  write('shared.txt', 'QA value\n');
  git('add', 'shared.txt');
  git('commit', '-qm', 'QA changes same line');
  const qaBaseline = git('rev-parse', 'HEAD');

  mkdirSync(join(cwd, 'records'));
  write('records/task.json', JSON.stringify({
    id: 'GOV-006-P0-4',
    status: 'ready',
    prMergeBase,
    head: taskHead,
    paths: ['shared.txt'],
    dependsOn: []
  }));
  git('switch', '-q', 'main');

  const qaSourceReceipt = {
    repository: 'Bella0960/web-runtime-lab',
    workflow: '.github/workflows/reusable-qa-request.yml',
    runId: 45785677703,
    runNumber: 91,
    runHeadSha: '9'.repeat(40),
    sourceSha: qaBaseline,
    releasedAt: '2026-11-26T09:02:40Z'
  };
  const result = spawnSync(process.execPath, [
    script, 'records', qaBaseline, 'integration/conflicting-delta', JSON.stringify(qaSourceReceipt)
  ], { cwd, encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /GOV-006-P0-4 patch conflicts/);
  assert.match(result.stderr, /shared\.txt/);
  assert.equal(git('branch', '--list', 'integration/conflicting-delta'), '');
  assert.equal(git('rev-parse', 'HEAD'), common);
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
