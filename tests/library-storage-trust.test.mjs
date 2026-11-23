import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-LIBRARY-001 · 阅读应用写入可信性契约
 * 从 library/library.html 截取真实 saveReaderSettings / saveReaderComment，
 * 在隔离上下文跑真实实现：设置与段评写入失败都必须可检测、可读、不虚假成功。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(resolve(root, 'library/library.html'), 'utf8');

function slice(from, to) {
  const start = page.indexOf(from);
  const end = page.indexOf(to, start);
  assert.ok(start > 0 && end > start, `cannot slice ${from}`);
  return page.slice(start, end);
}

const settingsBlock = slice('  var settingsSaveWarned = false;', '  function readStoredBookFallback(');
const commentBlock = slice('  function saveReaderComment(comment) {', '  function getReaderRoles()');

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

function makeSandbox({ store, settings = {}, idbWorks = true, idbStore = {} }) {
  const toasts = [];
  const alerts = [];
  const sandbox = {
    localStorage: store,
    settings,
    READER_SETTINGS_KEY: 'maomao_reader_settings_v1',
    READER_BG_KEY: 'maomao_reader_bg_v1',
    READER_BG_MAX_CHARS: 1000,
    commentCache: Object.create(null),
    showToast: (m) => toasts.push(m),
    alert: (m) => alerts.push(m),
    idbPut: (name, value) => {
      if (!idbWorks) return Promise.reject(new Error('IndexedDB unavailable'));
      idbStore[name + ':' + value.id] = value;
      return Promise.resolve(value.id);
    },
    JSON,
    Object,
    String,
    Number,
    Array,
    Math,
    Date,
    Promise,
    Error,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(settingsBlock + '\n' + commentBlock, sandbox);
  return { sb: sandbox, toasts, alerts, idbStore };
}

test('设置写入成功：返回 true 且完整落盘', () => {
  const store = makeStore();
  const { sb, toasts } = makeSandbox({ store, settings: { bg: 2, fs: 18, lh: 1.9 } });
  assert.equal(sb.saveReaderSettings(), true);
  const saved = JSON.parse(store.raw.maomao_reader_settings_v1);
  assert.equal(saved.fs, 18);
  assert.equal(saved.lh, 1.9);
  assert.equal(toasts.length, 0);
});

test('设置写入失败：返回 false 并提示一次，不刷屏', () => {
  const store = makeStore();
  const { sb, toasts } = makeSandbox({ store, settings: { fs: 18 } });
  store.failWrites(true);

  assert.equal(sb.saveReaderSettings(), false);
  assert.equal(sb.saveReaderSettings(), false, 'repeat failure keeps returning false');
  assert.equal(sb.saveReaderSettings(), false);

  assert.equal(toasts.length, 1, 'warn only once per session, not on every slider move');
  assert.ok(toasts[0].includes('刷新后会回到上一次保存的设置'), 'warning must explain the consequence');
});

test('设置写入失败不影响背景图独立键的逻辑', () => {
  const store = makeStore();
  const { sb } = makeSandbox({ store, settings: { image: 'data:image/png;base64,AAA' } });
  store.failWrites(true);
  sb.saveReaderSettings();
  assert.equal('maomao_reader_bg_v1' in store.raw, false, 'failed write must not fake a stored background');
});

test('背景图超限：不写盘、给出尺寸原因', () => {
  const store = makeStore();
  const { sb, alerts } = makeSandbox({ store, settings: { image: 'x'.repeat(2000) } });
  sb.saveReaderSettings();
  assert.equal('maomao_reader_bg_v1' in store.raw, false);
  assert.equal(alerts.length, 1);
  assert.ok(alerts[0].includes('背景图过大'));
});

test('段评：IndexedDB 可用时直接写 IDB 并进缓存', async () => {
  const store = makeStore();
  const { sb, idbStore } = makeSandbox({ store });
  await sb.saveReaderComment({ id: 'b1|0|3|roleA', text: '写得好' });
  assert.ok(idbStore['comments:b1|0|3|roleA'], 'comment must be persisted to IDB');
  assert.equal(sb.commentCache['b1|0|3|roleA'].text, '写得好');
});

test('段评：IDB 不可用时回落 localStorage 并进缓存', async () => {
  const store = makeStore();
  const { sb } = makeSandbox({ store, idbWorks: false });
  await sb.saveReaderComment({ id: 'b1|0|4|roleA', text: '这一段很安静' });
  const saved = JSON.parse(store.raw.maomao_reader_comments_v1);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].text, '这一段很安静');
  assert.ok(sb.commentCache['b1|0|4|roleA'], 'cache must be updated after fallback write');
});

test('段评：两条路径都失败时抛出可读原因，且不污染缓存', async () => {
  const store = makeStore();
  const { sb } = makeSandbox({ store, idbWorks: false });
  store.failWrites(true);

  await assert.rejects(
    () => sb.saveReaderComment({ id: 'b1|0|5|roleA', text: '会失败' }),
    (err) => {
      assert.ok(!/QuotaExceeded/.test(err.message), 'must not surface the raw DOM exception name');
      assert.ok(err.message.includes('没能保存'), 'must give an actionable reason');
      return true;
    }
  );
  assert.equal('b1|0|5|roleA' in sb.commentCache, false, 'failed comment must not appear saved');
});

test('段评：同段同角色重写覆盖而不是重复堆积', async () => {
  const store = makeStore();
  const { sb } = makeSandbox({ store, idbWorks: false });
  await sb.saveReaderComment({ id: 'b1|0|6|roleA', text: '第一版' });
  await sb.saveReaderComment({ id: 'b1|0|6|roleA', text: '第二版' });
  const saved = JSON.parse(store.raw.maomao_reader_comments_v1);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].text, '第二版');
});

test('源码守卫：设置写入不再被空 catch 吞掉', () => {
  const line = page.split('\n').find((l) => l.includes('localStorage.setItem(READER_SETTINGS_KEY'));
  assert.ok(line, 'settings write line must exist');
  assert.equal(/catch\(e\)\{\s*\}/.test(line), false, 'settings write must not be silently swallowed');
  assert.ok(page.includes('if (!saved || (!backgroundSaved && !img)) warnSettingsSaveFailed();'), 'failure must surface to the user');
});
