import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-GROWTH-001 · 共同成长（growth/growth.html）
 * 核心回归：成长数据必须和情侣空间读同一组「按正式角色 ID 命名」的键。
 * 之前读的是 maoer_couple_*_v1，而 couple.html 写的是 maoer_couple_*_<roleId>，
 * 两个键永远对不上 → 点数、统计、勋章全部显示 0，功能等于没生效。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(resolve(root, 'growth/growth.html'), 'utf8');

const script = (() => {
  const start = page.indexOf('<script>');
  const end = page.indexOf('</script>', start);
  assert.ok(start > 0 && end > start, 'growth script not found');
  return page.slice(start + '<script>'.length, end);
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
    failWrites: (f) => { quota = f; },
    raw,
  };
}

function makeEl(id) {
  const el = {
    id, innerHTML: '', value: '', style: {},
    _text: '',
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v == null ? '' : v); },
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    _h: {},
    addEventListener(ev, fn) { this._h[ev] = fn; },
    click() { if (this._h.click) this._h.click({}); },
    submit() { if (this._h.submit) this._h.submit({ preventDefault() {} }); },
  };
  return el;
}

function makeRuntime({ store, currentRole = 'roleA', confirmAnswer = true, search = '' } = {}) {
  const els = {};
  const frames = [];
  const queue = [];
  let clock = 0;
  /* 数字滚动由 rAF 驱动：用队列推进时间而不是递归调用，避免栈溢出 */
  function drainFrames() {
    let guard = 0;
    while (queue.length && guard++ < 400) {
      const fn = queue.shift();
      clock += 400;
      fn(clock);
    }
  }
  const sandbox = {
    localStorage: store,
    document: { getElementById: (id) => (els[id] = els[id] || makeEl(id)), querySelectorAll: () => [] },
    location: { search },
    URLSearchParams,
    confirm: () => confirmAnswer,
    requestAnimationFrame: (fn) => { frames.push(fn); queue.push(fn); return frames.length; },
    setTimeout: (fn) => { try { fn(); } catch (e) {} return 0; },
    clearTimeout() {},
    addEventListener() {},
    JSON, Object, String, Number, Array, Math, Date, isNaN, console,
  };
  sandbox.window = sandbox;
  sandbox.PhoneStorage = {
    getCharacters: () => [{ id: 'roleA', name: '阿岚' }, { id: 'roleB', name: '白露' }],
    getCurrentContactId: () => currentRole,
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  const get = (id) => (els[id] = els[id] || makeEl(id));
  drainFrames();
  return { sb: sandbox, get, frames, drain: drainFrames };
}

const SEED = {
  'maoer_couple_moments_roleA': JSON.stringify([{ id: 'm1', text: '第一次一起看电影' }, { id: 'm2', text: '雨里走回家' }]),
  'maoer_couple_bucket_roleA': JSON.stringify([{ id: 'b1', text: '一起看海', done: true }, { id: 'b2', text: '学做蛋糕', done: false }]),
  'maoer_couple_mood_roleA': JSON.stringify({ '2026-11-20': ['还好', '挺好'], '2026-11-21': ['累', ''] }),
  'maoer_couple_profile_roleA': JSON.stringify({ nameA: '我', nameB: '阿岚', startDate: '2026-01-01' }),
};

test('成长页读取情侣空间的真实键：点数与统计不再是 0', () => {
  const store = makeStore({ ...SEED });
  const { get } = makeRuntime({ store });
  /* 2 段记忆(20) + 1 个完成计划(15) + 2 个心情日(10) = 45 */
  assert.equal(get('points').textContent, '45', '点数必须按真实数据计算');
  assert.equal(get('memoryStat').textContent, '2');
  assert.equal(get('planStat').textContent, '1');
  assert.equal(get('moodStat').textContent, '2');
  assert.ok(get('levelName').textContent.includes('01'));
});

test('勋章按真实数据解锁', () => {
  const store = makeStore({ ...SEED });
  const { get } = makeRuntime({ store });
  const html = get('badges').innerHTML;
  const unlocked = (html.match(/badge-card /g) || []).length - (html.match(/badge-card locked/g) || []).length;
  assert.ok(unlocked >= 3, '至少「第一段记忆 / 把计划变成回忆 / 认真听见彼此」应解锁');
  assert.ok(get('earnedCount').textContent.startsWith(String(unlocked)));
});

test('角色隔离：B 的成长页读不到 A 的数据', () => {
  const store = makeStore({ ...SEED });
  const { get } = makeRuntime({ store, currentRole: 'roleB' });
  assert.equal(get('points').textContent, '0');
  assert.equal(get('memoryStat').textContent, '0');
});

test('URL ?id= 优先', () => {
  const store = makeStore({ ...SEED });
  const { get } = makeRuntime({ store, currentRole: 'roleB', search: '?id=roleA' });
  assert.equal(get('memoryStat').textContent, '2');
});

/* 总控复审：旧全局 _v1 键从未被任何应用写入，无条件兜底只会跨角色泄漏 → 已移除。 */
test('旧全局 _v1 键不再兜底：不会把历史资料广播给所有角色', () => {
  const store = makeStore({
    'maoer_couple_moments_v1': JSON.stringify([{ id: 'old', text: '旧记录' }]),
    'maoer_couple_bucket_v1': JSON.stringify([{ id: 'ob', text: '旧计划', done: true }]),
  });
  const { get } = makeRuntime({ store, currentRole: 'roleA' });
  assert.equal(get('memoryStat').textContent, '0', 'A 不得继承从未归属过自己的全局旧数据');
  assert.equal(get('planStat').textContent, '0');
});

test('目标写进当前角色的键，写失败要提示且不谎报成功', () => {
  const store = makeStore({ ...SEED });
  const r = makeRuntime({ store });
  r.get('goalInput').value = '一起早起';
  r.get('goalForm').submit();
  assert.ok(store.raw['maoer_growth_goals_roleA'], '必须按角色落库');
  assert.equal(JSON.parse(store.raw['maoer_growth_goals_roleA']).length, 1);
  assert.ok(r.get('toast').textContent.includes('已加入'));

  store.failWrites(true);
  r.get('goalInput').value = '第二条';
  r.get('goalForm').submit();
  assert.equal(JSON.parse(store.raw['maoer_growth_goals_roleA']).length, 1, '写失败不能落库');
  assert.ok(r.get('toast').textContent.includes('没能保存'), '必须说明失败');
});

test('勾选目标：写失败不提示 +15', () => {
  const store = makeStore({ ...SEED });
  const r = makeRuntime({ store });
  r.get('goalInput').value = '一起早起';
  r.get('goalForm').submit();
  const id = JSON.parse(store.raw['maoer_growth_goals_roleA'])[0].id;

  store.failWrites(true);
  r.sb.toggleGoal(id);
  assert.ok(r.get('toast').textContent.includes('没能保存'), '失败时不能说自己完成了一项');
  assert.equal(r.get('toast').textContent.includes('+15'), false);

  store.failWrites(false);
  r.sb.toggleGoal(id);
  assert.ok(r.get('toast').textContent.includes('+15'));
  assert.equal(JSON.parse(store.raw['maoer_growth_goals_roleA'])[0].done, true);
});

test('取消完成时提示与点数同步，不再谎报 +15', () => {
  const store = makeStore({ ...SEED, 'maoer_growth_goals_roleA': JSON.stringify([{ id: 'g1', text: '目标', done: true }]) });
  const r = makeRuntime({ store });
  assert.equal(r.get('points').textContent, '60', '45 + 15');
  r.sb.toggleGoal('g1');
  r.drain();                       // 重新渲染会重跑数字滚动
  assert.ok(r.get('toast').textContent.includes('已取消'));
  assert.equal(r.get('points').textContent, '45');
});

test('删除目标：确认与写失败处理', () => {
  const store = makeStore({ ...SEED, 'maoer_growth_goals_roleA': JSON.stringify([{ id: 'g1', text: '目标', done: false }]) });
  const r = makeRuntime({ store, confirmAnswer: false });
  r.sb.delGoal('g1');
  assert.equal(JSON.parse(store.raw['maoer_growth_goals_roleA']).length, 1, '取消确认不删');

  const r2 = makeRuntime({ store, confirmAnswer: true });
  store.failWrites(true);
  r2.sb.delGoal('g1');
  assert.equal(JSON.parse(store.raw['maoer_growth_goals_roleA']).length, 1, '写失败不删');

  store.failWrites(false);
  r2.sb.delGoal('g1');
  assert.equal(JSON.parse(store.raw['maoer_growth_goals_roleA']).length, 0);
});

test('脏数据不崩：非法结构回落到空集合', () => {
  const store = makeStore({
    'maoer_couple_moments_roleA': '"不是数组"',
    'maoer_couple_bucket_roleA': 'null',
    'maoer_couple_mood_roleA': '[]',
    'maoer_couple_profile_roleA': '[]',
  });
  const r = makeRuntime({ store });
  assert.equal(r.get('points').textContent, '0');
  assert.equal(r.get('memoryStat').textContent, '0');
});

test('源码守卫：键名按角色命名、无角色只读、写入有返回检查', () => {
  assert.ok(script.includes("'maoer_couple_moments_'+roleId"), '必须读按角色命名的真实键');
  assert.equal(script.includes('LEGACY'), false, '不得再无条件兜底旧全局键');
  assert.ok(script.includes('getCurrentContactId'), '必须绑定共享当前角色');
  assert.ok(script.includes('canStore'), '必须有只读闸门');
  assert.ok(script.includes('getCharacters'), '?id= 必须经正式角色列表验证');
  assert.ok(script.includes('未能保存') || script.includes('没能保存'), '写入失败必须提示');
  assert.equal(/https?:\/\/|fetch\(|PhoneAPI/.test(script), false, '成长页不应有网络/模型调用');
  assert.equal(/Made by|作者：/.test(page), false, 'no developer signature');
});

test('真实 HTML 真的加载了 phone_storage.js，且在内联脚本之前', () => {
  const libAt = page.indexOf('shared/js/phone/phone_storage.js');
  assert.ok(libAt > 0, '独立页面必须引入共享存储');
  assert.ok(libAt < page.lastIndexOf('<script>'), '必须在内联脚本之前加载');
});

test('无合法正式角色：只读，不写任何键', () => {
  const store = makeStore();
  const r = makeRuntime({ store, currentRole: '' });
  r.get('goalInput').value = '不该写进去';
  r.get('goalForm').submit();
  const keys = Object.keys(store.raw).filter((k) => k.startsWith('maoer_growth_goals_'));
  assert.deepEqual(keys, [], '无角色时不得创建任何目标桶');
  assert.ok(
    r.get('toast').textContent.includes('正式角色') || r.get('toast').textContent.includes('没能保存'),
    '必须给出未绑定或保存失败的原因');
});

test('?id= 指向不存在的角色：只读', () => {
  const store = makeStore({ ...SEED });
  const r = makeRuntime({ store, currentRole: 'roleA', search: '?id=ghost' });
  assert.equal(r.get('memoryStat').textContent, '0', '失效深链不得读到当前角色的数据');
  r.get('goalInput').value = 'x';
  r.get('goalForm').submit();
  const keys = Object.keys(store.raw).filter((k) => k.startsWith('maoer_growth_goals_'));
  assert.deepEqual(keys, []);
});
