import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-GAMES-001 · 游戏大厅存档写入可信性契约
 * 从 games/games.html 截取真实实现，在隔离上下文跑：
 * 存档写入失败必须可检测、不抛未捕获异常、不谎报成功。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(resolve(root, 'games/games.html'), 'utf8');

function slice(from, to) {
  const start = page.indexOf(from);
  const end = page.indexOf(to, start);
  assert.ok(start > 0 && end > start, `cannot slice ${from}`);
  return page.slice(start, end);
}

const writeBlock = slice('function showToast(text){', 'function characterTraits(){');
const statsBlock = slice('function statsRoot(){', 'function showToast(text){');
const roleBlock = slice('function selectRole(id){', 'function renderPartner(){');
const progressBlock = slice('function saveCaseProgress(', 'function loadGeneratedDetectiveCases(');

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

function makeSandbox({ store, roles = [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }] }) {
  const toasts = [];
  const toastEl = { textContent: '', classList: { add() {}, remove() {} } };
  const sandbox = {
    localStorage: store,
    activeRole: roles[0],
    roleList: roles,
    rolePickerOpen: true,
    reactionSequence: 0,
    gameStorageWarned: false,
    detectiveGenToken: 0,   /* #445 在 selectRole 里作废旧生成结果，此沙箱只需提供变量 */
    byId: (id) => (id === 'toast' ? toastEl : { textContent: '', innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
    showToast: (t) => toasts.push(t),
    roleName: (r) => (r && (r.name || r.nickname)) || '游戏搭档',
    activeRoleKey: () => String(roles[0] && roles[0].id || 'default-partner'),
    renderRoles: () => {},
    renderPartner: () => {},
    activeGame: null,
    clearTimeout,
    setTimeout,
    JSON,
    Object,
    String,
    Number,
    Array,
    Math,
    Date,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  /* writeBlock 自己定义 showToast，会覆盖上面的 stub：改为记录后用 toastEl 断言 */
  vm.runInContext(writeBlock, sandbox);
  vm.runInContext(statsBlock + '\n' + roleBlock, sandbox);
  const wrappedToast = [{ text: '' }];
  vm.runInContext('var __lastToast="";(function(){var _t=showToast;showToast=function(x){__lastToast=String(x);_t(x)}})()', sandbox);
  const lastToast = () => vm.runInContext('__lastToast', sandbox);
  return { sb: sandbox, toasts, toastEl, wrappedToast, lastToast };
}

test('saveRaw：写入成功返回 true，失败返回 false 且不抛异常', () => {
  const store = makeStore();
  const { sb, toastEl } = makeSandbox({ store });

  assert.equal(sb.saveRaw('k1', 'v1'), true);
  assert.equal(store.raw.k1, 'v1');

  store.failWrites(true);
  assert.doesNotThrow(() => sb.saveRaw('k2', 'v2'));
  assert.equal(sb.saveRaw('k2', 'v2'), false);
  assert.equal('k2' in store.raw, false);
  assert.ok(toastEl.textContent.includes('没能保存'), 'failure must be surfaced to the player');
});

test('写入失败只提示一次，不连点刷屏', () => {
  const store = makeStore();
  const { sb, toastEl } = makeSandbox({ store });
  store.failWrites(true);

  sb.saveRaw('a', '1');
  const first = toastEl.textContent;
  toastEl.textContent = 'SENTINEL';
  sb.saveRaw('b', '2');
  sb.saveRaw('c', '3');

  assert.equal(toastEl.textContent, 'SENTINEL', 'repeat failures inside one session must stay quiet');
  assert.ok(first.includes('没能保存'));
});

test('quiet 写入失败不打扰玩家，但仍返回 false', () => {
  const store = makeStore();
  const { sb, toastEl } = makeSandbox({ store });
  store.failWrites(true);

  assert.equal(sb.saveRaw('a', '1', true), false);
  assert.equal(toastEl.textContent, '');
});

test('saveJSON：序列化后再写，失败同样可检测', () => {
  const store = makeStore();
  const { sb } = makeSandbox({ store });

  assert.equal(sb.saveJSON('obj', { x: 1 }), true);
  assert.equal(store.raw.obj, '{"x":1}');

  store.failWrites(true);
  assert.equal(sb.saveJSON('obj2', { y: 2 }), false);
  assert.equal('obj2' in store.raw, false);
});

test('saveJSON：遇到不可序列化的值不抛异常', () => {
  const store = makeStore();
  const { sb } = makeSandbox({ store });
  const circular = {};
  circular.self = circular;

  assert.doesNotThrow(() => sb.saveJSON('bad', circular));
  assert.equal(sb.saveJSON('bad', circular), false);
});

test('saveCaseProgress：失败返回 false、存档不动、不抛异常', () => {
  const store = makeStore({ maomao_detective_progress_v1: '{"a":{"completed":[1]}}' });
  const { sb } = makeSandbox({ store });
  sb.activeRoleKey = () => 'a';
  sb.caseProgressRoot = () => JSON.parse(store.getItem('maomao_detective_progress_v1') || '{}');
  sb.caseProgress = () => ({ completed: [] });
  vm.runInContext(progressBlock, sb);

  assert.equal(sb.saveCaseProgress({ completed: [1, 2] }), true);
  assert.equal(JSON.parse(store.raw.maomao_detective_progress_v1).a.completed.length, 2);

  store.failWrites(true);
  assert.doesNotThrow(() => sb.saveCaseProgress({ completed: [1, 2, 3] }));
  assert.equal(sb.saveCaseProgress({ completed: [9] }), false);
  assert.equal(JSON.parse(store.raw.maomao_detective_progress_v1).a.completed.length, 2, 'failed save must not corrupt the stored progress');
});

test('selectRole：存档失败时不谎报「已切换搭档」', () => {
  const store = makeStore();
  const { sb, lastToast } = makeSandbox({ store });
  sb.renderRoles = () => {};

  sb.selectRole('b');
  assert.ok(lastToast().includes('已切换搭档'), 'success path keeps the normal message');
  assert.equal(store.raw.maomao_game_role, 'b');

  store.failWrites(true);
  sb.selectRole('a');
  assert.equal(lastToast().includes('已切换搭档'), false, 'must not claim success when the write failed');
  assert.ok(lastToast().includes('没能存到本机'), 'must explain that the choice will not survive a refresh');
});

test('saveStat：写失败不抛异常，战绩不被写坏', () => {
  const store = makeStore();
  const { sb } = makeSandbox({ store });
  sb.renderRoles = () => {};
  sb.saveStat('word', 'win');
  assert.equal(JSON.parse(store.raw.maomao_game_stats_v1).a.plays, 1);

  store.failWrites(true);
  assert.doesNotThrow(() => sb.saveStat('word', 'win'));
  assert.equal(JSON.parse(store.raw.maomao_game_stats_v1).a.plays, 1, 'stored stats must stay at the last successful write');
});

test('源码守卫：生成新案与「跟TA聊聊」不再谎报成功或携带旧草稿', () => {
  assert.ok(page.includes("showToast(caseSaved?'新案件已加入案件档案'"), 'generated case must only claim success when stored');
  assert.ok(page.includes('没能存下，刷新后会消失'), 'generated case must explain the unsaved state');
  assert.ok(page.includes('if(!pendingSaved){'), 'chat handoff must branch on the write result');
  assert.ok(page.includes("localStorage.removeItem('maomao_game_pending_'"), 'failed handoff must clear the stale draft');
});
