import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from 'playwright';

// DESKTOP-WIDGET-IMAGE-002:
// 1) full backup really contains the IndexedDB widget photos (not only legacy ds_* keys)
// 2) clean-profile restore brings back all nine independently uploaded widget image slots
// 3) legacy ds_* compatibility (legacy-only read, new wins, legacy never overwrites)
// 4) cross-device migration via the existing backup import (NOT cloud sync)
// 5) partial/corrupt restore keeps existing images and reports the failure

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

const WIDGETS = [
  { name: 'image', click: '[data-drag="image"]', render: '[data-drag="image"]', key: 'home_widget_image_v1_image_img', legacyKey: 'ds_image_v1' },
  { name: 'postcard-background', click: '#pcBgTop', render: '#pcBgTop', key: 'home_widget_image_v1_postcard_background', legacyKey: 'ds_postcard_v1' },
  { name: 'postcard-avatar', click: '#pcAvatar', render: '#pcAvatar', key: 'home_widget_image_v1_postcard_avatar', legacyKey: 'ds_postcard_v1' },
  { name: 'polaroid', click: '#poImg', render: '#poImg', key: 'home_widget_image_v1_polaroid_img', legacyKey: 'ds_polaroid_v1' },
  { name: 'dialog-them-avatar', click: '#dlAvatarThem', render: '#dlAvatarThem', key: 'home_widget_image_v1_dialog_themAvatar', legacyKey: 'ds_dialog_v1' },
  { name: 'dialog-me-avatar', click: '#dlAvatarMe', render: '#dlAvatarMe', key: 'home_widget_image_v1_dialog_meAvatar', legacyKey: 'ds_dialog_v1' },
  { name: 'social-avatar', click: '#scAvatar', render: '#scAvatar .sc-photo-inner', key: 'home_widget_image_v1_social_avatar', legacyKey: 'ds_social_v1' },
  { name: 'social-photo-1', click: '#scP1', render: '#scP1 .sc-p-photo', key: 'home_widget_image_v1_social_p1', legacyKey: 'ds_social_v1' },
  { name: 'social-photo-2', click: '#scP2', render: '#scP2 .sc-p-photo', key: 'home_widget_image_v1_social_p2', legacyKey: 'ds_social_v1' }
];
const PHOTOS_A = WIDGETS.map((_, index) => makeNoisePng(320, 320, 1000 + index * 7919));
const PHOTOS_B = WIDGETS.map((_, index) => makeNoisePng(320, 320, 50000 + index * 6151));
const LAYOUT = {
  v: 14,
  pages: [['image'], ['postcard'], ['polaroid'], ['dialog'], ['social'], ['app_characters', 'app_library']],
  dock: ['app_chat', 'app_shop'],
  removed: []
};

async function seedDesktop(page) {
  await page.goto(`${baseUrl}/index.html`, { waitUntil: 'load' });
  await page.evaluate(layout => localStorage.setItem('ds_layout_v14', JSON.stringify(layout)), LAYOUT);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(300);
}

async function pageIndexOfWidget(page, widget) {
  return page.evaluate(selector => {
    const el = document.querySelector(selector);
    const pageEl = el && el.closest('.home-page');
    return pageEl ? Array.prototype.indexOf.call(document.querySelectorAll('.home-page'), pageEl) : -1;
  }, widget.click);
}

async function swipeTo(page, index) {
  if (index < 0) return;
  await page.evaluate(i => {
    const home = document.getElementById('homeScreen');
    home.scrollLeft = i * home.clientWidth;
  }, index);
  await page.waitForTimeout(350);
}

async function gotoWidget(page, widget) {
  await swipeTo(page, await pageIndexOfWidget(page, widget));
}

async function readSaved(page, key) {
  return page.evaluate(async k => {
    const value = await window.MAOMAOWallpaperStore.getByKey(k);
    if (!value) return '';
    return typeof value === 'string' ? value : (value.dataUrl || '');
  }, key);
}

async function waitSaved(page, key) {
  await page.waitForFunction(async k => !!(await window.MAOMAOWallpaperStore.getByKey(k)), key, { timeout: 15000 });
}

async function waitRender(page, selector, dataUrl) {
  await page.waitForFunction(({ sel, expected }) => {
    const el = document.querySelector(sel);
    return !!el && el.style.backgroundImage.includes(expected);
  }, { sel: selector, expected: dataUrl }, { timeout: 15000 });
}

async function uploadWidget(page, widget, photo) {
  await gotoWidget(page, widget);
  const target = page.locator(widget.click);
  await target.scrollIntoViewIfNeeded();
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
  await target.click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: widget.name + '.png', mimeType: 'image/png', buffer: photo });
  await waitSaved(page, widget.key);
  const saved = await readSaved(page, widget.key);
  assert.ok(saved.startsWith('data:image/'), `${widget.name}: photo must be stored in IndexedDB`);
  await waitRender(page, widget.render, saved);
  return saved;
}

async function uploadAll(page, photos) {
  const saved = {};
  for (let index = 0; index < WIDGETS.length; index++) {
    saved[WIDGETS[index].name] = await uploadWidget(page, WIDGETS[index], photos[index]);
  }
  await swipeTo(page, 0);
  return saved;
}

async function exportBackup(page, tag) {
  await page.goto(`${baseUrl}/settings/settings.html`, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.locator('#rowExportData').click()
  ]);
  const file = path.join(os.tmpdir(), `maomao-backup-test-${tag}-${Date.now()}.json`);
  await download.saveAs(file);
  assert.ok(fs.statSync(file).size > 1000, 'backup file must not be empty');
  return file;
}

function decodeImage(value) {
  const comma = value.indexOf(',');
  assert.ok(comma > 0, 'backup value must be a data URL');
  const bytes = Buffer.from(value.slice(comma + 1), 'base64');
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes[0] === 0x89 && bytes.toString('ascii', 1, 4) === 'PNG';
  assert.ok(isJpeg || isPng, 'backup value must decode to a real image');
  return { bytes: bytes.length, format: isJpeg ? 'JPEG' : 'PNG' };
}

function inspectBackup(file, saved) {
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(backup.__backup && backup.__backup.schema >= 2, 'backup must be schema >= 2');
  const wallpapers = backup.indexedDB && backup.indexedDB['maomao-media-store']
    && backup.indexedDB['maomao-media-store'].wallpapers;
  assert.ok(Array.isArray(wallpapers), 'backup must include the wallpapers IndexedDB store');
  const byKey = new Map(wallpapers.map(record => [record.__key, record.__value]));
  const rows = [];
  for (const widget of WIDGETS) {
    const record = byKey.get(widget.key);
    assert.ok(record, `${widget.name}: IndexedDB record missing from backup`);
    const value = typeof record === 'string' ? record : record.dataUrl;
    assert.equal(value, saved[widget.name], `${widget.name}: backup must carry the exact IndexedDB photo`);
    const decoded = decodeImage(value);
    rows.push({
      widget: widget.name,
      indexedDBKey: widget.key,
      chars: value.length,
      bytes: decoded.bytes,
      format: decoded.format,
      legacyKeyInBackup: Object.prototype.hasOwnProperty.call(backup.data || {}, widget.legacyKey)
    });
  }
  return { backup, wallpapers, rows };
}

async function importBackup(page, file, expectedToastPattern) {
  page.once('dialog', dialog => dialog.accept().catch(() => {}));
  await page.goto(`${baseUrl}/settings/settings.html`, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const toastSeen = page.waitForFunction(pattern => {
    const toast = document.getElementById('toastMsg');
    return !!toast && toast.classList.contains('show') && new RegExp(pattern).test(toast.textContent);
  }, expectedToastPattern, { timeout: 20000 }).then(() => true).catch(() => false);
  await page.setInputFiles('#importFileInput', file);
  const seen = await toastSeen;
  await page.waitForTimeout(2500);
  await page.waitForLoadState('load');
  return seen;
}

async function ensureLayout(page) {
  const hasLayout = await page.evaluate(() => {
    try { return !!JSON.parse(localStorage.getItem('ds_layout_v14') || 'null'); } catch { return false; }
  });
  if (!hasLayout) {
    await page.evaluate(layout => localStorage.setItem('ds_layout_v14', JSON.stringify(layout)), LAYOUT);
    await page.reload({ waitUntil: 'load' });
  }
  await page.waitForTimeout(300);
}

async function verifyAllWidgets(page, saved) {
  const results = {};
  for (const widget of WIDGETS) {
    await gotoWidget(page, widget);
    await waitRender(page, widget.render, saved[widget.name]);
    const persisted = await readSaved(page, widget.key);
    assert.equal(persisted, saved[widget.name], `${widget.name}: IndexedDB value must match after restore`);
    results[widget.name] = 'restored';
  }
  return results;
}

async function withPersistentProfile(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `maomao-${name}-`));
  const context = await chromium.launchPersistentContext(dir, {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true
  });
  try {
    return await fn(context);
  } finally {
    await context.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const report = { backup: [], restore: [], legacy: [], crossDevice: [], partial: [] };
const browser = await chromium.launch({ headless: true });
const tmpFiles = [];
try {
  // ---------- 1. Full backup contains real IndexedDB photos ----------
  let exportedFile;
  let savedA;
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await seedDesktop(page);
    savedA = await uploadAll(page, PHOTOS_A);
    exportedFile = await exportBackup(page, 'main');
    tmpFiles.push(exportedFile);
    const inspected = inspectBackup(exportedFile, savedA);
    report.backup = inspected.rows;
    console.log('GROUP 1 full backup: IndexedDB wallpapers records');
    console.table(inspected.rows);
    console.log('localStorage legacy keys in backup:',
      Object.keys(inspected.backup.data || {}).filter(key => key.startsWith('ds_')).sort());
    await context.close();
  }

  // ---------- 2. Clean-profile restore ----------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const importToast = await importBackup(page, exportedFile, '导入成功');
    assert.equal(importToast, true, 'restore must report success');
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'load' });
    await ensureLayout(page);
    report.restore = await verifyAllWidgets(page, savedA);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(600);
    const afterReload = await verifyAllWidgets(page, savedA);
    console.log('GROUP 2 clean restore:', report.restore, 'after reload:', afterReload);
    await context.close();
  }

  // ---------- 3. Legacy ds_* compatibility ----------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await seedDesktop(page);
    const legacyA = 'data:image/png;base64,' + PHOTOS_B[0].toString('base64');
    const newB = 'data:image/png;base64,' + PHOTOS_A[0].toString('base64');
    await page.evaluate(value => localStorage.setItem('ds_image_v1', JSON.stringify({ img: value })), legacyA);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await waitRender(page, '[data-drag="image"]', legacyA);
    report.legacy.push({ check: 'legacy-only read', result: 'PASS' });

    // New data in IndexedDB must win over the legacy value.
    await page.evaluate(({ key, value }) => window.MAOMAOWallpaperStore.saveByKey(key, value), { key: WIDGETS[0].key, value: newB });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(600);
    await waitRender(page, '[data-drag="image"]', newB);
    assert.equal(await page.evaluate(() => document.querySelector('[data-drag="image"]').style.backgroundImage.includes('data:image/png;base64,' + JSON.parse(localStorage.getItem('ds_image_v1')).img.split(',')[1]) === false), true);
    report.legacy.push({ check: 'new IndexedDB wins over legacy', result: 'PASS' });

    // Upload a fresh photo while the legacy value still exists.
    const uploaded = await uploadWidget(page, WIDGETS[0], PHOTOS_A[1]);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(600);
    await waitRender(page, '[data-drag="image"]', uploaded);
    const legacyStillThere = await page.evaluate(() => localStorage.getItem('ds_image_v1'));
    assert.ok(legacyStillThere, 'legacy ds_* data must not be deleted');
    assert.equal(JSON.parse(legacyStillThere).img, legacyA, 'legacy value must remain untouched');
    assert.equal(await readSaved(page, WIDGETS[0].key), uploaded);
    report.legacy.push({ check: 'legacy never overwrites new upload, not deleted', result: 'PASS' });
    console.log('GROUP 3 legacy compatibility:', report.legacy);
    await context.close();
  }

  // ---------- 4. Cross-device migration via backup import (not cloud sync) ----------
  {
    let deviceFile;
    let deviceSaved;
    await withPersistentProfile('device-a', async context => {
      const page = context.pages()[0] || await context.newPage();
      await seedDesktop(page);
      deviceSaved = await uploadAll(page, PHOTOS_A);
      deviceFile = await exportBackup(page, 'device-a');
      tmpFiles.push(deviceFile);
    });
    await withPersistentProfile('device-b', async context => {
      const page = context.pages()[0] || await context.newPage();
      const ok = await importBackup(page, deviceFile, '导入成功');
      assert.equal(ok, true, 'cross-device import must report success');
      await page.goto(`${baseUrl}/index.html`, { waitUntil: 'load' });
      await ensureLayout(page);
      report.crossDevice.push({ step: 'import into separate profile', result: 'PASS' });
      report.crossDevice.push({ widgets: await verifyAllWidgets(page, deviceSaved) });
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(600);
      await verifyAllWidgets(page, deviceSaved);
      report.crossDevice.push({ step: 'still present after reload', result: 'PASS' });
    });
    console.log('GROUP 4 cross-device (backup import only, NOT cloud sync):', report.crossDevice);
  }

  // ---------- 5. Partial/corrupt backup must keep existing photos ----------
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await seedDesktop(page);
    const existing = await uploadAll(page, PHOTOS_B);

    const original = JSON.parse(fs.readFileSync(exportedFile, 'utf8'));
    const wallpapers = original.indexedDB['maomao-media-store'].wallpapers;
    const polaroidKey = WIDGETS.find(widget => widget.name === 'polaroid').key;
    const corruptionCases = [
      { label: 'null value', mutate: record => { record.__value = null; } },
      { label: 'non-image text', mutate: record => { record.__value = 'not-an-image'; } },
      { label: 'invalid base64 data URL', mutate: record => { record.__value = 'data:image/png;base64,%%%'; } },
      { label: 'invalid dataUrl wrapper', mutate: record => { record.__value = { dataUrl: 'data:image/png;base64,%%%' }; } }
    ];

    for (const corruptionCase of corruptionCases) {
      const damagedBackup = JSON.parse(JSON.stringify(original));
      const damagedWallpapers = damagedBackup.indexedDB['maomao-media-store'].wallpapers;
      const victim = damagedWallpapers.find(record => record.__key === polaroidKey);
      assert.ok(victim, 'fixture must contain the polaroid record');
      corruptionCase.mutate(victim);

      const corruptedFile = path.join(os.tmpdir(), `maomao-backup-corrupt-${corruptionCase.label.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}.json`);
      fs.writeFileSync(corruptedFile, JSON.stringify(damagedBackup));
      tmpFiles.push(corruptedFile);

      const toastSeen = await importBackup(page, corruptedFile, '图片库备份记录损坏');
      assert.equal(toastSeen, true, corruptionCase.label + ': corrupt wallpaper backup must be reported');
      await page.goto(`${baseUrl}/index.html`, { waitUntil: 'load' });
      await ensureLayout(page);
      await page.waitForTimeout(600);
      for (const widget of WIDGETS) {
        assert.equal(await readSaved(page, widget.key), existing[widget.name],
          widget.name + ': existing photo must be preserved for ' + corruptionCase.label);
      }
      const preserved = await verifyAllWidgets(page, existing);
      report.partial.push({ check: corruptionCase.label + ': all existing photos preserved', result: 'PASS', widgets: preserved });
    }
    report.partial.push({ check: 'all corrupt wallpaper cases show a warning', result: 'PASS', cases: corruptionCases.map(item => item.label) });

    // Invalid JSON must also leave data untouched.
    const invalidFile = path.join(os.tmpdir(), `maomao-backup-invalid-${Date.now()}.json`);
    fs.writeFileSync(invalidFile, '{ this is not json');
    tmpFiles.push(invalidFile);
    const invalidToast = await importBackup(page, invalidFile, '导入失败');
    assert.equal(invalidToast, true, 'invalid JSON must be reported');
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'load' });
    await page.waitForTimeout(600);
    for (const widget of WIDGETS) {
      assert.equal(await readSaved(page, widget.key), existing[widget.name],
        `${widget.name}: invalid import must not change existing photos`);
    }
    report.partial.push({ check: 'invalid JSON keeps existing photos', result: 'PASS' });
    console.log('GROUP 5 partial/corrupt consistency:', report.partial);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  for (const file of tmpFiles) { try { fs.unlinkSync(file); } catch {} }
}

console.log('PASS: desktop widget image backup/restore compatibility');
console.log(JSON.stringify(report, null, 2));
