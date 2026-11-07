import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const loader = read('shared/js/font-loader.js');
const settings = read('settings/font-settings.html');
const serviceWorker = read('sw.js');

test('custom font files are warmed into a dedicated persistent cache', () => {
  assert.match(loader, /FONT_CACHE_NAME = 'maomao-font-assets-v1'/);
  assert.match(loader, /function cacheFontBlob\(id, blob, format\)/);
  assert.match(loader, /cache\.put\(url, response\)/);
  assert.match(loader, /FONT_CACHE_FORMAT_PREFIX \+ id/);
  assert.match(loader, /new URL\('\.\.\/\.\.\/__maomao_fonts\//);
});

test('cached font presets bypass repeated IndexedDB Blob reads on controlled app pages', () => {
  const cachedFastPath = loader.indexOf('if (cachedFormat && hasFontServiceWorker())');
  const indexedDbFallback = loader.indexOf("indexedDB.open('maomao-font-presets', 1)");
  assert.ok(cachedFastPath >= 0, 'cached-font fast path must exist');
  assert.ok(indexedDbFallback > cachedFastPath, 'IndexedDB must remain a fallback after the cache fast path');
  assert.match(loader, /applyUrl\(cachedUrl, cachedFormat\)/);
});

test('font fetching and decoding starts during document parsing', () => {
  assert.match(loader, /rel = 'preload'/);
  assert.match(loader, /document\.fonts\.load\('14px "MAOMAOUserFont"'/);
  assert.match(loader, /font-display:swap/);
});

test('font settings waits for the cache warm-up before reporting success', () => {
  assert.match(settings, /return Promise\.resolve\(activatePreset\(record\)\)\.then\(function \(cacheReady\)/);
  assert.match(settings, /跨应用字体缓存已准备好/);
  assert.match(settings, /removeCached\(id\)/);
});

test('service worker serves cached font assets from a same-origin route', () => {
  assert.match(serviceWorker, /const FONT_ASSET_CACHE = 'maomao-font-assets-v1'/);
  assert.match(serviceWorker, /new URL\('__maomao_fonts\/', self\.registration\.scope\)/);
  assert.match(serviceWorker, /cache\.match\(req\)/);
  assert.match(serviceWorker, /return cached \|\| new Response\('', \{/);
});

test('font asset cache survives app-shell version upgrades', () => {
  assert.match(serviceWorker, /const CACHE_NAME = 'phone-app-pwa-v174'/);
  assert.match(serviceWorker, /keys\.filter\(key => key\.startsWith\('phone-app-'\) && key !== CACHE_NAME\)/);
  assert.doesNotMatch(serviceWorker, /key\.startsWith\('maomao-font-assets/);
});
