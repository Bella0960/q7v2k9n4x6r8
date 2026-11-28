import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../settings/js/api-config-tools.js', import.meta.url), 'utf8');

function makeHarness(initial = {}, failKey = '') {
  const data = new Map(Object.entries(initial));
  const localStorage = {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) {
      if (key === failKey) throw new Error('QuotaExceededError');
      data.set(key, String(value));
    },
    removeItem(key) { data.delete(key); }
  };
  const window = { setTimeout, clearTimeout, confirm() { return false; } };
  const document = { getElementById() { return null; } };
  runInNewContext(source, { window, document, localStorage }, {
    filename: 'api-config-tools.js',
    timeout: 3000
  });
  return {
    api: window.ApiConfigTools,
    localStorage,
    snapshot() { return Object.fromEntries(data); }
  };
}
function backup(activeId, profiles) {
  return { app: 'maomao-api-profiles', schema: 1, activeId, profiles };
}
test('OpenAI host appends /v1 only if missing', () => {
  const api = makeHarness().api;
  assert.equal(api.normalizeBaseUrl('https://api.openai.com/'), 'https://api.openai.com/v1');
  assert.equal(api.normalizeBaseUrl('https://api.openai.com/v1'), 'https://api.openai.com/v1');
});
test('Gemini native base becomes the OpenAI-compatible Gemini endpoint', () => {
  const api = makeHarness().api;
  assert.equal(api.normalizeBaseUrl('https://generativelanguage.googleapis.com/v1beta'),
    'https://generativelanguage.googleapis.com/v1beta/openai');
});
test('known suffix is trimmed without changing custom proxy paths', () => {
  const api = makeHarness().api;
  assert.equal(api.normalizeBaseUrl('https://gateway.example/v1/chat/completions'),
    'https://gateway.example/v1');
  assert.equal(api.normalizeBaseUrl('https://gateway.example/private/v2/'),
    'https://gateway.example/private/v2');
});
test('export preserves separate keys, temperature zero, model and context budget', () => {
  const profiles = [
    { id: 'a', name: 'A', baseUrl: 'https://a.example/v1', apiKey: 'key-a', temperature: 0, memoryCount: 5 },
    { id: 'b', name: 'B', baseUrl: 'https://b.example/v1', apiKey: 'key-b', maxTokens: 512, memoryCount: 19 }
  ];
  const { api } = makeHarness({
    api_profiles_v1: JSON.stringify(profiles),
    api_active_profile: 'b'
  });
  const file = api.exportData();
  assert.equal(file.activeId, 'b');
  assert.equal(file.profiles[0].temperature, 0);
  assert.equal(file.profiles[0].apiKey, 'key-a');
  assert.equal(file.profiles[1].apiKey, 'key-b');
  assert.equal(file.profiles[1].memoryCount, 19);
  assert.equal(file.containsPlaintextKeys, true);
});
test('import accepts a versioned export without lossy conversion', () => {
  const { api } = makeHarness();
  const data = backup('a', [{ id: 'a', apiKey: 'key', temperature: 0, memoryCount: 1 }]);
  const parsed = api.decodeBackup(JSON.stringify(data));
  assert.equal(parsed.profiles[0].temperature, 0);
  assert.equal(parsed.profiles[0].memoryCount, 1);
});
test('unknown schema and duplicated IDs are rejected', () => {
  const { api } = makeHarness();
  assert.throws(() => api.decodeBackup(JSON.stringify({ ...backup('a', [{ id: 'a' }]), schema: 999 })));
  assert.throws(() => api.decodeBackup(JSON.stringify(backup('a', [{ id: 'a' }, { id: 'a' }]))));
});
test('invalid provider URLs and non-object records are rejected', () => {
  const { api } = makeHarness();
  assert.throws(() => api.decodeBackup(JSON.stringify(backup('a', [{ id: 'a', baseUrl: 'javascript:alert(1)' }]))));
  assert.throws(() => api.decodeBackup(JSON.stringify(backup('a', ['not a profile']))));
});
test('import merges without overwriting existing active profile and key', () => {
  const current = [{ id: 'a', apiKey: 'existing', name: 'Local' }];
  const originalMirror = { apiKey: 'existing', model: 'current-model', memoryCount: 12 };
  const { api, localStorage } = makeHarness({
    api_profiles_v1: JSON.stringify(current),
    api_active_profile: 'a',
    api_settings: JSON.stringify(originalMirror)
  });
  const count = api.mergeBackup(backup('a', [{ id: 'a', apiKey: 'imported', name: 'Imported' }]));
  const rows = JSON.parse(localStorage.getItem('api_profiles_v1'));
  assert.equal(count, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].apiKey, 'existing');
  assert.equal(rows[1].apiKey, 'imported');
  assert.notEqual(rows[1].id, 'a');
  assert.equal(localStorage.getItem('api_active_profile'), 'a');
  assert.equal(JSON.parse(localStorage.getItem('api_settings')).apiKey, 'existing');
});
test('fresh device import selects the source active profile', () => {
  const { api, localStorage } = makeHarness();
  api.mergeBackup(backup('b', [
    { id: 'a', apiKey: 'key-a' },
    { id: 'b', apiKey: 'key-b', temperature: 0, memoryCount: 8 }
  ]));
  const mirror = JSON.parse(localStorage.getItem('api_settings'));
  assert.equal(mirror.apiKey, 'key-b');
  assert.equal(mirror.temperature, 0);
  assert.equal(mirror.memoryCount, 8);
});
test('quota error rolls back prior writes', () => {
  const old = {
    api_profiles_v1: JSON.stringify([{ id: 'a', apiKey: 'old' }]),
    api_active_profile: 'a',
    api_settings: '{"apiKey":"old"}'
  };
  const { api, snapshot } = makeHarness(old, 'api_active_profile');
  assert.throws(() => api.mergeBackup(backup('b', [{ id: 'b', apiKey: 'new' }])));
  assert.deepEqual(snapshot(), old);
});
test('corrupt local profiles fail closed without modifying user data', () => {
  const old = { api_profiles_v1: '{corrupt', api_settings: '{}' };
  const { api, snapshot } = makeHarness(old);
  assert.throws(() => api.mergeBackup(backup('b', [{ id: 'b', apiKey: 'new' }])));
  assert.deepEqual(snapshot(), old);
});
