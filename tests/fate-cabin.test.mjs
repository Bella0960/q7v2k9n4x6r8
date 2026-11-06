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


test('navigation, wheel editing and persistence failures have explicit safe behavior', () => {
  assert.match(page, /data-exit/, 'the desktop exit action must be separate from the in-cabin back action');
  assert.match(page, /window\.location\.assign\('\.\.\/index\.html'\)/,
    'the exit control must navigate to the MAOMAO launcher');
  assert.match(page, /if\(spinning\)return/, 'wheel options cannot change while the wheel is moving');
  assert.match(page, /input\.disabled=spinning/, 'wheel option entry must be disabled while spinning');
  assert.match(page, /setStorageNotice/, 'storage read/write failures must have a visible global message');
  assert.match(page, /本地保存失败/, 'failed writes must not be reported as successful persistence');
});


test('tarot and oracle history have visible reopenable entries', () => {
  assert.match(page, /id="tarotHistory"/);
  assert.match(page, /data-tarot-history-index/);
  assert.match(page, /function openTarotHistory/);
  assert.match(page, /id="oracleHistory"/);
  assert.match(page, /data-oracle-history-index/);
  assert.match(page, /function openOracleHistory/);
});


test('Fate Cabin ritual interiors include responsive crystal, wheel and oracle treatments', () => {
  assert.match(page, /class="ritual-note"/);
  assert.match(page, /class="empty-crystals"/);
  assert.match(page, /className='crystal-facet'/);
  assert.match(page, /class="wheel-stage-caption"/);
  assert.match(page, /id="wheelCount"/);
  assert.match(page, /class="oracle-paper-wrap"/);
  assert.match(page, /class="oracle-placeholder-seal"/);
  assert.match(page, /className='oracle-seal'/);
  assert.match(page, /@media\(max-width:560px\)/);
  assert.match(page, /prefers-reduced-motion:reduce/);
});


test('the tarot deck contains all 78 major and minor arcana cards', () => {
  assert.match(page, /var TAROT_DECK_TOTAL=78/);
  assert.match(page, /function buildMinorArcana\(\)/);
  assert.match(page, /name:suit\.name\+rank\.name/);
  assert.match(page, /tarotDeck=tarotDeck\.concat\(buildMinorArcana\(\)\)/);
  assert.match(page, /new Set\(tarotDeck\.map\(function\(card\)\{return card\.name;\}\)\)\.size!==TAROT_DECK_TOTAL/);
  assert.match(page, /完整的 78 张牌组/);
});

test('wheel options can be renamed, reset, and keep their action decorations', () => {
  assert.match(page, /data-edit-option/);
  assert.match(page, /data-save-option/);
  assert.match(page, /function saveWheelEdit/);
  assert.match(page, /data-action="reset-options"/);
  assert.match(page, /function resetWheelOptions/);
  assert.match(page, /id="spinButtonLabel"/);
  assert.match(page, /id="wheelResultText"/);
});
