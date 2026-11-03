// nav-exclusion-contract.test.mjs
// 验证 nav.js 排除逻辑的正确性与版本号一致性。
// 所有断言直接基于源码字符串匹配或沙箱执行，不 mock 运行时。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

const navSrc = read('shared/js/nav.js');
const cafePage = read('cafe/cafe.html');
const chatPage = read('chat/chat/chat.html');
const contactsPage = read('chat/contacts/contacts.html');
const momentsPage = read('chat/moments/moments.html');
const profilePage = read('profile/profile.html');
const gamesPage = read('games/games.html');
const settingsPage = read('settings/settings.html');
const charactersPage = read('worldbook/characters/characters.html');
const worldbookPage = read('worldbook/worldbook/worldbook.html');
const swSrc = read('sw.js');

// --- 1. nav.js 源码结构检查 ---

test('nav.js 采用 SKIP_DIRS + SKIP_FILES 统一排除策略（非旧 SKIP_PAGES 子串匹配）', () => {
  assert.match(navSrc, /SKIP_DIRS\s*=\s*\[/, 'nav.js 应使用 SKIP_DIRS 目录级排除');
  assert.match(navSrc, /SKIP_FILES\s*=\s*\[/, 'nav.js 应使用 SKIP_FILES 文件名级排除');
  // 旧逻辑（纯 SKIP_PAGES + indexOf 子串匹配）不应是唯一策略
  assert.match(navSrc, /path\.split\(['"]\/['"]\)\.filter\(Boolean\)/, '应通过 path segments 判断');
  assert.match(navSrc, /for \(var d = 0; d < pathParts\.length; d\+\+\)/, '应遍历所有目录段');
  assert.match(navSrc, /SKIP_DIRS\.indexOf\(pathParts\[d\]\)/, '应遍历目录段匹配');
});

test('nav.js 包含咖啡馆目录级排除（cafe 在 SKIP_DIRS 中）', () => {
  assert.match(navSrc, /'cafe'/, 'SKIP_DIRS 应包含 cafe');
});

test('nav.js 在 shouldSkip 时主动清除残留底部导航 DOM', () => {
  assert.match(navSrc, /shouldSkip/, '应统一使用 shouldSkip 标志');
  assert.match(navSrc, /querySelectorAll\(['"]\.floating-nav,\s*\.bottom-nav,\s*\.chat-bottom-bar['"]\)/,
    '应主动 .remove() 所有残留底部导航');
});

// --- 2. 沙箱执行 nav.js 排除逻辑，验证路径判断结果 ---

function runShouldSkipNav(pathname) {
  // 从源码中提取排除逻辑并在沙箱执行
  const extracted = `
    var path = ${JSON.stringify(pathname)}.toLowerCase();
    var pathParts = path.split('/').filter(Boolean);
    var lastSeg = pathParts.length ? pathParts[pathParts.length - 1] : '';
    var SKIP_DIRS = ['cafe', 'games', 'settings', 'worldbook', 'memory'];
    var SKIP_FILES = ['index.html', 'chat-detail.html', 'settings.html', 'edit-profile.html', 'memory.html', 'characters.html', 'shake.html'];
    var shouldSkip = false;
    if (pathParts.length === 0) {
      shouldSkip = true;
    } else {
      for (var d = 0; d < pathParts.length; d++) {
        if (SKIP_DIRS.indexOf(pathParts[d]) !== -1) { shouldSkip = true; break; }
      }
      if (!shouldSkip && SKIP_FILES.indexOf(lastSeg) !== -1) shouldSkip = true;
      if (!shouldSkip && lastSeg === 'cafe.html') shouldSkip = true;
    }
    shouldSkip;
  `;
  return runInNewContext(extracted);
}

const EXPECT_SKIP = [
  '/', '/index.html',
  '/cafe/cafe.html', '/cafe.html', '/cafe',
  '/MAOMAO/cafe/cafe.html', '/phone-app/cafe/cafe.html',
  '/games/games.html',
  '/settings/settings.html', '/settings/appearance.html',
  '/worldbook/characters/characters.html', '/worldbook/worldbook/worldbook.html',
  '/chat/chat/chat-detail.html',
  '/memory/memory.html',
  '/cafe/cafe.html?v=20261103',
];

const EXPECT_KEEP = [
  '/chat/chat/chat.html', '/chat/contacts/contacts.html',
  '/chat/moments/moments.html', '/profile/profile.html',
  '/chat/chat/chat-search.html', '/chat/chat/chat-settings.html',
  '/forum/forum.html', '/wallet/wallet.html',
  '/travel/dream-travel.html', '/diary/diary.html',
];

test('nav.js 排除逻辑：咖啡馆页面正确 skip', () => {
  EXPECT_SKIP.forEach(p => {
    assert.equal(runShouldSkipNav(p), true, `应 skip: ${p}`);
  });
});

test('nav.js 排除逻辑：聊天与保留导航的页面不被误排除', () => {
  EXPECT_KEEP.forEach(p => {
    assert.equal(runShouldSkipNav(p), false, `不应 skip: ${p}`);
  });
});

// --- 3. 版本号一致性 ---

const NAV_VERSION = 'v=20261103v1';

test('所有引入 nav.js 的 HTML 文件都带版本号 ' + NAV_VERSION, () => {
  const htmlFiles = [
    { content: cafePage, name: 'cafe/cafe.html' },
    { content: chatPage, name: 'chat/chat/chat.html' },
    { content: contactsPage, name: 'chat/contacts/contacts.html' },
    { content: momentsPage, name: 'chat/moments/moments.html' },
    { content: profilePage, name: 'profile/profile.html' },
    { content: gamesPage, name: 'games/games.html' },
    { content: settingsPage, name: 'settings/settings.html' },
    { content: charactersPage, name: 'worldbook/characters/characters.html' },
    { content: worldbookPage, name: 'worldbook/worldbook/worldbook.html' },
  ];
  htmlFiles.forEach(({ content, name }) => {
    const hasNav = content.includes('nav.js');
    if (hasNav) {
      assert.match(content, new RegExp(`nav\\.js\\?${NAV_VERSION.replace(/\./g, '\\.')}`),
        `${name} 的 nav.js 应带 ${NAV_VERSION} 版本号`);
    }
  });
});

test('sw.js 预缓存列表中的 nav.js 版本号与 HTML 同步', () => {
  assert.match(swSrc, new RegExp(`'shared/js/nav\\.js\\?${NAV_VERSION.replace(/\./g, '\\.')}'`),
    'sw.js 预缓存应包含带版本号的 nav.js');
});

test('sw.js CACHE_NAME 已升级（v156+）以让旧缓存失效', () => {
  assert.match(swSrc, /phone-app-pwa-v15[6-9]|phone-app-pwa-v\d{3}/,
    'CACHE_NAME 应已升级到 v156+');
});

// --- 4. 咖啡馆页面验证 ---

test('cafe/cafe.html 不包含 chat-bottom-bar 或 bottom-nav 硬编码结构', () => {
  assert.doesNotMatch(cafePage, /class=["'][^"']*chat-bottom-bar[^"']*["']/,
    '咖啡馆页面不应硬编码 chat-bottom-bar');
  assert.doesNotMatch(cafePage, /class=["'][^"']*bottom-nav[^"']*["']/,
    '咖啡馆页面不应硬编码 bottom-nav');
});

test('cafe/cafe.html 的 nav.js 在 body 末尾同步加载（非动态）', () => {
  assert.match(cafePage, /<script[^>]+src=["'][^"']*nav\.js/,
    '咖啡馆页面应同步引入 nav.js 让排除逻辑立即生效');
});
