import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-TRAVEL-001 · 触梦旅行存档写入可信性契约
 * 从 travel/dream-travel.html 截取真实实现，在隔离上下文跑真实函数：
 * 抵达、收藏、票根、手札、导入都必须「写成功才算完成」，失败整份回滚且可重试。
 * 源码级行为测试，不是浏览器 E2E。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(resolve(root, 'travel/dream-travel.html'), 'utf8');

function slice(from, to) {
  const start = page.indexOf(from);
  const end = page.indexOf(to, start);
  assert.ok(start > 0 && end > start, `cannot slice ${from}`);
  return page.slice(start, end);
}

const storeBlock = slice('function loadData(){', 'function esc(');
const helperBlock = slice('function dateKey(', 'function toast(');
const markVisitedBlock = slice('function markVisited(', 'function copyPlaceText(');
const arriveBlock = slice('function arriveTicket(', 'function cancelTicket(');
const noteBlock = slice('function saveNote(', 'function deleteNote(');
const importBlock = slice('function importBackup(', 'main.addEventListener(');

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

function makeSandbox(store, seedData) {
  const toasts = [];
  const fields = {};
  const sandbox = {
    localStorage: store,
    STORE_KEY: 'maomao_dream_travel_v1',
    destinations: [{ id: 'moon-sea', name: '月光海', gift: '潮汐贝壳' }, { id: 'cloud-train', name: '云端列车', gift: '车票' }],
    data: seedData,
    view: 'explore',
    editingNoteId: null,
    scroller: { scrollTop: 0 },
    toast: (m) => toasts.push(m),
    render: () => {},
    setView: () => {},
    $: (id) => (fields[id] = fields[id] || { value: '', innerHTML: '', hidden: false, classList: { add() {}, remove() {}, toggle() {} }, focus() {} }),
    confirm: () => true,
    iconSvg: () => '<svg></svg>',
    closeNote: () => {},
    closeBooking: () => {},
    closeDetail: () => {},
    Date,
    Math,
    JSON,
    Object,
    String,
    Number,
    Array,
    isNaN,
  };
  for (const id of ['noteTitle', 'noteContent', 'noteDate', 'notePlace']) {
    fields[id] = { value: '', innerHTML: '', hidden: false, classList: { add() {}, remove() {}, toggle() {} }, focus() {} };
  }
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(helperBlock + '\n' + storeBlock + '\n' + markVisitedBlock + '\n' + arriveBlock + '\n' + noteBlock, sandbox);
  return { sb: sandbox, toasts, fields };
}

function baseData() {
  return { favorites: [], visited: [], bookings: [], notes: [], souvenirs: [] };
}

test('persist：成功返回 true，失败返回 false 且不静默', () => {
  const store = makeStore();
  const { sb, toasts } = makeSandbox(store, baseData());
  assert.equal(sb.persist(), true);

  store.failWrites(true);
  assert.equal(sb.persist(), false);
  assert.equal(toasts.length > 0, true, 'failure must be reported to the user');
});

test('快照/回滚：整份还原且 data 引用不变', () => {
  const store = makeStore();
  const seed = baseData();
  seed.visited.push('moon-sea');
  seed.notes.push({ id: 'n1', title: '旧', content: 'a' });
  const { sb } = makeSandbox(store, seed);
  const held = sb.data;

  const snap = sb.snapshotData();
  sb.data.visited.push('cloud-train');
  sb.data.notes[0].title = '被改了';
  sb.data.bookings.push({ id: 't9' });

  sb.restoreData(snap);
  assert.equal(sb.data, held, 'data reference must stay the same');
  assert.deepEqual(sb.data.visited, ['moon-sea']);
  assert.equal(sb.data.notes[0].title, '旧', 'nested objects must be restored too');
  assert.equal(sb.data.bookings.length, 0);
});

test('markVisited 写失败：visited 与纪念品都不留下', () => {
  const store = makeStore();
  const { sb } = makeSandbox(store, baseData());
  store.failWrites(true);

  sb.markVisited('moon-sea');
  assert.deepEqual(sb.data.visited, [], 'failed visit must not stay in memory');
  assert.deepEqual(sb.data.souvenirs, [], 'failed souvenir must not stay in memory');
});

test('markVisited 失败后下次成功写入不携带', () => {
  const store = makeStore();
  const { sb } = makeSandbox(store, baseData());
  store.failWrites(true);
  sb.markVisited('moon-sea');
  store.failWrites(false);

  sb.markVisited('cloud-train');
  assert.deepEqual(sb.data.visited, ['cloud-train']);
  assert.deepEqual(JSON.parse(store.raw.maomao_dream_travel_v1).visited, ['cloud-train']);
});

test('arriveTicket 写失败：票根状态与护照都回到抵达前', () => {
  const store = makeStore();
  const seed = baseData();
  seed.bookings.push({ id: 't1', placeId: 'moon-sea', date: '2026-11-24', status: 'planned' });
  const { sb } = makeSandbox(store, seed);
  store.failWrites(true);

  sb.arriveTicket('t1');
  assert.equal(sb.data.bookings[0].status, 'planned', 'ticket must not look arrived when save failed');
  assert.deepEqual(sb.data.visited, []);
  assert.deepEqual(sb.data.souvenirs, []);
});

test('saveNote 新写失败：手札不入列表，可重写一次', () => {
  const store = makeStore();
  const { sb, fields } = makeSandbox(store, baseData());
  fields.noteTitle.value = '雨夜';
  fields.noteContent.value = '在月光海待了很久';
  fields.noteDate.value = '2026-11-24';
  fields.notePlace.value = 'moon-sea';

  store.failWrites(true);
  sb.saveNote();
  assert.equal(sb.data.notes.length, 0, 'failed note must not stay in memory');

  store.failWrites(false);
  sb.saveNote();
  assert.equal(sb.data.notes.length, 1);
  assert.equal(JSON.parse(store.raw.maomao_dream_travel_v1).notes.length, 1);
});

test('saveNote 编辑失败：原手札内容不被改坏', () => {
  const store = makeStore();
  const seed = baseData();
  seed.notes.push({ id: 'n1', date: '2026-11-20', title: '原题', content: '原文', placeId: '', updatedAt: 'x' });
  const { sb, fields } = makeSandbox(store, seed);
  assert.equal(sb.persist(), true, 'seed must exist on disk before the failed edit');
  sb.editingNoteId = 'n1';
  fields.noteTitle.value = '改坏了';
  fields.noteContent.value = '新内容';

  store.failWrites(true);
  sb.saveNote();

  assert.equal(sb.data.notes[0].title, '原题', 'in-place edit must be rolled back on failure');
  assert.equal(sb.data.notes[0].content, '原文');
  assert.equal(JSON.parse(store.raw.maomao_dream_travel_v1).notes[0].title, '原题');
});

test('源码守卫：四个写入点都是「先快照、失败整份回滚」', () => {
  for (const [name, block] of [
    ['markVisited', markVisitedBlock],
    ['arriveTicket', arriveBlock],
    ['saveNote', noteBlock],
    ['importBackup', importBlock],
  ]) {
    assert.ok(block.includes('snapshotData()'), `${name} must snapshot before mutating`);
    assert.ok(block.includes('restoreData(before)'), `${name} must restore on failure`);
  }
  /* 只约束写入：读取失败回退到生成图、选区设置失败等都是无副作用的降级。 */
  const writeLines = page.split('\n').filter((l) => l.includes('setItem('));
  assert.equal(writeLines.length > 0, true, 'storage writes must exist');
  for (const line of writeLines) {
    assert.equal(/catch\(e\)\{\s*\}/.test(line), false, 'storage write must not be silently swallowed: ' + line.slice(0, 120));
  }
});

test('票根图写入失败会提示，不再空 catch', () => {
  const at = page.indexOf("localStorage.setItem('dream_ticket_img_'");
  assert.ok(at > 0, 'ticket image write not found');
  const line = page.slice(at, page.indexOf('\n', at));
  assert.equal(/catch\(e\)\{\s*\}/.test(line), false, 'ticket image failure must not be silent');
  assert.ok(line.includes('toast('), 'ticket image failure must tell the user');
});
