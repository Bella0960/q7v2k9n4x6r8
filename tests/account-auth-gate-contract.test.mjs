import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
);
const accountWorkflow = readFileSync(
  new URL('../.github/workflows/mao-account-auth-contract.yml', import.meta.url),
  'utf8'
);

test('complete account gate runs every required suite in the approved order', () => {
  const expected = [
    'test:accounts',
    'test:admin:center',
    'test:preview:config',
    'build',
    'test:cloud:push',
    'test:font:runtime',
    'test:desktop:layout',
    'test:pwa:navigation'
  ];
  const command = packageJson.scripts['test:accounts:all'];
  assert.equal(typeof command, 'string', 'one documented full-gate command must exist');

  const actual = command.split(/\s*&&\s*/).map(part => {
    const match = /^npm run ([a-z0-9:_-]+)$/.exec(part);
    assert.ok(match, `unexpected or unsafe gate command segment: ${part}`);
    return match[1];
  });
  assert.deepEqual(actual, expected,
    'the account gate must not silently omit, duplicate, or reorder a required stage');

  for (const scriptName of expected) {
    assert.equal(typeof packageJson.scripts[scriptName], 'string',
      `the gate references missing npm script: ${scriptName}`);
  }
});

test('account workflow runs syntax, dependency and full-gate commands', () => {
  assert.match(accountWorkflow, /name:\s*MAO Account Auth Contract/);
  assert.match(accountWorkflow, /runs-on:\s*ubuntu-latest/);
  assert.match(accountWorkflow, /node-version:\s*22/);
  assert.match(accountWorkflow, /run:\s*npm run check:syntax/);
  assert.match(accountWorkflow, /run:\s*npm ci/);
  assert.match(accountWorkflow, /run:\s*npm run test:accounts:all/);
});

test('changes to every account-gate input can trigger the contract workflow', () => {
  const requiredPaths = [
    "      - 'account/**'",
    "      - 'admin/**'",
    "      - 'worker/**'",
    "      - 'tests/account-*.test.mjs'",
    "      - 'tests/admin-center-*.test.mjs'",
    "      - 'tests/helpers/**'",
    "      - 'tests/preview-deployment-isolation.test.mjs'",
    "      - 'wrangler.jsonc'",
    "      - 'wrangler.preview.jsonc'",
    "      - '.github/workflows/deploy-mao-auth-preview.yml'",
    "      - 'package.json'",
    "      - 'package-lock.json'"
  ];
  for (const path of requiredPaths) {
    assert.ok(accountWorkflow.includes(path), `workflow path filter is missing: ${path}`);
  }
});

test('the syntax command is honestly named and does not expose a fake lint alias', () => {
  assert.equal(packageJson.scripts['check:syntax'], 'node scripts/check-syntax.mjs');
  assert.equal(Object.hasOwn(packageJson.scripts, 'lint'), false,
    'syntax-only validation must not be advertised as a full lint');
});
