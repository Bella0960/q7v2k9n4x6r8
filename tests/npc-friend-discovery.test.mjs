import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../shared/js/phone/npc-friend-discovery.js', import.meta.url), 'utf8');
const candidate = {
  name: '林知夏',
  profession: '校园广播站成员',
  personality: '细心、好奇，愿意认真听别人说话，遇到新话题时会主动分享自己的看法。',
  background: '在同一座城市读书，平时参加校园广播站和阅读社团。她喜欢记录生活里的小发现，也会把有趣的书和音乐分享给朋友。',
  speechStyle: '说话自然直接，习惯先回应对方的重点，再补充自己的想法；不会连续追问，也不会刻意使用夸张语气。',
  currentStatus: '最近正在准备校园广播站的一期读书分享节目。',
  reasonForAdding: '看到你们在同一个兴趣话题里交流，觉得可以从书和日常话题开始认识。',
  applicationMessage: '你好呀，我最近也在看这类书，刚好看到你聊到相关话题。想加个好友，以后可以交流读书和日常。',
  greeting: '你好，刚刚通过啦。那我先介绍一下自己，我平时会参加学校广播站，最近在准备一档读书分享节目。',
  persona: '你叫林知夏，是一名校园广播站成员。你细心、好奇，愿意认真倾听，也会主动分享自己的生活。你平时参加阅读社团，喜欢记录书籍、音乐和校园生活里的细节。你说话自然直接，先回应对方正在聊的内容，再补充自己的想法。你刚刚通过好友申请认识用户，目前只知道申请备注和当前对话里明确出现的信息，不会假设双方有未发生过的共同经历。你有自己的学习安排、朋友和兴趣，不会每轮都围绕用户转，也不会要求用户提供隐私或线下见面。'
};

function setup() {
  const persisted = Object.create(null);
  let characters = [{
    id: 'main-role',
    name: '主角色',
    persona: '喜欢阅读和日常生活话题。',
    tone: '表达自然。',
    worldBookIds: ['world-1'],
    npcCharacters: [{name:'已有朋友',profession:'同学',relation:'朋友'}]
  }];
  const histories = Object.create(null);
  const realUsers = [{id:'real-account-1'}];
  let apiCalls = 0;
  const phoneStorage = {
    rawGet(key, fallback) {
      return Object.prototype.hasOwnProperty.call(persisted, key) ? structuredClone(persisted[key]) : fallback;
    },
    rawSet(key, value) {
      persisted[key] = structuredClone(value);
      if (key === 'ai_custom_characters') characters = structuredClone(value);
      return true;
    },
    getCharacters() { return structuredClone(characters); },
    getCurrentContactId() { return 'main-role'; },
    getWorldbooks() { return [{id:'world-1',title:'城市校园',entries:[{name:'广播站',content:'校园广播站每周制作读书分享节目。'}]}]; },
    getChatHistory(id) {
      if (String(id) === 'main-role') return [{role:'user',text:'最近在找读书分享节目',time:100},{role:'assistant',text:'可以从校园广播站的节目找灵感。',time:200}];
      return structuredClone(histories[id] || []);
    },
    saveChatHistory(id, list) { histories[id] = structuredClone(list); return true; },
    getApiConfig() { return {apiKey:'test-key'}; }
  };
  const context = {
    PhoneStorage: phoneStorage,
    PhoneAPI: { async completeJSON() { apiCalls += 1; return {ok:true,data:structuredClone(candidate)}; } },
    localStorage: { getItem() { return null; }, setItem() {} },
    structuredClone,
    Date,
    Math
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return {
    api: context.MaoNpcFriends,
    getCharacters: () => structuredClone(characters),
    getHistories: () => structuredClone(histories),
    getRealUsers: () => structuredClone(realUsers),
    getApiCalls: () => apiCalls,
    persisted
  };
}

test('AI discovery creates one pending request without adding a contact', async () => {
  const app = setup();
  const result = await app.api.generateNow({force:true});
  assert.equal(result.ok, true);
  assert.equal(app.api.getPendingCount(), 1);
  assert.equal(app.getCharacters().length, 1);
  assert.equal(result.request.status, 'pending');
  assert.equal(result.request.type, 'ai_role');
  assert.equal(result.request.sourceRoleId, 'main-role');
  assert.equal(result.request.character.npcSocial, true);
  assert.equal(app.getRealUsers().length, 1);
  assert.equal(app.getApiCalls(), 1);
});

test('only one pending NPC request is allowed at a time', async () => {
  const app = setup();
  const first = await app.api.generateNow({force:true});
  const second = await app.api.generateNow({force:true});
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.error, 'PENDING_REQUEST_EXISTS');
  assert.equal(app.api.getPendingCount(), 1);
  assert.equal(app.getApiCalls(), 1);
});

test('accepting creates an isolated AI contact and a first message; repeat acceptance is idempotent', async () => {
  const app = setup();
  const generated = await app.api.generateNow({force:true});
  const id = generated.request.character.id;
  const accepted = app.api.accept(generated.request.id);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.characterId, id);
  const npc = app.getCharacters().find(role => role.id === id);
  assert.equal(npc.npcSocial, true);
  assert.equal(npc.npcFriendRequestId, generated.request.id);
  assert.equal(app.api.getPendingCount(), 0);
  const firstHistory = app.getHistories()[id];
  assert.equal(firstHistory.length, 1);
  assert.equal(firstHistory[0].role, 'assistant');
  assert.equal(firstHistory[0].npcFriendWelcome, true);
  assert.equal(firstHistory[0].text, candidate.greeting);
  const repeated = app.api.accept(generated.request.id);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.alreadyAccepted, true);
  assert.equal(app.getCharacters().filter(role => role.id === id).length, 1);
});

test('decline and block never create an AI contact and their names remain in duplicate protection', async () => {
  const declinedApp = setup();
  const declined = await declinedApp.api.generateNow({force:true});
  assert.equal(declinedApp.api.decline(declined.request.id).ok, true);
  assert.equal(declinedApp.getCharacters().length, 1);
  const retry = await declinedApp.api.generateNow({force:true});
  assert.equal(retry.ok, false);
  assert.equal(retry.error, 'DUPLICATE_NPC');

  const blockedApp = setup();
  const blocked = await blockedApp.api.generateNow({force:true});
  assert.equal(blockedApp.api.block(blocked.request.id).ok, true);
  assert.equal(blockedApp.getCharacters().length, 1);
  assert.equal(blockedApp.api.getRequests()[0].status, 'blocked');
});

test('automatic discovery can be disabled without affecting existing requests or contacts', async () => {
  const app = setup();
  assert.equal(app.api.updateSettings({enabled:false}).ok, true);
  const result = await app.api.start();
  assert.equal(result.ok, false);
  assert.equal(result.error, 'AUTO_DISCOVERY_DISABLED');
  assert.equal(app.getApiCalls(), 0);
  assert.equal(app.getCharacters().length, 1);
});

test('contacts page separates AI NPC requests from real-account friendships and documents foreground-only discovery', () => {
  const contacts = readFileSync(new URL('../chat/contacts/contacts.html', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../chat/contacts/npc-friends.html', import.meta.url), 'utf8');
  assert.match(contacts, /id="goNpcRequests"/);
  assert.match(contacts, /npc-friend-discovery\.js/);
  assert.match(contacts, /MaoNpcFriends\.start\(\)/);
  assert.match(page, /AI 虚构人物/);
  assert.match(page, /每个主角色成功生成后至少间隔 7 天/);
  assert.match(page, /不是手机关闭网页后的后台推送/);
  assert.match(page, /接受好友申请/);
  assert.match(page, /屏蔽/);
  assert.match(page, /去聊天/);
});
