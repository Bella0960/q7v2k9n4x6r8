// Assemble approved task commits on the recorded QA baseline in a new local ref.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const shaPattern = /^[0-9a-f]{40}$/;
const taskPattern = /^[A-Z][A-Z0-9-]{1,63}$/;
const branchPattern = /^integration\/[a-zA-Z0-9_/-]+$/;

function git(args, context = 'Git operation') {
  const result = spawnSync('git', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0 || result.error) {
    throw new Error(context + ' failed (Git exit ' + (result.status ?? 'unknown') + ').');
  }
  return result.stdout;
}

function commit(sha, label) {
  if (typeof sha !== 'string' || !shaPattern.test(sha) ||
    git(['cat-file', '-t', sha], label).trim() !== 'commit') {
    throw new Error(label + ' must be a locally available full commit SHA.');
  }
  return sha;
}

function changedPaths(base, head) {
  return git(['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', base, head, '--'])
    .split('\0').filter(Boolean).sort();
}

function readReadyTasks(directory) {
  const records = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => JSON.parse(readFileSync(join(directory, entry.name), 'utf8')));
  const ids = new Set();
  for (const task of records) {
    if (typeof task?.id !== 'string' || !taskPattern.test(task.id) ||
      ids.has(task.id) || !['in-progress', 'blocked', 'ready'].includes(task.status)) {
      throw new Error('Task records must have unique task IDs and valid statuses.');
    }
    ids.add(task.id);
  }
  return records.filter(task => task.status === 'ready').sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

function assemble(directory, qaSha, branch) {
  if (!branchPattern.test(branch ?? '')) {
    throw new Error('Use a new integration/ branch for the batch.');
  }
  const ref = 'refs/heads/' + branch;
  git(['check-ref-format', ref], 'Candidate branch validation');
  const baseline = commit(qaSha, 'Deployed QA baseline');
  const tasks = readReadyTasks(directory);
  if (!tasks.length) throw new Error('No ready tasks to assemble.');

  const owners = new Map();
  for (const task of tasks) {
    const base = commit(task.base, task.id + ' base');
    const head = commit(task.head, task.id + ' head');
    git(['merge-base', '--is-ancestor', base, head], task.id + ' task ancestry');
    git(['merge-base', '--is-ancestor', base, baseline], task.id + ' reviewed base in deployed QA');
    const paths = changedPaths(base, head);
    if (!paths.length || !Array.isArray(task.paths) ||
      JSON.stringify([...task.paths].sort()) !== JSON.stringify(paths)) {
      throw new Error(task.id + ' changed paths differ from its approved ownership.');
    }
    for (const path of paths) {
      const owner = owners.get(path);
      if (owner) throw new Error(owner + ' and ' + task.id + ' both own ' + JSON.stringify(path) + '.');
      owners.set(path, task.id);
    }
  }

  let candidate = baseline;
  for (const task of tasks) {
    const tree = git(['merge-tree', '--write-tree', candidate, task.head], task.id + ' candidate merge').trim();
    if (!shaPattern.test(tree)) throw new Error(task.id + ' returned an unexpected merge tree.');
    const paths = changedPaths(candidate, tree);
    if (paths.some(path => owners.get(path) !== task.id)) {
      throw new Error(task.id + ' would change paths outside its approved ownership.');
    }
    if (!paths.length) continue;
    candidate = git(['-c', 'commit.gpgSign=false', 'commit-tree', tree, '-p', candidate, '-p', task.head,
      '-m', 'Integrate ' + task.id + ' into ' + branch], task.id + ' candidate commit').trim();
  }
  if (candidate === baseline) throw new Error('All ready changes are already in the QA baseline.');
  // A zero old value makes this a create-only update, including simultaneous runs.
  git(['update-ref', ref, candidate, '0'.repeat(40)], 'Create-only integration branch update');
  return { branch, baseline, candidate, tasks: tasks.map(({ id, head }) => ({ id, head })) };
}

try {
  const [directory, baseline, branch, ...extra] = process.argv.slice(2);
  if (!directory || !baseline || !branch || extra.length) {
    throw new Error('Usage: npm run eng:batch -- <task-directory> <deployed-qa-sha> <integration/branch>');
  }
  console.log(JSON.stringify(assemble(directory, baseline, branch), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
