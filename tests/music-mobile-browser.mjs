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
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const PORT = Number(process.env.MUSIC_QA_PORT || 34273);
const BASE = 'http://127.0.0.1:' + PORT + '/music/music.html';
const widths = [375, 390, 430];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxGkAAAAASUVORK5CYII=', 'base64');
function makeWav(frequency = 220) {
  const sampleRate = 8000, frames = 8000;
  const buf = Buffer.alloc(44 + frames * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(buf.length - 8, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++)
    buf.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * frequency / sampleRate) * 1400), 44 + i * 2);
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
  // Fixed, non-sensitive progress markers recognized by the existing QA runner.
  console.log('SEALED_BROWSER_CHECKPOINT:0');
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
      // The file input is intentionally hidden: the visible import button opens it.
      await page.locator('.music-import-link').waitFor({ state: 'visible' });
      await page.locator('#musicImport').waitFor({ state: 'attached' });
      await page.screenshot({ path: join(shots, 'home-' + width + '.png') });
      // 真机状态栏交给 OS 绘制；音乐页不能生成第二条模拟时间/信号栏。
      const chrome = await page.evaluate(() => {
        localStorage.setItem('settings_statusbar', '0');
        window.__statusbarControlApply();
        localStorage.setItem('settings_statusbar', '1');
        window.__statusbarControlApply();
        const height = selector => document.querySelector(selector)?.getBoundingClientRect().height;
        return {
          fakeStatusCount: document.querySelectorAll('.statusbar, .status-bar, .phone-camera').length,
          headerHeight: height('#page-home > .navbar'),
          tabbarHeight: height('.tabbar'),
          miniPlayerHeight: height('.mini-player')
        };
      });
      assert.equal(chrome.fakeStatusCount, 0, 'music should never draw a fake phone status bar');
      assert.ok(chrome.headerHeight > 0 && chrome.headerHeight <= 54,
        width + 'px music top too tall: ' + JSON.stringify(chrome));
      assert.ok(chrome.tabbarHeight > 0 && chrome.tabbarHeight <= 56,
        width + 'px music bottom navigation too tall: ' + JSON.stringify(chrome));
      assert.ok(chrome.miniPlayerHeight > 0 && chrome.miniPlayerHeight <= 54,
        width + 'px music mini player too tall: ' + JSON.stringify(chrome));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 1, width + 'px layout overflow ' + overflow);
      // 真实点击 音乐个人页 → 设置 → 导入音乐，选择多个文件而非直接给隐藏 input 塞值。
      await page.evaluate(() => showSetting());
      const settingsImport = page.locator('#settingSheet [aria-label^="导入音乐"]');
      await settingsImport.waitFor({ state: 'visible' });
      const importPickerEvent = page.waitForEvent('filechooser');
      await settingsImport.click();
      const importPicker = await importPickerEvent;
      assert.equal(importPicker.isMultiple(), true, 'settings must accept multiple local audio files');
      await importPicker.setFiles([
        { name: 'QA 轻声.wav', mimeType: 'audio/wav', buffer: makeWav() },
        { name: 'QA 第二首.wav', mimeType: 'audio/wav', buffer: makeWav(330) }
      ]);
      await page.waitForFunction(() => {
        try { return JSON.parse(localStorage.getItem('music_local_tracks') || '[]').length === 2; }
        catch { return false; }
      });
      assert.equal(await page.locator('#settingSheet').evaluate(el => el.classList.contains('show')), false,
        'settings drawer should close after invoking the picker');
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
      // 点已导入歌曲的默认方形封面，图片选择器必须绑定到该歌曲，而非误触播放。
      await page.evaluate(() => { hideNP(); switchTab('home'); });
      const thumbnailToEdit = page.locator('#recent-list [data-music-track-id="' + trackId + '"]');
      await thumbnailToEdit.scrollIntoViewIfNeeded();
      const coverPickerEvent = page.waitForEvent('filechooser');
      await thumbnailToEdit.click();
      await (await coverPickerEvent).setFiles({ name:'cover.png', mimeType:'image/png', buffer:png });
      await page.waitForFunction(id => {
        try { return !!JSON.parse(localStorage.getItem('music_cover_assets_v1') || '{}')[id]; }
        catch { return false; }
      }, trackId);
      assert.equal(await page.evaluate(id => {
        const tracks = JSON.parse(localStorage.getItem('music_local_tracks') || '[]');
        const covers = JSON.parse(localStorage.getItem('music_cover_assets_v1') || '{}');
        return tracks.filter(t => t.id !== id).every(t => !covers[t.id]);
      }, trackId), true, 'image must not leak to other imported songs');
      const thumbnail = page.locator('#recent-list [data-music-track-id="' + trackId + '"]');
      await thumbnail.scrollIntoViewIfNeeded();
      await page.waitForFunction(id => {
        const img = document.querySelector('#recent-list [data-music-track-id="' + id + '"] img');
        return !!(img && img.src.startsWith('blob:'));
      }, trackId, { timeout: 10000 });
      assert.equal(await thumbnail.locator('img').count(), 1,
        'recent-play list must display uploaded original cover');
      // M03 integration: consume real imported bytes from a fresh same-origin
      // document, without seeding or copying catalog records into the reader.
      // The existing account-isolated catalog browser test remains separate.
      await page.waitForFunction(() => {
        const rows = JSON.parse(localStorage.getItem('music_local_tracks') || '[]');
        return rows.length === 2 && rows.every(t => Number(t.durSec) > 0);
      }, null, { timeout: 15000 });
      const original = await page.evaluate(() => ({
        catalog: localStorage.getItem('music_local_tracks'),
        covers: localStorage.getItem('music_cover_assets_v1')
      }));
      const readerUrl = new URL('/__test_music_catalog_reader__', BASE).href;
      const readerRoute = route => route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><meta charset="utf-8"><title>Catalog test reader</title>'
      });
      await context.route(readerUrl, readerRoute);
      const reader = await context.newPage();
      try {
        await reader.goto(readerUrl, {waitUntil: 'domcontentloaded'});
        for (const file of ['group-write-guard.js', 'music-catalog-adapter.js']) {
          await reader.addScriptTag({path: fileURLToPath(new URL('../shared/js/phone/' + file, import.meta.url))});
        }
        const result = await reader.evaluate(async () => {
          const adapter = window.MAOMusicCatalogAdapter;
          const listing = adapter.listTracks();
          if (!listing.ok) throw Error('catalog adapter: ' + listing.code);
          const audio = [];
          for (const track of listing.tracks) {
            const resolved = await adapter.resolveSource(track.id);
            if (!resolved.ok) throw Error('resolveSource: ' + resolved.code);
            audio.push({id: resolved.track.id, mime: resolved.source.mimeType,
              bytes: Array.from(new Uint8Array(await resolved.source.blob.arrayBuffer()))});
          }
          return {tracks: listing.tracks, warnings: listing.warnings, audio,
            catalog: localStorage.getItem('music_local_tracks'),
            covers: localStorage.getItem('music_cover_assets_v1')};
        });
        const rows = JSON.parse(original.catalog), covers = JSON.parse(original.covers);
        assert.deepEqual(result.warnings, []);
        assert.deepEqual(result.tracks.map(t => t.id), rows.map(t => t.id));
        assert.deepEqual(result.tracks.map(t => t.name), ['QA 轻声', 'QA 第二首']);
        assert.equal(result.tracks.find(t => t.id === trackId).coverAssetId, covers[trackId]);
        assert.equal(result.tracks.find(t => t.id !== trackId).coverAssetId, null);
        for (const [index, audio] of result.audio.entries()) {
          assert.equal(audio.id, rows[index].id);
          assert.match(audio.mime, /^audio\//);
          assert.deepEqual(Buffer.from(audio.bytes), makeWav(index === 0 ? 220 : 330),
            'reader must retrieve original imported audio for the exact track ID');
        }
        assert.equal(result.catalog, original.catalog, 'catalog reader must not rewrite imports');
        assert.equal(result.covers, original.covers, 'catalog reader must not rewrite covers');
      } finally {
        await reader.close();
        await context.unroute(readerUrl, readerRoute);
      }
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
      // M04a: actual HTMLAudioElement + the same original UI player. Only the
      // rejected play and delayed file-read cases inject a controlled fault.
      const playbackChecks = await page.evaluate(async firstId => {
        const media = window.audio;
        const secondId = JSON.parse(localStorage.getItem('music_local_tracks')).find(t => t.id !== firstId).id;
        const read = getAudioBlob;
        const nativeRevoke = URL.revokeObjectURL;
        const revoked = [];
        const check = (value, label) => { if (!value) throw Error(label); };
        const state = () => window.MAOMAOMusicPlayback.getState();
        const results = [], playbackEvents = [];
        const unsubscribe = window.MAOMAOMusicPlayback.subscribe(event => playbackEvents.push(event));
        const originalLoop = media.loop;
        media.loop = true; // one-second WAV must not naturally advance during assertions
        URL.revokeObjectURL = function(url) { revoked.push(url); return nativeRevoke.call(URL,url); };
        try {
          check(await playTrack(firstId), 'native first play');
          check(media instanceof HTMLAudioElement && !media.paused && state().trackId === firstId && state().playing, 'actual playback state');
          await togglePlay();
          check(media.paused && state().playing === false, 'native pause');
          results.push('play/pause');
          const bar = document.getElementById('progressBar');
          const rect = bar.getBoundingClientRect();
          check(rect.width > 0 && Number.isFinite(media.duration), 'seek geometry and duration');
          const target = media.duration * 0.5;
          bar.dispatchEvent(new MouseEvent('click', {clientX:rect.left + rect.width * 0.5, bubbles:true}));
          check(Math.abs(media.currentTime-target) < 0.12, 'native seek');
          check(Math.abs(state().currentTime-target) < 0.12, 'seek state');
          check(playbackEvents.at(-1).type === 'seek' && Math.abs(playbackEvents.at(-1).currentTime-target) < 0.12, 'seek event agrees with audio');
          results.push('seek');
          const originalSource = media.src;
          Object.defineProperty(media,'play',{configurable:true,value:()=>Promise.reject(new DOMException('Synthetic policy rejection','NotAllowedError'))});
          try {
            check(await playTrack(secondId) === false, 'rejected native switch');
            check(media.paused && !media.getAttribute('src') && state().trackId === firstId && !state().playing, 'no false track ownership');
            check(revoked.includes(originalSource), 'old object URL released');
            check(JSON.parse(localStorage.getItem('music_state')).id === firstId, 'failed track not persisted');
            const errorState = playbackEvents.at(-1);
            check(errorState.type === 'error' && errorState.trackId === firstId && !errorState.playing, 'subscription stops on failed play');
            check(JSON.parse(localStorage.getItem('music_playback_state_v1')).playing === false, 'persisted shared state not falsely playing');
          } finally { delete media.play; }
          await togglePlay();
          check(!media.paused && state().trackId === firstId && media.src.startsWith('blob:'), 'retry opens prior song');
          results.push('rejected switch/retry');
          const prior = media.src;
          const blob = await read(secondId);
          check(blob instanceof Blob, 'real second file');
          let release;
          getAudioBlob = id => id === secondId ? new Promise(resolve => { release=resolve; }) : read(id);
          try {
            const pending = playTrack(secondId);
            check(typeof release === 'function', 'pending read started');
            await togglePlay();
            release(blob);
            check(await pending === false && media.paused && media.src === prior, 'pause cancels delayed switch');
            check(state().trackId === firstId && !state().playing, 'old metadata retained while paused');
          } finally { getAudioBlob = read; }
          results.push('cancel pending switch');
          check(await playTrack(secondId), 'real second play');
          check(state().trackId === secondId && state().playing && media.src !== prior && revoked.includes(prior), 'successful switch and prior URL release');
          results.push('switch/release');
          await togglePlay();
          return results;
        } finally {
          getAudioBlob=read;
          delete media.play;
          unsubscribe();
          URL.revokeObjectURL=nativeRevoke;
          media.loop=originalLoop;
          musicPauseNative();
        }
      }, trackId);
      assert.deepEqual(playbackChecks, ['play/pause','seek','rejected switch/retry','cancel pending switch','switch/release']);
      // M04c: two real same-origin documents must never play together.
      const peer = await context.newPage();
      const peerErrors = [];
      peer.on('pageerror', err => peerErrors.push(err.message));
      try {
        await peer.goto(BASE,{waitUntil:'domcontentloaded'});
        await peer.waitForFunction(()=>typeof window.MAOMAOMusicPlayback?.getState==='function');
        // Restore an index-only old record without granting this new tab write ownership.
        const legacyCheck=await peer.evaluate(id=>{
          const original=localStorage.getItem('music_state');
          const idx=tracks.findIndex(t=>t.id===id);
          if(idx<0)throw Error('imported track missing');
          const raw=JSON.stringify({idx,time:0.6,playing:true});
          try{
            localStorage.setItem('music_state',raw);
            loadState();
            return {unchanged:localStorage.getItem('music_state')===raw,
              trackId:window.MAOMAOMusicPlayback.getState().trackId,paused:window.audio.paused,
              ownerWrite:musicSaveOwnedState()};
          }finally{if(original===null)localStorage.removeItem('music_state');else localStorage.setItem('music_state',original);}
        },trackId);
        assert.deepEqual(legacyCheck,{unchanged:true,trackId,paused:true,ownerWrite:false});

        assert.equal(await page.evaluate(()=>{window.audio.loop=true;return playTrack(tracks[currentIdx].id);}),true);
        const activeShared=await page.evaluate(()=>localStorage.getItem('music_playback_state_v1'));
        const denied=await peer.evaluate(async id=>{
          window.audio.loop=true;
          return {ok:await playTrack(id),paused:window.audio.paused,src:window.audio.getAttribute('src'),
            shared:localStorage.getItem('music_playback_state_v1')};
        },trackId);
        assert.equal(denied.ok,false);assert.equal(denied.paused,true);assert.equal(denied.src,null);
        assert.equal(denied.shared,activeShared,'non-owner cannot overwrite shared playback state');
        assert.equal(await page.evaluate(()=>window.MAOMAOMusicPlayback.getState().playing),true);
        await page.evaluate(()=>togglePlay());
        await page.waitForFunction(async()=>!(await navigator.locks.query()).held.some(l=>l.name==='maomao-native-music-playback-v1'));
        assert.equal(await peer.evaluate(id=>playTrack(id),trackId),true);
        assert.equal(await page.evaluate(()=>window.audio.paused),true);
        assert.equal(await peer.evaluate(()=>window.MAOMAOMusicPlayback.getState().playing),true);
        await peer.close();
        await page.waitForFunction(async()=>!(await navigator.locks.query()).held.some(l=>l.name==='maomao-native-music-playback-v1'));
        assert.equal(await page.evaluate(id=>playTrack(id),trackId),true);
        await page.evaluate(()=>{musicPauseNative();musicDiscardAudioSource();window.audio.loop=false;});
        assert.deepEqual(peerErrors,[]);
      } finally {if(!peer.isClosed())await peer.close();}
      // M05: isolated same-origin group session using real imported music,
      // actual group permissions, actual Web Locks and HTMLAudioElement.
      const groupReader=await context.newPage(), groupErrors=[];
      groupReader.on('pageerror',err=>groupErrors.push(err.message));
      await context.route(readerUrl,readerRoute);
      try{
        await groupReader.goto(readerUrl,{waitUntil:'domcontentloaded'});
        for(const file of ['group-write-guard.js','music-catalog-adapter.js','music-playback-controller.js','group-listening-session.js']){
          await groupReader.addScriptTag({path:fileURLToPath(new URL('../shared/js/phone/'+file,import.meta.url))});
        }
        await groupReader.addScriptTag({path:fileURLToPath(new URL('../shared/js/group-governance.js',import.meta.url))});
        const originalGroups=await groupReader.evaluate(()=>localStorage.getItem('phone_groups'));
        try{
          await groupReader.evaluate(()=>{
            localStorage.setItem('phone_groups',JSON.stringify([{id:'gMusicQA',ownerId:'__user',members:[{id:'r1',name:'同名'},{id:'r2',name:'同名'}]}]));
            const audio=document.createElement('audio');audio.loop=true;document.body.append(audio);
            window.__testGroupAudio=audio;
            window.__testGroupSession=window.MAOGroupListeningSession.createForGroup({audio,getGroupId:()=> 'gMusicQA',hasRole:id=>['r1','r2'].includes(id)});
          });
          const sessionCheck=await groupReader.evaluate(async id=>{
            const api=window.__testGroupSession,audio=window.__testGroupAudio;
            const check=(v,m)=>{if(!v)throw Error(m);};
            const tracks=window.MAOMusicCatalogAdapter.listTracks().tracks.map(t=>t.id);
            let s=api.start().snapshot;check(s.status==='selecting','selecting');
            s=api.setQueue(s,tracks).snapshot;s=api.selectTrack(s,id).snapshot;
            check(!api.join(s,'同名').ok,'nickname must not join');s=api.join(s,'r2').snapshot;
            check(s.participants.join(',')==='__user,r2','exact participant');
            s=(await api.play(s)).snapshot;
            check(s?.playing&&!audio.paused&&audio.currentSrc.startsWith('blob:'),'real group playback');
            check(!s.roleAudioDelivered&&!s.remoteSynchronized,'no fabricated delivery');
            s=api.seek(s,audio.duration/2).snapshot;check(Math.abs(s.currentTime-audio.duration/2)<0.15,'native seek');
            s=api.pause(s).snapshot;check(s.status==='paused'&&audio.paused,'native pause');
            s=(await api.play(s)).snapshot;check(s?.playing&&!audio.paused,'native resume');
            return {trackId:s.trackId,participants:s.participants};
          },trackId);
          assert.deepEqual(sessionCheck,{trackId,participants:['__user','r2']});
          assert.equal(await page.evaluate(id=>playTrack(id),trackId),false,'group holds the same native lock');
          await page.evaluate(()=>{
            const rows=JSON.parse(localStorage.getItem('phone_groups'));rows[0].members.pop();
            localStorage.setItem('phone_groups',JSON.stringify(rows));
          });
          await groupReader.waitForFunction(()=>window.__testGroupSession.getSnapshot()===null&&window.__testGroupAudio.paused&&!window.__testGroupAudio.getAttribute('src'));
          await page.waitForFunction(async()=>!(await navigator.locks.query()).held.some(l=>l.name==='maomao-native-music-playback-v1'));
          assert.equal(await page.evaluate(id=>playTrack(id),trackId),true,'membership invalidation released the shared lock');
          await page.evaluate(()=>{musicPauseNative();musicDiscardAudioSource();});
          assert.deepEqual(groupErrors,[]);
        }finally{
          await groupReader.evaluate(raw=>{
            window.__testGroupSession?.destroy();
            if(raw===null)localStorage.removeItem('phone_groups');else localStorage.setItem('phone_groups',raw);
          },originalGroups);
        }
      }finally{await groupReader.close();await context.unroute(readerUrl,readerRoute);}
      // M06: exercise the actual chat page, not the isolated preview.
      const chat=await context.newPage(), chatErrors=[];
      chat.on('pageerror',err=>chatErrors.push(err.message));
      await chat.route('**/*',route=>route.request().url().startsWith(new URL(BASE).origin+'/')?route.continue():route.abort());
      await page.evaluate(()=>{
        localStorage.setItem('phone_groups',JSON.stringify([{id:'g-listen-ui',name:'一起听歌测试群',ownerId:'__user',members:[{id:'listen-role',name:'测试成员'}]}]));
        localStorage.setItem('ai_custom_characters',JSON.stringify([{id:'listen-role',name:'测试成员',persona:'测试角色，喜欢音乐，回复简短自然。',tone:'简短自然',replyBubbleMode:'single'}]));
      });
      try{
        await chat.goto(new URL('/chat/chat/chat-detail.html?id=g-listen-ui',BASE).href);
        const entry=chat.locator('[data-group-listening-entry]');
        await entry.waitFor({state:'attached'});
        assert.equal(await chat.locator('[data-group-listening-audio]').count(),0,'lazy creation');
        await chat.locator('#plus-action-btn').click();
        await chat.locator('[data-plus-section="group"]').click();
        await entry.click();
        const dialog=chat.locator('#groupListeningDialog'),strip=chat.locator('#groupListeningStrip');
        await dialog.waitFor({state:'visible'});
        const track=dialog.locator('[data-glisten-track]');
        assert.equal(await track.count(),2);
        await track.first().check();await track.nth(1).check();
        // Repeat the synthetic one-second WAV during UI interaction; no real media mocked.
        await chat.evaluate(()=>{const original=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(this.dataset.groupListeningAudio)this.loop=true;return original.call(this);};});
        await dialog.locator('[data-glisten-start]').click();
        await strip.waitFor({state:'visible'});
        await chat.waitForFunction(()=>{const a=document.querySelector('[data-group-listening-audio]');return a&&!a.paused;});
        assert.ok((await strip.boundingBox()).height<=60,'compact playback card');
        assert.ok(await chat.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
        await chat.evaluate(()=>localStorage.removeItem('api_settings'));
        const sourceBefore=await chat.evaluate(()=>document.querySelector('[data-group-listening-audio]').src);
        await chat.locator('#chat-input').fill('听歌时继续发送聊天消息');
        await chat.locator('#chat-form button[type=submit]').click();
        await chat.waitForFunction(()=>JSON.parse(localStorage.getItem('chat_history_g-listen-ui')||'[]').some(m=>m.role==='user'&&m.text==='听歌时继续发送聊天消息'&&m.sendFailedReason==='missing-api-key'));
        assert.deepEqual(await chat.evaluate(()=>{const a=document.querySelector('[data-group-listening-audio]');return {paused:a.paused,src:a.src};}),{paused:false,src:sourceBefore},'real chat send/storage path does not interrupt playback');
        // Real chat success path, only a local intercepted synthetic API response.
        const mockBase=new URL('/__test_group_listen_api__/v1',BASE).href;
        let mockPosts=0;
        const capturedMusicTurns=[];
        const musicSection='【本轮一起听歌 · 公开曲目状态】';
        await chat.route(mockBase+'/**',async route=>{
          const request=route.request();
          if(request.method()!=='POST')return route.abort();
          const payload=request.postDataJSON();mockPosts++;
          if(payload.stream!==false&&Array.isArray(payload.messages))capturedMusicTurns.push(payload.messages);
          const answer='这首歌很适合今天。';
          return payload.stream===false?route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:answer}}]})}):
            route.fulfill({status:200,contentType:'text/event-stream',body:'data: '+JSON.stringify({choices:[{delta:{content:answer}}]})+'\n\ndata: [DONE]\n\n'});
        });
        await chat.evaluate(base=>localStorage.setItem('api_settings',JSON.stringify({apiKey:'synthetic-test-only',baseUrl:base,model:'test-model'})),mockBase);
        try{
          await chat.locator('#chat-input').fill('测试正常回复期间的播放');
          await chat.locator('#chat-form button[type=submit]').click();
          await chat.waitForFunction(()=>JSON.parse(localStorage.getItem('chat_history_g-listen-ui')||'[]').some(m=>m.role==='assistant'&&String(m.memberId)==='listen-role'&&String(m.text).includes('这首歌很适合今天')),null,{timeout:25000});
          assert.ok(mockPosts>0,'actual chat request reached only synthetic route');
          assert.ok(capturedMusicTurns.length>0);
          assert.ok(!capturedMusicTurns[0][0].content.includes(musicSection),'unjoined role receives no music context');
          assert.deepEqual(await chat.evaluate(()=>{const a=document.querySelector('[data-group-listening-audio]');return {paused:a.paused,src:a.src};}),{paused:false,src:sourceBefore},'successful assistant reply does not interrupt audio');
          // Exercise the real outbound payload once at the representative phone width.
          if(width===390){
            const marker=musicSection;
            const sendAndCapture=async text=>{
              await chat.waitForFunction(()=>!aiSending&&!singleChatSendPending);
              const oldCount=capturedMusicTurns.length;
              await chat.locator('#chat-input').fill(text);
              await chat.locator('#chat-form button[type=submit]').click();
              await chat.waitForFunction(t=>{
                const rows=JSON.parse(localStorage.getItem('chat_history_g-listen-ui')||'[]');
                const i=rows.findIndex(m=>m.role==='user'&&m.text===t);
                return i>=0&&rows.slice(i+1).some(m=>m.role==='assistant'&&String(m.memberId)==='listen-role'&&String(m.text).includes('这首歌很适合今天'));
              },text,{timeout:25000});
              const fresh=capturedMusicTurns.slice(oldCount);
              assert.ok(fresh.length>0,'actual outbound request');
              return fresh.find(messages=>messages.some(m=>m.role==='user'&&JSON.stringify(m.content).includes(text)))?.[0]?.content||fresh[0][0].content;
            };
            await chat.waitForFunction(()=>!aiSending&&!singleChatSendPending);
            await strip.getByRole('button',{name:'打开一起听歌详情'}).click();
            await dialog.locator('[data-glisten-member="listen-role"]').click();
            await dialog.getByRole('button',{name:'关闭',exact:true}).click();
            const joined=await sendAndCapture('参与成员讨论当前歌曲');
            assert.ok(joined.includes(marker));
            assert.ok(joined.includes('本机正在播放'));
            assert.ok(joined.includes('测试角色，喜欢音乐，回复简短自然。'),'original persona preserved');
            assert.ok(joined.includes('本机播放不表示角色真实接收或听到了音频'));
            const title=await strip.locator('strong').textContent();
            const line=joined.split('\n').find(x=>x.startsWith('{"曲名":'));
            assert.ok(line,'bounded metadata JSON in actual request');
            assert.equal(JSON.parse(line).曲名,title);
            await strip.getByRole('button',{name:'暂停',exact:true}).click();
            await chat.waitForFunction(()=>document.querySelector('[data-group-listening-audio]').paused);
            const paused=await sendAndCapture('暂停后的歌曲状态');
            assert.ok(paused.includes(marker)&&paused.includes('本机已暂停'));
            await strip.getByRole('button',{name:'播放',exact:true}).click();
            await chat.waitForFunction(()=>!document.querySelector('[data-group-listening-audio]').paused);
            await strip.getByRole('button',{name:'打开一起听歌详情'}).click();
            await dialog.locator('[data-glisten-member="listen-role"]').click();
            await dialog.getByRole('button',{name:'关闭',exact:true}).click();
            const left=await sendAndCapture('退出听歌后的正常聊天');
            assert.ok(!left.includes(marker),'revoked participant receives no music metadata');
            assert.deepEqual(await chat.evaluate(()=>{const a=document.querySelector('[data-group-listening-audio]');return {paused:a.paused,src:a.src};}),{paused:false,src:sourceBefore});
          }
        }finally{await chat.evaluate(()=>localStorage.removeItem('api_settings'));await chat.unroute(mockBase+'/**');}
        await strip.getByRole('button',{name:'打开一起听歌详情'}).click();
        await dialog.locator('[data-glisten-member="listen-role"]').click();
        assert.equal(await dialog.locator('[data-glisten-member="listen-role"]').getAttribute('aria-pressed'),'true');
        await dialog.getByRole('button',{name:'暂停',exact:true}).click();
        await chat.waitForFunction(()=>document.querySelector('[data-group-listening-audio]').paused);
        await dialog.getByRole('button',{name:'播放',exact:true}).click();
        await chat.waitForFunction(()=>!document.querySelector('[data-group-listening-audio]').paused);
        const previousSource=await chat.evaluate(()=>document.querySelector('[data-group-listening-audio]').src);
        await dialog.getByRole('button',{name:'下一首'}).click();
        await chat.waitForFunction(old=>{const a=document.querySelector('[data-group-listening-audio]');return a&&!a.paused&&a.src!==old;},previousSource);
        // Native ended events, not synthetic dispatch: the last song stops; previous then ends and advances.
        await chat.evaluate(()=>{const a=document.querySelector('[data-group-listening-audio]');a.loop=false;a.currentTime=Math.max(0,a.duration-0.08);});
        await chat.waitForFunction(()=>{const a=document.querySelector('[data-group-listening-audio]');return a&&a.ended&&a.paused;});
        assert.equal(await strip.locator('small').textContent(),'已播完');
        const finalSource=await chat.evaluate(()=>document.querySelector('[data-group-listening-audio]').src);
        await dialog.getByRole('button',{name:'上一首'}).click();
        await chat.waitForFunction(old=>{const a=document.querySelector('[data-group-listening-audio]');return a&&!a.paused&&a.src!==old;},finalSource);
        const firstSource=await chat.evaluate(()=>{const a=document.querySelector('[data-group-listening-audio]');a.loop=false;a.currentTime=Math.max(0,a.duration-0.08);return a.src;});
        await chat.waitForFunction(old=>{const a=document.querySelector('[data-group-listening-audio]');return a&&!a.paused&&a.src!==old;},firstSource);
        assert.equal(await dialog.getByRole('button',{name:'下一首'}).isDisabled(),true,'queue advanced to final song');
        // A removed participant invalidates the actual mounted view, including the audio DOM.
        await page.evaluate(()=>{const groups=JSON.parse(localStorage.getItem('phone_groups'));groups[0].members=[];localStorage.setItem('phone_groups',JSON.stringify(groups));});
        await chat.locator('[data-group-listening-audio]').waitFor({state:'detached'});
        await strip.waitFor({state:'hidden'});await dialog.waitFor({state:'hidden'});
        await chat.waitForFunction(async()=>!(await navigator.locks.query()).held.some(l=>l.name==='maomao-native-music-playback-v1'));
        await page.evaluate(()=>{const groups=JSON.parse(localStorage.getItem('phone_groups'));groups[0].members=[{id:'listen-role',name:'测试成员'}];localStorage.setItem('phone_groups',JSON.stringify(groups));});
        await chat.locator('#plus-action-btn').click();await chat.locator('[data-plus-section="group"]').click();await entry.click();
        await dialog.locator('[data-glisten-track]').first().check();await dialog.locator('[data-glisten-start]').click();
        await chat.waitForFunction(()=>{const a=document.querySelector('[data-group-listening-audio]');return a&&!a.paused;});
        await strip.getByRole('button',{name:'打开一起听歌详情'}).click();await dialog.locator('[data-glisten-end]').click();
        await strip.waitFor({state:'hidden'});assert.equal(await chat.locator('[data-group-listening-audio]').count(),0);
        await chat.reload();
        await entry.waitFor({state:'attached'});
        assert.equal(await chat.locator('[data-group-listening-audio]').count(),0,'refresh never automatically restarts a previous session');
        await chat.goto(new URL('/chat/chat/chat-detail.html?id=listen-role',BASE).href);
        assert.equal(await chat.locator('[data-group-listening-entry]').count(),0,'single-chat unaffected');
        assert.equal(await chat.locator('[data-feat="music-app"]').count(),1,'original music shortcut retained');
        assert.deepEqual(chatErrors,[]);
      }finally{await chat.close();}
      assert.deepEqual(pageErrors, [], 'no uncaught JS errors at ' + width);
      console.log('PASS Chromium ' + width + 'px: viewport, import Blob, reload, playback, cover, LRC, playlist');
      console.log('SEALED_BROWSER_CHECKPOINT:'+width);
    } finally {
      await context.close();
    }
  }
  // M09: actual desktop shell, imported audio, and stale picker transaction.
  // Separate fresh browser context: no real account, no external request.
  const desktop = await browser.newContext({viewport:{width:1280,height:800},serviceWorkers:'block'});
  const desktopErrors=[];
  try {
    const origin=new URL(BASE).origin;
    await desktop.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
    const library=await desktop.newPage();
    library.on('pageerror',err=>desktopErrors.push(err.message));
    await library.goto(BASE,{waitUntil:'domcontentloaded'});
    await library.locator('.music-import-link').waitFor({state:'visible'});
    await library.evaluate(()=>showSetting());
    const chooser=library.waitForEvent('filechooser');
    await library.locator('#settingSheet [aria-label^="导入音乐"]').click();
    await (await chooser).setFiles([
      {name:'QA 桌面第一首.wav',mimeType:'audio/wav',buffer:makeWav(220)},
      {name:'QA 桌面第二首.wav',mimeType:'audio/wav',buffer:makeWav(330)}
    ]);
    // Import automatically starts playback and the music app advances on ended.
    // Wait for its asynchronous duration writes, then explicitly release the
    // library's origin-wide playback lock before starting the group session.
    await library.waitForFunction(()=>{
      const rows=JSON.parse(localStorage.getItem('music_local_tracks')||'[]');
      return rows.length===2&&rows.every(t=>Number(t.durSec)>0)&&musicDurationPending.size===0;
    },null,{timeout:15000});
    await library.evaluate(()=>{musicPauseNative();musicDiscardAudioSource();});
    await library.waitForFunction(async()=>{
      const state=musicController.getState();
      return !state.pending&&!state.playing&&state.trackId===null&&window.audio.paused&&
        !(await navigator.locks.query()).held.some(l=>l.name==='maomao-native-music-playback-v1');
    },null,{timeout:10000});
    const tracks=await library.evaluate(()=>{
      localStorage.setItem('phone_groups',JSON.stringify([{id:'g-listen-desktop',name:'桌面一起听歌测试群',ownerId:'__user',members:[{id:'desktop-role',name:'测试成员'}]}]));
      localStorage.setItem('ai_custom_characters',JSON.stringify([{id:'desktop-role',name:'测试成员',persona:'测试角色，喜欢音乐。',tone:'简短自然'}]));
      localStorage.removeItem('api_settings');
      return JSON.parse(localStorage.getItem('music_local_tracks'));
    });
    console.log('SEALED_BROWSER_CHECKPOINT:500'); // desktop import/seed complete
    const chat=await desktop.newPage();
    chat.on('pageerror',err=>desktopErrors.push(err.message));
    await chat.goto(new URL('/chat/chat/chat-detail.html?id=g-listen-desktop',BASE).href);
    const entry=chat.locator('[data-group-listening-entry]'),dialog=chat.locator('#groupListeningDialog'),strip=chat.locator('#groupListeningStrip');
    await entry.waitFor({state:'attached'});
    await chat.locator('#plus-action-btn').click();
    await chat.locator('[data-plus-section="group"]').click();
    await entry.click();
    await dialog.waitFor({state:'visible'});
    const assertDialogLayout=async()=>{
      const geometry=await chat.evaluate(()=>{
        const b=document.getElementById('groupListeningDialog').getBoundingClientRect();
        return {left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:b.width,viewWidth:innerWidth,viewHeight:innerHeight,overflow:document.documentElement.scrollWidth-innerWidth};
      });
      assert.ok(geometry.width>0&&geometry.width<=431&&geometry.left>=0&&geometry.right<=geometry.viewWidth+1&&geometry.top>=0&&geometry.bottom<=geometry.viewHeight+1,'desktop dialog contained');
      assert.ok(geometry.overflow<=1,'desktop shell has no horizontal overflow');
    };
    await assertDialogLayout();
    await chat.waitForFunction(()=>document.querySelectorAll('#groupListeningDialog [data-glisten-track]').length===2);
    const firstId=tracks[0].id,secondId=tracks[1].id;
    assert.ok(firstId&&secondId&&firstId!==secondId);
    const trackRow=id=>dialog.locator('[data-glisten-track='+JSON.stringify(id)+']');
    await trackRow(firstId).check();
    await chat.evaluate(()=>{const original=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(this.dataset.groupListeningAudio)this.loop=true;return original.call(this);};});
    await dialog.locator('[data-glisten-start]').click();
    await strip.waitFor({state:'visible'});
    await chat.waitForFunction(()=>{const a=document.querySelector('[data-group-listening-audio]');return a&&!a.paused;});
    const source=await chat.evaluate(()=>document.querySelector('[data-group-listening-audio]').src);
    const card=await chat.evaluate(()=>{
      const strip=document.getElementById('groupListeningStrip'),host=document.querySelector('.phone-mockup');
      const b=strip.getBoundingClientRect(),h=host.getBoundingClientRect();
      return {contained:host.contains(strip)&&b.left>=h.left-1&&b.right<=h.right+1,height:b.height,overflow:document.documentElement.scrollWidth-innerWidth};
    });
    assert.ok(card.contained&&card.height>0&&card.height<=60&&card.overflow<=1,'compact card stays within desktop chat shell');
    await strip.getByRole('button',{name:'打开一起听歌详情'}).click();
    await assertDialogLayout();
    // Metadata changes in the sibling music library refresh the mounted card
    // even without a session revision. They never switch the native source.
    await library.evaluate(id=>{
      const rows=JSON.parse(localStorage.getItem('music_local_tracks'));
      const row=rows.find(x=>x.id===id);row.name='QA 已更新曲名';
      localStorage.setItem('music_local_tracks',JSON.stringify(rows));
    },firstId);
    await chat.waitForFunction(()=>document.querySelector('#groupListeningStrip strong')?.textContent==='QA 已更新曲名');
    assert.equal(await dialog.locator('.glisten-now strong').textContent(),'QA 已更新曲名');
    assert.deepEqual(await chat.evaluate(()=>{const a=document.querySelector('[data-group-listening-audio]');return {src:a.src,paused:a.paused};}),{src:source,paused:false});
    await dialog.getByRole('button',{name:'重新选歌'}).click();
    await trackRow(secondId).check();
    console.log('SEALED_BROWSER_CHECKPOINT:600'); // desktop initial playback and layout complete
    // Simulate a catalog update in the real sibling music document. Only
    // synthetic fixture metadata is altered; no real audio data is deleted.
    await library.evaluate(id=>{
      const rows=JSON.parse(localStorage.getItem('music_local_tracks'));
      localStorage.setItem('music_local_tracks',JSON.stringify(rows.filter(x=>x.id!==id)));
    },secondId);
    await dialog.locator('[data-glisten-start]').click();
    await trackRow(secondId).waitFor({state:'detached'});
    await trackRow(firstId).waitFor({state:'visible'});
    assert.equal(await dialog.locator('[data-glisten-track]').count(),1,'stale selection removed in actual picker');
    assert.equal(await trackRow(firstId).isChecked(),true);
    assert.equal(await dialog.isVisible(),true,'changed queue must be confirmed again');
    assert.deepEqual(await chat.evaluate(()=>{const a=document.querySelector('[data-group-listening-audio]');return {src:a.src,paused:a.paused};}),{src:source,paused:false},'rejected stale queue does not stop the previous song');
    console.log('SEALED_BROWSER_CHECKPOINT:700'); // stale selection rejected, source preserved
    await library.evaluate(rows=>localStorage.setItem('music_local_tracks',JSON.stringify(rows)),tracks);
    await chat.waitForFunction(()=>window.MAOMusicCatalogAdapter.listTracks().tracks?.length===2);
    await dialog.getByRole('button',{name:'关闭',exact:true}).click();
    await strip.getByRole('button',{name:'打开一起听歌详情'}).click();
    await dialog.getByRole('button',{name:'重新选歌'}).click();
    await trackRow(firstId).waitFor({state:'visible'});
    await trackRow(secondId).waitFor({state:'visible'});
    assert.equal(await dialog.locator('[data-glisten-track]').count(),2,'restored catalog is selectable');
    await trackRow(firstId).uncheck();
    await trackRow(secondId).check();
    await dialog.locator('[data-glisten-start]').click();
    await chat.waitForFunction(old=>{const a=document.querySelector('[data-group-listening-audio]');return a&&!a.paused&&a.src!==old;},source);
    await chat.locator('#chat-input').fill('桌面听歌时保留输入');
    await strip.getByRole('button',{name:'打开一起听歌详情'}).click();
    await dialog.locator('[data-glisten-end]').click();
    await strip.waitFor({state:'hidden'});
    assert.equal(await chat.locator('#chat-input').inputValue(),'桌面听歌时保留输入');
    assert.equal(await chat.locator('[data-group-listening-audio]').count(),0);
    await chat.waitForFunction(async()=>!(await navigator.locks.query()).held.some(l=>l.name==='maomao-native-music-playback-v1'));
    assert.deepEqual(desktopErrors,[]);
    console.log('PASS Chromium desktop 1280px: real group picker, stale catalog, valid replacement, draft and resource cleanup');
  } finally {await desktop.close();}
  console.log('PASS all 375/390/430px browser checks (screenshots in ' + shots + ')');
} catch (error) {
  console.error('FAIL MUSIC Chromium QA:', error && error.stack || error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
  if (shots && process.env.MUSIC_QA_KEEP_SHOTS !== '1') await rm(shots, { recursive:true, force:true });
}
