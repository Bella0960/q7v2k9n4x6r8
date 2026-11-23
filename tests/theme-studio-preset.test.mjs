import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('shared/js/theme-studio-runtime.js', root), 'utf8');

function boot(path = '/theme-studio/theme-studio.html', raw = null, throwOnSet = false) {
  const memory = new Map();
  if (raw !== null) memory.set('maomao_theme_studio_v1', JSON.stringify(raw));
  const attributes = new Map(), styles = new Map();
  const shell = {
    setAttribute(k, v) { attributes.set(k, v); },
    removeAttribute(k) { attributes.delete(k); },
    style: { setProperty(k, v) { styles.set(k, v); }, removeProperty(k) { styles.delete(k); } }
  };
  const global = {
    location: { pathname: path },
    localStorage: {
      getItem(k) { return memory.get(k) ?? null; },
      setItem(k, v) { if (throwOnSet) throw new Error('QuotaExceededError'); memory.set(k, String(v)); }
    },
    document: { readyState: 'complete', querySelector(s) { return s === '.phone-mockup' ? shell : null; } },
    addEventListener() {}
  };
  global.window = global;
  vm.runInNewContext(source, global);
  return { api: global.MAOMAOThemeStudio, attributes, styles, memory, global };
}

const VALID_ASSET = 'as_' + 'A'.repeat(32);

test('legacy bubble preset without scope reads back as null and keeps its values', () => {
  const app = boot(null, {
    v: 1, enabled: { list: false, detail: false }, list: {}, detail: {}, updatedAt: 0,
    presets: [{ id: 'old-1', name: '旧方案', tab: 'bubble', values: { myBubbleBg: '#222222' } }]
  });
  const back = app.api.read();
  assert.equal(back.presets.length, 1);
  assert.equal(back.presets[0].id, 'old-1');
  assert.equal(back.presets[0].name, '旧方案');
  assert.equal(back.presets[0].tab, 'bubble');
  assert.equal(back.presets[0].scope, null);
  assert.equal(back.presets[0].values.myBubbleBg, '#222222');
});

test('bubble preset keeps allowlisted scope; list/detail and invalid scope are dropped', () => {
  const app = boot(null, {
    v: 1, enabled: { list: false, detail: false }, list: {}, detail: {}, updatedAt: 0,
    presets: [
      { id: 'b-global', name: '全局泡', tab: 'bubble', scope: 'global', values: { myBubbleBg: '#111111' } },
      { id: 'b-role', name: '角色泡', tab: 'bubble', scope: 'role-a', values: { myBubbleBg: '#333333' } },
      { id: 'l-1', name: '列表', tab: 'list', scope: 'role-a', values: { itemRadius: 12 } },
      { id: 'bad-obj', name: '对象scope', tab: 'bubble', scope: { x: 1 }, values: { myBubbleBg: '#444444' } },
      { id: 'bad-num', name: '数字scope', tab: 'bubble', scope: 7, values: { myBubbleBg: '#555555' } },
      { id: 'bad-empty', name: '空串scope', tab: 'bubble', scope: '   ', values: { myBubbleBg: '#666666' } }
    ]
  });
  const byId = Object.fromEntries(boot(null, JSON.parse(app.memory.get(app.api.KEY))).api.read().presets.map(p => [p.id, p]));
  assert.equal(byId['b-global'].scope, 'global');
  assert.equal(byId['b-role'].scope, 'role-a');
  assert.equal(byId['l-1'].scope, null);
  assert.equal(byId['bad-obj'].scope, null);
  assert.equal(byId['bad-num'].scope, null);
  assert.equal(byId['bad-empty'].scope, null);
});

test('list/detail preset persists valid assetIds; unsafe image refs are rejected', () => {
  const app = boot();
  const state = app.api.read();
  state.presets = [
    { id: 'list-cover', name: '封面方案', tab: 'list', values: { itemRadius: 16, coverImage: VALID_ASSET, listImage: 'data:image/png;base64,AAAAAAAA' } },
    { id: 'detail-bg', name: '背景方案', tab: 'detail', values: { chatPadding: 12, chatImage: 'https://example.test/image.png' } }
  ];
  assert.equal(app.api.save(state), true);
  const back = boot(null, JSON.parse(app.memory.get(app.api.KEY))).api.read();
  const byId = Object.fromEntries(back.presets.map(p => [p.id, p]));
  assert.equal(byId['list-cover'].values.coverImage, VALID_ASSET);
  assert.equal(byId['list-cover'].values.listImage, '');
  assert.equal(byId['detail-bg'].values.chatImage, '');
  assert.equal(byId['list-cover'].values.itemRadius, 16);
  assert.equal(byId['detail-bg'].values.chatPadding, 12);
  assert.ok(!app.memory.get(app.api.KEY).includes('data:image'));
});

test('two presets with the same name keep distinct stable ids; update/delete target by id', () => {
  const app = boot();
  const state = app.api.read();
  state.presets = [
    { id: 'same-1', name: '方案甲', tab: 'list', values: { itemRadius: 10 } },
    { id: 'same-2', name: '方案甲', tab: 'list', values: { itemRadius: 18 } }
  ];
  assert.equal(app.api.save(state), true);
  const back = app.api.read();
  assert.equal(back.presets.length, 2);
  const byId = Object.fromEntries(back.presets.map(p => [p.id, p]));
  assert.equal(byId['same-1'].name, '方案甲');
  assert.equal(byId['same-2'].name, '方案甲');
  assert.notEqual(byId['same-1'].id, byId['same-2'].id);
  assert.equal(byId['same-1'].values.itemRadius, 10);
  assert.equal(byId['same-2'].values.itemRadius, 18);
});

test('presets are capped at 20', () => {
  const app = boot();
  const state = app.api.read();
  for (let i = 0; i < 25; i++) state.presets.push({ id: 'p' + i, name: '方案' + i, tab: 'list', values: { itemRadius: 10 } });
  assert.equal(app.api.save(state), true);
  assert.equal(boot(null, JSON.parse(app.memory.get(app.api.KEY))).api.read().presets.length, 20);
});

test('a rejected write returns false and leaves the previously stored data intact', () => {
  const good = boot();
  const base = good.api.read();
  base.presets = [{ id: 'keep-1', name: '保留方案', tab: 'list', values: { itemRadius: 14 } }];
  assert.equal(good.api.save(base), true);
  const before = good.memory.get(good.api.KEY);

  const failed = boot(null, JSON.parse(before), true);
  const draft = failed.api.read();
  draft.presets.push({ id: 'drop-1', name: '不应写入', tab: 'list', values: { itemRadius: 20 } });
  assert.equal(failed.api.save(draft), false);
  assert.equal(failed.memory.get(failed.api.KEY), before, 'failed write must not overwrite the previous store');

  const restored = boot(null, JSON.parse(before)).api.read();
  assert.equal(restored.presets.length, 1);
  assert.equal(restored.presets[0].id, 'keep-1');
  assert.equal(restored.presets[0].values.itemRadius, 14);
});

test('normalize never mutates an existing preset entry when a save-as adds a new copy', () => {
  // UI-level: cross-scope update must create a new entry for the current scope and
  // leave the source id/values/scope untouched. Runtime only re-normalizes the list;
  // this contract verifies an untouched source entry round-trips unchanged.
  const app = boot();
  const state = app.api.read();
  state.presets = [
    { id: 'role-a-p', name: 'A 的泡', tab: 'bubble', scope: 'role-a', values: { myBubbleBg: '#333333' } },
    { id: 'role-b-copy', name: 'B 副本', tab: 'bubble', scope: 'role-b', values: { myBubbleBg: '#222222' } }
  ];
  assert.equal(app.api.save(state), true);
  const back = app.api.read();
  const a = back.presets.find(p => p.id === 'role-a-p');
  assert.equal(a.scope, 'role-a');
  assert.equal(a.values.myBubbleBg, '#333333');
  assert.equal(back.presets.length, 2);
});
