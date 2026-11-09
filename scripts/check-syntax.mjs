import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const excludedRoots = new Set([
  '.git',
  '.wrangler',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results'
]);

function fail(message) {
  process.stderr.write('[syntax-check] ' + message + '\\n');
  process.exitCode = 1;
}

const tracked = spawnSync('git', ['ls-files', '-z'], {
  cwd: repositoryRoot,
  encoding: 'buffer'
});

if (tracked.error || tracked.status !== 0) {
  fail('Unable to enumerate tracked source files with git ls-files.');
  if (tracked.stderr) process.stderr.write(String(tracked.stderr));
  process.exit(1);
}

const candidates = tracked.stdout.toString('utf8')
  .split('\\0')
  .filter(Boolean)
  .filter((file) => /\\.(?:c|m)?js$/i.test(file))
  .filter((file) => !excludedRoots.has(file.split('/')[0]))
  .sort();

if (candidates.length === 0) {
  fail('No tracked JavaScript source files were found; refusing a false pass.');
  process.exit(1);
}

const failures = [];
for (const relativePath of candidates) {
  const checked = spawnSync(process.execPath, ['--check', path.resolve(repositoryRoot, relativePath)], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  });
  if (checked.error || checked.status !== 0) {
    failures.push({
      file: relativePath,
      output: [checked.stderr, checked.stdout, checked.error?.message]
        .filter(Boolean)
        .join('\\n')
        .trim()
    });
  }
}

if (failures.length > 0) {
  process.stderr.write('[syntax-check] Failed files:\\n');
  for (const failure of failures) {
    process.stderr.write('\\n--- ' + failure.file + ' ---\\n');
    process.stderr.write((failure.output || 'Node --check failed without diagnostic.') + '\\n');
  }
  process.exit(1);
}

process.stdout.write(
  '[syntax-check] Passed: ' + candidates.length +
  ' tracked JavaScript files parsed by Node.js ' + process.versions.node + '.\\n' +
  '[syntax-check] This verifies syntax only; no style or semantic lint rules are configured.\\n'
);
