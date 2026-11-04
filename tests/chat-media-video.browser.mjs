/**
 * CHAT-002 浏览器验收：聊天视频 / 实况照片附件（本机 Edge）
 *
 * 运行：node tests/chat-media-video.browser.mjs
 * 依赖：playwright（channel: msedge）。所有外部 API 一律 route mock，不产生真实付费请求。
 * 页面：/chat/chat/chat-detail.html?id=<roleId>，真实 localStorage + IndexedDB（maomao-assets）。
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.MAOMAO_ROOT || path.resolve(__dirname, '..');
const ASSETS = path.join(__dirname, 'assets');
const VIDEO_MP4 = path.join(ASSETS, 'tiny.mp4');
const PNG_A = path.join(ASSETS, 'tiny.png');
const PNG_B = path.join(ASSETS, 'tiny-2.png');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.woff2': 'font/woff2'
};

if (!existsSync(VIDEO_MP4) || statSync(VIDEO_MP4).size < 1024) {
    throw new Error('缺少真实测试视频 tests/assets/tiny.mp4');
}

function startServer() {
    const srv = createServer(async (req, res) => {
        try {
            const u = new URL(req.url, 'http://127.0.0.1');
            let p = decodeURIComponent(u.pathname);
            if (p === '/') p = '/index.html';
            const file = path.join(ROOT, p);
            if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
            const buf = await readFile(file);
            res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
            res.end(buf);
        } catch (e) {
            res.writeHead(404); res.end('not found');
        }
    });
    return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

const results = [];
function ok(name, pass, detail) {
    results.push({ name, status: pass ? 'PASS' : 'FAIL', detail: detail || '' });
    if (!pass) console.error('FAIL  ' + name + (detail ? '  — ' + detail : ''));
}
function skip(name, detail) {
    results.push({ name, status: 'SKIP', detail: detail || '' });
}
function assert(name, cond, detail) { ok(name, !!cond, detail); }

const ROLES = [
    { id: 'role-media-a', name: '测试角色 A', avatar: '', persona: '克制、简短。', source: 'custom' },
    { id: 'role-media-b', name: '测试角色 B', avatar: '', persona: '克制、简短。', source: 'custom' }
];

async function newPage(server, roleId, opts) {
    const ctx = await (opts && opts.ctx ? opts.ctx : browser.newContext({ viewport: { width: 375, height: 740 } }));
    await ctx.addInitScript((payload) => {
        try {
            localStorage.setItem('ai_custom_characters', JSON.stringify(payload.roles));
            localStorage.setItem('api_settings', JSON.stringify({
                apiKey: 'test-key', baseUrl: 'https://api.test.invalid/v1', model: 'test-model', temperature: 0.8
            }));
        } catch (e) {}
    }, { roles: ROLES });

    const page = await ctx.newPage();
    // 所有 API 请求一律 mock，绝不触发真实付费调用
    await page.route('**/chat/completions', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'mock', choices: [{ index: 0, message: { role: 'assistant', content: '嗯。' }, finish_reason: 'stop' }] })
    }));
    await page.goto(`${server.base}/chat/chat/chat-detail.html?id=${roleId}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.ChatMedia && typeof window.loadMessages === 'function' && document.getElementById('chat-messages'));
    // 媒体发送成功会触发一次“系统动作”AI 请求；测试里替换掉，保持确定性（路由仍已 mock）
    await page.evaluate(() => { try { window.sendMsg = function () { return Promise.resolve(); }; } catch (e) {} });
    page._ownCtx = !(opts && opts.ctx);
    page._ctx = ctx;
    return page;
}

async function openPicker(page) {
    await page.evaluate(() => {
        const overlay = document.querySelector('.plus-panel-overlay');
        if (overlay) overlay.classList.add('active');
    });
    const chooserPromise = page.waitForEvent('filechooser');
    await page.click('[data-feat="img"]');
    return chooserPromise;
}

async function pickFiles(page, files) {
    const chooser = await openPicker(page);
    await chooser.setFiles(files);
}

function readMessages(page, roleId) {
    return page.evaluate((id) => {
        let list = [];
        try { list = JSON.parse(localStorage.getItem('chat_history_' + id) || '[]'); } catch (e) {}
        return list;
    }, roleId);
}

function rawHistory(page, roleId) {
    return page.evaluate((id) => localStorage.getItem('chat_history_' + id) || '', roleId);
}

async function waitMessages(page, roleId, count, timeout = 12000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        const list = await readMessages(page, roleId);
        if (list.length >= count) return list;
        await page.waitForTimeout(120);
    }
    return readMessages(page, roleId);
}

async function sendConfirm(page) {
    await page.waitForSelector('.cm-overlay', { state: 'visible' });
    await page.click('.cm-btn.primary');
    await page.waitForSelector('.cm-overlay', { state: 'hidden' });
}

// 用真实鼠标坐标点击视频播放按钮：浏览器自己做命中测试，
// 避免 Playwright 命中判定在某些层叠/圆角按钮上的误报。
async function clickPlay(page) {
    const pt = await page.locator('.msg-video .mv-play').last().evaluate((el) => {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    });
    await page.mouse.click(pt.x, pt.y);
    return pt;
}

async function waitExist(page, assetId, expect, timeout = 5000) {
    const end = Date.now() + timeout;
    let last = null;
    while (Date.now() < end) {
        last = await page.evaluate((id) => window.__exists(id), assetId);
        if (last === expect) return last;
        await page.waitForTimeout(120);
    }
    return last;
}

let browser;
let server;

async function main() {
    server = await startServer();
    const base = `http://127.0.0.1:${server.address().port}`;
    server.base = base;
    browser = await chromium.launch({ channel: 'msedge', headless: true });

    try {
        await scenarioCore(base);
        await scenarioRefCount(base);
        await scenarioIsolation(base);
        await scenarioFailures(base);
        await scenarioLivePhoto(base);
        await scenarioMov(base);
    } catch (err) {
        ok('执行异常', false, String(err && err.stack || err));
    } finally {
        try { await browser.close(); } catch (e) {}
        try { server.close(); } catch (e) {}
    }

    const pass = results.filter((r) => r.status === 'PASS').length;
    const fail = results.filter((r) => r.status === 'FAIL').length;
    const skipped = results.filter((r) => r.status === 'SKIP').length;
    console.log('\n---- CHAT-002 browser results ----');
    for (const r of results) console.log(`${r.status}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
    console.log(`\nPASS ${pass}  FAIL ${fail}  SKIP ${skipped}  TOTAL ${results.length}`);
    if (fail > 0) process.exitCode = 1;
}

/* ---------------- 场景一：入口 / 图片回归 / 视频气泡 / 两种格式 / 刷新 ---------------- */
async function scenarioCore(base) {
    const page = await newPage(server, 'role-media-a');
    const RID = 'role-media-a';

    // 1. 入口 accept / multiple（同一个图片入口，没有新增工具栏按钮）
    const chooser = await openPicker(page);
    const inputInfo = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('input[type=file]'));
        const el = all[all.length - 1];
        return el ? { accept: el.accept, multiple: el.multiple } : null;
    });
    await chooser.setFiles([]);
    assert('入口 accept 覆盖 MP4/MOV', inputInfo && /video\/mp4/.test(inputInfo.accept) && /video\/quicktime/.test(inputInfo.accept), JSON.stringify(inputInfo));
    assert('入口支持多选', inputInfo && inputInfo.multiple === true, JSON.stringify(inputInfo));

    // 2. 原图片发送回归（纯图片不应出现预览弹层）
    const beforeImage = (await readMessages(page, RID)).length;
    await pickFiles(page, [PNG_A]);
    let list = await waitMessages(page, RID, beforeImage + 1);
    const imgMsg = list[list.length - 1];
    assert('原图片发送仍正常', list.length === beforeImage + 1 && imgMsg.type === 'image' && /^data:image\//.test(imgMsg.img || ''), `messages=${list.length} before=${beforeImage}`);
    assert('纯图片不弹预览层', (await page.locator('.cm-overlay').count()) === 0, '');
    const imgBubble = page.locator('.msg-row.sent .bubble-media img').last();
    assert('图片气泡渲染', (await imgBubble.count()) > 0, '');

    // 3. 混合选择：图片 + 视频 + 图片，按选择顺序入列
    await pickFiles(page, [PNG_A, VIDEO_MP4, PNG_B]);
    await page.waitForSelector('.cm-overlay', { state: 'visible' });
    assert('混合选择进入预览', (await page.locator('.cm-row').count()) === 3, 'rows=' + await page.locator('.cm-row').count());
    const isVideoRow = await page.locator('.cm-row').nth(1).locator('.cm-sub').textContent();
    assert('视频行含时长', /00:0\d/.test(isVideoRow || ''), String(isVideoRow));
    await sendConfirm(page);
    list = await waitMessages(page, RID, beforeImage + 4);
    const batch = list.slice(-3);
    assert('混合按选择顺序建消息', batch.length === 3 && batch[0].type === 'image' && batch[1].type === 'video' && batch[2].type === 'image', batch.map((m) => m.type).join(','));
    assert('MP4 可发送', batch[1].type === 'video' && !!batch[1].assetId, JSON.stringify({ assetId: batch[1].assetId, mime: batch[1].mime }));

    // 4. 视频气泡：真实首帧缩略图 + 时长 + 细线播放按钮
    const videoBubble = page.locator('.msg-video').last();
    await page.waitForSelector('.msg-video .mv-poster', { timeout: 5000 });
    const poster = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('.msg-video .mv-poster'));
        const img = imgs[imgs.length - 1];
        return img ? { complete: img.complete, w: img.naturalWidth, h: img.naturalHeight } : null;
    });
    assert('缩略图是真实首帧', poster && poster.w > 0 && poster.h > 0, JSON.stringify(poster));
    const durText = await page.locator('.msg-video .mv-dur').last().textContent();
    assert('视频气泡显示时长 mm:ss', durText === '00:01', String(durText));
    const hasSvg = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('.mv-play')).pop();
        return b ? { hasSvg: !!b.querySelector('svg'), text: b.textContent.trim() } : null;
    });
    assert('播放按钮为 SVG 细线且无 emoji', hasSvg && hasSvg.hasSvg && hasSvg.text === '', JSON.stringify(hasSvg));

    // 5. 播放 / 进度拖动 / 内联播放
    await clickPlay(page);
    await page.waitForSelector('.msg-video .mv-player', { timeout: 5000 });
    const playback = await page.evaluate(async () => {
        const v = Array.from(document.querySelectorAll('.mv-player')).pop();
        if (!v) return { ok: false };
        const t0 = Date.now();
        while (Date.now() - t0 < 3000 && !(v.readyState >= 2)) await new Promise((r) => setTimeout(r, 50));
        const info = {
            ok: true,
            duration: v.duration,
            readyState: v.readyState,
            playsinline: v.hasAttribute('playsinline'),
            controls: v.controls,
            pausedAfterPlay: v.paused
        };
        await new Promise((resolve) => {
            let done = false;
            v.addEventListener('seeked', () => { done = true; resolve(); }, { once: true });
            v.currentTime = 0.6;
            setTimeout(() => { if (!done) resolve(); }, 2000);
        });
        info.afterSeek = v.currentTime;
        return info;
    });
    assert('原生 video 播放', playback.ok && playback.readyState >= 1 && isFinite(playback.duration) && playback.duration > 0.9, JSON.stringify(playback));
    assert('playsinline + controls', playback.playsinline === true && playback.controls === true, JSON.stringify(playback));
    assert('进度可拖动', playback.afterSeek >= 0.5, 'currentTime=' + playback.afterSeek);
    // 全屏：headless Edge 可能拒绝 requestFullscreen，如实记录
    const fs = await page.evaluate(async () => {
        const v = Array.from(document.querySelectorAll('.mv-player')).pop();
        if (!v || !v.requestFullscreen) return { supported: false };
        try {
            await v.requestFullscreen();
            const okFull = !!document.fullscreenElement;
            if (okFull) await document.exitFullscreen();
            return { supported: true, ok: okFull };
        } catch (e) {
            return { supported: false, error: String(e && e.message || e) };
        }
    });
    if (fs.supported) assert('全屏可用', fs.ok === true, JSON.stringify(fs));
    else skip('全屏（headless 无法验证 UI 全屏）', JSON.stringify(fs));

    // 6. blob: URL 不许写进消息
    const raw = await rawHistory(page, RID);
    assert('消息中不含 blob: URL', raw.indexOf('blob:') === -1, 'len=' + raw.length);
    assert('消息中不含 base64 视频', raw.indexOf('data:video') === -1, '');

    // 7. 刷新后历史视频仍可播放（真实重载）
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.ChatMedia && (document.querySelectorAll('.msg-video').length > 0));
    await clickPlay(page);
    await page.waitForSelector('.msg-video .mv-player', { timeout: 5000 });
    const reloadPlayback = await page.evaluate(async () => {
        const v = Array.from(document.querySelectorAll('.mv-player')).pop();
        if (!v) return { ok: false };
        const t0 = Date.now();
        while (Date.now() - t0 < 3000 && !(v.readyState >= 1)) await new Promise((r) => setTimeout(r, 50));
        return { ok: true, duration: v.duration, readyState: v.readyState, networkSrc: String(v.currentSrc || '').slice(0, 5) };
    });
    assert('刷新后历史视频可播放（objectURL 重建）', reloadPlayback.ok && reloadPlayback.readyState >= 1 && reloadPlayback.duration > 0.9 && reloadPlayback.networkSrc === 'blob:', JSON.stringify(reloadPlayback));

    await page._ctx.close();
}

/* ---------------- 场景二：删除消息的引用计数 ---------------- */
async function scenarioRefCount(base) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
    const page = await newPage(server, 'role-media-a', { ctx });
    const RID = 'role-media-a';

    // 同一段视频发两次 → 内容寻址去重，共享同一 assetId
    const base0 = (await readMessages(page, RID)).length; // 新角色的开场白等基线消息
    await pickFiles(page, [VIDEO_MP4]);
    await sendConfirm(page);
    await waitMessages(page, RID, base0 + 1);
    await pickFiles(page, [VIDEO_MP4]);
    await sendConfirm(page);
    const list = await waitMessages(page, RID, base0 + 2);
    const vids = list.slice(-2);
    assert('重复视频复用同一 assetId', vids.length === 2 && !!vids[0].assetId && vids[0].assetId === vids[1].assetId, 'len=' + list.length + ' ids=' + (vids[0] && vids[0].assetId) + '/' + (vids[1] && vids[1].assetId));

    const assetId = vids[0].assetId;
    await page.evaluate(async (id) => {
        window.__media = new PhoneStorage.MediaRepository(PhoneStorage.result);
        window.__exists = async (aid) => (await window.__media.getBlob(aid)).ok;
    }, assetId);
    assert('发送后 Blob 存在', await page.evaluate((id) => window.__exists(id), assetId), '');

    const mids = await page.evaluate(() => Array.from(document.querySelectorAll('.msg-row.sent')).map((r) => r.dataset.mid).filter(Boolean));
    assert('消息具备 mid', mids.length >= 2, JSON.stringify(mids));

    // 删除第一条：仍有消息引用 → 不删 Blob
    await page.evaluate((mid) => window.deleteOneMessage(mid), mids[0]);
    assert('仍有引用时不删 Blob', (await waitExist(page, assetId, true)) === true, 'deleted first of two');

    // 删除第二条：无引用 → 删 Blob
    await page.evaluate((mid) => window.deleteOneMessage(mid), mids[1]);
    assert('无引用时才删 Blob', (await waitExist(page, assetId, false)) === false, 'deleted last');
    const refs = await page.evaluate(async (id) => {
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('maomao-assets', 1);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        const all = await new Promise((resolve, reject) => {
            const tx = db.transaction(['refs'], 'readonly');
            const r = tx.objectStore('refs').getAll();
            r.onsuccess = () => resolve(r.result || []);
            r.onerror = () => reject(r.error);
        });
        return all.filter((r) => r.assetId === id).length;
    }, assetId);
    assert('删除后无遗留 refs 记录', refs === 0, 'refs=' + refs);

    await page._ctx.close();
}

/* ---------------- 场景三：角色隔离 ---------------- */
async function scenarioIsolation(base) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
    const pageA = await newPage(server, 'role-media-a', { ctx });
    const baseA = (await readMessages(pageA, 'role-media-a')).length;
    await pickFiles(pageA, [VIDEO_MP4]);
    await sendConfirm(pageA);
    const listA = await waitMessages(pageA, 'role-media-a', baseA + 1);
    const assetA = listA[listA.length - 1] && listA[listA.length - 1].assetId;

    const pageB = await newPage(server, 'role-media-b', { ctx });
    await pageB.waitForTimeout(400);
    assert('角色 B 会话无该视频消息', (await pageB.locator('.msg-video').count()) === 0, '');
    const rawB = await rawHistory(pageB, 'role-media-b');
    assert('角色 B 历史不含 A 的 assetId', rawB.indexOf(String(assetA)) === -1, 'asset=' + assetA);
    const ownerB = await pageB.evaluate(async () => {
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('maomao-assets', 1);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        const all = await new Promise((resolve, reject) => {
            const tx = db.transaction(['refs'], 'readonly');
            const r = tx.objectStore('refs').getAll();
            r.onsuccess = () => resolve(r.result || []);
            r.onerror = () => reject(r.error);
        });
        return all.map((r) => r.ownerId || null);
    });
    assert('附件引用按会话归属（ownerId=角色ID）', ownerB.indexOf('role-media-b') === -1 && ownerB.indexOf('role-media-a') !== -1, JSON.stringify(ownerB));
    await ctx.close();
}

/* ---------------- 场景四：存储失败路径 ---------------- */
async function scenarioFailures(base) {
    // 4.1 IndexedDB 写入配额失败 → 明确失败 + 可重试
    const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
    const page = await newPage(server, 'role-media-a', { ctx });
    const baseF = (await readMessages(page, 'role-media-a')).length;
    await page.evaluate(() => {
        window.__origPutBlob = PhoneStorage.MediaRepository.prototype.putBlob;
        PhoneStorage.MediaRepository.prototype.putBlob = function () {
            return Promise.resolve({ ok: false, error: { code: 'QUOTA_EXCEEDED', message: 'QuotaExceededError', retryable: true } });
        };
    });
    await pickFiles(page, [VIDEO_MP4]);
    await sendConfirm(page);
    await page.waitForSelector('.cm-status-row', { timeout: 8000 });
    const failText = await page.locator('.cm-status-bubble').last().textContent();
    assert('视频存储失败有明确提示', /失败/.test(failText || '') && /空间不足/.test(failText || ''), String(failText));
    assert('失败保留重试入口', (await page.locator('.cm-retry').count()) >= 1, '');
    assert('失败不产生假成功消息', (await readMessages(page, 'role-media-a')).length === baseF, 'len=' + (await readMessages(page, 'role-media-a')).length + ' base=' + baseF);
    await page.evaluate(() => { PhoneStorage.MediaRepository.prototype.putBlob = window.__origPutBlob; });
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.cm-retry')).pop(); if (b) b.click(); });
    const afterRetry = await waitMessages(page, 'role-media-a', baseF + 1, 12000);
    assert('重试可成功发送', afterRetry.length === baseF + 1 && afterRetry[afterRetry.length - 1].type === 'video', 'len=' + afterRetry.length);
    await ctx.close();

    // 4.2 localStorage 写失败（聊天记录落库失败）
    const ctx2 = await browser.newContext({ viewport: { width: 375, height: 740 } });
    const page2 = await newPage(server, 'role-media-b', { ctx2 });
    const baseF2 = (await readMessages(page2, 'role-media-b')).length;
    await page2.evaluate(() => {
        window.__origSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (String(key).indexOf('chat_history_') === 0) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
            return window.__origSetItem.call(this, key, value);
        };
    });
    await pickFiles(page2, [PNG_A]);
    await page2.waitForSelector('.cm-status-row', { timeout: 8000 });
    const failText2 = await page2.locator('.cm-status-bubble').last().textContent();
    assert('消息落库失败有明确提示', /失败/.test(failText2 || '') && /本地存储/.test(failText2 || ''), String(failText2));
    assert('消息落库失败不假成功', (await readMessages(page2, 'role-media-b')).length === baseF2, 'len=' + (await readMessages(page2, 'role-media-b')).length + ' base=' + baseF2);
    await page2.evaluate(() => { Storage.prototype.setItem = window.__origSetItem; });
    await ctx2.close();
}

/* ---------------- 场景五：实况照片 ---------------- */
async function scenarioLivePhoto(base) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
    const page = await newPage(server, 'role-media-a', { ctx });
    const baseL = (await readMessages(page, 'role-media-a')).length;

    await pickFiles(page, [PNG_A, VIDEO_MP4]);
    await page.waitForSelector('.cm-live-toggle', { state: 'visible' });
    await page.click('.cm-live-toggle');
    assert('手动勾选后组合开关开启', (await page.locator('.cm-live-toggle').getAttribute('aria-pressed')) === 'true', '');
    await sendConfirm(page);
    const list = await waitMessages(page, 'role-media-a', baseL + 1);
    const liveMsg = list[list.length - 1] || {};
    assert('实况照片消息类型与伴生视频引用', list.length === baseL + 1 && liveMsg.type === 'live_photo' && !!liveMsg.liveVideoId && /^data:image\//.test(liveMsg.img || ''), JSON.stringify({ type: liveMsg.type, liveVideoId: liveMsg.liveVideoId }));
    await page.waitForSelector('.msg-live', { timeout: 8000 });
    assert('气泡显示 LIVE 标识', (await page.locator('.msg-live .mv-live-tag').count()) === 1 && (await page.locator('.msg-live .mv-live-tag').textContent()) === 'LIVE', '');

    // 长按播放 / 松开恢复静态
    const box = await page.locator('.msg-live').last().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(450);
    const pressing = await page.evaluate(() => {
        const w = Array.from(document.querySelectorAll('.msg-live')).pop();
        const v = w && w.querySelector('.mv-live-video');
        return v ? { hidden: v.hidden, paused: v.paused, cls: w.className } : null;
    });
    assert('长按播放动态视频', pressing && pressing.hidden === false && pressing.paused === false, JSON.stringify(pressing));
    await page.mouse.up();
    await page.waitForTimeout(350);
    const released = await page.evaluate(() => {
        const w = Array.from(document.querySelectorAll('.msg-live')).pop();
        const v = w && w.querySelector('.mv-live-video');
        return v ? { hidden: v.hidden, paused: v.paused, cls: w.className } : null;
    });
    assert('松开恢复静态', released && released.hidden === true && released.paused === true, JSON.stringify(released));

    // 手动组合才生效：不勾选时同选一张照片 + 一段视频 → 两条独立消息，不按文件名自动配对
    await pickFiles(page, [PNG_B, VIDEO_MP4]);
    await page.waitForSelector('.cm-overlay', { state: 'visible' });
    assert('未勾选时不出现组合消息', (await page.locator('.cm-live-toggle').getAttribute('aria-pressed')) === 'false', '');
    await sendConfirm(page);
    const list2 = await waitMessages(page, 'role-media-a', baseL + 3);
    assert('手动组合之外按普通图片+视频分开发送', list2.slice(-2).every((m) => m.type === 'image' || m.type === 'video') && list2.slice(-2).some((m) => m.type === 'video'), list2.slice(-2).map((m) => m.type).join(','));

    // 无伴生视频时降级为静态图，且无 LIVE 标识：普通图片气泡内没有 LIVE 标签
    const plainLive = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.msg-row.sent .bubble-media img'));
        const img = rows[rows.length - 1];
        const bubble = img && img.closest('.msg-live, .bubble-media');
        return bubble ? { isLive: !!bubble.querySelector('.mv-live-tag'), cls: bubble.className } : null;
    });
    assert('普通图片无 LIVE 标识', plainLive && plainLive.isLive === false, JSON.stringify(plainLive));

    await ctx.close();
}

/* ---------------- 场景六：MOV 降级 ---------------- */
async function scenarioMov(base) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 740 } });
    const page = await newPage(server, 'role-media-b', { ctx });
    const baseM = (await readMessages(page, 'role-media-b')).length;
    await pickFiles(page, [{ name: 'IMG_0001.MOV', mimeType: 'video/quicktime', buffer: Buffer.from('this-is-not-a-real-mov') }]);
    await page.waitForSelector('.cm-overlay', { state: 'visible' });
    const warn = await page.locator('.cm-warn').count() ? await page.locator('.cm-warn').textContent() : '';
    assert('MOV 无法解码时有明确降级提示', /不支持/.test(warn || '') && /MP4/.test(warn || ''), String(warn));
    assert('不可用视频不进入发送队列', (await page.locator('.cm-btn.primary').isDisabled()) === true, '');
    await page.click('.cm-btn.ghost');
    assert('取消发送不产生消息', (await readMessages(page, 'role-media-b')).length === baseM, 'len=' + (await readMessages(page, 'role-media-b')).length + ' base=' + baseM);
    await ctx.close();
}

main();
