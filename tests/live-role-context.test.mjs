import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-LIVE-001 · 直播间角色来源与 AI 调用契约
 * 从 companion/live.html 截取真实实现，在隔离上下文跑：
 * 角色必须来自正式 PhoneStorage；AI 必须走共享 PhoneAPI；背景写入失败不能说已切换。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(resolve(root, 'companion/live.html'), 'utf8');

function slice(from, to) {
  const start = page.indexOf(from);
  const end = page.indexOf(to, start);
  assert.ok(start > 0 && end > start, `cannot slice ${from}`);
  return page.slice(start, end);
}

const characterBlock = slice('/* 角色来源：优先用共享 PhoneStorage', '/* ========== 基础设置 ========== */');
const aiBlock = slice('/* 配置读取：与设置页保持一致', '/* ========== 背景自定义 ========== */');
const bgBlock = slice("const BG_KEY='maomao_live_bg_v1';", 'function openBgSheet()');

function makeStore(seed = {}) {
  const raw = { ...seed };
  let quota = false;
  return {
    getItem: (k) => (k in raw ? raw[k] : null),
    setItem: (k, v) => {
      if (quota) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
      raw[k] = String(v);
    },
    removeItem: (k) => { delete raw[k]; },
    failWrites: (flag) => { quota = flag; },
    raw,
  };
}

function makeSandbox({ store, phoneStorage, bubbles = [], toasts = [] }) {
  const fetched = [];
  const sandbox = {
    localStorage: store,
    BG_KEY: 'maomao_live_bg_v1',
    aiPending: false,
    me: { name: '阿岚', avatar: '', persona: '温柔' },
    stream: { querySelectorAll: () => [] },
    pushBubble: (b) => bubbles.push(b),
    pick: (arr) => arr[0],
    toast: (t) => toasts.push(t),
    clearTimeout,
    setTimeout,
    fetch: (...args) => { fetched.push(args); return Promise.reject(new Error('raw fetch must not be used')); },
    JSON,
    Object,
    String,
    Number,
    Array,
    Math,
    Date,
    Promise,
    Error,
    console,
  };
  sandbox.window = sandbox;
  if (phoneStorage) sandbox.PhoneStorage = phoneStorage;
  vm.createContext(sandbox);
  vm.runInContext(characterBlock, sandbox);
  vm.runInContext(aiBlock, sandbox);
  vm.runInContext(bgBlock, sandbox);
  return { sb: sandbox, fetched, bubbles, toasts };
}

const chars = [
  { id: 'roleB', name: '白露', avatar: 'b.png', personality: '安静' },
  { id: 'roleA', name: '阿岚', avatar: 'a.png', personality: '温柔', speechStyle: '轻声' },
];

test('角色来源：PhoneStorage 优先，按当前联系人取到正式角色', () => {
  const store = makeStore({ phone_current_contact: 'roleB', ai_custom_characters: JSON.stringify([{ id: 'legacy', name: '旧角色' }]) });
  const { sb } = makeSandbox({
    store,
    phoneStorage: {
      getCharacters: () => chars,
      getCurrentContactId: () => 'roleA',
    },
  });

  const me = sb.readCurrentCharacter();
  assert.equal(me.name, '阿岚', 'must follow PhoneStorage current contact, not the legacy key');
  assert.equal(me.avatar, 'a.png');
  assert.ok(me.persona.includes('温柔') && me.persona.includes('轻声'), 'persona should aggregate the character card fields');
});

test('角色来源：PhoneStorage 为空时回落旧键，不会变成无名 TA', () => {
  const store = makeStore({ phone_current_contact: 'x', ai_custom_characters: JSON.stringify([{ id: 'x', name: '旧角色', persona: '旧人设' }]) });
  const { sb } = makeSandbox({ store, phoneStorage: { getCharacters: () => [], getCurrentContactId: () => '' } });

  const me = sb.readCurrentCharacter();
  assert.equal(me.name, '旧角色');
  assert.equal(me.persona, '旧人设');
});

test('角色来源：两边都没有才是 TA，且不至于抛异常', () => {
  const store = makeStore();
  const { sb } = makeSandbox({ store });
  assert.doesNotThrow(() => sb.readCurrentCharacter());
  assert.equal(sb.readCurrentCharacter().name, 'TA');
});

test('AI 配置：PhoneStorage.getApiConfig 优先于旧 api_settings', () => {
  const store = makeStore({ api_settings: JSON.stringify({ apiKey: 'legacy-key' }) });
  const { sb } = makeSandbox({ store, phoneStorage: { getApiConfig: () => ({ apiKey: 'real-key' }) } });
  assert.equal(sb.liveApiConfig().apiKey, 'real-key');
});

test('AI 配置：共享模块没配 key 时才用旧键兜底', () => {
  const store = makeStore({ api_settings: JSON.stringify({ apiKey: 'legacy-key' }) });
  const { sb } = makeSandbox({ store, phoneStorage: { getApiConfig: () => ({ apiKey: '' }) } });
  assert.equal(sb.liveApiConfig().apiKey, 'legacy-key');
});

test('AI 调用：走共享 PhoneAPI，不发自己的 fetch', async () => {
  const store = makeStore();
  const bubbles = [];
  const { sb, fetched } = makeSandbox({
    store,
    bubbles,
    phoneStorage: { getApiConfig: () => ({ apiKey: 'real-key' }) },
  });
  sb.PhoneAPI = { complete: () => Promise.resolve('  今晚就慢慢聊呀。  ') };

  await sb.callHostAI('主播今天心情怎么样');
  assert.equal(fetched.length, 0, 'must not keep a parallel raw fetch implementation');
  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0].text, '今晚就慢慢聊呀。');
  assert.equal(bubbles[0].type, 'host');
});

test('AI 调用：PhoneAPI 不可用时给可读兜底，不崩', async () => {
  const store = makeStore();
  const bubbles = [];
  const { sb } = makeSandbox({ store, bubbles, phoneStorage: { getApiConfig: () => ({ apiKey: 'real-key' }) } });

  await sb.callHostAI('在吗');
  assert.equal(bubbles.length, 1);
  assert.ok(bubbles[0].text.includes('信号不太好'));
  assert.equal(sb.aiPending, false, 'pending flag must be released even on failure');
});

test('AI 调用：没有 key 时用本地兜底台词，不请求接口', async () => {
  const store = makeStore();
  const bubbles = [];
  const { sb, fetched } = makeSandbox({ store, bubbles, phoneStorage: { getApiConfig: () => ({ apiKey: '' }) } });
  let called = 0;
  sb.PhoneAPI = { complete: () => { called++; return Promise.resolve('x'); } };

  await sb.callHostAI('在吗');
  assert.equal(called, 0);
  assert.equal(fetched.length, 0);
  assert.equal(bubbles.length, 1);
});

test('背景保存：成功返回 true，失败返回 false 且不谎报', () => {
  const store = makeStore();
  const toasts = [];
  const { sb } = makeSandbox({ store, toasts });

  assert.equal(sb.saveBg({ type: 'preset', key: 'neon' }), true);
  assert.equal(JSON.parse(store.raw.maomao_live_bg_v1).key, 'neon');
  sb.bgToast(true);
  assert.ok(toasts.pop().includes('背景已切换'));

  store.failWrites(true);
  assert.doesNotThrow(() => sb.saveBg({ type: 'preset', key: 'mint' }));
  assert.equal(sb.saveBg({ type: 'preset', key: 'mint' }), false);
  sb.bgToast(false);
  const msg = toasts.pop();
  assert.equal(msg.includes('背景已切换'), false, 'must not claim success when the write failed');
  assert.ok(msg.includes('只在这次显示'), 'must explain that the background will not survive a refresh');
});

test('源码守卫：页面已引入共享存储与 AI 模块，且不再自带 fetch 请求', () => {
  assert.ok(page.includes('shared/js/phone/phone_storage.js'), 'must load PhoneStorage');
  assert.ok(page.includes('shared/js/phone/phone_api.js'), 'must load PhoneAPI');
  assert.equal(page.includes("fetch(base+'/chat/completions'"), false, 'parallel transport must be gone');
  assert.ok(page.includes('PhoneAPI.complete('), 'must use the shared AI entrypoint');
});
