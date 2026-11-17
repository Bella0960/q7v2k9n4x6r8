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

test('g 开头的普通角色仍可选择，实际群聊由群列表排除', () => {
  const picker = read('fanwai/fanwai-app.js');
  const engine = read('chat/chat/js/chat-fanwai.js');
  assert.match(picker, /groupIds\.has\(String\(role\.id\)\)/);
  assert.doesNotMatch(picker, /!\/\^g\/i/);
  assert.match(engine, /phone_groups/);
  assert.match(engine, /if \(isGroup\) return;/);
});

test('账号门禁在故事扩展注册之前；独立页面不绕过隔离', () => {
  const engine = read('chat/chat/js/chat-fanwai.js');
  assert.ok(engine.indexOf("var earlyMeta = document.querySelector") < engine.indexOf("var TEMPLATES = ["));
  assert.match(engine, /earlyScope\.accountId !== earlyId/);
});

test('切换角色或退出前等待番外保存队列，避免未落盘便换页', () => {
  const engine = read('chat/chat/js/chat-fanwai.js');
  assert.match(engine, /if \(standalone && \(key === 'switch-role' \|\| key === 'home'\)\) \{/);
  assert.match(engine, /await episodeWriteQueue;/);
  assert.match(engine, /if \(canPersist && persistenceFailed\) \{/);
});

test('独立页缺少聊天 Toast 时提供可见且安全的错误提示', () => {
  const picker = read('fanwai/fanwai-app.js');
  const css = read('fanwai/fanwai.css');
  assert.match(picker, /typeof global\.showToast !== 'function'/);
  assert.match(picker, /toast\.textContent = text/);
  assert.match(picker, /toast\.setAttribute\('role', 'status'\)/);
  assert.match(css, /\.fw-notice\[hidden\]/);
  assert.match(css, /safe-area-inset-bottom/);
});

test('独立页列表/阅读字号放大，更多操作不会横向溢出', () => {
  const css = read('fanwai/fanwai.css');
  assert.match(css, /fw-saved-title \{ font-size: 14px/);
  assert.match(css, /fw-preview-description \{ font-size: 14px/);
  assert.match(css, /fw-reader-menu \{[^}]*flex-wrap: wrap/);
});

test('创建过程禁止跨页导航，防止异步初次存档后在已离开页面启动模型', () => {
  const engine = read('chat/chat/js/chat-fanwai.js');
  assert.match(engine, /if \(standalone && state\.creating\)/);
  assert.match(engine, /if \(state\.creating\) \{\s*showNotice\('故事正在创建/);
});

test('存储故障仍可主动复制正在阅读的未落盘番外', () => {
  const engine = read('chat/chat/js/chat-fanwai.js');
  assert.match(engine, /button\('copy-unsaved', '复制当前文字'/);
  assert.match(engine, /clipboard\.writeText\(content\)/);
});

test('独立页返回箭头按页面层级导航，切换角色独立放在右侧', () => {
  const engine = read('chat/chat/js/chat-fanwai.js');
  assert.match(engine, /var backAction = secondaryAction === 'close' \? 'back'/);
  assert.match(engine, /button\(backAction, '‹', 'fw-switch-role'\)/);
  assert.match(engine, /button\('switch-role', '角色', 'fw-close'\)/);
  assert.match(engine, /backAction === 'home' \? '返回桌面'/);
});

test('阅读页返回目录前等待保存；保存失败时保留当前内存故事可复制', () => {
  const engine = read('chat/chat/js/chat-fanwai.js');
  assert.match(engine, /if \(key === 'back'\) \{/);
  assert.match(engine, /await episodeWriteQueue;\s*if \(canPersist && persistenceFailed && state\.active && state\.active\.messages\.length\)/);
  assert.match(engine, /showNotice\('故事保存失败，请先复制当前文字/);
  assert.match(engine, /renderReader\(\);\s*return;\s*\}\s*\}\s*openPicker\(\)/);
});
