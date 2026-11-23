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

test('retry after an uncertain forward commit is idempotent for an identical mid and payload', () => {
  const msg = { mid: 'forward-uncertain-1', role: 'user', type: 'image', assetId: 'synthetic-asset-A' };
  const f = fixture({ chat_history_A: '[]', chat_history_B: '[{"mid":"B-1"}]' });
  assert.equal(f.api.result.appendChatHistory('A', msg).ok, true);
  const before = f.data.chat_history_A;
  const writes = f.writes.filter(key => key === 'chat_history_A').length;
  const retry = f.api.result.appendChatHistory('A', { ...msg });
  assert.equal(retry.ok, true);
  assert.equal(retry.meta.alreadyPersisted, true);
  assert.equal(retry.meta.messageId, msg.mid);
  assert.equal(f.data.chat_history_A, before);
  assert.equal(f.writes.filter(key => key === 'chat_history_A').length, writes);
  assert.equal(JSON.parse(f.data.chat_history_A).length, 1);
  assert.equal(f.data.chat_history_B, '[{"mid":"B-1"}]');
});

test('duplicate mid with different media is a conflict, preserving the original bytes', () => {
  const previous = { mid: 'fwd-1', role: 'user', assetId: 'asset-A' };
  const raw = JSON.stringify([previous]);
  const f = fixture({ chat_history_A: raw, chat_history_B: '[{"mid":"B"}]' });
  const res = f.api.result.appendChatHistory('A', { ...previous, assetId: 'asset-B' });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'CONFLICT');
  assert.equal(f.data.chat_history_A, raw);
  assert.equal(f.data.chat_history_B, '[{"mid":"B"}]');
  assert.equal(f.writes.filter(key => key === 'chat_history_A').length, 0);
});

test('identical forwarded mids can exist in separately isolated role histories', () => {
  const msg = { mid: 'same-mid', text: 'synthetic' };
  const f = fixture({ chat_history_A: '[]', chat_history_B: '[]' });
  assert.equal(f.api.result.appendChatHistory('A', msg).ok, true);
  assert.equal(f.api.result.appendChatHistory('B', msg).ok, true);
  assert.equal(JSON.parse(f.data.chat_history_A).length, 1);
  assert.equal(JSON.parse(f.data.chat_history_B).length, 1);
});

test('corrupt primary blocks idempotent retry despite a matching legacy copy', () => {
  const raw = '{broken-primary';
  const duplicate = { mid: 'fwd-1', text: 'synthetic' };
  const f = fixture({
    chat_history_A: raw,
    phone_data_v2: JSON.stringify({ A: { chat: { history: [duplicate] } } })
  });
  const res = f.api.result.appendChatHistory('A', duplicate);
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'CORRUPT_DATA');
  assert.equal(f.data.chat_history_A, raw);
  assert.equal(f.writes.filter(key => key === 'chat_history_A').length, 0);
});

test('retry against identical legacy v2 record does not create another primary copy', () => {
  const previous = { mid: 'v2-1', text: 'legacy synthetic' };
  const legacy = JSON.stringify({ A: { chat: { history: [previous] } } });
  const f = fixture({ phone_data_v2: legacy });
  const res = f.api.result.appendChatHistory('A', { ...previous });
  assert.equal(res.ok, true);
  assert.equal(res.meta.alreadyPersisted, true);
  assert.equal(f.data.phone_data_v2, legacy);
  assert.equal(f.data.chat_history_A, undefined);
});

test('result.getChatHistory reports corrupt legacy v2 instead of false NOT_FOUND', () => {
  const badRoot = fixture({ phone_data_v2: '{broken-v2' });
  assert.equal(badRoot.api.result.getChatHistory('A').error.code, 'CORRUPT_DATA');
  const wrongShape = fixture({
    phone_data_v2: JSON.stringify({ A: { chat: { history: { text: 'not-array' } } } })
  });
  assert.equal(wrongShape.api.result.getChatHistory('A').error.code, 'CORRUPT_DATA');
  const badNull = fixture({
    phone_data_v2: JSON.stringify({ A: { chat: { history: null } } })
  });
  assert.equal(badNull.api.result.getChatHistory('A').error.code, 'CORRUPT_DATA');
});

test('result.getChatHistory keeps valid legacy fallback and primary precedence', () => {
  const legacy = root('legacy A');
  const fallback = fixture({ phone_data_v2: legacy });
  assert.equal(fallback.api.result.getChatHistory('A').value[0].text, 'legacy A');
  const primary = fixture({ chat_history_A: '[]', phone_data_v2: '{broken-v2' });
  assert.equal(primary.api.result.getChatHistory('A').ok, true);
  assert.equal(primary.api.result.getChatHistory('A').value.length, 0);
  assert.equal(primary.data.phone_data_v2, '{broken-v2');
});

test('invalid chat read targets never resolve phantom history keys or v2 buckets', () => {
  const phantom = '[{"mid":"phantom"}]';
  const f = fixture({
    chat_history_undefined: phantom,
    chat_history_null: phantom,
    phone_data_v2: JSON.stringify({ undefined: { chat: { history: [{ mid: 'v2-phantom' }] } } })
  });
  for (const id of [undefined, null, '', '   ', 0, {}]) {
    assert.equal(f.api.getChatHistory(id).length, 0);
    assert.equal(f.api.result.getChatHistory(id).error.code, 'VALIDATION_FAILED');
    assert.equal(f.api.result.getData(id, 'chat').error.code, 'VALIDATION_FAILED');
  }
  assert.equal(f.data.chat_history_undefined, phantom);
  assert.equal(f.data.chat_history_null, phantom);
  assert.equal(f.writes.filter(key => String(key).startsWith('chat_history_')).length, 0);
});

test('valid chat read targets preserve the primary and legacy fallback contracts', () => {
  const f = fixture({ chat_history_A: '[{"mid":"primary"}]', phone_data_v2: root('legacy B') });
  assert.equal(f.api.getChatHistory('A')[0].mid, 'primary');
  assert.equal(f.api.result.getChatHistory('A').value[0].mid, 'primary');
  assert.equal(f.api.result.getData('A', 'chat').value.history[0].mid, 'primary');
  assert.equal(f.api.result.getChatHistory('B').value[0].text, 'untouched B');
  assert.equal(f.writes.filter(key => String(key).startsWith('chat_history_')).length, 0);
});

test('retry treats reordered nested JSON object keys as the same persisted message', () => {
  const original = { mid: 'fwd-order', role: 'user', metadata: { b: 2, a: { y: 9, x: 8 } }, items: [{ z: 3, a: 1 }] };
  const raw = JSON.stringify([original]);
  const f = fixture({ chat_history_A: raw, chat_history_B: '[{"mid":"B"}]' });
  const retry = { items: [{ a: 1, z: 3 }], metadata: { a: { x: 8, y: 9 }, b: 2 }, role: 'user', mid: 'fwd-order' };
  const res = f.api.result.appendChatHistory('A', retry);
  assert.equal(res.ok, true);
  assert.equal(res.meta.alreadyPersisted, true);
  assert.equal(f.data.chat_history_A, raw);
  assert.equal(f.data.chat_history_B, '[{"mid":"B"}]');
  assert.equal(f.writes.filter(key => key === 'chat_history_A').length, 0);
});

test('retry detects changed nested media payload and never overwrites the original', () => {
  const original = { mid: 'fwd-nested', media: { assetId: 'asset-A', alt: 'synthetic' } };
  const raw = JSON.stringify([original]);
  const f = fixture({ chat_history_A: raw });
  const res = f.api.result.appendChatHistory('A', { media: { alt: 'synthetic', assetId: 'asset-B' }, mid: 'fwd-nested' });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'CONFLICT');
  assert.equal(f.data.chat_history_A, raw);
  assert.equal(f.writes.filter(key => key === 'chat_history_A').length, 0);
});

test('idempotent retry compares own __proto__ JSON data without prototype-key loss', () => {
  const oldMessage = JSON.parse('{"mid":"fwd-proto","meta":{"__proto__":{"assetId":"asset-A"},"normal":1}}');
  const changed = JSON.parse('{"mid":"fwd-proto","meta":{"normal":1,"__proto__":{"assetId":"asset-B"}}}');
  const original = JSON.stringify([oldMessage]);
  const f = fixture({ chat_history_A: original, chat_history_B: '[{"mid":"B"}]' });
  const result = f.api.result.appendChatHistory('A', changed);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CONFLICT');
  assert.equal(f.data.chat_history_A, original);
  assert.equal(f.data.chat_history_B, '[{"mid":"B"}]');
  assert.equal(f.writes.filter(key => key === 'chat_history_A').length, 0);
});

test('reordered special JSON keys remain idempotent when payload is unchanged', () => {
  const oldMessage = JSON.parse('{"mid":"fwd-special","meta":{"__proto__":{"assetId":"asset-A"},"constructor":"data"}}');
  const same = JSON.parse('{"meta":{"constructor":"data","__proto__":{"assetId":"asset-A"}},"mid":"fwd-special"}');
  const original = JSON.stringify([oldMessage]);
  const f = fixture({ chat_history_A: original });
  const result = f.api.result.appendChatHistory('A', same);
  assert.equal(result.ok, true);
  assert.equal(result.meta.alreadyPersisted, true);
  assert.equal(f.data.chat_history_A, original);
  assert.equal(f.writes.filter(key => key === 'chat_history_A').length, 0);
});

test('non-scalar message IDs fail closed without invoking custom toString or writing', () => {
  const raw = '[{"mid":"existing","text":"keep"}]';
  const f = fixture({ chat_history_A: raw, chat_history_B: '[{"mid":"B"}]' });
  let invoked = false;
  const dangerous = { toString() { invoked = true; throw new Error('must not execute'); } };
  for (const mid of [dangerous, ['existing'], true, Infinity, NaN]) {
    const result = f.api.result.appendChatHistory('A', { mid, text: 'synthetic' });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'VALIDATION_FAILED');
  }
  assert.equal(invoked, false);
  assert.equal(f.data.chat_history_A, raw);
  assert.equal(f.data.chat_history_B, '[{"mid":"B"}]');
  assert.equal(f.writes.filter(key => key === 'chat_history_A').length, 0);
});

test('finite numeric and string IDs retain their existing append behavior', () => {
  const f = fixture({ chat_history_A: '[]' });
  assert.equal(f.api.result.appendChatHistory('A', { mid: 123, text: 'numeric' }).ok, true);
  assert.equal(f.api.result.appendChatHistory('A', { mid: '456', text: 'string' }).ok, true);
  assert.equal(JSON.parse(f.data.chat_history_A).length, 2);
});
