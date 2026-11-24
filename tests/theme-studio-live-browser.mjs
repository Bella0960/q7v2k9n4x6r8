// THEME-STUDIO-LIVE-008: real chat-page apply / rollback acceptance.
// Unlike the workbench-local tests, this drives the workbench UI to apply a
// list/detail/bubble configuration, then opens the real chat list and chat
// detail pages and asserts computed styles on genuine DOM elements.
//
// Scope:
//  - List theme: header, card background/radius, avatar radius, name/preview/time
//    colors on real `.chat-slim-card` elements; survives reload.
//  - Detail theme: header title color and shell CSS variables on the real detail
//    page; rolled-back after disable.
//  - Bubble: global vs per-role isolation through ChatBeauty.resolve; clearing a
//    role override falls back to the global value; other roles are untouched.
//  - Disable rollback: after disabling list/detail in the workbench, reopening the
//    real pages drops the opt-in flag and restores baseline computed styles.
//  - Isolation: an unapplied draft must not reach the chat store; a rejected
//    (quota) write must not fake success; quick scope switches do not cross leaks.
//  - Built-in native / WeChat preset bridge writes data-chat-theme-preset.
//  - Three viewports 375/390/430: no horizontal overflow, composer/dock stays
//    inside the viewport, no runtime errors.
//
// CASCADE-009: the four detail layering gaps (header background, stage background,
// capsule background/radius, real bubble background) are now asserted as strong
// computed-style checks on genuine DOM elements. Bubble assertions consume the
// resolved ChatBeauty global/role variables; clearing a role override falls back
// to the global value and other roles stay untouched. A same-shell disable (no
// reload) clears the owned inline --ts-detail-* variables and asset flag, then a
// re-enable restores them. Synthetic uploaded backgrounds resolve to decodable
// blob URLs; disabling the workbench keeps the underlying IDB asset. No store
// schema, account data or other team's files are modified.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 4197;
const origin = 'http://127.0.0.1:' + port;
const outDir = resolve(root, 'test-results');
mkdirSync(outDir, { recursive: true });
const STUDIO_KEY = 'maomao_theme_studio_v1';
const PRESET_KEY = 'maomao_chat_theme_preset';

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

// --- helpers -----------------------------------------------------------------

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

// Normalize rgb()/rgba() and color-mix computed `color(srgb r g b)` into [r,g,b].
function channels(str) {
  if (!str) return null;
  const cm = str.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (cm) return [Math.round(Number(cm[1]) * 255), Math.round(Number(cm[2]) * 255), Math.round(Number(cm[3]) * 255)];
  const rm = str.match(/rgba?\(([^)]+)\)/);
  if (rm) return rm[1].split(',').slice(0, 3).map(x => Math.round(Number(x)));
  return null;
}
function assertColor(actual, hex, msg) {
  assert.deepEqual(channels(actual), channels(hexToRgb(hex)), msg + ' -> ' + actual);
}

const studioState = page => page.evaluate(k => {
  const raw = localStorage.getItem(k);
  return raw ? JSON.parse(raw) : null;
}, STUDIO_KEY);

const beautyKeys = page => page.evaluate(() =>
  Object.keys(localStorage).filter(k => k.indexOf('beauty_chat') === 0 && k !== 'beauty_chat_migrated_v1'));

async function setField(page, key, value) {
  await page.evaluate(([k, v]) => {
    const el = document.getElementById('edit-' + k);
    if (!el) throw new Error('missing field edit-' + k);
    el.focus();
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }, [key, value]);
  await delay(80);
}

async function gotoWorkbench(page) {
  await page.goto(origin + '/theme-studio/theme-studio.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#previewSurface', { timeout: 15000 });
  await delay(200);
}

async function readList(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('.phone-mockup');
    const card = document.querySelector('.chat-slim-card[data-id="role-a"]');
    const cs = el => el ? getComputedStyle(el) : null;
    const q = s => card ? card.querySelector(s) : null;
    const dock = document.querySelector('.input-dock, .floating-nav');
    return {
      flag: shell && shell.getAttribute('data-ts-list'),
      cards: document.querySelectorAll('.chat-slim-card').length,
      headerBg: cs(document.querySelector('.chat-theme-header'))?.backgroundColor || null,
      cardBg: cs(card)?.backgroundColor || null,
      cardRadius: cs(card)?.borderRadius || null,
      avatarRadius: cs(q('.chat-avatar'))?.borderRadius || null,
      nameColor: cs(q('.chat-name'))?.color || null,
      previewColor: cs(q('.chat-last-msg'))?.color || null,
      timeColor: cs(q('.chat-time'))?.color || null,
      overflow: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth },
      dockRect: dock ? dock.getBoundingClientRect().toJSON() : null
    };
  });
}

async function readDetail(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('.phone-mockup');
    const cs = el => el ? getComputedStyle(el) : null;
    const stage = document.querySelector('.chat-stage');
    const capsule = document.querySelector('.input-capsule');
    const dock = document.querySelector('.input-dock');
    const ta = document.querySelector('.msg-row.received .msg-bubble');
    const my = document.querySelector('.msg-row.sent .msg-bubble');
    const ownedVars = {};
    if (shell) for (const name of shell.style) {
      if (name.indexOf('--ts-detail-') === 0) ownedVars[name] = shell.style.getPropertyValue(name);
    }
    return {
      flag: shell && shell.getAttribute('data-ts-detail'),
      beauty: shell && shell.getAttribute('data-ts-beauty'),
      preset: shell && shell.getAttribute('data-chat-theme-preset'),
      userNameColor: cs(document.querySelector('.chat-user-name'))?.color || null,
      headerBg: cs(document.querySelector('.chat-header'))?.backgroundColor || null,
      stageBg: cs(stage)?.backgroundColor || null,
      stageImage: cs(stage)?.backgroundImage || null,
      capsuleBg: cs(capsule)?.backgroundColor || null,
      capsuleRadius: cs(capsule)?.borderRadius || null,
      taBg: cs(ta)?.backgroundColor || null,
      myBg: cs(my)?.backgroundColor || null,
      taColor: cs(ta)?.color || null,
      myColor: cs(my)?.color || null,
      stageVar: shell && shell.style.getPropertyValue('--ts-detail-chat-bg'),
      inputVar: shell && shell.style.getPropertyValue('--ts-detail-input-radius'),
      ownedVars,
      imageFlag: shell && shell.getAttribute('data-ts-detail-image'),
      bubbles: document.querySelectorAll('.msg-bubble').length,
      overflow: { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth },
      dockRect: dock ? dock.getBoundingClientRect().toJSON() : null
    };
  });
}

const resolveBubble = (page, scope) => page.evaluate(s => {
  const v = window.ChatBeauty.resolve(s === 'global' ? null : s);
  return { myBubbleBg: v.myBubbleBg, partnerBubbleBg: v.partnerBubbleBg };
}, scope);

// --- run --------------------------------------------------------------------

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
    const context = await browser.newContext({
      viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2
    });

    // Block any non-local network; synthetic data only, no real account/API.
    await context.route('**', route => {
      const u = route.request().url();
      if (/127\.0\.0\.1|localhost|data:|blob:/.test(u)) return route.continue();
      return route.abort();
    });

    // Synthetic roles + history injected before every page load.
    await context.addInitScript(() => {
      localStorage.setItem('ai_custom_characters', JSON.stringify([
        { id: 'role-a', name: '角色 A' }, { id: 'role-b', name: '角色 B' }
      ]));
      const now = Date.now();
      for (const id of ['role-a', 'role-b']) {
        localStorage.setItem('chat_history_' + id, JSON.stringify([
          { role: 'received', text: id + ' 对方消息', time: now - 60000 },
          { role: 'sent', text: id + ' 我的消息', time: now - 30000 }
        ]));
      }
    });

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

    // 1. Apply the list theme through the workbench UI.
    await gotoWorkbench(page);
    await page.click('[data-tab="list"]');
    await delay(120);
    await setField(page, 'headerBg', '#111111');
    await setField(page, 'itemBg', '#eeeeee');
    await setField(page, 'itemRadius', '22');
    await setField(page, 'avatarRadius', '30');
    await setField(page, 'textColor', '#222222');
    await setField(page, 'previewColor', '#333333');
    await setField(page, 'timeColor', '#444444');
    await page.click('#applyButton');
    await delay(200);

    let state = await studioState(page);
    assert.ok(state && state.enabled.list === true, width + 'px list apply enables list in store');

    // 2. Open the real chat list and assert genuine DOM computed styles.
    await page.goto(origin + '/chat/chat/chat.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chat-slim-card', { timeout: 15000 });
    await delay(300);
    let list = await readList(page);
    assert.equal(list.flag, '1', width + 'px list shell carries data-ts-list');
    assert.equal(list.cards, 2, width + 'px both synthetic roles render cards');
    assert.equal(list.headerBg, hexToRgb('#111111'), width + 'px list header background applies');
    assert.equal(list.cardBg, hexToRgb('#eeeeee'), width + 'px card background applies');
    assert.equal(list.cardRadius, '22px', width + 'px card radius applies');
    assert.equal(list.avatarRadius, '30%', width + 'px avatar radius applies');
    assert.equal(list.nameColor, hexToRgb('#222222'), width + 'px name color applies');
    assert.equal(list.previewColor, hexToRgb('#333333'), width + 'px preview color applies');
    assert.equal(list.timeColor, hexToRgb('#444444'), width + 'px time color applies');
    assert.ok(list.overflow.sw <= list.overflow.cw + 1, width + 'px list has no horizontal overflow');

    // Reload: list theme persists.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chat-slim-card', { timeout: 15000 });
    await delay(300);
    list = await readList(page);
    assert.equal(list.flag, '1', width + 'px list flag survives reload');
    assert.equal(list.cardRadius, '22px', width + 'px card radius survives reload');
    assert.equal(list.headerBg, hexToRgb('#111111'), width + 'px header bg survives reload');

    // 3. Detail theme via workbench UI; assert header title/background, stage
    //    background and capsule background/radius on the real detail DOM.
    await gotoWorkbench(page);
    await page.click('[data-tab="detail"]');
    await delay(120);
    await setField(page, 'headerBg', '#5a5a5a');
    await setField(page, 'headerText', '#222222');
    await setField(page, 'chatBg', '#2b2b2b');
    await setField(page, 'composerBg', '#444444');
    await setField(page, 'inputBg', '#3a3a3a');
    await setField(page, 'inputRadius', '24');
    await setField(page, 'sendBg', '#111111');
    await page.click('#applyButton');
    await delay(200);
    state = await studioState(page);
    assert.ok(state && state.enabled.detail === true, width + 'px detail apply enables detail in store');

    await page.goto(origin + '/chat/chat/chat-detail.html?id=role-a', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.msg-bubble', { timeout: 15000 });
    await delay(300);
    let detail = await readDetail(page);
    assert.equal(detail.flag, '1', width + 'px detail shell carries data-ts-detail');
    assert.equal(detail.bubbles, 2, width + 'px detail renders both received/sent bubbles');
    assert.equal(detail.userNameColor, hexToRgb('#222222'), width + 'px detail header title color applies');
    assert.equal(detail.stageVar, '#2b2b2b', width + 'px detail chat-bg variable written to shell');
    assert.equal(detail.inputVar, '24px', width + 'px detail input-radius variable written to shell');
    // P1 cascade: header/stage/capsule backgrounds and capsule radius reach the
    // real elements, not just the preset flag or shell CSS variables.
    assert.equal(detail.headerBg, hexToRgb('#5a5a5a'), width + 'px detail header background applies');
    assert.equal(detail.stageBg, hexToRgb('#2b2b2b'), width + 'px detail stage background applies');
    assert.equal(detail.capsuleBg, hexToRgb('#3a3a3a'), width + 'px detail capsule background applies');
    assert.equal(detail.capsuleRadius, '24px', width + 'px detail capsule radius applies');
    assert.ok(detail.overflow.sw <= detail.overflow.cw + 1, width + 'px detail has no horizontal overflow');

    // Reload: detail flag, title color and backgrounds persist.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.msg-bubble', { timeout: 15000 });
    await delay(300);
    detail = await readDetail(page);
    assert.equal(detail.flag, '1', width + 'px detail flag survives reload');
    assert.equal(detail.userNameColor, hexToRgb('#222222'), width + 'px detail title color survives reload');
    assert.equal(detail.headerBg, hexToRgb('#5a5a5a'), width + 'px detail header bg survives reload');
    assert.equal(detail.stageBg, hexToRgb('#2b2b2b'), width + 'px detail stage bg survives reload');
    assert.equal(detail.capsuleBg, hexToRgb('#3a3a3a'), width + 'px detail capsule bg survives reload');
    assert.equal(detail.capsuleRadius, '24px', width + 'px detail capsule radius survives reload');

    // 3b. Synthetic chat background: stored as an asset id, resolves to a decodable
    //     blob URL on the real stage. Disabling the workbench releases the lease but
    //     does not delete the underlying IDB asset; unrelated history/beauty data stays.
    await gotoWorkbench(page);
    await page.click('[data-tab="detail"]');
    await delay(120);
    const imageData = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 16; c.height = 12;
      const x = c.getContext('2d'); x.fillStyle = '#6b6b6b'; x.fillRect(0, 0, 16, 12);
      return c.toDataURL('image/png');
    });
    const imageBuffer = Buffer.from(imageData.slice(imageData.indexOf(',') + 1), 'base64');
    await page.locator('#imageSlots .image-slot').first().locator('button').first().click();
    await page.locator('#imageFile').setInputFiles({ name: 'synthetic-bg.png', mimeType: 'image/png', buffer: imageBuffer });
    await page.waitForFunction(() => /^as_[A-Z2-7]{32}$/.test((window.MAOMAOThemeStudio._draftSnapshot().detail || {}).chatImage || ''), { timeout: 13000 });
    await page.click('#applyButton');
    await delay(200);
    state = await studioState(page);
    const bgAssetId = state.detail.chatImage;
    assert.match(bgAssetId, /^as_[A-Z2-7]{32}$/, width + 'px detail chat background stored as asset id');

    await page.goto(origin + '/chat/chat/chat-detail.html?id=role-a', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.msg-bubble', { timeout: 15000 });
    await delay(300);
    detail = await readDetail(page);
    assert.equal(detail.imageFlag, '1', width + 'px detail image flag set on real stage');
    const decoded = await page.evaluate(async () => {
      const bg = getComputedStyle(document.querySelector('.chat-stage')).backgroundImage;
      const m = bg.match(/url\("?(blob:[^")]+)"?\)/);
      if (!m) return { bg, ok: false };
      const r = await fetch(m[1]); const b = await r.blob();
      return { bg, ok: b.size > 0 && b.type.startsWith('image/'), size: b.size, type: b.type };
    });
    assert.ok(decoded.ok, width + 'px stage background blob decodes to a non-empty image: ' + decoded.bg);

    const historyBefore = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('chat_history_role-a') || '[]').map(m => [m.role, m.text]));
    const beautyBefore = await beautyKeys(page);
    await gotoWorkbench(page);
    await page.click('[data-tab="detail"]');
    await delay(120);
    await page.click('#disableButton');
    await delay(200);
    await page.goto(origin + '/chat/chat/chat-detail.html?id=role-a', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.msg-bubble', { timeout: 15000 });
    await delay(300);
    detail = await readDetail(page);
    assert.equal(detail.imageFlag, null, width + 'px detail image flag dropped after disable');
    const assetKept = await page.evaluate(id => window.MAOMAOThemeStudioAssets.resolve(id).then(a => !!(a && a.url)), bgAssetId);
    assert.equal(assetKept, true, width + 'px underlying background asset survives workbench disable');
    const historyAfter = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('chat_history_role-a') || '[]').map(m => [m.role, m.text]));
    assert.deepEqual(historyAfter, historyBefore, width + 'px chat history preserved through disable');
    assert.deepEqual(await beautyKeys(page), beautyBefore, width + 'px beauty store preserved through disable');

    // Re-enable detail so later preset/bubble assertions run against an applied shell.
    await gotoWorkbench(page);
    await page.click('[data-tab="detail"]');
    await delay(120);
    await page.click('#applyButton');
    await delay(200);

    // 4. Bubble: global apply, then per-role A override, isolation and fallback.
    await gotoWorkbench(page);
    await page.click('[data-tab="bubble"]');
    await delay(120);
    await page.selectOption('#bubbleScope', 'global');
    await delay(100);
    await setField(page, 'partnerBubbleBg', '#333333');
    await setField(page, 'myBubbleBg', '#222222');
    await page.click('#applyButton');
    await delay(200);

    let globalResA = await resolveBubble(page, 'role-a');
    let globalResB = await resolveBubble(page, 'role-b');
    assert.equal(globalResA.myBubbleBg, '#222222', width + 'px global my bubble reaches resolve A');
    assert.equal(globalResA.partnerBubbleBg, '#333333', width + 'px global partner bubble reaches resolve A');
    assert.equal(globalResB.myBubbleBg, '#222222', width + 'px global my bubble reaches resolve B');

    // Per-role A override.
    await page.selectOption('#bubbleScope', 'role-a');
    await delay(100);
    await setField(page, 'myBubbleBg', '#444444');
    await page.click('#applyButton');
    await delay(200);

    const roleResA = await resolveBubble(page, 'role-a');
    const roleResB = await resolveBubble(page, 'role-b');
    assert.equal(roleResA.myBubbleBg, '#444444', width + 'px role A my bubble override applies');
    assert.equal(roleResA.partnerBubbleBg, '#333333', width + 'px role A partner keeps global');
    assert.equal(roleResB.myBubbleBg, '#222222', width + 'px role B falls back to global my bubble');
    assert.deepEqual(await beautyKeys(page), ['beauty_chat_global_v1', 'beauty_chat_role-a'],
      width + 'px beauty store holds global + role-a only');

    // Real detail page: bubbles consume the resolved global/role Beauty variables.
    await page.goto(origin + '/chat/chat/chat-detail.html?id=role-a', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.msg-bubble', { timeout: 15000 });
    await delay(300);
    let dA = await readDetail(page);
    assert.equal(dA.beauty, '1', width + 'px beauty marker set for saved global/role customization');
    assertColor(dA.taBg, '#333333', width + 'px role-a received bubble uses global partner background');
    assertColor(dA.myBg, '#444444', width + 'px role-a sent bubble uses role-A override background');

    // Role B does not inherit role-A: it falls back to the global my-bubble value.
    await page.goto(origin + '/chat/chat/chat-detail.html?id=role-b', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.msg-bubble', { timeout: 15000 });
    await delay(300);
    const dB = await readDetail(page);
    assertColor(dB.taBg, '#333333', width + 'px role-b received bubble keeps global partner background');
    assertColor(dB.myBg, '#222222', width + 'px role-b sent bubble falls back to global, not role-A override');

    // Clear role A override: A falls back to global, B untouched.
    await gotoWorkbench(page);
    await page.click('[data-tab="bubble"]');
    await delay(120);
    await page.selectOption('#bubbleScope', 'role-a');
    await delay(100);
    await page.click('#disableButton');
    await delay(200);
    const clearedA = await resolveBubble(page, 'role-a');
    const clearedB = await resolveBubble(page, 'role-b');
    assert.equal(clearedA.myBubbleBg, '#222222', width + 'px cleared role A falls back to global');
    assert.equal(clearedB.myBubbleBg, '#222222', width + 'px cleared role A does not touch role B');

    // Reopen role A in the real page: its sent bubble returns to the global value.
    await page.goto(origin + '/chat/chat/chat-detail.html?id=role-a', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.msg-bubble', { timeout: 15000 });
    await delay(300);
    const dAcleared = await readDetail(page);
    assertColor(dAcleared.myBg, '#222222', width + 'px cleared role-a sent bubble restores global background');

    // Quick scope switch: an unsaved draft stays scoped to its own role and must
    // not leak onto another role's baseline when switching back and forth.
    await gotoWorkbench(page);
    await page.click('[data-tab="bubble"]');
    await delay(120);
    const readMyBubble = () => page.$eval('#edit-myBubbleBg', el => el.value);
    await page.selectOption('#bubbleScope', 'global');
    await delay(100);
    await setField(page, 'myBubbleBg', '#111111'); // draft, not applied
    await page.selectOption('#bubbleScope', 'role-a');
    await delay(120);
    assert.equal(await readMyBubble(), '#222222', width + 'px role-a draft baseline does not inherit global draft');
    await page.selectOption('#bubbleScope', 'global');
    await delay(120);
    assert.equal(await readMyBubble(), '#111111', width + 'px global draft survives switching back');
    // Discard this draft by reloading the workbench; store still holds the applied global value.
    await gotoWorkbench(page);
    const afterDiscard = await resolveBubble(page, 'role-a');
    assert.equal(afterDiscard.myBubbleBg, '#222222', width + 'px discarded draft does not reach beauty store');

    // 5. Unapplied draft must not reach the store.
    await gotoWorkbench(page);
    await page.click('[data-tab="detail"]');
    await delay(120);
    await setField(page, 'headerText', '#777777');
    // No apply: detail draft stays unsaved; stored enabled.detail stays as previously applied.
    state = await studioState(page);
    assert.equal(state.detail.headerText, '#222222', width + 'px unapplied detail draft does not overwrite stored value');

    // 6. Rejected (quota) write must not fake success or mutate the store.
    const beforeQuota = await studioState(page);
    await page.evaluate(() => {
      const original = localStorage.setItem.bind(localStorage);
      localStorage.setItem = function () { throw new Error('QuotaExceededError'); };
      localStorage.setItem._original = original;
    });
    await setField(page, 'headerText', '#888888');
    await page.click('#applyButton');
    await delay(120);
    const afterQuota = await studioState(page);
    assert.deepEqual(afterQuota, beforeQuota, width + 'px quota failure keeps store unchanged');
    await page.evaluate(() => { localStorage.setItem = localStorage.setItem._original; });

    // 7. Built-in native / WeChat preset bridge on a real detail page.
    await page.goto(origin + '/chat/chat/chat-detail.html?id=role-a', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.msg-bubble', { timeout: 15000 });
    await delay(300);
    await page.evaluate(k => localStorage.setItem(k, 'wechat'), PRESET_KEY);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.msg-bubble', { timeout: 15000 });
    await delay(300);
    let preset = await page.evaluate(() => document.querySelector('.phone-mockup')?.getAttribute('data-chat-theme-preset'));
    assert.equal(preset, 'wechat', width + 'px wechat preset writes data-chat-theme-preset');
    // Under the WeChat preset the detail overrides still reach the real elements.
    const dwx = await readDetail(page);
    assert.equal(dwx.headerBg, hexToRgb('#5a5a5a'), width + 'px wechat header background applies');
    assert.equal(dwx.stageBg, hexToRgb('#2b2b2b'), width + 'px wechat stage background applies');
    assert.equal(dwx.capsuleBg, hexToRgb('#3a3a3a'), width + 'px wechat capsule background applies');
    assert.equal(dwx.capsuleRadius, '24px', width + 'px wechat capsule radius applies');
    assertColor(dwx.taBg, '#333333', width + 'px wechat received bubble keeps global partner background');
    assertColor(dwx.myBg, '#222222', width + 'px wechat sent bubble keeps global my background');
    await page.evaluate(k => localStorage.setItem(k, 'default'), PRESET_KEY);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.msg-bubble', { timeout: 15000 });
    await delay(300);
    preset = await page.evaluate(() => document.querySelector('.phone-mockup')?.getAttribute('data-chat-theme-preset'));
    assert.equal(preset, 'default', width + 'px native preset restores data-chat-theme-preset');

    // 8a. Same-shell disable on the current detail document (no reload): the opt-in
    //     marker, every owned inline --ts-detail-* variable and the asset flag drop
    //     on the current node; computed values return to baseline. Re-enable in the
    //     same shell brings the variables back. The beauty marker is independent of
    //     the workbench switch and stays while a global customization remains saved.
    await page.goto(origin + '/chat/chat/chat-detail.html?id=role-a', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.msg-bubble', { timeout: 15000 });
    await delay(300);
    let appliedDetail = await readDetail(page);
    assert.equal(appliedDetail.flag, '1', width + 'px detail shell is applied before same-shell disable');
    assert.ok(Object.keys(appliedDetail.ownedVars).length > 0, width + 'px owned detail inline vars present before disable');

    await page.evaluate(k => {
      const s = JSON.parse(localStorage.getItem(k));
      s.enabled.detail = false;
      localStorage.setItem(k, JSON.stringify(s));
      window.dispatchEvent(new StorageEvent('storage', { key: k }));
    }, STUDIO_KEY);
    await delay(200);
    let rolledDetail = await readDetail(page);
    assert.equal(rolledDetail.flag, null, width + 'px same-shell detail flag removed');
    assert.deepEqual(rolledDetail.ownedVars, {}, width + 'px same-shell owned detail inline vars cleared');
    assert.equal(rolledDetail.imageFlag, null, width + 'px same-shell detail asset flag cleared');
    assert.equal(rolledDetail.headerBg, 'rgba(0, 0, 0, 0)', width + 'px same-shell header bg restored to baseline');
    assert.equal(rolledDetail.stageBg, 'rgba(0, 0, 0, 0)', width + 'px same-shell stage bg restored to baseline');
    assert.equal(rolledDetail.capsuleBg, 'rgba(0, 0, 0, 0)', width + 'px same-shell capsule bg restored to baseline');
    assert.equal(rolledDetail.capsuleRadius, '9999px', width + 'px same-shell capsule radius restored to baseline');
    assert.equal(rolledDetail.beauty, '1', width + 'px beauty marker retained while global customization remains');

    // Re-enable in the same shell: owned variables return on the current node.
    await page.evaluate(k => {
      const s = JSON.parse(localStorage.getItem(k));
      s.enabled.detail = true;
      localStorage.setItem(k, JSON.stringify(s));
      window.dispatchEvent(new StorageEvent('storage', { key: k }));
    }, STUDIO_KEY);
    await delay(200);
    const reAppliedDetail = await readDetail(page);
    assert.equal(reAppliedDetail.flag, '1', width + 'px same-shell detail flag re-applied');
    assert.ok(Object.keys(reAppliedDetail.ownedVars).length > 0, width + 'px owned detail vars return after re-enable');

    // 8. Disable rollback on the real pages: list/detail customizations off and the
    //    baseline computed values are restored on genuine DOM elements (not just storage).
    await gotoWorkbench(page);
    await page.click('[data-tab="list"]');
    await delay(120);
    await page.click('#disableButton');
    await delay(200);
    state = await studioState(page);
    assert.ok(state && state.enabled.list === false, width + 'px list disable clears enabled.list');

    await page.goto(origin + '/chat/chat/chat.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.chat-slim-card', { timeout: 15000 });
    await delay(300);
    list = await readList(page);
    assert.equal(list.flag, null, width + 'px list flag removed after disable');
    assert.equal(list.cardBg, 'rgba(0, 0, 0, 0)', width + 'px list card background restored after disable');
    assert.equal(list.cardRadius, '0px', width + 'px list card radius restored after disable');
    assert.equal(list.avatarRadius, '50%', width + 'px list avatar radius restored after disable');
    assert.equal(list.nameColor, 'rgb(17, 17, 17)', width + 'px list name color restored after disable');
    assert.equal(list.previewColor, 'rgb(153, 153, 153)', width + 'px list preview color restored after disable');
    assert.equal(list.timeColor, 'rgb(170, 170, 170)', width + 'px list time color restored after disable');

    await gotoWorkbench(page);
    await page.click('[data-tab="detail"]');
    await delay(120);
    await page.click('#disableButton');
    await delay(200);
    state = await studioState(page);
    assert.ok(state && state.enabled.detail === false, width + 'px detail disable clears enabled.detail');

    await page.goto(origin + '/chat/chat/chat-detail.html?id=role-a', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.msg-bubble', { timeout: 15000 });
    await delay(300);
    detail = await readDetail(page);
    assert.equal(detail.flag, null, width + 'px detail flag removed after disable');
    assert.equal(detail.stageVar, '', width + 'px detail chat-bg var cleared after disable');
    assert.equal(detail.inputVar, '', width + 'px detail input-radius var cleared after disable');
    assert.equal(detail.userNameColor, 'rgb(17, 17, 17)', width + 'px detail title color restored after disable');

    // 9. Composer/dock stays inside the viewport; collect runtime errors.
    detail = await readDetail(page);
    assert.ok(detail.dockRect, width + 'px detail composer dock exists');
    assert.ok(detail.dockRect.bottom <= 844 + 1, width + 'px composer dock does not overflow viewport bottom');
    assert.ok(detail.dockRect.top >= 0, width + 'px composer dock does not overflow viewport top');
    assert.deepEqual(pageErrors, [], width + 'px detail page should not throw runtime errors');

    await page.screenshot({ path: resolve(outDir, `theme-studio-live-${width}.png`) });
    count++;
    console.log('PASS live chat apply/rollback @ ' + width + 'px');
    await context.close();
  }
} finally {
  try { if (browser) await browser.close(); } catch {}
  vite.kill('SIGTERM');
  setTimeout(() => process.exit(count === 3 ? 0 : 1), 300);
}
console.log(count + ' live-acceptance scenarios passed');
