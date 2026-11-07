import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../shared/js/phone/npc-social.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../chat/contacts/npc-friends.html', import.meta.url), 'utf8');
const contacts = readFileSync(new URL('../chat/contacts/contacts.html', import.meta.url), 'utf8');
const nav = readFileSync(new URL('../shared/js/nav.js', import.meta.url), 'utf8');

function createHarness() {
  const data = new Map();
  const roles = [{
    id: 'main-role',
    name: '主角色',
    persona: '一位住在海边城市的大学生。',
    worldBookIds: ['world-1'],
    npcCharacters: [{ id: 'relation-only', name: '旧人物关系资料' }]
  }];
  let aiCalls = 0;
  let capturedPrompt = '';
  let failGreetingSave = false;
  let completeJSONHandler = async () => ({ ok: true, data: {
    create: true,
    name: '林知夏',
    profession: '独立书店店员',
    persona: '在海边城市经营小书店，喜欢整理旧书，性格温和但有自己的主见。',
    greeting: '你好，我好像在共同的读书活动里见过你。',
    reason: '你们都参加了同一个读书活动，后来又在附近书店碰到。',
    speechStyle: '说话自然，句子简洁，偶尔分享书和日常。'
  } });
  const histories = Object.create(null);
  const localStorage = {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
  data.set('phone_current_contact', 'main-role');
  const phoneStorage = {
    getCharacters() { return roles.slice(); },
    getWorldbooks() { return [
      { id: 'world-1', title: '已绑定的校园世界', entries: [{ name: '广播站', content: '校园广播站每周制作读书分享节目。' }] },
      { id: 'world-2', title: '未绑定的世界书', content: '这段内容不应该进入 NPC 生成上下文。' }
    ]; },
    getApiConfig() { return { apiKey: 'test-key' }; },
    getChatHistory(id) { return histories[id] || []; },
    saveChatHistory(id, list) {
      if (failGreetingSave) return false;
      histories[id] = list.slice();
      return true;
    },
    result: {
      getCharacters() { return { ok: true, value: roles.slice() }; },
      saveCharacters(next) {
        roles.splice(0, roles.length, ...next);
        return { ok: true };
      }
    }
  };
  const context = {
    URL,
    Uint8Array,
    Date,
    Math,
    JSON,
    Promise,
    String,
    Array,
    Object,
    RegExp,
    Error,
    Map,
    localStorage,
    PhoneStorage: phoneStorage,
    PhoneAPI: {
      completeJSON: async (options) => {
        aiCalls += 1;
        capturedPrompt = (options && options.messages || []).map(function (item) { return item.content || ''; }).join('\n');
        return completeJSONHandler(options);
      }
    },
    crypto: { getRandomValues(bytes) { bytes.fill(7); return bytes; } },
    document: {
      readyState: 'complete',
      visibilityState: 'visible',
      body: null,
      currentScript: null,
      addEventListener() {},
      dispatchEvent() {},
      getElementById() { return null; }
    },
    location: { pathname: '/MAOMAO/chat/contacts/npc-friends.html' },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    setInterval() { return 1; },
    setTimeout() { return 1; },
    clearTimeout() {},
    console,
    fetch: async () => { throw new Error('NPC tests must not make network calls'); }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return {
    context, data, roles, histories,
    setCompleteJSONHandler(handler) { completeJSONHandler = handler; },
    setGreetingSaveFailure(value) { failGreetingSave = value === true; },
    get aiCalls() { return aiCalls; },
    get capturedPrompt() { return capturedPrompt; }
  };
}

test('NPC discovery is opt-in and does not run in the background when the page is hidden', async () => {
  const h = createHarness();
  h.context.document.visibilityState = 'hidden';
  h.context.NPCSocial.setSettings({ enabled: true });
  assert.equal(h.context.NPCSocial.getSettings().enabled, true);
  assert.equal(h.aiCalls, 0);
  assert.equal(h.context.NPCSocial.getPendingCount(), 0);
});

test('manual NPC discovery creates a pending application, then acceptance creates an isolated AI contact', async () => {
  const h = createHarness();
  const result = await h.context.NPCSocial.discoverNow();
  assert.equal(result.created, true);
  assert.equal(result.request.status, 'pending');
  assert.equal(h.context.NPCSocial.getPendingCount(), 1);
  assert.equal(h.roles.length, 1, 'NPC must not enter the contact list before acceptance');
  assert.match(h.capturedPrompt, /已绑定的校园世界/);
  assert.match(h.capturedPrompt, /校园广播站每周制作读书分享节目/);
  assert.doesNotMatch(h.capturedPrompt, /未绑定的世界书|不应该进入 NPC 生成上下文/);

  const accepted = h.context.NPCSocial.accept(result.request.id);
  assert.equal(accepted.ok, true);
  assert.equal(h.roles.length, 2);
  const npc = h.roles.find(role => role.id === accepted.roleId);
  assert.equal(npc.name, '林知夏');
  assert.equal(npc.npcSocialRole, true);
  assert.equal(npc.npcFriendRequestId, result.request.id);
  assert.equal(h.roles[0].npcCharacters[0].id, 'relation-only', 'legacy relationship records must remain untouched');
  assert.equal(h.histories[accepted.roleId].length, 1);
  assert.equal(h.histories[accepted.roleId][0].npcFriendWelcome, true);
  assert.equal(h.histories[accepted.roleId][0].text, npc.greeting);
  const repeated = h.context.NPCSocial.accept(result.request.id);
  assert.equal(repeated.alreadyAccepted, true);
  assert.equal(h.histories[accepted.roleId].length, 1, 'repeated acceptance must not duplicate the greeting');

  const stored = JSON.parse(h.data.get('npc_friend_requests_v2_main-role'));
  assert.equal(stored[0].status, 'accepted');
  assert.equal(h.context.NPCSocial.getPendingCount(), 0);
});

test('NPC rejection and blocking do not create contacts', () => {
  const h = createHarness();
  h.data.set('npc_friend_requests_v2_main-role', JSON.stringify([{
    id: 'req-1',
    mainRoleId: 'main-role',
    status: 'pending',
    createdAt: Date.now(),
    npc: { id: 'npc-1', name: '测试人物', persona: '测试设定' }
  }]));
  h.context.NPCSocial.reject('req-1', true);
  const stored = JSON.parse(h.data.get('npc_friend_requests_v2_main-role'));
  assert.equal(stored[0].status, 'blocked');
  assert.equal(h.roles.length, 1);
});

test('NPC data remains separate from real-user accounts and financial features', () => {
  assert.match(source, /npc_friend_requests_v1/);
  assert.match(source, /npc_friend_requests_v2_/);
  assert.match(source, /npc_friend_discovery_settings_v2_/);
  assert.match(source, /npcSocialRole: true/);
  assert.match(source, /npcFriendRequestId/);
  assert.doesNotMatch(source, /real_user_contacts_v1|\/api\/real-user-chat|finance_records|wallet/i);
  assert.doesNotMatch(source, /role\.npcCharacters\s*=/);
});

test('NPC request center discloses AI context and exposes explicit accept/reject/block actions', () => {
  assert.match(page, /当前主角色人设、已绑定世界书内容片段/);
  assert.match(page, /不会发送聊天历史/);
  assert.match(page, /id="roleNote"/);
  assert.match(page, /当前主角色：/);
  assert.match(page, /尚未选择主角色/);
  assert.match(page, /data-action="accept"/);
  assert.match(page, /data-action="decline"/);
  assert.match(page, /data-action="block"/);
  assert.match(contacts, /npc-friends\.html/);
  assert.ok(nav.includes("currentPage === 'chat.html' || currentPage === 'contacts.html'"));
  assert.ok(source.includes('role.worldBookIds'));
  assert.match(source, /面向青少年用户/);
  assert.match(source, /npcFriendWelcome: true/);
});

test('NPC requests, settings and AI-visible names are isolated by selected main role', async () => {
  const h = createHarness();
  const first = await h.context.NPCSocial.discoverNow();
  assert.equal(first.created, true);
  h.context.NPCSocial.setSettings({ enabled: true, intervalHours: 12 });

  h.roles.push({
    id: 'second-role',
    name: '第二主角色',
    persona: '另一套完全独立的人物设定。',
    worldBookIds: [],
    npcCharacters: [{ id: 'second-relation', name: '第二角色的旧人物' }]
  });
  h.context.localStorage.setItem('phone_current_contact', 'second-role');

  assert.equal(h.context.NPCSocial.getPendingCount(), 0, 'another role must not see the first role pending request');
  assert.equal(h.context.NPCSocial.getRequests().length, 0);
  assert.equal(h.context.NPCSocial.getSettings().enabled, false, 'auto discovery defaults off for a new role');
  h.context.NPCSocial.setSettings({ enabled: true, intervalHours: 48 });
  const second = await h.context.NPCSocial.discoverNow();
  assert.equal(second.created, true);
  assert.match(h.capturedPrompt, /第二角色的旧人物/);
  assert.doesNotMatch(h.capturedPrompt, /旧人物关系资料/);

  h.context.localStorage.setItem('phone_current_contact', 'main-role');
  assert.equal(h.context.NPCSocial.getPendingCount(), 1);
  assert.equal(h.context.NPCSocial.getSettings().enabled, true);
  assert.equal(h.context.NPCSocial.getSettings().intervalHours, 12);
  h.context.localStorage.setItem('phone_current_contact', 'second-role');
  assert.equal(h.context.NPCSocial.getPendingCount(), 1);
  assert.equal(h.context.NPCSocial.getSettings().intervalHours, 48);
});

test('legacy NPC requests migrate only to their recorded main role without deleting the backup', () => {
  const h = createHarness();
  const legacy = [
    { id: 'legacy-main', mainRoleId: 'main-role', status: 'pending', createdAt: 2, npc: { id: 'npc-a', name: '甲' } },
    { id: 'legacy-second', mainRoleId: 'second-role', status: 'pending', createdAt: 1, npc: { id: 'npc-b', name: '乙' } }
  ];
  h.data.set('npc_friend_requests_v1', JSON.stringify(legacy));
  // The harness bootstraps an empty current-role bucket before this fixture is added.
  h.context.localStorage.removeItem('npc_friend_requests_v2_main-role');
  assert.equal(h.context.NPCSocial.getRequests().length, 1);
  assert.equal(h.context.NPCSocial.getRequests()[0].id, 'legacy-main');
  assert.equal(h.data.get('npc_friend_requests_v1'), JSON.stringify(legacy), 'legacy data remains as a backup');

  h.context.localStorage.setItem('phone_current_contact', 'second-role');
  assert.equal(h.context.NPCSocial.getRequests().length, 1);
  assert.equal(h.context.NPCSocial.getRequests()[0].id, 'legacy-second');
});

test('corrupted role-scoped request data is preserved instead of being overwritten by migration', () => {
  const h = createHarness();
  const key = 'npc_friend_requests_v2_main-role';
  h.data.set(key, '{not-valid-json');
  assert.throws(() => h.context.NPCSocial.getRequests(), /无法读取/);
  assert.equal(h.data.get(key), '{not-valid-json');
});

test('switching main roles while AI discovery is pending still writes to the originating role', async () => {
  const h = createHarness();
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  let releaseResponse;
  h.setCompleteJSONHandler(() => {
    signalStarted();
    return new Promise(resolve => { releaseResponse = resolve; });
  });

  const discovery = h.context.NPCSocial.discoverNow();
  await started;
  h.roles.push({
    id: 'second-role',
    name: '第二主角色',
    persona: '另一套人物设定。',
    worldBookIds: [],
    npcCharacters: []
  });
  h.context.localStorage.setItem('phone_current_contact', 'second-role');
  releaseResponse({ ok: true, data: {
    create: true,
    name: '林知夏',
    profession: '独立书店店员',
    persona: '一位友善的虚构人物。',
    greeting: '你好。',
    reason: '因为共同的阅读活动认识。',
    speechStyle: '表达自然。'
  } });

  const result = await discovery;
  assert.equal(result.created, true);
  assert.equal(result.mainRoleId, 'main-role');
  assert.equal(result.request.mainRoleId, 'main-role');
  assert.equal(h.context.NPCSocial.getPendingCount(), 0, 'the newly selected role must not receive the in-flight request');

  h.context.localStorage.setItem('phone_current_contact', 'main-role');
  assert.equal(h.context.NPCSocial.getPendingCount(), 1, 'the originating role must receive its own request');
  assert.ok(h.context.NPCSocial.getSettings().lastAttemptAt > 0);
  h.context.localStorage.setItem('phone_current_contact', 'second-role');
  assert.equal(h.context.NPCSocial.getSettings().lastAttemptAt, 0, 'the other role must not inherit the attempt timestamp');
});

test('NPC acceptance stays pending until the first greeting is durable, then retries idempotently', async () => {
  const h = createHarness();
  const result = await h.context.NPCSocial.discoverNow();
  h.setGreetingSaveFailure(true);

  assert.throws(() => h.context.NPCSocial.accept(result.request.id), /首次问候保存失败/);
  assert.equal(h.roles.length, 2, 'the NPC role can be saved before greeting persistence');
  assert.equal(h.context.NPCSocial.getPendingCount(), 1, 'the request remains pending for retry');

  h.context.NPCSocial.reconcileAccepted();
  assert.equal(h.context.NPCSocial.getPendingCount(), 1, 'startup reconciliation must not accept without the greeting');

  h.setGreetingSaveFailure(false);
  const accepted = h.context.NPCSocial.accept(result.request.id);
  assert.equal(accepted.ok, true);
  assert.equal(h.context.NPCSocial.getPendingCount(), 0);
  assert.equal(h.histories[accepted.roleId].length, 1);
  assert.equal(h.histories[accepted.roleId][0].npcFriendWelcome, true);

  h.context.NPCSocial.reconcileAccepted();
  assert.equal(h.histories[accepted.roleId].length, 1, 'reconciliation must not duplicate the greeting');
});
