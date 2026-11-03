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
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

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
  await page.waitForTimeout(1200);
  const appearanceDiagnostics = await host.evaluate((root) => ({
    route: new URL(location.href).searchParams.get('maomao_app'),
    loadError: root.getAttribute('data-load-error'),
    views: Array.from(root.querySelectorAll('.maomao-app-view')).map((view) => ({
      id: view.getAttribute('data-maomao-app-view'),
      hidden: view.hidden,
      hasShadow: !!view.shadowRoot,
      errorText: view.shadowRoot && view.shadowRoot.textContent.slice(0, 160)
    }))
  }));
  assert.ok(
    await appearanceView.count(),
    'Appearance module did not mount: ' + JSON.stringify(appearanceDiagnostics) +
      ' console=' + JSON.stringify(consoleErrors)
  );
  await appearanceView.locator('.phone-mockup').waitFor();
  await appearanceView.locator('#homeIndicatorToggle').waitFor();
  assert.equal(await appearanceView.evaluate((view) => !!view.shadowRoot), true);
  assert.equal(await page.locator('#maomao-app-host iframe').count(), 0);

  await page.evaluate(() => {
    localStorage.setItem('settings_statusbar_time', '0');
    if (window.__statusbarControlApply) window.__statusbarControlApply();
  });
  await page.waitForFunction(() => {
    const view = document.querySelector('#maomao-app-host .maomao-app-view[data-maomao-app-view="settings_appearance"]');
    const time = view && view.shadowRoot && view.shadowRoot.querySelector('.status-time');
    return time && getComputedStyle(time).display === 'none';
  });
  await page.evaluate(() => {
    localStorage.setItem('settings_statusbar_time', '1');
    if (window.__statusbarControlApply) window.__statusbarControlApply();
  });

  await page.goBack();
  await settingsView.locator('.phone-mockup').waitFor();
  assert.equal(await appearanceView.isHidden(), true, 'inactive native view must not intercept clicks');

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
  await page.waitForTimeout(500);
  const soundDiagnostics = await page.evaluate(() => {
    const view = document.querySelector('#maomao-app-host .maomao-app-view[data-maomao-app-view="settings_sound"]');
    return view ? {
      hidden: view.hidden,
      hasShadow: !!view.shadowRoot,
      rows: view.shadowRoot ? view.shadowRoot.querySelectorAll('.chip-row').length : 0,
      chips: view.shadowRoot ? view.shadowRoot.querySelectorAll('.chip-row .chip').length : 0,
      hasSoundSystem: typeof window.SoundSystem !== 'undefined'
    } : null;
  });
  assert.ok(soundDiagnostics && soundDiagnostics.chips > 0,
    'Sound settings did not initialize: ' + JSON.stringify(soundDiagnostics) +
    ' console=' + JSON.stringify(consoleErrors));
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

  await settingsView.getByText('MiniMax 语音合成', { exact: true }).click();
  const ttsView = host.locator('.maomao-app-view[data-maomao-app-view="settings_tts"]');
  await ttsView.locator('#apiKey').waitFor();
  assert.equal(await ttsView.locator('#enableToggle').count(), 1);
  assert.equal(await page.locator('#maomao-app-host iframe').count(), 0);
  await ttsView.locator('a.back-btn').click();
  await settingsView.locator('.phone-mockup').waitFor();

  await settingsView.getByText('API 调用记录', { exact: true }).click();
  const logsView = host.locator('.maomao-app-view[data-maomao-app-view="settings_logs"]');
  await logsView.locator('#logList').waitFor();
  assert.equal(await logsView.locator('#clearBtn').count(), 1);
  assert.equal(await page.locator('#maomao-app-host iframe').count(), 0);
  await logsView.locator('.al-circle-btn').click();
  await settingsView.locator('.phone-mockup').waitFor();

  await settingsView.getByText('通话设置', { exact: true }).click();
  const callView = host.locator('.maomao-app-view[data-maomao-app-view="settings_call"]');
  await callView.locator('#btnBack').waitFor();
  await callView.locator('.segmented[data-key="call_default_type"] button[data-value="video"]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('call_default_type')), 'video');
  await callView.locator('.ios-switch input[data-key="call_dnd"]').check();
  assert.equal(await page.evaluate(() => localStorage.getItem('call_dnd')), 'true');
  assert.equal(await page.locator('#maomao-app-host iframe').count(), 0);
  await callView.locator('#btnBack').click();
  await settingsView.locator('.phone-mockup').waitFor();

  await settingsView.getByText('伴侣协议', { exact: true }).click();
  const protocolView = host.locator('.maomao-app-view[data-maomao-app-view="settings_rp_protocol"]');
  await protocolView.locator('#protocolText').waitFor();
  await protocolView.locator('#btnReset').click();
  await protocolView.locator('#btnSave').click();
  assert.ok(await page.evaluate(() => !!localStorage.getItem('chat_rp_protocol_')));
  await protocolView.locator('#btnPreview').click();
  await protocolView.locator('#previewModal.show').waitFor();
  assert.equal(await page.locator('#maomao-app-host iframe').count(), 0);
  await protocolView.locator('#btnClosePreview').click();
  await protocolView.locator('#btnBack').click();
  await settingsView.locator('.phone-mockup').waitFor();

  const historyBeforeDesktopBack = await page.evaluate(() => ({
    activeRoute: window.__MAOMAO_LEGACY_HOST__ && window.__MAOMAO_LEGACY_HOST__.getActiveRoute(),
    previousRoute: window.__MAOMAO_LEGACY_HOST__ && window.__MAOMAO_LEGACY_HOST__.getPreviousRoute(),
    length: history.length,
    state: history.state,
    search: location.search
  }));
  await page.goBack();
  const historyAfterDesktopBack = await page.evaluate(() => ({
    activeRoute: window.__MAOMAO_LEGACY_HOST__ && window.__MAOMAO_LEGACY_HOST__.getActiveRoute(),
    previousRoute: window.__MAOMAO_LEGACY_HOST__ && window.__MAOMAO_LEGACY_HOST__.getPreviousRoute(),
    length: history.length,
    state: history.state,
    search: location.search
  }));
  assert.equal(
    await page.locator('#maomao-app-host').isHidden(),
    true,
    'browser back should return to desktop; before=' + JSON.stringify(historyBeforeDesktopBack) +
      ' after=' + JSON.stringify(historyAfterDesktopBack)
  );
  assert.equal(await page.evaluate(() => localStorage.getItem('settings_dark_mode')), '1');

  assert.deepEqual(pageErrors, []);
  await context.close();
});
