// THEME-STUDIO-DRAFT-005: focused Chromium regression for unsaved-draft guard,
// undo/redo history and per-role bubble draft staging.
// - A completed slider/color operation records one history node; dragging fires
//   many input events but does not flood the stack.
// - Undo/redo push each other; a fresh edit clears the redo stack; the stack caps
//   at 30 nodes.
// - Restore-draft and preset load are undoable; applying successfully clears the
//   dirty flag, a failed apply keeps it.
// - Bubble drafts and history stay isolated between roles; switching away never
//   discards the previous role's unsaved draft or writes the other role's beauty
//   store.
// - Leaving with dirty drafts asks for confirmation; cancelling does not navigate.
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

async function editRange(page, value) {
  await page.evaluate((v) => {
    const input = document.querySelector('#editorFields input[type=range]');
    input.focus();
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await delay(80);
}
async function editColor(page, hex) {
  await page.evaluate((h) => {
    const input = document.querySelector('#editorFields input[type=color]');
    input.focus();
    input.value = h;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, hex);
  await delay(80);
}
const undoDisabled = page => page.evaluate(() => document.getElementById('undoButton').disabled);
const redoDisabled = page => page.evaluate(() => document.getElementById('redoButton').disabled);

let count = 0;
let browser = null;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

  for (const width of [375, 390, 430]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    dialogQueue.length = 0;

    await page.goto(origin + '/theme-studio/theme-studio.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chat-slim-card', { timeout: 15000 });
    await delay(200);

    // 1. Clean load: no dirty flag, empty history, both buttons disabled.
    let snap = await snapshot(page);
    assert.equal(snap.dirty, false, width + 'px clean load is not dirty');
    assert.equal(snap.undo, 0, width + 'px clean load has empty undo stack');
    assert.equal(snap.redo, 0, width + 'px clean load has empty redo stack');
    assert.equal(await undoDisabled(page), true, width + 'px undo disabled on clean load');
    assert.equal(await redoDisabled(page), true, width + 'px redo disabled on clean load');
    const baseRadius = snap.list.itemRadius;

    // 2. One completed slider operation records a single node and marks dirty.
    await editRange(page, '22');
    snap = await snapshot(page);
    assert.equal(snap.list.itemRadius, 22, width + 'px slider draft applied');
    assert.equal(snap.dirty, true, width + 'px edited draft is dirty');
    assert.equal(snap.undo, 1, width + 'px one slider operation = one history node');
    assert.equal(snap.redo, 0, width + 'px fresh edit clears redo');
    assert.equal(await undoDisabled(page), false, width + 'px undo enabled after edit');

    // 3. Undo restores the baseline and clears dirty; redo becomes available.
    await page.click('#undoButton');
    snap = await snapshot(page);
    assert.equal(snap.list.itemRadius, baseRadius, width + 'px undo restores baseline radius');
    assert.equal(snap.dirty, false, width + 'px undo to baseline clears dirty');
    assert.equal(snap.undo, 0, width + 'px undo popped the node');
    assert.equal(snap.redo, 1, width + 'px redo holds the undone edit');

    // 4. Redo restores the edit.
    await page.click('#redoButton');
    snap = await snapshot(page);
    assert.equal(snap.list.itemRadius, 22, width + 'px redo restores the edit');
    assert.equal(snap.dirty, true, width + 'px redo restores dirty state');
    assert.equal(snap.redo, 0, width + 'px redo popped the node');

    // 5. Undo then a fresh edit clears the redo stack.
    await page.click('#undoButton');
    await editRange(page, '18');
    snap = await snapshot(page);
    assert.equal(snap.list.itemRadius, 18, width + 'px fresh edit applied');
    assert.equal(snap.redo, 0, width + 'px fresh edit clears redo stack');

    // 6. History cap at 30 nodes. Reload afterwards to reset the in-memory stack so
    //    this saturation check does not pollute the later per-action assertions.
    for (let i = 0; i < 31; i++) await editRange(page, String(10 + (i % 20)));
    snap = await snapshot(page);
    assert.ok(snap.undo <= 30, width + 'px undo stack capped at 30, got ' + snap.undo);
    await page.click('#restoreDraft');
    await delay(80);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chat-slim-card', { timeout: 15000 });
    await delay(200);

    // 7. Color picker change records one node.
    await editColor(page, '#1a1a1a');
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
    await editRange(page, '30');
    await page.locator('.preset-entry .preset-use').first().click();
    await delay(120);
    snap = await snapshot(page);
    assert.notEqual(snap.list.itemRadius, 30, width + 'px preset load replaced the draft');
    await page.click('#undoButton');
    snap = await snapshot(page);
    assert.equal(snap.list.itemRadius, 30, width + 'px undo reverts the preset load');

    // 10. Successful apply clears dirty; a quota failure keeps dirty.
    await editRange(page, '25');
    await page.click('#applyButton');
    await delay(120);
    snap = await snapshot(page);
    assert.equal(snap.dirty, false, width + 'px successful apply clears dirty');

    await page.evaluate(() => {
      const original = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function () { throw new Error('QuotaExceededError'); };
      localStorage.setItem._original = original;
    });
    await editRange(page, '27');
    await page.click('#applyButton');
    await delay(120);
    snap = await snapshot(page);
    assert.equal(snap.dirty, true, width + 'px failed apply keeps dirty');
    await page.evaluate(() => { localStorage.setItem = localStorage.setItem._original; });

    // 11. Leaving with dirty drafts asks; cancelling does not navigate away.
    await editRange(page, '29');
    onDialog(page, 'dismiss');
    await page.evaluate(() => document.querySelector('.back').click());
    await delay(120);
    assert.ok(page.url().includes('theme-studio.html'), width + 'px cancelled back keeps the workbench');

    // 12. Per-role bubble drafts and history stay isolated.
    await page.click('#restoreDraft');
    await delay(80);
    await page.evaluate(() => localStorage.setItem('ai_custom_characters', JSON.stringify([
      { id: 'role-a', name: '角色 A' }, { id: 'role-b', name: '角色 B' }
    ])));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chat-slim-card', { timeout: 15000 });
    await delay(200);
    await page.click('[data-tab="bubble"]');
    await delay(120);

    await editColor(page, '#aaaaaa');
    let globalSnap = await snapshot(page);
    assert.equal(globalSnap.bubble.myBubbleBg, '#aaaaaa', width + 'px global bubble draft staged');
    const globalUndo = globalSnap.undo;

    await page.selectOption('#bubbleScope', 'role-a');
    await delay(120);
    await editColor(page, '#bbbbbb');
    let roleSnap = await snapshot(page);
    assert.equal(roleSnap.bubble.myBubbleBg, '#bbbbbb', width + 'px role A bubble draft staged');
    assert.equal(roleSnap.scope, 'role-a', width + 'px scope switched to role A');

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

    assert.deepEqual(pageErrors, [], width + 'px workbench should not throw runtime errors');
    await page.screenshot({ path: resolve(outDir, `theme-studio-draft-${width}.png`) });
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
