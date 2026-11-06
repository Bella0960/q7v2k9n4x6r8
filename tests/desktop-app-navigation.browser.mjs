import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const distRoot = path.resolve('dist');
assert.ok(fs.existsSync(path.join(distRoot, 'index.html')), 'production build is missing dist/index.html');

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  const filePath = path.resolve(distRoot, '.' + pathname);
  if (filePath !== distRoot && !filePath.startsWith(distRoot + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, bytes) => {
    if (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found');
      return;
    }
    const extension = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.woff2': 'font/woff2',
      '.woff': 'font/woff'
    };
    res.writeHead(200, {
      'Content-Type': types[extension] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(bytes);
  });
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;
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
  const homeResponse = await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
  assert.equal(homeResponse?.status(), 200, 'desktop home should load from the production build');

  const builtHome = fs.readFileSync(path.join(distRoot, 'index.html'), 'utf8');
  const routes = [...builtHome.matchAll(/data-href="([^"]+)"/g)].map(match => match[1]);
  assert.ok(routes.length >= 20, 'production home should expose all app shortcuts');
  assert.equal(new Set(routes).size, routes.length, 'app shortcut routes should be unique');

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

  const navigationResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === `/${firstRoute}`,
    { timeout: 10000 }
  );
  await tile.tap({ timeout: 10000 });
  const appResponse = await navigationResponse;
  assert.equal(appResponse.status(), 200, 'tapping an app icon should load its actual page');
  await page.waitForURL(url => new URL(url).pathname === `/${firstRoute}`, { timeout: 10000 });
  assert.equal(new URL(page.url()).pathname, `/${firstRoute}`,
    'mobile app icon tap should navigate to the declared app page');

  console.log(`PASS: ${routes.length} app routes exist in the production build and the first mobile app tap navigates successfully.`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
