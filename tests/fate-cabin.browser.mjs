import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const distRoot = path.resolve('dist');
assert.ok(fs.existsSync(path.join(distRoot, 'fortune', 'fortune.html')), 'production build is missing dist/fortune/fortune.html');

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
    res.writeHead(200, { 'Content-Type': types[extension] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(bytes);
  });
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = 'http://127.0.0.1:' + address.port;
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.goto(baseUrl + '/fortune/fortune.html', { waitUntil: 'load' });
  assert.equal(response && response.status(), 200, 'Fate Cabin must load from the production build');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });

  await page.locator('#homeView').waitFor({ state: 'visible' });
  await page.locator('[data-open="tarot"]').first().click();
  await page.locator('#tarotView').waitFor({ state: 'visible' });
  await page.locator('[data-spread="single"]').click();
  await page.locator('[data-action="draw-tarot"]').click();
  assert.equal(await page.locator('#crystalStage .crystal-card').count(), 1, 'single spread should reveal one crystal card');
  assert.equal(await page.locator('#tarotResults .reading-result').count(), 1, 'single spread should produce one interpretation');

  await page.locator('[data-go-home]').first().click();
  await page.locator('[data-open="wheel"]').first().click();
  await page.locator('#newWheelOption').fill('浏览器测试选项');
  await page.locator('[data-action="add-option"]').click();
  assert.ok((await page.locator('#wheelOptions').innerText()).includes('浏览器测试选项'), 'custom wheel option should appear');
  await page.locator('[data-action="spin"]').click();
  await page.waitForFunction(() => {
    const node = document.querySelector('#wheelResult');
    return node && node.textContent !== '正在转动…' && node.textContent.indexOf('这次的结果：') === 0;
  }, null, { timeout: 3000 });
  assert.equal(await page.locator('#wheelHistory li').count(), 1, 'wheel result should be recorded');
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), 'maomao_fate_cabin_v1');
  assert.ok(stored.wheelOptions.includes('浏览器测试选项'), 'wheel option should persist locally');
  assert.equal(stored.wheelHistory[0].value.length > 0, true, 'wheel result should persist locally');

  await page.locator('[data-go-home]').first().click();
  await page.locator('[data-open="oracle"]').first().click();
  await page.locator('[data-oracle-category="学业"]').click();
  await page.locator('[data-action="draw-oracle"]').click();
  assert.ok((await page.locator('#oraclePaper').innerText()).includes('学业'), 'oracle should use the selected category');
  assert.equal(await page.locator('#oraclePaper h3').count(), 1, 'oracle should reveal a reading');
  const afterOracle = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), 'maomao_fate_cabin_v1');
  assert.ok(afterOracle.dailyOracle[Object.keys(afterOracle.dailyOracle).find(key => key.endsWith('_学业'))],
    'daily oracle selection should persist locally');

  assert.deepEqual(errors, [], 'Fate Cabin interactions must not throw browser errors');
  console.log('PASS: mobile Fate Cabin loads; single tarot, custom wheel spin/history, and categorized daily oracle persist without page errors.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
