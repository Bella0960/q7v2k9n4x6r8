import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext, Script } from 'node:vm';

const pageSource = readFileSync(new URL('../chat/date/date.html', import.meta.url), 'utf8');
const atomicSource = readFileSync(new URL('../shared/js/phone/chat-history-atomic.js', import.meta.url), 'utf8');

function section(start, end) {
    const a = pageSource.indexOf(start);
    const b = pageSource.indexOf(end, a);
    assert.ok(a >= 0 && b > a, start);
    return pageSource.slice(a, b);
}
const storageSource = section("    var HISTORY_KEY = 'chat_history_' + roleId;",
    '    // Real send/reply paths use the same Web Lock');
const writerSource = section('    var dateRerollPending = null;',
    '    /* ---------- 本地内容生成（预览用，不依赖 API）');
const createPage = new Function('window', 'localStorage', 'roleId', 'toast', 'console',
    storageSource + writerSource + '\n' +
    'var history = loadHistory();\n' +
    'return { loadHistory, saveHistory, appendDateMessage, commitDateReply,' +
    'getHistory: () => history, setReroll(index) {' +
    'dateRerollPending={index,baseline:JSON.parse(JSON.stringify(history))};},' +
    'getReplaced: () => dateReplyWasReplacement, getUnreadable:()=>_dateHistoryUnreadable };'
);

function store(seed) {
    const values = new Map(Object.entries(seed));
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        raw(key) { return values.get(key); }
    };
}
function locks() {
    const chains = new Map();
    return { request(name, options, work) {
        assert.equal(options.mode, 'exclusive');
        const promise = (chains.get(name) || Promise.resolve()).then(work);
        chains.set(name, promise.catch(() => {}));
        return promise;
    } };
}
function fixture(initial, shared, roleId = 'role') {
    const localStorage = shared?.localStorage || store({ ['chat_history_' + roleId]: initial });
    const lock = shared?.lock || locks();
    const window = { localStorage, navigator: { locks: lock } };
    runInNewContext(atomicSource, { window });
    const toasts = [];
    const page = createPage(window, localStorage, roleId, msg => toasts.push(msg), { error() {}, warn() {} });
    return { ...page, window, localStorage, lock, toasts };
}

test('online and long-offline concurrent append preserve all 2000 old messages', async () => {
    const old = Array.from({ length: 2000 }, (_, i) => ({
        mid: 'message-' + i, mode: i % 2 ? 'online' : 'date',
        type: i % 3 ? 'text' : 'image', assetId: 'asset-' + i
    }));
    const localStorage = store({ chat_history_role: JSON.stringify(old) });
    const lock = locks();
    const a = fixture('', { localStorage, lock });
    const b = fixture('', { localStorage, lock });
    const results = await Promise.all([
        a.appendDateMessage({ role: 'user', text: 'offline user', mode: 'date', time: 111 }),
        b.appendDateMessage({ role: 'assistant', text: 'online reply', mode: 'online', time: 222 })
    ]);
    assert.deepEqual(results, [true, true]);
    const list = JSON.parse(localStorage.raw('chat_history_role'));
    assert.equal(list.length, 2002);
    assert.deepEqual(list.slice(0, 2000), old);
    assert.equal(list.at(-1).text, 'online reply');
});

test('regeneration only replaces the targeted reply when snapshot unchanged', async () => {
    const old = [
        { mid: 'user', role: 'user', text: 'hi', mode: 'date' },
        { mid: 'old-ai', role: 'assistant', text: 'original', mode: 'date' },
        { mid: 'keep', role: 'user', text: 'extra', mode: 'online' }
    ];
    const f = fixture(JSON.stringify(old));
    f.setReroll(1);
    assert.equal(await f.commitDateReply({ role: 'assistant', text: 'replacement', mode: 'date' }), true);
    assert.equal(f.getReplaced(), true);
    const saved = JSON.parse(f.localStorage.raw('chat_history_role'));
    assert.equal(saved.length, 3);
    assert.equal(saved[1].text, 'replacement');
    assert.deepEqual(saved.filter((_, index) => index !== 1), old.filter((_, index) => index !== 1));
});

test('concurrent new message cancels regeneration without deleting old reply', async () => {
    const old = [
        { mid: 'user', role: 'user', text: 'hi' },
        { mid: 'old-ai', role: 'assistant', text: 'original' }
    ];
    const f = fixture(JSON.stringify(old));
    f.setReroll(1);
    assert.equal(await f.appendDateMessage({ role: 'user', text: 'other tab' }), true);
    assert.equal(await f.commitDateReply({ role: 'assistant', text: 'replacement' }), false);
    const saved = JSON.parse(f.localStorage.raw('chat_history_role'));
    assert.equal(saved[1].text, 'original');
    assert.equal(saved.length, 3);
    assert.equal(f.getReplaced(), false);
});

test('malformed history is preserved and all offline writes stop', async () => {
    for (const raw of ['broken-json', '{"not":"an array"}']) {
        const f = fixture(raw);
        assert.equal(f.getUnreadable(), true);
        assert.equal(await f.appendDateMessage({ role: 'assistant', text: 'blocked' }), false);
        assert.equal(f.saveHistory([{ role: 'assistant', text: 'unsafe' }], []), false);
        assert.equal(f.localStorage.raw('chat_history_role'), raw);
    }
});

test('legacy synchronous offline edits cannot overwrite another tab', async () => {
    const raw = JSON.stringify([{ role: 'assistant', text: 'old' }]);
    const f = fixture(raw);
    const other = fixture('', { localStorage: f.localStorage, lock: f.lock });
    assert.equal(await other.appendDateMessage({ role: 'user', text: 'new' }), true);
    assert.equal(f.saveHistory([{ role: 'assistant', text: 'edited' }], []), false);
    assert.deepEqual(JSON.parse(f.localStorage.raw('chat_history_role')).map(m => m.text), ['old', 'new']);
});

test('long-offline reroll never deletes original message before API result', () => {
    const act = section('    function actReroll() {', '    // 保存：把当前线下模式剧情导出');
    const target = section('    function rerollMsg(idx) {', '    // 编辑：就地改为可编辑文本');
    for (const code of [act, target]) {
        assert.doesNotMatch(code, /saveHistory\(|history\.pop\(|history\.splice\(/);
        assert.match(code, /dateRerollPending/);
        assert.match(code, /requestReply\(/);
    }
    assert.match(pageSource, /await commitDateReply\(aiMsg\)/);
    assert.match(pageSource, /await commitDateReply\(offlineReply\)/);
    assert.match(pageSource, /await appendDateMessage\(userMsg\)/);
});


test('long-offline delete refuses to erase a message written by another tab', async () => {
    const before = [
        { mid: 'a', role: 'assistant', text: 'original' },
        { mid: 'b', role: 'user', text: 'other' }
    ];
    const f = fixture(JSON.stringify(before));
    const fragment = section('    async function deleteMsg(idx) {', '    // 长按检测：');
    let persisted = f.getHistory();
    const unsafeWriter = new Function('history', 'replaceDateHistorySafely', 'renderAll',
        'scrollBottom', 'toast', 'sending', fragment + '\nreturn deleteMsg;');
    const messages = [];
    const remove = unsafeWriter(persisted, async (expected, next) => {
        const result = await f.window.ChatHistoryAtomic.replaceIfUnchanged('role', expected, next);
        return result.ok;
    }, () => {}, () => {}, message => messages.push(message), false);
    // Concurrent history write must make the editor's snapshot stale.
    await f.window.ChatHistoryAtomic.appendIf('role', { mid: 'late', role: 'user', text: 'new' });
    await remove(0);
    assert.deepEqual(JSON.parse(f.localStorage.raw('chat_history_role')).map(m => m.mid), ['a', 'b', 'late']);
});

test('long-offline edit and delete callbacks use CAS and never call legacy whole-history save', () => {
    const edit = section('    function editMsg(idx) {', '    // 删除：从剧情与聊天记录中移除');
    const remove = section('    async function deleteMsg(idx) {', '    // 长按检测：');
    assert.match(edit, /btnSave\.addEventListener\('click', async function/);
    assert.match(edit, /await replaceDateHistorySafely\(original, replacement\)/);
    assert.match(remove, /await replaceDateHistorySafely\(original, replacement\)/);
    assert.doesNotMatch(edit + remove, /saveHistory\(/);
});

test('offline AI streaming has a rejection handler that clears pending regeneration', () => {
    const request = section('    function requestReply(nudge) {', '    function setSending(on) {');
    assert.match(request, /catch\(function \(error\) \{\s*dateRerollPending = null/);
    assert.match(request, /setSending\(false\)/);
    assert.match(request, /原有记录已保留/);
});

test('long-offline page retains valid JavaScript and existing UI structure', () => {
    const scripts = [...pageSource.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
        .map(m => m[1]).filter(Boolean);
    scripts.forEach(script => { if (script.trim()) new Script(script); });
    assert.match(pageSource, /chat-history-atomic\.js\?v=20261118v3/);
    assert.match(pageSource, /<div class="page">/);
});
