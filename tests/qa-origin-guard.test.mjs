import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the exact origin guard used by the QA release preflight, not a
// separately maintained regex that could drift away from the release script.
const source = readFileSync(new URL('../scripts/qa-direct-release.mjs', import.meta.url), 'utf8');
const guardLine = source.split('\n').find(line =>
  line.includes('assert.match(origin, ') &&
  line.includes("'Unexpected repository origin'")
);
assert.ok(guardLine, 'QA release must check the origin repository');
const match = guardLine.match(/assert\.match\(origin,\s*(\/.*\/),\s*'Unexpected repository origin'\);/);
assert.ok(match, 'QA origin check must keep an explicit regex');
const originPattern = new RegExp(match[1].slice(1, -1));

test('QA release accepts only the original and renamed repository URLs', () => {
  for (const origin of [
    'https://github.com/Bella0960/MAOMAO',
    'https://github.com/Bella0960/MAOMAO.git',
    'https://github.com/Bella0960/q7v2k9n4x6r8',
    'https://github.com/Bella0960/q7v2k9n4x6r8.git',
    'git@github.com:Bella0960/MAOMAO.git',
    'ssh://git@github.com/Bella0960/q7v2k9n4x6r8.git',
  ]) {
    assert.match(origin, originPattern, origin);
  }
});

test('QA release rejects unexpected repository identities and lookalikes', () => {
  for (const origin of [
    'https://github.com/Other/q7v2k9n4x6r8',
    'https://github.com/Bella0960/q7v2k9n4x6r8-copy',
    'https://github.com/Bella0960/MAOMAO/fork',
    'https://example.com/Bella0960/MAOMAO',
    'https://github.com/Bella0960/another-repository',
    'https://github.com/Bella0960/MAOMAO.git?ref=main',
  ]) {
    assert.doesNotMatch(origin, originPattern, origin);
  }
});
