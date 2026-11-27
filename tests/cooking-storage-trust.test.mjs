import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-KITCHEN-001 · 投喂厨房存档写入可信性契约
 * 从 games/js/cooking.js 截取真实实现，在隔离上下文模拟正常写入与配额失败：
 * 历史条目、口味档案、自定义配方都要求「写成功才落内存」，失败可重试且不虚假成功。
 * 源码级行为测试，不是浏览器 E2E。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const src = readFileSync(resolve(root, 'games/js/cooking.js'), 'utf8');

const historyBlock = (() => {
  const start = src.indexOf('function saveHistory(){');
  const end = src.indexOf('function loadHistory(){');
  assert.ok(start > 0 && end > start, 'history helpers not found');
  return src.slice(start, end);
})();

const tasteWriter = (() => {
  const start = src.indexOf('function writeTasteMemory(next)');
  assert.ok(start > 0, 'writeTasteMemory not found');
  const end = src.indexOf('\n', start);
  return src.slice(start, end);
})();

const customWriter = (() => {
  const start = src.indexOf('function saveCustomRecipes(){');
  assert.ok(start > 0, 'saveCustomRecipes not found');
  const end = src.indexOf('var hiddenRecipes=', start);
  return src.slice(start, end);
})();

function makeStore(seed = {}) {
  const data = { ...seed };
  let quota = false;
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      if (quota) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
      data[k] = String(v);
    },
    removeItem: (k) => { delete data[k]; },
    failWrites: (flag) => { quota = flag; },
    raw: data,
  };
}

function makeSandbox(store) {
  const sandbox = {
    localStorage: store,
    history: [],
    customRecipes: [{ id: 'r1' }],
    CUSTOM_RECIPES_KEY: 'maomao_custom_recipes_v1',
    HISTORY_KEY: 'maomao_cooking_history_v1',
    tasteStorageKey: () => 'maomao_cooking_taste_v1_roleA',
    showToast: () => {},
    renderHistoryCount: () => {},
    JSON,
    Object,
    String,
    Number,
  };
  vm.createContext(sandbox);
  vm.runInContext(historyBlock + '\n' + customWriter, sandbox);
  vm.runInContext(tasteWriter, sandbox);
  return sandbox;
}

test('历史写入成功：条目入栈并持久化', () => {
  const store = makeStore();
  const sb = makeSandbox(store);
  assert.equal(sb.pushHistory({ name: '番茄炒蛋' }), true);
  assert.equal(sb.history.length, 1);
  assert.equal(JSON.parse(store.raw.maomao_cooking_history_v1).length, 1);
});

test('历史写入失败：本次条目被撤销，界面条数不领先于存档', () => {
  const store = makeStore();
  const sb = makeSandbox(store);
  sb.pushHistory({ name: '第一道' });
  const before = sb.history.length;
  store.failWrites(true);

  assert.equal(sb.pushHistory({ name: '第二道' }), false);
  assert.equal(sb.history.length, before, 'failed dish must not stay in memory');
  assert.equal(JSON.parse(store.raw.maomao_cooking_history_v1).length, before);
  assert.notEqual(sb.history[0].name, '第二道');
});

test('历史刷新回读：成功写入后内容一致', () => {
  const store = makeStore();
  const sb = makeSandbox(store);
  sb.pushHistory({ name: '雨夜面' });
  const reloaded = JSON.parse(store.raw.maomao_cooking_history_v1);
  assert.equal(reloaded[0].name, '雨夜面');
});

test('口味档案写入失败返回 false 且不污染存档', () => {
  const store = makeStore({ 'maomao_cooking_taste_v1_roleA': JSON.stringify({ likes: 1, dislikes: 0, flavors: {}, ingredients: {}, lastFeedback: '' }) });
  const sb = makeSandbox(store);
  store.failWrites(true);

  assert.equal(sb.writeTasteMemory({ likes: 2, dislikes: 0, flavors: { 甜口系: 1 }, ingredients: {}, lastFeedback: '喜欢：x' }), false);
  assert.equal(JSON.parse(store.raw['maomao_cooking_taste_v1_roleA']).likes, 1, 'persisted taste memory must stay unchanged');
});

test('自定义配方写入成功才保留、失败即回滚', () => {
  const store = makeStore();
  const sb = makeSandbox(store);
  assert.equal(sb.saveCustomRecipes(), true);
  assert.equal(JSON.parse(store.raw.maomao_custom_recipes_v1).length, 1);

  store.failWrites(true);
  assert.equal(sb.saveCustomRecipes(), false);
});

test('口味反馈先写盘再改内存，失败分支提前返回', () => {
  const start = src.indexOf('function saveTasteFeedback(');
  const end = src.indexOf('\n', start);
  const body = src.slice(start, end);

  const writeAt = body.indexOf('writeTasteMemory(next)');
  const memoryAt = body.indexOf('tasteMemory=next');
  const flagAt = body.indexOf('currentDish.tasteFeedback=');
  assert.ok(writeAt > 0 && memoryAt > writeAt && flagAt > writeAt, 'taste memory must be written before in-memory state changes');
  assert.ok(body.includes("if(!writeTasteMemory(next)){showToast('口味档案暂时无法保存"), 'failure branch must return without marking the dish as rated');
});

test('自定义配方失败时不会提示“已添加到图鉴”', () => {
  const start = src.indexOf("$('addCustomRecipe').onclick");
  const end = src.indexOf('function updateCookByMode', start);
  const body = src.slice(start, end);
  assert.ok(body.includes('if(!saveCustomRecipes()){customRecipes.pop();return}'), 'failed recipe must be rolled back and must not report success');
});

test('带去聊天：pending 写失败时不携带陈旧数据', () => {
  const start = src.indexOf('function continueChat(');
  const end = src.indexOf("$('backButton')", start);
  const body = src.slice(start, end);
  assert.ok(body.includes('carried'), 'pending write result must be tracked');
  assert.ok(body.includes("&cooking='+(carried?'1':'0')"), 'chat entry must not claim cooking payload when the write failed');
  assert.equal(/catch\(e\)\{\}\s*$/m.test(body), false, 'pending write must not be silently swallowed');
});

/* P1（总控复审 #431）：历史满 60 条时写失败，原第 60 条必须保住。 */
test('历史满 60 条 + 写入失败：整份原数组还原，不丢原记录', () => {
  const store = makeStore();
  const sb = makeSandbox(store);
  for (let i = 0; i < 60; i++) sb.history.push({ name: '旧菜' + i });
  sb.saveHistory();

  store.failWrites(true);
  assert.equal(sb.pushHistory({ name: '新菜' }), false);

  assert.equal(sb.history.length, 60, 'must still hold all 60 original entries');
  assert.equal(sb.history[0].name, '旧菜0', 'order and content must be restored');
  assert.equal(sb.history[59].name, '旧菜59', 'the 60th entry must not be silently evicted');
  assert.equal(JSON.parse(store.raw.maomao_cooking_history_v1).length, 60, 'persisted store must stay untouched');
  assert.equal(sb.history.some((d) => d.name === '新菜'), false);
});

test('满额失败之后的下一次成功写入不携带失败菜品，且只挤掉最旧一条', () => {
  const store = makeStore();
  const sb = makeSandbox(store);
  for (let i = 0; i < 60; i++) sb.history.push({ name: '旧菜' + i });
  sb.saveHistory();

  store.failWrites(true);
  sb.pushHistory({ name: '失败菜' });
  store.failWrites(false);

  assert.equal(sb.pushHistory({ name: '成功菜' }), true);
  assert.equal(sb.history.length, 60);
  assert.equal(sb.history[0].name, '成功菜');
  assert.equal(sb.history.some((d) => d.name === '失败菜'), false, 'failed dish must not leak into the next save');
  assert.equal(sb.history[59].name, '旧菜58', 'only the oldest entry may be evicted on a successful save');
  assert.equal(JSON.parse(store.raw.maomao_cooking_history_v1).length, 60);
});
