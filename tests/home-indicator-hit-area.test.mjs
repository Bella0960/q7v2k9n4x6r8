import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/**
 * Home 条点击拦截修复的真实浏览器验证。
 * 本机 Edge（channel: 'msedge'），375×812 / 390×844 / 430×932 三档各自独立跑。
 *
 * 断言内容：
 *  1. 聊天输入框中心点击不跳 /index.html，且输入框获得焦点并能输入。
 *  2. 论坛「发现」tab 中心点击正常切换、不跳 /index.html。
 *  3. 论坛「消息」tab 中心点击进入 forum-notifications.html、不跳 /index.html。
 *  4. 论坛评论输入框中心点击获得焦点并能输入。
 *  5. Home 条可见线中心点击仍能返回桌面（/index.html）。
 *  6. 页面滚动与底部导航不受影响。
 *  7. 三个页面均无横向溢出（scrollWidth <= clientWidth）。
 *
 * 通过 MAOMAO_ROOT 可把静态站点根指向另一份工作树，用于对 origin/main 基线跑回归。
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const servedRoot = resolve(process.env.MAOMAO_ROOT || repoRoot);

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
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function startServer(root) {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const rel = urlPath === '/' ? '/index.html' : urlPath;
      const filePath = path.join(root, rel);
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    } catch (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => resolvePromise(server));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWPORTS = [
  { width: 375, height: 812, label: '375x812' },
  { width: 390, height: 844, label: '390x844' },
  { width: 430, height: 932, label: '430x932' }
];

/** 读取 Home 条与指定目标的矩形、pointer-events 与重叠面积。 */
function measureRects(selector) {
  {
    const round = (v) => Math.round(v * 100) / 100;
    const read = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: round(r.left), top: round(r.top), width: round(r.width), height: round(r.height), right: round(r.right), bottom: round(r.bottom) };
    };
    const bar = document.querySelector('button.maomao-global-home-indicator');
    const target = document.querySelector(selector);
    const barRect = read(bar);
    const targetRect = read(target);
    const barStyle = bar ? getComputedStyle(bar) : null;
    const lineStyle = bar ? getComputedStyle(bar, '::before') : null;
    let overlap = null;
    if (barRect && targetRect) {
      const w = Math.max(0, Math.min(barRect.right, targetRect.right) - Math.max(barRect.left, targetRect.left));
      const h = Math.max(0, Math.min(barRect.bottom, targetRect.bottom) - Math.max(barRect.top, targetRect.top));
      overlap = { width: round(w), height: round(h), area: round(w * h) };
    }
    return {
      bar: barRect,
      target: targetRect,
      barPointerEvents: barStyle ? barStyle.pointerEvents : null,
      barPosition: barStyle ? barStyle.position : null,
      barZIndex: barStyle ? barStyle.zIndex : null,
      linePointerEvents: lineStyle ? lineStyle.pointerEvents : null,
      lineWidth: lineStyle ? lineStyle.width : null,
      lineHeight: lineStyle ? lineStyle.height : null,
      overlap,
      targetCenter: targetRect ? { x: round(targetRect.left + targetRect.width / 2), y: round(targetRect.top + targetRect.height / 2) } : null,
      barCenter: barRect ? { x: round(barRect.left + barRect.width / 2), y: round(barRect.top + barRect.height / 2) } : null
    };
  }
}

async function hitStack(page, x, y) {
  return page.evaluate(([cx, cy]) => {
    const describe = (el) => {
      if (!el) return null;
      const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '';
      return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls;
    };
    return {
      top: describe(document.elementFromPoint(cx, cy)),
      stack: document.elementsFromPoint(cx, cy).slice(0, 4).map(describe)
    };
  }, [x, y]);
}

async function readOverflow(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  }));
}

const SEEDED_POST = {
  id: 'hit_test_post',
  name: '测试用户',
  avatar: '测',
  topic: '日常交流',
  title: '评论输入框命中测试',
  body: '用于验证评论输入框中心点击不被 Home 条拦截。',
  comments: [],
  likes: 0,
  owner: 'seed',
  aiCommentBatch: 'v1'
};

async function runViewport(browser, baseUrl, viewport) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  await context.addInitScript((seed) => {
    localStorage.setItem('forum_posts', JSON.stringify([seed]));
  }, SEEDED_POST);
  const page = await context.newPage();
  const checks = [];
  const add = (name, ok, measured) => checks.push({ name, ok: !!ok, measured });

  const pathOf = () => {
    try { return new URL(page.url()).pathname; } catch (error) { return ''; }
  };
  const isIndex = () => /\/index\.html$/i.test(pathOf()) || pathOf() === '/';
  const openPage = async (url, waitSelector) => {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('button.maomao-global-home-indicator', { timeout: 10000 });
    if (waitSelector) await page.waitForSelector(waitSelector, { timeout: 10000 });
    await sleep(250);
  };

  // ---------- 1. 聊天输入框 ----------
  await openPage(`${baseUrl}/chat/chat/chat-detail.html?id=c_test`, '#chat-input');
  const chatGeom = await page.evaluate(measureRects, '#chat-input');
  const chatStack = chatGeom.targetCenter ? await hitStack(page, chatGeom.targetCenter.x, chatGeom.targetCenter.y) : null;
  const chatUrlBefore = pathOf();
  if (chatGeom.targetCenter) {
    await page.mouse.click(chatGeom.targetCenter.x, chatGeom.targetCenter.y);
    await sleep(450);
  }
  const chatAfter = await page.evaluate(() => {
    const input = document.querySelector('#chat-input');
    return {
      activeId: document.activeElement ? (document.activeElement.id || document.activeElement.tagName.toLowerCase()) : null,
      hasInput: !!input,
      value: input ? input.value : null,
      path: location.pathname
    };
  });
  const chatFocused = chatAfter.hasInput && chatAfter.activeId === 'chat-input';
  add('chat.input-center.clicking.focus', chatFocused && chatAfter.path === chatUrlBefore && !isIndex(),
    { beforePath: chatUrlBefore, afterPath: chatAfter.path, activeId: chatAfter.activeId, hitStack: chatStack });
  if (chatFocused && !isIndex()) {
    await page.keyboard.type('x');
    await sleep(120);
    const typed = await page.evaluate(() => document.querySelector('#chat-input') ? document.querySelector('#chat-input').value : '');
    add('chat.input-center.clicking.typing', typed.includes('x'), { value: typed.slice(-4) });
  } else {
    add('chat.input-center.clicking.typing', false, { skippedBecauseNotFocused: true });
  }
  const chatGeom2 = await page.evaluate(measureRects, '#chat-input');
  const chatOverflow = await readOverflow(page);
  add('chat.input.center.insideBarRect', !!(chatGeom2.overlap && chatGeom2.overlap.width > 0 && chatGeom2.overlap.height > 0),
    { overlap: chatGeom2.overlap, bar: chatGeom2.bar, target: chatGeom2.target });
  add('chat.no-horizontal-overflow', chatOverflow.overflow <= 0, chatOverflow);

  // ---------- 2. 论坛 tab ----------
  await openPage(`${baseUrl}/forum/forum.html`, '.nav-item[data-page="discover"]');
  const forumGeom = await page.evaluate(() => {
    const round = (v) => Math.round(v * 100) / 100;
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { left: round(r.left), top: round(r.top), width: round(r.width), height: round(r.height), right: round(r.right), bottom: round(r.bottom), cx: round(r.left + r.width / 2), cy: round(r.top + r.height / 2) };
    };
    const nav = (p) => rect(document.querySelector(`.nav-item[data-page="${p}"]`));
    const bar = document.querySelector('button.maomao-global-home-indicator');
    let firstPost = null;
    const post = document.querySelector('.post[data-post]');
    if (post) firstPost = post.dataset.post;
    return { discover: nav('discover'), notice: nav('notice'), home: nav('home'), bar: rect(bar), firstPost, barPointerEvents: getComputedStyle(bar).pointerEvents };
  });
  const discoverStack = await hitStack(page, forumGeom.discover.cx, forumGeom.discover.cy);
  await page.mouse.click(forumGeom.discover.cx, forumGeom.discover.cy);
  await sleep(450);
  const discoverAfter = await page.evaluate(() => ({
    path: location.pathname,
    activeNav: (document.querySelector('.nav-item.active') || {}).dataset ? document.querySelector('.nav-item.active').dataset.page : null,
    hasDiscoverMarker: !!document.querySelector('.masthead .overline span') && document.querySelector('.masthead .overline span').textContent.indexOf('DISCOVER') === 0
  }));
  add('forum.discover-tab.clicking.switch', !isIndex() && discoverAfter.path === '/forum/forum.html' && discoverAfter.activeNav === 'discover' && discoverAfter.hasDiscoverMarker,
    { afterPath: discoverAfter.path, activeNav: discoverAfter.activeNav, discoverMarker: discoverAfter.hasDiscoverMarker, hitStack: discoverStack });

  const noticeStack = forumGeom.notice ? await hitStack(page, forumGeom.notice.cx, forumGeom.notice.cy) : null;
  if (forumGeom.notice) {
    await page.mouse.click(forumGeom.notice.cx, forumGeom.notice.cy);
    await sleep(500);
  }
  const noticeAfter = pathOf();
  add('forum.notice-tab.clicking.navigate', !!forumGeom.notice && !isIndex() && /forum-notifications\.html$/i.test(noticeAfter),
    { afterPath: noticeAfter, hitStack: noticeStack });

  await openPage(`${baseUrl}/forum/forum.html`, '.nav-item[data-page="home"]');
  const homeTabGeom = await page.evaluate(() => {
    const r = document.querySelector('.nav-item[data-page="home"]').getBoundingClientRect();
    return { cx: Math.round((r.left + r.width / 2) * 100) / 100, cy: Math.round((r.top + r.height / 2) * 100) / 100 };
  });
  await page.mouse.click(homeTabGeom.cx, homeTabGeom.cy);
  await sleep(400);
  const homeTabAfter = await page.evaluate(() => ({
    path: location.pathname,
    activeNav: document.querySelector('.nav-item.active') ? document.querySelector('.nav-item.active').dataset.page : null
  }));
  add('forum.home-tab.clicking', !isIndex() && homeTabAfter.path === '/forum/forum.html' && homeTabAfter.activeNav === 'home',
    homeTabAfter);

  const forumOverflow = await readOverflow(page);
  add('forum.no-horizontal-overflow', forumOverflow.overflow <= 0, forumOverflow);

  // ---------- 3. 论坛滚动 ----------
  const scrollArea = await page.evaluate(() => {
    const area = document.querySelector('.scroll-area');
    if (!area) return null;
    const r = area.getBoundingClientRect();
    return {
      before: area.scrollTop,
      max: area.scrollHeight - area.clientHeight,
      cx: Math.round((r.left + r.width / 2) * 100) / 100,
      cy: Math.round((r.top + Math.min(r.height, 200) / 3) * 100) / 100
    };
  });
  if (scrollArea && scrollArea.max > 0) {
    await page.mouse.move(scrollArea.cx, scrollArea.cy);
    await page.mouse.wheel(0, 320);
    await sleep(350);
    const after = await page.evaluate(() => document.querySelector('.scroll-area').scrollTop);
    add('forum.page.scroll', after > scrollArea.before, { before: scrollArea.before, after, max: scrollArea.max });
  } else {
    add('forum.page.scroll', false, { reason: 'scroll area missing or not scrollable', scrollArea });
  }

  // ---------- 4. 论坛评论输入框 ----------
  const postId = forumGeom.firstPost;
  if (postId) {
    await openPage(`${baseUrl}/forum/forum-detail.html?id=${encodeURIComponent(SEEDED_POST.id)}`, '#commentInput');
    const commentGeom = await page.evaluate(measureRects, '#commentInput');
    const commentStack = commentGeom.targetCenter ? await hitStack(page, commentGeom.targetCenter.x, commentGeom.targetCenter.y) : null;
    const beforePath = pathOf();
    if (commentGeom.targetCenter) {
      await page.mouse.click(commentGeom.targetCenter.x, commentGeom.targetCenter.y);
      await sleep(400);
    }
    const commentAfter = await page.evaluate(() => ({
      activeId: document.activeElement ? (document.activeElement.id || document.activeElement.tagName.toLowerCase()) : null,
      path: location.pathname
    }));
    const focused = commentAfter.activeId === 'commentInput';
    add('forum.comment-input.center.clicking.focus', focused && !isIndex() && commentAfter.path === beforePath,
      { beforePath, afterPath: commentAfter.path, activeId: commentAfter.activeId, overlap: commentGeom.overlap, hitStack: commentStack });
    if (focused) {
      await page.keyboard.type('y');
      await sleep(120);
      const typed = await page.evaluate(() => document.querySelector('#commentInput') ? document.querySelector('#commentInput').value : '');
      add('forum.comment-input.center.clicking.typing', typed.includes('y'), { value: typed.slice(-4) });
    } else {
      add('forum.comment-input.center.clicking.typing', false, { skippedBecauseNotFocused: true });
    }
    const detailOverflow = await readOverflow(page);
    add('forum-detail.no-horizontal-overflow', detailOverflow.overflow <= 0, detailOverflow);
  } else {
    add('forum.comment-input.center.clicking.focus', false, { reason: 'no seeded post found on forum.html' });
    add('forum.comment-input.center.clicking.typing', false, { reason: 'no seeded post found on forum.html' });
    add('forum-detail.no-horizontal-overflow', false, { reason: 'no seeded post found on forum.html' });
  }

  // ---------- 5. Home 条自身仍可用 ----------
  await openPage(`${baseUrl}/forum/forum.html`, '.nav-item[data-page="home"]');
  const barGeom = await page.evaluate(() => {
    const bar = document.querySelector('button.maomao-global-home-indicator');
    const r = bar.getBoundingClientRect();
    const line = getComputedStyle(bar, '::before');
    return {
      cx: Math.round((r.left + r.width / 2) * 100) / 100,
      cy: Math.round((r.top + r.height / 2) * 100) / 100,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      pointerEvents: getComputedStyle(bar).pointerEvents,
      linePointerEvents: line.pointerEvents,
      lineWidth: line.width,
      lineHeight: line.height
    };
  });
  const lineStack = await hitStack(page, barGeom.cx, barGeom.cy);
  await page.mouse.click(barGeom.cx, barGeom.cy);
  await sleep(500);
  add('home-line.center.clicking.returns-home', isIndex(), { afterPath: pathOf(), hitStack: lineStack, bar: barGeom });

  await context.close();
  return { viewport, checks };
}

const server = await startServer(servedRoot);
const baseUrl = `http://127.0.0.1:${server.address().port}`;
let browser;
let anyFail = false;
const report = [];
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const viewport of VIEWPORTS) {
    let checks;
    try {
      checks = (await runViewport(browser, baseUrl, viewport)).checks;
    } catch (error) {
      checks = [{ name: 'fatal', ok: false, measured: { message: String(error && error.message || error) } }];
    }
    const passed = checks.filter((c) => c.ok).length;
    const total = checks.length;
    const failed = checks.filter((c) => !c.ok).map((c) => c.name);
    if (passed !== total) anyFail = true;
    report.push({
      viewport: viewport.label,
      passed,
      total,
      status: passed === total ? 'PASS' : 'FAIL',
      failed,
      checks
    });
    console.log(`[${viewport.label}] ${passed === total ? 'PASS' : 'FAIL'} ${passed}/${total}`);
    for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  ${JSON.stringify(c.measured)}`);
  }
  console.log('RESULT_JSON ' + JSON.stringify(report));
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
if (anyFail) process.exitCode = 1;
