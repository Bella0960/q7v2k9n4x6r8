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
  for (const filename of ['chat/chat/chat.html', 'chat/chat/chat-detail.html', 'chat/chat/group-play.html']) {
    const html = load(filename);
    assert.match(html, /group-governance\.js\?v=20261115g3/, filename);
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
  assert.match(load('sw.js'), /group-governance\.js\?v=20261115g3/);
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
