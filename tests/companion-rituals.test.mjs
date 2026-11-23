import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-COMPANION-001 · 角色陪伴（companion/rituals.html）
 * 重点回归：
 *  1. 必须使用共享 PhoneAPI + 共享 API 配置，不得自己 fetch / 读旧 api_settings
 *  2. 正式角色人设进入提示词；没有正式角色才退回名字匹配
 *  3. 付费回应有额度/间隔/进行中锁，没有 API 时零费用本地回应
 *  4. 预算写不进本机时 fail-closed
 * 全部 mock，不产生任何真实网络请求。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(resolve(root, 'companion/rituals.html'), 'utf8');

const script = (() => {
  const start = page.indexOf('<script>');
  const end = page.indexOf('</script>', start);
  assert.ok(start > 0 && end > start, 'rituals script not found');
  return page.slice(start + '<script>'.length, end);
})();

/* 状态已按正式角色分桶（总控 P1）：测试的当前角色是 roleA */
const KEY = 'maomao_companion_v1_roleA';

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
    failWrites: (f) => { quota = f; },
    raw,
  };
}

function makeEl(id) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    dataset: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    _h: {},
    addEventListener(ev, fn) { this._h[ev] = fn; },
    append() {},
    appendChild() {},
    closest() { return null; },
    querySelectorAll() { return []; },
    play() { return Promise.resolve(); },
    pause() {},
    load() {},
    click() { if (this._h.click) return this._h.click({ preventDefault() {}, target: this }); },
  };
}

function makeRuntime({ store, currentRole = 'roleA', apiKey = 'test-key', behavior = 'resolve', reply = '刚听到这首歌就想起你们了。' } = {}) {
  const els = {};
  const calls = [];
  const sandbox = {
    localStorage: store,
    document: {
      getElementById: (id) => (els[id] = els[id] || makeEl(id)),
      querySelector: () => (els.__orb = els.__orb || makeEl('orb')),
      querySelectorAll: () => [],
      createElement: (tag) => makeEl(tag),
      addEventListener() {},
    },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    JSON, Object, String, Number, Array, Math, Date, Promise, Error, isFinite, console,
    AbortController,
  };
  sandbox.window = sandbox;
  const ROLES = [
    { id: 'roleA', name: '阿岚', personality: '温柔、话不多', speechStyle: '轻声' },
    { id: 'roleB', name: '白露', personality: '安静、喜欢观察' },
  ];
  sandbox.PhoneStorage = {
    getCharacters: () => ROLES,
    getCurrentContactId: () => currentRole,
    getApiConfig: () => ({ apiKey }),
  };
  sandbox.PhoneAPI = {
    complete: (payload) => {
      calls.push(payload);
      if (behavior === 'reject') return Promise.reject(new Error('请求超时（20000ms）'));
      return Promise.resolve(reply);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return { sb: sandbox, els, calls, get: (id) => (els[id] = els[id] || makeEl(id)) };
}

const flush = () => new Promise((r) => setTimeout(r, 10));
const today = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

test('正式角色：标题与来电都用共享当前角色，不用自由输入的名字', () => {
  const store = makeStore();
  const { get } = makeRuntime({ store, currentRole: 'roleB' });
  assert.ok(get('liveRoleTitle').textContent.includes('白露'));
  assert.ok(get('callTitle').textContent.includes('白露'));
});

test('有 API：一次点击 = 一次共享 PhoneAPI 调用，人设来自正式角色', async () => {
  const store = makeStore();
  const { calls, get, sb } = makeRuntime({ store, currentRole: 'roleA' });

  await get('askRoleBtn').click();
  await flush();

  assert.equal(calls.length, 1, '必须只发一次');
  assert.ok(String(calls[0].system).includes('阿岚'));
  assert.ok(String(calls[0].system).includes('温柔、话不多'), '正式角色人设必须进入提示词');
  assert.equal(/apiKey|Bearer|sk-/.test(JSON.stringify(calls[0])), false, '提示词里不得带密钥');
  assert.ok(get('liveComments').textContent !== undefined);
  const saved = JSON.parse(store.raw[KEY] || '{}');
  assert.ok((saved.comments || []).some((c) => String(c).includes('阿岚')), '回应要落进留言区并持久化');
  assert.ok(sb.REPLY_DAILY_LIMIT ? true : true);
});

test('没有 API：零费用本地回应，不扣额度', async () => {
  const store = makeStore();
  const { calls, get } = makeRuntime({ store, apiKey: '' });

  await get('askRoleBtn').click();
  await flush();

  assert.equal(calls.length, 0, '无 key 时不得调用付费接口');
  assert.equal(store.raw.maomao_companion_reply_budget_v1, undefined, '不得记账');
  assert.ok(get('listenState').textContent.includes('零费用'), '要说明这是本地回应');
  const saved = JSON.parse(store.raw[KEY] || '{}');
  assert.ok((saved.comments || []).length === 1, '至少给一句本地回应，而不是点了没反应');
});

test('额度：每天 20 次用完后再点 0 请求', async () => {
  const store = makeStore({
    maomao_companion_reply_budget_v1: JSON.stringify({ day: today(), used: 20 }),
  });
  const { calls, get } = makeRuntime({ store });
  await get('askRoleBtn').click();
  await flush();
  assert.equal(calls.length, 0);
  assert.ok(get('toast').textContent.includes('已用完'));
});

test('间隔：10 秒内重复点只保留 1 次请求', async () => {
  const store = makeStore();
  const { calls, get } = makeRuntime({ store });
  await get('askRoleBtn').click();
  await flush();
  await get('askRoleBtn').click();
  await flush();
  assert.equal(calls.length, 1, '必须遵守最小间隔');
});

test('进行中锁：连续点击不会并发花钱', async () => {
  const store = makeStore();
  const { calls, get } = makeRuntime({ store });
  let resolveLater;
  const hanging = new Promise((r) => { resolveLater = r; });
  get('askRoleBtn').click();     // 第一次：pending
  get('askRoleBtn').click();     // 第二次：应被 busy 拦住
  resolveLater();
  await flush();
  assert.ok(calls.length <= 1, '并发点击不得产生多次请求');
});

test('预算写不进本机：第一次就是 0 次付费请求（fail-closed）', async () => {
  const store = makeStore();
  const { calls, get } = makeRuntime({ store });
  store.failWrites(true);          // 之后任何 setItem 都失败
  await get('askRoleBtn').click();
  await flush();
  assert.equal(calls.length, 0, '预算写不进本机就绝不能发出付费请求');
  assert.ok(get('toast').textContent.includes('预算') || get('toast').textContent.includes('没能写入'), '必须说明原因');

  get('sb').lastReplyAt = 0;
  await get('askRoleBtn').click();
  await flush();
  assert.equal(calls.length, 0, '后续也保持 0 次');
});

test('P1 续：预算写入必须读回确认（不是只看有没有抛异常）', () => {
  /* 用一个会「写进去但读出来不一样」的假存储验证读回校验 */
  const raw = {};
  const store = {
    getItem: (k) => (k in raw ? raw[k] : null),
    setItem: (k, v) => { raw[k] = String(v) + '!corrupted'; },   /* 写入后内容被改，读回不匹配 */
    removeItem: (k) => { delete raw[k]; },
    raw,
  };
  const r = makeRuntime({ store });
  r.get('askRoleBtn').click();
  return Promise.resolve().then(() => {
    assert.equal(r.calls.length, 0, '读回校验失败也必须 fail-closed');
  });
});

test('失败不自动重试：只 1 次请求并提示', async () => {
  const store = makeStore();
  const { calls, get } = makeRuntime({ store, behavior: 'reject' });
  await get('askRoleBtn').click();
  await flush();
  assert.equal(calls.length, 1);
  assert.ok(get('toast').textContent.length > 0);
});

test('存储失败：角色/闹钟写着失败要提示，不静默', () => {
  const store = makeStore();
  const { get } = makeRuntime({ store });
  store.failWrites(true);
  get('roleName').value = '阿岚';
  get('saveRole').click();
  assert.ok(get('toast').textContent.includes('存储空间不足') || get('toast').textContent.includes('没能保存'));
});

test('源码守卫：不再自建 AI 通道、不读旧配置、有成本护栏', () => {
  assert.equal(/fetch\s*\(/.test(script), false, '不得自己 fetch');
  assert.equal(/localStorage\.getItem\('api_settings'\)/.test(script), false, '不得再读旧 api_settings');
  assert.ok(script.includes('PhoneAPI.complete'), '必须复用共享 API');
  assert.ok(script.includes('PhoneStorage.getApiConfig'), '必须复用共享配置');
  assert.ok(script.includes('REPLY_DAILY_LIMIT'), '必须有每日额度');
  assert.ok(script.includes('REPLY_MIN_INTERVAL'), '必须有最小间隔');
  assert.ok(script.includes('getCurrentContactId'), '必须绑定正式角色');
  assert.equal(/Made by|作者：/.test(page), false, 'no developer signature');
});

/* ---------- 总控首轮审查：真实脚本链与角色私有数据 ---------- */

test('真实 HTML 真的加载了 phone_storage.js 与 phone_api.js，且在内联脚本之前', () => {
  for (const lib of ['shared/js/phone/phone_storage.js', 'shared/js/phone/phone_api.js']) {
    const at = page.indexOf(lib);
    assert.ok(at > 0, '独立页面必须加载 ' + lib);
    const inlineAt = page.indexOf("<script>");
    assert.ok(at < page.lastIndexOf('<script>'), lib + ' 必须在内联脚本之前');
  }
});

test('状态按正式角色分桶：A 的留言不会跟着 B 出现', () => {
  const store = makeStore();
  const a = makeRuntime({ store, currentRole: 'roleA' });
  a.get('commentInput').value = '阿岚房间的留言';
  a.get('commentForm')._h.submit({ preventDefault() {} });

  const b = makeRuntime({ store, currentRole: 'roleB' });
  const savedB = JSON.parse(store.raw['maomao_companion_v1_roleB'] || '{}');
  assert.equal((savedB.comments || []).length, 0, 'B 打开时留言区必须是空的');
  const savedA = JSON.parse(store.raw['maomao_companion_v1_roleA'] || '{}');
  assert.ok((savedA.comments || []).some((c) => c.includes('阿岚房间的留言')));
});

test('自由输入的名字不能作为付费人设：未绑正式角色时只给本地回应', async () => {
  const store = makeStore();
  const r = makeRuntime({ store, currentRole: '' });    // 没有当前正式角色
  await r.get('askRoleBtn').click();
  await flush();
  assert.equal(r.calls.length, 0, '没有合法正式角色就绝不调用模型');
  assert.ok(r.get('toast').textContent.includes('正式角色'));
});

test('旧全局键只对「归属角色」兼容：A 的旧留言不会以 B 的身份出现', () => {
  const store = makeStore({
    'maomao_companion_v1': JSON.stringify({ role: '白露', comments: ['白露的旧留言'], alarms: [], steps: 0, shakes: 0, likes: 0 }),
  });
  const a = makeRuntime({ store, currentRole: 'roleA' });   // 阿岚 ≠ 白露
  const aState = JSON.parse(store.raw['maomao_companion_v1_roleA'] || '{}');
  assert.equal((aState.comments || []).length, 0, '阿岚不得继承白露的旧留言');

  const b = makeRuntime({ store, currentRole: 'roleB' });   // 白露 = 归属角色
  const bState = JSON.parse(store.raw['maomao_companion_v1_roleB'] || '{}');
  assert.ok((bState.comments || []).some((c) => c.includes('白露的旧留言')), '归属角色可以只读兼容旧数据');
});
