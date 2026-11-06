import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tutorialPath = resolve(here, '../tutorial/tutorial.html');
const html = readFileSync(tutorialPath, 'utf8');
const index = readFileSync(resolve(here, '../index.html'), 'utf8');
const sw = readFileSync(resolve(here, '../sw.js'), 'utf8');
const packageJson = JSON.parse(readFileSync(resolve(here, '../package.json'), 'utf8'));
const tutorialWorkflow = readFileSync(resolve(here, '../.github/workflows/tutorial-regression.yml'), 'utf8');

function readExtraLessons(source) {
  const match = source.match(/var extraLessons=(\[[\s\S]*?\]);\nlessons=lessons\.concat\(extraLessons\);/);
  assert.ok(match, 'additional feature lessons must be a valid JSON lesson collection');
  return JSON.parse(match[1]);
}

test('tutorial app is linked from the desktop and included in the default layout', () => {
  assert.match(index, /data-href="tutorial\/tutorial\.html"[^>]*data-drag="app_tutorial"[^>]*data-name="教程"/);
  assert.match(index, /'app_tutorial'\s*\]/);
  assert.match(index, /addTutorialShortcutToExistingLayouts/);
  assert.equal(existsSync(tutorialPath), true);
});

test('tutorial offers the learning path, progress tracking and at least 45 lessons', () => {
  assert.match(html, /maomao_tutorial_progress_v1/);
  assert.match(html, /学习进度/);
  assert.match(html, /从这里，学会使用小手机/);
  assert.match(html, /data-step/);
  assert.match(html, /data-answer/);
  assert.match(html, /continueBtn/);
  const extra = readExtraLessons(html);
  assert.ok(extra.length >= 18, 'expected detailed app-by-app lessons in addition to the core course');
  const ids = new Set(extra.map((lesson) => lesson.id));
  for (const id of [
    'forum-post', 'music-player', 'takeout-order', 'couple-space',
    'growth-progress', 'daily-companion', 'cafe-management',
    'reading-workflow', 'envelope-letter', 'diary-journal',
    'novel-workshop', 'dream-travel', 'game-hall', 'offline-mode',
    'chat-rich-features', 'theme-store-guide', 'poster-archive', 'live-room'
  ]) assert.ok(ids.has(id), 'missing detailed lesson: ' + id);
});

test('guided tours load real same-origin pages and highlight their actual controls', () => {
  assert.match(html, /id="tourModal"/);
  assert.match(html, /id="tourFrame"/);
  assert.match(html, /function openGuidedTour\(lesson\)/);
  assert.match(html, /frame\.contentDocument/);
  assert.match(html, /data-maomao-tour-focus/);
  assert.match(html, /addTourConfig\('api-connect'/);
  assert.match(html, /addTourConfig\('image-config'/);
  assert.match(html, /addTourConfig\('minimax-tts'/);
  assert.match(html, /addTourConfig\('image-generate'/);
  assert.match(html, /addTourConfig\('worldbook'/);
  assert.match(html, /addTourConfig\('fonts'/);
  assert.match(html, /addTourConfig\('character-create'/);
  const extra = readExtraLessons(html);
  for (const id of ['forum-post','takeout-order','couple-space','cafe-management','reading-workflow','envelope-letter','diary-journal']) {
    const lesson = extra.find((item) => item.id === id);
    assert.ok(lesson && lesson.tour && lesson.tour.steps.length >= 3, 'missing real-page guided tour: ' + id);
    assert.ok(lesson.tour.url.startsWith('../'), 'tour must stay on the MAOMAO origin');
  }
  assert.match(html, /右侧是真实 MAOMAO 页面/);
});

test('tutorial app directory contains all desktop app shortcuts with valid local routes', () => {
  const appBlock = html.match(/var apps=\[([\s\S]*?)\n\];/);
  assert.ok(appBlock, 'app directory must declare its desktop app map');
  const entries = [...appBlock[1].matchAll(/\['([^']+)','([^']+)','([^']+)'\]/g)];
  assert.ok(entries.length >= 29, 'expected a directory entry for every desktop app');
  const indexNames = new Set([...index.matchAll(/data-name="([^"]+)"[^>]*title="[^"]+"/g)].map((m) => m[1]));
  for (const entry of entries) {
    assert.ok(indexNames.has(entry[1]), 'missing desktop app in directory: ' + entry[1]);
    assert.ok(existsSync(resolve(dirname(tutorialPath), entry[3])), 'missing app route: ' + entry[3]);
  }
});

test('API practice stays local-only and MIX is not given invented connection details', () => {
  assert.match(html, /没有发出网络请求，也没有保存任何内容/);
  assert.match(html, /当前状态：待确认/);
  assert.match(html, /没有找到能够确认名称为「MIX」的独立配置入口/);
  assert.doesNotMatch(html, /XMLHttpRequest|navigator\.sendBeacon|fetch\s*\(/);
  assert.match(html, /API Key 是账户凭证/);
  assert.match(html, /教程不会读取或显示输入框里的密钥/);
});

test('PWA caches the tutorial app and the dedicated test command is registered', () => {
  assert.match(sw, /phone-app-pwa-v175/);
  assert.match(sw, /'\.\/tutorial\/tutorial\.html'/);
  assert.equal(packageJson.scripts['test:tutorial'], 'node --test tests/tutorial-app-contract.test.mjs');
  assert.match(tutorialWorkflow, /npm run test:tutorial/);
  assert.match(tutorialWorkflow, /npm run test:desktop:layout/);
  assert.match(tutorialWorkflow, /npm run build/);
});
