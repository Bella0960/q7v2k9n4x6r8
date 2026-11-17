import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

test('番外桌面图标保留布局并能打开独立路由', () => {
  const index = read('index.html');
  assert.match(index, /data-href="fanwai\/fanwai\.html" data-drag="app_fanwai"/);
  assert.match(index, /addFanwaiShortcutToExistingLayouts/);
  assert.match(index, /currentLayout\.removed/);
});

test('独立番外只用薄顶部和真实视口，不使用聊天半屏弹窗', () => {
  const page = read('fanwai/fanwai.html');
  const css = read('fanwai/fanwai.css');
  assert.match(page, /data-fanwai-standalone="true"/);
  assert.doesNotMatch(page, /status-bar|phone-mockup/);
  assert.match(css, /height: 100dvh/);
  assert.match(css, /\.fw-app-header \{[^}]*height: 44px/);
  assert.match(css, /#fanwaiLayer\.fw-standalone \.fw-sheet/);
  assert.match(css, /max-height: none/);
  assert.match(css, /box-shadow: none/);
});

test('角色选择在读本机数据前验证账号隔离，不混用其他角色', () => {
  const picker = read('fanwai/fanwai-app.js');
  assert.ok(picker.indexOf('runtime.ready !== true') < picker.indexOf("getItem('ai_custom_characters')"));
  assert.match(picker, /String\(role\.id\) === selectedId/);
  assert.match(picker, /encodeURIComponent\(String\(role\.id\)\)/);
  assert.match(picker, /chat-fanwai\.js/);
});

test('旧聊天入口跳独立页面，原引擎复用而不删除存档与续写', () => {
  const extras = read('chat/chat/js/chat-extras.js');
  const engine = read('chat/chat/js/chat-fanwai.js');
  assert.match(extras, /\.\.\/\.\.\/fanwai\/fanwai\.html/);
  assert.doesNotMatch(extras, /fanwaiScript\.src/);
  assert.match(engine, /if \(standalone\) openPicker\(\);/);
  assert.match(engine, /var DB_NAME = 'maomao-fanwai-v1'/);
  assert.match(engine, /async function generate\(\)/);
  assert.match(engine, /function openBranchPreview\(\)/);
  assert.match(engine, /state\.root\.hidden = false/);
});
