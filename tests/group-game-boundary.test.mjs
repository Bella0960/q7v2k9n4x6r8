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

test('game start keeps private role cards after a transient public-state readback failure', () => {
  const h = harness();
  const key = 'phone_group_game_v1_g1';
  const originalSet = h.storage.setItem;
  const originalGet = h.storage.getItem;
  let failNextPublicRead = false;
  h.storage.setItem = function (k, value) {
    originalSet.call(this, k, value);
    if (k === key) failNextPublicRead = true;
  };
  h.storage.getItem = function (k) {
    if (k === key && failNextPublicRead) {
      failNextPublicRead = false;
      throw new Error('transient IndexedDB/localStorage readback error');
    }
    return originalGet.call(this, k);
  };
  const result = begin(h);
  assert.equal(result.ok, true, 'saved public state is rechecked before declaring failure');
  assert.equal(h.game.getPublic('g1').status, 'active');
  assert.equal(h.game.buildRoleContext({groupId:'g1',roleId:'r1'}).ok, true);
  assert.equal(h.game.buildRoleContext({groupId:'g1',roleId:'r2'}).ok, true);
});

test('persistent public readback failure never creates an active game without cards', () => {
  const h = harness();
  const key = 'phone_group_game_v1_g1';
  const originalSet = h.storage.setItem;
  const originalGet = h.storage.getItem;
  let blockPublicRead = false;
  h.storage.setItem = function (k, value) {
    originalSet.call(this, k, value);
    if (k === key) blockPublicRead = true;
  };
  h.storage.getItem = function (k) {
    if (k === key && blockPublicRead) throw Error('storage unavailable');
    return originalGet.call(this, k);
  };
  const result = begin(h);
  assert.equal(result.code, 'SAVE_UNVERIFIED', 'unknown persistence cannot be a false success');
  assert.equal(h.records.has(key), true, 'committed public record remains available');
  assert.equal([...h.records.keys()].filter(k =>
    k.startsWith('phone_group_game_private_v1_g1_')).length, 3,
    'role cards must not be deleted while public state is uncertain');
  blockPublicRead = false;
  assert.equal(h.game.getPublic('g1').status, 'active', 'refresh can recover the round');
  assert.equal(h.game.buildRoleContext({groupId:'g1',roleId:'r2'}).ok, true);
});

test('a role card from another group cannot be used for game reveal', () => {
  const h = harness();
  assert.equal(begin(h).ok, true);
  const key = [...h.records.keys()].find(k =>
    k.startsWith('phone_group_game_private_v1_g1_') && k.endsWith('_r1'));
  const role = JSON.parse(h.storage.getItem(key));
  h.storage.setItem(key, JSON.stringify({...role, groupId:'g2'}));
  assert.equal(h.game.finish({group:group(),groupId:'g1',actorId:'__user'}).code,
    'MISSING_CARD', 'a cross-group identity record cannot authorize reveal');
  assert.equal(h.game.getPublic('g1').status, 'active');
});

test('duplicated or impossible persisted players never enter public game vote counts', () => {
  const invalidPlayers = [
    ['r1', 'r1', 'r2'],
    ['r1', '__user', 'r2'],
    ['r1', 'r2', 100],
    ['r1'],
    Array.from({length:25}, (_, i) => 'r' + i)
  ];
  for (const players of invalidPlayers) {
    const h = harness();
    assert.equal(begin(h).ok, true);
    const publicKey = 'phone_group_game_v1_g1';
    const prior = JSON.parse(h.records.get(publicKey));
    prior.players = players;
    const damaged = JSON.stringify(prior);
    const privateBefore = [...h.records.keys()].filter(k =>
      k.startsWith('phone_group_game_private_v1_')).sort();
    h.storage.setItem(publicKey, damaged);
    assert.equal(h.game.getPublic('g1'), null,
      'invalid player roster must not be accepted as a valid session');
    assert.equal(begin(h).code, 'CORRUPT_SESSION',
      'new round cannot silently overwrite corrupted old session');
    assert.equal(h.records.get(publicKey), damaged,
      'original persisted bytes must remain for recovery');
    assert.deepEqual([...h.records.keys()].filter(k =>
      k.startsWith('phone_group_game_private_v1_')).sort(), privateBefore,
      'invalid public record cannot trigger cleanup of private cards');
  }
});

test('legacy group user entry cannot become an AI secret-game player', () => {
  const h = harness();
  const g = group();
  g.members.push({id:'__user', name:'用户'});
  const result = begin(h, {group:g});
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.session.players), ['r1', 'r2', 'r3']);
  assert.equal(result.session.players.includes('__user'), false);
  assert.equal(h.game.buildRoleContext({groupId:'g1', roleId:'__user'}).code,
    'NOT_PLAYER', 'user metadata cannot act as a secret AI role');
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
  for (const name of ['group-game-session.js?v=20261116game11',
    'group-memory-events.js?v=20261116gme4']) {
    assert.ok(worker.includes(name), name);
    assert.ok(detail.includes(name), name);
    assert.ok(settings.includes(name), name);
  }
  assert.ok(worker.includes('group-game-panel.js?v=20261116gpanel6'));
  assert.ok(worker.includes('chat-context-policy.js?v=20261118historybudget1'));
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
    '公开推理[群私',
    '公开推理[游戏私聊:r2:跨行线索\n继续隐藏]',
    '公开推理[群私聊:r2:跨行线索\n未结束',
    '公开推理[游戏私聊:r2:' + '秘密'.repeat(700)
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


test('one ballot per character is private until the host reveals the round', () => {
  const h = harness();
  assert.equal(begin(h).ok, true);
  const sessionId = h.game.getPublic('g1').sessionId;
  const context = h.game.buildRoleContext({ groupId:'g1', roleId:'r1' });
  assert.match(context.text, /\[游戏猜测:你怀疑的准确角色ID\]/);
  const first = { groupId:'g1', sessionId, voterId:'r1', targetId:'r2', eventId:'guess-first' };
  assert.equal(h.game.castVote(first).ok, true);
  assert.equal(h.game.castVote(first).duplicate, true, 'replaying the same ballot is idempotent');
  assert.equal(h.game.castVote({ ...first, eventId:'changed-guess', targetId:'r3' }).code,
    'ALREADY_VOTED', 'the character cannot move its vote in the same round');
  assert.equal(h.game.castVote({ ...first, voterId:'r2', targetId:'r2', eventId:'self' }).code,
    'INVALID_VOTE', 'self-voting and outsiders are not valid');
  assert.equal(h.game.castVote({ ...first, voterId:'outsider', eventId:'outside' }).code,
    'INVALID_VOTE');
  const second = { ...first, voterId:'r3', targetId:'r1', eventId:'guess-second' };
  assert.equal(h.game.castVote(second).ok, true);

  const pub = h.game.getPublic('g1');
  assert.equal(pub.voteCount, 2);
  assert.equal(pub.correctVotes, null, 'secret vote results are not revealed early');
  assert.equal(pub.voteTally.length, 0);
  const publicData = JSON.stringify(pub);
  assert.doesNotMatch(publicData, /guess-first|guess-second|targetId|r2.*1票/);
  assert.match(h.game.buildRoleContext({ groupId:'g1', roleId:'r1' }).text, /你已完成本局猜测/);
  assert.doesNotMatch(h.game.buildRoleContext({ groupId:'g1', roleId:'r3' }).text, /guess-first|我投了r2/);

  const finished = h.game.finish({ group:group(), groupId:'g1', actorId:'__user' });
  assert.equal(finished.ok, true);
  assert.equal(finished.session.revealedRoleId, 'r2');
  assert.equal(finished.session.voteCount, 2);
  assert.equal(finished.session.correctVotes, 1);
  const tally = finished.session.voteTally.reduce((out, row) => {
    out[row.targetId] = row.count;
    return out;
  }, {});
  assert.equal(tally.r1, 1);
  assert.equal(tally.r2, 1);
  assert.equal(tally.r3, 0);
  assert.equal([...h.records.keys()].some(key => key.includes('_vote_')), false,
    'the round cannot leave recoverable private vote keys');
  assert.equal(h.memory.recordGameClosure({ group:group(), session:finished.session }).ok, true);
  assert.match(h.memory.getPublicPrompt({ groupId:'g1' }), /2人投票，1人猜对/);
});

test('game guesses fail closed on storage errors, corruption and stale rounds', () => {
  const h = harness();
  assert.equal(begin(h).ok, true);
  const sid = h.game.getPublic('g1').sessionId;
  const ballot = { groupId:'g1', sessionId:sid, voterId:'r1',
    targetId:'r2', eventId:'storage-probe' };
  h.storage.blocked = true;
  assert.equal(h.game.castVote(ballot).code, 'SAVE_FAILED');
  h.storage.blocked = false;
  assert.equal(h.game.getPublic('g1').voteCount, 0, 'no phantom vote after failed write');
  assert.equal(h.game.castVote(ballot).ok, true);
  const key = 'phone_group_game_private_v1_g1_' + sid + '_vote_r1';
  h.storage.setItem(key, '{"eventId":');
  assert.equal(h.game.getPublic('g1').voteError, true);
  assert.equal(h.game.castVote({ ...ballot, voterId:'r3', eventId:'next' }).code, 'CORRUPT_VOTE');
  assert.equal(h.game.finish({ group:group(), groupId:'g1', actorId:'__user' }).code,
    'CORRUPT_VOTE', 'do not declare an incorrect tally');
  assert.equal(h.game.getPublic('g1').status, 'active');
  h.storage.removeItem(key);
  assert.equal(h.game.finish({ group:group(), groupId:'g1', actorId:'__user' }).ok, true);
  assert.equal(begin(h).ok, true);
  assert.equal(h.game.castVote(ballot).code, 'STALE_SESSION');
});

test('game guess AI tag is saved only after real reply and never flashes in streaming UI', () => {
  const detail = load('chat/chat/chat-detail.html');
  const sessionSource = load('shared/js/phone/group-game-session.js');
  const panel = load('shared/js/phone/group-game-panel.js');
  assert.match(detail, /turnEffects\.afterSave\(function \(\) \{[\s\S]*?GroupGameSessions\.castVote/);
  assert.match(detail, /expectedGameSessionId/);
  assert.match(detail, /gameGuessSeen/);
  assert.match(detail, /游戏猜测/);
  assert.match(sessionSource, /游戏猜测/);
  assert.match(detail, /redactGroupPrivateStream\(tmpText\)/);
  assert.match(detail, /redactGroupPrivateStream\(snapshotText\.replace/);
  assert.match(panel, /game\.voteCount/);
  assert.match(panel, /game\.correctVotes/);
  assert.match(panel, /renderTally\(game\)/);
});


test('host can cancel a broken or unfinished game without revealing or remembering secrets', () => {
  const h = harness();
  assert.equal(begin(h, {allowPrivate: true}).ok, true);
  const sid = h.game.getPublic('g1').sessionId;
  assert.equal(h.game.castVote({
    groupId:'g1',sessionId:sid,voterId:'r1',targetId:'r2',eventId:'abort-test'
  }).ok, true);
  assert.equal(h.game.sendWhisper({
    groupId:'g1',sessionId:sid,fromId:'r1',toId:'r3',
    text:'未公开的猜测',eventId:'abort-whisper'
  }).ok, true);
  assert.equal(h.game.cancel({group:group(),groupId:'g1',actorId:'r1'}).code,
    'NO_PERMISSION', 'regular roles cannot cancel a host session');
  const cancelled = h.game.cancel({group:group(),groupId:'g1',actorId:'__user'});
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.session.status, 'cancelled');
  assert.equal(cancelled.session.revealedRoleId, '');
  assert.equal(cancelled.session.voteTally.length, 0);
  assert.equal(h.memory.recordGameClosure({group:group(),session:cancelled.session}).ok,
    false, 'cancelled sessions must never create a public result memory');
  assert.equal(h.game.checkDirectPrivateAllowed({roleId:'r1'}).allowed,true);
  assert.equal([...h.records.keys()].some(k =>
    k.includes(sid) && k.startsWith('phone_group_game_private_v1_')),false);
  assert.equal(begin(h).ok,true,'the owner can immediately start a fresh round');
});

test('cancel is a verified write; invalid vote can be safely abandoned', () => {
  const h = harness();
  assert.equal(begin(h).ok, true);
  const sid = h.game.getPublic('g1').sessionId;
  h.storage.setItem('phone_group_game_private_v1_g1_'+sid+'_vote_r1','{"broken":');
  assert.equal(h.game.getPublic('g1').voteError,true);
  assert.equal(h.game.finish({group:group(),groupId:'g1',actorId:'__user'}).code,
    'CORRUPT_VOTE');
  h.storage.blocked=true;
  assert.equal(h.game.cancel({group:group(),groupId:'g1',actorId:'__user'}).code,
    'SAVE_FAILED','failed cancellation must not discard identity cards');
  assert.equal(h.game.getPublic('g1').status,'active');
  h.storage.blocked=false;
  assert.equal(h.game.cancel({group:group(),groupId:'g1',actorId:'__user'}).ok,true);
  assert.equal(h.game.getPublic('g1').status,'cancelled');
  assert.equal(begin(h).ok,true);
});


test('incomplete privacy cleanup is reported and can be retried without losing group history', () => {
  const h=harness();
  const historic=[{ role:'user',text:'原来的群聊消息',mid:'old1' }];
  h.storage.setItem('chat_history_g1',JSON.stringify(historic));
  assert.equal(begin(h,{allowPrivate:true}).ok,true);
  const sid=h.game.getPublic('g1').sessionId;
  assert.equal(h.game.sendWhisper({groupId:'g1',sessionId:sid,fromId:'r1',toId:'r2',
    text:'临时游戏私聊',eventId:'clear-probe'}).ok,true);
  const actualRemove=h.storage.removeItem.bind(h.storage);
  let blocked=true;
  h.storage.removeItem=(key)=>{
    if(blocked && key.includes(sid))throw new Error('StorageUnavailable');
    return actualRemove(key);
  };
  const result=h.game.finish({group:group(),groupId:'g1',actorId:'__user'});
  assert.equal(result.ok,true,'the public game result was durably saved');
  assert.equal(result.cleanupComplete,false,'must not pretend private data was cleared');
  const status=h.game.getCleanupStatus({group:group(),groupId:'g1',actorId:'__user'});
  assert.equal(status.ok,true);
  assert.ok(status.cleanupPending>0);
  assert.equal(begin(h).code,'PENDING_CLEANUP',
    'new rounds cannot silently leave previous secrets lying around');
  assert.equal(h.game.retryCleanup({group:group(),groupId:'g1',actorId:'r2'}).code,
    'NO_PERMISSION');
  blocked=false;
  const recovered=h.game.retryCleanup({group:group(),groupId:'g1',actorId:'__user'});
  assert.equal(recovered.ok,true);
  assert.equal(recovered.cleanupComplete,true);
  assert.equal(h.game.getCleanupStatus({group:group(),groupId:'g1',actorId:'__user'}).cleanupPending,0);
  assert.equal(h.storage.getItem('chat_history_g1'),JSON.stringify(historic),
    'game cleanup never deletes existing public conversation messages');
  assert.equal(begin(h).ok,true);
});

test('cancelled rounds with failed cleanup expose retry but not role secrets', () => {
  const h=harness();
  assert.equal(begin(h,{allowPrivate:true}).ok,true);
  const sid=h.game.getPublic('g1').sessionId;
  const actualRemove=h.storage.removeItem.bind(h.storage);
  h.storage.removeItem=(key)=>{
    if(key.includes(sid))throw new Error('RemoveBlocked');
    return actualRemove(key);
  };
  const ended=h.game.cancel({group:group(),groupId:'g1',actorId:'__user'});
  assert.equal(ended.ok,true);
  assert.equal(ended.cleanupComplete,false);
  assert.equal(ended.session.status,'cancelled');
  assert.equal(ended.session.revealedRoleId,'');
  assert.equal(h.game.buildRoleContext({groupId:'g1',roleId:'r2'}).active,false,
    'cancelled identities cannot enter AI context even when cleanup fails');
  assert.equal(h.memory.recordGameClosure({group:group(),session:ended.session}).ok,false);
  const panel=load('shared/js/phone/group-game-panel.js');
  assert.match(panel,/groupGameCleanup/);
  assert.match(panel,/api\.getCleanupStatus/);
  assert.match(panel,/api\.retryCleanup/);
});


test('owner may appoint a nonplaying AI host; moderator receives no secret role card or votes', () => {
  const h = harness();
  const selected = begin(h, { hostId:'r3' });
  assert.equal(selected.ok, true);
  const sid = selected.session.sessionId;
  assert.equal(selected.session.hostId, 'r3');
  assert.equal(selected.session.players.length, 2);
  assert.equal(selected.session.players.includes('r3'), false);
  assert.equal(h.records.has('phone_group_game_private_v1_g1_'+sid+'_r3'), false,
    'a moderator must never receive a role-only identity card');
  assert.equal(h.records.has('phone_group_game_private_v1_g1_'+sid+'_vote_r3'), false);
  const host = h.game.buildRoleContext({ groupId:'g1', roleId:'r3' });
  assert.equal(host.ok, true);
  assert.equal(host.active, true);
  assert.equal(host.isHost, true);
  assert.match(host.text, /你是本局主持人/);
  assert.match(host.text, /你不是玩家/);
  assert.doesNotMatch(host.text, /唯一的坏人|坏人是谁：|r2是坏人/);
  assert.doesNotMatch(host.text, /可添加.*游戏猜测/);
  assert.doesNotMatch(host.text, /游戏揭晓\]/, 'host cannot reveal before all ballots');
  assert.equal(h.game.castVote({
    groupId:'g1',sessionId:sid,voterId:'r3',targetId:'r2',eventId:'mod-vote'
  }).code,'INVALID_VOTE');
  assert.equal(h.game.finish({group:group(),groupId:'g1',
    sessionId:sid,actorId:'r3'}).code,'NOT_READY');
  assert.equal(h.game.start({group:group(),actorId:'r3',
    hostId:'r3',badRoleId:'r2',gameId:'mystery'}).code,'NO_PERMISSION');
});

test('delegated host can reveal only after unanimous ballots and matching round', () => {
  const h = harness();
  const started = begin(h,{hostId:'r3'});
  assert.equal(started.ok,true);
  const sid=started.session.sessionId;
  assert.equal(h.game.castVote({
    groupId:'g1',sessionId:sid,voterId:'r1',targetId:'r2',eventId:'host-vote-1'
  }).ok,true);
  assert.equal(h.game.finish({
    group:group(),groupId:'g1',sessionId:sid,actorId:'r3'
  }).code,'NOT_READY');
  assert.equal(h.game.castVote({
    groupId:'g1',sessionId:sid,voterId:'r2',targetId:'r1',eventId:'host-vote-2'
  }).ok,true);
  const host=h.game.buildRoleContext({groupId:'g1',roleId:'r3'});
  assert.equal(host.ok,true);
  assert.match(host.text, /\[游戏揭晓\]/);
  assert.doesNotMatch(host.text, /坏人是r2|唯一的坏人/);
  assert.equal(h.game.finish({
    group:group(),groupId:'g1',sessionId:'stale-round',actorId:'r3'
  }).code,'NO_PERMISSION');
  assert.equal(h.game.finish({
    group:group(),groupId:'g1',sessionId:sid,actorId:'r2'
  }).code,'NO_PERMISSION');
  const muted=group();
  muted.members.find(m=>m.id==='r3').isMuted=true;
  assert.equal(h.game.finish({
    group:muted,groupId:'g1',sessionId:sid,actorId:'r3'
  }).code,'HOST_UNAVAILABLE');
  const final=h.game.finish({group:group(),groupId:'g1',sessionId:sid,actorId:'r3'});
  assert.equal(final.ok,true);
  assert.equal(final.session.status,'finished');
  assert.equal(final.session.revealedRoleId,'r2');
  assert.equal(final.session.voteCount,2);
  assert.equal(final.session.correctVotes,1);
  assert.equal(h.game.finish({group:group(),groupId:'g1',sessionId:sid,
    actorId:'r3'}).code,'NOT_ACTIVE', 'repeated marker never ends game twice');
  assert.equal([...h.records.keys()].some(k=>k.includes(sid)&&
    k.startsWith('phone_group_game_private_v1_')),false);
});

test('role moderator selection is fail-closed; owner remains able to finish and cancel', () => {
  const h=harness();
  assert.equal(begin(h,{hostId:'outsider'}).code,'INVALID_HOST');
  assert.equal(begin(h,{hostId:'r2'}).code,'INVALID_SECRET',
    'selected moderator cannot also be secretly designated as bad');
  assert.equal(begin(h,{hostId:'r3'}).ok,true);
  assert.equal(h.game.cancel({group:group(),groupId:'g1',actorId:'r3'}).code,
    'NO_PERMISSION','AI moderators cannot cancel the game');
  assert.equal(h.game.finish({group:group(),groupId:'g1',actorId:'__user'}).ok,true,
    'owner retains override to finish early');
});

test('AI moderator reveal directives stay hidden and use verified-save effects', () => {
  const h=harness();
  assert.equal(h.game.redactPublicStreamText('宣布结果[游戏揭晓]'),'宣布结果');
  assert.equal(h.game.redactPublicStreamText('宣布结果[游戏揭'),'宣布结果');
  const detail=load('chat/chat/chat-detail.html');
  assert.match(detail,/gameRevealSeen/);
  assert.match(detail,/GroupGameSessions\.finish\(\{/);
  assert.match(detail,/GroupGameChatReceipts\.publish\(\{/);
  assert.match(detail,/GroupMemoryEvents\.recordGameClosure\(\{/);
  assert.match(detail,/turnEffects\.afterSave\(function\(\)\{/);
  assert.match(detail,/session\.hostId!==hostId/);
  assert.match(detail,/groupAutoRevealReceipt/);
  assert.match(detail,/replySaved/);
  const panel=load('shared/js/phone/group-game-panel.js');
  assert.match(panel,/id="groupGameHost"/);
  assert.match(panel,/hostId:hostSelect\.value/);
  assert.match(panel,/updateCulpritOptions\(\)/);
});


test('moderator speaker selection preserves direct mentions while opening and announcing results', () => {
  const source=load('chat/chat/chat-detail.html');
  assert.match(source, /moderatorSpoke = historyList\.some/);
  assert.match(source, /hostRound\.voteCount === hostRound\.players\.length/);
  assert.match(source, /!groupReplyPick\.isMentioned/);
  assert.match(source, /getAvailableGroupMembers\(\)\.find/);
  assert.match(source, /groupAutoRevealReceipt = receipt/);
  assert.match(source, /groupAutoRevealReceipt &&/);
  assert.match(source, /m\.mid === receipt\.mid/);
  assert.match(source, /gameRevealSeen/);
});


test('shared group memory can remember the public moderator but not private ballots', () => {
  const h=harness();
  assert.equal(begin(h,{hostId:'r3'}).ok,true);
  const sid=h.game.getPublic('g1').sessionId;
  assert.equal(h.game.castVote({groupId:'g1',sessionId:sid,
    voterId:'r1',targetId:'r2',eventId:'moderator-memory-vote'}).ok,true);
  const finished=h.game.finish({group:group(),groupId:'g1',actorId:'__user'});
  assert.equal(finished.ok,true);
  assert.equal(h.memory.recordGameClosure({group:group(),session:finished.session}).ok,true);
  const shared=h.memory.getPublicPrompt({groupId:'g1'});
  assert.match(shared,/「角色三」主持/);
  assert.match(shared,/「角色二」/);
  assert.doesNotMatch(shared,/moderator-memory-vote|voterId|phone_group_game_private/);
});

test('corrupt game inbox fails closed without losing previously stored private data', () => {
  const h = harness();
  assert.equal(begin(h, {allowPrivate: true}).ok, true);
  const sessionId = h.game.getPublic('g1').sessionId;
  const recipientKey = 'phone_group_game_private_v1_g1_' + sessionId + '_inbox_r2';
  const damaged = '{"oldPrivateMessage":';
  h.storage.setItem(recipientKey, damaged);
  const send = () => h.game.sendWhisper({
    groupId:'g1',sessionId,fromId:'r1',toId:'r2',
    text:'不能覆盖原私聊',eventId:'inbox-corruption'
  });
  assert.equal(send().code, 'CORRUPT_INBOX');
  assert.equal(h.storage.getItem(recipientKey), damaged,
    'malformed private messages must not be overwritten with a new array');
  assert.equal(h.game.buildRoleContext({groupId:'g1',roleId:'r2'}).code,
    'CORRUPT_INBOX', 'recipient AI reply must stop if inbox is unreadable');
  assert.equal(h.game.getHostConversation({
    group:group(),groupId:'g1',actorId:'__user',peerId:'r2'
  }).code, 'CORRUPT_INBOX',
  'owner cannot silently see a falsely empty private conversation');

  const originalGet = h.storage.getItem.bind(h.storage);
  h.storage.getItem = (key) => {
    if (key === recipientKey) throw new Error('StorageUnavailable');
    return originalGet(key);
  };
  assert.equal(send().code, 'STORAGE_UNAVAILABLE');
  assert.equal(h.game.buildRoleContext({groupId:'g1',roleId:'r2'}).code,
    'STORAGE_UNAVAILABLE');
  h.storage.getItem = originalGet;
  assert.equal(h.storage.getItem(recipientKey), damaged);

  const hostKey = 'phone_group_game_private_v1_g1_' + sessionId + '_inbox___user';
  h.storage.setItem(hostKey, damaged);
  assert.equal(h.game.getHostConversation({
    group:group(),groupId:'g1',actorId:'__user',peerId:'r1'
  }).code, 'CORRUPT_INBOX');
  assert.equal(h.storage.getItem(hostKey), damaged);
});

test('corrupted self-vote cannot be counted or published as game result', () => {
  const h = harness();
  assert.equal(begin(h).ok, true);
  const sid = h.game.getPublic('g1').sessionId;
  const key = 'phone_group_game_private_v1_g1_' + sid + '_vote_r1';
  const invalid = {version:1,groupId:'g1',sessionId:sid,voterId:'r1',
    targetId:'r1',eventId:'invalid-self-ballot',time:Date.now()};
  h.storage.setItem(key, JSON.stringify(invalid));
  const publicBefore = h.game.getPublic('g1');
  assert.equal(publicBefore.voteError, true,
    'self-vote in storage must mark the round as corrupted');
  assert.equal(publicBefore.voteCount, 0,
    'invalid ballots cannot count toward unanimous completion');
  assert.equal(h.game.castVote({groupId:'g1',sessionId:sid,
    voterId:'r2',targetId:'r1',eventId:'valid-after-damaged'}).code,
    'CORRUPT_VOTE', 'no voting into a round with corrupted ballots');
  assert.equal(h.game.finish({group:group(),groupId:'g1',actorId:'__user'}).code,
    'CORRUPT_VOTE', 'owner cannot publish a fabricated tally');
  assert.equal(h.game.getPublic('g1').status,'active');
  assert.equal(h.storage.getItem(key), JSON.stringify(invalid),
    'protect unreadable or inconsistent source ballots for diagnosis');
  assert.equal(h.game.cancel({group:group(),groupId:'g1',actorId:'__user'}).ok,
    true, 'owner retains a safe way to cancel without revealing identity');

  const next = begin(h);
  assert.equal(next.ok, true);
  const nextSid = next.session.sessionId;
  const nextKey = 'phone_group_game_private_v1_g1_' + nextSid + '_vote_r1';
  h.storage.setItem(nextKey, JSON.stringify({...invalid,
    sessionId:nextSid,targetId:'r2',time:null}));
  assert.equal(h.game.getPublic('g1').voteError,true,
    'missing vote timestamps cannot count as valid ballots');
});

test('nested closing brackets in hidden directives never expose partial secrets', () => {
  const h = harness();
  const samples = [
    '公开推理[游戏私聊:r2:不能公开[注释]后半段秘密]',
    '公开推理[群私聊:r1:给你的内容[方括号]后半段秘密]',
    '公开推理[游戏私聊:r2:跨行[括号]\\n后半段秘密]',
    '公开推理[游戏私聊:r2:秘密]后面不应假定是公开正文',
    '公开推理[游戏猜测:r2]未验证的后缀',
    '公开推理[游戏私聊:r2:秘密[嵌套]后半段秘密',
    '公开推理[群私聊:r1:长内容]\\n偷偷补充第二行'
  ];
  for (const source of samples) {
    assert.equal(h.game.redactPublicStreamText(source), '公开推理', source);
  }
  assert.equal(h.game.redactPublicStreamText('公开推理[今天]群友继续聊天'),
    '公开推理[今天]群友继续聊天', 'ordinary user text remains visible');
  const detail = load('chat/chat/chat-detail.html');
  assert.match(detail, /var privateMarker=/,
    'the final saved group reply must validate the marker grammar too');
  assert.match(detail, /var privateTail=/,
    'nested directives must be dropped before they can queue private effects');
});
