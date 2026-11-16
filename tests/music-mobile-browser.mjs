/**
 * MUSIC-UI-001: real Chromium smoke against locally built Vite dist.
 * Run after `npm ci && npm run build`: node tests/music-mobile-browser.mjs
 * Uses isolated browser contexts and local Vite preview; never touches production/QA data.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.MUSIC_QA_PORT || 34273);
const BASE = 'http://127.0.0.1:' + PORT + '/music/music.html';
const widths = [375, 390, 430];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxGkAAAAASUVORK5CYII=', 'base64');
function makeWav() {
  const sampleRate = 8000, frames = 8000;
  const buf = Buffer.alloc(44 + frames * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(buf.length - 8, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    buf.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / sampleRate) * 1400), 44 + i * 2);
  return buf;
}
async function waitPreview(processHandle) {
  for (let i = 0; i < 100; i++) {
    if (processHandle.exitCode !== null) throw new Error('Vite preview terminated before readiness');
    try {
      const response = await fetch(BASE, { signal: AbortSignal.timeout(700) });
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Vite preview not ready at ' + BASE);
}
let server = null, browser = null, shots = null;
try {
  shots = await mkdtemp(join(tmpdir(), 'maomao-music-qa-'));
  const vite = new URL('../node_modules/vite/bin/vite.js', import.meta.url);
  server = spawn(process.execPath, [vite.pathname, 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  await waitPreview(server);
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: 844 }, isMobile: true, hasTouch: true,
      serviceWorkers: 'block'
    });
    const page = await context.newPage(), pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));
    try {
      const response = await page.goto(BASE, { waitUntil: 'domcontentloaded' });
      assert.equal(response.status(), 200, 'music page HTTP 200');
      await page.locator('#musicImport').waitFor();
      await page.screenshot({ path: join(shots, 'home-' + width + '.png') });
      await page.evaluate(() => {
        localStorage.setItem('settings_statusbar', '0');
        window.__statusbarControlApply();
      });
      assert.equal(await page.locator('.statusbar').evaluate(el => getComputedStyle(el).display), 'none',
        'global statusbar off must hide music bar');
      await page.evaluate(() => {
        localStorage.setItem('settings_statusbar', '1');
        window.__statusbarControlApply();
      });
      assert.notEqual(await page.locator('.statusbar').evaluate(el => getComputedStyle(el).display), 'none',
        'global statusbar on must restore music bar');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 1, width + 'px layout overflow ' + overflow);
      await page.locator('#musicImport').setInputFiles({
        name: 'QA 轻声.wav', mimeType: 'audio/wav', buffer: makeWav()
      });
      await page.waitForFunction(() => {
        try { return JSON.parse(localStorage.getItem('music_local_tracks') || '[]').length > 0; }
        catch { return false; }
      });
      const trackId = await page.evaluate(() => JSON.parse(localStorage.getItem('music_local_tracks'))[0].id);
      assert.match(trackId, /^local_/);
      const audioInfo = await page.evaluate(async (id) => {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('maomao-media-store', 2);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const record = await new Promise((resolve, reject) => {
          const tx = db.transaction('audio', 'readonly');
          const req = tx.objectStore('audio').get(id);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        db.close();
        return { size: record?.blob?.size, type: record?.blob?.type };
      }, trackId);
      assert.ok(audioInfo.size >= 44, 'actual WAV binary persisted');
      await page.evaluate(id => playTrack(id), trackId);
      await page.waitForFunction(id => {
        try { return JSON.parse(localStorage.getItem('music_state') || 'null')?.id === id; }
        catch { return false; }
      }, trackId, { timeout: 10000 });
      await page.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(await page.evaluate(id => JSON.parse(localStorage.getItem('music_local_tracks'))[0].id === id, trackId), true);
      // Critical: after reload, local audio has no object URL until user plays.
      await page.evaluate(() => togglePlay());
      await page.waitForFunction(() => window.audio && window.audio.currentSrc.startsWith('blob:'),
        null, { timeout: 10000 });
      assert.ok(await page.evaluate(() => window.audio && window.audio.src.startsWith('blob:')),
        'resume must recreate local Blob URL after refresh');
      await page.waitForFunction(id => document.getElementById('npTitle')?.textContent === 'QA 轻声', trackId);
      await page.locator('#coverUpload').setInputFiles({ name:'cover.png', mimeType:'image/png', buffer:png });
      await page.waitForFunction(id => {
        try { return !!JSON.parse(localStorage.getItem('music_cover_assets_v1') || '{}')[id]; }
        catch { return false; }
      }, trackId);
      await page.evaluate(() => { hideNP(); switchTab('home'); });
      const thumbnail = page.locator('#recent-list [data-music-track-id="' + trackId + '"]');
      await thumbnail.scrollIntoViewIfNeeded();
      await page.waitForFunction(id => {
        const img = document.querySelector('#recent-list [data-music-track-id="' + id + '"] img');
        return !!(img && img.src.startsWith('blob:'));
      }, trackId, { timeout: 10000 });
      assert.equal(await thumbnail.locator('img').count(), 1,
        'recent-play list must display uploaded original cover');
      await page.locator('#lyricsUpload').setInputFiles({
        name: 'sample.lrc', mimeType:'text/plain',
        buffer: Buffer.from('[00:00.00]第一句\n[00:00.50]第二句\n')
      });
      await page.waitForFunction(id => {
        try { return JSON.parse(localStorage.getItem('music_lyrics_v1') || '{}')[id]?.lines?.length === 2; }
        catch { return false; }
      }, trackId);
      page.once('dialog', dialog => dialog.accept('手机验收'));
      await page.evaluate(() => addCurrentToMusicPlaylist());
      assert.equal(await page.evaluate(id =>
        JSON.parse(localStorage.getItem('music_playlists_v1'))['手机验收'].includes(id), trackId), true);
      // 视觉验收必须真正打开播放页，而不是误拍音乐首页。
      await page.evaluate(() => showNP());
      await page.waitForTimeout(260);
      const layout = await page.evaluate(() => {
        const phone = document.querySelector('.phone').getBoundingClientRect();
        const cover = document.querySelector('#npCover').getBoundingClientRect();
        const controls = document.querySelector('.np-controls').getBoundingClientRect();
        const panel = document.querySelector('#npOverlay .np-main').getBoundingClientRect();
        return {
          coverTop: cover.top - phone.top,
          coverBottom: cover.bottom - phone.top,
          controlsTop: controls.top - phone.top,
          controlsBottom: controls.bottom - phone.top,
          panelHeight: panel.height, phoneHeight: phone.height,
          layoutMid: (cover.top + controls.bottom) / 2 - phone.top
        };
      });
      assert.ok(layout.coverTop > 128,
        width + 'px cover still too high: ' + JSON.stringify(layout));
      assert.ok(layout.controlsTop > 430,
        width + 'px player controls still clustered at top: ' + JSON.stringify(layout));
      assert.ok(layout.controlsBottom < layout.phoneHeight - 50,
        width + 'px player controls too low or clipped: ' + JSON.stringify(layout));
      assert.ok(Math.abs(layout.layoutMid - layout.phoneHeight / 2) < 94,
        width + 'px now-playing group not vertically balanced: ' + JSON.stringify(layout));
      await page.screenshot({ path: join(shots, 'player-' + width + '.png') });
      // 小屏高（667px）必须可以滑动到播放控制，而不是被隐藏。
      await page.setViewportSize({ width, height: 667 });
      await page.locator('.np-controls').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('.np-controls').isVisible(), true,
        width + 'px short phone hides controls');
      await page.screenshot({ path: join(shots, 'player-short-' + width + '.png') });
      assert.deepEqual(pageErrors, [], 'no uncaught JS errors at ' + width);
      console.log('PASS Chromium ' + width + 'px: viewport, import Blob, reload, playback, cover, LRC, playlist');
    } finally {
      await context.close();
    }
  }
  console.log('PASS all 375/390/430px browser checks (screenshots in ' + shots + ')');
} catch (error) {
  console.error('FAIL MUSIC Chromium QA:', error && error.stack || error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
  if (shots && process.env.MUSIC_QA_KEEP_SHOTS !== '1') await rm(shots, { recursive:true, force:true });
}
