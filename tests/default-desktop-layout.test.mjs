import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mobileCss = readFileSync(new URL('../shared/css/mobile-fit.css', import.meta.url), 'utf8');

function extractDefaultPages(source) {
  const match = source.match(/function getDefaultLayout\(\)\s*\{[\s\S]*?pages:\s*\[([\s\S]*?)\],\s*dock:/);
  assert.ok(match, 'getDefaultLayout must declare its page distribution');
  return [...match[1].matchAll(/\[((?:\s*'[^']+'\s*,?)+)\]/g)].map((page) =>
    [...page[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
  );
}

test('default home keeps the three requested widgets on a compact first page', () => {
  const pages = extractDefaultPages(index);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages[0], [
    'clock-lg', 'duo', 'polaroid',
    'app_inspect', 'app_worldbook', 'app_memory', 'app_forum'
  ]);
  assert.ok(pages[1].every((id) => id.startsWith('app_')));
  assert.ok(pages[2].every((id) => id.startsWith('app_')));
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

test('only the exact previous built-in default is migrated; mobile grid is width-safe', () => {
  assert.match(index, /currentLayout\.pages\.length === 3/);
  assert.match(index, /if \(isPreviousDefault\)\s*\{\s*currentLayout = getDefaultLayout\(\)/);
  assert.match(mobileCss, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)\s*!important/);
  assert.match(mobileCss, /grid-auto-rows:\s*68px\s*!important/);
  assert.match(mobileCss, /\.maomao-home \.home-page[\s\S]*?overflow-y:\s*auto\s*!important/);
});
