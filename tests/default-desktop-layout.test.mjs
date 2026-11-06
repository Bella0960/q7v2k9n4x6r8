import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const widgetManager = readFileSync(new URL('../desktop/widgets.html', import.meta.url), 'utf8');
const mobileCss = readFileSync(new URL('../shared/css/mobile-fit.css', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function extractDefaultPages(source) {
  const match = source.match(/function getDefaultLayout\(\)\s*\{[\s\S]*?pages:\s*\[([\s\S]*?)\],\s*dock:/);
  assert.ok(match, 'getDefaultLayout must declare its page distribution');
  return [...match[1].matchAll(/\[((?:\s*'[^']+'\s*,?)+)\]/g)].map((page) =>
    [...page[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
  );
}

test('the local-approved default opens on the component page, not the app grid', () => {
  const pages = extractDefaultPages(index);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages[0], [
    'clock-lg', 'image', 'photowall', 'todo', 'calendar', 'countdown', 'note'
  ]);
  assert.ok(pages[1].every((id) => id.startsWith('app_')));
  assert.ok(pages[2].every((id) => id.startsWith('app_')));
  assert.match(index, /v:\s*13,/);
  assert.match(index, /var LS_KEY = 'ds_layout_v13'/);
});

test('the previous v12 layout and backup migration are removed instead of restored', () => {
  assert.match(index, /key !== 'ds_layout_v13'/, 'startup must delete obsolete desktop layout versions');
  assert.match(index, /localStorage\.removeItem\('maomao_home_layout_backup_20261106'\)/);
  assert.match(index, /localStorage\.removeItem\('ds_home_default_revision'\)/);
  assert.doesNotMatch(index, /ds_layout_v12|LS_KEY_OLD|migrateKnownBuiltInDefaultLayouts|ensureComponentFirstHomeRevision/);
  assert.doesNotMatch(index, /localStorage\.setItem\([^;]*maomao_home_layout_backup_20261106/);
  assert.match(widgetManager, /var LS_KEY = 'ds_layout_v13'/);
  assert.doesNotMatch(widgetManager, /ds_layout_v12/);
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

test('the mobile home grid fits narrow screens and the PWA downloads the new home', () => {
  assert.match(mobileCss, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)\s*!important/);
  assert.match(mobileCss, /grid-auto-rows:\s*68px\s*!important/);
  assert.match(mobileCss, /\.maomao-home \.home-page[\s\S]*?overflow-y:\s*auto\s*!important/);
  assert.match(serviceWorker, /const CACHE_NAME = 'phone-app-pwa-v165'/);
});
