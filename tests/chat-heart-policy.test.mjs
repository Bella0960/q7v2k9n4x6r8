import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const source = read('shared/js/phone/chat-heart-policy.js');

function createPolicy() {
  const sandbox = { window: {}, Date, JSON, Array, String, Number, Math, encodeURIComponent, isFinite };
  runInNewContext(source, sandbox);
  return sandbox.window.ChatHeartPolicy;
}

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    data
  };
}

test('heart markers are extracted without changing ordinary reply text', () => {
  const policy = createPolicy();
  const parsed = policy.extractMarkers('先回答你。\n[心声:其实我还在想这件事。]\n[心声：有一点在意。]');
  assert.equal(parsed.text, '先回答你。');
  assert.deepEqual(Array.from(parsed.hearts), ['其实我还在想这件事。', '有一点在意。']);
  assert.deepEqual(Array.from(policy.extractMarkers('普通回复').hearts), []);
});

test('heart storage keys isolate both conversation and speaker identities', () => {
  const policy = createPolicy();
  const first = policy.storageKey({ conversationId: 'group-1', speakerId: 'role-a', isGroupChat: true });
  const second = policy.storageKey({ conversationId: 'group-1', speakerId: 'role-b', isGroupChat: true });
  const third = policy.storageKey({ conversationId: 'group-2', speakerId: 'role-a', isGroupChat: true });
  assert.notEqual(first, second);
  assert.notEqual(first, third);
  assert.equal(policy.storageKey({ conversationId: 'group-1', speakerId: 'group-1', isGroupChat: true }), '');
});

test('v2 storage keys avoid separator collisions and ambiguous v1 histories fail closed', () => {
  const policy = createPolicy();
  const first = { conversationId: 'a_b', speakerId: 'c', isGroupChat: true };
  const second = { conversationId: 'a', speakerId: 'b_c', isGroupChat: true };
  assert.notEqual(policy.storageKey(first), policy.storageKey(second));

  const legacyKey = 'chat_heart_history_v1_a_b_c';
  const legacyRecords = [{
    id: 'old-a',
    text: 'A 的旧心声',
    createdAt: 100,
    conversationId: 'a_b',
    speakerId: 'c'
  }];
  const storage = makeStorage({ [legacyKey]: JSON.stringify(legacyRecords) });

  assert.equal(policy.getLatest(storage, first).record.text, 'A 的旧心声');
  const ambiguous = policy.getLatest(storage, second);
  assert.equal(ambiguous.record, null);
  assert.equal(ambiguous.code, 'legacy_ambiguous');

  assert.equal(policy.appendHearts(storage, second, ['B 的新心声'], 200).ok, true);
  assert.equal(storage.getItem(legacyKey), JSON.stringify(legacyRecords));
  assert.equal(policy.getLatest(storage, first).record.text, 'A 的旧心声');
  assert.equal(policy.getLatest(storage, second).record.text, 'B 的新心声');
});

test('v1 history without explicit owner IDs is not assigned to a speaker', () => {
  const policy = createPolicy();
  const options = { conversationId: 'group_1', speakerId: 'member_2', isGroupChat: true };
  const key = 'chat_heart_history_v1_group_1_member_2';
  const storage = makeStorage({
    [key]: JSON.stringify([{ id: 'legacy-unknown', text: '归属不明', createdAt: 100 }])
  });
  const result = policy.getLatest(storage, options);
  assert.equal(result.ok, true);
  assert.equal(result.code, 'legacy_ambiguous');
  assert.equal(result.record, null);
});

test('group members keep separate histories and never read the ambiguous legacy group key', () => {
  const policy = createPolicy();
  const storage = makeStorage({ 'latest_heart_group-1': '旧群心声，归属不明' });
  const a = { conversationId: 'group-1', speakerId: 'role-a', isGroupChat: true };
  const b = { conversationId: 'group-1', speakerId: 'role-b', isGroupChat: true };
  assert.equal(policy.getLatest(storage, a).record, null);
  assert.equal(policy.getLatest(storage, b).record, null);
  assert.equal(policy.appendHearts(storage, a, ['A 的想法'], 1000).ok, true);
  assert.equal(policy.appendHearts(storage, b, ['B 的想法'], 2000).ok, true);
  assert.equal(policy.getLatest(storage, a).record.text, 'A 的想法');
  assert.equal(policy.getLatest(storage, b).record.text, 'B 的想法');
  assert.equal(storage.getItem('latest_heart_group-1'), '旧群心声，归属不明');
});

test('direct chats retain read compatibility with the old latest-heart key', () => {
  const policy = createPolicy();
  const storage = makeStorage({ 'latest_heart_role-1': '旧版心声' });
  const result = policy.getLatest(storage, {
    conversationId: 'role-1', speakerId: 'role-1', legacyRoleId: 'role-1'
  });
  assert.equal(result.ok, true);
  assert.equal(result.record.text, '旧版心声');
  assert.equal(result.record.createdAt, 0);
});

test('heart history is bounded and writes are verified before success is returned', () => {
  const policy = createPolicy();
  const storage = makeStorage();
  const options = { conversationId: 'role-1', speakerId: 'role-1', legacyRoleId: 'role-1' };
  for (let i = 0; i < 27; i++) {
    assert.equal(policy.appendHearts(storage, options, ['心声 ' + i], 1000 + i).ok, true);
  }
  const result = policy.readHistory(storage, options);
  assert.equal(result.records.length, 24);
  assert.equal(result.records[0].text, '心声 3');
  assert.equal(result.records[result.records.length - 1].text, '心声 26');
});

test('failed storage writes and corrupted records fail closed without claiming success', () => {
  const policy = createPolicy();
  const blocked = {
    getItem() { return null; },
    setItem() { throw new Error('quota'); }
  };
  const options = { conversationId: 'role-1', speakerId: 'role-1' };
  assert.equal(policy.appendHearts(blocked, options, ['不会保存'], 1000).code, 'write');

  const corrupted = makeStorage();
  corrupted.setItem(policy.storageKey(options), '{broken');
  const result = policy.appendHearts(corrupted, options, ['不覆盖损坏数据'], 1000);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'corrupt');
  assert.equal(corrupted.getItem(policy.storageKey(options)), '{broken');
});

test('heart prompt is optional, persona-bound, and isolates group speakers', () => {
  const policy = createPolicy();
  const prompt = policy.buildPrompt({ isGroupChat: true });
  assert.match(prompt, /不是每轮必需/);
  assert.match(prompt, /角色人设、世界书、记忆/);
  assert.match(prompt, /每位成员的心声必须彼此隔离/);
  assert.match(prompt, /不得变成对用户的要求/);
});

test('chat detail wires speaker identity, verified saves, scoped reads, and the heart prompt', () => {
  const detail = read('chat/chat/chat-detail.html');
  const serviceWorker = read('sw.js');
  const packageJson = JSON.parse(read('package.json'));
  assert.ok(detail.includes('chat-heart-policy.js?v=20261126mind1'));
  assert.match(detail, /row\.dataset\.memberId\s*=\s*String\(msg\.memberId\)/);
  assert.match(detail, /streamResult\.ok\s*&&\s*replySaved\s*&&\s*fullText\s*&&\s*parsedHeart\.hearts\.length/);
  assert.match(detail, /ChatHeartPolicy\.appendHearts/);
  assert.match(detail, /ChatHeartPolicy\.readHistory/);
  assert.match(detail, /ChatHeartPolicy\.buildPrompt/);
  assert.ok(serviceWorker.includes('chat-heart-policy.js?v=20261126mind1'));
  assert.ok(Number(serviceWorker.match(/phone-app-pwa-v(\d+)/)?.[1]) >= 206);
  assert.ok(packageJson.scripts['test:chat:contract'].includes('tests/chat-heart-policy.test.mjs'));
});
