import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(path.join(process.cwd(), 'shared/js/phone/role-avatar-library.js'), 'utf8');

function createLibrary(seed, options = {}) {
  const values = new Map(Object.entries(seed || {}));
  const assets = new Map();
  const refs = new Set();
  let sequence = 0;
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (options.failWrites) throw new Error('storage quota');
      values.set(key, String(value));
    },
    removeItem(key) {
      if (options.failWrites) throw new Error('storage quota');
      values.delete(key);
    }
  };
  class MediaRepository {
    putBlob(input, opts) {
      if (options.failMedia) return Promise.resolve({ ok: false, error: { code: 'DB_UNAVAILABLE', message: 'offline' } });
      sequence += 1;
      const suffix = sequence.toString(2).replace(/0/g, 'A').replace(/1/g, 'B');
      const assetId = 'as_' + suffix.padStart(32, 'A');
      assets.set(assetId, input);
      refs.add(assetId + '|' + opts.ownerType + '|' + opts.ownerId);
      return Promise.resolve({ ok: true, value: { assetId, reused: false } });
    }
    removeRef(assetId, ownerType, ownerId) {
      if (options.failRemoveRefFor === assetId) {
        return Promise.resolve({ ok: false, error: { code: 'DB_UNAVAILABLE', message: 'write failed' } });
      }
      const removed = refs.delete(assetId + '|' + ownerType + '|' + ownerId);
      return Promise.resolve({ ok: true, value: { removed } });
    }
    addRef(assetId, ownerType, ownerId) {
      if (options.failAddRefFor === assetId) {
        return Promise.resolve({ ok: false, error: { code: 'DB_UNAVAILABLE', message: 'link failed' } });
      }
      refs.add(assetId + '|' + ownerType + '|' + ownerId);
      return Promise.resolve({ ok: true });
    }
    getAsset(assetId) {
      if (!assets.has(assetId)) return Promise.resolve({ ok: false, error: { code: 'NOT_FOUND' } });
      const stored = assets.get(assetId);
      const mimeType = stored && stored.type ? stored.type : 'image/jpeg';
      const blob = stored instanceof Blob ? stored : new Blob([String(stored)], { type: mimeType });
      return Promise.resolve({ ok: true, value: { asset: { mimeType }, blob } });
    }
    removeAsset(assetId) {
      const stillReferenced = Array.from(refs).some(ref => ref.startsWith(assetId + '|'));
      if (stillReferenced || options.retainAssets) {
        return Promise.resolve({ ok: false, error: { code: 'VALIDATION_FAILED' } });
      }
      assets.delete(assetId);
      return Promise.resolve({ ok: true });
    }
    toDataUrl(assetId) {
      return Promise.resolve(assets.has(assetId)
        ? { ok: true, value: 'data:image/jpeg;base64,AVATAR' }
        : { ok: false, error: { code: 'NOT_FOUND' } });
    }
    toObjectUrl(assetId) {
      return Promise.resolve(assets.has(assetId)
        ? { ok: true, value: { url: 'blob:avatar/' + assetId, revoke() {} } }
        : { ok: false, error: { code: 'NOT_FOUND' } });
    }
  }
  const window = { localStorage, PhoneStorage: { MediaRepository } };
  vm.runInNewContext(source, { window }, { filename: 'role-avatar-library.js' });
  return { api: window.RoleAvatarLibrary, values, assets, refs };
}

test('avatar libraries are isolated by character and store only asset references', async () => {
  const { api, values } = createLibrary();
  const first = await api.add('role-a', new Blob(['one'], { type: 'image/jpeg' }), { label: '日常头像' });
  const second = await api.add('role-b', new Blob(['two'], { type: 'image/jpeg' }), { label: '旅行头像' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(api.list('role-a').length, 1);
  assert.equal(api.list('role-b').length, 1);
  assert.notEqual(api.list('role-a')[0].assetId, api.list('role-b')[0].assetId);
  const saved = values.get(api._storageKey('role-a'));
  assert.equal(saved.includes('data:image'), false);
  assert.equal(saved.includes('blob:'), false);
  assert.equal(saved.includes(first.value.assetId), true);
});

test('active avatar can only point to an item in the same character library', async () => {
  const { api } = createLibrary();
  const a = await api.add('role-a', 'data:image/jpeg;base64,AAA');
  const b = await api.add('role-b', 'data:image/jpeg;base64,BBB');
  assert.equal(api.setActive('role-a', a.value.id).ok, true);
  assert.equal(api.getActive('role-a').assetId, a.value.assetId);
  assert.equal(api.getActive('role-b'), null);
  assert.equal(api.setActive('role-a', b.value.id).ok, false);
  assert.equal(api.setActive('role-a', '').ok, true);
});

test('duplicate image assets do not create duplicate library entries', async () => {
  const { api } = createLibrary();
  const a = await api.add('role-a', 'data:image/jpeg;base64,AAA');
  const duplicate = await api.add('role-a', 'data:image/jpeg;base64,AAA');
  assert.equal(a.ok, true);
  assert.equal(duplicate.ok, true);
  assert.equal(api.list('role-a').length, 1);
  assert.equal(duplicate.value.id, a.value.id);
});

test('current avatar cannot be removed before another avatar is selected', async () => {
  const { api } = createLibrary();
  const a = await api.add('role-a', 'data:image/jpeg;base64,AAA');
  assert.equal(api.setActive('role-a', a.value.id).ok, true);
  const blocked = await api.remove('role-a', a.value.id);
  assert.equal(blocked.ok, false);
  assert.equal(api.list('role-a').length, 1);
  assert.equal(api.getActive('role-a').id, a.value.id);
});

test('removing an inactive avatar releases only this character reference', async () => {
  const { api, refs, assets } = createLibrary();
  const a = await api.add('role-a', 'data:image/jpeg;base64,AAA');
  const b = await api.add('role-a', 'data:image/jpeg;base64,BBB');
  api.setActive('role-a', a.value.id);
  const removed = await api.remove('role-a', b.value.id);
  assert.equal(removed.ok, true);
  assert.equal(api.list('role-a').length, 1);
  assert.equal(refs.has(b.value.assetId + '|role-avatar|role-a'), false);
  assert.equal(assets.has(b.value.assetId), false);
});

test('shared assets remain available when another feature still references them', async () => {
  const { api, refs, assets } = createLibrary({}, { retainAssets: true });
  const a = await api.add('role-a', 'data:image/jpeg;base64,AAA');
  const b = await api.add('role-a', 'data:image/jpeg;base64,BBB');
  api.setActive('role-a', a.value.id);
  const removed = await api.remove('role-a', b.value.id);
  assert.equal(removed.ok, true);
  assert.equal(removed.meta.assetRetained, true);
  assert.equal(assets.has(b.value.assetId), true);
  assert.equal(api.list('role-a').length, 1);
});

test('invalid image inputs and unavailable media storage fail without changing the library', async () => {
  const { api } = createLibrary();
  assert.equal((await api.add('', 'data:image/jpeg;base64,AAA')).ok, false);
  assert.equal((await api.add('role-a', 'not-an-image')).ok, false);
  assert.equal(api.list('role-a').length, 0);
  const unavailable = createLibrary({}, { failMedia: true });
  assert.equal((await unavailable.api.add('role-a', 'data:image/jpeg;base64,AAA')).ok, false);
  assert.equal(unavailable.api.list('role-a').length, 0);
});

test('storage quota failure rolls back the new media reference', async () => {
  const { api, refs } = createLibrary({}, { failWrites: true });
  const result = await api.add('role-a', 'data:image/jpeg;base64,AAA');
  assert.equal(result.ok, false);
  assert.equal(refs.size, 0);
});

test('legacy state is normalized and object URLs/data URLs are resolved through MediaRepository', async () => {
  const valid = 'as_' + 'A'.repeat(32);
  const key = 'maomao_role_avatar_library_v1_role-a';
  const seed = { [key]: JSON.stringify({ activeId: 'avatar_' + 'A'.repeat(32), items: [
    { id: 'ignored', assetId: 'invalid', label: '<bad>' },
    { assetId: valid, label: '  我的头像  ', source: 'legacy', createdAt: 10 },
    { assetId: valid, label: 'duplicate', createdAt: 11 }
  ] }) };
  const { api } = createLibrary(seed);
  assert.equal(api.list('role-a').length, 1);
  assert.equal(api.getActive('role-a').label, '我的头像');
  assert.equal((await api.toDataUrl(valid)).value, 'data:image/jpeg;base64,AVATAR');
  assert.equal((await api.toObjectUrl(valid)).value.url, 'blob:avatar/' + valid);
});

test('removing a role clears its private index and releases role-owned references', async () => {
  const { api, refs, values } = createLibrary();
  const a = await api.add('role-a', 'data:image/jpeg;base64,AAA');
  const b = await api.add('role-a', 'data:image/jpeg;base64,BBB');
  const removed = await api.removeRole('role-a');
  assert.equal(removed.ok, true);
  assert.equal(removed.value.removed, 2);
  assert.equal(api.list('role-a').length, 0);
  assert.equal(refs.has(a.value.assetId + '|role-avatar|role-a'), false);
  assert.equal(refs.has(b.value.assetId + '|role-avatar|role-a'), false);
  assert.equal(values.has(api._storageKey('role-a')), false);
});


const managerSource = fs.readFileSync(
  path.join(process.cwd(), 'worldbook/characters/js/characters-manager.js'), 'utf8'
);
const characterPage = fs.readFileSync(
  path.join(process.cwd(), 'worldbook/characters/characters.html'), 'utf8'
);
const serviceWorker = fs.readFileSync(path.join(process.cwd(), 'sw.js'), 'utf8');

test('character profile loads the shared media stack before the avatar library and manager', () => {
  const storage = characterPage.indexOf('phone_storage.js');
  const repository = characterPage.indexOf('storage/repository.js');
  const media = characterPage.indexOf('storage/media-repository.js');
  const avatars = characterPage.indexOf('role-avatar-library.js?v=20261107v2');
  const manager = characterPage.indexOf('js/characters-manager.js?v=20261107v3');
  assert.ok(storage >= 0 && repository > storage && media > repository && avatars > media && manager > avatars);
  assert.ok(characterPage.includes('id="avatarLibraryFileInput"'));
  assert.ok(characterPage.includes('id="avatarLibraryGrid"') === false,
    'the gallery itself is rendered only inside the selected role profile');
});

test('role manager imports legacy avatar data only into that role library and keeps legacy consumers compatible', () => {
  assert.ok(managerSource.includes('ensureLegacyAvatarInLibrary(role)'));
  assert.ok(managerSource.includes('const synchronized = library.setActive(role.id, linked.id)'));
  assert.ok(managerSource.includes('if (token === avatarLibraryRenderToken && legacyReady)'));
  assert.ok(managerSource.includes('const previousActive = library.getActive(role.id)'));
  assert.ok(managerSource.includes("library.setActive(role.id, previousActive ? previousActive.id : '')"));
  assert.ok(managerSource.includes("source: 'legacy'"));
  assert.ok(managerSource.includes('latest.avatarAssetId = saved.value.assetId'));
  assert.ok(managerSource.includes('target.avatar = resolved.value'));
  assert.ok(managerSource.includes('target.avatarAssetId = item.assetId'));
  assert.ok(managerSource.includes('role.avatar'),
    'existing profile and list avatar rendering must continue to support the legacy field');
});

test('portrait studio can add a cropped Blob without automatically replacing the active avatar', () => {
  assert.ok(managerSource.includes("portraitPurpose === 'library'"));
  assert.ok(managerSource.includes("output.toBlob(function (blob)"));
  assert.ok(managerSource.includes('RoleAvatarLibrary.add(roleId, blob'));
  assert.ok(managerSource.includes('新头像已加入这个角色的收藏。选择缩略图即可设为当前头像。'));
  assert.ok(managerSource.includes("portraitPurpose = 'profile'"));
});

test('current avatar changes are persisted with a compatibility DataURL and roll back on save failure', () => {
  assert.ok(managerSource.includes('library.setActive(roleId, item.id)'));
  assert.ok(managerSource.includes('library.toDataUrl(item.assetId)'));
  assert.ok(managerSource.includes("const previousAvatar = target.avatar || ''"));
  assert.ok(managerSource.includes("library.setActive(roleId, previousActive ? previousActive.id : '')"));
  assert.ok(managerSource.includes('target.avatar = previousAvatar'));
});

test('avatar gallery revokes object URLs and prevents removal of the active portrait', () => {
  assert.ok(managerSource.includes('releaseAvatarLibraryUrls()'));
  assert.ok(managerSource.includes('avatarLibraryObjectUrls.push(resolved.value)'));
  assert.ok(managerSource.includes('if (item.active)'));
  assert.ok(managerSource.includes('当前头像不能直接移除'));
  assert.ok(managerSource.includes('library.remove(roleId, avatarId)'));
});

test('deleting a character releases only that character avatar references after profile deletion succeeds', () => {
  assert.ok(managerSource.includes('if (!saveRoles(updatedRoles))'));
  assert.ok(managerSource.includes('RoleAvatarLibrary.removeRole(String(id))'));
  assert.ok(managerSource.includes('角色删除失败，原有资料和头像均已保留。'));
});

test('PWA shell caches the role portrait archive and its runtime at v178', () => {
  assert.ok(serviceWorker.includes("const CACHE_NAME = 'phone-app-pwa-v179'"));
  assert.ok(serviceWorker.includes("'./worldbook/characters/characters.html'"));
  assert.ok(serviceWorker.includes("'./worldbook/characters/js/characters-manager.js?v=20261107v3'"));
  assert.ok(serviceWorker.includes("'./shared/js/phone/role-avatar-library.js?v=20261107v2'"));
});


test('role removal restores already released references when a later cleanup step fails', async () => {
  const laterCleanupAssetId = 'as_' + 'A'.repeat(31) + 'B';
  const failAtSecond = createLibrary({}, { failRemoveRefFor: laterCleanupAssetId });
  const a = await failAtSecond.api.add('role-a', 'data:image/jpeg;base64,AAA');
  const b = await failAtSecond.api.add('role-a', 'data:image/jpeg;base64,BBB');
  const result = await failAtSecond.api.removeRole('role-a');
  assert.equal(result.ok, false);
  assert.equal(failAtSecond.api.list('role-a').length, 2);
  assert.equal(failAtSecond.refs.has(a.value.assetId + '|role-avatar|role-a'), true);
  assert.equal(failAtSecond.refs.has(b.value.assetId + '|role-avatar|role-a'), true);
});


test('chat image assets are linked into a role avatar library without copying image bytes', async () => {
  const { api, assets, refs } = createLibrary();
  const source = await api.add('chat-owner', 'data:image/jpeg;base64,PHOTO');
  const before = assets.size;
  const candidate = await api.addAsset('role-a', source.value.assetId, {
    label: '聊天候选头像',
    source: 'chat'
  });
  assert.equal(candidate.ok, true);
  assert.equal(api.list('role-a').length, 1);
  assert.equal(api.list('role-a')[0].source, 'chat');
  assert.equal(assets.size, before, 'the existing media asset is reused');
  assert.equal(refs.has(source.value.assetId + '|role-avatar|role-a'), true);
  assert.equal(api.getActive('role-a'), null, 'a candidate never changes the active avatar');
});

test('chat avatar candidate linking is role-isolated and deduplicates the same source asset', async () => {
  const { api } = createLibrary();
  const source = await api.add('chat-owner', 'data:image/jpeg;base64,PHOTO');
  const a = await api.addAsset('role-a', source.value.assetId, { source: 'chat' });
  const duplicate = await api.addAsset('role-a', source.value.assetId, { source: 'chat' });
  const b = await api.addAsset('role-b', source.value.assetId, { source: 'chat' });
  assert.equal(a.ok, true);
  assert.equal(duplicate.ok, true);
  assert.equal(b.ok, true);
  assert.equal(api.list('role-a').length, 1);
  assert.equal(api.list('role-b').length, 1);
  assert.equal(a.value.id, duplicate.value.id);
  assert.equal(api.list('role-a')[0].active, false);
  assert.equal(api.list('role-b')[0].active, false);
});

test('chat avatar candidate linking rejects unavailable and non-image assets', async () => {
  const { api, assets } = createLibrary();
  const unavailable = await api.addAsset('role-a', 'as_' + 'Z'.repeat(32), { source: 'chat' });
  assert.equal(unavailable.ok, false);

  const nonImageId = 'as_' + 'B'.repeat(32);
  assets.set(nonImageId, new Blob(['not an image'], { type: 'application/octet-stream' }));
  const invalid = await api.addAsset('role-a', nonImageId, { source: 'chat' });
  assert.equal(invalid.ok, false);
  assert.equal(api.list('role-a').length, 0);
});

test('chat avatar candidate reference is released if role library metadata cannot be saved', async () => {
  const failing = createLibrary({}, { failWrites: true });
  const sourceAssetId = 'as_' + 'A'.repeat(31) + 'B';
  failing.assets.set(sourceAssetId, new Blob(['photo'], { type: 'image/jpeg' }));
  const result = await failing.api.addAsset('role-a', sourceAssetId, { source: 'chat' });
  assert.equal(result.ok, false);
  assert.equal(failing.refs.has(sourceAssetId + '|role-avatar|role-a'), false);
  assert.equal(failing.assets.has(sourceAssetId), true, 'the chat-owned source asset is retained');
});

test('chat avatar candidate linking failure does not write a role library entry', async () => {
  const failing = createLibrary({ failAddRefFor: 'as_' + 'A'.repeat(31) + 'B' });
  const sourceAssetId = 'as_' + 'A'.repeat(31) + 'B';
  failing.assets.set(sourceAssetId, new Blob(['photo'], { type: 'image/jpeg' }));
  const result = await failing.api.addAsset('role-a', sourceAssetId, { source: 'chat' });
  assert.equal(result.ok, false);
  assert.equal(failing.api.list('role-a').length, 0);
});

test('paired portraits are saved as a role-scoped relationship without copying image assets', async () => {
  const { api, assets, refs } = createLibrary();
  const a = await api.add('role-a', 'data:image/jpeg;base64,PAIR_A');
  const b = await api.add('role-a', 'data:image/jpeg;base64,PAIR_B');
  const before = assets.size;
  const linked = api.linkPair('role-a', a.value.id, b.value.id, { source: 'chat', label: '情头' });
  assert.equal(linked.ok, true);
  assert.equal(linked.value.avatars.length, 2);
  assert.equal(linked.value.label, '情头');
  assert.equal(api.getPairs('role-a').length, 1);
  assert.equal(api.getPairs('role-b').length, 0);
  assert.equal(assets.size, before, 'pair metadata references existing assets');
  assert.equal(refs.has(a.value.assetId + '|role-avatar|role-a'), true);
  assert.equal(refs.has(b.value.assetId + '|role-avatar|role-a'), true);
  assert.equal(api.getActive('role-a'), null, 'pairing never changes the active avatar');
});

test('a portrait can belong to only one pair and paired images cannot be removed until unlinked', async () => {
  const { api, assets } = createLibrary();
  const a = await api.add('role-a', 'data:image/jpeg;base64,A');
  const b = await api.add('role-a', 'data:image/jpeg;base64,B');
  const c = await api.add('role-a', 'data:image/jpeg;base64,C');
  const linked = api.linkPair('role-a', a.value.id, b.value.id);
  assert.equal(linked.ok, true);
  assert.equal(api.linkPair('role-a', a.value.id, c.value.id).error.code, 'PAIR_CONFLICT');
  const blocked = await api.remove('role-a', b.value.id);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'PAIR_EXISTS');
  const unlinked = api.unlinkPair('role-a', linked.value.id);
  assert.equal(unlinked.ok, true);
  assert.equal(unlinked.meta.portraitsRetained, true);
  assert.equal(api.getPairs('role-a').length, 0);
  assert.equal(api.list('role-a').length, 3);
  const removed = await api.remove('role-a', b.value.id);
  assert.equal(removed.ok, true);
  assert.equal(assets.has(b.value.assetId), false);
});

test('pair creation rejects same, missing, and cross-character portraits and deduplicates reversed pairs', async () => {
  const { api } = createLibrary();
  const a = await api.add('role-a', 'data:image/jpeg;base64,A');
  const b = await api.add('role-a', 'data:image/jpeg;base64,B');
  const other = await api.add('role-b', 'data:image/jpeg;base64,C');
  assert.equal(api.linkPair('role-a', a.value.id, a.value.id).error.code, 'VALIDATION_FAILED');
  assert.equal(api.linkPair('role-a', a.value.id, other.value.id).error.code, 'NOT_FOUND');
  const first = api.linkPair('role-a', a.value.id, b.value.id);
  const reverse = api.linkPair('role-a', b.value.id, a.value.id);
  assert.equal(first.ok, true);
  assert.equal(reverse.ok, true);
  assert.equal(reverse.meta.reused, true);
  assert.equal(api.getPairs('role-a').length, 1);
});

test('adding or selecting another portrait preserves existing pair relationships', async () => {
  const { api } = createLibrary();
  const a = await api.add('role-a', 'data:image/jpeg;base64,A');
  const b = await api.add('role-a', 'data:image/jpeg;base64,B');
  const pair = api.linkPair('role-a', a.value.id, b.value.id);
  assert.equal(pair.ok, true);

  const c = await api.add('role-a', 'data:image/jpeg;base64,C');
  assert.equal(c.ok, true);
  assert.equal(api.getPairs('role-a').length, 1);
  assert.equal(api.setActive('role-a', c.value.id).ok, true);
  assert.equal(api.getPairs('role-a').length, 1);
  assert.deepEqual(Array.from(api.getPairs('role-a')[0].avatarIds), [a.value.id, b.value.id]);
});

test('deleting a character clears its pair metadata and references without affecting another character pair', async () => {
  const { api, refs } = createLibrary();
  const a1 = await api.add('role-a', 'data:image/jpeg;base64,A1');
  const a2 = await api.add('role-a', 'data:image/jpeg;base64,A2');
  const b1 = await api.add('role-b', 'data:image/jpeg;base64,B1');
  const b2 = await api.add('role-b', 'data:image/jpeg;base64,B2');
  assert.equal(api.linkPair('role-a', a1.value.id, a2.value.id).ok, true);
  assert.equal(api.linkPair('role-b', b1.value.id, b2.value.id).ok, true);

  const removed = await api.removeRole('role-a');
  assert.equal(removed.ok, true);
  assert.equal(api.list('role-a').length, 0);
  assert.equal(api.getPairs('role-a').length, 0);
  assert.equal(refs.has(a1.value.assetId + '|role-avatar|role-a'), false);
  assert.equal(refs.has(a2.value.assetId + '|role-avatar|role-a'), false);
  assert.equal(api.getPairs('role-b').length, 1);
  assert.equal(refs.has(b1.value.assetId + '|role-avatar|role-b'), true);
  assert.equal(refs.has(b2.value.assetId + '|role-avatar|role-b'), true);
});

test('pair state normalization rejects dangling, repeated, duplicate and overlapping relationships', () => {
  const { api } = createLibrary();
  const assetA = 'as_' + 'A'.repeat(32);
  const assetB = 'as_' + 'B'.repeat(32);
  const assetC = 'as_' + 'C'.repeat(32);
  const idA = 'avatar_' + assetA.slice(3);
  const idB = 'avatar_' + assetB.slice(3);
  const idC = 'avatar_' + assetC.slice(3);
  const normalized = api._normalizeState({
    activeId: idA,
    items: [
      { assetId: assetA, label: 'A' },
      { assetId: assetB, label: 'B' },
      { assetId: assetC, label: 'C' }
    ],
    pairs: [
      { avatarIds: [idA, idB], label: 'valid', source: 'chat', createdAt: 10 },
      { avatarIds: [idB, idA], label: 'duplicate reversed', createdAt: 11 },
      { avatarIds: [idB, idC], label: 'overlap', createdAt: 12 },
      { avatarIds: [idA, idA], label: 'same image', createdAt: 13 },
      { avatarIds: [idA, 'avatar_missing'], label: 'dangling', createdAt: 14 }
    ]
  });
  assert.equal(normalized.pairs.length, 1);
  assert.equal(normalized.pairs[0].label, 'valid');
  assert.equal(normalized.pairs[0].source, 'chat');
  assert.deepEqual(Array.from(normalized.pairs[0].avatarIds), [idA, idB]);
});
