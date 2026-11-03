import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PREVIEW_URL = 'http://127.0.0.1:4175';
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
    ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4175', '--strictPort'],
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

test('beauty editor runs natively and preserves shared, role and preset data', async () => {
  const context = await browser.newContext();
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
      { id: 'role-a', name: '测试角色 A' }
    ]));
  });

  await page.goto(PREVIEW_URL + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#homeScreen [data-href="beauty/beauty.html"]').click();

  const host = page.locator('#maomao-app-host');
  const beautyView = host.locator('.maomao-app-view[data-maomao-app-view="beauty"]');
  await beautyView.waitFor({ state: 'visible' });
  await beautyView.locator('.phone').waitFor({ state: 'visible' });
  await beautyView.locator('#vbPreview').waitFor({ state: 'visible' });
  await page.waitForFunction(() => window.ChatBeauty &&
    typeof window.ChatBeauty.resolve === 'function' &&
    typeof window.ChatBeauty.save === 'function');

  const nativeState = await beautyView.evaluate((view) => ({
    hasShadowRoot: !!view.shadowRoot,
    hasEditor: !!view.shadowRoot.querySelector('#beautyTabs'),
    hasIframe: !!view.shadowRoot.querySelector('iframe'),
    hasRoleOption: !!view.shadowRoot.querySelector('#vbScope option[value="role-a"]')
  }));
  assert.deepEqual(nativeState, {
    hasShadowRoot: true,
    hasEditor: true,
    hasIframe: false,
    hasRoleOption: true
  });
  assert.equal(await host.locator('iframe').count(), 0);

  // A global visual setting still writes through the existing ChatBeauty key.
  await beautyView.locator('#vbAvatarSize').evaluate((element) => {
    element.value = '36';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await beautyView.locator('#btnRight').click();
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem('beauty_chat_global_v1') || '{}');
    return saved.vars && saved.vars.avatarSize === 36;
  });

  // A role-specific value remains sparse and does not overwrite the global value.
  await beautyView.locator('#vbScope').selectOption('role-a');
  await beautyView.locator('#vbAvatarSize').evaluate((element) => {
    element.value = '42';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await beautyView.locator('#btnRight').click();
  await page.waitForFunction(() => {
    const role = JSON.parse(localStorage.getItem('beauty_chat_role-a') || '{}');
    return role.vars && role.vars.avatarSize === 42;
  });
  const resolvedSizes = await page.evaluate(() => ({
    global: window.ChatBeauty.resolve(null).avatarSize,
    role: window.ChatBeauty.resolve('role-a').avatarSize
  }));
  assert.deepEqual(resolvedSizes, { global: 36, role: 42 });

  // The tab-specific action button is available; CSS presets still use their old key.
  await beautyView.locator('#beautyTabs [data-tab="css"]').click();
  await beautyView.locator('#btnLeft').waitFor({ state: 'visible' });
  await beautyView.locator('#btnLeft').click();
  await beautyView.locator('#presetName').fill('原生模块测试预设');
  await beautyView.locator('#presetCss').fill('.chat-slim-card { border-radius: 9px; }');
  await beautyView.locator('#btnRight').click();
  await page.waitForFunction(() => {
    const items = JSON.parse(localStorage.getItem('beauty_presets') || '[]');
    return items.some((item) => item.name === '原生模块测试预设');
  });

  // Dynamically generated legacy onclick handlers are rebound inside the module.
  const presetRow = beautyView.locator('#presetList .preset-item').filter({ hasText: '原生模块测试预设' });
  await presetRow.waitFor();
  await presetRow.click();
  await page.waitForFunction(() => {
    const active = JSON.parse(localStorage.getItem('beauty_active') || '{}');
    return active.all === '原生模块测试预设';
  });
  await presetRow.locator('.preset-del').click();
  await page.waitForFunction(() => {
    const items = JSON.parse(localStorage.getItem('beauty_presets') || '[]');
    return !items.some((item) => item.name === '原生模块测试预设');
  });

  // Global chat theme controls continue to use the same ChatBeauty theme API.
  await beautyView.locator('#beautyTabs [data-tab="theme"]').click();
  await beautyView.locator('#chatThemeIMessageOption').click();
  assert.equal(await page.evaluate(() => window.ChatBeauty.getThemePreset()), 'imessage');
  await beautyView.locator('#chatThemeDefaultOption').click();
  assert.equal(await page.evaluate(() => window.ChatBeauty.getThemePreset()), 'default');

  // Internal links stay inside the app host; browser back restores this editor.
  await beautyView.locator('.header-store-link').click();
  await page.waitForFunction(() => {
    const bridge = window.__MAOMAO_LEGACY_HOST__;
    return bridge && /theme-store\/theme-store\.html/.test(bridge.getActiveRoute() || '');
  });
  await page.goBack();
  await beautyView.locator('#vbPreview').waitFor();

  // Opening from the desktop and going back returns to the desktop, not Settings.
  await beautyView.locator('.header .back-btn').click();
  await page.waitForFunction(() => {
    const hostElement = document.getElementById('maomao-app-host');
    return !hostElement || hostElement.hidden;
  });

  // The same native module can also be opened from Settings and returns there.
  await page.locator('#homeScreen [data-href="settings/settings.html"]').click();
  const settingsView = host.locator('.maomao-app-view[data-maomao-app-view="settings"]');
  await settingsView.waitFor({ state: 'visible' });
  await settingsView.getByText('美化导入', { exact: true }).click();
  await beautyView.waitFor({ state: 'visible' });
  await beautyView.locator('.phone').waitFor({ state: 'visible' });
  assert.equal(await host.locator('iframe').count(), 0);
  await beautyView.locator('.header .back-btn').click();
  await page.waitForFunction(() => {
    const view = document.querySelector('#maomao-app-host .maomao-app-view[data-maomao-app-view="beauty"]');
    return view && view.hidden;
  });
  assert.equal(await beautyView.isHidden(), true);

  assert.deepEqual(pageErrors, [], 'page errors: ' + JSON.stringify(pageErrors));
  assert.deepEqual(consoleErrors, [], 'console errors: ' + JSON.stringify(consoleErrors));
  await context.close();
});
