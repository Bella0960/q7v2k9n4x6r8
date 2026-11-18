import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const detail = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const atomicSource = readFileSync(new URL('../shared/js/phone/chat-history-atomic.js', import.meta.url), 'utf8');
const start = detail.indexOf('if (replySaved && queuedGroupPrivateMessages.length) {');
const end = detail.indexOf('var avatarRoleId =', start);
assert.ok(start > 0 && end > start);
const deliverySource = detail.slice(start, end);
const executeDelivery = new Function('window', 'currentCharacter', 'queuedGroupPrivateMessages',
    'showToast', 'showGroupPrivatePopup', 'loadMessages', 'replySaved',
    'var historyList = [];\nreturn (async function () {\n' +
    deliverySource + '\nreturn historyList;\n});');

function storage(initial) {
    const map = new Map(Object.entries(initial));
    return {
        getItem(key) { return map.has(key) ? map.get(key) : null; },
        setItem(key, value) { map.set(key, String(value)); },
        get(key) { return map.get(key); }
    };
}
function locks() {
    const pending = new Map();
    return { request(name, options, work) {
        assert.equal(options.mode, 'exclusive');
        const next = (pending.get(name) || Promise.resolve()).then(work);
        pending.set(name, next.catch(() => {}));
        return next;
    } };
}
function fixture({ corruptTarget = false, missingTarget = false, replySaved = true } = {}) {
    const groupHistory = Array.from({ length: 2000 }, (_, i) => ({ mid: 'g-' + i, mode: 'online' }));
    const privateHistory = Array.from({ length: 2000 }, (_, i) => ({
        mid: 'p-' + i, type: i % 2 ? 'image' : 'text', assetId: 'asset-' + i
    }));
    const data = {
        chat_history_group: JSON.stringify(groupHistory)
    };
    if (!missingTarget) data.chat_history_role = corruptTarget ? 'broken-json' : JSON.stringify(privateHistory);
    const localStorage = storage(data);
    const window = { localStorage, navigator: { locks: locks() } };
    runInNewContext(atomicSource, { window });
    const queue = [{
        targetId: 'role',
        privateMsg: { mid: 'private-mid', role: 'assistant', text: 'private', privateFromGroup: true },
        groupMessage: { mid: 'card-mid', role: 'assistant', text: 'private', type: 'group_private' },
        displayName: '角色',
        privateMessageText: 'private'
    }];
    const toasts = [];
    const popups = [];
    const loadMessages = () => JSON.parse(localStorage.getItem('chat_history_group'));
    const deliver = executeDelivery(window, { id: 'group' }, queue, msg => toasts.push(msg),
        (...args) => popups.push(args), loadMessages, replySaved);
    return { localStorage, groupHistory, privateHistory, window, queue, toasts, popups, deliver };
}

test('private delivery and group card preserve both 2000-message histories', async () => {
    const f = fixture();
    await f.deliver();
    const privateNow = JSON.parse(f.localStorage.get('chat_history_role'));
    const groupNow = JSON.parse(f.localStorage.get('chat_history_group'));
    assert.equal(privateNow.length, 2001);
    assert.equal(groupNow.length, 2001);
    assert.deepEqual(privateNow.slice(0, 2000), f.privateHistory);
    assert.deepEqual(groupNow.slice(0, 2000), f.groupHistory);
    assert.equal(privateNow.at(-1).mid, 'private-mid');
    assert.equal(groupNow.at(-1).mid, 'card-mid');
    assert.equal(f.popups.length, 1);
});

test('same group private delivery can retry without duplicates', async () => {
    const f = fixture();
    await f.deliver();
    await f.deliver();
    assert.equal(JSON.parse(f.localStorage.get('chat_history_role')).length, 2001);
    assert.equal(JSON.parse(f.localStorage.get('chat_history_group')).length, 2001);
});

test('corrupt or missing private history stays unchanged without showing a delivered card', async () => {
    for (const options of [{ corruptTarget: true }, { missingTarget: true }]) {
        const f = fixture(options);
        const previous = f.localStorage.get('chat_history_role');
        await f.deliver();
        assert.equal(f.localStorage.get('chat_history_role'), previous);
        assert.equal(JSON.parse(f.localStorage.get('chat_history_group')).length, 2000);
        assert.equal(f.popups.length, 0);
        assert.equal(f.toasts.length, 1);
    }
});

test('failed group AI reply does not deliver a private message', async () => {
    const f = fixture({ replySaved: false });
    await f.deliver();
    assert.equal(JSON.parse(f.localStorage.get('chat_history_role')).length, 2000);
    assert.equal(JSON.parse(f.localStorage.get('chat_history_group')).length, 2000);
});

test('private marker only queues delivery, not direct stale PhoneStorage writes', () => {
    const start = detail.indexOf('text = text.replace(/\\[群私聊');
    const end = detail.indexOf('text = text.replace(/\\[群动作', start);
    assert.ok(start > 0 && end > start);
    const block = detail.slice(start, end);
    assert.match(block, /queuedPrivateMessages\.push/);
    assert.doesNotMatch(block, /saveChatHistory|saveMessages\(|localStorage\.setItem/);
    assert.match(deliverySource, /ChatHistoryAtomic\.appendIf\(delivery\.targetId, delivery\.privateMsg\)/);
});
