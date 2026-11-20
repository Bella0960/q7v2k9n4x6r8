import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const music = readFileSync(new URL('../music/music.html', import.meta.url), 'utf8');
const begin = music.indexOf('  function musicDisplayArtist(t) {');
const end = music.indexOf('  function isLocalTrackPlayable(t) {', begin);
assert.ok(begin > 0 && end > begin, 'real music duration helpers must exist');

function makeApp(ports = {}) {
  const state = {
    catalog: (ports.catalog || []).map(t => ({...t})),
    live: ports.live || [],
    saved: 0,
    rendered: 0,
    oldWarnings: [],
    activeUrls: new Set()
  };
  let urlIndex = 0;
  const mockUrl = {
    createObjectURL() {
      const url = 'blob:music-duration-test-' + (++urlIndex);
      state.activeUrls.add(url);
      return url;
    },
    revokeObjectURL(url) { state.activeUrls.delete(url); }
  };
  class TestAudio {
    duration = Number(ports.duration ?? 225.8);
    load() {
      if (!this.src) return;
      queueMicrotask(() => {
        if (ports.audioError) this.onerror?.(new Error('invalid audio'));
        else this.onloadedmetadata?.();
      });
    }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
  }
  const fn = new Function(
    'Audio','URL','getAudioBlob','readLocalTracksMeta','saveLocalTracksMeta',
    'getTrackById','renderRecent','renderAlbum','renderSearch','renderFav',
    'document','musicWarnOnce','tracks','musicMetaReadFailure',
    music.slice(begin, end) +
    '\nreturn { musicDisplayArtist, musicFormatDuration, musicTrackDurationLabel, musicProbeAudioDuration, musicScheduleLocalDuration, musicRecoverExistingDurations };'
  );
  const app = fn(
    ports.Audio || TestAudio, mockUrl,
    ports.getBlob || (async () => null),
    () => state.catalog.map(t => ({ ...t })),
    next => { if (ports.failSave) throw new Error('quota'); state.catalog = next; state.saved++; },
    id => state.live.find(t => t.id === id),
    () => state.rendered++, () => state.rendered++, () => state.rendered++,
    () => state.rendered++,
    { getElementById: () => null },
    (key, message) => state.oldWarnings.push(message),
    state.live, null
  );
  return { app, state };
}

test('local artist label is compatible with previous import names and normal demo artists', () => {
  const { app } = makeApp();
  assert.equal(app.musicDisplayArtist({source:'local',artist:'本地导入'}),'未知歌手');
  assert.equal(app.musicDisplayArtist({source:'local',artist:'未知歌手'}),'未知歌手');
  assert.equal(app.musicDisplayArtist({source:'local',artist:''}),'未知歌手');
  assert.equal(app.musicDisplayArtist({source:'remote',artist:'Brambles'}),'Brambles');
});

test('duration is true mm:ss, hours supported, and missing/invalid is --:--', () => {
  const { app } = makeApp();
  assert.equal(app.musicFormatDuration(225.9),'03:45');
  assert.equal(app.musicFormatDuration(3661),'01:01:01');
  for (const unknown of [0,-1,Infinity,NaN,'本地',null,undefined])
    assert.equal(app.musicFormatDuration(unknown),'--:--');
  assert.equal(app.musicTrackDurationLabel({source:'local',dur:'本地',durSec:0}), '--:--');
  assert.equal(app.musicTrackDurationLabel({source:'local',dur:'本地',durSec:225}), '03:45');
  assert.equal(app.musicTrackDurationLabel({source:'remote',dur:'4:21',durSec:261}), '4:21');
});

test('metadata-only audio probe returns real length, never plays and revokes blob URL', async () => {
  let audioPlays = 0;
  class FakeAudio {
    duration = 225.9;
    preload = '';
    removeAttribute(attr) { if (attr==='src') this.src=''; }
    load() { if (this.src) queueMicrotask(() => this.onloadedmetadata?.()); }
    play() { audioPlays++; throw new Error('should not play'); }
  }
  const {app,state} = makeApp({Audio:FakeAudio});
  const seconds = await app.musicProbeAudioDuration(new Blob([new Uint8Array([1,2,3])]));
  assert.equal(seconds,225.9);
  assert.equal(audioPlays,0);
  assert.equal(state.activeUrls.size,0);
});

test('metadata extraction errors retain --:-- without inventing a song duration', async () => {
  const old = {id:'local_old',source:'local',artist:'本地导入',dur:'本地',durSec:0};
  const {app,state} = makeApp({live:[old],catalog:[old],audioError:true});
  const ok = await app.musicScheduleLocalDuration(old,new Blob(['bytes']));
  assert.equal(ok,false);
  assert.equal(state.saved,0);
  assert.equal(state.catalog[0].dur,'本地');
  assert.equal(app.musicTrackDurationLabel(old),'--:--');
  assert.equal(state.activeUrls.size,0);
});

test('metadata commit updates only matching local record and retains unrelated songs', async () => {
  const older={id:'local_A',source:'local',artist:'本地导入',dur:'本地',durSec:0};
  const another={id:'local_B',source:'local',artist:'Other artist',dur:'01:11',durSec:71};
  const {app,state}=makeApp({live:[older,another],catalog:[older,another],duration:225.4});
  const ok=await app.musicScheduleLocalDuration(older,new Blob(['bytes']));
  assert.equal(ok,true);
  assert.equal(state.catalog[0].dur,'03:45');
  assert.equal(state.catalog[0].durSec,225);
  assert.equal(state.catalog[0].artist,'本地导入','legacy metadata artist must remain untouched');
  assert.deepEqual(state.catalog[1],another,'unrelated song must remain byte-identical');
  assert.equal(older.dur,'03:45');
  assert.equal(app.musicDisplayArtist(older),'未知歌手');
  assert.equal(state.saved,1);
  assert.equal(state.activeUrls.size,0);
});

test('metadata write failures preserve prior catalog and are reported without losing playable audio', async () => {
  const old={id:'local_Q',source:'local',artist:'未知歌手',dur:'--:--',durSec:0};
  const {app,state}=makeApp({live:[old],catalog:[old],duration:45,failSave:true});
  const ok=await app.musicScheduleLocalDuration(old,new Blob(['bytes']));
  assert.equal(ok,false);
  assert.equal(state.catalog[0].durSec,0);
  assert.equal(old.durSec,0);
  assert.equal(state.saved,0);
  assert.ok(state.oldWarnings.some(x=>x.includes('时长暂未保存')));
});

test('markup uses display helpers throughout recent/favorite/album/mini player and no duration placeholders leak', () => {
  assert.match(music, /renderRecent\(\)[\s\S]*?musicSafeText\(musicDisplayArtist\(t\)\)/);
  assert.match(music, /renderRecent\(\)[\s\S]*?musicSafeText\(musicTrackDurationLabel\(t\)\)/);
  assert.match(music, /function renderFav\(\)[\s\S]*?musicSafeText\(musicTrackDurationLabel\(t\)\)/);
  assert.match(music, /document\.getElementById\('miniArtist'\)\.textContent = musicDisplayArtist\(t\)/);
  assert.match(music, /musicScheduleLocalDuration\(track, audioBlob\)/);
  assert.match(music, /musicRecoverExistingDurations\(\);/);
  assert.match(music, /\.track-item \.t-dur \{[\s\S]*?font-variant-numeric: tabular-nums/);
});
