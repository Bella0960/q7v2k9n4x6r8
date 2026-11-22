// Executes the production PhoneStorage and MemoryRecall modules under quota pressure.
// No personal data or real browser storage is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = path => readFileSync(resolve(root, path), 'utf8');

function environment(quota = 1e9) {
  let allowedQuota = quota;
  const data = new Map();
  const events = [];
  const usage = () => [...data].reduce((sum, [key, value]) => sum + key.length + value.length, 0);
  const localStorage = {
    get length() { return data.size; },
    key: n => [...data.keys()][n] ?? null,
    getItem: key => data.has(String(key)) ? data.get(String(key)) : null,
    removeItem: key => data.delete(String(key)),
    setItem(key, value) {
      key = String(key);
      value = String(value);
      const before = data.has(key) ? key.length + data.get(key).length : 0;
      if (usage() - before + key.length + value.length > allowedQuota) {
        const error = new Error('quota exceeded');
        error.name = 'QuotaExceededError';
        throw error;
      }
      data.set(key, value);
    }
  };
  class CustomEvent {
    constructor(type, options) { this.type = type; this.detail = options?.detail; }
  }
  const win = {
    localStorage, CustomEvent, Date, JSON, Math, Set, Object, Array, String, Number, RegExp,
    console: { log() {}, warn() {}, error() {} },
    dispatchEvent(event) { events.push(event); return true; }
  };
  win.window = win;
  const context = vm.createContext(win);
  for (const path of ['shared/js/phone/phone_storage.js', 'shared/js/phone/memory_recall.js']) {
    vm.runInContext(source(path), context, { filename: path });
  }
  return { win, data, events, localStorage, used: usage, setQuota: amount => { allowedQuota = amount; } };
}
const history = n => Array.from({ length: n }, (_, i) => ({
  role: 'sent', text: 'message-' + i + '-' + 'x'.repeat(60), time: i
}));

test('normal chat and memory writes succeed without warning', () => {
  const { win, events, localStorage } = environment();
  assert.equal(win.PhoneStorage.saveChatHistory('a', history(3)), true);
  assert.equal(win.MemoryRecall.saveMemories('a', [{ content: 'test' }]), true);
  assert.ok(localStorage.getItem('chat_history_a'));
  assert.ok(localStorage.getItem('chat_memories_a'));
  assert.equal(events.length, 0);
});

test('quota error never replaces the previous chat history', () => {
  const { win, events, localStorage } = environment(3000);
  assert.equal(win.PhoneStorage.saveChatHistory('a', history(5)), true);
  const previous = localStorage.getItem('chat_history_a');
  assert.equal(win.PhoneStorage.saveChatHistory('a', history(200)), false);
  assert.equal(localStorage.getItem('chat_history_a'), previous);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'phone:storage-failure');
  assert.equal(events[0].detail.key, 'chat_history_a');
  assert.equal(events[0].detail.error, 'QuotaExceededError');
  assert.equal(Object.hasOwn(events[0].detail, 'value'), false);
});

test('failed memory write returns false without creating a new key', () => {
  const { win, localStorage, used, setQuota } = environment();
  setQuota(used() + 60);
  assert.equal(win.MemoryRecall.saveMemories('a', [{ content: 'm'.repeat(700) }]), false);
  assert.equal(localStorage.getItem('chat_memories_a'), null);
});

test('failed memory upsert returns save-failed instead of a false success', () => {
  const { win, localStorage, used, setQuota } = environment();
  setQuota(used() + 60);
  const result = win.MemoryRecall.upsertMemory('a', { content: 'm'.repeat(600) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'save-failed');
  assert.equal(localStorage.getItem('chat_memories_a'), null);
});

test('successful memory upsert remains compatible with existing role storage', () => {
  const { win } = environment();
  assert.equal(win.MemoryRecall.upsertMemory('a', { content: 'drinks green tea' }).ok, true);
  assert.equal(win.PhoneStorage.getMemories('a').length, 1);
  assert.equal(win.PhoneStorage.getMemories('b').length, 0);
});

test('quota error does not destroy the phone_data_v2 duplicate', () => {
  const { win, localStorage, used, setQuota } = environment();
  localStorage.setItem('phone_data_v2', JSON.stringify({ a: { memories: { items: [{ content: 'old' }] } } }));
  setQuota(used() + 60);
  assert.equal(win.PhoneStorage.saveMemories('a', [{ content: 'n'.repeat(600) }]), false);
  assert.equal(JSON.parse(localStorage.getItem('phone_data_v2')).a.memories.items[0].content, 'old');
});

test('silently dropped memory writes fail verification and preserve the legacy copy', () => {
  const { win, localStorage, events } = environment();
  const legacy = JSON.stringify({ a: { memories: { items: [{ content: 'old' }] } } });
  localStorage.setItem('phone_data_v2', legacy);
  const normalSet = localStorage.setItem;
  localStorage.setItem = (key, value) => {
    if (key !== 'chat_memories_a') normalSet(key, value);
  };
  assert.equal(win.PhoneStorage.saveMemories('a', [{ content: 'new' }]), false);
  assert.equal(localStorage.getItem('chat_memories_a'), null);
  assert.equal(localStorage.getItem('phone_data_v2'), legacy);
  assert.equal(events.at(-1).detail.error, 'WriteNotPersisted');
});

test('unreadable primary memory preflight blocks write and preserves legacy data', () => {
  const { win, localStorage, events } = environment();
  const legacy = JSON.stringify({ a: { memories: { items: [{ content: 'old' }] } } });
  localStorage.setItem('phone_data_v2', legacy);
  const normalGet = localStorage.getItem;
  localStorage.getItem = key => {
    if (key === 'chat_memories_a') throw new Error('primary read unavailable');
    return normalGet(key);
  };
  assert.equal(win.PhoneStorage.saveMemories('a', [{ content: 'new' }]), false);
  assert.equal(localStorage.getItem('phone_data_v2'), legacy);
  assert.equal(events.at(-1).detail.error, 'PrimaryUnavailable');
});

test('unreadable post-write memory readback blocks legacy cleanup', () => {
  const { win, localStorage, events } = environment();
  const legacy = JSON.stringify({ a: { memories: { items: [{ content: 'old' }] } } });
  localStorage.setItem('phone_data_v2', legacy);
  const normalGet = localStorage.getItem;
  let reads = 0;
  localStorage.getItem = key => {
    if (key === 'chat_memories_a' && ++reads > 1) throw new Error('readback unavailable');
    return normalGet(key);
  };
  assert.equal(win.PhoneStorage.saveMemories('a', [{ content: 'new' }]), false);
  assert.equal(localStorage.getItem('phone_data_v2'), legacy);
  assert.equal(events.at(-1).detail.error, 'ReadbackUnavailable');
});

test('corrupt primary memories are never silently overwritten', () => {
  const { win, localStorage, events } = environment();
  localStorage.setItem('chat_memories_a', '{"unfinished":');
  const broken = localStorage.getItem('chat_memories_a');
  assert.equal(win.PhoneStorage.saveMemories('a', [{ content: 'new' }]), false);
  assert.equal(localStorage.getItem('chat_memories_a'), broken);
  assert.equal(events.at(-1).detail.error, 'CorruptPrimary');
});

test('non-array primary memories remain untouched even if legacy v2 looks usable', () => {
  const { win, localStorage, events } = environment();
  localStorage.setItem('chat_memories_a', '{"old":"payload"}');
  localStorage.setItem('phone_data_v2', JSON.stringify({
    a: { memories: { items: [{ content: 'legacy' }] } }
  }));
  const previous = localStorage.getItem('phone_data_v2');
  assert.equal(win.PhoneStorage.saveMemories('a', [{ content: 'new' }]), false);
  assert.equal(localStorage.getItem('chat_memories_a'), '{"old":"payload"}');
  assert.equal(localStorage.getItem('phone_data_v2'), previous);
  assert.equal(events.at(-1).detail.error, 'CorruptPrimary');
});

test('invalid memory target or non-array input does not write new records', () => {
  const { win, localStorage } = environment();
  assert.equal(win.PhoneStorage.saveMemories('', [{ content: 'bad' }]), false);
  assert.equal(win.PhoneStorage.saveMemories('a', null), false);
  assert.equal(localStorage.getItem('chat_memories_'), null);
  assert.equal(localStorage.getItem('chat_memories_a'), null);
});

test('memory management actions do not claim success after storage failure', () => {
  const html = source('worldbook/memory/memory.html');
  assert.match(html, /const dedupRoleId = currentMemId;/);
  assert.match(html, /String\(currentMemId\) !== String\(dedupRoleId\)/);
  assert.match(html, /JSON\.stringify\(arr\) !== dedupSnapshot/);
  assert.match(html, /if \(!saveMemories\(dedupRoleId, arr\)\) \{ alert\('记忆保存失败/);
  assert.match(html, /if \(!saveMemories\(mergeRoleId, arr\)\) \{/);
  assert.match(html, /const mergeRoleId = currentMemId;/);
  assert.match(html, /const mems = loadMemories\(mergeRoleId\);/);
  assert.match(html, /if \(!saveMemories\(currentMemId, arr\)\) \{ alert\('保存失败/);
});

test('failure reporting cannot itself cause a second failure', () => {
  const { win } = environment(100);
  win.dispatchEvent = undefined;
  assert.equal(win.PhoneStorage.rawSet('test', 'x'.repeat(500)), false);
});

test('chat summary cursor advances only after successful memory persistence', () => {
  const html = source('chat/chat/chat-detail.html');
  const guard = html.indexOf('if (!memSaved)');
  const cursor = html.lastIndexOf("localStorage.setItem('chat_summary_processed_' + rid");
  assert.ok(guard !== -1 && cursor > guard);
  const block = html.slice(guard, cursor);
  assert.match(block, /sumToast\('本批记忆未保存/);
  assert.match(block, /return;/);
  assert.match(html, /addEventListener\('phone:storage-failure'/);
});

test('manual summary uses a stable role and does not advance after a rejected save', () => {
  const html = source('worldbook/memory/memory.html');
  const start = html.indexOf('async function runSummary(historySlice, isAll, processedTo)');
  const end = html.indexOf('// ---- 记忆工具 ----', start);
  assert.ok(start !== -1 && end > start);
  const summary = html.slice(start, end);
  assert.match(summary, /const summaryId = currentMemId;/);
  assert.match(summary, /if \(!saveMemories\(summaryId, mems\)\)/);
  assert.doesNotMatch(summary, /saveMemories\(currentMemId/);
  assert.doesNotMatch(summary, /'chat_summary_processed_' \+ currentMemId/);
});
