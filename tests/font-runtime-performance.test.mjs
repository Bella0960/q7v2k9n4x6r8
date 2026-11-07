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
  const cachedFastPath = loader.indexOf('if (cachedUrl && hasFontServiceWorker())');
  const indexedDbFallback = loader.indexOf('loadPresetFromIndexedDb(source, isStillCurrent);');
  assert.ok(cachedFastPath >= 0, 'cached-font fast path must exist');
  assert.ok(indexedDbFallback > cachedFastPath, 'IndexedDB must remain a fallback after the cache fast path');
  assert.match(loader, /applyUrl\(cachedUrl, cachedFormat\)/);
});

test('font styling is deferred past DOMContentLoaded, one frame, and an idle slot', () => {
  /* 预加载/解码请求仍然存在，但真正的样式注入必须排在新时序的空闲阶段。 */
  assert.match(loader, /rel = 'preload'/);
  assert.match(loader, /document\.fonts\.load\('14px "MAOMAOUserFont"'/);
  assert.match(loader, /font-display:swap/);
  assert.match(loader, /document\.addEventListener\('DOMContentLoaded', afterFrame/, 'must wait for DOMContentLoaded before scheduling a frame');
  assert.match(loader, /window\.requestAnimationFrame\(function \(\) \{ whenIdle\(run\); \}\)/, 'font work must run after a rendered frame');
  assert.match(loader, /requestIdleCallback\(callback, \{ timeout: 1000 \}\)/, 'font work must yield to an idle slot with a bounded timeout');
});

test('heavy font work is deferred to an idle slot after first paint', () => {
  assert.match(loader, /requestIdleCallback/, 'font application must use idle time');
  assert.match(loader, /document\.addEventListener\('DOMContentLoaded', afterFrame/, 'font application must wait for DOMContentLoaded');
  assert.match(loader, /requestAnimationFrame/, 'font application must wait for a rendered frame');
});

test('an IndexedDB font request remains usable when the same preset is reselected after an intermediate switch', () => {
  assert.match(loader, /function fontRequestIsRelevant\(source, isStillCurrent\)/);
  assert.match(loader, /return isStillCurrent\(\) \|\| readActiveFontSource\(\)\.key === source\.key/);
  assert.match(loader, /if \(failedFontKey === source\.key \|\| !fontRequestIsRelevant\(source, isStillCurrent\)\)/);
});

test('font source application is idempotent per document', () => {
  assert.match(loader, /if \(key && key === appliedFontKey && hasAppliedFontStyle\(\)\) return false;/);
  assert.match(loader, /if \(source\.key !== 'none' && source\.key === appliedFontKey && hasAppliedFontStyle\(\)\)/);
  assert.match(loader, /appliedFontKey/, 'runtime must remember the applied font key');
});

test('existing cache entries are never rewritten on subsequent pages', () => {
  assert.match(loader, /return cache\.match\(url\)\.then\(function \(existing\) \{/);
  assert.match(loader, /if \(existing\) \{/, 'cache hit must skip cache.put');
});

test('pages without a service worker controller still read Cache Storage, not IndexedDB', () => {
  assert.match(loader, /if \(cachedUrl && window\.caches\) \{/);
  assert.match(loader, /caches\.match\(cachedUrl\)/, 'no-controller path must read Cache Storage directly');
  const cacheRead = loader.indexOf('caches.match(cachedUrl)');
  const indexedDbFallback = loader.indexOf('loadPresetFromIndexedDb(source, isStillCurrent);', cacheRead);
  assert.ok(cacheRead >= 0 && indexedDbFallback > cacheRead, 'IndexedDB remains the final fallback');
});

test('broken fonts fall back to the system font stack', () => {
  assert.match(loader, /function fallbackToSystemFont\(key\)/);
  assert.match(loader, /warmPromise\.then\(function \(faces\)/, 'must await the font load result');
  assert.match(loader, /removeAppliedFontStyle\(\)/, 'failed font must remove the custom rule');
  assert.doesNotMatch(loader, /\.catch\(function \(\) \{\s*\}\)/, 'font failures must not be silently swallowed');
});

test('font preview uses an isolated family and theme specimens load once', () => {
  assert.match(settings, /font-family:"MAOMAOPreviewFont"/);
  assert.doesNotMatch(settings, /font-family:"MAOMAOUserFont";src:url\("' \+ safeUrl/);
  const store = read('theme-store/theme-store.html');
  assert.match(store, /fontFaceStates/);
  assert.match(store, /if\(state&&state\.ready\)/, 'already loaded specimens must be reused');
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
  /* 不绑定具体 PWA 版本号：只要求 app-shell 使用版本化的 phone-app-pwa 命名。 */
  assert.match(serviceWorker, /const CACHE_NAME = 'phone-app-pwa-v[\w.-]+'/, 'app-shell cache must keep a versioned name');
  assert.match(serviceWorker, /const FONT_ASSET_CACHE = 'maomao-font-assets-v1'/);
  assert.match(serviceWorker, /keys\.filter\(key => key\.startsWith\('phone-app-'\) && key !== CACHE_NAME\)/);
  /* 清理条件只覆盖 phone-app- 前缀，字体专用缓存不在此命名空间内，因此不会被删除。 */
  assert.doesNotMatch(serviceWorker, /key === FONT_ASSET_CACHE/);
  assert.doesNotMatch(serviceWorker, /key\.startsWith\('maomao-font-assets/);
});
