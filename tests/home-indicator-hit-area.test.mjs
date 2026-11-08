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
    const hitTarget = document.querySelector('.maomao-global-home-indicator-hit-target');
    const hitRect = hitTarget ? hitTarget.getBoundingClientRect() : null;
    const hitStyle = hitTarget ? getComputedStyle(hitTarget) : null;
    return {
      top: describe(document.elementFromPoint(cx, cy)),
      stack: document.elementsFromPoint(cx, cy).slice(0, 4).map(describe),
      hitTarget: hitRect ? {
        left: hitRect.left, top: hitRect.top, width: hitRect.width, height: hitRect.height,
        right: hitRect.right, bottom: hitRect.bottom,
        position: hitStyle.position, pointerEvents: hitStyle.pointerEvents,
        cssWidth: hitStyle.width, cssHeight: hitStyle.height, cssBottom: hitStyle.bottom
      } : null
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

  // ---------- 5. 论坛详情页：评论输入框优先，Home 线不承担返回（例外） ----------
  await openPage(`${baseUrl}/forum/forum-detail.html?id=${encodeURIComponent(SEEDED_POST.id)}`, '#commentInput');
  const detailLineGeom = await page.evaluate(() => {
    const round = (v) => Math.round(v * 100) / 100;
    const read = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: round(r.left), top: round(r.top), width: round(r.width), height: round(r.height), right: round(r.right), bottom: round(r.bottom) };
    };
    const describe = (el) => {
      if (!el) return null;
      const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : '';
      return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls;
    };
    const shell = document.querySelector('button.maomao-global-home-indicator');
    const lineStyle = getComputedStyle(shell, '::before');
    const sr = shell.getBoundingClientRect();
    // 可见线在 140x30 外壳内居中，实际绘制区固定为 84x4。
    const lineRect = {
      left: round(sr.left + (sr.width - 84) / 2),
      top: round(sr.top + (sr.height - 4) / 2),
      width: 84,
      height: 4,
      right: round(sr.left + (sr.width - 84) / 2 + 84),
      bottom: round(sr.top + (sr.height - 4) / 2 + 4)
    };
    const lineCenter = { x: round((lineRect.left + lineRect.right) / 2), y: round((lineRect.top + lineRect.bottom) / 2) };
    const hit = document.querySelector('.maomao-global-home-indicator-hit-target');
    const inputRect = read(document.querySelector('#commentInput'));
    let intersection = null;
    if (inputRect) {
      const left = Math.max(lineRect.left, inputRect.left);
      const right = Math.min(lineRect.right, inputRect.right);
      const top = Math.max(lineRect.top, inputRect.top);
      const bottom = Math.min(lineRect.bottom, inputRect.bottom);
      intersection = {
        left: round(left), top: round(top), right: round(right), bottom: round(bottom),
        width: round(Math.max(0, right - left)), height: round(Math.max(0, bottom - top))
      };
    }
    return {
      shellRect: read(shell),
      lineRect,
      lineCenter,
      lineWidth: lineStyle.width,
      lineHeight: lineStyle.height,
      shellPointerEvents: getComputedStyle(shell).pointerEvents,
      hitExists: !!hit,
      inputRect,
      intersection,
      lineTopElement: describe(document.elementFromPoint(lineCenter.x, lineCenter.y)),
      inputCenter: inputRect ? { x: round((inputRect.left + inputRect.right) / 2), y: round((inputRect.top + inputRect.bottom) / 2) } : null,
      inputBottomCenter: inputRect ? { x: round((inputRect.left + inputRect.right) / 2), y: round(inputRect.bottom - 1) } : null,
      inputEdges: inputRect ? {
        top: { x: round((inputRect.left + inputRect.right) / 2), y: round(inputRect.top + 1) },
        bottom: { x: round(inputRect.left + 20), y: round(inputRect.bottom - 1) },
        left: { x: round(inputRect.left + 1), y: round((inputRect.top + inputRect.bottom) / 2) },
        right: { x: round(inputRect.right - 1), y: round((inputRect.top + inputRect.bottom) / 2) }
      } : null
    };
  });

  add('forum-detail.home-line.visible-84x4',
    detailLineGeom.lineWidth === '84px' && detailLineGeom.lineHeight === '4px' &&
    Math.abs(detailLineGeom.lineRect.width - 84) <= 0.5 && Math.abs(detailLineGeom.lineRect.height - 4) <= 0.5 &&
    detailLineGeom.shellPointerEvents === 'none', detailLineGeom);
  // 例外：评论输入框完整覆盖 84x4 区域，该页不创建命中目标，Home 线不承担返回桌面。
  add('forum-detail.home-line.no-hit-target-exception', detailLineGeom.hitExists === false, { hitExists: detailLineGeom.hitExists });
  add('forum-detail.home-line.fully-overlaps-comment-input',
    !!(detailLineGeom.intersection &&
      Math.abs(detailLineGeom.intersection.width - 84) <= 0.5 &&
      Math.abs(detailLineGeom.intersection.height - 4) <= 0.5),
    { intersection: detailLineGeom.intersection, lineRect: detailLineGeom.lineRect, inputRect: detailLineGeom.inputRect });
  add('forum-detail.home-line.center.hits-comment-input',
    /input#commentInput/.test(detailLineGeom.lineTopElement || ''),
    { lineTopElement: detailLineGeom.lineTopElement, lineCenter: detailLineGeom.lineCenter });

  const detailPath = pathOf();
  const blurActive = () => page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  const tapAndRead = async (point) => {
    if (!point) return null;
    await blurActive();
    await page.mouse.click(point.x, point.y);
    await sleep(160);
    return page.evaluate(() => ({
      path: location.pathname,
      activeId: document.activeElement ? (document.activeElement.id || document.activeElement.tagName.toLowerCase()) : null
    }));
  };
  const focusCheck = (name, result, extra) => add(name,
    !!result && result.activeId === 'commentInput' && result.path === detailPath && !isIndex(),
    Object.assign({ path: result ? result.path : null, activeId: result ? result.activeId : null, expectedPath: detailPath }, extra || {}));

  focusCheck('forum-detail.comment-input.center.clicking.focus', await tapAndRead(detailLineGeom.inputCenter), { point: detailLineGeom.inputCenter });
  focusCheck('forum-detail.comment-input.bottom-center.clicking.focus', await tapAndRead(detailLineGeom.inputBottomCenter), { point: detailLineGeom.inputBottomCenter });
  for (const edge of ['top', 'bottom', 'left', 'right']) {
    focusCheck(`forum-detail.comment-input.edge.${edge}.clicking.focus`,
      await tapAndRead(detailLineGeom.inputEdges ? detailLineGeom.inputEdges[edge] : null),
      { point: detailLineGeom.inputEdges ? detailLineGeom.inputEdges[edge] : null });
  }

  // 原先被 84x4 命中目标拦截的区域：现在应落到评论输入框，且不返回桌面。
  const lineAreaTap = await tapAndRead(detailLineGeom.lineCenter);
  focusCheck('forum-detail.comment-input.line-area.clicking.focus', lineAreaTap, { lineCenter: detailLineGeom.lineCenter });
  add('forum-detail.home-line.center.clicking.exception-no-return',
    !!lineAreaTap && lineAreaTap.path === detailPath && !isIndex(),
    { result: lineAreaTap, lineCenter: detailLineGeom.lineCenter, exception: 'comment input keeps priority; this page does not return to home via the line' });

  const commentText = `home-indicator-002-${viewport.width}`;
  const centerRetap = await tapAndRead(detailLineGeom.inputCenter);
  let commentFocused = !!centerRetap && centerRetap.activeId === 'commentInput';
  if (commentFocused) await page.keyboard.type(commentText);
  await sleep(100);
  const typedValue = await page.evaluate(() => document.querySelector('#commentInput') ? document.querySelector('#commentInput').value : '');
  add('forum-detail.comment-input.outside-line.focus',
    commentFocused && typedValue.includes(commentText),
    { activeId: commentFocused ? 'commentInput' : null, typedValue, inputCenter: detailLineGeom.inputCenter });

  // 相邻区域连续触摸：输入框底边 → 线中心 → 输入框底边 → 线中心。
  const sequencePoints = [
    ['input-bottom', detailLineGeom.inputEdges ? detailLineGeom.inputEdges.bottom : null],
    ['line-center', detailLineGeom.lineCenter],
    ['input-bottom', detailLineGeom.inputEdges ? detailLineGeom.inputEdges.bottom : null],
    ['line-center', detailLineGeom.lineCenter]
  ];
  const sequence = [];
  await blurActive();
  for (const [label, point] of sequencePoints) {
    if (!point) continue;
    await page.mouse.click(point.x, point.y);
    await sleep(130);
    const state = await page.evaluate(() => ({
      path: location.pathname,
      activeId: document.activeElement ? (document.activeElement.id || document.activeElement.tagName.toLowerCase()) : null
    }));
    sequence.push(Object.assign({ label, point }, state));
  }
  add('forum-detail.adjacent-sequence.no-navigation',
    sequence.length === sequencePoints.length && sequence.every((step) => step.path === detailPath && !isIndex()),
    { sequence, expectedPath: detailPath });
  add('forum-detail.adjacent-sequence.final-focus',
    sequence.length === sequencePoints.length && sequence[sequence.length - 1].activeId === 'commentInput',
    { sequence });

  if (commentFocused && typedValue.includes(commentText)) {
    await page.click('.comment-bar .send-btn');
    const submitDeadline = Date.now() + 2000;
    let submitted = false;
    while (Date.now() < submitDeadline && !submitted) {
      await sleep(100);
      submitted = await page.evaluate((expected) => {
        try {
          const posts = JSON.parse(localStorage.getItem('forum_posts') || '[]');
          const post = posts.find((item) => item && item.id === 'hit_test_post');
          return !!(post && Array.isArray(post.comments) && post.comments.some((c) => c && c.text === expected));
        } catch (error) { return false; }
      }, commentText);
    }
    add('forum-detail.comment-input.type-and-submit', submitted, { commentText, typedValue, submitted });
  } else {
    add('forum-detail.comment-input.type-and-submit', false, { commentText, typedValue, skippedBecauseNotFocused: true });
  }

  // ---------- 6. Home 条自身仍可用 ----------
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
  browser = await chromium.launch({ headless: true });
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
