import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';

/* APP-POSTER-001 · 视觉档案 / 互动海报（poster/poster.html）
 * 重点回归：
 *  1. 异步保存的竞态：FileReader 期间关闭弹窗/切换作品，不得把图片写到错误的作品上
 *  2. 校验必须发生在改动之前，超大图片被拒绝时不能悄悄改掉内存里的标题
 *  3. art 字段拼进 className/innerHTML 前必须过白名单
 *  4. 旧数据不丢：键名不变，写入失败回滚
 * 全部本地 mock，无网络请求。 */

const root = fileURLToPath(new URL('../', import.meta.url));
const page = readFileSync(resolve(root, 'poster/poster.html'), 'utf8');

const script = (() => {
  const start = page.indexOf('<script>');
  const end = page.indexOf('</script>', start);
  assert.ok(start > 0 && end > start, 'poster script not found');
  return page.slice(start + '<script>'.length, end);
})();

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
    failWrites: (f) => { quota = f; },
    raw,
  };
}

function makeEl(id) {
  const el = {
    id, innerHTML: '', textContent: '', value: '', type: '', className: '', alt: '',
    style: { cssText: '' },
    files: [],
    dataset: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, on) { if (on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    _h: {},
    setAttribute() {}, getAttribute() { return null; },
    addEventListener(ev, fn) { this._h[ev] = fn; },
    appendChild(c) { (this._children = this._children || []).push(c); },
    /* render() 里 copy.innerHTML 后会立即 querySelector 取出标题/说明占位 */
    querySelector(sel) {
      this._qs = this._qs || {};
      if (!this._qs[sel]) this._qs[sel] = makeEl(sel);
      return this._qs[sel];
    },
    querySelectorAll() { return []; },
    onclick: null,
    src: '',
  };
  return el;
}

function makeRuntime({ store, confirmAnswer = true, imageData = 'data:image/jpeg;base64,NEWIMG' } = {}) {
  const els = {};
  const alerts = [];
  const readers = [];
  const gridItems = [];
  const sandbox = {
    localStorage: store,
    document: {
      getElementById: (id) => (els[id] = els[id] || makeEl(id)),
      querySelectorAll: (sel) => (sel === '[data-filter]' ? [els.fAll || (els.fAll = makeEl('fAll'))] : []),
      createElement: (tag) => makeEl(tag),
      addEventListener() {},
      body: makeEl('body'),
    },
    confirm: () => confirmAnswer,
    alert: (m) => alerts.push(m),
    /* FileReader 桩：记录 reader，让测试控制异步完成时机 */
    FileReader: class {
      constructor() { readers.push(this); }
      readAsDataURL() {}
    },
    requestAnimationFrame: (fn) => fn(Date.now()),
    JSON, Object, String, Number, Array, Math, Date, RegExp, Error, console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  const get = (id) => (els[id] = els[id] || makeEl(id));
  return { sb: sandbox, get, alerts, readers, store };
}

const SEED = JSON.stringify([
  { id: 1, title: 'Still, Here', caption: 'A STUDY OF PRESENCE', type: 'portrait', desc: '笔记', art: 'a1' },
  { id: 2, title: 'Objects in Silence', caption: 'ORDINARY', type: 'still', desc: '物件', art: 'a2' },
]);

test('旧数据不丢：已有档案按原键读出，标题与注释保留', () => {
  const store = makeStore({ maomao_visual_archive_v1: SEED });
  const { get } = makeRuntime({ store });
  assert.ok(get('total').innerHTML.includes('02'), '计数必须来自真实存档');
});

test('键名不变：写入仍落在 maomao_visual_archive_v1', () => {
  const store = makeStore({ maomao_visual_archive_v1: SEED });
  const r = makeRuntime({ store });
  r.sb.openWork(1);                       // 打开作品后再保存
  r.get('editTitle').value = '改后的标题';
  r.get('save').onclick();
  assert.ok(store.raw.maomao_visual_archive_v1, '必须写原键');
  const works = JSON.parse(store.raw.maomao_visual_archive_v1);
  assert.equal(works[0].title, '改后的标题');
});

test('P1 异步保存竞态：FileReader 未完成时切换作品，图片仍写到原目标', () => {
  const store = makeStore({ maomao_visual_archive_v1: SEED });
  const r = makeRuntime({ store });

  r.sb.openWork(1);                       // 打开作品 1
  r.get('editTitle').value = '作品一的图';
  r.get('editImage').files = [{ size: 1000 }];
  r.get('save').onclick();                 // 触发异步读图（尚未完成）
  assert.equal(r.readers.length, 1);

  r.sb.openWork(2);                       // 用户切到作品 2（current 已变）

  r.readers[0].result = 'data:image/jpeg;base64,IMG1';
  r.readers[0].onload();                  // 读图完成

  const works = JSON.parse(store.raw.maomao_visual_archive_v1);
  assert.equal(works[0].image, 'data:image/jpeg;base64,IMG1', '图必须写到作品 1');
  assert.equal(works[1].image, undefined, '不得写到作品 2');
  assert.equal(works[0].title, '作品一的图');
});

test('P1 续：FileReader 期间关闭弹窗，保存仍完成且不报错', () => {
  const store = makeStore({ maomao_visual_archive_v1: SEED });
  const r = makeRuntime({ store });

  r.sb.openWork(2);
  r.get('editTitle').value = '作品二的图';
  r.get('editImage').files = [{ size: 1000 }];
  r.get('save').onclick();
  r.sb.closeModal();                      // 保存过程中关闭
  r.readers[0].result = 'data:image/png;base64,IMG2';
  r.readers[0].onload();

  const works = JSON.parse(store.raw.maomao_visual_archive_v1);
  assert.equal(works[1].image, 'data:image/png;base64,IMG2');
  assert.equal(works[1].title, '作品二的图');
});

test('P1 校验在前：超大图片被拒绝时，标题不得悄悄改掉', () => {
  const store = makeStore({ maomao_visual_archive_v1: SEED });
  const r = makeRuntime({ store });
  r.sb.openWork(1);
  r.get('editTitle').value = '不该被保存的标题';
  r.get('editImage').files = [{ size: 2 * 1024 * 1024 }];
  r.get('save').onclick();

  assert.ok(r.alerts.some((a) => a.includes('1.5MB')), '必须提示图片过大');
  const works = JSON.parse(store.raw.maomao_visual_archive_v1);
  assert.equal(works[0].title, 'Still, Here', '内存里的标题不能被改');
  assert.equal(works[0].image, undefined);
});

test('写入失败回滚：收藏切换在配额满时不生效', () => {
  const store = makeStore({ maomao_visual_archive_v1: SEED });
  const r = makeRuntime({ store });
  r.sb.openWork(1);
  store.failWrites(true);
  r.get('favorite').onclick();

  const works = JSON.parse(store.raw.maomao_visual_archive_v1);
  assert.equal(works[0].favorite, undefined);
  assert.ok(r.alerts.length > 0, '要提示保存失败');
});

test('art 白名单：非法 art 不进入 className / innerHTML', () => {
  const store = makeStore({
    maomao_visual_archive_v1: JSON.stringify([
      { id: 1, title: 'x', type: 'still', art: 'x" onerror="alert(1)' },
    ]),
  });
  const r = makeRuntime({ store });
  r.sb.openWork(1);
  const html = r.get('detailArt').innerHTML;
  assert.equal(html.includes('onerror'), false, '属性注入必须被拦掉');
  assert.ok(html.includes('art a2'), '非法值回落 a2');
  /* 375px 网格样式仍然存在 */
  assert.ok(page.includes('@media(max-width:560px)'), '移动端断点保留');
});

test('P1 保存失败回滚：图片与标题不得在后续成功写入中偷偷落盘', () => {
  const store = makeStore({ maomao_visual_archive_v1: SEED });
  const r = makeRuntime({ store });
  r.sb.openWork(1);
  r.get('editTitle').value = '未保存标题';
  r.get('editDesc').value = '未保存说明';
  r.get('editImage').files = [{ size: 1000 }];
  r.get('save').onclick();
  store.failWrites(true);
  r.readers[0].result = 'data:image/png;base64,UNSAVED';
  r.readers[0].onload();
  assert.ok(r.alerts.some(x => x.includes('存储')), '写入失败需提示');
  store.failWrites(false);
  r.get('favorite').onclick();  // 另一项成功操作不得把前一次失败的编辑顺带保存
  const saved = JSON.parse(store.raw.maomao_visual_archive_v1)[0];
  assert.equal(saved.title, 'Still, Here');
  assert.equal(saved.desc, '笔记');
  assert.equal(saved.image, undefined);
  assert.equal(saved.favorite, true);
});

test('P1 收藏失败回滚：再次保存不能顺带记录失败的收藏', () => {
  const store = makeStore({ maomao_visual_archive_v1: SEED });
  const r = makeRuntime({ store });
  r.sb.openWork(1);
  store.failWrites(true);
  r.get('favorite').onclick();
  store.failWrites(false);
  r.get('save').onclick();
  assert.equal(JSON.parse(store.raw.maomao_visual_archive_v1)[0].favorite, undefined);
});

test('P1 同一作品的旧读图回调不得覆盖更新的保存；读图报错要提示', () => {
  const store = makeStore({ maomao_visual_archive_v1: SEED });
  const r = makeRuntime({ store });
  r.sb.openWork(1);
  r.get('editTitle').value = '旧编辑';
  r.get('editImage').files = [{ size: 1000 }];
  r.get('save').onclick();
  r.get('editTitle').value = '新编辑';
  r.get('save').onclick();
  assert.equal(r.readers.length, 2);
  r.readers[1].result = 'data:image/png;base64,NEW';
  r.readers[1].onload();
  r.readers[0].result = 'data:image/png;base64,OLD';
  r.readers[0].onload();
  const saved = JSON.parse(store.raw.maomao_visual_archive_v1)[0];
  assert.equal(saved.title, '新编辑');
  assert.equal(saved.image, 'data:image/png;base64,NEW');

  r.sb.openWork(2);
  r.get('editImage').files = [{ size: 1000 }];
  r.get('save').onclick();
  r.readers[2].onerror();
  assert.ok(r.alerts.some(x => x.includes('图片读取失败')));
});

test('源码守卫：save 锁定目标、校验前置、无网络调用', () => {
  assert.ok(script.includes('const target=current;'), '保存必须锁定目标作品');
  assert.ok(script.includes('if(file&&file.size>1.5*1024*1024)'), '图片大小校验必须在改动前');
  const titleAt = script.indexOf("current.title=title;");
  assert.equal(titleAt, -1, '不得再先改 current 再校验');
  assert.ok(script.includes('target.title=title'));
  assert.equal(/fetch\(|PhoneAPI|XMLHttpRequest/.test(script), false, '海报页无网络/模型调用');
  assert.ok(script.includes('safeArt'), 'art 必须过白名单');
  assert.equal(/Made by|作者：/.test(page), false, 'no developer signature');
});
