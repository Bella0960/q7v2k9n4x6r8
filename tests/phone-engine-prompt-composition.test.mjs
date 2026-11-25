import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../shared/js/phone/phone_engine.js', import.meta.url), 'utf8');

function harness(roles = [{ id: 'r1' }]) {
  const calls = [], reads = [];
  const defs = [
    { id: 'notes', name: '笔记', prompt: 'NOTES_RULE', jsonSchema: '{"items":[]}' },
    { id: 'weather', name: '天气', prompt: 'WEATHER_RULE', jsonSchema: '{"weather":""}' }
  ];
  const window = {
    PhoneStorage: { getCurrentContactId: () => 'r1', getCharacters: () => roles },
    PhoneContext: { buildPhoneRoleContext: (id, app) => { reads.push([id, app]); return 'CONTEXT_SAMPLE'; } },
    PhoneApps: { get: id => defs.find(a => a.id === id), list: () => defs },
    PhoneAPI: { completeJSON: async request => { calls.push(request); return { ok: true, data: { items: [] } }; } }
  };
  new Function('window', source)(window);
  return { engine: window.PhoneEngine, calls, reads, defs };
}
test('single app uses only its own registry instructions and separates context', async () => {
  const h = harness();
  assert.equal((await h.engine.refreshApp({ appId: 'notes' })).ok, true);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.reads, [['r1', 'notes']]);
  const request = h.calls[0];
  assert.match(request.system, /NOTES_RULE/);
  assert.doesNotMatch(request.system, /WEATHER_RULE|CONTEXT_SAMPLE/);
  assert.match(request.user, /CONTEXT_SAMPLE/);
});
test('bundle includes each registered instruction once in one request', async () => {
  const h = harness();
  await h.engine.refreshAll({});
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.reads, [['r1', null]]);
  const system = h.calls[0].system;
  assert.equal(system.split('NOTES_RULE').length, 2);
  assert.equal(system.split('WEATHER_RULE').length, 2);
  assert.ok(system.includes('["notes","weather"]'));
});
test('missing role stops context collection and request', async () => {
  const h = harness([{ id: 'r2' }]);
  await assert.rejects(h.engine.refreshApp({ appId: 'notes' }), /角色不存在/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.reads.length, 0);
});
test('unknown app stops context collection and request', async () => {
  const h = harness();
  await assert.rejects(h.engine.refreshApp({ appId: 'unknown' }), /未注册/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.reads.length, 0);
});
test('duplicate role identity stops bundle generation', async () => {
  const h = harness([{ id: 'r1' }, { id: 'r1' }]);
  await assert.rejects(h.engine.refreshAll(), /身份不明确/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.reads.length, 0);
});
test('pure composition produces stable system instructions as context changes', () => {
  const h = harness();
  const a = h.engine.buildGenerationRequest('A', h.defs, true);
  const b = h.engine.buildGenerationRequest('B', h.defs, true);
  assert.equal(a.system, b.system);
  assert.notEqual(a.user, b.user);
  assert.equal(h.calls.length, 0);
});
test('duplicate app IDs fail closed', () => {
  const h = harness();
  assert.throws(() => h.engine.buildGenerationRequest('A', [h.defs[0], h.defs[0]], true), /配置无效/);
});
test('missing schema fails closed', () => {
  const h = harness();
  assert.throws(() => h.engine.buildGenerationRequest('A', [{ id: 'notes' }], false), /配置无效/);
});
test('missing context fails closed', () => {
  const h = harness();
  assert.throws(() => h.engine.buildGenerationRequest(' ', h.defs, true), /上下文不可用/);
});
