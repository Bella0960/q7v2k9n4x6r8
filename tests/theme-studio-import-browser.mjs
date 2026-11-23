// THEME-STUDIO-IMPORT-003: focused Chromium regression for theme workbench
// import reliability and draft isolation.
// - Valid JSON/CSS round-trip into the draft preview only (no localStorage write,
//   no role bubble change, no cross-theme leak) until Apply is clicked.
// - Rejected imports (bad JSON, incompatible format, partial-invalid CSS, wrong
//   unit, out-of-range number, unknown variable, >64KB) leave the three drafts,
//   current tab/scope and applied theme untouched.
// - Apply persists only on a successful write; a rejected write must not report
//   success or overwrite the previous stored config.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 4193;
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

async function uploadImport(page, name, text, mime) {
  const buffer = Buffer.from(text, 'utf8');
  process.stdout.write('  upload ' + name + ' (' + buffer.length + ' bytes)\n');
  await page.setInputFiles('#importFile', [{ name, mimeType: mime || 'application/json', buffer }]);
  // IO / parsing is synchronous on the file-text read; let the promise microtask flush.
  await delay(120);
}

const snapshot = page => page.evaluate(() => window.MAOMAOThemeStudio._draftSnapshot());
const storedStudio = page => page.evaluate(k => localStorage.getItem(k), STUDIO_KEY);

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

    // Nothing persisted on load; no beauty/role bubble written by the workbench.
    assert.equal(await storedStudio(page), null, width + 'px does not write studio store on load');
    assert.deepEqual(await beautyKeys(page), [], width + 'px writes no beauty scope on load');

    const before = await snapshot(page);

    // 1. Malformed JSON: rejected, drafts and storage stay unchanged.
    await uploadImport(page, 'broken.json', '{ this is not json', 'application/json');
    assert.deepEqual(await snapshot(page), before, width + 'px malformed JSON leaves drafts intact');
    assert.ok((await page.locator('#notice').textContent()).length > 0, width + 'px malformed JSON shows an error');
    assert.equal(await storedStudio(page), null, width + 'px malformed JSON does not persist');

    // 2. Incompatible format/version: rejected, drafts unchanged.
    await uploadImport(page, 'other.json', JSON.stringify({ format: 'some-other-tool', version: 1 }), 'application/json');
    assert.deepEqual(await snapshot(page), before, width + 'px incompatible format leaves drafts intact');
    assert.equal(await storedStudio(page), null, width + 'px incompatible format does not persist');

    // 3. Partial-invalid CSS: one valid variable applies; out-of-range, wrong-unit
    //    and unknown variables are refused; untouched defaults are preserved.
    const mixedCss = [
      ':root {',
      '  --ts-list-item-radius: 18px;',      // valid, in range
      '  --ts-list-title-size: 999px;',      // out of range (>20) -> refused
      '  --ts-list-item-gap: 2em;',         // wrong unit -> refused
      '  --ts-list-fake-var: 5;',            // unknown variable -> ignored
      '}'
    ].join('\n');
    await uploadImport(page, 'mixed.css', mixedCss, 'text/css');
    const afterCss = await snapshot(page);
    assert.equal(afterCss.list.itemRadius, 18, width + 'px valid CSS variable applies');
    assert.equal(afterCss.list.titleSize, before.list.titleSize, width + 'px out-of-range number is refused');
    assert.equal(afterCss.list.itemGap, before.list.itemGap, width + 'px wrong unit is refused');
    assert.equal(await storedStudio(page), null, width + 'px CSS preview does not persist');
    assert.deepEqual(await beautyKeys(page), [], width + 'px CSS preview writes no beauty scope');

    // 4. Over 64KB: rejected before any draft mutation.
    const huge = ':root { --ts-list-item-radius: ' + '7;'.repeat(40000) + ' }';
    await uploadImport(page, 'huge.css', huge, 'text/css');
    assert.equal((await snapshot(page)).list.itemRadius, 18, width + 'px oversized file keeps the prior valid draft');
    assert.equal(await storedStudio(page), null, width + 'px oversized file does not persist');

    // 5. Role scope isolation: inject two roles, switch bubble scope to A, import a
    //    bubble draft. No beauty scope (global or per-role) may be written until Apply.
    await page.evaluate(() => {
      localStorage.setItem('ai_custom_characters', JSON.stringify([
        { id: 'role-a', name: '角色 A' }, { id: 'role-b', name: '角色 B' }
      ]));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chat-slim-card', { timeout: 15000 });
    await delay(200);
    await page.click('[data-tab="bubble"]');
    await delay(120);
    await page.selectOption('#bubbleScope', 'role-a');
    await delay(120);
    const bubbleJson = JSON.stringify({
      format: 'maomao-theme-studio', version: 1,
      bubble: { myBubbleBg: '#222222', myBubbleColor: '#FFFFFF', bubbleMaxWidth: 80 }
    });
    await uploadImport(page, 'bubble.json', bubbleJson, 'application/json');
    const afterBubble = await snapshot(page);
    assert.equal(afterBubble.scope, 'role-a', width + 'px import does not silently switch scope');
    assert.equal(afterBubble.bubble.myBubbleBg, '#222222', width + 'px bubble draft imports to preview');
    assert.deepEqual(await beautyKeys(page), [], width + 'px bubble import writes no role/global beauty store');
    assert.equal(await storedStudio(page), null, width + 'px bubble import does not persist studio store');

    // 6. Valid list JSON round-trip: preview updates, but storage still untouched.
    await page.click('[data-tab="list"]');
    await delay(120);
    const listJson = JSON.stringify({
      format: 'maomao-theme-studio', version: 1,
      list: { itemRadius: 20, itemGap: 6, textColor: '#222222' },
      detail: { inputRadius: 24 }
    });
    await uploadImport(page, 'theme.json', listJson, 'application/json');
    const afterList = await snapshot(page);
    assert.equal(afterList.list.itemRadius, 20, width + 'px valid JSON list applies to draft');
    assert.equal(afterList.detail.inputRadius, 24, width + 'px valid JSON detail applies to draft');
    assert.equal(await storedStudio(page), null, width + 'px JSON preview still does not persist');

    // 7. Apply persists only after an explicit click; reload keeps the saved config.
    await page.click('#applyButton');
    await delay(150);
    const persisted = await storedStudio(page);
    assert.ok(persisted, width + 'px Apply writes the studio store');
    const parsed = JSON.parse(persisted);
    assert.equal(parsed.enabled.list, true, width + 'px Apply enables the list region');
    assert.equal(parsed.list.itemRadius, 20, width + 'px persisted list matches the applied draft');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chat-slim-card', { timeout: 15000 });
    await delay(200);
    const reloaded = JSON.parse(await storedStudio(page));
    assert.equal(reloaded.list.itemRadius, 20, width + 'px saved config survives reload');

    // 8. Rejected write: force setItem to throw, change a draft, Apply must fail
    //    without overwriting the previously stored config.
    await page.evaluate(() => {
      const original = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function () { throw new Error('QuotaExceededError'); };
      localStorage.setItem._original = original;
    });
    await page.evaluate(() => {
      const input = document.querySelector('#editorFields input[type=range]');
      input.value = '30';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.click('#applyButton');
    await delay(150);
    assert.ok(/失败|空间/.test(await page.locator('#notice').textContent()), width + 'px rejected write reports failure');
    const stillSaved = JSON.parse(await storedStudio(page));
    assert.equal(stillSaved.list.itemRadius, 20, width + 'px failed Apply keeps the previous stored config');

    assert.deepEqual(pageErrors, [], width + 'px workbench should not throw runtime errors');
    await page.screenshot({ path: resolve(outDir, `theme-studio-import-${width}.png`) });
    count++;
    console.log('PASS theme-studio import isolation @ ' + width + 'px');
    await context.close();
  }
} finally {
  try { if (browser) await browser.close(); } catch {}
  vite.kill('SIGTERM');
  setTimeout(() => process.exit(count === 3 ? 0 : 1), 300);
}
console.log(count + ' import-isolation scenarios passed');
