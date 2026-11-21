import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const config = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');

function setFromConfig(name) {
  const match = config.match(new RegExp('const ' + name + ' = new Set\\((\\[[\\s\\S]*?\\])\\)'));
  assert.ok(match, name + ' must be declared in vite.config.js');
  return runInNewContext('(' + match[1] + ')', Object.create(null));
}

function collectSource() {
  const marker = '(function collectHtml(dir, prefix) {';
  const start = config.indexOf(marker);
  const end = config.indexOf("})(__dirname, '');", start);
  assert.ok(start >= 0 && end > start, 'collectHtml function must exist in vite.config.js');
  return config.slice(start, end + 2);
}

// A directory where an archived page is followed by other HTML entries.
// With `return` the later siblings vanish; with `continue` they are kept.
const tree = {
  '': [
    { name: 'index.html', isDirectory: () => false },
    { name: 'previews', isDirectory: () => true },
    { name: 'docs', isDirectory: () => true },
    { name: 'worker', isDirectory: () => true }
  ],
  'previews': [
    { name: 'diary-redesign.html', isDirectory: () => false },
    { name: 'other.html', isDirectory: () => false },
    { name: 'zzz.html', isDirectory: () => false }
  ],
  'docs': [
    { name: 'audit-report.html', isDirectory: () => false },
    { name: 'spec.html', isDirectory: () => false }
  ],
  'worker': [
    { name: 'secret.html', isDirectory: () => false }
  ]
};

function discover() {
  const htmlFiles = {};
  const context = {
    fs: { readdirSync: (dir) => tree[dir] || [] },
    resolve: (dir, name) => dir + name,
    excludedHtmlDirs: new Set(setFromConfig('excludedHtmlDirs')),
    privateRuntimeDirs: new Set(setFromConfig('privateRuntimeDirs')),
    archivedHtmlPaths: new Set(setFromConfig('archivedHtmlPaths')),
    htmlFiles
  };
  runInNewContext(
    'const collectHtml = ' + collectSource() + ";\ncollectHtml('', '');",
    context
  );
  return htmlFiles;
}

test('archived HTML is skipped without dropping sibling HTML in the same directory', () => {
  const pages = discover();
  for (const archived of setFromConfig('archivedHtmlPaths')) {
    const key = archived.replace(/\.html$/, '');
    assert.equal(Object.prototype.hasOwnProperty.call(pages, key), false,
      archived + ' must not be a Vite HTML entry');
  }
  assert.equal('previews/other' in pages, true,
    'sibling after an archived preview must still be discovered');
  assert.equal('previews/zzz' in pages, true,
    'later sibling in the same directory must still be discovered');
  assert.equal('docs/spec' in pages, true,
    'sibling after an archived document must still be discovered');
  assert.equal('index' in pages, true, 'root HTML entry must remain');
  assert.equal('worker/secret' in pages, false, 'private runtime dir must remain excluded');
});
