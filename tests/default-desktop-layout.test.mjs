import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const widgetManager = readFileSync(new URL('../desktop/widgets.html', import.meta.url), 'utf8');
const desktopCss = readFileSync(new URL('../desktop/css/styles.css', import.meta.url), 'utf8');
const mobileCss = readFileSync(new URL('../shared/css/mobile-fit.css', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function extractDefaultPages(source) {
  const match = source.match(/function getDefaultLayout\(\)\s*\{[\s\S]*?pages:\s*\[([\s\S]*?)\],\s*dock:/);
  assert.ok(match, 'getDefaultLayout must declare its page distribution');
  return [...match[1].matchAll(/\[((?:\s*'[^']+'\s*,?)+)\]/g)].map((page) =>
    [...page[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
  );
}

test('default home has the clock, duo avatars, photo wall and app quadrants in the requested order', () => {
  const pages = extractDefaultPages(index);
  assert.deepEqual(pages[0], [
    'clock-lg',
    'app_inspect', 'app_worldbook', 'app_memory', 'app_forum',
    'duo', 'photowall',
    'app_wallet', 'app_music', 'app_beauty', 'app_theme_store'
  ]);
  assert.equal(pages.length, 3);
  assert.match(index, /v:\s*14,/);
  assert.match(index, /var LS_KEY = 'ds_layout_v14'/);
});

test('obsolete layout keys are cleared and the widget manager uses the current layout key', () => {
  assert.match(index, /key !== 'ds_layout_v14'/);
  assert.doesNotMatch(index, /ds_layout_v13|ds_layout_v12/);
  assert.match(widgetManager, /var LS_KEY = 'ds_layout_v14'/);
  assert.doesNotMatch(widgetManager, /ds_layout_v13|ds_layout_v12/);
});

test('every desktop app is assigned exactly once and dock apps stay in the dock', () => {
  const pages = extractDefaultPages(index);
  const assigned = pages.flat();
  const appIds = [...new Set([...index.matchAll(/data-drag="(app_[^"]+)"/g)].map((m) => m[1]))]
    .filter((id) => id !== 'app_chat' && id !== 'app_shop');
  assert.equal(new Set(assigned).size, assigned.length, 'default pages must not contain duplicate items');
  assert.deepEqual([...assigned].filter((id) => id.startsWith('app_')).sort(), [...appIds].sort());
  assert.match(index, /dock:\s*\['app_chat',\s*'app_shop'\]/);
});

test('the mobile home grid keeps four columns and supports vertical page scrolling', () => {
  assert.match(mobileCss, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)\s*!important/);
  assert.match(mobileCss, /grid-auto-rows:\s*68px\s*!important/);
  assert.match(desktopCss, /#gridPage0 > \[data-drag\]:nth-child\(6\)[^{]*\{ grid-column: 3 \/ 5 !important; grid-row: 3 \/ 5 !important;/);
  assert.match(mobileCss, /#gridPage0 > \[data-drag\]:nth-child\(7\)[^{]*\{ grid-column: 1 \/ 3 !important; grid-row: 5 \/ 7 !important;/);
  assert.match(mobileCss, /\.maomao-home \.home-page[\s\S]*?overflow-y:\s*auto\s*!important/);
  assert.match(serviceWorker, /const CACHE_NAME = 'phone-app-pwa-v166'/);
});
