import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const detail = fs.readFileSync('chat/chat/chat-detail.html', 'utf8');
const from = detail.indexOf('        var _chatHistoryUnreadable = false;');
const to = detail.indexOf('        // 失败提示冷却：', from);
const saveFrom = detail.indexOf('        function saveMessages(list) {', to);
const saveTo = detail.indexOf('        // /photo 为用户显式触发', saveFrom);
assert.ok(from >= 0 && to > from && saveFrom > to && saveTo > saveFrom,
  'real chat source must expose the read/write guard blocks');
const code = detail.slice(from, to) + '\n' + detail.slice(saveFrom, saveTo);

function fixture(raw, options = {}) {
  let bytes = raw;
  let writes = 0;
  let initialized = 0;
  const toasts = [];
  const sandbox = {
    _storage: options.storage || null,
    currentCharacter: { id: 'role-A' },
    storageKey: 'chat_history_role-A',
    localStorage: {
      getItem: key => { assert.equal(key, 'chat_history_role-A'); return bytes; },
      setItem: (key, value) => { assert.equal(key, 'chat_history_role-A'); writes++; bytes = value; }
    },
    removeLegacyStickerCaptions: list => list,
    getInitialMessages: () => { initialized++; return [{ role: 'received', text: 'Welcome' }]; },
    _shouldWarnAgain: () => true,
    _resetWarnCooldown: () => {},
    _verifyHistoryRoundTrip: list => JSON.stringify(list) === bytes,
    showToast: text => toasts.push(text),
    console: { warn: () => {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(code + '\nglobalThis.chatGuard = { loadMessages, saveMessages };', sandbox);
  return {
    read: () => sandbox.chatGuard.loadMessages(),
    write: list => sandbox.chatGuard.saveMessages(list),
    bytes: () => bytes,
    writes: () => writes,
    initialized: () => initialized,
    toasts
  };
}

test('corrupt JSON remains byte-for-byte intact; no fake welcome or outgoing success', () => {
  const raw = '{bad-chat-json';
  const chat = fixture(raw);
  assert.equal(chat.read().length, 0);
  assert.equal(chat.write([{ role: 'user', text: 'hello' }]), false);
  assert.equal(chat.bytes(), raw);
  assert.equal(chat.writes(), 0);
  assert.equal(chat.initialized(), 0);
  assert.ok(chat.toasts.some(text => text.includes('暂停')));
});

test('valid non-array JSON is not silently overwritten', () => {
  const raw = '{"history":[{"text":"keep me"}]}';
  const chat = fixture(raw);
  assert.equal(chat.read().length, 0);
  assert.equal(chat.write([]), false);
  assert.equal(chat.bytes(), raw);
  assert.equal(chat.writes(), 0);
});

test('a valid empty history remains empty rather than generating a welcome message', () => {
  const chat = fixture('[]');
  assert.equal(chat.read().length, 0);
  assert.equal(chat.initialized(), 0);
  assert.equal(chat.writes(), 0);
  assert.equal(chat.write([{ role: 'user', text: 'hello' }]), true);
  assert.equal(chat.writes(), 1);
});

test('a genuinely absent history initializes once and verifies persistence', () => {
  const chat = fixture(null);
  assert.equal(chat.read().length, 1);
  assert.equal(chat.initialized(), 1);
  assert.equal(chat.writes(), 1);
});

test('PhoneStorage throwing must not fall back to overwriting localStorage', () => {
  const raw = '{"legacy":"preserve"}';
  const chat = fixture(raw, { storage: { getChatHistory() { throw Error('storage unavailable'); } } });
  assert.equal(chat.read().length, 0);
  assert.equal(chat.write([{ role: 'user', text: 'not saved' }]), false);
  assert.equal(chat.bytes(), raw);
  assert.equal(chat.writes(), 0);
});
