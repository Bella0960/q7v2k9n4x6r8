import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const PREVIEW_URL = 'http://127.0.0.1:4174';
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
    ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'],
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

test('settings and its four major subviews run as native modules', async () => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(PREVIEW_URL + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.locator('#homeScreen [data-href="settings/settings.html"]').click();

  const host = page.locator('#maomao-app-host');
  const settingsView = host.locator('.maomao-app-view[data-maomao-app-view="settings"]');
  await settingsView.locator('.phone-mockup').waitFor();
  await settingsView.getByText('APPEARANCE', { exact: true }).waitFor();

  const nativeState = await settingsView.evaluate((view) => ({
    hasShadowRoot: !!view.shadowRoot,
    hasSettingsDom: !!view.shadowRoot.querySelector('.phone-mockup'),
    hasIframe: !!view.shadowRoot.querySelector('iframe')
  }));
  assert.deepEqual(nativeState, {
    hasShadowRoot: true,
    hasSettingsDom: true,
    hasIframe: false
  });
  assert.equal(await page.locator('#maomao-app-host iframe').count(), 0);

  await settingsView.locator('#dark-mode-toggle').evaluate((element) => element.click());
  assert.equal(await settingsView.locator('#dark-mode-toggle').isChecked(), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('settings_dark_mode')), '1');
  assert.equal(await settingsView.evaluate((view) => view.classList.contains('dark')), true);

  await settingsView.getByText('API 设置', { exact: true }).click();
  await settingsView.locator('#api-panel').waitFor({ state: 'visible' });
  await settingsView.locator('#api-panel .back-btn').click();
  await settingsView.locator('#api-panel').waitFor({ state: 'hidden' });

  // Appearance is now a native module, and browser back restores the still-mounted settings module.
  await settingsView.getByText('外观', { exact: true }).click();
  const appearanceView = host.locator('.maomao-app-view[data-maomao-app-view="settings_appearance"]');
  await appearanceView.locator('.phone-mockup').waitFor();
  await appearanceView.locator('#homeIndicatorToggle').waitFor();
  assert.equal(await appearanceView.evaluate((view) => !!view.shadowRoot), true);
  assert.equal(await page.locator('#maomao-app-host iframe').count(), 0);
  await page.goBack();
  await settingsView.locator('.phone-mockup').waitFor();

  // The page's own back button replaces the subview route rather than creating a back-navigation loop.
  await settingsView.getByText('外观', { exact: true }).click();
  await appearanceView.locator('.phone-mockup').waitFor();
  await appearanceView.locator('.header .icon-btn').click();
  await settingsView.locator('.phone-mockup').waitFor();

  await settingsView.getByText('字体设置', { exact: true }).click();
  const fontView = host.locator('.maomao-app-view[data-maomao-app-view="settings_font"]');
  await fontView.locator('#fontUrlInput').waitFor();
  await fontView.locator('#fontPlus').click();
  assert.equal(await fontView.locator('#fontSizeValue').count(), 1);
  assert.equal(await page.locator('#maomao-app-host iframe').count(), 0);
  await fontView.locator('a.back-btn').click();
  await settingsView.locator('.phone-mockup').waitFor();

  await settingsView.getByText('音效设置', { exact: true }).click();
  const soundView = host.locator('.maomao-app-view[data-maomao-app-view="settings_sound"]');
  await soundView.locator('.chip-row .chip').first().waitFor();
  assert.ok(await soundView.locator('.chip-row .chip').count() > 0);
  assert.equal(await page.locator('#maomao-app-host iframe').count(), 0);
  await soundView.locator('a.back-btn').click();
  await settingsView.locator('.phone-mockup').waitFor();

  await settingsView.getByText('自定义图标', { exact: true }).click();
  const iconsView = host.locator('.maomao-app-view[data-maomao-app-view="settings_icons"]');
  await iconsView.locator('#iconList').waitFor();
  await iconsView.locator('#iconList .icon-row').first().waitFor();
  assert.ok(await iconsView.locator('#iconList .icon-row').count() > 0);
  assert.equal(await page.locator('#maomao-app-host iframe').count(), 0);
  await iconsView.locator('.back-btn').click();
  await settingsView.locator('.phone-mockup').waitFor();

  await page.goBack();
  await page.locator('#maomao-app-host').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => localStorage.getItem('settings_dark_mode')), '1');

  assert.deepEqual(pageErrors, []);
  await context.close();
});
