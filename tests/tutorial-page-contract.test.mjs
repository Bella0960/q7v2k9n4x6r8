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
const tutorialWorkflow = read('.github/workflows/tutorial-regression.yml');

test('tutorial script parses without syntax errors', () => {
  assert.doesNotThrow(() => new Function(guideScript));
});

test('tutorial is a desktop app and is added without resetting saved layouts', () => {
  assert.match(home, /data-href="tutorial\/tutorial\.html"/);
  assert.match(home, /data-drag="app_tutorial"/);
  assert.match(home, /addTutorialShortcutToExistingLayouts/);
  assert.match(home, /currentLayout\.removed \|\| \[\]\)\.indexOf\(id\)/);
  assert.match(home, /indexOf\('app_settings'\)/);
});

test('tutorial migration preserves custom pages, Dock and removal choices', () => {
  const source = home.match(/\(function addTutorialShortcutToExistingLayouts\(\) \{[\s\S]*?\n      \}\)\(\);/);
  assert.ok(source);
  const migrate = new Function('currentLayout', 'saveLayout', source[0]);
  const layout = { pages: [['app_chat'], ['app_settings', 'app_finance']], dock: ['app_shop'], removed: ['clock'] };
  let saves = 0;
  const save = () => { saves++; };
  migrate(layout, save);
  migrate(layout, save);
  assert.deepEqual(layout, {
    pages: [['app_chat'], ['app_settings', 'app_tutorial', 'app_finance']],
    dock: ['app_shop'],
    removed: ['clock']
  });
  assert.equal(saves, 1);

  const hidden = { pages: [['app_settings']], dock: ['app_shop'], removed: ['app_tutorial'] };
  migrate(hidden, save);
  assert.deepEqual(hidden.pages, [['app_settings']]);
  assert.equal(saves, 1);
});

test('guide documents the merged chat features and correctly separates unverified push', () => {
  // Reader-facing release notes are editorial, not a dump of internal PRs.
  const bulletin = guideScript.slice(
    guideScript.indexOf('var OFFICIAL_RELEASE_NOTES ='),
    guideScript.indexOf('var GUIDES =')
  );
  assert.match(bulletin, /OFFICIAL_RELEASE_NOTES/);
  assert.doesNotMatch(bulletin, /PR #|测试候选|修 bug/);
  assert.match(guideScript, /release\.approved === true/);
  assert.match(guideScript, /release\.status === 'published'/);
  assert.match(guideScript, /单条 \/ 自动 \/ 连续多条/);
  assert.match(guideScript, /头像收藏/);
  assert.match(guideScript, /建立配对/);
  assert.match(guideScript, /收藏给TA/);
  assert.match(guideScript, /角色图库/);
  assert.match(guideScript, /主动联系只在 MAOMAO 前台打开时检查/);
  assert.match(guideScript, /手机系统推送要单独验收/);
  assert.match(guideScript, /自主挑图只使用标记为「公开」/);
  assert.match(guideScript, /此前的手机打不开反馈仍需在安装版和普通浏览器分别实测/);
});

test('every desktop app has a matching guide and quick-open entry, including admin center', () => {
  const tiles = [...home.matchAll(/data-href="([^"]+)" data-drag="(app_[^"]+)" data-name="([^"]+)"/g)]
    .map((match) => ({ path: match[1], id: match[2], name: match[3] }))
    .filter((item) => item.id.startsWith('app_'));
  const appGuideIds = [...guideScript.matchAll(/id:'(app-[^']+)'/g)].map((match) => match[1]);
  const appEntries = [...guideScript.matchAll(/\['([^']+)',\s*'([^']+\.html)',\s*'[^']+'\]/g)]
    .map((match) => ({ name: match[1], path: match[2] }));
  assert.ok(tiles.some((tile) => tile.id === 'app_admin_center'),
    'desktop admin-center shortcut must exist');
  assert.ok(tiles.some((tile) => tile.id === 'app_tutorial'),
    'desktop tutorial shortcut must exist');
  assert.equal(appGuideIds.length, tiles.length,
    'every real desktop app must have its own step-by-step guide');
  assert.equal(new Set(appGuideIds).size, appGuideIds.length,
    'duplicate app guides are not allowed');
  assert.equal(appEntries.length, tiles.length,
    'every real desktop app must appear in the quick-open directory');
  assert.equal(new Set(appEntries.map((entry) => entry.path)).size, appEntries.length,
    'duplicate quick-open destinations are not allowed');
  tiles.forEach((tile) => {
    assert.ok(guideScript.includes("href:'../" + tile.path + "'"), 'missing app guide route for ' + tile.name);
    assert.ok(appEntries.some((entry) => entry.path === tile.path), 'missing quick-open entry for ' + tile.name);
    assert.ok(existsSync(resolve(root, tile.path)), 'missing app page for ' + tile.name + ': ' + tile.path);
  });
});

test('all tutorial guide deep links resolve to real HTML pages', () => {
  const guideRoutes = [...guideScript.matchAll(/href:\s*'\.\.\/([^']+\.html)'/g)].map((match) => match[1]);
  assert.ok(guideRoutes.length >= 50, 'expected route links throughout the complete guide catalog');
  [...new Set(guideRoutes)].forEach((path) => {
    assert.ok(existsSync(resolve(root, path)), 'missing tutorial destination: ' + path);
  });
});

test('tutorial provides a real stepper, interface-location illustration, FAQ, and persisted progress', () => {
  assert.match(guideHtml, /id="guideSearch"/);
  assert.match(guideHtml, /id="walkthroughModal"/);
  assert.match(guideHtml, /id="walkStepDone"/);
  assert.match(guideHtml, /id="walkOpenPage"/);
  assert.match(guideHtml, /class="walk-visual"/);
  assert.match(guideHtml, /id="faqList"/);
  assert.match(guideHtml, /id="exportTests"/);
  assert.match(guideHtml, /id="resetModal"/);
  assert.match(guideScript, /maomao_tutorial_progress_v1/);
  assert.match(guideScript, /function startGuide/);
  assert.match(guideScript, /function moveWalkthrough/);
  assert.match(guideScript, /function renderFaqs/);
  const faqSection = guideScript.slice(guideScript.indexOf('var FAQS = ['), guideScript.indexOf('var APPS = ['));
  assert.equal((faqSection.match(/^    \['/gm) || []).length, 11, 'expected searchable FAQ entries');
});

test('manual is book-first: chapter index, readable sheets, official-only releases and folded private notebook', () => {
  assert.match(guideHtml, /id="guideCoverTitle"/);
  assert.match(guideHtml, /class="book-navigation"/);
  assert.match(guideHtml, /id="release-notes"/);
  assert.match(guideHtml, /id="book-index"/);
  assert.match(guideHtml, /class="test-notebook"/);
  assert.match(guideHtml, /id="guideSearch"/);
  assert.match(guideHtml, /id="walkthroughModal"/);
  assert.match(guideHtml, /tutorial\.js\?v=20261118book1/);
  assert.match(guideScript, /<details class="guide-sheet">/);
  assert.match(guideScript, /<summary class="guide-top">/);
  assert.match(guideScript, /NO PUBLIC RELEASE YET/);
  assert.doesNotMatch(guideScript.slice(guideScript.indexOf('function renderUpdates()'),guideScript.indexOf('function renderFilters()')),/GUIDE_UPDATES/);
  // Do not lose the existing reader's saved test/progress storage schema.
  assert.match(guideScript, /maomao_tutorial_progress_v1/);
  assert.match(guideScript, /function startGuide/);
  assert.match(guideScript, /function moveWalkthrough/);
});

test('book reader step navigation updates only the current chapter without rebuilding the open index', () => {
  const counter = guideScript.slice(
    guideScript.indexOf('  function refreshChapterProgress(guide) {'),
    guideScript.indexOf('  function startGuide(id) {')
  );
  const stepper = guideScript.slice(
    guideScript.indexOf('  function moveWalkthrough(delta) {'),
    guideScript.indexOf('  function exportProgress() {')
  );
  const toggle = guideScript.slice(
    guideScript.indexOf("  $('walkStepDone').addEventListener('change'"),
    guideScript.indexOf("  $('walkthroughModal').addEventListener('click'")
  );
  assert.match(counter, /querySelector\('/);
  assert.match(counter, /\.guide-step-meta/);
  assert.match(counter, /counter\.textContent/);
  assert.match(stepper, /refreshChapterProgress\(activeWalkthrough\)/);
  assert.match(toggle, /refreshChapterProgress\(activeWalkthrough\)/);
  assert.doesNotMatch(stepper, /renderGuides\(\)/);
  assert.doesNotMatch(toggle, /renderGuides\(\)/);
});

test('composer menu guide covers the actual one-to-one and group menu entry labels', () => {
  for (const label of ['表情包','奔赴','重玩','位置','纪念日','旁白动作','直播间','音乐','语音通话','视频通话','发红包','转账','图片','语音','名片','送礼物','群投票','群接龙','群通话']) {
    assert.ok(guideScript.includes(label), 'missing composer menu guide label: ' + label);
  }
});

test('conversation settings has a direct navigation fallback and is cached in the PWA shell', () => {
  assert.match(chatDetail, /onclick="if\(this\.dataset\.navBound!=='1'\)/);
  assert.match(chatDetail, /btnMoreMenu\.dataset\.navBound = '1'/);
  assert.match(chatDetail, /btnMoreMenu\.addEventListener\('click'/);
  assert.ok(serviceWorker.includes("'./chat/chat/chat-settings.html'"));
});

test('tutorial workflow enforces a guide update when user-facing app pages change', () => {
  assert.match(tutorialWorkflow, /pull_request:/);
  assert.match(tutorialWorkflow, /npm run test:tutorial/);
  assert.match(tutorialWorkflow, /User-facing MAOMAO files changed without updating tutorial\/tutorial\.js/);
  assert.match(tutorialWorkflow, /execFileSync\('git', \['diff', '--name-only',/);
  assert.match(tutorialWorkflow, /tutorial\/tutorial\.js/);
});

test('PWA app shell caches the full guide bundle and has a matching test command', () => {
  assert.match(serviceWorker, /const CACHE_NAME = 'phone-app-pwa-v[0-9]+'/,
    'PWA shell must use a versioned cache without hard-coding an old release');
  assert.ok(serviceWorker.includes("'./tutorial/tutorial.html'"));
  assert.ok(serviceWorker.includes("'./tutorial/tutorial.js?v=20261118book1'"));
  assert.equal(packageJson.scripts['test:tutorial'], 'node --test tests/tutorial-page-contract.test.mjs');
});

test('chat detail scripts parse so the conversation settings handler can bind', () => {
  const scripts = [...chatDetail.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attributes]) => !/\bsrc\s*=|\btype\s*=/.test(attributes));
  assert.ok(scripts.some(([, , source]) => /async function sendMsg\(/.test(source)));
  for (const [, , source] of scripts) new Function(source);
});

test('account release candidate guide documents the existing login path and QA safety boundary', () => {
  assert.match(guideScript, /"id"\s*:\s*"account-qa"/);
  assert.match(guideScript, /已有账号 · 登录/);
  assert.match(guideScript, /管理员中心（QA 待验收）/);
  assert.match(guideScript, /"href"\s*:\s*"\.\.\/account\/index\.html"/);
  assert.match(guideScript, /本机备份不等于云端账号的可恢复备份/);
  assert.match(guideScript, /不得对正式账号执行停用、重置或清空/);
});

test('fanwai tutorial exposes hidden story preferences without claiming production acceptance', () => {
  assert.match(guideScript, /"id"\s*:\s*"fanwai-story-qa"/);
  assert.match(guideScript, /番外剧场与隐藏故事设置（QA 待验收）/);
  assert.match(guideScript, /输入栏「＋」→「番外」/);
  assert.match(guideScript, /不带记忆/);
  assert.match(guideScript, /参考角色记忆/);
  assert.match(guideScript, /短篇 40 条、中篇 80 条、长篇 100 条/);
  assert.match(guideScript, /不能当作成功/);
  assert.match(guideScript, /不允许写入原聊天、长期记忆或钱包/);
});
