import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* MUSIC-LISTEN-TOGETHER-001 · 和 TA 一起听（同设备伴听 · 默认关闭 · 付费护栏）
 * 从 music/music.html 截取真实实现，在隔离上下文跑：
 * 不开零调用、每首 1 次、间隔 3 分钟、每日 10 次、切角色/关闭/后台丢弃旧结果、无接口本地兜底。
 * 全程 mock，不产生真实付费请求。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(resolve(root, 'music/music.html'), 'utf8');

const block = (() => {
  const start = page.indexOf('  /* ===== 和 TA 一起听（同设备本地伴听');
  const end = page.indexOf('  // ===== 断点续播 =====', start);
  assert.ok(start > 0 && end > start, 'listen-together block not found');
  return page.slice(start, end);
})();

/* 注释里会提到 timeupdate / PhoneContext 这类词，判定必须只看代码 */
const codeOnly = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ROLES = [
  { id: 'roleA', name: '阿岚', personality: '温柔', speechStyle: '轻声' },
  { id: 'roleB', name: '白露', personality: '安静' },
];
const TRACKS = [
  { id: 't1', name: '雨夜书简', artist: 'Brambles' },
  { id: 't2', name: '半糖', artist: '未眠' },
];

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

function makeRuntime({ store, apiKey = 'test-key', behavior = 'resolve', rawReply = '这首我也很喜欢。' } = {}) {
  const toasts = [];
  const calls = [];
  const prompts = [];
  const els = {};
  const makeEl = (id) => ({
    id, textContent: '', innerHTML: '', className: '',
    children: [],
    classList: { _on: false, add() { this._on = true; }, remove() { this._on = false; }, toggle(v) { this._on = !!v; }, contains() { return this._on; } },
    addEventListener() {},
    insertBefore() {},
    removeChild() {},
  });
  const sandbox = {
    localStorage: store,
    tracks: TRACKS,
    currentIdx: 0,
    playing: false,
    document: {
      hidden: false,
      getElementById: (id) => (els[id] = els[id] || makeEl(id)),
      createElement: (tag) => makeEl(tag),
      addEventListener: (ev, fn) => { sandbox.__docHandlers = sandbox.__docHandlers || {}; sandbox.__docHandlers[ev] = fn; },
    },
    toast: (t) => toasts.push(t),
    getTrackById: (id) => TRACKS.find((t) => t.id === id) || null,
    setTimeout, clearTimeout,
    JSON, Object, String, Number, Array, Math, Date, Promise, Error, console,
    esc: (v) => String(v == null ? '' : v),
  };
  sandbox.window = sandbox;
  sandbox.PhoneStorage = { getCharacters: () => ROLES, getApiConfig: () => ({ apiKey }) };
  sandbox.PhoneAPI = {
    complete: (payload) => {
      calls.push(payload);
      prompts.push((payload.system || '') + '\n' + (payload.user || ''));
      if (behavior === 'reject') return Promise.reject(new Error('HTTP 500'));
      return Promise.resolve(rawReply);
    },
  };
  /* 原始播放器（被一起听包一层，用于验证同步） */
  sandbox.playTrack = function (trackId) {
    const t = sandbox.getTrackById(trackId);
    sandbox.currentIdx = TRACKS.indexOf(t);
    sandbox.playing = true;
    return Promise.resolve();
  };
  sandbox.togglePlay = function () {
    sandbox.playing = !sandbox.playing;
  };
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox);
  return { sb: sandbox, els, toasts, calls, prompts };
}

const flush = () => new Promise((r) => setTimeout(r, 10));

test('默认关闭：播放后 0 次调用', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  assert.equal(sb.together.enabled, false);
  await sb.playTrack('t1');
  await flush();
  assert.equal(calls.length, 0);
});

test('开启后一次请求，并显示角色短句', async () => {
  const store = makeStore();
  const { sb, calls, els } = makeRuntime({ store });
  sb.setTogetherEnabled(true);
  await sb.playTrack('t1');
  await flush();

  assert.equal(calls.length, 1, 'one generation per track');
  assert.ok(els.togetherLine.textContent.includes('阿岚：'), 'line must be attributed to the chosen role');
  assert.ok(els.togetherLine.textContent.includes('这首我也很喜欢'));
});

test('不开启就没有任何付费请求，但播放器照常工作', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  await sb.playTrack('t2');
  sb.togglePlay();
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(sb.currentIdx, 1, 'player still switches tracks');
});

test('每首最多 1 次：重复播放同一首不再请求', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  sb.setTogetherEnabled(true);
  await sb.playTrack('t1');
  await flush();
  await sb.playTrack('t1');
  await flush();
  assert.equal(calls.length, 1);
});

test('间隔不足 3 分钟：换歌也不请求', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  sb.setTogetherEnabled(true);
  await sb.playTrack('t1');
  await flush();
  sb.lastAtCheck = true;
  await sb.playTrack('t2');
  await flush();
  assert.equal(calls.length, 1, 'must respect the 3-minute window');
});

test('每日 10 次上限：用完后 0 请求', async () => {
  const day = new Date();
  const key = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
  const store = makeStore({ maomao_music_together_v1: JSON.stringify({ day: key, used: 10, enabled: true, roleId: 'roleA' }) });
  const { sb, calls } = makeRuntime({ store });
  sb.together.enabled = true;
  sb.together.roleId = 'roleA';
  await sb.playTrack('t1');
  await flush();
  assert.equal(calls.length, 0);
});

test('无接口：0 次调用，走本地短句兜底', async () => {
  const store = makeStore();
  const { sb, calls, els } = makeRuntime({ store, apiKey: '' });
  sb.setTogetherEnabled(true);
  await sb.playTrack('t1');
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(sb.together.degraded, true);
  assert.ok(els.togetherLine.textContent.includes('：'), 'local fallback line shown');
});

test('请求失败：不重试，降级本地短句', async () => {
  const store = makeStore();
  const { sb, calls, els } = makeRuntime({ store, behavior: 'reject' });
  sb.setTogetherEnabled(true);
  await sb.playTrack('t1');
  await flush();
  assert.equal(calls.length, 1, 'no silent retry');
  assert.equal(sb.together.degraded, true);
  assert.ok(els.togetherLine.textContent.includes('：'));
});

test('切角色：旧结果丢弃，不串到新角色', async () => {
  const store = makeStore();
  const { sb, els } = makeRuntime({ store });
  sb.setTogetherEnabled(true);
  sb.togetherShowLine('基线');
  const before = els.togetherLine.textContent;

  const pending = sb.requestTogetherLine(TRACKS[0], '切到这首歌');
  sb.setTogetherRole('roleB');
  await pending;
  await flush();

  /* 换角色会清空显示区；关键是旧结果不能填进来 */
  assert.equal(els.togetherLine.textContent, '', 'display must be cleared for the new role');
  assert.equal(els.togetherLine.textContent.includes('这首我也很喜欢'), false, 'stale line must not leak to the new role');
  assert.equal(before, '基线');
  assert.equal(sb.together.roleId, 'roleB');
});

test('关闭模式：进行中的结果丢弃', async () => {
  const store = makeStore();
  const { sb, els } = makeRuntime({ store });
  sb.setTogetherEnabled(true);
  sb.togetherShowLine('基线');
  const before = els.togetherLine.textContent;

  const pending = sb.requestTogetherLine(TRACKS[1], '切到这首歌');
  sb.setTogetherEnabled(false);
  await pending;
  await flush();
  assert.equal(els.togetherLine.textContent, before);
});

test('切后台：不发新请求', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  sb.setTogetherEnabled(true);
  sb.together.lastAt = 0;
  sb.document.hidden = true;
  sb.togetherOnTrackChange(TRACKS[1], '切到这首歌');
  await flush();
  assert.equal(calls.length, 0);
});

test('不监听 timeupdate：绝不会逐秒调用', () => {
  assert.equal(/timeupdate/.test(codeOnly), false, 'listen-together must not hook timeupdate');
  assert.ok(codeOnly.includes('__togetherPlayTrack'), 'must hook track change');
  assert.ok(codeOnly.includes('__togetherTogglePlay'), 'must hook play/pause');
});

test('只发文字：不上传音频/Blob/密钥，也不引入 PhoneContext', async () => {
  const store = makeStore();
  const { sb, prompts } = makeRuntime({ store });
  sb.setTogetherEnabled(true);
  await sb.playTrack('t1');
  await flush();

  assert.equal(prompts.length, 1);
  assert.equal(/PhoneContext/.test(codeOnly), false, 'must not use the unsafe shared context');
  assert.equal(/blob|base64|data:audio|apiKey/i.test(prompts[0]), false, 'prompt must not carry audio or keys');
  assert.ok(prompts[0].includes('雨夜书简'), 'track title is sent as text');
});

test('预算先记账：失败也占用当日额度', async () => {
  const store = makeStore();
  const { sb } = makeRuntime({ store, behavior: 'reject' });
  sb.setTogetherEnabled(true);
  await sb.playTrack('t1');
  await flush();
  assert.equal(JSON.parse(store.raw.maomao_music_together_v1).used, 1);
});

test('源码守卫：默认关闭、护栏常量、面板与安全区', () => {
  assert.ok(page.includes('var TOGETHER_DAILY_LIMIT = 10;'));
  assert.ok(page.includes('var TOGETHER_MIN_INTERVAL = 3 * 60 * 1000;'));
  assert.ok(page.includes('enabled: false'), 'must default to off');
  assert.ok(page.includes('env(safe-area-inset-bottom)'), 'bottom sheet must respect the safe area');
  assert.ok(page.includes('id="togetherBtn"'), 'compact entry in the mini player');
  assert.equal(/Made by|dev signature|作者：/.test(page), false, 'no developer signature');
});

test('资料保存：部分失败时回滚，不留下半截昵称', () => {
  const start = page.indexOf('  function saveProfileEdit() {');
  const end = page.indexOf("  document.getElementById('musicImport')", start);
  const body = page.slice(start, end);
  assert.ok(body.includes('prev'), 'must capture previous values');
  assert.ok(body.includes('localStorage.removeItem(pair[0])'), 'must roll back to the previous values');
  assert.ok(body.includes('已保持原来的昵称与背景'), 'must tell the user nothing was changed');
});
