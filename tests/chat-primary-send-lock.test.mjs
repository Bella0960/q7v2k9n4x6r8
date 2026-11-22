import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext, Script } from 'node:vm';

const detail = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const atomicSource = readFileSync(new URL('../shared/js/phone/chat-history-atomic.js', import.meta.url), 'utf8');

function section(start, end) {
    const a = detail.indexOf(start);
    const b = detail.indexOf(end, a);
    assert.ok(a >= 0 && b > a, 'missing real source section: ' + start);
    return detail.slice(a, b);
}

function storage(seed = {}, options = {}) {
    const values = new Map(Object.entries(seed));
    return {
        get length() { return values.size; },
        key(index) { return [...values.keys()][index] || null; },
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) {
            if (options.quota) { const err = new Error('full'); err.name = 'QuotaExceededError'; throw err; }
            values.set(key, String(value));
        },
        removeItem(key) { values.delete(key); },
        raw(key) { return values.get(key); }
    };
}

function locks() {
    const tails = new Map();
    return { request(name, options, callback) {
        assert.equal(options.mode, 'exclusive');
        const next = (tails.get(name) || Promise.resolve()).then(callback);
        tails.set(name, next.catch(() => {}));
        return next;
    } };
}

const helpers = section('        async function appendChatSafely(messages, guard) {',
    '        function saveMessages(list) {');
const makeHelpers = new Function('window', 'currentCharacter', 'storageKey', 'showToast',
    '_chatHistoryUnreadable', helpers + '\nreturn { appendChatSafely, replaceChatSafely };');

function tab(localStorage, lock, id = 'role') {
    const window = { localStorage, navigator: lock ? { locks: lock } : {} };
    runInNewContext(atomicSource, { window });
    const toasts = [];
    return {
        window,
        toasts,
        ...makeHelpers(window, { id }, 'chat_history_' + id,
            text => toasts.push(text), false)
    };
}

test('2000 rich messages survive concurrent private and group chat sends', async () => {
    const old = Array.from({ length: 2000 }, (_, i) => ({
        mid: 'old-' + i, mode: i % 3 ? 'online' : 'date',
        type: i % 2 ? 'voice' : 'image', assetId: 'asset-' + i,
        extra: { index: i }
    }));
    const s = storage({ chat_history_role: JSON.stringify(old) });
    const lock = locks();
    const [a, b] = await Promise.all([
        tab(s, lock).appendChatSafely([{ mid: 'send-a', role: 'user', text: 'a' }]),
        tab(s, lock).appendChatSafely([{ mid: 'send-b', role: 'assistant', text: 'b' }])
    ]);
    assert.equal(a, true);
    assert.equal(b, true);
    const data = JSON.parse(s.raw('chat_history_role'));
    assert.equal(data.length, 2002);
    assert.deepEqual(data.slice(0, 2000), old);
    assert.deepEqual(data.slice(-2).map(m => m.mid), ['send-a', 'send-b']);
});

test('stale edits and deletes cannot erase concurrent new messages', async () => {
    const old = [{ mid: 'existing', text: 'keep', type: 'image', assetId: 'asset-1' }];
    const s = storage({ chat_history_role: JSON.stringify(old) });
    const lock = locks();
    const a = tab(s, lock);
    const b = tab(s, lock);
    assert.equal(await b.appendChatSafely([{ mid: 'new', text: 'new arrival' }]), true);
    assert.equal(await a.replaceChatSafely(old, []), false);
    assert.equal(await a.replaceChatSafely(old, [{ mid: 'existing', text: 'edited' }]), false);
    assert.deepEqual(JSON.parse(s.raw('chat_history_role')).map(x => x.mid), ['existing', 'new']);
});

test('multi-bubble AI reply is committed in one guarded batch', async () => {
    const s = storage({ chat_history_role: '[{"mid":"user","role":"user"}]' });
    const role = tab(s, locks());
    assert.equal(await role.appendChatSafely([
        { mid: 'turn-1', turnId: 'turn', role: 'assistant', text: 'one' },
        { mid: 'turn-2', turnId: 'turn', role: 'assistant', text: 'two' }
    ]), true);
    assert.equal(JSON.parse(s.raw('chat_history_role')).length, 3);
});

test('corrupt history and unavailable locks refuse all writes', async () => {
    const corrupt = storage({ chat_history_role: '{broken' });
    assert.equal(await tab(corrupt, locks()).appendChatSafely([{ mid: 'a' }]), false);
    assert.equal(corrupt.raw('chat_history_role'), '{broken');
    const noLock = storage({ chat_history_role: '[]' });
    assert.equal(await tab(noLock, null).appendChatSafely([{ mid: 'a' }]), false);
    assert.equal(noLock.raw('chat_history_role'), '[]');
});


test('all three primary user-send routes use the shared lock, never a stale whole-history save', () => {
    assert.match(detail, /if \(!await appendChatSafely\(\[blockedMsg\]\)\)/);
    assert.match(detail, /userSaved = await appendChatSafely\(\[userMsg\]\)/);
    assert.match(detail, /if \(!await appendChatSafely\(\[userMsg\]\)\)/);
    assert.match(detail, /historyList = loadMessages\(\);[\s\S]*?messages committed snapshot|historyList = loadMessages\(\);/);
    assert.match(detail, /chat-history-atomic\.js\?v=20261118v3/);
});
