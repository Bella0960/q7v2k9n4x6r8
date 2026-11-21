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
