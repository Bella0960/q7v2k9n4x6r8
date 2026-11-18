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

const legacySave = section('        function saveMessages(list) {', '        // /photo ');
function legacyFixture(localStorage, baseline) {
    const factory = new Function('localStorage', 'baseline', 'toasts', 'console',
        'var _chatHistoryUnreadable = false;\n' +
        'var _lastReadChatRaw = baseline;\n' +
        'var storageKey = "chat_history_role";\n' +
        'var currentCharacter = {id:"role"};\n' +
        'var _storage = null;\n' +
        'var showToast = message => toasts.push(message);\n' +
        'var _shouldWarnAgain = () => true;\n' +
        'var _resetWarnCooldown = () => {};\n' +
        'var _verifyHistoryRoundTrip = list => JSON.stringify(list) === localStorage.getItem(storageKey);\n' +
        legacySave + '\nreturn saveMessages;');
    const toasts = [];
    return { save: factory(localStorage, baseline, toasts, { warn() {} }), toasts };
}

test('remaining legacy synchronous card writes reject stale snapshots', async () => {
    const initial = JSON.stringify([{ mid: 'a', text: 'keep' }]);
    const s = storage({ chat_history_role: initial });
    const local = legacyFixture(s, initial);
    assert.equal(await tab(s, locks()).appendChatSafely([{ mid: 'b', text: 'other tab' }]), true);
    assert.equal(local.save([{ mid: 'a' }, { mid: 'danger' }]), false);
    assert.deepEqual(JSON.parse(s.raw('chat_history_role')).map(x => x.mid), ['a', 'b']);
});

test('legacy writers save when unchanged, but preserve corrupt and quota-failed records', () => {
    const initial = '[{"mid":"a"}]';
    const s = storage({ chat_history_role: initial });
    assert.equal(legacyFixture(s, initial).save([{ mid: 'a' }, { mid: 'b' }]), true);
    const malformed = storage({ chat_history_role: 'bad-json' });
    assert.equal(legacyFixture(malformed, 'bad-json').save([]), false);
    assert.equal(malformed.raw('chat_history_role'), 'bad-json');
    const quota = storage({ chat_history_role: initial }, { quota: true });
    assert.equal(legacyFixture(quota, initial).save([{ mid: 'new' }]), false);
    assert.equal(quota.raw('chat_history_role'), initial);
});

test('pagehide writes only an isolated journal, recovered under lock on next opening', async () => {
    const old = Array.from({ length: 2000 }, (_, i) => ({ mid: 'existing-' + i, type: 'text' }));
    const s = storage({ chat_history_role: JSON.stringify(old) });
    const c = tab(s, locks());
    let pagehide;
    const window = { addEventListener(name, listener) { if (name === 'pagehide') pagehide = listener; } };
    let aiSending = true;
    const journal = section('        let inflightSnapshot = null;', '        // 3. 核心真实 AI 聊天发送逻辑');
    const factory = new Function('window', 'localStorage', 'currentCharacter', 'stripInternalReasoning',
        'loadMessages', 'appendChatSafely', 'renderAllMessages', '_vl', 'console',
        'getSending', 'setSending',
        'var _chatHistoryUnreadable = false;\n' +
        'var aiSending = getSending();\n' +
        journal + '\nreturn {setSnapshot(v) { inflightSnapshot = v; }, recoverInFlightJournals};');
    const writer = factory(window, s, { id: 'role' }, s => s,
        () => JSON.parse(s.getItem('chat_history_role')),
        c.appendChatSafely, () => {}, null, { warn() {} }, () => aiSending, v => { aiSending = v; });
    writer.setSnapshot({ text: 'partial reply', voiceMode: 'online' });
    pagehide();
    assert.equal(JSON.parse(s.raw('chat_history_role')).length, 2000);
    assert.equal(s.length, 2);
    const journalKey = s.key(1);
    assert.match(journalKey, /^chat_inflight_journal_role_/);
    const restored = factory(window, s, { id: 'role' }, s => s,
        () => JSON.parse(s.getItem('chat_history_role')),
        c.appendChatSafely, () => {}, null, { warn() {} }, () => false, v => {});
    await restored.recoverInFlightJournals();
    assert.equal(s.raw(journalKey), undefined);
    const history = JSON.parse(s.raw('chat_history_role'));
    assert.equal(history.length, 2001);
    assert.equal(history.at(-1).text, 'partial reply');
});

test('main chat script parses and all P0 routes use protected save functions', () => {
    const inline = [...detail.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
        .map(match => match[1]).filter(Boolean);
    inline.forEach(code => { if (code.trim()) new Script(code); });
    assert.match(detail, /chat-history-atomic\.js\?v=20261118v3/);
    assert.match(detail, /await appendChatSafely\(\[userMsg\]\)/);
    assert.match(detail, /await appendChatSafely\(aiNewMessages\)/);
    assert.match(detail, /await replaceChatSafely\(aiWriteBaseline, historyList\)/);
    assert.match(detail, /await replaceChatSafely\(originalSnapshot, keep\)/);
    assert.doesNotMatch(journal, /saveMessages\(/);
});
