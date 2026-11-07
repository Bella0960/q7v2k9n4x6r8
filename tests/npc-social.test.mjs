import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../shared/js/phone/npc-social.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../chat/contacts/npc-friends.html', import.meta.url), 'utf8');
const contacts = readFileSync(new URL('../chat/contacts/contacts.html', import.meta.url), 'utf8');

function createHarness() {
  const data = new Map();
  const roles = [{
    id: 'main-role',
    name: '主角色',
    persona: '一位住在海边城市的大学生。',
    npcCharacters: [{ id: 'relation-only', name: '旧人物关系资料' }]
  }];
  let aiCalls = 0;
  const localStorage = {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
  const phoneStorage = {
    getCharacters() { return roles.slice(); },
    getWorldbooks() { return []; },
    getApiConfig() { return { apiKey: 'test-key' }; },
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
      completeJSON: async () => {
        aiCalls += 1;
        return { ok: true, data: {
          create: true,
          name: '林知夏',
          profession: '独立书店店员',
          persona: '在海边城市经营小书店，喜欢整理旧书，性格温和但有自己的主见。',
          greeting: '你好，我好像在共同的读书活动里见过你。',
          reason: '你们都参加了同一个读书活动，后来又在附近书店碰到。',
          speechStyle: '说话自然，句子简洁，偶尔分享书和日常。'
        } };
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
  return { context, data, roles, get aiCalls() { return aiCalls; } };
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

  const accepted = h.context.NPCSocial.accept(result.request.id);
  assert.equal(accepted.ok, true);
  assert.equal(h.roles.length, 2);
  const npc = h.roles.find(role => role.id === accepted.roleId);
  assert.equal(npc.name, '林知夏');
  assert.equal(npc.npcSocialRole, true);
  assert.equal(npc.npcFriendRequestId, result.request.id);
  assert.equal(h.roles[0].npcCharacters[0].id, 'relation-only', 'legacy relationship records must remain untouched');

  const stored = JSON.parse(h.data.get('npc_friend_requests_v1'));
  assert.equal(stored[0].status, 'accepted');
  assert.equal(h.context.NPCSocial.getPendingCount(), 0);
});

test('NPC rejection and blocking do not create contacts', () => {
  const h = createHarness();
  h.data.set('npc_friend_requests_v1', JSON.stringify([{
    id: 'req-1',
    status: 'pending',
    createdAt: Date.now(),
    npc: { id: 'npc-1', name: '测试人物', persona: '测试设定' }
  }]));
  h.context.NPCSocial.reject('req-1', true);
  const stored = JSON.parse(h.data.get('npc_friend_requests_v1'));
  assert.equal(stored[0].status, 'blocked');
  assert.equal(h.roles.length, 1);
});

test('NPC data remains separate from real-user accounts and financial features', () => {
  assert.match(source, /npc_friend_requests_v1/);
  assert.match(source, /npc_friend_discovery_settings_v1/);
  assert.match(source, /npcSocialRole: true/);
  assert.match(source, /npcFriendRequestId/);
  assert.doesNotMatch(source, /real_user_contacts_v1|\/api\/real-user-chat|finance_records|wallet/i);
  assert.doesNotMatch(source, /role\.npcCharacters\s*=/);
});

test('NPC request center discloses AI context and exposes explicit accept/reject/block actions', () => {
  assert.match(page, /当前主角色人设、已绑定世界书内容片段/);
  assert.match(page, /不会发送聊天历史/);
  assert.match(page, /data-action="accept"/);
  assert.match(page, /data-action="decline"/);
  assert.match(page, /data-action="block"/);
  assert.match(contacts, /npc-friends\.html/);
});
