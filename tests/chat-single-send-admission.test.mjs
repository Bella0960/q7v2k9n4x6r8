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
    source.indexOf('        // Only the model\'s TEMPORARY history sees')
);

function setup(isGroupChat, sendMsgTurn) {
    const toasts = [];
    let scopeCurrent = true;
    const sandbox = { window: {}, isGroupChat, groupPageExited: false, readGroupScope: () => scopeCurrent ? {} : null, sendMsgTurn, showToast: message => toasts.push(message) };
    runInNewContext('let aiSending = false, singleChatSendPending = false, inflightSnapshot = null, singleChatPartialSaved = false, groupInterruptedSave = null, _retryInFlight = false;\n' + admission + retry, sandbox);
    return { send: sandbox.sendMsg, retry: sandbox.window.retryFailedMessage, toasts, revoke: () => { scopeCurrent = false; } };
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

// The integrated group engine serializes turns too; the next follow-up is
// admitted after the current request has finished, never recursively.
test('group follow-ups keep the existing scoped send path without concurrent entry', async () => {
    let finish;
    const turns = [];
    const {send, revoke, toasts} = setup(true, opts => {
        turns.push(opts.text);
        return new Promise(resolve => { finish = resolve; });
    });
    const first = send({text:'first'});
    await send({text:'overlap',groupFollowup:true});
    assert.deepEqual(turns,['first']);
    finish('sent'); assert.equal(await first,'sent');
    const next=send({text:'follow-up',groupFollowup:true});
    finish('follow-up sent'); assert.equal(await next,'follow-up sent');
    revoke();await send({text:'revoked',groupFollowup:true});
    assert.deepEqual(turns,['first','follow-up']);assert.equal(toasts.length,2);
});
