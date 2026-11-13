import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const serviceWorker = read('sw.js');
const desktopScript = read('desktop/js/script.js');
const homePage = read('index.html');
assert.match(serviceWorker, /const CACHE_NAME = 'phone-app-pwa-v207'/);
const viteConfig = read('vite.config.js');

test('build emits a manifest containing every HTML entry point', () => {
  assert.match(viteConfig, /Object\.keys\(htmlFiles\)[\s\S]*\.map\(page => page \+ '\.html'\)/);
  assert.match(viteConfig, /fileName: 'pwa-pages\.json'/);
  const pageManifest = JSON.parse(read('dist/pwa-pages.json'));
  assert.ok(pageManifest.includes('index.html'));
  assert.ok(pageManifest.includes('settings/settings.html'));
  assert.ok(pageManifest.includes('chat/chat/chat.html'));
  assert.ok(pageManifest.includes('worldbook/worldbook/worldbook.html'));
  assert.ok(pageManifest.includes('forum/forum.html'));
  assert.ok(pageManifest.every(page => typeof page === 'string' && page.endsWith('.html')));
});


test('every desktop app shortcut is emitted as a real HTML page in the production build', () => {
  const builtHome = read('dist/index.html');
  const pageManifest = JSON.parse(read('dist/pwa-pages.json'));
  const routes = [...builtHome.matchAll(/data-href="([^"]+\.html)"/g)].map(match => match[1]);

  assert.ok(routes.length >= 20, 'the built desktop must retain all app shortcuts');
  assert.equal(new Set(routes).size, routes.length, 'desktop app routes must be unique');
  for (const route of routes) {
    assert.ok(pageManifest.includes(route), 'app route missing from the PWA page manifest: ' + route);
    assert.ok(fs.existsSync(path.join(root, 'dist', route)), 'app route missing from production build output: ' + route);
  }
});

test('service worker stores public login pages but never precaches account-owned HTML', () => {
  assert.match(serviceWorker, /fetch\('\.\/pwa-pages\.json'/);
  assert.match(serviceWorker, /APP_SHELL\.concat\(pageEntries\)/);
  assert.match(serviceWorker, /filter\(url => url === '\.\/account\/index\.html'/);
  assert.match(serviceWorker, /cache\.add\(url\)/);
});

test('private navigation goes directly to Worker and never reuses cached protected HTML', () => {
  const start = serviceWorker.indexOf("if (req.mode === 'navigate' && !isPublicAccountPage)");
  const end = serviceWorker.indexOf("if (req.mode === 'navigate' && isPublicAccountPage)", start);
  assert.ok(start >= 0 && end > start, 'public and private navigation must use distinct paths');
  const privateRoute = serviceWorker.slice(start, end);
  assert.match(privateRoute, /return await fetch\(req\)/);
  assert.match(privateRoute, /new URL\('account\/index\.html'/, 'offline fallback must point only to the public login page');
  assert.match(privateRoute, /caches\.match\(entry\.href\)/, 'offline login is allowed');
  assert.doesNotMatch(privateRoute, /caches\.match\(req\)|caches\.open|event\.waitUntil/,
    'a protected HTML request itself must never be cached or served from cache');
});

test('desktop app navigation has one valid capture-phase owner', () => {
  assert.doesNotMatch(desktopScript, /data-href 点击跳转|target\.closest\('\[data-href\]'\)/,
    'desktop/js/script.js must not register a second bubble-phase app navigator');
  assert.match(homePage,
    /target\.closest\('\.app-tile\[data-href\]'\)[\s\S]*?new URL\(href, document\.baseURI\)[\s\S]*?destination\.origin !== window\.location\.origin[\s\S]*?window\.location\.assign\(destination\.href\);[\s\S]*?\}, true\);/,
    'index.html must retain the valid same-origin capture-phase app navigation handler');
});

test('failed app navigation never falls back to the desktop index page', () => {
  assert.doesNotMatch(serviceWorker, /cached \|\| caches\.match\('\.\/index\.html'\)/);
  assert.match(serviceWorker, /status: 503/);
});

test('public login uses fresh network HTML first, with offline-only cache fallback', () => {
  const start = serviceWorker.indexOf("if (req.mode === 'navigate' && isPublicAccountPage)");
  const end = serviceWorker.indexOf('// 所有历史版本参数的 font-loader', start);
  assert.ok(start > 0 && end > start);
  const route = serviceWorker.slice(start, end);
  assert.match(route, /fetch\(req, \{ cache: 'no-store' \}\)/);
  assert.match(route, /event\.waitUntil\(networkPromise/);
  const freshAt = route.indexOf('var fresh = await networkPromise;');
  const cachedAt = route.indexOf('var cached = await caches.match(req)');
  assert.ok(freshAt >= 0 && cachedAt > freshAt,
    'fresh HTML must be returned before consulting the offline cache');
  assert.match(route, /if \(cached\) return cached;/);
  assert.doesNotMatch(route, /if \(cached\) return cached;[\s\S]*?var fresh = await networkPromise;/);
});
