import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startPwaBuiltServer } from './helpers/pwa-built-server.mjs';
import path from 'node:path';
import { chromium } from 'playwright';

const distRoot = path.resolve('dist');
assert.ok(fs.existsSync(path.join(distRoot, 'index.html')), 'production build is missing dist/index.html');

const fixture = await startPwaBuiltServer();
const baseUrl = fixture.origin;
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  console.log('PWA_NAV_STAGE:home');
  const homeResponse = await page.goto(`${baseUrl}/index.html`, { waitUntil: 'load', timeout:30000 });
  assert.equal(homeResponse?.status(), 200, 'desktop home should load from the production build');
  console.log('PWA_NAV_STAGE:controller');
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30000 });
  const serviceWorkerState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return { supported: false, controller: false };
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      supported: true,
      scope: registration.scope,
      activeState: registration.active?.state || 'none',
      controller: !!navigator.serviceWorker.controller
    };
  });
  assert.equal(serviceWorkerState.supported, true, 'mobile browser must support the app service worker');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });


  const builtHome = fs.readFileSync(path.join(distRoot, 'index.html'), 'utf8');
  const routes = [...builtHome.matchAll(/data-href="([^"]+)"/g)].map(match => match[1]);
  assert.ok(routes.length >= 20, 'production home should expose all app shortcuts');
  assert.equal(new Set(routes).size, routes.length, 'app shortcut routes should be unique');


  console.log('PWA_NAV_STAGE:photo');
  // A default-home photo upload must survive paging away/back and a full reload.
  const photoSlot = page.locator('#pw1');
  const photoChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
  await photoSlot.scrollIntoViewIfNeeded();
  await photoSlot.click();
  const photoChooser = await photoChooserPromise;
  await photoChooser.setFiles({
    name: 'maomao-widget-photo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#333333"/></svg>'
    )
  });

  const photoKey = 'home_widget_upload_v1_photowall_pw1';
  await page.waitForFunction(async (key) => {
    const store = window.MAOMAOWallpaperStore;
    const slot = document.querySelector('#pw1');
    if (!store || !slot) return false;
    const saved = await store.getByKey(key);
    return !!saved && slot.style.backgroundImage.includes('data:image/');
  }, photoKey, { timeout: 15000 });

  await page.evaluate(() => {
    const home = document.getElementById('homeScreen');
    home.scrollLeft = home.clientWidth;
  });
  await page.waitForFunction(() => document.getElementById('homeScreen').scrollLeft > 0,
    null, { timeout: 5000 });
  await page.evaluate(() => {
    document.getElementById('homeScreen').scrollLeft = 0;
  });
  await page.waitForFunction(() => document.getElementById('homeScreen').scrollLeft === 0,
    null, { timeout: 5000 });

  assert.equal(
    await photoSlot.evaluate(el => el.style.backgroundImage.includes('data:image/')),
    true,
    'the photo wall image must remain visible after swiping to another page and back'
  );

  console.log('PWA_NAV_STAGE:reload');
  await page.reload({ waitUntil: 'load',timeout:30000 });
  await page.waitForFunction(async (key) => {
    const store = window.MAOMAOWallpaperStore;
    const slot = document.querySelector('#pw1');
    if (!store || !slot) return false;
    const saved = await store.getByKey(key);
    return !!saved && slot.style.backgroundImage.includes('data:image/');
  }, photoKey, { timeout: 15000 });
  assert.equal(pageErrors.length, 0,
    'photo upload, page swipe, and reload must not throw JavaScript errors: ' + pageErrors.join(' | '));

  console.log('PWA_NAV_STAGE:routes');
  for (const route of routes) {
    const response = await context.request.get(`${baseUrl}/${route}`);
    assert.equal(response.status(), 200, `app page should be served: ${route}`);
    assert.ok((response.headers()['content-type'] || '').includes('text/html'), `app page should be HTML: ${route}`);
  }

  assert.equal(await page.locator('body').evaluate(node => node.classList.contains('home-editing')), false,
    'fresh home should not start in edit mode');
  const tile = page.locator('button.app-tile[data-href]').first();
  await tile.scrollIntoViewIfNeeded();
  const firstRoute = await tile.getAttribute('data-href');
  assert.ok(firstRoute, 'first app tile should declare its destination');

  console.log('PWA_NAV_STAGE:tap');
  const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 });
  await tile.tap({ timeout: 10000 });
  const appResponse = await navigation;
  assert.equal(appResponse?.status(), 200,
    'tapping an app icon with the service worker active must load its actual page');
  await page.waitForURL(url => new URL(url).pathname === `/${firstRoute}`, { timeout: 10000 });
  assert.equal(new URL(page.url()).pathname, `/${firstRoute}`,
    'mobile app icon tap should navigate to the declared app page');
  assert.equal(pageErrors.length, 0,
    'desktop home and app navigation must not throw JavaScript errors: ' + pageErrors.join(' | '));

  console.log(`PASS: service worker ${serviceWorkerState.activeState}; ${routes.length} app routes exist; mobile tap navigates without page errors.`);
} finally {
  await browser.close();
  await fixture.close();
}
