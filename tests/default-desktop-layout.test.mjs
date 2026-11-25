import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const widgetManager = readFileSync(new URL('../desktop/widgets.html', import.meta.url), 'utf8');
const desktopCss = readFileSync(new URL('../desktop/css/styles.css', import.meta.url), 'utf8');
const mobileCss = readFileSync(new URL('../shared/css/mobile-fit.css', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const desktopScript = readFileSync(new URL('../desktop/js/script.js', import.meta.url), 'utf8');

function extractDefaultPages(source) {
  const match = source.match(/function getDefaultLayout\(\)\s*\{[\s\S]*?pages:\s*\[([\s\S]*?)\],\s*dock:/);
  assert.ok(match, 'getDefaultLayout must declare its page distribution');
  return [...match[1].matchAll(/\[((?:\s*'[^']+'\s*,?)+)\]/g)].map((page) =>
    [...page[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
  );
}

test('default home has the clock, duo avatars, photo wall and app quadrants in the requested order', () => {
  const pages = extractDefaultPages(index);
  assert.deepEqual(pages[0], [
    'clock-lg',
    'app_inspect', 'app_worldbook', 'app_memory', 'app_forum',
    'duo', 'photowall',
    'app_wallet', 'app_music', 'app_beauty', 'app_theme_store'
  ]);
  assert.equal(pages.length, 3);
  assert.equal(pages[1][0], 'app_characters');
  assert.equal(pages[1][1], 'app_encounter', '邂逅必须出现在角色库旁');
  assert.match(index, /v:\s*14,/);
  assert.match(index, /var LS_KEY = 'ds_layout_v14'/);
});

test('encounter entry preserves removed apps and saved desktop layout', () => {
  assert.match(index, /data-href="encounter\/encounter\.html" data-drag="app_encounter"/);
  assert.match(index, /function addEncounterShortcutToExistingLayouts\(\)/);
  assert.match(index, /currentLayout\.removed \|\| \[\]/);
});

test('old desktop layouts are migrated without destroying saved positions', () => {
  assert.match(index, /for \(var version = 13; version >= 1; version--\)/);
  assert.match(index, /readJSON\('ds_layout_v' \+ version\)/);
  assert.doesNotMatch(index, /localStorage\.removeItem\(key\)/);
  assert.match(widgetManager, /var LS_KEY = 'ds_layout_v14'/);
});

test('every desktop app is assigned exactly once and dock apps stay in the dock', () => {
  const pages = extractDefaultPages(index);
  const assigned = pages.flat();
  const appIds = [...new Set([...index.matchAll(/data-drag="(app_[^"]+)"/g)].map((m) => m[1]))]
    .filter((id) => id !== 'app_chat' && id !== 'app_shop' && id !== 'app_admin_center');
  // The super-admin-only entry is intentionally hidden until account authorization.
  assert.match(index, /data-drag="app_admin_center"[^>]*\bhidden>/);
  assert.equal(new Set(assigned).size, assigned.length, 'default pages must not contain duplicate items');
  assert.deepEqual([...assigned].filter((id) => id.startsWith('app_')).sort(), [...appIds].sort());
  assert.match(index, /dock:\s*\['app_chat',\s*'app_shop'\]/);
});

test('the mobile home grid keeps four columns and supports vertical page scrolling', () => {
  assert.match(mobileCss, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)\s*!important/);
  assert.match(mobileCss, /grid-auto-rows:\s*68px\s*!important/);
  assert.match(desktopCss, /#gridPage0\.is-default-layout > \[data-drag\]:nth-child\(6\)[^{]*\{ grid-column: 3 \/ 5 !important; grid-row: 3 \/ 5 !important;/);
  assert.match(mobileCss, /#gridPage0\.is-default-layout > \[data-drag\]:nth-child\(7\)[^{]*\{ grid-column: 1 \/ 3 !important; grid-row: 5 \/ 7 !important;/);
  assert.match(mobileCss, /\.maomao-home \.home-page[\s\S]*?overflow-y:\s*auto\s*!important/);
  assert.ok(Number(serviceWorker.match(/^const CACHE_NAME = 'phone-app-pwa-v(\d+)'/m)?.[1] || 0) >= 241, 'PWA must retain the network-first account cache baseline');
});


test('all home photo upload slots persist and restore through IndexedDB', () => {
  assert.match(index, /home_widget_upload_v1_/,
    'every photo slot must have a stable widget-scoped storage key');
  assert.match(index, /imageStore\.getByKey\(storageKey\)/,
    'saved photos must be restored from the shared IndexedDB image store');
  assert.match(index, /imageStore\.saveByKey\(storageKey, dataUrl\)/,
    'newly uploaded photos must be persisted before being treated as saved');
  assert.match(index, /function preparePhoto\(file\)/,
    'uploaded photos must be resized before storage');
  assert.doesNotMatch(index, /var avatar = document\.getElementById\('pfAvatar'\)/,
    'the profile avatar must not install a second upload listener');
});

test('all desktop app tiles have valid relative destinations and delegated click navigation', () => {
  const hrefs = [...index.matchAll(/<button\b(?=[^>]*\bapp-tile\b)[^>]*\bdata-href="([^"]+)"[^>]*>/g)]
    .map((match) => match[1]);
  assert.ok(hrefs.length >= 20, 'expected all desktop app tiles to expose destinations');
  assert.equal(new Set(hrefs).size, hrefs.length, 'app destinations should be unique');
  for (const href of hrefs) {
    assert.doesNotMatch(href, /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i, 'app routes must remain same-origin relative paths');
    assert.ok(existsSync(new URL('../' + href, import.meta.url)), 'missing app destination: ' + href);
  }
  assert.match(index, /target\.closest\('\.app-tile\[data-href\]'\)/);
  assert.match(index, /new URL\(href, document\.baseURI\)/);
  assert.match(index, /destination\.origin !== window\.location\.origin/,
    'app navigation must reject cross-origin destinations');
  assert.match(index, /window\.location\.assign\(destination\.href\);\s*\}, true\);/,
    'navigation must run in capture phase before legacy gesture handlers can stop propagation');
  assert.doesNotMatch(desktopScript, /target\.closest\('\[data-href\]'\)/,
    'the legacy bubble-phase handler must not duplicate the capture-phase navigation');
  assert.match(index, /home-editing/);
});


test('only the untouched default page is subject to hardcoded art-directed positions', () => {
  assert.match(index, /function updateDefaultGridComposition\(\)/);
  assert.match(index, /!isDragging && ids\.length === expected\.length/);
  assert.doesNotMatch(desktopCss, /#gridPage0 > \[data-drag\]:nth-child/);
  assert.doesNotMatch(mobileCss, /#gridPage0 > \[data-drag\]:nth-child/);
  assert.match(index, /firstGrid\.classList\.remove\('is-default-layout'\)/);
});

test('drag placeholder inherits actual two- and three-row widget occupancy', () => {
  assert.match(index, /function getDraggedGridSpan\(el, axis\)/);
  assert.match(index, /window\.getComputedStyle\(el\)/);
  assert.match(index, /placeholder\.style\.gridColumn = 'span ' \+ Math\.min\(4, dragCols\)/);
  assert.match(index, /placeholder\.style\.gridRow = 'span ' \+ dragRows/);
  assert.doesNotMatch(desktopCss, /\.drag-placeholder\.span-4/);
});

test('layout saves report failure and the stored version remains v14', () => {
  assert.match(index, /currentLayout = \{ v: 14, pages: pagesOrder, dock: dockOrder, removed: removedOrder \}/);
  assert.match(index, /return localStorage\.getItem\(LS_KEY\) === serialized/);
  assert.match(index, /if \(!saveLayout\(currentLayout\)\)/);
});


test('widget manager checks physical grid capacity and respects the desktop page limit', () => {
  assert.match(widgetManager, /var MAX_PAGES = 4/);
  assert.match(widgetManager, /function fitsPage\(ids\)/);
  assert.match(widgetManager, /if \(layout\.pages\.length >= MAX_PAGES/);
  assert.doesNotMatch(widgetManager, /MAX_PER_PAGE = 8/);
  assert.match(widgetManager, /return localStorage\.getItem\(LS_KEY\) === serialized/);
  assert.match(widgetManager, /for \(var version = 13; version >= 1; version--\)/);
});

test('an interrupted touch drag is cancelled without a layout write', () => {
  assert.match(index, /function cancelDrag\(\)/);
  assert.match(index, /document\.addEventListener\('touchcancel', function \(\) \{[\s\S]*?cancelDrag\(\)/);
  assert.match(index, /dragClone\.removeAttribute\('data-drag'\)/);
  assert.match(index, /dragClone\.querySelectorAll\('\[id\], \[data-drag\]'\)/);
});


// These tests execute the actual embedded widget-manager functions with a mocked
// localStorage and minimal DOM. They do not use screenshots or paid APIs.
function createWidgetManagerHarness(seed = {}) {
  const blocks = [...widgetManager.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  const managerScript = blocks.map((m) => m[1]).find((s) => s.includes('function fitsPage(ids)'));
  assert.ok(managerScript, 'desktop widget manager script must be present');
  const instrumented = managerScript.replace(
    /render\(\);\s*\}\)\(\);\s*$/,
    'window.__desktopLayoutTest = { readLayout, addWidget, removeWidget, fitsPage }; render(); })();'
  );
  assert.notEqual(instrumented, managerScript, 'manager test hooks must be injected');
  const map = new Map(Object.entries(seed));
  const store = {
    failWrites: false,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) {
      if (this.failWrites) throw new Error('QuotaExceededError');
      map.set(key, String(value));
    }
  };
  const note = { textContent: 'Original widget instructions' };
  const list = { innerHTML: '', appendChild() {} };
  const document = {
    getElementById(id) { return id === 'widgetList' ? list : null; },
    querySelector(selector) { return selector === '.page-note' ? note : null; },
    createElement() {
      return { className: '', innerHTML: '', textContent: '',
        appendChild() {}, addEventListener() {} };
    }
  };
  const window = {};
  runInNewContext(instrumented, { document, localStorage: store, window, Set });
  return { ...window.__desktopLayoutTest, map, store, note };
}

test('widget manager recognizes existing defaults and places by physical 4-column capacity', () => {
  const h = createWidgetManagerHarness();
  const layout = h.readLayout();
  assert.ok(layout.pages[0].includes('clock-lg'));
  assert.ok(h.fitsPage(layout.pages[0]));
  assert.equal(h.fitsPage([...layout.pages[0], 'polaroid']), false);
  assert.equal(h.addWidget(layout, 'polaroid'), true);
  assert.equal(layout.pages[0].includes('polaroid'), false);
  assert.equal(layout.pages[1].includes('polaroid'), true);
  assert.equal(h.readLayout().pages[1].includes('polaroid'), true);
  assert.equal(h.addWidget(layout, 'polaroid'), true);
  assert.equal(layout.pages.flat().filter((id) => id === 'polaroid').length, 1);
});

test('widget removal is persisted; storage failure never reports a successful add', () => {
  const h = createWidgetManagerHarness();
  const initial = h.readLayout();
  assert.equal(h.addWidget(initial, 'polaroid'), true);
  assert.equal(h.removeWidget(h.readLayout(), 'polaroid'), true);
  assert.equal(h.readLayout().removed.includes('polaroid'), true);
  const before = h.map.get('ds_layout_v14');
  h.store.failWrites = true;
  assert.equal(h.addWidget(h.readLayout(), 'polaroid'), false);
  assert.equal(h.map.get('ds_layout_v14'), before);
  assert.match(h.note.textContent, /保存失败/);
});

test('widget manager recovers older valid layout when current version is malformed', () => {
  const old = { v: 13, pages: [['note'], [], []], dock: [], removed: [] };
  const h = createWidgetManagerHarness({
    ds_layout_v14: '{corrupted',
    ds_layout_v13: JSON.stringify(old)
  });
  assert.equal(h.readLayout().pages[0][0], 'note');
  assert.equal(h.readLayout().v, 14);
  assert.equal(h.map.get('ds_layout_v13'), JSON.stringify(old));
});

test('widget manager refuses a fifth page and preserves a full user layout', () => {
  const h = createWidgetManagerHarness();
  const full = { v: 14, pages: Array.from({ length: 4 }, () => Array(24).fill('app_test')),
    dock: [], removed: [] };
  const before = JSON.stringify(full);
  assert.equal(h.addWidget(full, 'clock'), false);
  assert.equal(JSON.stringify(full), before);
  assert.match(h.note.textContent, /桌面空间不足/);
});

test('real drag-span helper reads wide and tall grid styles, including dock fallback', () => {
  const match = index.match(/function getDraggedGridSpan\(el, axis\) \{[\s\S]*?\n      \}/);
  assert.ok(match, 'drag span function must exist');
  const cases = [
    [{ gridColumnStart: '1', gridColumnEnd: '5', gridRowStart: '1', gridRowEnd: '3' }, [4, 2]],
    [{ gridColumnStart: 'span 2', gridColumnEnd: 'auto', gridRowStart: 'auto', gridRowEnd: 'span 2' }, [2, 2]],
    [{ gridColumnStart: 'span 4', gridColumnEnd: 'auto', gridRowStart: 'auto', gridRowEnd: 'span 3' }, [4, 3]]
  ];
  for (const [style, expected] of cases) {
    const harness = { window: { getComputedStyle() { return style; } } };
    const source = match[0] + '\nwindow.__span = getDraggedGridSpan;';
    runInNewContext(source, harness);
    const element = { closest() { return {}; } };
    assert.deepEqual([harness.window.__span(element, 'column'),
      harness.window.__span(element, 'row')], expected);
    assert.equal(harness.window.__span({ closest() { return null; } }, 'column'), 1);
  }
});

test('touchcancel restores original element without persisting a partially moved layout', () => {
  const match = index.match(/function cancelDrag\(\) \{[\s\S]*?\n      \}/);
  assert.ok(match, 'cancel drag function must exist');
  const counts = { placeholder: 0, ghost: 0, cleanup: 0, refresh: 0, writes: 0 };
  const harness = {
    isDragging: true, edgeTimer: null, lastEdgeSide: 'left', edgeCooldown: true,
    dragOriginPage: null, activePageIndex: 0,
    placeholder: { remove() { counts.placeholder++; } },
    dragClone: { remove() { counts.ghost++; } },
    dragEl: { style: { display: 'none' }, classList: {
      remove(className) { assert.equal(className, 'is-dragging-source'); }
    } },
    resetDragMotion() {},
    cleanupEmptyTrailingPages() { counts.cleanup++; },
    updateDefaultGridComposition() { counts.refresh++; },
    persistCurrentDOM() { counts.writes++; },
    clearTimeout() {}
  };
  runInNewContext(match[0] + '\ncancelDrag();', harness);
  assert.equal(harness.isDragging, false);
  assert.deepEqual(counts, { placeholder: 1, ghost: 1, cleanup: 1, refresh: 1, writes: 0 });
  assert.match(index, /function interruptHomeDrag\(\) \{[\s\S]*?if \(isDragging\) cancelDrag\(\)/);
  assert.match(index, /window\.addEventListener\('blur', interruptHomeDrag\)/);
});

test('cancelled cross-page gesture navigates back without storing a drop', () => {
  const match = index.match(/function cancelDrag\(\) \{[\s\S]*?\n      \}/);
  assert.ok(match);
  let returned = -1, writes = 0;
  const context = {
    isDragging: true, edgeTimer: null, dragOriginPage: 0, activePageIndex: 1,
    placeholder: null, dragClone: null, dragEl: null,
    resetDragMotion() {},
    cleanupEmptyTrailingPages() {}, updateDefaultGridComposition() {},
    getPages() { return [{}, {}]; },
    goToPage(page) { returned = page; },
    persistCurrentDOM() { writes++; },
    clearTimeout() {}
  };
  runInNewContext(match[0] + '\ncancelDrag();', context);
  assert.equal(returned, 0);
  assert.equal(context.dragOriginPage, null);
  assert.equal(writes, 0);
});


test('all 2x2 utility widgets occupy the two physical grid rows advertised in the catalog', () => {
  assert.match(desktopCss, /\.desktop-grid \.ds-todo,[\s\S]*?\.desktop-grid \.ds-cal,[\s\S]*?\.desktop-grid \.ds-count \{[\s\S]*?grid-column: span 2;[\s\S]*?grid-row: span 2;/);
  for (const id of ['todo', 'calendar', 'countdown']) {
    assert.match(widgetManager, new RegExp("id: '" + id + "',[^\\n]*cols: 2, rows: 2"));
  }
});


function createHomeLayoutHarness(seed = {}) {
  const match = index.match(/function getDefaultLayout\(\) \{[\s\S]*?\n      var currentLayout = loadLayout\(\);/);
  assert.ok(match, 'home default/load/save layout functions must be present');
  const map = new Map(Object.entries(seed));
  const localStorage = {
    failWrites: false,
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) {
      if (this.failWrites) throw new Error('QuotaExceededError');
      map.set(key, String(value));
    }
  };
  const window = {};
  runInNewContext("var LS_KEY = 'ds_layout_v14';\n" + match[0] +
    '\nwindow.__test = { loadLayout, saveLayout, getDefaultLayout };', { localStorage, window });
  return { ...window.__test, map, localStorage };
}

test('home screen migrates a valid old layout without deleting its record', () => {
  const old = { v: 13, pages: [['duo', 'clock-lg'], ['app_forum']], dock: ['app_chat'], removed: [] };
  const h = createHomeLayoutHarness({ ds_layout_v13: JSON.stringify(old) });
  const loaded = h.loadLayout();
  assert.equal(loaded.pages[0][0], 'duo');
  assert.equal(loaded.pages[0][1], 'clock-lg');
  assert.equal(loaded.pages.length, 3);
  assert.equal(loaded.v, 14);
  assert.equal(h.saveLayout(loaded), true);
  assert.equal(JSON.parse(h.map.get('ds_layout_v14')).pages[0][0], 'duo');
  assert.equal(h.map.get('ds_layout_v13'), JSON.stringify(old));
});

test('home screen recovers from malformed v14 and protects storage on failed write', () => {
  const old = { v: 13, pages: [['note'], []], dock: [], removed: [] };
  const h = createHomeLayoutHarness({
    ds_layout_v14: '{invalid-json',
    ds_layout_v13: JSON.stringify(old)
  });
  const loaded = h.loadLayout();
  assert.equal(loaded.pages[0][0], 'note');
  const before = h.map.get('ds_layout_v14');
  h.localStorage.failWrites = true;
  assert.equal(h.saveLayout(loaded), false);
  assert.equal(h.map.get('ds_layout_v14'), before);
  assert.equal(h.map.get('ds_layout_v13'), JSON.stringify(old));
});

test('the Dock centers one to five shortcuts without losing the default app pair', () => {
  const dockRule = desktopCss.match(/(?:^|\n)\.dock-bar\s*\{([^}]+)\}/)?.[1];
  assert.ok(dockRule, 'Dock layout rule must exist');
  assert.match(dockRule, /justify-content:\s*center\s*;/,
    'a sparse Dock must keep its shortcuts centered as a group');
  const gap = Number(dockRule.match(/gap:\s*(\d+)px\s*;/)?.[1]);
  assert.equal(gap, 12, 'keep a small, consistent spacing between Dock shortcuts');
  assert.match(dockRule, /padding:\s*0\s+8px\s*;/);
  assert.match(mobileCss, /\.dock-wrapper\s*\{[^}]*padding:\s*0\s+14px\s+max\(/);
  assert.match(index, /dockItems\.length\s*>=\s*5/);
  assert.match(index, /dock:\s*\['app_chat',\s*'app_shop'\]/);
  // 375px viewport: outer 14px padding per side, Dock 8px inner padding and 1px border.
  // All five allowed 50px tiles must fit even on the narrowest required phone viewport.
  assert.ok(5 * 50 + 4 * gap <= 375 - 2 * (14 + 8 + 1));
});


test('drag input coalesces into a single frame and flushes the last point on drop', () => {
  const start = index.indexOf('function queueDragMove(');
  const end = index.indexOf('function resetDragMotion(', start);
  assert.ok(start >= 0 && end > start);
  const calls = [], frames = new Map();
  let serial = 0;
  const ctx = {
    isDragging: true, pendingDragPoint: null, latestDragPoint: null, dragFrame: null,
    requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); },
    moveDrag(x,y) { calls.push([x,y]); }
  };
  runInNewContext(index.slice(start,end),ctx);
  ctx.queueDragMove(1,2); ctx.queueDragMove(3,4); ctx.queueDragMove(5,6);
  assert.equal(frames.size,1);
  const [id,fn] = [...frames.entries()][0]; frames.delete(id); fn();
  assert.deepEqual(calls,[[5,6]]);
  ctx.queueDragMove(7,8); ctx.flushDragMove();
  assert.deepEqual(calls,[[5,6],[7,8]]);
  assert.equal(frames.size,0);
});
test('desktop motion avoids left/top writes and live glass sampling during gestures', () => {
  assert.match(index,/function setDragAvatarPosition[\s\S]*?--drag-x/);
  assert.match(index,/if \(isDragging\) return;\s*var cur = getCurrentPageFromScroll/);
  assert.match(desktopCss,/translate3d\(var\(--drag-x/);
  assert.match(desktopCss,/home-dragging \.app-icon::before[\s\S]*?backdrop-filter: none/);
});

test('desktop icons cannot shrink into a rectangle; row height accounts for text',()=>{
  assert.match(desktopCss,/flex:\s*0 0 auto !important;[\s\S]*?aspect-ratio:\s*1 \/ 1 !important/);
  assert.match(desktopCss,/--desktop-icon-row:\s*max\(72px,\s*calc\(var\(--desktop-icon-edge\) \+ 6px \+ \.86rem \+ 2px\)\)/);
  assert.match(mobileCss,/grid-auto-rows:\s*var\(--desktop-icon-row,\s*68px\) !important/);
});

test('normal touch movement remains passive; active drag alone installs and removes blocking listener',()=>{
  assert.match(index,/document\.addEventListener\('touchmove', handleActiveDragTouch, \{ passive: false \}\)/);
  assert.match(index,/document\.removeEventListener\('touchmove', handleActiveDragTouch\)/);
  assert.match(index,/function handleActiveDragTouch\(e\)[\s\S]*?if \(e\.cancelable\) e\.preventDefault\(\)/);
  assert.match(index,/document\.addEventListener\('touchmove', function \(e\) \{[\s\S]*?clearTimeout\(pressTimer\)[\s\S]*?\}, \{ passive: true \}\)/);
});
test('drag clones retain measured source dimensions; minute ticks avoid unnecessary widget updates',()=>{
  assert.match(index,/var sourceWidth = targetItem\.offsetWidth/);
  assert.match(index,/ghostIcon\.style\.setProperty\('height', iconHeight \+ 'px', 'important'\)/);
  assert.match(index,/if \(renderedDay === dayKey\) return/);
  assert.match(index,/if \(!eventEl\.isContentEditable && eventEl\.textContent !== data\.event\)/);
});


test('drag geometry cache reuses stable measurements and invalidates on real placement', () => {
  const start = index.indexOf('      function invalidateDragGeometry() {');
  const end = index.indexOf('      function setDragAvatarPosition(cx, cy) {', start);
  assert.ok(start >= 0 && end > start);
  let reads = 0, writes = 0;
  const rect = () => { reads++; return { left: 0, right: 10, top: 0, bottom: 10, width: 10, height: 10 }; };
  const tile = { getBoundingClientRect: rect };
  const placeholder = { getBoundingClientRect: rect };
  const dragEl = { getBoundingClientRect: () => { throw new Error('hidden source measured'); } };
  const grid = { children: [placeholder, tile, dragEl], insertBefore(node, sibling) {
    writes++; this.children = this.children.filter(x => x !== node);
    this.children.splice(sibling ? this.children.indexOf(sibling) : this.children.length, 0, node);
    node.parentNode = this;
  } };
  placeholder.parentNode = grid;
  const ctx = { dragBounds: null, dragGeometry: null, dragReorderAnimations: new Map(), placeholder, dragEl,
    homeScreen: { getBoundingClientRect: rect }, dockBar: { getBoundingClientRect: rect },
    nextPlaceableSibling(el) { return grid.children.slice(grid.children.indexOf(el)+1).find(x => x !== dragEl && x !== placeholder) || null; } };
  runInNewContext(index.slice(start,end) + '\nthis.api = { getDragBounds, getDragGeometry, invalidateDragGeometry, placeDragPlaceholder };', ctx);
  const api = ctx.api;
  api.getDragBounds(); api.getDragGeometry(grid);
  assert.equal(reads,4);
  for (let i=0;i<100;i++) { api.getDragBounds(); api.getDragGeometry(grid); }
  assert.equal(reads,4, 'stable drag must not remeasure tiles');
  assert.equal(api.placeDragPlaceholder(grid,tile),false);
  assert.equal(writes,0);
  assert.equal(api.placeDragPlaceholder(grid,null),true);
  assert.equal(writes,1);
  api.getDragBounds(); api.getDragGeometry(grid);
  assert.equal(reads,8,'placement must invalidate cached geometry');
  api.invalidateDragGeometry();
  api.getDragGeometry(grid);
  assert.equal(reads,10);
  assert.match(index,/document\.addEventListener\('scroll', invalidateDragGeometry, true\)/);
  assert.match(index,/document\.removeEventListener\('scroll', invalidateDragGeometry, true\)/);
  assert.match(index,/finally \{ setDragAvatarPosition\(cx, cy\); \}/);
});


test('desktop and Dock drag slot hysteresis prevents boundary jitter without locking adjacent slots', () => {
  const start = index.indexOf('      function isPointInDragSlot(');
  const end = index.indexOf('      function placeDragPlaceholder(', start);
  assert.ok(start >= 0 && end > start);
  const ctx = {};
  runInNewContext(index.slice(start,end),ctx);
  const inside = ctx.isPointInDragSlot;
  const slot = { left: 20, right: 80, top: 30, bottom: 90 };
  assert.equal(inside(null,40,40,5),false);
  for (const [x,y] of [[15,60],[85,60],[50,25],[50,95],[50,50]]) assert.equal(inside(slot,x,y,5),true);
  for (const [x,y] of [[14,60],[86,60],[50,24],[50,96]]) assert.equal(inside(slot,x,y,5),false);
  assert.match(index,/isPointInDragSlot\(dockGeometry\.slot, cx, cy, 5\)/);
  assert.match(index,/isPointInDragSlot\(geometry\.slot, cx, cy, 5\)/);
});


test('reorder visual animation preserves final hit geometry and cancels without leaking', () => {
  const start = index.indexOf('      function getDragTileRect(');
  const end = index.indexOf('      function setDragAvatarPosition(', start);
  assert.ok(start >= 0 && end > start);
  const active = new Map(), calls = [];
  let x = 0, visualOffset = 0;
  const placeholder = {}, dragEl = {};
  const tile = { offsetWidth: 40, offsetHeight: 40,
    getBoundingClientRect() { return {left:x+visualOffset, right:x+visualOffset+40, top:10, bottom:50, width:40, height:40}; },
    animate(frames,options) {
      calls.push({frames,options});
      visualOffset=parseFloat(frames[0].translate);
      return {cancel(){visualOffset=0; if(this.oncancel)this.oncancel();}};
    } };
  const grid={children:[placeholder,tile],insertBefore(){this.children=[tile,placeholder];x=40;}};
  placeholder.parentNode=grid;
  const ctx={dragReorderAnimations:active,placeholder,dragEl,
    window:{getComputedStyle(){return {translate:visualOffset+'px 0px'}},matchMedia(){return {matches:false}}},
    CSS:{supports(){return true}},nextPlaceableSibling(){return tile},invalidateDragGeometry(){}};
  runInNewContext(index.slice(start,end),ctx);
  assert.equal(ctx.placeDragPlaceholder(grid,null),true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].frames[0].translate,'-40px 0px');
  assert.equal(calls[0].options.duration,180);
  assert.equal(tile.getBoundingClientRect().left,0);
  assert.equal(ctx.getDragTileRect(tile).left,40,'hit testing must use the final slot, not the animated visual');
  ctx.stopDragReorderAnimations();
  assert.equal(active.size,0);
  assert.equal(visualOffset,0);
  assert.equal(ctx.getDragTileRect(tile).left,40);
  ctx.window.matchMedia=()=>({matches:true});
  assert.equal(ctx.canAnimateDragReorder(),false);
});


test('cross-page edge intent is cancelled over Dock, invalid boundaries and newer unpainted input', () => {
  const start=index.indexOf('      function clearDragEdgeIntent()');
  const end=index.indexOf('      function updateDragTarget(',start);
  assert.ok(start>=0&&end>start);
  const bounds={home:{left:0,right:390,top:50,bottom:720},dock:{left:0,right:390,top:700,bottom:780,width:390,height:80}};
  let flip=0;const timers=new Map();let seq=0;
  const grid={};const pages=[{querySelector:()=>grid},{querySelector:()=>grid}];
  const ctx={MAX_PAGES:4,activePageIndex:0,edgeTimer:null,lastEdgeSide:null,edgeCooldown:false,isDragging:true,placeholder:{},latestDragPoint:{x:380,y:300},getDragBounds:()=>bounds,getPages:()=>pages,setTimeout(fn){timers.set(++seq,fn);return seq;},clearTimeout(id){timers.delete(id);},goToPage(i){flip++;ctx.activePageIndex=i;},placeDragPlaceholder(){},vibrate(){},lockDragEdge(){ctx.edgeCooldown=true;}};
  runInNewContext(index.slice(start,end),ctx);
  assert.equal(ctx.getDragEdgeSide(bounds,10,300,0,2),null);
  assert.equal(ctx.getDragEdgeSide(bounds,380,740,0,2),null);
  assert.equal(ctx.getDragEdgeSide(bounds,380,300,3,4),null);
  ctx.updateDragEdgeIntent(380,300);assert.equal(timers.size,1);
  ctx.latestDragPoint={x:10,y:300};
  let [id,fn]=[...timers.entries()][0];timers.delete(id);fn();
  assert.equal(flip,0);assert.equal(ctx.lastEdgeSide,null);
  ctx.latestDragPoint={x:380,y:300};ctx.updateDragEdgeIntent(380,300);
  ctx.updateDragEdgeIntent(380,740);assert.equal(timers.size,0);
  ctx.updateDragEdgeIntent(380,300);
  [id,fn]=[...timers.entries()][0];timers.delete(id);fn();
  assert.equal(flip,1);assert.equal(ctx.activePageIndex,1);
});

test('drop consumes final touch and mouse position and interruption is a cancellation', () => {
  assert.match(index,/function endDrag\(finalPoint\)/);
  assert.match(index,/latestDragPoint = pendingDragPoint = finalPoint;[\s\S]*?flushDragMove\(\)/);
  assert.match(index,/endDrag\(touch \? \{ x: touch\.clientX, y: touch\.clientY \} : null\)/);
  assert.match(index,/endDrag\(\{ x: e\.clientX, y: e\.clientY \}\)/);
  assert.match(index,/window\.addEventListener\('pagehide', interruptHomeDrag\)/);
  assert.match(index,/if \(document\.hidden\) interruptHomeDrag\(\)/);
  assert.match(index,/if \(isDragging\) \{ endDrag\(\); return; \}/);
});


test('release settles a pending page flip, uses latest input and persists exactly once', () => {
  const start=index.indexOf('      function endDrag(finalPoint)');
  const end=index.indexOf('      // ===== 事件监听',start);
  assert.ok(start>=0&&end>start);
  const order=[], calls=[];
  const parent={id:'gridPage1',insertBefore(){order.push('place');}};
  const source={classList:{remove(){}},style:{}};
  const ph={parentNode:parent,remove(){order.push('remove-slot');}};
  const ctx={isDragging:true,dragEl:source,placeholder:ph,dragClone:{remove(){order.push('remove-ghost');}},
    dragOriginPage:0,edgeTimer:null,activePageIndex:1,latestDragPoint:{x:100,y:200},pendingDragPoint:null,
    homeScreen:{clientWidth:390,scrollLeft:210,scrollTo(options){this.scrollLeft=options.left;order.push('settle');}},
    invalidateDragGeometry(){order.push('invalidate');},
    flushDragMove(){calls.push([ctx.pendingDragPoint.x,ctx.pendingDragPoint.y]);order.push('flush');},
    resetDragMotion(){order.push('reset');},setElementAsDock(){throw Error('wrong parent');},setElementAsDesktop(){},
    vibrate(){},cleanupEmptyTrailingPages(){order.push('cleanup');},persistCurrentDOM(){order.push('save');},
    document:{body:{classList:{add(){}}}},setTimeout(){},clearTimeout(){}};
  runInNewContext(index.slice(start,end),ctx);
  ctx.endDrag({x:110,y:210});ctx.endDrag({x:120,y:220});
  assert.deepEqual(calls,[[110,210]]);
  assert.deepEqual(order,['settle','invalidate','flush','reset','place','remove-slot','remove-ghost','cleanup','save']);
  assert.equal(ctx.isDragging,false);
  assert.equal(ctx.dragEl,null);
});


test('creator-only shortcut cannot reenter ordinary layout via remaining-app restoration', () => {
  const code=index.match(/\(function configureCreatorAdminShortcut\(\) \{[\s\S]*?\n      \}\)\(\);/)?.[0];
  assert.ok(code);
  for(const role of [null,'member','super_admin']){
    const id='app_admin_center';
    const tile={hidden:true,removed:false,remove(){this.removed=true;}};
    const layout={pages:[['app_settings','app_music'],['app_forum',id]],dock:['app_chat'],removed:['clock',id]};
    let saved;
    const doc={querySelector(selector){
      if(selector==='meta[name="mao-account-role"]')return role?{content:role}:null;
      if(selector==='[data-drag="'+id+'"]')return tile;
      return null;
    }};
    runInNewContext(code,{document:doc,currentLayout:layout,saveLayout(x){saved=JSON.parse(JSON.stringify(x));}});
    assert.ok(saved);
    assert.deepEqual(saved.dock,['app_chat']);
    assert.deepEqual(saved.pages[0],['app_settings','app_music']);
    assert.deepEqual(saved.removed,['clock']);
    if(role==='super_admin'){
      assert.equal(tile.hidden,false);
      assert.equal(tile.removed,false);
      assert.equal(saved.pages.flat().filter(x=>x===id).length,1);
    }else{
      assert.equal(tile.removed,true);
      assert.equal(saved.pages.flat().includes(id),false);
      assert.equal(saved.dock.includes(id),false);
      assert.equal(saved.removed.includes(id),false);
    }
  }
});


test('desktop glass pauses expensive optical work while editing and excludes visual ghosts', () => {
  const vendor = readFileSync(new URL('../shared/vendor/liquid-glass/liquid-glass.js', import.meta.url), 'utf8');
  const glassCss = readFileSync(new URL('../shared/css/liquid-glass-theme.css', import.meta.url), 'utf8');
  const controls = readFileSync(new URL('../shared/js/liquid-glass-controls.js', import.meta.url), 'utf8');
  for(const source of [index,controls]){
    assert.ok(source.includes("selector: '.maomao-liquid-glass-icon:not([data-home-drag-ghost])'"));
    assert.ok(source.includes("deferDuring: 'body.maomao-home:is(.home-editing,.home-dragging,.home-paging):not(.lg-controls-open)'"));
  }
  assert.match(index,/icon\.setAttribute\('data-home-drag-ghost', ''\)/);
  assert.match(glassCss,/home-editing \.desktop-grid > \.app-tile,[\s\S]*?animation: none !important/);
  assert.match(glassCss,/home-editing,\.home-paging,\.home-dragging\):not\(\.lg-controls-open\) \.dock-bar,[\s\S]*?backdrop-filter: none !important/);
  const fn=vendor.match(/function hostMotionDeferred\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(fn);
  const ctx={HAS_DOM:true,config:{deferDuring:null},document:{body:{matches:s=>s==='busy'}}};
  runInNewContext(fn+'\nthis.check=hostMotionDeferred;',ctx);
  assert.equal(ctx.check(),false);
  ctx.config.deferDuring='busy';assert.equal(ctx.check(),true);
  ctx.config.deferDuring='idle';assert.equal(ctx.check(),false);
  ctx.document.body=null;assert.equal(ctx.check(),false);
  // Exercise actual deferred branches without running the third-party renderer.
  const tier=vendor.slice(vendor.indexOf('function evaluateTiers()'),vendor.indexOf('  const max = config.maxRefractive',vendor.indexOf('function evaluateTiers()')))+'}';
  const tone=vendor.slice(vendor.indexOf('function runToneSampling()'),vendor.indexOf('  const { all, scroll, entered } = toneState;',vendor.indexOf('function runToneSampling()')))+'}';
  const timers=[];
  const runtime={state:{initialized:true},document:{hidden:false},hostMotionDeferred:()=>true,
    tiers:{timer:7},toneState:{timer:8,all:true,scroll:true,entered:new Set(['fixture'])},
    clearTimeout(){},setTimeout(fn,delay){timers.push(delay);return 99;}};
  runInNewContext(tier+'\n'+tone+'\nevaluateTiers();runToneSampling();',runtime);
  assert.deepEqual(timers,[250,250]);
  assert.equal(runtime.toneState.all,true);
  assert.equal(runtime.toneState.scroll,true);
  assert.equal(runtime.toneState.entered.has('fixture'),true);
  assert.equal(runtime.tiers.timer,99);
  assert.equal(runtime.toneState.timer,99);
});
