import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const source = read('shared/js/phone/worldbook-resolver.js');
const chatDetail = read('chat/chat/chat-detail.html');
const datePage = read('chat/date/date.html');

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); }
  };
}

function createResolver(storage) {
  const sandbox = { window: {}, Date, JSON, Array, String, Number, Object, console };
  sandbox.window.localStorage = storage || makeStorage();
  runInNewContext(source, sandbox);
  return sandbox.window.WorldbookResolver;
}

const GLOBAL_BOOK = { id: 'wb_global', title: '世界总设定', scope: 'global', content: '全局背景' };
const LOCAL_A = { id: 'wb_local_a', title: '角色A私设', scope: 'local', content: '只属于A' };
const LOCAL_B = { id: 'wb_local_b', title: '角色B私设', scope: 'local', content: '只属于B' };
const LEGACY_BOOK = { id: 'wb_legacy', title: '旧版书', content: '没有 scope 字段' };
const ALL = [GLOBAL_BOOK, LOCAL_A, LOCAL_B, LEGACY_BOOK];

// vm 里创建的数组与外部 realm 的 Array 原型不同，deepStrictEqual 会因原型不等失败，
// 统一用外部 realm 的 Array.from 归一化后再比较。
const list = (value) => Array.from(value || []);
const idsOf = (result) => Array.from(result.books, (book) => String(book.id));

test('global worldbooks always apply, including legacy records without a scope field', () => {
  const resolver = createResolver();
  const result = resolver.resolve({ books: ALL, contactId: 'role-a' });
  assert.deepEqual(idsOf(result), ['wb_global', 'wb_legacy']);
  assert.equal(result.diagnostics.bindingState, 'missing');
  assert.equal(result.diagnostics.source, 'global_only');
  assert.deepEqual(list(result.diagnostics.excludedLocalIds), ['wb_local_a', 'wb_local_b']);
});

test('a local worldbook never reaches a character that did not mount it', () => {
  const storage = makeStorage({ 'chat_worldbooks_role-a': JSON.stringify(['wb_local_a']) });
  const resolver = createResolver(storage);
  const result = resolver.resolve({ books: ALL, contactId: 'role-b' });
  assert.ok(!idsOf(result).includes('wb_local_a'), '角色A的私设不得进入角色B的上下文');
  assert.ok(!idsOf(result).includes('wb_local_b'));
  assert.deepEqual(list(result.diagnostics.excludedLocalIds), ['wb_local_a', 'wb_local_b']);
});

test('a mounted local worldbook is injected alongside the global ones', () => {
  const storage = makeStorage({ 'chat_worldbooks_role-a': JSON.stringify(['wb_local_a']) });
  const resolver = createResolver(storage);
  const result = resolver.resolve({ books: ALL, contactId: 'role-a' });
  assert.deepEqual(idsOf(result), ['wb_global', 'wb_local_a', 'wb_legacy']);
  assert.equal(result.diagnostics.source, 'bound');
  assert.equal(result.diagnostics.mountedCount, 1);
  assert.deepEqual(list(result.diagnostics.excludedLocalIds), ['wb_local_b']);
});

test('an explicitly emptied mount list keeps only the global books', () => {
  const storage = makeStorage({ 'chat_worldbooks_role-a': '[]' });
  const resolver = createResolver(storage);
  const result = resolver.resolve({ books: ALL, contactId: 'role-a' });
  assert.deepEqual(idsOf(result), ['wb_global', 'wb_legacy']);
  assert.equal(result.diagnostics.bindingState, 'bound');
  assert.equal(result.diagnostics.mountedCount, 0);
});

test('object-shaped mount records are honoured, not silently dropped', () => {
  const storage = makeStorage({
    'chat_worldbooks_role-a': JSON.stringify({ worldbookIds: ['wb_local_a', 'wb_local_b'] })
  });
  const resolver = createResolver(storage);
  const result = resolver.resolve({ books: ALL, contactId: 'role-a' });
  assert.deepEqual(idsOf(result), ['wb_global', 'wb_local_a', 'wb_local_b', 'wb_legacy']);
});

test('corrupt, unparsable or id-less mount records fail closed to global books only', () => {
  const cases = [
    ['not-json{', 'corrupt'],
    [JSON.stringify({ something: 'else' }), 'corrupt'],
    [JSON.stringify('wb_local_a'), 'corrupt']
  ];
  for (const [raw, expectedState] of cases) {
    const storage = makeStorage({ 'chat_worldbooks_role-a': raw });
    const resolver = createResolver(storage);
    const result = resolver.resolve({ books: ALL, contactId: 'role-a' });
    assert.equal(result.diagnostics.bindingState, expectedState, `记录 ${raw} 应按损坏处理`);
    assert.deepEqual(idsOf(result), ['wb_global', 'wb_legacy'], `记录 ${raw} 不能放出局部书`);
  }
});

test('missing contact id resolves to global books instead of the whole library', () => {
  const resolver = createResolver();
  const withEmpty = resolver.resolve({ books: ALL, contactId: '' });
  const withoutId = resolver.resolve({ books: ALL });
  for (const result of [withEmpty, withoutId]) {
    assert.deepEqual(idsOf(result), ['wb_global', 'wb_legacy']);
    assert.equal(result.diagnostics.source, 'global_only');
  }
});

test('book order and non-array input are handled without throwing', () => {
  const resolver = createResolver();
  assert.deepEqual(idsOf(resolver.resolve({ books: [LEGACY_BOOK, GLOBAL_BOOK], contactId: 'x' })),
    ['wb_legacy', 'wb_global']);
  assert.equal(resolver.resolve({ books: null, contactId: 'x' }).books.length, 0);
  assert.equal(resolver.resolve(null).books.length, 0);
  assert.deepEqual(idsOf(resolver.resolve({ books: [null, GLOBAL_BOOK, 'junk'], contactId: 'x' })),
    ['wb_global']);
});

test('chat detail routes single-chat and group worldbooks through the same resolver', () => {
  assert.match(chatDetail, /<script src="[^"]*worldbook-resolver\.js\?v=/);
  assert.match(chatDetail, /window\.WorldbookResolver\.resolve\(\{[\s\S]{0,160}?contactId: aliasRoleId/);
  assert.doesNotMatch(chatDetail, /if \(isGroupChat\) \{\s*const mountRaw = localStorage\.getItem\('chat_worldbooks_'/,
    '单聊不得再绕过绑定过滤直接注入整库');
  assert.match(chatDetail, /wbList = wbList\.filter\(function \(book\) \{[\s\S]{0,120}?book\.scope !== 'local'/,
    '解析模块缺失时必须保留"局部书不串"的兜底');
});

test('offline date scenes apply the same binding rule for the current role', () => {
  assert.match(datePage, /<script src="[^"]*worldbook-resolver\.js\?v=/);
  assert.match(datePage, /window\.WorldbookResolver\.resolve\(\{[\s\S]{0,160}?contactId: roleId/);
  assert.match(datePage, /wbList = wbList\.filter\(function \(b\) \{[\s\S]{0,120}?b\.scope !== 'local'/);
});

const LOCAL_C = { id: 'wb_local_c', title: '角色C私设', scope: 'local', content: '只属于C' };
const GROUP_ALL = [GLOBAL_BOOK, LOCAL_A, LOCAL_B, LOCAL_C, LEGACY_BOOK];

test('a group turn may use the speaking member own local worldbook', () => {
  const storage = makeStorage({ 'chat_worldbooks_g1': JSON.stringify(['wb_local_a']) });
  const resolver = createResolver(storage);
  const result = resolver.resolve({
    books: GROUP_ALL,
    contactId: 'g1',
    speakerContactId: 'role-c'
  });
  assert.deepEqual(idsOf(result), ['wb_global', 'wb_local_a', 'wb_legacy']);
  assert.ok(!idsOf(result).includes('wb_local_c'), '发言成员未挂载的书不进入上下文');
});

test('the speaking member own binding is merged with the group binding', () => {
  const storage = makeStorage({
    'chat_worldbooks_g1': JSON.stringify(['wb_local_a']),
    'chat_worldbooks_role-c': JSON.stringify(['wb_local_c'])
  });
  const resolver = createResolver(storage);
  const result = resolver.resolve({
    books: GROUP_ALL,
    contactId: 'g1',
    speakerContactId: 'role-c'
  });
  assert.deepEqual(idsOf(result), ['wb_global', 'wb_local_a', 'wb_local_c', 'wb_legacy']);
  assert.equal(result.diagnostics.boundBy, 'both');
  assert.deepEqual(list(result.diagnostics.speakerOnlyIds), ['wb_local_c']);
  assert.deepEqual(list(result.diagnostics.excludedLocalIds), ['wb_local_b']);
});

test('a book mounted by both the group and the speaker is injected only once', () => {
  const storage = makeStorage({
    'chat_worldbooks_g1': JSON.stringify(['wb_local_a', 'wb_local_c']),
    'chat_worldbooks_role-c': JSON.stringify(['wb_local_c'])
  });
  const resolver = createResolver(storage);
  const result = resolver.resolve({
    books: GROUP_ALL,
    contactId: 'g1',
    speakerContactId: 'role-c'
  });
  const occurrences = idsOf(result).filter((id) => id === 'wb_local_c').length;
  assert.equal(occurrences, 1);
  assert.deepEqual(list(result.diagnostics.speakerOnlyIds), []);
});

test('without a speaker id a group turn falls back to the group binding only', () => {
  const storage = makeStorage({ 'chat_worldbooks_role-c': JSON.stringify(['wb_local_c']) });
  const resolver = createResolver(storage);
  const result = resolver.resolve({ books: GROUP_ALL, contactId: 'g1', speakerContactId: '' });
  assert.deepEqual(idsOf(result), ['wb_global', 'wb_legacy']);
  assert.equal(result.diagnostics.speakerBindingState, 'not_provided');
  assert.equal(result.diagnostics.source, 'global_only');
});

test('a speaker id equal to the conversation id is not read twice', () => {
  const storage = makeStorage({ 'chat_worldbooks_g1': JSON.stringify(['wb_local_a']) });
  const resolver = createResolver(storage);
  const result = resolver.resolve({ books: GROUP_ALL, contactId: 'g1', speakerContactId: 'g1' });
  assert.deepEqual(idsOf(result), ['wb_global', 'wb_local_a', 'wb_legacy']);
  assert.equal(result.diagnostics.speakerBindingState, 'not_provided');
});

test('group chat passes the speaker id only from the current turn pick', () => {
  assert.match(chatDetail, /const speakerContactId = \(isGroupChat && groupReplyPick && groupReplyPick\.id != null\)/);
  assert.match(chatDetail, /speakerContactId: speakerContactId/);
});
