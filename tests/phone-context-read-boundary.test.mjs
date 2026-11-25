import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../shared/js/phone/phone_context.js', import.meta.url), 'utf8');

const role = { id: 'r1', name: 'R' };
function run(character = role, legacy = null, options = {}) {
  const calls = { history: 0, finance: 0 };
  const window = { PhoneStorage: {
    getCharacters: () => options.characters ?? [character],
    getWorldbooks: () => [{ id: 'a', content: 'ALLOWED' }, { id: 'b', content: 'OTHER' }],
    getChatHistory: () => { calls.history++; return options.history ?? []; },
    getMemories: () => options.memories ?? [],
    getMoments: () => options.moments ?? [],
    getFinanceRecords: () => { calls.finance++; return [{ title: 'PRIVATE_WALLET' }]; }
  } };
  if (options.bridge) window.RoleWorldbookBindings = options.bridge;
  new Function('window', 'localStorage', source)(window, { getItem: () => legacy });
  return { context: window.PhoneContext.buildPhoneRoleContext('r1', 'letters'), calls };
}

test('no implicit global worldbook mounts', () => {
  assert.doesNotMatch(run().context, /ALLOWED|OTHER/);
});
test('explicit role binding includes only mounted book', () => {
  const { context } = run({ ...role, worldBookIds: ['a'] });
  assert.match(context, /ALLOWED/); assert.doesNotMatch(context, /OTHER/);
});
test('legacy explicit worldbook mount preserved', () => {
  assert.match(run(role, '["a"]').context, /ALLOWED/);
});
test('explicit clear overrides stale role binding', () => {
  assert.doesNotMatch(run({ ...role, worldBookIds: ['a'] }, '[]').context, /ALLOWED/);
});
test('corrupt mount fails closed', () => {
  assert.doesNotMatch(run({ ...role, worldBookIds: ['a'] }, 'bad').context, /ALLOWED/);
});
test('binding bridge failure cannot widen scope', () => {
  const { context } = run({ ...role, worldBookIds: ['a'] }, null, {
    bridge: { filterBooks: () => ({ ok: false }) }
  });
  assert.doesNotMatch(context, /ALLOWED|OTHER/);
});
test('confirmed and explicitly role-scoped legacy memory allowed, pending and conflicting ownership denied', () => {
  const { context } = run(role, null, { memories: [
    { content: 'CONFIRMED', status: 'confirmed', sourceRoleId: 'r1' },
    { content: 'PENDING', status: 'pending' },
    { content: 'OTHER_MEMORY', sourceRoleId: 'r2' },
    'LEGACY_ROLE_KEY'
  ] });
  assert.match(context, /CONFIRMED/); assert.match(context, /LEGACY_ROLE_KEY/);
  assert.doesNotMatch(context, /PENDING|OTHER_MEMORY/);
});
test('history sender identity, silent/group records, and single history read', () => {
  const { context, calls } = run(role, null, { history: [
    { role: 'received', text: 'ROLE_MESSAGE' },
    { role: 'sent', text: 'USER_MESSAGE' },
    { role: 'system', text: 'SYSTEM_ONLY' },
    { role: 'assistant', silent: true, text: 'HIDDEN' },
    { role: 'received', memberId: 'r2', text: 'WRONG_MEMBER' },
    { role: 'assistant', groupId: 'g', text: 'GROUP' }
  ] });
  assert.match(context, /R：ROLE_MESSAGE/); assert.match(context, /用户：USER_MESSAGE/);
  assert.doesNotMatch(context, /SYSTEM_ONLY|HIDDEN|WRONG_MEMBER|GROUP/);
  assert.equal(calls.history, 1);
});
test('cross-app snapshots enforce visible scope and do not read finance', () => {
  const { context, calls } = run(role, null, { moments: [
    { authorId: 'me', visibility: 'public', content: 'USER_PUBLIC' },
    { authorId: 'me', visibility: 'custom', visibleTo: ['r1'], content: 'USER_ALLOWED' },
    { authorId: 'me', visibility: 'private', content: 'USER_PRIVATE' },
    { authorId: 'me', visibility: 'custom', visibleTo: ['r2'], content: 'USER_DENIED' },
    { authorId: 'r2', visibility: 'public', content: 'OTHER_POST' },
    { authorId: 'r1', visibility: 'public', content: 'ROLE_PUBLIC' },
    { authorId: 'me', content: 'UNKNOWN_VIS' }
  ] });
  for (const allowed of ['USER_PUBLIC','USER_ALLOWED','ROLE_PUBLIC']) assert.ok(context.includes(allowed));
  assert.doesNotMatch(context, /USER_PRIVATE|USER_DENIED|OTHER_POST|UNKNOWN_VIS|PRIVATE_WALLET/);
  assert.equal(calls.finance, 0);
});
test('duplicate role identity fails closed before reading data', () => {
  const { context, calls } = run(role, null, { characters: [role, { ...role, name: 'OTHER' }] });
  assert.doesNotMatch(context, /姓名/);
  assert.equal(calls.history, 0); assert.equal(calls.finance, 0);
});
