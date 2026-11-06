import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = (process.env.MAOMAO_PRODUCTION_URL || 'https://mao.miamor520000.workers.dev').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  const homeResponse = await page.goto(origin + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  assert.equal(homeResponse?.status(), 200, 'production Worker home must return HTTP 200');
  assert.ok((homeResponse.headers()['content-type'] || '').includes('text/html'),
    'production Worker home must return HTML');

  const tiles = page.locator('.app-tile[data-href]');
  const count = await tiles.count();
  assert.ok(count >= 20, `production home must expose all app shortcuts; found ${count}`);

  const routes = [];
  for (let i = 0; i < count; i++) {
    const href = await tiles.nth(i).getAttribute('data-href');
    assert.ok(href && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href),
      `app shortcut ${i + 1} must use a local relative route`);
    routes.push(href);
  }
  assert.equal(new Set(routes).size, routes.length, 'production app routes must be unique');

  const routeResults = [];
  for (const route of routes) {
    const response = await context.request.get(new URL(route, origin + '/').href, { timeout: 20000, maxRedirects: 0 });
    routeResults.push({
      route,
      status: response.status(),
      location: response.headers()['location'] || '',
      type: response.headers()['content-type'] || ''
    });
  }
  const failedRoutes = routeResults.filter(item => item.status !== 200 || !item.type.includes('text/html'));
  if (failedRoutes.length) {
    console.error('PRODUCTION_ROUTE_FAILURES=' + JSON.stringify(failedRoutes));
  }
  assert.equal(failedRoutes.length, 0,
    `all production app routes must return HTTP 200 HTML; failed ${failedRoutes.length}/${routes.length}`);

  const firstTile = tiles.first();
  const firstRoute = routes[0];
  const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
  await firstTile.tap({ timeout: 15000 });
  const response = await navigation;
  const finalUrl = page.url();
  const redirectChain = [];
  if (response) {
    let request = response.request();
    while (request) {
      const prior = request.redirectedFrom();
      if (!prior) break;
      redirectChain.unshift({ from: prior.url(), to: request.url() });
      request = prior;
    }
  }
  console.log('MOBILE_NAVIGATION=' + JSON.stringify({
    finalStatus: response?.status() ?? null,
    finalUrl,
    redirectChain,
    pageErrors
  }));
  assert.equal(response?.status(), 200,
    'real mobile tap must finish on HTTP 200; final URL: ' + finalUrl);
  assert.equal(new URL(finalUrl).pathname, new URL(firstRoute, origin + '/').pathname,
    'real mobile tap must finish at its declared app route');
  assert.equal(pageErrors.length, 0, 'production home must not throw JavaScript errors: ' + pageErrors.join(' | '));

  console.log(`PASS: live Worker returned HTTP 200 HTML for home and all ${routes.length} app routes; mobile tap opened ${firstRoute}.`);
} finally {
  await browser.close();
}
