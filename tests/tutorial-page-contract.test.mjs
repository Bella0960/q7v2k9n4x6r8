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

test('all 29 desktop app shortcuts have a matching app guide and quick-open entry', () => {
  const tiles = [...home.matchAll(/data-href="([^"]+)" data-drag="(app_[^"]+)" data-name="([^"]+)"/g)]
    .map((match) => ({ path: match[1], id: match[2], name: match[3] }))
    .filter((item) => item.id.startsWith('app_'));
  const appGuideIds = [...guideScript.matchAll(/id:'(app-[^']+)'/g)].map((match) => match[1]);
  const appEntries = [...guideScript.matchAll(/\['([^']+)',\s*'([^']+\.html)',\s*'[^']+'\]/g)]
    .map((match) => ({ name: match[1], path: match[2] }));
  assert.equal(tiles.length, 29, 'expected all desktop app tiles, including Tutorial');
  assert.equal(appGuideIds.length, 29, 'every app must have its own step-by-step guide');
  assert.equal(appEntries.length, 29, 'every app must appear in the quick-open directory');
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
  assert.equal((faqSection.match(/^    \[/gm) || []).length, 12, 'expected searchable FAQ entries');
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
  assert.match(serviceWorker, /const CACHE_NAME = 'phone-app-pwa-v204'/);
  assert.ok(serviceWorker.includes("'./tutorial/tutorial.html'"));
  assert.ok(serviceWorker.includes("'./tutorial/tutorial.js?v=20261111v4'"));
  assert.equal(packageJson.scripts['test:tutorial'], 'node --test tests/tutorial-page-contract.test.mjs');
});

test('chat detail scripts parse so the conversation settings handler can bind', () => {
  const scripts = [...chatDetail.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(([, attributes]) => !/\bsrc\s*=|\btype\s*=/.test(attributes));
  assert.ok(scripts.some(([, , source]) => /async function sendMsg\(/.test(source)));
  for (const [, , source] of scripts) new Function(source);
});

const apiSettings = read('settings/settings.html');
const apiSettingsScript = read('settings/js/settings.js');
const miniMaxSettings = read('settings/minimax-tts.html');

test('API-first handbook explains credentials, /v1, connection results, sampling, images and MiniMax', () => {
  for (const chapter of ['api-first', 'api-url-v1', 'api-errors', 'api-params', 'api-images', 'minimax-voice-guide']) {
    assert.ok(guideScript.includes('"id": "' + chapter + '"'), 'missing technical chapter: ' + chapter);
    assert.ok(guideHtml.includes('data-open-guide="' + chapter + '"'), 'missing chapter navigation: ' + chapter);
  }
  for (const keyword of ['401','403','404','429','CORS','chat/completions','images/generations','Temperature','Top P','Group ID','Voice ID']) {
    assert.ok(guideScript.includes(keyword), 'missing critical technical concept: ' + keyword);
  }
  assert.match(guideHtml, /id="diagnoseSelect"/);
  assert.match(guideHtml, /id="diagnoseAnswer"/);
  assert.match(guideHtml, /id="storageAlert"/);
  assert.match(guideScript, /MIX 和 MiniMax 是同一个语音功能吗/);
  assert.match(guideScript, /最近最多 14 条聊天消息/);
  assert.match(guideScript, /function guideCard\(guide\)/);
  assert.match(guideScript, /\^#guide=/);
});

test('actual settings link to relevant lessons and temperature zero is saved', () => {
  for (const chapter of ['api-first','api-url-v1','api-errors','api-params','api-images']) {
    assert.ok(apiSettings.includes('tutorial.html#guide=' + chapter), 'API settings missing lesson link: ' + chapter);
  }
  assert.ok(miniMaxSettings.includes('tutorial.html#guide=minimax-voice-guide'));
  assert.equal((apiSettingsScript.match(/temperature: Number\.isFinite\(Number\(apiTemperatureInput\.value\)\)/g) || []).length, 2);
  assert.doesNotMatch(apiSettingsScript, /temperature: parseFloat\(apiTemperatureInput\.value\) \|\| 0\.7/);
  assert.ok(guideScript.includes('保存只表示配置写到浏览器'));
});


test('technical handbook shows readable chapters and separates voice wiring from settings storage', () => {
  for (const id of ['walkArticle','walkStepperContent','walkProgressWrap','catalogDetails']) {
    assert.ok(guideHtml.includes('id="' + id + '"'), 'missing technical article component: ' + id);
  }
  assert.match(guideScript, /function renderTechnicalGuide\(guide\)/);
  assert.match(guideScript, /function isTechnicalGuide\(guide\)/);
  assert.match(guideScript, /OFFICIAL_PORTALS/);
  assert.match(guideScript, /尚未核实完整的远程语音合成请求/);
  assert.match(guideScript, /\$\('walkArticle'\)\.hidden = false/);
  assert.match(guideScript, /\$\('walkStepperContent'\)\.hidden = false/);
  assert.match(guideHtml, /class="diagnosis-disclaimer"/);
  assert.ok(miniMaxSettings.includes('尚不等于完成真实语音连接或播放验收'));
  assert.ok(miniMaxSettings.includes("return localStorage.getItem(STORAGE_KEY) === serialized"));
  assert.ok(miniMaxSettings.includes('保存失败，请检查浏览器存储空间和权限'));
});

test('live connection checks current form and distinguishes success, errors and unsupported response shapes', async () => {
  const start = apiSettingsScript.indexOf('function friendlyHttpError(status, detail) {');
  const end = apiSettingsScript.indexOf('// 绑定测试连接按钮点击', start);
  assert.ok(start >= 0 && end > start, 'cannot isolate connection-test runtime');
  const functionSource = apiSettingsScript.slice(start, end);
  const make = new Function(
    'apiKeyInput','apiUrlInput','apiModelInput','document',
    'fetch','AbortController','setTimeout','clearTimeout','URL','Date',
    functionSource + '\nreturn testConnection;'
  );
  const scenarios = [
    { name:'success', code:200, match:/聊天连接成功.*保存全部设置/ },
    { name:'HTTP 400', code:400, match:/请求格式/ },
    { name:'HTTP 401', code:401, match:/API Key/ },
    { name:'HTTP 403', code:403, match:/访问权限/ },
    { name:'HTTP 404', code:404, match:/模型/ },
    { name:'HTTP 429', code:429, match:/额度/ },
    { name:'HTTP 500', code:500, match:/服务器/ },
    { name:'malformed HTTP 200', code:200, response:{ hello:true }, match:/未包含兼容的聊天结果/ },
    { name:'CORS', error:'Failed to fetch', match:/CORS/ },
    { name:'timeout', error:'timeout', abort:true, match:/15 秒/ },
    { name:'duplicate path', url:'https://example.invalid/v1/chat/completions', match:/移除末尾/ },
    { name:'empty Key', key:'', match:/请先填写 API Key/ },
    { name:'invalid URL', url:'not-a-url', match:/有效网址/ }
  ];
  for (const scenario of scenarios) {
    const keyInput = { value: scenario.key === undefined ? 'not-a-real-key' : scenario.key };
    const urlInput = { value: scenario.url || 'https://example.invalid/v1' };
    const modelInput = { value:'demo-chat-model' };
    const button = { disabled:false, textContent:'测试连接' };
    const message = { innerText:'', style:{} };
    const calls = [];
    const fetchMock = async (url, options) => {
      calls.push({ url, options });
      if (scenario.error) {
        const error = new Error(scenario.error);
        if (scenario.abort) error.name = 'AbortError';
        throw error;
      }
      return {
        status:scenario.code, ok:scenario.code < 300,
        statusText:'ERROR',
        json:async () => scenario.response || (
          scenario.code === 200
            ? { choices:[{ message:{ content:'OK' } }] }
            : { error:{ message:'Provider error' } }
        )
      };
    };
    const check = make(
      keyInput,urlInput,modelInput,
      {getElementById(id) { return id === 'test-msg' ? message : id === 'btn-test-connection' ? button : null; }},
      fetchMock,AbortController,()=>1,()=>{},URL,Date
    );
    await check();
    assert.match(message.innerText, scenario.match, scenario.name);
    assert.equal(button.disabled, false, scenario.name + ': unlock');
    assert.equal(button.textContent, '测试连接', scenario.name + ': label');
    assert.doesNotMatch(message.innerText, /not-a-real-key/, scenario.name + ': key is not shown');
    if (scenario.name === 'success') {
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://example.invalid/v1/chat/completions');
      const request = JSON.parse(calls[0].options.body);
      assert.equal(request.model, 'demo-chat-model');
      assert.equal(Object.prototype.hasOwnProperty.call(request, 'max_tokens'), false);
      assert.equal(Object.prototype.hasOwnProperty.call(request, 'temperature'), false);
      assert.equal(request.messages.length, 1);
    }
  }
});


test('tutorial storage failures are visible and existing valid progress survives', () => {
  const script = guideScript;
  assert.match(script, /return parsed && typeof parsed === 'object' && !Array\.isArray\(parsed\)/);
  assert.match(script, /测试记录未保存到本机/);
  assert.match(script, /无法清空本机的测试记录/);
  assert.match(script, /function saveWalkthroughState\(\) \{[\s\S]*?return saveProgress\(\)/);
  assert.match(script, /var removed = false/);
  assert.ok(guideHtml.includes('id="storageAlert"'));
});
