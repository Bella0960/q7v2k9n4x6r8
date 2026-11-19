import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pageSource = readFileSync(new URL('../chat/call/call.html', import.meta.url), 'utf8');
const atomicSource = readFileSync(new URL('../shared/js/phone/chat-history-atomic.js', import.meta.url), 'utf8');
const start = pageSource.indexOf('  var endingCall=false;');
const end = pageSource.indexOf("  document.getElementById('btnHangup').addEventListener('click', endCall);", start);
assert.ok(start >= 0 && end > start, 'group-call writer should be extractable');
const writerSource = pageSource.slice(start, end);
const createWriter = new Function(
    'window', 'document', 'sessionStorage', 'roleId', 'callType', 'connected',
    'seconds', 'isGroupCall', 'currentGroup', 'connectTimer', 'tickTimer',
    'formatTime', 'clearTimeout', 'clearInterval', 'alert', 'console',
    writerSource + '\nreturn endCall;'
);

function fixture(options = {}) {
    const messages = options.messages || Array.from({ length: 2000 }, (_, i) => ({
        mid: 'existing-' + i, type: i % 2 ? 'image' : 'text',
        mode: i % 2 ? 'date' : 'online',
        assetId: i % 2 ? 'image-' + i : undefined
    }));
    const values = new Map([['chat_history_group', JSON.stringify(messages)]]);
    const localStorage = {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); }
    };
    const window = {
        localStorage,
        navigator: { locks: { request: async (_lockName, _options, callback) => callback() } },
        location: { href: 'before-call' }
    };
    new Function('window', atomicSource)(window);
    const receipt = {};
    const alerts = [];
    const hangup = { disabled: false };
    const endCall = createWriter(
        window,
        { getElementById: () => hangup },
        { setItem: (key, value) => { receipt[key] = value; } },
        'group', 'voice', true, 35,
        options.isGroupCall !== false,
        { members: [{ name: 'member A' }, { nickname: 'member B' }] },
        0, 0, seconds => String(seconds),
        () => {}, () => {},
        message => alerts.push(message),
        { error() {} }
    );
    return {
        endCall, window, alerts, receipt, hangup,
        history: () => JSON.parse(values.get('chat_history_group'))
    };
}

test('group call adds one receipt without overwriting rich messages', async () => {
    const f = fixture();
    await f.endCall();
    const history = f.history();
    assert.equal(history.length, 2001);
    assert.equal(history[0].mid, 'existing-0');
    assert.equal(history[1999].mid, 'existing-1999');
    assert.equal(history.at(-1).type, 'call');
    assert.deepEqual(history.at(-1).call.participants, ['member A', 'member B']);
    assert.equal(history.at(-1).call.duration, 35);
    assert.match(f.window.location.href, /chat-detail\.html\?id=group/);
    assert.equal(f.alerts.length, 0);
    assert.equal(JSON.parse(f.receipt.call_result_group).duration, 35);
});

test('two hangup clicks cannot save two group-call receipts', async () => {
    const f = fixture();
    await Promise.all([f.endCall(), f.endCall()]);
    assert.equal(f.hangup.disabled, true);
    assert.equal(f.history().length, 2001);
});

test('missing lock is a failed group receipt, never a deleted conversation', async () => {
    const f = fixture({ messages: [{ mid: 'old', text: 'keep' }] });
    f.window.navigator = {};
    await f.endCall();
    assert.deepEqual(f.history(), [{ mid: 'old', text: 'keep' }]);
    assert.equal(f.alerts.length, 1);
    assert.match(f.window.location.href, /chat-detail\.html\?id=group/);
});

test('ordinary one-to-one call does not append a group receipt', async () => {
    const f = fixture({ isGroupCall: false, messages: [{ mid: 'keep' }] });
    await f.endCall();
    assert.deepEqual(f.history(), [{ mid: 'keep' }]);
    assert.equal(f.alerts.length, 0);
});

test('call page loads the atomic helper and no longer overwrites full history', () => {
    assert.match(pageSource, /chat-history-atomic\.js\?v=20261118v3/);
    assert.match(writerSource, /await atomic\.appendIf\(roleId,callMessage\)/);
    assert.doesNotMatch(writerSource, /saveChatHistory|localStorage\.setItem/);
});
