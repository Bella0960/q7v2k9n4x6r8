#!/usr/bin/env node
// Shared PR-backed task registry and create-only QA batch handoff.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runConflictAudit } from './engineering-pr-conflicts.mjs';

const API = 'https://api.github.com';
const DEFAULT_REPO = 'Bella0960/q7v2k9n4x6r8';
const SHA = /^[0-9a-f]{40}$/;
const TASK_ID = /^[A-Z][A-Z0-9-]{1,63}$/;
const RISK = /^F[1-4]$/;
const CHECK_NAME = /(test|build|verify|gate|regression|browser|contract)/i;
const MARKER = /<!--\s*MAOMAO_TASK_V1\s*([\s\S]*?)-->/g;
const BATCH_SCRIPT = new URL('./engineering-qa-batch.mjs', import.meta.url);

function clean(value, max = 220) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}
function fail(message) { throw new Error(clean(message, 1200)); }

function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.version !== 1 || !TASK_ID.test(value.id ?? '') ||
      !['submitted', 'ready'].includes(value.status) ||
      !SHA.test(value.base ?? '') || !SHA.test(value.head ?? '') ||
      !RISK.test(value.risk ?? '') ||
      !Array.isArray(value.requiredChecks) || value.requiredChecks.length < 1 ||
      value.requiredChecks.length > 20 ||
      (value.dependsOn != null && !Array.isArray(value.dependsOn))) {
    fail('Invalid MAOMAO task manifest. Expected version 1, task ID, submitted status, full base/head SHAs, F1-F4 risk, and required check names.');
  }
  const checks = [...new Set(value.requiredChecks.map(x => clean(x, 120)))];
  if (checks.length !== value.requiredChecks.length ||
      checks.some(x => !x || !CHECK_NAME.test(x))) {
    fail('Every required check must be a unique, exact GitHub test/build/verify/browser check name.');
  }
  const dependencies = value.dependsOn ?? [];
  if (dependencies.length > 30 || dependencies.some(id => !TASK_ID.test(id) || id === value.id) ||
      new Set(dependencies).size !== dependencies.length) {
    fail('Task dependencies must be unique, valid Task IDs and cannot include the task itself.');
  }
  return {
    version: 1,
    id: value.id,
    status: value.status,
    base: value.base,
    head: value.head,
    risk: value.risk,
    requiredChecks: checks,
    dependsOn: [...new Set(value.dependsOn ?? [])]
  };
}

export function parseTaskManifest(body) {
  const matches = [...String(body ?? '').matchAll(new RegExp(MARKER.source, 'g'))];
  if (!matches.length) return null;
  if (matches.length !== 1) fail('PR must contain exactly one MAOMAO_TASK_V1 block.');
  let value;
  try { value = JSON.parse(matches[0][1].trim()); }
  catch { fail('PR MAOMAO_TASK_V1 block is not valid JSON.'); }
  return validateManifest(value);
}

export function renderTaskManifest(value) {
  const manifest = validateManifest(value);
  return '<!-- MAOMAO_TASK_V1\n' + JSON.stringify(manifest, null, 2) + '\n-->';
}

export function replaceTaskManifest(body, value) {
  const source = String(body ?? '');
  const matches = [...source.matchAll(new RegExp(MARKER.source, 'g'))];
  if (matches.length > 1) fail('PR contains duplicate MAOMAO_TASK_V1 blocks; repair it before registration.');
  const block = renderTaskManifest(value);
  if (!matches.length) return source.trimEnd() + '\n\n' + block + '\n';
  const match = matches[0];
  return source.slice(0, match.index) + block + source.slice(match.index + match[0].length);
}

export function pathSetFromPrFiles(files) {
  if (!Array.isArray(files)) fail('GitHub PR files response is invalid.');
  const paths = new Set();
  for (const file of files) {
    for (const raw of [file?.filename, file?.previous_filename]) {
      if (raw == null) continue;
      if (typeof raw !== 'string' || !raw || raw.startsWith('/') ||
          raw.split('/').some(part => !part || part === '.' || part === '..') ||
          raw.includes('\0')) fail('GitHub PR file list contains an unsafe path.');
      paths.add(raw);
    }
  }
  return [...paths].sort();
}

function latestReviews(reviews) {
  const latest = new Map();
  for (const review of reviews) {
    const login = review?.user?.login;
    if (typeof login !== 'string' || !login) continue;
    const old = latest.get(login);
    const time = Date.parse(review.submitted_at ?? '') || 0;
    const oldTime = Date.parse(old?.submitted_at ?? '') || 0;
    if (!old || time >= oldTime) latest.set(login, review);
  }
  return [...latest.values()];
}

function latestBy(items, key, timeKey) {
  const latest = new Map();
  for (const item of items) {
    const name = item?.[key];
    if (typeof name !== 'string' || !name) continue;
    const old = latest.get(name);
    const time = Date.parse(item?.[timeKey] ?? '') || 0;
    const oldTime = Date.parse(old?.[timeKey] ?? '') || 0;
    if (!old || time >= oldTime) latest.set(name, item);
  }
  return latest;
}

export function evaluateTaskEvidence({ pr, manifest, reviews = [], checkRuns = [], status = { state: 'pending', statuses: [] }, repository = DEFAULT_REPO }) {
  const reasons = [];
  if (pr?.state !== 'open') reasons.push('PR is not open');
  if (pr?.draft) reasons.push('PR is still draft');
  if (pr?.base?.ref !== 'main' && !/^(integration|qa)\//.test(pr?.base?.ref ?? '')) reasons.push('PR base must be main or an approved integration/qa branch');
  if (pr?.head?.repo?.full_name !== repository || pr?.base?.repo?.full_name !== repository) {
    reasons.push('PR head/base must both belong to the source repository');
  }
  if (pr?.head?.sha !== manifest?.head) reasons.push('registered head SHA is stale');
  if (!manifest || !['submitted', 'ready'].includes(manifest.status)) reasons.push('task is not submitted');
  const statusContexts = Array.isArray(status?.statuses) ? status.statuses : [];
  if (statusContexts.length && status?.state !== 'success') {
    reasons.push('combined commit status is ' + clean(status?.state ?? 'missing'));
  } else if (!statusContexts.length && !['pending', 'success'].includes(status?.state)) {
    reasons.push('combined commit status is ' + clean(status?.state ?? 'missing'));
  }

  const currentReviews = latestReviews(reviews).filter(review =>
    review.commit_id === pr?.head?.sha && review.user?.login !== pr?.user?.login);
  if (currentReviews.some(review => review.state === 'CHANGES_REQUESTED')) {
    reasons.push('a current-head reviewer requested changes');
  }
  if (!currentReviews.some(review => review.state === 'APPROVED')) {
    reasons.push('missing an approval on the exact current head from someone other than the PR author');
  }

  const currentChecks = checkRuns.filter(run => !run?.head_sha || run.head_sha === pr?.head?.sha);
  const latestChecks = latestBy(currentChecks, 'name', 'started_at');
  for (const run of latestChecks.values()) {
    if (run?.status !== 'completed') {
      reasons.push('check is not complete: ' + clean(run?.name ?? 'unnamed check'));
    } else if (!['success', 'neutral', 'skipped'].includes(run?.conclusion)) {
      reasons.push('check did not pass: ' + clean(run?.name ?? 'unnamed check') + ' (' + clean(run?.conclusion) + ')');
    }
  }

  const latestStatuses = latestBy(statusContexts, 'context', 'updated_at');
  for (const context of latestStatuses.values()) {
    if (context?.state !== 'success') {
      reasons.push('commit status is not successful: ' + clean(context?.context ?? 'unnamed status'));
    }
  }

  for (const required of manifest?.requiredChecks ?? []) {
    const check = latestChecks.get(required);
    const context = latestStatuses.get(required);
    const passed = (check?.status === 'completed' && check?.conclusion === 'success') ||
      context?.state === 'success';
    if (!passed) reasons.push('required check missing or not successful: ' + required);
  }
  return { ready: reasons.length === 0, reasons: [...new Set(reasons)] };
}

function git(args, context = 'Git operation', allowFailure = false) {
  const result = spawnSync('git', args, {
    encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  });
  if (result.status !== 0 || result.error) {
    if (allowFailure) return { ok: false, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    const detail = [result.stderr, result.error?.message].filter(Boolean).join('\n');
    fail(context + ' failed (Git exit ' + (result.status ?? 'unknown') + '). ' + detail);
  }
  return { ok: true, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
function gitText(args, context) { return git(args, context).stdout.trim(); }
function ensureCommit(sha, label) {
  if (!SHA.test(sha)) fail(label + ' is not a full 40-character SHA.');
  let check = git(['cat-file', '-e', sha + '^{commit}'], label + ' lookup', true);
  if (!check.ok) {
    git(['fetch', '--quiet', '--no-tags', 'origin', sha], label + ' fetch');
    check = git(['cat-file', '-e', sha + '^{commit}'], label + ' verification', true);
  }
  if (!check.ok) fail(label + ' is not available as a commit after fetch.');
}
function isAncestor(base, head, label) {
  const result = git(['merge-base', '--is-ancestor', base, head], label, true);
  if (!result.ok) fail(label + ': base is not an ancestor of head.');
}
function gitChangedPaths(base, head) {
  return git(['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', base, head, '--'],
    'Task path comparison').stdout.split('\0').filter(Boolean).sort();
}
function equalPaths(a, b) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

async function api(path, { method = 'GET', body } = {}) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) fail('Set GH_TOKEN or run inside GitHub Actions with GITHUB_TOKEN; the queue fails closed without authenticated API access.');
  const response = await fetch(API + path, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: 'Bearer ' + token,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'maomao-ready-task-registry',
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(25000)
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { fail('GitHub API returned invalid JSON for ' + path); }
  if (!response.ok) {
    const quota = response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0';
    fail('GitHub API ' + response.status + ' for ' + path + ': ' +
      (quota ? 'rate limit exhausted; use the authenticated repository workflow.' : clean(data.message ?? raw)));
  }
  return data;
}

async function pagedArray(path, key = null, limit = 3000) {
  const output = [];
  for (let page = 1; page <= Math.ceil(limit / 100); page++) {
    const separator = path.includes('?') ? '&' : '?';
    const data = await api(path + separator + 'per_page=100&page=' + page);
    const items = key ? data?.[key] : data;
    if (!Array.isArray(items)) fail('GitHub API returned an invalid paginated list for ' + path);
    output.push(...items);
    if (output.length > limit) fail('GitHub API result exceeded the safe pagination limit for ' + path);
    if (items.length < 100) return output;
  }
  fail('GitHub API pagination limit reached; refusing an incomplete task scan.');
}

async function getOpenPrs(repository) {
  return pagedArray('/repos/' + repository + '/pulls?state=open');
}
async function getPrFiles(repository, number) {
  const files = await pagedArray('/repos/' + repository + '/pulls/' + number + '/files');
  if (files.length >= 3000) fail('PR #' + number + ' reached GitHub’s 3,000-file API cap; ownership is incomplete.');
  return files;
}
async function getCheckRuns(repository, sha) {
  return pagedArray('/repos/' + repository + '/commits/' + sha + '/check-runs', 'check_runs');
}
async function fetchPrEvidence(repository, pr) {
  const [reviews, checkRuns, status, files] = await Promise.all([
    pagedArray('/repos/' + repository + '/pulls/' + pr.number + '/reviews'),
    getCheckRuns(repository, pr.head.sha),
    api('/repos/' + repository + '/commits/' + pr.head.sha + '/status'),
    getPrFiles(repository, pr.number)
  ]);
  if (!Array.isArray(status?.statuses) || status.total_count > status.statuses.length) {
    fail('PR #' + pr.number + ' commit-status list is incomplete.');
  }
  return { reviews, checkRuns, status, files };
}

function parseArgs(args) {
  const [baseline, ...flags] = args;
  if (!SHA.test(baseline ?? '')) fail('Usage: npm run eng:batch:auto -- <deployed-qa-source-sha> [--push]');
  if (flags.some(flag => flag !== '--push')) fail('Only --push is supported after the QA baseline SHA.');
  return { baseline, push: flags.includes('--push') };
}

async function registerTask(repository, args) {
  const [numberText, id, base, risk, ...requiredChecks] = args;
  const number = Number(numberText);
  if (!Number.isSafeInteger(number) || number < 1) fail('PR number must be a positive integer.');
  if (!TASK_ID.test(id ?? '') || !SHA.test(base ?? '') || !RISK.test(risk ?? '') || !requiredChecks.length) {
    fail('Usage: npm run eng:register -- <PR-number> <TASK-ID> <QA-baseline-SHA> <F1|F2|F3|F4> "<exact test check name>" [...] [--depends-on=TASK-ID,TASK-ID]');
  }
  const manifest = validateManifest({
    version: 1, id, status: 'submitted', base,
    head: '0'.repeat(40), risk, requiredChecks
  });
  const pr = existingPr;
  if (pr.state !== 'open' || pr.head?.repo?.full_name !== repository || pr.base?.repo?.full_name !== repository) {
    fail('Registration requires an open PR whose head and base both belong to ' + repository + '.');
  }
  manifest.head = pr.head.sha;
  if (!SHA.test(manifest.head)) fail('PR head SHA is not a full commit SHA.');
  const comparison = await api('/repos/' + repository + '/compare/' + base + '...' + manifest.head);
  if (comparison.status !== 'ahead' || !(comparison.ahead_by > 0)) {
    fail('The declared QA baseline must be an ancestor of the task head and the task must contain changes.');
  }
  const files = await getPrFiles(repository, number);
  if (!files.length) fail('Cannot register an empty PR.');
  const body = replaceTaskManifest(pr.body ?? '', manifest);
  const latest = await api('/repos/' + repository + '/pulls/' + number);
  if (latest.head?.sha !== manifest.head || latest.state !== 'open' ||
      latest.body !== pr.body || latest.base?.ref !== pr.base?.ref) {
    fail('PR body, base, or head changed during registration; no overwrite was made. Rerun eng:register.');
  }
  const updated = await api('/repos/' + repository + '/pulls/' + number, { method: 'PATCH', body: { body } });
  console.log(JSON.stringify({
    status: 'submitted',
    pr: number,
    url: updated.html_url,
    task: id,
    baseline: base,
    head: manifest.head,
    risk,
    requiredChecks: checks,
    dependsOn: manifest.dependsOn,
    changedFiles: pathSetFromPrFiles(files)
  }, null, 2));
}

function latestOpenPrMetadata(pr) {
  return {
    number: pr.number,
    title: clean(pr.title),
    url: pr.html_url,
    author: pr.user?.login,
    branch: pr.head?.ref,
    head: pr.head?.sha,
    baseBranch: pr.base?.ref
  };
}

async function collectReadyTasks(repository, baseline, pullRequests) {
  const registered = [];
  const blocked = [];
  for (const pr of pullRequests) {
    let manifest;
    try { manifest = parseTaskManifest(pr.body); }
    catch (error) {
      blocked.push({ ...latestOpenPrMetadata(pr), state: 'blocked', reasons: [clean(error.message)] });
      continue;
    }
    if (!manifest) continue;
    const evidence = await fetchPrEvidence(repository, pr);
    const latestPr = await api('/repos/' + repository + '/pulls/' + pr.number);
    if (latestPr.head?.sha !== pr.head?.sha || latestPr.state !== 'open' || latestPr.draft) {
      blocked.push({ ...latestOpenPrMetadata(pr), state: 'blocked', reasons: ['PR changed while the queue was collecting evidence; rerun the scan'] });
      continue;
    }
    const latestManifest = parseTaskManifest(latestPr.body ?? '');
    if (JSON.stringify(latestManifest) !== JSON.stringify(manifest)) {
      blocked.push({ ...latestOpenPrMetadata(pr), state: 'blocked', reasons: ['task manifest changed while the queue was collecting evidence; rerun registration and scan'] });
      continue;
    }
    const result = evaluateTaskEvidence({ pr: latestPr, manifest, ...evidence, repository });
    if (!result.ready) {
      blocked.push({ ...latestOpenPrMetadata(pr), state: 'blocked', reasons: result.reasons });
      continue;
    }
    try {
      ensureCommit(manifest.base, 'PR #' + pr.number + ' registered base');
      ensureCommit(manifest.head, 'PR #' + pr.number + ' registered head');
      ensureCommit(baseline, 'Current deployed QA baseline');
      isAncestor(manifest.base, manifest.head, 'PR #' + pr.number + ' task ancestry');
      isAncestor(manifest.base, baseline, 'PR #' + pr.number + ' base-to-QA ancestry');
      const apiPaths = pathSetFromPrFiles(evidence.files);
      const gitPaths = gitChangedPaths(manifest.base, manifest.head);
      if (!gitPaths.length || !equalPaths(apiPaths, gitPaths)) {
        fail('PR #' + pr.number + ' Git diff does not match the complete GitHub changed-file list.');
      }
      registered.push({
        id: manifest.id,
        status: 'ready',
        base: manifest.base,
        head: manifest.head,
        paths: gitPaths,
        pr: latestOpenPrMetadata(pr),
        risk: manifest.risk
      });
    } catch (error) {
      blocked.push({ ...latestOpenPrMetadata(pr), state: 'blocked', reasons: [clean(error.message)] });
    }
  }

  const idCounts = new Map();
  for (const task of registered) idCounts.set(task.id, (idCounts.get(task.id) ?? 0) + 1);
  const duplicateIds = new Set([...idCounts].filter(([, count]) => count > 1).map(([id]) => id));
  const active = new Set(registered.filter(task => !duplicateIds.has(task.id)));
  for (const task of registered.filter(task => duplicateIds.has(task.id))) {
    blocked.push({ ...task.pr, state: 'blocked', reasons: ['duplicate Task ID ' + task.id + ' appears in multiple open PRs'] });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of [...active]) {
      const missing = (task.dependsOn ?? []).filter(id => ![...active].some(candidate => candidate.id === id));
      if (missing.length) {
        active.delete(task);
        blocked.push({
          ...task.pr,
          state: 'blocked',
          reasons: ['dependency is not ready in this batch: ' + missing.join(', ')]
        });
        changed = true;
      }
    }
  }
  return { ready: [...active], blocked };
}

function remoteBranchExists(branch) {
  const result = git(['ls-remote', '--heads', 'origin', 'refs/heads/' + branch], 'Remote candidate preflight');
  return Boolean(result.stdout.trim());
}
function assertPushTarget(repository) {
  const url = gitText(['remote', 'get-url', 'origin'], 'Read origin remote');
  const normalized = url.replace(/\.git$/i, '')
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/');
  if (normalized.toLowerCase() !== ('https://github.com/' + repository).toLowerCase()) {
    fail('origin must point to https://github.com/' + repository + ' before candidate push.');
  }
}
function pushCandidate(repository, branch, candidate) {
  assertPushTarget(repository);
  if (remoteBranchExists(branch)) fail('Remote candidate branch already exists; refusing to overwrite it: ' + branch);
  git(['push', '--force-with-lease=refs/heads/' + branch + ':', 'origin', candidate + ':refs/heads/' + branch], 'Create-only candidate push');
  const pushed = gitText(['ls-remote', '--heads', 'origin', 'refs/heads/' + branch], 'Verify pushed candidate');
  const [sha] = pushed.split(/\s+/);
  if (sha !== candidate) fail('Remote candidate receipt does not match the assembled SHA.');
}

async function assembleReadyBatch(repository, baseline, { push = false } = {}) {
  if (!SHA.test(baseline ?? '')) fail('QA baseline must be a full 40-character SHA.');
  const branch = 'integration/qa-batch-' + baseline.slice(0, 12);
  const ref = 'refs/heads/' + branch;
  const localExists = git(['show-ref', '--verify', '--quiet', ref], 'Local candidate preflight', true).ok;
  if (localExists || remoteBranchExists(branch)) {
    fail('A batch candidate already exists for this QA baseline. It is immutable; finish that release before starting another batch.');
  }
  const pullRequests = await getOpenPrs(repository);
  const { ready, blocked } = await collectReadyTasks(repository, baseline, pullRequests);
  if (!ready.length) {
    return { status: 'no-ready-tasks', repository, baseline, discoveredOpenPrs: pullRequests.length, includedTasks: [], blocked };
  }

  const temp = mkdtempSync(join(tmpdir(), 'maomao-ready-prs-'));
  let candidate = null;
  try {
    for (let index = 0; index < ready.length; index++) {
      const task = ready[index];
      const record = { id: task.id, status: 'ready', base: task.base, head: task.head, paths: task.paths, dependsOn: task.dependsOn };
      writeFileSync(join(temp, String(index + 1).padStart(3, '0') + '.json'), JSON.stringify(record));
    }
    const result = spawnSync(process.execPath, [fileURLToPath(BATCH_SCRIPT), temp, baseline, branch], {
      encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    if (result.status !== 0 || result.error) {
      const detail = clean(result.stderr || result.error?.message || 'batch assembly failed', 1800);
      return { status: 'blocked', repository, baseline, branch, includedTasks: [], blocked, assemblyError: detail };
    }
    const receipt = JSON.parse(result.stdout);
    candidate = receipt.candidate;

    let conflicts;
    try {
      conflicts = await runConflictAudit({
        repo: repository,
        base: baseline,
        head: candidate,
        ignorePullRequestNumbers: ready.map(task => task.pr.number)
      });
    } catch (error) {
      git(['update-ref', '-d', ref, candidate], 'Remove candidate after incomplete ownership scan');
      candidate = null;
      throw error;
    }
    if (conflicts.exactOverlapCount || conflicts.sharedHotspotCount) {
      git(['update-ref', '-d', ref, candidate], 'Remove rejected local candidate');
      candidate = null;
      return {
        status: 'blocked',
        repository,
        baseline,
        branch,
        includedTasks: [],
        blocked,
        ownershipConflicts: {
          exact: conflicts.exactOverlapCount,
          sharedHotspots: conflicts.sharedHotspotCount,
          findings: conflicts.findings
        }
      };
    }

    if (push) pushCandidate(repository, branch, candidate);
    return {
      status: push ? 'pushed' : 'assembled-local',
      repository,
      baseline,
      branch,
      candidate,
      candidateUrl: 'https://github.com/' + repository + '/tree/' + branch,
      includedTasks: receipt.tasks.map(task => ({
        id: task.id,
        base: task.base,
        head: task.head,
        paths: task.paths,
        dependsOn: task.dependsOn,
        pr: ready.find(item => item.id === task.id)?.pr ?? null
      })),
      ownershipWarnings: conflicts.findings,
      blocked
    };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY || DEFAULT_REPO;
  const [command, ...args] = process.argv.slice(2);
  if (command === 'register') return registerTask(repository, args);
  if (command === 'assemble') {
    const { baseline, push } = parseArgs(args);
    const receipt = await assembleReadyBatch(repository, baseline, { push });
    console.log(JSON.stringify(receipt, null, 2));
    if (receipt.status === 'blocked') process.exitCode = 2;
    return;
  }
  fail('Usage: node scripts/engineering-qa-queue.mjs register ... | assemble <qa-baseline-sha> [--push]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(clean(error?.message ?? error, 1600));
    process.exitCode = 1;
  });
}
