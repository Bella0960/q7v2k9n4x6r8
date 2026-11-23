import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-CAFE-004b · 采购场景（手动补货 + 智能补货）写入可信性
 * 与 CAFE-004 同一套快照/回滚实现：写入失败时扣款与库存必须一起回到改动前，
 * 不允许“扣了钱但没入库”或“入了库没扣钱”的半成品状态。
 * 源码级行为测试，不是浏览器 E2E。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const cafe = readFileSync(resolve(root, 'cafe/cafe.html'), 'utf8');

const stateSource = (() => {
  const cloneAt = cafe.indexOf('function clone(o){');
  const initAt = cafe.indexOf('var st=loadState();');
  const saveAt = cafe.indexOf('var CAFE_SAVE_FAIL_MSG=');
  const endAt = cafe.indexOf('/* 手风琴：展开状态跨重渲染保持 */', saveAt);
  assert.ok(cloneAt > 0 && initAt > cloneAt && saveAt > initAt && endAt > saveAt, 'state helper block not found');
  return cafe.slice(cloneAt, initAt) + cafe.slice(saveAt, endAt);
})();

function makeStore() {
  const data = {};
  let quota = false;
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      if (quota) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
      data[key] = String(value);
    },
    failWrites: (flag) => { quota = flag; },
    read: () => (data.maomao_cafe_state_v1 === undefined ? undefined : JSON.parse(data.maomao_cafe_state_v1)),
  };
}

function makeSandbox(store, state) {
  const sandbox = { localStorage: store, st: state, JSON, String, Object };
  vm.createContext(sandbox);
  vm.runInContext(stateSource, sandbox);
  return sandbox;
}

const baseState = () => ({ day: 3, cash: 200, stock: { beans: 10, milk: 8, cups: 4 } });

test('手动补货失败：扣款与库存一起回滚', () => {
  const store = makeStore();
  const state = baseState();
  const sandbox = makeSandbox(store, state);

  const before = sandbox.cafeStateSnapshot();
  state.cash -= 40;
  state.stock.beans += 10;
  store.failWrites(true);
  assert.equal(sandbox.save(), false);
  sandbox.cafeStateRestore(before);

  assert.equal(state.cash, 200, 'money must not disappear when the purchase cannot be saved');
  assert.equal(state.stock.beans, 10, 'stock must not grow when the purchase cannot be saved');
});

test('智能补货含多种原料时整批回滚', () => {
  const store = makeStore();
  const state = baseState();
  const sandbox = makeSandbox(store, state);

  const before = sandbox.cafeStateSnapshot();
  state.cash -= 120;
  state.stock.beans += 20;
  state.stock.milk += 30;
  state.stock.cups += 40;
  store.failWrites(true);
  assert.equal(sandbox.save(), false);
  sandbox.cafeStateRestore(before);

  assert.equal(state.cash, 200);
  assert.deepEqual(state.stock, { beans: 10, milk: 8, cups: 4 });
});

test('失败的采购不会被下一次成功写入带进存档', () => {
  const store = makeStore();
  const state = baseState();
  const sandbox = makeSandbox(store, state);
  sandbox.save();

  const before = sandbox.cafeStateSnapshot();
  state.cash -= 40;
  state.stock.beans += 10;
  store.failWrites(true);
  sandbox.save();
  sandbox.cafeStateRestore(before);

  store.failWrites(false);
  state.cash -= 6;
  state.stock.milk += 2;
  assert.equal(sandbox.save(), true);

  const persisted = store.read();
  assert.equal(persisted.cash, 194);
  assert.deepEqual(persisted.stock, { beans: 10, milk: 10, cups: 4 }, 'the failed bean purchase must not appear after a later successful write');
});

const handlers = (() => {
  const buyAt = cafe.indexOf("document.querySelectorAll('[data-buy]')");
  const autoAt = cafe.indexOf('[data-auto-buy]');
  assert.ok(buyAt > 0 && autoAt > buyAt, 'stock purchase handlers not found');
  const endAt = cafe.indexOf('\nfunction ', autoAt);
  return {
    buy: cafe.slice(buyAt, autoAt),
    auto: cafe.slice(autoAt, endAt > autoAt ? endAt : undefined),
  };
})();

test('两个采购入口都先快照、失败即回滚并 return', () => {
  for (const [name, body] of Object.entries(handlers)) {
    assert.ok(body.includes('cafeStateSnapshot()'), name + ' purchase does not snapshot the state');
    assert.ok(body.includes('if(!savedOk){cafeStateRestore(before)'), name + ' purchase does not roll back on write failure');
    assert.ok(body.includes('CAFE_SAVE_FAIL_MSG'), name + ' purchase does not surface the failure');
    assert.equal(/save\(\);renderStock\(\);toast\('(已补货|智能补货完成)/.test(body), false, name + ' purchase still reports success unconditionally');
  }
});

test('采购仍在改动现金之前检查余额', () => {
  assert.ok(handlers.buy.indexOf('st.cash<total') < handlers.buy.indexOf('st.cash-=total'), 'balance check must precede the deduction');
  assert.ok(handlers.auto.indexOf('st.cash<totalCost') < handlers.auto.indexOf('st.cash-=totalCost'));
});
