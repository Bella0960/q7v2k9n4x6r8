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
// Reuse the real cross-tab version helpers that now precede loadMessages.
const baselineFrom = detail.indexOf('        var _chatHistoryBaselines = new WeakMap();');
assert.ok(baselineFrom >= 0 && baselineFrom < from, 'real history baseline helpers are required');
const code = detail.slice(baselineFrom, to) + '\n' + detail.slice(readFrom, saveTo);

function fixture(raw, options = {}) {
  let bytes = raw;
  let writes = 0;
  let initialized = 0;
  let lastRead = null;
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
    read: () => {
      lastRead = sandbox.chatGuard.loadMessages();
      return lastRead;
    },
    write: list => sandbox.chatGuard.saveMessages(
      lastRead ? sandbox._inheritChatBaseline(list, lastRead) : list
    ),
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

const storageSource = fs.readFileSync('shared/js/phone/phone_storage.js', 'utf8');
const forwardStart = detail.indexOf('        async function forwardMessage(');
const forwardEnd = detail.indexOf('        // 点 AI 头像', forwardStart);
assert.ok(forwardStart >= 0 && forwardEnd > forwardStart, 'real forwarding handler is required');

function forwardFixture({ primary, legacy, getItem, setItem, addRef, removeRef } = {}) {
  const targetKey = 'chat_history_role-B';
  const sourceKey = 'chat_history_role-A';
  const sourceBytes = '[{"mid":"source","text":"keep the source"}]';
  const stored = new Map([[sourceKey, sourceBytes]]);
  if (primary !== undefined) stored.set(targetKey, primary);
  if (legacy !== undefined) stored.set('phone_data_v2', JSON.stringify(legacy));
  const toasts = [];
  const removed = [];
  let nextMid = 0;
  const sandbox = {
    localStorage: {
      getItem: key => getItem ? getItem(key, stored) : stored.get(key) ?? null,
      setItem: (key, value) => setItem ? setItem(key, value, stored) : stored.set(key, value)
    },
    console: { warn: () => {} },
    aliasRoleId: 'role-A',
    chatTitle: { textContent: 'Source alias' },
    contactName: 'Source',
    plainTextOf: message => message.text,
    ensureMid: message => { if (!message.mid) message.mid = 'forward-' + ++nextMid; },
    showToast: text => toasts.push(text),
    _chatImageMediaRepo: {
      addRef: addRef ? (...args) => addRef(stored, ...args) : async () => ({ ok: true }),
      removeRef: removeRef || (async (...args) => { removed.push(args); })
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(storageSource, sandbox);
  sandbox._storage = sandbox.PhoneStorage;
  vm.runInContext(detail.slice(forwardStart, forwardEnd), sandbox);
  return {
    forward: (message = { text: 'hello' }) =>
      sandbox.forwardMessage({ message, count: 1, text: message.text }, 'role-B', 'Target'),
    primary: () => stored.get(targetKey),
    legacy: () => stored.get('phone_data_v2'),
    sourceUnchanged: () => assert.equal(stored.get(sourceKey), sourceBytes),
    toasts,
    removed
  };
}

test('forwarding refuses corrupt or non-array primary history even with a valid legacy duplicate', async () => {
  const legacy = { 'role-B': { chat: { history: [{ text: 'older copy' }] } } };
  for (const primary of ['{broken', '{"text":"wrong shape"}', '']) {
    const fixture = forwardFixture({ primary, legacy });
    await fixture.forward();
    assert.equal(fixture.primary(), primary);
    assert.equal(fixture.legacy(), JSON.stringify(legacy));
    assert.match(fixture.toasts.at(-1), /保护原始数据/);
    fixture.sourceUnchanged();
  }
});

test('forwarding appends to legacy only when the primary key is missing', async () => {
  const legacy = {
    'role-A': { chat: { history: [{ text: 'other role' }] } },
    'role-B': { chat: { history: [{ text: 'older message' }] }, notes: { text: 'keep' } }
  };
  for (const primary of [undefined, '[]']) {
    const fixture = forwardFixture({ primary, legacy });
    await fixture.forward();
    assert.deepEqual(JSON.parse(fixture.primary()).map(message => message.text),
      primary === undefined ? ['older message', 'hello'] : ['hello']);
    assert.deepEqual(JSON.parse(fixture.primary()).at(-1).forwardFrom,
      { id: 'role-A', name: 'Source alias' });
    assert.deepEqual(JSON.parse(fixture.legacy()), {
      'role-A': legacy['role-A'], 'role-B': { notes: legacy['role-B'].notes }
    });
    assert.match(fixture.toasts.at(-1), /已转发/);
    fixture.sourceUnchanged();
  }
  const malformed = { 'role-B': { chat: { history: 'unreadable history' } } };
  const fixture = forwardFixture({ legacy: malformed });
  await fixture.forward();
  assert.equal(fixture.primary(), undefined);
  assert.equal(fixture.legacy(), JSON.stringify(malformed));
  assert.match(fixture.toasts.at(-1), /保护原始数据/);
});

test('forwarding refuses unreadable data and rolls back a linked image on quota or a dropped write', async () => {
  const unreadable = forwardFixture({
    primary: '[]',
    getItem() { throw new Error('storage is unavailable'); }
  });
  await unreadable.forward();
  assert.equal(unreadable.primary(), '[]');
  assert.match(unreadable.toasts.at(-1), /存储暂不可用/);
  for (const drop of [false, true]) {
    const fixture = forwardFixture({
      primary: '[]',
      setItem() {
        if (!drop) throw new DOMException('full', 'QuotaExceededError');
      }
    });
    await fixture.forward({ type: 'image', assetId: 'test-asset', text: '' });
    assert.equal(fixture.primary(), '[]');
    assert.deepEqual(fixture.removed, [['test-asset', 'chat-message', 'forward-1']]);
    assert.match(fixture.toasts.at(-1), /转发失败|转发未完成/);
    fixture.sourceUnchanged();
  }
});

test('image forwarding reads history after linking and keeps a possibly persisted image when readback throws', async () => {
  const original = [{ mid: 'existing', text: 'keep' }];
  const concurrent = { mid: 'new', text: 'arrived while linking' };
  const fixture = forwardFixture({
    primary: JSON.stringify(original),
    addRef: async stored => {
      stored.set('chat_history_role-B', JSON.stringify([...original, concurrent]));
      return { ok: true };
    }
  });
  await fixture.forward({ type: 'image', assetId: 'test-asset', text: '' });
  assert.deepEqual(JSON.parse(fixture.primary()).map(message => message.mid), ['existing', 'new', 'forward-1']);
  assert.equal(fixture.removed.length, 0);
  assert.match(fixture.toasts.at(-1), /已转发/);

  const corruptedWhileLinking = forwardFixture({
    primary: JSON.stringify(original),
    addRef: async stored => {
      stored.set('chat_history_role-B', '{changed');
      return { ok: true };
    }
  });
  await corruptedWhileLinking.forward({ type: 'image', assetId: 'test-asset', text: '' });
  assert.equal(corruptedWhileLinking.primary(), '{changed');
  assert.deepEqual(corruptedWhileLinking.removed, [['test-asset', 'chat-message', 'forward-1']]);

  let hasWritten = false;
  const uncertain = forwardFixture({
    primary: JSON.stringify(original),
    getItem(key, stored) {
      if (hasWritten && key === 'chat_history_role-B') throw new Error('readback unavailable');
      return stored.get(key) ?? null;
    },
    setItem(key, value, stored) {
      stored.set(key, value);
      if (key === 'chat_history_role-B') hasWritten = true;
    }
  });
  await uncertain.forward({ type: 'image', assetId: 'test-asset', text: '' });
  assert.equal(JSON.parse(uncertain.primary()).at(-1).assetId, 'test-asset');
  assert.equal(uncertain.removed.length, 0);
  assert.match(uncertain.toasts.at(-1), /无法确认/);
  uncertain.sourceUnchanged();
});
