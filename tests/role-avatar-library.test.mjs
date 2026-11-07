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
      const assetId = 'as_' + String(sequence).padStart(32, 'A').slice(-32);
      assets.set(assetId, input);
      refs.add(assetId + '|' + opts.ownerType + '|' + opts.ownerId);
      return Promise.resolve({ ok: true, value: { assetId, reused: false } });
    }
    removeRef(assetId, ownerType, ownerId) {
      refs.delete(assetId + '|' + ownerType + '|' + ownerId);
      return Promise.resolve({ ok: true, value: { removed: true } });
    }
    addRef(assetId, ownerType, ownerId) {
      refs.add(assetId + '|' + ownerType + '|' + ownerId);
      return Promise.resolve({ ok: true });
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
