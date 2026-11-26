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
  assert.match(index, /v:\s*14,/);
  assert.match(index, /var LS_KEY = 'ds_layout_v14'/);
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
    .filter((id) => id !== 'app_chat' && id !== 'app_shop');
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
  assert.match(serviceWorker, /const CACHE_NAME = 'phone-app-pwa-v206'/);
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
    cleanupEmptyTrailingPages() { counts.cleanup++; },
    updateDefaultGridComposition() { counts.refresh++; },
    persistCurrentDOM() { counts.writes++; },
    clearTimeout() {}
  };
  runInNewContext(match[0] + '\ncancelDrag();', harness);
  assert.equal(harness.isDragging, false);
  assert.deepEqual(counts, { placeholder: 1, ghost: 1, cleanup: 1, refresh: 1, writes: 0 });
  assert.match(index, /window\.addEventListener\('blur', function \(\) \{[\s\S]*?if \(isDragging\) cancelDrag\(\)/);
});

test('cancelled cross-page gesture navigates back without storing a drop', () => {
  const match = index.match(/function cancelDrag\(\) \{[\s\S]*?\n      \}/);
  assert.ok(match);
  let returned = -1, writes = 0;
  const context = {
    isDragging: true, edgeTimer: null, dragOriginPage: 0, activePageIndex: 1,
    placeholder: null, dragClone: null, dragEl: null,
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
