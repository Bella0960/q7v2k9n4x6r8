import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const admission = source.slice(
    source.indexOf('        async function sendMsg(opts) {'),
    source.indexOf('        async function sendMsgTurn(opts) {')
);
const retry = source.slice(
    source.indexOf('        window.retryFailedMessage ='),
    source.indexOf('        // ================= 礼物拆开动画')
);

function setup(isGroupChat, sendMsgTurn) {
    const toasts = [];
    const sandbox = { window: {}, isGroupChat, sendMsgTurn, showToast: message => toasts.push(message) };
    runInNewContext('let aiSending = false, singleChatSendPending = false;\n' + admission + retry, sandbox);
    return { send: sandbox.sendMsg, retry: sandbox.window.retryFailedMessage, toasts };
}

test('single chat blocks competing sends and retries during asynchronous preparation', async () => {
    let finish;
    const turns = [];
    const { send, retry, toasts } = setup(false, opts => {
        turns.push(opts.text);
        return new Promise(resolve => { finish = resolve; });
    });
    const first = send({ text: 'first' });
    await send({ text: 'second' });
    retry('old-message', 1);
    assert.deepEqual(turns, ['first']);
    assert.equal(toasts.length, 2);
    finish();
    await first;
    const next = send({ text: 'second' });
    finish();
    await next;
    assert.deepEqual(turns, ['first', 'second']);
});

test('single chat releases its admission lock when preparation rejects', async () => {
    const { send } = setup(false, async opts => {
        if (opts.fail) throw new Error('preparation failed');
        return 'sent';
    });
    await assert.rejects(send({ fail: true }), /preparation failed/);
    assert.equal(await send({ fail: false }), 'sent');
});

test('group follow-ups keep the existing send path', async () => {
    let send;
    ({ send } = setup(true, async opts => (
        opts.groupFollowup ? 'follow-up sent' : send({ groupFollowup: true })
    )));
    assert.equal(await send({}), 'follow-up sent');
});
