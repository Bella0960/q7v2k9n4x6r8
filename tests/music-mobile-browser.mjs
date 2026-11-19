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
  const sampleRate = 8000, frames = 8000 * 8;
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
      await page.evaluate(() => { window.audio.currentTime = 3; saveState(); });
      assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem('music_state')).time >= 2.9),
        'local WAV checkpoint must save before reloading');
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
      await page.waitForFunction(() =>
        Number.isFinite(window.audio.currentTime) &&
        window.audio.currentTime >= 2.75 && window.audio.currentTime < 6.75,
        null, {timeout:10000});
      assert.ok(await page.evaluate(() => window.audio.currentTime >= 2.75),
        'local WAV must seek to the saved position instead of restarting');
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
      // 在真实浏览器点歌单控件：改名、移出单曲、删除歌单，原音频仍在 IndexedDB。
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => {
        hideNP();
        showMusicPlaylists();
        showMusicPlaylistTracks('手机验收');
      });
      assert.equal(await page.locator('#musicPlaylistView').isVisible(), true);
      assert.equal(await page.locator('.music-playlist-track').count(), 1);
      await page.screenshot({ path: join(shots, 'playlist-' + width + '.png') });
      page.once('dialog', dialog => dialog.accept('已改名'));
      await page.locator('.music-playlist-toolbar .music-playlist-quiet').first().click();
      assert.equal(await page.evaluate(() =>
        Object.prototype.hasOwnProperty.call(JSON.parse(localStorage.getItem('music_playlists_v1')), '已改名')), true);
      // 用两首真实导入的 WAV 验证播放队列，不用无音源的模拟歌曲。
      await page.locator('#musicImport').setInputFiles({
        name:'QA 第二首.wav', mimeType:'audio/wav', buffer:makeWav()
      });
      await page.waitForFunction(() =>
        JSON.parse(localStorage.getItem('music_local_tracks') || '[]').length === 2);
      const secondTrackId = await page.evaluate(id =>
        JSON.parse(localStorage.getItem('music_local_tracks')).find(t => t.id !== id).id, trackId);
      await page.evaluate(id => {
        window.MAOMAOMusicPlaylists.addTrack('已改名', id);
        hideNP();
        showMusicPlaylistTracks('已改名');
      }, secondTrackId);
      assert.equal(await page.locator('.music-playlist-track-name').count(), 2);
      await page.locator('.music-playlist-track-name').first().click();
      await page.waitForFunction(id =>
        window.MAOMAOMusicQueue.getState().playlistName === '已改名' &&
        window.MAOMAOMusicQueue.getState().currentTrackId === id, trackId);
      assert.equal(await page.locator('#musicPlaylistView').isVisible(), false,
        'playlist only closes after audio playback really starts');
      assert.equal(await page.locator('#npOverlay').isVisible(), true);
      await page.evaluate(() => nextTrack());
      await page.waitForFunction(id =>
        window.MAOMAOMusicQueue.getState().currentTrackId === id, secondTrackId);
      assert.equal(await page.locator('#npTitle').textContent(), 'QA 第二首');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('music_state')).playlistName),
        '已改名', 'playlist context must persist with playback position');
      await page.reload({ waitUntil:'domcontentloaded' });
      assert.equal(await page.evaluate(() => window.MAOMAOMusicQueue.getState().playlistName),
        '已改名', 'reopening the phone must restore active playlist');
      await page.evaluate(() => togglePlay());
      await page.waitForFunction(id => {
        const state = window.MAOMAOMusicQueue.getState();
        return state.playlistName === '已改名' && state.currentTrackId === id &&
          window.audio.currentSrc.startsWith('blob:');
      }, secondTrackId, { timeout:10000 });
      await page.evaluate(() => {
        hideNP();
        showMusicPlaylistTracks('已改名');
      });
      page.once('dialog', dialog => dialog.accept());
      await page.locator('.music-playlist-track .music-playlist-quiet').first().click();
      assert.equal(await page.evaluate(() =>
        JSON.parse(localStorage.getItem('music_playlists_v1'))['已改名'].length), 1);
      page.once('dialog', dialog => dialog.accept());
      await page.locator('.music-playlist-toolbar .music-playlist-quiet').last().click();
      assert.equal(await page.evaluate(() =>
        Object.keys(JSON.parse(localStorage.getItem('music_playlists_v1') || '{}')).length), 0);
      assert.equal(await page.evaluate(async ids => {
        const catalog = JSON.parse(localStorage.getItem('music_local_tracks') || '[]');
        for (const id of ids) {
          const blob = await getAudioBlob(id);
          if (!(blob?.size > 44 && catalog.some(track => track.id === id))) return false;
        }
        return true;
      }, [trackId, secondTrackId]), true, 'deleting a playlist must preserve both original WAV files');

      // 本地音乐管理：改名 + 可逆移出/恢复，跨刷新不丢原始 WAV。
      await page.evaluate(() => { hideNP(); openMusicLocalManager(); });
      assert.equal(await page.locator('#musicLocalManager').isVisible(), true);
      const localRow = page.locator('.music-local-row').filter({ hasText:'QA 第二首' });
      await localRow.waitFor();
      page.once('dialog', dialog => dialog.accept('保留的本地曲'));
      await localRow.locator('.music-local-btn').first().click();
      assert.equal(await page.evaluate(id =>
        JSON.parse(localStorage.getItem('music_local_tracks')).find(t => t.id === id)?.name,
        secondTrackId), '保留的本地曲');
      page.once('dialog', dialog => dialog.accept());
      await page.locator('.music-local-row').filter({hasText:'保留的本地曲'})
        .locator('.music-local-btn').last().click();
      assert.equal(await page.evaluate(id =>
        JSON.parse(localStorage.getItem('music_local_tracks')).find(t => t.id === id)?.hidden,
        secondTrackId), true);
      assert.equal(await page.evaluate(id => getTrackById(id) === null, secondTrackId), true);
      await page.reload({ waitUntil:'domcontentloaded' });
      await page.evaluate(() => openMusicLocalManager());
      const hiddenRow = page.locator('.music-local-row').filter({hasText:'保留的本地曲'});
      assert.match(await hiddenRow.textContent(), /已移出/);
      await hiddenRow.locator('.music-local-btn').last().click();
      assert.equal(await page.evaluate(id => !!getTrackById(id), secondTrackId), true);
      assert.equal(await page.evaluate(async id => (await getAudioBlob(id))?.size > 44,
        secondTrackId), true, 'restored local song retains original IndexedDB audio');
      await page.screenshot({ path: join(shots, 'local-manager-' + width + '.png') });
      // Android document pickers can supply numeric names and generic MIME.
      await page.locator('#musicImport').setInputFiles({
        name:'318924510', mimeType:'application/octet-stream', buffer:makeWav()
      });
      await page.waitForFunction(() => {
        try { return JSON.parse(localStorage.getItem('music_local_tracks') || '[]')
          .some(track => track.name === '318924510'); }
        catch { return false; }
      }, null, {timeout:10000});
      const numericId = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('music_local_tracks'))
          .find(track => track.name === '318924510').id);
      const numericRecord = await page.evaluate(id => new Promise((resolve,reject) => {
        const open=indexedDB.open('maomao-media-store',2);
        open.onerror=()=>reject(open.error);
        open.onsuccess=()=>{
          const db=open.result, req=db.transaction('audio','readonly')
            .objectStore('audio').get(id);
          req.onsuccess=()=>{
            const value=req.result;
            resolve({type:value?.blob?.type,mimeType:value?.mimeType,size:value?.blob?.size});
            db.close();
          };
          req.onerror=()=>{db.close();reject(req.error);};
        };
      }),numericId);
      assert.equal(numericRecord.type,'audio/wav');
      assert.equal(numericRecord.mimeType,'audio/wav');
      assert.ok(numericRecord.size>44);
      // Imported filenames may contain apostrophes or HTML-like characters.
      // The player must show their literal text and still open them from Queue.
      await page.locator('#musicImport').setInputFiles({
        name:"O'Neil <live>.wav", mimeType:'audio/wav', buffer:makeWav()
      });
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('music_local_tracks') || '[]')
        .some(track => track.name === "O'Neil <live>"), null, {timeout:10000});
      await page.evaluate(() => showQueue());
      await page.locator('#queueBody .queue-item')
        .filter({hasText:"O'Neil <live>"}).click();
      await page.waitForFunction(() => document.getElementById('npTitle')?.textContent === "O'Neil <live>",
        null, {timeout:10000});
      // A corrupted song must fail to play while the previous local WAV and
      // its object URL remain usable, without changing queue/current title.
      const rollback = await page.evaluate(async () => {
        const previousId = tracks[currentIdx]?.id;
        const previousSrc = window.audio.src;
        const previousTitle = document.getElementById('npTitle')?.textContent;
        const brokenId = 'qa-broken-' + Date.now();
        tracks.push({id:brokenId,name:'损坏音频',artist:'QA',source:'local',
          lyrics:[],dur:'本地',durSec:0});
        try {
          await putAudioBlob({id:brokenId,name:'损坏音频',artist:'QA',
            mimeType:'audio/wav',size:20,
            blob:new Blob([new Uint8Array(20).fill(0xa5)],{type:'audio/wav'})});
          const started=await playTrack(brokenId);
          let previousBlobUsable=false;
          try {previousBlobUsable=(await fetch(previousSrc)).ok;} catch {}
          return {
            started, currentId:tracks[currentIdx]?.id, previousId,
            previousSrc, restoredSrc:window.audio.src,
            previousTitle, title:document.getElementById('npTitle')?.textContent,
            previousBlobUsable
          };
        } finally {
          tracks.splice(tracks.findIndex(t=>t.id===brokenId),1);
          await deleteAudioBlob(brokenId);
        }
      });
      assert.equal(rollback.started,false,'corrupt WAV must not report successful playback');
      assert.equal(rollback.currentId,rollback.previousId,'failed next song must not replace current');
      assert.equal(rollback.restoredSrc,rollback.previousSrc,'previous audio URL must return');
      assert.equal(rollback.title,rollback.previousTitle,'now playing should keep previous title');
      assert.equal(rollback.previousBlobUsable,true,'old WAV Blob must not be prematurely revoked');
      // Force a staged replacement through real HTMLAudioElement media events;
      // the old song's stored id/time must survive the failed decode.
      const background = await page.evaluate(() => {
        window.audio.currentTime = 3.25;
        const beforePaused = window.audio.paused;
        const existing = Object.getOwnPropertyDescriptor(document,'visibilityState');
        try {
          Object.defineProperty(document,'visibilityState',{
            configurable:true,get:()=> 'hidden'
          });
          document.dispatchEvent(new Event('visibilitychange'));
        } finally {
          if (existing) Object.defineProperty(document,'visibilityState',existing);
          else delete document.visibilityState;
        }
        return {
          pausedBefore:beforePaused,pausedAfter:window.audio.paused,
          progress:JSON.parse(localStorage.getItem('music_state') || 'null'),
          currentId:tracks[currentIdx]?.id
        };
      });
      assert.equal(background.progress?.id,background.currentId,
        'background checkpoint must belong to the confirmed track');
      assert.ok(background.progress?.time >= 3,
        'background checkpoint must save current confirmed playback time');
      assert.equal(background.pausedAfter,background.pausedBefore,
        'background checkpoint must not force audio to pause');
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
