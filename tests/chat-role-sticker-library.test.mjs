import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const source = fs.readFileSync(path.join(process.cwd(), 'shared/js/phone/role-sticker-library.js'), 'utf8');

function createLibrary(seed, options) {
  const values = new Map(Object.entries(seed || {}));
  const localStorage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (options && options.failWrites) throw new Error('storage quota');
      values.set(key, String(value));
    }
  };
  const window = { localStorage };
  vm.runInNewContext(source, { window }, { filename: 'role-sticker-library.js' });
  return { api: window.RoleStickerLibrary, values };
}

test('role sticker favourites stay isolated between characters', () => {
  const { api } = createLibrary();
  const sharedSticker = api.stickerKey('pack-a', 'sticker-1');
  assert.equal(api.toggle('role-a', sharedSticker).selected, true);
  assert.deepEqual(Array.from(api.list('role-a')), [sharedSticker]);
  assert.deepEqual(Array.from(api.list('role-b')), []);
  assert.equal(api.toggle('role-b', sharedSticker).selected, true);
  assert.deepEqual(Array.from(api.list('role-b')), [sharedSticker]);
  assert.equal(api.toggle('role-a', sharedSticker).selected, false);
  assert.deepEqual(Array.from(api.list('role-a')), []);
  assert.deepEqual(Array.from(api.list('role-b')), [sharedSticker]);
});

test('sticker references include both library and sticker IDs', () => {
  const { api } = createLibrary();
  const first = api.stickerKey('pack-a', 'sticker-1');
  const second = api.stickerKey('pack-b', 'sticker-1');
  assert.equal(first, api.stickerKey('pack-a', 'sticker-1'));
  assert.notEqual(first, second);
  assert.equal(api.stickerKey('', 'sticker-1'), '');
  assert.equal(api.stickerKey('pack-a', ''), '');
});

test('favourites store references only, not copied image data', () => {
  const { api, values } = createLibrary();
  const ref = api.stickerKey('pack-a', 'sticker-1');
  assert.equal(api.toggle('role-a', ref).ok, true);
  const saved = values.get('chat_sticker_favorites_v1_role-a');
  assert.equal(saved, JSON.stringify([ref]));
  assert.equal(saved.includes('data:image'), false);
  assert.equal(saved.includes('https://'), false);
});

test('stored data is normalized and duplicate references are removed', () => {
  const key = 'chat_sticker_favorites_v1_role-a';
  const { api } = createLibrary({ [key]: JSON.stringify(['pack-a::sticker-1', '', 'pack-a::sticker-1', 42, null]) });
  assert.deepEqual(Array.from(api.list('role-a')), ['pack-a::sticker-1']);
  assert.equal(api.has('role-a', 'pack-a::sticker-1'), true);
  assert.equal(api.has('role-a', 'pack-b::sticker-1'), false);
});

test('invalid identifiers and storage failures do not report a successful save', () => {
  const normal = createLibrary();
  assert.equal(normal.api.toggle('', 'pack-a::sticker-1').ok, false);
  assert.equal(normal.api.toggle('role-a', '').ok, false);
  assert.deepEqual(Array.from(normal.api.list('role-a')), []);
  const failing = createLibrary({}, { failWrites: true });
  const result = failing.api.toggle('role-a', 'pack-a::sticker-1');
  assert.equal(result.ok, false);
  assert.deepEqual(Array.from(failing.api.list('role-a')), []);
});
