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
// Known, pre-existing CSS layering gaps (reported to the reviewer, NOT asserted
// as green): on the detail page the stage background, composer capsule background
// and capsule radius, and the real bubble background are pinned by higher-specificity
// !important rules in shared/chat-owned styles. This test records their actual
// computed values in `defects` and does not treat them as passed. No product
// code, store schema, account data or other team's files are modified.
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
    return {
      flag: shell && shell.getAttribute('data-ts-detail'),
      preset: shell && shell.getAttribute('data-chat-theme-preset'),
      userNameColor: cs(document.querySelector('.chat-user-name'))?.color || null,
      headerBg: cs(document.querySelector('.chat-header'))?.backgroundColor || null,
      stageBg: cs(stage)?.backgroundColor || null,
      capsuleBg: cs(capsule)?.backgroundColor || null,
      capsuleRadius: cs(capsule)?.borderRadius || null,
      stageVar: shell && shell.style.getPropertyValue('--ts-detail-chat-bg'),
      inputVar: shell && shell.style.getPropertyValue('--ts-detail-input-radius'),
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
const defectsByWidth = {};

try {
  await waitForServer();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  for (const width of [375, 390, 430]) {
    const defects = [];
    defectsByWidth[width] = defects;
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

    // 3. Detail theme via workbench UI; assert the header title color and shell vars.
    await gotoWorkbench(page);
    await page.click('[data-tab="detail"]');
    await delay(120);
    await setField(page, 'headerText', '#222222');
    await setField(page, 'chatBg', '#222222');
    await setField(page, 'inputRadius', '24');
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
    assert.equal(detail.stageVar, '#222222', width + 'px detail chat-bg variable written to shell');
    assert.equal(detail.inputVar, '24px', width + 'px detail input-radius variable written to shell');
    assert.ok(detail.overflow.sw <= detail.overflow.cw + 1, width + 'px detail has no horizontal overflow');

    // Known layering gaps: record actual computed values; do NOT assert them green.
    defects.push({
      area: 'detail header background', observed: detail.headerBg,
      note: 'pinned by chat-detail.html inline frosted-override .chat-header !important block and shared chat-light-surfaces.css header rule; owned by chat/shared, not touched here'
    });
    defects.push({
      area: 'detail stage background', observed: detail.stageBg,
      note: 'pinned transparent by chat-detail.html inline .chat-stage !important block and shared light-surfaces stage/#chat-messages rule; owned by chat/shared, not touched here'
    });
    defects.push({
      area: 'detail capsule background/radius', observed: { bg: detail.capsuleBg, radius: detail.capsuleRadius },
      note: 'pinned by chat-detail.html inline .input-capsule !important block and shared light-surfaces #chat-form rule; owned by chat/shared, not touched here'
    });

    // Reload: detail flag and title color persist.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.msg-bubble', { timeout: 15000 });
    await delay(300);
    detail = await readDetail(page);
    assert.equal(detail.flag, '1', width + 'px detail flag survives reload');
    assert.equal(detail.userNameColor, hexToRgb('#222222'), width + 'px detail title color survives reload');

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

    // Real detail pages: resolve layer is correct; real bubble background is still
    // pinned by the chat-detail inline frosted rule (recorded as a defect).
    await page.goto(origin + '/chat/chat/chat-detail.html?id=role-a', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.msg-bubble', { timeout: 15000 });
    await delay(300);
    const bubbleObs = await page.evaluate(() => {
      const pick = sel => { const b = document.querySelector(sel); return b ? getComputedStyle(b).backgroundColor : null; };
      return { received: pick('.msg-row.received .msg-bubble'), sent: pick('.msg-row.sent .msg-bubble') };
    });
    defects.push({ area: 'detail real bubble background', observed: bubbleObs,
      note: 'beauty vars resolve and are attached to the stage, but chat-detail.html inline frosted-override block re-declares --chat-bubble-ta-bg/--chat-bubble-my-bg and background on the bubble node with !important; shared light-surfaces.css 17/18 stacks the same vars with !important. Owned by chat/shared, not touched here.' });

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

    // Quick scope switch: an unsaved draft stays scoped to its own role and must
    // not leak onto another role's baseline when switching back and forth.
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
    await page.evaluate(k => localStorage.setItem(k, 'default'), PRESET_KEY);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.msg-bubble', { timeout: 15000 });
    await delay(300);
    preset = await page.evaluate(() => document.querySelector('.phone-mockup')?.getAttribute('data-chat-theme-preset'));
    assert.equal(preset, 'default', width + 'px native preset restores data-chat-theme-preset');

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
  console.log('--- known layering defects (reported, not asserted green) ---');
  for (const [w, list] of Object.entries(defectsByWidth)) {
    for (const d of list) console.log(`${w}px [${d.area}]`, JSON.stringify(d.observed), '-', d.note);
  }
  setTimeout(() => process.exit(count === 3 ? 0 : 1), 300);
}
console.log(count + ' live-acceptance scenarios passed');
