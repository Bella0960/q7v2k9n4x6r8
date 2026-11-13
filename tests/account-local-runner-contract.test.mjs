import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(path.join(root, 'scripts/run-account-auth-gate.mjs'), 'utf8');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

test('local acceptance gate invokes real scripts instead of removed npm aliases', () => {
  assert.doesNotMatch(source, /['"]check:syntax['"]|['"]test:accounts:all['"]/);
  assert.match(source, /args:\s*\['scripts\/check-syntax\.mjs'\]/);
  assert.match(source, /args:\s*\['run', 'build'\]/);
  assert.match(source, /args:\s*\['tests\/account-worker-runtime-e2e\.mjs'\]/);
  assert.match(source, /shell:\s*process\.platform\s*===\s*'win32'\s*&&\s*!step\.command/);
});

test('local acceptance gate builds through required release tests', () => {
  assert.match(pkg.scripts.prebuild, /test:release:gate/);
  assert.match(pkg.scripts['test:release:gate'], /test:release:accounts/);
  assert.ok(existsSync(path.join(root, 'scripts/check-syntax.mjs')));
  assert.ok(existsSync(path.join(root, 'tests/account-worker-runtime-e2e.mjs')));
  assert.ok(existsSync(path.join(root, 'wrangler.preview.jsonc')));
});

test('local SQLite E2E uses disposable state and refuses to overwrite existing credentials', () => {
  const workerTest = readFileSync(path.join(root, 'tests/account-worker-runtime-e2e.mjs'), 'utf8');
  assert.match(workerTest, /mkdtemp\(/);
  assert.match(workerTest, /existsSync\(VARS_PATH\)/);
  assert.match(workerTest, /Refusing to overwrite existing \.dev\.vars/);
  assert.match(workerTest, /'--local'/);
  assert.match(workerTest, /rm\(/);
});
