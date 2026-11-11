import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8');

const chatBeautySource = read('shared/js/chat-beauty.js');
const chatPageSource = read('chat/chat/chat.html');
const myMomentsSource = read('chat/moments/my-moments.html');
const chatDetailSource = read('chat/chat/chat-detail.html');
const datePageSource = read('chat/date/date.html');
const forumDetailSource = read('forum/forum-detail.html');
const callPageSource = read('chat/call/call.html');
const couplePageSource = read('couple/couple.html');
const shopPageSource = read('wallet/shop.html');
const takeoutPageSource = read('wallet/takeout.html');
const familyCardsPageSource = read('wallet/family-cards.html');
const journeyPageSource = read('chat/date/journey.html');

/* ---------- 真实源码函数提取（行为级执行，不做字符串存在性断言） ---------- */

function extractFunction(source, name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('未找到函数：' + name);
  let depth = 0;
  let started = false;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') {
      depth += 1;
      started = true;
    } else if (ch === '}') {
      depth -= 1;
      if (started && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('函数未闭合：' + name);
}

/* ---------- 最小 localStorage 模拟（保持键可被 Object.keys 枚举） ---------- */

function createLocalStorage(seed = {}) {
  const store = Object.assign({}, seed);
  Object.defineProperties(store, {
    getItem: {
      enumerable: false,
      value(key) {
        return Object.prototype.hasOwnProperty.call(this, key) ? this[key] : null;
      }
    },
    setItem: {
      enumerable: false,
      value(key, value) {
        this[key] = String(value);
      }
    },
    removeItem: {
      enumerable: false,
      value(key) {
        delete this[key];
      }
    }
  });
  return store;
}

/* ---------- ChatBeauty：真实执行 shared/js/chat-beauty.js ---------- */

function createWallpaperStore(images, localStorage) {
  return {
    getByKey(key) {
      if (Object.prototype.hasOwnProperty.call(images, key) && images[key]) {
        return Promise.resolve(images[key]);
      }
      // 与 shared/js/wallpaper-store.js 一致：IDB 缺失时回退 localStorage 旧值。
      return Promise.resolve(localStorage.getItem(key) || '');
    }
  };
}

function loadChatBeauty(localStorage, images = {}) {
  const win = { MAOMAOWallpaperStore: createWallpaperStore(images, localStorage) };
  const sandbox = {
    window: win,
    globalThis: win,
    localStorage,
    console,
    setTimeout,
    clearTimeout,
    Promise
  };
  runInNewContext(chatBeautySource, sandbox, { filename: 'shared/js/chat-beauty.js' });
  assert.ok(win.ChatBeauty, 'ChatBeauty 未加载');
  return win.ChatBeauty;
}

function createRoot() {
  const css = new Map();
  const style = {
    setProperty(name, value) { css.set(name, String(value)); },
    getPropertyValue(name) { return css.has(name) ? css.get(name) : ''; },
    removeProperty(name) { css.delete(name); }
  };
  const rootEl = {
    style,
    closest() { return null; },
    querySelectorAll() { return []; },
    matches() { return false; },
    setAttribute() {},
    removeAttribute() {}
  };
  return { rootEl, css };
}

async function flushPromises() {
  for (let i = 0; i < 3; i++) {
    await new Promise((done) => setTimeout(done, 0));
  }
}

function globalBeautySeed() {
  return JSON.stringify({
    v: 1,
    updatedAt: 1,
    vars: { chatBg: 'idb-image:beauty_chat_bg_global' }
  });
}

function resolveGlobalToken(localStorage) {
  const cfg = JSON.parse(localStorage.getItem('beauty_chat_global_v1') || '{}');
  return cfg && cfg.vars ? cfg.vars.chatBg : '';
}

test('ChatBeauty：角色背景只写入自己的作用域，不泄漏给其他角色', () => {
  const localStorage = createLocalStorage();
  const cb = loadChatBeauty(localStorage);
  assert.equal(cb.save('roleA', { chatBg: 'data:image/png;base64,ROLEA' }), true);
  assert.match(localStorage.getItem('beauty_chat_roleA'), /ROLEA/);
  assert.equal(localStorage.getItem('beauty_chat_roleB'), null);
  assert.equal(localStorage.getItem('beauty_chat_global_v1'), null);
  assert.equal(cb.resolve('roleA').chatBg, 'data:image/png;base64,ROLEA');
  assert.equal(cb.resolve('roleB').chatBg, '');
});

test('ChatBeauty：无角色配置时全局 IndexedDB 背景对两个角色都生效', async () => {
  const localStorage = createLocalStorage({
    beauty_chat_global_v1: globalBeautySeed()
  });
  const images = { beauty_chat_bg_global: 'data:image/png;base64,GLOBALIMG' };
  const cb = loadChatBeauty(localStorage, images);

  const rootA = createRoot();
  cb.apply('roleA', rootA.rootEl);
  await flushPromises();
  assert.match(rootA.css.get('--chat-bg-image'), /GLOBALIMG/);

  const rootB = createRoot();
  cb.apply('roleB', rootB.rootEl);
  await flushPromises();
  assert.match(rootB.css.get('--chat-bg-image'), /GLOBALIMG/);
});

test('ChatBeauty：角色背景覆盖全局，其他角色仍显示全局（不串图）', async () => {
  const localStorage = createLocalStorage({
    beauty_chat_global_v1: globalBeautySeed()
  });
  const images = {
    beauty_chat_bg_global: 'data:image/png;base64,GLOBALIMG',
    beauty_chat_bg_role_roleA: 'data:image/png;base64,ROLEAIMG'
  };
  const cb = loadChatBeauty(localStorage, images);
  assert.equal(cb.save('roleA', { chatBg: 'idb-image:beauty_chat_bg_role_roleA' }), true);

  const rootA = createRoot();
  cb.apply('roleA', rootA.rootEl);
  await flushPromises();
  assert.match(rootA.css.get('--chat-bg-image'), /ROLEAIMG/);
  assert.doesNotMatch(rootA.css.get('--chat-bg-image'), /GLOBALIMG/);

  const rootB = createRoot();
  cb.apply('roleB', rootB.rootEl);
  await flushPromises();
  assert.match(rootB.css.get('--chat-bg-image'), /GLOBALIMG/);
  assert.doesNotMatch(rootB.css.get('--chat-bg-image'), /ROLEAIMG/);
});

test('ChatBeauty：reset 角色后恢复继承全局设置且不删除全局资产', async () => {
  const localStorage = createLocalStorage({
    beauty_chat_global_v1: globalBeautySeed()
  });
  const images = {
    beauty_chat_bg_global: 'data:image/png;base64,GLOBALIMG',
    beauty_chat_bg_role_roleA: 'data:image/png;base64,ROLEAIMG'
  };
  const cb = loadChatBeauty(localStorage, images);
  cb.save('roleA', { chatBg: 'idb-image:beauty_chat_bg_role_roleA' });

  cb.reset('roleA');
  assert.equal(localStorage.getItem('beauty_chat_roleA'), null);
  assert.equal(resolveGlobalToken(localStorage), 'idb-image:beauty_chat_bg_global');

  const rootA = createRoot();
  cb.apply('roleA', rootA.rootEl);
  await flushPromises();
  assert.match(rootA.css.get('--chat-bg-image'), /GLOBALIMG/);
  assert.equal(images.beauty_chat_bg_role_roleA, 'data:image/png;base64,ROLEAIMG');
});

test('ChatBeauty：save(chatBg:null) 清除角色覆盖并恢复全局', async () => {
  const localStorage = createLocalStorage({
    beauty_chat_global_v1: globalBeautySeed()
  });
  const images = {
    beauty_chat_bg_global: 'data:image/png;base64,GLOBALIMG',
    beauty_chat_bg_role_roleA: 'data:image/png;base64,ROLEAIMG'
  };
  const cb = loadChatBeauty(localStorage, images);
  cb.save('roleA', { chatBg: 'idb-image:beauty_chat_bg_role_roleA' });
  assert.equal(cb.save('roleA', { chatBg: null }), true);

  const roleCfg = JSON.parse(localStorage.getItem('beauty_chat_roleA') || '{}');
  assert.equal(roleCfg.vars.chatBg, undefined);
  assert.equal(cb.resolve('roleA').chatBg, 'idb-image:beauty_chat_bg_global');

  const rootA = createRoot();
  cb.apply('roleA', rootA.rootEl);
  await flushPromises();
  assert.match(rootA.css.get('--chat-bg-image'), /GLOBALIMG/);
});

test('ChatBeauty：旧 chat_bg_<roleId> 仍按角色回落，不串到其他角色', async () => {
  const localStorage = createLocalStorage({
    chat_bg_roleA: 'data:image/png;base64,LEGACYA'
  });
  const cb = loadChatBeauty(localStorage);

  const rootA = createRoot();
  cb.apply('roleA', rootA.rootEl);
  await flushPromises();
  assert.match(rootA.css.get('--chat-bg-image') || '', /LEGACYA/);

  const rootB = createRoot();
  cb.apply('roleB', rootB.rootEl);
  await flushPromises();
  assert.equal(rootB.css.get('--chat-bg-image') || '', '');
});

test('ChatBeauty：保存或重置一个角色不影响其他角色与全局配置', () => {
  const localStorage = createLocalStorage({
    beauty_chat_global_v1: globalBeautySeed(),
    beauty_chat_roleB: JSON.stringify({ v: 1, updatedAt: 1, vars: { chatBg: 'data:image/png;base64,ROLEB' } })
  });
  const cb = loadChatBeauty(localStorage);
  const beforeGlobal = localStorage.getItem('beauty_chat_global_v1');
  const beforeRoleB = localStorage.getItem('beauty_chat_roleB');

  cb.save('roleA', { chatBg: 'data:image/png;base64,ROLEA' });
  cb.reset('roleA');

  assert.equal(localStorage.getItem('beauty_chat_global_v1'), beforeGlobal);
  assert.equal(localStorage.getItem('beauty_chat_roleB'), beforeRoleB);
});

/* ---------- 封面：真实执行 chat.html / my-moments.html 的读写函数 ---------- */

function loadChatCoverFunctions(localStorage) {
  const sandbox = {
    localStorage,
    console,
    _storage: undefined,
    PROFILE_KEY: 'myProfile',
    CHAT_LIST_COVER_KEY: 'chat_list_cover_v1',
    CHAT_LIST_COVER_MIGRATED_KEY: 'chat_list_cover_migrated_v1',
    alert() {}
  };
  const code = ['loadProfile', 'loadChatListCover', 'saveChatListCover']
    .map((name) => extractFunction(chatPageSource, name))
    .join('\n');
  runInNewContext(code, sandbox, { filename: 'chat/chat/chat.html#cover' });
  return {
    load: () => sandbox.loadChatListCover(),
    save: (value) => sandbox.saveChatListCover(value)
  };
}

function loadMyHomeCoverFunctions(localStorage) {
  const sandbox = {
    localStorage,
    console,
    _storage: undefined,
    PROFILE_KEY: 'myProfile',
    MY_HOME_COVER_KEY: 'my_home_cover_v1',
    MY_HOME_COVER_MIGRATED_KEY: 'my_home_cover_migrated_v1',
    alert() {}
  };
  const code = ['readProfile', 'loadMyHomeCover', 'saveMyHomeCover']
    .map((name) => extractFunction(myMomentsSource, name))
    .join('\n');
  runInNewContext(code, sandbox, { filename: 'chat/moments/my-moments.html#cover' });
  return {
    load: () => sandbox.loadMyHomeCover(),
    save: (value) => sandbox.saveMyHomeCover(value)
  };
}

test('封面：聊天列表封面只从 myProfile.cover 迁移一次', () => {
  const localStorage = createLocalStorage({
    myProfile: JSON.stringify({ cover: 'profile.png' })
  });
  const chatCover = loadChatCoverFunctions(localStorage);

  assert.equal(chatCover.load(), 'profile.png');
  assert.equal(localStorage.getItem('chat_list_cover_migrated_v1'), '1');

  localStorage.setItem('myProfile', JSON.stringify({ cover: 'profile-changed.png' }));
  assert.equal(chatCover.load(), 'profile.png');
});

test('封面：显式保存聊天列表封面后，myProfile.cover 编辑不能替换它', () => {
  const localStorage = createLocalStorage({
    myProfile: JSON.stringify({ cover: 'profile.png' })
  });
  const chatCover = loadChatCoverFunctions(localStorage);

  assert.equal(chatCover.save('chat.png'), true);
  localStorage.setItem('myProfile', JSON.stringify({ cover: 'profile-changed.png' }));
  assert.equal(chatCover.load(), 'chat.png');
});

test('封面：清空聊天列表封面后不会被 myProfile.cover 再次迁移覆盖', () => {
  const localStorage = createLocalStorage({
    myProfile: JSON.stringify({ cover: 'profile.png' })
  });
  const chatCover = loadChatCoverFunctions(localStorage);

  assert.equal(chatCover.save(''), true);
  assert.equal(localStorage.getItem('chat_list_cover_migrated_v1'), '1');
  assert.equal(chatCover.load(), '');
});

test('封面：聊天列表封面与我的主页封面互不覆盖', () => {
  const localStorage = createLocalStorage({
    myProfile: JSON.stringify({ cover: 'profile.png' })
  });
  const chatCover = loadChatCoverFunctions(localStorage);
  const homeCover = loadMyHomeCoverFunctions(localStorage);

  chatCover.save('chat.png');
  homeCover.save('home.png');
  assert.equal(chatCover.load(), 'chat.png');
  assert.equal(homeCover.load(), 'home.png');

  localStorage.setItem('myProfile', JSON.stringify({ cover: 'profile-new.png' }));
  assert.equal(chatCover.load(), 'chat.png');
  assert.equal(homeCover.load(), 'home.png');
});

test('封面：我的主页封面清空后保持为空，不回落到共享 myProfile.cover', () => {
  const localStorage = createLocalStorage({
    myProfile: JSON.stringify({ cover: 'profile.png' })
  });
  const homeCover = loadMyHomeCoverFunctions(localStorage);

  assert.equal(homeCover.save(''), true);
  assert.equal(localStorage.getItem('my_home_cover_migrated_v1'), '1');
  assert.equal(homeCover.load(), '');
});

test('封面：两套独立封面都存在时，编辑 myProfile.cover 不改变任何一套', () => {
  const localStorage = createLocalStorage({
    myProfile: JSON.stringify({ cover: 'profile.png' }),
    chat_list_cover_v1: 'chat.png',
    chat_list_cover_migrated_v1: '1',
    my_home_cover_v1: 'home.png',
    my_home_cover_migrated_v1: '1'
  });
  const chatCover = loadChatCoverFunctions(localStorage);
  const homeCover = loadMyHomeCoverFunctions(localStorage);

  localStorage.setItem('myProfile', JSON.stringify({ cover: 'profile-edited.png' }));
  assert.equal(chatCover.load(), 'chat.png');
  assert.equal(homeCover.load(), 'home.png');
});

/* ---------- 名片：真实执行 chat-detail.html 的历史读写函数 ---------- */

function loadHistoryFunctions(storageSlots) {
  const sandbox = {
    console,
    localStorage: createLocalStorage(),
    currentCharacter: { id: 'roleA' },
    removeLegacyStickerCaptions: (list) => list,
    getInitialMessages: () => [],
    _resetWarnCooldown() {},
    _shouldWarnAgain: () => false,
    showToast() {},
    _storage: {
      getChatHistory(contactId) {
        const slot = storageSlots[contactId];
        return Array.isArray(slot) ? slot.slice() : [];
      },
      saveChatHistory(contactId, list) {
        storageSlots[contactId] = JSON.parse(JSON.stringify(list));
        return true;
      }
    }
  };
  Object.defineProperty(sandbox, 'storageKey', {
    enumerable: true,
    get() {
      return 'chat_history_' + (sandbox.currentCharacter && sandbox.currentCharacter.id);
    }
  });
  const code = ['_messageIdentity', '_readBackHistory', '_verifyHistoryRoundTrip', 'loadMessages', 'saveMessages']
    .map((name) => extractFunction(chatDetailSource, name))
    .join('\n');
  runInNewContext(code, sandbox, { filename: 'chat/chat/chat-detail.html#history' });
  return sandbox;
}

test('名片：卡片快照只写入当前会话历史，不在其他会话出现', () => {
  const slots = {};
  const sandbox = loadHistoryFunctions(slots);
  const card = {
    role: 'user',
    type: 'card',
    card: { id: 'card-1', name: '卡片甲', avatar: '' },
    time: 1,
    mid: 'm1'
  };

  sandbox.currentCharacter = { id: 'roleA' };
  const listA = sandbox.loadMessages();
  listA.push(card);
  assert.equal(sandbox.saveMessages(listA), true);
  assert.deepEqual(sandbox.loadMessages(), [card]);
  assert.match(JSON.stringify(slots.roleA), /卡片甲/);

  sandbox.currentCharacter = { id: 'roleB' };
  assert.deepEqual(sandbox.loadMessages(), []);
  assert.equal(JSON.stringify(slots.roleB || []).includes('卡片甲'), false);
  assert.equal(sandbox.localStorage.getItem('chat_history_roleB'), null);
});

test('名片：刷新后仍只从所属会话读回，不与其他角色共享存储槽', () => {
  const slots = {
    roleA: [{ role: 'user', type: 'card', card: { id: 'card-1', name: '卡片甲', avatar: '' }, time: 1, mid: 'm1' }],
    roleB: [{ role: 'received', text: 'B 的普通消息', time: 2, mid: 'm2' }]
  };
  const sandbox = loadHistoryFunctions(slots);

  sandbox.currentCharacter = { id: 'roleA' };
  const reloadedA = sandbox.loadMessages();
  assert.equal(reloadedA.length, 1);
  assert.equal(reloadedA[0].card.name, '卡片甲');

  sandbox.currentCharacter = { id: 'roleB' };
  const reloadedB = sandbox.loadMessages();
  assert.equal(reloadedB.length, 1);
  assert.equal(reloadedB[0].text, 'B 的普通消息');
  assert.equal(reloadedB.some((msg) => msg.type === 'card'), false);
});


/* ---------- 跨页面写入：失败必须显式反馈，且不留下未保存的内存状态 ---------- */

function loadDateSaveHistory(storage, localStorage = createLocalStorage()) {
  const toasts = [];
  const sandbox = {
    _storage: storage,
    roleId: 'roleA',
    HISTORY_KEY: 'chat_history_roleA',
    localStorage,
    toast: (message) => toasts.push(message),
    console: { error() {} }
  };
  runInNewContext(extractFunction(datePageSource, 'saveHistory'), sandbox, {
    filename: 'chat/date/date.html#saveHistory'
  });
  return { save: sandbox.saveHistory, toasts, localStorage };
}

test('赴约历史：PhoneStorage 写入失败时回滚本次变更并提示，不冒充成功', () => {
  const original = [{ role: 'user', text: '旧内容', time: 1 }];
  const candidate = original.slice();
  candidate.push({ role: 'user', text: '新内容', time: 2 });
  const sandbox = loadDateSaveHistory({
    getChatHistory: () => original.slice(),
    saveChatHistory: () => false
  });

  assert.equal(sandbox.save(candidate, original), false);
  assert.deepEqual(candidate, original, '失败时必须恢复原数组，避免 UI 将未保存消息留作已完成状态');
  assert.equal(sandbox.toasts.length, 1);
  assert.match(sandbox.toasts[0], /保存失败/);
});

test('赴约历史：写入返回成功但读回内容不一致时仍判失败并回滚', () => {
  const original = [{ role: 'assistant', text: '旧回复', time: 1 }];
  const candidate = original.slice();
  candidate.push({ role: 'user', text: '待保存', time: 2 });
  const sandbox = loadDateSaveHistory({
    saveChatHistory: () => true,
    getChatHistory: () => original.slice()
  });

  assert.equal(sandbox.save(candidate, original), false);
  assert.deepEqual(candidate, original);
  assert.match(sandbox.toasts[0], /保存失败/);
});

test('赴约历史：读回数组长度相同但本次变更内容被改写时仍判失败', () => {
  const original = [{ role: 'assistant', text: '旧回复', time: 1 }];
  const candidate = original.slice();
  candidate.push({ role: 'user', text: '我刚发送的内容', time: 2, mode: 'date' });
  const sandbox = loadDateSaveHistory({
    saveChatHistory: () => true,
    getChatHistory: () => [
      { role: 'assistant', text: '旧回复', time: 1 },
      { role: 'user', text: '被错误改写的内容', time: 2, mode: 'date' }
    ]
  });

  assert.equal(sandbox.save(candidate, original), false);
  assert.deepEqual(candidate, original);
  assert.match(sandbox.toasts[0], /保存失败/);
});

test('赴约历史：成功写入后必须完整读回同一数组才返回成功', () => {
  let persisted = [];
  const candidate = [{ role: 'user', text: '新消息', time: 2, mode: 'date', scene: '咖啡馆' }];
  const sandbox = loadDateSaveHistory({
    saveChatHistory: (id, list) => {
      assert.equal(id, 'roleA');
      persisted = JSON.parse(JSON.stringify(list));
      return true;
    },
    getChatHistory: () => JSON.parse(JSON.stringify(persisted))
  });

  assert.equal(sandbox.save(candidate, []), true);
  assert.deepEqual(persisted, candidate);
  assert.deepEqual(sandbox.toasts, []);
});

test('赴约历史：没有 PhoneStorage 时 localStorage 写入异常也会回滚', () => {
  const original = [{ role: 'assistant', text: '旧内容', time: 1 }];
  const candidate = original.slice();
  candidate.push({ role: 'user', text: '新内容', time: 2 });
  const localStorage = {
    getItem() { return null; },
    setItem() { throw new Error('quota exceeded'); }
  };
  const sandbox = loadDateSaveHistory(null, localStorage);

  assert.equal(sandbox.save(candidate, original), false);
  assert.deepEqual(candidate, original);
  assert.match(sandbox.toasts[0], /保存失败/);
});

function loadForumSharePost(storage, localStorage = createLocalStorage()) {
  const alerts = [];
  const sandbox = {
    window: { PhoneStorage: storage },
    localStorage,
    alert: (message) => alerts.push(message),
    console: { warn() {}, error() {} },
    postBody: () => '测试帖子正文',
    postTitle: () => '测试帖子标题'
  };
  runInNewContext(extractFunction(forumDetailSource, 'sharePost'), sandbox, {
    filename: 'forum/forum-detail.html#sharePost'
  });
  localStorage.setItem('ai_custom_characters', JSON.stringify([{ id: 'roleA', name: '角色甲' }]));
  return { share: sandbox.sharePost, alerts, localStorage };
}

test('论坛分享：PhoneStorage 保存失败时不显示分享成功', () => {
  const sandbox = loadForumSharePost({
    getChatHistory: () => [],
    saveChatHistory: () => false
  });

  sandbox.share();
  assert.equal(sandbox.alerts.length, 1);
  assert.match(sandbox.alerts[0], /分享失败/);
  assert.doesNotMatch(sandbox.alerts[0], /已分享给/);
});

test('论坛分享：保存并读回目标角色消息后才显示成功', () => {
  let persisted = [];
  const sandbox = loadForumSharePost({
    getChatHistory: () => JSON.parse(JSON.stringify(persisted)),
    saveChatHistory: (id, list) => {
      assert.equal(id, 'roleA');
      persisted = JSON.parse(JSON.stringify(list));
      return true;
    }
  });

  sandbox.share();
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].role, 'user');
  assert.match(persisted[0].text, /测试帖子正文/);
  assert.equal(sandbox.alerts.length, 1);
  assert.match(sandbox.alerts[0], /已分享给 角色甲/);
});


function loadGroupCallEndCall(storage, localStorage = createLocalStorage()) {
  const alerts = [];
  const sessionValues = {};
  const sandbox = {
    connectTimer: null,
    tickTimer: null,
    clearTimeout() {},
    clearInterval() {},
    sessionStorage: {
      setItem(key, value) { sessionValues[key] = String(value); }
    },
    roleId: 'groupA',
    callType: 'voice',
    connected: true,
    seconds: 65,
    isGroupCall: true,
    currentGroup: { members: [{ nickname: '成员甲' }] },
    window: { PhoneStorage: storage, location: { href: '' } },
    localStorage,
    formatTime: (seconds) => String(seconds),
    alert: (message) => alerts.push(message),
    console: { error() {} },
    encodeURIComponent
  };
  runInNewContext(extractFunction(callPageSource, 'endCall'), sandbox, {
    filename: 'chat/call/call.html#endCall'
  });
  return { endCall: sandbox.endCall, alerts, sessionValues, window: sandbox.window };
}

test('群通话：保存并读回通话卡片后才视为聊天记录已保存', () => {
  let persisted = [];
  const sandbox = loadGroupCallEndCall({
    getChatHistory: () => JSON.parse(JSON.stringify(persisted)),
    saveChatHistory: (id, list) => {
      assert.equal(id, 'groupA');
      persisted = JSON.parse(JSON.stringify(list));
      return true;
    }
  });

  sandbox.endCall();
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].type, 'call');
  assert.equal(persisted[0].call.title, '群语音通话');
  assert.deepEqual(sandbox.alerts, []);
  assert.match(sandbox.window.location.href, /chat-detail\.html\?id=groupA/);
});

test('群通话：PhoneStorage 写入失败时明确提示，不把失败当成功', () => {
  const sandbox = loadGroupCallEndCall({
    getChatHistory: () => [],
    saveChatHistory: () => false
  });

  sandbox.endCall();
  assert.equal(sandbox.alerts.length, 1);
  assert.match(sandbox.alerts[0], /群通话记录未能保存/);
  assert.match(sandbox.window.location.href, /chat-detail\.html\?id=groupA/);
});

test('情侣绑定：邀请消息持久化结果与资料保存提示保持区分', () => {
  assert.match(couplePageSource, /let invitationSaved = true/);
  assert.match(couplePageSource, /storage\.saveChatHistory\(profile\.partnerId, next\) === true/);
  assert.match(couplePageSource, /聊天记录写入后校验失败/);
  assert.match(couplePageSource, /资料已保存，但邀请消息没有写入聊天记录/);
});


function loadWalletMessageWriter(source, functionName, storage, localStorage = createLocalStorage()) {
  const sandbox = {
    window: { PhoneStorage: storage },
    localStorage,
    console: { error() {} },
    toast() {}
  };
  runInNewContext(extractFunction(source, functionName), sandbox, {
    filename: 'wallet#' + functionName
  });
  return { write: sandbox[functionName], localStorage };
}

test('钱包消息：商店与外卖写入器只追加到指定角色，不串写其他会话', () => {
  for (const [source, functionName] of [
    [shopPageSource, 'appendChatHistoryMessage'],
    [takeoutPageSource, 'appendChatHistoryMessage']
  ]) {
    const records = {
      roleA: [{ role: 'assistant', text: 'A 的旧消息', time: 1 }],
      roleB: [{ role: 'assistant', text: 'B 的旧消息', time: 2 }]
    };
    const storage = {
      getChatHistory: (id) => JSON.parse(JSON.stringify(records[id] || [])),
      saveChatHistory: (id, list) => {
        records[id] = JSON.parse(JSON.stringify(list));
        return true;
      }
    };
    const writer = loadWalletMessageWriter(source, functionName, storage);
    const notice = { role: 'user', type: 'text', text: '只属于 A 的付款通知', time: 3 };

    assert.equal(writer.write('roleA', notice), true);
    assert.equal(records.roleA.length, 2);
    assert.equal(records.roleA[1].text, notice.text);
    assert.equal(records.roleB.length, 1);
    assert.equal(records.roleB[0].text, 'B 的旧消息');
  }
});

test('钱包消息：写入失败或读回缺失时返回失败，不把通知当成成功', () => {
  const failedSave = loadWalletMessageWriter(shopPageSource, 'appendChatHistoryMessage', {
    getChatHistory: () => [],
    saveChatHistory: () => false
  });
  assert.equal(failedSave.write('roleA', {
    role: 'user', type: 'text', text: '失败通知', time: 4
  }), false);

  const failedReadback = loadWalletMessageWriter(takeoutPageSource, 'appendChatHistoryMessage', {
    getChatHistory: () => [],
    saveChatHistory: () => true
  });
  assert.equal(failedReadback.write('roleA', {
    role: 'user', type: 'text', text: '读回缺失', time: 5
  }), false);
});

test('亲属卡通知：失败状态不会被普通卡片成功提示覆盖', () => {
  const writer = loadWalletMessageWriter(familyCardsPageSource, 'appendRoleNotice', {
    getChatHistory: () => [],
    saveChatHistory: () => false
  });
  assert.equal(writer.write({ roleId: 'roleA' }, '卡片通知'), false);
  assert.match(familyCardsPageSource, /var noticeSaved = !verb \|\| appendRoleNotice\(card, verb\)/);
  assert.match(familyCardsPageSource, /卡片操作已保存，但聊天通知未写入/);
});

test('商店和外卖：交易成功但聊天通知失败时显示合并后的明确状态', () => {
  assert.match(shopPageSource, /var chatNoticeFailed = false/);
  assert.match(shopPageSource, /订单已完成，但聊天通知未保存/);
  assert.match(takeoutPageSource, /var chatNoticeFailed = false/);
  assert.match(takeoutPageSource, /下单成功，但聊天通知未保存/);
  assert.match(takeoutPageSource, /if \(!forwarded\)[\s\S]*?return;[\s\S]*?toast\('已转发给 '/);
});


function loadJourneyMessageWriter(storage, saved = []) {
  let persisted = JSON.parse(JSON.stringify(saved));
  let attempts = 0;
  let warnings = 0;
  let stateWrites = 0;
  const sandbox = {
    window: {},
    localStorage: createLocalStorage(),
    roleId: 'roleA',
    historyKey: 'chat_history_roleA',
    stateKey: 'chat_journey_state_roleA',
    state: { startedAt: 1000, scene: '咖啡馆', sentStages: [], messages: ['刚出门'] },
    stages: [{ at: 0 }],
    fallbackMessages: ['刚出门'],
    PhoneStorage: undefined,
    console: { error() {} },
    saveState() { stateWrites += 1; },
    showStorageWarning() { warnings += 1; },
    generateFallbackText() { return '刚出门'; },
    loadHistory() { return JSON.parse(JSON.stringify(persisted)); }
  };
  sandbox.window.PhoneStorage = storage ? {
    saveChatHistory(id, list) {
      attempts += 1;
      return storage.saveChatHistory(id, list, (next) => {
        persisted = JSON.parse(JSON.stringify(next));
      });
    },
    getChatHistory() {
      return JSON.parse(JSON.stringify(persisted));
    }
  } : null;
  const source = [
    extractFunction(journeyPageSource, 'saveHistory'),
    extractFunction(journeyPageSource, 'appendJourneyMessage')
  ].join('\n') + '\nappendJourneyMessage;';
  const append = runInNewContext(source, sandbox, { filename: 'chat/date/journey.html#appendJourneyMessage' });
  return {
    append,
    state: sandbox.state,
    read: () => JSON.parse(JSON.stringify(persisted)),
    get attempts() { return attempts; },
    get warnings() { return warnings; },
    get stateWrites() { return stateWrites; }
  };
}

test('赴约行程：阶段消息写入失败时不标记已发送，并在下一帧重试', () => {
  let allowSave = false;
  const writer = loadJourneyMessageWriter({
    saveChatHistory(id, list, persist) {
      assert.equal(id, 'roleA');
      if (!allowSave) return false;
      persist(list);
      return true;
    }
  });

  writer.append(0);
  assert.deepEqual(writer.state.sentStages, [], '失败时不能写入 sentStages');
  assert.equal(writer.read().length, 0);
  assert.equal(writer.warnings, 1);

  allowSave = true;
  writer.append(0);
  assert.deepEqual(writer.state.sentStages, [0]);
  assert.equal(writer.read().length, 1);
  assert.equal(writer.read()[0].mode, 'journey');
  assert.equal(writer.read()[0].journeyStage, 0);
  assert.equal(writer.attempts, 2);
});

test('赴约行程：历史中已存在相同 journeyId/stage 时不重复插入', () => {
  const existing = [{
    role: 'assistant',
    type: 'text',
    text: '刚出门',
    time: 1000,
    mode: 'journey',
    journeyId: '1000',
    journeyStage: 0,
    scene: '咖啡馆'
  }];
  const writer = loadJourneyMessageWriter({
    saveChatHistory() {
      throw new Error('不应再次写入');
    }
  }, existing);

  writer.append(0);
  assert.equal(writer.read().length, 1);
  assert.deepEqual(writer.state.sentStages, [0]);
  assert.equal(writer.attempts, 0);
});
