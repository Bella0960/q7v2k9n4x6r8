import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the entire production PhoneStorage module, not a copied helper.
const storageSource = readFileSync('shared/js/phone/phone_storage.js', 'utf8');

function fixture(seed = {}, options = {}) {
  const data = { ...seed };
  const writes = [];
  const storage = {
    getItem(key) {
      if (options.readThrows && String(key).startsWith('chat_history_')) {
        throw new Error('storage read unavailable');
      }
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    setItem(key, value) {
      writes.push(key);
      if (options.quotaThrows && String(key).startsWith('chat_history_')) {
        const err = new Error('quota exhausted');
        err.name = 'QuotaExceededError';
        throw err;
      }
      if (options.dropWrites && String(key).startsWith('chat_history_')) return;
      data[key] = String(value);
      if (options.commitThenThrow && String(key).startsWith('chat_history_')) {
        if (options.commitThenReadThrows) options.readThrows = true;
        throw new Error('synthetic failure after commit');
      }
    },
    removeItem(key) { delete data[key]; }
  };
  const context = { window: {}, localStorage: storage, console: { warn() {} } };
  runInNewContext(storageSource, context, { filename: 'shared/js/phone/phone_storage.js', timeout: 2000 });
  const api = context.window.PhoneStorage;
  assert.ok(api && api.result, 'production module must load');
  return { api, data, writes };
}

const root = (a = 'stale A') => JSON.stringify({
  A: { chat: { history: [{ role: 'received', text: a }] } },
  B: { chat: { history: [{ role: 'received', text: 'untouched B' }] } }
});

test('corrupt JSON primary blocks legacy and result writers, preserving raw bytes and B', () => {
  const bytes = '{broken-json';
  const f = fixture({
    chat_history_A: bytes,
    phone_data_v2: root(),
    chat_history_B: '[{"role":"received","text":"B"}]'
  });
  assert.equal(f.api.getChatHistory('A').length, 0);
  assert.equal(f.api.getData('A', 'chat'), null);
  assert.equal(f.api.result.getChatHistory('A').error.code, 'CORRUPT_DATA');
  assert.equal(f.api.saveChatHistory('A', [{ text: 'new A' }]), false);
  assert.equal(f.api.result.saveChatHistory('A', [{ text: 'new A' }]).error.code, 'CORRUPT_DATA');
  assert.equal(f.data.chat_history_A, bytes);
  assert.equal(f.data.chat_history_B, '[{"role":"received","text":"B"}]');
  assert.equal(f.data.phone_data_v2, root());
  assert.equal(f.writes.filter((key) => key === 'chat_history_A').length, 0);
});

test('valid JSON with wrong shape does not fall back or overwrite', () => {
  const original = '{"history":[{"text":"real but wrong shape"}]}';
  const f = fixture({ chat_history_A: original, phone_data_v2: root() });
  assert.equal(f.api.getChatHistory('A').length, 0);
  assert.equal(f.api.result.getChatHistory('A').error.code, 'CORRUPT_DATA');
  assert.equal(f.api.saveChatHistory('A', []), false);
  assert.equal(f.api.result.saveChatHistory('A', []).error.code, 'CORRUPT_DATA');
  assert.equal(f.data.chat_history_A, original);
});

test('valid empty primary overrides legacy duplicate, both write facades verify updates', () => {
  const f = fixture({ chat_history_A: '[]', phone_data_v2: root() });
  assert.equal(f.api.getChatHistory('A').length, 0);
  assert.equal(f.api.saveChatHistory('A', [{ role: 'user', text: 'new A' }]), true);
  assert.equal(JSON.parse(f.data.chat_history_A)[0].text, 'new A');
  assert.equal(f.api.result.saveChatHistory('A', [{ role: 'user', text: 'next A' }]).ok, true);
  assert.equal(JSON.parse(f.data.chat_history_A)[0].text, 'next A');
  assert.equal(JSON.parse(f.data.phone_data_v2).A?.chat, undefined);
  assert.equal(JSON.parse(f.data.phone_data_v2).B.chat.history[0].text, 'untouched B');
});

test('missing primary retains legacy v2 recovery and migrates only after verified write', () => {
  const f = fixture({ phone_data_v2: root('old A') });
  assert.equal(f.api.getChatHistory('A')[0].text, 'old A');
  assert.equal(f.api.result.getChatHistory('A').value[0].text, 'old A');
  assert.equal(f.api.saveChatHistory('A', [{ text: 'saved A' }]), true);
  assert.equal(JSON.parse(f.data.chat_history_A)[0].text, 'saved A');
  assert.equal(JSON.parse(f.data.phone_data_v2).A?.chat, undefined);
  assert.equal(JSON.parse(f.data.phone_data_v2).B.chat.history[0].text, 'untouched B');
});

test('silently dropped writes are failures and must not delete legacy recovery copy', () => {
  const original = root();
  const f = fixture({ phone_data_v2: original }, { dropWrites: true });
  assert.equal(f.api.saveChatHistory('A', [{ text: 'not saved' }]), false);
  assert.equal(f.api.result.saveChatHistory('A', [{ text: 'not saved' }]).error.code, 'DB_UNAVAILABLE');
  assert.equal(f.data.chat_history_A, undefined);
  assert.equal(f.data.phone_data_v2, original);
});

test('read failures block both writers without overwriting data', () => {
  const f = fixture({ chat_history_A: '[{"text":"old"}]', phone_data_v2: root() }, { readThrows: true });
  assert.equal(f.api.getChatHistory('A').length, 0);
  assert.equal(f.api.result.getChatHistory('A').error.code, 'DB_UNAVAILABLE');
  assert.equal(f.api.saveChatHistory('A', [{ text: 'new' }]), false);
  assert.equal(f.api.result.saveChatHistory('A', [{ text: 'new' }]).error.code, 'DB_UNAVAILABLE');
  assert.equal(f.data.chat_history_A, '[{"text":"old"}]');
  assert.equal(f.writes.filter((key) => key === 'chat_history_A').length, 0);
});

test('quota exceptions are surfaced instead of reporting persistence success', () => {
  const f = fixture({ phone_data_v2: root() }, { quotaThrows: true });
  assert.equal(f.api.saveChatHistory('A', [{ text: 'new' }]), false);
  assert.equal(f.api.result.saveChatHistory('A', [{ text: 'new' }]).error.code, 'QUOTA_EXCEEDED');
  assert.equal(f.data.chat_history_A, undefined);
});

test('invalid outgoing list never becomes [] and cannot delete a conversation', () => {
  const original = '[{"text":"keep"}]';
  const f = fixture({ chat_history_A: original, phone_data_v2: root() });
  assert.equal(f.api.saveChatHistory('A', { text: 'wrong shape' }), false);
  assert.equal(f.api.result.saveChatHistory('A', null).error.code, 'VALIDATION_FAILED');
  assert.equal(f.data.chat_history_A, original);
  assert.equal(f.writes.filter((key) => key === 'chat_history_A').length, 0);
});


test('result.getData(chat) refuses non-array and unreadable primary instead of stale v2', () => {
  const legacy = root('stale A');
  for (const primary of ['{"history":[]}', 'null', '""', '{broken']) {
    const f = fixture({ chat_history_A: primary, phone_data_v2: legacy });
    assert.equal(f.api.result.getData('A', 'chat').error.code, 'CORRUPT_DATA');
    assert.equal(f.data.chat_history_A, primary);
    assert.equal(f.data.phone_data_v2, legacy);
  }
  const f = fixture({ chat_history_A: '[]', phone_data_v2: legacy }, { readThrows: true });
  assert.equal(f.api.result.getData('A', 'chat').error.code, 'DB_UNAVAILABLE');
  assert.equal(f.data.chat_history_A, '[]');
});

test('result.getData(chat) falls back only for missing primary with a valid legacy array', () => {
  const good = fixture({ phone_data_v2: root('old A') });
  assert.equal(good.api.result.getData('A', 'chat').value.history[0].text, 'old A');
  const malformed = fixture({
    phone_data_v2: JSON.stringify({ A: { chat: { history: { text: 'invalid' } } } })
  });
  assert.equal(malformed.api.result.getData('A', 'chat').error.code, 'CORRUPT_DATA');
  const invalidRoot = fixture({ phone_data_v2: '{invalid-v2' });
  assert.equal(invalidRoot.api.result.getData('A', 'chat').error.code, 'CORRUPT_DATA');
  const validPrimary = fixture({ chat_history_A: '[{"text":"primary"}]', phone_data_v2: '{invalid-v2' });
  assert.equal(validPrimary.api.result.getData('A', 'chat').value.history[0].text, 'primary');
});


test('invalid conversation IDs never write phantom chat_history keys', () => {
  const f = fixture({ chat_history_A: '[{"text":"keep"}]' });
  for (const id of [undefined, null, '', '   ', 0, {}]) {
    assert.equal(f.api.saveChatHistory(id, [{ text: 'wrong' }]), false);
    assert.equal(f.api.result.saveChatHistory(id, [{ text: 'wrong' }]).error.code, 'VALIDATION_FAILED');
    assert.equal(f.api.result.appendChatHistory(id, { text: 'wrong' }).error.code, 'VALIDATION_FAILED');
  }
  assert.equal(f.data.chat_history_A, '[{"text":"keep"}]');
  assert.equal(f.writes.filter((key) => String(key).startsWith('chat_history_')).length, 0);
});

test('forward append rejects corrupt and non-array target without touching source role', () => {
  for (const bad of ['{broken', '{"history":[]}', 'null']) {
    const f = fixture({ chat_history_A: bad, chat_history_B: '[{"mid":"source"}]', phone_data_v2: root() });
    const res = f.api.result.appendChatHistory('A', { mid: 'forward-1', assetId: 'synthetic-image' });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'CORRUPT_DATA');
    assert.equal(f.data.chat_history_A, bad);
    assert.equal(f.data.chat_history_B, '[{"mid":"source"}]');
    assert.equal(f.writes.filter((key) => key === 'chat_history_A').length, 0);
  }
});

test('forward append handles quota and dropped writes without false success', () => {
  for (const [options, code] of [[{ quotaThrows: true }, 'QUOTA_EXCEEDED'], [{ dropWrites: true }, 'DB_UNAVAILABLE']]) {
    const f = fixture({ phone_data_v2: root(), chat_history_B: '[{"mid":"source"}]' }, options);
    const res = f.api.result.appendChatHistory('A', { mid: 'forward-1', assetId: 'synthetic-image' });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, code);
    assert.equal(f.data.chat_history_A, undefined);
    assert.equal(f.data.chat_history_B, '[{"mid":"source"}]');
    assert.equal(JSON.parse(f.data.phone_data_v2).A.chat.history[0].text, 'stale A');
  }
});

test('forward append migrates valid legacy v2 and keeps unrelated role intact', () => {
  const f = fixture({ phone_data_v2: root('legacy A'), chat_history_B: '[{"mid":"source"}]' });
  const res = f.api.result.appendChatHistory('A', { mid: 'forward-1', assetId: 'synthetic-image' });
  assert.equal(res.ok, true);
  const saved = JSON.parse(f.data.chat_history_A);
  assert.equal(saved.length, 2);
  assert.equal(saved[0].text, 'legacy A');
  assert.equal(saved[1].mid, 'forward-1');
  assert.equal(f.data.chat_history_B, '[{"mid":"source"}]');
  assert.equal(JSON.parse(f.data.phone_data_v2).B.chat.history[0].text, 'untouched B');
});

test('forward append fails closed when v2 is malformed and primary absent', () => {
  const malformed = '{"A":{"chat":{"history":{"text":"bad"}}}}';
  const f = fixture({ phone_data_v2: malformed, chat_history_B: '[{"mid":"source"}]' });
  const res = f.api.result.appendChatHistory('A', { mid: 'forward-1' });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'CORRUPT_DATA');
  assert.equal(f.data.phone_data_v2, malformed);
  assert.equal(f.data.chat_history_A, undefined);
});

test('post-commit write exception is verified success, preserving forwarded image reference', () => {
  const f = fixture({ phone_data_v2: root(), chat_history_B: '[{"mid":"B"}]' },
    { commitThenThrow: true });
  const result = f.api.result.appendChatHistory('A', { mid: 'forward-image', assetId: 'asset-A' });
  assert.equal(result.ok, true);
  assert.equal(result.meta.verifiedAfterWriteError, true);
  assert.equal(JSON.parse(f.data.chat_history_A).at(-1).assetId, 'asset-A');
  assert.equal(f.data.chat_history_B, '[{"mid":"B"}]');
});

test('post-commit write with unreadable verification reports uncertainty, not definite rollback', () => {
  const f = fixture({ phone_data_v2: root(), chat_history_B: '[{"mid":"B"}]' },
    { commitThenThrow: true, commitThenReadThrows: true });
  const result = f.api.result.appendChatHistory('A', { mid: 'forward-image', assetId: 'asset-A' });
  assert.equal(result.ok, false);
  assert.equal(result.meta.writeMayHavePersisted, true);
  assert.equal(JSON.parse(f.data.chat_history_A).at(-1).assetId, 'asset-A');
  assert.equal(f.data.chat_history_B, '[{"mid":"B"}]');
});

test('pre-commit quota exception remains a definite failure and does not append', () => {
  const f = fixture({ chat_history_A: '[{"mid":"old"}]', phone_data_v2: root() },
    { quotaThrows: true });
  const result = f.api.result.appendChatHistory('A', { mid: 'not-saved' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'QUOTA_EXCEEDED');
  assert.equal(result.meta.writeMayHavePersisted, false);
  assert.equal(f.data.chat_history_A, '[{"mid":"old"}]');
});
