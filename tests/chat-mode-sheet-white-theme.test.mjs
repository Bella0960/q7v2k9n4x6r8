import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const open = html.indexOf('function openChatModeSheet()');
const attach = html.indexOf('document.body.appendChild(overlay);', open);
const render = html.slice(open, attach);
const cssStart = html.indexOf('/* 留白聊天主题：模式菜单');
const cssEnd = html.indexOf('@keyframes chatModeFadeIn', cssStart);
const css = html.slice(cssStart, cssEnd);

test('white-theme mode menu is compact with safe area and readable choices', () => {
  assert.ok(cssStart > -1 && cssEnd > cssStart);
  assert.match(css, /max-height:min\(72dvh,470px\)/);
  assert.match(css, /background:#fff/);
  assert.match(css, /#f4f4f6/);
  assert.match(css, /env\(safe-area-inset-bottom,0px\)/);
  assert.match(css, /overflow-wrap:anywhere/);
  assert.doesNotMatch(render, /CONVERSATION MODES|chat-mode-kicker|chat-mode-number|chat-mode-mark/);
});

test('all four mode routes, cancel and per-role state remain intact', () => {
  for (const mode of ['online','offline-short','offline-long','narration','cancel']) {
    assert.equal(render.split('data-chat-mode="' + mode + '"').length - 1,1,
      'missing or duplicate mode ' + mode);
  }
  assert.match(html, /const modeKey = 'chat_mode_' \+ currentCharacter\.id/);
  assert.match(html, /selected === 'offline-short' \|\| selected === 'offline-long'/);
  assert.match(html, /window\.location\.href = page \+ '\?v=20261028modes1&id='/);
  assert.match(html, /selected === 'narration'/);
  assert.match(html, /event\.key === 'Escape'/);
  assert.match(html, /button\.setAttribute\('aria-pressed', String\(active\)\)/);
});
