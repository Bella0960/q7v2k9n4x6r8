import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (filename) => fs.readFileSync(path.join(root, filename), 'utf8');
const gameSource = load('shared/js/phone/group-game-session.js');
const memorySource = load('shared/js/phone/group-memory-events.js');
const contextSource = load('shared/js/phone/chat-context-policy.js');

function harness() {
  const records = new Map();
  const storage = {
    blocked: false,
    failOnWrite: 0,
    writeCount: 0,
    getItem(key) { return records.has(key) ? records.get(key) : null; },
    setItem(key, value) {
      this.writeCount++;
      if (this.blocked || this.writeCount === this.failOnWrite)
        throw new Error('QuotaExceededError');
      records.set(key, String(value));
    },
    removeItem(key) { records.delete(key); }
  };
  const memories = new Map();
  const window = { localStorage: storage };
  window.MemoryRecall = {
    getMemories(gid) { return memories.get(gid) || []; },
    upsertMemory(gid, item) {
      const list = memories.get(gid) || [];
      const memory = { ...item, id: 'memory' + (list.length + 1), createdAt: Date.now() };
      list.push(memory);
      memories.set(gid, list);
      return { ok: true, memory };
    }
  };
  for (const [name, source] of [
    ['group-game-session.js', gameSource],
    ['group-memory-events.js', memorySource],
    ['chat-context-policy.js', contextSource]
  ]) vm.runInNewContext(source, { window, console }, { filename: name });
  return { game: window.GroupGameSessions, memory: window.GroupMemoryEvents,
    context: window.ChatContextPolicy, storage, records, memories };
}
function group(id = 'g1') {
  return { id, ownerId: '__user', userMembership: 'joined',
    members: [{ id: 'r1', name: '角色一' }, { id: 'r2', name: '角色二' }, { id: 'r3', name: '角色三' }] };
}
function begin(h, options = {}) {
  return h.game.start({ group: group(options.groupId || 'g1'), actorId: '__user',
    gameId: 'mystery', badRoleId: 'r2', ...options });
}

test('failed role-card/public-state writes roll back the entire new game', () => {
  for (let failOnWrite = 1; failOnWrite <= 4; failOnWrite++) {
    const h = harness();
    h.storage.failOnWrite = failOnWrite;
    const result = begin(h);
    assert.equal(result.ok, false, 'failed write #' + failOnWrite);
    assert.equal(h.game.getPublic('g1'), null, 'no active game may become visible');
    assert.equal([...h.records.keys()].some((key) =>
      key.startsWith('phone_group_game_private_v1_')), false,
      'no dangling role cards after failed write #' + failOnWrite);
  }
});

test('corrupt existing public game state is never overwritten by a new round', () => {
  const h = harness();
  const corrupted = '{"status":"active","unparseable":';
  h.storage.setItem('phone_group_game_v1_g1', corrupted);
  const result = begin(h);
  assert.equal(result.code, 'CORRUPT_SESSION');
  assert.equal(h.storage.getItem('phone_group_game_v1_g1'), corrupted);
  assert.equal([...h.records.keys()].some((key) =>
    key.startsWith('phone_group_game_private_v1_')), false);
});

test('public memory prompt only sees confirmed allowlisted sources', () => {
  const h = harness();
  h.memories.set('g1', [
    { id: 'secret-memory', content: '不可公开的私密身份', status: 'fixed', source: 'private' },
    { id: 'public-memory', content: '大家一起完成了一次接龙', status: 'fixed', source: 'group_chain_public' },
    { id: 'unconfirmed-memory', content: '还没确认的猜测', status: 'pending', source: 'group_manual' }
  ]);
  const publicPrompt = h.memory.getPublicPrompt({ groupId: 'g1' });
  assert.match(publicPrompt, /大家一起完成了一次接龙/);
  assert.doesNotMatch(publicPrompt, /不可公开的私密身份|还没确认的猜测/);
});

test('private identity cards never enter the public game record or another player context', () => {
  const h = harness();
  assert.equal(begin(h).ok, true);
  const pub = h.game.getPublic('g1');
  assert.equal(pub.status, 'active');
  assert.equal(JSON.stringify(pub).includes('badRoleId'), false);
  assert.equal(h.records.get('phone_group_game_v1_g1').includes('"role":"bad"'), false);
  const good = h.game.buildRoleContext({ groupId: 'g1', roleId: 'r1' });
  const bad = h.game.buildRoleContext({ groupId: 'g1', roleId: 'r2' });
  const other = h.game.buildRoleContext({ groupId: 'g1', roleId: 'r3' });
  assert.equal(good.ok, true);
  assert.equal(good.text.includes('你的身份：普通玩家'), true);
  assert.equal(good.text.includes('r2'), false);
  assert.equal(bad.text.includes('你的身份：坏人'), true);
  assert.equal(other.text.includes('你的身份：普通玩家'), true);
  assert.equal(h.game.getPublic('g2'), null);
  assert.equal(h.game.buildRoleContext({ groupId: 'g1', roleId: 'uninvited' }).ok, false);
});

test('missing or corrupted role-only card fails closed, not an invented reply', () => {
  const h = harness();
  assert.equal(begin(h).ok, true);
  const key = [...h.records.keys()].find((k) => k.includes('_r1') && k.startsWith('phone_group_game_private_'));
  assert.ok(key);
  h.storage.removeItem(key);
  assert.equal(h.game.buildRoleContext({ groupId: 'g1', roleId: 'r1' }).code, 'MISSING_CARD');
  assert.equal(h.game.buildRoleContext({ groupId: 'g1', roleId: 'r2' }).ok, true);
});

test('private chat is blocked by frozen game rules and cannot leak into shared state', () => {
  const h = harness();
  assert.equal(begin(h, { allowPrivate: false }).ok, true);
  const firstSessionId = h.game.getPublic('g1').sessionId;
  assert.equal(h.game.sendWhisper({ groupId: 'g1', sessionId: firstSessionId, fromId: 'r1',
    toId: 'r2', text: '仅收件人知道', eventId: 'event1' }).ok, false);
  assert.equal([...h.records.keys()].some((k) => k.includes('_inbox_')), false);
  assert.equal(h.game.finish({ groupId: 'g1', group: group(), actorId: '__user' }).ok, true);
  assert.equal(begin(h, { allowPrivate: true, showPrivateActivity: true }).ok, true);
  const req = { groupId: 'g1', sessionId: h.game.getPublic('g1').sessionId, fromId: 'r1', toId: 'r2',
    text: '仅收件人知道', eventId: 'event2' };
  assert.equal(h.game.sendWhisper(req).ok, true);
  assert.equal(h.game.sendWhisper(req).duplicate, true);
  assert.equal(h.game.sendWhisper({ ...req, toId: 'outsider', eventId: 'event3' }).ok, false);
  const recipient = h.game.buildRoleContext({ groupId: 'g1', roleId: 'r2' });
  const other = h.game.buildRoleContext({ groupId: 'g1', roleId: 'r3' });
  assert.match(recipient.text, /仅收件人知道/);
  assert.doesNotMatch(other.text, /仅收件人知道/);
  assert.doesNotMatch(JSON.stringify(h.game.getPublic('g1')), /仅收件人知道/);
  assert.doesNotMatch(h.records.get('phone_group_game_v1_g1'), /仅收件人知道/);
  assert.equal(h.game.finish({ groupId: 'g1', group: group(), actorId: '__user' }).ok, true);
  assert.equal(h.game.buildRoleContext({ groupId: 'g1', roleId: 'r2' }).active, false);
  assert.equal([...h.records.keys()].some((key) => key.includes('_inbox_')), false);
  assert.equal(begin(h, { allowPrivate: true }).ok, true);
  assert.notEqual(h.game.getPublic('g1').sessionId, req.sessionId);
  assert.equal(h.game.sendWhisper({ ...req, eventId: 'old-round-echo' }).code, 'STALE_SESSION',
    'late responses from the previous game must never enter the next round');
  assert.equal(h.game.buildRoleContext({ groupId: 'g1', roleId: 'r2' }).text.includes('仅收件人知道'), false);
});

test('shared AI history filters private records and explicit role-only visibility', () => {
  const h = harness();
  const entries = [
    { role: 'user', text: '公开消息' },
    { role: 'assistant', type: 'group_private', text: '普通群私聊' },
    { role: 'assistant', type: 'group_game_private', text: '秘密游戏私聊' },
    { role: 'assistant', visibility: 'role_only', text: '只给角色' },
    { role: 'assistant', visibility: 'private', text: '私密' },
    { role: 'assistant', text: '正常回话', memberId: 'r1' }
  ];
  const result = h.context.mapHistoryToApiMessages(entries, String, {
    isGroupChat: true, groupMembers: group().members
  });
  const text = JSON.stringify(result);
  assert.match(text, /公开消息/);
  assert.match(text, /正常回话/);
  for (const secret of ['普通群私聊', '秘密游戏私聊', '只给角色', '私密'])
    assert.doesNotMatch(text, new RegExp(secret));
});

test('only a persisted game reveal can enter public long-term group memories', () => {
  const h = harness();
  assert.equal(begin(h).ok, true);
  const forged = { ...h.game.getPublic('g1'), status: 'finished', revealedRoleId: 'r2' };
  assert.equal(h.memory.recordGameClosure({ group: group(), session: forged }).ok, false);
  assert.equal(h.memories.has('g1'), false);
  const finished = h.game.finish({ groupId: 'g1', group: group(), actorId: '__user' });
  assert.equal(finished.ok, true);
  const event = h.memory.recordGameClosure({ group: group(), session: finished.session });
  assert.equal(event.ok, true);
  assert.equal(h.memories.get('g1').length, 1);
  assert.match(h.memory.getPublicPrompt({ groupId: 'g1' }), /角色二/);
  assert.equal(h.memory.getPublicPrompt({ groupId: 'g2' }), '');
  assert.equal(h.memory.recordGameClosure({ group: group(), session: finished.session }).duplicate, true);
});

test('closed chain memory requires a matching saved public chat message', () => {
  const h = harness();
  const event = { role: 'user', type: 'group_chain', mid: 'chain1', time: Date.now(),
    chain: { title: '故事接龙', closed: true, entries: [
      { memberId: '__user', text: '开头' }, { memberId: 'r1', text: '续写' }
    ] } };
  assert.equal(h.memory.recordChainClosure({ group: group(), message: event }).ok, false);
  h.storage.setItem('chat_history_g1', JSON.stringify([event]));
  assert.equal(h.memory.recordChainClosure({ group: group(), message: event }).ok, true);
  assert.match(h.memory.getPublicPrompt({ groupId: 'g1' }), /故事接龙/);
  assert.equal(h.memory.recordChainClosure({ group: group(), message: event }).duplicate, true);
  assert.equal(h.memory.getPublicPrompt({ groupId: 'g2' }), '');
});

test('chat detail routes private events only after a verified saved AI reply', () => {
  const detail = load('chat/chat/chat-detail.html');
  assert.match(detail, /queueGameWhisper\(/);
  assert.match(detail, /replySaved && pendingGameWhisper/);
  assert.match(detail, /GroupGameSessions\.sendWhisper\(pendingGameWhisper\)/);
  assert.match(detail, /GroupMemoryEvents\.recordChainClosure/);
  assert.match(detail, /m\.type !== 'group_game_private'/);
  assert.match(detail, /activeGame\.sessionId !== expectedGameSessionId/);
  assert.match(detail, /privateRule\.active\) return ''/);
  assert.match(detail, /const roleMemory = isGroupChat[\s\S]*?buildWeightedMemoryText/);
  assert.match(detail, /if \(!isCompleted \|\| isRegeneration \|\| contextOnly\)/);
  for (const [index, match] of [...detail.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi)].entries()) {
    assert.doesNotThrow(() => new vm.Script(match[1], { filename: 'chat-detail:inline' + index }));
  }
});

test('backup keeps confirmed group memory but excludes unfinished secret cards', () => {
  const window = {};
  vm.runInNewContext(load('settings/js/backup-modules.js'), { window, console });
  const reg = window.MAOMAOBackupRegistry;
  assert.equal(reg.belongsTo('characters', 'chat_memories_g1'), true);
  assert.equal(reg.belongsTo('characters', 'phone_group_memory_public_events_v1_g1'), true);
  assert.equal(reg.isSensitiveKey('phone_group_game_private_v1_g1_sid_r2'), true);
  assert.equal(reg.isSensitiveKey('phone_group_game_v1_g1'), true);
  assert.match(load('settings/js/backup.js'), /phone_group_game_\(\?:private_\)\?v1_/);
});

test('PWA uses the updated game scripts and installs the entire feature bundle', () => {
  const worker = load('sw.js');
  const detail = load('chat/chat/chat-detail.html');
  const settings = load('chat/chat/group-play.html');
  const cacheVersion = Number((worker.match(/phone-app-pwa-v(\d+)/) || [])[1]) || 0;
  assert.ok(cacheVersion >= 210, 'secret-game privacy assets require PWA v209+');
  for (const name of ['group-game-session.js?v=20261115game3',
    'group-memory-events.js?v=20261115gme2']) {
    assert.ok(worker.includes(name), name);
    assert.ok(detail.includes(name), name);
    assert.ok(settings.includes(name), name);
  }
  assert.ok(worker.includes('group-game-panel.js?v=20261115gpanel1'));
  assert.ok(worker.includes('chat-context-policy.js?v=20261115gameprivacy1'));
});
