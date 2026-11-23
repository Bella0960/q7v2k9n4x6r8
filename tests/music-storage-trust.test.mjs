import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-MUSIC-001 · 音乐应用提示与本地写入契约
 * 页面原本调用 toast(...) 却没有定义：提示看不见还会抛 ReferenceError 打断播放。
 * 这里跑真实实现验证：toast 可用、写入失败可检测、昵称编辑不会谎报成功。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(resolve(root, 'music/music.html'), 'utf8');

function slice(from, to) {
  const start = page.indexOf(from);
  const end = page.indexOf(to, start);
  assert.ok(start > 0 && end > start, `cannot slice ${from}`);
  return page.slice(start, end);
}

const toastBlock = slice('  var musicToastTimer = null;', '  function removeTrackFromRecent(');
const listBlock = slice('  function saveRecentIds(ids) {', '  function removeTrackFromRecent(');
const profileBlock = slice('  function persistProfileFields(fields) {', "  document.getElementById('musicImport')");

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

function makeSandbox({ store, fields = {} }) {
  const created = [];
  const appended = [];
  const sandbox = {
    localStorage: store,
    LOCAL_TRACKS_KEY: 'music_local_tracks_meta',
    JSON,
    Object,
    String,
    Number,
    Array,
    Math,
    Date,
    clearTimeout,
    setTimeout,
    document: {
      getElementById: (id) => fields[id] || null,
      createElement: (tag) => {
        const el = {
          tag,
          id: '',
          className: '',
          textContent: '',
          classList: { _on: false, add() { this._on = true; }, remove() { this._on = false; }, contains() { return this._on; } },
        };
        created.push(el);
        return el;
      },
      body: { appendChild: (el) => appended.push(el) },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(toastBlock + '\n' + listBlock, sandbox);
  return { sb: sandbox, fields, created, appended };
}

test('toast 现在有实现：能创建节点、写文案并自动收起', () => {
  const store = makeStore();
  const { sb, created, appended } = makeSandbox({ store });

  sb.toast('音频加载失败');
  const el = created.find((n) => n.id === 'musicToast');
  assert.ok(el, 'toast must create its own node');
  assert.equal(el.textContent, '音频加载失败');
  assert.equal(el.className, 'music-toast');
  assert.equal(el.classList._on, true, 'must become visible');
  assert.equal(appended.length, 1);
});

test('toast 复用同一个节点，连续提示不堆叠', () => {
  const store = makeStore();
  const fields = { musicToast: { id: 'musicToast', textContent: '', classList: { _on: false, add() { this._on = true; }, remove() { this._on = false; } } } };
  const { sb, created } = makeSandbox({ store, fields });

  sb.toast('第一条');
  sb.toast('第二条');
  assert.equal(created.length, 0, 'must reuse the existing node');
  assert.equal(fields.musicToast.textContent, '第二条');
});

test('saveLocal：成功返回 true，失败返回 false 且不抛异常', () => {
  const store = makeStore();
  const { sb } = makeSandbox({ store });

  assert.equal(sb.saveLocal('k', 'v'), true);
  assert.equal(store.raw.k, 'v');

  store.failWrites(true);
  assert.doesNotThrow(() => sb.saveLocal('k2', 'v2'));
  assert.equal(sb.saveLocal('k2', 'v2'), false);
});

test('写入失败只提示一次，不刷屏', () => {
  const store = makeStore();
  const toastCalls = [];
  const { sb } = makeSandbox({ store });
  sb.toast = (t) => toastCalls.push(t);

  store.failWrites(true);
  sb.saveLocal('a', '1');
  sb.saveLocal('b', '2');
  sb.saveLocal('c', '3');
  assert.equal(toastCalls.length, 1);
  assert.ok(toastCalls[0].includes('没能保存'));
});

test('quiet 写入失败不打扰，但仍返回 false', () => {
  const store = makeStore();
  const toastCalls = [];
  const { sb } = makeSandbox({ store });
  sb.toast = (t) => toastCalls.push(t);

  store.failWrites(true);
  assert.equal(sb.saveLocal('a', '1', true), false);
  assert.equal(toastCalls.length, 0);
});

test('saveFavIds / saveRecentIds 失败可检测', () => {
  const store = makeStore();
  const { sb } = makeSandbox({ store });
  sb.saveLocal = () => false;
  assert.equal(sb.saveFavIds(['a']), false);
  assert.equal(sb.saveRecentIds(['a']), false);
});

test('saveProfileEdit：三条写入失败时不关闭弹窗、不谎报保存', () => {
  const store = makeStore();
  const fields = {
    editName: { value: '  新昵称  ' },
    editHandle: { value: 'mao' },
    editBgCustom: { value: '' },
  };
  const calls = { render: 0, close: 0 };
  const { sb } = makeSandbox({ store, fields });
  sb.BG_PRESETS = [{ css: '#111' }];
  sb.selectedBg = 0;
  sb.renderProfile = () => { calls.render++; };
  sb.closeProfileEdit = () => { calls.close++; };
  sb.toast = () => {};
  vm.runInContext(profileBlock, sb);

  store.failWrites(true);
  sb.saveProfileEdit();
  assert.equal(calls.close, 0, 'edit sheet must stay open so the user can retry');
  assert.equal(calls.render, 0);

  store.failWrites(false);
  sb.saveProfileEdit();
  assert.equal(store.raw.music_profile_name, '新昵称');
  assert.equal(store.raw.music_profile_handle, '@mao');
  assert.equal(calls.close, 1);
});

test('个人资料三字段：第三项写失败时原三项全部回滚', () => {
  const store = makeStore({
    music_profile_name: '旧昵称', music_profile_handle: '@old', music_profile_bg: '#222'
  });
  const originalSet = store.setItem;
  let failed = false;
  store.setItem = (key, value) => {
    if (key === 'music_profile_bg' && !failed) {
      failed = true;
      throw new Error('QuotaExceededError');
    }
    return originalSet(key, value);
  };
  const fields = {
    editName: { value: '新昵称' },
    editHandle: { value: 'new' },
    editBgCustom: { value: '#eeeeee' }
  };
  const { sb } = makeSandbox({ store, fields });
  const calls = { render: 0, close: 0, warnings: [] };
  sb.BG_PRESETS = [{ css: '#111' }];
  sb.selectedBg = 0;
  sb.renderProfile = () => { calls.render++; };
  sb.closeProfileEdit = () => { calls.close++; };
  sb.toast = (msg) => calls.warnings.push(msg);
  vm.runInContext(profileBlock, sb);

  sb.saveProfileEdit();
  assert.equal(failed, true, 'third key must throw once to exercise partial rollback');
  assert.deepEqual({
    name: store.raw.music_profile_name,
    handle: store.raw.music_profile_handle,
    bg: store.raw.music_profile_bg,
  }, { name: '旧昵称', handle: '@old', bg: '#222' });
  assert.equal(calls.render, 0);
  assert.equal(calls.close, 0);
  assert.ok(calls.warnings.some((msg) => msg.includes('旧资料已恢复')));
});

test('源码守卫：toast 已定义，且播放计数/收藏计数不再裸写', () => {
  assert.ok(page.includes('function toast(text)'), 'toast must be defined');
  assert.ok(page.includes("id = 'musicToast'"), 'toast must own a node');
  assert.equal(page.includes("localStorage.setItem('music_played_count'"), false, 'played count must go through saveLocal');
  assert.equal(page.includes("localStorage.setItem('music_fav_count'"), false, 'fav count must go through saveLocal');
  assert.equal(page.includes("localStorage.setItem('music_profile_name'"), false, 'profile writes must go through saveLocal');
});
