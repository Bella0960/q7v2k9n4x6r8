/**
 * MAOMAO Tutorial Mobile Browser Regression.
 * Real Chromium layout/interaction checks. No user account, real API Key, or remote API requests.
 * Run after npm ci and Playwright Chromium installation:
 *   npm run test:tutorial:browser
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp'
};
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname); }
  catch { res.writeHead(400).end(); return; }
  const file = path.resolve(ROOT, '.' + pathname);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    res.writeHead(403).end('forbidden'); return;
  }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(file).pipe(res);
  });
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const origin = 'http://127.0.0.1:' + port;

let browser;
let checks = 0;
function record(message) { checks++; process.stdout.write('PASS ' + message + '\n'); }
async function assertNoOverflow(page, width, stage) {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth
  }));
  assert.ok(metrics.document <= width + 1 && metrics.body <= width + 1,
    stage + ' horizontal overflow at ' + width + ': ' + JSON.stringify(metrics));
  record(stage + ' no overflow at ' + width + 'px');
}
async function openGuide(page, id, expectedTitle) {
  await page.locator('#topicGrid [data-open-guide="' + id + '"]').click();
  await page.locator('#walkthroughModal').waitFor({ state:'visible' });
  await page.locator('#walkArticle').waitFor({ state:'visible' });
  await page.getByRole('heading', { name:expectedTitle }).waitFor();
  assert.equal(await page.locator('#walkStepperContent').isVisible(), false);
  assert.equal(await page.locator('#walkNext').isVisible(), false);
  assert.ok((await page.locator('#walkArticle .walk-article-section').count()) >= 6);
  await page.locator('#walkClose').click();
  await page.locator('#walkthroughModal').waitFor({ state:'hidden' });
  record(id + ' article navigation');
}
try {
  browser = await chromium.launch({ headless:true });
  for (const width of [320, 375, 390, 430, 768]) {
    const ctx = await browser.newContext({
      viewport:{ width, height:844 },
      deviceScaleFactor:2,
      isMobile:width < 768,
      hasTouch:width < 768
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.goto(origin + '/tutorial/tutorial.html', { waitUntil:'domcontentloaded' });
      await page.locator('#topicGrid button').first().waitFor();
      assert.equal(await page.locator('#topicGrid button').count(), 6);
      await assertNoOverflow(page, width, 'home');
      await openGuide(page, 'api-first', 'API 到底是什么？从哪里获取');
      await openGuide(page, 'api-errors', '连接测试失败：按报错解决');
      await openGuide(page, 'api-params', '温度、Top P、Tokens 到底调什么');
      await openGuide(page, 'api-images', 'AI 生图：为什么聊天能用却画不出图');
      await openGuide(page, 'minimax-voice-guide', 'MiniMax 语音：API、Group ID 与 Voice ID');

      await page.selectOption('#diagnoseSelect', '404');
      assert.match(await page.locator('#diagnoseAnswer').innerText(), /Base URL/);
      record('HTTP 404 diagnoses address / model');

      assert.equal(await page.locator('#catalogDetails').evaluate(el => el.open), false);
      await page.fill('#guideSearch', '温度');
      assert.equal(await page.locator('#catalogDetails').evaluate(el => el.open), true);
      assert.ok((await page.locator('#guideGrid .guide-card').count()) > 0);
      record('search expands filtered catalog');

      await page.fill('#guideSearch', '');
      assert.equal(await page.locator('#faqList details').count(), 12);
      record('all 12 FAQ entries render');

      await page.locator('[data-start-guide="desktop"]').first().click();
      await page.locator('#walkStepperContent').waitFor({ state:'visible' });
      assert.equal(await page.locator('#walkArticle').isVisible(), false);
      await page.locator('#walkNext').click();
      assert.match(await page.locator('#walkStepCount').innerText(), /第 2 步/);
      await page.locator('#walkClose').click();
      record('legacy tutorial stepper preserved');

      await page.goto(origin + '/tutorial/tutorial.html#guide=api-images',
        { waitUntil:'domcontentloaded' });
      await page.locator('#walkArticle').waitFor({ state:'visible' });
      assert.match(await page.locator('#walkTitle').innerText(), /AI 生图/);
      await assertNoOverflow(page, width, 'article');
      record('direct hash opens article');

      assert.deepEqual(errors, [], width + 'px JavaScript page errors');
      record('no page errors at ' + width + 'px');
    } finally { await ctx.close(); }
  }

  // Storage failure feedback must never claim successful persistence.
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  await ctx.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'maomao_tutorial_progress_v1') {
        throw new DOMException('Simulated storage quota', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };
  });
  try {
    const page = await ctx.newPage();
    await page.goto(origin + '/tutorial/tutorial.html', { waitUntil:'domcontentloaded' });
    await page.locator('#catalogDetails > summary').click();
    await page.locator('[data-guide-id="desktop"] .guide-extra summary').click();
    await page.locator('input[data-done="desktop"]').check();
    await page.locator('#storageAlert').waitFor({ state:'visible' });
    assert.match(await page.locator('#storageAlert').innerText(), /未保存/);
    record('storage quota failure is visible');
  } finally { await ctx.close(); }

  console.log('MAOMAO tutorial browser smoke: ' + checks + ' assertions passed.');
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
}
