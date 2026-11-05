import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/**
 * P0-02 页面加载性能回归测试（真实浏览器，本机 Edge）。
 * A: 首访只产生一次文档导航（不再被 controllerchange 强制 reload），且预缓存完整、离线可用。
 * B: 跳转淡出/淡入缩短后，点击→首帧与点击→navigationStart 明显下降，页面与返回导航仍正确。
 * C: 联系人排序复用同一个 Intl.Collator，构造次数不随联系人数量增长，排序结果与基线一致。
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function listPages(dir = root, rel = '') {
  const pages = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'tests', 'perf'].includes(entry.name)) continue;
    const next = rel ? rel + '/' + entry.name : entry.name;
    if (entry.isDirectory()) pages.push(...listPages(path.join(dir, entry.name), next));
    else if (entry.name.endsWith('.html')) pages.push(next);
  }
  return pages;
}

function startServer() {
  const pages = listPages();
  const state = { requests: 0 };
  const server = createServer(async (req, res) => {
    state.requests += 1;
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/pwa-pages.json') {
        const body = Buffer.from(JSON.stringify(pages));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
        res.end(body);
        return;
      }
      const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
      const filePath = path.join(root, rel);
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const data = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': path.extname(filePath) === '.html' ? 'no-store' : 'public, max-age=600'
      });
      res.end(data);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
  return new Promise((resolvePromise) => server.listen(0, '127.0.0.1', () => resolvePromise({ server, state, pages })));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NAME_POOL = ['张三', '李四', '王五', '阿明', '赵六', '陈晨', '周一', '吴凡', '郑好', '孙悦', '钱多', '冯雨', '褚青', '卫蓝', '蒋北', '沈知', '韩冬', '杨帆', '朱砂', '秦川'];
const PY_POOL = ['zhangsan', 'lisi', 'wangwu', 'aming', 'zhaoliu', 'chenchen', 'zhouyi', 'wufan', 'zhenghao', 'sunyue', 'qianduo', 'fengyu', 'chuqing', 'weilan', 'jiangbei', 'shenzhi', 'handong', 'yangfan', 'zhusha', 'qinchuan'];

function makeRoles(count) {
  const roles = [];
  for (let i = 0; i < count; i++) {
    const base = NAME_POOL[i % NAME_POOL.length];
    roles.push({
      id: 'perf-c' + String(i).padStart(2, '0'),
      name: i < NAME_POOL.length ? base : base + (i + 1),
      pinyin: PY_POOL[i % PY_POOL.length] + (i < NAME_POOL.length ? '' : String(i + 1))
    });
  }
  return roles;
}

const CLICK_PROBE = () => {
  try {
    document.addEventListener('click', (event) => {
      const anchor = event.target && event.target.closest ? event.target.closest('a[href], [data-href]') : null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') || anchor.getAttribute('data-href') || '';
      if (!href || href.charAt(0) === '#') return;
      sessionStorage.setItem('__perf_click', String(Date.now()));
    }, true);
  } catch (error) { /* 忽略 */ }
};

const readClickMetrics = () => {
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const paints = performance.getEntriesByType('paint') || [];
  const fcp = paints.find((entry) => entry.name === 'first-contentful-paint');
  const clickTs = Number(sessionStorage.getItem('__perf_click') || 0);
  const fcpFromClick = clickTs && fcp ? Math.round((performance.timeOrigin + fcp.startTime - clickTs) * 10) / 10 : null;
  const navStartFromClick = clickTs ? Math.round((performance.timeOrigin + (nav.startTime || 0) - clickTs) * 10) / 10 : null;
  return {
    path: location.pathname,
    type: nav.type || null,
    fcpFromClick,
    navStartFromClick,
    fcp: fcp ? Math.round(fcp.startTime) : -1
  };
};

async function cacheStats(page, expectedUrls = []) {
  return page.evaluate(async (expected) => {
    const keys = await caches.keys();
    const appCaches = keys.filter((key) => key.startsWith('phone-app-pwa-')).sort();
    const cacheName = appCaches[appCaches.length - 1] || '';
    const cache = cacheName ? await caches.open(cacheName) : null;
    const entries = cache ? await cache.keys() : [];
    const missing = [];
    for (const url of expected) {
      if (!cache || !(await cache.match(url))) missing.push(url);
    }
    const registrations = await navigator.serviceWorker.getRegistrations();
    const registration = registrations.find((item) => item.active && item.active.scriptURL.includes('/sw.js')) || null;
    return {
      keys,
      cacheName,
      entries: entries.length,
      controlled: !!navigator.serviceWorker.controller,
      activeState: registration && registration.active ? registration.active.state : 'missing',
      expectedCount: expected.length,
      missing
    };
  }, expectedUrls);
}

async function waitForServiceWorkerControl(page) {
  // `ready` can resolve during the activation hand-off; the user-visible
  // contract is that this document is actually controlled by the worker.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(
    () => !!navigator.serviceWorker.controller,
    null,
    { timeout: 30000 }
  );
}

async function waitForPrecache(page, minEntries) {
  await page.waitForFunction(async (min) => {
    const keys = await caches.keys();
    let total = 0;
    for (const key of keys) {
      const cache = await caches.open(key);
      total += (await cache.keys()).length;
    }
    return total >= min;
  }, minEntries, { timeout: 20000 });
}

async function sectionA(browser, baseUrl, report, expectedPrecacheUrls) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    if (localStorage.getItem('__seeded')) return;
    localStorage.setItem('__seeded', '1');
    localStorage.setItem('ai_custom_characters', JSON.stringify([{ id: 'perf-a1', name: '张三', pinyin: 'zhangsan' }]));
    localStorage.setItem('phone_groups', '[]');
  });
  const page = await context.newPage();
  let mainFrameNavigations = 0;
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) mainFrameNavigations += 1; });

  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await waitForServiceWorkerControl(page);
  await sleep(100);

  const navEntries = await page.evaluate(() => performance.getEntriesByType('navigation').map((entry) => entry.type));
  const stats = await cacheStats(page, expectedPrecacheUrls);
  const navCountAtSwReady = mainFrameNavigations;

  const checks = [];
  checks.push(['首访只有一次文档导航', navCountAtSwReady === 1, { navigations: navCountAtSwReady }]);
  checks.push(['首访文档未被 reload', navEntries.length === 1 && navEntries[0] === 'navigate', { navEntries }]);
  checks.push(['首访页面已受 SW 控制', stats.controlled === true, { controlled: stats.controlled }]);
  checks.push(['活动 SW 缓存完整覆盖 APP_SHELL 与全部 HTML 页面清单', stats.missing.length === 0,
    { cacheName: stats.cacheName, entries: stats.entries, expected: stats.expectedCount, activeState: stats.activeState, missing: stats.missing }]);

  // 离线仍能打开聊天页
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await sleep(400);
  await context.setOffline(true);
  let offlineOk = false;
  let offlineDetail = null;
  try {
    await page.goto(baseUrl + '/chat/chat/chat.html', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForSelector('#chatListContainer', { timeout: 6000 });
    const textLength = await page.evaluate(() => (document.body.textContent || '').trim().length);
    offlineOk = textLength > 0 && page.url().includes('/chat/chat/chat.html');
    offlineDetail = { textLength, url: page.url() };
  } catch (error) {
    offlineDetail = { error: String(error).slice(0, 120) };
  }
  await context.setOffline(false);
  checks.push(['离线仍能打开聊天页', offlineOk, offlineDetail]);

  report.A = { checks, navCount: navCountAtSwReady, precache: stats, offline: offlineDetail, requests: null };
  await context.close();
}

async function sectionB(browser, baseUrl, report) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(CLICK_PROBE);
  await context.addInitScript(() => {
    if (localStorage.getItem('__seeded')) return;
    localStorage.setItem('__seeded', '1');
    localStorage.setItem('ai_custom_characters', JSON.stringify([{ id: 'perf-b1', name: '张三', pinyin: 'zhangsan' }, { id: 'perf-b2', name: '李四', pinyin: 'lisi' }]));
  });
  const page = await context.newPage();
  await page.goto(baseUrl + '/index.html', { waitUntil: 'load' });
  await waitForPrecache(page, 150);
  await sleep(500);

  const measurements = [];
  const checks = [];
  for (let round = 0; round < 3; round++) {
    if (!page.url().includes('/chat/chat/chat.html')) {
      await page.goto(baseUrl + '/chat/chat/chat.html', { waitUntil: 'load' });
    }
    await page.waitForSelector('.nav-tab[href*="contacts"]', { timeout: 10000 });
    await page.evaluate(() => sessionStorage.removeItem('__perf_click'));
    await page.click('.nav-tab[href*="contacts"]');
    await page.waitForURL('**/chat/contacts/contacts.html', { timeout: 15000 });
    await page.waitForLoadState('load');
    await sleep(500);
    const metrics = await page.evaluate(readClickMetrics);
    metrics.items = await page.locator('#contactList .contact-item').count();
    metrics.title = await page.locator('.top-nav-title').first().textContent();
    measurements.push(metrics);

    // 返回聊天页，验证返回导航仍可用
    await page.click('.nav-tab[href*="chat/chat/chat.html"]');
    await page.waitForURL('**/chat/chat/chat.html', { timeout: 15000 });
    await page.waitForSelector('#chatListContainer', { timeout: 10000 });
  }

  const sortedNav = measurements.map((m) => m.navStartFromClick).sort((a, b) => a - b);
  const sortedFcp = measurements.map((m) => m.fcpFromClick).sort((a, b) => a - b);
  const medianNav = sortedNav[Math.floor(sortedNav.length / 2)];
  const medianFcp = sortedFcp[Math.floor(sortedFcp.length / 2)];

  checks.push(['联系人页内容渲染正确', measurements.every((m) => m.items >= 2 && m.title === '通讯录'), { items: measurements.map((m) => m.items), titles: measurements.map((m) => m.title) }]);
  checks.push(['返回导航回到聊天页可用', page.url().includes('/chat/chat/chat.html'), { url: page.url() }]);
  checks.push(['点击→navigationStart 中位数 <= 150ms（基线约 211ms）', medianNav <= 150, { median: medianNav, rounds: measurements.map((m) => m.navStartFromClick) }]);
  checks.push(['点击→首帧中位数 <= 260ms（基线约 291ms）', medianFcp <= 260, { median: medianFcp, rounds: measurements.map((m) => m.fcpFromClick) }]);

  // prefers-reduced-motion 仍然生效
  const reduceContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await reduceContext.addInitScript(CLICK_PROBE);
  const reducePage = await reduceContext.newPage();
  await reducePage.goto(baseUrl + '/chat/chat/chat.html', { waitUntil: 'load' });
  await sleep(300);
  const reduceStyle = await reducePage.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return { transitionDuration: style.transitionDuration, animationDuration: style.animationDuration };
  });
  checks.push(['reduced-motion 下过渡/动画被关闭', /^0s|none/.test(reduceStyle.transitionDuration) && /^0s|none/.test(reduceStyle.animationDuration), reduceStyle]);
  await reduceContext.close();

  report.B = { checks, measurements, medianNav, medianFcp, reducedMotion: reduceStyle };
  await context.close();
}

async function sectionC(browser, baseUrl, report) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const roles = makeRoles(40);
  await context.addInitScript((seed) => {
    if (localStorage.getItem('__perf_roles_seeded')) return;
    localStorage.setItem('__perf_roles_seeded', '1');
    localStorage.setItem('ai_custom_characters', JSON.stringify(seed));
    localStorage.setItem('phone_groups', '[]');
  }, roles);
  await context.addInitScript(() => {
    window.__collatorCount = 0;
    const Real = Intl.Collator;
    Intl.Collator = new Proxy(Real, {
      construct(target, args) {
        window.__collatorCount += 1;
        return Reflect.construct(target, args, target);
      }
    });
  });

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(baseUrl + '/chat/contacts/contacts.html', { waitUntil: 'load' });
  await page.waitForSelector('#contactList .contact-item', { timeout: 10000 });
  await sleep(300);

  const rendered = await page.evaluate(() => Array.from(document.querySelectorAll('#contactList .contact-item')).map((el) => el.getAttribute('data-id')));
  const collatorCount = await page.evaluate(() => window.__collatorCount);
  const loadMetrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const fcp = (performance.getEntriesByType('paint') || []).find((entry) => entry.name === 'first-contentful-paint');
    return { dcl: Math.round(nav.domContentLoadedEventEnd || 0), load: Math.round(nav.loadEventEnd || 0), fcp: fcp ? Math.round(fcp.startTime) : -1 };
  });

  // 期望顺序：与页面渲染规则一致（先按比较器排序，再按首字母分组，A-Z 在前，# 最后）
  const expected = await page.evaluate((seed) => {
    const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
    const keyOf = (role) => String(role.pinyin || role.py || role.sortName || role.name || '');
    const initialOf = (role) => {
      const first = keyOf(role).trim().charAt(0).toUpperCase();
      return /^[A-Z]$/.test(first) ? first : '#';
    };
    const sorted = seed.slice().sort((a, b) => collator.compare(keyOf(a), keyOf(b)));
    const groups = {};
    sorted.forEach((role) => {
      const letter = initialOf(role);
      (groups[letter] = groups[letter] || []).push(role);
    });
    const letters = Object.keys(groups).sort((a, b) => {
      if (a === '#') return 1;
      if (b === '#') return -1;
      return a.localeCompare(b);
    });
    return letters.flatMap((letter) => groups[letter].map((role) => role.id));
  }, roles);

  const checks = [];
  const sameOrder = rendered.length === expected.length && rendered.every((id, index) => id === expected[index]);
  checks.push(['排序结果与基线完全一致', sameOrder, { rendered: rendered.slice(0, 8), expected: expected.slice(0, 8), count: { rendered: rendered.length, expected: expected.length } }]);
  checks.push(['40 个联系人只构造 1 次 Intl.Collator', collatorCount === 1, { collatorCount }]);

  // 少数据量时构造次数必须相同（不随列表长度增长）
  const smallRoles = makeRoles(6);
  await page.evaluate((seed) => { localStorage.setItem('ai_custom_characters', JSON.stringify(seed)); }, smallRoles);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#contactList .contact-item', { timeout: 10000 });
  await sleep(200);
  const smallCount = await page.evaluate(() => window.__collatorCount);
  const smallRendered = await page.evaluate(() => Array.from(document.querySelectorAll('#contactList .contact-item')).map((el) => el.getAttribute('data-id')));
  checks.push(['6 个联系人构造次数与 40 个时相同', smallCount === collatorCount && smallCount <= 1 && smallRendered.length === 6,
    { small: smallCount, large: collatorCount, rendered: smallRendered.length }]);

  report.C = { checks, collatorCount, smallCount, loadMetrics, renderedCount: rendered.length };
  await context.close();
}

const { server, pages } = await startServer();
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const swSource = await readFile(resolve(root, 'sw.js'), 'utf8');
const appShellMatch = swSource.match(/const APP_SHELL = \[([\s\S]*?)\n\];/);
if (!appShellMatch) throw new Error('Unable to read APP_SHELL from sw.js');
const appShellPaths = Array.from(appShellMatch[1].matchAll(/['"]([^'"]+)['"]/g), (match) => match[1]);
const expectedPrecacheUrls = Array.from(new Set(
  appShellPaths
    .concat(pages.map((page) => './' + page))
    .filter((path) => path !== './')
    .map((path) => new URL(path, baseUrl + '/').href)
));
const report = {};
let browser;
let failed = false;
const failures = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  await sectionA(browser, baseUrl, report, expectedPrecacheUrls);
  await sectionB(browser, baseUrl, report);
  await sectionC(browser, baseUrl, report);
  for (const key of ['A', 'B', 'C']) {
    for (const [name, ok, detail] of report[key].checks) {
      console.log(`${ok ? 'PASS' : 'FAIL'} [${key}] ${name} ${JSON.stringify(detail)}`);
      if (!ok) { failed = true; failures.push(`[${key}] ${name}`); }
    }
  }
  console.log(JSON.stringify(report, null, 2));
  console.log(`pages=${pages.length}`);
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
if (failed) {
  console.error(`FAILED: ${failures.join('; ')}`);
  process.exitCode = 1;
}
