import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from 'playwright';

// DESKTOP-WIDGET-IMAGE-001 regression:
// desktop widget photos must survive page swipes, reloads, near-full localStorage,
// must stay isolated per widget, and must never report a fake success when saving fails.

const distRoot = path.resolve('dist');
assert.ok(fs.existsSync(path.join(distRoot, 'index.html')), 'production build is missing dist/index.html');

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(distRoot, '.' + pathname);
  if (filePath !== distRoot && !filePath.startsWith(distRoot + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, bytes) => {
    if (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found');
      return;
    }
    const extension = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff'
    };
    res.writeHead(200, {
      'Content-Type': types[extension] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(bytes);
  });
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}
// Noise PNGs compress poorly, so the widget's JPEG output is large enough to expose quota problems.
function makeNoisePng(width, height, seedStart) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let seed = seedStart;
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      raw[row + 1 + x * 3] = seed & 0xff;
      raw[row + 2 + x * 3] = (seed >> 8) & 0xff;
      raw[row + 3 + x * 3] = (seed >> 16) & 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

const PHOTO_A = makeNoisePng(900, 900, 12345);
const PHOTO_B = makeNoisePng(900, 900, 77777);
const IMAGE_KEY = 'home_widget_image_v1_image_img';
const PHOTOWALL_KEY = 'home_widget_upload_v1_photowall_pw1';
const LAYOUT = {
  v: 14,
  pages: [['image', 'photowall', 'clock-lg'], ['app_characters'], ['app_library']],
  dock: ['app_chat', 'app_shop'],
  removed: []
};

async function seedLayout(page) {
  await page.goto(`${baseUrl}/index.html`, { waitUntil: 'load' });
  await page.evaluate(layout => localStorage.setItem('ds_layout_v14', JSON.stringify(layout)), LAYOUT);
  await page.reload({ waitUntil: 'load' });
}

async function upload(page, selector, buffer) {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
  await target.click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'widget-photo.png', mimeType: 'image/png', buffer });
}

async function backgroundOf(page, selector) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    return el ? el.style.backgroundImage : '';
  }, selector);
}

async function waitForBackground(page, selector, timeout = 15000) {
  await page.waitForFunction(sel => {
    const el = document.querySelector(sel);
    return !!el && el.style.backgroundImage.includes('data:image/');
  }, selector, { timeout });
}

async function swipeTo(page, index) {
  await page.evaluate(i => {
    const home = document.getElementById('homeScreen');
    home.scrollLeft = i * home.clientWidth;
  }, index);
  await page.waitForTimeout(350);
  await page.evaluate(() => { document.getElementById('homeScreen').scrollLeft = 0; });
  await page.waitForTimeout(350);
}

async function readToast(page) {
  return page.evaluate(() => {
    const toast = document.querySelector('#toast');
    return toast ? { text: toast.textContent, show: toast.classList.contains('show') } : null;
  });
}

const browser = await chromium.launch({ headless: true });
const report = [];
try {
  for (const viewport of [{ width: 375, height: 812 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
    // --- Scenario A: upload, swipe pages, reload, replace, isolation, no duplicate saves ---
    {
      const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      await seedLayout(page);

      const layoutBefore = await page.evaluate(() => localStorage.getItem('ds_layout_v14'));
      await page.evaluate(() => {
        const store = window.MAOMAOWallpaperStore;
        window.__widgetImageSaves = [];
        const original = store.saveByKey.bind(store);
        store.saveByKey = (key, dataUrl) => {
          window.__widgetImageSaves.push(key);
          return original(key, dataUrl);
        };
      });

      await upload(page, '[data-drag="image"]', PHOTO_A);
      await waitForBackground(page, '[data-drag="image"]');
      const imageA = await backgroundOf(page, '[data-drag="image"]');
      const savedImageA = await page.evaluate(key => window.MAOMAOWallpaperStore.getByKey(key), IMAGE_KEY);
      assert.ok(savedImageA && savedImageA.startsWith('data:image/'), `${viewport.width}: image widget photo must be saved in IndexedDB`);
      assert.ok(imageA.includes(savedImageA), `${viewport.width}: image widget must display the saved photo`);

      // No duplicate writes from rendering.
      assert.equal(
        await page.evaluate(key => window.__widgetImageSaves.filter(k => k === key).length, IMAGE_KEY),
        1,
        `${viewport.width}: uploading once must save exactly once`
      );

      await swipeTo(page, 1);
      await swipeTo(page, 2);
      assert.ok((await backgroundOf(page, '[data-drag="image"]')).includes(savedImageA),
        `${viewport.width}: photo must survive swiping to pages 2 and 3 and back`);
      assert.equal(
        await page.evaluate(key => window.__widgetImageSaves.filter(k => k === key).length, IMAGE_KEY),
        1,
        `${viewport.width}: page swipes must not re-save the photo`
      );

      await page.reload({ waitUntil: 'load' });
      await waitForBackground(page, '[data-drag="image"]');
      assert.ok((await backgroundOf(page, '[data-drag="image"]')).includes(savedImageA),
        `${viewport.width}: photo must be restored after reloading the desktop`);

      // Replace the photo; the previous one must never come back.
      await upload(page, '[data-drag="image"]', PHOTO_B);
      await page.waitForFunction((key, previous) => {
        const el = document.querySelector('[data-drag="image"]');
        return el && el.style.backgroundImage.includes('data:image/') && !el.style.backgroundImage.includes(previous);
      }, IMAGE_KEY, savedImageA, { timeout: 15000 });
      const savedImageB = await page.evaluate(key => window.MAOMAOWallpaperStore.getByKey(key), IMAGE_KEY);
      assert.notEqual(savedImageB, savedImageA, `${viewport.width}: replacement photo must replace the previous one`);
      await page.reload({ waitUntil: 'load' });
      await waitForBackground(page, '[data-drag="image"]');
      assert.ok((await backgroundOf(page, '[data-drag="image"]')).includes(savedImageB),
        `${viewport.width}: only the replacement photo may be restored`);

      // A second widget keeps its own photo (no cross-widget reuse).
      await upload(page, '#pw1', PHOTO_A);
      await waitForBackground(page, '#pw1');
      const savedPhotowall = await page.evaluate(key => window.MAOMAOWallpaperStore.getByKey(key), PHOTOWALL_KEY);
      assert.ok(savedPhotowall && savedPhotowall.startsWith('data:image/'), `${viewport.width}: photo wall photo must be saved`);
      assert.notEqual(savedPhotowall, savedImageB, `${viewport.width}: widgets must not share the same image data`);
      assert.ok((await backgroundOf(page, '[data-drag="image"]')).includes(savedImageB),
        `${viewport.width}: uploading on the photo wall must not change the image widget`);
      assert.ok((await backgroundOf(page, '#pw1')).includes(savedPhotowall),
        `${viewport.width}: photo wall must keep its own photo`);

      await swipeTo(page, 1);
      await page.reload({ waitUntil: 'load' });
      await waitForBackground(page, '[data-drag="image"]');
      await waitForBackground(page, '#pw1');
      assert.ok((await backgroundOf(page, '[data-drag="image"]')).includes(savedImageB),
        `${viewport.width}: image widget photo must survive swipe + reload`);
      assert.ok((await backgroundOf(page, '#pw1')).includes(savedPhotowall),
        `${viewport.width}: photo wall photo must survive swipe + reload`);

      const layoutAfter = await page.evaluate(() => localStorage.getItem('ds_layout_v14'));
      assert.deepEqual(JSON.parse(layoutAfter), JSON.parse(layoutBefore),
        `${viewport.width}: widget uploads must not change the desktop layout`);
      assert.equal(pageErrors.length, 0,
        `${viewport.width}: upload/swipe/reload must not throw: ${pageErrors.join(' | ')}`);

      report.push({ viewport: `${viewport.width}x${viewport.height}`, scenario: 'normal', ok: true });
      await context.close();
    }

    // --- Scenario B: localStorage near quota ---
    {
      const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      await seedLayout(page);
      const fill = await page.evaluate(() => {
        const chunk = 'x'.repeat(64 * 1024);
        let count = 0;
        try {
          for (; count < 200; count++) localStorage.setItem('quota_fill_' + count, chunk);
        } catch (error) {
          return { count, error: error.name };
        }
        return { count, error: null };
      });
      assert.equal(fill.error, 'QuotaExceededError', `${viewport.width}: localStorage should be full for this scenario`);

      await upload(page, '[data-drag="image"]', PHOTO_A);
      await waitForBackground(page, '[data-drag="image"]');
      const saved = await page.evaluate(key => window.MAOMAOWallpaperStore.getByKey(key), IMAGE_KEY);
      assert.ok(saved && saved.startsWith('data:image/'), `${viewport.width}: photo must still save with full localStorage`);
      const toast = await readToast(page);
      assert.equal(toast && toast.show, false, `${viewport.width}: a successful save must not show a failure toast`);

      await page.reload({ waitUntil: 'load' });
      await waitForBackground(page, '[data-drag="image"]');
      assert.ok((await backgroundOf(page, '[data-drag="image"]')).includes(saved),
        `${viewport.width}: photo must survive reload even when localStorage was full`);

      report.push({ viewport: `${viewport.width}x${viewport.height}`, scenario: 'near-quota', ok: true });
      await context.close();
    }

    // --- Scenario C: save failure must be reported, never faked ---
    {
      const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
      const page = await context.newPage();
      await seedLayout(page);
      await page.evaluate(() => {
        window.MAOMAOWallpaperStore.saveByKey = () => Promise.reject(new Error('simulated quota failure'));
      });
      await upload(page, '[data-drag="image"]', PHOTO_A);
      await page.waitForFunction(() => {
        const toast = document.querySelector('#toast');
        return !!toast && toast.classList.contains('show') && toast.textContent.includes('图片保存失败');
      }, null, { timeout: 10000 });
      const background = await backgroundOf(page, '[data-drag="image"]');
      assert.equal(background.includes('data:image/'), false,
        `${viewport.width}: a failed save must not display the image as if it succeeded`);
      assert.equal(await page.evaluate(() => localStorage.getItem('ds_image_v1')), null,
        `${viewport.width}: a failed save must not fall back to writing localStorage silently`);

      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(1200);
      assert.equal((await backgroundOf(page, '[data-drag="image"]')).includes('data:image/'), false,
        `${viewport.width}: a failed save must not resurrect after reload`);

      report.push({ viewport: `${viewport.width}x${viewport.height}`, scenario: 'save-failure', ok: true });
      await context.close();
    }
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}

console.log('PASS: desktop widget image persistence');
console.table(report);
