import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (path) => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const bridgeSource = read('shared/js/phone/role-worldbook-bindings.js');

function harness(init = {}) {
  const data = new Map(Object.entries(init));
  const storage = {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
  const window = {};
  vm.runInNewContext(bridgeSource, { window, localStorage: storage });
  return { binding: window.RoleWorldbookBindings, data, storage };
}
const roles = [{ id: 'role_a', name: 'A', worldBookIds: ['a'] },
  { id: 'role_b', name: 'B', worldBookIds: ['b'] }];
const json = JSON.stringify;

test('role-editor binding remains visible in chat-settings and chat context', () => {
  const { binding } = harness({ ai_custom_characters: json(roles) });
  assert.deepEqual([...binding.read('role_a').ids], ['a']);
  assert.deepEqual([...binding.filterBooks('role_a', [{ id: 'a' }, { id: 'b' }]).books].map(x => x.id), ['a']);
  assert.deepEqual([...binding.filterBooks('role_b', [{ id: 'a' }, { id: 'b' }]).books].map(x => x.id), ['b']);
});
test('legacy chat-settings-only mount and object form survive without silent deletion', () => {
  const { binding } = harness({
    ai_custom_characters: json([{ id: 'role_a', name: 'A' }]),
    chat_worldbooks_role_a: json({ worldbookIds: ['old1', 'old2'] })
  });
  assert.deepEqual([...binding.read('role_a').ids], ['old1', 'old2']);
});
test('conflicting old mounts are temporarily unioned; explicit save becomes authoritative', () => {
  const { binding, storage } = harness({
    ai_custom_characters: json(roles),
    chat_worldbooks_role_a: json(['old'])
  });
  assert.deepEqual([...binding.read('role_a').ids], ['a', 'old']);
  assert.equal(binding.read('role_a').hasConflict, true);
  assert.equal(binding.save('role_a', ['new', 'new']).ok, true);
  assert.deepEqual(JSON.parse(storage.getItem('chat_worldbooks_role_a')), ['new']);
  assert.deepEqual(JSON.parse(storage.getItem('ai_custom_characters'))[0].worldBookIds, ['new']);
  assert.equal(binding.read('role_a').hasConflict, false);
  assert.deepEqual(JSON.parse(storage.getItem('ai_custom_characters'))[1].worldBookIds, ['b']);
});
test('disabled legacy binding cannot inject lore until user explicitly saves', () => {
  const { binding } = harness({
    ai_custom_characters: json(roles),
    chat_worldbooks_role_a: json({ enabled: false, worldbookIds: ['a'] })
  });
  assert.deepEqual([...binding.read('role_a').ids], []);
  assert.deepEqual([...binding.filterBooks('role_a', [{ id: 'a' }]).books], []);
  assert.equal(binding.save('role_a', ['a']).ok, true);
  assert.deepEqual([...binding.read('role_a').ids], ['a']);
});
test('explicit unmount persists after a fresh read', () => {
  const { binding } = harness({ ai_custom_characters: json(roles), chat_worldbooks_role_a: json(['a']) });
  assert.equal(binding.save('role_a', []).ok, true);
  assert.deepEqual([...binding.read('role_a').ids], []);
});
test('worldbook deletion does not mutate stale references on read', () => {
  const { binding, storage } = harness({
    ai_custom_characters: json(roles),
    chat_worldbooks_role_a: json(['deleted'])
  });
  assert.deepEqual([...binding.filterBooks('role_a', [{ id: 'a' }]).books].map(x => x.id), ['a']);
  assert.deepEqual([...binding.read('role_a').ids], ['a', 'deleted']);
  assert.deepEqual(JSON.parse(storage.getItem('chat_worldbooks_role_a')), ['deleted']);
});
test('failed large character write rolls back small mount, preserving both records', () => {
  const { binding, storage } = harness({ ai_custom_characters: json(roles) });
  const original = storage.getItem('ai_custom_characters');
  const realSet = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === 'ai_custom_characters') throw new Error('QuotaExceededError');
    realSet(key, value);
  };
  const result = binding.save('role_a', ['changed']);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'STORAGE_WRITE_FAILED');
  assert.equal(storage.getItem('ai_custom_characters'), original);
  assert.equal(storage.getItem('chat_worldbooks_role_a'), null);
});

test('failed small mount write never overwrites the large character array', () => {
  const { binding, storage } = harness({ ai_custom_characters: json(roles) });
  const original = storage.getItem('ai_custom_characters');
  const realSet = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === 'chat_worldbooks_role_a') throw new Error('QuotaExceededError');
    realSet(key, value);
  };
  assert.equal(binding.save('role_a', ['changed']).ok, false);
  assert.equal(storage.getItem('ai_custom_characters'), original);
});
test('malformed legacy binding blocks destructive save', () => {
  const { binding, storage } = harness({
    ai_custom_characters: json(roles),
    chat_worldbooks_role_a: '{broken'
  });
  const original = storage.getItem('ai_custom_characters');
  assert.equal(binding.read('role_a').ok, false);
  assert.equal(binding.save('role_a', ['changed']).ok, false);
  assert.equal(storage.getItem('ai_custom_characters'), original);
});
test('group without corresponding role still uses its legacy mount, never rewrites character list', () => {
  const { binding, storage } = harness({ ai_custom_characters: json(roles) });
  assert.equal(binding.save('group_1', ['book_1']).ok, true);
  assert.deepEqual([...binding.read('group_1').ids], ['book_1']);
  assert.equal(storage.getItem('ai_custom_characters'), json(roles));
});
test('legacy global books remain selected by default; local books stay private', () => {
  const { binding } = harness({
    ai_custom_characters: json([{ id: 'role_a', worldBookIds: ['local_a'] },
      { id: 'role_b', worldBookIds: [] }]),
    phone_worldbooks: json([
      { id: 'shared', scope: 'global', content: '共享背景' },
      { id: 'old_global', content: '老版全局背景' },
      { id: 'local_a', scope: 'local', content: '专属设定' },
      { id: 'disabled_global', scope: 'global', enabled: false }
    ])
  });
  assert.deepEqual([...binding.read('role_a').ids], ['local_a', 'shared', 'old_global']);
  assert.deepEqual([...binding.read('role_b').ids], ['shared', 'old_global']);
  assert.deepEqual([...binding.filterBooks('role_b', [
    { id: 'shared' }, { id: 'old_global' }, { id: 'local_a' }
  ]).books].map(x => x.id), ['shared', 'old_global']);
});

test('explicitly cleared chat mount cannot resurrect old character or global lore', () => {
  const { binding, storage } = harness({
    ai_custom_characters: json(roles),
    phone_worldbooks: json([{ id: 'global', scope: 'global' }]),
    chat_worldbooks_role_a: '[]'
  });
  assert.deepEqual([...binding.read('role_a').ids], []);
  assert.deepEqual([...binding.filterBooks('role_a', [
    { id: 'a' }, { id: 'global' }
  ]).books], []);
  assert.equal(binding.save('role_a', []).ok, true);
  assert.deepEqual(JSON.parse(storage.getItem('ai_custom_characters'))[0].worldBookIds, []);
});

test('explicitly saved partial selection never auto-readds unrelated global books', () => {
  const { binding } = harness({
    ai_custom_characters: json(roles),
    phone_worldbooks: json([{ id: 'global', scope: 'global' }]),
    chat_worldbooks_role_a: json(['a'])
  });
  assert.deepEqual([...binding.read('role_a').ids], ['a']);
});

test('missing book IDs remain in stored binding when visible library is incomplete', () => {
  const { binding, storage } = harness({
    ai_custom_characters: json([{ id: 'role_a', worldBookIds: ['missing_book'] }]),
    phone_worldbooks: json([{ id: 'present', scope: 'global' }]),
    chat_worldbooks_role_a: json(['missing_book'])
  });
  assert.deepEqual([...binding.read('role_a').ids], ['missing_book']);
  assert.deepEqual([...binding.filterBooks('role_a', [{ id: 'present' }]).books], []);
  assert.deepEqual(JSON.parse(storage.getItem('chat_worldbooks_role_a')), ['missing_book']);
});

test('role editor and chat settings both load the same bridge before handlers', () => {
  const editor = read('worldbook/characters/characters.html');
  const manager = read('worldbook/characters/js/characters-manager.js');
  const settings = read('chat/chat/chat-settings.html');
  const detail = read('chat/chat/chat-detail.html');
  const context = read('shared/js/phone/phone_context.js');
  assert.ok(editor.indexOf('role-worldbook-bindings.js') < editor.indexOf('js/characters-manager.js'));
  assert.match(manager, /RoleWorldbookBindings\.read\(target\.id/);
  assert.match(manager, /RoleWorldbookBindings\.save\(savedRoleId/);
  assert.match(settings, /RoleWorldbookBindings\.read\(roleId/);
  assert.match(settings, /RoleWorldbookBindings\.save\(roleId, mountIds/);
  assert.match(detail, /RoleWorldbookBindings\.filterBooks\(/);
  assert.match(detail, /本轮未请求 AI/);
  assert.match(context, /RoleWorldbookBindings\.filterBooks\(/);
});
