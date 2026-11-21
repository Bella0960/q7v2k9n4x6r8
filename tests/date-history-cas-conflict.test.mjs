import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const sourcePath = new URL('../shared/js/phone/phone_storage.js', import.meta.url);

function loadStorage(raw) {
  const source = readFileSync(sourcePath, 'utf8');
  const key = 'chat_history_role-a';
  const records = new Map();
  if (raw !== undefined && raw !== null) records.set(key, raw);
  const localStorage = {
    getItem: (name) => records.has(name) ? records.get(name) : null,
    setItem: (name, value) => { records.set(name, String(value)); },
    removeItem: (name) => { records.delete(name); },
    get length() { return records.size; },
    key: (index) => [...records.keys()][index] ?? null
  };
  const context = { localStorage, console: { warn() {}, error() {} }, window: {} };
  runInNewContext(source, context);
  return { NS: context.window.PhoneStorage, records, key };
}

test('PhoneStorage.result.saveChatHistory rejects a stale CAS token without writing', () => {
  const oldRaw = '[{"text":"old reply"}]';
  const { NS, records, key } = loadStorage(oldRaw);
  const staleToken = '[{"text":"stale editor snapshot"}]';
  const result = NS.result.saveChatHistory('role-a', [{ text: 'late offline reply' }], staleToken);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CONFLICT');
  assert.equal(records.get(key), oldRaw, 'a conflicting writer must never overwrite newer chat');
});

test('PhoneStorage.result.saveChatHistory commits when the CAS token matches', () => {
  const oldRaw = '[{"text":"old reply"}]';
  const { NS, records, key } = loadStorage(oldRaw);
  const next = [{ text: 'old reply' }, { text: 'offline reply' }];
  const result = NS.result.saveChatHistory('role-a', next, oldRaw);
  assert.equal(result.ok, true);
  assert.equal(records.get(key), JSON.stringify(next));
});

test('a missing primary accepts a null CAS token for first migration write', () => {
  const { NS, records, key } = loadStorage(null);
  const first = [{ text: 'first offline reply' }];
  const result = NS.result.saveChatHistory('role-a', first, null);
  assert.equal(result.ok, true);
  assert.equal(records.get(key), JSON.stringify(first));
});
