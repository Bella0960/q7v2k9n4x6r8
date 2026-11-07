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
  const contentAssets = new Map();
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
      if (typeof input === 'string' && contentAssets.has(input)) {
        const existingAssetId = contentAssets.get(input);
        refs.add(existingAssetId + '|' + opts.ownerType + '|' + opts.ownerId);
        return Promise.resolve({ ok: true, value: { assetId: existingAssetId, reused: true } });
      }
      sequence += 1;
      const suffix = sequence.toString(2).replace(/0/g, 'A').replace(/1/g, 'B');
      const assetId = 'as_' + suffix.padStart(32, 'A');
      assets.set(assetId, input);
      if (typeof input === 'string') contentAssets.set(input, assetId);
      refs.add(assetId + '|' + opts.ownerType + '|' + opts.ownerId);
      const result = { ok: true, value: { assetId, reused: false } };
      if (options.deferPutBlob) {
        return new Promise(resolve => { options.releasePutBlob = () => resolve(result); });
      }
      return Promise.resolve(result);
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
      const result = { ok: true, value: { asset: { mimeType }, blob } };
      if (options.deferGetAssetFor === assetId) {
        return new Promise(resolve => { options.releaseGetAsset = () => resolve(result); });
      }
      return Promise.resolve(result);
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

test('a pending portrait upload cannot recreate a library after its character is deleted', async () => {
  const options = { deferPutBlob: true };
  const { api, assets, refs } = createLibrary({}, options);
  const pending = api.add('role-deleted', 'data:image/jpeg;base64,LATE_UPLOAD');
  assert.equal(typeof options.releasePutBlob, 'function');

  const deleted = await api.removeRole('role-deleted');
  assert.equal(deleted.ok, true);
  options.releasePutBlob();

  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ROLE_DELETED');
  assert.equal(api.list('role-deleted').length, 0);
  assert.equal(Array.from(refs).some(ref => ref.endsWith('|role-avatar|role-deleted')), false);
  assert.equal(assets.size, 0, 'a newly uploaded orphan is removed after its role reference is released');
});

test('a pending chat pair cannot leave a late portrait reference after character deletion', async () => {
  const firstAssetId = 'as_' + 'A'.repeat(32);
  const secondAssetId = 'as_' + 'B'.repeat(32);
  const options = { deferGetAssetFor: secondAssetId };
  const { api, assets, refs } = createLibrary({}, options);
  assets.set(firstAssetId, new Blob(['first'], { type: 'image/jpeg' }));
  assets.set(secondAssetId, new Blob(['second'], { type: 'image/jpeg' }));
  refs.add(firstAssetId + '|chat-message|message-a');
  refs.add(secondAssetId + '|chat-message|message-b');

  const pending = api.addAssetPair('role-deleted', firstAssetId, secondAssetId);
  for (let i = 0; i < 8 && typeof options.releaseGetAsset !== 'function'; i += 1) await Promise.resolve();
  assert.equal(typeof options.releaseGetAsset, 'function', 'the second pair image is waiting on media lookup');

  const deleted = await api.removeRole('role-deleted');
  assert.equal(deleted.ok, true);
  options.releaseGetAsset();

  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ROLE_DELETED');
  assert.equal(api.list('role-deleted').length, 0);
  assert.equal(api.getPairs('role-deleted').length, 0);
  assert.equal(refs.has(firstAssetId + '|role-avatar|role-deleted'), false);
  assert.equal(refs.has(secondAssetId + '|role-avatar|role-deleted'), false);
  assert.equal(refs.has(firstAssetId + '|chat-message|message-a'), true, 'chat-owned source image is retained');
  assert.equal(refs.has(secondAssetId + '|chat-message|message-b'), true, 'chat-owned source image is retained');
});

test('deleted role tombstones block later portrait and pair mutations', async () => {
  const { api } = createLibrary();
  const first = await api.add('role-a', 'data:image/jpeg;base64,FIRST');
  const second = await api.add('role-a', 'data:image/jpeg;base64,SECOND');
  assert.equal((await api.removeRole('role-a')).ok, true);

  assert.equal((await api.add('role-a', 'data:image/jpeg;base64,AFTER_DELETE')).error.code, 'ROLE_DELETED');
  assert.equal((await api.addAsset('role-a', first.value.assetId, { source: 'chat' })).error.code, 'ROLE_DELETED');
  assert.equal(api.linkPair('role-a', first.value.id, second.value.id).error.code, 'ROLE_DELETED');
  assert.equal(api.setActive('role-a', first.value.id).error.code, 'ROLE_DELETED');
  assert.equal(api.list('role-a').length, 0);
});

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

test('parallel portrait uploads merge into the latest role snapshot instead of overwriting each other', async () => {
  const { api } = createLibrary();
  const results = await Promise.all([
    api.add('role-a', 'data:image/jpeg;base64,PARALLEL_A', { label: '并发头像 A' }),
    api.add('role-a', 'data:image/jpeg;base64,PARALLEL_B', { label: '并发头像 B' })
  ]);
  assert.equal(results.every(result => result.ok), true);
  assert.equal(api.list('role-a').length, 2);
  assert.deepEqual(
    api.list('role-a').map(item => item.label).sort(),
    ['并发头像 A', '并发头像 B']
  );
});

test('parallel chat asset links preserve every portrait reference in the role library', async () => {
  const { api, assets, refs } = createLibrary();
  const firstAssetId = 'as_' + 'A'.repeat(32);
  const secondAssetId = 'as_' + 'B'.repeat(32);
  assets.set(firstAssetId, new Blob(['first'], { type: 'image/jpeg' }));
  assets.set(secondAssetId, new Blob(['second'], { type: 'image/jpeg' }));

  const results = await Promise.all([
    api.addAsset('role-a', firstAssetId, { source: 'chat', label: '聊天头像 A' }),
    api.addAsset('role-a', secondAssetId, { source: 'chat', label: '聊天头像 B' })
  ]);
  assert.equal(results.every(result => result.ok), true);
  assert.equal(api.list('role-a').length, 2);
  assert.equal(refs.has(firstAssetId + '|role-avatar|role-a'), true);
  assert.equal(refs.has(secondAssetId + '|role-avatar|role-a'), true);
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

test('portrait removal revalidates pair state after asynchronous reference release', async () => {
  const { api, refs } = createLibrary();
  const first = await api.add('role-a', 'data:image/jpeg;base64,PAIR_FIRST');
  const second = await api.add('role-a', 'data:image/jpeg;base64,PAIR_SECOND');
  assert.equal(api.setActive('role-a', first.value.id).ok, true);

  const removalPending = api.remove('role-a', second.value.id);
  const paired = api.linkPair('role-a', first.value.id, second.value.id);
  assert.equal(paired.ok, true);

  const removed = await removalPending;
  assert.equal(removed.ok, false);
  assert.equal(removed.error.code, 'PAIR_EXISTS');
  assert.equal(api.getPairs('role-a').length, 1);
  assert.equal(api.find('role-a', second.value.id).id, second.value.id);
  assert.equal(refs.has(second.value.assetId + '|role-avatar|role-a'), true);
});

test('portrait removal revalidates the active avatar after asynchronous reference release', async () => {
  const { api, refs } = createLibrary();
  const current = await api.add('role-a', 'data:image/jpeg;base64,CURRENT');
  const candidate = await api.add('role-a', 'data:image/jpeg;base64,CANDIDATE');

  const removalPending = api.remove('role-a', candidate.value.id);
  assert.equal(api.setActive('role-a', candidate.value.id).ok, true);

  const removed = await removalPending;
  assert.equal(removed.ok, false);
  assert.equal(removed.error.code, 'VALIDATION_FAILED');
  assert.equal(api.getActive('role-a').id, candidate.value.id);
  assert.equal(refs.has(candidate.value.assetId + '|role-avatar|role-a'), true);
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
  const avatars = characterPage.indexOf('role-avatar-library.js?v=20261107v8');
  const manager = characterPage.indexOf('js/characters-manager.js?v=20261107v10');
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
  assert.ok(managerSource.includes('await library.removeRole(String(id))'));
  assert.ok(managerSource.includes('角色删除失败，原有资料和头像均已保留。'));
});

test('PWA shell caches the role portrait archive and its runtime at v178', () => {
  assert.ok(serviceWorker.includes("const CACHE_NAME = 'phone-app-pwa-v192'"));
  assert.ok(serviceWorker.includes("'./worldbook/characters/characters.html'"));
  assert.ok(serviceWorker.includes("'./worldbook/characters/js/characters-manager.js?v=20261107v10'"));
  assert.ok(serviceWorker.includes("'./shared/js/phone/role-avatar-library.js?v=20261107v8'"));
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

test('role avatar library exposes a dedicated transactional pair saver', () => {
  assert.equal(typeof createLibrary().api.addAssetPair, 'function');
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

test('transactional chat pair saver stores two existing assets once and creates the role-scoped pair', async () => {
  const { api, assets, refs } = createLibrary();
  const first = await api.add('chat-owner', 'data:image/jpeg;base64,FIRST');
  const second = await api.add('chat-owner', 'data:image/jpeg;base64,SECOND');
  const before = assets.size;

  const result = await api.addAssetPair('role-a', first.value.assetId, second.value.assetId, { label: '聊天情头' });
  assert.equal(result.ok, true);
  assert.equal(result.value.label, '聊天情头');
  assert.equal(result.value.avatars.length, 2);
  assert.equal(api.list('role-a').length, 2);
  assert.equal(api.getPairs('role-a').length, 1);
  assert.equal(api.getPairs('role-b').length, 0);
  assert.equal(assets.size, before, 'the pair reuses the two existing media blobs');
  assert.equal(refs.has(first.value.assetId + '|role-avatar|role-a'), true);
  assert.equal(refs.has(second.value.assetId + '|role-avatar|role-a'), true);
  assert.equal(api.getActive('role-a'), null, 'pair saving does not change the active avatar');
});

test('saving the same chat pair twice is idempotent and preserves the original pair record', async () => {
  const { api, assets, refs } = createLibrary();
  const first = await api.add('chat-owner', 'data:image/jpeg;base64,FIRST');
  const second = await api.add('chat-owner', 'data:image/jpeg;base64,SECOND');
  const initial = await api.addAssetPair('role-a', first.value.assetId, second.value.assetId, {
    label: '第一次收藏'
  });
  assert.equal(initial.ok, true);
  const assetCount = assets.size;
  const referenceCount = refs.size;

  const repeated = await api.addAssetPair('role-a', first.value.assetId, second.value.assetId, {
    label: '重复请求不应覆盖名称'
  });
  assert.equal(repeated.ok, true);
  assert.equal(repeated.meta.reused, true);
  assert.equal(api.list('role-a').length, 2);
  assert.equal(api.getPairs('role-a').length, 1);
  assert.equal(api.getPairs('role-a')[0].label, '第一次收藏');
  assert.equal(assets.size, assetCount);
  assert.equal(refs.size, referenceCount);
});

test('transactional pair saver rolls back its first new reference when the second asset cannot be linked', async () => {
  const secondAssetId = 'as_' + 'B'.repeat(32);
  const failing = createLibrary({}, { failAddRefFor: secondAssetId });
  const first = await failing.api.add('chat-owner', 'data:image/jpeg;base64,FIRST');
  failing.assets.set(secondAssetId, new Blob(['second image'], { type: 'image/jpeg' }));
  failing.refs.add(secondAssetId + '|chat-message|message-b');

  const result = await failing.api.addAssetPair('role-a', first.value.assetId, secondAssetId);
  assert.equal(result.ok, false);
  assert.equal(failing.api.list('role-a').length, 0);
  assert.equal(failing.api.getPairs('role-a').length, 0);
  assert.equal(failing.refs.has(first.value.assetId + '|role-avatar|role-a'), false);
  assert.equal(failing.refs.has(first.value.assetId + '|role-avatar|chat-owner'), true);
  assert.equal(failing.refs.has(secondAssetId + '|chat-message|message-b'), true);
});

test('transactional pair saver preserves an existing pair when a new overlapping pair conflicts', async () => {
  const { api } = createLibrary();
  const first = await api.add('chat-owner', 'data:image/jpeg;base64,FIRST');
  const second = await api.add('chat-owner', 'data:image/jpeg;base64,SECOND');
  const third = await api.add('chat-owner', 'data:image/jpeg;base64,THIRD');
  const original = await api.addAssetPair('role-a', second.value.assetId, third.value.assetId);
  assert.equal(original.ok, true);

  const conflict = await api.addAssetPair('role-a', first.value.assetId, second.value.assetId);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, 'PAIR_CONFLICT');
  assert.equal(api.list('role-a').length, 2);
  assert.equal(api.list('role-a').some(item => item.assetId === first.value.assetId), false);
  assert.equal(api.getPairs('role-a').length, 1);
  assert.deepEqual(
    Array.from(api.getPairs('role-a')[0].avatarIds),
    [api.list('role-a').find(item => item.assetId === second.value.assetId).id,
     api.list('role-a').find(item => item.assetId === third.value.assetId).id]
  );
});

test('transactional pair saver never removes an existing single avatar when its other image fails', async () => {
  const secondAssetId = 'as_' + 'C'.repeat(32);
  const failing = createLibrary({}, { failAddRefFor: secondAssetId });
  const first = await failing.api.add('chat-owner', 'data:image/jpeg;base64,FIRST');
  const existing = await failing.api.addAsset('role-a', first.value.assetId, { source: 'chat' });
  failing.assets.set(secondAssetId, new Blob(['second image'], { type: 'image/jpeg' }));

  const result = await failing.api.addAssetPair('role-a', first.value.assetId, secondAssetId);
  assert.equal(result.ok, false);
  assert.equal(failing.api.list('role-a').length, 1);
  assert.equal(failing.api.list('role-a')[0].id, existing.value.id);
  assert.equal(failing.refs.has(first.value.assetId + '|role-avatar|role-a'), true);
});

test('transactional pair saver rejects duplicate or malformed source assets without writing pair records', async () => {
  const { api } = createLibrary();
  const source = await api.add('role-a', 'data:image/jpeg;base64,SAME');
  const same = await api.addAssetPair('role-a', source.value.assetId, source.value.assetId);
  const invalid = await api.addAssetPair('role-a', 'not-an-asset', source.value.assetId);
  assert.equal(same.ok, false);
  assert.equal(same.error.code, 'VALIDATION_FAILED');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'VALIDATION_FAILED');
  assert.equal(api.list('role-a').length, 1);
  assert.equal(api.getPairs('role-a').length, 0);
});

test('transactional pair saver reports partial rollback instead of hiding a stranded new portrait', async () => {
  const firstAssetId = 'as_' + 'A'.repeat(31) + 'B';
  const secondAssetId = 'as_' + 'D'.repeat(32);
  const failing = createLibrary({}, {
    failAddRefFor: secondAssetId,
    failRemoveRefFor: firstAssetId
  });
  const first = await failing.api.add('chat-owner', 'data:image/jpeg;base64,FIRST');
  assert.equal(first.value.assetId, firstAssetId);
  failing.assets.set(secondAssetId, new Blob(['second image'], { type: 'image/jpeg' }));
  const result = await failing.api.addAssetPair('role-a', firstAssetId, secondAssetId);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PARTIAL_ROLLBACK');
  assert.equal(result.meta.cleanupRequired, true);
  assert.equal(failing.api.getPairs('role-a').length, 0);
  assert.equal(failing.api.list('role-a').length, 1);
});

test('swapping a pair reverses only its A/B order and preserves active portrait references', async () => {
  const { api, assets, refs } = createLibrary();
  const first = await api.add('role-a', 'data:image/jpeg;base64,FIRST');
  const second = await api.add('role-a', 'data:image/jpeg;base64,SECOND');
  const third = await api.add('role-a', 'data:image/jpeg;base64,THIRD');
  api.setActive('role-a', third.value.id);
  const pair = api.linkPair('role-a', first.value.id, second.value.id, { label: '情头' });
  const assetCount = assets.size;
  const firstRef = refs.has(first.value.assetId + '|role-avatar|role-a');
  const secondRef = refs.has(second.value.assetId + '|role-avatar|role-a');

  const swapped = api.swapPair('role-a', pair.value.id);
  assert.equal(swapped.ok, true);
  assert.deepEqual(Array.from(swapped.value.avatarIds), [second.value.id, first.value.id]);
  assert.equal(swapped.value.label, '情头');
  assert.equal(swapped.value.avatars[0].assetId, second.value.assetId);
  assert.equal(api.getActive('role-a').id, third.value.id);
  assert.equal(api.getPairs('role-a').length, 1);
  assert.equal(assets.size, assetCount);
  assert.equal(refs.has(first.value.assetId + '|role-avatar|role-a'), firstRef);
  assert.equal(refs.has(second.value.assetId + '|role-avatar|role-a'), secondRef);
});

test('swapping a missing pair fails without changing the portrait library', async () => {
  const { api } = createLibrary();
  const first = await api.add('role-a', 'data:image/jpeg;base64,FIRST');
  const before = api.list('role-a');
  const result = api.swapPair('role-a', 'pair_missing');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NOT_FOUND');
  assert.deepEqual(Array.from(api.list('role-a').map(item => item.id)), Array.from(before.map(item => item.id)));
  assert.equal(api.getPairs('role-a').length, 0);
});

test('direct pair lookup returns the matching role-scoped relationship for either portrait', async () => {
  const { api } = createLibrary();
  const a = await api.add('role-a', 'data:image/jpeg;base64,A');
  const b = await api.add('role-a', 'data:image/jpeg;base64,B');
  const other = await api.add('role-b', 'data:image/jpeg;base64,C');
  const pair = api.linkPair('role-a', a.value.id, b.value.id, { label: '情头' });
  assert.equal(api.getPairForAvatar('role-a', a.value.id).id, pair.value.id);
  assert.equal(api.getPairForAvatar('role-a', b.value.id).id, pair.value.id);
  assert.equal(api.getPairForAvatar('role-b', a.value.id), null);
  assert.equal(api.getPairForAvatar('role-a', other.value.id), null);
});

test('renaming a pair sanitizes and saves only its label while preserving images, order and active avatar', async () => {
  const { api, assets, refs } = createLibrary();
  const first = await api.add('role-a', 'data:image/jpeg;base64,FIRST');
  const second = await api.add('role-a', 'data:image/jpeg;base64,SECOND');
  const active = await api.add('role-a', 'data:image/jpeg;base64,ACTIVE');
  api.setActive('role-a', active.value.id);
  const pair = api.linkPair('role-a', first.value.id, second.value.id, {
    label: '初始名称', source: 'chat', createdAt: 123
  });
  const assetCount = assets.size;
  const firstRef = refs.has(first.value.assetId + '|role-avatar|role-a');
  const secondRef = refs.has(second.value.assetId + '|role-avatar|role-a');

  const renamed = api.renamePair('role-a', pair.value.id, '  <新情头>  ');
  assert.equal(renamed.ok, true);
  assert.equal(renamed.value.label, '新情头');
  assert.deepEqual(Array.from(renamed.value.avatarIds), [first.value.id, second.value.id]);
  assert.equal(renamed.value.source, 'chat');
  assert.equal(renamed.value.createdAt, 123);
  assert.equal(api.getPairForAvatar('role-a', first.value.id).label, '新情头');
  assert.equal(api.getActive('role-a').id, active.value.id);
  assert.equal(assets.size, assetCount);
  assert.equal(refs.has(first.value.assetId + '|role-avatar|role-a'), firstRef);
  assert.equal(refs.has(second.value.assetId + '|role-avatar|role-a'), secondRef);

  const blank = api.renamePair('role-a', pair.value.id, '  ');
  assert.equal(blank.ok, false);
  assert.equal(blank.error.code, 'VALIDATION_FAILED');
  assert.equal(api.getPairs('role-a')[0].label, '新情头');
  assert.equal(api.renamePair('role-a', 'pair_missing', '新名字').error.code, 'NOT_FOUND');
});

test('renaming truncates pair names to the library display limit', async () => {
  const { api } = createLibrary();
  const first = await api.add('role-a', 'data:image/jpeg;base64,FIRST');
  const second = await api.add('role-a', 'data:image/jpeg;base64,SECOND');
  const pair = api.linkPair('role-a', first.value.id, second.value.id);
  const renamed = api.renamePair('role-a', pair.value.id, '名'.repeat(50));
  assert.equal(renamed.ok, true);
  assert.equal(renamed.value.label.length, 36);
});
