import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const serviceWorker = read('sw.js');
const desktopScript = read('desktop/js/script.js');
const homePage = read('index.html');
assert.match(serviceWorker, /const CACHE_NAME = 'phone-app-pwa-v186'/);
assert.ok(serviceWorker.includes('./settings/mcp-connections.html'));
assert.ok(serviceWorker.includes('./shared/js/phone/mcp-client.js?v=20261108m'));
assert.ok(serviceWorker.includes('./shared/js/phone/mcp-role-permissions.js?v=20261108a'));
assert.ok(serviceWorker.includes('./shared/js/phone/mcp-ai-tools.js?v=20261108a'));
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


test('MCP settings page and PWA shell load the same guarded client and role-permission versions', () => {
  const mcpPage = read('settings/mcp-connections.html');
  assert.ok(mcpPage.includes('mcp-client.js?v=20261108m'));
  assert.ok(mcpPage.includes('mcp-role-permissions.js?v=20261108a'));
  assert.ok(serviceWorker.includes('./shared/js/phone/mcp-client.js?v=20261108m'));
  assert.ok(serviceWorker.includes('./shared/js/phone/mcp-role-permissions.js?v=20261108a'));
});
