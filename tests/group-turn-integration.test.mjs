import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (filename) => fs.readFileSync(path.join(root, filename), 'utf8');
const html = read('chat/chat/chat-detail.html');
const markerStart = html.indexOf('        function processGroupInteractionMarkers(');
const markerEnd = html.indexOf('        function showGroupPrivatePopup(', markerStart);
assert.ok(markerStart > 0 && markerEnd > markerStart);
const markerSource = html.slice(markerStart, markerEnd);
const gameSource = read('shared/js/phone/group-turn-effects.js');

function harness(options = {}) {
  const events = [], groupWrites = [], data = new Map();
  let privatePopupCount = 0;
  const group = {
    id:'g1', ownerId:'__user', userMembership:'joined',
    members:[{id:'r1', name:'角色一'}, {id:'r2', name:'角色二'}, {id:'r3', name:'角色三'}],
    relationships:{}, settings:{allowPrivateMessages:true, relationshipDynamicsEnabled:true}
  };
  const history = [
    {role:'user',type:'group_poll',mid:'p1',poll:{question:'选项',closed:false,options:['甲','乙'],votes:{}}},
    {role:'user',type:'group_chain',mid:'c1',chain:{title:'故事接龙',closed:false,entries:[{memberId:'r2',text:'开头'}]}},
    {role:'user',mid:'u1',text:'请管理员禁言角色三',time:Date.now()}
  ];
  const governance = {
    naturalModeration(text) {
      return String(text || '').includes('禁言')
        ? {actorId:'r1',target:'r3',action:'mute'} : null;
    },
    userIsInGroup(){return true;}, isMuted(){return false;},
    apply(req) {
      events.push('admin:'+req.action);
      return {ok:req.save()===true};
    }
  };
  const storage = {
    getItem(key){return data.has(key)?data.get(key):null},
    setItem(key,value){data.set(key,String(value))}
  };
  const window = {GroupGovernance:governance, GroupGameSessions:null};
  new Function('window',gameSource)(window);
  const environment = {
    window, currentGroup:group, currentRoleId:'g1', isGroupChat:true,
    contextOnly:false, localStorage:storage,
    getGroupSettings(){return group.settings;},
    ensureMid(message) {
      if (options.failChain && message.mid === 'c1') throw Error('Injected parser failure');
      if (!message.mid) message.mid='id'+Date.now();
      return message.mid;
    },
    findGroupSpeakerInHistory(){return group.members[1];},
    groupMemberDisplayName(member){return member.name || member.id;},
    loadGroupById(){return group;},
    saveCurrentGroupObject(){groupWrites.push('group');return true;},
    commitDeferredGroupRelationship(fromId,targetId) {
      events.push('relation:'+fromId+':'+targetId);
      return {ok:true};
    },
    saveMessages(){groupWrites.push('history');return true;},
    showToast(){},
    showGroupPrivatePopup(){privatePopupCount++;},
    console
  };
  const parse = new Function(...Object.keys(environment),
    markerSource+'\nreturn processGroupInteractionMarkers;')(...Object.values(environment));
  return {parse, group, history, events, groupWrites, data, window,
    createTurn:window.GroupTurnEffects.create, get privatePopupCount(){return privatePopupCount;}};
}

const actions = '正常回复 [群投票:p1:2] [群接龙:c1:续写] [群关系互动:r2:讨论了话题] [群动作:禁言:r3]';
test('no governance, relationships or private messaging execute during marker parsing', () => {
  const h = harness(), tx = h.createTurn();
  const visible = h.parse(actions, h.group.members[0], h.history,
    false, false, true, '', () => {}, tx);
  assert.match(visible, /正常回复/);
  assert.doesNotMatch(visible, /群投票|群接龙|群动作|群关系互动/);
  assert.equal(h.history[0].poll.votes.r1, 1);
  assert.equal(h.history[1].chain.entries.length, 2);
  assert.equal(h.events.length, 0);
  assert.equal(h.groupWrites.length, 0);
});

test('failed AI reply returns exact vote/chain state and performs no group actions', () => {
  const h = harness(), tx = h.createTurn();
  const before = JSON.stringify(h.history);
  h.parse(actions, h.group.members[0], h.history, false, false, true, '', () => {}, tx);
  const result = tx.finalize(false);
  assert.equal(result.saved, false);
  assert.equal(JSON.stringify(h.history), before);
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.groupWrites, []);
});

test('verified AI reply commits moderation and relationships once; vote/chain retained', () => {
  const h = harness(), tx = h.createTurn();
  h.parse(actions, h.group.members[0], h.history, false, false, true, '', () => {}, tx);
  // The real caller first saves the modified reply+poll+chain history in one write.
  h.groupWrites.push('verified-reply');
  const result = tx.finalize(true);
  assert.equal(result.ok, true);
  assert.equal(h.history[0].poll.votes.r1, 1);
  assert.equal(h.history[1].chain.entries.length, 2);
  assert.ok(h.events.some((event) => event.startsWith('admin:')));
  assert.equal(h.events.filter((event) => event.startsWith('admin:')).length, 1,
    'direct admin instruction and equivalent AI marker must not apply twice');
  assert.ok(h.events.some((event) => event.startsWith('relation:')));
  assert.ok(h.groupWrites.indexOf('verified-reply') < h.groupWrites.indexOf('group'));
  assert.equal(tx.finalize(true).code, 'ALREADY_FINALIZED');
});

test('ordinary private group DM cannot write to role chat until reply is saved', () => {
  const h = harness(), tx = h.createTurn();
  const visible = h.parse('说点悄悄话 [群私聊:r1:只有角色单聊能看到]',
    h.group.members[0], h.history, false, false, true, '', () => {}, tx);
  assert.doesNotMatch(visible, /只有角色单聊能看到/);
  assert.equal(h.data.has('chat_history_r1'), false);
  assert.equal(h.privatePopupCount, 0);
  tx.finalize(false);
  assert.equal(h.data.has('chat_history_r1'), false);
  const h2 = harness(), tx2 = h2.createTurn();
  h2.parse('正常文字 [群私聊:r1:角色限定私聊]', h2.group.members[0],
    h2.history, false, false, true, '', () => {}, tx2);
  assert.equal(h2.data.has('chat_history_r1'), false);
  assert.equal(tx2.finalize(true).ok, true);
  assert.match(h2.data.get('chat_history_r1'), /角色限定私聊/);
  const publicCard = h2.history.find((item) => item && item.type === 'group_private');
  assert.ok(publicCard, 'group entry remains usable after private delivery');
  assert.equal(publicCard.text, '', 'public group history must not duplicate private text');
  assert.ok(publicCard.privateMessageId, 'group card has metadata-only private receipt');
  assert.doesNotMatch(JSON.stringify(publicCard), /角色限定私聊/);
  const savedPrivate = JSON.parse(h2.data.get('chat_history_r1'));
  assert.equal(publicCard.privateMessageId, savedPrivate[0].mid);
  assert.equal(h2.privatePopupCount, 1);
});

test('multiple private markers can only deliver the first one per saved turn', () => {
  const h = harness(), tx = h.createTurn();
  const text = '回复 [群私聊:r1:第一条] [群私聊:r1:第二条]';
  const visible = h.parse(text, h.group.members[0], h.history,
    false, false, true, '', () => {}, tx);
  assert.doesNotMatch(visible, /第一条|第二条|群私聊/);
  assert.equal(h.data.has('chat_history_r1'), false);
  const settled = tx.finalize(true);
  assert.equal(settled.ok, true);
  assert.equal(settled.committed, 1, 'only one ordinary private message may be queued');
  const saved = JSON.parse(h.data.get('chat_history_r1'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].text, '第一条');
  assert.equal(h.privatePopupCount, 1);
});

test('incomplete AI response does not even stage vote/chain or governance', () => {
  const h = harness(), tx = h.createTurn(), before = JSON.stringify(h.history);
  const stripped = h.parse(actions, h.group.members[0], h.history,
    false, false, false, '', () => {}, tx);
  assert.doesNotMatch(stripped, /群投票|群动作/);
  assert.equal(JSON.stringify(h.history), before);
  assert.equal(tx.finalize(false).saved, false);
  assert.deepEqual(h.events, []);
});

test('exception halfway through marker parsing rolls back an earlier staged vote', () => {
  const h = harness({failChain:true}), tx = h.createTurn();
  const before = JSON.stringify(h.history);
  assert.throws(() => h.parse(actions, h.group.members[0], h.history,
    false, false, true, '', () => {}, tx), /Injected parser failure/);
  assert.equal(h.history[0].poll.votes.r1, 1, 'vote was staged before the exception');
  const result = tx.finalize(false);
  assert.equal(result.saved, false);
  assert.equal(JSON.stringify(h.history), before);
  assert.equal(h.events.length, 0);
  assert.equal(h.groupWrites.length, 0);
});
