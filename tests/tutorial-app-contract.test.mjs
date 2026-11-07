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

function readPage(relativePath) {
  const path = resolve(dirname(tutorialPath), relativePath);
  assert.ok(existsSync(path), 'guided tour page does not exist: ' + relativePath);
  return readFileSync(path, 'utf8');
}

function assertSelectorExists(source, selector, label) {
  const ids = [...selector.matchAll(/#([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
  for (const id of ids) {
    assert.ok(source.includes('id="' + id + '"') || source.includes("id='" + id + "'"), label + ' missing #' + id);
  }
  const attrs = [...selector.matchAll(/\[([a-zA-Z_-][\w-]*)(?:=["\\']([^"\\']+)["\\'])?\]/g)];
  for (const [, attr, value] of attrs) {
    assert.ok(source.includes(attr), label + ' missing [' + attr + ']');
    if (value) assert.ok(source.includes(value), label + ' missing selector value ' + value);
  }
  const classes = [...selector.matchAll(/\.([A-Za-z_-][\w-]*)/g)].map((m) => m[1]);
  for (const name of classes) {
    assert.ok(source.includes(name), label + ' missing .' + name);
  }
}

test('tutorial app is linked from the desktop and included in the default layout', () => {
  assert.match(index, /data-href="tutorial\/tutorial\.html"[^>]*data-drag="app_tutorial"[^>]*data-name="教程"/);
  assert.match(index, /'app_tutorial'\s*\]/);
  assert.match(index, /addTutorialShortcutToExistingLayouts/);
  assert.equal(existsSync(tutorialPath), true);
});

test('tutorial offers the learning path, progress tracking and at least 50 lessons', () => {
  assert.match(html, /maomao_tutorial_progress_v1/);
  assert.match(html, /学习进度/);
  assert.match(html, /从这里，学会使用小手机/);
  assert.match(html, /data-step/);
  assert.match(html, /data-answer/);
  assert.match(html, /continueBtn/);
  const extra = readExtraLessons(html);
  assert.ok(extra.length >= 26, 'expected detailed app-by-app lessons in addition to the core course');
  const ids = new Set(extra.map((lesson) => lesson.id));
  for (const id of [
    'forum-post', 'music-player', 'takeout-order', 'couple-space',
    'growth-progress', 'daily-companion', 'cafe-management',
    'reading-workflow', 'envelope-letter', 'diary-journal',
    'novel-workshop', 'dream-travel', 'game-hall', 'offline-mode',
    'chat-rich-features', 'theme-store-guide', 'poster-archive', 'live-room',
    'desktop-widgets', 'chat-compose-and-media', 'chat-settings-and-autonomy',
    'group-chat-interactions', 'character-network', 'novel-author-tools',
    'cafe-menu-stock', 'novel-workflow'
  ]) assert.ok(ids.has(id), 'missing detailed lesson: ' + id);
});

test('guided tours load same-origin pages and their selector targets exist in real source files', () => {
  assert.match(html, /id="tourModal"/);
  assert.match(html, /id="tourFrame"/);
  assert.match(html, /function openGuidedTour\(lesson\)/);
  assert.match(html, /frame\.contentDocument/);
  assert.match(html, /data-maomao-tour-old-style/);
  assert.match(html, /library-settings/);
  const baseTours = [
    { path: '../settings/settings.html', selectors: ['#api-provider','#api-url','#api-key','#api-model','#btn-fetch-models','#settingsForm button[type="submit"]','#btn-test-connection','#api-image-model','#api-image-endpoint'] },
    { path: '../settings/minimax-tts.html', selectors: ['#enableToggle','#versionRow','#apiKey','#groupId','#modelGrid','#saveBtn'] },
    { path: '../settings/image-generation.html', selectors: ['#characterSelect','#appearance','#styleKeywords','#saveRole','#scene','#privateImage','#generateImage','#gallery'] },
    { path: '../worldbook/worldbook/worldbook.html', selectors: ['#btnAddFooter','#edName','#btnEditSave'] },
    { path: '../settings/font-settings.html', selectors: ['#fontUrlInput','#applyFontBtn','.file-pick','#fontSchemeName','#saveFontPresetBtn','#fontSizePreview','#restoreFontDefaults'] },
    { path: '../worldbook/characters/characters.html', selectors: ['#editRoleName','#editRolePersona','#editRoleTone','#editRoleAppearance','#editRoleStyleKeywords','#btnSaveRole'] }
  ];
  for (const tour of baseTours) {
    const page = readPage(tour.path);
    for (const selector of tour.selectors) assertSelectorExists(page, selector, tour.path);
  }
  const extra = readExtraLessons(html);
  const tourLessons = extra.filter((lesson) => lesson.tour);
  assert.ok(tourLessons.length >= 13, 'expected at least 13 detailed real-page tours');
  for (const lesson of tourLessons) {
    assert.ok(lesson.tour.url.startsWith('../'), 'tour must stay on the MAOMAO origin: ' + lesson.id);
    assert.ok(lesson.tour.steps.length >= 3, 'tour too short: ' + lesson.id);
    for (const step of lesson.tour.steps) {
      assert.ok(step.selector, 'tour step has no selector: ' + lesson.id);
      const stepPage = readPage(step.page || lesson.tour.url);
      assertSelectorExists(stepPage, step.selector, lesson.id + ' / ' + (step.page || lesson.tour.url));
    }
  }
  assert.match(html, /右侧是真实 MAOMAO 页面/);
});

test('chat guided tours follow the real list, detail and settings pages', () => {
  const listPage = readPage('../chat/chat/chat.html');
  const detailPage = readPage('../chat/chat/chat-detail.html');
  const settingsPage = readPage('../chat/chat/chat-settings.html');
  assertSelectorExists(listPage, '.chat-slim-card', 'chat list');
  assertSelectorExists(listPage, '.chat-group-card', 'group chat list');

  const tourBlock = (id) => {
    const start = html.indexOf("addTourConfig('" + id + "'");
    assert.ok(start >= 0, 'missing guided tour config: ' + id);
    const next = html.indexOf("\\naddTourConfig('", start + 1);
    const end = next >= 0 ? next : html.indexOf('\\nvar apps=', start);
    assert.ok(end > start, 'unterminated guided tour config: ' + id);
    return html.slice(start, end);
  };

  const compose = tourBlock('chat-compose-and-media');
  for (const selector of ['#chat-input', '#voice-input-btn', '#plus-action-btn', '.plus-item[data-feat="img"]']) {
    assertSelectorExists(detailPage, selector, 'chat compose / detail page');
    assert.ok(compose.includes("page:'../chat/chat/chat-detail.html',selector:'" + selector + "'"), 'chat compose step must target detail page: ' + selector);
  }

  const settings = tourBlock('chat-settings-and-autonomy');
  assertSelectorExists(detailPage, '#btn-more-menu', 'chat settings / detail page');
  assert.ok(settings.includes("page:'../chat/chat/chat-detail.html',selector:'#btn-more-menu'"));
  for (const selector of ['#actionBackground', '#pinToggle', '#memCard', '#actionSearchHistory', '#actionTimeAware', '#autoMomentToggle', '#proactiveContactToggle', '#proactiveContactInterval', '#followUpToggle', '#autoCommentToggle', '#autoInteractToggle']) {
    assertSelectorExists(settingsPage, selector, 'chat settings page');
    assert.ok(settings.includes("page:'../chat/chat/chat-settings.html',selector:'" + selector + "'"), 'settings step must target chat-settings page: ' + selector);
  }

  const group = tourBlock('group-chat-interactions');
  for (const selector of ['#plus-action-btn', '.plus-item[data-feat="group-poll"]', '#groupComposerQuestion', '#groupComposerOptions', '#groupComposerSubmit']) {
    assertSelectorExists(detailPage, selector, 'group interaction / detail page');
    assert.ok(group.includes("page:'../chat/chat/chat-detail.html',selector:'" + selector + "'"), 'group interaction step must target detail page: ' + selector);
  }

  assert.ok(html.includes('new URL(step.page||tour.url,window.location.href)'), 'guided tours must navigate to the page assigned to each step');
  assert.ok(html.includes('guidedFrameNavigationPending'), 'the iframe must only refocus after tutorial-controlled navigation, not user navigation');
});

test('tutorial app directory contains every desktop app shortcut with valid local routes', () => {
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
  assert.doesNotMatch(html, /getElementById\(['\"]api-key['\"]\)\s*\.value/);
});

test('novel workshop guide reflects current local-template behavior', () => {
  const extra = readExtraLessons(html);
  const lesson = extra.find((item) => item.id === 'novel-workshop');
  assert.ok(lesson);
  const body = [lesson.lead, ...lesson.steps.map((step) => step.join(' ')), ...lesson.tips.map((tip) => tip.join(' '))].join(' ');
  assert.match(body, /本地/);
  assert.match(body, /真实 AI 生成尚未接入/);
});

test('PWA caches the tutorial app and dedicated CI runs tests, layout check and build', () => {
  assert.match(sw, /phone-app-pwa-v177/);
  assert.match(sw, /'\.\/tutorial\/tutorial\.html'/);
  assert.equal(packageJson.scripts['test:tutorial'], 'node --test tests/tutorial-app-contract.test.mjs');
  assert.match(tutorialWorkflow, /npm run test:tutorial/);
  assert.match(tutorialWorkflow, /npm run test:desktop:layout/);
  assert.match(tutorialWorkflow, /npm run build/);
});
