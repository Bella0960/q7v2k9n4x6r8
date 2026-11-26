/* THEME-PREVIEW-005 · 真实场景预览专项回归。
 * 裸 http server（跨平台路径校验），headless Chromium，视口 320/375/390/430。
 * 预览始终为虚构示例；打开 / 滑动 / 关闭不得写入 ChatBeauty、localStorage 或 IndexedDB。
 * 入口优先走商城真实按钮（discover 五场景入口、主题卡片封面）；直接调用 open() 仅在末尾 API 级用例使用。 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const server = createServer((req, res) => {
  try {
    const p = resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]));
    if (!p.toLowerCase().startsWith(root.toLowerCase())) throw Error();
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp' })[extname(p)] || 'application/octet-stream');
    res.end(readFileSync(p));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const browser = await pw.chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });

const SCENES = ['聊天首页', '聊天详情', '动态', '我的', '我的主页'];
let count = 0;

async function ptrTrack(ctx, page, locator, points, endType = 'up') {
  const box = await locator.boundingBox();
  assert.ok(box && box.width > 0, 'visual box measurable');
  const x = box.x + box.width * .5, y = box.y + box.height * .5;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'left' });
  let last = [0, 0];
  for (const [dx, dy] of points) { last = [dx, dy]; await page.mouse.move(x + dx, y + dy, { steps: 1 }); }
  if (endType === 'cancel') {
    await locator.dispatchEvent('pointercancel', { pointerId: 1, button: 0, buttons: 0, clientX: x + last[0], clientY: y + last[1] });
  } else {
    await page.mouse.up({ button: 'left' });
  }
}
const swipe = (ctx, page, locator, dx, dy) => ptrTrack(ctx, page, locator, [[dx, dy]], 'up');
const tapHold = async (ctx, page, locator) => {
  const b = await locator.boundingBox();
  await page.mouse.move(b.x + b.width * .5, b.y + b.height * .5);
  await page.mouse.down({ button: 'left' });
  await page.mouse.up({ button: 'left' });
};

const activeTab = page => page.locator('[data-rp-scene][aria-pressed="true"], [data-rp-scene].active').innerText();
const state = page => page.evaluate(() => window.MAOMAORealScenePreview._state());

async function installIdbCounter(page) {
  await page.evaluate(() => {
    if (!window.__idbOpenCount) {
      window.__idbOpenCount = 0;
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = function (...args) { window.__idbOpenCount++; return open(...args); };
    }
  });
}

try {
  for (const width of [320, 375, 390, 430]) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: width < 500 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(base + '/theme-store/theme-store.html');
    await page.waitForSelector('.sf-product', { timeout: 8000 });

    // 真实入口：discover 五场景按钮 → atmosphere 新预览。
    const entry = page.locator('[data-action="market-preview"]');
    await entry.waitFor({ state: 'visible' });
    assert.equal(await entry.count(), 1, 'real five-scene entry rendered once');
    await installIdbCounter(page);

    const rememberedTop = await page.locator('#storeContent').evaluate(el => el.scrollTop);
    // 收藏是用户主动业务操作，会写入收藏集合；只读隔离比对时剔除该键，其余存储不得被预览改动。
    const snapshotStorage = () => page.evaluate(() => { const s = { ...localStorage }; delete s['maomao_market_collection_v1']; return JSON.stringify(s); });
    const storageBefore = await snapshotStorage();
    const themeBefore = await page.evaluate(() => window.ChatBeauty && ChatBeauty.getThemePreset && ChatBeauty.getThemePreset());
    const idbBefore = await page.evaluate(() => window.__idbOpenCount);

    await entry.click();
    await page.waitForSelector('.rp-overlay', { timeout: 5000 });
    assert.equal((await state(page)).open, true, 'overlay open state');
    assert.equal(await page.locator('[data-rp-scene]').count(), 5, 'five scene tabs');
    assert.ok(await page.locator('.rp-phone-mockup').count() === 1, 'single active preview shell');

    // 按钮翻页：从详情页起点在五场景间顺序循环。
    const START = 1; // detail
    assert.equal(await activeTab(page), SCENES[START], 'starts on detail scene');
    for (let k = 1; k <= 4; k++) {
      await page.locator('[data-rp-next]').click();
      assert.equal(await activeTab(page), SCENES[(START + k) % 5], 'next reaches scene ' + k);
    }
    await page.locator('[data-rp-next]').click();
    assert.equal(await activeTab(page), SCENES[START], 'next wraps back to detail scene');
    await page.locator('[data-rp-prev]').click();
    assert.equal(await activeTab(page), SCENES[0], 'prev from detail reaches first scene');

    // 手势：左滑一页、右滑回一页；纵向不误触；短点按不误触。
    const visual = page.locator('.rp-visual');
    await swipe(ctx, page, visual, -120, 0);
    assert.equal(await activeTab(page), SCENES[1], 'left swipe moves one scene forward');
    await swipe(ctx, page, visual, 120, 0);
    assert.equal(await activeTab(page), SCENES[0], 'right swipe moves one scene back');
    const beforeVertical = await activeTab(page);
    await swipe(ctx, page, visual, 0, 90);
    assert.equal(await activeTab(page), beforeVertical, 'vertical swipe does not turn scene');
    await tapHold(ctx, page, visual);
    assert.equal(await activeTab(page), beforeVertical, 'short tap does not turn scene');

    // 取消手势 / 回拉 / 反向 settle。
    await ptrTrack(ctx, page, visual, [[-70, 0]], 'cancel');
    assert.equal(await activeTab(page), SCENES[0], 'cancelled gesture does not turn scene');
    await swipe(ctx, page, visual, -120, 0);
    assert.equal(await activeTab(page), SCENES[1], 'next swipe still works after cancel');
    await ptrTrack(ctx, page, visual, [[-70, 0], [0, 0]], 'up');
    assert.equal(await activeTab(page), SCENES[1], 'pull-back to start does not turn scene');
    await ptrTrack(ctx, page, visual, [[70, 0], [-70, 0]], 'up');
    assert.equal(await activeTab(page), SCENES[2], 'reverse settle follows final position');

    // 键盘：方向键翻页；Tab / Shift+Tab 焦点循环。
    await page.locator('[data-rp-scene]').first().click();
    await page.keyboard.press('ArrowRight');
    assert.equal(await activeTab(page), SCENES[1], 'arrow right works');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await activeTab(page), SCENES[0], 'arrow left works');

    const all = await page.locator('.rp-overlay button').all();
    const visible = [];
    for (const b of all) { if (await b.boundingBox()) visible.push(b); }
    const last = visible[visible.length - 1];
    await last.focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '关闭预览', 'Tab wraps from last to backdrop');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), '应用这个主题', 'Shift+Tab wraps from backdrop to apply');

    // Esc 关闭：清理 overlay / 滚动锁 / 焦点，滚动位置与存储保持。
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.rp-overlay').count(), 0, 'overlay removed on Esc');
    assert.equal(await page.evaluate(() => document.body.style.overflow), '', 'body scroll lock released');
    assert.equal((await state(page)).open, false, 'closed state reported');
    assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.isConnected), 'focus returns to a live element after close');
    assert.ok(Math.abs(await page.locator('#storeContent').evaluate(el => el.scrollTop) - rememberedTop) < 5, 'main scroll offset preserved after close');

    // 第二次打开：遮罩点击关闭。
    await entry.click();
    await page.waitForSelector('.rp-overlay');
    await page.locator('.rp-backdrop').evaluate(b => b.click());
    assert.equal(await page.locator('.rp-overlay').count(), 0, 'backdrop click closes overlay');
    assert.equal(await page.evaluate(() => document.body.style.overflow), '', 'scroll lock released after backdrop close');

    // 收藏同步：预览内星标与商城卡片星标一致，关闭后状态保持。
    const cardFav = () => page.locator('.sf-theme-item[data-theme-id="atmosphere"] [data-sf="favorite"]');
    await entry.click();
    await page.waitForSelector('.rp-overlay');
    const favBtn = page.locator('[data-rp-favorite]');
    const beforeFav = await favBtn.getAttribute('aria-pressed');
    assert.equal(await cardFav().getAttribute('aria-pressed'), beforeFav, 'preview favorite matches card before toggle');
    await favBtn.click();
    const afterFav = await favBtn.getAttribute('aria-pressed');
    assert.notEqual(afterFav, beforeFav, 'preview favorite toggles on click');
    assert.match(await favBtn.innerText(), afterFav === 'true' ? /已收藏/ : /^收藏$/);
    await page.keyboard.press('Escape');
    assert.equal(await cardFav().getAttribute('aria-pressed'), afterFav, 'card favorite synced after close');
    await entry.click();
    await page.waitForSelector('.rp-overlay');
    assert.equal(await page.locator('[data-rp-favorite]').getAttribute('aria-pressed'), afterFav, 'favorite persists on reopen');
    await page.locator('[data-rp-favorite]').click();
    assert.equal(await page.locator('[data-rp-favorite]').getAttribute('aria-pressed'), beforeFav, 'favorite toggles back on second click');
    await page.keyboard.press('Escape');
    assert.equal(await cardFav().getAttribute('aria-pressed'), beforeFav, 'card favorite restored after unfavorite');
    const favList = await page.evaluate(() => MAOMAOMarketCollection.read().favorites);
    assert.equal(favList.includes('atmosphere'), beforeFav === 'true', 'favorite persisted to collection store matches final state');

    // 50 次开关：不残留 overlay / 滚动锁 / 状态。
    for (let round = 0; round < 50; round++) {
      await entry.click();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.rp-overlay').count(), 0, 'round ' + round + ' overlay removed');
      assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden', 'round ' + round + ' no scroll lock left');
      const st = await state(page);
      assert.equal(st.open, false, 'round ' + round + ' closed state');
      assert.equal(st.gestureActive, false, 'round ' + round + ' gesture cleared');
    }

    // 50 次后手势仍生效。
    await entry.click();
    await swipe(ctx, page, visual, -120, 0);
    assert.equal(await activeTab(page), SCENES[2], 'gesture still works after 50 open/close cycles');
    await page.keyboard.press('Escape');

    // 只读隔离（剔除收藏集合键：收藏是主动业务写，单独核对其落库一致性）。
    assert.equal(await snapshotStorage(), storageBefore, 'preview writes no localStorage besides the favorite collection');
    assert.equal(await page.evaluate(() => window.ChatBeauty && ChatBeauty.getThemePreset && ChatBeauty.getThemePreset()), themeBefore, 'preview does not change applied theme');
    assert.equal(await page.evaluate(() => window.__idbOpenCount), idbBefore, 'preview opens no new IndexedDB database');

    // 无横向溢出。
    await entry.click();
    await page.waitForSelector('.rp-overlay');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'no horizontal overflow at width ' + width);
    await page.keyboard.press('Escape');

    assert.deepEqual(errors, [], 'no page errors');
    count++;
    console.log('PASS real-scene-preview width ' + width + ': entry click, swipe thresholds, lifecycle cleanup, focus loop, read-only, no overflow');
    await ctx.close();
  }

  // API 级 sanity（非页面入口路径）。
  const apiCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const apiPage = await apiCtx.newPage();
  await apiPage.goto(base + '/theme-store/theme-store.html');
  await apiPage.waitForSelector('.sf-product');
  await apiPage.evaluate(() => window.MAOMAORealScenePreview.open('wechat', 'detail'));
  await apiPage.waitForSelector('.rp-overlay');
  assert.equal((await apiPage.evaluate(() => window.MAOMAORealScenePreview._state())).open, true, 'direct API preview opens');
  await apiPage.keyboard.press('Escape');
  assert.equal(await apiPage.locator('.rp-overlay').count(), 0, 'direct API preview closes');
  assert.equal((await apiPage.evaluate(() => window.MAOMAORealScenePreview._state())).gestureActive, false, 'direct API preview clears gesture');
  await apiCtx.close();
  console.log('PASS direct API entry sanity: open() opens and cleans up');

  // 30 组合矩阵：六主题 × 五场景。API 级打开，断言真实结构、主题属性、场景样式表加载与未覆盖回退。
  const MATRIX_THEMES = ['default', 'imessage', 'qq', 'silver-butterfly', 'wechat', 'atmosphere'];
  const MATRIX_SCENES = ['list', 'detail', 'moments', 'mine', 'home'];
  const AT_SURFACE = { list: 'chats', detail: 'detail', moments: 'moments', mine: 'profile' };
  const STRUCTURE = {
    list: ['main-stage', 'cover-gradient-banner', 'white-profile-stage', 'arch-avatar-bridge', 'user-id-text', 'tier4-floating-stream'],
    detail: ['chat-header', 'chat-stage', 'msg-row received', 'msg-row sent', 'msg-bubble', 'input-dock'],
    moments: ['space-stage', 'wechat-moments-toolbar', 'cover-block', 'wechat-cover-name', 'moments-main-panel'],
    mine: ['profile-content', 'info-row', 'profile-edit-btn', 'profile-cover', 'menu-card'],
    home: ['page-wallpaper', 'wallpaper-veil', 'cover-nav-btn', 'space-stage', 'profile-hero', 'stats-row', 'feed']
  };
  const SCENE_CSS_MARKER = {
    list: ['chat-light-surfaces.css', 'atmosphere-pages.css'],
    detail: ['chat-beauty-runtime.css', 'chat-light-surfaces.css'],
    moments: ['atmosphere-pages.css'],
    mine: ['profile-chat-themes.css'],
    home: ['atmosphere-my-home.css']
  };
  // 场景组内必须被浏览器真实解析、规则非空的样式表（probe.ruleCounts 字段名）。
  const RULE_CHECK = {
    list: ['atmospherePages'],
    detail: ['runtime', 'atmospherePages'],
    moments: ['atmospherePages'],
    mine: ['profile', 'atmospherePages'],
    home: ['home']
  };

  function covered(theme, scene) {
    if (scene === 'home') return theme === 'atmosphere';
    if (theme === 'imessage') return scene === 'detail';
    return true;
  }

  function expectedEffective(theme, scene) {
    return covered(theme, scene) ? theme : 'default';
  }

  const matrixCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const mp = await matrixCtx.newPage();
  const matrixErrors = [];
  mp.on('pageerror', e => matrixErrors.push(e.message));
  await mp.goto(base + '/theme-store/theme-store.html');
  await mp.waitForSelector('.sf-product');

  for (const theme of MATRIX_THEMES) {
    for (const scene of MATRIX_SCENES) {
      await mp.evaluate(([t, s]) => window.MAOMAORealScenePreview.open(t, s), [theme, scene]);
      await mp.waitForLoadState('networkidle');
      const probe = await mp.evaluate(() => {
        const shell = document.querySelector('.rp-phone-mockup');
        const stage = shell.querySelector('.chat-stage');
        const note = document.querySelector('.rp-scope-note');
        const links = [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.getAttribute('href') || '');
        const has = cls => !!shell.querySelector('.' + cls.split(' ').join('.'));
        const sentBubble = shell.querySelector('.msg-row.sent .msg-bubble, .msg-row.right .msg-bubble');
        const sheets = [...document.styleSheets];
        const ruleCount = marker => { const sh = sheets.find(x => x.href && x.href.includes(marker)); if (!sh) return -1; try { return sh.cssRules.length; } catch (e) { return -2; } };
        const homeRules = ruleCount('atmosphere-my-home.css');
        return {
          preset: shell.getAttribute('data-chat-theme-preset'),
          stagePreset: stage ? stage.getAttribute('data-chat-theme-preset') : null,
          surface: shell.getAttribute('data-at-surface'),
          homeSurface: shell.getAttribute('data-at-home-surface'),
          unsupported: note.classList.contains('rp-scope-unsupported'),
          noteText: note.textContent.trim(),
          links,
          ruleCounts: { runtime: ruleCount('chat-beauty-runtime.css'), profile: ruleCount('profile-chat-themes.css'), atmospherePages: ruleCount('atmosphere-pages.css'), home: homeRules },
          computed: {
            shellBg: getComputedStyle(shell).backgroundColor,
            sentBg: sentBubble ? getComputedStyle(sentBubble).backgroundColor : null
          },
          structure: {
            'main-stage': has('main-stage'),
            'cover-gradient-banner': has('cover-gradient-banner'),
            'white-profile-stage': has('white-profile-stage'),
            'arch-avatar-bridge': has('arch-avatar-bridge'),
            'user-id-text': has('user-id-text'),
            'tier4-floating-stream': has('tier4-floating-stream'),
            'chat-stage': has('chat-stage'),
            'chat-header': has('chat-header'),
            'msg-row received': has('msg-row received'),
            'msg-row sent': has('msg-row sent'),
            'msg-bubble': has('msg-bubble'),
            'input-dock': has('input-dock'),
            'space-stage': has('space-stage'),
            'wechat-moments-toolbar': has('wechat-moments-toolbar'),
            'cover-block': has('cover-block'),
            'wechat-cover-name': has('wechat-cover-name'),
            'moments-main-panel': has('moments-main-panel'),
            'profile-content': has('profile-content'),
            'info-row': has('info-row'),
            'profile-edit-btn': has('profile-edit-btn'),
            'profile-cover': has('profile-cover'),
            'menu-card': has('menu-card'),
            'page-wallpaper': has('page-wallpaper'),
            'wallpaper-veil': has('wallpaper-veil'),
            'cover-nav-btn': has('cover-nav-btn'),
            'profile-hero': has('profile-hero'),
            'stats-row': has('stats-row'),
            'feed': has('feed')
          }
        };
      });

      const effective = expectedEffective(theme, scene);
      const inScope = covered(theme, scene);
      const label = theme + '/' + scene;

      // 壳层 preset 落有效主题；未覆盖组合诚实回退 default。
      assert.equal(probe.preset, effective, label + ' shell preset falls back correctly');
      assert.equal(probe.unsupported, !inScope, label + ' unsupported note matches scope');
      if (!inScope) assert.match(probe.noteText, /不受此主题修改/, label + ' fallback note wording');

      // 真实结构：当前场景的关键骨架节点必须存在。
      for (const cls of STRUCTURE[scene]) {
        assert.ok(probe.structure[cls], label + ' missing real structure .' + cls);
      }

      // 详情舞台同步同一 preset，命中运行时舞台级气泡选择器。
      if (scene === 'detail') {
        assert.equal(probe.stagePreset, probe.preset, label + ' chat-stage mirrors shell preset');
      }

      // atmosphere 等价 surface 属性：仅 atmosphere 设置；其余主题显式清除，无残留。
      if (effective === 'atmosphere' && scene !== 'home') {
        assert.equal(probe.surface, AT_SURFACE[scene], label + ' atmosphere data-at-surface');
        assert.equal(probe.homeSurface, null, label + ' no home-surface on non-home');
      } else if (effective === 'atmosphere' && scene === 'home') {
        assert.equal(probe.homeSurface, 'personal-home', label + ' atmosphere home surface');
        assert.equal(probe.surface, null, label + ' no page-surface on home');
      } else {
        assert.equal(probe.surface, null, label + ' non-atmosphere clears data-at-surface');
        assert.equal(probe.homeSurface, null, label + ' non-atmosphere clears home-surface');
      }

      // 场景级生产样式表已注入（映射命中证据）。
      for (const marker of SCENE_CSS_MARKER[scene]) {
        assert.ok(probe.links.some(h => h.includes(marker)), label + ' loads ' + marker);
      }

      // 场景组样式表已被浏览器真实解析、规则非空（不是空挂 link）。
      for (const field of RULE_CHECK[scene]) {
        assert.ok(probe.ruleCounts[field] > 0, label + ' parsed scene stylesheet rules (' + field + '=' + probe.ruleCounts[field] + ')');
      }

      // 关键计算样式命中（headless 下经两轮探测稳定的差异化落点；其余主题视觉留真机复核）。
      if (theme === 'imessage' && scene === 'detail') {
        assert.equal(probe.computed.shellBg, 'rgb(242, 242, 247)', label + ' imessage detail shell background');
        assert.notEqual(probe.computed.sentBg, 'rgb(255, 255, 255)', label + ' imessage detail sent bubble tinted');
      }
      if (theme === 'qq' && scene === 'detail') {
        assert.equal(probe.computed.sentBg, 'rgb(176, 176, 176)', label + ' qq detail sent bubble gray');
      }
      if (theme === 'atmosphere' && scene === 'home') {
        assert.notEqual(probe.computed.shellBg, 'rgb(255, 255, 255)', label + ' atmosphere home shell tinted');
      }

      await mp.evaluate(() => window.MAOMAORealScenePreview.close());
      assert.equal(await mp.locator('.rp-overlay').count(), 0, label + ' overlay closed');
    }
  }

  assert.deepEqual(matrixErrors, [], 'matrix run has no page errors');
  await matrixCtx.close();
  console.log('PASS 30-combination matrix: structure, theme attributes, scene CSS mapping, fallback cleanup');
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
console.log(count + ' real-scene-preview scenarios passed');
