import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkInlineSource,
  extractInlineScripts,
  isIgnoredDirectory
} from '../scripts/lint.mjs';

test('inline script extraction checks classic and module JavaScript only', () => {
  const html = [
    '<script src="/external.js"></script>',
    '<script type="application/json">{"ok":true}</script>',
    '<script type="importmap">{"imports":{}}</script>',
    '<script>window.ready = true;</script>',
    '<script type="module">export const ready = true;</script>',
    '<script type="text/babel">const view = <div />;</script>'
  ].join('');
  const scripts = extractInlineScripts(html);
  assert.equal(scripts.length, 2);
  assert.deepEqual(scripts.map(item => item.mode), ['commonjs', 'module']);
  assert.deepEqual(scripts.map(item => item.scriptIndex), [4, 5]);
});

test('inline syntax check accepts valid code and rejects invalid code', () => {
  assert.equal(checkInlineSource('const value = 1;', 'valid.html#script-1').ok, true);
  const invalid = checkInlineSource('const = ;', 'invalid.html#script-1');
  assert.equal(invalid.ok, false);
  assert.match(invalid.output, /SyntaxError/);
});

test('generated and vendor directories are excluded deliberately', () => {
  for (const name of ['node_modules', 'dist', '.git', '.wrangler', 'coverage', 'test-results']) {
    assert.equal(isIgnoredDirectory(name), true, name);
  }
  assert.equal(isIgnoredDirectory('chat'), false);
  assert.equal(isIgnoredDirectory('tests'), false);
});
