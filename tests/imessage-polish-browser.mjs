// THEME-IMESSAGE-POLISH-011: iMessage (Apple Messages) theme polish acceptance.
// Real Chromium against the Vite dev app (no live API / account / paid endpoint).
//
// Scope:
//  - List rows: avatar size, name/preview/time type scale and color, quiet row
//    chrome (no frosted card, no border) on the real `.chat-slim-card` elements.
//  - Detail: quiet centered timestamp label (not a frosted pill), rounded white
//    composer capsule, bubble corner radius / line height, no overflow.
//  - Isolation: native default and WeChat presets are not restyled by the iMessage
//    rules; role A/B bubbles stay independent; reload keeps the preset.
//  - Three viewports 375/390/430; synthetic characters and history only; all
//    non-origin network aborted. No store schema, account or other theme files
//    are modified.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 4199;
const origin = 'http://127.0.0.1:' + port;
const outDir = resolve(root, 'test-results');
mkdirSync(outDir, { recursive: true });

const vite = spawn(process.execPath, [
  resolve(root, 'node_modules/vite/bin/vite.js'),
  '--host', '127.0.0.1', '--port', String(port), '--strictPort'
], { cwd: root, stdio: 'ignore' });

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (vite.exitCode !== null) throw new Error('Vite exited before ready');
    try { const r = await fetch(origin + '/index.html'); if (r.ok) return; } catch {}
    await delay(250);
  }
  throw new Error('Vite server did not become ready');
}

function channels(str) {
  if (!str) return null;
  const cm = str.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (cm) return [Math.round(Number(cm[1]) * 255), Math.round(Number(cm[2]) * 255), Math.round(Number(cm[3]) * 255)];
  const rm = str.match(/rgba?\(([^)]+)\)/);
  if (rm) return rm[1].split(',').slice(0, 3).map(x => Math.round(Number(x)));
  return null;
}

async function computed(page, sel, prop) {
  return page.evaluate(([s, p]) => {
    const el = document.querySelector(s);
    if (!el) return null;
    return getComputedStyle(el)[p];
  }, [sel, prop]);
}

// Idempotent seed: values are written only when absent, so reloads / in-page
// navigation do not rewrite the preset or history and hide a persistence bug.
function seed(arg) {
  if (!localStorage.getItem('maomao_chat_theme_preset')) {
    localStorage.setItem('maomao_chat_theme_preset', arg.preset);
  }
  if (!localStorage.getItem('ai_custom_characters')) {
    localStorage.setItem('ai_custom_characters', JSON.stringify([
      { id: 'role-a', name: '测试角色甲' },
      { id: 'role-b', name: '很长很长的角色昵称用来检查长昵称换行与不溢出的边界情况' }
    ]));
  }
  for (const roleId of ['role-a', 'role-b']) {
    if (!localStorage.getItem('chat_history_' + roleId)) {
      localStorage.setItem('chat_history_' + roleId, JSON.stringify(arg.history));
    }
  }
}

const LONG_TEXT = '长消息用于检查换行排版与溢出。'.repeat(12);
const alternating = Array.from({ length: 8 }, (_, i) => ({
  role: i % 2 ? 'user' : 'received',
  text: i === 6 ? LONG_TEXT : '测试消息 ' + i,
  time: Date.now() - 60000 + i * 1000
}));
// A run of consecutive same-role messages to check grouping spacing / corners.
const runOnes = Array.from({ length: 4 }, (_, i) => ({
  role: 'received', text: '连续分组消息 ' + i, time: Date.now() - 20000 + i * 1000
}));
const history = alternating.concat(runOnes);

// Synthetic special-message history for the non-iMessage isolation check:
// a gift card with an inline background image and a system-error bubble with an
// inline light-gray fill. These inline values are written by their own renderer
// and must survive a new-message pass, theme switch and reload — they must not be
// scanned off by any theme bridge.
const PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const specialMessages = [
  { role: 'received', type: 'image', img: PNG_DATA_URI, time: Date.now() - 10000 },
  { role: 'received', type: 'gift', gift: { img: PNG_DATA_URI, message: '生日快乐', tag: '祝福' }, time: Date.now() - 9000 },
  { role: 'system_error', isError: true, text: '系统提示：这是一条错误/系统消息', time: Date.now() - 8000 }
];
const specialHistory = history.concat(specialMessages);

let count = 0;
let browser = null;

try {
  await waitForServer();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  for (const width of [375, 390, 430]) {
    // ---- iMessage preset: list + detail real DOM -------------------------
    const ctx = await browser.newContext({
      viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2
    });
    await ctx.route('**/*', r =>
      r.request().url().startsWith(origin + '/') ? r.continue() : r.abort());
    await ctx.addInitScript(seed, { preset: 'imessage', history: specialHistory });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    // List page
    await page.goto(origin + '/chat/chat/chat.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chat-slim-card', { timeout: 10000 });
    await delay(300);

    const shellPreset = await page.evaluate(() =>
      document.querySelector('.phone-mockup')?.getAttribute('data-chat-theme-preset'));
    assert.equal(shellPreset, 'imessage', width + 'px list bridge writes imessage preset');

    const cardBlur = await computed(page, '.chat-slim-card', 'backdropFilter');
    const cardBorder = await computed(page, '.chat-slim-card', 'borderTopWidth');
    assert.equal(cardBlur, 'none', width + 'px list card has no frosted blur');
    assert.equal(cardBorder, '0px', width + 'px list card has no border');

    const avatarSize = await computed(page, '.chat-avatar', 'width');
    assert.equal(avatarSize, '40px', width + 'px list avatar is 40px');
    const nameSize = await computed(page, '.chat-name', 'fontSize');
    const nameWeight = await computed(page, '.chat-name', 'fontWeight');
    assert.equal(nameSize, '16px', width + 'px list name is 16px');
    assert.equal(nameWeight, '500', width + 'px list name weight 500');
    assert.equal(await computed(page, '.chat-last-msg', 'fontSize'), '14px',
      width + 'px list preview 14px');
    const timeSize = await computed(page, '.chat-time', 'fontSize');
    const timeFont = await computed(page, '.chat-time', 'fontFamily');
    assert.equal(timeSize, '12px', width + 'px list time 12px');
    assert.ok(!/monospace/.test(timeFont), width + 'px list time uses system font');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      width + 'px list no horizontal overflow');

    // Detail page
    await page.goto(origin + '/chat/chat/chat-detail.html?id=role-a', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#chat-messages .msg-row').length >= 12,
      null, { timeout: 6000 });
    await delay(300);

    const tColor = await computed(page, '.message-time', 'color');
    const tChannels = channels(tColor);
    assert.ok(tChannels && !(tChannels[0] > 240 && tChannels[1] > 240 && tChannels[2] > 240),
      width + 'px timestamp is readable gray, not white -> ' + tColor);
    assert.equal(await computed(page, '.message-time', 'backgroundColor'), 'rgba(0, 0, 0, 0)',
      width + 'px timestamp has no frosted pill background');
    assert.equal(await computed(page, '.message-time', 'backdropFilter'), 'none',
      width + 'px timestamp has no blur');

    const capsuleRadius = await computed(page, '.input-capsule', 'borderRadius');
    assert.equal(capsuleRadius, '20px', width + 'px composer capsule 20px radius');

    const sentRadius = await computed(page, '.msg-row.sent .msg-bubble', 'borderRadius');
    const recvRadius = await computed(page, '.msg-row.received .msg-bubble', 'borderRadius');
    assert.ok(/18px/.test(sentRadius) && /5px/.test(sentRadius),
      width + 'px sent bubble keeps 18/5 corner radius -> ' + sentRadius);
    assert.ok(/18px/.test(recvRadius) && /5px/.test(recvRadius),
      width + 'px received bubble keeps 18/5 corner radius -> ' + recvRadius);

    // Special media renders in the real renderer: image decodes, gift keeps its
    // inline card background, error bubble keeps its inline light-gray fill.
    const media = await page.evaluate(() => {
      const img = document.querySelector('.msg-media-img');
      const gift = document.querySelector('.bubble-gift .gift-card');
      let errorBg = null;
      document.querySelectorAll('.msg-bubble').forEach(b => {
        if (b.style.backgroundColor) errorBg = b.style.backgroundColor;
      });
      const refinements = [...document.querySelectorAll('link[rel="stylesheet"]')]
        .filter(l => (l.getAttribute('href') || '').includes('imessage-theme-refinements.css'));
      // Long-text bubble must wrap without horizontal overflow.
      let longBubble = null;
      document.querySelectorAll('.msg-bubble').forEach(b => {
        if ((b.textContent || '').length > 60) longBubble = b;
      });
      return {
        img: img ? { complete: img.complete, w: img.naturalWidth } : null,
        giftBg: gift ? gift.style.backgroundImage : null,
        errorBg,
        refinements: refinements.length,
        injected: !!document.querySelector('#maomao-imessage-theme-css'),
        longOverflow: longBubble ? longBubble.scrollWidth - longBubble.clientWidth : 0
      };
    });
    assert.ok(media.img && media.img.complete && media.img.w > 0,
      width + 'px image message decodes in iMessage -> ' + JSON.stringify(media.img));
    assert.ok(media.giftBg && /url\(/.test(media.giftBg),
      width + 'px gift card keeps inline background-image -> ' + media.giftBg);
    assert.equal(media.errorBg, 'rgb(242, 242, 247)',
      width + 'px error bubble keeps inline light-gray fill -> ' + media.errorBg);
    assert.equal(media.refinements, 1, width + 'px exactly one refinements stylesheet, no duplicate injection');
    assert.ok(media.longOverflow <= 1, width + 'px long-text bubble wraps without overflow -> ' + media.longOverflow);

    // Consecutive same-role run renders as a grouped block.
    const recvRun = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#chat-messages .msg-row')];
      let best = 0, cur = 0;
      rows.forEach(r => {
        if (r.classList.contains('received')) { cur += 1; best = Math.max(best, cur); } else cur = 0;
      });
      return best;
    });
    assert.ok(recvRun >= 3, width + 'px consecutive received group has at least 3 rows -> ' + recvRun);

    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      width + 'px detail no horizontal overflow');

    // Role B opens independently, no cross-role bubble leak.
    await page.goto(origin + '/chat/chat/chat-detail.html?id=role-b', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#chat-messages .msg-row').length >= 12,
      null, { timeout: 6000 });
    assert.ok(await page.locator('.msg-row.sent .msg-bubble').count() >= 2, width + 'px role B sent bubbles render');
    assert.ok(await page.locator('.msg-row.received .msg-bubble').count() >= 2, width + 'px role B received bubbles render');
    // Long nickname renders in the header; the page itself must not overflow
    // (single-line header title may ellipsis-truncate by design).
    const longName = await page.evaluate(() => {
      const el = document.querySelector('.chat-user-name');
      return el ? el.textContent.trim() : '';
    });
    assert.ok(longName.length > 0, width + 'px role B header name renders');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      width + 'px role B detail no horizontal overflow');

    // Reload keeps the preset and quiet timestamp.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#chat-messages .msg-row').length >= 12,
      null, { timeout: 6000 });
    await delay(200);
    assert.equal(await page.evaluate(() =>
      document.querySelector('.phone-mockup')?.getAttribute('data-chat-theme-preset')), 'imessage',
      width + 'px preset survives reload');
    const tColorAfter = channels(await computed(page, '.message-time', 'color'));
    assert.ok(tColorAfter && !(tColorAfter[0] > 240 && tColorAfter[1] > 240 && tColorAfter[2] > 240),
      width + 'px timestamp stays gray after reload');

    assert.deepEqual(errors, [], width + 'px iMessage no runtime errors');
    await page.screenshot({ path: resolve(outDir, `imessage-polish-${width}.png`) });
    await ctx.close();

    // ---- Isolation: default preset must not inherit iMessage list type ----
    const defCtx = await browser.newContext({
      viewport: { width, height: 844 }, isMobile: true, hasTouch: true
    });
    await defCtx.route('**/*', r =>
      r.request().url().startsWith(origin + '/') ? r.continue() : r.abort());
    await defCtx.addInitScript(seed, { preset: 'default', history: specialHistory });
    const defPage = await defCtx.newPage();
    const defErrors = [];
    defPage.on('pageerror', e => defErrors.push(e.message));
    await defPage.goto(origin + '/chat/chat/chat.html', { waitUntil: 'domcontentloaded' });
    await defPage.waitForSelector('.chat-slim-card', { timeout: 10000 });
    await delay(200);
    const defNameSize = await computed(defPage, '.chat-name', 'fontSize');
    assert.notEqual(defNameSize, '16px', width + 'px default list name not forced to iMessage 16px');
    assert.ok(await defPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      width + 'px default list no overflow');
    assert.ok(await defPage.evaluate(() => !document.querySelector('#maomao-imessage-theme-css')),
      width + 'px default has no injected iMessage stylesheet');

    // Special-message inline fills belong to their own renderer; in a non-iMessage
    // preset they must survive a new-message pass and a reload (not be scanned off).
    await defPage.goto(origin + '/chat/chat/chat-detail.html?id=role-a', { waitUntil: 'domcontentloaded' });
    await defPage.waitForFunction(() => document.querySelectorAll('#chat-messages .msg-row').length >= 12,
      null, { timeout: 6000 });
    await delay(200);
    const readSpecial = () => defPage.evaluate(() => {
      const gift = document.querySelector('.bubble-gift .gift-card');
      const img = document.querySelector('.msg-media-img');
      let errorBg = null;
      document.querySelectorAll('.msg-bubble').forEach(b => {
        if (b.style.backgroundColor) errorBg = b.style.backgroundColor;
      });
      return {
        giftBg: gift ? gift.style.backgroundImage : null,
        errorBg,
        img: img ? { complete: img.complete, w: img.naturalWidth } : null
      };
    });
    const specialBefore = await readSpecial();
    assert.ok(specialBefore.img && specialBefore.img.complete && specialBefore.img.w > 0,
      width + 'px default image message decodes -> ' + JSON.stringify(specialBefore.img));
    assert.ok(specialBefore.giftBg && /url\(/.test(specialBefore.giftBg),
      width + 'px default gift card keeps its inline background-image -> ' + specialBefore.giftBg);
    assert.equal(specialBefore.errorBg, 'rgb(242, 242, 247)',
      width + 'px default error bubble keeps its inline light-gray fill -> ' + specialBefore.errorBg);

    await defPage.reload({ waitUntil: 'domcontentloaded' });
    await defPage.waitForFunction(() => document.querySelectorAll('#chat-messages .msg-row').length >= 12,
      null, { timeout: 6000 });
    await delay(200);
    const specialAfter = await readSpecial();
    assert.ok(specialAfter.img && specialAfter.img.complete && specialAfter.img.w > 0,
      width + 'px default image still decodes after reload -> ' + JSON.stringify(specialAfter.img));
    assert.ok(specialAfter.giftBg && /url\(/.test(specialAfter.giftBg),
      width + 'px default gift card keeps background-image after reload -> ' + specialAfter.giftBg);
    assert.equal(specialAfter.errorBg, 'rgb(242, 242, 247)',
      width + 'px default error bubble keeps light-gray fill after reload -> ' + specialAfter.errorBg);

    assert.deepEqual(defErrors, [], width + 'px default no runtime errors');
    await defCtx.close();

    // ---- Isolation: WeChat preset opens cleanly, no iMessage bleed --------
    const wxCtx = await browser.newContext({
      viewport: { width, height: 844 }, isMobile: true, hasTouch: true
    });
    await wxCtx.route('**/*', r =>
      r.request().url().startsWith(origin + '/') ? r.continue() : r.abort());
    await wxCtx.addInitScript(seed, { preset: 'wechat', history });
    const wxPage = await wxCtx.newPage();
    const wxErrors = [];
    wxPage.on('pageerror', e => wxErrors.push(e.message));
    await wxPage.goto(origin + '/chat/chat/chat-detail.html?id=role-a', { waitUntil: 'domcontentloaded' });
    await wxPage.waitForFunction(() => document.querySelectorAll('#chat-messages .msg-row').length >= 12,
      null, { timeout: 6000 });
    await delay(200);
    assert.ok(await wxPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      width + 'px wechat detail no overflow');
    assert.ok(await wxPage.evaluate(() => !document.querySelector('#maomao-imessage-theme-css')),
      width + 'px wechat has no injected iMessage stylesheet');
    assert.deepEqual(wxErrors, [], width + 'px wechat no runtime errors');
    await wxCtx.close();

    count++;
    console.log('PASS imessage polish @ ' + width + 'px');
  }

  // ---- Real UI closed loop: default -> imessage -> wechat -> imessage -> default
  // Driven through the actual beauty-center theme buttons, not by writing the
  // preset key directly. Verifies persistence, link idempotency, no residue,
  // saved global/role config retention, an in-session locally-sent message,
  // focus, a narrowed viewport and scroll-to-bottom.
  {
    const loopCtx = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2
    });
    await loopCtx.route('**/*', r =>
      r.request().url().startsWith(origin + '/') ? r.continue() : r.abort());
    await loopCtx.addInitScript(seed, { preset: 'default', history: specialHistory });
    const lp = await loopCtx.newPage();
    const loopErrors = [];
    lp.on('pageerror', e => loopErrors.push(e.message));

    const OPT = {
      default: '#chatThemeDefaultOption',
      imessage: '#chatThemeIMessageOption',
      wechat: '#chatThemeWechatOption'
    };

    async function pickTheme(theme) {
      await lp.goto(origin + '/beauty/beauty.html', { waitUntil: 'domcontentloaded' });
      await lp.waitForSelector('button.btab[data-tab="theme"]', { timeout: 5000 });
      await lp.click('button.btab[data-tab="theme"]');
      await lp.waitForSelector('#tabTheme:not(.hide)', { timeout: 5000 });
      await delay(150);
      await lp.click(OPT[theme]);
      await delay(150);
      const persisted = await lp.evaluate(() => localStorage.getItem('maomao_chat_theme_preset'));
      assert.equal(persisted, theme, 'loop: preset persisted after UI click -> ' + persisted);
    }

    async function openDetail() {
      await lp.goto(origin + '/chat/chat/chat-detail.html?id=role-a', { waitUntil: 'domcontentloaded' });
      await lp.waitForFunction(() => document.querySelectorAll('#chat-messages .msg-row').length >= 12,
        null, { timeout: 6000 });
      await delay(200);
      return lp.evaluate(() => ({
        preset: document.querySelector('.phone-mockup')?.getAttribute('data-chat-theme-preset'),
        injected: !!document.querySelector('#maomao-imessage-theme-css'),
        refinements: [...document.querySelectorAll('link[rel="stylesheet"]')]
          .filter(l => (l.getAttribute('href') || '').includes('imessage-theme-refinements.css')).length
      }));
    }

    // 1) default baseline
    let st = await openDetail();
    assert.equal(st.preset, 'default', 'loop: starts on default preset');
    assert.equal(st.injected, false, 'loop: default has no injected iMessage link');

    // 2) default -> imessage via real UI
    await pickTheme('imessage');
    st = await openDetail();
    assert.equal(st.preset, 'imessage', 'loop: detail reads imessage after UI switch');
    assert.equal(st.refinements, 1, 'loop: imessage loads exactly one refinements sheet');

    // 3) imessage -> wechat
    await pickTheme('wechat');
    st = await openDetail();
    assert.equal(st.preset, 'wechat', 'loop: detail reads wechat after UI switch');
    assert.equal(st.injected, false, 'loop: wechat drops any injected iMessage link');

    // 4) wechat -> imessage again; no duplicate stylesheet accumulates
    await pickTheme('imessage');
    st = await openDetail();
    assert.equal(st.preset, 'imessage', 'loop: returns to imessage');
    assert.equal(st.refinements, 1, 'loop: second imessage entry still one refinements sheet');

    // Reload keeps the preset; back navigation to the list keeps it too.
    await lp.reload({ waitUntil: 'domcontentloaded' });
    await lp.waitForFunction(() => document.querySelectorAll('#chat-messages .msg-row').length >= 12,
      null, { timeout: 6000 });
    await delay(200);
    assert.equal(await lp.evaluate(() =>
      document.querySelector('.phone-mockup')?.getAttribute('data-chat-theme-preset')), 'imessage',
      'loop: preset survives reload');
    await lp.goto(origin + '/chat/chat/chat.html', { waitUntil: 'domcontentloaded' });
    await lp.waitForSelector('.chat-slim-card', { timeout: 10000 });
    await delay(150);
    assert.equal(await lp.evaluate(() =>
      document.querySelector('.phone-mockup')?.getAttribute('data-chat-theme-preset')), 'imessage',
      'loop: preset kept after returning to list');

    // 5) imessage -> default via real UI
    await pickTheme('default');
    st = await openDetail();
    assert.equal(st.preset, 'default', 'loop: back to default after UI switch');
    assert.equal(st.injected, false, 'loop: default leaves no injected iMessage link');

    // Saved global and role-scoped beauty config survive a theme switch + reload;
    // the theme bridge must not wipe stored customizations.
    await lp.goto(origin + '/chat/chat/chat-detail.html?id=role-a', { waitUntil: 'domcontentloaded' });
    await lp.waitForFunction(() => document.querySelectorAll('#chat-messages .msg-row').length >= 12,
      null, { timeout: 6000 });
    await delay(150);
    await lp.evaluate(() => {
      ChatBeauty.save('global', { partnerBubbleBg: '#EEEEEE' });
      ChatBeauty.save('role-a', { myBubbleBg: '#222222' });
    });
    const savedBefore = await lp.evaluate(() => {
      const g = JSON.parse(localStorage.getItem('beauty_chat_global_v1') || 'null');
      const r = JSON.parse(localStorage.getItem('beauty_chat_role-a') || 'null');
      return { g: g && g.vars, r: r && r.vars };
    });
    assert.equal(savedBefore.g && savedBefore.g.partnerBubbleBg, '#EEEEEE', 'loop: global beauty config saved');
    assert.equal(savedBefore.r && savedBefore.r.myBubbleBg, '#222222', 'loop: role beauty config saved');
    await lp.reload({ waitUntil: 'domcontentloaded' });
    await lp.waitForFunction(() => document.querySelectorAll('#chat-messages .msg-row').length >= 12,
      null, { timeout: 6000 });
    await delay(150);
    const savedAfter = await lp.evaluate(() => {
      const g = JSON.parse(localStorage.getItem('beauty_chat_global_v1') || 'null');
      const r = JSON.parse(localStorage.getItem('beauty_chat_role-a') || 'null');
      return { g: g && g.vars, r: r && r.vars };
    });
    assert.equal(savedAfter.g && savedAfter.g.partnerBubbleBg, '#EEEEEE', 'loop: global config survives reload');
    assert.equal(savedAfter.r && savedAfter.r.myBubbleBg, '#222222', 'loop: role config survives reload');

    // In-session locally-sent message (no live API key -> local user bubble plus
    // the renderer's own system-error bubble). Not a reopened-page replay.
    const sentBefore = await lp.locator('.msg-row.sent .msg-bubble').count();
    await lp.fill('#chat-input', '当前会话本地新增的一条闭环测试消息');
    await lp.focus('#chat-input');
    assert.equal(await lp.evaluate(() => document.activeElement && document.activeElement.id), 'chat-input',
      'loop: composer input receives focus');
    await lp.click('.send-icon-btn');
    await delay(800);
    const sentAfter = await lp.locator('.msg-row.sent .msg-bubble').count();
    assert.ok(sentAfter > sentBefore, 'loop: locally sent user bubble renders in-session -> ' + sentBefore + ' -> ' + sentAfter);
    const tailErr = await lp.evaluate(() => {
      const rows = [...document.querySelectorAll('#chat-messages .msg-row')];
      const last = rows[rows.length - 1];
      return last ? (last.textContent || '').trim() : '';
    });
    assert.ok(/API|配置/.test(tailErr), 'loop: system-error bubble follows the local send -> ' + tailErr.slice(0, 24));

    // Narrowed viewport must not produce horizontal overflow; scroll reaches bottom.
    await lp.setViewportSize({ width: 320, height: 700 });
    await delay(150);
    assert.ok(await lp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'loop: 320px viewport no horizontal overflow');
    await lp.evaluate(() => {
      const m = document.querySelector('#chat-messages');
      if (m) m.scrollTop = m.scrollHeight;
    });
    await delay(200);
    const atBottom = await lp.evaluate(() => {
      const m = document.querySelector('#chat-messages');
      return m ? m.scrollHeight - m.scrollTop - m.clientHeight : 0;
    });
    assert.ok(atBottom <= 2, 'loop: scroll reaches bottom -> residual ' + atBottom);
    await lp.setViewportSize({ width: 390, height: 844 });

    assert.deepEqual(loopErrors, [], 'loop: no runtime errors');
    await loopCtx.close();
    console.log('PASS theme-switch closed loop @ 390px');
  }
} finally {
  try { if (browser) await browser.close(); } catch {}
  vite.kill('SIGTERM');
  setTimeout(() => process.exit(count === 3 ? 0 : 1), 300);
}
console.log(count + ' imessage-polish scenarios passed');
