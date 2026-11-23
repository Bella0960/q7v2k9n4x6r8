import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* LIVE-AI-AUDIENCE-001 · 直播间 AI 观众（默认关闭 · 付费护栏）
 * 从 companion/live.html 截取真实实现，在隔离上下文跑：
 * 不开启零调用、开启后批量输出、达上限不发请求、失败不重试、切后台/关闭后旧结果丢弃、
 * 无 key 自动降级本地模拟。全部 mock，不产生真实付费请求。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(resolve(root, 'companion/live.html'), 'utf8');

const block = (() => {
  const start = page.indexOf('/* ========== AI 观众（默认关闭');
  const end = page.indexOf('/* ========== 背景自定义 ========== */');
  assert.ok(start > 0 && end > start, 'AI audience block not found');
  return page.slice(start, end);
})();

const BATCH = [
  { name: '奶盖不加糖', text: '刚下班就冲进来了，今天也在等你开播' },
  { name: '月亮邮递员', text: '这个灯光好像旧电影的片头' },
  { name: '气泡水', text: '主播今天声音有点飘，是不是没睡好' },
  { name: '早睡冠军', text: '我又熬夜失败了…' },
  { name: '一颗西柚', text: '刚泡好咖啡，陪你坐一会儿' },
];

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

function makeRuntime({ store, apiKey = 'test-key', behavior = 'resolve', raw = null } = {}) {
  const els = {};
  const listeners = {};
  const toasts = [];
  const bubbles = [];
  const calls = [];
  const timers = [];
  const makeEl = (id) => ({
    id,
    textContent: '',
    _on: false,
    classList: { toggle() {}, add() { this._on = true; }, remove() { this._on = false; } },
    addEventListener: (ev, fn) => { (listeners[id] = listeners[id] || {})[ev] = fn; },
  });
  const sandbox = {
    localStorage: store,
    me: { name: '阿岚' },
    AI_AUDIENCE_KEY: 'maomao_live_ai_audience_v1',
    $: (id) => (els[id] = els[id] || makeEl(id)),
    stream: { querySelectorAll: () => [] },
    pushBubble: (b) => bubbles.push(b),
    toast: (t) => toasts.push(t),
    liveApiConfig: () => ({ apiKey }),
    document: {
      hidden: false,
      addEventListener: (ev, fn) => { listeners['doc:' + ev] = fn; },
    },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    addEventListener: (ev, fn) => { listeners['win:' + ev] = fn; },
    JSON, Object, String, Number, Array, Math, Date, Promise, Error, console,
  };
  sandbox.window = sandbox;
  sandbox.PhoneAPI = {
    complete: () => {
      calls.push(Date.now());
      if (behavior === 'reject') return Promise.reject(new Error('HTTP 500'));
      return Promise.resolve(raw == null ? JSON.stringify(BATCH) : raw);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox);
  return { sb: sandbox, els, listeners, toasts, bubbles, calls, timers };
}

const flush = () => new Promise((r) => setTimeout(r, 10));

/* 把 release 的排期跑完：只跑短定时器，长排期（≥15s / 3 分钟）不触发 */
function drainShortTimers(timers) {
  let guard = 0;
  while (timers.length && guard++ < 40) {
    const t = timers.shift();
    if (t.ms < 15000) t.fn();
  }
}

test('默认关闭：不开启就 0 次付费调用', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  assert.equal(sb.aiAudience.enabled, false);
  sb.aiAudienceTick();
  await flush();
  assert.equal(calls.length, 0);
});

test('开启后一次请求批量生成，本地按时间播出多条', async () => {
  const store = makeStore();
  const { sb, calls, bubbles, timers } = makeRuntime({ store });

  sb.setAiAudience(true);
  sb.aiAudienceTick();
  await flush();
  assert.equal(calls.length, 1, 'one batch = one paid request');
  assert.equal(sb.aiAudience.busy, false);

  drainShortTimers(timers);
  const viewers = bubbles.filter((b) => b.type === 'viewer ai-viewer');
  assert.equal(viewers.length, BATCH.length, 'all generated lines should be released');
  assert.ok(viewers.every((b) => b.text.length <= 40));
  assert.ok(bubbles.some((b) => b.type === 'system' && b.text.includes('虚拟角色')), 'must state that AI viewers are virtual');
});

test('开启时的系统提示说明是虚拟角色，不是真人', async () => {
  const store = makeStore();
  const { sb, bubbles } = makeRuntime({ store });
  sb.setAiAudience(true);
  const sys = bubbles.find((b) => b.type === 'system');
  assert.ok(sys && sys.text.includes('虚拟角色') && sys.text.includes('不是真人'));
});

test('每场 6 批上限：用完后 0 请求', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  sb.setAiAudience(true);
  sb.aiAudience.sessionUsed = sb.AI_AUDIENCE_SESSION_LIMIT;

  sb.aiAudienceTick();
  sb.requestAiAudienceBatch();
  await flush();
  assert.equal(calls.length, 0, 'session cap must block further paid calls');
});

test('每日 12 批上限：用完后 0 请求', async () => {
  const store = makeStore({
    maomao_live_ai_audience_v1: JSON.stringify({ day: new Date().toISOString().slice(0, 10), used: 12, enabled: true }),
  });
  const { sb, calls } = makeRuntime({ store });
  sb.setAiAudience(true);
  sb.aiAudienceTick();
  await flush();
  assert.equal(calls.length, 0, 'daily cap must block further paid calls');
});

test('间隔不足 3 分钟不发请求', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  sb.setAiAudience(true);
  sb.aiAudience.lastAt = Date.now() - 10000;   // 只过了 10 秒
  sb.aiAudienceTick();
  await flush();
  assert.equal(calls.length, 0);
});

test('失败只降级不重试：仍然只 1 次请求，并进入降级状态', async () => {
  const store = makeStore();
  const { sb, calls, timers } = makeRuntime({ store, behavior: 'reject' });

  sb.setAiAudience(true);
  sb.aiAudienceTick();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(sb.aiAudience.busy, false);
  assert.equal(sb.aiAudience.degraded, true, 'must fall back to local simulation');

  sb.aiAudienceTick();                       // 立刻再 tick 也不该重发
  await flush();
  assert.equal(calls.length, 1, 'no silent retry');
  assert.ok(timers.length > 0, 'must wait for the next interval instead of retrying immediately');
});

test('无可用 key：0 次调用并降级为本地模拟', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store, apiKey: '' });

  sb.setAiAudience(true);
  sb.aiAudienceTick();
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(sb.aiAudience.degraded, true);
});

test('关闭模式后：返回的旧批次全部丢弃', async () => {
  const store = makeStore();
  const { sb, bubbles } = makeRuntime({ store });

  sb.setAiAudience(true);
  const before = bubbles.length;
  const promise = sb.requestAiAudienceBatch();   // 请求已发出
  sb.setAiAudience(false);                       // 立刻关闭
  await promise;
  await flush();

  const viewers = bubbles.slice(before).filter((b) => b.type === 'viewer ai-viewer');
  assert.equal(viewers.length, 0, 'stale batch must not be released into the room');
});

test('切后台：进行中的结果丢弃，不回写新弹幕', async () => {
  const store = makeStore();
  const { sb, bubbles, listeners } = makeRuntime({ store });

  sb.setAiAudience(true);
  const before = bubbles.length;
  const promise = sb.requestAiAudienceBatch();
  sb.document.hidden = true;
  listeners['doc:visibilitychange']();
  await promise;
  await flush();

  const viewers = bubbles.slice(before).filter((b) => b.type === 'viewer ai-viewer');
  assert.equal(viewers.length, 0);
});

test('开启期间切后台也不发新请求', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  sb.setAiAudience(true);
  sb.document.hidden = true;
  sb.aiAudienceTick();
  await flush();
  assert.equal(calls.length, 0);
});

test('批次解析严格：超长截断、未知名字归一到固定人设、最多 6 条', () => {
  const store = makeStore();
  const { sb } = makeRuntime({ store });

  const lines = sb.parseAiAudienceBatch(JSON.stringify([
    { name: '奶盖不加糖', text: 'x'.repeat(120) },
    { name: '不存在的路人', text: '主播好' },
    { name: '', text: '' },
    { name: '气泡水', text: '第4条' },
    { name: '气泡水', text: '第5条' },
    { name: '气泡水', text: '第6条' },
    { name: '气泡水', text: '第7条' },
    { name: '气泡水', text: '第8条' },
  ]));
  assert.ok(lines.length <= 6);
  assert.equal(lines[0].text.length, 40, 'over-long lines must be trimmed');
  assert.ok(sb.AI_AUDIENCE_ROSTER.some((r) => r.name === lines[1].name), 'unknown names fall back to the stable roster');
  assert.equal(lines.some((l) => l.text === ''), false, 'empty lines dropped');
});

test('批次解析拒绝非 JSON 与空数组', () => {
  const store = makeStore();
  const { sb } = makeRuntime({ store });
  assert.throws(() => sb.parseAiAudienceBatch('对不起我做不到'));
  assert.throws(() => sb.parseAiAudienceBatch('[]'));
});

test('预算先记账：失败也占用一次当日额度', async () => {
  const store = makeStore();
  const { sb } = makeRuntime({ store, behavior: 'reject' });
  sb.setAiAudience(true);
  sb.aiAudienceTick();
  await flush();
  const saved = JSON.parse(store.raw.maomao_live_ai_audience_v1);
  assert.equal(saved.used, 1, 'failed attempt still consumes the daily budget');
});

test('虚拟礼物不触碰钱包/余额/交易', () => {
  const giftAt = page.indexOf("const GIFTS=[");
  const giftEnd = page.indexOf('/* ========== 点赞 ========== */', giftAt);
  const giftBlock = page.slice(giftAt, giftEnd);
  assert.ok(giftBlock.length > 0);
  assert.equal(/wallet|balance|余额|支付|pay\(|transaction/i.test(giftBlock), false, 'gifts must stay purely visual');
  assert.equal(/money|coin|price/i.test(giftBlock), false);
});

test('源码守卫：默认关闭、护栏常量与关闭即作废', () => {
  assert.ok(page.includes('var AI_AUDIENCE_SESSION_LIMIT=6;'));
  assert.ok(page.includes('var AI_AUDIENCE_DAILY_LIMIT=12;'));
  assert.ok(page.includes('var AI_AUDIENCE_MIN_INTERVAL=3*60*1000;'));
  assert.ok(page.includes('enabled:false'), 'AI audience must default to off');
  assert.ok(page.includes('bumpAiAudienceToken();'), 'turning it off / hiding the page must invalidate in-flight results');
  assert.ok(page.includes('if(document.hidden)return;'), 'must not call while backgrounded');
});

/* ---------- 总控 P1：预算落盘失败必须 fail-closed ---------- */

test('P1 存储拒写：只允许第一批，之后 0 次付费调用', async () => {
  const store = makeStore();
  const { sb, calls, toasts } = makeRuntime({ store });
  sb.setAiAudience(true);          /* 此时存储正常，先成功开启 */
  store.failWrites(true);          /* 过程中配额写满 */

  sb.aiAudienceTick();
  await flush();
  assert.equal(calls.length, 1, '第一批照常（已记账）');
  assert.equal(sb.aiAudienceDaily.persistBroken, true, '必须标记预算写入失败');

  for (let i = 0; i < 8; i++) {
    sb.aiAudience.lastAt = 0;
    sb.aiAudienceTick();
    sb.requestAiAudienceBatch();
    await flush();
  }
  assert.equal(calls.length, 1, '预算写不进本机时必须停止新的付费调用');
  assert.ok(toasts.some((t) => t.includes('暂停付费调用')), 'must tell the user why it stopped');
});

test('P1 续：拒写状态下关闭再打开，仍然 0 次新调用', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  sb.setAiAudience(true);
  store.failWrites(true);
  sb.aiAudienceTick();
  await flush();
  assert.equal(calls.length, 1);

  sb.setAiAudience(false);
  sb.setAiAudience(true);
  sb.aiAudience.lastAt = 0;
  sb.aiAudienceTick();
  sb.requestAiAudienceBatch();
  await flush();

  assert.equal(calls.length, 1, '重开开关不得放开 fail-closed');
  assert.equal(sb.aiAudienceDaily.persistBroken, true);
});

test('P1 续：开关不重置本场已用批次与 3 分钟间隔', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  sb.setAiAudience(true);
  sb.aiAudienceTick();
  await flush();
  assert.equal(calls.length, 1);

  const usedBefore = sb.aiAudience.sessionUsed;
  const lastBefore = sb.aiAudience.lastAt;
  sb.setAiAudience(false);
  sb.setAiAudience(true);

  assert.equal(sb.aiAudience.sessionUsed, usedBefore, 'sessionUsed 不能被开关清零');
  assert.equal(sb.aiAudience.lastAt, lastBefore, 'lastAt 不能被开关清零');

  sb.aiAudienceTick();
  await flush();
  assert.equal(calls.length, 1, '间隔未到不得因为重开开关而立刻再请求');
});

test('P1 续：本场上限用满后，即使重开开关也是 0 请求', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  sb.setAiAudience(true);
  sb.aiAudience.sessionUsed = sb.AI_AUDIENCE_SESSION_LIMIT;

  sb.setAiAudience(false);
  sb.setAiAudience(true);
  sb.aiAudience.lastAt = 0;
  sb.aiAudienceTick();
  sb.requestAiAudienceBatch();
  await flush();

  assert.equal(calls.length, 0);
});

test('P1 源码守卫：setAiAudience 不再清 sessionUsed / lastAt，且预算写失败即停', () => {
  const start = page.indexOf('function setAiAudience(on){');
  const end = page.indexOf('function openAudienceSheet()', start);
  const body = page.slice(start, end);
  assert.equal(/aiAudience\.sessionUsed\s*=\s*0/.test(body), false, '不得在开关里清零本场批次');
  assert.equal(/aiAudience\.lastAt\s*=\s*0/.test(body), false, '不得在开关里清零间隔');
  assert.ok(page.includes('aiAudienceDaily.persistBroken'), '必须有落盘失败标记');
  assert.ok(page.includes('max(aiAudienceStoredUsed(),aiAudienceDaily.used)'), '日额度取落盘与会话计数的较大值');
});
