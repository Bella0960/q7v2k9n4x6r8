import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-COMPANION-001 · 陪伴日历（companion/companion.html）
 * 重点回归：
 *  1. 必须绑正式角色（PhoneStorage 当前角色优先），不同角色不共用同一份回答
 *  2. 写入失败不能假报「已保存」，也不能把界面上的旧数据改坏
 *  3. 切换 Tab 不能丢掉还没保存的输入
 *  4. 纪念日日期校验与天数计算
 * 全部本地 mock，不产生任何网络请求。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(resolve(root, 'companion/companion.html'), 'utf8');

const script = (() => {
  const start = page.indexOf('<script>');
  const end = page.indexOf('</script>', start);
  assert.ok(start > 0 && end > start, 'companion script not found');
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

function decode(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

function makeEl(id) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    hidden: false,
    dataset: {},
    children: [],
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, on) { if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (on) this._s.add(c); else this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    reset() { this.value = ''; },
    addEventListener(ev, fn) { (this._h = this._h || {})[ev] = fn; },
    click() { if (this._h && this._h.click) this._h.click({ preventDefault() {}, target: this }); },
    submit() { if (this._h && this._h.submit) this._h.submit({ preventDefault() {}, target: this }); },
    closest() { return null; },
    querySelectorAll() { return []; },
    appendChild() {},
  };
}

/**
 * 迷你 DOM：只有 questionList 的 innerHTML 会被真的解析出 [data-answer] textarea，
 * 这样切换 Tab / 保存 / 草稿这些路径能走真实代码。
 */
function makeDom() {
  const els = {};
  const LIST_ID = 'questionList';
  let answers = [];
  const get = (id) => {
    if (!els[id]) els[id] = makeEl(id);
    return els[id];
  };
  Object.defineProperty(get(LIST_ID), 'innerHTML', {
    get() { return els[LIST_ID]._html || ''; },
    set(html) {
      els[LIST_ID]._html = String(html);
      answers = [];
      const re = /<textarea data-answer="(\d+)"[^>]*>([\s\S]*?)<\/textarea>/g;
      let m;
      while ((m = re.exec(String(html)))) {
        const ta = makeEl('ta' + m[1]);
        ta.dataset.answer = m[1];
        ta.value = decode(m[2]);
        answers.push(ta);
      }
    },
  });
  const document = {
    getElementById: get,
    querySelectorAll(sel) {
      if (sel === '[data-answer]') return answers;
      if (sel === '[data-tab]') return [get('tabQ'), get('tabE')];
      return [];
    },
    querySelector() { return get('queryRoot'); },
  };
  get('tabQ').dataset.tab = 'questions';
  get('tabE').dataset.tab = 'anniversaries';
  return { document, get, answers: () => answers };
}

function makeRuntime({ store, search = '', phoneStorage = null, confirmAnswer = true } = {}) {
  const dom = makeDom();
  const toasts = [];
  const sandbox = {
    localStorage: store,
    document: dom.document,
    location: { search },
    URLSearchParams,
    JSON, Object, String, Number, Array, Math, Date, isFinite, RegExp, console,
    confirm: () => confirmAnswer,
    setTimeout, clearTimeout,
  };
  sandbox.window = sandbox;
  if (phoneStorage) sandbox.PhoneStorage = phoneStorage;
  /* toast 是内部函数，这里通过 DOM 观察 */
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  const toastEl = dom.get('toast');
  return {
    sb: sandbox,
    dom,
    get: dom.get,
    toasts,
    toastText: () => toastEl.textContent,
    fields: () => dom.answers(),
  };
}

const ROLES = [{ id: 'roleA', name: '阿岚' }, { id: 'roleB', name: '白露' }];
const phoneWith = (currentId) => ({
  getCharacters: () => ROLES,
  getCurrentContactId: () => currentId,
});

test('绑定正式角色：使用 PhoneStorage 当前角色作为存储命名空间', () => {
  const store = makeStore();
  const { get, fields } = makeRuntime({ store, phoneStorage: phoneWith('roleB') });
  assert.ok(get('roleLabel').textContent.includes('白露'), '角色名要显示出来，而不是「本地保存」通用文案');

  fields()[0].value = '只属于白露的回答';
  get('questionList')._h.input({ target: fields()[0] });
  get('saveAnswers')._h.click();
  const day = Object.keys(JSON.parse(store.raw['maoer_daily_questions_roleB'] || '{}'))[0];
  assert.ok(store.raw['maoer_daily_questions_roleB'], '必须写到以正式角色 ID 命名的键');
  assert.equal(store.raw['maoer_daily_questions_default'], undefined, '不得再共用 default 命名空间');
  assert.equal(JSON.parse(store.raw['maoer_daily_questions_roleB'])[day][0], '只属于白露的回答');
});

test('角色隔离：A 的回答不会出现在 B 的日历里', () => {
  const store = makeStore();
  const a = makeRuntime({ store, phoneStorage: phoneWith('roleA') });
  a.fields()[0].value = '阿岚的回答';
  a.get('questionList')._h.input({});
  a.get('saveAnswers')._h.click();

  const b = makeRuntime({ store, phoneStorage: phoneWith('roleB') });
  assert.equal(b.fields()[0].value, '', 'B 打开时必须是空的，不能读到 A 的内容');
  const aKeys = Object.keys(JSON.parse(store.raw['maoer_daily_questions_roleA']));
  const bKeys = Object.keys(JSON.parse(store.raw['maoer_daily_questions_roleB'] || '{}'));
  assert.equal(aKeys.length, 1);
  assert.equal(bKeys.length, 0);
});

test('URL ?id= 优先于当前角色，便于从聊天页深链进入', () => {
  const store = makeStore();
  const { fields } = makeRuntime({ store, search: '?id=roleA', phoneStorage: phoneWith('roleB') });
  fields()[0].value = '深链写入';
  const { get } = makeRuntime({ store, search: '?id=roleA', phoneStorage: phoneWith('roleB') });
  get('saveAnswers')._h.click();
  assert.ok(store.raw['maoer_daily_questions_roleA'], '必须按 URL 指定的角色落库');
});

test('没有共享角色时退回 legacy currentRoleId，再退回 default', () => {
  const store = makeStore({ currentRoleId: 'legacyRole' });
  const { fields, get } = makeRuntime({ store });
  fields()[0].value = '旧环境';
  get('saveAnswers')._h.click();
  assert.ok(store.raw['maoer_daily_questions_legacyRole']);

  const store2 = makeStore();
  const r2 = makeRuntime({ store: store2 });
  r2.fields()[0].value = '无角色';
  r2.get('saveAnswers')._h.click();
  assert.ok(store2.raw['maoer_daily_questions_default']);
});

test('写入失败：不提示「已保存」，内存里的旧值不被改坏', () => {
  const store = makeStore();
  const r1 = makeRuntime({ store, phoneStorage: phoneWith('roleA') });
  r1.fields()[0].value = '第一次';
  r1.get('saveAnswers')._h.click();
  const before = store.raw['maoer_daily_questions_roleA'];

  store.failWrites(true);
  r1.fields()[0].value = '第二次（写不进去）';
  r1.get('questionList')._h.input({});
  r1.get('saveAnswers')._h.click();

  assert.ok(r1.get('saveStatus').textContent.includes('没能保存'), '必须如实说没保存');
  assert.ok(r1.toastText().includes('存储空间不足'), '要给出原因');
  assert.equal(store.raw['maoer_daily_questions_roleA'], before, '磁盘上的旧数据不能被改坏');
});

test('写入失败后恢复可写：再保存一次能成功', () => {
  const store = makeStore();
  const r = makeRuntime({ store, phoneStorage: phoneWith('roleA') });
  store.failWrites(true);
  r.fields()[0].value = '补写';
  r.get('questionList')._h.input({});
  r.get('saveAnswers')._h.click();
  assert.equal(store.raw['maoer_daily_questions_roleA'], undefined);

  store.failWrites(false);
  r.get('saveAnswers')._h.click();
  assert.ok(store.raw['maoer_daily_questions_roleA']);
  assert.ok(r.get('saveStatus').textContent.includes('已保存'));
});

test('切换 Tab 不丢未保存的输入', () => {
  const store = makeStore();
  const r = makeRuntime({ store, phoneStorage: phoneWith('roleA') });
  r.fields()[0].value = '写到一半就去看看纪念日';
  r.get('questionList')._h.input({});

  r.get('tabE')._h.click();                 // 切到纪念日
  assert.equal(r.get('questionsPanel').hidden, true);
  r.get('tabQ')._h.click();                 // 切回来
  assert.equal(r.fields()[0].value, '写到一半就去看看纪念日', '草稿必须还在');
  assert.ok(r.get('saveStatus').textContent.includes('未保存'), '要提示有未保存的修改');
});

test('保存后草稿清空，状态回到已保存', () => {
  const store = makeStore();
  const r = makeRuntime({ store, phoneStorage: phoneWith('roleA') });
  r.fields()[0].value = '保存一下';
  r.get('questionList')._h.input({});
  r.get('saveAnswers')._h.click();
  r.get('tabE')._h.click();
  r.get('tabQ')._h.click();
  assert.equal(r.fields()[0].value, '保存一下');
  assert.ok(r.get('saveStatus').textContent.includes('已保存'));
});

test('清空今天：写入失败时不清空内存与界面', () => {
  const store = makeStore();
  const r = makeRuntime({ store, phoneStorage: phoneWith('roleA'), confirmAnswer: true });
  r.fields()[0].value = '要被清掉';
  r.get('questionList')._h.input({});
  r.get('saveAnswers')._h.click();

  store.failWrites(true);
  r.get('clearAnswers')._h.click();
  assert.ok(store.raw['maoer_daily_questions_roleA'], '写失败时旧回答必须保留');

  store.failWrites(false);
  r.get('clearAnswers')._h.click();
  const day = Object.keys(JSON.parse(store.raw['maoer_daily_questions_roleA']))[0];
  assert.deepEqual(JSON.parse(store.raw['maoer_daily_questions_roleA'])[day], undefined, '清空后当天记录被移除');
});

test('纪念日：拒绝非法日期，接受合法日期并按日期排序', () => {
  const store = makeStore();
  const r = makeRuntime({ store, phoneStorage: phoneWith('roleA') });
  const form = r.get('eventForm');
  const name = r.get('eventName');
  const date = r.get('eventDate');

  name.value = '第一次聊天';
  date.value = '不是日期';
  form._h.submit({ preventDefault() {}, target: form });
  assert.equal(store.raw['maoer_anniversaries_roleA'], undefined, '非法日期不得写入');

  date.value = '2024-05-20';
  form._h.submit({ preventDefault() {}, target: form });
  assert.ok(store.raw['maoer_anniversaries_roleA']);
  const list = JSON.parse(store.raw['maoer_anniversaries_roleA']);
  assert.equal(list.length, 1);
  assert.equal(list[0].date, '2024-05-20');

  name.value = '更早的一天';
  date.value = '2020-01-01';
  form._h.submit({ preventDefault() {}, target: form });
  const html = r.get('eventList').innerHTML;
  assert.ok(html.indexOf('更早的一天') < html.indexOf('第一次聊天'), '列表要按日期升序');
});

test('纪念日：删除写失败时不从界面消失', () => {
  const store = makeStore();
  const r = makeRuntime({ store, phoneStorage: phoneWith('roleA') });
  r.get('eventName').value = '要删的一天';
  r.get('eventDate').value = '2024-05-20';
  r.get('eventForm')._h.submit({ preventDefault() {}, target: r.get('eventForm') });
  const list = JSON.parse(store.raw['maoer_anniversaries_roleA']);

  store.failWrites(true);
  /* 直接触发删除按钮逻辑：通过 innerHTML 上的 data-delete 值走事件委托 */
  const btn = { dataset: { delete: list[0].id }, closest: (s) => (s === '[data-delete]' ? btn : null) };
  r.get('eventList')._h.click({ target: btn });
  assert.equal(JSON.parse(store.raw['maoer_anniversaries_roleA']).length, 1, '删除失败不能丢数据');
  assert.ok(r.get('eventList').innerHTML.includes('要删的一天'));

  store.failWrites(false);
  r.get('eventList')._h.click({ target: btn });
  assert.equal(JSON.parse(store.raw['maoer_anniversaries_roleA']).length, 0);
});

test('源码守卫：不再直写 localStorage、绑定共享角色、不引入付费调用', () => {
  assert.equal(/localStorage\.setItem\(KEY_[QE]/.test(script), false, '必须走统一的写入封装');
  assert.ok(script.includes('PhoneStorage'), '必须优先读共享当前角色');
  assert.ok(script.includes("getCurrentContactId"), '要按正式角色绑定');
  assert.equal(/fetch\(|PhoneAPI|chat\/completions/.test(script), false, '这个页面不应有任何付费/网络调用');
  assert.equal(/Made by|作者：/.test(page), false, 'no developer signature');
});
