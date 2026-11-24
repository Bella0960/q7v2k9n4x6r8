// THEME-STUDIO-PERF-006: mobile workbench input-perf and stability regression.
// Real headless Chromium on a synthetic local HTTP origin; no private account data,
// no external API. Views: 375 / 390 / 430.
//
// Coverage:
// - 50 rapid tab switches: synchronous handler timing, no long task, no DOM/listener
//   growth, no runtime errors.
// - Slider/color input is coalesced to one preview frame; unchanged preview variables
//   are not rewritten; the final draft value and preview variable still land.
// - Repeated scope switches (global / role A / role B) keep drafts and undo stacks
//   isolated; an unsaved bubble draft never writes the beauty store.
// - Two synthetic uploads: the second undo restores the first image only; an unrelated
//   radius edit survives; the same assetId is reused from a session-local lease cache
//   instead of being re-resolved from IDB on every tab switch.
// - Back guard cancels stays on the page; an applied config survives a reload.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp'
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const safe = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = resolve(root, safe || 'index.html');
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    if (!(await stat(file)).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;

const STUDIO_KEY = 'maomao_theme_studio_v1';
const snapshot = page => page.evaluate(() => window.MAOMAOThemeStudio._draftSnapshot());
const beautyKeys = page => page.evaluate(() =>
  Object.keys(localStorage).filter(k => k.indexOf('beauty_chat') === 0 && k !== 'beauty_chat_migrated_v1'));

const dialogQueue = [];
function bindDialog(page) {
  if (page.__dialogBound) return;
  page.__dialogBound = true;
  page.on('dialog', async d => {
    const next = dialogQueue.shift() || { action: 'dismiss' };
    if (next.action === 'accept') await d.accept(); else await d.dismiss();
  });
}

async function editRange(page, selector, value) {
  await page.evaluate(({ sel, v }) => {
    const input = document.querySelector(sel);
    input.focus();
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }, { sel: selector, v: value });
  await delay(80);
}
async function editColor(page, selector, hex) {
  await page.evaluate(({ sel, h }) => {
    const input = document.querySelector(sel);
    input.focus();
    input.value = h;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }, { sel: selector, h: hex });
  await delay(80);
}
async function uploadCover(page, fill) {
  const imageData = await page.evaluate((color) => {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 12;
    const x = c.getContext('2d'); x.fillStyle = color || '#777777'; x.fillRect(0, 0, 16, 12);
    return c.toDataURL('image/png');
  }, fill || '#777777');
  const buffer = Buffer.from(imageData.slice(imageData.indexOf(',') + 1), 'base64');
  await page.locator('#imageSlots .image-slot').first().locator('button').first().click();
  await page.locator('#imageFile').setInputFiles({ name: 'synthetic-qa.png', mimeType: 'image/png', buffer });
}

let count = 0;
let browser = null;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  for (const width of [375, 390, 430]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    bindDialog(page);
    dialogQueue.length = 0;

    await page.addInitScript(() => {
      window.__longtasks = [];
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) window.__longtasks.push(+e.duration.toFixed(2));
      }).observe({ entryTypes: ['longtask'] });
      // Count rAF preview frames so a burst of synchronous inputs can be asserted to
      // coalesce into one refresh instead of one frame per input. The unwrapped original
      // is kept for the test's own wait-for-frame hops so they are not counted.
      window.__rafCount = 0;
      const origRaf = window.requestAnimationFrame.bind(window);
      window.__origRaf = origRaf;
      window.requestAnimationFrame = (cb) => origRaf((t) => { window.__rafCount++; cb(t); });
    });

    await page.goto(origin + '/theme-studio/theme-studio.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#previewSurface', { timeout: 15000 });
    await page.evaluate(() => localStorage.clear());
    // Synthetic roles for scope isolation; no real account data.
    await page.evaluate(() => localStorage.setItem('ai_custom_characters', JSON.stringify([
      { id: 'role-a', name: '角色 A' }, { id: 'role-b', name: '角色 B' }
    ])));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#editorFields input', { timeout: 15000 });
    await delay(150);

    // 1. Clean load: clean draft, empty history, stable node budget.
    let snap = await snapshot(page);
    assert.equal(snap.dirty, false, width + 'px clean load is not dirty');
    assert.equal(snap.undo, 0, width + 'px clean load has empty undo');
    const initialNodes = await page.evaluate(() => ({
      inputs: document.querySelectorAll('#editorFields input').length,
      buttons: document.querySelectorAll('button').length,
      nodes: document.querySelectorAll('*').length
    }));

    // 2. 50 rapid tab switches: sync handler timing + no node/listener growth.
    const switchTimes = await page.evaluate(() => {
      const tabs = ['detail', 'bubble', 'list'];
      const out = [];
      for (let i = 0; i < 50; i++) {
        const btn = document.querySelector(`[data-tab="${tabs[i % 3]}"]`);
        const t0 = performance.now();
        btn.click();
        out.push(performance.now() - t0);
      }
      return out;
    });
    const maxSwitch = Math.max(...switchTimes);
    assert.ok(maxSwitch < 50, width + 'px tab switch under one long-task threshold, max ' + maxSwitch);
    // Return to the same tab as the initial sample before comparing the node budget:
    // different tabs hold different field counts, so only an in-tab comparison proves
    // there is no node/listener accumulation.
    await page.click('[data-tab="list"]');
    await delay(60);
    const afterNodes = await page.evaluate(() => ({
      inputs: document.querySelectorAll('#editorFields input').length,
      buttons: document.querySelectorAll('button').length,
      nodes: document.querySelectorAll('*').length
    }));
    assert.deepEqual(afterNodes, initialNodes, width + 'px node budget stable after 50 switches');

    // 3. Input coalescing: draft value and preview variable both land after a frame.
    await page.click('[data-tab="list"]');
    await editRange(page, '#edit-itemRadius', '22');
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    snap = await snapshot(page);
    assert.equal(snap.list.itemRadius, 22, width + 'px slider draft lands');
    const radiusVar = await page.evaluate(() =>
      getComputedStyle(document.getElementById('previewSurface')).getPropertyValue('--p-list-item-radius').trim());
    assert.equal(radiusVar, '22px', width + 'px preview variable lands: ' + radiusVar);

    // 3b. Coalescing: a synchronous burst of slider inputs schedules a single preview frame.
    const rafBefore = await page.evaluate(() => window.__rafCount);
    await page.evaluate(() => {
      const input = document.querySelector('#edit-itemRadius');
      input.focus();
      for (let v = 23; v <= 27; v++) {
        input.value = String(v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    });
    await page.evaluate(() => new Promise(r => window.__origRaf(() => window.__origRaf(r))));
    const rafAfter = await page.evaluate(() => window.__rafCount);
    assert.ok(rafAfter - rafBefore <= 1, width + 'px input burst coalesces to one preview frame, frames=' + (rafAfter - rafBefore));
    snap = await snapshot(page);
    assert.equal(snap.list.itemRadius, 27, width + 'px burst final draft value lands');

    // 4. First synthetic upload; record the asset id (draft only, not applied).
    await uploadCover(page, '#777777');
    await page.waitForFunction(() =>
      /^as_[A-Z2-7]{32}$/.test(window.MAOMAOThemeStudio._draftSnapshot().list.coverImage),
      null, { timeout: 15000 });
    snap = await snapshot(page);
    const coverA = snap.list.coverImage;
    assert.match(coverA, /^as_[A-Z2-7]{32}$/, width + 'px first upload stores an asset id');

    // 5. Session-local lease cache: repeated switches must not re-resolve the same id
    //    from IDB. Count repository resolve calls after the initial render settled.
    await page.evaluate(() => {
      const assets = window.MAOMAOThemeStudioAssets;
      const orig = assets.resolve.bind(assets);
      window.__resolveCalls = 0;
      assets.resolve = (id) => { window.__resolveCalls++; return orig(id); };
    });
    await page.evaluate(() => {
      const tabs = ['detail', 'bubble', 'list'];
      for (let i = 0; i < 30; i++) document.querySelector(`[data-tab="${tabs[i % 3]}"]`).click();
    });
    await delay(250);
    const resolveCalls = await page.evaluate(() => window.__resolveCalls);
    assert.equal(resolveCalls, 0, width + 'px cached lease is reused, no repeat IDB resolve, calls=' + resolveCalls);

    // 6. Single-flight thumb resolve: while the second image's lease is still pending,
    //    rapid tab switches must share one in-flight promise instead of opening a new
    //    IDB/object-URL resolve per rebuild. A controllable delayed mock stands in for
    //    the repository; the blob URL behind it is a real decodable synthetic image.
    await editRange(page, '#edit-itemRadius', '30');
    await page.evaluate(async () => {
      const assets = window.MAOMAOThemeStudioAssets;
      const makeUrl = async () => {
        const c = document.createElement('canvas'); c.width = 16; c.height = 12;
        const x = c.getContext('2d'); x.fillStyle = '#333333'; x.fillRect(0, 0, 16, 12);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        return URL.createObjectURL(blob);
      };
      const urlA = await makeUrl();
      const urlB = await makeUrl();
      window.__thumbMock = { calls: 0, revoked: Object.create(null), urls: [urlA, urlB], next: 0, assets: [], delay: 120, failOnce: false };
      assets.resolve = (id) => {
        window.__thumbMock.calls++;
        return new Promise((resolve) => {
          setTimeout(() => {
            if (window.__thumbMock.failOnce) { window.__thumbMock.failOnce = false; resolve(null); return; }
            const url = window.__thumbMock.urls[window.__thumbMock.next++ % window.__thumbMock.urls.length];
            const asset = { url, revoke() {
              if (window.__thumbMock.revoked[url]) return;
              window.__thumbMock.revoked[url] = (window.__thumbMock.revoked[url] || 0) + 1;
              URL.revokeObjectURL(url);
            } };
            window.__thumbMock.assets.push(asset);
            resolve(asset);
          }, window.__thumbMock.delay);
        });
      };
    });
    await uploadCover(page, '#333333');
    await page.waitForFunction((prev) => {
      const id = window.MAOMAOThemeStudio._draftSnapshot().list.coverImage;
      return /^as_[A-Z2-7]{32}$/.test(id) && id !== prev;
    }, coverA, { timeout: 15000 });
    // Fire tab switches while the mock resolve is still pending; all rebuilds must share
    // the single in-flight promise.
    await page.evaluate(() => {
      const tabs = ['detail', 'bubble', 'list'];
      for (let i = 0; i < 12; i++) document.querySelector(`[data-tab="${tabs[i % 3]}"]`).click();
    });
    await delay(280);
    snap = await snapshot(page);
    assert.notEqual(snap.list.coverImage, coverA, width + 'px second upload has a distinct id');
    const singleFlightCalls = await page.evaluate(() => window.__thumbMock.calls);
    // One shared thumbnail resolveThumb promise + one main-preview applyPhotoPreview
    // resolve; neither scales with the 12 rebuilds. A leaked per-rebuild resolve would
    // grow this count with the switch loop.
    assert.ok(singleFlightCalls <= 2, width + 'px pending resolves do not scale with switches, calls=' + singleFlightCalls);
    console.log('  resolves@' + width + 'px:', singleFlightCalls);
    const thumbBg = await page.evaluate(() => {
      const t = document.querySelector('#imageSlots .image-thumb');
      return t ? t.style.backgroundImage : '';
    });
    assert.ok(thumbBg.includes('blob:'), width + 'px thumbnail shows a decoded blob URL: ' + thumbBg);
    const thumbUrl = (thumbBg.match(/blob:[^")]+/) || [])[0];
    const decoded = await page.evaluate((url) => new Promise(res => {
      const img = new Image();
      img.onload = () => res(img.naturalWidth > 0);
      img.onerror = () => res(false);
      img.src = url;
    }), thumbUrl);
    assert.equal(decoded, true, width + 'px thumbnail blob URL decodes to an image: ' + thumbUrl);

    // 6b. Upload-in-flight style isolation: undoing the second upload restores the first
    //    image only; the unrelated radius edit survives; the second id does not leak.
    await page.click('#undoButton');
    snap = await snapshot(page);
    assert.equal(snap.list.coverImage, coverA, width + 'px undo second upload restores first image');
    assert.equal(snap.list.itemRadius, 30, width + 'px unrelated radius edit survives image undo');

    // 7. Scope isolation: global and per-role bubble drafts + history do not cross.
    await page.click('[data-tab="bubble"]');
    await delay(100);
    await editColor(page, '#edit-myBubbleBg', '#aaaaaa');
    const globalUndo = (await snapshot(page)).undo;
    await page.selectOption('#bubbleScope', 'role-a');
    await delay(100);
    await editColor(page, '#edit-myBubbleBg', '#bbbbbb');
    let roleSnap = await snapshot(page);
    assert.equal(roleSnap.bubble.myBubbleBg, '#bbbbbb', width + 'px role A draft staged');
    await page.selectOption('#bubbleScope', 'global');
    await delay(100);
    let globalSnap = await snapshot(page);
    assert.equal(globalSnap.bubble.myBubbleBg, '#aaaaaa', width + 'px global draft restored after role switch');
    assert.equal(globalSnap.undo, globalUndo, width + 'px global history isolated from role A');
    await page.selectOption('#bubbleScope', 'role-a');
    await delay(100);
    roleSnap = await snapshot(page);
    assert.equal(roleSnap.bubble.myBubbleBg, '#bbbbbb', width + 'px role A draft still staged on return');
    await page.selectOption('#bubbleScope', 'role-b');
    await delay(100);
    await editColor(page, '#edit-myBubbleBg', '#cccccc');
    let roleBSnap = await snapshot(page);
    assert.equal(roleBSnap.bubble.myBubbleBg, '#cccccc', width + 'px role B draft staged');
    await page.selectOption('#bubbleScope', 'role-a');
    await delay(100);
    roleSnap = await snapshot(page);
    assert.equal(roleSnap.bubble.myBubbleBg, '#bbbbbb', width + 'px role A draft isolated from role B');
    await page.selectOption('#bubbleScope', 'role-b');
    await delay(100);
    roleBSnap = await snapshot(page);
    assert.equal(roleBSnap.bubble.myBubbleBg, '#cccccc', width + 'px role B draft still staged on return');
    assert.deepEqual(await beautyKeys(page), [], width + 'px unsaved bubble draft writes no beauty scope');

    // 8. Back guard: cancelling stays on the workbench.
    await page.click('[data-tab="list"]');
    await editRange(page, '#edit-itemRadius', '29');
    dialogQueue.push({ action: 'dismiss' });
    await page.evaluate(() => document.querySelector('.back').click());
    await delay(120);
    assert.ok(page.url().includes('theme-studio.html'), width + 'px cancelled back keeps the workbench');

    // 9. Applied list config is written to disk immediately. The bubble drafts above are
    //    still unsaved, so a reload would (correctly) be held by the beforeunload guard;
    //    the reopen-read path is verified separately in a clean context below.
    await page.click('#applyButton');
    await delay(120);
    const persisted = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STUDIO_KEY);
    assert.equal(persisted.enabled.list, true, width + 'px applied list config is persisted');
    assert.equal(persisted.list.itemRadius, 29, width + 'px applied radius is persisted');

    const longtasks = await page.evaluate(() => window.__longtasks);
    assert.deepEqual(pageErrors, [], width + 'px no runtime errors: ' + pageErrors.join('; '));
    // Long tasks are measured, not certified as zero-thread-blocking: image decode / IDB
    // writes happen in the shared repository (out of scope). The <=300 ms guard only
    // rules out a frozen main thread; reported 203-217 ms tasks are decode/IDB batches
    // and are NOT proof of a performance pass. Same-condition before/after baseline
    // comparison against fixed PR #478 was not executed in this isolated context
    // (NOT VERIFIED). Switch-batch responsiveness is tracked separately via switchTimes.
    assert.ok(longtasks.every(d => d <= 300), width + 'px long task over 300 ms: ' + JSON.stringify(longtasks));
    console.log('  longtasks@' + width + ':', JSON.stringify(longtasks));
    const medianSwitch = switchTimes.slice().sort((a, b) => a - b)[Math.floor(switchTimes.length / 2)];
    console.log('  switch@' + width + 'px: max=' + maxSwitch.toFixed(2) + 'ms median=' + medianSwitch.toFixed(2) + 'ms');

    count++;
    console.log('PASS theme-studio perf + stability @ ' + width + 'px');
    await context.close();
  }

  // Reopen-read: a clean reload after a pre-applied config loads the saved values as the
  // baseline and starts clean (no dirty flag, no phantom history).
  {
    const reopen = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const rp = await reopen.newPage();
    const rerr = [];
    rp.on('pageerror', e => rerr.push(e.message));
    await rp.goto(origin + '/theme-studio/theme-studio.html', { waitUntil: 'domcontentloaded' });
    await rp.waitForSelector('#previewSurface', { timeout: 15000 });
    await rp.evaluate((key) => localStorage.setItem(key, JSON.stringify({
      v: 1, enabled: { list: true, detail: false },
      list: { itemRadius: 18 }, detail: {}, presets: [], updatedAt: 1
    })), STUDIO_KEY);
    await rp.reload({ waitUntil: 'domcontentloaded' });
    await rp.waitForSelector('#previewSurface', { timeout: 15000 });
    await delay(150);
    const rsnap = await rp.evaluate(() => window.MAOMAOThemeStudio._draftSnapshot());
    assert.equal(rsnap.list.itemRadius, 18, 'reopen loads saved list radius');
    assert.equal(rsnap.dirty, false, 'reopen baseline is not dirty');
    assert.equal(rsnap.undo, 0, 'reopen starts with empty history');
    assert.deepEqual(rerr, [], 'reopen has no runtime errors: ' + rerr.join('; '));
    await reopen.close();
  }

  // R2 lease lifecycle (390px; viewport-agnostic): a stale late promise must not wipe a
  // newer in-flight pending; post-hide URLs are really revoked and stop decoding; the
  // current thumbnail + main-preview URLs still decode; null and rejection are both
  // retried by call delta; drafts survive; BFCache restore uses a real
  // PageTransitionEvent(persisted). A true back-forward navigation round-trip is NOT
  // VERIFIED in this headless context.
  {
    const lc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const lp = await lc.newPage();
    const lerr = [];
    lp.on('pageerror', e => lerr.push(e.message));
    await lp.goto(origin + '/theme-studio/theme-studio.html', { waitUntil: 'domcontentloaded' });
    await lp.waitForSelector('#previewSurface', { timeout: 15000 });
    await lp.evaluate(() => localStorage.clear());
    await lp.reload({ waitUntil: 'domcontentloaded' });
    await lp.waitForSelector('#editorFields input', { timeout: 15000 });
    await delay(150);

    await lp.evaluate(async () => {
      const assets = window.MAOMAOThemeStudioAssets;
      const makeUrl = async () => {
        const c = document.createElement('canvas'); c.width = 16; c.height = 12;
        const x = c.getContext('2d'); x.fillStyle = '#444444'; x.fillRect(0, 0, 16, 12);
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        return URL.createObjectURL(blob);
      };
      const pool = []; for (let i = 0; i < 12; i++) pool.push(await makeUrl());
      window.__lmock = {
        calls: 0, revoked: Object.create(null), pool, next: 0, deferreds: [],
        failNext: false, rejectNext: false, assets: []
      };
      assets.resolve = () => {
        window.__lmock.calls++;
        if (window.__lmock.failNext) { window.__lmock.failNext = false; return Promise.resolve(null); }
        if (window.__lmock.rejectNext) { window.__lmock.rejectNext = false; return Promise.reject(new Error('mock reject')); }
        let res; const p = new Promise(r => { res = r; });
        window.__lmock.deferreds.push(res);
        return p;
      };
      window.__lmock.settle = (res) => {
        const url = window.__lmock.pool[window.__lmock.next++ % window.__lmock.pool.length];
        const state = { revoked: false };
        const asset = { url, revoke() {
          if (state.revoked) return;
          state.revoked = true;
          URL.revokeObjectURL(url);
          window.__lmock.revoked[url] = (window.__lmock.revoked[url] || 0) + 1;
        } };
        window.__lmock.assets.push(asset);
        res(asset);
      };
    });

    const decodes = (url) => lp.evaluate((u) => new Promise(res => {
      const img = new Image();
      img.onload = () => res(img.naturalWidth > 0);
      img.onerror = () => res(false);
      img.src = u;
    }), url);

    // A1. Real synthetic upload; thumbnail + main-preview resolves hang in the mock.
    await uploadCover(lp, '#444444');
    await lp.waitForFunction(() =>
      /^as_[A-Z2-7]{32}$/.test(window.MAOMAOThemeStudio._draftSnapshot().list.coverImage),
      null, { timeout: 15000 });
    await delay(60);
    const oldPending = await lp.evaluate(() => window.__lmock.deferreds.length);
    assert.ok(oldPending >= 1, 'upload produced at least one pending resolve');

    // A2. Hide, then restore from BFCache: a fresh generation rebuilds while the old
    // deferreds are still unresolved.
    await lp.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await lp.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await delay(60);
    const callsAfterRestore = await lp.evaluate(() => window.__lmock.calls);

    // A3. Settle the stale old batch first. The stale callbacks must not trigger another
    // resolve (no third resolve) and must not wipe the newer pending map.
    await lp.evaluate((n) => {
      const old = window.__lmock.deferreds.slice(0, n);
      old.forEach(res => window.__lmock.settle(res));
    }, oldPending);
    await delay(60);
    const callsAfterStale = await lp.evaluate(() => window.__lmock.calls);
    assert.equal(callsAfterStale, callsAfterRestore, 'stale late resolve does not trigger a third resolve');

    // A4. Stale post-hide URLs were really revoked and must no longer decode.
    const staleUrls = await lp.evaluate((n) => window.__lmock.assets.slice(0, n).map(a => a.url), oldPending);
    for (const url of staleUrls) {
      assert.equal(await decodes(url), false, 'stale post-hide URL does not decode: ' + url);
    }
    const revokedCount = await lp.evaluate(() => Object.keys(window.__lmock.revoked).length);
    assert.equal(revokedCount, staleUrls.length, 'each stale URL revoked exactly once');

    // A5. Settle the fresh batch; current thumbnail and main-preview URLs decode.
    await lp.evaluate(() => {
      window.__lmock.deferreds.forEach(res => window.__lmock.settle(res));
      window.__lmock.deferreds = [];
    });
    await delay(120);
    const thumbBg = await lp.evaluate(() => {
      const t = document.querySelector('#imageSlots .image-thumb');
      return t ? t.style.backgroundImage : '';
    });
    const thumbUrl = (thumbBg.match(/blob:[^")]+/) || [])[0];
    assert.ok(thumbUrl, 'fresh thumbnail paints a blob URL: ' + thumbBg);
    assert.equal(await decodes(thumbUrl), true, 'current thumbnail URL decodes: ' + thumbUrl);
    const coverVar = await lp.evaluate(() =>
      getComputedStyle(document.getElementById('previewSurface')).getPropertyValue('--p-list-cover-image').trim());
    const mainUrl = (coverVar.match(/blob:[^")]+/) || [])[0];
    assert.ok(mainUrl, 'main preview holds a blob URL: ' + coverVar);
    assert.equal(await decodes(mainUrl), true, 'current main-preview URL decodes: ' + mainUrl);

    // B1. Null resolve then retry, measured by call delta (not a cumulative >=2 guess).
    // pagehide first drops the session lease cache so the failure path is actually hit.
    const callsBeforeNull = await lp.evaluate(() => window.__lmock.calls);
    await lp.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await lp.evaluate(() => { window.__lmock.failNext = true; });
    await lp.click('[data-tab="detail"]');
    await lp.click('[data-tab="list"]');
    await delay(60);
    await lp.click('[data-tab="detail"]');
    await lp.click('[data-tab="list"]');
    await delay(60);
    await lp.evaluate(() => {
      window.__lmock.deferreds.forEach(res => window.__lmock.settle(res));
      window.__lmock.deferreds = [];
    });
    await delay(120);
    const nullDelta = await lp.evaluate((base) => window.__lmock.calls - base, callsBeforeNull);
    assert.ok(nullDelta >= 2, 'null failure is retried, delta=' + nullDelta);
    let draft = await lp.evaluate(() => window.MAOMAOThemeStudio._draftSnapshot().list.coverImage);
    assert.ok(/^as_[A-Z2-7]{32}$/.test(draft), 'cover draft survives a null resolve');

    // B2. Rejection then retry; a rejected resolve must leave the draft intact.
    const callsBeforeRej = await lp.evaluate(() => window.__lmock.calls);
    await lp.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await lp.evaluate(() => { window.__lmock.rejectNext = true; });
    await lp.click('[data-tab="detail"]');
    await lp.click('[data-tab="list"]');
    await delay(60);
    await lp.click('[data-tab="detail"]');
    await lp.click('[data-tab="list"]');
    await delay(60);
    await lp.evaluate(() => {
      window.__lmock.deferreds.forEach(res => window.__lmock.settle(res));
      window.__lmock.deferreds = [];
    });
    await delay(120);
    const rejDelta = await lp.evaluate((base) => window.__lmock.calls - base, callsBeforeRej);
    assert.ok(rejDelta >= 2, 'rejection is retried, delta=' + rejDelta);
    draft = await lp.evaluate(() => window.MAOMAOThemeStudio._draftSnapshot().list.coverImage);
    assert.ok(/^as_[A-Z2-7]{32}$/.test(draft), 'cover draft survives a rejection');

    assert.deepEqual(lerr, [], 'lease lifecycle context has no runtime errors: ' + lerr.join('; '));
    await lc.close();
  }
} finally {
  try { if (browser) await browser.close(); } catch {}
  server.close();
  await once(server, 'close');
}
console.log(count + ' perf scenarios passed');
process.exit(count === 3 ? 0 : 1);
