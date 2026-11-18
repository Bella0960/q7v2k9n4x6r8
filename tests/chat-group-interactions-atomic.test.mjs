import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const atomicSource = readFileSync(new URL('../shared/js/phone/chat-history-atomic.js', import.meta.url), 'utf8');
function section(start, end) {
    const a = html.indexOf(start), b = html.indexOf(end, a);
    assert.ok(a >= 0 && b > a, 'missing group interaction source section');
    return html.slice(a, b);
}
const formSource = section('            var composerSubmitting = false;',
    "            var messageContainer = document.getElementById('chat-messages');");
const clickSource = section("            messageContainer.addEventListener('click', async function (event) {",
    '        })();');
const formFactory = new Function('composerForm', 'composerSubmit', 'composerMode',
    'composerQuestion', 'composerOptions', 'composerEntry', 'composerTargetMid',
    'loadMessages', 'ensureMid', 'appendChatSafely', 'replaceChatSafely',
    'closeComposer', 'renderAllMessages', 'showToast', 'maybeStartGroupActivity', 'console',
    'var handler;\n' +
    'var registration = composerForm.addEventListener.bind(composerForm);\n' +
    formSource + '\nreturn composerForm.handler;');
const clickFactory = new Function('messageContainer', 'loadMessages', 'ensureMid',
    'replaceChatSafely', 'renderAllMessages', 'showToast', 'openComposer', 'location',
    clickSource + '\nreturn messageContainer.handler;');

function fixture(items = []) {
    const values = new Map([['chat_history_group', JSON.stringify(items)]]);
    const localStorage = {
        getItem: key => values.has(key) ? values.get(key) : null,
        setItem(key, value) { values.set(key, String(value)); }
    };
    const pending = new Map();
    const locks = {
        request(name, options, fn) {
            assert.equal(options.mode, 'exclusive');
            const next = (pending.get(name) || Promise.resolve()).then(fn);
            pending.set(name, next.catch(() => {}));
            return next;
        }
    };
    const window = { navigator: { locks }, localStorage };
    runInNewContext(atomicSource, { window });
    const loadMessages = () => JSON.parse(localStorage.getItem('chat_history_group'));
    let mids = 0;
    const ensureMid = message => message.mid || (message.mid = 'group-mid-' + ++mids);
    const append = messages => window.ChatHistoryAtomic.appendManyIf('group', messages).then(r => r.ok);
    const replace = (old, next) => window.ChatHistoryAtomic.replaceIfUnchanged('group', old, next).then(r => r.ok);
    const notes = [];
    let renders = 0;
    const display = { render: () => { renders += 1; }, toast: message => notes.push(message) };
    return {
        window, localStorage, loadMessages, ensureMid, append, replace,
        display, notes, get renders() { return renders; }
    };
}
function createForm(f, mode, opts = {}) {
    const form = { addEventListener(name, fn) { if (name === 'submit') this.handler = fn; } };
    const submit = { disabled: false };
    const handler = formFactory(
        form, submit, mode,
        { value: opts.question || '去哪儿？', focus() {} },
        { value: opts.options || '公园\n咖啡馆', focus() {} },
        { value: opts.entry || '我先来', focus() {} },
        opts.targetMid || 'chain',
        f.loadMessages, f.ensureMid, f.append, opts.replace || f.replace,
        () => {}, f.display.render, f.display.toast, () => {}, { warn() {} }
    );
    return { handler, submit };
}
function click(f, selector, attributes = {}, replace = f.replace) {
    const container = { addEventListener(name, fn) { if (name === 'click') this.handler = fn; } };
    const listener = clickFactory(container, f.loadMessages, f.ensureMid,
        replace, f.display.render, f.display.toast, () => {}, { href: '' });
    const btn = { getAttribute(key) { return attributes[key]; } };
    return listener({ target: { closest(query) { return query === selector ? btn : null; } } });
}

test('group poll and chain creation append without losing 2000 old messages', async () => {
    const original = Array.from({ length: 2000 }, (_, i) => ({
        mid: 'old-' + i, type: i % 2 ? 'image' : 'voice',
        assetId: 'asset-' + i
    }));
    const f = fixture(original);
    await createForm(f, 'poll').handler({ preventDefault() {} });
    await createForm(f, 'chain').handler({ preventDefault() {} });
    const saved = f.loadMessages();
    assert.equal(saved.length, 2002);
    assert.deepEqual(saved.slice(0, 2000), original);
    assert.equal(saved[2000].type, 'group_poll');
    assert.equal(saved[2001].type, 'group_chain');
});

test('two simultaneous form submits create only one poll', async () => {
    const f = fixture();
    const form = createForm(f, 'poll');
    await Promise.all([
        form.handler({ preventDefault() {} }),
        form.handler({ preventDefault() {} })
    ]);
    assert.equal(f.loadMessages().length, 1);
    assert.equal(form.submit.disabled, false);
});

test('stale chain join and stale poll vote fail closed after another tab sends', async () => {
    const f = fixture([
        { mid: 'chain', type: 'group_chain', chain: { title: '接龙', entries: [], closed: false } },
        { mid: 'poll', type: 'group_poll', poll: { question: '哪里？', options: ['A', 'B'], votes: {}, closed: false } }
    ]);
    const staleReplace = async (expected, next) => {
        await f.window.ChatHistoryAtomic.appendIf('group', {
            mid: 'remote-' + Date.now() + Math.random(), role: 'user', text: 'another tab'
        });
        return f.replace(expected, next);
    };
    await createForm(f, 'join', { targetMid: 'chain', replace: staleReplace }).handler({ preventDefault() {} });
    await click(f, '[data-poll-mid][data-poll-option]',
        { 'data-poll-mid': 'poll', 'data-poll-option': '1' }, staleReplace);
    const saved = f.loadMessages();
    assert.equal(saved[0].chain.entries.length, 0);
    assert.deepEqual(saved[1].poll.votes, {});
    assert.equal(saved.length, 4);
});

test('successful vote and close actions preserve existing history fields', async () => {
    const f = fixture([
        { mid: 'poll', role: 'user', type: 'group_poll',
            poll: { question: 'What?', options: ['A', 'B'], votes: {}, closed: false }, metadata: { keep: true } },
        { mid: 'chain', type: 'group_chain', chain: { title: 'Topic', entries: [], closed: false } }
    ]);
    await click(f, '[data-poll-mid][data-poll-option]',
        { 'data-poll-mid': 'poll', 'data-poll-option': '1' });
    await click(f, '[data-poll-close]', { 'data-poll-close': 'poll' });
    await click(f, '[data-chain-close]', { 'data-chain-close': 'chain' });
    const now = f.loadMessages();
    assert.equal(now[0].poll.votes.__user, 1);
    assert.equal(now[0].poll.closed, true);
    assert.equal(now[1].chain.closed, true);
    assert.deepEqual(now[0].metadata, { keep: true });
});

test('all group poll/chain button writes use guarded append or CAS', () => {
    assert.match(formSource, /appendChatSafely\(\[message\]\)/);
    assert.match(formSource, /appendChatSafely\(\[chainMessage\]\)/);
    assert.match(formSource, /replaceChatSafely\(joinBaseline, joinHistory\)/);
    assert.match(clickSource, /replaceChatSafely\(pollBaseline, history\)/);
    assert.match(clickSource, /replaceChatSafely\(pollCloseBaseline, pollHistory\)/);
    assert.match(clickSource, /replaceChatSafely\(chainCloseBaseline, closeHistory\)/);
    assert.doesNotMatch(formSource + clickSource, /saveMessages\(/);
});
