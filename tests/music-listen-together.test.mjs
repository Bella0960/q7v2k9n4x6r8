import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* MUSIC-LISTEN-TOGETHER-001 · 和 TA 一起听（同设备伴听 · 默认关闭 · 付费护栏）
 * 从 music/music.html 截取真实实现，在隔离上下文跑。
 * 058 修复（总控 P1-01/02/03 + P2）：
 *   - 无 API 不扣次数、不占「这首歌一次」；配好 key 后同一首仍可触发
 *   - 预算落盘失败时按会话内单调计数 fail-closed，关掉再打开不能重置
 *   - 只有 audio 真的触发 playing、且仍是当前曲目才发请求（播放失败/缺 Blob → 0 次）
 *   - 资料改成单键原子写 + 读回校验，不再假报「已保持原资料」
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

function makeAudio() {
  const listeners = {};
  return {
    paused: true,
    currentTime: 0,
    src: '',
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
    listenerCount(ev) { return (listeners[ev] || []).length; },
    emit(ev) { (listeners[ev] || []).slice().forEach((fn) => fn()); },
    pause() { this.paused = true; this.emit('pause'); },
  };
}

/**
 * playMode 控制「真实播放是否成功」：
 *   'ok'     —— 和真实浏览器一致，异步加载完成后才触发 playing
 *   'blocked' —— 播放被拒/失败，永远不触发 playing（例如本地 Blob 缺失、自动播放被拦）
 *   'stale'  —— 先给一首触发 playing，随后被更晚的切歌覆盖
 */
function makeRuntime({ store, apiKey = 'test-key', behavior = 'resolve', rawReply = '这首我也很喜欢。', playMode = 'ok' } = {}) {
  const toasts = [];
  const calls = [];
  const prompts = [];
  const els = {};
  const audio = makeAudio();
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
    audio,
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
  /* 原始播放器（会被一起听包一层）。真机上 audio 的 playing 事件由浏览器在解出音频后发出，
     这里按 playMode 复现「异步才真正播起来」。 */
  sandbox.playTrack = function (trackId) {
    const t = sandbox.getTrackById(trackId);
    if (!t) return Promise.resolve();
    sandbox.currentIdx = TRACKS.indexOf(t);
    if (playMode === 'blocked') return Promise.resolve();          /* 加载失败/被拒：不 emit */
    sandbox.playing = true;
    audio.paused = false;
    if (playMode === 'ok') setTimeout(() => audio.emit('playing'), 0);
    return Promise.resolve();
  };
  sandbox.togglePlay = function () {
    if (sandbox.playing) { sandbox.playing = false; audio.paused = true; return; }
    sandbox.playing = true;
    audio.paused = false;
    if (playMode !== 'blocked') setTimeout(() => audio.emit('playing'), 0);
  };
  vm.createContext(sandbox);
  vm.runInContext(block, sandbox);
  return { sb: sandbox, els, toasts, calls, prompts, audio };
}

const flush = () => new Promise((r) => setTimeout(r, 20));

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

/* ---------- P1-01：没有可用 API 时不得扣次数、不得占名额 ---------- */

test('P1-01 无 API：0 次请求、不扣额度、不占用这首歌的唯一名额', async () => {
  const store = makeStore();
  const { sb, calls, els } = makeRuntime({ store, apiKey: '' });
  sb.setTogetherEnabled(true);
  await sb.playTrack('t1');
  await flush();

  assert.equal(calls.length, 0);
  assert.equal(sb.together.degraded, true, 'degraded 本地兜底');
  assert.ok(els.togetherLine.textContent.includes('：'), 'local fallback line shown');
  assert.equal(sb.togetherRemaining(), 10, '离线/无 key 不得消耗付费额度');
  assert.equal(JSON.parse(store.raw.maomao_music_together_v1 || '{}').used || 0, 0);
  assert.equal(sb.together.perRoleTrack['roleA|t1'], undefined, 'must not burn the per-track slot');
});

test('P1-01 续：无 key 之后配好 key，同一首歌仍可正常触发一次', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store, apiKey: '' });
  sb.setTogetherEnabled(true);
  await sb.playTrack('t1');
  await flush();
  assert.equal(calls.length, 0);

  sb.PhoneStorage.getApiConfig = () => ({ apiKey: 'later-key' });
  sb.together.lastAt = 0;
  await sb.playTrack('t1');
  await flush();

  assert.equal(calls.length, 1, '当前曲目在配置 API 后仍能伴听一次');
  assert.equal(sb.togetherRemaining(), 9);
});

/* ---------- P1-02：预算落盘失败必须 fail-closed ---------- */

test('P1-02 存储拒写：仍按会话内单调计数，最多只有 10 次真实请求', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  sb.setTogetherEnabled(true);
  store.failWrites(true);                 /* 配额已满：setItem 全部抛 QuotaExceededError */

  for (let i = 0; i < 14; i++) {
    sb.together.lastAt = 0;
    sb.requestTogetherLine({ id: 'x' + i, name: '曲' + i, artist: '人' }, '测试');
  }
  await flush();

  assert.equal(calls.length, 10, '写不进存储也必须停在每日上限');
  assert.equal(sb.togetherRemaining(), 0);
  assert.equal(sb.togetherSession.persistBroken, true, 'must surface the persistence failure');
});

test('P1-02 续：关掉再打开不会重置已消耗额度', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  sb.setTogetherEnabled(true);
  store.failWrites(true);

  for (let i = 0; i < 10; i++) {
    sb.together.lastAt = 0;
    sb.requestTogetherLine({ id: 'y' + i, name: '曲' + i, artist: '人' }, '测试');
  }
  await flush();
  assert.equal(calls.length, 10);

  sb.setTogetherEnabled(false);
  sb.setTogetherEnabled(true);
  sb.together.lastAt = 0;
  sb.requestTogetherLine({ id: 'z', name: '再来一首', artist: '人' }, '测试');
  await flush();

  assert.equal(calls.length, 10, '重开开关不得绕过每日上限');
  assert.equal(sb.togetherRemaining(), 0);
});

test('P1-02 续：开关不刷新「同一首」名额与 3 分钟间隔', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store });
  sb.setTogetherEnabled(true);
  await sb.playTrack('t1');
  await flush();
  assert.equal(calls.length, 1);

  sb.setTogetherEnabled(false);
  sb.setTogetherEnabled(true);
  await sb.playTrack('t1');
  await flush();

  assert.equal(calls.length, 1, '重开开关不能让同一首歌再讲一次');
});

/* ---------- P1-03：音频真的开始播放后才请求 ---------- */

test('P1-03 播放失败/被拒：0 次付费请求，也不扣额度', async () => {
  const store = makeStore();
  const { sb, calls } = makeRuntime({ store, playMode: 'blocked' });
  sb.setTogetherEnabled(true);
  await sb.playTrack('t1');
  await flush();

  assert.equal(calls.length, 0, '没有真的播起来就不能花钱');
  assert.equal(sb.togetherRemaining(), 10);
});

test('P1-03 续：快速切歌只按最终真正播放的那一首请求', async () => {
  const store = makeStore();
  const { sb, calls, prompts } = makeRuntime({ store });
  sb.setTogetherEnabled(true);
  await sb.playTrack('t1');
  await sb.playTrack('t2');
  await flush();

  assert.equal(calls.length, 1);
  assert.ok(prompts[0].includes('半糖'), '只允许最终曲目进入提示词');
});

test('P1-03 续：playing 事件之后才建监听——未播起时挂起的请求会被清理', async () => {
  const store = makeStore();
  const { sb, audio } = makeRuntime({ store, playMode: 'blocked' });
  sb.setTogetherEnabled(true);
  await sb.playTrack('t1');
  assert.equal(audio.listenerCount('playing'), 1, 'arm 了待发请求');
  sb.playTrack('t2');
  assert.equal(audio.listenerCount('playing'), 1, '旧监听必须被替换，不能叠加');
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

test('预算先记账：请求失败也占用当日额度', async () => {
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

/* ---------- P2：资料保存必须真实 ---------- */

test('P2 资料：单键原子写 + 读回校验，失败时如实说明没保存', () => {
  const start = page.indexOf('  function saveProfileEdit() {');
  const end = page.indexOf("  document.getElementById('musicImport')", start);
  const body = page.slice(start, end);
  assert.ok(body.includes('PROFILE_KEY'), '三条资料必须写进同一个键');
  assert.ok(body.includes('back === payload'), '必须读回校验');
  assert.equal(body.includes('removeItem(pair[0])'), false, '不再依赖可能同样失败的逐键回滚');
  assert.ok(body.includes('仍是原来的'), '失败时不得假报「已保持原资料」');
});

test('P2 资料：getProfile 优先读新键，旧键保持兼容；存储拒写时资料不变', () => {
  const getStart = page.indexOf('  function getProfile() {');
  const getEnd = page.indexOf('  function getSharedUserAvatar()', getStart);
  const getBody = page.slice(getStart, getEnd);
  assert.ok(getBody.includes('readProfileRecord()'), '读取优先新键');
  assert.ok(getBody.includes("music_profile_name"), '旧键仍作为兼容来源');

  /* 真实执行：写失败不能改动旧资料 */
  const store = makeStore({ music_profile_name: '老昵称', music_profile_handle: '@old' });
  const els = {};
  const makeEl = () => ({ value: '', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {} });
  const sandbox = {
    localStorage: store,
    document: {
      getElementById: (id) => (els[id] = els[id] || makeEl()),
      querySelector: () => makeEl(),
      addEventListener() {},
    },
    BG_PRESETS: [{ css: '#111', name: '纯黑' }],
    selectedBg: 0,
    toast() {},
    warnMusicStorage() {},
    renderProfile() {},
    closeProfileEdit() {},
    JSON, Object, String, Number, Array, Math, Date, console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const slice = page.slice(page.indexOf('  var PROFILE_KEY'), page.indexOf('  function getSharedUserAvatar()'));
  vm.runInContext(slice, sandbox);
  els.editName = Object.assign(makeEl(), { value: '新昵称' });
  els.editHandle = Object.assign(makeEl(), { value: 'newbie' });
  els.editBgCustom = Object.assign(makeEl(), { value: '#1a1a1a' });

  store.failWrites(true);
  vm.runInContext(page.slice(page.indexOf('  function saveProfileEdit() {'), page.indexOf("  document.getElementById('musicImport')")), sandbox);
  sandbox.saveProfileEdit();

  assert.equal(store.raw.music_profile_v2, undefined, '写失败不得留下半截数据');
  assert.equal(store.raw.music_profile_name, '老昵称', '旧资料必须原样保留');
  assert.equal(store.raw.music_profile_handle, '@old');

  store.failWrites(false);
  sandbox.saveProfileEdit();
  const rec = JSON.parse(store.raw.music_profile_v2);
  assert.equal(rec.name, '新昵称');
  assert.equal(rec.handle, '@newbie');
  assert.deepEqual({ ...sandbox.getProfile() }, { avatar: 'M', name: '新昵称', handle: '@newbie', bg: '#111' });
});
