import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css = readFileSync(new URL('../luck-room/css/luck-room.css', import.meta.url), 'utf8');
const page = readFileSync(new URL('../luck-room/luck-room.html', import.meta.url), 'utf8');

function rule(selector) {
  const idx = css.indexOf(selector + '{');
  assert.ok(idx >= 0, selector + ' CSS rule must exist');
  const end = css.indexOf('}', idx);
  assert.ok(end > idx);
  return css.slice(idx + selector.length + 1, end);
}

test('one-luck main scroll container scrolls vertically on phone instead of trapping long content', () => {
  assert.match(page, /class="luck-app"/);
  const app = rule('.luck-app');
  assert.match(app, /overflow-y:\s*auto/);
  assert.match(app, /overflow-x:\s*hidden/);
  assert.match(app, /-webkit-overflow-scrolling:\s*touch/);
  assert.match(app, /height:\s*100dvh/);
  assert.match(app, /min-height:\s*0/);
  assert.match(app, /padding:\s*calc\(env\(safe-area-inset-top\)/);
  assert.doesNotMatch(app, /overflow-y:\s*hidden/);
});

test('one-luck scrollbar remains hidden across WebKit Firefox and legacy Edge', () => {
  const app = rule('.luck-app');
  assert.match(app, /scrollbar-width:\s*none/);
  assert.match(app, /-ms-overflow-style:\s*none/);
  assert.match(rule('.luck-app::-webkit-scrollbar'), /display:\s*none/);
});

test('one-luck scrolling does not remove the four existing game modes', () => {
  for (const feature of ['抽签', '转盘', '塔罗', '运势']) assert.ok(page.includes(feature));
  assert.match(css, /\.history-drawer\s*\{[^}]*overflow:\s*auto/);
});
