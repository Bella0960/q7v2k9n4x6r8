import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../shared/js/contact-groups.js', import.meta.url), 'utf8');
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
  vm.runInNewContext(source, { window, localStorage, JSON, Array, Object, String, Date, Math });
  return { api: window.PhoneContactGroups, data };
}

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
    { id: 'family', name: '家人', memberIds: ['a', 'b'] },
    { id: 'friends', name: '朋友', memberIds: ['a', 'c'] }
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
    memberIds: ['c', 'd', 'a', 'b']
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
});

test('Moments audience controls do not reuse @mentions as the visible-to list', () => {
  assert.match(composerPage, /selectedVisibleGroupIds/);
  assert.match(composerPage, /selectedHiddenGroupIds/);
  assert.match(composerPage, /key: 'excluded', label: '不给谁看'/);
  assert.match(composerPage, /visibleTo: visibleAudience\.memberIds/);
  assert.match(composerPage, /hiddenTo: hiddenAudience\.memberIds/);
  assert.match(composerPage, /mentions: mentionsList\.slice\(\)/);
  assert.doesNotMatch(composerPage, /post\.visibleTo\s*=\s*mentionsList/);
  assert.match(composerPage, /currentPerm === 'excluded' && !hiddenAudience\.memberIds\.length/);
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
  assert.match(serviceWorker, /phone-app-pwa-v174/);
  assert.match(packageJson, /test:contact:groups/);
  assert.match(serviceWorker, /contact-groups\.js\?v=20261107v1/);
});

test('saving groups never overwrites malformed data already at the new storage key', () => {
  const { api, data } = createRuntime('{broken');
  const result = api.saveGroups([{ id: 'new', name: '新分组', memberIds: ['a'] }]);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'corrupt_data');
  assert.equal(data.get('contact_groups_v1'), '{broken');
});
