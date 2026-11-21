import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const page = readFileSync(new URL('../chat/date/date.html', import.meta.url), 'utf8');
const start = page.indexOf("    var HISTORY_KEY = 'chat_history_' + roleId;");
const end = page.indexOf('    /* ---------- 本地内容生成', start);
assert.ok(start >= 0 && end > start);
assert.match(page, /var history = loadEditableHistory\(\);/);

function setup(raw = null, legacy = []) {
    const key = 'chat_history_role-a';
    const records = new Map(raw === null ? [] : [[key, raw]]);
    const localStorage = {
        getItem: (name) => records.get(name) ?? null,
        setItem: (name, value) => records.set(name, value)
    };
    const warnings = [];
    const context = {
        roleId: 'role-a', localStorage,
        toast: (message) => warnings.push(message),
        console: { error() {} },
        window: { PhoneStorage: {
            getChatHistory: (id) => JSON.parse(records.get('chat_history_' + id) ?? JSON.stringify(legacy)),
            saveChatHistory: (id, list) => {
                localStorage.setItem('chat_history_' + id, JSON.stringify(list));
                return true;
            }
        } }
    };
    runInNewContext(page.slice(start, end), context);
    return { context, key, records, warnings };
}

test('a stale long-offline editor cannot overwrite newer chat even after a prompt read', () => {
    const { context, key, records, warnings } = setup('[{"text":"old"}]');
    const history = context.loadEditableHistory();
    const newer = '[{"text":"old"},{"text":"new online message"}]';
    records.set(key, newer);
    assert.equal(context.loadHistory().length, 2);
    const rollback = history.slice();
    history.push({ text: 'late offline reply' });
    assert.equal(context.saveHistory(history, rollback), false);
    assert.equal(records.get(key), newer);
    assert.equal(history.length, 1);
    assert.match(warnings[0], /刷新页面/);
});

test('first save migrates legacy history and advances the snapshot for later saves', () => {
    const legacy = [{ text: 'legacy' }];
    const { context, key, records } = setup(null, legacy);
    const history = context.loadEditableHistory();
    history.push({ text: 'first offline reply' });
    assert.equal(context.saveHistory(history), true);
    history.push({ text: 'second offline reply' });
    assert.equal(context.saveHistory(history), true);
    assert.deepEqual(JSON.parse(records.get(key)).map((item) => item.text),
        ['legacy', 'first offline reply', 'second offline reply']);
});

test('legacy changes, corrupt storage and role drift block writes', () => {
    const legacy = [{ text: 'legacy' }];
    const stale = setup(null, legacy);
    const history = stale.context.loadEditableHistory();
    legacy.push({ text: 'new legacy entry' });
    assert.equal(stale.context.saveHistory(history), false);
    assert.equal(stale.records.has(stale.key), false);

    const corrupt = setup('{broken');
    assert.equal(corrupt.context.loadEditableHistory().length, 0);
    assert.equal(corrupt.context.saveHistory([{ text: 'unsafe' }]), false);
    assert.equal(corrupt.records.get(corrupt.key), '{broken');

    const wrongRole = setup('[]');
    wrongRole.context.loadEditableHistory();
    wrongRole.context.roleId = 'role-b';
    assert.equal(wrongRole.context.saveHistory([{ text: 'unsafe' }]), false);
    assert.equal(wrongRole.records.has('chat_history_role-b'), false);
});


test('a failed edit keeps the unsaved textarea visible for copying', () => {
    const start = page.indexOf('    function editMsg(idx) {');
    const end = page.indexOf('    // 删除：从剧情', start);
    assert.ok(start >= 0 && end > start, 'must exercise real editMsg implementation');

    const history = [{ role: 'assistant', text: 'original reply' }];
    let editor;
    let renderCount = 0;
    let scrollCount = 0;

    function element(tag) {
        return {
            tag, style: {}, children: [], handlers: {},
            appendChild(child) { this.children.push(child); },
            addEventListener(type, handler) { this.handlers[type] = handler; },
            before(node) { editor = node; },
            remove() { this.removed = true; }
        };
    }
    const anchor = element('div');
    const context = {
        history,
        storyEl: { querySelectorAll: () => [anchor] },
        document: { createElement: element },
        saveHistory: () => false,
        renderAll: () => { renderCount++; },
        scrollBottom: () => { scrollCount++; },
        toast: () => {},
        setTimeout: () => {}
    };
    runInNewContext(page.slice(start, end), context);
    context.editMsg(0);

    const textarea = editor.children[0];
    textarea.value = 'edited text that has not been saved';
    const actions = editor.children[1];
    actions.children[0].handlers.click();

    assert.equal(history[0].text, 'original reply');
    assert.equal(textarea.value, 'edited text that has not been saved');
    assert.equal(renderCount, 0, 'rerender would destroy the unsaved edit box');
    assert.equal(scrollCount, 0);
    assert.equal(anchor.style.display, 'none', 'editor must remain visible');
    actions.children[1].handlers.click();
    assert.equal(anchor.style.display, '', 'cancel restores the original bubble');
    assert.equal(editor.removed, true);
});

test('a stale send keeps the original input draft and never requests AI', () => {
    const start = page.indexOf('    function send() {');
    const end = page.indexOf('    /* ---------- 三颗行动钮', start);
    assert.ok(start >= 0 && end > start, 'must exercise real send implementation');

    const input = { value: 'draft that must not disappear', style: {} };
    const history = [{ role: 'assistant', text: 'prior reply' }];
    const sendingStates = [];
    let apiCalls = 0;
    let appended = 0;
    const context = {
        input, history, sceneName: 'test scene', sending: false,
        generatingReplyOptions: false,
        closeReplyOptionsPanel: () => {},
        setSending: value => sendingStates.push(value),
        saveHistory: () => false,
        appendMessage: () => { appended++; },
        requestReply: () => { apiCalls++; }
    };
    runInNewContext(page.slice(start, end), context);
    context.send();

    assert.equal(input.value, 'draft that must not disappear');
    assert.equal(history.length, 1, 'failed persistence must not add a phantom message');
    assert.equal(apiCalls, 0, 'never contact AI for an unsaved message');
    assert.equal(appended, 0, 'no unsaved bubble may appear');
    assert.deepEqual(sendingStates, [true, false]);
});
