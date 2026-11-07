import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../shared/js/contact-groups.js', import.meta.url), 'utf8');
const contactsPage = readFileSync(new URL('../chat/contacts/contacts.html', import.meta.url), 'utf8');
const composerPage = readFileSync(new URL('../forum/post-create.html', import.meta.url), 'utf8');
const momentsPage = readFileSync(new URL('../chat/moments/moments.html', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function createRuntime(initialValue, options = {}) {
  const data = new Map();
  if (initialValue !== undefined) data.set('contact_groups_v1', initialValue);
  const localStorage = {
    getItem(key) {
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
  const snapshot = api.buildAudienceSnapshot(['family', 'work', 'missing'], ['c', 'd', 'a']);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), {
    groupIds: ['family', 'work'],
    contactIds: ['c', 'd', 'a'],
    memberIds: ['c', 'd', 'a', 'b']
  });
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
});

test('excluded contacts are filtered from the feed and blocked from AI comment/mention requests', () => {
  assert.match(momentsPage, /if \(v === 'excluded'\)/);
  assert.match(momentsPage, /function canRoleViewPost\(post, roleId\)/);
  assert.match(momentsPage, /if \(!canRoleViewPost\(post, role\.id\)\) return;/);
  assert.match(momentsPage, /!canRoleViewPost\(post, id\)/);
});

test('PWA cache contains the contact group policy module and has a new cache version', () => {
  assert.match(serviceWorker, /phone-app-pwa-v174/);
  assert.match(serviceWorker, /contact-groups\.js\?v=20261107v1/);
});

test('saving groups never overwrites malformed data already at the new storage key', () => {
  const { api, data } = createRuntime('{broken');
  const result = api.saveGroups([{ id: 'new', name: '新分组', memberIds: ['a'] }]);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'corrupt_data');
  assert.equal(data.get('contact_groups_v1'), '{broken');
});
