import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('group chat has one categorized page; preserves all original editable controls', () => {
  const html = read('chat/chat/group-play.html');
  const js = read('shared/js/group-settings-layout.js');
  assert.match(html, /group-settings-layout\.js\?v=20261115s1/);
  assert.doesNotThrow(() => new vm.Script(js));
  for (const category of ['atmosphere', 'members', 'memory', 'games', 'owner']) {
    assert.match(js, new RegExp('\\b' + category + ':'));
  }
  for (const field of ['scheduleEnabled', 'memorySharing', 'spectatorMode',
    'allowRoleActions', 'allowRoleInvitations', 'allowPrivateMessages',
    'autoTalkEnabled', 'relationshipDynamicsEnabled', 'followUpEnabled']) {
    assert.match(html, new RegExp('data-setting="' + field + '"'), field);
  }
  assert.match(js, /var isOwner = String\(group\.ownerId \|\| '__user'\) === '__user'/);
  assert.match(js, /takeSetting\('memorySharing', memoryPane\)/);
  assert.match(js, /category-more/);
  assert.doesNotMatch(js, /data-setting="gamePrivateChat"/, 'do not show fake private-game toggle');
  assert.match(js, /appendChild\(members\)/);
  assert.match(js, /appendChild\(relationships\)/);
  assert.match(js, /群聊对话设置/);
});

test('memory groups integrate into original Memory Space and share MemoryRecall', () => {
  const html = read('worldbook/memory/memory.html');
  const js = read('shared/js/phone/group_memory_view.js');
  assert.match(html, /group_memory_view\.js\?v=20261115gm1/);
  assert.ok(html.indexOf('group_memory_view.js') < html.indexOf('<script id="memory-space-framework"'),
    'group tab must exist before old framework binds tab clicks');
  assert.doesNotThrow(() => new vm.Script(js));
  assert.match(js, /root\.MemoryRecall\.upsertMemory\(groupId/);
  assert.match(js, /root\.MemoryRecall\.getMemories\(groupId\)/);
  assert.match(js, /status: 'fixed'/);
  assert.match(js, /source: 'group_manual'/);
  assert.match(js, /typeof root\.MemoryRecall\.upsertMemory/);
  assert.doesNotMatch(js, /localStorage\.setItem\(['"]chat_memories_/, 'do not create parallel memory store');
});

test('group memory IDs isolate from individual characters and other groups', () => {
  const store = new Map();
  const storage = {
    fail: false,
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { if (this.fail) throw new Error('QuotaExceededError'); store.set(key, String(value)); }
  };
  const sandbox = { window: { localStorage: storage }, console };
  vm.runInNewContext(read('shared/js/phone/memory_recall.js'), sandbox);
  const memory = sandbox.window.MemoryRecall;

  assert.equal(memory.upsertMemory('g1', {
    content: '群里一起玩接龙，后来约好去看展。', category: 'plot',
    status: 'fixed', source: 'group_manual'
  }).ok, true);
  assert.equal(memory.getMemories('g1').length, 1);
  assert.equal(memory.getMemories('g2').length, 0);
  assert.equal(memory.getMemories('c1').length, 0);
  assert.ok(store.has('chat_memories_g1'));
  assert.ok(!store.has('chat_memories_c1'));
  storage.fail = true;
  assert.equal(memory.upsertMemory('g1', { content: '第二段回忆' }).ok, false);
  assert.equal(memory.getMemories('g1').length, 1, 'failed save preserves prior memories');
});

test('PWA includes both group modules and opens genuine existing group/memory pages', () => {
  const sw = read('sw.js');
  const cacheVersion = Number((sw.match(/phone-app-pwa-v(\d+)/) || [])[1]) || 0;
  assert.ok(cacheVersion >= 209, 'group game privacy fixes require PWA cache v209+');
  for (const resource of ['group-settings-layout.js?v=20261115s1',
    'group_memory_view.js?v=20261115gm1']) {
    assert.ok(sw.includes(resource), resource);
  }
  assert.match(sw, /APP_SHELL\.concat\(pageEntries\)/,
    'QA must retain its dynamic PWA page manifest');
  for (const page of ['chat/chat/group-play.html',
    'worldbook/memory/memory.html']) {
    assert.ok(fs.existsSync(path.join(root, page)), page);
  }
  const group = read('shared/js/group-settings-layout.js');
  assert.match(group, /worldbook\/memory\/memory.html\?view=groups/);
  assert.match(group, /chat-detail\.html\?id=/);
});


test('public group history recall excludes role-only and private messages, preserving ordinary single-chat recall', () => {
  const data = new Map();
  const storage = {
    getItem(k) { return data.get(k) || null; },
    setItem(k, v) { data.set(k, String(v)); }
  };
  const window = { localStorage: storage };
  vm.runInNewContext(loadMemorySource(), { window, console });
  const recall = window.MemoryRecall;
  const history = [
    { role: 'assistant', text: '群里找到了秘密线索，藏在花园的盒子里', visibility: 'role_only' },
    { role: 'assistant', text: '私信里讨论了秘密线索和花园地图', visibility: 'private' },
    { role: 'assistant', text: '秘密线索来自其他人的私聊', type: 'group_private' },
    { role: 'assistant', text: '大家说好了今晚一起玩推理游戏', visibility: 'public' }
  ];
  const query = '秘密线索';
  const privateRecall = recall.searchHistoryMessages(history, query, { maxScan: 100, maxItems: 5 });
  assert.ok(privateRecall.length >= 1, 'legacy role history still supports its own historical recall');
  const publicRecall = recall.searchHistoryMessages(history, query, {
    maxScan: 100, maxItems: 5, groupPublicOnly: true
  });
  assert.deepEqual(Array.from(publicRecall), [], 'the shared group AI cannot recall private visibility');
  const page = read('chat/chat/chat-detail.html');
  assert.match(page, /recallOptions\.groupPublicOnly = true/);
  assert.match(page, /m\.visibility !== 'role_only'/);
});

function loadMemorySource() { return read('shared/js/phone/memory_recall.js'); }
