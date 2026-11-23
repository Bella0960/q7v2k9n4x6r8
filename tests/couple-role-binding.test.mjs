import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-COUPLE-001 · 情侣空间（couple/couple.html）
 * 重点回归：
 *  1. 必须绑正式角色（PhoneStorage 当前角色），不同角色不共用一份数据
 *  2. 绑定对象来自正式角色列表，而不是旧 ai_custom_characters
 *  3. 写失败不能假报成功，内存也不能先改
 *  4. 头像地址不得把用户数据当 HTML 注入
 * 全部本地 mock，无网络请求。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(resolve(root, 'couple/couple.html'), 'utf8');

const script = (() => {
  const start = page.indexOf('<script>');
  const end = page.indexOf('</script>', start);
  assert.ok(start > 0 && end > 0, 'couple script not found');
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
    id, innerHTML: '', textContent: '', value: '', disabled: false, selected: false,
    style: {}, dataset: {}, children: [],
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    addEventListener(ev, fn) { (this._h = this._h || {})[ev] = fn; },
    appendChild(c) { this.children.push(c); },
    click() { if (this._h && this._h.click) return this._h.click({ target: this }); },
    querySelectorAll() { return []; },
  };
  return el;
}

const ROLES = [{ id: 'roleA', name: '阿岚', avatar: 'data:image/png;base64,AAA' }, { id: 'roleB', name: '白露' }];

function makeRuntime({ store, currentRole = 'roleA', confirmAnswer = true } = {}) {
  const els = {};
  const sandbox = {
    localStorage: store,
    document: {
      getElementById: (id) => (els[id] = els[id] || makeEl(id)),
      createElement: (tag) => makeEl(tag),
      querySelectorAll: () => [],
    },
    location: { search: '' },
    URLSearchParams,
    confirm: () => confirmAnswer,
    FileReader: class {},
    Image: class {},
    setTimeout, clearTimeout, JSON, Object, String, Number, Array, Math, Date, Promise, Error, console,
  };
  sandbox.window = sandbox;
  sandbox.PhoneStorage = {
    getCharacters: () => ROLES,
    getCurrentContactId: () => currentRole,
    getMyProfile: () => ({ name: '我', avatar: '' }),
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  const get = (id) => (els[id] = els[id] || makeEl(id));
  return { sb: sandbox, get, store };
}

test('绑定正式角色：数据写进以正式角色 ID 命名的键', () => {
  const store = makeStore();
  const r = makeRuntime({ store, currentRole: 'roleB' });
  r.get('bucketInput').value = '一起去看海';
  r.sb.addBucket();

  assert.ok(store.raw['maoer_couple_bucket_roleB'], '必须按正式角色 ID 落库');
  assert.equal(store.raw['maoer_couple_bucket_default'], undefined, '不得再落到 default');
  assert.deepEqual(JSON.parse(store.raw['maoer_couple_bucket_roleB']).map((x) => x.text), ['一起去看海']);
});

test('角色隔离：A 的心愿清单不会出现在 B 的空间', () => {
  const store = makeStore();
  const a = makeRuntime({ store, currentRole: 'roleA' });
  a.get('bucketInput').value = 'A 的心愿';
  a.sb.addBucket();

  const b = makeRuntime({ store, currentRole: 'roleB' });
  assert.equal(b.get('bucketDesc').textContent, '0/0 件', 'B 打开必须是空的');
});

test('URL ?id= 优先于当前角色', () => {
  const store = makeStore();
  const r = makeRuntime({ store, currentRole: 'roleB' });
  /* 通过 location 注入 ?id=roleA 并重新加载一次 */
  const store2 = makeStore();
  const sandbox = {
    localStorage: store2,
    document: { getElementById: (id) => makeEl(id), createElement: (t) => makeEl(t), querySelectorAll: () => [] },
    location: { search: '?id=roleA' },
    URLSearchParams,
    confirm: () => true,
    setTimeout, clearTimeout, JSON, Object, String, Number, Array, Math, Date, Promise, Error, console,
  };
  sandbox.window = sandbox;
  sandbox.PhoneStorage = { getCharacters: () => ROLES, getCurrentContactId: () => 'roleB', getMyProfile: () => ({}) };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  const bucketInput = makeEl('bucketInput');
  bucketInput.value = '深链写入';
  sandbox.document.getElementById = (id) => (id === 'bucketInput' ? bucketInput : makeEl(id));
  sandbox.addBucket();
  assert.ok(store2.raw['maoer_couple_bucket_roleA']);
  assert.equal(r.store.raw['maoer_couple_bucket_roleB'], undefined);
});

test('写失败：不提示成功，内存也不留半截数据', () => {
  const store = makeStore();
  const r = makeRuntime({ store });
  r.get('bucketInput').value = '第一项';
  r.sb.addBucket();
  assert.equal(JSON.parse(store.raw['maoer_couple_bucket_roleA']).length, 1);

  store.failWrites(true);
  r.get('bucketInput').value = '第二项（写不进去）';
  r.sb.addBucket();
  assert.equal(JSON.parse(store.raw['maoer_couple_bucket_roleA']).length, 1, '磁盘不能变');
  assert.equal(r.get('bucketDesc').textContent, '0/1 件', '内存也不能变成 2 项');
  assert.ok(r.get('toast').textContent.includes('存储空间不足'), '要说明原因');
});

test('打卡写失败：按钮不会变成已打卡', () => {
  const store = makeStore();
  const r = makeRuntime({ store });
  store.failWrites(true);
  r.sb.doCheckin();
  assert.equal(r.get('checkinBtn').disabled, false, '失败时不能显示已打卡');
  assert.equal(store.raw['maoer_couple_checkin_roleA'], undefined);
});

test('心情写失败：不静默吞掉', () => {
  const store = makeStore();
  const r = makeRuntime({ store });
  r.get('moodA').value = '今天很好';
  r.get('moodB').value = '也挺好';
  store.failWrites(true);
  r.sb.saveMood();
  assert.equal(store.raw['maoer_couple_mood_roleA'], undefined);
  assert.ok(r.get('toast').textContent.includes('存储空间不足'));
});

test('绑定对象来自正式角色列表，不是旧 ai_custom_characters', () => {
  const store = makeStore({ ai_custom_characters: JSON.stringify([{ id: 'legacy', name: '旧角色' }]) });
  const r = makeRuntime({ store });
  r.sb.openSet();
  const sel = r.get('setPartner');
  const values = sel.children.map((c) => c.value);
  assert.ok(values.includes('roleA') && values.includes('roleB'), '必须列出正式角色');
  assert.equal(values.includes('legacy'), false, '有正式角色时不再混入旧列表');
});

test('saveSet 写失败：不会出现「名字变了、绑定没变」', () => {
  const store = makeStore();
  const r = makeRuntime({ store });
  r.sb.openSet();
  r.get('setNameA').value = '新名字';
  r.get('setNameB').value = 'TA';
  r.get('setDate').value = '2024-05-20';
  r.get('setPartner').value = 'roleA';
  store.failWrites(true);
  r.sb.saveSet();

  assert.equal(store.raw['maoer_couple_profile_roleA'], undefined, '写失败不得落盘');
  assert.ok(r.get('toast').textContent.includes('没能保存'));
});

test('头像地址：非白名单协议不进入 innerHTML', () => {
  const store = makeStore();
  store.raw['maoer_couple_profile_roleA'] = JSON.stringify({ taAvatar: 'x" onerror="alert(1)', myAvatar: 'javascript:alert(1)' });
  const r = makeRuntime({ store });
  const html = r.get('avA').innerHTML + r.get('avB').innerHTML;
  assert.equal(html.includes('onerror'), false, '属性注入必须被拦掉');
  assert.equal(html.includes('javascript:'), false);
  /* 没有图片时回落到首字 */
  assert.ok(r.get('avA').textContent.length > 0);
});

test('内联 onclick 调用的函数必须挂在 window 上，否则点了就报错', () => {
  const store = makeStore();
  const r = makeRuntime({ store });
  const names = [...page.matchAll(/onclick="([a-zA-Z_$][\w$]*)\(/g)].map((m) => m[1]);
  const unique = [...new Set(names)].filter((n) => !['if', 'for', 'while', 'return', 'window'].includes(n));
  assert.ok(unique.length >= 8, '应能扫到内联处理器');
  const missing = unique.filter((n) => typeof r.sb[n] !== 'function');
  assert.deepEqual(missing, [], '这些内联函数没有暴露到 window：' + missing.join(','));
});

test('源码守卫：绑正式角色、写失败有返回、无重复 AI 通道', () => {
  assert.ok(script.includes('getCurrentContactId'), '必须优先用共享当前角色');
  assert.equal(/const roleId = urlParams.get\('id'\) \|\| localStorage\.getItem\('currentRoleId'\) \|\| 'default'/.test(script), false, '旧的默认兜底必须被替换');
  assert.ok(script.includes('return true;') && script.includes('storeWarned'), '写入必须返回布尔并可提示');
  assert.equal(/fetch\(|PhoneAPI/.test(script), false, '本页不应有任何模型调用');
  assert.ok(script.includes('safeSrc'), '头像地址必须过白名单');
  assert.equal(/Made by|作者：/.test(page), false, 'no developer signature');
});
