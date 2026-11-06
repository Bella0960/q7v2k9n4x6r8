import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const distRoot = path.resolve('dist');
assert.ok(fs.existsSync(path.join(distRoot, 'index.html')), 'production build is missing dist/index.html');

const builtHome = fs.readFileSync(path.join(distRoot, 'index.html'), 'utf8');
const routes = [...builtHome.matchAll(/data-href="([^"]+)"/g)].map(match => match[1]);
assert.ok(routes.length >= 20, 'production home should expose all app shortcuts');
assert.equal(new Set(routes).size, routes.length, 'app shortcut routes should be unique');

const serviceWorkerSource = fs.readFileSync(path.resolve('sw.js'), 'utf8');
const expectedCacheName = serviceWorkerSource.match(/const CACHE_NAME = ['"]([^'"]+)['"]/)?.[1];
assert.ok(expectedCacheName, 'source service worker must declare its cache version');

const configuredBaseUrl = (process.env.MAOMAO_BASE_URL || '').trim().replace(/\\/+$/, '');
let server = null;
let baseUrl = configuredBaseUrl;

if (!baseUrl) {
  const localServer = http.createServer((req, res) => {
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
    localServer.once('error', reject);
    localServer.listen(0, '127.0.0.1', resolve);
  });
  server = localServer;

  const address = server.address();
  assert.ok(address && typeof address === 'object');
  baseUrl = `http://127.0.0.1:${address.port}`;
}

const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'block'
  });

  const indexResponse = await context.request.get(`${baseUrl}/index.html`);
  assert.equal(indexResponse.status(), 200, `home page must load from ${baseUrl}`);
  assert.ok((indexResponse.headers()['content-type'] || '').includes('text/html'),
    'home page response must be HTML');

  const remoteIndex = await indexResponse.text();
  assert.match(remoteIndex, /data-href=/, 'served home page must contain app destinations');

  const serviceWorkerResponse = await context.request.get(`${baseUrl}/sw.js`);
  assert.equal(serviceWorkerResponse.status(), 200, 'deployed service worker must be reachable');
  const remoteServiceWorker = await serviceWorkerResponse.text();
  assert.ok(remoteServiceWorker.includes(expectedCacheName),
    `deployed service worker cache version mismatch; expected ${expectedCacheName}`);

  for (const route of routes) {
    const response = await context.request.get(`${baseUrl}/${route}`);
    assert.equal(response.status(), 200, `app page should be served: ${route}`);
    assert.ok((response.headers()['content-type'] || '').includes('text/html'),
      `app page should be HTML: ${route}`);
    const body = await response.text();
    assert.match(body, /<html[\\s>]/i, `app route returned no HTML document: ${route}`);
  }

  const page = await context.newPage();
  const homeResponse = await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
  assert.equal(homeResponse?.status(), 200, 'mobile home should load');

  assert.equal(await page.locator('body').evaluate(node => node.classList.contains('home-editing')), false,
    'fresh home should not start in edit mode');

  const tile = page.locator('button.app-tile[data-href]').first();
  await tile.scrollIntoViewIfNeeded();
  const firstRoute = await tile.getAttribute('data-href');
  assert.ok(firstRoute, 'first app tile should declare its destination');

  const expectedPath = `/${firstRoute}`;
  const navigationResponse = page.waitForResponse(response =>
    new URL(response.url()).origin === new URL(baseUrl).origin &&
    new URL(response.url()).pathname === expectedPath,
    { timeout: 15000 }
  );
  await tile.tap({ timeout: 10000 });
  const appResponse = await navigationResponse;
  assert.equal(appResponse.status(), 200, 'real mobile tap must load the app document');
  await page.waitForURL(url =>
    url.origin === new URL(baseUrl).origin && url.pathname === expectedPath,
    { timeout: 10000 }
  );
  assert.equal(new URL(page.url()).pathname, expectedPath,
    'mobile app tap must navigate to the exact declared app page');

  console.log(`PASS: live target ${baseUrl}; cache ${expectedCacheName}; ${routes.length} app routes returned HTTP 200 HTML; mobile tap navigated to ${expectedPath}.`);
} finally {
  await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}
