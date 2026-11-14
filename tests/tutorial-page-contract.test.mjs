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
  assert.match(guideScript, /PR #241/);
  assert.match(guideScript, /PR #240/);
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

test('all 30 desktop app shortcuts have a matching guide; creator-only tutorial is role-gated', () => {
  const tiles = [...home.matchAll(/data-href="([^"]+)" data-drag="(app_[^"]+)" data-name="([^"]+)"/g)]
    .map((match) => ({ path: match[1], id: match[2], name: match[3] }))
    .filter((item) => item.id.startsWith('app_'));
  const appGuideIds = [...guideScript.matchAll(/id:'(app-[^']+)'/g)].map((match) => match[1]);
  const appEntries = [...guideScript.matchAll(/\['([^']+)',\s*'([^']+\.html)',\s*'[^']+'\]/g)]
    .map((match) => ({ name: match[1], path: match[2] }));
  assert.equal(tiles.length, 30, 'expected 29 ordinary tiles plus the creator-only manager');
  assert.equal(appGuideIds.length, 30, 'the founder-only app also needs a guide');
  assert.equal(appEntries.length, 30, 'the founder-only app also needs a directory entry');
  tiles.forEach((tile) => {
    assert.ok(guideScript.includes("href:'../" + tile.path + "'"), 'missing app guide route for ' + tile.name);
    assert.ok(appEntries.some((entry) => entry.path === tile.path), 'missing quick-open entry for ' + tile.name);
    assert.ok(existsSync(resolve(root, tile.path)), 'missing app page for ' + tile.name + ': ' + tile.path);
  });
  assert.ok(tiles.some(tile => tile.id === 'app_admin_center' && tile.path === 'admin/admin-center.html'));
  assert.match(guideScript, /founderRole\.content === 'super_admin'/);
  assert.match(guideScript, /if \(isFounder\) \{/);
  assert.match(guideScript, /GUIDES\.push\(\{/);
  assert.match(guideScript, /APPS\.push\(\['管理中心'/);
  assert.match(guideScript, /id:'account-access'/);
  assert.match(guideScript, /id:'app-admin'/);
});

test('current founder QA guide links to real admin, social and chat screens without claiming unverified features', () => {
  assert.match(guideScript, /id: 'qa-001-admin'/);
  assert.match(guideScript, /id: 'qa-001-social'/);
  assert.match(guideScript, /id: 'qa-001-chat-save'/);
  assert.match(guideScript, /原管理员 001 已完成手机登录/);
  assert.match(guideScript, /href: '\.\.\/chat\/contacts\/real-friends\.html'/);
  assert.match(guideScript, /已审批真人好友会直接出现在聊天首页/);
  assert.match(guideScript, /麦克风/);
  assert.match(guideScript, /相册照片/);
  assert.match(guideScript, /不需要 AI API/);
  assert.match(guideScript, /不要填写密码/);
});

test('2026-11-14 QA guide is inside the real desktop app and gates unverified server claims', () => {
  assert.match(guideHtml, /id="qaReadinessTitle"/);
  assert.match(guideHtml, /id="qaCloudStatus"/);
  assert.match(guideHtml, /id="qaAccountStatus"/);
  assert.match(guideHtml, /id="qaPushStatus"/);
  assert.match(guideHtml, /id="qaRecheck"/);
  assert.match(guideHtml, /tutorial\.js\?v=20261114qa1/);
  assert.match(guideScript, /id: 'qa-20261114-quickstart'/);
  for (const id of ['qa-20261114-push', 'qa-20261114-forum',
    'qa-20261114-inspect', 'qa-20261114-theme', 'qa-20261114-wallet']) {
    assert.ok(guideScript.includes("id: '" + id + "'"), 'missing staged QA guide ' + id);
  }
  assert.match(guideScript, /qaRead\('\/api\/health'\)/);
  assert.match(guideScript, /qaRead\('\/api\/admin\/bootstrap\/status'\)/);
  assert.match(guideScript, /health\.vapidConfigured === true/);
  assert.match(guideScript, /account\.identityAuthorityConnected === true/);
  assert.match(guideScript, /checkQaReadiness\(\)/);
  assert.match(guideScript, /不能把旧预览的 001 登录当成当前成功/);
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
  assert.ok(Number(/phone-app-pwa-v(\d+)/.exec(serviceWorker)?.[1]) >= 206, 'tutorial update must ship with the newer authenticated PWA cache');
  assert.ok(serviceWorker.includes("'./tutorial/tutorial.html'"));
  assert.ok(serviceWorker.includes("'./tutorial/tutorial.js?v=20261114qa1'"));
  assert.equal(packageJson.scripts['test:tutorial'], 'node --test tests/tutorial-page-contract.test.mjs');
});

test('chat detail scripts parse so the conversation settings handler can bind', () => {
  const scripts = [...chatDetail.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attributes]) => !/\bsrc\s*=|\btype\s*=/.test(attributes));
  assert.ok(scripts.some(([, , source]) => /async function sendMsg\(/.test(source)));
  for (const [, , source] of scripts) new Function(source);
});

test('mobile bug report is copyable, compact and only collects declared test notes', () => {
  assert.match(guideHtml, /id="copyTests"/);
  assert.match(guideHtml, /id="copyTestsHint"/);
  assert.match(guideScript, /function buildTestReport\(onlyTouched\)/);
  assert.match(guideScript, /if \(onlyTouched && !state\.done && !String\(state\.note \|\| ''\)\.trim\(\)\) return/);
  assert.match(guideScript, /var report = buildTestReport\(true\)/);
  assert.match(guideScript, /navigator\.clipboard\.writeText\(report\)/);
  assert.match(guideScript, /window\.prompt\('未能自动复制/);
  assert.match(guideScript, /'屏幕视口：' \+ width/);
  assert.doesNotMatch(guideScript.slice(guideScript.indexOf('function buildTestReport('), guideScript.indexOf('function exportProgress(')), /chat_history|api_key|localStorage\.getItem|document\.cookie/i);
});
