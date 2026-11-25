import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const source = load('shared/js/group-governance.js');
const roles = [
  { id: 'c1', name: '林澈', persona: '冷静谨慎' },
  { id: 'c2', name: '江念', persona: '活泼健谈' },
  { id: 'c3', name: '李四', persona: '安静' }
];

function harness(groups = []) {
  const values = new Map([
    ['phone_groups', JSON.stringify(groups)],
    ['ai_custom_characters', JSON.stringify(roles)]
  ]);
  const storage = {
    blocked: false,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (this.blocked) throw new Error('QuotaExceededError');
      values.set(key, String(value));
    }
  };
  const window = { localStorage: storage };
  vm.runInNewContext(source, { window, console }, { filename: 'group-governance.js' });
  return { api: window.GroupGovernance, storage, values };
}
function group(settings = { allowRoleActions: true }) {
  return { id: 'g1', name: '测试群', ownerId: '__user',
    settings, members: roles.map((role) => ({
      id: role.id, name: role.name, avatar: '', isAdmin: false, muted: false
    })), relationships: {} };
}
function save(storage, g) {
  return () => {
    storage.setItem('phone_groups', JSON.stringify([g]));
    return true;
  };
}

test('legacy membership and owner-granted role moderation enforce role boundaries', () => {
  const g = group({ allowRoleActions: false });
  const { api, storage } = harness([g]);
  const commit = save(storage, g);
  assert.equal(api.userIsInGroup(g), true, 'legacy groups are joined');
  assert.equal(api.rank(g, '__user'), 3);
  assert.equal(api.apply({ group: g, actorId: 'c1', action: 'mute', target: 'c3', save: commit }).ok, false);
  assert.equal(api.apply({ group: g, actorId: '__user', action: 'promote', target: 'c1', save: commit }).ok, true);
  assert.equal(g.settings.allowRoleActions, true, 'appointing a group admin enables the agreed role actions');
  assert.equal(api.rank(g, 'c1'), 2);
  assert.equal(api.apply({ group: g, actorId: 'c1', action: 'mute', target: 'c3', save: commit }).ok, true);
  assert.equal(api.isMuted(g.members[2]), true);
  assert.equal(api.apply({ group: g, actorId: 'c1', action: 'mute', target: 'c1', save: commit }).ok, false);
  assert.equal(api.apply({ group: g, actorId: 'c2', action: 'unmute', target: 'c3', save: commit }).ok, false);
  assert.equal(api.apply({ group: g, actorId: 'c1', action: 'mute', target: '__user', save: commit }).ok, false);
  assert.equal(api.apply({ group: g, actorId: '__user', action: 'promote', target: 'c2', save: commit }).ok, true);
  assert.equal(api.apply({ group: g, actorId: 'c1', action: 'mute', target: 'c2', save: commit }).ok, false);
  assert.equal(api.apply({ group: g, actorId: 'c1', action: 'promote', target: 'c3', save: commit }).ok, false);
  assert.equal(api.apply({ group: g, actorId: '__user', action: 'demote', target: 'c1', save: commit }).ok, true);
  assert.equal(api.apply({ group: g, actorId: 'c1', action: 'unmute', target: 'c3', save: commit }).ok, false);
  assert.equal(api.apply({ group: g, actorId: '__user', action: 'unmute', target: 'c3', save: commit }).ok, true);
  assert.equal(api.isMuted(g.members[2]), false);
});

test('explicit addressed natural moderation is idempotence-friendly and rejects hypotheticals', () => {
  const g = group();
  g.members[0].isAdmin = true;
  const { api } = harness([g]);
  assert.equal(JSON.stringify(api.naturalModeration('林澈，你把李四禁言了', g)),
    JSON.stringify({ actorId: 'c1', target: 'c3', action: 'mute' }));
  assert.equal(JSON.stringify(api.naturalModeration('@林澈 把李四解除禁言', g)),
    JSON.stringify({ actorId: 'c1', target: 'c3', action: 'unmute' }));
  assert.equal(api.naturalModeration('如果林澈把李四禁言了会怎样', g), null);
  assert.equal(api.naturalModeration('江念把李四禁言了', g), null, 'non-admins cannot be directed to mute');
  assert.equal(api.naturalModeration('林澈你今天心情怎么样', g), null);
});

test('failed persistence rolls back changes and events only fire after success', () => {
  const g = group();
  const { api, storage } = harness([g]);
  let changes = 0;
  const unsubscribe = api.on('action:promote', () => { changes++; });
  const bad = api.apply({ group: g, actorId: '__user', action: 'promote',
    target: 'c1', save: () => false });
  assert.equal(bad.ok, false);
  assert.equal(g.members[0].isAdmin, false);
  assert.equal(changes, 0);
  const good = api.apply({ group: g, actorId: '__user', action: 'promote',
    target: 'c1', save: save(storage, g) });
  assert.equal(good.ok, true);
  assert.equal(changes, 1);
  unsubscribe();
  storage.blocked = true;
  assert.equal(api.leave({ group: g, save: () => {
    try { storage.setItem('phone_groups', JSON.stringify([g])); return true; }
    catch { return false; }
  }}).ok, false);
  assert.equal(api.userIsInGroup(g), true);
});

test('leave and rejoin require consent; decline never rejoins or modifies role library', () => {
  const g = group();
  const { api, storage } = harness([g]);
  const beforeRoles = storage.getItem('ai_custom_characters');
  assert.equal(api.leave({ group: g, save: save(storage, g) }).ok, true);
  assert.equal(api.userIsInGroup(g), false);
  const offered = api.offerInvitation({ groupId: 'g1', inviterId: 'c1' });
  assert.equal(offered.ok, true);
  assert.equal(api.offerInvitation({ groupId: 'g1', inviterId: 'c1' }).ok, false);
  assert.equal(api.pendingInvitations().length, 1);
  assert.equal(api.resolveInvitation({ id: offered.invitation.id, accept: false }).ok, true);
  assert.equal(JSON.parse(storage.getItem('phone_groups'))[0].userMembership, 'left');
  const offeredAgain = api.offerInvitation({ groupId: 'g1', inviterId: 'c1' });
  assert.equal(offeredAgain.ok, true);
  assert.equal(api.resolveInvitation({ id: offeredAgain.invitation.id, accept: true }).ok, true);
  assert.equal(JSON.parse(storage.getItem('phone_groups'))[0].userMembership, 'joined');
  assert.equal(storage.getItem('ai_custom_characters'), beforeRoles);
});

test('new role-owned group stays a draft until accepted and keeps existing roles untouched', () => {
  const { api, storage } = harness([]);
  const beforeRoles = storage.getItem('ai_custom_characters');
  const proposed = api.offerNewGroupInvitation({ inviterId: 'c1',
    groupName: '周末小聚', memberIds: ['c2', 'invalid'] });
  assert.equal(proposed.ok, true);
  assert.equal(JSON.parse(storage.getItem('phone_groups')).length, 0);
  assert.equal(api.pendingInvitations()[0].draft, true);
  assert.equal(api.offerNewGroupInvitation({ inviterId: 'c1',
    groupName: '第二个群', memberIds: ['c3'] }).ok, false, 'daily cooldown and one pending invite');
  assert.equal(api.resolveInvitation({ id: proposed.invitation.id, accept: true }).ok, true);
  const groups = JSON.parse(storage.getItem('phone_groups'));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, '周末小聚');
  assert.equal(groups[0].ownerId, 'c1');
  assert.equal(groups[0].members.length, 2);
  assert.equal(groups[0].userMembership, 'joined');
  assert.equal(storage.getItem('ai_custom_characters'), beforeRoles);
});

test('all touched pages compile and refer to the shared bridge; backup and PWA include it', () => {
  for (const filename of ['chat/chat/chat.html', 'chat/chat/chat-detail.html', 'chat/chat/group-play.html', 'chat/chat/chat-settings.html']) {
    const html = load(filename);
    assert.match(html, /group-governance\.js\?v=20261125scope3/, filename);
    const inline = [...html.matchAll(/<script(?:\s+[^>]*)?>([\s\S]*?)<\/script>/gi)];
    for (const [index, match] of inline.entries()) {
      assert.doesNotThrow(() => new vm.Script(match[1], { filename: filename + ':inline' + index }));
    }
  }
  const detail = load('chat/chat/chat-detail.html');
  assert.match(detail, /GroupGovernance\.isMuted/);
  assert.match(detail, /GroupGovernance\.naturalModeration/);
  assert.match(detail, /offerNewGroupInvitation/);
  assert.match(detail, /群动作:禁言:/);
  assert.match(load('chat/chat/chat.html'), /pendingInvitations/);
  assert.match(load('chat/chat/group-play.html'), /GroupGovernance\.leave/);
  assert.match(load('sw.js'), /group-governance\.js\?v=20261125scope3/);
  assert.match(load('settings/js/backup-modules.js'), /phone_group_invitations/);
});


test('QQ-style custom titles are group-local; admins cannot override peers or owner', () => {
  const g = group({ allowRoleActions: true });
  const { api, storage } = harness([g]);
  const commit = save(storage, g);
  assert.equal(api.apply({ group: g, actorId: '__user', action: 'promote', target: 'c1', save: commit }).ok, true);
  assert.equal(api.apply({ group: g, actorId: 'c1', action: 'set-title', target: 'c2',
    options: { title: '首席摸鱼官' }, save: commit }).ok, true);
  assert.equal(g.members[1].title, '首席摸鱼官');
  assert.equal(api.apply({ group: g, actorId: 'c1', action: 'set-title', target: 'c1',
    options: { title: '群主' }, save: commit }).ok, false, 'cannot title self');
  assert.equal(api.apply({ group: g, actorId: '__user', action: 'promote', target: 'c3', save: commit }).ok, true);
  assert.equal(api.apply({ group: g, actorId: 'c1', action: 'set-title', target: 'c3',
    options: { title: '越权头衔' }, save: commit }).ok, false, 'cannot title peer admin');
  assert.equal(api.apply({ group: g, actorId: '__user', action: 'set-title', target: 'c3',
    options: { title: '活动主持' }, save: commit }).ok, true);
  assert.equal(g.members[2].title, '活动主持');
  assert.equal(api.apply({ group: g, actorId: 'c2', action: 'set-title', target: 'c1',
    options: { title: '普通成员不能改' }, save: commit }).ok, false);

  const before = JSON.stringify(g);
  const failed = api.apply({ group: g, actorId: '__user', action: 'set-title', target: 'c2',
    options: { title: '未保存' }, save: () => false });
  assert.equal(failed.ok, false);
  assert.equal(JSON.stringify(g), before, 'failure must restore previous title and group data');
  assert.equal(api.apply({ group: g, actorId: '__user', action: 'set-title', target: 'c2',
    options: { title: '' }, save: commit }).ok, true, 'owner may clear a custom title');
  assert.equal(g.members[1].title, '');
  const rolePool = JSON.parse(storage.getItem('ai_custom_characters'));
  assert.equal(rolePool[1].name, '江念', 'no mutation to original character profile');
});


test('silent storage writes cannot create phantom old/new group invitations or joins', () => {
  const g = group();
  g.userMembership = 'left';
  const h = harness([g]);
  const originalSet = h.storage.setItem.bind(h.storage);
  h.storage.setItem = (key, value) => {
    if (key === 'phone_group_invitations') return; // silently dropped
    originalSet(key, value);
  };
  const failed = h.api.offerInvitation({ groupId: 'g1', inviterId: 'c1' });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'SAVE_FAILED');
  assert.equal(h.api.pendingInvitations().length, 0);
  h.storage.setItem = originalSet;
  const invited = h.api.offerInvitation({ groupId: 'g1', inviterId: 'c1' });
  assert.equal(invited.ok, true);
  // An adapter may silently drop membership updates too. Never claim joined.
  h.storage.setItem = (key, value) => {
    if (key === 'phone_groups') return;
    originalSet(key, value);
  };
  assert.equal(h.api.resolveInvitation({ id: invited.invitation.id, accept:true }).code, 'SAVE_FAILED');
  assert.equal(JSON.parse(h.storage.getItem('phone_groups'))[0].userMembership, 'left');

  const n = harness([]);
  const setNew = n.storage.setItem.bind(n.storage);
  n.storage.setItem = (key, value) => {
    if (key === 'phone_group_invitations') return;
    setNew(key, value);
  };
  const proposed = n.api.offerNewGroupInvitation({
    inviterId:'c1', groupName:'周末小聚', memberIds:['c2']
  });
  assert.equal(proposed.ok, false);
  assert.equal(proposed.code, 'SAVE_FAILED');
  assert.equal(n.api.pendingInvitations().length, 0);
  assert.equal(JSON.parse(n.storage.getItem('phone_groups')).length, 0);
});

test('thrown persistence errors restore in-memory admin changes and group membership', () => {
  const g = group();
  const h = harness([g]);
  const before = JSON.stringify(g);
  let events = 0;
  h.api.on('group:changed', () => { events++; });
  h.api.on('group:user-left', () => { events++; });
  const explodingSave = () => { throw Error('QuotaExceededError'); };

  const appointed = h.api.apply({
    group: g, actorId: '__user', action: 'promote',
    target: 'c1', save: explodingSave
  });
  assert.equal(appointed.code, 'SAVE_FAILED',
    'quota failures must be reported instead of throwing into the UI');
  assert.equal(JSON.stringify(g), before,
    'failed admin appointment cannot remain visible in memory');
  assert.equal(events, 0, 'unsaved admin actions emit no events');

  const left = h.api.leave({ group: g, save: explodingSave });
  assert.equal(left.code, 'SAVE_FAILED',
    'quota failure on leave must return a recoverable result');
  assert.equal(JSON.stringify(g), before,
    'unsaved leave must not hide the group or create fake exit metadata');
  assert.equal(events, 0, 'unsaved departures emit no events');

  assert.equal(h.api.apply({
    group: g, actorId: '__user', action: 'promote',
    target: 'c1', save: save(h.storage, g)
  }).ok, true, 'normal persisted admin actions still work');
  assert.equal(h.api.leave({ group:g, save: save(h.storage, g) }).ok,
    true, 'normal saved leave still works');
  assert.equal(g.userMembership, 'left');
});

test('declining stale invitations never depends on deleted roles or groups', () => {
  const h = harness();
  const offer = h.api.offerNewGroupInvitation({
    storage: h.storage, inviterId: 'c1', groupName: '临时组',
    memberIds: ['c2']
  });
  assert.equal(offer.ok, true);
  const originalGroups = h.values.get('phone_groups');
  h.values.set('ai_custom_characters', JSON.stringify([roles[0]]));
  const survivingRoles = h.values.get('ai_custom_characters');
  const declined = h.api.resolveInvitation({
    storage:h.storage, id:offer.invitation.id, accept:false
  });
  assert.equal(declined.ok, true, 'deleting a candidate role cannot trap an invite');
  assert.equal(declined.accepted, false);
  assert.equal(h.values.get('phone_groups'), originalGroups,
    'declining cannot silently create or join a group');
  assert.equal(h.values.get('ai_custom_characters'), survivingRoles,
    'declining must never rewrite character profiles');
  const entry = JSON.parse(h.values.get('phone_group_invitations'))[0];
  assert.equal(entry.status, 'declined');
  assert.equal(h.api.resolveInvitation({
    storage:h.storage, id:offer.invitation.id, accept:false
  }).code, 'NOT_FOUND', 'a dismissed invitation cannot be declined twice');

  const g = group(); g.userMembership = 'left';
  const h2 = harness([g]);
  const old = h2.api.offerInvitation({
    storage:h2.storage, groupId:g.id, inviterId:'c1'
  });
  assert.equal(old.ok, true);
  h2.values.set('phone_groups', '[]');
  assert.equal(h2.api.resolveInvitation({
    storage:h2.storage, id:old.invitation.id, accept:false
  }).ok, true, 'removed original groups cannot trap old invite receipts');
  assert.deepEqual(JSON.parse(h2.values.get('phone_groups')), []);
});

test('declining a pending invite works despite a corrupted group index', () => {
  const h = harness();
  const offer = h.api.offerNewGroupInvitation({
    storage:h.storage, inviterId:'c1', groupName:'校验中',
    memberIds:['c2']
  });
  assert.equal(offer.ok, true);
  const corruptBytes = '{"groups":"unreadable"';
  h.values.set('phone_groups', corruptBytes);
  const declined = h.api.resolveInvitation({
    storage:h.storage, id:offer.invitation.id, accept:false
  });
  assert.equal(declined.ok, true,
    'decline must not depend on parsing unrelated group data');
  assert.equal(declined.accepted, false);
  assert.equal(h.values.get('phone_groups'), corruptBytes,
    'corrupt group data must remain unchanged');
  assert.equal(JSON.parse(h.values.get('phone_group_invitations'))[0].status,
    'declined');

  const h2 = harness();
  const pending = h2.api.offerNewGroupInvitation({
    storage:h2.storage, inviterId:'c1', groupName:'候选群',
    memberIds:['c2']
  });
  assert.equal(pending.ok, true);
  h2.values.set('phone_groups', corruptBytes);
  assert.equal(h2.api.resolveInvitation({
    storage:h2.storage, id:pending.invitation.id, accept:true
  }).code, 'INVALID_STORAGE',
  'accept must still fail closed if the group index cannot be read');
  assert.equal(h2.values.get('phone_groups'), corruptBytes);
  assert.equal(JSON.parse(h2.values.get('phone_group_invitations'))[0].status,
    'pending');
});


test('departed owner cannot continue to administer the old group', () => {
  for (const status of ['left', 'declined']) {
    const g = group();
    g.userMembership = status;
    const h = harness([g]);
    const before = JSON.stringify(g);
    let saved = 0;
    const result = h.api.apply({
      group: g, actorId: '__user', action: 'promote',
      target: 'c1', save() { saved++; return true; }
    });
    assert.equal(h.api.rank(g, '__user'), 0, 'former owner has no active rights');
    assert.equal(result.code, 'NO_PERMISSION');
    assert.equal(saved, 0, 'no storage write after permission denial');
    assert.equal(JSON.stringify(g), before, 'no group mutation');
  }

  const g = group();
  const h = harness([g]);
  assert.equal(h.api.rank(g, '__user'), 3, 'legacy joined group retains owner powers');
  assert.equal(h.api.apply({
    group: g, actorId: '__user', action: 'promote',
    target: 'c1', save: save(h.storage, g)
  }).ok, true, 'joined owner remains authorized');
});

test('member permission fields remain compatible and changes are scoped to the active group', () => {
  const first = group();
  const second = {...group(), id:'g2'};
  const {api, storage} = harness([first, second]);
  const commit = () => { storage.setItem('phone_groups', JSON.stringify([first, second])); return true; };
  const apply = (action, target) => api.apply({group:first, actorId:'__user', action, target, save:commit});
  assert.equal(apply('promote', 'c1').ok, true);
  assert.equal(first.members[0].memberRole, 'admin');
  assert.equal(api.rank(first, 'c1'), 2);
  assert.equal(api.rank(second, 'c1'), 1);
  assert.equal(apply('mute', 'c1').ok, true);
  assert.equal(first.members[0].isMuted, true);
  assert.equal(api.isMuted(first.members[0]), true);
  assert.equal(api.isMuted(second.members[0]), false);
  assert.equal(apply('unmute', 'c1').ok, true);
  assert.equal(first.members[0].isMuted, false);
  assert.equal(apply('demote', 'c1').ok, true);
  assert.equal(first.members[0].memberRole, 'member');
  first.ownerId = 'c2';
  assert.equal(apply('promote', 'c1').code, 'NO_PERMISSION');
  assert.equal(apply('mute', 'c1').code, 'NO_PERMISSION');
});

test('canonical group governance rejects duplicate IDs, reserved user and ambiguous invitation targets',()=>{
  const {api}=harness();
  assert.equal(api.findMember({members:[{id:'r1'},{id:'r1'},{id:'r2',name:'r1'}]},'r1'),null);
  assert.equal(api.findMember({members:[{id:'__user',name:'me'}]},'__user'),null);
  assert.equal(api.findMember({members:[{id:'r1',name:'same'},{id:'r2',name:'same'}]},'same'),null);
  const g=group();
  const invoke=(target,roles)=>api.apply({group:g,actorId:'__user',action:'invite',target,options:{roles},save:()=>true});
  assert.equal(invoke('unique',[{id:'r3',name:'unique'},{id:'r3',name:'other'}]).ok,false);
  assert.equal(invoke('me',[{id:'__user',name:'me'}]).ok,false);
  assert.equal(invoke('r3',[{id:'r3',name:'x'},{id:'r4',name:'r3'}]).ok,true);
  assert.equal(g.members.at(-1).id,'r3');
});
test('group home uses current account scope and captured write snapshot',()=>{
  const home=load('shared/js/group-settings-home.js');
  assert.ok(home.includes('guard.commit(snapshot,group).ok===true'));
  assert.ok(home.includes('guard.readPreference(current.snapshot,'));
  assert.ok(home.includes("apply('rename', value, undefined, current)"));
  assert.ok(home.includes("setPreference('myNickname', value, current)"));
  assert.equal(home.includes("write('phone_groups', JSON.stringify(groups)"),false);
});


test('legacy group-play uses the captured account-ready snapshot and never writes while rendering relationships',()=>{
  const play=load('chat/chat/group-play.html'),guard=load('shared/js/phone/group-write-guard.js');
  for(const [,script] of play.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(script.trim())new vm.Script(script);
  const a=play.indexOf('    function persist(message){'),b=play.indexOf('    function renderSettings(){',a);
  assert.ok(a>=0&&b>a);
  const persistSrc=play.slice(a,b);
  function setup(){
    let data=JSON.stringify([{id:'g1',ownerId:'__user',name:'old',members:[{id:'r1'},{id:'r2'}],settings:{}},{id:'g2',name:'other'}]);
    const state={id:'MAO-AAAAAAAAAAAA',ready:true,writes:0,fail:false,notices:[],blocked:0};
    const window={document:{querySelector(q){return {content:q.includes('role')?'member':state.id};}},location:{hostname:'preview.mao520.com'},get __MAO_ACCOUNT_SCOPE__(){return {accountId:state.id,role:'member',ready:state.ready};},localStorage:{getItem(){return data;},setItem(k,v){state.writes++;if(state.fail)throw Error('quota');data=v;}}};
    vm.runInNewContext(guard,{window});
    const api=window.MAOGroupWriteGuard,base=api.read('g1');
    const env=new Function('guard','groupBase','notify','rejectWrite','normalizeForDisplay','var group=groupBase.group;function currentSnapshot(){return guard.matches(groupBase)};'+persistSrc+';return {persist,group:()=>group};')(api,base,x=>state.notices.push(x),()=>{state.blocked++;return false;},g=>g);
    return {state,env,get:()=>JSON.parse(data),replace:v=>{data=JSON.stringify(v);}};
  }
  {const h=setup(),rows=h.get();rows[1].name='newer';h.replace(rows);h.env.group().name='updated';assert.equal(h.env.persist('ok'),true);assert.equal(h.get()[1].name,'newer');h.env.group().name='second';assert.equal(h.env.persist('ok'),true);assert.equal(h.get()[0].name,'second');}
  {const h=setup(),rows=h.get();rows[0].name='newer';h.replace(rows);h.env.group().name='stale';assert.equal(h.env.persist('ok'),false);assert.equal(h.state.writes,0);assert.equal(h.get()[0].name,'newer');assert.equal(h.state.notices.length,0);}
  {const h=setup();h.state.fail=true;h.env.group().name='bad';assert.equal(h.env.persist('ok'),false);assert.equal(h.get()[0].name,'old');assert.equal(h.state.notices.length,0);assert.equal(h.state.blocked,1);}
  {const h=setup();h.state.ready=false;h.env.group().name='bad';assert.equal(h.env.persist('ok'),false);assert.equal(h.state.writes,0);}
  const render=play.slice(play.indexOf('    function renderRelationships(){'),play.indexOf('    function groupMemberName'));
  assert.doesNotMatch(render,/\bpersist\(/);assert.ok(render.includes('finally{group=originalGroup;}'));
  const change=play.slice(play.indexOf("var field=input.getAttribute('data-setting');"),play.indexOf("document.getElementById('groupChatMode').addEventListener"));
  assert.ok(change.indexOf('if(!persist(')>=0&&change.indexOf('if(!persist(')<change.indexOf('localStorage.removeItem'));
  assert.ok(change.includes('&&currentSnapshot()'));
  assert.ok(play.includes('!nextOwner||String(nextOwner.id)!==nextOwnerId'));
  assert.ok(play.includes("if(!currentSnapshot()){rejectWrite();return;}"));
});



test('scoped group wallpaper transaction and reset preserve unrelated data',async()=>{
 const source=load('shared/js/wallpaper-store.js'),home=load('shared/js/group-settings-home.js'),settings=load('chat/chat/chat-settings.html');
 const A="data:image/png;base64,AAAA",B="data:image/png;base64,BBBB",C="data:image/png;base64,CCCC",K="chat_bg_g1";
 function harness(){
 const records=new Map([[K,{dataUrl:A,updatedAt:1}],["chat_bg_g2",{dataUrl:C}],["home_custom_wallpaper",{dataUrl:C}]]),legacy=new Map(),state={ready:true,writes:0,reads:0,dbFail:false,failMutation:false};
 const db={transaction(name,mode){let pending=0,staged=null,aborted=false,completed=false;const tx={abort(){if(completed)throw Error("complete");aborted=true;Promise.resolve().then(()=>tx.onabort?.())},objectStore(){return {get(key){state.reads++;return schedule(()=>records.get(key))},put(value,key){return schedule(()=>{if(state.failMutation)throw Error("quota");staged=[key,value];state.onMutation?.()})},delete(key){return schedule(()=>{if(state.failMutation)throw Error("quota");staged=[key,undefined];state.onMutation?.()})}}}};
 function finish(){if(!pending&&!aborted&&!completed){completed=true;if(staged){state.writes++;if(staged[1]===undefined)records.delete(staged[0]);else records.set(...staged)}state.beforeComplete?.();tx.oncomplete?.()}}
 function schedule(action){const req={};pending++;Promise.resolve().then(()=>{if(aborted)return;try{req.result=action();req.onsuccess?.()}catch(e){req.error=e;req.onerror?.();tx.error=e;tx.onerror?.();aborted=true;}finally{pending--;finish()}});return req}return tx}};
 const w={indexedDB:{open(){const req={};Promise.resolve().then(()=>{if(state.dbFail){req.error=Error("offline");req.onerror?.()}else{req.result=db;req.onsuccess?.()}});return req}},localStorage:{getItem:k=>legacy.get(k)??null,removeItem:k=>{if(state.failCleanup)throw Error("cleanup");legacy.delete(k)},setItem:(k,v)=>legacy.set(k,v)}};
 new Function("window","document",source)(w,{});return {state,records,legacy,api:w.MAOMAOWallpaperStore,valid:()=>state.ready};
}
 async function rejected(p){try{await p;return false}catch(e){return true}}
 const cases=[
  ["legacy read does not migrate",async()=>{let h=harness();h.records.delete(K);h.legacy.set(K,A);return await h.api.getByKey(K)===A&&h.state.writes===0&&!h.records.has(K)}],
  ["snapshot reads legacy without writing",async()=>{let h=harness();h.records.delete(K);h.legacy.set(K,A);let s=await h.api.snapshotGroupBackground(K,h.valid);return s.legacy===A&&s.image===""&&h.state.writes===0}],
  ["save preserves other groups and desktop",async()=>{let h=harness(),s=await h.api.snapshotGroupBackground(K,h.valid);return await h.api.saveGroupBackground(s,B,h.valid)&&h.records.get(K).dataUrl===B&&h.records.get("chat_bg_g2").dataUrl===C&&h.records.get("home_custom_wallpaper").dataUrl===C}],
  ["stale image cannot overwrite newer image",async()=>{let h=harness(),s=await h.api.snapshotGroupBackground(K,h.valid);h.records.set(K,{dataUrl:C,updatedAt:2});return await rejected(h.api.saveGroupBackground(s,B,h.valid))&&h.records.get(K).dataUrl===C&&h.state.writes===0}],
  ["same bytes newer revision rejected",async()=>{let h=harness(),s=await h.api.snapshotGroupBackground(K,h.valid);h.records.set(K,{dataUrl:A,updatedAt:2});return await rejected(h.api.saveGroupBackground(s,B,h.valid))&&h.state.writes===0}],
  ["reset removes matching image only",async()=>{let h=harness();h.legacy.set(K,A);let s=await h.api.snapshotGroupBackground(K,h.valid);return await h.api.resetGroupBackground(s,h.valid)&&!h.records.has(K)&&!h.legacy.has(K)&&h.records.has("chat_bg_g2")}],
  ["stale reset preserves latest image",async()=>{let h=harness(),s=await h.api.snapshotGroupBackground(K,h.valid);h.records.set(K,{dataUrl:C,updatedAt:2});return await rejected(h.api.resetGroupBackground(s,h.valid))&&h.records.get(K).dataUrl===C&&h.state.writes===0}],
  ["changed legacy preserved",async()=>{let h=harness(),s=await h.api.snapshotGroupBackground(K,h.valid);h.legacy.set(K,C);return await rejected(h.api.resetGroupBackground(s,h.valid))&&h.legacy.get(K)===C&&h.state.writes===0}],
  ["scope loss before save zero writes",async()=>{let h=harness(),s=await h.api.snapshotGroupBackground(K,h.valid);h.state.ready=false;return await rejected(h.api.saveGroupBackground(s,B,h.valid))&&h.state.writes===0}],
  ["scope loss during mutation aborts",async()=>{let h=harness(),s=await h.api.snapshotGroupBackground(K,h.valid);h.state.onMutation=()=>h.state.ready=false;return await rejected(h.api.saveGroupBackground(s,B,h.valid))&&h.state.writes===0&&h.records.get(K).dataUrl===A}],
  ["quota failure no fallback",async()=>{let h=harness(),s=await h.api.snapshotGroupBackground(K,h.valid);h.state.failMutation=true;return await rejected(h.api.saveGroupBackground(s,B,h.valid))&&!h.legacy.has(K)&&h.records.get(K).dataUrl===A}],
  ["legacy cleanup failure is not success",async()=>{let h=harness();h.legacy.set(K,A);let s=await h.api.snapshotGroupBackground(K,h.valid);h.state.failCleanup=true;return await rejected(h.api.resetGroupBackground(s,h.valid))&&h.legacy.get(K)===A}],
  ["changed legacy after commit not removed",async()=>{let h=harness();h.legacy.set(K,A);let s=await h.api.snapshotGroupBackground(K,h.valid);h.state.beforeComplete=()=>h.legacy.set(K,C);return await rejected(h.api.resetGroupBackground(s,h.valid))&&h.legacy.get(K)===C}],
  ["non-group keys rejected before read",async()=>{let h=harness();for(const key of ["chat_bg_r1","home_custom_wallpaper","chat_bg_g"])if(!await rejected(h.api.snapshotGroupBackground(key,h.valid)))return false;return h.state.reads===0}],
  ["invalid scope no image read",async()=>{let h=harness();h.state.ready=false;return await h.api.readGroupBackground(K,h.valid)===""&&h.state.reads===0}],
  ["IDB unavailable legacy read only",async()=>{let h=harness();h.state.dbFail=true;h.legacy.set(K,A);return await h.api.readGroupBackground(K,h.valid)===A&&await rejected(h.api.snapshotGroupBackground(K,h.valid))&&h.state.writes===0}],
  ["new and legacy settings use guarded writer",()=>home.includes("wallpaper.saveGroupBackground(snapshot,data,validEdit)")&&home.includes("wallpaper.resetGroupBackground(snapshot,valid)")&&settings.includes("wallpaperStore.saveGroupBackground(snapshot,dataUrl")&&settings.includes("return saveBackgroundImage(dataUrl,selection)")&&!home.includes("wallpaper.saveByKey(bgKey")&&!home.includes("wallpaper.removeByKey(bgKey")]
 ];
 for(const [name,fn] of cases)assert.equal(await fn(),true,name);
});


test('legacy group settings reject stale data, permission changes and missing groups',()=>{
  const html=load('chat/chat/chat-settings.html'),guard=load('shared/js/phone/group-write-guard.js'),governance=load('shared/js/group-governance.js');
  for(const [,code] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(code.trim())new vm.Script(code);
  const a=html.indexOf('    function legacyPageCurrent()'),b=html.indexOf('    // ===== 邀请角色',a);
  assert.ok(a>=0&&b>a);
  const adapter=html.slice(a,b),A='MAO-AAAAAAAAAAAA',B='MAO-BBBBBBBBBBBB';
  function harness(){
    const state={id:A,ready:true,writes:0,fail:false};
    const map=new Map([['phone_groups',JSON.stringify([{id:'g1',name:'old',ownerId:'__user',members:[{id:'r1'},{id:'r2'}]},{id:'g2',name:'other'}])]]);
    const w={document:{querySelector(q){return {content:q.includes('role')?'member':state.id};}},location:{hostname:'preview.mao520.com'},get __MAO_ACCOUNT_SCOPE__(){return {accountId:state.id,role:'member',ready:state.ready};},localStorage:{getItem:k=>map.get(k)??null,setItem(k,v){state.writes++;if(state.fail)throw Error('quota');map.set(k,v);}}};
    new Function('window',guard)(w);new Function('window',governance)(w);
    const api=new Function('window','legacyGuard','legacyAccount','legacySnapshots','roleId',adapter+';return {loadCurrentGroup,saveCurrentGroup,applyLegacyGroup,saveLegacyPreference,legacyGroupCurrent,legacySnapshots};')(w,w.MAOGroupWriteGuard,A,new WeakMap(),'g1');
    return {state,map,api,w,rows:()=>JSON.parse(map.get('phone_groups'))};
  }
  {const h=harness(),x=h.api.loadCurrentGroup(),r=h.rows();r[1].name='newer';h.map.set('phone_groups',JSON.stringify(r));assert.equal(h.api.applyLegacyGroup(x,'rename','new').ok,true);assert.equal(h.rows()[0].name,'new');assert.equal(h.rows()[1].name,'newer');}
  {const h=harness(),x=h.api.loadCurrentGroup(),r=h.rows();r[0].name='newer';h.map.set('phone_groups',JSON.stringify(r));assert.equal(h.api.applyLegacyGroup(x,'rename','old edit').ok,false);assert.equal(h.state.writes,0);}
  {const h=harness(),x=h.api.loadCurrentGroup();h.map.set('phone_groups',JSON.stringify(h.rows().slice(1)));x.name='bad';assert.equal(h.api.saveCurrentGroup(x),false);assert.equal(h.rows().length,1);assert.equal(h.state.writes,0);}
  {const h=harness(),x=h.api.loadCurrentGroup();h.state.id=B;assert.equal(h.api.applyLegacyGroup(x,'rename','new').ok,false);assert.equal(h.state.writes,0);}
  {const h=harness(),r=h.rows();r[0].members.push({id:'r1'});h.map.set('phone_groups',JSON.stringify(r));assert.equal(h.api.loadCurrentGroup(),null);}
  {const h=harness(),r=h.rows();r[0].members=[{id:'r1'}];h.map.set('phone_groups',JSON.stringify(r));assert.equal(h.api.applyLegacyGroup(h.api.loadCurrentGroup(),'remove','r1').ok,false);assert.equal(h.state.writes,0);}
  {const h=harness(),r=h.rows();r[0].ownerId='r1';h.map.set('phone_groups',JSON.stringify(r));assert.equal(h.api.applyLegacyGroup(h.api.loadCurrentGroup(),'rename','new').ok,false);assert.equal(h.state.writes,0);}
  {const h=harness(),x=h.api.loadCurrentGroup();h.state.fail=true;assert.equal(h.api.applyLegacyGroup(x,'rename','new').ok,false);assert.equal(x.name,'old');assert.equal(h.rows()[0].name,'old');}
  {const h=harness(),x=h.api.loadCurrentGroup(),snap=h.w.MAOGroupWriteGuard.readPreference(h.api.legacySnapshots.get(x),'alias');h.map.set('chat_group_alias_g1','new');assert.equal(h.api.saveLegacyPreference(snap,'old',false),false);assert.equal(h.map.get('chat_group_alias_g1'),'new');assert.equal(h.state.writes,0);}
  {const h=harness(),r=h.rows();r[0].ownerId='r1';h.map.set('phone_groups',JSON.stringify(r));const x=h.api.loadCurrentGroup(),snap=h.w.MAOGroupWriteGuard.readPreference(h.api.legacySnapshots.get(x),'notice');assert.equal(h.api.saveLegacyPreference(snap,'new',true),false);assert.equal(h.state.writes,0);}
  const dismiss=html.slice(html.indexOf("    document.getElementById('actionGpDismiss').addEventListener"),html.indexOf('    var gpAdvancedEntry'));
  assert.ok(dismiss.indexOf('!legacyGuard.remove(snap).ok')>=0&&dismiss.indexOf('!legacyGuard.remove(snap).ok')<dismiss.indexOf('clearConversationMemory'));
  assert.ok(dismiss.includes('storedRole'));
  assert.ok(html.includes('if (requestedGroup && (!isGroupSetting || !explicitGroupOptions))'));
  assert.ok(html.includes('var g=captured;'));
});


test('group-only portraits use exact account/group/member ownership and never alter global avatar data',async()=>{
  const A='MAO-AAAAAAAAAAAA',AS='as_'+'A'.repeat(32),image='data:image/png;base64,AAAA';
  class FakeBlob{constructor(){this.type='image/png';this.size=3;}}
  function setup(){
    const state={account:A,ready:true,active:true,writes:0,puts:0};
    const map=new Map([['phone_groups',JSON.stringify([{id:'g1',ownerId:'__user',members:[{id:'r1',avatar:'original'},{id:'r2'}]},{id:'g2',members:[{id:'r1',avatar:'other'}]}])],['ai_custom_characters','[{"id":"r1","avatar":"role"}]']]),owners=new Map(),blobs=new Map();
    const w={document:{querySelector:q=>({content:q.includes('role')?'member':state.account})},location:{hostname:'preview.mao520.com'},get __MAO_ACCOUNT_SCOPE__(){return {accountId:state.account,role:'member',ready:state.ready};},localStorage:{getItem:k=>map.get(k)??null,setItem(k,v){state.writes++;map.set(k,v);}},PhoneStorage:{MediaRepository:class{
      async putBlob(blob,opts){state.puts++;blobs.set(AS,blob);owners.set(opts.ownerId,AS);state.onPut?.();return {ok:true,value:{assetId:AS}};}
      async getBlob(id){return {ok:true,value:blobs.get(id)};}
      async listByOwner(type,id){return {ok:true,value:owners.has(id)?[{assetId:owners.get(id)}]:[]};}
      async toDataUrl(){return {ok:true,value:image};}
    }}};
    new Function('window',load('shared/js/phone/group-write-guard.js'))(w);
    new Function('window',load('shared/js/group-governance.js'))(w);
    new Function('window','Blob',load('shared/js/phone/group-portraits.js'))(w,FakeBlob);
    return {state,map,owners,blobs,p:w.MAOGroupPortraits,g:w.MAOGroupWriteGuard,gov:w.GroupGovernance,group:id=>w.MAOGroupWriteGuard.read(id).group};
  }
  {const h=setup(),role=h.map.get('ai_custom_characters');assert.equal(await h.p.save(h.p.snapshot('g1'),new Map([['r1',new FakeBlob()]])),true);assert.equal(h.group('g1').members[0].avatar,'original');assert.equal(h.group('g2').members[0].avatar,'other');assert.equal(h.map.get('ai_custom_characters'),role);assert.equal(h.owners.get(JSON.stringify([A,'g1','r1'])),AS);assert.equal(await h.p.resolve(h.group('g1'),'r1'),image);assert.equal(await h.p.resolve(h.group('g2'),'r1'),'');assert.equal(await h.p.save(h.p.snapshot('g1'),new Map([['r1',null]])),true);assert.equal(h.group('g1').portraitOverridesV1.entries.length,0);}
  {const h=setup();const snap=h.p.snapshot('g1');h.state.onPut=()=>h.state.active=false;await assert.rejects(h.p.save(snap,new Map([['r1',new FakeBlob()]]),()=>h.state.active));assert.equal(h.state.writes,0);}
  {const h=setup();await assert.rejects(h.p.save(h.p.snapshot('g1'),new Map([['r1',new FakeBlob()],['missing',new FakeBlob()]])));assert.equal(h.state.puts,0);}
  {const h=setup();await h.p.save(h.p.snapshot('g1'),new Map([['r1',new FakeBlob()],['r2',new FakeBlob()]]));const snap=h.g.read('g1');assert.equal(h.gov.apply({group:snap.group,actorId:'__user',action:'remove',target:'r1',save:()=>h.g.commit(snap,snap.group).ok}).ok,true);assert.equal(h.group('g1').portraitOverridesV1.entries.length,1);assert.equal(h.group('g1').portraitOverridesV1.entries[0].memberId,'r2');assert.equal(h.blobs.has(AS),true);}
  {const h=setup(),snap=h.g.read('g1');h.g.commit(snap,{...snap.group,ownerId:'r1'});await assert.rejects(h.p.save(h.p.snapshot('g1'),new Map([['r2',new FakeBlob()]])));assert.equal(h.state.puts,0);assert.equal(await h.p.save(h.p.snapshot('g1'),new Map([['__user',new FakeBlob()]])),true);}
  const home=load('shared/js/group-settings-home.js'),detail=load('chat/chat/chat-detail.html');
  assert.ok(home.includes("portraits.save(snapshot,new Map([[id,blob]]),valid)"));
  assert.ok(home.includes("canvas.toBlob("));
  assert.ok(detail.includes("fillGroupPortrait(extraAv,"));
  assert.ok(detail.includes("fillGroupPortrait(avatar,getMyAvatar(),'__user')"));
});
test('group portrait backups reject missing bytes, metadata, owner refs and account mismatch before restore',()=>{
  const b=load('settings/js/backup.js'),A='MAO-AAAAAAAAAAAA',B='MAO-BBBBBBBBBBBB',AS='as_'+'A'.repeat(32);
  const a=b.indexOf('    function musicBackupBlobEncoded'),z=b.indexOf('    function backupMissingMusicImages',a),c=b.indexOf('    function backupMissingGroupPortraits'),d=b.indexOf('    function groupPortraitBackupAccount',c);
  assert.ok(a>=0&&z>a&&c>=0&&d>c);
  const verify=new Function(b.slice(a,z)+b.slice(c,d)+';return backupMissingGroupPortraits;')();
  function archive(){return {data:{phone_groups:JSON.stringify([{id:'g1',members:[{id:'r1'}],portraitOverridesV1:{accountId:A,entries:[{memberId:'r1',assetId:AS}]}}])},indexedDB:{'maomao-assets':{blobs:[{assetId:AS,blob:'AAAA'}],assets:[{assetId:AS,mimeType:'image/png'}],refs:[{assetId:AS,refs:[{ownerType:'group-portrait',ownerId:JSON.stringify([A,'g1','r1'])}]}]}}};}
  assert.equal(verify(archive(),A),false);
  assert.equal(verify(archive(),B),true);
  assert.equal(verify({data:{phone_groups:'[{"id":"g1"}]'}},A),false);
  for(const key of ['blobs','assets','refs']){const x=archive();x.indexedDB['maomao-assets'][key]=[];assert.equal(verify(x,A),true,key);}
  {const x=archive();x.indexedDB['maomao-assets'].refs[0].refs[0].ownerId=JSON.stringify([A,'g2','r1']);assert.equal(verify(x,A),true);}
  {const x=archive();x.indexedDB['maomao-assets'].blobs[0].blob='??';assert.equal(verify(x,A),true);}
  {const x=archive();x.indexedDB['maomao-assets'].blobs.push(x.indexedDB['maomao-assets'].blobs[0]);assert.equal(verify(x,A),true);}
  assert.ok(b.includes('&& !missingGroupPortraits'));
  assert.ok(b.includes("if(backupMissingGroupPortraits(obj,groupPortraitBackupAccount()))"));
});


test('group turns fence requests, writes, followups and deferred actions against current identity',()=>{
  const html=load('chat/chat/chat-detail.html'),w={};
  for(const [,code] of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))if(code.trim())new vm.Script(code);
  new Function('window',load('shared/js/phone/group-turn-effects.js'))(w);
  new Function('window',load('shared/js/phone/group-private-receipt-recovery.js'))(w);
  {let n=0;const f=w.GroupTurnEffects.create(()=>true);f.afterSave(()=>{n++;return true;});assert.equal(f.finalize(false).saved,false);assert.equal(n,0);}
  {let n=0;const f=w.GroupTurnEffects.create(()=>false);f.afterSave(()=>{n++;return true;});assert.equal(f.finalize(true).postCommitFailures,1);assert.equal(n,0);}
  {let active=true,n=0;const f=w.GroupTurnEffects.create(()=>active);f.afterSave(()=>{active=false;n++;return true;});f.afterSave(()=>{n++;return true;});const result=f.finalize(true);assert.equal(result.committed,1);assert.equal(result.postCommitFailures,1);assert.equal(n,1);}
  {let n=0;const f=w.GroupTurnEffects.create();f.afterSave(()=>{n++;return true;});assert.equal(f.finalize(true).ok,true);assert.equal(n,1);assert.equal(f.finalize(true).ok,false);}
  for(const group of [{id:'g1',members:[{id:'r1'},{id:'r1'}]},{id:'g1',members:[{id:'__user'}]},{id:'g1',members:[{id:'g1'}]},{id:'g1',userMembership:'declined',members:[{id:'r1'}]}]){
    let n=0;const result=w.GroupPrivateReceiptRecovery.reconcile({group,readGroupHistory(){n++;return [];},readRoleHistory(){n++;return [];},saveGroupHistory(){n++;return true;}});
    assert.equal(result.ok,false);assert.equal(n,0);
  }
  {let history=[];const result=w.GroupPrivateReceiptRecovery.reconcile({group:{id:'g1',members:[{id:'r1'}]},readGroupHistory:()=>history,readRoleHistory:()=>[{role:'assistant',mid:'m1',text:'secret',time:1,privateFromGroup:true,privateGroupReceiptV1:true,fromGroupId:'g1'}],saveGroupHistory:m=>{history=m;return true;}});assert.equal(result.ok,true);assert.equal(result.repaired,1);assert.equal(history[0].text,'');}
  assert.ok(html.includes('if(!groupTurnCurrent()){discardStaleGroupTurn();return;}\n            const chatResponseTimeoutMs'));
  assert.ok(html.includes('groupInterruptedSave=null;\n            if(!groupTurnCurrent()){discardStaleGroupTurn();return;}\n            fullText'));
  assert.ok(html.includes('var replySaved = isGroupChat ? await saveGroupReplyLocked(historyList,groupTurnCurrent) : saveMessages(historyList)'));
  assert.ok(html.includes('if(aiSending&&save)void save();'));
  assert.ok(html.includes('singleChatSendPending||!groupGuard.matches(followupScope)'));
  assert.ok(html.includes('targetId!==speakerId||!currentGroupSpeaker(targetId)'));
  assert.ok(html.includes('queueGameReveal, contextOnly)'));
  assert.ok(html.includes('if((groupPageExited&&allowExit!==true)||!isGroupChat||!groupGuard'));
});


test('group integration pages and precache use one canonical script revision',()=>{
  const sw=load('sw.js');
  const pages=['chat/chat/chat.html','chat/chat/chat-detail.html','chat/chat/chat-settings.html','chat/chat/group-play.html'];
  const expected={"group-governance.js":"20261125scope3","group-memory-events.js":"20261125public1","chat-context-policy.js":"20261125public1","chat-history-atomic.js":"20261125scope1","wallpaper-store.js":"20261125group2","group-turn-effects.js":"20261125scope1","group-private-receipt-recovery.js":"20261125scope1","group-settings-home.js":"20261125scope4","group-write-guard.js":"20261125g10","group-portraits.js":"20261125scope1"};
  for(const [name,rev] of Object.entries(expected)){
    assert.ok(sw.includes(name+'?v='+rev),name+' precache');
    for(const page of pages){const html=load(page);for(const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)){if(match[1].includes('/'+name+'?v='))assert.ok(match[1].endsWith(name+'?v='+rev),page+' '+name);}}
  }
});


test('group creation and member invitation recheck exact selected role identity',()=>{
  const chat=load('chat/chat/chat.html'),home=load('shared/js/group-settings-home.js'),guard=load('shared/js/phone/group-write-guard.js');
  const adapter=chat.slice(chat.indexOf('      function creationRoles('),chat.indexOf('      function renderMembers()',chat.indexOf('      function creationRoles(')));
  const inviteAdapter=home.slice(home.indexOf('    function inviteCandidates('),home.indexOf('    function selectMembers(',home.indexOf('    function inviteCandidates(')));
  const A='MAO-AAAAAAAAAAAA',B='MAO-BBBBBBBBBBBB';
  function setup(){
    const state={id:A,ready:true,writes:0,quota:false},roles=[{id:'r1',name:'甲',avatar:'a'},{id:'r2',name:'乙',avatar:'b'}];
    const map=new Map([['ai_custom_characters',JSON.stringify(roles)],['phone_groups',JSON.stringify([{id:'g1',name:'old',members:[{id:'r1'}]}])]]);
    const w={document:{querySelector:q=>({content:q.includes('role')?'member':state.id})},location:{hostname:'preview.mao520.com'},get __MAO_ACCOUNT_SCOPE__(){return {accountId:state.id,role:'member',ready:state.ready}},localStorage:{getItem:k=>map.get(k)??null,setItem(k,v){state.writes++;if(state.quota)throw Error('quota');map.set(k,v)}}};
    new Function('window',guard)(w);
    const api=new Function('window','localStorage',adapter+';return {creationRoles,uniqueCreationRoles,createSelectedGroup};')(w,w.localStorage);
    const invites=new Function(inviteAdapter+';return {inviteCandidates,currentInvitationRole};')();
    return {state,roles,map,api,invites,create(ids=['r1'],shown=roles){return api.createSelectedGroup(A,shown,ids,'群聊',99)},rows:()=>JSON.parse(map.get('phone_groups'))};
  }
  {const h=setup();assert.equal(h.create(['r1','r2']).ok,true);assert.equal(h.rows()[0].name,'old');assert.equal(h.rows()[1].members.length,2);}
  for(const change of [h=>{h.state.id=B},h=>{h.state.ready=false},h=>h.map.set('ai_custom_characters','[]'),h=>h.map.set('ai_custom_characters','{bad'),h=>h.map.set('ai_custom_characters',JSON.stringify([{id:'r1',name:'edited'}])),h=>h.map.set('ai_custom_characters',JSON.stringify([...h.roles,{id:'r1'}])),h=>h.map.set('ai_custom_characters',JSON.stringify([...h.roles,{id:'g99'}])),h=>h.map.set('phone_groups','{bad'),h=>h.map.set('phone_groups','[{"id":"g99"}]')]){
    const h=setup();change(h);assert.equal(h.create().ok,false);assert.equal(h.state.writes,0);
  }
  {const h=setup();assert.equal(h.create(['r1','r1']).ok,false);assert.equal(h.state.writes,0);}
  {const h=setup(),rows=[{id:'__user',name:'user'}];h.map.set('ai_custom_characters',JSON.stringify(rows));assert.equal(h.create(['__user'],rows).ok,false);assert.equal(h.state.writes,0);}
  {const h=setup();h.state.quota=true;assert.equal(h.create().ok,false);assert.equal(h.rows().length,1);}
  {const h=setup();h.map.set('ai_custom_characters',JSON.stringify([h.roles[0],{id:'r2',name:'edited'}]));assert.equal(h.create().ok,true);}
  {const h=setup(),g={id:'g1',members:[{id:'r1'}]};assert.deepEqual(h.invites.inviteCandidates([...h.roles,{id:'r2'},{id:'__user'},{id:'g1'},{id:'r3'}],g).map(x=>x.id),['r3']);const current={group:g};assert.equal(h.invites.currentInvitationRole('r2',current,h.roles,[]),null);assert.equal(h.invites.currentInvitationRole('r2',current,h.roles,[{id:'r2',name:'edited'}]),null);assert.equal(h.invites.currentInvitationRole('r2',current,h.roles,h.roles).id,'r2');}
  assert.ok(chat.includes('group-write-guard.js?v=20261125g10'));
  assert.ok(home.includes('currentInvitationRole(String(id),current,selectedAction,pool)'));
});

test('invitation compensation preserves concurrent group edit',()=>{
  const g=group(); g.userMembership='left'; const h=harness([g,{id:'g2',name:'old'}]);
  const o=h.api.offerInvitation({groupId:'g1',inviterId:'c1'});
  const set=h.storage.setItem.bind(h.storage);let emitted=0;h.api.on('invitation:resolved',()=>emitted++);
  h.storage.setItem=(key,value)=>{if(key==='phone_group_invitations'){const a=JSON.parse(h.storage.getItem('phone_groups'));a[1].name='new';set('phone_groups',JSON.stringify(a));throw Error('quota');}set(key,value);};
  assert.equal(h.api.resolveInvitation({id:o.invitation.id,accept:true}).ok,false);
  assert.equal(JSON.parse(h.storage.getItem('phone_groups'))[1].name,'new');assert.equal(emitted,0);
});
test('invitation resolution refuses duplicate ids and stale account UI',()=>{
  const g=group();g.userMembership='left';const h=harness([g]);const o=h.api.offerInvitation({groupId:'g1',inviterId:'c1'});
  const before=h.storage.getItem('phone_groups');
  assert.equal(h.api.resolveInvitation({id:o.invitation.id,accept:true,expectedAccount:'other'}).code,'SCOPE_CHANGED');
  const a=JSON.parse(h.storage.getItem('phone_group_invitations'));a.push({...a[0]});h.storage.setItem('phone_group_invitations',JSON.stringify(a));
  assert.equal(h.api.resolveInvitation({id:o.invitation.id,accept:true}).ok,false);assert.equal(h.storage.getItem('phone_groups'),before);
});
test('invitation compensation restores unchanged group after dropped receipt',()=>{
  const g=group();g.userMembership='left';const h=harness([g]);const o=h.api.offerInvitation({groupId:'g1',inviterId:'c1'});
  const before=h.storage.getItem('phone_groups'),set=h.storage.setItem.bind(h.storage);
  h.storage.setItem=(key,value)=>{if(key!=='phone_group_invitations')set(key,value);};
  assert.equal(h.api.resolveInvitation({id:o.invitation.id,accept:true}).ok,false);assert.equal(h.storage.getItem('phone_groups'),before);
});
test('invitation acceptance refuses duplicate role ids and orphan history',()=>{
  const h=harness();const o=h.api.offerNewGroupInvitation({inviterId:'c1',groupName:'测试群',memberIds:['c2']});
  const before=h.storage.getItem('phone_groups');h.storage.setItem('ai_custom_characters',JSON.stringify([...roles,roles[0]]));
  assert.equal(h.api.resolveInvitation({id:o.invitation.id,accept:true}).ok,false);h.storage.setItem('ai_custom_characters',JSON.stringify(roles));
  h.storage.setItem('chat_history_'+o.invitation.groupId,'[]');assert.equal(h.api.resolveInvitation({id:o.invitation.id,accept:true}).ok,false);assert.equal(h.storage.getItem('phone_groups'),before);
});

test('interrupted group reply retains only validated public prose and an error in one replacement',()=>{
  const html=load('chat/chat/chat-detail.html'),start=html.indexOf('        function buildInterruptedGroupHistory('),end=html.indexOf('\n        // 页面退出时',start);
  assert.ok(start>=0&&end>start);
  const code=html.slice(start,end);
  const build=new Function('stripInternalReasoning','ensureMid',code+'\nreturn buildInterruptedGroupHistory;')(
    s=>String(s).replace(/<think\b[^>]*>[\s\S]*?(?:<\/think\s*>|$)/gi,''),m=>{m.mid='test-'+m.time;});
  const raw='[{"role":"user","mid":"u1","text":"你好"}]',meta={memberId:'r1',name:'角色',validate:()=>true};
  for(const value of ['你好[群私聊:r2:秘密]','你好[群私','你好[转账:100','你好[投票:内容]','你好<thi','<think>内部</think>你好[游戏私聊:r2:秘密]']){
    const out=build(raw,value,meta);assert.equal(out.hasText,true);assert.equal(out.history.length,3);assert.equal(out.history[0].mid,'u1');
    assert.equal(out.history[1].text,'你好');assert.equal(out.history[1].memberId,'r1');assert.equal(out.history[2].role,'system_error');
    assert.ok(!JSON.stringify(out.history).includes('秘密'));
  }
  for(const options of [{...meta,validate:()=>false},{...meta,allowText:false}]){
    const out=build(raw,'你好',options);assert.equal(out.hasText,false);assert.equal(out.history.length,2);assert.equal(out.history[1].role,'system_error');
  }
  assert.equal(build(raw,'你好',{...meta,memberId:'__user'}),null);
  assert.equal(build('{bad','你好',meta),null);
  assert.ok(html.indexOf('if(isGroupChat&&!streamResult.ok){')<html.indexOf('var groupTurnEffects = window.GroupTurnEffects'));
  assert.ok(html.includes('return groupTurnCurrent(allowExit===true||result.hasText===true);'));
  assert.ok(html.includes('if(!result||(allowExit===true&&!result.hasText))return false;'));
  assert.ok(html.includes('if(isRegen){restoreFailedRegeneration();return;}'));
});
