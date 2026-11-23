import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-CAFE-004 · 咖啡馆存档写入可信性 + 失败回滚契约
 * 截取真实的 clone / save / cafeStateSnapshot / cafeStateRestore 在隔离上下文执行，
 * 覆盖：正常写入、配额失败、整份回滚、引用不被替换、失败操作不混入下一次写入、刷新回读。
 * 业务函数（runDay 等）用源码顺序断言校验事务边界，不做浏览器 E2E。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const cafe = readFileSync(resolve(root, 'cafe/cafe.html'), 'utf8');

const stateSource = (() => {
  const cloneAt = cafe.indexOf('function clone(o){');
  const initAt = cafe.indexOf('var st=loadState();');
  const saveAt = cafe.indexOf('var CAFE_SAVE_FAIL_MSG=');
  const endAt = cafe.indexOf('/* 手风琴：展开状态跨重渲染保持 */', saveAt);
  assert.ok(cloneAt > 0 && initAt > cloneAt && saveAt > initAt && endAt > saveAt, 'state helper block not found');
  /* 只取 clone 定义 + save/快照/回滚实现，避开 var st=loadState() 的初始化调用 */
  const block = cafe.slice(cloneAt, initAt) + cafe.slice(saveAt, endAt);
  assert.ok(block.includes('cafeStateRestore'), 'rollback helpers missing');
  return block;
})();

function makeStore(initial) {
  const data = initial === undefined ? {} : { maomao_cafe_state_v1: initial };
  let quota = false;
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      if (quota) {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      }
      data[key] = String(value);
    },
    failWrites: (flag) => { quota = flag; },
    raw: data,
    read: () => (data.maomao_cafe_state_v1 === undefined ? undefined : JSON.parse(data.maomao_cafe_state_v1)),
  };
}

function makeSandbox(store, state) {
  const sandbox = { localStorage: store, st: state, JSON, String, Object };
  vm.createContext(sandbox);
  vm.runInContext(stateSource, sandbox);
  return sandbox;
}

function baseState() {
  return {
    day: 5,
    cash: 500,
    menu: ['latte'],
    stock: { beans: 20, milk: 10 },
    history: [{ day: 4, profit: 90 }],
    partnerProfiles: { r1: { rapport: 10, history: [] } },
    growthClaims: {},
    lifeStats: { days: 4, totalProfit: 200 },
  };
}

test('正常写入：返回 true 且存档与内存一致', () => {
  const store = makeStore();
  const state = baseState();
  const sandbox = makeSandbox(store, state);

  assert.equal(sandbox.save(), true);
  assert.deepEqual(store.read(), state);
});

test('配额失败：返回 false、不抛异常、旧存档字节不变', () => {
  const previous = JSON.stringify({ day: 4, cash: 480 });
  const store = makeStore(previous);
  const sandbox = makeSandbox(store, baseState());
  store.failWrites(true);

  assert.equal(sandbox.save(), false);
  assert.equal(store.raw.maomao_cafe_state_v1, previous);
});

test('回滚恢复整份状态，包括嵌套对象与数组', () => {
  const state = baseState();
  const sandbox = makeSandbox(makeStore(), state);
  const before = sandbox.cafeStateSnapshot();

  state.day = 6;
  state.cash = 100;
  state.stock.beans = 0;
  state.history.unshift({ day: 5, profit: -40 });
  state.partnerProfiles.r1.rapport = 99;
  state.growthClaims.days3 = { day: 6 };
  state.lifeStats.totalProfit = 120;

  sandbox.cafeStateRestore(before);

  assert.deepEqual(state, baseState(), 'rollback must restore the whole snapshot');
  assert.equal(state.day, 5);
  assert.equal(state.cash, 500);
  assert.deepEqual(state.stock, { beans: 20, milk: 10 });
  assert.equal(state.history.length, 1);
  assert.equal(state.partnerProfiles.r1.rapport, 10);
  assert.deepEqual(state.growthClaims, {});
  assert.equal(state.lifeStats.totalProfit, 200);
});

test('回滚原地进行：st 引用不变，旧嵌套引用不会复活', () => {
  const state = baseState();
  const sandbox = makeSandbox(makeStore(), state);
  const before = sandbox.cafeStateSnapshot();
  const held = state;
  const staleStock = state.stock;

  state.cash = 1;
  state.stock = { beans: 0, milk: 0 };
  sandbox.cafeStateRestore(before);

  assert.equal(held, state, 'state object identity must be preserved for closures that kept a reference');
  assert.notEqual(state.stock, staleStock, 'restored nested objects must not be the mutated instance');
  assert.deepEqual(state.stock, { beans: 20, milk: 10 });
});

test('失败的操作不会被下一次成功写入带进存档', () => {
  const store = makeStore();
  const state = baseState();
  const sandbox = makeSandbox(store, state);
  sandbox.save();

  /* 第一次动作：结算（含 day++），写入失败 → 回滚 */
  const before = sandbox.cafeStateSnapshot();
  state.day += 1;
  state.cash += 300;
  store.failWrites(true);
  assert.equal(sandbox.save(), false);
  sandbox.cafeStateRestore(before);

  /* 第二次动作：补货，写入成功 */
  store.failWrites(false);
  state.cash -= 20;
  state.stock.beans += 10;
  assert.equal(sandbox.save(), true);

  const persisted = store.read();
  assert.equal(persisted.day, 5, 'the failed settlement must not advance the day in storage');
  assert.equal(persisted.cash, 480, 'only the successful purchase should be persisted');
  assert.equal(persisted.stock.beans, 30);
});

test('刷新回读：成功写入后可在新上下文还原', () => {
  const store = makeStore();
  const state = baseState();
  makeSandbox(store, state).save();

  const reloaded = store.read();
  assert.equal(reloaded.day, 5);
  assert.deepEqual(reloaded.menu, ['latte']);
});

test('失败提示文案不含成功语义', () => {
  const message = cafe.match(/CAFE_SAVE_FAIL_MSG='([^']*)'/)[1];
  assert.ok(message.includes('写入失败'));
  for (const word of ['已选择', '已领取', '已记录', '结算完成']) {
    assert.equal(message.includes(word), false, 'failure message must not read like success: ' + word);
  }
});

const TX_FUNCTIONS = ['chooseEvent', 'runDay', 'chooseStory', 'chooseGalleryStory', 'choosePartnerEpisode'];

function functionBody(name) {
  const start = name === 'chooseEvent' ? cafe.lastIndexOf('function ' + name + '(') : cafe.indexOf('function ' + name + '(');
  assert.ok(start > 0, 'missing function: ' + name);
  return cafe.slice(start, cafe.indexOf('\nfunction ', start + 10));
}

test('五条路径都先快照、失败即回滚、且不再无条件提示成功', () => {
  for (const name of TX_FUNCTIONS) {
    const body = functionBody(name);
    assert.ok(body.includes('cafeStateSnapshot()'), name + ' does not snapshot the state before mutating');
    assert.ok(body.includes('if(!savedOk){cafeStateRestore(before)'), name + ' does not roll back when the write fails');
    assert.equal(/savedOk\?/.test(body), false, name + ' still renders success text through a bare ternary');
  }
});

test('结算失败时不弹成功结算弹窗、不提前推进日数提示', () => {
  const body = functionBody('runDay');
  const snapshotAt = body.indexOf('cafeStateSnapshot()');
  const firstMoneyMutation = body.indexOf('st.cash-=ad');
  const rollbackAt = body.indexOf('if(!savedOk){cafeStateRestore(before)');
  const reportAt = body.indexOf('showDailyReport(report)');

  assert.ok(snapshotAt >= 0 && firstMoneyMutation > snapshotAt, 'snapshot must happen before the day is simulated');
  assert.ok(rollbackAt > 0);
  assert.ok(reportAt > rollbackAt, 'the daily report modal must not open before the failure branch');
});

test('成长奖励失败后可重新领取（回滚会撤销领取标记）', () => {
  const state = baseState();
  state.lifeStats = { days: 10, totalServed: 60, bestProfitStreak: 3, bestDailyProfit: 320 };
  const store = makeStore();
  const sandbox = makeSandbox(store, state);
  const before = sandbox.cafeStateSnapshot();

  state.growthClaims.days3 = { day: state.day };
  state.cash += 80;
  store.failWrites(true);
  assert.equal(sandbox.save(), false);
  sandbox.cafeStateRestore(before);

  assert.deepEqual(state.growthClaims, {}, 'the claim marker must be rolled back so the reward can be claimed again');
  assert.equal(state.cash, 500);
});

test('存档不再使用静默空 catch，存储键与载荷未变', () => {
  assert.equal(/setItem\('maomao_cafe_state_v1',JSON\.stringify\(st\)\);\}catch\(e\)\{\}/.test(cafe), false);
  assert.ok(stateSource.includes("key='maomao_cafe_state_v1'") && stateSource.includes("payload=JSON.stringify(st)") && stateSource.includes("localStorage.getItem(key)===payload"));
});
