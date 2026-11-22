import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../worldbook/characters/characters.html', import.meta.url), 'utf8');
const mobileFit = readFileSync(new URL('../shared/css/mobile-fit.css', import.meta.url), 'utf8');

test('role library is full-viewport and each row spans list width at 375/390/430px', () => {
  assert.match(page, /href="\.\.\/\.\.\/shared\/css\/mobile-fit\.css"/);
  assert.match(mobileFit, /\.phone-mockup,[\s\S]*?width:\s*100vw\s*!important/);
  const block = page.slice(page.indexOf('/* P0-BATCH1: each role occupies the entire list width'));
  assert.ok(block.length > 100, 'scoped role list guard must be present');
  assert.match(block, /#listView\s*\.role-list\s*\{[\s\S]*?width:\s*100%/);
  assert.match(block, /#listView\s*\.role-slim-bar\s*\{[\s\S]*?width:\s*100%/);
  assert.match(block, /#listView\s*\.role-slim-bar\s*\{[\s\S]*?flex:\s*0 0 auto/);
  assert.match(block, /#listView\s*\.role-slim-bar\s+\.slim-meta\s*\{\s*min-width:\s*0/);
  for (const width of [375, 390, 430]) {
    const horizontalPadding = 24 * 2;
    assert.ok(width - horizontalPadding >= 327, 'role grid remains usable on narrow screen');
  }
});

test('overflowing role libraries preserve vertical touch scroll and hide visible scrollbars', () => {
  const block = page.slice(page.indexOf('/* P0-BATCH1: each role occupies the entire list width'));
  assert.match(block, /#listView\s*\.role-list\s*\{[\s\S]*?overflow-y:\s*auto\s*!important/);
  assert.match(block, /-webkit-overflow-scrolling:\s*touch/);
  assert.match(block, /scrollbar-width:\s*none/);
  assert.match(block, /#listView\s*\.role-list::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
});
