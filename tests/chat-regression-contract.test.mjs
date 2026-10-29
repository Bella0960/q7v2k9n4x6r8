import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

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
const policySource = read('shared/js/phone/chat-message-policy.js');
const policyWindow = {};
runInNewContext(policySource, { window: policyWindow, globalThis: {} });
const policy = policyWindow.ChatMessagePolicy;
const serviceWorker = read('sw.js');
const packageJson = JSON.parse(read('package.json'));

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

test('pure message policy matches the expected online visibility and search eligibility', () => {
  assert.ok(policy, 'ChatMessagePolicy should be exposed by the shared script');
  for (const item of fixtures.cases) {
    assert.equal(
      !policy.isHiddenFromOnlineTimeline(item.message),
      item.expected.onlineVisible,
      item.id + ': onlineVisible'
    );
    assert.equal(
      policy.isSearchableMessage(item.message),
      item.expected.searchable,
      item.id + ': searchable'
    );
  }
});

test('reasoning cleanup preserves visible prose and removes internal-only blocks', () => {
  assert.equal(typeof policy.stripInternalReasoning, 'function');
  const cases = [
    { input: '你好，<think>私密推理</think>世界', expected: '你好，世界' },
    { input: 'a<reasoning>secret</reasoning>b<analysis>hidden</analysis>c', expected: 'abc' },
    { input: '<THINK mode="x">secret</THINK>visible', expected: 'visible' },
    { input: 'visible<think>unfinished', expected: 'visible' },
    { input: 'ordinary reply', expected: 'ordinary reply' },
    { input: null, expected: '' }
  ];
  for (const item of cases) {
    assert.equal(policy.stripInternalReasoning(item.input), item.expected, String(item.input));
  }
});

test('memory marker extraction cleans visible text without performing storage writes', () => {
  assert.equal(typeof policy.extractMemoryMarkers, 'function');
  const cases = [
    { input: '你好[记住:喜欢海边]世界', text: '你好世界', memories: ['喜欢海边'] },
    {
      input: 'A [记住: 重要约定 ]\n\n\nB [记住:继续使用旧版模式]\n',
      text: 'A\n\nB',
      memories: ['重要约定', '继续使用旧版模式']
    },
    { input: 'A[记住:   ]B', text: 'AB', memories: [] },
    { input: null, text: '', memories: [] }
  ];
  for (const item of cases) {
    const result = policy.extractMemoryMarkers(item.input);
    assert.equal(result.text, item.text, String(item.input));
    assert.deepEqual(Array.from(result.memories), item.memories, String(item.input));
  }
  assert.match(detail, /ChatMessagePolicy\.extractMemoryMarkers/);
  assert.match(detail, /function saveUserMemories\(memories\)/);
});

test('reply content parser preserves narration extraction and bubble splitting', () => {
  assert.equal(typeof policy.parseReplyContent, 'function');
  const cases = [
    {
      input: 'Hi\n\nHow are you?',
      expected: { thinks: [], narrations: [], bubbles: ['Hi', 'How are you?'] }
    },
    {
      input: '<narratage>（轻声）</narratage>\n你好\n\n第二段',
      expected: { thinks: [], narrations: ['（轻声）'], bubbles: ['你好', '第二段'] }
    },
    {
      input: '第一段<narratage>旁白一</narratage>第二段<narratage>旁白二</narratage>',
      expected: { thinks: [], narrations: ['旁白一', '旁白二'], bubbles: ['第一段第二段'] }
    },
    {
      input: '<narratage>   </narratage>\n正文',
      expected: { thinks: [], narrations: [], bubbles: ['正文'] }
    },
    {
      input: '<think>内部内容</think>',
      expected: { thinks: [], narrations: [], bubbles: [] }
    },
    {
      input: '<narratage>未闭合标签',
      expected: { thinks: [], narrations: [], bubbles: ['<narratage>未闭合标签'] }
    }
  ];
  for (const item of cases) {
    assert.deepEqual(policy.parseReplyContent(item.input), item.expected, item.input);
  }
  assert.match(detail, /ChatMessagePolicy\.parseReplyContent/);
});

test('shared policy is loaded by both relevant pages and precached for PWA', () => {
  assert.match(detail, /chat-message-policy\.js\?v=20261029v4/);
  assert.match(search, /chat-message-policy\.js\?v=20261029v4/);
  assert.match(serviceWorker, /phone-app-pwa-v114/);
  assert.match(serviceWorker, /chat-message-policy\.js\?v=20261029v4/);
  assert.equal(
    packageJson.scripts['test:chat:contract'],
    'node --test tests/chat-regression-contract.test.mjs'
  );
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
  assert.match(detail, /ChatMessagePolicy\.stripInternalReasoning/);
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
  assert.match(detail, /m\.status === 'confirmed'/);
  assert.match(memoryRecall, /reinforcementCount/);
  assert.match(memoryRecall, /lastReinforcedAt/);
  assert.match(memoryRecall, /saveMemories:saveMemories/);
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
