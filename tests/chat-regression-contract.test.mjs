import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

const detail = read('chat/chat/chat-detail.html');
const chatNotifier = read('shared/js/chat-notifier.js');
const navPage = read('shared/js/nav.js');
const homePage = read('index.html');
const momentsPage = read('chat/moments/moments.html');
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
const followUpPolicySource = read('shared/js/phone/chat-followup-policy.js');
const followUpPolicyWindow = {};
runInNewContext(followUpPolicySource, { window: followUpPolicyWindow, globalThis: followUpPolicyWindow });
const followUpPolicy = followUpPolicyWindow.ChatFollowUpPolicy;

const presencePolicySource = read('shared/js/phone/chat-presence-policy.js');
const presencePolicyWindow = {};
runInNewContext(presencePolicySource, { window: presencePolicyWindow });
const presencePolicy = presencePolicyWindow.ChatPresencePolicy;
const rolePublicTimelineSource = read('shared/js/phone/role-public-timeline.js');
const rolePublicTimelineWindow = {};
runInNewContext(rolePublicTimelineSource, { window: rolePublicTimelineWindow, globalThis: rolePublicTimelineWindow });
const rolePublicTimeline = rolePublicTimelineWindow.RolePublicTimeline;

const serviceWorker = read('sw.js');
const profileEditor = read('profile/edit-profile.html');
const chatListPage = read('chat/chat/chat.html');
const contactsPage = read('chat/contacts/contacts.html');
const profilePage = read('profile/profile.html');
const wechatThemeCss = read('shared/css/wechat-theme-refinements.css');
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
    mentionQueueIds: ['role-c'],
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

test('group message keyword extraction filters filler words and retains useful short-message terms', () => {
  const keywords = groupPolicy.extractKeywords('今天加班到十点累死了');
  assert.ok(keywords.includes('加班'));
  assert.ok(keywords.includes('十点'));
  assert.ok(keywords.includes('累死'));
  assert.equal(keywords.includes('今天'), false);
  assert.equal(keywords.includes('到'), false);
  assert.equal(keywords.includes('了'), false);
});

test('group keyword extraction improves synonym matching without breaking phrase tags', () => {
  assert.equal(groupPolicy.calculateTopicRelevance(
    { interestTags: ['工作'] },
    '今天加班到很晚'
  ), 100);
  assert.equal(groupPolicy.calculateTopicRelevance(
    { expertiseTags: ['心理学'] },
    '我最近有点疲惫'
  ) > 0, true);
  assert.equal(groupPolicy.calculateTopicRelevance(
    { interestTags: ['前端开发'] },
    '今天在做前端开发'
  ), 100);
});

test('keyword extraction keeps a fallback when Intl.Segmenter is unavailable', () => {
  const fallbackWindow = {};
  runInNewContext(groupPolicySource, {
    window: fallbackWindow,
    Intl: null,
    globalThis: {}
  });
  const fallbackPolicy = fallbackWindow.GroupChatPolicy;
  const keywords = fallbackPolicy.extractKeywords('今天加班到十点累死了');
  assert.ok(keywords.includes('加班'));
  assert.ok(keywords.includes('十点'));
  assert.ok(keywords.includes('累死'));
  assert.equal(fallbackPolicy.calculateTopicRelevance(
    { interestTags: ['工作'] },
    '今天加班了'
  ), 100);
});

test('group topic matching supports synonym groups and keeps legacy interests readable', () => {
  assert.equal(groupPolicy.calculateTopicRelevance(
    { interestTags: ['编程'] },
    '我今天敲代码到很晚'
  ), 100);
  assert.equal(groupPolicy.calculateTopicRelevance(
    { interests: ['篮球'] },
    '晚上一起打球吧'
  ), 100);
  assert.equal(groupPolicy.calculateTopicRelevance(
    { interestTags: ['篮球', '咖啡'] },
    '周末打球'
  ), 50);
});

test('expertise and background tags contribute independently to topic relevance', () => {
  assert.equal(groupPolicy.calculateTopicRelevance(
    { expertiseTags: ['React'] },
    '这个 React 组件怎么写？'
  ), 100);
  assert.equal(groupPolicy.calculateTopicRelevance(
    { backgroundTags: ['大学室友'] },
    '大学室友今天来找我了'
  ), 100);
  assert.equal(groupPolicy.calculateTopicRelevance(
    { interestTags: ['音乐'], expertiseTags: ['React'] },
    'React 组件怎么写？',
    { type: 'help' }
  ) > groupPolicy.calculateTopicRelevance(
    { interestTags: ['音乐'], expertiseTags: ['React'] },
    'React 组件怎么写？',
    { type: 'casual' }
  ), true);
});

test('local group message context detects emotion, invitations, help and conflict', () => {
  assert.equal(groupPolicy.analyzeMessageContext('今天加班到很晚，真的好累').type, 'emotional');
  assert.equal(groupPolicy.analyzeMessageContext('周末要不要一起去打球？').type, 'invitation');
  assert.equal(groupPolicy.analyzeMessageContext('这个 React 组件为什么报错？').type, 'help');
  assert.equal(groupPolicy.analyzeMessageContext('我和他昨天吵架了').type, 'conflict');
  assert.equal(groupPolicy.analyzeMessageContext('晚上吃什么').type, 'casual');
});

test('user messages do not inherit a previous role-to-role relationship weight', () => {
  const members = [
    { id: 'role-c', talkativeness: 0.5, replyThreshold: 30 },
    { id: 'role-b', talkativeness: 0.5, replyThreshold: 30 }
  ];
  const decision = groupPolicy.selectSpeaker({
    availableMembers: members,
    members,
    isFollowup: true,
    previousSpeakerId: 'role-a',
    relationshipTargetId: '',
    relationships: {
      '["role-a","role-c"]': { familiarity: 100 }
    },
    random: () => 0.6
  });
  assert.equal(decision.member.id, 'role-b');
  assert.equal(decision.relationship, null);
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

test('relationship event severity caps proposed changes and sanitizes its reason', () => {
  const normalized = groupPolicy.normalizeRelationshipEvent({
    level: 'micro',
    intimacyDelta: 40,
    trustDelta: -30,
    summary: '兑现了承诺\n并按时出现'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(normalized)), {
    level: 'micro',
    intimacyDelta: 2,
    trustDelta: -2,
    summary: '兑现了承诺 并按时出现'
  });
  assert.equal(groupPolicy.normalizeRelationshipEvent({
    level: 'ordinary', intimacyDelta: 5, trustDelta: 5, summary: '普通寒暄'
  }), null);
  assert.equal(groupPolicy.normalizeRelationshipEvent({
    level: 'major', intimacyDelta: 0, trustDelta: 0, summary: '没有变化'
  }), null);
});

test('negative trust changes create repair debt and slow later recovery', () => {
  const direction = { intimacy: 50, trust: 60, trustRecoveryDebt: 0, eventHistory: [] };
  const loss = groupPolicy.applyRelationshipEvent(direction, {
    level: 'major', intimacyDelta: 0, trustDelta: -8, summary: '明确失信'
  }, 1000);
  assert.equal(loss.trustDelta, -8);
  assert.equal(direction.trust, 52);
  assert.equal(direction.trustRecoveryDebt, 12);

  const recovery = groupPolicy.applyRelationshipEvent(direction, {
    level: 'moderate', intimacyDelta: 0, trustDelta: 5, summary: '主动解释并兑现补救'
  }, 2000);
  assert.equal(recovery.trustDelta, 4);
  assert.equal(direction.trust, 56);
  assert.equal(direction.trustRecoveryDebt, 10);
  assert.equal(direction.eventHistory.length, 2);
});

test('relationship event history is bounded and invalid events do not mutate scores', () => {
  const direction = { intimacy: 50, trust: 50, trustRecoveryDebt: 0, eventHistory: [] };
  assert.equal(groupPolicy.applyRelationshipEvent(direction, {
    level: 'micro', intimacyDelta: 0, trustDelta: 0, summary: '普通聊天'
  }, 1), null);
  assert.equal(direction.intimacy, 50);
  assert.equal(direction.trust, 50);
  for (let i = 0; i < 25; i++) {
    groupPolicy.applyRelationshipEvent(direction, {
      level: 'micro', intimacyDelta: 1, trustDelta: 0, summary: '本轮确有新的互动 ' + i
    }, 1000 + i);
  }
  assert.equal(direction.eventHistory.length, 20);
  assert.equal(direction.intimacy, 75);
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
  assert.match(detail, /group-chat-policy\.js\?v=20261102v5/);
  assert.match(detail, /groupPolicy\.selectSpeaker/);
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
  assert.match(detail, /relationshipTargetId: isGroupFollowup && previousSpeaker/);
  assert.doesNotMatch(detail, /relation\.familiarity = Math\.min\(100, Math\.max\(0, parseInt\(relation\.familiarity/);
  assert.match(detail, /relationshipDynamicsEnabled !== false/);
  assert.match(groupPolicySource, /Intl\.Segmenter/);
  assert.match(groupPolicySource, /function extractKeywords\(text\)/);
  assert.match(groupPolicySource, /TOPIC_STOP_WORDS/);
  assert.match(groupPolicySource, /function tagMatchesTopic\(tag, messageText, keywords\)/);
  assert.match(groupPlay, /data-member-field="interestTags"/);
  assert.match(groupPlay, /data-member-field="expertiseTags"/);
  assert.match(groupPlay, /data-member-field="backgroundTags"/);
  assert.match(groupPlay, /member\.interests=tags/);
  assert.match(detail, /analyzeMessageContext\(selectionText\)/);
  assert.match(detail, /groupContextPrompt/);
  assert.match(detail, /relationshipDynamicsEnabled !== false && isGroupFollowup/);
  assert.match(detail, /applyRelationshipEvent/);
  assert.match(detail, /群关系变化/);
  assert.match(detail, /processGroupInteractionMarkers\(fullText, groupReplyPick, historyList, isRegen, isGroupFollowup\)/);
  assert.match(detail, /!isGroupFollowup \|\| !speaker/);
  assert.match(groupPlay, /data-setting="relationshipDynamicsEnabled"/);
  assert.match(groupPlay, /近期关系变化/);
  assert.match(groupPlay, /trustRecoveryDebt/);
  assert.match(groupPlay, /field==='trust'\)direction\.trustRecoveryDebt=0/);


});

test('shared policy is loaded by both relevant pages and precached for PWA', () => {
  assert.match(detail, /chat-message-policy\.js\?v=20261029v5/);
  assert.match(search, /chat-message-policy\.js\?v=20261029v5/);
  assert.ok(serviceWorker.includes('phone-app-pwa-v173'));
  assert.match(serviceWorker, /chat-message-policy\.js\?v=20261029v5/);
  assert.match(detail, /chat-send-policy\.js\?v=20261029v2/);
  assert.match(serviceWorker, /chat-send-policy\.js\?v=20261029v2/);
  assert.match(detail, /chat-context-policy\.js\?v=20261031v1/);
  assert.match(detail, /function buildCharacterSocialPrompt\(role\)/);
  assert.match(detail, /role\.npcCharacters/);
  assert.match(detail, /relationshipRole/);
  assert.match(serviceWorker, /chat-context-policy\.js\?v=20261031v1/);
  assert.match(serviceWorker, /group-chat-policy\.js\?v=20261102v5/);
  assert.match(serviceWorker, /phone_context\.js\?v=20261102npc1/);
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


test('chat presence policy learns only the active character voice from ordinary replies', () => {
  assert.equal(typeof presencePolicy.collectVoiceSamples, 'function');
  assert.equal(typeof presencePolicy.buildPrompt, 'function');

  const history = [
    { role: 'assistant', text: '今天外面风好大。' },
    { role: 'user', text: '我这边也有点冷。' },
    { role: 'assistant', text: '你那边是不是还在下雨？' },
    { role: 'assistant', mode: 'date', text: '（走到窗边）外面下雨了。' },
    { role: 'assistant', voiceMode: 'narration', text: '这段旁白不能进入线上语气档案。' },
    { role: 'assistant', silent: true, text: '隐藏指令不能当作语言样本。' },
    { role: 'assistant', type: 'image', text: '图片描述不能当作语言样本。' },
    { role: 'system_error', text: '错误提示不能当作语言样本。' }
  ];

  assert.deepEqual(
    Array.from(presencePolicy.collectVoiceSamples(history, { maxSamples: 2 })),
    ['今天外面风好大。', '你那边是不是还在下雨？']
  );

  const prompt = presencePolicy.buildPrompt({
    mode: 'online',
    history,
    currentText: '那你忙完了吗？',
    maxSamples: 2
  });
  assert.ok(prompt.includes('今天外面风好大。'));
  assert.ok(prompt.includes('你那边是不是还在下雨？'));
  assert.equal(prompt.includes('隐藏指令不能当作语言样本'), false);
  assert.equal(prompt.includes('图片描述不能当作语言样本'), false);
  assert.equal(prompt.includes('错误提示不能当作语言样本'), false);
  assert.equal(prompt.includes('外面下雨了。'), false);
});

test('chat presence policy keeps group voice examples isolated to the selected speaker', () => {
  const history = [
    { role: 'assistant', name: '小林', memberId: 'role-a', text: '我刚到。' },
    { role: 'assistant', name: '阿岚', memberId: 'role-b', text: '我去买点东西。' },
    { role: 'assistant', name: '小林', memberId: 'role-a', text: '你们先聊，我听着。' }
  ];
  const samples = presencePolicy.collectVoiceSamples(history, {
    isGroupChat: true,
    speakerId: 'role-a',
    speakerName: '小林',
    maxSamples: 2
  });
  assert.deepEqual(Array.from(samples), ['我刚到。', '你们先聊，我听着。']);
});

test('chat presence policy skips narration and face-to-face modes and avoids rigid message quotas', () => {
  assert.equal(presencePolicy.buildPrompt({ mode: 'narration' }), '');
  assert.equal(presencePolicy.buildPrompt({ mode: 'offline' }), '');

  const prompt = presencePolicy.buildPrompt({ mode: 'online', history: [] });
  assert.match(prompt, /不固定消息条数/);
  assert.match(prompt, /不要为了拆气泡把完整的一句话硬切开/);
  assert.match(prompt, /情绪连续性/);
  assert.doesNotMatch(prompt, /18-26字|每条必须.*字/);
});

test('chat presence policy is loaded by chat detail and precached for PWA', () => {
  assert.match(detail, /chat-presence-policy\.js\?v=20261102v17/);
  assert.match(detail, /ChatPresencePolicy\.buildPrompt/);
  assert.match(serviceWorker, /phone-app-pwa-v175/);
  assert.match(serviceWorker, /chat-presence-policy\.js\?v=20261102v17/);
});


test('chat presence policy derives a bounded pause from the previous bubble length', () => {
  assert.equal(typeof presencePolicy.getBubbleDelayMs, 'function');
  const shortPause = presencePolicy.getBubbleDelayMs('嗯。');
  const longerPause = presencePolicy.getBubbleDelayMs('我刚刚还在想你说的那件事。');
  const maximumPause = presencePolicy.getBubbleDelayMs('甲'.repeat(100));
  assert.ok(shortPause >= 520 && shortPause <= 920);
  assert.ok(longerPause > shortPause);
  assert.equal(maximumPause, 920);
});

test('chat detail stages multi-bubble replies and preserves the existing stream path', () => {
  assert.match(detail, /async function appendAiMessageWithPacing\(msg, idx\)/);
  assert.match(detail, /await appendAiMessageWithPacing\(aiMsg, aiMessageIndex\)/);
  assert.match(detail, /chatMessages\.appendChild\(node\)/);
  assert.match(detail, /aiBubblePacingRunId \+= 1/);
  assert.match(detail, /prefers-reduced-motion: reduce/);
  assert.match(detail, /activeChatModeForPrompt !== 'narration'/);
  assert.match(detail, /PhoneStream\.chat\(\{/);
  assert.match(detail, /inflightSnapshot = null/);
  assert.match(detail, /saveMessages\(historyList\)/);
});


test('voice habit profile stores aggregate language tendencies without retaining chat content', () => {
  assert.equal(typeof presencePolicy.buildVoiceHabitProfile, 'function');
  assert.equal(typeof presencePolicy.buildVoiceHabitPrompt, 'function');

  const privatePhrase = '这句只用于测试，不应进入长期档案。';
  const history = [
    { role: 'assistant', text: '嗯，今天有点忙。' },
    { role: 'assistant', text: '我刚刚才忙完呢。' },
    { role: 'assistant', text: '啊？你已经到家啦？' },
    { role: 'assistant', text: '哈哈，等我一下。' },
    { role: 'assistant', text: '我在路上，马上就到。' },
    { role: 'assistant', text: privatePhrase + '\n\n我晚点再和你说。' },
    { role: 'assistant', mode: 'date', text: '（走到窗边）外面下雨了。' },
    { role: 'assistant', silent: true, text: '隐藏任务不能加入统计。' },
    { role: 'assistant', type: 'image', text: '图片消息不能加入统计。' },
    { role: 'system_error', text: '错误消息不能加入统计。' }
  ];

  const profile = presencePolicy.buildVoiceHabitProfile(history, { maxMessages: 80 });
  assert.ok(profile);
  assert.equal(profile.sampleCount, 6);
  assert.ok(profile.avgChars > 0);
  assert.ok(Array.isArray(profile.particles));
  assert.equal(JSON.stringify(profile).includes(privatePhrase), false);
  assert.equal(JSON.stringify(profile).includes('隐藏任务不能加入统计'), false);
  assert.equal(JSON.stringify(profile).includes('图片消息不能加入统计'), false);
  assert.equal(JSON.stringify(profile).includes('外面下雨了'), false);
  assert.equal(JSON.stringify(profile).includes('这段旁白不能进入线上语气档案'), false);

  const prompt = presencePolicy.buildVoiceHabitPrompt(profile);
  assert.ok(prompt.includes('角色长期表达习惯档案'));
  assert.ok(prompt.includes('近期 6 条'));
  assert.equal(prompt.includes(privatePhrase), false);
});

test('voice habit profile is isolated by group speaker and does not mix other members', () => {
  const history = [
    { role: 'assistant', name: '小林', memberId: 'role-a', text: '嗯，我刚到。' },
    { role: 'assistant', name: '阿岚', memberId: 'role-b', text: '今天真的太忙了，哈哈哈哈！' },
    { role: 'assistant', name: '小林', memberId: 'role-a', text: '你们先聊，我听着呢。' },
    { role: 'assistant', name: '阿岚', memberId: 'role-b', text: '我马上过去！' },
    { role: 'assistant', name: '小林', memberId: 'role-a', text: '好呀，我在这里等你。' },
    { role: 'assistant', name: '阿岚', memberId: 'role-b', text: '收到收到！' },
    { role: 'assistant', name: '小林', memberId: 'role-a', text: '嗯，那就这么定吧。' },
    { role: 'assistant', name: '阿岚', memberId: 'role-b', text: '哈哈哈哈！' }
  ];

  const profile = presencePolicy.buildVoiceHabitProfile(history, {
    isGroupChat: true, speakerId: 'role-a', speakerName: '小林'
  });
  assert.ok(profile);
  assert.equal(profile.sampleCount, 4);
  assert.ok(profile.questionRate <= 0.25);
  assert.ok(profile.emojiRate <= 0.25);
});

test('voice habit profile cache is reused only while its source messages stay unchanged', () => {
  const history = [
    { role: 'assistant', mid: 'a', time: 1, text: '嗯，我知道了。' },
    { role: 'assistant', mid: 'b', time: 2, text: '好呀，等我一下。' },
    { role: 'assistant', mid: 'c', time: 3, text: '我刚刚出门呢。' },
    { role: 'assistant', mid: 'd', time: 4, text: '哈哈，马上到。' }
  ];
  const first = presencePolicy.buildVoiceHabitProfile(history);
  const reused = presencePolicy.buildVoiceHabitProfile(history, {}, first);
  assert.ok(first);
  assert.equal(reused.sourceSignature, first.sourceSignature);
  assert.equal(reused.generatedAt, first.generatedAt);

  const editedHistory = history.map((item, index) =>
    index === 3 ? { ...item, text: '我还要再等十分钟。' } : item
  );
  const rebuilt = presencePolicy.buildVoiceHabitProfile(editedHistory, {}, first);
  assert.notEqual(rebuilt.sourceSignature, first.sourceSignature);

  const shortened = presencePolicy.buildVoiceHabitProfile(history.slice(0, 3), {}, first);
  assert.equal(shortened, null);
  assert.equal(presencePolicy.buildVoiceHabitPrompt(shortened), '');
});

test('chat detail persists voice habits per character and per group session without storing raw messages', () => {
  assert.match(detail, /chat_voice_habits_v1_/);
  assert.match(detail, /encodeURIComponent\(voiceProfileRoleId\)/);
  assert.match(detail, /'group_' \+ encodeURIComponent\(String\(aliasRoleId \|\| currentRoleId \|\| ''\)\)/);
  assert.match(detail, /localStorage\.setItem\(voiceProfileKey, JSON\.stringify\(voiceHabitProfile\)\)/);
  assert.match(detail, /maxMessages: 80/);
  assert.match(detail, /var presenceMode = isGroupChat/);
  assert.match(detail, /voiceMode: presenceMode \|\| 'online'/);
  assert.match(detail, /voiceMode: inflightSnapshot\.voiceMode \|\| 'online'/);
  assert.match(detail, /localStorage\.removeItem\(voiceProfileKey\)/);
  assert.match(detail, /buildVoiceHabitPrompt\(voiceHabitProfile\)/);
  assert.match(detail, /buildEmotionContinuityPrompt/);
  assert.match(detail, /maxScan: 24/);
  assert.match(serviceWorker, /phone-app-pwa-v173/);
  assert.match(serviceWorker, /chat-presence-policy\.js\?v=20261102v17/);
});


test('emotion continuity detects explicit first-person emotional signals but ignores negation and casual text', () => {
  assert.equal(typeof presencePolicy.classifyExplicitEmotion, 'function');
  assert.equal(typeof presencePolicy.findRecentEmotionalSignal, 'function');
  assert.equal(typeof presencePolicy.buildEmotionContinuityPrompt, 'function');

  assert.equal(presencePolicy.classifyExplicitEmotion('我有点委屈，刚才那句话让我不舒服。').kind, 'hurt');
  assert.equal(presencePolicy.classifyExplicitEmotion('我真的很担心你。').kind, 'worry');
  assert.equal(presencePolicy.classifyExplicitEmotion('你让我很难过。').kind, 'hurt');
  assert.equal(presencePolicy.classifyExplicitEmotion('我好喜欢你。').kind, 'affection');
  assert.equal(presencePolicy.classifyExplicitEmotion('我不是很难过了。'), null);
  assert.equal(presencePolicy.classifyExplicitEmotion('我不开心。').kind, 'hurt');
  assert.equal(presencePolicy.classifyExplicitEmotion('我不高兴。').kind, 'hurt');
  assert.equal(presencePolicy.classifyExplicitEmotion('我开心吗？'), null);
  assert.equal(presencePolicy.classifyExplicitEmotion('我是不是很难过？'), null);
  assert.equal(presencePolicy.classifyExplicitEmotion('我没有生气。'), null);
  assert.equal(presencePolicy.classifyExplicitEmotion('哈哈我今天吃了面条。'), null);
  assert.equal(presencePolicy.classifyExplicitEmotion('你今天开心吗？'), null);
});

test('emotion continuity exposes only a recent short-lived cue and asks the model to verify resolution', () => {
  const history = [
    { role: 'user', text: '我有点委屈，刚才那句话让我不舒服。' },
    { role: 'assistant', text: '我明白了，刚才没顾及你的感受。' },
    { role: 'user', text: '嗯，我现在好多了。' },
    { role: 'assistant', text: '那就好。' }
  ];
  const signal = presencePolicy.findRecentEmotionalSignal(history, { mode: 'online' });
  assert.ok(signal);
  assert.equal(signal.kind, 'hurt');
  assert.equal(signal.speaker, 'other');
  assert.equal(signal.turnsSince, 2);

  const prompt = presencePolicy.buildEmotionContinuityPrompt(history, { mode: 'online' });
  assert.ok(prompt.includes('委屈或难过'));
  assert.ok(prompt.includes('如果已经缓和或话题已经转开，就正常交流'));
  assert.ok(prompt.includes('最多在接下来一到两轮'));
  assert.ok(prompt.includes('不构成角色的长期性格'));
  assert.equal(prompt.includes('我有点委屈，刚才那句话让我不舒服'), false);
});

test('emotion continuity expires after more than two later user turns and is disabled in non-chat scenes', () => {
  const history = [
    { role: 'user', text: '我真的很担心。' },
    { role: 'assistant', text: '我知道。' },
    { role: 'user', text: '那我先去忙了。' },
    { role: 'assistant', text: '好。' },
    { role: 'user', text: '我回来了。' },
    { role: 'assistant', text: '嗯。' },
    { role: 'user', text: '今天过得还行。' }
  ];
  assert.equal(presencePolicy.findRecentEmotionalSignal(history, { mode: 'online' }), null);
  assert.equal(presencePolicy.buildEmotionContinuityPrompt(history, { mode: 'narration' }), '');
  assert.equal(presencePolicy.buildEmotionContinuityPrompt(history, { mode: 'offline' }), '');
  assert.equal(presencePolicy.buildEmotionContinuityPrompt(history, { mode: 'date' }), '');
});

test('emotion continuity keeps group speaker signals isolated', () => {
  const history = [
    { role: 'user', text: '我有点担心这件事。' },
    { role: 'assistant', memberId: 'role-b', name: '阿岚', text: '我真的很生气。' },
    { role: 'assistant', memberId: 'role-a', name: '小林', text: '嗯，我听到了。' }
  ];
  const signal = presencePolicy.findRecentEmotionalSignal(history, {
    mode: 'online', isGroupChat: true, speakerId: 'role-a', speakerName: '小林'
  });
  assert.ok(signal);
  assert.equal(signal.kind, 'worry');
  assert.equal(signal.speaker, 'other');
  assert.equal(signal.turnsSince, 1);

  const ownSignalHistory = [
    { role: 'user', text: '今天还好。' },
    { role: 'assistant', memberId: 'role-a', name: '小林', text: '其实我有点失落。' },
    { role: 'user', text: '怎么了？' }
  ];
  const ownSignal = presencePolicy.findRecentEmotionalSignal(ownSignalHistory, {
    mode: 'online', isGroupChat: true, speakerId: 'role-a', speakerName: '小林'
  });
  assert.ok(ownSignal);
  assert.equal(ownSignal.speaker, 'self');
  assert.equal(ownSignal.kind, 'hurt');
});


test('life continuity extracts only explicit first-person plans, activities and interests', () => {
  assert.equal(typeof presencePolicy.extractLifeNoteSentences, 'function');
  assert.equal(typeof presencePolicy.collectLifeContinuityNotes, 'function');
  assert.equal(typeof presencePolicy.buildAutonomyPrompt, 'function');

  const cases = [
    { text: '我明天准备去图书馆看书。', expected: true },
    { text: '我今晚还得加班。', expected: true },
    { text: '我最近在学做甜点。', expected: true },
    { text: '我这周末有考试。', expected: true },
    { text: '我平时喜欢烘焙。', expected: true },
    { text: '我对电影很感兴趣。', expected: true },
    { text: '我最近挺喜欢画画。', expected: true },
    { text: '我最近觉得很累。', expected: false },
    { text: '我今天不开心。', expected: false },
    { text: '我明天要不要去？', expected: false },
    { text: '我今天不要去。', expected: false },
    { text: '我昨天去看电影了。', expected: false },
    { text: '我今天看了电影。', expected: false },
    { text: '我今天准备把工作做完。', expected: true },
    { text: '我最近想你。', expected: false },
    { text: '哈哈，今天吃了面条。', expected: false }
  ];

  for (const item of cases) {
    assert.equal(
      presencePolicy.extractLifeNoteSentences(item.text).length > 0,
      item.expected,
      item.text
    );
  }
});

test('life continuity only uses the active role own notes and expires old plans', () => {
  const history = [
    { role: 'user', text: '你周末有什么安排？' },
    { role: 'assistant', text: '我明天准备去图书馆看书。' },
    { role: 'user', text: '准备看什么？' },
    { role: 'assistant', text: '可能看一本小说。' },
    { role: 'user', text: '听起来不错。' }
  ];
  const notes = presencePolicy.collectLifeContinuityNotes(history, { mode: 'online' });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].text, '我明天准备去图书馆看书。');
  assert.equal(notes[0].kind, 'activity');
  assert.equal(notes[0].turnsSince, 2);

  const expired = [
    { role: 'assistant', text: '我明天准备去图书馆看书。' },
    { role: 'user', text: '1' }, { role: 'assistant', text: '2' },
    { role: 'user', text: '3' }, { role: 'assistant', text: '4' },
    { role: 'user', text: '5' }, { role: 'assistant', text: '6' },
    { role: 'user', text: '7' }, { role: 'assistant', text: '8' },
    { role: 'user', text: '9' }
  ];
  assert.deepEqual(Array.from(presencePolicy.collectLifeContinuityNotes(expired, {
    mode: 'online', maxTurns: 4
  })), []);
});

test('life continuity separates group members and disables offline scenes', () => {
  const history = [
    { role: 'assistant', memberId: 'role-a', name: '小林', text: '我明天准备去图书馆看书。' },
    { role: 'assistant', memberId: 'role-b', name: '阿岚', text: '我今晚还得加班。' },
    { role: 'assistant', memberId: 'role-a', name: '小林', text: '我平时喜欢烘焙。' }
  ];
  const notes = presencePolicy.collectLifeContinuityNotes(history, {
    mode: 'online', isGroupChat: true, speakerId: 'role-a', speakerName: '小林'
  });
  assert.deepEqual(
    Array.from(notes.map((item) => item.text)),
    ['我平时喜欢烘焙。', '我明天准备去图书馆看书。']
  );
  assert.equal(notes.some((item) => item.text.includes('加班')), false);
  assert.equal(presencePolicy.buildAutonomyPrompt(history, { mode: 'offline' }), '');
  assert.deepEqual(Array.from(presencePolicy.collectLifeContinuityNotes(history, {
    mode: 'offline', isGroupChat: true, speakerId: 'role-a', speakerName: '小林'
  })), []);
});

test('autonomy prompt encourages restrained initiative without inventing real-world activity', () => {
  const prompt = presencePolicy.buildAutonomyPrompt([
    { role: 'assistant', text: '我最近在学做甜点。' },
    { role: 'user', text: '原来如此。' }
  ], { mode: 'online' });
  assert.ok(prompt.includes('角色自主性与生活连续性'));
  assert.ok(prompt.includes('不是每轮都要主动发起新话题'));
  assert.ok(prompt.includes('我最近在学做甜点。'));
  assert.ok(prompt.includes('没有已知安排时，不要编造'));
  assert.ok(prompt.includes('对方不接话题时自然放下'));
  assert.ok(prompt.includes('不要连续重复'));
});

test('chat detail injects the role autonomy prompt and precaches the updated policy', () => {
  assert.ok(detail.includes('ChatPresencePolicy.buildAutonomyPrompt'));
  assert.ok(detail.includes('maxNotes: 3'));
  assert.ok(detail.includes('maxTurns: 4'));
  assert.ok(detail.includes('chat-presence-policy.js?v=20261102v17'));
  assert.ok(serviceWorker.includes('phone-app-pwa-v173'));
  assert.ok(serviceWorker.includes('chat-presence-policy.js?v=20261102v17'));
});


test('follow-up delay escalates by round, adds bounded jitter and respects relationship pace', () => {
  assert.equal(followUpPolicy.calculateDelay(1, 'friend', 0.5), 30);
  assert.equal(followUpPolicy.calculateDelay(2, 'friend', 0.5), 45);
  assert.equal(followUpPolicy.calculateDelay(3, 'friend', 0.5), 60);
  assert.equal(followUpPolicy.calculateDelay(1, 'stranger', 0), 23);
  assert.equal(followUpPolicy.calculateDelay(1, 'close', 0.5), 23);
  assert.equal(followUpPolicy.calculateDelay(1, 'lover', 0.5), 15);
  assert.ok(followUpPolicy.calculateDelay(1, 'friend', 0) >= 15);
  assert.ok(followUpPolicy.calculateDelay(1, 'friend', 0.999) <= 45);
  assert.ok(followUpPolicy.calculateDelay(2, 'friend', 0.5, 0.2) >
    followUpPolicy.calculateDelay(2, 'friend', 0.5, 0.7));
});

test('follow-up policy blocks quiet hours, persists a pause and ends a chain on user reply', () => {
  const night = new Date(2026, 10, 2, 23, 30, 0).getTime();
  assert.equal(followUpPolicy.isQuietTime(night), true);
  const nextMorning = followUpPolicy.nextAllowedTime(night);
  assert.equal(new Date(nextMorning).getHours(), 9);
  assert.equal(new Date(nextMorning).getMinutes(), 0);
  const state = { ignoredCount: 0, userReceptivityScore: 0.7 };
  followUpPolicy.applyUserIntent(state, '先别主动联系了', night);
  assert.equal(state.pausedByUser, true);
  assert.equal(state.cooldownUntil, night + 72 * 60 * 60 * 1000);
  assert.equal(followUpPolicy.shouldBlock(state, night + 1000).blocked, true);
  followUpPolicy.applyUserIntent(state, '可以继续主动联系', night + 2000);
  assert.equal(state.pausedByUser, false);
  assert.equal(state.cooldownUntil, 0);
  state.followUpCount = 2; state.dueAt = night + 5000;
  followUpPolicy.noteUserReply(state);
  assert.equal(state.followUpCount, 0);
  assert.equal(state.dueAt, 0);
  assert.ok(state.userReceptivityScore > 0.7);
  const noReplyCooldown = { ignoredCount: 3, pausedByUser: false };
  followUpPolicy.shouldBlock(noReplyCooldown, night);
  followUpPolicy.noteUserReply(noReplyCooldown);
  assert.equal(noReplyCooldown.cooldownUntil, 0);
});

test('follow-up policy escalates no-reply cooldown and builds non-pressuring contextual prompts', () => {
  const state = { ignoredCount: 3 };
  const blocked = followUpPolicy.shouldBlock(state, 1000000);
  assert.equal(blocked.reason, 'repeated-no-reply');
  assert.equal(state.cooldownUntil, 1000000 + 24 * 60 * 60 * 1000);
  const prompt = followUpPolicy.buildPrompt({ name: '小林', round: 2, relationship: '朋友', persona: '安静，喜欢阅读。', context: '用户：最近加班。\n角色：这周挺忙的。' });
  assert.match(prompt, /最多20个汉字/);
  assert.match(prompt, /不责备、不施压/);
  assert.match(prompt, /["']send["']\s*:\s*false/);
});

test('proactive contact policy requires a complete, opted-in conversation and a quiet idle window', () => {
  assert.equal(typeof presencePolicy.evaluateProactiveContact, 'function');
  assert.equal(typeof presencePolicy.buildProactiveContactPrompt, 'function');

  const now = new Date(2026, 10, 2, 12, 0, 0).getTime();
  const history = [
    { role: 'user', text: '你周末有什么安排？', time: now - 14 * 60 * 60 * 1000 },
    { role: 'assistant', text: '我明天准备去图书馆看书。', time: now - 13.8 * 60 * 60 * 1000 },
    { role: 'user', text: '准备看什么？', time: now - 13.5 * 60 * 60 * 1000 },
    { role: 'assistant', text: '可能看一本小说，顺便找找资料。', time: now - 13 * 60 * 60 * 1000 }
  ];
  const options = {
    enabled: true,
    now,
    localHour: 12,
    minIdleMs: 8 * 60 * 60 * 1000,
    maxInactiveMs: 30 * 24 * 60 * 60 * 1000,
    globalCooldownMs: 24 * 60 * 60 * 1000,
    roleCooldownMs: 24 * 60 * 60 * 1000,
    quietStartHour: 9,
    quietEndHour: 22
  };

  const eligible = presencePolicy.evaluateProactiveContact(history, options);
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.reason, 'eligible');
  assert.equal(eligible.historyCount, 4);

  assert.equal(
    presencePolicy.evaluateProactiveContact(history, { ...options, enabled: false }).reason,
    'disabled'
  );
  assert.equal(
    presencePolicy.evaluateProactiveContact(history, { ...options, localHour: 23 }).reason,
    'quiet-hours'
  );
  assert.equal(
    presencePolicy.evaluateProactiveContact(history, {
      ...options, globalLastAttemptAt: now - 4 * 60 * 60 * 1000
    }).reason,
    'global-cooldown'
  );
  assert.equal(
    presencePolicy.evaluateProactiveContact(history, {
      ...options, roleLastAttemptAt: now - 5 * 60 * 60 * 1000, roleCooldownMs: 48 * 60 * 60 * 1000
    }).reason,
    'role-cooldown'
  );
  assert.equal(
    presencePolicy.evaluateProactiveContact(history, { ...options, minIdleMs: 20 * 60 * 60 * 1000 }).reason,
    'not-idle-long-enough'
  );
});

test('proactive contact waits for a reply, expires dormant history and never chains its own messages', () => {
  const now = new Date(2026, 10, 2, 12, 0, 0).getTime();
  const options = {
    enabled: true, now, localHour: 12,
    minIdleMs: 8 * 60 * 60 * 1000,
    maxInactiveMs: 30 * 24 * 60 * 60 * 1000,
    globalCooldownMs: 24 * 60 * 60 * 1000,
    roleCooldownMs: 24 * 60 * 60 * 1000
  };
  const history = [
    { role: 'user', text: '你周末有什么安排？', time: now - 14 * 60 * 60 * 1000 },
    { role: 'assistant', text: '我明天准备去图书馆看书。', time: now - 13.8 * 60 * 60 * 1000 },
    { role: 'user', text: '准备看什么？', time: now - 13.5 * 60 * 60 * 1000 },
    { role: 'assistant', text: '你觉得看小说怎么样？', time: now - 13 * 60 * 60 * 1000 }
  ];
  assert.equal(
    presencePolicy.evaluateProactiveContact(history, options).reason,
    'awaiting-answer'
  );

  const unanswered = [
    { role: 'user', text: '你还好吗？', time: now - 14 * 60 * 60 * 1000 },
    { role: 'assistant', text: '嗯，还好。', time: now - 13 * 60 * 60 * 1000 },
    { role: 'user', text: '那就好。', time: now - 12 * 60 * 60 * 1000 },
    { role: 'assistant', text: '我刚好想起一件事。', time: now - 11 * 60 * 60 * 1000, proactiveContact: true }
  ];
  assert.equal(
    presencePolicy.evaluateProactiveContact(unanswered, options).reason,
    'awaiting-user-after-proactive-message'
  );

  const oldHistory = [
    { role: 'user', text: '你好呀。', time: now - 32 * 24 * 60 * 60 * 1000 },
    { role: 'assistant', text: '你好。', time: now - 32 * 24 * 60 * 60 * 1000 + 1000 },
    { role: 'user', text: '最近怎么样？', time: now - 31 * 24 * 60 * 60 * 1000 },
    { role: 'assistant', text: '还不错。', time: now - 31 * 24 * 60 * 60 * 1000 + 1000 }
  ];
  assert.equal(
    presencePolicy.evaluateProactiveContact(oldHistory, options).reason,
    'inactive-too-long'
  );
});

test('proactive contact prompt allows skipping and forbids guilt, pressure and invented actions', () => {
  const prompt = presencePolicy.buildProactiveContactPrompt(
    { name: '小林', persona: '安静，喜欢阅读。' },
    [
      { role: 'user', text: '你周末有什么安排？' },
      { role: 'assistant', text: '我明天准备去图书馆看书。' },
      { role: 'user', text: '准备看什么？' },
      { role: 'assistant', text: '可能看一本小说。' }
    ],
    { localTime: '2026-11-02 12:00' }
  );
  assert.ok(prompt.includes('MAOMAO 主动联系时机判断'));
  assert.ok(prompt.includes('宁可跳过'));
  assert.ok(prompt.includes('为什么不理我'));
  assert.ok(prompt.includes('{"send":false,"text":""}'));
  assert.ok(prompt.includes('我明天准备去图书馆看书。'));
  assert.ok(prompt.includes('当前本地时间'));
});

test('proactive contact is opt-in, foreground-only, daily-capped and reuses chat history notifications', () => {
  assert.match(chatSettings, /chat_proactive_contact_[' ]\s*\+\s*roleId/);
  assert.match(chatSettings, /chat_proactive_interval_[' ]\s*\+\s*roleId/);
  assert.match(chatSettings, /return localStorage\.getItem\(PROACTIVE_CONTACT_KEY\) === 'true'/);
  assert.match(chatSettings, /proactiveContactInterval/);
  assert.match(chatSettings, /value="24"/);
  assert.match(chatSettings, /value="48"/);
  assert.match(chatSettings, /value="72"/);

  assert.match(chatNotifier, /document\.visibilityState === 'hidden'/);
  assert.match(chatNotifier, /PROACTIVE_GLOBAL_COOLDOWN_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(chatNotifier, /PROACTIVE_MIN_IDLE_MS = 8 \* 60 \* 60 \* 1000/);
  assert.match(chatNotifier, /checkFollowUpTasks/);
  assert.match(chatNotifier, /chat_followup_state_/);
  assert.match(chatNotifier, /proactiveFollowUp: true/);
  assert.match(chatNotifier, /startFollowUpScheduler/);
  assert.match(chatNotifier, /maomao:followup-message/);
  assert.match(chatNotifier, /FOLLOW_UP_LOCK_KEY/);
  assert.match(chatNotifier, /isReplyToPendingChain/);
  assert.match(chatNotifier, /lastUserMessageAt/);
  assert.match(chatNotifier, /assistantTime \+ firstDelay/);
  assert.match(chatSettings, /chat_followup_enabled_/);
  assert.match(groupPlay, /followUpEnabled:false/);
  assert.match(groupPlay, /data-setting="followUpEnabled"/);
  assert.match(chatNotifier, /PhoneAPI\.completeJSON/);
  assert.match(chatNotifier, /chat_proactive_global_attempt_at/);
  assert.match(chatNotifier, /proactiveContact: true/);
  assert.match(chatNotifier, /saveChatHistory\(candidate\.contact\.id, freshHistory\)/);
  assert.match(chatNotifier, /tick\(\);/);
  assert.match(chatNotifier, /startProactiveScheduler\(\)/);
  assert.match(chatNotifier, /executeCloudProactiveCandidate/);
  assert.match(chatNotifier, /ensureCloudExecutorPresence/);
  assert.match(chatNotifier, /updatePresenceHeartbeat\(true\)/);
  assert.match(chatNotifier, /updateCharacterLease\(key, 'acquire'\)/);
  assert.match(chatNotifier, /ownedByCurrentDevice !== true/);
  assert.match(chatNotifier, /hasStoredCloudDeviceCredentials/);
  assert.match(chatNotifier, /cloud_device_v1/);
  const contextOwnershipIndex = chatNotifier.indexOf('context.ownedByCurrentDevice !== true');
  const leaseAcquireIndex = chatNotifier.indexOf('await ensureCloudExecutorPresence(roleId, cloud)');
  assert.ok(contextOwnershipIndex >= 0 && leaseAcquireIndex > contextOwnershipIndex,
    '必须先确认最新上下文归当前设备，再申请角色租约');
  assert.match(chatNotifier, /getCharacterContextVersion\(roleId\)/);
  assert.match(chatNotifier, /enqueueAutonomyActivity\(roleId, Number\(context\.version\)\)/);
  assert.match(chatNotifier, /claimAutonomyActivity\(roleId\)/);
  assert.match(chatNotifier, /completeAutonomyActivity\(activity, content\)/);
  assert.match(chatNotifier, /skipAutonomyActivity\(activity, 'no_worthy_message'\)/);
  assert.match(chatNotifier, /localMessage\.serverMessageId = serverMessageId|serverMessageId: serverMessageId/);

});

test('proactive contact notifier is loaded on home and navigation pages and precached by PWA', () => {
  assert.match(homePage, /chat-notifier\.js\?v=20261107v1/);
  assert.match(navPage, /chat-notifier\.js\?v=20261107v1/);
  assert.match(detail, /chat-notifier\.js\?v=20261107v1/);
  assert.match(detail, /chat-presence-policy\.js\?v=20261102v17/);
  assert.match(serviceWorker, /phone-app-pwa-v175/);
  assert.match(serviceWorker, /chat-notifier\.js\?v=20261107v1/);
  assert.match(serviceWorker, /chat-presence-policy\.js\?v=20261102v17/);
  assert.match(serviceWorker, /chat-followup-policy/);
});


test('role public timeline shares only the role own recent public or friends-visible Moments', () => {
  assert.equal(typeof rolePublicTimeline.collectRolePublicMoments, 'function');
  assert.equal(typeof rolePublicTimeline.buildRolePrompt, 'function');
  const now = new Date(2026, 10, 2, 12, 0, 0).getTime();
  const moments = [
    { id: 'a', authorId: 'role-a', visibility: 'public', content: '我明天准备去海边散步。', time: now - 2 * 60 * 60 * 1000 },
    { id: 'b', authorId: 'role-a', visibility: 'private', content: '我不想让别人知道这件事。', time: now - 60 * 60 * 1000 },
    { id: 'c', authorId: 'role-a', visibility: 'custom', content: '只对特定对象可见。', time: now - 50 * 60 * 1000 },
    { id: 'd', authorId: 'role-b', visibility: 'public', content: '我今晚还得加班。', time: now - 40 * 60 * 1000 },
    { id: 'e', authorId: 'role-a', visibility: 'friends', content: '我最近在学做甜点。', time: now - 30 * 60 * 1000 },
    { id: 'f', authorId: 'role-a', visibility: 'public', content: '这条动态已经过期。', time: now - 20 * 24 * 60 * 60 * 1000 }
  ];
  const entries = rolePublicTimeline.collectRolePublicMoments('role-a', moments, { now, maxEntries: 5 });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].text, '我最近在学做甜点。');
  assert.equal(entries[1].text, '我明天准备去海边散步。');
  const prompt = rolePublicTimeline.buildRolePrompt('role-a', moments, { now });
  assert.ok(prompt.includes('角色跨场景公开近况'));
  assert.ok(prompt.includes('我最近在学做甜点。'));
  assert.ok(prompt.includes('不包含一对一私聊'));
  assert.equal(prompt.includes('我不想让别人知道这件事。'), false);
  assert.equal(prompt.includes('只对特定对象可见。'), false);
  assert.equal(prompt.includes('我今晚还得加班。'), false);
});

test('group public timeline includes only member-owned public posts and labels their owners', () => {
  assert.equal(typeof rolePublicTimeline.buildGroupPrompt, 'function');
  const now = new Date(2026, 10, 2, 12, 0, 0).getTime();
  const prompt = rolePublicTimeline.buildGroupPrompt(
    [{ id: 'role-a', name: '小林' }, { id: 'role-b', name: '阿岚' }],
    [
      { authorId: 'role-a', visibility: 'public', content: '我明天准备去图书馆。', time: now - 3 * 60 * 60 * 1000 },
      { authorId: 'role-b', visibility: 'private', content: '这件事不要告诉大家。', time: now - 2 * 60 * 60 * 1000 }
    ],
    { now }
  );
  assert.ok(prompt.includes('小林'));
  assert.ok(prompt.includes('我明天准备去图书馆。'));
  assert.equal(prompt.includes('阿岚'), false);
  assert.equal(prompt.includes('不要告诉大家'), false);
});

test('chat, group chat and Moments prompts consume the same public timeline without merging private histories', () => {
  assert.ok(detail.includes('role-public-timeline.js?v=20261102v1'));
  assert.ok(detail.includes('RolePublicTimeline.buildRolePrompt'));
  assert.ok(detail.includes('RolePublicTimeline.buildGroupPrompt'));
  assert.ok(detail.includes('PhoneStorage.getMoments()'));
  assert.ok(momentsPage.includes('role-public-timeline.js?v=20261102v1'));
  assert.ok(momentsPage.includes('RolePublicTimeline.buildRolePrompt'));
  assert.ok(serviceWorker.includes('phone-app-pwa-v173'));
  assert.ok(serviceWorker.includes('role-public-timeline.js?v=20261102v1'));
});
  
test('PWA manifest is referenced from the deployment root so relative icon and start URLs resolve correctly', () => {
  assert.ok(homePage.includes('href="%BASE_URL%manifest.json"'));
  assert.ok(serviceWorker.includes("'./manifest.json'"));
});

test('Service Worker navigation does not abort slow mobile page requests', () => {
  assert.ok(serviceWorker.includes("if (req.mode === 'navigate')"));
  assert.ok(serviceWorker.includes('fetch(req).then'));
  assert.equal(serviceWorker.includes('new AbortController()'), false);
  assert.equal(serviceWorker.includes('controller.abort()'), false);
});

test('Cloudflare Worker preserves explicit HTML routes and maps only the root to the desktop index', () => {
  const wranglerConfig = JSON.parse(read('wrangler.jsonc').replace(/^\/\/.*\n/, ''));
  const worker = read('worker.js');

  assert.equal(wranglerConfig.main, 'worker.js');
  assert.equal(wranglerConfig.assets.binding, 'ASSETS');
  assert.equal(wranglerConfig.assets.html_handling, 'none');
  assert.equal(wranglerConfig.assets.run_worker_first, true);
  assert.match(worker, /url\.pathname === "\/"[\s\S]*?new URL\("\/index\.html", url\)/);
  assert.match(worker, /return env\.ASSETS\.fetch\(request\)/,
    'non-root app routes must be passed through unchanged instead of falling back to index.html');
});


test('Messages chat-list theme is isolated, cache-busted, grayscale and hides inherited music UI', () => {
  const chatHome = read('chat/chat/chat.html');
  const storePage = read('theme-store/theme-store.html');
  const listThemeCss = read('shared/css/chat-list-editorial-theme.css');
  const listThemeScript = read('shared/js/chat-list-theme.js');

  assert.ok(chatHome.includes('chat-list-editorial-theme.css?v=20261104v2'));
  assert.ok(chatHome.includes('chat-list-theme.js?v=20261104v2'));
  assert.match(serviceWorker, /phone-app-pwa-v173/);
  assert.ok(serviceWorker.includes('./shared/css/chat-list-editorial-theme.css?v=20261104v2'));
  assert.ok(serviceWorker.includes('./shared/js/chat-list-theme.js?v=20261104v2'));

  for (const value of ['#F7F7F9', '#F0F0F3', '#FFFFFF', '#333333', '#777777', '#999999']) {
    assert.ok(listThemeCss.toUpperCase().includes(value), 'missing neutral token: ' + value);
  }
  assert.equal(listThemeCss.includes('#F7F6F2'), false, 'theme must not drift toward warm beige');
  const musicRuleStart = listThemeCss.indexOf('.phone-mockup[data-chat-list-theme="editorial"] .floating-music-card {');
  assert.notEqual(musicRuleStart, -1, 'music player selector must be scoped to the list theme');
  assert.match(listThemeCss.slice(musicRuleStart, musicRuleStart + 180), /display: none !important;/);
  assert.ok(listThemeCss.includes('.phone-mockup[data-chat-list-theme="editorial"] #chatListContainer {'));
  assert.equal(listThemeCss.includes('data-chat-theme-preset='), false, 'list-only CSS must not target whole-chat themes');

  assert.ok(storePage.includes("CHAT_LIST_THEME_KEY='maomao_chat_list_theme_preset_v1'"));
  assert.ok(storePage.includes("chat-list-theme-toggle')applyChatListTheme()"));
  assert.ok(storePage.includes("localStorage.removeItem(CHAT_LIST_THEME_KEY)"));

  const state = new Map([['maomao_chat_list_theme_preset_v1', 'editorial']]);
  const listeners = Object.create(null);
  const attributes = new Map();
  const shell = {
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key)
  };
  const windowLike = {
    localStorage: {
      getItem: (key) => state.has(key) ? state.get(key) : null,
      setItem: (key, value) => state.set(key, String(value)),
      removeItem: (key) => state.delete(key)
    },
    addEventListener: (name, callback) => { listeners[name] = callback; }
  };
  const documentLike = {
    readyState: 'complete',
    querySelector: (selector) => {
      assert.equal(selector, '.phone-mockup');
      return shell;
    }
  };

  runInNewContext(listThemeScript, { window: windowLike, document: documentLike });
  assert.equal(attributes.get('data-chat-list-theme'), 'editorial', 'saved theme should apply on page load');

  state.delete('maomao_chat_list_theme_preset_v1');
  listeners['maomao:chat-list-theme-change']();
  assert.equal(attributes.has('data-chat-list-theme'), false, 'removing theme should restore default');

  assert.equal(windowLike.MAOMAOChatListTheme.set('editorial'), true);
  assert.equal(state.get('maomao_chat_list_theme_preset_v1'), 'editorial');
  assert.equal(attributes.get('data-chat-list-theme'), 'editorial');
  assert.equal(windowLike.MAOMAOChatListTheme.set('default'), true);
  assert.equal(state.has('maomao_chat_list_theme_preset_v1'), false);
  assert.equal(attributes.has('data-chat-list-theme'), false);
});



test('Netlify Deploy Previews skip the full PWA app-shell installation', () => {
  const home = read('index.html');
  const previewGuard = home.indexOf("var previewHost = location.hostname.indexOf('deploy-preview-') === 0");
  const registration = home.indexOf("navigator.serviceWorker.register('./sw.js'");
  assert.notEqual(previewGuard, -1, 'deploy preview should bypass service worker registration');
  assert.ok(registration > previewGuard, 'production PWA registration must remain available outside preview hosts');
  assert.match(home, /swHadController|hadController/, 'first installation must not trigger a duplicate document reload');
});


test('theme store uses a bounded viewport scroll area on mobile', () => {
  const storePage = read('theme-store/theme-store.html');
  const appRule = storePage.match(/\.store-app\{([^}]*)\}/);
  const scrollRule = storePage.match(/\.main-content\{([^}]*)\}/);

  assert.ok(appRule, 'store app shell rule should exist');
  assert.match(appRule[1], /height:100vh/);
  assert.match(appRule[1], /height:100dvh/, 'dynamic viewport height should track mobile browser chrome');
  assert.ok(scrollRule, 'main content scroll rule should exist');
  assert.match(scrollRule[1], /flex:1 1 auto/);
  assert.match(scrollRule[1], /min-height:0/, 'flex child must be allowed to shrink into the viewport');
  assert.match(scrollRule[1], /overflow-y:auto/);
  assert.match(scrollRule[1], /overscroll-behavior-y:contain/);
  assert.match(scrollRule[1], /-webkit-overflow-scrolling:touch/);
});


test('chat contacts page uses the shared full-screen mobile layout', () => {
  const contacts = read('chat/contacts/contacts.html');
  const chatHome = read('chat/chat/chat.html');
  const mobileFit = read('shared/css/mobile-fit.css');

  assert.ok(chatHome.includes('shared/css/mobile-fit.css'), 'chat home should load shared mobile layout');
  assert.ok(contacts.includes('shared/css/mobile-fit.css'), 'contacts must use the same mobile layout');
  assert.ok(contacts.indexOf('shared/css/mobile-fit.css') > contacts.indexOf('</style>'), 'shared overrides must load after page-local CSS');
  assert.match(mobileFit, /\.phone-mockup,[\s\S]*?height: 100vh !important;[\s\S]*?height: 100dvh !important;/);
  assert.ok(contacts.includes('.contact-stage'), 'contacts scroll stage should remain present');
});


test('whole-chat theme is refreshed when a chat page is restored from browser history', () => {
  const themeScript = read('shared/js/chat-page-theme.js');
  const state = new Map([['maomao_chat_theme_preset', 'default']]);
  const listeners = Object.create(null);
  const attributes = new Map();
  const shell = {
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key)
  };
  const windowLike = {
    localStorage: {
      getItem: (key) => state.has(key) ? state.get(key) : null
    },
    addEventListener: (name, callback) => { listeners[name] = callback; }
  };
  const documentLike = {
    readyState: 'complete',
    querySelectorAll: (selector) => {
      assert.equal(selector, '.phone-mockup');
      return [shell];
    }
  };

  runInNewContext(themeScript, { window: windowLike, document: documentLike });
  assert.equal(attributes.get('data-chat-theme-preset'), 'default', 'saved theme should apply at initial load');

  state.set('maomao_chat_theme_preset', 'wechat');
  assert.equal(typeof listeners.pageshow, 'function', 'theme bridge should listen for bfcache/page restoration');
  listeners.pageshow({ persisted: true });
  assert.equal(attributes.get('data-chat-theme-preset'), 'wechat', 'restored page should read the latest saved theme');

  state.set('maomao_chat_theme_preset', 'imessage');
  listeners['maomao:chat-theme-change']();
  assert.equal(attributes.get('data-chat-theme-preset'), 'imessage', 'same-page theme changes should still apply');

  for (const path of [
    'chat/chat/chat.html',
    'chat/chat/chat-detail.html',
    'chat/contacts/contacts.html',
    'chat/moments/moments.html',
    'profile/profile.html'
  ]) {
    assert.ok(read(path).includes('chat-page-theme.js?v=20261105v1'), path + ' should load the refreshed theme bridge');
  }
  assert.match(serviceWorker, /phone-app-pwa-v173/, 'the PhoneAPI and settings changes require the refreshed PWA cache');
});


test('MAo uses the bunny as its installed app icon and exposes the three default avatar presets', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.name, 'MAo');
  assert.equal(manifest.short_name, 'MAo');
  assert.ok(manifest.icons.some(icon => icon.src === './assets/mao-bunny-192.png' && icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.src === './assets/mao-bunny-512.png' && icon.purpose === 'maskable'));

  assert.ok(homePage.includes('<title>MAo</title>'));
  assert.match(homePage, /name="apple-mobile-web-app-title" content="MAo"/);
  assert.ok(homePage.includes('apple-touch-icon') && homePage.includes('mao-bunny-192.png'));

  for (const asset of ['avatar-bunny.svg', 'avatar-cat.svg', 'avatar-cat-dark.svg']) {
    assert.ok(profileEditor.includes('data-avatar-src="../assets/' + asset + '"'), 'missing selectable avatar: ' + asset);
    assert.ok(profileEditor.includes('"../assets/' + asset + '": "data:image/svg+xml;charset=UTF-8,%3Csvg'), 'preset should persist as a portable data URL: ' + asset);
    assert.ok(serviceWorker.includes('./assets/' + asset), 'avatar must be available offline: ' + asset);
    assert.ok(read('assets/' + asset).includes('<svg'), 'avatar SVG asset should exist: ' + asset);
  }
  assert.ok(serviceWorker.includes('./assets/mao-bunny-192.png'));
  assert.ok(serviceWorker.includes('./assets/mao-bunny-512.png'));
});


test('PhoneStorage automatically assigns one of the three default avatars only when the profile avatar is empty', () => {
  function bootStorage(initialProfile, randomValue) {
    const data = new Map();
    if (initialProfile !== undefined) data.set('myProfile', JSON.stringify(initialProfile));
    const localStorage = {
      getItem(key) { return data.has(key) ? data.get(key) : null; },
      setItem(key, value) { data.set(key, String(value)); },
      removeItem(key) { data.delete(key); },
      key(index) { return Array.from(data.keys())[index] || null; },
      get length() { return data.size; }
    };
    const windowLike = {};
    runInNewContext(storage, {
      window: windowLike,
      localStorage,
      console: { warn() {} },
      Math: { floor: Math.floor, random: () => randomValue }
    });
    return { api: windowLike.PhoneStorage, data };
  }

  const fresh = bootStorage(undefined, 0.5);
  const presets = fresh.api.getDefaultAvatarPresets();
  assert.equal(presets.length, 3);
  const assigned = fresh.api.getMyProfile();
  assert.ok(presets.some(item => item.dataUrl === assigned.avatar), 'fresh profile receives one of the three built-in avatars');
  assert.equal(JSON.parse(fresh.data.get('myProfile')).avatar, assigned.avatar, 'default avatar is persisted');
  assert.equal(fresh.api.getMyProfile().avatar, assigned.avatar, 'the assigned default stays stable between pages');

  const existing = bootStorage({ nickname: '已有用户', avatar: 'data:image/png;base64,custom-avatar' }, 0.1);
  assert.equal(existing.api.getMyProfile().avatar, 'data:image/png;base64,custom-avatar', 'existing custom avatar must never be overwritten');
});

test('the shared default portrait is displayed across music, chat calls, settings, finance and forum identity surfaces', () => {
  const music = read('music/music.html');
  const callUi = read('chat/call/call-ui.html');
  const settings = read('settings/settings.html');
  const finance = read('wallet/finance.html');
  const forum = read('forum/forum.html');
  const forumDetail = read('forum/forum-detail.html');
  const couple = read('couple/couple.html');

  assert.ok(music.includes('phone_storage.js'));
  assert.ok(music.includes("renderMusicAvatar(document.getElementById('musicHomeAvatar')"));
  assert.ok(music.includes("renderMusicAvatar(document.getElementById('pAvatar')"));
  assert.equal(music.includes('editAvatar'), false, 'music must not keep a separate letter-avatar editor');
  assert.equal(music.includes("setItem('music_profile_avatar'"), false);

  assert.ok(detail.includes('fillAvatar(avatar, getMyAvatar(), USER_SVG)'), 'outgoing chat messages use the shared user portrait');
  assert.ok(callUi.includes('phone_storage.js'));
  assert.ok(callUi.includes('PhoneStorage.getMyProfile()'), 'outgoing call UI initializes and reads the shared profile');

  assert.ok(settings.includes('PhoneStorage.getMyProfile()'));
  assert.ok(settings.includes('avatarImage.src = avatarSrc'));
  assert.ok(finance.includes('PhoneStorage.getMyProfile()'));
  assert.ok(finance.includes('financeUserAvatar'));
  assert.ok(finance.includes('image.src = src'));

  assert.ok(forum.includes('function forumAvatarContent(p)'));
  assert.ok(forum.includes('forumAvatarContent(p)'));
  assert.ok(forum.includes('function getMyForumAvatar()'));
  assert.ok(forumDetail.includes('function avatarContent(item, isUserPost)'));
  assert.ok(forumDetail.includes('avatarContent(c, false)'));
  assert.ok(forumDetail.includes('avatarContent(r, false)'));

  assert.ok(couple.includes('phone_storage.js'));
  assert.ok(couple.includes('const myPortrait = profile.myAvatar || sharedAvatar;'), 'couple profile keeps its own uploaded portrait, otherwise inherits the shared default');
});


test('forum detail post and comment avatars retain their own sizing and clipping rules', () => {
  const source = read('forum/forum-detail.html');
  const styleStart = source.indexOf('<style');
  const styleBodyStart = source.indexOf('>', styleStart) + 1;
  const styleEnd = source.indexOf('</style>', styleBodyStart);
  assert.ok(styleStart >= 0 && styleBodyStart > 0 && styleEnd > styleBodyStart,
    'forum detail page should contain a readable stylesheet');
  const css = source.slice(styleBodyStart, styleEnd);

  function getAvatarRule(selector) {
    const start = css.indexOf(selector + ' {');
    assert.ok(start >= 0, selector + ' rule must exist as a standalone rule');
    const end = css.indexOf('}', start);
    assert.ok(end > start, selector + ' rule must close');
    return css.slice(start, end + 1);
  }

  const postAvatarRule = getAvatarRule('.p-avatar');
  const commentAvatarRule = getAvatarRule('.c-avatar');
  assert.ok(postAvatarRule.includes('width: 27px;'), 'post avatar keeps its width');
  assert.ok(postAvatarRule.includes('overflow: hidden;'), 'post avatar clips its image');
  assert.ok(commentAvatarRule.includes('width: 27px;'), 'comment avatar keeps its width');
  assert.ok(commentAvatarRule.includes('overflow: hidden;'), 'comment avatar clips its image');
  assert.equal(css.includes('.p-avatar{.p-avatar'), false, 'post avatar selector must not be nested');
  assert.equal(css.includes('.c-avatar{.c-avatar'), false, 'comment avatar selector must not be nested');
});

test('WeChat page refinements load on all five core pages and stay isolated from other themes', () => {
  const stylesheetVersion = 'wechat-theme-refinements.css?v=20261105v2';
  for (const [pageName, source] of [
    ['chat home', chatListPage],
    ['chat detail', detail],
    ['contacts', contactsPage],
    ['Moments', momentsPage],
    ['Me profile', profilePage]
  ]) {
    assert.equal(
      source.split(stylesheetVersion).length - 1,
      1,
      pageName + ' must load the WeChat refinement layer exactly once'
    );
  }

  const selectorLines = wechatThemeCss
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('.'));
  assert.ok(selectorLines.length > 0, 'the WeChat refinement stylesheet should contain scoped selectors');
  assert.ok(
    selectorLines.every((line) => line.startsWith('.phone-mockup[data-chat-theme-preset="wechat"]')),
    'every selector must be scoped to the active WeChat preset'
  );
  const activeStylesheetRules = wechatThemeCss.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(
    activeStylesheetRules,
    /\.msg-bubble\b/,
    'message bubbles must remain under ChatBeauty customization'
  );
  assert.ok(serviceWorker.includes("'./shared/css/wechat-theme-refinements.css?v=20261105v2'"));
  assert.ok(serviceWorker.includes('phone-app-pwa-v173'));
  assert.ok(
    wechatThemeCss.includes('.floating-nav .nav-tab > span:nth-of-type(2)::after'),
    'WeChat labels must attach to the second span, not the optional unread badge'
  );
  assert.equal(
    wechatThemeCss.includes('span:last-child::after'),
    false,
    'the optional badge must never be treated as a navigation label'
  );
  assert.ok(
    wechatThemeCss.includes('grid-template-columns: repeat(4, minmax(0, 1fr))'),
    'the four WeChat navigation items must use equal-width columns'
  );
  assert.ok(
    wechatThemeCss.includes('height: calc(64px + env(safe-area-inset-bottom, 0px))'),
    'the navigation bar must reserve one consistent content height plus the device safe area'
  );
});

test('WeChat Moments keeps the cover action menu available', () => {
  assert.ok(momentsPage.includes('id="btnAdd"'));
  assert.ok(momentsPage.includes('id="btnAiPost"'));
  assert.ok(momentsPage.includes('id="roleSelect"'));
  assert.match(
    wechatThemeCss,
    /\.cover-add-btn \{\r?\n  display: flex !important;/,
    'the visual refinement must not hide the cover action menu trigger'
  );
});
