import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../shared/js/phone/phone_storage.js', import.meta.url), 'utf8');
const old = { id: 'old', role: 'sent', text: '旧记录' };
const fresh = { id: 'fresh', role: 'sent', text: '新记录' };

function fixture() {
    const entries = {
        phone_data_v2: { solo: { chat: { history: [old] }, memories: { items: [old] }, diary: { keep: true } },
            group: { chat: { history: [old] }, memories: { items: [old] } } },
        chat_history_solo: [old], chat_memories_solo: [old], chat_summary_processed_solo: 9,
        chat_last_summary_solo: 1, chat_summary_auto_solo: 0, chat_history_other: [old]
    };
    const data = new Map(Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)]));
    const localStorage = {
        getItem: key => data.get(key) ?? null,
        setItem: (key, value) => data.set(key, value),
        removeItem: key => data.delete(key)
    };
    const window = {};
    vm.runInNewContext(source, { window, console, localStorage });
    return { storage: window.PhoneStorage, data, localStorage };
}

test('chat clear removes primary and fallback records only for the chosen conversation', () => {
    const { storage, data } = fixture();
    assert.equal(storage.clearConversationMemory('solo', true), true);
    assert.equal(storage.getChatHistory('solo').length, 0);
    assert.equal(storage.getMemories('solo').length, 0);
    assert.equal(data.has('chat_summary_processed_solo'), false);
    assert.equal(data.has('chat_last_summary_solo'), false);
    assert.equal(data.get('chat_summary_auto_solo'), '0');
    const root = JSON.parse(data.get('phone_data_v2'));
    assert.deepEqual(root.solo, { diary: { keep: true } });
    assert.equal(root.group.chat.history.length, 1);
    assert.equal(storage.clearConversationMemory('group', true), true);
    assert.equal(storage.getMemoryArchiveEntries('group').length, 0);
    assert.equal(storage.getMemories('group').length, 0);
    assert.equal(storage.getChatHistory('other').length, 1);
});

test('archive deletion and memory-only clear preserve chat and display later messages', () => {
    const { storage, localStorage } = fixture();
    const first = storage.getMemoryArchiveEntries('solo')[0];
    assert.equal(storage.hideMemoryArchiveEntry('solo', first.key), true);
    assert.equal(storage.getMemoryArchiveEntries('solo').length, 0);
    assert.equal(storage.getChatHistory('solo').length, 1);
    const revision = storage.getMemoryArchive('solo').revision;
    assert.equal(storage.clearConversationMemory('solo', false), true);
    assert.notEqual(storage.getMemoryArchive('solo').revision, revision);
    assert.equal(storage.getMemories('solo').length, 0);
    assert.equal(storage.getChatHistory('solo').length, 1);
    localStorage.setItem('chat_history_solo', JSON.stringify([old, fresh]));
    assert.equal(storage.getMemoryArchiveEntries('solo')[0].message.id, 'fresh');
});

test('a late write failure rolls back both primary and compatibility data', () => {
    const { storage, data, localStorage } = fixture();
    const original = Object.fromEntries(data);
    const setItem = localStorage.setItem;
    localStorage.setItem = (key, value) => {
        if (key.startsWith('chat_memory_archive_v1_')) throw new Error('quota');
        return setItem(key, value);
    };
    assert.equal(storage.clearConversationMemory('solo', true), false);
    assert.deepEqual(Object.fromEntries(data), original);
});
