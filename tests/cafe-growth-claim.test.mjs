import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-CAFE-002 · 成长奖励领取行为契约
 * 从生产源码中截取 claimGrowthReward + bindGrowthClaim 的真实实现，放进隔离上下文执行，
 * 模拟真实点击事件：能领、只能领一次、非领奖区域不触发、重复绑定不会叠加响应。
 * 说明：这是源码级行为测试，不是浏览器 E2E。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(resolve(root, 'cafe/cafe.html'), 'utf8');

function slice(from, to) {
  const start = source.indexOf(from);
  assert.ok(start > 0, 'source marker not found: ' + from);
  const end = source.indexOf(to, start);
  assert.ok(end > start, 'source end marker not found: ' + to);
  return source.slice(start, end);
}

function buildSandbox() {
  const state = {
    day: 9,
    cash: 100,
    unlocked: [],
    unlockedItems: [],
    decorUnlocked: [],
    growthClaims: {},
  };
  let persisted = null;
  const sandbox = {
    st: state,
    ITEMS: [],
    DECORS: [],
    growthMilestones: () => [
      { id: 'days7', title: '开业一周', desc: '经营满 7 天', value: 9, target: 7, reward: 120, unlock: 'menu' },
      { id: 'days30', title: '开业一月', desc: '经营满 30 天', value: 9, target: 30, reward: 400, unlock: 'menu' },
    ],
    money: (n) => '¥' + Math.round(Number(n) || 0),
    clamp: (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0)),
    clone: value => JSON.parse(JSON.stringify(value)),
    localStorage: { setItem: (_, value) => { persisted = value; }, getItem: () => persisted },
    renderAll: () => {},
    toast: () => {},
    Number,
    Math,
    Object,
    String,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    slice('function claimGrowthReward(', '\nfunction renderGrowthDashboard(') +
    'function bindGrowthClaim(root){const nodes={records:root};\n'+slice(" nodes.records.addEventListener('click'", " panel.addEventListener('click'")+'}',
    sandbox
  );
  return sandbox;
}

function mountRoot(sandbox) {
  const listeners = [];
  const el = { addEventListener: (type, fn) => listeners.push({ type, fn }) };
  sandbox.bindGrowthClaim(el);
  return { el, listeners };
}

function clickWith(listeners, target) {
  const listener = listeners.find((l) => l.type === 'click');
  assert.ok(listener, 'click delegation was not registered');
  listener.fn({ target });
}

test('点击领取奖励按钮会真正发放奖励', () => {
  const sandbox = buildSandbox();
  const { listeners } = mountRoot(sandbox);
  const button = { getAttribute: () => 'days7' };
  const label = { closest: (sel) => (sel === '[data-growth-claim]' ? button : null) };

  clickWith(listeners, label);

  assert.ok(sandbox.st.growthClaims.days7, 'claim was not written to state');
  assert.equal(sandbox.st.cash, 220, 'reward cash was not granted exactly once');
});

test('同一奖励第二次点击不会重复发放', () => {
  const sandbox = buildSandbox();
  const { listeners } = mountRoot(sandbox);
  const button = { getAttribute: () => 'days7' };
  const label = { closest: () => button };

  clickWith(listeners, label);
  const afterFirst = sandbox.st.cash;
  clickWith(listeners, label);

  assert.equal(sandbox.st.cash, afterFirst, 'duplicate claim granted cash again');
});

test('未达成或未知的奖励不会发放', () => {
  const sandbox = buildSandbox();
  const { listeners } = mountRoot(sandbox);
  clickWith(listeners, { closest: () => ({ getAttribute: () => 'days30' }) });
  assert.equal(sandbox.st.cash, 100, 'locked milestone granted a reward');
  assert.deepEqual(Object.keys(sandbox.st.growthClaims), []);

  clickWith(listeners, { closest: () => ({ getAttribute: () => 'not-a-milestone' }) });
  assert.equal(sandbox.st.cash, 100, 'unknown milestone granted a reward');
});

test('点击非领奖区域不会触发领取', () => {
  const sandbox = buildSandbox();
  const { listeners } = mountRoot(sandbox);
  clickWith(listeners, { closest: () => null });
  assert.equal(sandbox.st.cash, 100);
  assert.deepEqual(Object.keys(sandbox.st.growthClaims), []);
});

test('挂载档案只注册一次点击委托', () => {
  const sandbox = buildSandbox();
  const { listeners } = mountRoot(sandbox);
  assert.equal(listeners.length, 1, 'delegation registered more than once');
});

test('renderCafeDetails 不再在 innerHTML 之前绑定领奖按钮', () => {
  const details = slice('function renderCafeDetails(', 'function renderOverview(');
  const bindAt = details.indexOf("querySelectorAll('[data-growth-claim]')");
  const replaceAt = details.indexOf('root.innerHTML=html');
  assert.equal(bindAt === -1 || bindAt > replaceAt, true, 'growth claim listeners are still attached before the DOM is replaced');
});

test('保存失败时资金和领取状态回滚，可以重试', () => {
  const sandbox = buildSandbox();
  const { listeners } = mountRoot(sandbox);
  const target = { closest: () => ({ getAttribute: () => 'days7' }) };
  const normalStorage = sandbox.localStorage;
  sandbox.localStorage = { setItem() {}, getItem: () => null };
  clickWith(listeners, target);
  assert.equal(sandbox.st.cash, 100);
  assert.deepEqual(Object.keys(sandbox.st.growthClaims), []);
  sandbox.localStorage = normalStorage;
  clickWith(listeners, target);
  assert.equal(sandbox.st.cash, 220);
});
