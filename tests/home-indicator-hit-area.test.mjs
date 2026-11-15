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

  // ---------- 5. 论坛详情页：Home 热区与评论输入框各自独立可用 ----------
  const detailUrl = `${baseUrl}/forum/forum-detail.html?id=${encodeURIComponent(SEEDED_POST.id)}`;
  await openPage(detailUrl, '#commentInput');
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
    const shellRect = read(shell);
    const lineRect = shellRect ? {
      left: round(shellRect.left + (shellRect.width - 84) / 2),
      top: round(shellRect.top + (shellRect.height - 4) / 2),
      width: 84,
      height: 4,
      right: round(shellRect.left + (shellRect.width - 84) / 2 + 84),
      bottom: round(shellRect.top + (shellRect.height - 4) / 2 + 4)
    } : null;
    const lineCenter = lineRect ? {
      x: round((lineRect.left + lineRect.right) / 2),
      y: round((lineRect.top + lineRect.bottom) / 2)
    } : null;
    const hit = document.querySelector('.maomao-global-home-indicator-hit-target');
    const hitRect = read(hit);
    const inputRect = read(document.querySelector('#commentInput'));
    return {
      lineRect,
      lineCenter,
      lineWidth: lineStyle.width,
      lineHeight: lineStyle.height,
      shellPointerEvents: getComputedStyle(shell).pointerEvents,
      hitExists: !!hit,
      hitRect,
      hitPointerEvents: hit ? getComputedStyle(hit).pointerEvents : null,
      inputRect,
      inputToHitGap: hitRect && inputRect ? round(hitRect.top - inputRect.bottom) : null,
      lineTopElement: lineCenter ? describe(document.elementFromPoint(lineCenter.x, lineCenter.y)) : null
    };
  });

  // A reply hint must not overlap the composer. Preview images expand the
  // composer, so a static bottom:64px causes real input obstruction.
  const hintMetrics = () => page.evaluate(() => {
    const hint = document.getElementById('replyHint');
    const composer = document.querySelector('.comment-bar');
    const hr = hint.getBoundingClientRect();
    const cr = composer.getBoundingClientRect();
    return { hintBottom: hr.bottom, hintHeight: hr.height,
      hintLeft: hr.left, hintWidth: hr.width,
      composerLeft: cr.left, composerWidth: cr.width,
      composerTop: cr.top, composerHeight: cr.height,
      composerBottom: parseFloat(getComputedStyle(composer).bottom) || 0,
      contentScrollClearance: parseFloat(getComputedStyle(document.body).paddingBottom) || 0,
      bottomCSS: getComputedStyle(hint).bottom };
  });
  await page.evaluate(() => { document.getElementById('replyHint').style.display = 'flex'; });
  // ResizeObserver/rAF updates are asynchronous. Wait for real geometry before
  // measuring, rather than racing the first visible reply-hint frame.
  await page.waitForFunction(() => {
    const hint = document.getElementById('replyHint');
    const composer = document.querySelector('.comment-bar');
    const h = hint.getBoundingClientRect();
    const c = composer.getBoundingClientRect();
    const scrollPadding = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    const composerBottom = parseFloat(getComputedStyle(composer).bottom) || 0;
    return h.height > 0 && h.bottom <= c.top - 6 &&
      scrollPadding >= c.height + composerBottom + h.height + 14;
  }, null, { timeout: 2000 });
  let replyMetrics = await hintMetrics();
  add('forum-detail.reply-hint.above-composer',
    replyMetrics.hintBottom <= replyMetrics.composerTop - 6, replyMetrics);
  add('forum-detail.reply-hint.matches-mobile-composer-width',
    Math.abs(replyMetrics.hintLeft - replyMetrics.composerLeft) <= 1 &&
    Math.abs(replyMetrics.hintWidth - replyMetrics.composerWidth) <= 1,
    replyMetrics);
  add('forum-detail.reply-hint.content-scroll-clearance',
    replyMetrics.contentScrollClearance >=
      replyMetrics.composerHeight + replyMetrics.composerBottom + replyMetrics.hintHeight + 14,
    replyMetrics);
  const composerBeforePreview = replyMetrics.composerHeight;

  await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.id = 'home-indicator-preview-size-probe';
    probe.style.height = '60px';
    document.getElementById('commentImagePreview').appendChild(probe);
  });
  await page.waitForFunction(() => {
    const bar = document.querySelector('.comment-bar');
    return bar.getBoundingClientRect().height > 90 &&
      document.getElementById('replyHint').getBoundingClientRect().bottom <= bar.getBoundingClientRect().top - 6;
  }, null, { timeout: 1500 }).catch(() => {});
  replyMetrics = await hintMetrics();
  add('forum-detail.reply-hint.stays-above-expanded-composer',
    replyMetrics.composerHeight > composerBeforePreview + 45 &&
    replyMetrics.hintBottom <= replyMetrics.composerTop - 6, replyMetrics);
  add('forum-detail.reply-hint.expanded-content-scroll-clearance',
    replyMetrics.contentScrollClearance >=
      replyMetrics.composerHeight + replyMetrics.composerBottom + replyMetrics.hintHeight + 14,
    replyMetrics);
  // Verify actual scrolled viewport clearance, not merely a CSS padding number.
  await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.id = 'home-indicator-last-content-probe';
    probe.style.height = '180px';
    document.body.appendChild(probe);
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await page.waitForTimeout(100);
  const lastContentClearance = await page.evaluate(() => ({
    lastContentBottom: document.getElementById('home-indicator-last-content-probe').getBoundingClientRect().bottom,
    replyHintTop: document.getElementById('replyHint').getBoundingClientRect().top,
    scrollY: window.scrollY
  }));
  add('forum-detail.reply-hint.scrolled-last-content-visible',
    lastContentClearance.scrollY > 0 &&
    lastContentClearance.lastContentBottom <= lastContentClearance.replyHintTop - 6,
    lastContentClearance);
  await page.evaluate(() => {
    document.getElementById('home-indicator-last-content-probe')?.remove();
  });

  await page.evaluate(() => {
    document.getElementById('home-indicator-preview-size-probe')?.remove();
    document.getElementById('replyHint').style.display = 'none';
  });

  // Deleting another comment above a selected reply target must shift the
  // target index rather than silently cancelling the user's reply context.
  // Use the live forum page functions and restore the seeded post afterward.
  const adjacentDelete = await page.evaluate(() => {
    const originalComments = post.comments.slice();
    try {
      post.comments = [
        { id: 'nav2-earlier-comment', name: '先前评论', owner: 'me', text: '先发', time: Date.now() },
        { id: 'nav2-selected-target', name: '正在回复的人', owner: 'me', text: '目标', time: Date.now() }
      ];
      if (!saveNow()) return { setupSaved: false };
      renderComments();
      replyTo(1);
      document.getElementById('commentInput').value = '待发送的回复草稿';
      deleteComment(0);
      const preceding = {
        index: replyToIdx,
        hintVisible: getComputedStyle(document.getElementById('replyHint')).display !== 'none',
        label: document.getElementById('replyTargetName').textContent,
        draft: document.getElementById('commentInput').value,
        remainingIds: post.comments.map((comment) => comment.id)
      };
      deleteComment(0);
      const target = {
        index: replyToIdx,
        hintHidden: getComputedStyle(document.getElementById('replyHint')).display === 'none',
        remaining: post.comments.length
      };
      return { setupSaved: true, preceding, target };
    } finally {
      post.comments = originalComments;
      saveNow();
      cancelReply();
      renderComments();
      renderPost();
    }
  });
  add('forum-detail.reply.kept-when-earlier-comment-deleted',
    adjacentDelete.setupSaved === true &&
    adjacentDelete.preceding?.index === 0 &&
    adjacentDelete.preceding?.hintVisible === true &&
    adjacentDelete.preceding?.label === '@正在回复的人' &&
    adjacentDelete.preceding?.draft === '待发送的回复草稿' &&
    adjacentDelete.preceding?.remainingIds.join(',') === 'nav2-selected-target',
    adjacentDelete);
  add('forum-detail.reply.cancelled-when-target-deleted',
    adjacentDelete.setupSaved === true &&
    adjacentDelete.target?.index === -1 &&
    adjacentDelete.target?.hintHidden === true &&
    adjacentDelete.target?.remaining === 0,
    adjacentDelete);

  // The visual 140px shell is aria-hidden and must not be a second keyboard
  // tab stop. Its separate 84px hit-target remains the accessible button.
  const homeA11y = await page.evaluate(() => {
    const shell = document.querySelector('button.maomao-global-home-indicator');
    const target = document.querySelector('.maomao-global-home-indicator-hit-target');
    return {
      shellHidden: shell?.getAttribute('aria-hidden'),
      shellTabIndex: shell?.tabIndex,
      targetLabel: target?.getAttribute('aria-label'),
      targetTabIndex: target?.tabIndex,
      targetHidden: target?.getAttribute('aria-hidden')
    };
  });
  add('forum-detail.home-line.decorative-shell-not-keyboard-focusable',
    homeA11y.shellHidden === 'true' && homeA11y.shellTabIndex === -1 &&
    !!homeA11y.targetLabel && homeA11y.targetTabIndex === 0 &&
    homeA11y.targetHidden !== 'true', homeA11y);

  add('forum-detail.home-line.visible-84x4',
    detailLineGeom.lineWidth === '84px' && detailLineGeom.lineHeight === '4px' &&
    Math.abs(detailLineGeom.lineRect.width - 84) <= 0.5 &&
    Math.abs(detailLineGeom.lineRect.height - 4) <= 0.5 &&
    detailLineGeom.shellPointerEvents === 'none', detailLineGeom);
  add('forum-detail.home-line.hit-target-present-and-aligned',
    detailLineGeom.hitExists && detailLineGeom.hitPointerEvents === 'auto' &&
    !!detailLineGeom.hitRect &&
    Math.abs(detailLineGeom.hitRect.width - 84) <= 0.5 &&
    Math.abs(detailLineGeom.hitRect.height - 4) <= 0.5 &&
    Math.abs(detailLineGeom.hitRect.left - detailLineGeom.lineRect.left) <= 0.5 &&
    Math.abs(detailLineGeom.hitRect.top - detailLineGeom.lineRect.top) <= 0.5,
    { hitExists: detailLineGeom.hitExists, hitRect: detailLineGeom.hitRect, lineRect: detailLineGeom.lineRect, hitPointerEvents: detailLineGeom.hitPointerEvents });
  add('forum-detail.home-line.reserved-below-comment-input',
    !!detailLineGeom.inputRect && detailLineGeom.inputToHitGap >= 6,
    { inputRect: detailLineGeom.inputRect, hitRect: detailLineGeom.hitRect, gap: detailLineGeom.inputToHitGap });
  add('forum-detail.home-line.center.hits-home-target',
    typeof detailLineGeom.lineTopElement === 'string' && detailLineGeom.lineTopElement.indexOf('button.maomao-global-home-indicator-hit-target') === 0,
    { lineTopElement: detailLineGeom.lineTopElement, lineCenter: detailLineGeom.lineCenter });

  // 命中可见线中心应返回桌面；随后重新进入详情页，继续验证评论功能。
  await page.mouse.click(detailLineGeom.lineCenter.x, detailLineGeom.lineCenter.y);
  await sleep(450);
  const lineTapPath = pathOf();
  add('forum-detail.home-line.center.clicking.returns-home', isIndex(), { afterPath: lineTapPath });

  await openPage(detailUrl, '#commentInput');
  const inputPoints = await page.evaluate(() => {
    const r = document.querySelector('#commentInput').getBoundingClientRect();
    const round = (v) => Math.round(v * 100) / 100;
    return {
      center: { x: round((r.left + r.right) / 2), y: round((r.top + r.bottom) / 2) },
      bottomCenter: { x: round((r.left + r.right) / 2), y: round(r.bottom - 1) },
      edges: {
        top: { x: round((r.left + r.right) / 2), y: round(r.top + 1) },
        bottom: { x: round(r.left + 20), y: round(r.bottom - 1) },
        left: { x: round(r.left + 1), y: round((r.top + r.bottom) / 2) },
        right: { x: round(r.right - 1), y: round((r.top + r.bottom) / 2) }
      }
    };
  });
  const detailPath = pathOf();
  const tapAndRead = async (point) => {
    await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
    await page.mouse.click(point.x, point.y);
    await sleep(160);
    return page.evaluate(() => ({
      path: location.pathname,
      activeId: document.activeElement ? (document.activeElement.id || document.activeElement.tagName.toLowerCase()) : null
    }));
  };
  const focusCheck = (name, result, point) => add(name,
    !!result && result.activeId === 'commentInput' && result.path === detailPath && !isIndex(),
    { path: result ? result.path : null, activeId: result ? result.activeId : null, point, expectedPath: detailPath });

  focusCheck('forum-detail.comment-input.center.clicking.focus', await tapAndRead(inputPoints.center), inputPoints.center);
  focusCheck('forum-detail.comment-input.bottom-center.clicking.focus', await tapAndRead(inputPoints.bottomCenter), inputPoints.bottomCenter);
  for (const edge of ['top', 'bottom', 'left', 'right']) {
    focusCheck(`forum-detail.comment-input.edge.${edge}.clicking.focus`, await tapAndRead(inputPoints.edges[edge]), inputPoints.edges[edge]);
  }

  const commentText = `home-indicator-002-${viewport.width}`;
  const centerRetap = await tapAndRead(inputPoints.center);
  let commentFocused = !!centerRetap && centerRetap.activeId === 'commentInput';
  if (commentFocused) await page.keyboard.type(commentText);
  await sleep(100);
  const typedValue = await page.evaluate(() => document.querySelector('#commentInput') ? document.querySelector('#commentInput').value : '');
  add('forum-detail.comment-input.type-and-submit.ready',
    commentFocused && typedValue.includes(commentText),
    { activeId: centerRetap ? centerRetap.activeId : null, typedValue, inputCenter: inputPoints.center });

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

  const hiddenPreferenceState = await page.evaluate(() => {
    localStorage.setItem('settings_home_indicator_visible', '0');
    window.dispatchEvent(new Event('maomao:home-indicator-change'));
    return {
      hitDisplay: getComputedStyle(document.querySelector('.maomao-global-home-indicator-hit-target')).display,
      composerBottom: getComputedStyle(document.querySelector('.comment-bar')).bottom
    };
  });
  add('forum-detail.hidden-home-indicator-restores-composer-bottom',
    hiddenPreferenceState.hitDisplay === 'none' && hiddenPreferenceState.composerBottom === '0px',
    hiddenPreferenceState);

  const restoredPreferenceState = await page.evaluate(() => {
    localStorage.removeItem('settings_home_indicator_visible');
    window.dispatchEvent(new Event('maomao:home-indicator-change'));
    return {
      hitDisplay: getComputedStyle(document.querySelector('.maomao-global-home-indicator-hit-target')).display,
      composerBottom: getComputedStyle(document.querySelector('.comment-bar')).bottom
    };
  });
  add('forum-detail.visible-home-indicator-reserves-composer-bottom',
    restoredPreferenceState.hitDisplay === 'block' && restoredPreferenceState.composerBottom === '24px',
    restoredPreferenceState);

  // The generic mobile-fit.css gives .comment-bar padding-bottom:... !important.
  // This forum-specific preference must still win, including on 375-430px phones.
  const paddingPreference = await page.evaluate(() => {
    const root = document.documentElement;
    const bar = document.querySelector('.comment-bar');
    const property = '--maomao-home-indicator-comment-padding-bottom';
    const previous = root.style.getPropertyValue(property);
    const priority = root.style.getPropertyPriority(property);
    try {
      root.style.setProperty(property, '19px');
      return {
        expected: '19px',
        computed: getComputedStyle(bar).paddingBottom,
        width: window.innerWidth
      };
    } finally {
      if (previous) root.style.setProperty(property, previous, priority);
      else root.style.removeProperty(property);
    }
  });
  add('forum-detail.mobile-fit-respects-home-indicator-composer-padding',
    paddingPreference.computed === paddingPreference.expected,
    paddingPreference);

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
