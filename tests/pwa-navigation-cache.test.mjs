import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const serviceWorker = read('sw.js');
const viteConfig = read('vite.config.js');

test('build emits a manifest containing every HTML entry point', () => {
  assert.match(viteConfig, /Object\.keys\(htmlFiles\)[\s\S]*\.map\(page => page \+ '\.html'\)/);
  assert.match(viteConfig, /fileName: 'pwa-pages\.json'/);
});

test('service worker precaches all HTML routes listed by the build manifest', () => {
  assert.match(serviceWorker, /fetch\('\.\/pwa-pages\.json'/);
  assert.match(serviceWorker, /APP_SHELL\.concat\(pageEntries\)/);
  assert.match(serviceWorker, /cache\.add\(url\)/);
});

test('mobile navigation serves cached app pages before waiting for network', () => {
  assert.match(serviceWorker, /var cachedPromise = caches\.match\(req\)/);
  assert.match(serviceWorker, /if \(cached\) return cached/);
  assert.match(serviceWorker, /event\.waitUntil\(updatePromise/);
});

test('failed app navigation never falls back to the desktop index page', () => {
  assert.doesNotMatch(serviceWorker, /cached \|\| caches\.match\('\.\/index\.html'\)/);
  assert.match(serviceWorker, /status: 503/);
});
