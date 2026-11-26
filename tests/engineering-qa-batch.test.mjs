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

  const first = task('TASK-01', 'one.txt');
  const second = task('TASK-02', 'two.txt');
  write('records/first.json', JSON.stringify(first));
  write('records/second.json', JSON.stringify(second));
  write('records/pending.json', JSON.stringify({ id: 'TASK-03', status: 'in-progress' }));
  git('switch', '-q', 'main');
  write('baseline.txt', 'unsaved work');
  const release = name => spawnSync(process.execPath, [script, 'records', baseline, 'integration/' + name],
    { cwd, encoding: 'utf8' });

  const assembled = release('batch-01');
  assert.equal(assembled.status, 0, assembled.stderr);
  const receipt = JSON.parse(assembled.stdout);
  assert.equal(receipt.candidate, git('rev-parse', 'integration/batch-01'));
  assert.deepEqual(receipt.tasks, [
    { id: 'TASK-01', base: baseline, head: first.head, paths: ['one.txt'] },
    { id: 'TASK-02', base: baseline, head: second.head, paths: ['two.txt'] }
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
  const result = spawnSync(process.execPath, [script, 'records', baseline, 'integration/conflict'],
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
