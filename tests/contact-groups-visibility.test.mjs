import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../shared/js/contact-groups.js', import.meta.url), 'utf8');
const identitySource = readFileSync(new URL('../shared/js/phone/contact-identity.js', import.meta.url), 'utf8');
const notifierSource = readFileSync(new URL('../shared/js/chat-notifier.js', import.meta.url), 'utf8');
const detailPage = readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const navPage = readFileSync(new URL('../shared/js/nav.js', import.meta.url), 'utf8');
const contactsPage = readFileSync(new URL('../chat/contacts/contacts.html', import.meta.url), 'utf8');
const composerPage = readFileSync(new URL('../forum/post-create.html', import.meta.url), 'utf8');
const momentsPage = readFileSync(new URL('../chat/moments/moments.html', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const packageJson = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const backup = readFileSync(new URL('../settings/js/backup.js', import.meta.url), 'utf8');
const browserTest = readFileSync(new URL('./contact-groups-browser.mjs', import.meta.url), 'utf8');

function createRuntime(initialValue, options = {}) {
  const data = new Map();
  if (initialValue !== undefined) data.set('contact_groups_v1', initialValue);
  const localStorage = {
    getItem(key) {
      if (options.failReads) throw new Error('storage unavailable');
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (options.failWrites) {
        const error = new Error('storage unavailable');
        error.name = options.failWrites === 'quota' ? 'QuotaExceededError' : 'SecurityError';
        throw error;
      }
      data.set(key, String(value));
    }
  };
  const window = { localStorage };
  vm.runInNewContext(identitySource, { window, localStorage, JSON, Array, Object, String, Date, Math, encodeURIComponent, decodeURIComponent });
  vm.runInNewContext(source, { window, localStorage, JSON, Array, Object, String, Date, Math, encodeURIComponent, decodeURIComponent });
  return { api: window.PhoneContactGroups, identity: window.PhoneContactIdentity, data };
}

test('contact identity keys separate AI roles, real accounts, and group conversations with the same ID', () => {
  const { identity } = createRuntime();
  const role = identity.fromRole({ id: 'same-id' });
  const user = identity.fromUser({ id: 'same-id' });
  const group = identity.fromGroup({ id: 'same-id' });
  assert.equal(role.key, 'ai_role:same-id');
  assert.equal(user.key, 'real_user:same-id');
  assert.equal(group.key, 'chat_group:same-id');
  assert.equal(new Set([role.key, user.key, group.key]).size, 3);
  assert.equal(identity.parseKey(user.key).type, 'real_user');
  assert.equal(identity.toLegacyConversationId(role), 'same-id');
  assert.equal(identity.toLegacyConversationId(group), 'same-id');
  assert.equal(identity.toLegacyConversationId(user), 'real_user:same-id');
  assert.equal(identity.equals(role, user), false);
});

test('contact identity parser round-trips encoded IDs and rejects malformed keys', () => {
  const { identity } = createRuntime();
  const ref = identity.fromUser({ id: 'user/a:b 1' });
  assert.equal(identity.parseKey(ref.key).id, 'user/a:b 1');
  assert.equal(identity.parseKey('unknown:value'), null);
  assert.equal(identity.parseKey('real_user:%E0%A4%A'), null);
});

test('typed group members preserve non-role contacts while keeping legacy role IDs', () => {
  const { api } = createRuntime();
  const saved = api.saveGroups([{
    id: 'family',
    name: '家人',
    memberIds: ['same-id', 'role-b'],
    memberRefs: ['real_user:same-id', 'ai_role:same-id']
  }]);
  assert.equal(saved.ok, true);
  const group = api.getGroups()[0];
  assert.deepEqual(JSON.parse(JSON.stringify(group.memberIds)), ['same-id', 'role-b']);
  assert.deepEqual(JSON.parse(JSON.stringify(group.memberRefs)), ['real_user:same-id', 'ai_role:same-id', 'ai_role:role-b']);
  assert.deepEqual(JSON.parse(JSON.stringify(api.getGroupIdsForContactRef('real_user:same-id'))), ['family']);
  assert.deepEqual(JSON.parse(JSON.stringify(api.getGroupIdsForContact('same-id'))), ['family']);
});

test('typed audience snapshots keep same-ID role and real account membership separate', () => {
  const { api } = createRuntime();
  api.saveGroups([{
    id: 'mixed',
    name: '混合联系人',
    memberIds: ['same-id'],
    memberRefs: ['real_user:same-id', 'ai_role:same-id']
  }]);
  const snapshot = api.buildAudienceSnapshot(['mixed'], [], {
    availableContactIds: ['same-id']
  });
  assert.equal(snapshot.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.memberIds)), ['same-id']);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.memberRefs)), ['real_user:same-id', 'ai_role:same-id']);
  assert.equal(snapshot.memberCount, 2);
});

test('typed contact roster rejects deleted direct users and omits deleted user refs left in groups', () => {
  const { api } = createRuntime();
  api.saveGroups([{
    id: 'mixed',
    name: '混合联系人',
    memberIds: ['role-a'],
    memberRefs: ['ai_role:role-a', 'real_user:user-deleted']
  }]);

  const missingDirect = api.buildAudienceSnapshot([], [], {
    selectedContactRefs: ['real_user:user-deleted'],
    availableContactIds: ['role-a'],
    availableContactRefs: ['ai_role:role-a', 'real_user:user-live']
  });
  assert.equal(missingDirect.ok, false);
  assert.equal(missingDirect.error, 'missing_contacts');
  assert.deepEqual(JSON.parse(JSON.stringify(missingDirect.missingContactRefs)), ['real_user:user-deleted']);

  const groupSnapshot = api.buildAudienceSnapshot(['mixed'], [], {
    availableContactIds: ['role-a'],
    availableContactRefs: ['ai_role:role-a', 'real_user:user-live']
  });
  assert.equal(groupSnapshot.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(groupSnapshot.memberIds)), ['role-a']);
  assert.deepEqual(JSON.parse(JSON.stringify(groupSnapshot.memberRefs)), ['ai_role:role-a']);
  assert.deepEqual(JSON.parse(JSON.stringify(groupSnapshot.staleMemberRefs)), ['real_user:user-deleted']);
  assert.equal(groupSnapshot.memberCount, 1);
});

test('typed Moments privacy never matches a real account to a role with the same raw ID', () => {
  const { api, identity } = createRuntime();
  const role = identity.fromRole({ id: 'same-id' });
  const user = identity.fromUser({ id: 'same-id' });
  const selected = {
    authorId: 'owner',
    visibility: 'custom',
    visibleTo: ['same-id'],
    visibleContactRefs: ['ai_role:same-id']
  };
  const excluded = {
    authorId: 'owner',
    visibility: 'excluded',
    hiddenTo: ['same-id'],
    hiddenContactRefs: ['ai_role:same-id']
  };
  assert.equal(api.canContactReceivePost(selected, role, { id: 'owner' }), true);
  assert.equal(api.canContactReceivePost(selected, user, { id: 'owner' }), false);
  assert.equal(api.canContactReceivePost(excluded, role, { id: 'owner' }), false);
  assert.equal(api.canContactReceivePost(excluded, user, { id: 'owner' }), true);
  assert.equal(api.canRoleReceivePost({ authorId: 'owner', visibility: 'custom', visibleTo: ['same-id'] }, 'same-id', { id: 'owner' }), true);
  assert.equal(api.canContactReceivePost({ authorId: 'role-author', visibility: 'private' }, user, { id: 'owner' }), true);
});

test('typed contact identity is loaded before chat notification and stored in chat relationship snapshots', () => {
  assert.ok(contactsPage.includes('phone/contact-identity.js?v=20261107v1'));
  assert.ok(composerPage.includes('phone/contact-identity.js?v=20261107v1'));
  assert.ok(momentsPage.includes('phone/contact-identity.js?v=20261107v1'));
  assert.ok(detailPage.includes('phone/contact-identity.js?v=20261107v1'));
  assert.ok(detailPage.includes('window.PhoneCurrentContactRef'));
  assert.ok(contactsPage.includes('data-contact-key'));
  assert.ok(navPage.includes('contact-identity.js?v=20261107v1'));
  assert.ok(notifierSource.includes("contactRef: contactIdentity('ai_role', roleId)"));
  assert.ok(notifierSource.includes("contactRef: contactIdentity('chat_group', groupId)"));
  assert.ok(notifierSource.includes('ChatNotifier.getContactIdentity'));
  assert.ok(composerPage.includes('visibleContactRefs: visibleAudience.memberRefs'));
  assert.ok(composerPage.includes('hiddenContactRefs: hiddenAudience.memberRefs'));
  assert.ok(composerPage.includes('audienceVersion: 2'));
});

test('contact groups normalize IDs and permit one contact to belong to multiple groups', () => {
  const { api } = createRuntime();
  const result = api.saveGroups([
    { id: 'family', name: '  家人  ', memberIds: ['a', 'b', 'a', null] },
    { id: 'friends', name: '朋友', memberIds: ['a', 'c'] },
    { id: 'family', name: '重复 ID', memberIds: ['x'] },
    { id: '', name: '无效分组', memberIds: ['z'] }
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(api.getGroups())), [
    { id: 'family', name: '家人', memberIds: ['a', 'b'], memberRefs: ['ai_role:a', 'ai_role:b'] },
    { id: 'friends', name: '朋友', memberIds: ['a', 'c'], memberRefs: ['ai_role:a', 'ai_role:c'] }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(api.getGroupIdsForContact('a'))), ['family', 'friends']);
});

test('audience snapshots merge selected groups and individual contacts without duplicates', () => {
  const { api } = createRuntime();
  api.saveGroups([
    { id: 'family', name: '家人', memberIds: ['a', 'b'] },
    { id: 'work', name: '同事', memberIds: ['b', 'c'] }
  ]);
  const snapshot = api.buildAudienceSnapshot(['family', 'work'], ['c', 'd', 'a']);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), {
    ok: true,
    groupIds: ['family', 'work'],
    contactIds: ['c', 'd', 'a'],
    memberIds: ['c', 'd', 'a', 'b'],
    memberRefs: ['ai_role:c', 'ai_role:d', 'ai_role:a', 'ai_role:b'],
    memberCount: 4,
    staleMemberIds: [],
    staleMemberRefs: []
  });
  const stale = api.buildAudienceSnapshot(['family', 'missing'], ['c', 'd', 'a']);
  assert.equal(stale.ok, false);
  assert.equal(stale.error, 'missing_groups');
  assert.deepEqual(JSON.parse(JSON.stringify(stale.missingGroupIds)), ['missing']);
});

test('audience snapshots validate live contacts and omit stale members left inside groups', () => {
  const { api } = createRuntime();
  api.saveGroups([{ id: 'family', name: '家人', memberIds: ['a', 'b', 'deleted-role'] }]);

  const mixed = api.buildAudienceSnapshot(['family'], ['c'], {
    availableContactIds: ['a', 'b', 'c', 'd']
  });
  assert.equal(mixed.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(mixed.memberIds)), ['c', 'a', 'b']);
  assert.deepEqual(JSON.parse(JSON.stringify(mixed.staleMemberIds)), ['deleted-role']);

  const staleDirect = api.buildAudienceSnapshot([], ['deleted-role'], {
    availableContactIds: ['a', 'b', 'c', 'd']
  });
  assert.equal(staleDirect.ok, false);
  assert.equal(staleDirect.error, 'missing_contacts');
  assert.deepEqual(JSON.parse(JSON.stringify(staleDirect.missingContactIds)), ['deleted-role']);
});

test('selected groups fail closed when storage is corrupt, unavailable, or the group was deleted', () => {
  const corrupt = createRuntime('{broken');
  const blockedCorrupt = corrupt.api.buildAudienceSnapshot(['family'], ['a']);
  assert.equal(blockedCorrupt.ok, false);
  assert.equal(blockedCorrupt.error, 'corrupt_data');
  assert.deepEqual(JSON.parse(JSON.stringify(blockedCorrupt.memberIds)), []);

  const directOnly = corrupt.api.buildAudienceSnapshot([], ['a']);
  assert.equal(directOnly.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(directOnly.memberIds)), ['a']);

  const unavailable = createRuntime(undefined, { failReads: true });
  const blockedUnavailable = unavailable.api.buildAudienceSnapshot(['family'], ['a']);
  assert.equal(blockedUnavailable.ok, false);
  assert.equal(blockedUnavailable.error, 'storage_unavailable');

  const deleted = createRuntime();
  const selectedBeforeDelete = deleted.api.saveGroups([{ id: 'family', name: '家人', memberIds: ['a', 'b'] }]);
  assert.equal(selectedBeforeDelete.ok, true);
  deleted.api.saveGroups([]);
  const blockedDeleted = deleted.api.buildAudienceSnapshot(['family'], ['c']);
  assert.equal(blockedDeleted.ok, false);
  assert.equal(blockedDeleted.error, 'missing_groups');
  assert.deepEqual(JSON.parse(JSON.stringify(blockedDeleted.missingGroupIds)), ['family']);
});

test('a saved audience snapshot is not changed when a contact group is edited later', () => {
  const { api } = createRuntime();
  api.saveGroups([{ id: 'family', name: '家人', memberIds: ['a', 'b'] }]);
  const post = {
    visibility: 'custom',
    visibleTo: api.buildAudienceSnapshot(['family'], []).memberIds
  };
  api.saveGroups([{ id: 'family', name: '家人', memberIds: ['a', 'c'] }]);
  assert.deepEqual(JSON.parse(JSON.stringify(post.visibleTo)), ['a', 'b']);
  assert.equal(api.canViewPost(post, 'b'), true);
  assert.equal(api.canViewPost(post, 'c'), false);
});

test('deleting a group later does not rewrite the audience snapshot saved on an older post', () => {
  const { api } = createRuntime();
  api.saveGroups([{ id: 'family', name: '家人', memberIds: ['a', 'b'] }]);
  const oldPost = {
    visibility: 'excluded',
    hiddenTo: api.buildAudienceSnapshot(['family'], []).memberIds
  };
  api.saveGroups([]);
  assert.deepEqual(JSON.parse(JSON.stringify(oldPost.hiddenTo)), ['a', 'b']);
  assert.equal(api.canViewPost(oldPost, 'a'), false);
  assert.equal(api.canViewPost(oldPost, 'c'), true);
});

test('visibility policy covers public, friends, private, selected, and excluded contacts', () => {
  const { api } = createRuntime();
  assert.equal(api.canViewPost({ visibility: 'public' }, 'a'), true);
  assert.equal(api.canViewPost({ visibility: 'friends' }, 'a'), true);
  assert.equal(api.canViewPost({ visibility: 'private' }, 'a'), false);
  assert.equal(api.canViewPost({ visibility: 'custom', visibleTo: ['a'] }, 'a'), true);
  assert.equal(api.canViewPost({ visibility: 'custom', visibleTo: ['a'] }, 'b'), false);
  assert.equal(api.canViewPost({ visibility: 'excluded', hiddenTo: ['a'] }, 'a'), false);
  assert.equal(api.canViewPost({ visibility: 'excluded', hiddenTo: ['a'] }, 'b'), true);
  assert.equal(api.canViewPost({ visibility: 'legacy-custom', visibleTo: [] }, 'a'), true);
});

test('malformed group storage safely returns an empty list', () => {
  const { api } = createRuntime('{broken');
  assert.deepEqual(JSON.parse(JSON.stringify(api.getGroups())), []);
});

test('storage write failures are reported rather than treated as success', () => {
  const quota = createRuntime(undefined, { failWrites: 'quota' }).api.saveGroups([{ id: 'g', name: '朋友' }]);
  assert.equal(quota.ok, false);
  assert.equal(quota.error, 'storage_full');
  const unavailable = createRuntime(undefined, { failWrites: true }).api.saveGroups([{ id: 'g', name: '朋友' }]);
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.error, 'storage_unavailable');
});

test('Contacts page exposes group creation, editing, deletion, membership, and filtering', () => {
  assert.match(contactsPage, /id="btnNewContactGroup"/);
  assert.match(contactsPage, /id="btnSaveContactGroup"/);
  assert.match(contactsPage, /data-group-action="edit"/);
  assert.match(contactsPage, /data-group-action="delete"/);
  assert.match(contactsPage, /data-contact-member=/);
  assert.match(contactsPage, /data-contact-group=/);
  assert.match(contactsPage, /contactGroupApi\.saveGroups/);
  assert.match(contactsPage, /发现 '\s*\+ staleMemberCount/);
  assert.match(contactsPage, /保存时会从分组中清除/);
  assert.match(contactsPage, /当前联系人列表暂时无法读取/);
  assert.match(contactsPage, /Do not remove members when the current contact roster itself cannot be verified/);
});

test('Moments audience controls do not reuse @mentions as the visible-to list', () => {
  assert.match(composerPage, /selectedVisibleGroupIds/);
  assert.match(composerPage, /selectedHiddenGroupIds/);
  assert.match(composerPage, /key: 'excluded', label: '不给谁看'/);
  assert.match(composerPage, /visibleTo: visibleAudience\.memberIds/);
  assert.match(composerPage, /hiddenTo: hiddenAudience\.memberIds/);
  assert.match(composerPage, /mentions: mentionsList\.slice\(\)/);
  assert.doesNotMatch(composerPage, /post\.visibleTo\s*=\s*mentionsList/);
  assert.match(composerPage, /currentPerm === 'excluded' && !getAudienceMemberCount\(hiddenAudience\)/);
  assert.match(composerPage, /不给谁看至少选择一位联系人/);
});

test('Moments audience preview lists the resolved recipients and explains snapshot behavior', () => {
  assert.match(composerPage, /audience-review/);
  assert.match(composerPage, /本条动态可见对象/);
  assert.match(composerPage, /本条动态排除对象/);
  assert.match(composerPage, /previewNames/);
  assert.match(composerPage, /发布后会固定保存这份联系人名单/);
  assert.match(composerPage, /已失效分组 · 点击取消选择/);
  assert.match(composerPage, /!activeAudience\.ok/);
  assert.match(composerPage, /openAudienceSelection\(currentPerm\)/);
  assert.match(composerPage, /分组已发生变化，请重新确认可见范围/);
  assert.match(composerPage, /分组数据暂时无法读取/);
  assert.match(composerPage, /module_unavailable/);
  assert.match(composerPage, /联系人已不存在，请取消失效联系人后重新选择/);
  assert.match(composerPage, /已失效联系人 · 点击取消选择/);
  assert.match(composerPage, /availableContactIds/);
  assert.match(composerPage, /staleMemberIds/);
  assert.match(browserTest, /角色甲/);
  assert.match(browserTest, /角色乙/);
  assert.match(browserTest, /角色丙/);
  assert.match(browserTest, /角色丁/);
});

test('owner feed remains visible while excluded AI contacts are blocked from comment/mention requests', () => {
  assert.match(momentsPage, /朋友圈页面是当前手机主人的动态流/);
  assert.match(momentsPage, /if \(isMine\) return true/);
  assert.doesNotMatch(momentsPage, /hiddenTo\.indexOf\(String\(me\.id/);
  assert.match(momentsPage, /function canRoleViewPost\(post, roleId\)/);
  assert.match(momentsPage, /policy\.canRoleReceivePost\(post, roleId, me\)/);
  assert.match(momentsPage, /if \(!canRoleViewPost\(post, role\.id\)\) return;/);
  assert.match(momentsPage, /!canRoleViewPost\(post, id\)/);
});

test('AI audience checks apply only to user-authored posts and fail closed for restricted users', () => {
  const { api } = createRuntime();
  const profile = { id: 'owner', name: '我' };
  const customPost = { authorId: 'owner', visibility: 'custom', visibleTo: ['friend-a'] };
  const excludedPost = { authorId: 'owner', visibility: 'excluded', hiddenTo: ['friend-b'] };
  assert.equal(api.canRoleReceivePost(customPost, 'friend-a', profile), true);
  assert.equal(api.canRoleReceivePost(customPost, 'friend-b', profile), false);
  assert.equal(api.canRoleReceivePost(excludedPost, 'friend-b', profile), false);
  assert.equal(api.canRoleReceivePost(excludedPost, 'friend-a', profile), true);
  assert.equal(api.canRoleReceivePost({ authorId: 'role-author', visibility: 'private' }, 'friend-a', profile), true);
  assert.equal(api.canRoleReceivePost({ author: '我', visibility: 'private' }, 'friend-a', profile), false);
});

test('contact group metadata is covered by the existing full localStorage backup without adding secrets', () => {
  assert.ok(backup.includes('function snapshot(dropCaches, dropSecrets)'));
  assert.ok(backup.includes('keys.forEach(function (k)'));
  assert.ok(backup.includes('out[k] = localStorage.getItem(k)'));
  assert.ok(backup.includes("var EXCLUDE_KEYS = ['api_call_logs']"));
  assert.equal(backup.includes('contact_groups_v1'), false);
});

test('PWA cache contains the contact group policy module and has a new cache version', () => {
  assert.match(serviceWorker, /phone-app-pwa-v175/);
  assert.match(packageJson, /test:contact:groups/);
  assert.ok(serviceWorker.includes('./shared/js/phone/contact-identity.js?v=20261107v1'));
  assert.ok(serviceWorker.includes('./shared/js/contact-groups.js?v=20261107v2'));
});

test('saving groups never overwrites malformed data already at the new storage key', () => {
  const { api, data } = createRuntime('{broken');
  const result = api.saveGroups([{ id: 'new', name: '新分组', memberIds: ['a'] }]);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'corrupt_data');
  assert.equal(data.get('contact_groups_v1'), '{broken');
});
