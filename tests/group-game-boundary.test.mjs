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
  assert.match(detail, /pendingGameWhisper && groupTurnEffects && window\.GroupGameSessions/);
  assert.match(detail, /groupTurnEffects\.afterSave\(function \(\) \{[\s\S]*?GroupGameSessions\.sendWhisper\(pendingGameWhisper\)/);
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
  for (const name of ['group-game-session.js?v=20261116game6',
    'group-memory-events.js?v=20261115gme2']) {
    assert.ok(worker.includes(name), name);
    assert.ok(detail.includes(name), name);
    assert.ok(settings.includes(name), name);
  }
  assert.ok(worker.includes('group-game-panel.js?v=20261116gpanel2'));
  assert.ok(worker.includes('chat-context-policy.js?v=20261115gameprivacy1'));
});

test('corrupt game metadata fails closed for AI identity and all private routes', () => {
  const h = harness();
  h.storage.setItem('phone_group_game_v1_g1', '{"sessionId":');
  assert.equal(h.game.buildRoleContext({ groupId: 'g1', roleId: 'r1' }).code, 'CORRUPT_SESSION');
  const permission = h.game.canWhisper({ groupId: 'g1', fromId: 'r1', toId: 'r2' });
  assert.equal(permission.active, true);
  assert.equal(permission.allowed, false);
  assert.equal(permission.code, 'CORRUPT_SESSION');
  assert.equal(h.game.buildRoleContext({ groupId: 'g2', roleId: 'r1' }).active, false,
    'a truly empty unrelated group must still work');
  assert.equal(h.game.canWhisper({ groupId: 'g2', fromId: 'r1', toId: 'r2' }).allowed, true);
});

test('a complete or half-streamed secret marker never becomes a public bubble or pagehide snapshot', () => {
  const h = harness();
  const samples = [
    '公开推理[游戏私聊:r2:我收到的绝密线索]',
    '公开推理[游戏私聊:r2:还没输出完的秘密',
    '公开推理[群私聊:r1:只能发给你的话]',
    '公开推理[群私聊:r1:未完成的私聊',
    '公开推理[游戏私聊',
    '公开推理[游',
    '公开推理[群私'
  ];
  for (const message of samples) {
    const masked = h.game.redactPublicStreamText(message);
    assert.equal(masked, '公开推理', message);
  }
  assert.equal(h.game.redactPublicStreamText('公开[今天]大家投票吧'), '公开[今天]大家投票吧');
  const detail = load('chat/chat/chat-detail.html');
  assert.match(detail, /function redactGroupPrivateStream\(value\)/);
  assert.match(detail, /return redactGroupPrivateStream\(snapshotText\.replace/);
  assert.match(detail, /tmpText = redactGroupPrivateStream\(tmpText\)\.trim\(\)/);
  assert.match(detail, /if \(!isCompleted \|\| isRegeneration \|\| contextOnly\)/,
    'incomplete AI replies may not persist private machine actions');
});


test('host game DM displays only its own conversation, never the other players private talk', () => {
  const h = harness();
  assert.equal(begin(h, { allowPrivate: true, showPrivateActivity: true }).ok, true);
  const sid = h.game.getPublic('g1').sessionId;
  const send = (fromId, toId, text, eventId) => h.game.sendWhisper({
    groupId: 'g1', sessionId: sid, fromId, toId, text, eventId
  });
  assert.equal(send('__user', 'r2', '我给你的提示只有你能看到', 'host1').ok, true);
  assert.equal(send('r2', '__user', '主持人，我收到了', 'host2').ok, true);
  assert.equal(send('r3', 'r2', '其他两位角色的私下讨论', 'host3').ok, true);
  const convo = h.game.getHostConversation({
    group: group(), groupId: 'g1', actorId: '__user', peerId: 'r2'
  });
  assert.equal(convo.ok, true);
  assert.equal(convo.messages.length, 2);
  assert.equal(convo.messages[0].direction, 'sent');
  assert.equal(convo.messages[1].direction, 'received');
  const visible = JSON.stringify(convo.messages);
  assert.match(visible, /我给你的提示只有你能看到/);
  assert.match(visible, /主持人，我收到了/);
  assert.doesNotMatch(visible, /其他两位角色的私下讨论/);
  assert.equal(h.game.getHostConversation({
    group: group(), groupId: 'g1', actorId: 'r2', peerId: 'r2'
  }).code, 'NO_PERMISSION');
  assert.equal(h.game.getHostConversation({
    group: group(), groupId: 'g1', actorId: '__user', peerId: 'outsider'
  }).code, 'NOT_PLAYER');
  assert.doesNotMatch(JSON.stringify(h.game.getPublic('g1')), /我给你的提示|主持人，我收到了/);
  assert.doesNotMatch(h.memory.getPublicPrompt({ groupId: 'g1' }), /主持人，我收到了/);
  assert.equal(h.game.finish({ groupId: 'g1', group: group(), actorId: '__user' }).ok, true);
  assert.equal([...h.records.keys()].some(k => k.includes('_inbox___user')), false);
});

test('host game private-chat controls remain collapsed and unavailable in no-private mode', () => {
  const settings = load('shared/js/phone/group-game-panel.js');
  const detail = load('chat/chat/chat-detail.html');
  assert.doesNotThrow(() => new vm.Script(settings));
  assert.match(settings, /id="groupGameWhisperPanel"/);
  assert.match(settings, /game\.rules\.allowPrivate!==true/);
  assert.match(settings, /api\.getHostConversation/);
  assert.match(settings, /api\.sendWhisper/);
  assert.match(detail, /recipientId !== '__user'/);
  assert.match(detail, /redactGroupPrivateStream/);
});


test('game private DM preserves confirmed delivery and recovers public activity idempotently', () => {
  const h = harness();
  assert.equal(begin(h, { allowPrivate: true, showPrivateActivity: true }).ok, true);
  const sid = h.game.getPublic('g1').sessionId;
  const req = { groupId: 'g1', sessionId: sid, fromId: 'r1', toId: 'r2',
    text: '只给角色二的秘密消息', eventId: 'whisper-recover-1' };
  const originalSet = h.storage.setItem.bind(h.storage);
  let blockActivity = true;
  h.storage.setItem = (key, value) => {
    if (key === 'phone_group_game_v1_g1' && blockActivity) throw new Error('QuotaExceededError');
    return originalSet(key, value);
  };
  const first = h.game.sendWhisper(req);
  assert.equal(first.ok, true, 'recipient inbox has been durably saved');
  assert.equal(first.privateSaved, true);
  assert.equal(first.activitySynced, false, 'public activity failure must not be misreported as synced');
  assert.equal(h.game.buildRoleContext({ groupId: 'g1', roleId: 'r2' }).text.includes(req.text), true);
  assert.equal(h.game.getPublic('g1').activity.length, 0);
  blockActivity = false;
  const again = h.game.sendWhisper(req);
  assert.equal(again.ok, true);
  assert.equal(again.duplicate, true);
  assert.equal(again.activitySynced, true);
  assert.equal(h.game.getPublic('g1').activity.length, 1, 'retry must add metadata once');
  const recipient = h.records.get('phone_group_game_private_v1_g1_' + sid + '_inbox_r2');
  assert.equal(JSON.parse(recipient).length, 1, 'retry must not deliver a second private message');
  assert.equal(h.game.sendWhisper({ ...req, text: '碰撞的另一条消息' }).code, 'EVENT_CONFLICT');
  assert.doesNotMatch(h.records.get('phone_group_game_v1_g1'), /只给角色二的秘密消息/);
});


test('no-private mode also blocks ordinary one-to-one role chat before persistence', () => {
  const h = harness();
  h.storage.setItem('phone_groups', JSON.stringify([group()]));
  assert.equal(begin(h, { allowPrivate: false }).ok, true);
  const denied = h.game.checkDirectPrivateAllowed({ roleId: 'r2' });
  assert.equal(denied.ok, true);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'GAME_PRIVATE_DISABLED');
  assert.equal(h.game.checkDirectPrivateAllowed({ roleId: 'outside' }).allowed, true);
  assert.equal(h.game.finish({ group: group(), groupId: 'g1', actorId: '__user' }).ok, true);
  assert.equal(h.game.checkDirectPrivateAllowed({ roleId: 'r2' }).allowed, true);
  assert.equal(begin(h, { allowPrivate: true }).ok, true);
  assert.equal(h.game.checkDirectPrivateAllowed({ roleId: 'r2' }).allowed, true);
  h.storage.setItem('phone_group_game_v1_g1', '{"notValid":');
  assert.equal(h.game.checkDirectPrivateAllowed({ roleId: 'r2' }).code, 'CORRUPT_SESSION');
  const detail = load('chat/chat/chat-detail.html');
  assert.match(detail, /GameSessions\.checkDirectPrivateAllowed/);
  const guardIndex = detail.indexOf('checkDirectPrivateAllowed({');
  const saveIndex = detail.indexOf('const userMsg = {', guardIndex);
  assert.ok(guardIndex > 0 && saveIndex > guardIndex,
    'direct DM guard must run before writing a new user message');
});
