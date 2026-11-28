// Assemble approved task commits on the recorded QA baseline in a new local ref.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const shaPattern = /^[0-9a-f]{40}$/;
const taskPattern = /^[A-Z][A-Z0-9-]{1,63}$/;
const branchPattern = /^integration\/[a-zA-Z0-9_/-]+$/;

function git(args, context = 'Git operation') {
  const result = spawnSync('git', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
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


function findDeployedTask(candidate, taskId) {
  const matches = git([
    'log', '--format=%H', '--fixed-strings', '--grep=Task-ID: ' + taskId, candidate
  ], taskId + ' deployed-task history').trim().split(/\r?\n/).filter(Boolean);
  for (const commitSha of matches) {
    const message = git(['show', '-s', '--format=%B', commitSha], taskId + ' deployment provenance');
    if (!message.startsWith('Integrate ' + taskId + ' into integration/')) continue;
    const lines = new Set(message.split(/\r?\n/).map(line => line.trim()));
    if (!lines.has('Task-ID: ' + taskId)) continue;
    const baseLine = [...lines].find(line => line.startsWith('Task-PR-Merge-Base-SHA: '));
    const headLine = [...lines].find(line => line.startsWith('Task-PR-Head-SHA: '));
    const prMergeBase = baseLine?.slice('Task-PR-Merge-Base-SHA: '.length);
    const head = headLine?.slice('Task-PR-Head-SHA: '.length);
    if (!shaPattern.test(prMergeBase ?? '') || !shaPattern.test(head ?? '')) {
      throw new Error(taskId + ' has incomplete prior deployment provenance in QA history; candidate assembly stopped.');
    }
    return { commit: commitSha, prMergeBase, head };
  }
  return null;
}

function ensureCommitAvailable(sha, label) {
  if (!shaPattern.test(sha ?? '')) throw new Error(label + ' is not a full commit SHA.');
  const existing = spawnSync('git', ['cat-file', '-e', sha + '^{commit}'], {
    encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024
  });
  if (existing.status !== 0 || existing.error) {
    git(['fetch', '--quiet', '--no-tags', 'origin', sha], label + ' fetch');
  }
  return commit(sha, label);
}

function isAncestorCommit(base, head, label) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', base, head], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  const detail = String(result.stderr || result.error?.message || 'unknown Git error')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ' ')
    .trim().slice(0, 1000);
  throw new Error(label + ' failed.' + (detail ? '\n' + detail : ''));
}


// The merge base is explicit: source history before it is outside this task.
// Merge trees without checking out files or writing the user's index.
function applyTaskDelta(candidate, patchBase, taskHead, approvedPaths, task) {
  const incrementalPaths = changedPaths(patchBase, taskHead);
  const approved = new Set(approvedPaths);
  const unapproved = incrementalPaths.filter(path => !approved.has(path));
  if (unapproved.length) {
    throw new Error(task.id + ' incremental delta includes paths outside its approved PR diff: ' +
      unapproved.map(path => JSON.stringify(path)).join(', ') +
      '. Reconcile the previously deployed head with the current approved PR before assembly.');
  }

  const result = spawnSync('git', [
    '-c', 'merge.renames=true', '-c', 'merge.directoryRenames=conflict',
    'merge-tree', '--write-tree', '--messages', '-z',
    '--merge-base=' + patchBase, candidate, taskHead
  ], { encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error(task.id + ' tree merge could not run: ' +
      String(result.error?.message || result.stderr || 'Git exit ' + result.status).trim());
  }
  const fields = result.stdout.split('\0');
  const [tree] = fields;
  const separator = fields.indexOf('', 1);
  if (!shaPattern.test(tree) || separator < 0) {
    throw new Error(task.id + ' returned an unexpected Git tree merge result.');
  }
  if (result.status === 1) {
    const baseStages = new Set(fields.slice(1, separator)
      .filter(stage => /^[0-7]{6} [0-9a-f]{40} 1\t/.test(stage))
      .map(stage => stage.slice(stage.indexOf('\t') + 1)));
    const conflicts = [];
    // After the unmerged stages, Git emits NUL-separated records containing
    // a path count, paths, a stable conflict type and a human-readable message.
    for (let i = separator + 1; i < fields.length - 1;) {
      const count = Number(fields[i++]);
      if (!Number.isSafeInteger(count) || count < 1 || i + count + 1 >= fields.length - 1) {
        throw new Error(task.id + ' returned malformed Git conflict details.');
      }
      const paths = fields.slice(i, i + count);
      i += count;
      let type = fields[i++];
      i++; // The localized human-readable message is redundant.
      // Git groups ordinary text conflicts and add/add under "contents".
      if (type === 'CONFLICT (contents)' && paths.length === 1 && !baseStages.has(paths[0])) {
        type = 'CONFLICT (add/add)';
      }
      if (type.startsWith('CONFLICT')) {
        conflicts.push(type + ' ' + paths.map(path => JSON.stringify(path)).join(', '));
      }
    }
    const dependencies = task.dependsOn ?? [];
    throw new Error(task.id + ' patch conflicts with candidate ' + candidate +
      ' (PR delta ' + patchBase + '..' + taskHead + ').\n' +
      'Resolve on the deployed QA baseline with approved prerequisite changes' +
      (dependencies.length ? ' (' + dependencies.join(', ') + ')' : '') +
      ', then register and approve the resolved head.\n' + (conflicts.join('\n') || 'Git reported an unclassified conflict.'));
  }
  return tree;
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
  }

  let candidate = baseline;
  let anyTaskChangedTree = false;
  for (const task of tasks) {
    const prMergeBase = prMergeBasesByTask.get(task.id);
    const previousTree = git(['rev-parse', candidate + '^{tree}'], task.id + ' previous candidate tree').trim();
    // QA candidates are single-parent commits, so the source PR head is not
    // necessarily in their ancestry. Prefer the immutable task trailers already
    // deployed in QA; when a PR advances, apply only the delta after that head.
    const priorDeployment = findDeployedTask(candidate, task.id);
    let patchBase = prMergeBase;
    let alreadyDeployed = false;
    if (priorDeployment) {
      if (priorDeployment.head === task.head || isAncestorCommit(task.head, candidate,
        task.id + ' current PR head in deployed QA history')) {
        alreadyDeployed = true;
      } else {
        ensureCommitAvailable(priorDeployment.head, task.id + ' previously deployed PR head');
        if (!isAncestorCommit(priorDeployment.head, task.head,
          task.id + ' current PR head must descend from its previously deployed head')) {
          throw new Error(task.id + ' was previously deployed at PR head ' + priorDeployment.head +
            ', but current head ' + task.head + ' does not descend from it. Refusing to reapply the full PR delta; ' +
            'restore the deployed head as an ancestor or register a new Task ID.');
        }
        patchBase = priorDeployment.head;
      }
    } else {
      alreadyDeployed = isAncestorCommit(task.head, candidate,
        task.id + ' legacy deployed-head ancestry');
    }
    const tree = alreadyDeployed
      ? git(['rev-parse', candidate + '^{tree}'], task.id + ' already-deployed QA tree').trim()
      : applyTaskDelta(candidate, patchBase, task.head, pathsByTask.get(task.id), task);
    if (!shaPattern.test(tree)) throw new Error(task.id + ' returned an unexpected merged tree.');
    const changed = changedPaths(candidate, tree);
    // Renames can redirect a clean Git merge to a path absent from the approved PR.
    const approvedPaths = new Set(pathsByTask.get(task.id));
    const outside = changed.filter(path => !approvedPaths.has(path));
    if (outside.length) {
      throw new Error(task.id + ' would change paths outside its approved PR diff: ' +
        outside.map(path => JSON.stringify(path)).join(', ') +
        '. Resolve against candidate ' + candidate + ' and approve the new path ownership.');
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
