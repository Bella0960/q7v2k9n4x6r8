import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

const detail = read('chat/chat/chat-detail.html');
const groupPlay = read('chat/chat/group-play.html');
const inspectPhone = read('inspect-phone/phone.html');
const forumPage = read('forum/forum.html');
const footprint = read('chat/footprint/footprint.html');
const libraryReader = read('library/library.html');
const takeout = read('wallet/takeout.html');
const chatSettings = read('chat/chat/chat-settings.html');
const globalSettings = read('settings/settings.html');
const rpProtocolPage = read('worldbook/settings/rp-protocol.html');
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
const contextPolicySource = read('shared/js/phone/chat-context-policy.js');
const contextPolicyWindow = {};
runInNewContext(contextPolicySource, { window: contextPolicyWindow, globalThis: {} });
const contextPolicy = contextPolicyWindow.ChatContextPolicy;
const phoneContextSource = read('shared/js/phone/phone_context.js');
const phoneContextWindow = { PhoneStorage: {} };
runInNewContext(phoneContextSource, { window: phoneContextWindow });
const phoneContext = phoneContextWindow.PhoneContext;
const sendPolicySource = read('shared/js/phone/chat-send-policy.js');
const sendPolicyWindow = {};
runInNewContext(sendPolicySource, { window: sendPolicyWindow, globalThis: {} });
const sendPolicy = sendPolicyWindow.ChatSendPolicy;
const groupPolicySource = read('shared/js/phone/group-chat-policy.js');
const groupPolicyWindow = {};
runInNewContext(groupPolicySource, { window: groupPolicyWindow, globalThis: {} });
const groupPolicy = groupPolicyWindow.GroupChatPolicy;
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
    const result = policy.parseReplyContent(item.input);
    const actual = {
      thinks: Array.from(result.thinks),
      narrations: Array.from(result.narrations),
      bubbles: Array.from(result.bubbles)
    };
    assert.deepEqual(actual, item.expected, item.input);
  }
  assert.match(detail, /ChatMessagePolicy\.parseReplyContent/);
});

test('reply cleanup protects think/narration blocks while applying the existing cleanup callback', () => {
  assert.equal(typeof policy.cleanupReplyPreservingBlocks, 'function');
  const raw = '标点，，<think>think one!!</think>\n<narratage>旁白，</narratage>\n<think>think two??</think>正文，，';
  let callbackCalls = 0;
  let callbackInput = '';
  const result = policy.cleanupReplyPreservingBlocks(raw, (text) => {
    callbackCalls += 1;
    callbackInput = text;
    assert.equal(text.includes('<think>'), false);
    assert.equal(text.includes('<narratage>'), false);
    assert.equal((text.match(/THINK_BLOCK/g) || []).length, 2);
    assert.equal((text.match(/NARR_BLOCK/g) || []).length, 1);
    return text.replace(/，{2,}/g, '，').trim();
  });
  assert.equal(callbackCalls, 1);
  assert.equal(result, '标点，<think>think one!!</think>\n<narratage>旁白，</narratage>\n<think>think two??</think>正文，');
  assert.ok(callbackInput.includes('THINK_BLOCK'));
  assert.match(detail, /ChatMessagePolicy\.cleanupReplyPreservingBlocks/);
});

test('shared context policy preserves legacy history mapping rules without mutating source messages', () => {
  assert.equal(typeof contextPolicy.mapHistoryToApiMessages, 'function');
  const history = [
    { role: 'user', text: '你好' },
    { role: 'assistant', text: 'A<think>private</think>\n\n\n<narratage>旁白</narratage>\n\nB' },
    { role: 'received', type: 'sticker', desc: ' 开心 ' },
    { role: 'sent', type: 'sticker', desc: '' },
    { role: 'system_error', text: '不要进入上下文' },
    { role: 'assistant', isError: true, text: '也不要进入上下文' },
    { role: 'system', text: '未知角色仍不映射' },
    { role: 'assistant', text: '<narratage>只有旁白</narratage>' },
    { role: 'assistant', content: '最后一条 AI 回复' }
  ];
  const original = JSON.stringify(history);
  const actual = JSON.parse(JSON.stringify(
    contextPolicy.mapHistoryToApiMessages(history, policy.stripInternalReasoning)
  ));
  assert.deepEqual(actual, [
    { role: 'user', content: '你好' },
    { role: 'assistant', content: 'A\n\nB' },
    { role: 'assistant', content: '[用户发送了一张表情包，表达的意思是：开心。请理解其含义并自然回应，不要复述这段说明。]' },
    { role: 'user', content: '[用户发送了一张表情包，请结合语境自然回应。]' },
    { role: 'assistant', content: '最后一条 AI 回复' },
    { role: 'user', content: '(继续)' }
  ]);
  assert.equal(JSON.stringify(history), original, 'mapping must not mutate saved history objects');
  assert.match(detail, /ChatContextPolicy\.mapHistoryToApiMessages/);
  assert.match(detail, /Compatibility fallback: keep the legacy context mapping intact/);
});

test('quoted chat messages carry their source into the model context', () => {
  const mapped = JSON.parse(JSON.stringify(contextPolicy.mapHistoryToApiMessages([
    {
      role: 'user',
      text: '我觉得可以。',
      quote: { mid: 'm-source', authorName: 'TA', text: '那我们周末去看看？' }
    }
  ])));
  assert.deepEqual(mapped, [{
    role: 'user',
    content: '[引用回复上下文，原消息来自TA：「那我们周末去看看？」]\n我觉得可以。'
  }]);
});

test('shared context policy preserves per-role history limit precedence and recent slicing', () => {
  assert.equal(typeof contextPolicy.resolveMemoryLimit, 'function');
  assert.equal(typeof contextPolicy.selectRecentHistory, 'function');

  for (const limit of [10, 20, 30, 50]) {
    assert.equal(contextPolicy.resolveMemoryLimit(String(limit), 99), limit);
    assert.equal(contextPolicy.resolveMemoryLimit('  ' + limit + ' ', 99), limit);
  }

  assert.equal(contextPolicy.resolveMemoryLimit(null, 30), 30);
  assert.equal(contextPolicy.resolveMemoryLimit('5', 30), 30);
  assert.equal(contextPolicy.resolveMemoryLimit('invalid', 0), 20);
  assert.equal(contextPolicy.resolveMemoryLimit('30-extra', 99), 30, 'legacy parseInt behavior is preserved');
  assert.equal(contextPolicy.resolveMemoryLimit('5', '7'), '7', 'legacy config fallback value is not coerced');

  const history = Array.from({ length: 6 }, (_, i) => ({ role: 'user', text: 'm' + i }));
  const before = JSON.stringify(history);
  assert.deepEqual(
    JSON.parse(JSON.stringify(contextPolicy.selectRecentHistory(history, 3))),
    [{ role: 'user', text: 'm3' }, { role: 'user', text: 'm4' }, { role: 'user', text: 'm5' }]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(contextPolicy.selectRecentHistory(history, 20))),
    history
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(contextPolicy.selectRecentHistory([], 10))),
    []
  );
  assert.equal(JSON.stringify(history), before, 'recent history selection must not mutate saved history');
  assert.match(detail, /ChatContextPolicy\.resolveMemoryLimit/);
  assert.match(detail, /ChatContextPolicy\.selectRecentHistory/);
  assert.match(detail, /Compatibility fallback: preserve the page's original limit and slice behavior/);
});

test('shared context policy preserves local historical recall query and budget rules', () => {
  assert.equal(typeof contextPolicy.buildHistoricalRecallRequest, 'function');

  const history = [
    { role: 'user', text: '之前说过的老话题' },
    { role: 'assistant', text: '角色过去说的细节' },
    { role: 'sent', content: '旧消息只有 content 字段可用' },
    { role: 'system_error', text: '错误消息不应该变成召回查询' },
    { role: 'user', text: '' }
  ];

  assert.deepEqual(
    JSON.parse(JSON.stringify(contextPolicy.buildHistoricalRecallRequest(history, '当前正在问的问题', 12))),
    {
      query: '当前正在问的问题',
      options: { excludeRecent: 12, maxItems: 2, maxChars: 540, maxScan: 2500 }
    }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(contextPolicy.buildHistoricalRecallRequest(history, '', 4))),
    {
      query: '旧消息只有 content 字段可用',
      options: { excludeRecent: 4, maxItems: 2, maxChars: 540, maxScan: 2500 }
    }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(contextPolicy.buildHistoricalRecallRequest([], '', 0))),
    {
      query: '',
      options: { excludeRecent: 0, maxItems: 2, maxChars: 540, maxScan: 2500 }
    }
  );
  assert.match(detail, /ChatContextPolicy\.buildHistoricalRecallRequest/);
  assert.match(detail, /Compatibility fallback: preserve the original backwards query scan and limits/);
  assert.match(detail, /buildHistoricalRecallText\(historyList, recallQuery, recallOptions\)/);
});

test('shared context policy keeps explicitly scoped user memories role-isolated while preserving legacy globals', () => {
  assert.equal(typeof contextPolicy.filterUserMemoriesForRole, 'function');
  const memories = [
    { text: 'legacy global fact' },
    { content: 'role A fact', sourceRoleId: 'role-A' },
    { text: 'role B fact', sourceRoleId: 'role-B' },
    { content: 'numeric role fact', sourceRoleId: 7 }
  ];
  const before = JSON.stringify(memories);
  assert.deepEqual(
    JSON.parse(JSON.stringify(contextPolicy.filterUserMemoriesForRole(memories, 'role-A'))),
    [
      { text: 'legacy global fact' },
      { content: 'role A fact', sourceRoleId: 'role-A' }
    ]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(contextPolicy.filterUserMemoriesForRole(memories, 7))),
    [
      { text: 'legacy global fact' },
      { content: 'numeric role fact', sourceRoleId: 7 }
    ]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(contextPolicy.filterUserMemoriesForRole(memories, 'role-C'))),
    [{ text: 'legacy global fact' }]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(contextPolicy.filterUserMemoriesForRole(null, 'role-A'))),
    []
  );
  assert.equal(JSON.stringify(memories), before, 'memory filtering must not mutate stored memory objects');
  assert.match(detail, /ChatContextPolicy\.filterUserMemoriesForRole/);
  assert.match(detail, /Compatibility fallback: legacy entries without a role ID remain globally visible/);
});


test('shared context policy preserves weighted long-term memory injection tiers', () => {
  assert.equal(typeof contextPolicy.buildWeightedMemoryInjectionText, 'function');
  const memories = [
    { status: 'fixed', content: '固定事实', testWeight: 0.01 },
    { status: 'confirmed', content: '清晰事实B', testWeight: 0.81 },
    { content: '旧版无状态事实', testWeight: 0.65 },
    { status: 'confirmed', content: '清晰事实A', testWeight: 0.91 },
    { status: 'confirmed', content: '模糊事实B', testWeight: 0.24 },
    { status: 'confirmed', content: '模糊事实A', testWeight: 0.41 },
    { status: 'pending', content: '待确认内容不应注入', testWeight: 0.99 },
    { status: 'rejected', content: '非确认内容不应注入', testWeight: 0.98 },
    { status: 'confirmed', content: '低于阈值的内容', testWeight: 0.12 },
    { status: 'confirmed', testWeight: 0.99 }
  ];
  const before = JSON.stringify(memories);
  const actual = contextPolicy.buildWeightedMemoryInjectionText(memories, '  旧式摘要  ', (memory) => memory.testWeight);
  const expected = [
    '【你一直记得的事】（钉住的记忆，绝对不会忘，可自然提及）',
    '· 固定事实',
    '【你清晰记得的事】（可以自然地提及）',
    '· 清晰事实A',
    '· 清晰事实B',
    '· 旧版无状态事实',
    '【你隐约记得的事】（只有当对方主动提起相关话题时，你才回忆起来；平时不要主动提起）',
    '· 模糊事实A',
    '· 模糊事实B',
    '【过往长期记忆】旧式摘要'
  ].join('\n');
  assert.equal(actual, expected);
  assert.equal(actual.includes('待确认内容不应注入'), false);
  assert.equal(actual.includes('非确认内容不应注入'), false);
  assert.equal(actual.includes('低于阈值的内容'), false);
  assert.equal(JSON.stringify(memories), before, 'prompt composition must not mutate stored records');

  assert.equal(
    contextPolicy.buildWeightedMemoryInjectionText([], '  仅旧摘要  ', (memory) => memory.testWeight),
    '仅旧摘要'
  );
  assert.equal(
    contextPolicy.buildWeightedMemoryInjectionText([], '暂无记忆', (memory) => memory.testWeight),
    '暂无记忆'
  );
  assert.equal(
    contextPolicy.buildWeightedMemoryInjectionText(
      [{ status: 'pending', content: '待确认', testWeight: 1 }],
      '旧摘要',
      (memory) => memory.testWeight
    ),
    '【过往长期记忆】旧摘要'
  );
  assert.ok(detail.includes('ChatContextPolicy.buildWeightedMemoryInjectionText'));
  assert.ok(detail.includes('Compatibility fallback: preserve the original fixed/confirmed/pending and clear/vague rules'));
});

test('living worldbook retrieval respects nested entries, trigger modes and legacy books', () => {
  assert.equal(typeof contextPolicy.buildWorldbookInjectionText, 'function');
  const books = [
    {
      title: '日常生活',
      content: '不应与嵌套条目重复注入',
      keywords: ['海边'],
      entries: [
        { name: '雨天习惯', content: '下雨时会把窗户关小一点。', position: 'front', injectMode: 'keyword', keywords: ['下雨', '雨天'] },
        { name: '固定习惯', content: '每天早上先喝一杯温水。', position: 'middle', injectMode: 'always' },
        { name: '偶尔想起', content: '偶尔会去海边散步。', position: 'back', injectMode: 'keyword' },
        { name: '概率碎片', content: '最近在学做面包。', injectMode: 'probability', probability: 30 },
        { name: '已停用', content: '这条不能出现。', enabled: false, injectMode: 'always' }
      ]
    },
    { title: '旧版资料', content: '旧格式内容仍应保留。' }
  ];
  const result = contextPolicy.buildWorldbookInjectionText(books, {
    currentText: '今天外面下雨了，我想去海边。',
    recentMessages: [],
    random: () => 0.2,
    maxEntries: 20,
    maxChars: 8000
  });
  assert.ok(result.indexOf('雨天习惯') < result.indexOf('固定习惯'), 'front entries should appear first');
  assert.ok(result.includes('每天早上先喝一杯温水。'));
  assert.ok(result.includes('偶尔会去海边散步。'), 'book-level keywords should be inherited by entries');
  assert.ok(result.includes('最近在学做面包。'), 'probability entries should honor the supplied random source');
  assert.ok(result.includes('旧格式内容仍应保留。'));
  assert.equal(result.includes('不应与嵌套条目重复注入'), false);
  assert.equal(result.includes('这条不能出现'), false);

  const noTrigger = contextPolicy.buildWorldbookInjectionText([{
    title: '旧事',
    entries: [{ name: '毕业旅行', content: '曾经去过山城。', injectMode: 'keyword', keywords: ['毕业旅行'] }]
  }], { currentText: '晚饭吃什么', recentMessages: [], random: () => 0 });
  assert.equal(noTrigger, '');

  const recentTrigger = contextPolicy.buildWorldbookInjectionText([{
    title: '近期话题',
    entries: [{ name: '工作', content: '最近换了一个项目。', injectMode: 'keyword', keywords: ['新项目'] }]
  }], {
    currentText: '你今天忙吗？',
    recentMessages: [{ role: 'user', text: '我接手了一个新项目。' }]
  });
  assert.ok(recentTrigger.includes('最近换了一个项目。'), 'recent dialogue should keep a relevant entry available');
});

test('shared PhoneContext uses keyword-triggered living worldbook entries', () => {
  assert.equal(typeof phoneContext.buildWorldbookInjectionText, 'function');
  const result = phoneContext.buildWorldbookInjectionText([
    {
      title: '角色日常',
      entries: [
        { name: '固定习惯', content: '出门前总会检查钥匙。', injectMode: 'always' },
        { name: '夜间安排', content: '夜班结束后会去便利店买热饮。', injectMode: 'keyword', keywords: ['夜班'] },
        { name: '停用事项', content: '这条已停用。', enabled: false, injectMode: 'always' }
      ]
    }
  ], {
    recentMessages: [{ role: 'user', text: '我今天又要上夜班了。' }],
    maxEntries: 10,
    maxChars: 8000
  });
  assert.ok(result.includes('出门前总会检查钥匙。'));
  assert.ok(result.includes('夜班结束后会去便利店买热饮。'));
  assert.equal(result.includes('这条已停用'), false);
});

test('living worldbook retrieval applies entry and character-count budgets', () => {
  const entries = Array.from({ length: 6 }, (_, index) => ({
    name: '条目' + index,
    content: '设定内容' + index,
    injectMode: 'always',
    position: index === 5 ? 'back' : 'middle'
  }));
  const result = contextPolicy.buildWorldbookInjectionText([{ title: '预算', entries }], {
    maxEntries: 2,
    maxChars: 300
  });
  assert.equal((result.match(/【预算 ·/g) || []).length, 2);
  const clipped = contextPolicy.buildWorldbookInjectionText([{
    title: '长文本',
    entries: [{ name: '长条目', content: '甲'.repeat(100), injectMode: 'always' }]
  }], { maxChars: 24 });
  assert.ok(clipped.length <= 24);
  assert.ok(clipped.endsWith('…'));
});

test('send options normalization preserves legacy defaults and clamps group auto depth', () => {
  assert.equal(typeof sendPolicy.normalizeOptions, 'function');
  const asPlainObject = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(asPlainObject(sendPolicy.normalizeOptions(null, '  typed text  ')), {
    customText: '',
    silent: false,
    contextOnly: false,
    regenDirection: '',
    isRegen: false,
    isGroupFollowup: false,
    groupAutoDepth: 0,
    text: 'typed text'
  });
  assert.deepEqual(asPlainObject(sendPolicy.normalizeOptions({
    text: '  explicit prompt  ',
    silent: 1,
    contextOnly: true,
    regenDirection: '  previous  ',
    isRegenerate: true,
    groupFollowup: true,
    groupAutoDepth: '3'
  }, 'ignored input')), {
    customText: 'explicit prompt',
    silent: true,
    contextOnly: true,
    regenDirection: 'previous',
    isRegen: true,
    isGroupFollowup: true,
    groupAutoDepth: 3,
    text: 'explicit prompt'
  });
  assert.equal(sendPolicy.normalizeOptions({ groupAutoDepth: '-7' }, ' hi ').groupAutoDepth, 0);
  assert.equal(sendPolicy.normalizeOptions({ groupAutoDepth: 'not-a-number' }, ' hi ').groupAutoDepth, 0);
  assert.match(detail, /ChatSendPolicy\.normalizeOptions/);
  assert.match(detail, /Compatibility fallback: preserve the original sendMsg option normalization/);
});

test('send preflight keeps guard precedence and evaluates later checks lazily', () => {
  assert.equal(typeof sendPolicy.evaluatePreflight, 'function');

  const emptyCalls = [];
  assert.equal(sendPolicy.evaluatePreflight({
    text: '',
    isRegen: false,
    contextOnly: false,
    isBlocked: () => { emptyCalls.push('blocked'); return true; },
    isSending: () => { emptyCalls.push('sending'); return true; },
    isGroupChat: () => { emptyCalls.push('group'); return true; },
    hasGroup: () => { emptyCalls.push('hasGroup'); return true; },
    getAvailableGroupMembers: () => { emptyCalls.push('members'); return []; }
  }), 'empty');
  assert.deepEqual(emptyCalls, []);

  const blockedCalls = [];
  assert.equal(sendPolicy.evaluatePreflight({
    text: 'hi',
    isBlocked: () => { blockedCalls.push('blocked'); return true; },
    isSending: () => { blockedCalls.push('sending'); return true; },
    isGroupChat: () => { blockedCalls.push('group'); return true; },
    hasGroup: () => { blockedCalls.push('hasGroup'); return true; },
    getAvailableGroupMembers: () => { blockedCalls.push('members'); return []; }
  }), 'blocked');
  assert.deepEqual(blockedCalls, ['blocked']);

  const busyCalls = [];
  assert.equal(sendPolicy.evaluatePreflight({
    text: 'hi',
    isBlocked: () => { busyCalls.push('blocked'); return false; },
    isSending: () => { busyCalls.push('sending'); return true; },
    isGroupChat: () => { busyCalls.push('group'); return true; },
    hasGroup: () => { busyCalls.push('hasGroup'); return true; },
    getAvailableGroupMembers: () => { busyCalls.push('members'); return []; }
  }), 'busy');
  assert.deepEqual(busyCalls, ['blocked', 'sending']);

  const groupCalls = [];
  assert.equal(sendPolicy.evaluatePreflight({
    text: 'hi',
    isBlocked: () => { groupCalls.push('blocked'); return false; },
    isSending: () => { groupCalls.push('sending'); return false; },
    isGroupChat: () => { groupCalls.push('group'); return true; },
    hasGroup: () => { groupCalls.push('hasGroup'); return true; },
    getAvailableGroupMembers: () => { groupCalls.push('members'); return []; }
  }), 'group-unavailable');
  assert.deepEqual(groupCalls, ['blocked', 'sending', 'group', 'hasGroup', 'members']);

  const regenCalls = [];
  assert.equal(sendPolicy.evaluatePreflight({
    text: '',
    isRegen: true,
    contextOnly: false,
    isBlocked: () => { regenCalls.push('blocked'); return false; },
    isSending: () => { regenCalls.push('sending'); return false; },
    isGroupChat: () => { regenCalls.push('group'); return true; },
    hasGroup: () => { regenCalls.push('hasGroup'); return true; },
    getAvailableGroupMembers: () => { regenCalls.push('members'); return []; }
  }), 'ready');
  assert.deepEqual(regenCalls, ['blocked', 'sending', 'group', 'hasGroup']);
  assert.match(detail, /ChatSendPolicy\.evaluatePreflight/);
  assert.match(detail, /preflightReason === 'group-unavailable'/);
});


test('group chat policy resolves @mentions before weighted speaker selection', () => {
  assert.equal(typeof groupPolicy.extractMentionedMemberIds, 'function');
  assert.equal(typeof groupPolicy.selectSpeaker, 'function');
  const members = [
    { id: 'role-a', name: '小林', nickname: '林林' },
    { id: 'role-b', name: '阿岚' },
    { id: 'role-c', name: '夜班搭档' }
  ];
  assert.deepEqual(
    Array.from(groupPolicy.extractMentionedMemberIds('这件事问问 @林林，再听听 @夜班搭档。@unknown', members)),
    ['role-a', 'role-c']
  );
  assert.deepEqual(
    Array.from(groupPolicy.getPendingMentionIds([
      { role: 'user', text: '@林林 @阿岚 @夜班搭档' },
      { role: 'assistant', memberId: 'role-a', text: '我来回答。' },
      { role: 'assistant', memberId: 'role-b', text: '我也补充一句。' }
    ], members, [members[0], members[1], members[2]], '')),
    ['role-c']
  );

  const first = groupPolicy.selectSpeaker({
    availableMembers: members,
    members,
    mentionQueueIds: ['role-a', 'role-c'],
    isFollowup: false,
    random: () => 0.99
  });
  assert.equal(first.member.id, 'role-a');
  assert.equal(first.isMentioned, true);

  const second = groupPolicy.selectSpeaker({
    availableMembers: members,
    members,
    mentionQueueIds: ['role-a', 'role-c'],
    isFollowup: true,
    previousSpeakerId: 'role-a',
    random: () => 0.99
  });
  assert.equal(second.member.id, 'role-c');
  assert.equal(second.isMentioned, true);
});

test('an explicit @mention can select the immediately previous speaker', () => {
  const members = [
    { id: 'role-a', name: '小林' },
    { id: 'role-b', name: '阿岚' }
  ];
  const decision = groupPolicy.selectSpeaker({
    availableMembers: members,
    members,
    mentionQueueIds: ['role-a'],
    isFollowup: true,
    previousSpeakerId: 'role-a',
    random: () => 0.99
  });
  assert.equal(decision.member.id, 'role-a');
  assert.equal(decision.isMentioned, true);
});

test('group relationship familiarity affects which member is more likely to pick up a thread', () => {
  const weighted = groupPolicy.selectSpeaker({
    availableMembers: [{ id: 'role-c' }, { id: 'role-b' }],
    members: [{ id: 'role-a' }, { id: 'role-b' }, { id: 'role-c' }],
    previousSpeakerId: 'role-a',
    relationships: {
      '["role-a","role-b"]': { familiarity: 100, interactions: 0 }
    },
    random: () => 0.4
  });
  assert.equal(weighted.member.id, 'role-b');
  assert.equal(weighted.isMentioned, false);
});

test('directional group relationships keep each character perspective independent', () => {
  const relationships = {
    '["role-a","role-b"]': {
      directions: {
        'role-a': { fromId: 'role-a', toId: 'role-b', intimacy: 82, trust: 24, type: '朋友', moodToward: 'warm' },
        'role-b': { fromId: 'role-b', toId: 'role-a', intimacy: 16, trust: 91, type: '竞争对手', moodToward: 'cold' }
      }
    }
  };
  assert.equal(groupPolicy.getDirectionalRelationship(relationships, 'role-a', 'role-b').intimacy, 82);
  assert.equal(groupPolicy.getDirectionalRelationship(relationships, 'role-a', 'role-b').trust, 24);
  assert.equal(groupPolicy.getDirectionalRelationship(relationships, 'role-b', 'role-a').intimacy, 16);
  assert.equal(groupPolicy.getDirectionalRelationship(relationships, 'role-b', 'role-a').trust, 91);
});

test('group routing weighs topic relevance and each member talkativeness', () => {
  const members = [
    { id: 'music', talkativeness: 1, replyThreshold: 30, interests: ['音乐'] },
    { id: 'quiet', talkativeness: 0.1, replyThreshold: 85, interests: ['历史'] }
  ];
  const decision = groupPolicy.selectSpeaker({
    availableMembers: members,
    members,
    text: '我们来聊聊音乐吧',
    random: () => 0.5
  });
  assert.equal(decision.member.id, 'music');
  assert.equal(decision.fallback, false);
});

test('group routing falls back to the most talkative member below all thresholds', () => {
  const members = [
    { id: 'quiet', talkativeness: 0.2, replyThreshold: 85 },
    { id: 'chatty', talkativeness: 0.9, replyThreshold: 85 }
  ];
  const decision = groupPolicy.selectSpeaker({
    availableMembers: members,
    members,
    text: '随便聊聊',
    random: () => 0
  });
  assert.equal(decision.member.id, 'chatty');
  assert.equal(decision.fallback, true);
});

test('group duplicate guard is limited to the configured three-second window', () => {
  assert.equal(groupPolicy.isDuplicateWithinWindow('same text', 1000, 'same   text', 3999, 3000), true);
  assert.equal(groupPolicy.isDuplicateWithinWindow('same text', 1000, 'same text', 4000, 3000), false);
  assert.equal(groupPolicy.isDuplicateWithinWindow('first', 1000, 'second', 1200, 3000), false);
  assert.equal(groupPolicy.isDuplicateWithinWindow('', 1000, '', 1200, 3000), false);
});

test('group follow-up delay stays between one and five seconds', () => {
  assert.equal(groupPolicy.getReplyDelayMs(() => 0), 1000);
  assert.equal(groupPolicy.getReplyDelayMs(() => 0.999999), 5000);
});

test('group model context retains speaker identity and excludes group-private payloads', () => {
  const mapped = contextPolicy.mapHistoryToApiMessages([
    { role: 'assistant', memberId: 'role-a', text: '我刚到。' },
    { role: 'assistant', type: 'group_private', text: '这句只属于私聊，不应进群上下文。' },
    { role: 'assistant', name: '阿岚', text: '我也到了。' },
    { role: 'user', text: '那我们开始吧。' }
  ], null, {
    isGroupChat: true,
    groupMembers: [{ id: 'role-a', name: '小林', nickname: '林林' }]
  });
  assert.deepEqual(JSON.parse(JSON.stringify(mapped)), [
    { role: 'assistant', content: '【群成员 林林】\n我刚到。' },
    { role: 'assistant', content: '【群成员 阿岚】\n我也到了。' },
    { role: 'user', content: '那我们开始吧。' }
  ]);
  assert.equal(mapped.some((item) => item.content.includes('只属于私聊')), false);
});


test('offline group context keeps narration text so the shared scene remains continuous', () => {
  const mapped = contextPolicy.mapHistoryToApiMessages([
    { role: 'assistant', name: '小林', text: '<narratage>门被推开了。</narratage>我到了。' },
    { role: 'user', text: '先坐一会儿。' }
  ], null, { isGroupChat: true, groupMode: 'offline' });
  assert.equal(mapped[0].content, '【群成员 小林】\n门被推开了。我到了。');
});

test('group chat wiring includes mention dispatch, paced replies, duplicate protection and shared-history modes', () => {
  assert.match(detail, /group-chat-policy\.js\?v=20261102v2/);
  assert.match(detail, /GroupChatPolicy\.selectSpeaker/);
  assert.match(detail, /getPendingMentionIds/);
  assert.match(detail, /本轮被@点名/);
  assert.match(detail, /acceptGroupUserMessage/);
  assert.match(detail, /isDuplicateWithinWindow/);
  assert.match(detail, /savedHistory = loadMessages\(\)/);
  assert.match(detail, /savedMessage\.silent/);
  assert.match(detail, /groupAutoFollowupToken/);
  assert.match(detail, /getGroupReplyDelayMs/);
  assert.match(detail, /群聊模式：线下共同场景/);
  assert.match(detail, /mapHistoryToApiMessages\(recentHistory, stripInternalReasoning, \{/);
  assert.match(groupPlay, /id="groupChatMode"/);
  assert.match(groupPlay, /group\.settings\.chatMode/);
  assert.match(groupPlay, /data-member-field="talkativeness"/);
  assert.match(groupPlay, /data-member-field="replyThreshold"/);
  assert.match(groupPlay, /data-relationship-field="trust"/);
  assert.match(groupPlay, /data-relationship-direction/);
  assert.match(detail, /getGroupRelationshipContext\(groupReplyPick\.id\)/);
  assert.match(detail, /recentSpeakerIds/);
  assert.match(detail, /群成员双向关系网/);
  assert.match(detail, /direction\.sharedEvents/);
});

test('shared policy is loaded by both relevant pages and precached for PWA', () => {
  assert.match(detail, /chat-message-policy\.js\?v=20261029v5/);
  assert.match(search, /chat-message-policy\.js\?v=20261029v5/);
  assert.match(serviceWorker, /phone-app-pwa-v131/);
  assert.match(serviceWorker, /chat-message-policy\.js\?v=20261029v5/);
  assert.match(detail, /chat-send-policy\.js\?v=20261029v2/);
  assert.match(serviceWorker, /chat-send-policy\.js\?v=20261029v2/);
  assert.match(detail, /chat-context-policy\.js\?v=20261031v1/);
  assert.match(serviceWorker, /chat-context-policy\.js\?v=20261031v1/);
  assert.match(serviceWorker, /group-chat-policy\.js\?v=20261102v2/);
  assert.match(serviceWorker, /phone_context\.js\?v=20261031v1/);
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
  assert.match(detail, /let streamResult;\s*try\s*\{\s*streamResult = await PhoneStream\.chat\(/);
  assert.match(detail, /onPaint: paintStreamLive/);
  assert.match(detail, /typeof streamResult\.fullText === 'string'/);
  assert.match(stream, /result\.fullText = fullText/);
  assert.match(stream, /finish\(e\)/);
  assert.match(stream, /WATCHDOG_MS/);
  assert.match(stream, /TOTAL_MS/);
});

test('unexpected stream rejection is converted to the normal error path and keeps last painted text', () => {
  assert.match(detail, /let lastPaintedStreamText = ''/);
  assert.match(detail, /lastPaintedStreamText = typeof text === 'string' \? text : ''/);
  assert.match(detail, /let streamResult;\s*try\s*\{\s*streamResult = await PhoneStream\.chat\(/);
  assert.match(detail, /catch \(streamErr\)/);
  assert.match(detail, /fullText: lastPaintedStreamText/);
  assert.match(detail, /kind: 'network'/);
  const fallbackIndex = detail.indexOf('fullText: lastPaintedStreamText');
  const unlockIndex = detail.indexOf('aiSending = false;   // R3：所有出口统一解锁', fallbackIndex);
  assert.ok(fallbackIndex >= 0 && unlockIndex > fallbackIndex, 'recovered request path should continue to the existing send-lock release');
});


test('context size controls and local historical recall remain bounded', () => {
  assert.match(detail, /persona: 5000/);
  assert.match(detail, /memory: 3000/);
  assert.match(detail, /userMemory: 2000/);
  assert.match(detail, /worldbook: 8000/);
  assert.match(detail, /rpComposed: 16000/);
  assert.match(detail, /recentHistory = historyList\.slice\(-memoryLimit\)/);
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

test('inspect phone generates and caches private content by character and local date', () => {
  assert.match(inspectPhone, /phone_storage\.js/);
  assert.match(inspectPhone, /phone_api\.js/);
  assert.match(inspectPhone, /PhoneAPI\.completeJSON/);
  assert.match(inspectPhone, /roleBio/);
  assert.match(inspectPhone, /inspect_phone_content_v2_/);
  assert.match(inspectPhone, /if\(hasCachedContent\)return/);
  assert.match(inspectPhone, /encodeURIComponent\(roleId\)/);
  assert.match(inspectPhone, /function normalizePhoneContent/);
  assert.match(inspectPhone, /escHtml/);
});

test('forum creates a fallback for every role and upgrades it with persona-based AI content', () => {
  assert.match(forumPage, /phone_api\.js/);
  assert.match(forumPage, /function forumRoleBio/);
  assert.match(forumPage, /function ensureRolePosts/);
  assert.match(forumPage, /function generateRolePosts/);
  assert.match(forumPage, /PhoneAPI\.completeJSON/);
  assert.match(forumPage, /post\.generatedBy\s*!==\s*'ai'/);
  assert.match(forumPage, /post\.generatedBy='ai'/);
  assert.match(forumPage, /roleId:id/);
});

test('footprint follows the local current date and keeps week, calendar and generated data role-scoped', () => {
  assert.match(footprint, /const todayKey = \(\) =>/);
  assert.ok(footprint.indexOf('const pad =') < footprint.indexOf('let currentDate = todayKey()'));
  assert.match(footprint, /function renderWeekDays\(\)/);
  assert.match(footprint, /data-date/);
  assert.match(footprint, /currentDate = todayKey\(\)/);
  assert.match(footprint, /loadFootprintData\(requestRoleId\)/);
  assert.match(footprint, /localData\[requestDate\] = items/);
  assert.match(footprint, /function findItem\(id\)/);
  assert.doesNotMatch(footprint, /currentDate = '2025-04-16'/);
  assert.doesNotMatch(footprint, /currentDate = '2025-04-' \+/);
});

test('reader import requires a title and confirms book details before adding to shelf', () => {
  assert.match(libraryReader, /accept="\.txt,\.epub,text\/plain,application\/epub\+zip"/);
  assert.match(libraryReader, /书籍名称（必填）/);
  assert.match(libraryReader, /function openImportDialog/);
  assert.match(libraryReader, /function confirmImportedBook/);
  assert.match(libraryReader, /if \(!name\) \{ showToast\('请先填写书名'/);
  assert.match(libraryReader, /await persistLocalBook\(book\)/);
});

test('reader import parses TXT chapter headings and EPUB manifest/spine/nav in source order', () => {
  assert.match(libraryReader, /function detectTxtHeading/);
  assert.match(libraryReader, /function parseTxtBook/);
  assert.match(libraryReader, /function flushParagraph/);
  assert.match(libraryReader, /function parseEpubBook/);
  assert.match(libraryReader, /META-INF\/container\.xml/);
  assert.match(libraryReader, /xmlElements\(spine, 'itemref'\)/);
  assert.match(libraryReader, /tocTitles\[chapterPath\]/);
  assert.match(libraryReader, /importFormat: 'epub'/);
});

test('reader library persists imported books and paragraph comments across reloads', () => {
  assert.match(libraryReader, /indexedDB\.open\(READER_DB_NAME, READER_DB_VERSION\)/);
  assert.match(libraryReader, /createObjectStore\('books'/);
  assert.match(libraryReader, /createObjectStore\('comments'/);
  assert.match(libraryReader, /function restoreLocalBooks/);
  assert.match(libraryReader, /function saveReaderComment/);
  assert.match(libraryReader, /Promise\.all\(\[restoreLocalBooks\(\), loadReaderComments\(\)\]\)/);
});

test('reader paragraph comments are generated by the chosen character using persona, memory and recent chat', () => {
  assert.match(libraryReader, /function renderRoleOptions/);
  assert.match(libraryReader, /function openParagraphComment/);
  assert.match(libraryReader, /async function generateParagraphComment/);
  assert.match(libraryReader, /PhoneAPI\.complete\(/);
  assert.match(libraryReader, /rolePersona/);
  assert.match(libraryReader, /recentChat/);
  assert.match(libraryReader, /memories/);
  assert.match(libraryReader, /function commentKey\(bookId, chapterIndex, paragraphIndex, roleId\)/);
  assert.match(libraryReader, /data-paragraph-comment/);
});

test('reader keeps three books per row and shows three recommendations on the home page', () => {
  assert.match(libraryReader, /grid-template-columns:repeat\(3,1fr\)/);
  assert.match(libraryReader, /var picks = books\.slice\(0, 3\)/);
});

test('takeout cart stays bound to one restaurant and checkout uses the cart restaurant', () => {
  assert.match(takeout, /function getDishShopId\(dishId\)/);
  assert.match(takeout, /function getCartShop\(\)/);
  assert.match(takeout, /takeout_cart_shop_id/);
  assert.match(takeout, /cartShopId !== currentShop\.id/);
  assert.match(takeout, /window\.confirm\(/);
  assert.match(takeout, /var orderShop = getCartShop\(\)/);
  assert.match(takeout, /shop: orderShop\.name, shopId: orderShop\.id/);
  assert.match(takeout, /function clearCart\(\)/);
  assert.match(takeout, /if \(currentShop\) renderDishes\(\);\s*else updateCartUI\(\)/);
});

test('partner protocol is managed globally from desktop settings and shared by every chat', () => {
  assert.match(globalSettings, /window\.location\.href='\.\.\/worldbook\/settings\/rp-protocol\.html'/);
  assert.match(globalSettings, /伴侣协议/);
  assert.doesNotMatch(chatSettings, /rp-protocol\.html|伴侣协议/);
  assert.match(rpProtocolPage, /var STORAGE_KEY = 'chat_rp_protocol_';/);
  assert.match(rpProtocolPage, /function migrateLegacyProtocol\(\)/);
  assert.doesNotMatch(rpProtocolPage, /getRoleIdFromUrl/);
  assert.match(detail, /localStorage\.getItem\(globalRpKey\)/);
  assert.match(detail, /localStorage\.setItem\(globalRpKey, legacyValue\)/);
  assert.doesNotMatch(detail, /localStorage\.getItem\('chat_rp_protocol_' \+ aliasRoleId\)/);
});
