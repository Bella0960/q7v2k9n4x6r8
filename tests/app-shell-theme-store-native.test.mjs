import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PREVIEW_URL = 'http://127.0.0.1:4176';
let previewProcess;
let browser;

async function waitForPreview() {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < 20000) {
    if (previewProcess && previewProcess.exitCode !== null) {
      throw new Error('Vite preview exited before becoming ready');
    }
    try {
      const response = await fetch(PREVIEW_URL + '/index.html');
      if (response.ok) return;
      lastError = new Error('Preview returned HTTP ' + response.status);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error('Vite preview did not become ready: ' + String(lastError));
}

test.before(async () => {
  previewProcess = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4176', '--strictPort'],
    { stdio: 'ignore' }
  );
  await waitForPreview();
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  if (browser) await browser.close();
  if (previewProcess && previewProcess.exitCode === null) {
    previewProcess.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => previewProcess.once('exit', resolve)),
      delay(2000)
    ]);
  }
});

test('theme store runs natively and preserves theme, role-scoped bubble and font-settings navigation', async () => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('ai_custom_characters', JSON.stringify([
      { id: 'role-a', name: '测试角色 A' },
      { id: 'role-b', name: '测试角色 B' }
    ]));
    localStorage.setItem('phone_current_contact', 'role-a');
  });

  await page.goto(PREVIEW_URL + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#homeScreen [data-href="theme-store/theme-store.html"]').click();

  const host = page.locator('#maomao-app-host');
  const storeView = host.locator('.maomao-app-view[data-maomao-app-view="theme_store"]');
  await storeView.waitFor({ state: 'visible' });
  await storeView.locator('.store-app').waitFor({ state: 'visible' });
  await storeView.locator('#storeContent .product-card').first().waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.ChatBeauty &&
    typeof window.ChatBeauty.setThemePreset === 'function' &&
    typeof window.ChatBeauty.save === 'function');

  const nativeState = await storeView.evaluate((view) => {
    const shadow = view.shadowRoot;
    const art = shadow && shadow.querySelector('.theme-art-silver-butterfly');
    return {
      hasShadowRoot: !!shadow,
      hasStore: !!(shadow && shadow.querySelector('.store-app')),
      hasThemeCards: !!(shadow && shadow.querySelectorAll('.product-card').length),
      hasLegacyIframe: !!(shadow && shadow.querySelector('iframe')),
      butterflyAsset: art ? getComputedStyle(art).backgroundImage : ''
    };
  });
  assert.equal(nativeState.hasShadowRoot, true);
  assert.equal(nativeState.hasStore, true);
  assert.equal(nativeState.hasThemeCards, true);
  assert.equal(nativeState.hasLegacyIframe, false);
  assert.match(nativeState.butterflyAsset, /silver-butterfly\.svg|data:image\/svg\+xml/,
    'theme preview asset should resolve relative to the original Theme Store page');
  assert.equal(await host.locator('iframe:visible').count(), 0);

  // Whole-page theme selection stays separate from the bubble preset system.
  await storeView.locator('[data-action="theme-apply"][data-id="imessage"]').click();
  await page.waitForFunction(() => window.ChatBeauty.getThemePreset() === 'imessage');
  const owned = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('maomao_theme_store_owned_v1') || '[]')
  );
  assert.ok(owned.includes('imessage'));

  // The initial scope follows the selected role, and a role-only preset does not leak.
  await storeView.locator('#categoryNav [data-category="bubbles"]').click();
  await storeView.locator('#bubbleScope').waitFor({ state: 'visible' });
  assert.equal(await storeView.locator('#bubbleScope').inputValue(), 'role-a');
  await storeView.locator('[data-action="bubble-apply"][data-id="builtin-wechat-bubble"]').click();
  await page.waitForFunction(() =>
    window.ChatBeauty.resolve('role-a').myBubbleBg === '#95EC69'
  );
  const scopedValues = await page.evaluate(() => ({
    roleA: window.ChatBeauty.resolve('role-a').myBubbleBg,
    roleB: window.ChatBeauty.resolve('role-b').myBubbleBg,
    global: window.ChatBeauty.resolve(null).myBubbleBg,
    roleStorage: JSON.parse(localStorage.getItem('beauty_chat_role-a') || '{}')
  }));
  assert.equal(scopedValues.roleA, '#95EC69');
  assert.notEqual(scopedValues.roleB, '#95EC69');
  assert.notEqual(scopedValues.global, '#95EC69');
  assert.ok(scopedValues.roleStorage.vars &&
    scopedValues.roleStorage.vars.myBubbleBg === '#95EC69');

  // Applying the same preset globally is an independent action.
  await storeView.locator('#bubbleScope').selectOption('global');
  await storeView.locator('[data-action="bubble-apply"][data-id="builtin-wechat-bubble"]').click();
  await page.waitForFunction(() =>
    window.ChatBeauty.resolve(null).myBubbleBg === '#95EC69'
  );

  await storeView.locator('#myThemesShortcut').click();
  await storeView.locator('#storeContent .mine-list').waitFor({ state: 'visible' });
  assert.match(await storeView.locator('#storeContent').innerText(), /iMessage|微信经典气泡/);

  // The font settings subview remembers the Theme Store as its actual source app.
  await storeView.locator('#categoryNav [data-category="fonts"]').click();
  await storeView.locator('[data-action="open-font-settings"]').waitFor({ state: 'visible' });
  await storeView.locator('[data-action="open-font-settings"]').click();
  const fontView = host.locator('.maomao-app-view[data-maomao-app-view="settings_font"]');
  await fontView.waitFor({ state: 'visible' });
  await fontView.locator('#fontUrlInput').waitFor({ state: 'visible' });
  await fontView.locator('a.back-btn').click();
  await page.waitForFunction(() => {
    const bridge = window.__MAOMAO_LEGACY_HOST__;
    return bridge && bridge.getActiveRoute() === 'theme-store/theme-store.html';
  });
  await storeView.waitFor({ state: 'visible' });

  await storeView.locator('#backButton').click();
  await page.waitForFunction(() => {
    const hostElement = document.getElementById('maomao-app-host');
    return !hostElement || hostElement.hidden;
  });

  assert.deepEqual(pageErrors, [], 'page errors: ' + JSON.stringify(pageErrors));
  assert.deepEqual(consoleErrors, [], 'console errors: ' + JSON.stringify(consoleErrors));
  await context.close();
});
