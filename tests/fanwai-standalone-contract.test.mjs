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
  assert.match(extras, /fanwaiScript\.src/);
  assert.match(extras, /stopImmediatePropagation/);
  // 源分支可原生打开；QA 安全引擎则由兼容入口点击现有菜单启动。
  const picker = read('fanwai/fanwai-app.js');
  assert.match(picker, /entry\.click\(\)/);
  assert.match(engine, /function openPicker\(\)/);
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
  assert.match(engine, /earlyScope\.accountId !== (?:earlyId|earlyAccount)/);
});

test('QA 原安全引擎处理保存和返回；角色切换只在故事目录出现', () => {
  const engine = read('chat/chat/js/chat-fanwai.js');
  const app = read('fanwai/fanwai-app.js');
  assert.match(app, /switchRole\.hidden = !sheet\.querySelector\('\.fw-grid'\)/);
  assert.match(app, /readerBack\.click\(\)/);
  assert.ok(/await episodeWriteQueue;/.test(engine) || /state\.pendingPause/.test(engine));
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

test('首次创建时的异步保护由保留的引擎负责', () => {
  const engine = read('chat/chat/js/chat-fanwai.js');
  assert.match(engine, /state\.creating = true;/);
  assert.match(engine, /state\.creating = false;/);
  assert.match(engine, /viewSerial/);
});

test('存储故障仍可主动复制正在阅读的未落盘番外', () => {
  const engine = read('chat/chat/js/chat-fanwai.js');
  assert.match(engine, /button\('copy-unsaved',/);
  assert.match(engine, /clipboard\.writeText\((?:text|content)\)/);
});

test('独立页统一使用薄顶栏，阅读返回交给原存档引擎', () => {
  const app = read('fanwai/fanwai-app.js');
  assert.match(app, /var top = baseHeader\(\)/);
  assert.match(app, /\.fw-reader-menu \[data-action="back"\]/);
  assert.match(app, /var switchRole = link\('角色', 'fanwai.html'/);
  assert.match(app, /back\.setAttribute\('aria-label', '返回上一级'\)/);
});

test('故事返回使用原引擎安全门禁，保留未存稿处理', () => {
  const engine = read('chat/chat/js/chat-fanwai.js');
  assert.match(engine, /if \(key === 'back'\) \{/);
  assert.ok(/await episodeWriteQueue;/.test(engine) || /state\.pendingPause/.test(engine));
  assert.ok(/persistenceFailed/.test(engine) || /state\.unsavedEpisode/.test(engine));
});

test('不替换 QA 引擎也能挂载独立全屏：兼容旧 plus 与 phone 锚点', () => {
  const app = read('fanwai/fanwai-app.js');
  const css = read('fanwai/fanwai.css');
  assert.match(app, /legacyHost\.id = 'fanwaiLegacyHost'/);
  assert.match(app, /oldPanel\.id = 'plusPanelOverlay'/);
  assert.match(app, /oldPhone = element\('div', 'phone-mockup'\)/);
  assert.match(app, /entry\.click\(\)/);
  assert.match(app, /\.fw-reader-menu \[data-action="back"\]/);
  assert.match(css, /#fanwaiLayer\.fw-standalone\.fw-legacy-engine/);
  assert.match(css, /height: 100dvh/);
});

test('聊天页仅保留单次原 QA 引擎加载，避免初始化重复', () => {
  const extras = read('chat/chat/js/chat-extras.js');
  assert.equal((extras.match(/fanwaiScript\\.src/g) || []).length, 1);
  assert.match(extras, /20261116v23/);
});
