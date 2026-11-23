// THEME-STUDIO-PREVIEW-002: real Chromium check for the theme workbench preview.
// Verifies the list/detail/bubble previews mirror the native chat structure,
// stay within 375/390/430 viewports, update live on input, and do not persist
// anything to the real chat theme until Apply is clicked.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 4192;
const origin = 'http://127.0.0.1:' + port;
const outDir = resolve(root, 'test-results');
mkdirSync(outDir, { recursive: true });
const STORAGE_KEY = 'maomao_theme_studio_v1';

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

async function measureOverflow(page) {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const overflow = Array.from(document.querySelectorAll('body *'))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return { tag: el.tagName.toLowerCase(), cls: typeof el.className === 'string' ? el.className.slice(0, 80) : '', right: rect.right, left: rect.left, display: style.display, visibility: style.visibility };
      })
      .filter((i) => i.display !== 'none' && i.visibility !== 'hidden' && (i.right > viewportWidth + 1 || i.left < -1))
      .slice(0, 20);
    return { documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, viewportWidth, overflow };
  });
}

try {
  await waitForServer();
  const browser = await chromium.launch({ headless: true });

  for (const width of [375, 390, 430]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(origin + '/theme-studio/theme-studio.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chat-slim-card', { timeout: 15000 });
    await delay(300);

    // Three independent editor regions remain present.
    const tabs = await page.locator('[data-tab]').evaluateAll((els) => els.map((e) => e.dataset.tab));
    assert.deepEqual(tabs.sort(), ['bubble', 'detail', 'list'], width + 'px keeps the three editor tabs');

    // List preview mirrors the native chat card structure.
    const listCards = await page.locator('#mockList .chat-slim-card').count();
    assert.equal(listCards, 2, width + 'px list preview renders two demo cards');
    const listText = await page.locator('#mockList .chat-name').allTextContents();
    assert.ok(listText.length === 2 && listText.every(Boolean), width + 'px list shows two nicknames');
    for (const cls of ['chat-avatar', 'chat-meta', 'chat-title-row', 'chat-time', 'chat-last-msg']) {
      assert.ok(await page.locator('#mockList .' + cls).count() > 0, width + 'px list preview has .' + cls);
    }

    // Nothing persisted to the real theme before Apply.
    const storedBefore = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    assert.equal(storedBefore, null, width + 'px does not write the theme store on load');

    // Live update: drag a list slider and confirm the preview variable changes immediately.
    const radiusSlider = page.locator('#editorFields input[type=range]').first();
    await radiusSlider.waitFor({ state: 'visible', timeout: 5000 });
    const beforeVar = await page.evaluate(() => getComputedStyle(document.getElementById('previewSurface')).getPropertyValue('--p-list-item-radius').trim());
    await page.evaluate(() => {
      const input = document.querySelector('#editorFields input[type=range]');
      input.value = '24';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await delay(120);
    const afterVar = await page.evaluate(() => getComputedStyle(document.getElementById('previewSurface')).getPropertyValue('--p-list-item-radius').trim());
    assert.notEqual(beforeVar, afterVar, width + 'px list slider updates the preview live');
    const storedAfter = await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
    assert.equal(storedAfter, null, width + 'px still does not persist after live preview');

    let overflow = await measureOverflow(page);
    assert.ok(overflow.documentWidth <= width + 1, width + 'px list document overflow: ' + JSON.stringify(overflow));
    assert.ok(overflow.bodyWidth <= width + 1, width + 'px list body overflow: ' + JSON.stringify(overflow));
    assert.equal(overflow.overflow.length, 0, width + 'px list off-screen elements: ' + JSON.stringify(overflow.overflow));
    await page.screenshot({ path: resolve(outDir, `theme-studio-${width}-list.png`) });

    // Detail preview mirrors the native chat detail structure.
    await page.click('[data-tab="detail"]');
    await delay(150);
    for (const cls of ['chat-header', 'chat-title-box', 'chat-user-name', 'chat-stage', 'input-dock', 'input-capsule', 'send-icon-btn']) {
      assert.ok(await page.locator('#mockDetail .' + cls).count() > 0, width + 'px detail preview has .' + cls);
    }
    overflow = await measureOverflow(page);
    assert.ok(overflow.documentWidth <= width + 1, width + 'px detail document overflow');
    await page.screenshot({ path: resolve(outDir, `theme-studio-${width}-detail.png`) });

    // Bubble preview keeps the native message rows.
    await page.click('[data-tab="bubble"]');
    await delay(150);
    assert.ok(await page.locator('#mockDetail .msg-row').count() >= 2, width + 'px bubble preview keeps two message rows');
    assert.ok(await page.locator('#mockDetail .msg-bubble').count() >= 2, width + 'px bubble preview keeps bubbles');
    overflow = await measureOverflow(page);
    assert.ok(overflow.documentWidth <= width + 1, width + 'px bubble document overflow');
    await page.screenshot({ path: resolve(outDir, `theme-studio-${width}-bubble.png`) });

    assert.deepEqual(pageErrors, [], width + 'px workbench should not throw runtime errors');
    process.stdout.write('PASS theme-studio preview @ ' + width + 'px\n');
    await context.close();
  }

  await browser.close();
} finally {
  vite.kill('SIGTERM');
}
