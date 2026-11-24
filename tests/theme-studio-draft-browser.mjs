// THEME-STUDIO-QA-BATCH-3: focused Chromium regression for unsaved-draft guard,
// undo/redo history and per-role bubble draft staging, on the v146 advanced workbench.
// - A completed slider/color operation records one history node; dragging fires many
//   input events but does not flood the stack.
// - Undo/redo push each other; a fresh edit clears the redo stack; the stack caps at 30.
// - Restore-draft and preset load are undoable; applying successfully clears the dirty
//   flag, a failed apply keeps it.
// - An uploaded image asset id is part of the snapshot: undo drops the id, redo restores
//   it; no blob bytes are put into history.
// - Bubble drafts and history stay isolated between roles; switching away never discards
//   the previous role's unsaved draft or writes the other role's beauty store. Clearing a
//   role override rebuilds from the real resolved value.
// - Leaving with dirty drafts asks for confirmation; cancelling does not navigate away.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 4195;
const origin = 'http://127.0.0.1:' + port;
const outDir = resolve(root, 'test-results');
mkdirSync(outDir, { recursive: true });
const STUDIO_KEY = 'maomao_theme_studio_v1';

const vite = spawn(process.execPath, [
  resolve(root, 'node_modules/vite/bin/vite.js'),
  '--host', '127.0.0.1', '--port', String(port), '--strictPort'
], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error('Vite exited before ready');
    try { const r = await fetch(origin + '/index.html'); if (r.ok) return; } catch {}
    await delay(250);
  }
  throw new Error('Vite server did not become ready');
}

const snapshot = page => page.evaluate(() => window.MAOMAOThemeStudio._draftSnapshot());
const beautyKeys = page => page.evaluate(() =>
  Object.keys(localStorage).filter(k => k.indexOf('beauty_chat') === 0 && k !== 'beauty_chat_migrated_v1'));

const dialogQueue = [];
function onDialog(page, action, value, record) {
  dialogQueue.push({ action, value, record });
  if (!page.__dialogBound) {
    page.__dialogBound = true;
    page.on('dialog', async d => {
      const next = dialogQueue.shift() || { action: 'dismiss' };
      if (next.record) next.record(d.message());
      if (next.action === 'accept') await d.accept(next.value); else await d.dismiss();
    });
  }
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
async function uploadCoverImage(page, fill) {
  const imageData = await page.evaluate((color) => {
    const canvas = document.createElement('canvas');
    canvas.width = 16; canvas.height = 12;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = color || '#777777'; ctx.fillRect(0, 0, 16, 12);
    return canvas.toDataURL('image/png');
  }, fill || '#777777');
  const buffer = Buffer.from(imageData.slice(imageData.indexOf(',') + 1), 'base64');
  await page.locator('#imageSlots .image-slot').first().locator('button').first().click();
  await page.locator('#imageFile').setInputFiles({ name: 'synthetic-qa.png', mimeType: 'image/png', buffer });
}
async function uploadImport(page, name, text, mime) {
  const buffer = Buffer.from(text, 'utf8');
  await page.setInputFiles('#importFile', [{ name, mimeType: mime || 'application/json', buffer }]);
  await delay(120);
}
const undoDisabled = page => page.evaluate(() => document.getElementById('undoButton').disabled);
const redoDisabled = page => page.evaluate(() => document.getElementById('redoButton').disabled);
const dirtyHidden = page => page.evaluate(() => document.getElementById('dirtyTag').hidden);

let count = 0;
let browser = null;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  for (const width of [375, 390, 430]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    dialogQueue.length = 0;

    await page.goto(origin + '/theme-studio/theme-studio.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#previewSurface', { timeout: 15000 });
    await delay(200);

    // 1. Clean load: no dirty flag, empty history, both buttons disabled.
    let snap = await snapshot(page);
    assert.equal(snap.dirty, false, width + 'px clean load is not dirty');
    assert.equal(snap.undo, 0, width + 'px clean load has empty undo stack');
    assert.equal(snap.redo, 0, width + 'px clean load has empty redo stack');
    assert.equal(await undoDisabled(page), true, width + 'px undo disabled on clean load');
    assert.equal(await redoDisabled(page), true, width + 'px redo disabled on clean load');
    assert.equal(await dirtyHidden(page), true, width + 'px dirty tag hidden on clean load');
    const baseRadius = snap.list.itemRadius;

    // 1b. Restoring an unchanged draft creates no phantom undo node and keeps redo empty.
    await page.click('#restoreDraft');
    await delay(80);
    snap = await snapshot(page);
    assert.equal(snap.undo, 0, width + 'px restore on unchanged draft adds no history node');
    assert.equal(snap.redo, 0, width + 'px unchanged restore keeps redo empty');
    assert.equal(snap.dirty, false, width + 'px unchanged restore stays clean');

    // 2. One completed slider operation records a single node and marks dirty.
    await editRange(page, '#edit-itemRadius', '22');
    snap = await snapshot(page);
    assert.equal(snap.list.itemRadius, 22, width + 'px slider draft applied');
    assert.equal(snap.dirty, true, width + 'px edited draft is dirty');
    assert.equal(snap.undo, 1, width + 'px one slider operation = one history node');
    assert.equal(snap.redo, 0, width + 'px fresh edit clears redo');
    assert.equal(await undoDisabled(page), false, width + 'px undo enabled after edit');
    assert.equal(await dirtyHidden(page), false, width + 'px dirty tag visible after edit');

    // 3. Undo restores the baseline and clears dirty; redo becomes available.
    await page.click('#undoButton');
    snap = await snapshot(page);
    assert.equal(snap.list.itemRadius, baseRadius, width + 'px undo restores baseline radius');
    assert.equal(snap.dirty, false, width + 'px undo to baseline clears dirty');
    assert.equal(snap.undo, 0, width + 'px undo popped the node');
    assert.equal(snap.redo, 1, width + 'px redo holds the undone edit');
    assert.equal(await dirtyHidden(page), true, width + 'px dirty tag hidden after undo to baseline');

    // 4. Redo restores the edit.
    await page.click('#redoButton');
    snap = await snapshot(page);
    assert.equal(snap.list.itemRadius, 22, width + 'px redo restores the edit');
    assert.equal(snap.dirty, true, width + 'px redo restores dirty state');
    assert.equal(snap.redo, 0, width + 'px redo popped the node');

    // 5. Undo then a fresh edit clears the redo stack.
    await page.click('#undoButton');
    await editRange(page, '#edit-itemRadius', '18');
    snap = await snapshot(page);
    assert.equal(snap.list.itemRadius, 18, width + 'px fresh edit applied');
    assert.equal(snap.redo, 0, width + 'px fresh edit clears redo stack');

    // 6. History cap at 30 nodes. Reload afterwards to reset the in-memory stack so this
    //    saturation check does not pollute the later per-action assertions.
    for (let i = 0; i < 31; i++) await editRange(page, '#edit-itemRadius', String(10 + (i % 20)));
    snap = await snapshot(page);
    assert.ok(snap.undo <= 30, width + 'px undo stack capped at 30, got ' + snap.undo);
    await page.click('#restoreDraft');
    await delay(80);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#previewSurface', { timeout: 15000 });
    await delay(200);

    // 7. Color picker change records one node.
    await editColor(page, '#edit-headerBg', '#1a1a1a');
    snap = await snapshot(page);
    assert.equal(snap.list.headerBg, '#1a1a1a', width + 'px color draft applied');
    assert.ok(snap.undo >= 1, width + 'px color change records history');

    // 8. Restore-draft is undoable and returns to the saved baseline.
    await page.click('#restoreDraft');
    snap = await snapshot(page);
    assert.equal(snap.dirty, false, width + 'px restore to baseline clears dirty');
    assert.ok(snap.undo >= 1, width + 'px restore itself is an undoable action');
    await page.click('#undoButton');
    snap = await snapshot(page);
    assert.equal(snap.list.headerBg, '#1a1a1a', width + 'px undo restores the pre-restore draft');

    // 9. Preset load is undoable: save a preset, change the draft, load it back.
    onDialog(page, 'accept', '列表方案');
    await page.click('#savePreset');
    await delay(120);

    // 9b. Loading a preset that already matches the draft records no phantom history node.
    let snapMatch = await snapshot(page);
    const undoBeforeMatchingLoad = snapMatch.undo;
    await page.locator('.preset-entry .preset-use').first().click();
    await delay(120);
    snapMatch = await snapshot(page);
    assert.equal(snapMatch.undo, undoBeforeMatchingLoad, width + 'px matching preset load adds no history node');

    await editRange(page, '#edit-itemRadius', '30');
    await page.locator('.preset-entry .preset-use').first().click();
    await delay(120);
    snap = await snapshot(page);
    assert.notEqual(snap.list.itemRadius, 30, width + 'px preset load replaced the draft');
    await page.click('#undoButton');
    snap = await snapshot(page);
    assert.equal(snap.list.itemRadius, 30, width + 'px undo reverts the preset load');

    // 10. Successful apply clears dirty; a quota failure keeps dirty.
    await editRange(page, '#edit-itemRadius', '25');
    await page.click('#applyButton');
    await delay(120);
    snap = await snapshot(page);
    assert.equal(snap.dirty, false, width + 'px successful apply clears dirty');

    await page.evaluate(() => {
      const original = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function () { throw new Error('QuotaExceededError'); };
      localStorage.setItem._original = original;
    });
    await editRange(page, '#edit-itemRadius', '27');
    await page.click('#applyButton');
    await delay(120);
    snap = await snapshot(page);
    assert.equal(snap.dirty, true, width + 'px failed apply keeps dirty');
    await page.evaluate(() => { localStorage.setItem = localStorage.setItem._original; });

    // 10b. A list-only import records history only for the list section; the detail and
    //     bubble stacks gain no phantom node and keep their redo.
    const detailUndoBefore = (snap.stacks.detail || { undo: 0 }).undo;
    const bubbleUndoBefore = (snap.stacks['bubble:global'] || { undo: 0 }).undo;
    await uploadImport(page, 'list-only.json', JSON.stringify({
      format: 'maomao-theme-studio', version: 1, list: { itemRadius: 14 }
    }));
    snap = await snapshot(page);
    assert.equal((snap.stacks.detail || { undo: 0 }).undo, detailUndoBefore,
      width + 'px list-only import adds no detail history');
    assert.equal((snap.stacks['bubble:global'] || { undo: 0 }).undo, bubbleUndoBefore,
      width + 'px list-only import adds no bubble history');
    assert.ok((snap.stacks.list || { undo: 0 }).undo >= 1,
      width + 'px list section records the import node');
    assert.equal(await dirtyHidden(page), false, width + 'px import marks current context dirty immediately');
    assert.equal(await undoDisabled(page), false, width + 'px import enables undo immediately');

    // 10c. Image asset ids are part of the snapshot. A later upload's undo must roll
    //      back only that image: an unrelated radius edit made after the first upload
    //      survives undoing the second upload.
    await uploadCoverImage(page, '#777777');
    await page.waitForFunction(() =>
      /^as_[A-Z2-7]{32}$/.test(window.MAOMAOThemeStudio._draftSnapshot().list.coverImage),
      null, { timeout: 15000 });
    snap = await snapshot(page);
    const coverA = snap.list.coverImage;
    assert.match(coverA, /^as_[A-Z2-7]{32}$/, width + 'px first uploaded image stores an asset id');

    await editRange(page, '#edit-itemRadius', '30');

    await uploadCoverImage(page, '#333333');
    await page.waitForFunction((prev) => {
      const id = window.MAOMAOThemeStudio._draftSnapshot().list.coverImage;
      return /^as_[A-Z2-7]{32}$/.test(id) && id !== prev;
    }, coverA, { timeout: 15000 });
    snap = await snapshot(page);
    const coverB = snap.list.coverImage;
    assert.notEqual(coverB, coverA, width + 'px second upload produces a distinct asset id');

    // Undo the second upload: first image returns, the radius edit (30) is NOT rolled back.
    await page.click('#undoButton');
    snap = await snapshot(page);
    assert.equal(snap.list.coverImage, coverA, width + 'px undo second upload restores first image');
    assert.equal(snap.list.itemRadius, 30, width + 'px unrelated radius edit survives undoing the image');

    // Undo the radius edit, then the first upload.
    await page.click('#undoButton');
    snap = await snapshot(page);
    assert.equal(snap.list.coverImage, coverA, width + 'px undo radius edit keeps the first image');
    await page.click('#undoButton');
    snap = await snapshot(page);
    assert.equal(snap.list.coverImage, '', width + 'px undo drops the first uploaded image id');

    // 11. Leaving with dirty drafts asks; cancelling does not navigate away.
    await editRange(page, '#edit-itemRadius', '29');
    onDialog(page, 'dismiss');
    await page.evaluate(() => document.querySelector('.back').click());
    await delay(120);
    assert.ok(page.url().includes('theme-studio.html'), width + 'px cancelled back keeps the workbench');

    // 11b. An unsaved bubble draft still guards exit after switching to list/detail. The
    //      leaving bubble draft is staged in memory only; list/detail stay clean, but
    //      anyDirty() must still see the unsaved bubble change and block leaving.
    await page.click('#restoreDraft');
    await delay(80);
    await page.click('[data-tab="bubble"]');
    await delay(120);
    await editColor(page, '#edit-myBubbleBg', '#dddddd');
    const tabSwitchUndo = (await snapshot(page)).undo;

    // Switch to list without touching list fields: bubble draft keeps anyDirty true.
    await page.click('[data-tab="list"]');
    await delay(120);
    snap = await snapshot(page);
    assert.equal(snap.tab, 'list', width + 'px switched to list');
    assert.equal(snap.contextDirty, false, width + 'px list context stays clean');
    assert.equal(snap.dirty, true, width + 'px unsaved global bubble draft still flags dirty on list tab');
    onDialog(page, 'dismiss');
    await page.evaluate(() => document.querySelector('.back').click());
    await delay(120);
    assert.ok(page.url().includes('theme-studio.html'), width + 'px cancelled back keeps the workbench on list');

    // Switch to detail: the same exit guard applies.
    await page.click('[data-tab="detail"]');
    await delay(120);
    snap = await snapshot(page);
    assert.equal(snap.tab, 'detail', width + 'px switched to detail');
    assert.equal(snap.dirty, true, width + 'px unsaved global bubble draft still flags dirty on detail tab');
    onDialog(page, 'dismiss');
    await page.evaluate(() => document.querySelector('.back').click());
    await delay(120);
    assert.ok(page.url().includes('theme-studio.html'), width + 'px cancelled back keeps the workbench on detail');

    // Back to bubble: the draft and its undo history survive the tab switches.
    await page.click('[data-tab="bubble"]');
    await delay(120);
    snap = await snapshot(page);
    assert.equal(snap.bubble.myBubbleBg, '#dddddd', width + 'px bubble draft survives the tab switches');
    assert.equal(snap.undo, tabSwitchUndo, width + 'px bubble history survives the tab switches');
    // Revert to baseline so no global bubble override leaks into the role matrix below.
    await page.click('#restoreDraft');
    await delay(80);

    // 12. Per-role bubble drafts and history stay isolated.
    await page.click('#restoreDraft');
    await delay(80);
    await page.evaluate(() => localStorage.setItem('ai_custom_characters', JSON.stringify([
      { id: 'role-a', name: '角色 A' }, { id: 'role-b', name: '角色 B' }
    ])));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#previewSurface', { timeout: 15000 });
    await delay(200);
    await page.click('[data-tab="bubble"]');
    await delay(120);

    await editColor(page, '#edit-myBubbleBg', '#aaaaaa');
    let globalSnap = await snapshot(page);
    assert.equal(globalSnap.bubble.myBubbleBg, '#aaaaaa', width + 'px global bubble draft staged');
    assert.equal(globalSnap.contextDirty, true, width + 'px global bubble edit is dirty without switching scope');
    assert.equal(await dirtyHidden(page), false, width + 'px global dirty tag visible without scope switch');
    assert.equal(await undoDisabled(page), false, width + 'px global undo enabled without scope switch');
    const globalUndo = globalSnap.undo;

    await page.selectOption('#bubbleScope', 'role-a');
    await delay(120);
    await editColor(page, '#edit-myBubbleBg', '#bbbbbb');
    let roleSnap = await snapshot(page);
    assert.equal(roleSnap.bubble.myBubbleBg, '#bbbbbb', width + 'px role A bubble draft staged');
    assert.equal(roleSnap.scope, 'role-a', width + 'px scope switched to role A');
    assert.equal(roleSnap.contextDirty, true, width + 'px role A bubble edit is dirty without switching back');

    // Back to global: its staged draft survives; role A's history does not leak in.
    await page.selectOption('#bubbleScope', 'global');
    await delay(120);
    globalSnap = await snapshot(page);
    assert.equal(globalSnap.bubble.myBubbleBg, '#aaaaaa', width + 'px global draft restored after role switch');
    assert.equal(globalSnap.undo, globalUndo, width + 'px global history isolated from role A');

    await page.selectOption('#bubbleScope', 'role-a');
    await delay(120);
    roleSnap = await snapshot(page);
    assert.equal(roleSnap.bubble.myBubbleBg, '#bbbbbb', width + 'px role A draft still staged on return');
    assert.deepEqual(await beautyKeys(page), [], width + 'px unsaved bubble draft writes no beauty scope');

    // Role A's unsaved draft also keeps the exit guard armed after switching to list.
    await page.click('[data-tab="list"]');
    await delay(120);
    roleSnap = await snapshot(page);
    assert.equal(roleSnap.dirty, true, width + 'px unsaved role A bubble draft still flags dirty on list tab');
    await page.click('[data-tab="bubble"]');
    await delay(120);

    // 12b. Clearing role A's override rebuilds from the real resolved value; it must not
    //     reuse the stale staged draft as the applied baseline, and must not touch global
    //     or role B drafts.
    await page.selectOption('#bubbleScope', 'role-b');
    await delay(120);
    await editColor(page, '#edit-myBubbleBg', '#cccccc');
    await page.selectOption('#bubbleScope', 'role-a');
    await delay(120);
    const resolvedBefore = await page.evaluate(() => {
      const v = window.ChatBeauty.resolve('role-a');
      return { myBubbleBg: v.myBubbleBg };
    });
    await page.click('#disableButton');
    await delay(120);
    roleSnap = await snapshot(page);
    const resolvedAfter = await page.evaluate(() => {
      const v = window.ChatBeauty.resolve('role-a');
      return { myBubbleBg: v.myBubbleBg };
    });
    assert.equal(roleSnap.bubble.myBubbleBg, resolvedAfter.myBubbleBg,
      width + 'px cleared role A draft matches the real resolved value');
    assert.equal(resolvedAfter.myBubbleBg, resolvedBefore.myBubbleBg,
      width + 'px resolve stays stable after clearing role A');
    assert.equal(roleSnap.contextDirty, false, width + 'px cleared role A context is not dirty');
    assert.equal(await dirtyHidden(page), true, width + 'px dirty tag hidden after clear');

    await page.selectOption('#bubbleScope', 'role-b');
    await delay(120);
    roleSnap = await snapshot(page);
    assert.equal(roleSnap.bubble.myBubbleBg, '#cccccc', width + 'px role B draft survives clearing role A');

    await page.selectOption('#bubbleScope', 'global');
    await delay(120);
    globalSnap = await snapshot(page);
    assert.equal(globalSnap.bubble.myBubbleBg, '#aaaaaa', width + 'px global draft survives clearing role A');

    assert.deepEqual(pageErrors, [], width + 'px workbench should not throw runtime errors');
    await page.screenshot({ path: resolve(outDir, `theme-studio-draft-${width}.png`) });

    // 13. Confirming the back navigation leaves once; the native beforeunload must not
    //     block the accepted navigation a second time.
    onDialog(page, 'accept');
    await Promise.all([
      page.waitForNavigation({ timeout: 5000 }),
      page.evaluate(() => document.querySelector('.back').click())
    ]);
    assert.ok(!page.url().includes('theme-studio.html'),
      width + 'px accepted back navigates away from the workbench');

    count++;
    console.log('PASS theme-studio draft guard + undo/redo @ ' + width + 'px');
    await context.close();
  }
} finally {
  try { if (browser) await browser.close(); } catch {}
  vite.kill('SIGTERM');
  setTimeout(() => process.exit(count === 3 ? 0 : 1), 300);
}
console.log(count + ' draft-guard scenarios passed');
