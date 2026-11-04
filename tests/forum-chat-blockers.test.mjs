import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const forumHome = read('forum/forum.html');
const forumDetail = read('forum/forum-detail.html');
const chatDetail = read('chat/chat/chat-detail.html');

test('forum detail loads the same theme-aware seeded posts as the list and persists first initialization', () => {
  assert.match(forumHome, /function getSeededPosts\(\)/);
  assert.match(forumDetail, /function getSeededPosts\(\)/);
  assert.match(forumDetail, /const seeded=\[/);
  assert.match(forumHome, /localStorage\.setItem\(STORE,JSON\.stringify\(seedPosts\)\)/);
  assert.match(forumDetail, /if \(raw === null\)[\s\S]*?savePosts\(seedPosts\)/);
  assert.match(forumDetail, /function loadPosts\(\)[\s\S]*?mergeForumPosts\(stored,seedPosts\)/);
});

test('forum seed merge keeps existing comments/likes and user posts while refreshing themed seed copy', () => {
  const start = forumDetail.indexOf('function mergeForumPosts(');
  const end = forumDetail.indexOf('\nfunction loadPosts()', start);
  assert.ok(start >= 0 && end > start, 'detail page should expose the shared merge implementation');
  const mergeSource = forumDetail.slice(start, end) + '\nmergeForumPosts;';
  const mergeForumPosts = runInNewContext(mergeSource, { Map, Set });

  const merged = mergeForumPosts(
    [
      { id: 'p1', title: '旧主题标题', likes: 99, comments: [{ id: 'c1', text: '保留评论' }], liked: true },
      { id: 'user_abc', owner: 'me', title: '我的帖子', body: '用户正文' }
    ],
    [
      { id: 'p1', name: '宝宝', title: '当前主题标题', body: '当前主题正文', likes: 18, comments: 6, featured: true, owner: 'seed' },
      { id: 'p2', name: '拾光', title: '第二条种子', body: '正文', likes: 2, comments: 0, owner: 'seed' }
    ]
  );

  const p1 = merged.find((item) => item.id === 'p1');
  assert.equal(p1.title, '当前主题标题');
  assert.equal(p1.likes, 99);
  assert.equal(p1.liked, true);
  assert.equal(p1.comments[0].text, '保留评论');
  assert.ok(merged.some((item) => item.id === 'user_abc' && item.body === '用户正文'));
  assert.ok(merged.some((item) => item.id === 'p2'), 'missing seed posts should be restored');
});

test('invalid forum post IDs never replace the document shell', () => {
  assert.doesNotMatch(forumDetail, /document\.body\.innerHTML\s*=/);
  assert.match(forumDetail, /这条帖子暂时无法找到/);
  assert.match(forumDetail, /history\.back\(\)/);
  assert.match(forumDetail, /帖子暂不可用/);
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractBlock(source, startMarker, endMarker, fromIndex) {
  const start = source.indexOf(startMarker, fromIndex || 0);
  assert.ok(start >= 0, 'missing start marker: ' + startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, 'missing end marker: ' + endMarker);
  return source.slice(start, end);
}

function loadSaveMessages(sandbox) {
  const start = chatDetail.indexOf('function _readBackHistory()');
  const end = chatDetail.indexOf('\n        // 头像占位', start);
  assert.ok(start >= 0 && end > start, 'saveMessages read-back helpers should be isolated');
  return runInNewContext(chatDetail.slice(start, end) + '\nsaveMessages;', sandbox);
}

function createSandboxBase() {
  return {
    currentCharacter: { id: 'role-1' },
    storageKey: 'chat_history_role-1',
    showToast: () => {},
    _resetWarnCooldown: () => {},
    _shouldWarnAgain: () => false,
    console: { warn: () => {} }
  };
}

function loadEnsureMid() {
  const start = chatDetail.indexOf('function ensureMid(');
  const end = chatDetail.indexOf('\n        function findByMid', start);
  assert.ok(start >= 0 && end > start, 'ensureMid helper should be isolated');
  return runInNewContext(chatDetail.slice(start, end) + '\nensureMid;', {});
}

function loadSystemErrorDedupe() {
  const start = chatDetail.indexOf('function _isRepeatedSystemError(');
  const close = chatDetail.indexOf('\n        }', start);
  assert.ok(start >= 0 && close > start, 'system_error dedupe helper should be isolated');
  const end = close + '\n        }'.length;
  return runInNewContext(chatDetail.slice(start, end) + '\n_isRepeatedSystemError;', {});
}

function loadRetryHelpers() {
  const start = chatDetail.indexOf('function _locateRetryMessage(');
  const end = chatDetail.indexOf('\n        window.retryFailedMessage', start);
  assert.ok(start >= 0 && end > start, 'retry helpers should be isolated');
  return runInNewContext(
    chatDetail.slice(start, end) +
    '\n({ _locateRetryMessage: _locateRetryMessage, _prepareRetryMessage: _prepareRetryMessage });',
    {}
  );
}

test('saveMessages reports success only after a matching read-back from the existing storage channel', () => {
  const target = [
    { role: 'assistant', text: '欢迎', time: 1 },
    { role: 'user', text: '你好', time: 2, mid: 'm2' }
  ];

  // 正常写入并读回一致
  let stored = null;
  const okSandbox = createSandboxBase();
  okSandbox._storage = {
    saveChatHistory: (id, list) => { stored = clone(list); return true; },
    getChatHistory: () => clone(stored)
  };
  assert.equal(loadSaveMessages(okSandbox)(target), true);

  // 底层写入报成功，但读回为空（静默未持久化）
  const emptySandbox = createSandboxBase();
  emptySandbox._storage = {
    saveChatHistory: () => true,
    getChatHistory: () => []
  };
  assert.equal(loadSaveMessages(emptySandbox)(target), false);

  // 读回条数一致但内容不一致
  const wrongSandbox = createSandboxBase();
  wrongSandbox._storage = {
    saveChatHistory: () => true,
    getChatHistory: () => clone([target[0], { role: 'user', text: '被吞掉的内容', time: 2, mid: 'm2' }])
  };
  assert.equal(loadSaveMessages(wrongSandbox)(target), false);

  // 读回条数不一致
  const shortSandbox = createSandboxBase();
  shortSandbox._storage = {
    saveChatHistory: () => true,
    getChatHistory: () => clone(target.slice(0, 1))
  };
  assert.equal(loadSaveMessages(shortSandbox)(target), false);

  // 底层写入返回 false / 抛异常 / 读取抛异常
  const rejectSandbox = createSandboxBase();
  rejectSandbox._storage = { saveChatHistory: () => false, getChatHistory: () => clone(target) };
  assert.equal(loadSaveMessages(rejectSandbox)(target), false);

  const throwSandbox = createSandboxBase();
  throwSandbox._storage = {
    saveChatHistory: () => { throw new Error('quota exceeded'); },
    getChatHistory: () => clone(target)
  };
  assert.equal(loadSaveMessages(throwSandbox)(target), false);

  const readThrowSandbox = createSandboxBase();
  readThrowSandbox._storage = {
    saveChatHistory: () => true,
    getChatHistory: () => { throw new Error('read failed'); }
  };
  assert.equal(loadSaveMessages(readThrowSandbox)(target), false);
});

test('saveMessages read-back verification also covers the localStorage fallback channel', () => {
  const target = [{ role: 'user', text: '你好', time: 2, mid: 'm2' }];
  const store = {};
  const workingLocalStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; }
  };

  const okSandbox = createSandboxBase();
  okSandbox._storage = null;
  okSandbox.localStorage = workingLocalStorage;
  assert.equal(loadSaveMessages(okSandbox)(target), true);

  // setItem 抛异常
  const throwSandbox = createSandboxBase();
  throwSandbox._storage = null;
  throwSandbox.localStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('quota exceeded'); },
    removeItem: () => {}
  };
  assert.equal(loadSaveMessages(throwSandbox)(target), false);

  // setItem 静默丢弃，读回不到
  const discardSandbox = createSandboxBase();
  discardSandbox._storage = null;
  discardSandbox.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  assert.equal(loadSaveMessages(discardSandbox)(target), false);

  // 读回内容被截断/改写
  const staleSandbox = createSandboxBase();
  staleSandbox._storage = null;
  staleSandbox.localStorage = {
    getItem: () => JSON.stringify([{ role: 'user', text: '旧内容', time: 2, mid: 'm2' }]),
    setItem: () => {},
    removeItem: () => {}
  };
  assert.equal(loadSaveMessages(staleSandbox)(target), false);
});

function runMissingApiKeyBranch(options) {
  const saves = [];
  const renders = [];
  let quoteClears = 0;
  const input = { value: options.inputValue == null ? '未发送原文' : options.inputValue, style: {} };
  const context = {
    apiKey: '',
    isRegen: !!options.isRegen,
    contextOnly: !!options.contextOnly,
    silent: !!options.silent,
    text: '未发送原文',
    isGroupChat: false,
    pendingQuote: options.pendingQuote === undefined ? { mid: 'q1', text: '被引用的原文' } : options.pendingQuote,
    lastGroupUserSend: { text: 'previous', time: 1 },
    groupAutoFollowupToken: 5,
    _vl: null,
    ensureMid: loadEnsureMid(),
    _isRepeatedSystemError: loadSystemErrorDedupe(),
    input,
    loadMessages: () => clone(options.history || [{ role: 'assistant', text: '旧消息' }]),
    saveMessages: (list) => {
      saves.push(clone(list));
      return options.saveResults[Math.min(saves.length - 1, options.saveResults.length - 1)];
    },
    acceptGroupUserMessage: () => true,
    appendMessageToDOM: (msg) => renders.push(msg),
    vlRefresh: () => {},
    scrollToBottom: () => {},
    updateSendBtnState: () => {},
    SoundSystem: { play: () => {} },
    showToast: () => {},
    window: { clearQuote: () => { quoteClears += 1; } }
  };
  const sendStart = chatDetail.indexOf('async function sendMsg(opts)');
  const branch = extractBlock(chatDetail, 'if (!apiKey)', '\n            baseUrl = baseUrl.replace', sendStart);
  new Function('context', 'with (context) { ' + branch + ' }')(context);
  return { saves, renders, input, quoteClears, context };
}

test('missing API key: a failed user-message save stops the send and writes no error record', () => {
  const result = runMissingApiKeyBranch({ saveResults: [false] });
  assert.equal(result.saves.length, 1, '只有用户消息的一次写入尝试');
  assert.equal(result.saves[0].length, 2);
  assert.equal(result.saves[0][1].role, 'user');
  assert.equal(result.saves[0][1].sendFailed, true);
  assert.ok(result.saves[0].every((m) => m.role !== 'system_error'), '失败时不得把 system_error 写进存储');
  assert.equal(result.renders.length, 0, '失败时不得渲染任何气泡');
  assert.equal(result.input.value, '未发送原文', '输入框原文必须保留');
  assert.equal(result.quoteClears, 0, '引用状态必须保留');
  assert.equal(result.context.groupAutoFollowupToken, 5, '群聊防重复占位必须回滚');
});

test('missing API key: a failed second save never leaves an error bubble that storage does not contain', () => {
  const result = runMissingApiKeyBranch({ saveResults: [true, false] });
  assert.equal(result.saves.length, 2);
  assert.equal(result.renders.length, 1);
  assert.equal(result.renders[0].role, 'user');
  assert.ok(!result.renders.some((m) => m.role === 'system_error'), '第二次写入失败时错误气泡不得出现');
  assert.equal(result.input.value, '');
});

test('missing API key: successful saves keep the existing user-then-error behavior', () => {
  const result = runMissingApiKeyBranch({ saveResults: [true, true] });
  assert.equal(result.saves.length, 2);
  assert.equal(result.renders.length, 2);
  assert.equal(result.renders[0].role, 'user');
  assert.equal(result.renders[1].role, 'system_error');
  assert.equal(result.renders[1].isError, true);
  assert.equal(result.saves[1][result.saves[1].length - 1].role, 'system_error');
  assert.equal(result.input.value, '');
  assert.equal(result.quoteClears, 1);
});

test('missing API key without a new user message never renders an unsaved error record', () => {
  const result = runMissingApiKeyBranch({ isRegen: true, saveResults: [false] });
  assert.equal(result.saves.length, 1);
  assert.equal(result.renders.length, 0);
});

test('new failed user messages persist a stable mid without duplicating the record on the second save', () => {
  const result = runMissingApiKeyBranch({ saveResults: [true, true] });
  const user = result.saves[0][1];
  assert.equal(user.role, 'user');
  assert.ok(typeof user.mid === 'string' && user.mid.length > 0, '用户消息必须带稳定 mid');
  assert.equal(result.saves[1].filter((m) => m.role === 'user').length, 1, '第二次写入不得插入第二条用户消息');
  assert.equal(result.saves[1][1].mid, user.mid, '错误记录写入时沿用同一个 mid');
  assert.equal(result.saves[0].filter((m) => m.role === 'user').length, 1);
});

test('missing API key: repeated regen/contextOnly triggers do not accumulate the same system_error', () => {
  const first = runMissingApiKeyBranch({ isRegen: true, saveResults: [true] });
  assert.equal(first.saves.length, 1);
  assert.equal(first.saves[0].filter((m) => m.role === 'system_error').length, 1);

  const stored = clone(first.saves[first.saves.length - 1]);
  const second = runMissingApiKeyBranch({ isRegen: true, history: stored, saveResults: [true] });
  assert.equal(second.saves.length, 0, '相同错误已在历史尾部时不再重复写入');
  assert.equal(second.renders.length, 0, '不得重复渲染相同错误提示');
  assert.equal(stored.filter((m) => m.role === 'system_error').length, 1);

  const contextFirst = runMissingApiKeyBranch({ contextOnly: true, saveResults: [true] });
  assert.equal(contextFirst.saves.length, 1);
  const contextStored = clone(contextFirst.saves[contextFirst.saves.length - 1]);
  const contextSecond = runMissingApiKeyBranch({ contextOnly: true, history: contextStored, saveResults: [true] });
  assert.equal(contextSecond.saves.length, 0, 'contextOnly 重复触发同样不得累积');
  assert.equal(contextStored.filter((m) => m.role === 'system_error').length, 1);
});

test('retry reuses the original failed user message instead of appending a duplicate', () => {
  const helpers = loadRetryHelpers();
  const list = [
    { role: 'assistant', text: '欢迎', time: 1, mid: 'm1' },
    { role: 'user', text: '在吗', time: 2, mid: 'm2', sendFailed: true, sendFailedReason: 'missing-api-key' }
  ];
  const before = clone(list);
  const prepared = helpers._prepareRetryMessage(list, 'm2');
  assert.ok(prepared, '按 mid 应能定位失败消息');
  assert.equal(prepared.index, 1);
  assert.equal(prepared.message, list[1], '必须复用同一条记录，而不是新建对象');
  assert.equal(list.length, 2, '不得新增消息');
  assert.equal(list[1].sendFailed, undefined);
  assert.equal(list[1].sendFailedReason, undefined);
  assert.equal(list[1].text, before[1].text);
  assert.equal(list[1].mid, before[1].mid);
  assert.deepEqual(list[0], before[0]);
});

test('retry is idempotent across repeated clicks and never leaves a duplicate unsent message', () => {
  const helpers = loadRetryHelpers();
  const list = [
    { role: 'user', text: '在吗', time: 2, mid: 'm2', sendFailed: true, sendFailedReason: 'missing-api-key' }
  ];
  assert.ok(helpers._prepareRetryMessage(list, 'm2'));
  assert.equal(list.length, 1);
  assert.equal(list.filter((m) => m.role === 'user').length, 1);
  // 第二次点击：失败标记已清除，不能再次触发重试，也不能插入新消息。
  assert.equal(helpers._prepareRetryMessage(list, 'm2'), null);
  assert.equal(list.length, 1);
  assert.equal(list.filter((m) => m.role === 'user' && m.text === '在吗').length, 1);
});

test('retry locates legacy failed messages without mid by time and never migrates them', () => {
  const helpers = loadRetryHelpers();
  const list = [{ role: 'user', text: '旧失败消息', time: 2, sendFailed: true }];
  const prepared = helpers._prepareRetryMessage(list, 'm_generated_at_render', 2);
  assert.ok(prepared, '旧消息没有 mid 时应退回 time 匹配');
  assert.equal(prepared.index, 0);
  assert.equal(list.length, 1);
  assert.equal(list[0].mid, undefined, '不得为旧消息补写 mid 或迁移历史数据');
  assert.equal(list[0].sendFailed, undefined);
  assert.equal(list[0].text, '旧失败消息');
});

test('blocked send also stops when the user message cannot be persisted', () => {
  const saves = [];
  const renders = [];
  let quoteClears = 0;
  const input = { value: '未发送原文', style: {} };
  const context = {
    isBlocked: () => true,
    aliasRoleId: 'role-1',
    isRegen: false,
    contextOnly: false,
    silent: false,
    text: '未发送原文',
    isGroupChat: false,
    pendingQuote: { mid: 'q1', text: '被引用的原文' },
    lastGroupUserSend: { text: 'previous', time: 1 },
    groupAutoFollowupToken: 9,
    _vl: null,
    ensureMid: loadEnsureMid(),
    input,
    acceptGroupUserMessage: () => true,
    loadMessages: () => clone([{ role: 'assistant', text: '旧消息' }]),
    saveMessages: (list) => { saves.push(clone(list)); return false; },
    appendMessageToDOM: (msg) => renders.push(msg),
    vlRefresh: () => {},
    updateSendBtnState: () => {},
    scrollToBottom: () => {},
    SoundSystem: { play: () => {} },
    showToast: () => {},
    window: { clearQuote: () => { quoteClears += 1; } }
  };
  const branch = extractBlock(
    chatDetail,
    'if (isBlocked(aliasRoleId) && !isRegen && !contextOnly) {',
    '\n            const config = getAiConfig();'
  );
  new Function('context', 'with (context) { ' + branch + ' }')(context);
  assert.equal(saves.length, 1);
  assert.equal(renders.length, 0);
  assert.equal(input.value, '未发送原文');
  assert.equal(quoteClears, 0);
  assert.equal(context.groupAutoFollowupToken, 9);
});

test('shared context policy filters sendFailed messages out of the model context', () => {
  const sandbox = {};
  runInNewContext(read('shared/js/phone/chat-context-policy.js'), sandbox);
  const mapped = clone(sandbox.ChatContextPolicy.mapHistoryToApiMessages([
    { role: 'user', text: '这条发送失败了', sendFailed: true },
    { role: 'assistant', text: '收到' },
    { role: 'user', text: '正常发送' }
  ], (raw) => String(raw || '')));
  assert.deepEqual(mapped, [
    { role: 'assistant', content: '收到' },
    { role: 'user', content: '正常发送' }
  ]);
});

test('chat detail fallback context mapping also filters sendFailed messages', () => {
  const forEachStart = chatDetail.indexOf('recentHistory.forEach(m => {');
  assert.ok(forEachStart >= 0, 'fallback mapping should exist');
  const forEachEnd = chatDetail.indexOf('\n                });', forEachStart);
  assert.ok(forEachEnd > forEachStart, 'fallback mapping block should be isolated');
  const forEachBlock = chatDetail.slice(forEachStart, forEachEnd) + '\n                });';
  const context = {
    recentHistory: [
      { role: 'user', text: '这条发送失败了', sendFailed: true },
      { role: 'user', text: '正常发送' }
    ],
    apiMessages: [],
    isGroupChat: false,
    currentGroup: null,
    stripInternalReasoning: (raw) => String(raw || '')
  };
  new Function('context', 'with (context) { ' + forEachBlock + ' }')(context);
  assert.deepEqual(context.apiMessages, [{ role: 'user', content: '正常发送' }]);
});

test('blocked-send and error-message context isolation contracts remain intact', () => {
  assert.match(chatDetail, /if \(isBlocked\(aliasRoleId\) && !isRegen && !contextOnly\)/);
  assert.match(chatDetail, /if \(m\.isError \|\| m\.role === 'system_error' \|\| m\.sendFailed\) return/);
  assert.match(chatDetail, /sendFailedReason === 'missing-api-key'/);
});
