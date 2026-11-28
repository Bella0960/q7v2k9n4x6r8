#!/usr/bin/env node
// Shared PR-backed task registry and create-only QA batch handoff.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runConflictAudit } from './engineering-pr-conflicts.mjs';

const API = 'https://api.github.com';
const DEFAULT_REPO = 'Bella0960/q7v2k9n4x6r8';
const QA_REPOSITORY = 'Bella0960/web-runtime-lab';
const QA_WORKFLOW_FILE = 'reusable-qa-request.yml';
const QA_WORKFLOW_ID = 428897690;
const QA_WORKFLOW_PATH = '.github/workflows/' + QA_WORKFLOW_FILE;
const QA_REQUEST_PATH = '.github/qa-release-request.json';
const QA_RELEASE_STEP = 'Automatically select scope, validate and publish QA once';
const SHA = /^[0-9a-f]{40}$/;
const TASK_ID = /^[A-Z][A-Z0-9-]{1,63}$/;
const RISK = /^F[1-4]$/;
const CHECK_NAME = /(test|build|verify|gate|regression|browser|contract|tools?)/i;
const OWNER_APPROVAL_MARKER = /<!--\s*MAOMAO_OWNER_APPROVAL_V1\s*([\s\S]*?)-->/g;
const PRODUCTION_WORKER_CHECK = 'Workers Builds: mao';
const PRODUCTION_WORKER_BRANCH = '__maomao_release_after_checkpoint_only__';
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

function latestOwnerApproval(comments, ownerLogin, taskId) {
  const approvals = [];
  for (const comment of comments) {
    if (comment?.user?.login !== ownerLogin) continue;
    const matches = [...String(comment.body ?? '').matchAll(new RegExp(OWNER_APPROVAL_MARKER.source, 'g'))];
    if (!matches.length) continue;
    const createdAt = Date.parse(comment.created_at ?? '') || 0;
    if (matches.length !== 1) {
      approvals.push({ valid: false, createdAt, reason: 'owner approval comment contains duplicate markers' });
      continue;
    }
    let value;
    try { value = JSON.parse(matches[0][1].trim()); }
    catch {
      approvals.push({ valid: false, createdAt, reason: 'owner approval comment contains invalid JSON' });
      continue;
    }
    if (value?.taskId !== taskId) continue;
    const valid = value.version === 1 &&
      SHA.test(value.head ?? '') &&
      ['approve', 'revoke'].includes(value.decision);
    approvals.push({ valid, value, createdAt, reason: valid ? '' : 'owner approval payload is incomplete or invalid' });
  }
  approvals.sort((a, b) => a.createdAt - b.createdAt);
  return approvals.at(-1) ?? null;
}

function isOutOfScopeProductionWorkerCheck(run, pr) {
  return run?.name === PRODUCTION_WORKER_CHECK &&
    String(run?.details_url ?? '').includes('/workers/services/view/mao/production/builds/') &&
    pr?.head?.ref !== PRODUCTION_WORKER_BRANCH;
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

export function evaluateTaskEvidence({ pr, manifest, reviews = [], ownerComments = [], checkRuns = [], status = { state: 'pending', statuses: [] }, repository = DEFAULT_REPO }) {
  const reasons = [];
  if (pr?.state !== 'open') reasons.push('PR is not open');
  if (pr?.draft) reasons.push('PR is still draft');
  if (pr?.base?.ref !== 'main' && !/^(integration|qa)\//.test(pr?.base?.ref ?? '')) reasons.push('PR base must be main or an approved integration/qa branch');
  if (pr?.head?.repo?.full_name !== repository || pr?.base?.repo?.full_name !== repository) {
    reasons.push('PR head/base must both belong to the source repository');
  }
  if (pr?.head?.sha !== manifest?.head) reasons.push('registered head SHA is stale');
  if (pr?.merge_base_sha !== manifest?.base) reasons.push('registered PR merge-base SHA is stale or does not match the current PR merge base');
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
  const ownerLogin = String(repository).split('/')[0];
  const ownerApproval = latestOwnerApproval(ownerComments, ownerLogin, manifest?.id);
  if (!ownerApproval || !ownerApproval.valid || ownerApproval.value?.decision !== 'approve' ||
      ownerApproval.value?.head !== pr?.head?.sha) {
    reasons.push(ownerApproval?.value?.decision === 'revoke'
      ? 'repository owner revoked approval for this task head'
      : 'missing repository-owner approval for the exact current PR head');
  }

  const currentChecks = checkRuns.filter(run =>
    (!run?.head_sha || run.head_sha === pr?.head?.sha) && !isOutOfScopeProductionWorkerCheck(run, pr));
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
  return git(['--literal-pathspecs', 'diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', base, head, '--'],
    'Task path comparison').stdout.split('\0').filter(Boolean).sort();
}
function equalPaths(a, b) {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

async function api(path, { method = 'GET', body, publicReadOnly = false } = {}) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!publicReadOnly && !token) fail('Set GH_TOKEN or run inside GitHub Actions with GITHUB_TOKEN; the queue fails closed without authenticated API access.');
  const response = await fetch(API + path, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      ...(publicReadOnly ? {} : { authorization: 'Bearer ' + token }),
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

async function pagedArray(path, key = null, limit = 3000, options = {}) {
  const output = [];
  for (let page = 1; page <= Math.ceil(limit / 100); page++) {
    const separator = path.includes('?') ? '&' : '?';
    const data = await api(path + separator + 'per_page=100&page=' + page, options);
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
  const [reviews, ownerComments, checkRuns, status, files] = await Promise.all([
    pagedArray('/repos/' + repository + '/pulls/' + pr.number + '/reviews'),
    pagedArray('/repos/' + repository + '/issues/' + pr.number + '/comments'),
    getCheckRuns(repository, pr.head.sha),
    api('/repos/' + repository + '/commits/' + pr.head.sha + '/status'),
    getPrFiles(repository, pr.number)
  ]);
  if (!Array.isArray(status?.statuses) || status.total_count > status.statuses.length) {
    fail('PR #' + pr.number + ' commit-status list is incomplete.');
  }
  return { reviews, ownerComments, checkRuns, status, files };
}


async function readQaRequestAtRun(run) {
  const response = await api(
    '/repos/' + QA_REPOSITORY + '/contents/' + QA_REQUEST_PATH + '?ref=' + encodeURIComponent(run.head_sha),
    { publicReadOnly: true }
  );
  if (response?.encoding !== 'base64' || typeof response.content !== 'string') {
    fail('QA run #' + run.run_number + ' has no readable immutable request-file receipt.');
  }
  try {
    return JSON.parse(Buffer.from(response.content.replace(/\s/g, ''), 'base64').toString('utf8'));
  } catch {
    fail('QA run #' + run.run_number + ' has an invalid immutable request-file receipt.');
  }
}

async function qaRunJobs(run) {
  return pagedArray(
    '/repos/' + QA_REPOSITORY + '/actions/runs/' + run.id + '/jobs',
    'jobs',
    3000,
    { publicReadOnly: true }
  );
}

export async function getLatestSuccessfulQaReleaseReceipt() {
  const runs = await pagedArray(
    '/repos/' + QA_REPOSITORY + '/actions/workflows/' + QA_WORKFLOW_ID + '/runs?branch=main',
    'workflow_runs',
    3000,
    { publicReadOnly: true }
  );
  const ordered = runs
    .filter(run => run?.path === QA_WORKFLOW_PATH && run?.head_branch === 'main' &&
      ['push', 'workflow_dispatch'].includes(run?.event))
    .sort((a, b) => {
      const updatedAt = run => Date.parse(run?.updated_at ?? '') || Date.parse(run?.created_at ?? '') || 0;
      return updatedAt(b) - updatedAt(a) ||
        (Number(b?.run_attempt) || 0) - (Number(a?.run_attempt) || 0) ||
        (Number(b?.run_number) || 0) - (Number(a?.run_number) || 0);
    });

  for (const run of ordered) {
    if (!Number.isSafeInteger(run?.id) || run.id < 1 ||
        !Number.isSafeInteger(run?.run_number) || run.run_number < 1 ||
        !SHA.test(run?.head_sha ?? '') || !Number.isFinite(Date.parse(run?.updated_at ?? run?.created_at ?? ''))) {
      fail('QA workflow run metadata is incomplete; refusing to infer the deployed source SHA.');
    }

    if (run.event === 'push') {
      const request = await readQaRequestAtRun(run);
      if (!request || typeof request !== 'object' || Array.isArray(request) ||
          Object.keys(request).some(key => !['operation', 'candidate', 'confirmation'].includes(key)) ||
          !['verify', 'release'].includes(request.operation) || !SHA.test(request.candidate ?? '')) {
        fail('QA push run #' + run.run_number + ' has an invalid immutable request; refusing to use an older QA baseline.');
      }
      if (request.operation === 'verify') continue;
      if (request.operation !== 'release' || request.confirmation !== 'qa-only') {
        fail('QA push run #' + run.run_number + ' has an unknown or invalid operation; refusing to use an older release baseline.');
      }
      if (run.status !== 'completed' || run.conclusion !== 'success') {
        fail('A newer QA release attempt #' + run.run_number + ' did not complete successfully. Its deployment state is uncertain; do not assemble from an older baseline.');
      }
      const jobs = await qaRunJobs(run);
      const releaseSteps = jobs.flatMap(job => Array.isArray(job?.steps) ? job.steps : [])
        .filter(step => step?.name === QA_RELEASE_STEP);
      if (releaseSteps.length !== 1 || releaseSteps[0].conclusion !== 'success') {
        fail('QA release run #' + run.run_number + ' lacks a successful release-step receipt.');
      }
      return {
        repository: QA_REPOSITORY,
        workflow: QA_WORKFLOW_PATH,
        runId: run.id,
        runNumber: run.run_number,
        runHeadSha: run.head_sha,
        sourceSha: request.candidate,
        releasedAt: run.updated_at ?? run.created_at
      };
    }

    if (run.status !== 'completed') {
      fail('QA workflow_dispatch run #' + run.run_number + ' is still active; wait for the QA release queue to finish before assembling.');
    }
    const jobs = await qaRunJobs(run);
    const releaseSteps = jobs.flatMap(job => Array.isArray(job?.steps) ? job.steps : [])
      .filter(step => step?.name === QA_RELEASE_STEP);
    if (releaseSteps.length !== 1) {
      fail('Cannot determine whether manual QA run #' + run.run_number + ' published a candidate.');
    }
    if (releaseSteps[0].conclusion === 'skipped') continue;
    fail('Latest successful QA release run #' + run.run_number +
      ' used workflow_dispatch; its exact candidate SHA is not recorded in the immutable request commit. Refusing to guess the source baseline.');
  }
  fail('No successful QA-only release receipt was found in the fixed reusable QA workflow.');
}

async function requireCurrentQaBaseline(baseline) {
  if (!SHA.test(baseline ?? '')) fail('QA baseline must be a full 40-character SHA.');
  const receipt = await getLatestSuccessfulQaReleaseReceipt();
  if (receipt.sourceSha !== baseline) {
    fail('Stale QA baseline ' + baseline + '. Latest successful QA release is run #' +
      receipt.runNumber + ' with source SHA ' + receipt.sourceSha +
      '. Reassemble from the latest successful QA source SHA; the old candidate must not be handed to QA.');
  }
  return receipt;
}

function parseArgs(args) {
  const [baseline, ...flags] = args;
  if (!SHA.test(baseline ?? '')) fail('Usage: npm run eng:batch:auto -- <deployed-qa-source-sha> [--push]');
  if (flags.some(flag => flag !== '--push')) fail('Only --push is supported after the QA baseline SHA.');
  return { baseline, push: flags.includes('--push') };
}

async function registerTask(repository, args) {
  const [numberText, id, risk, ...extraArgs] = args;
  const number = Number(numberText);
  if (!Number.isSafeInteger(number) || number < 1) fail('PR number must be a positive integer.');
  const dependencyArgs = extraArgs.filter(value => value.startsWith('--depends-on='));
  if (dependencyArgs.length > 1 ||
      extraArgs.some(value => value.startsWith('--') && !value.startsWith('--depends-on='))) {
    fail('Only one --depends-on=TASK-ID,TASK-ID option is supported.');
  }
  const requiredChecks = extraArgs.filter(value => !value.startsWith('--depends-on='));
  const dependsOn = dependencyArgs.length
    ? dependencyArgs[0].slice('--depends-on='.length).split(',').map(value => value.trim())
    : [];
  if (dependencyArgs.length && (!dependencyArgs[0].slice('--depends-on='.length).trim() || dependsOn.some(value => !value))) {
    fail('--depends-on must contain a comma-separated list of Task IDs.');
  }
  if (!TASK_ID.test(id ?? '') || !RISK.test(risk ?? '') || !requiredChecks.length) {
    fail('Usage: npm run eng:register -- <PR-number> <TASK-ID> <F1|F2|F3|F4> "<exact test check name>" [...] [--depends-on=TASK-ID,TASK-ID]');
  }
  const pr = await api('/repos/' + repository + '/pulls/' + number);
  if (pr.state !== 'open' || pr.head?.repo?.full_name !== repository || pr.base?.repo?.full_name !== repository) {
    fail('Registration requires an open PR whose head and base both belong to ' + repository + '.');
  }
  const head = pr.head?.sha;
  const baseBranchSha = pr.base?.sha;
  if (!SHA.test(head ?? '') || !SHA.test(baseBranchSha ?? '')) {
    fail('The current PR base branch SHA and head SHA must both be full commit SHAs.');
  }
  const comparison = await api('/repos/' + repository + '/compare/' + baseBranchSha + '...' + head);
  const prMergeBase = comparison.merge_base_commit?.sha;
  if (!SHA.test(prMergeBase ?? '') ||
      !['ahead', 'diverged'].includes(comparison.status) || !(comparison.ahead_by > 0)) {
    fail('GitHub could not confirm a non-empty PR diff and its exact merge-base SHA; registration stopped.');
  }
  const manifest = validateManifest({
    version: 1, id, status: 'submitted', base: prMergeBase,
    head, risk, requiredChecks, dependsOn
  });
  const files = await getPrFiles(repository, number);
  if (!files.length) fail('Cannot register an empty PR.');
  const body = replaceTaskManifest(pr.body ?? '', manifest);
  const latest = await api('/repos/' + repository + '/pulls/' + number);
  if (latest.head?.sha !== head || latest.state !== 'open' ||
      latest.body !== pr.body || latest.base?.ref !== pr.base?.ref || latest.base?.sha !== baseBranchSha) {
    fail('PR body, base, or head changed during registration; no overwrite was made. Rerun eng:register.');
  }
  const updated = await api('/repos/' + repository + '/pulls/' + number, { method: 'PATCH', body: { body } });
  console.log(JSON.stringify({
    status: 'submitted',
    pr: number,
    url: updated.html_url,
    task: id,
    prMergeBase,
    head,
    risk,
    requiredChecks: manifest.requiredChecks,
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
    let prWithMergeBase;
    try {
      ensureCommit(latestPr.base?.sha, 'PR #' + pr.number + ' current base branch SHA');
      ensureCommit(latestPr.head?.sha, 'PR #' + pr.number + ' current head SHA');
      const mergeBaseSha = gitText(['merge-base', latestPr.base.sha, latestPr.head.sha],
        'PR #' + pr.number + ' current merge-base SHA').trim();
      if (!SHA.test(mergeBaseSha)) fail('PR #' + pr.number + ' current merge-base did not resolve to a full SHA.');
      prWithMergeBase = { ...latestPr, merge_base_sha: mergeBaseSha };
    } catch (error) {
      blocked.push({ ...latestOpenPrMetadata(pr), state: 'blocked', reasons: [clean(error.message)] });
      continue;
    }
    const result = evaluateTaskEvidence({ pr: prWithMergeBase, manifest, ...evidence, repository });
    if (!result.ready) {
      blocked.push({ ...latestOpenPrMetadata(pr), state: 'blocked', reasons: result.reasons });
      continue;
    }
    try {
      ensureCommit(manifest.base, 'PR #' + pr.number + ' registered merge base');
      ensureCommit(manifest.head, 'PR #' + pr.number + ' registered head');
      ensureCommit(baseline, 'Current deployed QA baseline');
      isAncestor(manifest.base, manifest.head, 'PR #' + pr.number + ' merge-base-to-head ancestry');
      const apiPaths = pathSetFromPrFiles(evidence.files);
      const gitPaths = gitChangedPaths(manifest.base, manifest.head);
      if (!gitPaths.length || !equalPaths(apiPaths, gitPaths)) {
        fail('PR #' + pr.number + ' Git diff does not match the complete GitHub changed-file list.');
      }
      registered.push({
        id: manifest.id,
        status: 'ready',
        prMergeBase: manifest.base,
        head: manifest.head,
        paths: gitPaths,
        pr: latestOpenPrMetadata(pr),
        risk: manifest.risk,
        dependsOn: manifest.dependsOn
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

function taskPrMergeBase(task) { return task?.prMergeBase ?? task?.prBase ?? task?.base; }

function candidateReceiptPath(baseline) {
  const gitPath = gitText(['rev-parse', '--git-path', 'maomao-qa-batch-receipts'], 'Locate candidate receipt directory');
  return join(resolve(gitPath), 'qa-batch-' + baseline + '.json');
}

function readCandidateReceipt(repository, baseline, branch) {
  const path = candidateReceiptPath(baseline);
  if (!existsSync(path)) return null;
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail('Stored candidate receipt is unreadable; refusing to rebuild or overwrite this batch.');
  }
  const tasks = receipt?.tasks;
  const taskIds = receipt?.taskIds;
  const qa = receipt?.qaSourceReceipt;
  if (!receipt || ![1, 2].includes(receipt.version) || receipt.repository !== repository ||
      receipt.baseline !== baseline || receipt.branch !== branch || !SHA.test(receipt.candidate ?? '') ||
      !Array.isArray(tasks) || !tasks.length || !Array.isArray(taskIds) ||
      taskIds.length !== tasks.length ||
      tasks.some(task => !TASK_ID.test(task?.id ?? '') || !SHA.test(taskPrMergeBase(task) ?? '') ||
        !SHA.test(task?.head ?? '') || !Array.isArray(task?.paths) ||
        task.paths.some(path => typeof path !== 'string' || !path || path.startsWith('/') ||
          path.split('/').some(part => !part || part === '.' || part === '..')) ||
        !Number.isSafeInteger(task?.prNumber) || task.prNumber < 1 ||
        !Array.isArray(task?.dependsOn) || task.dependsOn.some(id => !TASK_ID.test(id))) ||
      new Set(taskIds).size !== taskIds.length ||
      JSON.stringify(taskIds) !== JSON.stringify(tasks.map(task => task.id)) ||
      !qa || qa.repository !== QA_REPOSITORY || qa.workflow !== QA_WORKFLOW_PATH ||
      !Number.isSafeInteger(qa.runId) || qa.runId < 1 ||
      !Number.isSafeInteger(qa.runNumber) || qa.runNumber < 1 ||
      !SHA.test(qa.runHeadSha ?? '') || qa.sourceSha !== baseline ||
      !Number.isFinite(Date.parse(qa.releasedAt ?? '')) ||
      !Number.isFinite(Date.parse(receipt.createdAt ?? ''))) {
    fail('Stored candidate receipt failed validation; refusing to rebuild or overwrite this batch.');
  }
  return { path, receipt };
}

function writeCandidateReceipt(receipt) {
  const path = candidateReceiptPath(receipt.baseline);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + '.' + process.pid + '.' + Date.now() + '.tmp';
  writeFileSync(temporary, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  renameSync(temporary, path);
  return path;
}

function isCommitAncestor(base, head, label) {
  return git(['merge-base', '--is-ancestor', base, head], label, true).ok;
}

function verifyCandidateTaskProvenance(baseline, candidate, task) {
  const prMergeBase = taskPrMergeBase(task);
  const messages = gitText(['log', '--format=%B', baseline + '..' + candidate],
    task.id + ' candidate provenance');
  const lines = new Set(messages.split(/\r?\n/).map(line => line.trim()));
  const expected = [
    'Task-ID: ' + task.id,
    'Task-PR-Merge-Base-SHA: ' + prMergeBase,
    'Task-PR-Head-SHA: ' + task.head
  ];
  if (expected.some(line => !lines.has(line))) {
    fail(task.id + ' saved candidate lacks immutable PR merge-base/head provenance; refusing to resume it.');
  }
}

function localBranchSha(ref) {
  const result = git(['rev-parse', '--verify', ref], 'Local candidate preflight', true);
  if (!result.ok) return null;
  const sha = result.stdout.trim();
  if (!SHA.test(sha)) fail('Local candidate ref did not resolve to a commit SHA.');
  return sha;
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

function remoteBranchSha(branch) {
  const ref = 'refs/heads/' + branch;
  const output = gitText(['ls-remote', '--heads', 'origin', ref], 'Remote candidate preflight');
  if (!output) return null;
  const rows = output.split(/\r?\n/).filter(Boolean);
  if (rows.length !== 1) fail('Remote candidate lookup returned an ambiguous ref: ' + branch);
  const [sha, remoteRef] = rows[0].trim().split(/\s+/);
  if (remoteRef !== ref || !SHA.test(sha ?? '')) fail('Remote candidate lookup returned an invalid SHA for ' + branch);
  return sha;
}

function pushCandidate(repository, branch, candidate) {
  assertPushTarget(repository);
  const existing = remoteBranchSha(branch);
  if (existing === candidate) return { remoteSha: existing, alreadyPresent: true };
  if (existing) {
    fail('Remote candidate branch already exists at a different SHA (' + existing +
      '); refusing to overwrite it: ' + branch);
  }
  // Empty expected ref is a create-only lease: a concurrent branch creation makes the push fail.
  git(['push', '--force-with-lease=refs/heads/' + branch + ':', 'origin',
    candidate + ':refs/heads/' + branch], 'Create-only candidate push');
  const pushed = remoteBranchSha(branch);
  if (pushed !== candidate) fail('Remote candidate receipt does not match the assembled SHA.');
  return { remoteSha: pushed, alreadyPresent: false };
}

async function resumeCandidate(repository, baseline, branch, stored, { push = false } = {}) {
  const { receipt } = stored;
  const ref = 'refs/heads/' + branch;
  assertPushTarget(repository);
  const localSha = localBranchSha(ref);
  const remoteSha = remoteBranchSha(branch);
  if (localSha && localSha !== receipt.candidate) {
    fail('Local candidate ref differs from its saved receipt; refusing to replace either SHA.');
  }
  if (remoteSha && remoteSha !== receipt.candidate) {
    fail('Remote candidate branch exists at a different SHA (' + remoteSha +
      '); refusing to overwrite another window’s candidate.');
  }
  if (!localSha && remoteSha !== receipt.candidate) {
    fail('Saved receipt exists but its candidate commit is not available locally and the remote ref is empty. Restore the saved candidate bundle; do not reassemble automatically.');
  }
  if (localSha) {
    git(['cat-file', '-e', receipt.candidate + '^{commit}'], 'Saved candidate object verification');
    isAncestor(baseline, receipt.candidate, 'Saved candidate QA baseline');
    for (const task of receipt.tasks) {
      // Legacy v1 candidates used the source PR head as a merge parent. New
      // single-parent candidates retain the exact PR merge-base/head in trailers.
      if (!isCommitAncestor(task.head, receipt.candidate, task.id + ' saved candidate ancestry')) {
        verifyCandidateTaskProvenance(baseline, receipt.candidate, task);
      }
    }
  }

  let pushStatus = remoteSha === receipt.candidate ? 'already-present' : 'not-requested';
  let finalQaSourceReceipt = await requireCurrentQaBaseline(baseline);
  if (push && !remoteSha) {
    const conflicts = await runConflictAudit({
      repo: repository,
      base: baseline,
      head: receipt.candidate,
      ignorePullRequestNumbers: receipt.tasks.map(task => task.prNumber),
      checkContentConflicts: true
    });
    if (!conflicts.contentConflictChecksPerformed || conflicts.contentConflictCount) {
      fail('Saved candidate has a real content conflict or its three-way conflict audit is incomplete; it remains intact and was not pushed.');
    }
    finalQaSourceReceipt = await requireCurrentQaBaseline(baseline);
    const result = pushCandidate(repository, branch, receipt.candidate);
    pushStatus = result.alreadyPresent ? 'already-present' : 'created';
  }
  const status = remoteBranchSha(branch) === receipt.candidate ? 'pushed' : 'assembled-local';
  return {
    status,
    resumed: true,
    pushStatus,
    candidateReceiptPath: stored.path,
    qaSourceReceipt: finalQaSourceReceipt,
    repository,
    baseline,
    branch,
    candidate: receipt.candidate,
    candidateUrl: 'https://github.com/' + repository + '/tree/' + branch,
    includedTasks: receipt.tasks.map(task => ({
      id: task.id, prMergeBase: taskPrMergeBase(task), head: task.head, paths: task.paths,
      dependsOn: task.dependsOn, pr: task.prNumber
    })),
    ownershipWarnings: receipt.ownershipWarnings ?? [],
    blocked: receipt.blocked ?? []
  };
}

async function invalidateCandidate(repository, baseline, candidate, { deleteRemote = false } = {}) {
  if (!SHA.test(baseline ?? '') || !SHA.test(candidate ?? '')) {
    fail('Usage: node scripts/engineering-qa-queue.mjs invalidate <qa-baseline-sha> --confirm-candidate=<candidate-sha> [--delete-remote]');
  }
  const branch = 'integration/qa-batch-' + baseline.slice(0, 12);
  const stored = readCandidateReceipt(repository, baseline, branch);
  if (!stored) fail('No saved candidate receipt exists for this QA baseline.');
  if (stored.receipt.candidate !== candidate) {
    fail('Confirmation SHA does not match the saved candidate; nothing was invalidated.');
  }
  assertPushTarget(repository);
  const ref = 'refs/heads/' + branch;
  const localSha = localBranchSha(ref);
  if (localSha && localSha !== candidate) {
    fail('Local candidate ref differs from the saved candidate; nothing was invalidated.');
  }
  const remoteSha = remoteBranchSha(branch);
  if (remoteSha && remoteSha !== candidate) {
    fail('Remote candidate ref is a different SHA (' + remoteSha + '); refusing to delete another window’s candidate.');
  }
  if (remoteSha && !deleteRemote) {
    fail('Remote candidate exists at the confirmed SHA. Add --delete-remote only when the coordinator explicitly intends to void this published candidate.');
  }
  if (remoteSha) {
    // Ref deletion is guarded by the exact old SHA; a concurrent change makes Git reject it.
    await getLatestSuccessfulQaReleaseReceipt();
    git(['push', '--force-with-lease=refs/heads/' + branch + ':' + candidate,
      'origin', ':refs/heads/' + branch], 'Delete explicitly invalidated QA candidate ref');
    if (remoteBranchSha(branch)) {
      fail('Remote candidate ref changed during invalidation; the local receipt is retained.');
    }
  }
  if (localSha) git(['update-ref', '-d', ref, candidate], 'Invalidate explicitly confirmed local candidate');
  unlinkSync(stored.path);
  return {
    status: 'invalidated-candidate',
    baseline,
    branch,
    candidate,
    remoteRefDeleted: Boolean(remoteSha)
  };
}

async function assembleReadyBatch(repository, baseline, { push = false } = {}) {
  const qaSourceReceipt = await requireCurrentQaBaseline(baseline);
  const branch = 'integration/qa-batch-' + baseline.slice(0, 12);
  const ref = 'refs/heads/' + branch;
  const stored = readCandidateReceipt(repository, baseline, branch);
  if (stored) return resumeCandidate(repository, baseline, branch, stored, { push });

  assertPushTarget(repository);
  const localSha = localBranchSha(ref);
  const remoteSha = remoteBranchSha(branch);
  if (localSha || remoteSha) {
    fail('A candidate ref already exists for this QA baseline but has no saved receipt. Refusing to overwrite or reconstruct it; inspect the existing candidate and resolve it explicitly.');
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
      const record = { id: task.id, status: 'ready', prMergeBase: task.prMergeBase, head: task.head, paths: task.paths, dependsOn: task.dependsOn };
      writeFileSync(join(temp, String(index + 1).padStart(3, '0') + '.json'), JSON.stringify(record));
    }
    const result = spawnSync(process.execPath, [fileURLToPath(BATCH_SCRIPT), temp, baseline, branch, JSON.stringify(qaSourceReceipt)], {
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
        ignorePullRequestNumbers: ready.map(task => task.pr.number),
        checkContentConflicts: true
      });
    } catch (error) {
      git(['update-ref', '-d', ref, candidate], 'Remove candidate after incomplete ownership scan');
      candidate = null;
      throw error;
    }
    if (!conflicts.contentConflictChecksPerformed || conflicts.contentConflictCount) {
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
          exactPathOverlaps: conflicts.exactOverlapCount,
          contentConflicts: conflicts.contentConflictCount,
          sharedHotspots: conflicts.sharedHotspotCount,
          contentConflictChecksPerformed: conflicts.contentConflictChecksPerformed,
          findings: conflicts.findings
        }
      };
    }

    let finalQaSourceReceipt;
    try {
      // Recheck at the handoff boundary: a newer QA release during assembly invalidates this candidate.
      finalQaSourceReceipt = await requireCurrentQaBaseline(baseline);
    } catch (error) {
      git(['update-ref', '-d', ref, candidate], 'Remove candidate after QA baseline changed during assembly');
      candidate = null;
      throw error;
    }
    const includedTasks = receipt.tasks.map(task => ({
      id: task.id,
      prMergeBase: task.prMergeBase ?? task.prBase ?? task.base,
      head: task.head,
      paths: task.paths,
      dependsOn: task.dependsOn,
      pr: ready.find(item => item.id === task.id)?.pr ?? null
    }));
    const candidateReceipt = {
      version: 2,
      repository,
      baseline,
      branch,
      candidate,
      taskIds: receipt.tasks.map(task => task.id),
      tasks: receipt.tasks.map(task => ({
        id: task.id,
        prMergeBase: task.prMergeBase ?? task.prBase ?? task.base,
        head: task.head,
        paths: task.paths,
        dependsOn: task.dependsOn ?? [],
        prNumber: ready.find(item => item.id === task.id)?.pr?.number ?? null
      })),
      qaSourceReceipt: finalQaSourceReceipt,
      ownershipWarnings: conflicts.findings,
      blocked,
      createdAt: new Date().toISOString()
    };
    let savedReceiptPath;
    try {
      savedReceiptPath = writeCandidateReceipt(candidateReceipt);
    } catch (error) {
      git(['update-ref', '-d', ref, candidate], 'Remove candidate because its receipt could not be saved');
      candidate = null;
      throw error;
    }
    let pushStatus = 'not-requested';
    if (push) {
      const pushed = pushCandidate(repository, branch, candidate);
      pushStatus = pushed.alreadyPresent ? 'already-present' : 'created';
    }
    return {
      status: push ? 'pushed' : 'assembled-local',
      resumed: false,
      pushStatus,
      candidateReceiptPath: savedReceiptPath,
      qaSourceReceipt: finalQaSourceReceipt,
      repository,
      baseline,
      branch,
      candidate,
      candidateUrl: 'https://github.com/' + repository + '/tree/' + branch,
      includedTasks,
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
  if (command === 'validate-baseline') {
    const [baseline, ...extra] = args;
    if (extra.length) fail('Usage: node scripts/engineering-qa-queue.mjs validate-baseline <latest-successful-qa-source-sha>');
    const receipt = await requireCurrentQaBaseline(baseline);
    console.log(JSON.stringify({ status: 'current-qa-baseline', baseline, qaSourceReceipt: receipt }, null, 2));
    return;
  }
  if (command === 'assemble') {
    const { baseline, push } = parseArgs(args);
    const receipt = await assembleReadyBatch(repository, baseline, { push });
    console.log(JSON.stringify(receipt, null, 2));
    if (receipt.status === 'blocked') process.exitCode = 2;
    return;
  }
  if (command === 'invalidate') {
    const [baseline, ...flags] = args;
    const confirmations = flags.filter(flag => flag.startsWith('--confirm-candidate='));
    const deleteRemote = flags.includes('--delete-remote');
    const extra = flags.filter(flag => !flag.startsWith('--confirm-candidate=') && flag !== '--delete-remote');
    const match = /^--confirm-candidate=([0-9a-f]{40})$/.exec(confirmations[0] ?? '');
    if (extra.length || confirmations.length !== 1 || !match) {
      fail('Usage: node scripts/engineering-qa-queue.mjs invalidate <qa-baseline-sha> --confirm-candidate=<candidate-sha> [--delete-remote]');
    }
    console.log(JSON.stringify(await invalidateCandidate(repository, baseline, match[1], { deleteRemote }), null, 2));
    return;
  }
  fail('Usage: npm run eng:register -- <PR-number> <TASK-ID> <F1|F2|F3|F4> "exact test check name" [...] [--depends-on=TASK-ID,TASK-ID] | validate-baseline <qa-source-sha> | assemble <qa-baseline-sha> [--push] | invalidate <qa-baseline-sha> --confirm-candidate=<candidate-sha> [--delete-remote]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(clean(error?.message ?? error, 1600));
    process.exitCode = 1;
  });
}
