// THEME-STUDIO-PRESET-004: focused Chromium regression for saved-preset
// management, reliability and bubble role-scope safety.
// - Save two presets with the same name but distinct ids; rename/update/delete
//   locate by stable id and do not collide on equal names.
// - Update an existing preset does not consume a new slot; a rejected write
//   (quota) must not fake success or mutate the stored preset.
// - Legacy presets without scope stay visible and are labelled generic; loading
//   across roles asks for confirmation. Loading only fills the draft, never writes
//   the chat beauty store; list/detail/bubble drafts stay isolated.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 4194;
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

const beautyKeys = page => page.evaluate(() =>
  Object.keys(localStorage).filter(k => k.indexOf('beauty_chat') === 0 && k !== 'beauty_chat_migrated_v1'));

const snapshot = page => page.evaluate(() => window.MAOMAOThemeStudio._draftSnapshot());
const storedStudio = page => page.evaluate(k => localStorage.getItem(k), STUDIO_KEY);
const readPresets = page => page.evaluate(k => {
  const raw = localStorage.getItem(k);
  return raw ? JSON.parse(raw).presets : [];
}, STUDIO_KEY);

// Register a one-shot dialog handler: accept(prompt value) or dismiss(confirm).
function onDialog(page, action, value) {
  page.once('dialog', async d => {
    if (action === 'accept') await d.accept(value); else await d.dismiss();
  });
}

async function savePresetViaUI(page, name) {
  onDialog(page, 'accept', name);
  await page.click('#savePreset');
  await delay(120);
}

async function openEntryMenu(page, index) {
  const entries = await page.$$('.preset-entry');
  await entries[index].$('.preset-menu-btn').then(b => b.click());
  await delay(80);
  return entries[index];
}

async function clickMenuAction(entry, label) {
  const btn = await entry.$('button:has-text("' + label + '")');
  assert.ok(btn, 'menu action ' + label + ' exists');
  await btn.click();
  await delay(120);
}

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

    await page.goto(origin + '/theme-studio/theme-studio.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chat-slim-card', { timeout: 15000 });
    await delay(200);

    assert.equal(await storedStudio(page), null, width + 'px does not write studio store on load');
    assert.deepEqual(await beautyKeys(page), [], width + 'px writes no beauty scope on load');

    // Two roles available for bubble scope selection.
    await page.evaluate(() => localStorage.setItem('ai_custom_characters', JSON.stringify([
      { id: 'role-a', name: '角色 A' }, { id: 'role-b', name: '角色 B' }
    ])));

    // 1. Save two presets with the same name; ids must differ.
    await savePresetViaUI(page, '方案甲');
    await savePresetViaUI(page, '方案甲');
    let presets = await readPresets(page);
    assert.equal(presets.length, 2, width + 'px two same-name presets are saved');
    assert.equal(presets[0].name, '方案甲');
    assert.equal(presets[1].name, '方案甲');
    assert.notEqual(presets[0].id, presets[1].id, width + 'px same-name presets have distinct ids');

    // 2. Rename the first by id; the second keeps its original name.
    let first = await openEntryMenu(page, 0);
    onDialog(page, 'accept', '方案甲-改');
    await clickMenuAction(first, '重命名');
    presets = await readPresets(page);
    const byId = Object.fromEntries(presets.map(p => [p.id, p]));
    const firstId = presets[0].id;
    assert.equal(byId[firstId].name, '方案甲-改', width + 'px first preset renamed by id');
    assert.equal(presets.find(p => p.id !== firstId).name, '方案甲', width + 'px other same-name preset untouched');

    // 3. Update the first preset from the current draft; no new slot is consumed.
    await page.evaluate(() => {
      const input = document.querySelector('#editorFields input[type=range]');
      input.value = '22';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    first = await openEntryMenu(page, 0);
    onDialog(page, 'accept');
    await clickMenuAction(first, '更新草稿');
    presets = await readPresets(page);
    assert.equal(presets.length, 2, width + 'px update does not add a new preset slot');
    assert.equal(byId[firstId] ? presets.find(p => p.id === firstId).values.itemRadius : null, 22,
      width + 'px updated preset carries the draft value');

    // 4. Delete the second preset by id.
    const secondId = presets.find(p => p.id !== firstId).id;
    const second = await openEntryMenu(page, 1);
    onDialog(page, 'accept');
    await clickMenuAction(second, '删除');
    presets = await readPresets(page);
    assert.equal(presets.length, 1, width + 'px second preset deleted');
    assert.equal(presets[0].id, firstId, width + 'px remaining preset is the first one');

    // 5. Rejected write (quota): rename fails without faking success or mutating storage.
    await page.evaluate(() => {
      const original = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function () { throw new Error('QuotaExceededError'); };
      localStorage.setItem._original = original;
    });
    first = await openEntryMenu(page, 0);
    onDialog(page, 'accept', '不应保存');
    await clickMenuAction(first, '重命名');
    assert.ok(/失败|空间/.test(await page.locator('#notice').textContent()), width + 'px quota failure reports failure');
    presets = await readPresets(page);
    assert.equal(presets[0].name, '方案甲-改', width + 'px failed rename keeps the stored name');
    await page.evaluate(() => { localStorage.setItem = localStorage.setItem._original; });

    // 6. Legacy bubble preset without scope: labelled generic; cross-scope load asks
    //    confirmation. Dismiss leaves the draft and beauty store untouched.
    await page.evaluate(({ k, presets }) => {
      const cur = JSON.parse(localStorage.getItem(k) || 'null') ||
        { v: 1, enabled: { list: false, detail: false }, list: {}, detail: {}, presets: [], updatedAt: 0 };
      cur.presets = presets;
      localStorage.setItem(k, JSON.stringify(cur));
    }, { k: STUDIO_KEY, presets: [
      { id: 'list-p', name: '列表方案', tab: 'list', values: { itemRadius: 20 } },
      { id: 'legacy', name: '旧泡', tab: 'bubble', values: { myBubbleBg: '#222222' } },
      { id: 'role-a-p', name: 'A 的泡', tab: 'bubble', scope: 'role-a', values: { myBubbleBg: '#333333' } }
    ] });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chat-slim-card', { timeout: 15000 });
    await delay(200);
    await page.click('[data-tab="bubble"]');
    await delay(120);

    const legacyEntry = page.locator('.preset-entry', { hasText: '旧泡' });
    assert.ok(await legacyEntry.locator('.preset-scope').textContent().then(t => t.includes('旧版通用方案')),
      width + 'px legacy preset labelled generic');

    // Dismiss the cross-scope confirmation: draft unchanged, beauty store empty.
    onDialog(page, 'dismiss');
    await legacyEntry.locator('.preset-use').click();
    await delay(120);
    let afterRace = await snapshot(page);
    assert.notEqual(afterRace.bubble.myBubbleBg, '#222222', width + 'px dismissed legacy load keeps draft');
    assert.deepEqual(await beautyKeys(page), [], width + 'px legacy load writes no beauty scope');

    // Accept: legacy value fills the draft only; still no beauty write.
    onDialog(page, 'accept');
    await legacyEntry.locator('.preset-use').click();
    await delay(120);
    afterRace = await snapshot(page);
    assert.equal(afterRace.bubble.myBubbleBg, '#222222', width + 'px accepted legacy load fills draft');
    assert.deepEqual(await beautyKeys(page), [], width + 'px draft load writes no beauty scope');

    // 7. Cross-role preset: switch to role B; loading role A's preset asks confirmation.
    await page.selectOption('#bubbleScope', 'role-b');
    await delay(120);
    const roleEntry = page.locator('.preset-entry', { hasText: 'A 的泡' });
    onDialog(page, 'dismiss');
    await roleEntry.locator('.preset-use').click();
    await delay(120);
    afterRace = await snapshot(page);
    assert.notEqual(afterRace.bubble.myBubbleBg, '#333333', width + 'px dismissed cross-role load keeps draft');
    assert.deepEqual(await beautyKeys(page), [], width + 'px cross-role dismissal writes no beauty scope');

    onDialog(page, 'accept');
    await roleEntry.locator('.preset-use').click();
    await delay(120);
    afterRace = await snapshot(page);
    assert.equal(afterRace.bubble.myBubbleBg, '#333333', width + 'px accepted cross-role load fills draft');
    assert.deepEqual(await beautyKeys(page), [], width + 'px cross-role draft load writes no beauty scope');

    // 8. Region isolation: loading a list preset must not overwrite detail/bubble drafts.
    await page.click('[data-tab="list"]');
    await delay(120);
    const beforeDetail = (await snapshot(page)).detail;
    const beforeBubble = (await snapshot(page)).bubble;
    const listEntry = page.locator('.preset-entry').first();
    await listEntry.locator('.preset-use').click();
    await delay(120);
    const afterList = await snapshot(page);
    assert.deepEqual(afterList.detail, beforeDetail, width + 'px list load does not touch detail draft');
    assert.deepEqual(afterList.bubble, beforeBubble, width + 'px list load does not touch bubble draft');

    // 9. Persisted presets survive reload.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chat-slim-card', { timeout: 15000 });
    await delay(200);
    presets = await readPresets(page);
    assert.ok(presets.length >= 2, width + 'px presets survive reload');

    assert.deepEqual(pageErrors, [], width + 'px workbench should not throw runtime errors');
    await page.screenshot({ path: resolve(outDir, `theme-studio-preset-${width}.png`) });
    count++;
    console.log('PASS theme-studio preset management @ ' + width + 'px');
    await context.close();
  }
} finally {
  try { if (browser) await browser.close(); } catch {}
  vite.kill('SIGTERM');
  setTimeout(() => process.exit(count === 3 ? 0 : 1), 300);
}
console.log(count + ' preset-management scenarios passed');
