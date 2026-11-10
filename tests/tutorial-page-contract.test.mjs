import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

const home = read('index.html');
const serviceWorker = read('sw.js');
const guideHtml = read('tutorial/tutorial.html');
const chatDetail = read('chat/chat/chat-detail.html');
const guideScript = read('tutorial/tutorial.js');
const packageJson = JSON.parse(read('package.json'));

test('tutorial is a desktop app and is added without resetting saved layouts', () => {
  assert.match(home, /data-href="tutorial\/tutorial\.html"/);
  assert.match(home, /data-drag="app_tutorial"/);
  assert.match(home, /addTutorialShortcutToExistingLayouts/);
  assert.match(home, /currentLayout\.removed \|\| \[\]\)\.indexOf\(id\)/);
  assert.match(home, /indexOf\('app_settings'\)/);
});

test('guide documents the merged chat features and the reported settings blocker', () => {
  assert.match(guideScript, /PR #241/);
  assert.match(guideScript, /PR #240/);
  assert.match(guideScript, /单条 \/ 自动 \/ 连续多条/);
  assert.match(guideScript, /头像收藏/);
  assert.match(guideScript, /配对头像/);
  assert.match(guideScript, /收藏给 TA/);
  assert.match(guideScript, /角色图库/);
  assert.match(guideScript, /点不开对话设置/);
  assert.match(guideScript, /真实通知还需要单独完成推送链路和真机验收/);
});

test('all guide routes and desktop app directory links resolve to HTML pages', () => {
  const guideRoutes = [...guideScript.matchAll(/href:\s*'\.\.\/([^']+)'/g)].map((match) => match[1]);
  const appRoutes = [...guideScript.matchAll(/\['[^']+',\s*'([^']+\.html)'/g)].map((match) => match[1]);
  assert.ok(guideRoutes.length >= 8, 'expected guide action links');
  assert.ok(appRoutes.length >= 20, 'expected the desktop app quick directory');
  [...guideRoutes.map((path) => resolve(root, path)), ...appRoutes.map((path) => resolve(root, path))]
    .forEach((path) => assert.ok(existsSync(path), 'missing tutorial destination: ' + path));
});

test('tutorial saves local test notes and exports a report without touching chat data', () => {
  assert.match(guideHtml, /id="guideSearch"/);
  assert.match(guideHtml, /id="exportTests"/);
  assert.match(guideHtml, /id="resetModal"/);
  assert.match(guideScript, /maomao_tutorial_progress_v1/);
  assert.match(guideScript, /function exportProgress/);
});

test('conversation settings has a direct navigation fallback and is cached in the PWA shell', () => {
  assert.match(chatDetail, /onclick="window\.location\.assign\('chat-settings\.html\?roleId='/);
  assert.match(chatDetail, /btnMoreMenu\.addEventListener\('click'/);
  assert.ok(serviceWorker.includes("'./chat/chat/chat-settings.html'"));
});

test('PWA app shell includes the tutorial and uses the refreshed cache version', () => {
  assert.match(serviceWorker, /const CACHE_NAME = 'phone-app-pwa-v200'/);
  assert.ok(serviceWorker.includes("'./tutorial/tutorial.html'"));
  assert.ok(serviceWorker.includes("'./tutorial/tutorial.js?v=20261111v1'"));
  assert.equal(packageJson.scripts['test:tutorial'], 'node --test tests/tutorial-page-contract.test.mjs');
});
