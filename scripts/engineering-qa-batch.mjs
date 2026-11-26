// Assemble approved task commits on the recorded QA baseline in a new local ref.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const shaPattern = /^[0-9a-f]{40}$/;
const taskPattern = /^[A-Z][A-Z0-9-]{1,63}$/;
const branchPattern = /^integration\/[a-zA-Z0-9_/-]+$/;

function git(args, context = 'Git operation', cwd = process.cwd()) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0 || result.error) {
    const detail = [result.stdout, result.stderr, result.error?.message]
      .filter(value => typeof value === 'string' && value.trim())
      .join('\n')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ' ')
      .trim()
      .slice(0, 1600);
    throw new Error(context + ' failed (Git exit ' + (result.status ?? 'unknown') + ').' +
      (detail ? '\n' + detail : ''));
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

function safePath(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') &&
    !path.includes('\0') && !path.split('/').some(part => !part || part === '.' || part === '..');
}

// Apply only the reviewed PR delta (PR merge-base -> PR head) to the deployed QA tree.
// A normal branch merge would also import every unrelated commit on the PR base
// side when the QA and source histories have diverged.
function applyTaskDelta(candidate, prMergeBase, taskHead, paths, taskId, tempRoot, index) {
  const patch = git([
    '--literal-pathspecs', 'diff', '--binary', '--full-index', '--no-renames',
    '--no-ext-diff', prMergeBase, taskHead, '--', ...paths
  ], taskId + ' approved PR delta');
  if (!patch) throw new Error(taskId + ' approved PR diff is empty.');

  const patchPath = join(tempRoot, 'task-' + index + '.patch');
  const worktreePath = join(tempRoot, 'worktree-' + index);
  writeFileSync(patchPath, patch, { flag: 'wx' });
  let worktreeAdded = false;
  try {
    git(['worktree', 'add', '--detach', worktreePath, candidate], taskId + ' temporary worktree');
    worktreeAdded = true;
    const applied = spawnSync('git', ['apply', '--3way', '--index', patchPath], {
      cwd: worktreePath,
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 16 * 1024 * 1024
    });
    if (applied.status !== 0 || applied.error) {
      const detail = [applied.stderr, applied.stdout, applied.error?.message]
        .filter(value => typeof value === 'string' && value.trim())
        .join('\n')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ' ')
        .trim()
        .slice(0, 1600);
      throw new Error(taskId + ' patch conflicts with the deployed QA baseline or an earlier batch task; candidate assembly stopped.' +
        (detail ? '\n' + detail : ''));
    }
    const tree = git(['write-tree'], taskId + ' merged index tree', worktreePath).trim();
    const changed = changedPaths(candidate, tree);
    if (changed.some(path => !paths.includes(path))) {
      throw new Error(taskId + ' patch changed a path outside its approved PR diff.');
    }
    return tree;
  } finally {
    if (worktreeAdded) {
      spawnSync('git', ['worktree', 'remove', '--force', worktreePath], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 30000
      });
    }
    rmSync(worktreePath, { recursive: true, force: true });
    spawnSync('git', ['worktree', 'prune'], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 30000
    });
  }
}

export function orderReadyTasks(tasks) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const ordered = [];
  const visiting = new Set();
  const visited = new Set();
  function visit(task) {
    if (visited.has(task.id)) return;
    if (visiting.has(task.id)) throw new Error('Task dependency cycle includes ' + task.id + '.');
    visiting.add(task.id);
    const dependencies = task.dependsOn ?? [];
    if (!Array.isArray(dependencies) || dependencies.some(id => !taskPattern.test(id) || id === task.id) ||
        new Set(dependencies).size !== dependencies.length) {
      throw new Error(task.id + ' has an invalid dependency list.');
    }
    for (const dependency of dependencies) {
      const parent = byId.get(dependency);
      if (!parent) throw new Error(task.id + ' depends on ' + dependency + ', which is not ready in this batch.');
      visit(parent);
    }
    visiting.delete(task.id);
    visited.add(task.id);
    ordered.push(task);
  }
  for (const task of [...tasks].sort((a, b) => a.id.localeCompare(b.id, 'en'))) visit(task);
  return ordered;
}

function readReadyTasks(directory) {
  const records = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => JSON.parse(readFileSync(join(directory, entry.name), 'utf8')));
  const ids = new Set();
  for (const task of records) {
    if (typeof task?.id !== 'string' || !taskPattern.test(task.id) ||
      ids.has(task.id) || !['in-progress', 'blocked', 'ready'].includes(task.status) ||
      (task.status === 'ready' && (!Array.isArray(task.paths) || task.paths.some(path => !safePath(path))))) {
      throw new Error('Task records must have unique task IDs and valid statuses.');
    }
    ids.add(task.id);
  }
  return orderReadyTasks(records.filter(task => task.status === 'ready'));
}

function validateQaSourceReceipt(receipt, baseline) {
  if (!receipt || receipt.repository !== 'Bella0960/web-runtime-lab' ||
      receipt.workflow !== '.github/workflows/reusable-qa-request.yml' ||
      !Number.isSafeInteger(receipt.runId) || receipt.runId < 1 ||
      !Number.isSafeInteger(receipt.runNumber) || receipt.runNumber < 1 ||
      !shaPattern.test(receipt.runHeadSha ?? '') ||
      receipt.sourceSha !== baseline ||
      typeof receipt.releasedAt !== 'string' || !Number.isFinite(Date.parse(receipt.releasedAt))) {
    throw new Error('Batch requires a verified latest successful QA source receipt matching the exact baseline SHA.');
  }
  return {
    repository: receipt.repository,
    workflow: receipt.workflow,
    runId: receipt.runId,
    runNumber: receipt.runNumber,
    runHeadSha: receipt.runHeadSha,
    sourceSha: receipt.sourceSha,
    releasedAt: receipt.releasedAt
  };
}

function assemble(directory, qaSha, branch, receipt) {
  if (!branchPattern.test(branch ?? '')) {
    throw new Error('Use a new integration/ branch for the batch.');
  }
  const ref = 'refs/heads/' + branch;
  git(['check-ref-format', ref], 'Candidate branch validation');
  const baseline = commit(qaSha, 'Deployed QA baseline');
  const qaSourceReceipt = validateQaSourceReceipt(receipt, baseline);
  const tasks = readReadyTasks(directory);
  if (!tasks.length) throw new Error('No ready tasks to assemble.');

  const owners = new Map();
  const pathsByTask = new Map();
  const prMergeBasesByTask = new Map();
  for (const task of tasks) {
    const prMergeBase = commit(task.prMergeBase ?? task.prBase ?? task.base, task.id + ' PR merge base');
    const head = commit(task.head, task.id + ' head');
    git(['merge-base', '--is-ancestor', prMergeBase, head], task.id + ' PR merge-base-to-head ancestry');
    const paths = changedPaths(prMergeBase, head);
    if (!paths.length || !Array.isArray(task.paths) ||
      JSON.stringify([...task.paths].sort()) !== JSON.stringify(paths)) {
      throw new Error(task.id + ' changed paths differ from its approved ownership.');
    }
    pathsByTask.set(task.id, paths);
    prMergeBasesByTask.set(task.id, prMergeBase);
    for (const path of paths) {
      const owner = owners.get(path);
      if (owner) throw new Error(owner + ' and ' + task.id + ' both own ' + JSON.stringify(path) + '.');
      owners.set(path, task.id);
    }
  }

  let candidate = baseline;
  let anyTaskChangedTree = false;
  const worktreeRoot = mkdtempSync(join(tmpdir(), 'maomao-qa-task-delta-'));
  try {
    for (let index = 0; index < tasks.length; index++) {
      const task = tasks[index];
      const prMergeBase = prMergeBasesByTask.get(task.id);
      const previousTree = git(['rev-parse', candidate + '^{tree}'], task.id + ' previous candidate tree').trim();
      // A PR head already in the deployed QA history is already integrated.
      // Do not re-apply its patch: git apply --3way treats an already-applied
      // hunk as a conflict. Still write a provenance-only commit when another
      // task contributes a real tree change.
      const alreadyDeployed = spawnSync('git', ['merge-base', '--is-ancestor', task.head, candidate], {
        encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024
      });
      if (alreadyDeployed.status !== 0 && alreadyDeployed.status !== 1) {
        throw new Error(task.id + ' already-deployed ancestry check failed: ' +
          String(alreadyDeployed.stderr || alreadyDeployed.error?.message || 'unknown Git error').slice(0, 1000));
      }
      const tree = alreadyDeployed.status === 0
        ? git(['rev-parse', candidate + '^{tree}'], task.id + ' already-deployed QA tree').trim()
        : applyTaskDelta(candidate, prMergeBase, task.head, pathsByTask.get(task.id),
          task.id, worktreeRoot, index);
      if (!shaPattern.test(tree)) throw new Error(task.id + ' returned an unexpected merged tree.');
      const changed = changedPaths(candidate, tree);
      if (changed.some(path => owners.get(path) !== task.id)) {
        throw new Error(task.id + ' would change paths outside its approved ownership.');
      }
      if (tree !== previousTree) anyTaskChangedTree = true;

      // Keep the candidate history rooted only in the deployed QA baseline.
      // PR provenance is recorded in immutable commit trailers, not as a merge
      // parent whose unrelated source-branch tree was intentionally not imported.
      const message = 'Integrate ' + task.id + ' into ' + branch + '\n\n' +
        'Task-ID: ' + task.id + '\n' +
        'Task-PR-Merge-Base-SHA: ' + prMergeBase + '\n' +
        'Task-PR-Head-SHA: ' + task.head + '\n' +
        'QA-Source-SHA: ' + qaSourceReceipt.sourceSha + '\n' +
        'QA-Release-Run: ' + qaSourceReceipt.runId + '\n' +
        'QA-Release-Request-SHA: ' + qaSourceReceipt.runHeadSha;
      candidate = git(['-c', 'commit.gpgSign=false', 'commit-tree', tree, '-p', candidate,
        '-m', message], task.id + ' candidate commit').trim();
    }
  } finally {
    rmSync(worktreeRoot, { recursive: true, force: true });
    spawnSync('git', ['worktree', 'prune'], { encoding: 'utf8', timeout: 30000 });
  }
  if (!anyTaskChangedTree) throw new Error('All ready task diffs are already present in the deployed QA baseline; no candidate was created.');
  // A zero old value makes this a create-only update, including simultaneous runs.
  git(['update-ref', ref, candidate, '0'.repeat(40)], 'Create-only integration branch update');
  return {
    branch,
    baseline,
    candidate,
    qaSourceReceipt,
    tasks: tasks.map(({ id, head, dependsOn }) => ({
      id,
      prMergeBase: prMergeBasesByTask.get(id),
      head,
      dependsOn: dependsOn ?? [],
      paths: pathsByTask.get(id)
    }))
  };
}

function main() {
  try {
    const [directory, baseline, branch, receiptJson, ...extra] = process.argv.slice(2);
    if (!directory || !baseline || !branch || !receiptJson || extra.length) {
      throw new Error('Usage: npm run eng:batch -- <task-directory> <deployed-qa-sha> <integration/branch> <verified-qa-source-receipt-json>');
    }
    let receipt;
    try { receipt = JSON.parse(receiptJson); }
    catch { throw new Error('QA source receipt argument must be valid JSON.'); }
    console.log(JSON.stringify(assemble(directory, baseline, branch, receipt), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
