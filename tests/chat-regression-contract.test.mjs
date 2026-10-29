import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

const detail = read('chat/chat/chat-detail.html');
const extras = read('chat/chat/js/chat-extras.js');
const search = read('chat/chat/chat-search.html');
const storage = read('shared/js/phone/phone_storage.js');
const stream = read('shared/js/phone/phone_stream.js');
const memoryRecall = read('shared/js/phone/memory_recall.js');
const date = read('chat/date/date.html');
const journey = read('chat/date/journey.html');
const fixtures = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/chat-message-cases.json'), 'utf8'));

test('synthetic fixture set covers the compatibility-critical message families', () => {
  const ids = fixtures.cases.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, 'fixture case IDs must be unique');

  for (const item of fixtures.cases) {
    assert.ok(item.message && typeof item.message === 'object', item.id);
    assert.ok(item.expected && typeof item.expected === 'object', item.id);
    for (const key of ['onlineVisible', 'searchable', 'includedInContext']) {
      assert.equal(typeof item.expected[key], 'boolean', `${item.id}: expected.${key}`);
    }
  }

  for (const required of [
    'ordinary-user', 'legacy-content-field', 'image-message', 'sticker-message',
    'date-mode-message', 'silent-instruction', 'system-error',
    'group-speaker', 'forwarded-message', 'call-card-without-text'
  ]) {
    assert.ok(ids.includes(required), `missing fixture: ${required}`);
  }
});

test('chat detail retains the legacy load/save entry points and role-scoped storage', () => {
  assert.match(detail, /function loadMessages\(\)/);
  assert.match(detail, /function saveMessages\(list\)/);
  assert.match(detail, /_storage\.getChatHistory\(currentCharacter\.id\)/);
  assert.match(detail, /_storage\.saveChatHistory\(currentCharacter\.id, list\)/);
  assert.match(detail, /localStorage\.getItem\(storageKey\)/);
  assert.match(detail, /localStorage\.setItem\(storageKey, JSON\.stringify\(list\)\)/);
});

test('online rendering and search preserve date/silent filtering and error exclusion', () => {
  assert.match(detail, /m\.mode === 'date' \|\| m\.silent/);
  assert.match(search, /m\.mode === 'date' \|\| m\.silent/);
  assert.match(detail, /定位失败/);
  assert.match(search, /定位失败/);
  assert.match(search, /if \(isErrorMsg\(mm\)\) continue/);
  assert.match(search, /matched\.push\(\{ msg: mm, idx: i \}\)/);
});

test('message identity and model-context mapping keep compatibility fields', () => {
  assert.match(detail, /function ensureMid\(msg\)/);
  assert.match(detail, /row\.dataset\.mid = ensureMid\(msg\)/);
  assert.match(detail, /m\.text \|\| m\.content/);
  assert.match(detail, /m\.role === 'sent' \|\| m\.role === 'user'/);
  assert.match(detail, /m\.role === 'received' \|\| m\.role === 'assistant'/);
  assert.match(detail, /m\.isError \|\| m\.role === 'system_error'/);
  assert.match(detail, /memberId: groupReplyPick && groupReplyPick\.id/);
});

test('streaming stays behind PhoneStream and keeps partial-reply handling', () => {
  assert.match(detail, /const streamResult = await PhoneStream\.chat\(/);
  assert.match(detail, /onPaint: paintStreamLive/);
  assert.match(detail, /fullText = streamResult\.fullText/);
  assert.match(stream, /result\.fullText = fullText/);
  assert.match(stream, /finish\(e\)/);
  assert.match(stream, /WATCHDOG_MS/);
  assert.match(stream, /TOTAL_MS/);
});

test('context size controls and local historical recall remain bounded', () => {
  assert.match(detail, /persona: 5000/);
  assert.match(detail, /memory: 3000/);
  assert.match(detail, /userMemory: 2000/);
  assert.match(detail, /worldbook: 8000/);
  assert.match(detail, /rpComposed: 16000/);
  assert.match(detail, /const recentHistory = historyList\.slice\(-memoryLimit\)/);
  assert.match(detail, /buildHistoricalRecallText\(historyList, recallQuery/);
  assert.match(detail, /maxItems: 2/);
  assert.match(detail, /maxChars: 540/);
  assert.match(detail, /maxScan: 2500/);
  assert.match(memoryRecall, /function searchHistoryMessages\(/);
  assert.match(memoryRecall, /function buildHistoricalRecallText\(/);
});

test('memory marker parsing and weighted memory semantics remain present', () => {
  assert.match(detail, /function extractMemoryMarkers\(raw\)/);
  assert.match(detail, /function saveUserMemories\(memories\)/);
  assert.match(detail, /MemoryRecall\.upsertMemory\(/);
  assert.match(detail, /function trimMemoriesByWeight\(arr, max\)/);
  assert.match(detail, /m\.status === 'fixed'/);
  assert.match(detail, /status === 'pending'/);
  assert.match(memoryRecall, /reinforcementCount/);
  assert.match(memoryRecall, /lastReinforcedAt/);
  assert.match(memoryRecall, /NS\.saveMemories = function/);
});

test('chat extras keeps its current bridge dependency until a replacement is migrated', () => {
  for (const symbol of [
    'loadMessages', 'saveMessages', 'appendMessageToDOM', 'sendMsg',
    'showToast', 'currentCharacter', 'chatMessages'
  ]) {
    assert.ok(extras.includes(symbol), `chat-extras bridge symbol missing: ${symbol}`);
  }
  assert.match(detail, /<script src="js\/chat-extras\.js/);
  assert.match(detail, /window\.sendMsg = sendMsg/);
  assert.match(detail, /window\.regenerateReply = function/);
});

test('offline date mode shares the existing history key and marks scene messages', () => {
  assert.match(date, /var HISTORY_KEY = 'chat_history_' \+ roleId/);
  assert.match(date, /mode: 'date'/);
  assert.match(date, /_storage\.getChatHistory\(roleId\)/);
  assert.match(date, /_storage\.saveChatHistory\(roleId, list\)/);
  assert.match(journey, /var historyKey = 'chat_history_' \+ roleId/);
  assert.match(journey, /PhoneStorage\.saveChatHistory\(roleId,list\)/);
});

test('PhoneStorage remains backward-compatible and only compacts after a successful primary save', () => {
  assert.match(storage, /NS\.getChatHistory = function \(contactId\)/);
  assert.match(storage, /'chat_history_' \+ contactId/);
  assert.match(storage, /bucket\.chat\.history/);
  assert.match(storage, /NS\.saveChatHistory = function \(contactId, list\)/);
  assert.match(storage, /if \(!saved\) return false/);
  assert.match(storage, /NS\.saveMemories = function \(contactId, list\)/);
});

test('known external history writers remain on the migration inventory', () => {
  const callers = [
    'chat/call/call.html',
    'wallet/shop.html',
    'wallet/takeout.html',
    'wallet/family-cards.html',
    'forum/forum-detail.html'
  ];
  for (const caller of callers) {
    const source = read(caller);
    assert.ok(
      source.includes('chat_history_') || source.includes('saveChatHistory'),
      `${caller} no longer appears to use the documented chat-history contract; review before migrating it`
    );
  }
});
