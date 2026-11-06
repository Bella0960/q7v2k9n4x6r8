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
  await page.locator('[data-spread="three"]').click();
  await page.locator('[data-action="draw-tarot"]').click();
  assert.equal(await page.locator('#crystalStage .crystal-card').count(), 3, 'three-card spread should reveal three crystal cards');
  assert.deepEqual(await page.locator('#tarotResults .position').allTextContents(), ['过去 · 来处', '现在 · 此刻', '未来 · 可能']);

  await page.locator('[data-go-home]').first().click();
  await page.locator('[data-open="wheel"]').first().click();
  await page.locator('#newWheelOption').fill('浏览器测试选项');
  await page.locator('[data-action="add-option"]').click();
  assert.ok((await page.locator('#wheelOptions').innerText()).includes('浏览器测试选项'), 'custom wheel option should appear');
  await page.evaluate(() => { Math.random = () => 0; });
  await page.locator('[data-action="spin"]').click();
  await page.waitForFunction(() => {
    const node = document.querySelector('#wheelResult');
    return node && node.textContent !== '正在转动…' && node.textContent.indexOf('这次的结果：') === 0;
  }, null, { timeout: 3000 });
  assert.equal(await page.locator('#wheelHistory li').count(), 1, 'wheel result should be recorded');
  assert.equal(await page.locator('#wheelResult').innerText(), '这次的结果：出门走走',
    'the result under the pointer must match the selected first wheel segment');
  const wheelAlignment = await page.evaluate(() => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(document.getElementById('wheelDisc')).transform);
    const rotation = (Math.atan2(matrix.b, matrix.a) * 180 / Math.PI + 360) % 360;
    const count = document.querySelectorAll('#wheelOptions li').length;
    const center = ((-90 + 180 / count + rotation) % 360 + 360) % 360;
    return { center, count };
  });
  const pointerDistance = Math.min(Math.abs(wheelAlignment.center - 270), 360 - Math.abs(wheelAlignment.center - 270));
  assert.ok(pointerDistance < 1, 'selected wheel segment should stop centered under the top pointer');
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), 'maomao_fate_cabin_v1');
  assert.ok(stored.wheelOptions.includes('浏览器测试选项'), 'wheel option should persist locally');
  assert.equal(stored.wheelHistory[0].value.length > 0, true, 'wheel result should persist locally');

  await page.reload({ waitUntil: 'load' });
  await page.locator('[data-open="wheel"]').first().click();
  assert.ok((await page.locator('#wheelOptions').innerText()).includes('浏览器测试选项'),
    'custom wheel option should still exist after a full reload');
  assert.equal(await page.locator('#wheelHistory li').count(), 1,
    'wheel result history should still exist after a full reload');
  await page.locator('[data-go-home]').first().click();
  await page.locator('[data-open="oracle"]').first().click();
  await page.locator('[data-oracle-category="学业"]').click();
  await page.locator('[data-action="draw-oracle"]').click();
  assert.ok((await page.locator('#oraclePaper').innerText()).includes('学业'), 'oracle should use the selected category');
  assert.equal(await page.locator('#oraclePaper h3').count(), 1, 'oracle should reveal a reading');
  const afterOracle = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), 'maomao_fate_cabin_v1');
  assert.ok(afterOracle.dailyOracle[Object.keys(afterOracle.dailyOracle).find(key => key.endsWith('_学业'))],
    'daily oracle selection should persist locally');
  const savedOracleTitle = await page.locator('#oraclePaper h3').innerText();
  await page.reload({ waitUntil: 'load' });
  await page.locator('[data-open="oracle"]').first().click();
  await page.locator('[data-oracle-category="学业"]').click();
  assert.equal(await page.locator('#oraclePaper h3').innerText(), savedOracleTitle,
    'the saved daily oracle should be restored after a full reload');

  assert.deepEqual(errors, [], 'Fate Cabin interactions must not throw browser errors');

  await page.locator('[data-exit]').click();
  await page.waitForURL(url => new URL(url).pathname === '/index.html', { timeout: 10000 });
  assert.equal(new URL(page.url()).pathname, '/index.html', 'the top-left action must return to the MAOMAO desktop');

  const storageBlockedPage = await context.newPage();
  await storageBlockedPage.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'maomao_fate_cabin_v1') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  const storageErrors = [];
  storageBlockedPage.on('pageerror', error => storageErrors.push(error.message));
  await storageBlockedPage.goto(baseUrl + '/fortune/fortune.html', { waitUntil: 'load' });
  const beforeFailedWrite = await storageBlockedPage.evaluate(key => localStorage.getItem(key), 'maomao_fate_cabin_v1');
  await storageBlockedPage.locator('[data-open="wheel"]').first().click();
  await storageBlockedPage.locator('#newWheelOption').fill('不应保存的选项');
  await storageBlockedPage.locator('[data-action="add-option"]').click();
  await storageBlockedPage.locator('#fateStorageNotice').waitFor({ state: 'visible' });
  assert.ok((await storageBlockedPage.locator('#wheelMessage').innerText()).includes('保存失败'),
    'a failed local write must not be reported as a successful save');
  assert.equal(await storageBlockedPage.evaluate(key => localStorage.getItem(key), 'maomao_fate_cabin_v1'),
    beforeFailedWrite, 'a failed write must leave the previously saved record untouched');
  await storageBlockedPage.reload({ waitUntil: 'load' });
  await storageBlockedPage.locator('[data-open="wheel"]').first().click();
  assert.ok(!(await storageBlockedPage.locator('#wheelOptions').innerText()).includes('不应保存的选项'),
    'an unsaved option must not be mistaken for a persisted option after reload');
  assert.deepEqual(storageErrors, [], 'storage failure should be handled without JavaScript exceptions');
  console.log('PASS: mobile and desktop navigation, single/three-card tarot, wheel pointer alignment and reload persistence, categorized oracle persistence, and storage-failure reporting.');

} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
