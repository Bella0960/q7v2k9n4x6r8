import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-DIARY-001 · 日记应用写入可信性契约
 * 从 diary/diary.html 截取真实实现，在隔离上下文跑真实函数：
 * 置顶/收藏、角色自动涂鸦、角色自己写日记、偷看开关都必须「写成功才算完成」。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(resolve(root, 'diary/diary.html'), 'utf8');

function slice(from, to) {
  const start = page.indexOf(from);
  const end = page.indexOf(to, start);
  assert.ok(start > 0 && end > start, `cannot slice ${from}`);
  return page.slice(start, end);
}

const persistBlock = slice('  function persist(){', '  function hydratePhotos(');
const flagBlock = slice('  function toggleEntryFlag(', '  function renderPhotoPreview(');
const autoWriteBlock = slice('  function maybeAutoWriteCharEntry(){', '  setTimeout(maybeAutoWriteCharEntry,3000);');
const autoPeekBlock = slice('  function maybeAutoPeek(){', '  setTimeout(maybeAutoPeek,1800);');

function makeStore(seed = {}) {
  const raw = { ...seed };
  let quota = false;
  return {
    getItem: (k) => (k in raw ? raw[k] : null),
    setItem: (k, v) => {
      if (quota) throw Object.assign(new Error('QuotaExceededError'), { name: 'QuotaExceededError' });
      raw[k] = String(v);
    },
    removeItem: (k) => { delete raw[k]; },
    failWrites: (flag) => { quota = flag; },
    raw,
  };
}

function makeSandbox({ store, entries = [], role = { id: 'roleA', name: '阿岚' }, aiText = '今天风很大，窗台上的绿植被吹得一直点头。我把咖啡放在窗边，看它慢慢凉掉，忽然很想跟你说一句没什么用的废话。' }) {
  const toasts = [];
  const sandbox = {
    localStorage: store,
    STORAGE_KEY: 'maomao_diary_entries_v1',
    entries,
    peekBusy: false,
    showToast: (m) => toasts.push(m),
    render: () => {},
    todayKey: () => '2026-11-23',
    peekEnabled: () => true,
    peekCurrentRole: () => role,
    diaryCharacters: () => [role],
    sorted: (list) => list.slice(),
    console,
    JSON,
    Object,
    String,
    Number,
    Array,
    Date,
    Math,
    Promise,
    Error,
  };
  sandbox.window = sandbox;
  sandbox.PhoneAPI = { complete: () => Promise.resolve(aiText) };
  vm.createContext(sandbox);
  vm.runInContext(persistBlock + '\n' + flagBlock + '\n' + autoWriteBlock + '\n' + autoPeekBlock, sandbox);
  return { sb: sandbox, toasts };
}

test('persist：成功返回 true 且不把照片写进文字存档', () => {
  const store = makeStore();
  const entries = [{ id: 'd1', date: '2026-11-23', title: '标题', photo: 'data:image/png;base64,AA', photos: ['x'] }];
  const { sb } = makeSandbox({ store, entries });
  assert.equal(sb.persist(), true);
  const saved = JSON.parse(store.raw.maomao_diary_entries_v1);
  assert.equal(saved[0].title, '标题');
  assert.equal('photo' in saved[0], false, 'photos must stay out of the text store');
  assert.equal('photos' in saved[0], false);
});

test('置顶：写成功才生效并提示', () => {
  const store = makeStore();
  const entries = [{ id: 'd1', date: '2026-11-23', pinned: false }];
  const { sb, toasts } = makeSandbox({ store, entries });
  sb.togglePinned('d1');
  assert.equal(sb.entries[0].pinned, true);
  assert.equal(JSON.parse(store.raw.maomao_diary_entries_v1)[0].pinned, true);
  assert.ok(toasts.some((t) => t.includes('已置顶')));
});

test('置顶写失败：标记翻回去，updatedAt 也还原，并明说没保存', () => {
  const store = makeStore();
  const entries = [{ id: 'd1', date: '2026-11-23', pinned: false, updatedAt: '2026-11-20T00:00:00.000Z' }];
  const { sb, toasts } = makeSandbox({ store, entries });
  store.failWrites(true);

  sb.togglePinned('d1');
  assert.equal(sb.entries[0].pinned, false, 'flag must not look pinned when save failed');
  assert.equal(sb.entries[0].updatedAt, '2026-11-20T00:00:00.000Z', 'timestamp must roll back too');
  assert.ok(toasts.some((t) => t.includes('没能保存')), 'failure must be explained');
});

test('收藏写失败同样回滚', () => {
  const store = makeStore();
  const entries = [{ id: 'd1', date: '2026-11-23', favorite: true }];
  const { sb } = makeSandbox({ store, entries });
  store.failWrites(true);
  sb.toggleFavorite('d1');
  assert.equal(sb.entries[0].favorite, true);
});

test('角色自动写日记：写失败时这条日记被收回，不留在内存里', async () => {
  const store = makeStore();
  const { sb } = makeSandbox({ store, entries: [] });
  store.failWrites(true);

  sb.maybeAutoWriteCharEntry();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sb.entries.length, 0, 'failed char entry must be rolled back');
});

test('角色自动写日记：写成功时入库并记录时间戳', async () => {
  const store = makeStore();
  const { sb } = makeSandbox({ store, entries: [] });

  sb.maybeAutoWriteCharEntry();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sb.entries.length, 1);
  assert.equal(sb.entries[0].author, 'roleA');
  assert.equal(JSON.parse(store.raw.maomao_diary_entries_v1).length, 1);
  assert.ok(store.raw['char_last_wrote_roleA'], 'write timestamp must be recorded');
});

test('角色自动涂鸦：写失败时批注被收回，不污染下一次保存', async () => {
  const store = makeStore();
  const entries = [{ id: 'd1', date: '2026-11-23', content: '今天很累', charComments: [] }];
  const { sb } = makeSandbox({ store, entries });
  store.failWrites(true);

  sb.maybeAutoPeek();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sb.entries[0].charComments.length, 0, 'failed annotation must not stay in memory');
});

test('角色自动涂鸦：写成功才留下批注', async () => {
  const store = makeStore();
  const entries = [{ id: 'd1', date: '2026-11-23', content: '今天很累', charComments: [] }];
  const { sb } = makeSandbox({ store, entries });

  sb.maybeAutoPeek();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sb.entries[0].charComments.length, 1);
  assert.equal(sb.entries[0].charComments[0].characterId, 'roleA');
  assert.equal(JSON.parse(store.raw.maomao_diary_entries_v1)[0].charComments.length, 1);
});

test('源码守卫：偷看开关检查写入结果，失败不再假装切换成功', () => {
  const at = page.indexOf("localStorage.setItem('char_peek_enabled'");
  assert.ok(at > 0, 'peek switch write must exist');
  const block = page.slice(at, at + 400);
  assert.equal(/catch\(err\)\{\s*\}/.test(block), false, 'peek switch write must not be silently swallowed');
  assert.ok(block.includes('peekSaved'), 'peek switch must branch on the write result');
});
