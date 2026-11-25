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
    await ctx.addInitScript(seed, { preset: 'imessage', history });
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
    await page.waitForFunction(() => document.querySelectorAll('#chat-messages .msg-row').length >= 8,
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

    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      width + 'px detail no horizontal overflow');

    // Role B opens independently, no cross-role bubble leak.
    await page.goto(origin + '/chat/chat/chat-detail.html?id=role-b', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#chat-messages .msg-row').length >= 8,
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
    await page.waitForFunction(() => document.querySelectorAll('#chat-messages .msg-row').length >= 8,
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
    await defCtx.addInitScript(seed, { preset: 'default', history });
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
    await wxPage.waitForFunction(() => document.querySelectorAll('#chat-messages .msg-row').length >= 8,
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
} finally {
  try { if (browser) await browser.close(); } catch {}
  vite.kill('SIGTERM');
  setTimeout(() => process.exit(count === 3 ? 0 : 1), 300);
}
console.log(count + ' imessage-polish scenarios passed');
