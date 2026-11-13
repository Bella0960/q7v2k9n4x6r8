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
  assert.match(forumHome, /function getSeededPosts\(themeOverride\)/);
  assert.match(forumDetail, /function getSeededPosts\(themeOverride\)/);
  assert.match(forumDetail, /function getSeededPosts\(themeOverride\)\{return \[\]\}/, 'detail must not insert demo posts');
  assert.match(forumHome, /localStorage\.setItem\(STORE,JSON\.stringify\(seedPosts\)\)/);
  assert.match(forumDetail, /if \(raw === null\)[\s\S]*?savePosts\(seedPosts\)/);
  assert.match(forumDetail, /function loadPosts\(\)[\s\S]*?mergeForumPosts\(stored, seedPosts, buildPreviousSeedSets\(stored, seedIds\)\)/);
});

test('forum seed merge keeps user-edited fields, comments/likes and user posts while refreshing untouched defaults', () => {
  const start = forumDetail.indexOf('function mergeForumPosts(');
  const rest = forumDetail.slice(start);
  const end = start + rest.search(/\n\s*function loadPosts\(\)/);
  assert.ok(start >= 0 && end > start, 'detail page should expose the shared merge implementation');
  const mergeSource = forumDetail.slice(start, end) + '\nmergeForumPosts;';
  const mergeForumPosts = runInNewContext(mergeSource, { Map, Set });

  const merged = mergeForumPosts(
    [
      { id: 'p1', title: '我改过的标题', likes: 99, comments: [{ id: 'c1', text: '保留评论' }], liked: true },
      { id: 'user_abc', owner: 'me', title: '我的帖子', body: '用户正文' }
    ],
    [
      { id: 'p1', name: '宝宝', title: '当前主题标题', body: '当前主题正文', likes: 18, comments: 6, featured: true, owner: 'seed' },
      { id: 'p2', name: '拾光', title: '第二条种子', body: '正文', likes: 2, comments: 0, owner: 'seed' }
    ]
  );

  const p1 = merged.find((item) => item.id === 'p1');
  assert.equal(p1.title, '我改过的标题', '与默认值不同的字段视为用户修改，必须保留');
  assert.equal(p1.name, '宝宝', '未出现在存储中的默认字段同步为新默认值');
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

function extractBracedBlock(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, 'missing braced block: ' + startMarker);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced braced block: ' + startMarker);
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

function loadRetryLifecycleHelpers(saveMessages) {
  const start = chatDetail.indexOf('function _locateRetryMessage(');
  const end = chatDetail.indexOf('\n        // 一键重试', start);
  assert.ok(start >= 0 && end > start, 'retry lifecycle helpers should be isolated');
  return runInNewContext(
    chatDetail.slice(start, end) +
    '\n({ _locateRetryMessage: _locateRetryMessage, _prepareRetryMessage: _prepareRetryMessage,' +
    ' _locateUserMessageIndex: _locateUserMessageIndex, _markUserSendFailed: _markUserSendFailed });',
    { saveMessages: saveMessages || (() => true) }
  );
}

function runErrorTipBranch(marker, options) {
  const renders = [];
  const toasts = [];
  const saves = [];
  const historyList = clone(options.history);
  const context = {
    historyList: historyList,
    tipText: options.text,
    errText: options.text,
    _isRepeatedSystemError: loadSystemErrorDedupe(),
    saveMessages: (list) => { saves.push(clone(list)); return !!options.saved; },
    appendMessageToDOM: (msg) => renders.push(clone(msg)),
    showToast: (message) => toasts.push(String(message)),
    _vl: null,
    vlRefresh: () => { throw new Error('virtual list refresh should not run in this branch'); }
  };
  new Function('context', 'with (context) { ' + extractBracedBlock(chatDetail, marker) + ' }')(context);
  return { historyList, renders, toasts, saves };
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
    // sendMsg declares this in its surrounding scope; the extracted branch
    // needs the same variable supplied explicitly by its isolated VM fixture.
    visionImageMids: [],
    isGroupChat: false,
    pendingQuote: options.pendingQuote === undefined ? { mid: 'q1', text: '被引用的原文' } : options.pendingQuote,
    lastGroupUserSend: { text: 'previous', time: 1 },
    groupAutoFollowupToken: 5,
    _vl: null,
    visionImageMids: [], // Current sendMsg needs image-context IDs even on the missing-key path.
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

test('streaming interruption tip is written and rendered only when persistence succeeds', () => {
  const text = '连接中断（30 秒未收到新内容），以上为已收到的回复';
  const history = [
    { role: 'assistant', text: '欢迎', time: 1 },
    { role: 'user', text: '在吗', time: 2, mid: 'm2' },
    { role: 'assistant', text: '已收到的半截回复', time: 3 }
  ];

  const failed = runErrorTipBranch('if (!_isRepeatedSystemError(historyList, tipText)) {', {
    history, text, saved: false
  });
  assert.equal(failed.historyList.filter((m) => m.role === 'system_error').length, 0,
    '保存失败时不得把错误提示留在历史里');
  assert.equal(failed.renders.length, 0, '保存失败时不得渲染历史气泡');
  assert.deepEqual(failed.toasts, [text], '保存失败时用 toast 保留可见提示');
  assert.equal(failed.saves.length, 1);

  const saved = runErrorTipBranch('if (!_isRepeatedSystemError(historyList, tipText)) {', {
    history, text, saved: true
  });
  assert.equal(saved.historyList.filter((m) => m.role === 'system_error').length, 1);
  assert.equal(saved.renders.length, 1, '保存成功时正常渲染错误气泡');
  assert.equal(saved.renders[0].role, 'system_error');
  assert.equal(saved.renders[0].text, text);
  assert.deepEqual(saved.toasts, []);
});

test('zero-content API error bubble is written and rendered only when persistence succeeds', () => {
  const text = '连接失败: 503 Service Unavailable';
  const history = [
    { role: 'assistant', text: '欢迎', time: 1 },
    { role: 'user', text: '在吗', time: 2, mid: 'm2' }
  ];

  const failed = runErrorTipBranch('if (!_isRepeatedSystemError(historyList, errText)) {', {
    history, text, saved: false
  });
  assert.equal(failed.historyList.filter((m) => m.role === 'system_error').length, 0);
  assert.equal(failed.renders.length, 0);
  assert.deepEqual(failed.toasts, [text]);
  assert.equal(failed.saves.length, 1);

  const saved = runErrorTipBranch('if (!_isRepeatedSystemError(historyList, errText)) {', {
    history, text, saved: true
  });
  assert.equal(saved.historyList.filter((m) => m.role === 'system_error').length, 1);
  assert.equal(saved.renders.length, 1);
  assert.equal(saved.renders[0].role, 'system_error');
  assert.equal(saved.renders[0].text, text);
  assert.deepEqual(saved.toasts, []);
});

test('retry API failure re-marks the same user message instead of creating a new one', () => {
  const writes = [];
  const helpers = loadRetryLifecycleHelpers((list) => { writes.push(clone(list)); return true; });
  const original = [
    { role: 'assistant', text: '欢迎', time: 1, mid: 'm1' },
    { role: 'user', text: '在吗', time: 2, mid: 'm2' }
  ];
  const historyList = clone(original);
  const context = {
    historyList,
    streamResult: { ok: false, error: { kind: 'http', status: 503 } },
    retryTarget: { mid: 'm2', time: 2 },
    _markUserSendFailed: helpers._markUserSendFailed
  };
  new Function('context', 'with (context) { ' +
    extractBlock(chatDetail, 'var retryRemarked = false;', '\n            try {') + ' }')(context);

  assert.equal(historyList.length, 2, '不得新增第二条用户消息');
  assert.equal(historyList.filter((m) => m.role === 'user').length, 1);
  assert.equal(historyList[1].mid, 'm2', 'mid 必须保持不变');
  assert.equal(historyList[1].sendFailed, true, 'API 失败后必须重新打失败标记');
  assert.equal(historyList[1].sendFailedReason, 'api-error');
  assert.deepEqual(historyList[0], original[0], '已成功的历史不得改动');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].filter((m) => m.role === 'user').length, 1);

  // API 成功时不得误打失败标记。
  const okList = clone(original);
  new Function('context', 'with (context) { ' +
    extractBlock(chatDetail, 'var retryRemarked = false;', '\n            try {') + ' }')({
    historyList: okList,
    streamResult: { ok: true },
    retryTarget: { mid: 'm2', time: 2 },
    _markUserSendFailed: helpers._markUserSendFailed
  });
  assert.equal(okList[1].sendFailed, undefined);
  assert.equal(writes.length, 1, '成功路径不得写入失败标记');
});

test('two consecutive retry failures keep exactly one failed user message', () => {
  const writes = [];
  const helpers = loadRetryLifecycleHelpers((list) => { writes.push(clone(list)); return true; });
  const list = [
    { role: 'assistant', text: '欢迎', time: 1, mid: 'm1' },
    { role: 'user', text: '在吗', time: 2, mid: 'm2', sendFailed: true, sendFailedReason: 'missing-api-key' }
  ];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const prepared = helpers._prepareRetryMessage(list, 'm2');
    assert.ok(prepared, '第 ' + (attempt + 1) + ' 次重试必须能接管上一条失败消息');
    assert.equal(list.filter((m) => m.role === 'user').length, 1);
    assert.ok(helpers._markUserSendFailed(list, 'm2', undefined, 'api-error'));
    assert.equal(list.length, 2, '连续重试不得产生重复记录');
    assert.equal(list[1].mid, 'm2');
    assert.equal(list[1].text, '在吗');
    assert.equal(list[1].sendFailed, true);
  }

  assert.equal(writes.length, 2);
  assert.ok(writes.every((snapshot) => snapshot.filter((m) => m.role === 'user').length === 1));
});

test('retry API failure re-marks legacy messages without mid by time and never migrates them', () => {
  const helpers = loadRetryLifecycleHelpers(() => true);
  const list = [
    { role: 'assistant', text: '欢迎', time: 1 },
    { role: 'user', text: '旧失败消息', time: 2, sendFailed: true, sendFailedReason: 'missing-api-key' }
  ];

  assert.ok(helpers._prepareRetryMessage(list, 'm_generated_at_render', 2), '旧消息按 time 进入重试');
  assert.equal(list[1].sendFailed, undefined);
  assert.ok(helpers._markUserSendFailed(list, 'm_generated_at_render', 2, 'api-error'),
    'API 失败后按 time 回退重新标记');
  assert.equal(list.length, 2);
  assert.equal(list[1].sendFailed, true);
  assert.equal(list[1].mid, undefined, '不得为旧消息补写 mid 或迁移历史数据');
  assert.equal(list[1].text, '旧失败消息');
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

/* ===== 论坛合并/加载的行为级测试（在 node:vm 中执行页面里的真实函数） ===== */

function createForumEnv(initialStore) {
  const data = Object.assign({}, initialStore || {});
  const writes = [];
  const warns = [];
  const toasts = [];
  let failWrites = false;
  const env = {
    localStorage: {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
      },
      setItem(key, value) {
        if (failWrites) throw new Error('quota exceeded');
        data[key] = String(value);
        writes.push({ key, value: data[key] });
      },
      removeItem(key) { delete data[key]; }
    },
    console: {
      warn() {
        warns.push(Array.prototype.map.call(arguments, (v) => String(v && v.message ? v.message : v)).join(' '));
      }
    },
    toast(message) { toasts.push(String(message)); },
    Map,
    Set
  };
  env.forum = {
    data,
    writes,
    warns,
    toasts,
    setFailWrites(value) { failWrites = !!value; }
  };
  return env;
}

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, 'missing forum start marker: ' + label);
  const rest = source.slice(start);
  const offset = rest.indexOf(endMarker);
  assert.ok(offset > 0, 'missing forum end marker: ' + label);
  return rest.slice(0, offset);
}

function loadHomeForumCore(env) {
  const parts = [
    sliceBetween(forumHome, "const STORE='forum_posts';", '\nfunction getForumTheme(', 'store'),
    sliceBetween(forumHome, 'function getForumTheme(themeOverride){', '\nfunction getSeededPosts(', 'theme'),
    sliceBetween(forumHome, 'function getSeededPosts(themeOverride){', '\nconst FORUM_RESIDENTS=[', 'seeds'),
    sliceBetween(forumHome, 'const seeded=[', '\nconst $=id=>document.getElementById(id);', 'seed base'),
    sliceBetween(forumHome, 'function buildPreviousSeedSets(', '\nfunction save(){', 'merge/load')
  ];
  return runInNewContext(
    parts.join('\n') + '\n({ getForumTheme, getSeededPosts, mergeForumPosts, loadPosts });',
    env
  );
}

function loadDetailForumCore(env) {
  const source = sliceBetween(
    forumDetail,
    'function readForumConfig()',
    '\n  function timeAgo(',
    'detail forum core'
  );
  return runInNewContext(
    source + '\n({ getForumTheme, getSeededPosts, mergeForumPosts, loadPosts });',
    env
  );
}

/* 新版论坛不主动生成虚构种子帖；加载必须保留用户记录和异常降级能力。 */
test('detail page starts empty and never injects demo seed posts', () => {
  const env = createForumEnv({});
  const page = loadDetailForumCore(env);
  assert.deepEqual(Array.from(page.getSeededPosts()), []);
  assert.deepEqual(Array.from(page.loadPosts()), []);
  assert.equal(env.forum.data.forum_posts, '[]', '首次打开不应生成任何伪造帖子');
});

test('detail page preserves existing posts including legacy seed IDs and user edits', () => {
  const original = [
    { id: 'p1', owner: 'seed', title: '历史帖子', body: '保留旧正文', comments: [{ text: '历史评论' }], likes: 9 },
    { id: 'user_keep', owner: 'me', title: '自己发的帖子', body: '真实写入内容', comments: [{ text: '自己的评论' }], liked: true }
  ];
  const env = createForumEnv({ forum_posts: JSON.stringify(original) });
  const loaded = loadDetailForumCore(env).loadPosts();
  assert.equal(loaded.length, 2, '不得因新版本没有默认帖而删掉旧内容');
  assert.equal(loaded[0].title, '历史帖子');
  assert.equal(loaded[0].comments[0].text, '历史评论');
  assert.equal(loaded[1].body, '真实写入内容');
  assert.equal(loaded[1].comments[0].text, '自己的评论');
  assert.equal(loaded[1].liked, true);
});

test('detail page remains idempotent without generated default posts', () => {
  const env = createForumEnv({});
  const page = loadDetailForumCore(env);
  const first = clone(page.loadPosts());
  const second = clone(page.loadPosts());
  const third = clone(page.loadPosts());
  assert.deepEqual(first, []);
  assert.deepEqual(second, first);
  assert.deepEqual(third, second);
  assert.equal(env.forum.writes.filter(item => item.key === 'forum_posts').length, 1, '稳定状态不反复改写');
});

test('detail page keeps unreadable stored records and warns without overwriting them', () => {
  for (const raw of ['{broken json', JSON.stringify({ notAList: true })]) {
    const env = createForumEnv({ forum_posts: raw });
    const loaded = loadDetailForumCore(env).loadPosts();
    assert.deepEqual(Array.from(loaded), [], '损坏数据时不制造替代内容');
    assert.equal(env.forum.data.forum_posts, raw, '不得覆盖原始损坏数据');
    assert.ok(env.forum.warns.length >= 1, '必须保留可排查警告');
    assert.ok(env.forum.toasts.length >= 1, '必须给用户明确的降级提示');
  }
});

test('detail page keeps already-read user posts when a migration cannot be saved', () => {
  const original = [{ id: 'user_keep', owner: 'me', title: '仍在的帖子', body: '用户正文', comments: 3 }];
  const env = createForumEnv({ forum_posts: JSON.stringify(original) });
  env.forum.setFailWrites(true);
  const loaded = loadDetailForumCore(env).loadPosts();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'user_keep');
  assert.deepEqual(Array.from(loaded[0].comments), [], '旧数字评论安全转换为可读列表');
  assert.equal(env.forum.data.forum_posts, JSON.stringify(original), '保存失败不能假装已落盘');
  assert.ok(env.forum.warns.length >= 1);
  assert.ok(env.forum.toasts.some(m => m.includes('未写入')));
});

test('list page starts empty and never injects demo seed posts', () => {
  const env = createForumEnv({});
  const page = loadHomeForumCore(env);
  const loaded = page.loadPosts();
  assert.deepEqual(Array.from(loaded, (item) => item.id), [], '空 store 不应生成种子帖');
  assert.deepEqual(Array.from(page.getSeededPosts(), (item) => item.id), [], '列表页种子来源应为空');
  assert.equal(env.forum.data.forum_posts, '[]', '首次加载应写入空列表而不是种子内容');
});

test('list page keeps legacy stored posts untouched and stays idempotent', () => {
  const env = createForumEnv({});
  const page = loadHomeForumCore(env);
  const stored = [
    {
      id: 'p1', name: '宝宝', owner: 'seed', themeId: 'reality',
      title: '我自己改过的标题', body: '旧正文', topic: '旧话题',
      likes: 99, liked: true,
      comments: [{ name: '我', owner: 'me', text: '我自己的评论' }],
      seedCommentsFilled: true
    },
    {
      id: 'user_keep', owner: 'me', title: '用户自己发的帖子',
      body: '用户正文', comments: [{ name: '我', owner: 'me', text: '用户自建评论' }]
    }
  ];
  env.localStorage.setItem('forum_posts', JSON.stringify(stored));
  const first = clone(page.loadPosts());
  const second = clone(page.loadPosts());
  const third = clone(page.loadPosts());

  assert.equal(first.length, 2, '只应保留用户已有内容，不新增种子帖');
  assert.deepEqual(second, first, '第二次加载不得改变内容');
  assert.deepEqual(third, second, '第三次加载不得改变内容');

  const p1 = first.find((item) => item.id === 'p1');
  assert.equal(p1.title, '我自己改过的标题', '旧帖子标题必须保留');
  assert.equal(p1.likes, 99, '点赞数保留');
  assert.equal(p1.liked, true, '点赞状态保留');
  assert.equal(p1.comments[0].text, '我自己的评论', '用户评论保留');

  const keptUser = first.find((item) => item.id === 'user_keep');
  assert.equal(keptUser.title, '用户自己发的帖子', '用户自建帖子标题不被覆盖');
  assert.equal(keptUser.comments[0].text, '用户自建评论', '用户自建评论不被覆盖');
  assert.equal(first.filter((item) => String(item.id).indexOf('p') === 0).length, 1, '种子帖不得重复或新增');
});

test('list page keeps the document shell when stored data is corrupt or not a list', () => {
  for (const raw of ['{broken json', JSON.stringify({ notAList: true })]) {
    const env = createForumEnv({ forum_posts: raw });
    const page = loadHomeForumCore(env);
    const loaded = page.loadPosts();
    assert.ok(Array.isArray(loaded), '损坏数据不得让加载抛出或返回非数组');
    assert.deepEqual(Array.from(loaded, (item) => item.id), [], '损坏数据且无种子时应返回空列表');
    assert.ok(env.forum.warns.length >= 1, '读取失败必须显式记录');
    assert.ok(env.forum.toasts.length >= 1, '读取失败必须给出用户可见提示');
    assert.equal(
      env.forum.writes.filter((entry) => entry.key === 'forum_posts').length,
      0,
      '损坏数据不得被静默覆盖'
    );
  }
});

test('list page still shows already-read user posts when write-back fails', () => {
  const env = createForumEnv({});
  const page = loadHomeForumCore(env);
  const userPost = { id: 'user_keep', owner: 'me', title: '仍在的帖子', body: '用户正文', comments: 3 };
  env.localStorage.setItem('forum_posts', JSON.stringify([userPost]));
  env.forum.setFailWrites(true);

  const loaded = page.loadPosts();
  assert.ok(loaded.some((item) => item.id === 'user_keep'), '回写失败不得退回空视图');
  assert.equal(loaded.length, 1, '用户帖子应继续展示');
  assert.ok(Array.isArray(loaded[0].comments), '旧数字评论应迁移为数组');
  assert.equal(loaded[0].comments.length, 0, '旧数字评论应安全迁移为空数组');
  assert.ok(env.forum.warns.length >= 1, '回写失败必须显式记录');
  assert.ok(
    env.forum.toasts.some((message) => message.indexOf('未写入') >= 0),
    '回写失败必须提示本次改动可能不会保留'
  );
});

function fakeElement() {
  return { style: {}, textContent: '', innerHTML: '', value: '', placeholder: '', disabled: false };
}

function loadDetailLoadPost(env) {
  const source = sliceBetween(forumDetail, 'let post = null;', '\n  function renderPost()', 'loadPost');
  return runInNewContext(source + '\nloadPost;', env);
}

test('detail invalid post id keeps the shell and an unreadable store still renders the seed post', () => {
  const head = fakeElement();
  const actions = fakeElement();
  const content = fakeElement();
  const commentList = fakeElement();
  const commentInput = fakeElement();
  const sendButton = fakeElement();
  const topbar = fakeElement();
  topbar.textContent = 'The Forum';
  const document = {
    querySelector(selector) {
      if (selector === '.p-head') return head;
      if (selector === '.p-actions') return actions;
      if (selector === '.comment-bar .send-btn') return sendButton;
      if (selector === '.topbar') return topbar;
      return null;
    },
    getElementById(id) {
      const map = { pContent: content, commentList: commentList, commentInput: commentInput };
      return map[id] || null;
    }
  };

  const renders = [];
  const coreEnv = createForumEnv({ forum_posts: '{broken json' });
  const core = loadDetailForumCore(coreEnv);
  assert.deepEqual(Array.from(core.loadPosts()), [], '损坏存储不应自动补入假帖子');
  const existing = [{ id: 'user_keep', title: '已有帖子', owner: 'me', comments: [], body: '正文' }];
  const baseStubs = {
    document,
    URLSearchParams,
    setTimeout,
    renderPost: () => renders.push('post'),
    renderComments: () => renders.push('comments'),
    generateInitialAIComments: () => {}
  };

  const env = createForumEnv({});
  Object.assign(env, baseStubs, {
    location: { search: '?id=missing_post' },
    getPostId: () => 'missing_post',
    loadPosts: () => clone(existing)
  });
  const loadPost = loadDetailLoadPost(env);
  loadPost();

  assert.equal(head.style.display, 'none');
  assert.equal(actions.style.display, 'none');
  assert.ok(content.textContent.indexOf('这条帖子暂时无法找到') >= 0, '应显示帖子找不到的说明');
  assert.ok(commentList.textContent.indexOf('暂时无法加载') >= 0, '评论列应显示降级提示');
  assert.equal(commentInput.disabled, true);
  assert.equal(commentInput.placeholder, '帖子暂不可用');
  assert.equal(sendButton.disabled, true);
  assert.equal(renders.length, 0, '无效帖子 ID 不得进入正常渲染流程');
  assert.equal(topbar.textContent, 'The Forum', '页面外壳（顶栏）必须保留');

  const okEnv = createForumEnv({});
  Object.assign(okEnv, baseStubs, {
    location: { search: '?id=user_keep' },
    getPostId: () => 'user_keep',
    loadPosts: () => clone(existing)
  });
  const loadSeedPost = loadDetailLoadPost(okEnv);
  loadSeedPost();
  assert.deepEqual(renders, ['post', 'comments'], '原有用户帖子仍能正常渲染且页面外壳不崩溃');
});

/* ===== 论坛静默 catch 收口：注入抛错桩验证退化语义与 warn 上下文 ===== */

function loadReadForumConfig(source, env) {
  return runInNewContext(extractBracedBlock(source, 'function readForumConfig()') + '\nreadForumConfig;', env);
}

function loadForumRoleList(env) {
  return runInNewContext(
    sliceBetween(forumHome, 'function forumRoleList(){', '\nfunction forumRoleId(', 'forumRoleList') + '\nforumRoleList;',
    env
  );
}

function loadCallAI(env) {
  return runInNewContext(
    sliceBetween(forumDetail, 'async function callAI(prompt) {', '\n  const DETAIL_RESIDENTS=[', 'callAI') + '\ncallAI;',
    env
  );
}

function loadThreadWorldbook(env) {
  env.post = null; // The live page declares 'let post'; isolated function tests need the same binding.
  return runInNewContext(
    sliceBetween(forumDetail, 'function getForumThreadWorldbook(){', '\n  async function forumAIJSON(', 'thread worldbook') +
      '\ngetForumThreadWorldbook;',
    env
  );
}

function loadSharePost(env) {
  return runInNewContext(
    sliceBetween(forumDetail, 'function sharePost() {', '\n  function getFollows()', 'share post') + '\nsharePost;',
    env
  );
}

const forumConfigPages = [
  { label: 'forum.html', source: forumHome },
  { label: 'forum-detail.html', source: forumDetail }
];

for (const page of forumConfigPages) {
  test(page.label + ' readForumConfig keeps returning the default config and logs locatable context on read failure', () => {
    const corruptEnv = createForumEnv({ forum_config: '{broken json' });
    const corrupt = loadReadForumConfig(page.source, corruptEnv);
    const corruptConfig = corrupt();
    assert.equal(Object.keys(corruptConfig).length, 0, '解析失败仍返回空配置（默认配置）');
    assert.equal(corruptEnv.forum.warns.length, 1);
    assert.ok(corruptEnv.forum.warns[0].includes('readForumConfig'), '日志必须包含函数名');
    assert.ok(corruptEnv.forum.warns[0].includes('forum_config'), '日志必须包含存储键');

    const deniedEnv = createForumEnv({});
    deniedEnv.localStorage.getItem = () => { throw new Error('storage denied'); };
    const denied = loadReadForumConfig(page.source, deniedEnv);
    assert.equal(Object.keys(denied()).length, 0, '读取抛错仍返回空配置');
    assert.ok(deniedEnv.forum.warns[0].includes('storage denied'), '日志必须带上原始错误');

    const okEnv = createForumEnv({ forum_config: JSON.stringify({ theme: 'bagua' }) });
    const ok = loadReadForumConfig(page.source, okEnv);
    assert.equal(ok().theme, 'bagua', '正常路径不得被新增日志分支影响');
    assert.equal(okEnv.forum.warns.length, 0, '正常读取不得产生 warn');
  });
}

test('forumRoleList falls back to the local character cache when PhoneStorage fails', () => {
  const env = createForumEnv({ ai_custom_characters: JSON.stringify([{ name: '晚风' }, { id: 'no-name' }]) });
  const throwingStorage = { getCharacters() { throw new Error('contacts unavailable'); } };
  env.window = { PhoneStorage: throwingStorage };
  env.PhoneStorage = throwingStorage;
  const before = env.forum.warns.length;
  const roles = loadForumRoleList(env)();
  assert.equal(roles.length, 1, '角色列表仍退化为可用的本地缓存');
  assert.equal(roles[0].name, '晚风');
  assert.equal(env.forum.warns.length, before + 1, '只有失败的 PhoneStorage 来源需要记录');
  assert.ok(env.forum.warns[before].includes('PhoneStorage.getCharacters'), '日志必须指向调用点');
});

test('forumRoleList degrades to an empty list but logs both failed role sources', () => {
  const env = createForumEnv({ ai_custom_characters: '{broken json' });
  const throwingStorage = { getCharacters() { throw new Error('contacts unavailable'); } };
  env.window = { PhoneStorage: throwingStorage };
  env.PhoneStorage = throwingStorage;
  const before = env.forum.warns.length;
  const roles = loadForumRoleList(env)();
  assert.equal(roles.length, 0, '两个来源都失败时仍返回空列表且不抛错');
  const logs = env.forum.warns.slice(before);
  assert.equal(logs.length, 2);
  assert.ok(logs[0].includes('PhoneStorage.getCharacters') && logs[0].includes('contacts unavailable'));
  assert.ok(logs[1].includes('ai_custom_characters'), '解析失败日志必须带上存储键');
});

test('callAI keeps returning null on API failure, logs context once and never prompts the user itself', async () => {
  const env = createForumEnv({});
  env.getForumThreadWorldbook = () => '测试世界书';
  const api = { complete: async () => { throw new Error('network down'); } };
  env.window = { PhoneAPI: api };
  env.PhoneAPI = api;
  const before = env.forum.warns.length;
  assert.equal(await loadCallAI(env)('写一条评论'), null, '失败仍返回 null 交给调用方');
  assert.equal(env.forum.warns.length, before + 1);
  assert.ok(env.forum.warns[before].includes('callAI'), '日志必须包含调用点');
  assert.ok(env.forum.warns[before].includes('network down'));
  assert.equal(env.forum.toasts.length, 0, 'callAI 不得自行弹提示，提示责任在调用方');
});

test('callAI without a loaded PhoneAPI still degrades quietly on the normal path', async () => {
  const env = createForumEnv({});
  env.window = {};
  const before = env.forum.warns.length;
  assert.equal(await loadCallAI(env)('写一条评论'), null);
  assert.equal(env.forum.warns.length, before, '未加载 API 属于正常降级，不得产生失败日志');
});

test('getForumThreadWorldbook falls back to the default theme persona and logs the forum_config read failure', () => {
  const env = createForumEnv({ forum_config: '{broken json' });
  const before = env.forum.warns.length;
  const worldbook = loadThreadWorldbook(env)();
  assert.ok(worldbook.includes('当前论坛主题：现代都市'), '配置读失败时仍使用默认主题人设');
  assert.ok(worldbook.includes('论坛世界书：'));
  assert.equal(env.forum.warns.length, before + 1);
  assert.ok(env.forum.warns[before].includes('getForumThreadWorldbook'));
  assert.ok(env.forum.warns[before].includes('forum_config'));

  const okEnv = createForumEnv({ forum_config: JSON.stringify({ theme: 'xiuxian' }) });
  assert.ok(loadThreadWorldbook(okEnv)().includes('当前论坛主题：修仙界'), '正常路径不得受影响');
  assert.equal(okEnv.forum.warns.length, 0);
});

test('sharePost degrades to the no-contact prompt and logs the unreadable character cache', () => {
  const alerts = [];
  const env = createForumEnv({ ai_custom_characters: '{broken json' });
  env.alert = (message) => alerts.push(String(message));
  const before = env.forum.warns.length;
  loadSharePost(env)();
  assert.deepEqual(alerts, ['联系人列表暂时无法读取，请重试'], '损坏的联系人缓存必须明确报错，不能误报联系人为空');
  assert.equal(env.forum.warns.length, before + 1);
  assert.ok(env.forum.warns[before].includes('sharePost'));
  assert.ok(env.forum.warns[before].includes('ai_custom_characters'));
  assert.equal(env.forum.writes.length, 0, '角色缓存不可读时不得写入聊天记录');
});

