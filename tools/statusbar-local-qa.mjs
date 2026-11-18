/**
 * UI-STATUS-001: run the existing real tests locally, without GitHub Actions,
 * Cloudflare Workers Builds, a second QA Worker, or production access.
 *
 * Usage: node tools/statusbar-local-qa.mjs [--install] [--install-browser] [--with-pwa] [--root PATH]
 * Writes a JSON report and per-command logs under the OS temporary directory.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node tools/statusbar-local-qa.mjs [--install] [--install-browser] [--with-pwa] [--root PATH]');
  console.log('Runs existing Node contracts, Chromium DOM checks, and Vite build locally.');
  console.log('No cloud builds, deployment, branch changes, or database access.');
  process.exit(0);
}
const known = new Set(['--install', '--install-browser', '--with-pwa', '--root']);
if (args.some(arg => arg.startsWith('--') && !known.has(arg))) {
  console.error('Unknown argument. Use --help for usage.');
  process.exit(2);
}
const rootIndex = args.indexOf('--root');
if (rootIndex >= 0 && (!args[rootIndex + 1] || args[rootIndex + 1].startsWith('--'))) {
  console.error('--root must be followed by a directory.');
  process.exit(2);
}
const root = path.resolve(rootIndex >= 0 ? args[rootIndex + 1] : path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maomao-statusbar-qa-'));
const report = { taskId: 'UI-STATUS-001', root, startedAt: new Date().toISOString(),
  commit: null, stages: [], result: 'BLOCKED', verified: { sourcePreflight: false, browser: false, build: false },
  note: 'Local evidence only; no QA deployment, mobile device or production verification.' };

function run(name, command, argv, timeoutMs = 480000) {
  const startedAt = new Date().toISOString();
  const proc = spawnSync(command, argv, {
    cwd: root, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 12 * 1024 * 1024,
    env: { ...process.env, CI: '1', NO_COLOR: '1' }, shell: process.platform === 'win32'
  });
  const logfile = path.join(reportDir, `${String(report.stages.length + 1).padStart(2, '0')}-${name}.log`);
  fs.writeFileSync(logfile, `${proc.stdout || ''}\n${proc.stderr || ''}\n`, 'utf8');
  const stage = { name, command: [command, ...argv], startedAt, exitCode: proc.status,
    result: proc.error ? 'BLOCKED' : proc.status === 0 ? 'PASS' : 'FAIL', log: logfile,
    error: proc.error?.message || null };
  report.stages.push(stage);
  console.log(`${stage.result.padEnd(7)} ${name} — ${logfile}`);
  return stage;
}
function writeReport() {
  report.finishedAt = new Date().toISOString();
  const dest = path.join(reportDir, 'summary.json');
  fs.writeFileSync(dest, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`Summary: ${dest}`);
  return dest;
}

const required = [
  'package.json', 'package-lock.json', 'shared/js/statusbar-control.js',
  'tests/global-statusbar-wiring.test.mjs', 'tests/global-statusbar-browser.mjs',
  'inspect-phone/phone.html'
];
const missing = required.filter(file => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  report.stages.push({ name: 'source-preflight', result: 'BLOCKED', missing });
  console.error('BLOCKED: not a complete MAOMAO source tree. Missing: ' + missing.join(', '));
  writeReport();
  process.exit(2);
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.name !== 'phone-simulator') {
  report.stages.push({ name: 'project-identity', result: 'BLOCKED', actual: pkg.name });
  console.error('BLOCKED: wrong project root. Expected package name phone-simulator.');
  writeReport();
  process.exit(2);
}
// Prevent a partial fixture or stale export from being reported as a full app run.
const ignoredDirs = new Set(['.git', '.github', '.wrangler', 'node_modules', 'dist', 'tests', 'test-results', 'coverage']);
function countHtml(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ignoredDirs.has(entry.name)) continue;
    const location = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countHtml(location);
    else if (entry.name.endsWith('.html')) count++;
  }
  return count;
}
const htmlPages = countHtml(root);
report.htmlPages = htmlPages;
if (htmlPages < 80 || !/\bvite\s+build\b/.test(pkg.scripts?.build || '')) {
  report.stages.push({ name: 'full-repo-preflight', result: 'BLOCKED', htmlPages,
    buildScript: pkg.scripts?.build || null });
  console.error('BLOCKED: incomplete source or missing real Vite build script.');
  writeReport();
  process.exit(2);
}
report.verified.sourcePreflight = true;
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10000 });
if (git.status === 0) {
  report.commit = git.stdout.trim();
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', timeout: 10000 });
  report.dirtyWorktree = status.status === 0 ? Boolean(status.stdout.trim()) : null;
  if (report.dirtyWorktree) report.note += ' Working tree has changes; tests do not necessarily match the recorded HEAD.';
} else report.note += ' Git SHA could not be read; identify snapshot manually.';

const viteBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
if (args.includes('--install')) {
  const installed = run('install', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci']);
  if (installed.result !== 'PASS') {
    report.result = installed.result;
    writeReport();
    process.exit(installed.result === 'BLOCKED' ? 2 : 1);
  }
}
if (!fs.existsSync(viteBin)) {
  report.stages.push({ name: 'dependency-preflight', result: 'BLOCKED', missing: 'node_modules/.bin/vite' });
  console.error('BLOCKED: dependencies missing. Run with --install or restore an existing node_modules directory.');
  writeReport();
  process.exit(2);
}
if (args.includes('--install-browser')) {
  const browser = run('install-chromium', process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['--no-install', 'playwright', 'install', 'chromium']);
  if (browser.result !== 'PASS') {
    report.result = browser.result;
    writeReport();
    process.exit(browser.result === 'BLOCKED' ? 2 : 1);
  }
}

const node = process.execPath;
run('statusbar-node', node, ['--test', 'tests/global-statusbar-wiring.test.mjs']);
const browserStage = run('statusbar-chromium', node, ['tests/global-statusbar-browser.mjs']);
report.verified.browser = browserStage.result === 'PASS';
const buildStage = run('vite-build', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']);
report.verified.build = buildStage.result === 'PASS';
if (args.includes('--with-pwa')) {
  run('pwa-navigation', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'test:pwa:navigation']);
}
report.result = report.stages.every(s => s.result === 'PASS') ? 'PASS' : 'FAIL';
writeReport();
process.exit(report.result === 'PASS' ? 0 : 1);
