/**
 * STAGE04 acceptance screenshots: storefront home, categories (studio entry),
 * theme studio, and widget route highlight at 375/390/430px.
 * Local static assets only; no paid API, account or production endpoint.
 */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep, join } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('.');
const outDir = process.env.STAGE04_SHOTS_DIR || resolve('stage04-shots');
await mkdir(outDir, { recursive: true });

const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript',
  '.mjs':'text/javascript', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png',
  '.webp':'image/webp', '.woff2':'font/woff2', '.jpg':'image/jpeg' };

const server = createServer(async (req, res) => {
  try {
    let pathname = new URL(req.url || '/', 'http://localhost').pathname;
    pathname = decodeURIComponent(pathname);
    if (pathname === '/favicon.ico') { res.writeHead(204).end(); return; }
    const filename = resolve(root, '.' + pathname);
    if (!filename.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    const bytes = await readFile(filename);
    res.writeHead(200, { 'Content-Type': MIME[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(bytes);
  } catch { res.writeHead(404).end('Not Found'); }
});
await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });

const widths = [375, 390, 430];

async function shoot(width, tag, setup) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: width < 500, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await setup(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, `${tag}-${width}.png`), fullPage: false });
  await ctx.close();
  console.log('SHOT ' + tag + '-' + width);
}

for (const width of widths) {
  // Storefront home (discover).
  await shoot(width, 'storefront-home', async (page) => {
    await page.goto(origin + '/theme-store/theme-store.html', { waitUntil: 'load', timeout: 40000 });
    await page.waitForSelector('.sf-product');
  });

  // Storefront categories: chat-beauty group incl. studio entry.
  await shoot(width, 'storefront-categories', async (page) => {
    await page.goto(origin + '/theme-store/theme-store.html', { waitUntil: 'load', timeout: 40000 });
    await page.waitForSelector('.sf-product');
    await page.locator('[data-category="categories"]').click();
    await page.waitForSelector('.sf-category-row');
  });

  // Theme studio with back-to-storefront link.
  await shoot(width, 'studio', async (page) => {
    await page.goto(origin + '/theme-studio/theme-studio.html', { waitUntil: 'load', timeout: 40000 });
    await page.waitForTimeout(300);
  });

  // Widget manager routed highlight for clock-lg.
  await shoot(width, 'widget-highlight', async (page) => {
    await page.goto(origin + '/desktop/widgets.html?widget=clock-lg', { waitUntil: 'load', timeout: 40000 });
    await page.waitForSelector('[data-widget="clock-lg"].is-target');
    await page.waitForTimeout(200);
  });
}

await browser.close();
await new Promise((r) => server.close(r));
console.log('screenshots written to ' + outDir);
