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
const readFrom = detail.indexOf('        function _readBackHistory() {', to);
assert.ok(readFrom > to && readFrom < saveFrom, 'readback must use real production helpers');
const code = detail.slice(from, to) + '\n' + detail.slice(readFrom, saveTo);

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
    showToast: text => toasts.push(text),
    console: { warn: () => {} }
  };
  vm.createContext(sandbox);
  vm.runInContext(code + '\nglobalThis.chatGuard = { loadMessages, saveMessages };', sandbox);
  return {
    read: () => sandbox.chatGuard.loadMessages(),
    write: list => sandbox.chatGuard.saveMessages(list),
    bytes: () => bytes,
    setRaw: value => { bytes = value; },
    setRole: roleId => { sandbox.currentCharacter.id = roleId; },
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

test('corrupt primary key blocks a valid-looking PhoneStorage duplicate', () => {
  const raw = '{broken-primary';
  const chat = fixture(raw, {
    storage: {
      getChatHistory() { return [{ role: 'received', text: 'stale duplicate' }]; },
      saveChatHistory() { throw Error('must never write a corrupt conversation'); }
    }
  });
  assert.equal(chat.read().length, 0);
  assert.equal(chat.write([{ role: 'user', text: 'not persisted' }]), false);
  assert.equal(chat.bytes(), raw);
  assert.equal(chat.writes(), 0);
  assert.equal(chat.initialized(), 0);
});

test('valid empty primary key is authoritative over stale v2 duplicate', () => {
  const chat = fixture('[]', {
    storage: { getChatHistory() { return [{ text: 'stale duplicate' }]; } }
  });
  assert.equal(chat.read().length, 0);
  assert.equal(chat.initialized(), 0);
  assert.equal(chat.writes(), 0);
});

test('absent primary key may still recover legacy v2 history without welcome overwrite', () => {
  const chat = fixture(null, {
    storage: { getChatHistory() { return [{ role: 'received', text: 'v2 history' }]; } }
  });
  assert.equal(chat.read()[0].text, 'v2 history');
  assert.equal(chat.initialized(), 0);
  assert.equal(chat.writes(), 0);
});

test('PhoneStorage cannot fake success using only a stale duplicate', () => {
  const original = JSON.stringify([{ role: 'received', text: 'original', time: 1 }]);
  const chat = fixture(original, {
    storage: {
      saveChatHistory() { return true; },
      getChatHistory() { return [{ role: 'user', text: 'forged success', time: 2 }]; }
    }
  });
  assert.equal(chat.read().length, 1);
  assert.equal(chat.write([{ role: 'user', text: 'forged success', time: 2 }]), false);
  assert.equal(chat.bytes(), original);
  assert.equal(chat.writes(), 0);
});

test('late corruption in another tab blocks a write and preserves exact bytes', () => {
  const chat = fixture(JSON.stringify([{ role: 'user', text: 'old' }]));
  assert.equal(chat.read().length, 1);
  chat.setRaw('{corrupted-after-load');
  assert.equal(chat.write([{ role: 'user', text: 'new' }]), false);
  assert.equal(chat.bytes(), '{corrupted-after-load');
  assert.equal(chat.writes(), 0);
});

test('a changed role id never reads or writes a different conversation', () => {
  const original = JSON.stringify([{ role: 'user', text: 'A only' }]);
  const chat = fixture(original, {
    storage: {
      getChatHistory() { throw Error('must not read role B'); },
      saveChatHistory() { throw Error('must not write role B'); }
    }
  });
  chat.setRole('role-B');
  assert.equal(chat.read().length, 0);
  assert.equal(chat.write([{ role: 'user', text: 'B' }]), false);
  assert.equal(chat.bytes(), original);
  assert.equal(chat.writes(), 0);
});

test('malformed legacy getter cannot initialize welcome over unknown data', () => {
  const chat = fixture(null, {
    storage: { getChatHistory() { return { unexpected: 'object' }; } }
  });
  assert.equal(chat.read().length, 0);
  assert.equal(chat.write([{ role: 'user', text: 'do not save' }]), false);
  assert.equal(chat.initialized(), 0);
  assert.equal(chat.writes(), 0);
});

test('normal per-role write succeeds with the real readback helper', () => {
  const chat = fixture('[]');
  assert.equal(chat.read().length, 0);
  assert.equal(chat.write([{ role: 'user', text: 'verified', mid: 'm-1' }]), true);
  assert.equal(JSON.parse(chat.bytes())[0].mid, 'm-1');
  assert.equal(chat.writes(), 1);
});
