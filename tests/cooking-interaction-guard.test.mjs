import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-KITCHEN-001 · 投喂厨房试吃交互契约
 * 覆盖：连点「端给 TA」不重复入账；角色切换/重做/改菜后旧 AI 请求不得回写，
 * 且不得为已失效的试吃花掉一次收费 API 调用。
 * 除源码守卫外，beginTasting / requestReaction 用 VM 跑真实实现。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const src = readFileSync(resolve(root, 'games/js/cooking.js'), 'utf8');

const guardSource = (() => {
  const start = src.indexOf('function reactionIsCurrent(');
  assert.ok(start > 0, 'reactionIsCurrent not found');
  return src.slice(start, src.indexOf('\n', start));
})();

const tasteSource = (() => {
  const start = src.indexOf('/* 试吃请求的归属判定：');
  const end = src.indexOf('function saveHistory(){', start);
  assert.ok(start > 0 && end > start, 'tasting block not found');
  return src.slice(start, end);
})();

function makeSandbox(token, dish) {
  const sandbox = { reactionToken: token, currentDish: dish };
  vm.createContext(sandbox);
  vm.runInContext(guardSource, sandbox);
  return sandbox;
}

function makeEl() {
  return {
    textContent: '',
    value: '',
    hidden: false,
    innerHTML: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    querySelector: () => makeEl(),
  };
}

function makeDish() {
  return {
    name: '番茄炒蛋',
    createdAt: 1700000000000,
    profile: {
      dishName: '番茄炒蛋',
      flavor: '暖香系',
      description: '家常',
      ingredients: [{ name: '番茄', quantity: 2 }, { name: '鸡蛋', quantity: 2 }],
    },
  };
}

/* 真跑 beginTasting / requestReaction：setTimeout 由测试决定何时触发，
 * PhoneAPI.complete 只计数不联网。 */
function makeRuntime(dish) {
  const els = {};
  const timers = [];
  const apiCalls = [];
  const sandbox = {
    tastingLock: false,
    reactionToken: 0,
    currentDish: dish,
    cookBy: 'me',
    activeRole: { id: 'roleA', name: '阿岚' },
    history: [],
    tasteMemory: {},
    $: (id) => (els[id] = els[id] || makeEl()),
    setStage: () => {},
    roleName: (role) => (role && role.name) || 'TA',
    localReaction: () => ({ quote: '本地反应', title: 'TA 尝了一口', copy: '味道如何' }),
    saveHistory: () => true,
    // #431 uses the persisted-history helper; keep this interaction harness aligned.
    pushHistory: (item) => { sandbox.history.unshift(Object.assign({}, item)); return true; },
    renderHistoryCount: () => {},
    showToast: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    JSON,
    Object,
    String,
    Number,
    Array,
    Date,
    Math,
  };
  sandbox.window = sandbox;
  sandbox.PhoneStorage = { getApiConfig: () => ({ apiKey: 'test-key' }) };
  sandbox.PhoneAPI = {
    complete: (payload) => {
      apiCalls.push(payload);
      return Promise.resolve('“还不错。”');
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(tasteSource, sandbox);
  return { sb: sandbox, els, timers, apiCalls };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

test('当前请求：token 与菜品都匹配才算有效', () => {
  const dish = { id: 'dish_1' };
  const sb = makeSandbox(3, dish);
  assert.equal(sb.reactionIsCurrent(3, dish), true);
});

test('过期 token（重做/改菜后）不生效', () => {
  const dish = { id: 'dish_1' };
  const sb = makeSandbox(4, dish);
  assert.equal(sb.reactionIsCurrent(3, dish), false);
});

test('换了菜品后不生效', () => {
  const sb = makeSandbox(3, { id: 'dish_2' });
  assert.equal(sb.reactionIsCurrent(3, { id: 'dish_1' }), false);
});

test('端给 TA 具备连点锁，且记录本次 token', () => {
  const start = src.indexOf('function beginTasting(');
  const end = src.indexOf('function requestReaction(', start);
  const body = src.slice(start, end);
  assert.ok(body.includes('if(!currentDish||tastingLock)return;'), 'missing double-tap lock');
  assert.ok(body.includes('tastingLock=true'), 'lock must be set on entry');
  assert.ok(body.includes('++reactionToken'), 'each tasting round must own a token');
  assert.ok(body.includes('requestReaction(token,dish)'), 'deferred request must carry token and dish');
});

test('切换角色让进行中的请求失效', () => {
  const at = src.indexOf('b.onclick=function(){reactionToken++');
  assert.ok(at > 0, 'role switch must invalidate in-flight reaction');
});

test('重做与改菜都会让进行中的请求失效', () => {
  const again = src.indexOf("$('cookAgain').onclick");
  assert.ok(src.slice(again, src.indexOf('\n', again)).includes('reactionToken++'), 'cookAgain must invalidate in-flight reaction');
  const edit = src.indexOf("$('editDish').onclick");
  assert.ok(src.slice(edit, src.indexOf('\n', edit)).includes('reactionToken++'), 'editDish must invalidate in-flight reaction');
});

/* ===== 行为测试：900ms 延迟窗口内失效，不花付费调用、不写旧 UI ===== */

test('900ms 窗口内切换角色：0 次付费请求，且不覆盖试吃 UI', async () => {
  const dish = makeDish();
  const { sb, els, timers, apiCalls } = makeRuntime(dish);

  sb.beginTasting();
  const delayed = timers.find((t) => t.ms === 900);
  assert.ok(delayed, '900ms reaction timer must be scheduled');

  sb.reactionToken++;                 // 切角色 / 重做 / 改菜都会让 token 前进
  els.reactionKicker.textContent = 'UNTOUCHED';
  delayed.fn();
  await flush();

  assert.equal(apiCalls.length, 0, 'stale tasting must not spend a paid API call');
  assert.equal(els.reactionKicker.textContent, 'UNTOUCHED', 'stale timer must not overwrite the tasting UI');
});

test('900ms 窗口内重做（菜品被清空）：0 次付费请求', async () => {
  const dish = makeDish();
  const { sb, timers, apiCalls } = makeRuntime(dish);

  sb.beginTasting();
  const delayed = timers.find((t) => t.ms === 900);

  sb.reactionToken++;
  sb.currentDish = null;
  delayed.fn();
  await flush();

  assert.equal(apiCalls.length, 0);
});

test('未失效时正常发一次付费请求并写回结果', async () => {
  const dish = makeDish();
  const { sb, els, timers, apiCalls } = makeRuntime(dish);

  sb.beginTasting();
  timers.find((t) => t.ms === 900).fn();
  await flush();

  assert.equal(apiCalls.length, 1, 'a valid tasting must call the API exactly once');
  assert.equal(els.reactionKicker.textContent, 'THE VERDICT');
  assert.equal(dish.reaction, '还不错。');
  assert.equal(dish.reactionSource, 'ai');
});

test('直接以过期 token 调 requestReaction：一次请求都不发', async () => {
  const dish = makeDish();
  const { sb, apiCalls } = makeRuntime(dish);

  sb.requestReaction(-1, dish);
  await flush();

  assert.equal(apiCalls.length, 0);
});

test('请求已发出后切角色：旧响应不回写', async () => {
  const dish = makeDish();
  const { sb, els, apiCalls } = makeRuntime(dish);

  sb.requestReaction(sb.reactionToken, dish);
  assert.equal(apiCalls.length, 1, 'request was sent before invalidation');

  sb.reactionToken++;
  await flush();

  assert.equal(dish.reaction, undefined, 'stale response must not be written back');
  const kicker = els.reactionKicker;
  assert.notEqual(kicker && kicker.textContent, 'THE VERDICT', 'stale response must not rewrite the verdict UI');
});

test('源码守卫：延迟回调与付费请求前都有归属校验', () => {
  const delayAt = src.indexOf('setTimeout(function(){\n  /* 延迟窗口内可能已切换角色');
  assert.ok(delayAt > 0, 'delayed callback must open with the ownership guard');
  const guardAt = src.indexOf('if(!reactionIsCurrent(token,dish))return;', delayAt);
  assert.ok(guardAt > delayAt, 'delayed callback must check before touching the UI');

  const payAt = src.indexOf('if(!reactionIsCurrent(token,dish))return;\n window.PhoneAPI.complete(');
  assert.ok(payAt > 0, 'the paid call must be preceded by a fresh ownership check');
});
