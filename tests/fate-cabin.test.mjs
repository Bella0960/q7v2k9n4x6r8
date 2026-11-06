import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const home = read('index.html');
const page = read('fortune/fortune.html');
const icons = read('settings/icon-settings.html');
const sw = read('sw.js');

test('Fate Cabin is a real desktop app route and is included in the default layout', () => {
  assert.match(home, /data-href="fortune\/fortune\.html" data-drag="app_fate_cabin" data-name="命运小屋"/);
  assert.ok(existsSync(new URL('../fortune/fortune.html', import.meta.url)));
  assert.match(home, /'app_fate_cabin'/, 'new default desktop layout must include Fate Cabin');
  assert.match(home, /addFateCabinShortcutToExistingLayouts/, 'saved layouts must receive the app without being reset');
});

test('all desktop shortcuts have individual icon and icon-preset entries', () => {
  const shortcutIds = [...new Set([...home.matchAll(/data-drag="(app_[^"]+)"/g)].map(match => match[1]))];
  const configuredIds = [...new Set([...icons.matchAll(/\{\s*id:\s*'(app_[^']+)'/g)].map(match => match[1]))];
  assert.deepEqual(shortcutIds.filter(id => !configuredIds.includes(id)), []);
});

test('Fate Cabin contains the three requested usable modules and persists only its own small state', () => {
  assert.match(page, /id="tarotView"/);
  assert.match(page, /id="wheelView"/);
  assert.match(page, /id="oracleView"/);
  assert.match(page, /data-action="draw-tarot"/);
  assert.match(page, /data-action="spin"/);
  assert.match(page, /data-action="draw-oracle"/);
  assert.match(page, /data-action="add-option"/);
  assert.match(page, /maomao_fate_cabin_v1/);
  assert.match(page, /localStorage\.setItem\(STORE_KEY/);
  assert.match(page, /catch\(error\)/);
  assert.doesNotMatch(page, /[↑⬆↗]/, 'do not add decorative arrow symbols');
});

test('the updated PWA shell caches Fate Cabin and advances the service worker version', () => {
  assert.match(sw, /phone-app-pwa-v174/);
  assert.match(sw, /'\.\/fortune\/fortune\.html'/);
});
