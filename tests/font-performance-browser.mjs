import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

/**
 * PERF-FONT-001 真实浏览器回归（Playwright + 本机 Edge）。
 * 依赖测试字体 tests/fixtures/maomao-test-font.ttf（codicon，MIT，取自 playwright-core）。
 *
 * 覆盖：
 * 1. 默认字体启动：不读字体 IndexedDB、不写 Cache Storage、不创建 ObjectURL。
 * 2. 自定义字体首次加载：只在首帧之后应用，只写一次缓存。
 * 3. 多页面重复加载 / 页面切换性能：后续页面不读 IndexedDB、不重复写缓存。
 * 4. 同一字体并发加载：只注册一次、只创建一个 ObjectURL。
 * 5. 字体损坏及失败回退：自动移除自定义字体规则，回到系统字体。
 * 6. 原有字体数据兼容性：旧 custom_font_url 与旧 type:'url' 预设仍可使用。
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONT_FIXTURE = '/tests/fixtures/maomao-test-font.ttf';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8'
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
      const filePath = path.join(root, rel);
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const data = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': path.extname(filePath) === '.html' ? 'no-store' : 'public, max-age=600'
      });
      res.end(data);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

/* 页面内探针：只统计字体相关行为，避免把聊天数据读取混进来。 */
const INSTRUMENT = () => {
  const fp = window.__fp = {
    fontDbOpens: 0,
    fontDbGets: 0,
    cachePuts: 0,
    cachePutMs: 0,
    objectUrls: 0,
    objectUrlRevokes: 0,
    longTasks: [],
    fontStyleAt: null,
    fontStyleRemovedAt: null
  };
  try {
    const open = indexedDB.open.bind(indexedDB);
    indexedDB.open = function (name, ...rest) {
      if (String(name) === 'maomao-font-presets') fp.fontDbOpens++;
      return open(name, ...rest);
    };
  } catch (e) {}
  try {
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (...args) {
      if (this.name === 'presets') fp.fontDbGets++;
      return get.apply(this, args);
    };
  } catch (e) {}
  try {
    const put = Cache.prototype.put;
    Cache.prototype.put = function (...args) {
      fp.cachePuts++;
      const start = performance.now();
      const promise = put.apply(this, args);
      const settle = () => { fp.cachePutMs += performance.now() - start; };
      return promise.then((value) => { settle(); return value; }, (error) => { settle(); throw error; });
    };
  } catch (e) {}
  try {
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (blob) { fp.objectUrls++; return create(blob); };
  } catch (e) {}
  try {
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = function (url) { fp.objectUrlRevokes++; return revoke(url); };
  } catch (e) {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) fp.longTasks.push(Math.round(entry.duration));
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
  try {
    const scan = () => {
      const tag = document.getElementById('maomao-global-custom-font-style');
      if (tag && tag.textContent && fp.fontStyleAt === null) fp.fontStyleAt = Math.round(performance.now());
      if (!tag && fp.fontStyleAt !== null && fp.fontStyleRemovedAt === null) fp.fontStyleRemovedAt = Math.round(performance.now());
    };
    new MutationObserver(scan).observe(document, { childList: true, subtree: true, characterData: true });
    document.addEventListener('DOMContentLoaded', scan, { once: true });
  } catch (e) {}
};

const readMetrics = (page) => page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const fcp = performance.getEntriesByType('paint').find((entry) => entry.name === 'first-contentful-paint');
  const fp = window.__fp;
  const bodyFamily = getComputedStyle(document.body).fontFamily;
  const hasStyle = !!document.getElementById('maomao-global-custom-font-style');
  const fontResources = performance.getEntriesByType('resource')
    .filter((entry) => entry.name.indexOf('__maomao_fonts/') >= 0)
    .length;
  return {
    dcl: Math.round(nav.domContentLoadedEventEnd || 0),
    load: Math.round(nav.loadEventEnd || 0),
    fcp: fcp ? Math.round(fcp.startTime) : -1,
    fontDbOpens: fp.fontDbOpens,
    fontDbGets: fp.fontDbGets,
    cachePuts: fp.cachePuts,
    cachePutMs: Math.round(fp.cachePutMs),
    objectUrls: fp.objectUrls,
    objectUrlRevokes: fp.objectUrlRevokes,
    longTasks: fp.longTasks,
    longTaskTotal: fp.longTasks.reduce((sum, value) => sum + value, 0),
    fontStyleAt: fp.fontStyleAt,
    fontStyleRemovedAt: fp.fontStyleRemovedAt,
    hasStyle,
    fontFaces: Array.from(document.fonts)
      .filter((face) => face.family.replace(/["']/g, '') === 'MAOMAOUserFont')
      .map((face) => face.status),
    previewFaces: Array.from(document.fonts)
      .filter((face) => /StorePreview_/.test(face.family.replace(/["']/g, '')))
      .map((face) => face.status),
    bodyFamily,
    fontResources
  };
});

async function createContext(browser, origin, { blockSw = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    serviceWorkers: blockSw ? 'block' : 'allow'
  });
  await context.addInitScript(INSTRUMENT);
  return context;
}

async function seedFontPreset(page, origin, record) {
  return page.evaluate(async ({ fontUrl, record }) => {
    const payload = record.corrupt
      ? new Blob(['this is not a font file'], { type: 'font/ttf' })
      : await (await fetch(fontUrl)).blob();
    const db = await new Promise((done, fail) => {
      const request = indexedDB.open('maomao-font-presets', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('presets')) {
          request.result.createObjectStore('presets', { keyPath: 'id' });
        }
      };
      request.onsuccess = () => done(request.result);
      request.onerror = () => fail(request.error);
    });
    await new Promise((done, fail) => {
      const tx = db.transaction('presets', 'readwrite');
      tx.objectStore('presets').put({
        id: record.id,
        name: record.name || 'Test Font',
        type: 'file',
        format: 'truetype',
        createdAt: Date.now(),
        blob: payload
      });
      tx.oncomplete = done;
      tx.onerror = () => fail(tx.error);
    });
    db.close();
    return payload.size;
  }, { fontUrl: origin + FONT_FIXTURE, record });
}

async function waitForCustomFont(page) {
  await page.waitForFunction(() => {
    const tag = document.getElementById('maomao-global-custom-font-style');
    if (!tag || !tag.textContent) return false;
    return Array.from(document.fonts).some(
      (face) => face.family.replace(/["']/g, '') === 'MAOMAOUserFont' && face.status === 'loaded'
    );
  }, null, { timeout: 20000 });
}

async function waitForFontFallback(page) {
  await page.waitForFunction(() => {
    const tag = document.getElementById('maomao-global-custom-font-style');
    if (tag && tag.textContent) return false;
    return Array.from(document.fonts).every(
      (face) => !(face.family.replace(/["']/g, '') === 'MAOMAOUserFont' && face.status === 'loaded')
    );
  }, null, { timeout: 20000 });
}

/* 模拟 Safari 类环境：移除 requestIdleCallback，字体调度必须回退到 setTimeout。 */
async function disableIdleCallback(context) {
  await context.addInitScript(() => {
    window.requestIdleCallback = undefined;
    window.cancelIdleCallback = undefined;
    try { delete window.requestIdleCallback; } catch (e) {}
    try { delete window.cancelIdleCallback; } catch (e) {}
  });
}

async function deleteFontPreset(page, id) {
  await page.evaluate(async (presetId) => {
    const db = await new Promise((done, fail) => {
      const request = indexedDB.open('maomao-font-presets', 1);
      request.onsuccess = () => done(request.result);
      request.onerror = () => fail(request.error);
    });
    await new Promise((done, fail) => {
      const tx = db.transaction('presets', 'readwrite');
      tx.objectStore('presets').delete(presetId);
      tx.oncomplete = done;
      tx.onerror = () => fail(tx.error);
    });
    db.close();
  }, id);
}

async function requestStoreRefresh(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new StorageEvent('storage', { key: 'active_font_preset_id' }));
  });
}

async function readPreviewMetrics(page) {
  return page.evaluate(() => ({
    urls: window.__fp.objectUrls,
    revokes: window.__fp.objectUrlRevokes,
    previewFaces: Array.from(document.fonts)
      .filter((face) => /StorePreview_/.test(face.family.replace(/["']/g, '')))
      .map((face) => face.status),
    styled: Array.from(document.querySelectorAll('[data-font-specimen]'))
      .filter((node) => /StorePreview_/.test(node.style.fontFamily))
      .map((node) => node.dataset.fontSpecimen)
  }));
}

/* 建立真实 SW 控制器：注册 sw.js，等待 active 后重新加载，确保页面被 SW 接管。 */
async function ensureServiceWorkerControl(page, origin) {
  await page.goto(origin + '/index.html', { waitUntil: 'load' });
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service Worker unavailable');
    await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
    await navigator.serviceWorker.ready;
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
  return page.evaluate(() => navigator.serviceWorker.controller.scriptURL);
}

/* 与 font-loader.js 的 getFontCacheUrl 保持一致：/__maomao_fonts/<id>.<ext>。 */
function fontCacheUrl(origin, id, format = 'truetype') {
  const ext = format === 'woff2' ? '.woff2' : (format === 'woff' ? '.woff' : '.ttf');
  return origin + '/__maomao_fonts/' + encodeURIComponent(id) + ext;
}

async function hasFontCacheEntry(page, cacheUrl) {
  return page.evaluate(async (url) => !!(await caches.match(url)), cacheUrl);
}

function report(name, metrics) {
  console.log('  ' + name + ': ' + JSON.stringify({
    dcl: metrics.dcl,
    load: metrics.load,
    fcp: metrics.fcp,
    fontDbOpens: metrics.fontDbOpens,
    fontDbGets: metrics.fontDbGets,
    cachePuts: metrics.cachePuts,
    cachePutMs: metrics.cachePutMs,
    objectUrls: metrics.objectUrls,
    objectUrlRevokes: metrics.objectUrlRevokes,
    longTaskTotal: metrics.longTaskTotal,
    longTaskMax: metrics.longTasks.length ? Math.max(...metrics.longTasks) : 0,
    fontStyleAt: metrics.fontStyleAt,
    fontStyleRemovedAt: metrics.fontStyleRemovedAt,
    fontFaces: metrics.fontFaces,
    previewFaces: metrics.previewFaces,
    fontResources: metrics.fontResources
  }));
}

const results = [];
function pass(name) {
  results.push(name);
  console.log('PASS ' + name);
}

const server = await startServer();
const origin = 'http://127.0.0.1:' + server.address().port;
let browser = null;
try {
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    console.log('browser: Microsoft Edge');
  } catch (edgeError) {
    browser = await chromium.launch({ headless: true });
    console.log('browser: Playwright Chromium (Edge unavailable: ' + edgeError.message.split('\n')[0] + ')');
  }

  /* 1. 默认字体启动：不加载任何自定义字体。 */
  {
    console.log('\n[1] 默认字体启动');
    const context = await createContext(browser, origin);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const url of ['/index.html', '/chat/chat/chat.html', '/settings/settings.html', '/forum/forum.html']) {
      await page.goto(origin + url, { waitUntil: 'load' });
      await delay(1400);
      const metrics = await readMetrics(page);
      report(url, metrics);
      assert.equal(metrics.fontDbOpens, 0, url + ' 不应打开字体库');
      assert.equal(metrics.fontDbGets, 0, url + ' 不应读取字体记录');
      assert.equal(metrics.cachePuts, 0, url + ' 不应写入字体缓存');
      assert.equal(metrics.objectUrls, 0, url + ' 不应创建字体 ObjectURL');
      assert.deepEqual(metrics.fontFaces, [], url + ' 不应注册自定义字体');
      assert.equal(metrics.hasStyle, false, url + ' 不应注入字体样式');
      assert.equal(metrics.fontResources, 0, url + ' 不应请求字体资源');
    }
    assert.deepEqual(errors, [], '默认字体启动不应有页面错误');
    await context.close();
    pass('默认字体启动不加载任何自定义字体');
  }

  /* 2. 自定义字体首次加载：首帧后应用，只缓存一次。 */
  {
    console.log('\n[2] 自定义字体首次加载');
    const context = await createContext(browser, origin);
    const page = await context.newPage();
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    const bytes = await seedFontPreset(page, origin, { id: 'font_first_load', name: 'First Load' });
    await context.addInitScript(() => {
      try { localStorage.setItem('active_font_preset_id', 'font_first_load'); } catch (e) {}
    });
    await page.goto(origin + '/chat/chat/chat.html', { waitUntil: 'load' });
    await waitForCustomFont(page);
    const metrics = await readMetrics(page);
    report('/chat/chat/chat.html', metrics);
    assert.ok(bytes > 0, 'fixture font must have content');
    assert.equal(metrics.fontDbOpens, 1, '首次加载应读取一次字体库');
    assert.equal(metrics.fontDbGets, 1, '首次加载应读取一次字体 Blob');
    assert.equal(metrics.objectUrls, 1, '首次加载只创建一个 ObjectURL');
    assert.equal(metrics.cachePuts, 1, '首次加载只写入一次字体缓存');
    assert.deepEqual(metrics.fontFaces, ['loaded'], '字体只注册一次且已加载');
    assert.ok(metrics.fontStyleAt !== null, '字体样式应已注入');
    assert.ok(metrics.fontStyleAt >= metrics.dcl, '字体必须在 DOMContentLoaded 之后应用，不能阻塞首屏');
    await context.close();
    pass('自定义字体首次加载：首帧后应用并只缓存一次');
  }

  /* 3. 多页面重复加载 + 页面切换性能（屏蔽 SW，模拟首次启动 / 直达子页面 / Safari）。 */
  {
    console.log('\n[3] 多页面重复加载（SW 不可用）');
    const context = await createContext(browser, origin, { blockSw: true });
    const page = await context.newPage();
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    await seedFontPreset(page, origin, { id: 'font_repeat', name: 'Repeat' });
    await context.addInitScript(() => {
      try { localStorage.setItem('active_font_preset_id', 'font_repeat'); } catch (e) {}
    });

    const pages = ['/chat/chat/chat.html', '/chat/chat/chat-detail.html?id=perf-font', '/settings/settings.html', '/settings/font-settings.html', '/theme-store/theme-store.html', '/forum/forum.html'];
    let first = null;
    let maxSwitch = 0;
    for (const url of pages) {
      await page.goto(origin + url, { waitUntil: 'load' });
      await waitForCustomFont(page);
      const metrics = await readMetrics(page);
      report(url, metrics);
      assert.deepEqual(metrics.fontFaces, ['loaded'], url + ' 应注册且只注册一个自定义字体');
      assert.ok(metrics.fontStyleAt >= metrics.dcl, url + ' 字体不能阻塞首屏');
      if (!first) {
        first = metrics;
        assert.equal(metrics.fontDbOpens, 1, '首次页面应从 IndexedDB 读取一次');
        assert.equal(metrics.cachePuts, 1, '首次页面应写一次缓存');
      } else if (/font-settings|theme-store/.test(url)) {
        /* 字体管理与主题商店本来就要列出字体记录，会合法读取字体库；
           这里只验证它们没有重复写缓存、没有重复注册全局字体。 */
        console.log('  ' + url + ' 字体管理页正常读取字体列表（不属于运行时重复加载）');
        assert.equal(metrics.cachePuts, 0, url + ' 不应重复写字体缓存');
      } else {
        assert.equal(metrics.fontDbOpens, 0, url + ' 不应再次读取字体库');
        assert.equal(metrics.fontDbGets, 0, url + ' 不应再次读取字体 Blob');
        assert.equal(metrics.cachePuts, 0, url + ' 不应重复写字体缓存');
        assert.equal(metrics.objectUrls, 1, url + ' 每个文档只创建一个 ObjectURL');
      }
      if (/font-settings|theme-store/.test(url)) {
        assert.ok(metrics.objectUrls >= 1, url + ' 应保留全局字体 ObjectURL/预览');
      } else {
        assert.equal(metrics.objectUrls, 1, url + ' 每个文档只创建一个 ObjectURL');
      }
      maxSwitch = Math.max(maxSwitch, metrics.dcl);
      assert.ok(metrics.longTaskTotal <= 500, url + ' 挂载自定义字体后不应出现超过 500ms 的长任务，实际 ' + metrics.longTaskTotal + 'ms');
    }
    assert.ok(maxSwitch < 1500, '页面切换 DOMContentLoaded 应低于 1500ms，实际 ' + maxSwitch + 'ms');
    await context.close();
    pass('多页面重复加载：后续页面不读字体库、不重复写缓存');
  }

  /* 4. 同一字体并发加载：只注册一次，只创建一个 ObjectURL。 */
  {
    console.log('\n[4] 同一字体并发加载');
    const context = await createContext(browser, origin, { blockSw: true });
    const page = await context.newPage();
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    await seedFontPreset(page, origin, { id: 'font_concurrent', name: 'Concurrent' });
    await context.addInitScript(() => {
      try { localStorage.setItem('active_font_preset_id', 'font_concurrent'); } catch (e) {}
    });
    await page.goto(origin + '/chat/chat/chat.html', { waitUntil: 'load' });
    await waitForCustomFont(page);
    const metrics = await page.evaluate(async (fontUrl) => {
      const blob = await (await fetch(fontUrl)).blob();
      const id = localStorage.getItem('active_font_preset_id');
      window.MAOMAOFontRuntime.clear();
      localStorage.setItem('active_font_preset_id', id);
      const beforeUrls = window.__fp.objectUrls;
      const beforePuts = window.__fp.cachePuts;
      const cachedFormat = localStorage.getItem('maomao_font_cache_format_' + id) || 'truetype';
      const cachedUrl = new URL('../../__maomao_fonts/' + id + '.ttf', location.href).href;
      window.MAOMAOFontRuntime.applyBlob(blob, 'truetype');
      window.MAOMAOFontRuntime.applyBlob(blob, 'truetype');
      window.MAOMAOFontRuntime.applyUrl(cachedUrl, cachedFormat);
      window.MAOMAOFontRuntime.applyBlob(blob, 'truetype');
      return {
        objectUrlDelta: window.__fp.objectUrls - beforeUrls,
        cachePutDelta: window.__fp.cachePuts - beforePuts,
        faces: Array.from(document.fonts)
          .filter((face) => face.family.replace(/["']/g, '') === 'MAOMAOUserFont')
          .map((face) => face.status),
        inlineStyles: document.querySelectorAll('style').length
      };
    }, origin + FONT_FIXTURE);
    console.log('  ' + JSON.stringify(metrics));
    assert.equal(metrics.objectUrlDelta, 1, '同一字体连续/并发应用只创建一个 ObjectURL');
    assert.equal(metrics.cachePutDelta, 0, '已有缓存副本时不再写缓存');
    assert.equal(metrics.faces.length, 1, '同一字体只注册一次');
    await context.close();
    pass('同一字体并发加载只注册一次');
  }

  /* 5. 字体损坏及失败回退。 */
  {
    console.log('\n[5] 字体损坏及失败回退');
    const context = await createContext(browser, origin, { blockSw: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    await seedFontPreset(page, origin, { id: 'font_corrupt', name: 'Corrupt', corrupt: true });
    await page.evaluate(() => localStorage.setItem('active_font_preset_id', 'font_corrupt'));
    await page.goto(origin + '/chat/chat/chat.html', { waitUntil: 'load' });
    await waitForFontFallback(page);
    const metrics = await readMetrics(page);
    report('/chat/chat/chat.html', metrics);
    assert.equal(metrics.hasStyle, false, '损坏字体应移除自定义字体规则');
    assert.deepEqual(metrics.fontFaces, [], '损坏字体不应注册为已加载字体');
    assert.ok(!/MAOMAOUserFont/.test(metrics.bodyFamily), '页面应回退到系统字体栈');
    assert.ok(/apple-system|-apple-system|sf pro|pingfang|sans-serif|segoe/i.test(metrics.bodyFamily), '回退字体栈应包含系统字体');
    assert.deepEqual(errors, [], '字体损坏不应导致页面错误');
    await context.close();
    pass('字体损坏时自动回退系统字体');
  }

  /* 6. 原有字体数据兼容性：旧 custom_font_url。 */
  {
    console.log('\n[6] 原有字体数据兼容性（custom_font_url）');
    const context = await createContext(browser, origin, { blockSw: true });
    const page = await context.newPage();
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    await page.evaluate((url) => {
      localStorage.removeItem('active_font_preset_id');
      localStorage.setItem('custom_font_url', url);
    }, origin + FONT_FIXTURE);
    await page.goto(origin + '/chat/chat/chat.html', { waitUntil: 'load' });
    await waitForCustomFont(page);
    const metrics = await readMetrics(page);
    report('/chat/chat/chat.html', metrics);
    assert.deepEqual(metrics.fontFaces, ['loaded'], '旧 custom_font_url 仍应生效');
    assert.equal(metrics.fontDbOpens, 0, '旧 URL 数据无需读取字体库');
    assert.equal(metrics.cachePuts, 0, '旧 URL 数据无需写字体缓存');
    assert.equal(metrics.objectUrls, 0, 'URL 字体不应创建 ObjectURL');
    await context.close();
    pass('旧 custom_font_url 字体数据仍然兼容');
  }

  /* 7. 原有字体数据兼容性：旧 type:'url' 预设。 */
  {
    console.log('\n[7] 原有字体数据兼容性（type:url 预设）');
    const context = await createContext(browser, origin, { blockSw: true });
    const page = await context.newPage();
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    await page.evaluate(async (url) => {
      const db = await new Promise((done, fail) => {
        const request = indexedDB.open('maomao-font-presets', 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('presets')) {
            request.result.createObjectStore('presets', { keyPath: 'id' });
          }
        };
        request.onsuccess = () => done(request.result);
        request.onerror = () => fail(request.error);
      });
      await new Promise((done, fail) => {
        const tx = db.transaction('presets', 'readwrite');
        tx.objectStore('presets').put({ id: 'font_url_preset', name: 'URL Preset', type: 'url', url: url, format: 'truetype', createdAt: Date.now() });
        tx.oncomplete = done;
        tx.onerror = () => fail(tx.error);
      });
      db.close();
      localStorage.setItem('active_font_preset_id', 'font_url_preset');
      localStorage.removeItem('custom_font_url');
    }, origin + FONT_FIXTURE);
    await page.goto(origin + '/settings/settings.html', { waitUntil: 'load' });
    await waitForCustomFont(page);
    const metrics = await readMetrics(page);
    report('/settings/settings.html', metrics);
    assert.deepEqual(metrics.fontFaces, ['loaded'], '旧 URL 预设仍应生效');
    assert.equal(metrics.objectUrls, 0, 'URL 预设不应创建 ObjectURL');
    await context.close();
    pass('旧 type:url 字体预设仍然兼容');
  }

  /* 8-9. Safari 类环境（无 requestIdleCallback）：回退调度 + Cache Storage 命中。 */
  {
    console.log('\n[8] Safari 类环境（无 requestIdleCallback）');
    const context = await createContext(browser, origin, { blockSw: true });
    await disableIdleCallback(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    await seedFontPreset(page, origin, { id: 'font_safari', name: 'Safari Class' });
    await context.addInitScript(() => {
      try { localStorage.setItem('active_font_preset_id', 'font_safari'); } catch (e) {}
    });
    await page.goto(origin + '/chat/chat/chat.html', { waitUntil: 'load' });
    await waitForCustomFont(page);
    const first = await readMetrics(page);
    report('/chat/chat/chat.html', first);
    const idleAvailable = await page.evaluate(() => typeof window.requestIdleCallback === 'function');
    assert.equal(idleAvailable, false, '模拟环境必须没有 requestIdleCallback');
    assert.deepEqual(first.fontFaces, ['loaded'], '无 rIC 时仍应注册并加载自定义字体');
    assert.ok(first.fontStyleAt !== null && first.fontStyleAt >= first.dcl, '回退调度仍必须晚于 DOMContentLoaded');
    assert.ok(first.longTaskTotal <= 500, '回退调度不应产生超过 500ms 的长任务，实际 ' + first.longTaskTotal + 'ms');
    assert.deepEqual(errors, [], '无 rIC 环境不应有页面错误');
    pass('Safari 类环境（无 rIC）：回退调度仍应用字体且不阻塞首屏');

    console.log('[9] Safari 类环境：Cache Storage 命中');
    await page.goto(origin + '/settings/settings.html', { waitUntil: 'load' });
    await waitForCustomFont(page);
    const hit = await readMetrics(page);
    report('/settings/settings.html', hit);
    assert.equal(hit.fontDbOpens, 0, '缓存命中时不应打开字体库');
    assert.equal(hit.fontDbGets, 0, '缓存命中时不应读取字体 Blob');
    assert.equal(hit.cachePuts, 0, '缓存命中时不应重写字体缓存');
    assert.equal(hit.objectUrls, 1, '缓存命中后每个文档只创建一个 ObjectURL');
    assert.deepEqual(hit.fontFaces, ['loaded'], '缓存命中后字体仍应可用');
    assert.deepEqual(errors, [], '缓存命中不应有页面错误');
    pass('Safari 类环境：Cache Storage 命中不读 IndexedDB、不重写缓存');
    await context.close();
  }

  /* 10. Safari 类环境：Cache Storage 缺失，回退 IndexedDB 并只重建一次缓存。 */
  {
    console.log('\n[10] Safari 类环境：Cache Storage 缺失');
    const context = await createContext(browser, origin, { blockSw: true });
    await disableIdleCallback(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    await seedFontPreset(page, origin, { id: 'font_safari_missing', name: 'Cache Missing' });
    await context.addInitScript(() => {
      try { localStorage.setItem('active_font_preset_id', 'font_safari_missing'); } catch (e) {}
    });
    await page.goto(origin + '/chat/chat/chat.html', { waitUntil: 'load' });
    await waitForCustomFont(page);
    const cacheDeleted = await page.evaluate(async () => (window.caches ? caches.delete('maomao-font-assets-v1') : false));
    assert.equal(cacheDeleted, true, '字体专用缓存应已删除');
    await page.goto(origin + '/settings/settings.html', { waitUntil: 'load' });
    await waitForCustomFont(page);
    const metrics = await readMetrics(page);
    report('/settings/settings.html', metrics);
    assert.equal(metrics.fontDbOpens, 1, '缓存缺失时应回退 IndexedDB');
    assert.equal(metrics.fontDbGets, 1, '缓存缺失时应读取一次 Blob');
    assert.equal(metrics.cachePuts, 1, '回退后只重建一次字体缓存');
    assert.equal(metrics.objectUrls, 1, '回退后每个文档只创建一个 ObjectURL');
    assert.deepEqual(metrics.fontFaces, ['loaded'], '回退后字体仍应可用');
    assert.ok(metrics.fontStyleAt >= metrics.dcl, '回退调度不能阻塞首屏');
    assert.deepEqual(errors, [], '缓存缺失不应有页面错误');
    pass('Safari 类环境：Cache Storage 缺失时回退 IndexedDB 并只重建一次缓存');
    await context.close();
  }

  /* 11. Safari 类环境：Cache Storage 拒绝访问，回退 IndexedDB 且不产生页面错误。 */
  {
    console.log('\n[11] Safari 类环境：Cache Storage 拒绝访问（模拟）');
    const context = await createContext(browser, origin, { blockSw: true });
    await disableIdleCallback(context);
    await context.addInitScript(() => {
      CacheStorage.prototype.match = function () {
        return Promise.reject(new DOMException('Simulated cache access denied', 'SecurityError'));
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/index.html', { waitUntil: 'load' });
    await seedFontPreset(page, origin, { id: 'font_safari_denied', name: 'Cache Denied' });
    await context.addInitScript(() => {
      try { localStorage.setItem('active_font_preset_id', 'font_safari_denied'); } catch (e) {}
    });
    await page.goto(origin + '/chat/chat/chat.html', { waitUntil: 'load' });
    await waitForCustomFont(page);
    await page.goto(origin + '/settings/settings.html', { waitUntil: 'load' });
    await waitForCustomFont(page);
    const metrics = await readMetrics(page);
    report('/settings/settings.html', metrics);
    assert.equal(metrics.fontDbOpens, 1, '缓存拒绝时应回退 IndexedDB');
    assert.equal(metrics.fontDbGets, 1, '缓存拒绝时应读取一次 Blob');
    assert.deepEqual(metrics.fontFaces, ['loaded'], '缓存拒绝后字体仍应可用');
    assert.ok(metrics.fontStyleAt >= metrics.dcl, '拒绝访问不能阻塞首屏');
    assert.deepEqual(errors, [], '缓存拒绝不应变成页面错误');
    pass('Safari 类环境：Cache Storage 拒绝访问时回退 IndexedDB 且无页面错误');
    await context.close();
  }

  /* 12. theme-store 字体预览生命周期：重复渲染不重复创建，删除/失败/卸载时释放。 */
  {
    console.log('\n[12] theme-store 字体预览生命周期');
    const context = await createContext(browser, origin, { blockSw: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin + '/theme-store/theme-store.html', { waitUntil: 'load' });
    await seedFontPreset(page, origin, { id: 'font_preview_a', name: 'Preview A' });
    await seedFontPreset(page, origin, { id: 'font_preview_b', name: 'Preview B' });

    await page.evaluate(() => document.querySelector('[data-category="fonts"]').click());
    await requestStoreRefresh(page);
    await page.waitForFunction(() => {
      const nodes = Array.from(document.querySelectorAll('[data-font-specimen]'));
      return nodes.length === 2 && nodes.every((node) => /StorePreview_/.test(node.style.fontFamily));
    }, null, { timeout: 20000 });

    const initial = await readPreviewMetrics(page);
    console.log('  首次渲染: ' + JSON.stringify(initial));
    assert.equal(initial.urls, 2, '两个方案应各创建一个 ObjectURL');
    assert.equal(initial.revokes, 0, '首次渲染不应撤销 URL');
    assert.equal(initial.previewFaces.length, 2, '两个方案应各注册一个预览 FontFace');

    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) {
        document.querySelector('[data-category="themes"]').click();
        document.querySelector('[data-category="fonts"]').click();
      }
    });
    await requestStoreRefresh(page);
    await page.waitForFunction(() => {
      const nodes = Array.from(document.querySelectorAll('[data-font-specimen]'));
      return nodes.length === 2 && nodes.every((node) => /StorePreview_/.test(node.style.fontFamily));
    }, null, { timeout: 10000 });
    const repeated = await readPreviewMetrics(page);
    console.log('  重复渲染 4 次: ' + JSON.stringify(repeated));
    assert.equal(repeated.urls, initial.urls, '重复渲染不应重复创建 ObjectURL');
    assert.equal(repeated.revokes, initial.revokes, '重复渲染不应撤销仍在使用的 URL');
    assert.equal(repeated.previewFaces.length, 2, '重复渲染不应重复解码/注册 FontFace');
    assert.deepEqual(repeated.styled.sort(), ['font_preview_a', 'font_preview_b'], '重复渲染后预览仍应生效');

    await deleteFontPreset(page, 'font_preview_a');
    await requestStoreRefresh(page);
    await page.waitForFunction(() => {
      const nodes = Array.from(document.querySelectorAll('[data-font-specimen]'));
      return window.__fp.objectUrlRevokes >= 1 && !nodes.some((node) => node.dataset.fontSpecimen === 'font_preview_a');
    }, null, { timeout: 10000 });
    const afterDelete = await readPreviewMetrics(page);
    console.log('  删除 1 个方案后: ' + JSON.stringify(afterDelete));
    assert.equal(afterDelete.urls, initial.urls, '删除不应创建新的 ObjectURL');
    assert.equal(afterDelete.revokes, 1, '删除方案应撤销其 ObjectURL 一次');
    assert.equal(afterDelete.previewFaces.length, 1, '删除方案应从 document.fonts 移除对应 FontFace');

    await seedFontPreset(page, origin, { id: 'font_preview_bad', name: 'Broken', corrupt: true });
    await requestStoreRefresh(page);
    await page.evaluate(() => document.querySelector('[data-category="fonts"]').click());
    await page.waitForFunction(() => window.__fp.objectUrlRevokes >= 2, null, { timeout: 20000 });
    const afterBroken = await readPreviewMetrics(page);
    console.log('  预览加载失败后: ' + JSON.stringify(afterBroken));
    assert.equal(afterBroken.urls, 3, '损坏方案尝试一次应创建一个 ObjectURL');
    assert.equal(afterBroken.revokes, 2, '损坏方案失败后应立即撤销其 ObjectURL');
    assert.ok(!afterBroken.styled.includes('font_preview_bad'), '损坏方案不应应用预览字体');

    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) {
        document.querySelector('[data-category="themes"]').click();
        document.querySelector('[data-category="fonts"]').click();
      }
    });
    const brokenRepeated = await readPreviewMetrics(page);
    console.log('  损坏方案重复渲染: ' + JSON.stringify(brokenRepeated));
    assert.equal(brokenRepeated.urls, afterBroken.urls, '已失败的同一方案不应重复创建 ObjectURL/重复解码');
    assert.equal(brokenRepeated.revokes, afterBroken.revokes, '已失败的同一方案不应再次创建并撤销 URL');

    const beforeHide = await readPreviewMetrics(page);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    const afterHide = await readPreviewMetrics(page);
    console.log('  pagehide 释放: ' + JSON.stringify({ before: beforeHide, after: afterHide }));
    assert.equal(afterHide.revokes, beforeHide.revokes + 1, 'pagehide 应撤销仍在使用的预览 ObjectURL');
    assert.equal(afterHide.previewFaces.length, 0, 'pagehide 应移除所有预览 FontFace');
    assert.deepEqual(errors, [], '预览生命周期不应产生页面错误');
    pass('theme-store 字体预览：重复渲染不重复创建，删除/失败/卸载均释放');
    await context.close();
  }

  /* 13. 真实 SW 控制器 + 专用字体缓存被清 + IndexedDB 仍有字体 → 自动恢复并重建缓存。 */
  {
    console.log('\n[13] SW 控制 + 字体缓存被清 + IndexedDB 可恢复');
    const context = await createContext(browser, origin);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const swScript = await ensureServiceWorkerControl(page, origin);
    assert.ok(swScript.indexOf('/sw.js') >= 0, '页面必须由 sw.js 控制');

    await seedFontPreset(page, origin, { id: 'font_sw_recover', name: 'SW Recover' });
    await page.evaluate(() => localStorage.setItem('active_font_preset_id', 'font_sw_recover'));
    await page.reload({ waitUntil: 'load' });
    await waitForCustomFont(page);
    const seeded = await readMetrics(page);
    report('[13] 预热', seeded);
    const cacheUrl = fontCacheUrl(origin, 'font_sw_recover');
    assert.equal(await hasFontCacheEntry(page, cacheUrl), true, '预热后应存在字体缓存');
    assert.ok(seeded.fontDbOpens >= 1, '预热应从 IndexedDB 读取');
    assert.equal(seeded.cachePuts, 1, '预热应写入一次字体缓存');

    const deleted = await page.evaluate(async () => caches.delete('maomao-font-assets-v1'));
    assert.equal(deleted, true, '字体专用缓存应已删除');
    assert.equal(await hasFontCacheEntry(page, cacheUrl), false, '清理后缓存项必须不存在');

    await page.reload({ waitUntil: 'load' });
    await waitForCustomFont(page);
    const recovered = await readMetrics(page);
    report('[13] 恢复', recovered);
    assert.ok(recovered.fontFaces.includes('loaded'), '缓存缺失后应从 IndexedDB 恢复字体');
    assert.ok(recovered.fontStyleAt >= recovered.dcl, '恢复也不能阻塞首屏');
    assert.equal(recovered.fontDbOpens, 1, '恢复只打开一次字体库');
    assert.equal(recovered.fontDbGets, 1, '恢复只读取一次字体 Blob');
    assert.equal(recovered.cachePuts, 1, '恢复只重建一次字体缓存');
    assert.equal(recovered.objectUrls, 1, '恢复只创建一个 ObjectURL');
    assert.equal(await hasFontCacheEntry(page, cacheUrl), true, '恢复后缓存必须重建');
    assert.deepEqual(errors, [], '恢复不应产生页面错误');

    await page.reload({ waitUntil: 'load' });
    await waitForCustomFont(page);
    const hit = await readMetrics(page);
    report('[13] 恢复后再次加载', hit);
    assert.equal(hit.fontDbOpens, 0, '恢复成功后再次加载不得读取 IndexedDB');
    assert.equal(hit.fontDbGets, 0, '恢复成功后再次加载不得读取字体 Blob');
    assert.equal(hit.cachePuts, 0, '恢复成功后再次加载不得重写缓存');
    assert.equal(hit.objectUrls, 0, '缓存命中路径不得创建 ObjectURL');
    assert.ok(hit.fontFaces.includes('loaded'), '缓存命中后字体仍应可用');
    assert.ok(hit.fontResources >= 1, '缓存命中路径应通过 SW 字体地址加载');
    assert.deepEqual(errors, []);
    pass('SW 控制 + 缓存被清 + IndexedDB 可恢复：恢复成功并重建缓存，后续页面走命中');
    await context.close();
  }

  /* 14. 真实 SW 控制器 + 缓存缺失 + IndexedDB 也缺失 → 系统字体回退且不重复扫描。 */
  {
    console.log('\n[14] SW 控制 + 缓存缺失 + IndexedDB 也缺失');
    const context = await createContext(browser, origin);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await ensureServiceWorkerControl(page, origin);
    const cacheUrl = fontCacheUrl(origin, 'font_sw_missing');
    await page.evaluate(async ({ cacheUrl }) => {
      await new Promise((done, fail) => {
        const request = indexedDB.open('maomao-font-presets', 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('presets')) {
            request.result.createObjectStore('presets', { keyPath: 'id' });
          }
        };
        request.onsuccess = () => { request.result.close(); done(); };
        request.onerror = () => fail(request.error);
      });
      localStorage.setItem('active_font_preset_id', 'font_sw_missing');
      localStorage.setItem('maomao_font_cache_format_font_sw_missing', 'truetype');
      await caches.delete('maomao-font-assets-v1');
      return !!caches.match(cacheUrl);
    }, { cacheUrl });

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__fp.fontDbGets >= 1, null, { timeout: 20000 });
    await delay(400);
    const metrics = await readMetrics(page);
    report('[14] 失败回退', metrics);
    assert.equal(await hasFontCacheEntry(page, cacheUrl), false, '缺失数据不应留下缓存项');
    assert.equal(metrics.fontDbOpens, 1, '只在首次调度读取一次 IndexedDB');
    assert.equal(metrics.fontDbGets, 1, '只在首次调度读取一次 Blob');
    assert.equal(metrics.cachePuts, 0, '无数据时不得写缓存');
    assert.equal(metrics.hasStyle, false, '失败后不得保留自定义字体规则');
    assert.ok(!metrics.fontFaces.includes('loaded'), '失败后不得注册可用自定义字体');
    assert.deepEqual(errors, [], '失败回退不应产生页面错误');

    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) {
        window.dispatchEvent(new StorageEvent('storage', { key: 'active_font_preset_id' }));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      }
    });
    await delay(800);
    const afterRetry = await readMetrics(page);
    report('[14] 重复触发后', afterRetry);
    assert.equal(afterRetry.fontDbOpens, 1, '失败 key 应阻止同一文档重复打开数据库');
    assert.equal(afterRetry.fontDbGets, 1, '失败 key 应阻止同一文档重复读取 Blob');
    assert.equal(afterRetry.hasStyle, false, '重复触发仍应回退系统字体');
    assert.deepEqual(errors, []);
    pass('SW 控制 + 缓存与 IndexedDB 均缺失：回退系统字体且不重复扫描');
    await context.close();
  }

  /* 15. 真实 SW 控制器 + 恢复时 cache.put 抛错 → 回退系统字体、记录失败、不重试。 */
  {
    console.log('\n[15] SW 控制 + 恢复时 cache.put 抛错');
    const context = await createContext(browser, origin);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await ensureServiceWorkerControl(page, origin);
    await seedFontPreset(page, origin, { id: 'font_sw_putfail', name: 'Put Fail' });
    await page.evaluate(() => localStorage.setItem('active_font_preset_id', 'font_sw_putfail'));
    await page.reload({ waitUntil: 'load' });
    await waitForCustomFont(page);
    const cacheUrl = fontCacheUrl(origin, 'font_sw_putfail');
    assert.equal(await hasFontCacheEntry(page, cacheUrl), true, '预热后应存在字体缓存');
    await page.evaluate(async () => caches.delete('maomao-font-assets-v1'));

    await context.addInitScript(() => {
      window.__fp.cachePutThrows = 0;
      Cache.prototype.put = function () {
        window.__fp.cachePutThrows++;
        throw new Error('simulated cache put failure');
      };
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__fp.cachePutThrows >= 1, null, { timeout: 20000 });
    await delay(600);
    const metrics = await readMetrics(page);
    const throwsCount = await page.evaluate(() => window.__fp.cachePutThrows);
    report('[15] 重建失败', metrics);
    console.log('  cache.put 抛错次数: ' + throwsCount);
    assert.equal(throwsCount, 1, '恢复只尝试一次 cache.put');
    assert.equal(metrics.fontDbOpens, 1, '恢复只读取一次 IndexedDB');
    assert.equal(metrics.fontDbGets, 1, '恢复只读取一次 Blob');
    assert.equal(metrics.hasStyle, false, 'cache.put 失败后应回退系统字体');
    assert.ok(!metrics.fontFaces.includes('loaded'), 'cache.put 失败后不得保留已加载自定义字体');
    assert.equal(await hasFontCacheEntry(page, cacheUrl), false, '缓存不得重建成功');
    assert.deepEqual(errors, [], 'cache.put 抛错不得变成页面错误');

    await page.evaluate(() => {
      for (let i = 0; i < 3; i++) {
        window.dispatchEvent(new StorageEvent('storage', { key: 'active_font_preset_id' }));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      }
    });
    await delay(800);
    const afterRetry = await readMetrics(page);
    const throwsAfter = await page.evaluate(() => window.__fp.cachePutThrows);
    report('[15] 重复触发后', afterRetry);
    assert.equal(afterRetry.fontDbOpens, 1, '失败 key 应阻止重复打开数据库');
    assert.equal(throwsAfter, 1, '失败 key 应阻止再次尝试 cache.put');
    assert.equal(afterRetry.hasStyle, false, '重复触发仍应回退系统字体');
    assert.deepEqual(errors, []);
    pass('SW 控制 + cache.put 抛错：回退系统字体并记录失败，不重复重试');
    await context.close();
  }
} catch (error) {
  console.error('\nFAILED:', error && error.stack ? error.stack : error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
  console.log('\n' + (process.exitCode ? 'FAILED' : 'PASSED') + ' ' + results.length + '/15 tests: ' + results.join(' | '));
}
