import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const detail = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const atomicSource = readFileSync(new URL('../shared/js/phone/chat-history-atomic.js', import.meta.url), 'utf8');

function extract(start, end) {
    const a = detail.indexOf(start);
    const b = detail.indexOf(end, a);
    assert.ok(a >= 0 && b > a);
    return detail.slice(a, b);
}
function store(initial) {
    const values = new Map([['chat_history_role', initial]]);
    return {
        getItem(k) { return values.has(k) ? values.get(k) : null; },
        setItem(k, v) { values.set(k, String(v)); },
        raw() { return values.get('chat_history_role'); }
    };
}
function lock() {
    const queues = new Map();
    return { request(name, options, fn) {
        assert.equal(options.mode, 'exclusive');
        const next = (queues.get(name) || Promise.resolve()).then(fn);
        queues.set(name, next.catch(() => {}));
        return next;
    } };
}
const appendHelpers = extract('        async function appendChatSafely(messages, guard) {',
    '        function saveMessages(list) {');
const makeHelpers = new Function('window', 'currentCharacter', 'storageKey', 'showToast',
    '_chatHistoryUnreadable', appendHelpers + '\nreturn { appendChatSafely, replaceChatSafely };');

const imageSource = extract('        async function generateRoleImageFromChat(sceneHint) {',
    '        // system_error 去重');
const imageFactory = new Function(
    'window', 'document', 'currentCharacter', 'isGroupChat',
    'loadMessages', 'appendChatSafely', 'replaceChatSafely',
    'renderAllMessages', 'showToast', 'ensureMid',
    'var _chatImageGenerationRunning = false;\n' +
    imageSource + '\nreturn generateRoleImageFromChat;'
);

function fixture(onGenerate, old = [{ mid: 'original', text: 'keep', type: 'voice' }]) {
    const localStorage = store(JSON.stringify(old));
    const window = { localStorage, navigator: { locks: lock() } };
    runInNewContext(atomicSource, { window });
    const toast = [];
    const safe = makeHelpers(window, { id: 'role' }, 'chat_history_role',
        text => toast.push(text), false);
    let counter = 0;
    const input = { value: '/photo night' };
    window.PhoneImageGeneration = {
        generate: onGenerate || (async () => ({
            chatReferenceAdded: true, assetId: 'asset-1',
            record: { id: 'record-1' }, sceneDescription: 'night'
        })),
        safeFailure(error) { return error.message || 'error'; }
    };
    const load = () => JSON.parse(localStorage.raw());
    const generate = imageFactory(window, { getElementById: () => input }, { id: 'role', name: 'Role' },
        false, load, safe.appendChatSafely, safe.replaceChatSafely, () => {},
        text => toast.push(text), message => { if (!message.mid) message.mid = 'image-' + ++counter; });
    return { window, localStorage, toast, input, generate, load, safe };
}

test('photo generation updates pending image while preserving long rich history', async () => {
    const original = Array.from({ length: 2000 }, (_, i) => ({
        mid: 'old-' + i, type: i % 2 ? 'image' : 'voice',
        assetId: 'asset-old-' + i
    }));
    const f = fixture(null, original);
    await f.generate('moon');
    const list = f.load();
    assert.equal(list.length, 2001);
    assert.deepEqual(list.slice(0, 2000), original);
    assert.equal(list.at(-1).type, 'image');
    assert.equal(list.at(-1).assetId, 'asset-1');
    assert.equal(list.at(-1).imageRecordId, 'record-1');
    assert.equal(f.input.value, '');
});

test('another tab message arriving during image generation is never discarded', async () => {
    let finish;
    const f = fixture(async () => new Promise(resolve => { finish = resolve; }));
    const pending = f.generate('street');
    while (!finish) await Promise.resolve();
    assert.equal((await f.window.ChatHistoryAtomic.appendIf('role',
        { mid: 'other-tab', text: 'concurrent' })).ok, true);
    finish({ chatReferenceAdded: true, assetId: 'new-image',
        record: { id: 'id-2' }, sceneDescription: 'street' });
    await pending;
    const history = f.load();
    assert.deepEqual(history.map(m => m.mid), ['original', 'image-1', 'other-tab']);
    assert.equal(history[1].type, 'image');
});

test('failed image generation leaves original messages and one failure card', async () => {
    const f = fixture(async () => { throw new Error('mock failure'); });
    await f.generate('bad');
    const history = f.load();
    assert.equal(history.length, 2);
    assert.equal(history[0].mid, 'original');
    assert.equal(history[1].role, 'system_error');
    assert.match(history[1].text, /mock failure/);
});

test('failure marker on a user message uses CAS and rejects concurrent append', async () => {
    const source = extract('        function _locateUserMessageIndex(list, mid, time) {',
        '        // 一键重试：');
    const compiled = new Function('replaceChatSafely', source + '\nreturn _markUserSendFailed;');
    const f = fixture();
    const user = { mid: 'send-1', role: 'user', text: 'hi', time: 123 };
    assert.equal(await f.safe.appendChatSafely([user]), true);
    const stale = f.load();
    const mark = compiled(f.safe.replaceChatSafely);
    await f.window.ChatHistoryAtomic.appendIf('role', { mid: 'other', role: 'assistant', text: 'new' });
    assert.equal(await mark(stale, user.mid, user.time), false);
    assert.equal(f.load().length, 3);
    assert.equal(f.load()[1].sendFailed, undefined);
});

test('photo, retry, and translation no longer persist stale whole histories', () => {
    const retry = extract('        window.retryFailedMessage = async function',
        '        // ================= 礼物拆开动画');
    const translate = extract('        async function translateMessage(bubbleId) {',
        '        // R3 防重入锁');
    assert.match(imageSource, /await appendChatSafely\(\[pending\]\)/);
    assert.match(imageSource, /replaceChatSafely\(imageEditBaseline, latest\)/);
    assert.match(imageSource, /replaceChatSafely\(imageFailureBaseline, failed\)/);
    assert.match(retry, /replaceChatSafely\(originalSnapshot, list\)/);
    assert.match(translate, /replaceChatSafely\(originalSnapshot, list\)/);
    assert.doesNotMatch(imageSource + retry + translate, /saveMessages\(/);
});
