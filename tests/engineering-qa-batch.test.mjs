import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  assert.deepEqual(receipt.tasks.map(task => task.id), ['TASK-01', 'TASK-02']);
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
