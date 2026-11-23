import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-CAFE-004 · 咖啡馆存档写入可信性契约
 * 从 cafe/cafe.html 截取真实 save() 实现，在隔离上下文里模拟正常写入、QuotaExceededError、
 * 刷新回读与旧数据保全；并守住关键业务路径不再无条件提示成功。
 * 源码级行为测试，不是浏览器 E2E。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const cafe = readFileSync(resolve(root, 'cafe/cafe.html'), 'utf8');

const saveSource = (() => {
  const match = cafe.match(/var CAFE_SAVE_FAIL_MSG=[^\n]*\nfunction save\(\)\{[^\n]*\}/);
  assert.ok(match, 'save() with failure message not found in cafe.html');
  return match[0];
})();

function makeStore(initial) {
  const data = { 'maomao_cafe_state_v1': initial };
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
    failNextWrites: (flag) => { quota = flag; },
    raw: data,
  };
}

function makeSandbox(store, state) {
  const sandbox = { localStorage: store, st: state, JSON, String };
  vm.createContext(sandbox);
  vm.runInContext(saveSource, sandbox);
  return sandbox;
}

test('正常写入：返回 true 且内容与内存状态一致', () => {
  const store = makeStore(null);
  const state = { day: 3, cash: 120, eventChoice: 1 };
  const sandbox = makeSandbox(store, state);

  assert.equal(sandbox.save(), true);
  assert.deepEqual(JSON.parse(store.raw.maomao_cafe_state_v1), state);
});

test('配额失败：返回 false、不抛异常、旧存档不被破坏', () => {
  const previous = JSON.stringify({ day: 2, cash: 80 });
  const store = makeStore(previous);
  const state = { day: 3, cash: 120 };
  const sandbox = makeSandbox(store, state);
  store.failNextWrites(true);

  assert.equal(sandbox.save(), false, 'a failed write must be reported to the caller');
  assert.equal(store.raw.maomao_cafe_state_v1, previous, 'failed write must not damage the previous snapshot');
  assert.deepEqual(JSON.parse(store.raw.maomao_cafe_state_v1), { day: 2, cash: 80 });
});

test('失败后可检测到内存与持久化的分歧（供上层提示，不做隐式回滚）', () => {
  const store = makeStore(JSON.stringify({ day: 2 }));
  const state = { day: 2 };
  const sandbox = makeSandbox(store, state);

  state.day = 3;
  store.failNextWrites(true);
  assert.equal(sandbox.save(), false);

  const persisted = JSON.parse(store.raw.maomao_cafe_state_v1);
  assert.equal(persisted.day, 2);
  assert.notEqual(persisted.day, state.day, 'divergence must remain observable instead of silently "succeeding"');
});

test('刷新回读：成功写入的存档可以在新页面上下文还原', () => {
  const store = makeStore(null);
  const state = { day: 7, cash: 300, menu: ['americano'] };
  makeSandbox(store, state).save();

  const reloaded = JSON.parse(store.raw.maomao_cafe_state_v1);
  assert.equal(reloaded.day, 7);
  assert.equal(reloaded.cash, 300);
  assert.deepEqual(reloaded.menu, ['americano']);
});

test('失败提示文案不含成功语义', () => {
  const message = saveSource.match(/CAFE_SAVE_FAIL_MSG='([^']*)'/)[1];
  assert.ok(message.includes('写入失败'), 'failure message must say the write failed: ' + message);
  assert.equal(message.includes('已选择'), false);
  assert.equal(message.includes('已领取'), false);
  assert.equal(message.includes('已记录'), false);
});

test('关键业务路径不再无条件提示成功', () => {
  const sites = cafe.match(/var savedOk=save\(\);/g) || [];
  assert.equal(sites.length, 6, 'expected the six audited paths to branch on the save result');

  for (const fn of ['chooseEvent', 'runDay', 'claimGrowthReward', 'chooseStory', 'chooseGalleryStory', 'choosePartnerEpisode']) {
    /* main 上 chooseEvent 存在两份同名声明，函数提升后生效的是最后一份 */
    const start = fn === 'chooseEvent' ? cafe.lastIndexOf('function ' + fn + '(') : cafe.indexOf('function ' + fn + '(');
    assert.ok(start > 0, 'missing function: ' + fn);
    const body = cafe.slice(start, cafe.indexOf('\nfunction ', start + 10));
    assert.ok(/var savedOk=save\(\);/.test(body), fn + ' does not capture the save result');
    assert.ok(body.includes('savedOk?'), fn + ' still reports success unconditionally');
    assert.ok(body.includes('CAFE_SAVE_FAIL_MSG'), fn + ' does not surface the failure message');
  }
});

test('存档写入不再使用静默空 catch', () => {
  assert.equal(
    /setItem\('maomao_cafe_state_v1',JSON\.stringify\(st\)\);\}catch\(e\)\{\}/.test(cafe),
    false,
    'the silent catch around the cafe state write must stay removed'
  );
});

test('存储键与写入位置保持不变', () => {
  assert.ok(saveSource.includes("localStorage.setItem('maomao_cafe_state_v1',JSON.stringify(st))"), 'storage key or payload changed');
});
