import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-STORY-001 · 剧情应用存档读写一致性
 * 原实现：writeSave 在 PhoneStorage 缺失时写 localStorage，而 loadSave/renderCover 只读
 * PhoneStorage → 存了但封面读不到；rawSet 的布尔返回被忽略、catch 全空，失败也提示已保存。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(resolve(root, 'games/story.html'), 'utf8');

const block = (() => {
  const start = page.indexOf('/* 存档读写统一入口。');
  const end = page.indexOf('/* ====== 封面：渲染剧本卡片 ====== */', start);
  assert.ok(start > 0 && end > start, 'story save block not found');
  return page.slice(start, end);
})();

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

function makeRuntime({ store, phoneStorage }) {
  const toasts = [];
  const sandbox = {
    localStorage: store,
    toast: (t) => toasts.push(t),
    state: { bookId: 'b1', sceneId: 's3', stats: { courage: 2 }, unlocked: ['e1'], playerName: '' },
    PLAYER_KEY: 'maomao_story_player',
    DIFF_KEY: 'maomao_story_difficulty',
    JSON, Object, String, Number, Array, Math, Date, console,
  };
  sandbox.window = sandbox;
  if (phoneStorage) sandbox.PhoneStorage = phoneStorage;
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox);
  return { sb: sandbox, toasts };
}

test('storyWrite：共享存储成功即返回 true，且不重复写 localStorage', () => {
  const store = makeStore();
  let calls = 0;
  const { sb } = makeRuntime({
    store,
    phoneStorage: { rawSet: () => { calls++; return true; }, rawGet: () => null },
  });
  assert.equal(sb.storyWrite('k', 'v'), true);
  assert.equal(calls, 1);
  assert.equal('k' in store.raw, false, 'no duplicate write when the shared store already succeeded');
});

test('storyWrite：共享存储返回 false 时回落 localStorage 并成功', () => {
  const store = makeStore();
  const { sb } = makeRuntime({ store, phoneStorage: { rawSet: () => false, rawGet: () => null } });
  assert.equal(sb.storyWrite('k', { a: 1 }), true);
  assert.equal(store.raw.k, '{"a":1}');
});

test('storyWrite：两条后端都失败 → false 且只提示一次', () => {
  const store = makeStore();
  const { sb, toasts } = makeRuntime({ store, phoneStorage: { rawSet: () => false, rawGet: () => null } });
  store.failWrites(true);

  assert.equal(sb.storyWrite('k', 'v'), false);
  assert.equal(sb.storyWrite('k2', 'v'), false);
  assert.equal(toasts.length, 1, 'warn once per session');
  assert.ok(toasts[0].includes('没能保存'));
});

test('一致性回归：没有共享存储时写入，loadSave 能读回来（原 bug）', () => {
  const store = makeStore();
  const { sb } = makeRuntime({ store });          // 无 PhoneStorage
  assert.equal(sb.writeSave(), true);
  assert.equal('maomao_story_save_b1' in store.raw, true);

  const loaded = sb.loadSave();
  assert.equal(loaded.sceneId, 's3');
  assert.deepEqual(loaded.unlocked, ['e1']);
});

test('共享存储优先：rawGet 有值时不看 localStorage', () => {
  const store = makeStore({ k: 'from-local' });
  const { sb } = makeRuntime({ store, phoneStorage: { rawSet: () => true, rawGet: () => 'from-phone' } });
  assert.equal(sb.storyRead('k', null), 'from-phone');
});

test('共享存储读不到时回落 localStorage', () => {
  const store = makeStore({ k: 'from-local' });
  const { sb } = makeRuntime({ store, phoneStorage: { rawSet: () => true, rawGet: () => null } });
  assert.equal(sb.storyRead('k', null), 'from-local');
});

test('writeSave：共享存储失败但 localStorage 成功时仍然返回 true', () => {
  const store = makeStore();
  const { sb } = makeRuntime({ store, phoneStorage: { rawSet: () => false, rawGet: () => null } });
  assert.equal(sb.writeSave(), true);
  assert.equal('maomao_story_save_b1' in store.raw, true);
});

test('名字/难度写入失败会提示，不再静默', () => {
  const store = makeStore();
  const { sb, toasts } = makeRuntime({ store, phoneStorage: { rawSet: () => false, rawGet: () => null } });
  store.failWrites(true);

  sb.setPlayerName('小雨');
  assert.equal(toasts.length, 1);
  assert.ok(toasts[0].includes('名字没能保存'));
});

test('源码守卫：「已保存」只在真的写进去时才提示', () => {
  assert.ok(page.includes('var savedOk = writeSave();'), 'must branch on the write result');
  assert.ok(page.includes("toast(savedOk ? '已保存'"), 'success toast must be conditional');
  assert.ok(page.includes('sv = storyRead('), 'cover progress must read through the same path');
  assert.ok(page.includes('if(PhoneStorage.rawSet(key, value)) return true;'), 'rawSet boolean must be honoured');
});

/* 总控 P1：无共享存储时 setName/saveNpc/saveDiff 写 localStorage，但三个读入口仍只走
 * PhoneStorage → 写成功、刷新读不到。读写必须走同一条兜底路径。 */
test('无 PhoneStorage：姓名/NPC/难度写入后重新读回完整一致', () => {
  const store = makeStore();
  const { sb } = makeRuntime({ store });
  sb.setPlayerName('小雨');
  sb.saveNpc({ jiang: '阿江', chen: '阿野', su: '阿念' });
  sb.saveDiff('hard');

  // 模拟刷新：同一份 localStorage，全新运行时
  const again = makeRuntime({ store }).sb;
  again.state.book = null;
  assert.equal(again.getPlayerName(), '小雨');
  assert.deepEqual(
    { ...again.loadNpc() },
    { jiang: '阿江', chen: '阿野', su: '阿念' });
  assert.equal(again.loadDiff(), 'hard');
});

test('无 PhoneStorage 且无存档：三个读入口返回安全默认值，不抛异常', () => {
  const { sb } = makeRuntime({ store: makeStore() });
  sb.state.book = null;
  assert.equal(sb.getPlayerName(), '');
  assert.deepEqual(
    { ...sb.loadNpc() },
    { jiang: '江屿', chen: '陈野', su: '苏念' });
  assert.equal(sb.loadDiff(), 'normal');
});

test('PhoneStorage 抛异常时三个读入口回落 localStorage', () => {
  const store = makeStore({
    maomao_story_player: '旧名',
    maomao_story_difficulty: 'easy',
  });
  const { sb } = makeRuntime({
    store,
    phoneStorage: { rawSet: () => true, rawGet: () => { throw new Error('boom'); } },
  });
  assert.equal(sb.getPlayerName(), '旧名');
  assert.equal(sb.loadDiff(), 'easy');
});

test('源码守卫：三个读入口都走 storyRead', () => {
  for (const fn of ['getPlayerName', 'loadNpc', 'loadDiff']) {
    const at = block.indexOf('function ' + fn + '(');
    assert.ok(at > 0, fn + ' not found');
    const body = block.slice(at, at + 700).split('\nfunction ')[0];
    assert.ok(body.includes('storyRead('), fn + ' must read through storyRead()');
  }
});
