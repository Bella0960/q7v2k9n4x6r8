import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseTaskManifest,
  renderTaskManifest,
  replaceTaskManifest,
  pathSetFromPrFiles,
  evaluateTaskEvidence
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

function runQueueAssembleCli(t, specs, options = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'maomao-qa-assemble-cli-'));
  const stubDir = mkdtempSync(join(tmpdir(), 'maomao-qa-assemble-stub-'));
  t.after(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  });
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'QA Test');
  git('config', 'user.email', 'qa@example.invalid');
  writeFileSync(join(cwd, 'baseline.txt'), 'deployed QA baseline');
  git('add', 'baseline.txt');
  git('commit', '-qm', 'QA baseline');
  const originalBaseline = git('rev-parse', 'HEAD');
  const repository = 'Bella0960/q7v2k9n4x6r8';
  const qaRepository = 'Bella0960/web-runtime-lab';
  const remotePath = join(stubDir, 'origin.git');
  const remoteInit = spawnSync('git', ['init', '--bare', '-q', remotePath], { encoding: 'utf8' });
  assert.equal(remoteInit.status, 0, remoteInit.stderr || remoteInit.stdout);
  git('remote', 'add', 'origin', remotePath);
  const binDir = join(stubDir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const realGit = process.env.PATH.split(delimiter)
    .map(directory => join(directory, process.platform === 'win32' ? 'git.exe' : 'git'))
    .find(candidate => existsSync(candidate));
  assert.ok(realGit, 'git executable must be available for the test wrapper');
  const gitWrapper = join(binDir, process.platform === 'win32' ? 'git.cmd' : 'git');
  const wrapperScript = [
    '#!/bin/sh',
    'if [ "$1" = "remote" ] && [ "$2" = "get-url" ] && [ "$3" = "origin" ]; then',
    '  printf "%s\\n" "https://github.com/' + repository + '"',
    '  exit 0',
    'fi',
    'if [ "$1" = "ls-remote" ] && [ "$2" = "--heads" ] && [ "$3" = "origin" ]; then',
    '  shift 3',
    '  exec "$MAOMAO_TEST_REAL_GIT" ls-remote --heads "$MAOMAO_TEST_REMOTE_PATH" "$@"',
    'fi',
    'if [ "$1" = "push" ]; then',
    '  shift',
    '  lease="$1"',
    '  shift',
    '  if [ "$1" = "origin" ]; then shift; fi',
    '  exec "$MAOMAO_TEST_REAL_GIT" push "$lease" "$MAOMAO_TEST_REMOTE_PATH" "$@"',
    'fi',
    'exec "$MAOMAO_TEST_REAL_GIT" "$@"'
  ].join('\n');
  writeFileSync(gitWrapper, wrapperScript);
  if (process.platform !== 'win32') chmodSync(gitWrapper, 0o755);
  if (options.failFirstPush) {
    const marker = join(stubDir, 'first-push-rejected');
    const hook = join(remotePath, 'hooks', 'pre-receive');
    writeFileSync(hook, [
      '#!/bin/sh',
      'if [ ! -f "' + marker + '" ]; then',
      '  touch "' + marker + '"',
      '  echo "simulated first push failure" >&2',
      '  exit 1',
      'fi',
      'exit 0',
      ''
    ].join('\n'));
    chmodSync(hook, 0o755);
  }

  let latestQaSha = originalBaseline;
  let baseline = originalBaseline;
  if (options.advanceQaBaseline) {
    git('switch', '-qc', 'qa-deployed-baseline', originalBaseline);
    writeFileSync(join(cwd, 'deployed.txt'), 'already deployed to QA');
    git('add', 'deployed.txt');
    git('commit', '-qm', 'Deploy a later QA baseline');
    latestQaSha = git('rev-parse', 'HEAD');
    git('push', '-q', 'origin', 'qa-deployed-baseline:refs/heads/integration/qa-deployed-baseline');
    git('switch', '-q', 'main');
    if (options.useLatestAsInput) baseline = latestQaSha;
  }

  const prs = [];
  const evidence = {};
  const taskBase = baseline;
  for (let index = 0; index < specs.length; index++) {
    const spec = specs[index];
    const branch = 'task-' + spec.id.toLowerCase();
    const path = spec.path ?? branch + '.txt';
    git('switch', '-qc', branch, taskBase);
    writeFileSync(join(cwd, path), spec.id);
    git('add', path);
    git('commit', '-qm', spec.id);
    const head = git('rev-parse', 'HEAD');
    const number = index + 1;
    const taskManifest = manifest({
      id: spec.id,
      status: 'ready',
      base: taskBase,
      head,
      dependsOn: spec.dependsOn ?? []
    });
    prs.push({
      number,
      state: 'open',
      draft: false,
      title: spec.id,
      html_url: 'https://github.com/' + repository + '/pull/' + number,
      body: renderTaskManifest(taskManifest),
      user: { login: 'author' },
      head: { sha: head, ref: branch, repo: { full_name: repository } },
      base: { sha: taskBase, ref: 'main', repo: { full_name: repository } }
    });
    evidence[number] = {
      head,
      reviews: [{
        user: { login: 'reviewer' },
        state: 'APPROVED',
        commit_id: head,
        submitted_at: '2026-11-26T10:00:00Z'
      }],
      check_runs: [
        {
          name: 'Node Tests',
          head_sha: head,
          status: 'completed',
          conclusion: spec.ready === false ? 'failure' : 'success',
          started_at: '2026-11-26T10:00:00Z'
        },
        {
          name: 'Vite Build',
          head_sha: head,
          status: 'completed',
          conclusion: 'success',
          started_at: '2026-11-26T10:00:00Z'
        }
      ],
      status: { state: 'success', total_count: 0, statuses: [] },
      files: [{ filename: path }]
    };
    git('switch', '-q', 'main');
  }

  const rawSequence = options.qaReleaseSequence ?? [{ source: 'latest' }];
  const qaReleaseSequence = rawSequence.map(item => ({
    ...item,
    sourceSha: item.source === 'input' ? baseline : item.source === 'latest' ? latestQaSha : item.sourceSha
  }));
  if (options.qaReleaseEvent) qaReleaseSequence[0].event = options.qaReleaseEvent;

  const stubPath = join(stubDir, 'github-api-stub.mjs');
  const stub = [
    'const fixture = ' + JSON.stringify({ repository, qaRepository, prs, evidence }) + ';',
    'const json = value => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });',
    'let qaRunListCalls = 0;',
    'const releaseSequence = ' + JSON.stringify(qaReleaseSequence) + ';',
    'const releaseForCall = call => releaseSequence[Math.min(call, releaseSequence.length - 1)];',
    'const buildQaRuns = release => {',
    '  const requestCommit = release.runHeadSha || String(release.runId || 91).padStart(40, "0");',
    '  const runs = [',
    '    { id: 950, run_number: 95, workflow_id: 428897690, path: ".github/workflows/reusable-qa-request.yml", event: "push", head_branch: "main", status: "completed", conclusion: release.newerRunConclusion || "success", head_sha: "e".repeat(40), created_at: "2026-11-26T15:17:19Z", updated_at: "2026-11-26T15:17:19Z" },',
    '    { id: 949, run_number: 94, workflow_id: 428897690, path: ".github/workflows/reusable-qa-request.yml", event: "pull_request", head_branch: "GOV-007/test", status: "completed", conclusion: "success", head_sha: "f".repeat(40), created_at: "2026-11-26T10:04:44Z" },',
    '    { id: 948, run_number: 93, workflow_id: 428897690, path: ".github/workflows/reusable-qa-request.yml", event: "pull_request", head_branch: "GOV-007/test", status: "completed", conclusion: "failure", head_sha: "a".repeat(40), created_at: "2026-11-26T10:03:47Z" },',
    '    { id: 952, run_number: 92, workflow_id: 428897690, path: ".github/workflows/reusable-qa-request.yml", event: "push", head_branch: "main", status: "completed", conclusion: "failure", head_sha: "d".repeat(40), created_at: "2026-11-26T09:29:11Z", updated_at: "2026-11-26T09:29:11Z" },',
    '    { id: release.runId || 45785677703, run_number: release.runNumber || 91, workflow_id: 428897690, path: ".github/workflows/reusable-qa-request.yml", event: release.event || "push", head_branch: "main", status: "completed", conclusion: "success", head_sha: requestCommit, created_at: release.createdAt || "2026-11-26T08:44:11Z", updated_at: release.updatedAt || release.createdAt || "2026-11-26T08:44:11Z" }',
    '  ];',
    '  if (release.rerunOlderRelease) runs.push({ id: 45784272072, run_number: 90, workflow_id: 428897690, path: ".github/workflows/reusable-qa-request.yml", event: "push", head_branch: "main", status: "completed", conclusion: "success", head_sha: "b".repeat(40), run_attempt: 2, created_at: "2026-11-26T08:34:11Z", updated_at: "2026-11-26T16:30:00Z" });',
    '  return runs;',
    '};',
    'globalThis.fetch = async (input, init = {}) => {',
    '  const url = new URL(String(input));',
    '  const method = init.method || "GET";',
    '  if (method !== "GET") throw new Error("Unexpected mocked GitHub method: " + method);',
    '  const path = url.pathname;',
    '  const sourceBase = "/repos/" + fixture.repository;',
    '  const qaBase = "/repos/" + fixture.qaRepository;',
    '  const suffix = path.startsWith(sourceBase) ? path.slice(sourceBase.length) : "";',
    '  if (path === qaBase + "/actions/workflows/428897690/runs") {',
    '    const release = releaseForCall(qaRunListCalls++);',
    '    return json({ workflow_runs: buildQaRuns(release) });',
    '  }',
    '  const qaJobs = path.match(/^\\/repos\\/Bella0960\\/web-runtime-lab\\/actions\\/runs\\/(\\d+)\\/jobs$/);',
    '  if (qaJobs) {',
    '    const id = Number(qaJobs[1]);',
    '    const release = releaseForCall(Math.max(0, qaRunListCalls - 1));',
    '    const expectedRunId = release.rerunOlderRelease ? 45784272072 : (release.runId || 45785677703);',
    '    if (id !== expectedRunId) throw new Error("Unexpected QA jobs request: " + id);',
    '    return json({ jobs: [{ id: 91001, name: "request", conclusion: "success", steps: [{ name: "Automatically select scope, validate and publish QA once", conclusion: "success" }] }] });',
    '  }',
    '  if (path === qaBase + "/contents/.github/qa-release-request.json") {',
    '    const ref = url.searchParams.get("ref");',
    '    const release = releaseForCall(Math.max(0, qaRunListCalls - 1));',
    '    const requestCommit = release.runHeadSha || String(release.runId || 91).padStart(40, "0");',
    '    let request;',
    '    if (ref === "e".repeat(40)) request = release.newerRunOperation === "release" ? { operation: "release", candidate: release.sourceSha, confirmation: "qa-only" } : { operation: "verify", candidate: "4b49c0a95ea8cfedc8aa2007c061a1f6f6771431", confirmation: "qa-only" };',
    '    else if (ref === "d".repeat(40)) request = { operation: "verify", candidate: "6c61b0395705848dfa898073709a651869e87b90", confirmation: "qa-only" };',
    '    else if (release.rerunOlderRelease && ref === "b".repeat(40)) request = { operation: "release", candidate: release.sourceSha, confirmation: "qa-only" };',
    '    else if (ref === requestCommit) request = { operation: "release", candidate: release.sourceSha, confirmation: "qa-only" };',
    '    else throw new Error("Unexpected QA receipt ref: " + ref);',
    '    const encoded = Buffer.from(JSON.stringify(request), "utf8").toString("base64");',
    '    return json({ encoding: "base64", content: encoded.match(/.{1,24}/g).join("\\n") });',
    '  }',
    '  if (suffix === "/pulls") return json(fixture.prs);',
    '  let match = suffix.match(/^\\/pulls\\/(\\d+)$/);',
    '  if (match) return json(fixture.prs.find(pr => pr.number === Number(match[1])));',
    '  match = suffix.match(/^\\/pulls\\/(\\d+)\\/reviews$/);',
    '  if (match) return json(fixture.evidence[match[1]].reviews);',
    '  match = suffix.match(/^\\/pulls\\/(\\d+)\\/files$/);',
    '  if (match) return json(fixture.evidence[match[1]].files);',
    '  match = suffix.match(/^\\/commits\\/([0-9a-f]{40})\\/check-runs$/);',
    '  if (match) { const item = Object.values(fixture.evidence).find(value => value.head === match[1]); if (!item) throw new Error("Missing check-run fixture for " + match[1]); return json({ check_runs: item.check_runs }); }',
    '  match = suffix.match(/^\\/commits\\/([0-9a-f]{40})\\/status$/);',
    '  if (match) { const item = Object.values(fixture.evidence).find(value => value.head === match[1]); if (!item) throw new Error("Missing status fixture for " + match[1]); return json(item.status); }',
    '  throw new Error("Unexpected mocked GitHub request: " + method + " " + path);',
    '};'
  ].join('\n');
  writeFileSync(stubPath, stub);

  const command = options.command ?? 'assemble';
  const candidateRef = 'refs/heads/integration/qa-batch-' + baseline.slice(0, 12);
  const receiptPath = join(cwd, '.git', 'maomao-qa-batch-receipts', 'qa-batch-' + baseline + '.json');
  const runQueue = args => spawnSync(process.execPath, ['--import', stubPath, queueScript, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: binDir + delimiter + process.env.PATH,
      MAOMAO_TEST_REAL_GIT: realGit,
      MAOMAO_TEST_REMOTE_PATH: remotePath,
      GH_TOKEN: 'test-token',
      GITHUB_TOKEN: 'test-token',
      GITHUB_REPOSITORY: repository
    }
  });
  const initialArgs = [command, baseline, ...(options.push ? ['--push'] : [])];
  const result = runQueue(initialArgs);
  const remoteSha = () => {
    const remote = spawnSync('git', ['ls-remote', '--heads', remotePath, candidateRef], { cwd, encoding: 'utf8' });
    assert.equal(remote.status, 0, remote.stderr || remote.stdout);
    return remote.stdout.trim().split(/\s+/)[0] || null;
  };
  let receipt = null;
  if (result.stdout.trim()) {
    try { receipt = JSON.parse(result.stdout); }
    catch { throw new Error('Queue CLI did not return JSON. stdout=' + result.stdout + '\nstderr=' + result.stderr); }
  }
  const candidateExists = spawnSync('git', ['show-ref', '--verify', '--quiet', candidateRef], { cwd }).status === 0;
  let candidateDeployedFile = null;
  if (receipt?.candidate) {
    const deployed = spawnSync('git', ['show', receipt.candidate + ':deployed.txt'], { cwd, encoding: 'utf8' });
    if (deployed.status === 0) candidateDeployedFile = deployed.stdout.trim();
  }
  const gitCommand = (...args) => {
    const commandResult = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(commandResult.status, 0, commandResult.stderr || commandResult.stdout);
    return commandResult.stdout.trim();
  };
  return {
    result, receipt, baseline, originalBaseline, latestQaSha, candidateExists,
    candidateDeployedFile, cwd, candidateRef, receiptPath, remotePath, remoteSha, runQueue, git: gitCommand
  };
}

test('CLI assemble blocks a dependent task when its prerequisite is not ready and keeps independent work', t => {
  const { result, receipt } = runQueueAssembleCli(t, [
    { id: 'TASK-01', ready: false },
    { id: 'TASK-02', dependsOn: ['TASK-01'] },
    { id: 'TASK-10' }
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(receipt.status, 'assembled-local');
  assert.deepEqual(receipt.includedTasks.map(task => task.id), ['TASK-10']);
  assert.deepEqual(receipt.includedTasks[0].dependsOn, []);
  assert.ok(receipt.blocked.some(item => item.number === 1));
  assert.ok(receipt.blocked.some(item => item.number === 2 &&
    item.reasons.some(reason => reason.includes('TASK-01'))));
});

test('CLI assemble topologically orders ready tasks and retains dependencies in the receipt', t => {
  const { result, receipt } = runQueueAssembleCli(t, [
    { id: 'TASK-02', dependsOn: ['TASK-01'] },
    { id: 'TASK-01', dependsOn: ['TASK-10'] },
    { id: 'TASK-10' }
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(receipt.status, 'assembled-local');
  assert.deepEqual(receipt.includedTasks.map(task => task.id), ['TASK-10', 'TASK-01', 'TASK-02']);
  assert.deepEqual(receipt.includedTasks.find(task => task.id === 'TASK-02').dependsOn, ['TASK-01']);
});

test('CLI assemble explicitly blocks a task whose prerequisite is absent', t => {
  const { result, receipt } = runQueueAssembleCli(t, [
    { id: 'TASK-02', dependsOn: ['TASK-01'] }
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(receipt.status, 'no-ready-tasks');
  assert.deepEqual(receipt.includedTasks, []);
  assert.ok(receipt.blocked.some(item => item.reasons.some(reason =>
    reason.includes('dependency is not ready in this batch: TASK-01'))));
});

test('CLI assemble explicitly blocks dependency cycles before candidate creation', t => {
  const { result, receipt } = runQueueAssembleCli(t, [
    { id: 'TASK-01', dependsOn: ['TASK-02'] },
    { id: 'TASK-02', dependsOn: ['TASK-01'] }
  ]);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(receipt.status, 'blocked');
  assert.match(receipt.assemblyError, /cycle/i);
});

test('CLI assemble includes independent tasks with no dependencies', t => {
  const { result, receipt } = runQueueAssembleCli(t, [{ id: 'TASK-10' }]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(receipt.status, 'assembled-local');
  assert.deepEqual(receipt.includedTasks.map(task => task.id), ['TASK-10']);
  assert.deepEqual(receipt.includedTasks[0].dependsOn, []);
});


test('rejects an older QA SHA even when the commit is valid and task branches descend from it', t => {
  const { result, receipt, baseline, latestQaSha, candidateExists } = runQueueAssembleCli(
    t, [{ id: 'TASK-10' }], { advanceQaBaseline: true }
  );
  assert.equal(result.status, 1);
  assert.equal(receipt, null);
  assert.match(result.stderr, /stale QA baseline/i);
  assert.ok(result.stderr.includes(latestQaSha));
  assert.notEqual(baseline, latestQaSha);
  assert.equal(candidateExists, false);
});

test('accepts the latest successful release SHA, ignores newer verify-only runs, and retains deployed files', t => {
  const { result, receipt, baseline, candidateDeployedFile } = runQueueAssembleCli(
    t, [{ id: 'TASK-10' }], { advanceQaBaseline: true, useLatestAsInput: true }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(receipt.status, 'assembled-local');
  assert.equal(receipt.baseline, baseline);
  assert.equal(receipt.qaSourceReceipt.sourceSha, baseline);
  assert.equal(receipt.qaSourceReceipt.runNumber, 91);
  assert.equal(candidateDeployedFile, 'already deployed to QA');
});

test('removes a local candidate when the successful QA release baseline changes during assembly', t => {
  const { result, receipt, baseline, latestQaSha, candidateExists } = runQueueAssembleCli(
    t, [{ id: 'TASK-10' }], {
      advanceQaBaseline: true,
      qaReleaseSequence: [{ source: 'input' }, { source: 'latest', runId: 960, runNumber: 96, createdAt: '2026-11-27T10:00:00Z' }]
    }
  );
  assert.equal(result.status, 1);
  assert.equal(receipt, null);
  assert.match(result.stderr, /stale QA baseline/i);
  assert.ok(result.stderr.includes(latestQaSha));
  assert.equal(candidateExists, false);
});

test('fails closed when the newest successful QA release used workflow_dispatch without an immutable receipt', t => {
  const { result, receipt } = runQueueAssembleCli(
    t, [{ id: 'TASK-10' }], { qaReleaseEvent: 'workflow_dispatch' }
  );
  assert.equal(result.status, 1);
  assert.equal(receipt, null);
  assert.match(result.stderr, /workflow_dispatch/i);
  assert.match(result.stderr, /refusing to guess/i);
});


test('fails closed when a newer push run is an unsuccessful QA release attempt', t => {
  const { result, receipt } = runQueueAssembleCli(
    t, [{ id: 'TASK-10' }], {
      qaReleaseSequence: [{
        source: 'latest',
        newerRunOperation: 'release',
        newerRunConclusion: 'failure'
      }]
    }
  );
  assert.equal(result.status, 1);
  assert.equal(receipt, null);
  assert.match(result.stderr, /newer QA release attempt #95 did not complete successfully/i);
});


test('recognizes a rerun of an older release as the latest actual QA deployment', t => {
  const { result, receipt, baseline, candidateDeployedFile } = runQueueAssembleCli(
    t, [{ id: 'TASK-10' }], {
      advanceQaBaseline: true,
      useLatestAsInput: true,
      qaReleaseSequence: [{
        source: 'latest',
        rerunOlderRelease: true,
        updatedAt: '2026-11-26T08:44:11Z'
      }]
    }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(receipt.status, 'assembled-local');
  assert.equal(receipt.qaSourceReceipt.runNumber, 90);
  assert.equal(receipt.qaSourceReceipt.sourceSha, baseline);
  assert.equal(candidateDeployedFile, 'already deployed to QA');
});

test('CLI assemble persists an immutable candidate receipt and resumes the same SHA after a failed push', t => {
  const fixture = runQueueAssembleCli(t, [{ id: 'TASK-10' }], {
    push: true,
    failFirstPush: true
  });
  assert.notEqual(fixture.result.status, 0);
  assert.match(fixture.result.stderr, /Create-only candidate push failed/);
  assert.ok(fixture.candidateExists);
  assert.ok(existsSync(fixture.receiptPath));
  const saved = JSON.parse(readFileSync(fixture.receiptPath, 'utf8'));
  assert.equal(saved.version, 1);
  assert.equal(saved.baseline, fixture.baseline);
  assert.equal(saved.branch, 'integration/qa-batch-' + fixture.baseline.slice(0, 12));
  assert.equal(saved.candidate, fixture.git('rev-parse', fixture.candidateRef));
  assert.deepEqual(saved.taskIds, ['TASK-10']);
  assert.equal(saved.tasks[0].prNumber, 1);
  assert.equal(fixture.remoteSha(), null);

  const retry = fixture.runQueue(['assemble', fixture.baseline, '--push']);
  assert.equal(retry.status, 0, retry.stderr);
  const resumed = JSON.parse(retry.stdout);
  assert.equal(resumed.status, 'pushed');
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.pushStatus, 'created');
  assert.equal(resumed.candidate, saved.candidate);
  assert.equal(fixture.remoteSha(), saved.candidate);

  const idempotent = fixture.runQueue(['assemble', fixture.baseline, '--push']);
  assert.equal(idempotent.status, 0, idempotent.stderr);
  const repeated = JSON.parse(idempotent.stdout);
  assert.equal(repeated.candidate, saved.candidate);
  assert.equal(repeated.pushStatus, 'already-present');
  assert.equal(fixture.remoteSha(), saved.candidate);

  fixture.git('update-ref', '-d', fixture.candidateRef, saved.candidate);
  const remoteOnly = fixture.runQueue(['assemble', fixture.baseline, '--push']);
  assert.equal(remoteOnly.status, 0, remoteOnly.stderr);
  assert.equal(JSON.parse(remoteOnly.stdout).candidate, saved.candidate);
  assert.equal(JSON.parse(remoteOnly.stdout).status, 'pushed');
});

test('CLI assemble refuses to overwrite a remote candidate with a different SHA', t => {
  const fixture = runQueueAssembleCli(t, [{ id: 'TASK-10' }]);
  assert.equal(fixture.result.status, 0, fixture.result.stderr);
  const saved = JSON.parse(readFileSync(fixture.receiptPath, 'utf8'));
  fixture.git('switch', '-qc', 'other-window', fixture.baseline);
  writeFileSync(join(fixture.cwd ?? '', 'other-window.txt'), 'other window candidate');
  fixture.git('add', 'other-window.txt');
  fixture.git('commit', '-qm', 'Other window candidate');
  const otherSha = fixture.git('rev-parse', 'HEAD');
  fixture.git('push', '--force-with-lease=refs/heads/' + saved.branch + ':',
    fixture.remotePath, otherSha + ':refs/heads/' + saved.branch);
  fixture.git('switch', '-q', 'main');

  const retry = fixture.runQueue(['assemble', fixture.baseline, '--push']);
  assert.notEqual(retry.status, 0);
  assert.match(retry.stderr, /Remote candidate branch exists at a different SHA/);
  assert.equal(fixture.remoteSha(), otherSha);
  assert.equal(fixture.git('rev-parse', fixture.candidateRef), saved.candidate);
  assert.ok(existsSync(fixture.receiptPath));
});

test('CLI assemble only invalidates a local candidate after exact coordinator confirmation', t => {
  const fixture = runQueueAssembleCli(t, [{ id: 'TASK-10' }]);
  assert.equal(fixture.result.status, 0, fixture.result.stderr);
  const saved = JSON.parse(readFileSync(fixture.receiptPath, 'utf8'));

  const wrong = fixture.runQueue([
    'invalidate', fixture.baseline, '--confirm-candidate=' + '9'.repeat(40)
  ]);
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /Confirmation SHA does not match/);
  assert.ok(existsSync(fixture.receiptPath));
  assert.equal(fixture.git('rev-parse', fixture.candidateRef), saved.candidate);

  const invalidated = fixture.runQueue([
    'invalidate', fixture.baseline, '--confirm-candidate=' + saved.candidate
  ]);
  assert.equal(invalidated.status, 0, invalidated.stderr);
  assert.equal(JSON.parse(invalidated.stdout).status, 'invalidated-candidate');
  assert.equal(existsSync(fixture.receiptPath), false);
  assert.equal(spawnSync('git', ['show-ref', '--verify', '--quiet', fixture.candidateRef], { cwd: fixture.cwd }).status, 1);

  const reassembled = fixture.runQueue(['assemble', fixture.baseline]);
  assert.equal(reassembled.status, 0, reassembled.stderr);
  assert.equal(JSON.parse(reassembled.stdout).status, 'assembled-local');
  assert.ok(existsSync(fixture.receiptPath));
});

test('CLI invalidate refuses to delete a candidate that already exists remotely', t => {
  const fixture = runQueueAssembleCli(t, [{ id: 'TASK-10' }]);
  assert.equal(fixture.result.status, 0, fixture.result.stderr);
  const saved = JSON.parse(readFileSync(fixture.receiptPath, 'utf8'));
  fixture.git('push', '--force-with-lease=refs/heads/' + saved.branch + ':',
    fixture.remotePath, saved.candidate + ':refs/heads/' + saved.branch);

  const invalidated = fixture.runQueue([
    'invalidate', fixture.baseline, '--confirm-candidate=' + saved.candidate
  ]);
  assert.notEqual(invalidated.status, 0);
  assert.match(invalidated.stderr, /Remote candidate exists at the confirmed SHA/);
  assert.equal(fixture.remoteSha(), saved.candidate);
  assert.equal(fixture.git('rev-parse', fixture.candidateRef), saved.candidate);
  assert.ok(existsSync(fixture.receiptPath));
});

test('ready-batch workflow archives a candidate before pushing and restores it by prior run ID', () => {
  const workflow = readFileSync(new URL('../.github/workflows/engineering-ready-batch.yml', import.meta.url), 'utf8');
  const download = workflow.indexOf('actions/download-artifact@v4');
  const restore = workflow.indexOf('Restore exact candidate bundle and immutable receipt');
  const assemble = workflow.indexOf('Assemble one immutable candidate locally');
  const archive = workflow.indexOf('Archive exact candidate and receipt before pushing');
  const upload = workflow.indexOf('actions/upload-artifact@v4');
  const push = workflow.indexOf('Push the exact archived candidate (create-only)');
  assert.ok(download >= 0 && download < restore);
  assert.ok(restore < assemble && assemble < archive && archive < upload && upload < push);
  assert.match(workflow, /resume_run_id:/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /git bundle create/);
  assert.match(workflow, /retention-days: 90/);
  assert.match(workflow, /cancel-in-progress: false/);
});

test('CLI invalidate deletes a remote candidate only with exact SHA and explicit remote-delete confirmation', async t => {
  const fixture = runQueueAssembleCli(t, [{ id: 'TASK-10' }]);
  assert.equal(fixture.result.status, 0, fixture.result.stderr);
  const saved = JSON.parse(readFileSync(fixture.receiptPath, 'utf8'));
  fixture.git('push', '--force-with-lease=refs/heads/' + saved.branch + ':',
    fixture.remotePath, saved.candidate + ':refs/heads/' + saved.branch);

  const invalidated = fixture.runQueue([
    'invalidate', fixture.baseline, '--confirm-candidate=' + saved.candidate, '--delete-remote'
  ]);
  assert.equal(invalidated.status, 0, invalidated.stderr);
  const result = JSON.parse(invalidated.stdout);
  assert.equal(result.status, 'invalidated-candidate');
  assert.equal(result.remoteRefDeleted, true);
  assert.equal(fixture.remoteSha(), null);
  assert.equal(existsSync(fixture.receiptPath), false);
  assert.equal(spawnSync('git', ['show-ref', '--verify', '--quiet', fixture.candidateRef], { cwd: fixture.cwd }).status, 1);
});

test('CLI invalidate never deletes a different remote SHA even with explicit remote-delete confirmation', t => {
  const fixture = runQueueAssembleCli(t, [{ id: 'TASK-10' }]);
  assert.equal(fixture.result.status, 0, fixture.result.stderr);
  const saved = JSON.parse(readFileSync(fixture.receiptPath, 'utf8'));
  fixture.git('switch', '-qc', 'other-window', fixture.baseline);
  writeFileSync(join(fixture.cwd, 'other-window.txt'), 'other window candidate');
  fixture.git('add', 'other-window.txt');
  fixture.git('commit', '-qm', 'Other window candidate');
  const otherSha = fixture.git('rev-parse', 'HEAD');
  fixture.git('push', '--force-with-lease=refs/heads/' + saved.branch + ':',
    fixture.remotePath, otherSha + ':refs/heads/' + saved.branch);
  fixture.git('switch', '-q', 'main');

  const invalidated = fixture.runQueue([
    'invalidate', fixture.baseline, '--confirm-candidate=' + saved.candidate, '--delete-remote'
  ]);
  assert.notEqual(invalidated.status, 0);
  assert.match(invalidated.stderr, /Remote candidate ref is a different SHA/);
  assert.equal(fixture.remoteSha(), otherSha);
  assert.equal(fixture.git('rev-parse', fixture.candidateRef), saved.candidate);
  assert.ok(existsSync(fixture.receiptPath));
});

test('engineering-only test and script changes do not trigger unrelated app regression suites', () => {
  const tutorial = readFileSync(new URL('../.github/workflows/tutorial-regression.yml', import.meta.url), 'utf8');
  const font = readFileSync(new URL('../.github/workflows/font-runtime-regression.yml', import.meta.url), 'utf8');
  const chat = readFileSync(new URL('../.github/workflows/chat-regression-contract.yml', import.meta.url), 'utf8');
  const section = (source, begin, end) => source.split(begin)[1].split(end)[0];

  assert.equal(tutorial.includes("- 'package.json'"), false);
  assert.ok(tutorial.includes("- 'package-lock.json'"));

  const fontPr = section(font, '  pull_request:', '  push:');
  const fontPush = section(font, '  push:', 'permissions:');
  assert.equal(fontPr.includes("package.json"), false);
  assert.equal(fontPr.includes("font-runtime-regression.yml"), false);
  assert.ok(fontPr.includes("package-lock.json"));
  assert.ok(fontPush.includes("package-lock.json"));
  assert.ok(fontPush.includes("font-runtime-regression.yml"));

  const chatPr = section(chat, '  pull_request:', '  workflow_dispatch:');
  const chatPush = section(chat, '  push:', '  pull_request:');
  for (const paths of [chatPr, chatPush]) {
    assert.equal(paths.includes("- 'package.json'"), false);
    assert.ok(paths.includes("- 'package-lock.json'"));
    assert.ok(paths.includes("- 'tests/**'"));
    assert.ok(paths.includes("- '!tests/engineering-*.test.mjs'"));
  }
  assert.equal(chatPr.includes("chat-regression-contract.yml"), false);
  assert.ok(chatPush.includes("chat-regression-contract.yml"));
});
