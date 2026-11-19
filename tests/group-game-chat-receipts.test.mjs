import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

function group(id = 'g1') {
  return { id, name: '周末推理群', ownerId: '__user', userMembership: 'joined',
    members: [
      { id: 'r1', name: '林序' },
      { id: 'r2', name: '陈望' },
      { id: 'r3', name: '沈知' }
    ] };
}
function createHarness() {
  const records = new Map();
  const storage = {
    failWrite: false,
    getItem(key) { return records.has(key) ? records.get(key) : null; },
    setItem(key, value) {
      if (this.failWrite) throw new Error('QuotaExceededError');
      records.set(key, String(value));
    },
    removeItem(key) { records.delete(key); }
  };
  const window = { localStorage: storage };
  const context = { window, localStorage: storage, console };
  for (const script of [
    'shared/js/phone/phone_storage.js',
    'shared/js/phone/group-game-session.js',
    'shared/js/phone/group-game-chat-receipts.js',
    'shared/js/phone/chat-context-policy.js'
  ]) vm.runInNewContext(read(script), context, { filename: script });
  return { window, storage, records,
    games: window.GroupGameSessions,
    receipts: window.GroupGameChatReceipts };
}
function start(h, id = 'g1', allowPrivate = false) {
  return h.games.start({ group: group(id), actorId: '__user',
    gameId: 'mystery', badRoleId: 'r2', allowPrivate });
}
function finish(h, id = 'g1') {
  return h.games.finish({ group: group(id), groupId: id, actorId: '__user' });
}
function post(h, session, g = group()) {
  return h.receipts.publish({ group: g, session, actorId: '__user' });
}
function history(h, id = 'g1') {
  return JSON.parse(h.storage.getItem('chat_history_' + id) || '[]');
}

test('verified finish publishes once to original group chat; private votes never leak', () => {
  const h = createHarness();
  const original = [{ mid: 'old1', time: 1700000000000,
    role: 'user', text: '旧群消息必须保留' }];
  h.storage.setItem('chat_history_g1', JSON.stringify(original));
  const started = start(h);
  assert.equal(started.ok, true);
  assert.equal(h.games.castVote({ groupId: 'g1', sessionId: started.session.sessionId,
    voterId: 'r1', targetId: 'r2', eventId: 'gvr1' }).ok, true);
  assert.equal(h.games.castVote({ groupId: 'g1', sessionId: started.session.sessionId,
    voterId: 'r3', targetId: 'r1', eventId: 'gvr3' }).ok, true);

  const ended = finish(h);
  assert.equal(ended.ok, true);
  assert.equal(h.receipts.check({ group: group(), session: ended.session,
    actorId: '__user' }).exists, false);
  const created = post(h, ended.session);
  assert.equal(created.ok, true);
  assert.equal(created.duplicate, false);
  const again = post(h, ended.session);
  assert.equal(again.ok, true);
  assert.equal(again.duplicate, true);
  assert.equal(history(h).length, 2);
  assert.deepEqual(history(h)[0], original[0]);
  const record = history(h)[1];
  assert.equal(record.role, 'system');
  assert.equal(record.type, 'group_game_result');
  assert.equal(record.mid, 'm_game_result_' + ended.session.sessionId);
  assert.equal(record.groupGame.revealedRoleId, 'r2');
  assert.equal(record.groupGame.voteCount, 2);
  assert.equal(record.groupGame.correctVotes, 1);
  assert.equal(record.groupGame.voteTally.find(v => v.targetId === 'r2').count, 1);
  assert.doesNotMatch(JSON.stringify(record), /gvr1|gvr3|voterId|私聊内容/);
  assert.equal(h.receipts.check({ group: group(), session: ended.session,
    actorId: '__user' }).exists, true);
});

test('cancelled session generates a no-reveal receipt with no secret fields', () => {
  const h = createHarness();
  const started = start(h);
  assert.equal(started.ok, true);
  const cancelled = h.games.cancel({ group: group(), groupId: 'g1', actorId: '__user' });
  assert.equal(cancelled.ok, true);
  const created = post(h, cancelled.session);
  assert.equal(created.ok, true);
  const record = history(h)[0];
  assert.equal(record.groupGame.status, 'cancelled');
  assert.equal(record.groupGame.revealedRoleId, '');
  assert.equal(record.groupGame.revealedName, '');
  assert.deepEqual(Array.from(record.groupGame.voteTally), []);
  assert.match(record.text, /身份未揭晓/);
  assert.doesNotMatch(JSON.stringify(record), /陈望|r2|bad|winner/);
  assert.equal(post(h, cancelled.session).duplicate, true);
  assert.equal(start(h).ok, true, 'the next round can start after posting cancellation');
});

test('malformed or non-array history is protected, with no replacement', () => {
  for (const corrupt of ['{', '{}', '{"messages":[]}']) {
    const h = createHarness();
    const ended = finishAfterStart(h);
    h.storage.setItem('chat_history_g1', corrupt);
    const result = post(h, ended.session);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'HISTORY_CORRUPT');
    assert.equal(h.storage.getItem('chat_history_g1'), corrupt);
  }
});

function finishAfterStart(h) {
  assert.equal(start(h).ok, true);
  const result = finish(h);
  assert.equal(result.ok, true);
  return result;
}

test('save failure leaves prior messages untouched, then retry adds exactly one card', () => {
  const h = createHarness();
  h.storage.setItem('chat_history_g1',
    JSON.stringify([{ mid: 'm-old', role: 'assistant', text: '先前聊天', time: 1000 }]));
  const ended = finishAfterStart(h);
  h.storage.failWrite = true;
  const failure = post(h, ended.session);
  assert.equal(failure.ok, false);
  assert.equal(failure.code, 'SAVE_FAILED');
  assert.equal(history(h).length, 1);
  h.storage.failWrite = false;
  assert.equal(post(h, ended.session).ok, true);
  assert.equal(post(h, ended.session).duplicate, true);
  assert.equal(history(h).length, 2);
});

test('former legacy chat history in phone_data_v2 survives result projection', () => {
  const h = createHarness();
  const legacy = [{ mid: 'legacy1', time: 1020, role: 'user', text: '来自旧存储的消息' }];
  h.storage.setItem('phone_data_v2', JSON.stringify({
    g1: { chat: { history: legacy } }
  }));
  const ended = finishAfterStart(h);
  assert.equal(post(h, ended.session).ok, true);
  assert.deepEqual(history(h)[0], legacy[0]);
  assert.equal(history(h).length, 2);
});

test('a renamed member does not make the historical receipt duplicate conflict', () => {
  const h = createHarness();
  const ended = finishAfterStart(h);
  assert.equal(post(h, ended.session).ok, true);
  const firstName = history(h)[0].groupGame.revealedName;
  const renamed = group();
  renamed.members[1].nickname = '新群头衔昵称';
  const result = post(h, ended.session, renamed);
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(history(h).length, 1);
  assert.equal(history(h)[0].groupGame.revealedName, firstName);
});

test('the active, stale, unauthorized or tampered session is rejected', () => {
  const h = createHarness();
  const active = start(h);
  assert.equal(active.ok, true);
  assert.equal(post(h, active.session).code, 'NOT_CLOSED');
  assert.equal(h.receipts.publish({ group: group(), session: active.session,
    actorId: 'r1' }).code, 'NO_PERMISSION');
  const ended = finish(h);
  assert.equal(ended.ok, true);
  assert.equal(h.receipts.publish({ group: group(), session: {
    ...ended.session, sessionId: 'old_session'
  }, actorId: '__user' }).code, 'UNVERIFIED_RESULT');

  const key = 'phone_group_game_v1_g1';
  const saved = JSON.parse(h.storage.getItem(key));
  saved.voteCount = 2; // contradictory: no ballots/tally were cast
  h.storage.setItem(key, JSON.stringify(saved));
  assert.equal(post(h, ended.session).code, 'INVALID_TALLY');
  assert.equal(history(h).length, 0);
});

test('game result is a non-AI system receipt and page uses a genuine chat card', () => {
  const h = createHarness();
  const ended = finishAfterStart(h);
  assert.equal(post(h, ended.session).ok, true);
  const dialogue = h.window.ChatContextPolicy.mapHistoryToApiMessages(history(h),
    text => text, { isGroupChat: true });
  assert.equal(dialogue.some(item => String(item.content).includes('坏人是')), false,
    'system receipt must not be misclassified as an AI utterance');
  const detail = read('chat/chat/chat-detail.html');
  assert.match(detail, /msg\.type === 'group_game_result'/);
  assert.match(detail, /class="group-game-result-more"/);
  assert.match(detail, /msg\.groupGame && typeof msg\.groupGame === 'object'/);
  const panel = read('shared/js/phone/group-game-panel.js');
  assert.match(panel, /GroupGameChatReceipts/);
  assert.match(panel, /postResult\(result\.session\)/);
  assert.match(panel, /groupGameReceiptRetry/);
  const page = read('chat/chat/group-play.html');
  assert.match(page, /group-game-chat-receipts\.js\?v=20261116receipt2/);
  const sw = read('sw.js');
  assert.match(sw, /phone-app-pwa-v228/);
  assert.match(sw, /group-game-chat-receipts\.js\?v=20261116receipt2/);
});


test('game pane is mounted only after its five-category settings container exists', () => {
  const page = read('chat/chat/group-play.html');
  const settingsScript = page.indexOf('group-settings-layout.js?v=20261115s1');
  const gameScript = page.indexOf('group-game-panel.js?v=20261116gpanel6');
  assert.ok(settingsScript > 0 && gameScript > settingsScript,
    'both deferred scripts run at interactive/DOMContentLoaded; settings must mount before game panel');
  const settings = read('shared/js/group-settings-layout.js');
  assert.match(settings, /data-group-category/);
  const game = read('shared/js/phone/group-game-panel.js');
  assert.match(game, /document\.querySelector\('\[data-group-category="games"\]'\)/);
});


test('appointed role moderator stays credited after group nickname changes', () => {
  const h=createHarness();
  const selected=h.games.start({group:group(),actorId:'__user',
    gameId:'mystery',hostId:'r3',badRoleId:'r2',allowPrivate:false});
  assert.equal(selected.ok,true);
  const sid=selected.session.sessionId;
  assert.equal(h.games.castVote({groupId:'g1',sessionId:sid,voterId:'r1',
    targetId:'r2',eventId:'mod-r1'}).ok,true);
  assert.equal(h.games.castVote({groupId:'g1',sessionId:sid,voterId:'r2',
    targetId:'r1',eventId:'mod-r2'}).ok,true);
  const closed=h.games.finish({group:group(),groupId:'g1',sessionId:sid,actorId:'r3'});
  assert.equal(closed.ok,true);
  const saved=post(h,closed.session);
  assert.equal(saved.ok,true);
  const previous=history(h)[0];
  assert.equal(previous.groupGame.hostId,'r3');
  assert.equal(previous.groupGame.hostName,'沈知');
  assert.equal(previous.groupGame.revealedName,'陈望');
  assert.doesNotMatch(JSON.stringify(previous),/mod-r1|mod-r2|voterId/);
  const renamed=group();
  renamed.members[2].nickname='改了名字的主持人';
  assert.equal(post(h,closed.session,renamed).duplicate,true);
  assert.equal(history(h).length,1);
  assert.equal(history(h)[0].groupGame.hostName,'沈知');
  const chat=read('chat/chat/chat-detail.html');
  assert.match(chat,/gameResult\.hostName/);
});
