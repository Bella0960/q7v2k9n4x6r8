/** MUSIC-UI-001 / DATA-003: run with node --test tests/music-data-integrity.test.mjs.
 * Source contracts plus isolated execution of production storage guards.
 * They do not replace Vite/Chromium/real-device acceptance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext, Script } from 'node:vm';

const music = readFileSync(new URL('../music/music.html', import.meta.url), 'utf8');
const backup = readFileSync(new URL('../settings/js/backup.js', import.meta.url), 'utf8');

test('MUSIC-UI-001: actual embedded player script is syntactically valid', () => {
  const scripts = [...music.matchAll(/<script\s*>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'one inline native player script');
  assert.doesNotThrow(() => new Script(scripts[0][1], { filename: 'music/music.html:inline' }));
});

test('MUSIC-UI-001: native-status ownership, favorites and playback remain', () => {
  assert.match(music, /src="\.\.\/shared\/js\/statusbar-control\.js"/);
  assert.doesNotMatch(music, /<(?:div|header)\b[^>]*data-maomao-system-statusbar\b/);
  assert.match(music, /location\.hash === '#favorites'\) showFav\(\)/);
  assert.match(music, /id="audioPlayer"/);
  assert.match(music, /await getAudioBlob\(t\.id\)/);
  assert.match(music, /window\.audio\.play\(\)/);
});

test('MUSIC-IMPORT-002: existing settings opens multi-file MP3 picker without removing earlier controls', () => {
  const setting = music.slice(music.indexOf('<div class="modal-sheet" id="settingSheet">'),
    music.indexOf('<!-- 歌单管理', music.indexOf('<div class="modal-sheet" id="settingSheet">')));
  assert.match(setting, /aria-label="导入音乐，支持批量选择 MP3 等音频文件"/);
  assert.match(setting, /onclick="openMusicImportFromSettings\(\)"/);
  assert.match(setting, /睡眠定时/);
  assert.match(setting, /自动滚动歌词/);
  assert.match(music, /id="musicImport"[^>]*accept="[^"]*audio\/\*[^"]*\.mp3[^"]*"[^>]*multiple/);
  assert.match(music, /function openMusicImportFromSettings\(\)\s*\{[\s\S]*?getElementById\('musicImport'\)\.click\(\);[\s\S]*?closeSetting\(\)/);
  assert.match(music, /Array\.from\(e\.target\.files \|\| \[\]\)/);
});

test('MUSIC-IMPORT-002: tapping a song image uploads only to that song and preserves Blob backing', () => {
  assert.match(music, /function pickMusicCoverForTrack\(trackId\)/);
  assert.match(music, /musicPendingCoverTrackId = trackId/);
  assert.match(music, /var file = e\.target\.files\[0\], t = getTrackById\(trackId\)/);
  assert.match(music, /ownerType: 'music-cover', ownerId: t\.id/);
  for (const id of ['recent-list', 'search-results', 'favList']) {
    assert.ok(music.includes("'" + id + "'"), 'cover picker list missing: ' + id);
  }
  assert.match(music, /event\.stopPropagation\(\)/);
  assert.match(music, /musicWriteMap\(MUSIC_COVERS_KEY, covers\)/);
  assert.match(music, /musicMedia\.putBlob\(file,/);
});

test('MUSIC-UI-001: import persists binary then catalog, rejects quota errors, preserves references', () => {
  const start = music.indexOf("document.getElementById('musicImport').addEventListener");
  const end = music.indexOf('// ===== 断点续播 =====', start);
  assert.ok(start > -1 && end > start);
  const code = music.slice(start, end);
  assert.ok(code.indexOf('await putAudioBlob(') < code.indexOf('saveLocalTracksMeta(localMeta.concat([track]))'));
  assert.match(code, /catch \(err\) \{\s*try \{ await deleteAudioBlob\(tid\)/);
  assert.match(music, /if \(musicMetaReadFailure\) throw new Error/);
  const play = music.slice(music.indexOf('async function playTrack(trackId)'), music.indexOf('function prevTrack()'));
  assert.doesNotMatch(play, /removeTrackFromFav\(/);
  assert.doesNotMatch(play, /removeTrackFromRecent\(/);
  assert.match(play, /try \{ await window\.audio\.play\(\); \}/);
});

test('MUSIC-UI-001: real cover assets and no base64 music image persistence', () => {
  assert.match(music, /music_cover_assets_v1/);
  assert.match(music, /new window\.PhoneStorage\.MediaRepository\(\)/);
  assert.match(music, /musicMedia\.putBlob\(file,/);
  assert.match(music, /musicMedia\.getBlob\(id\)/);
  assert.doesNotMatch(music, /reader\.readAsDataURL\(file\)/);
  assert.match(music, /maomao:music:playback/);
  assert.match(music, /window\.audio\.paused/);
});

test('DATA-003: full backup stores actual audio bytes and fails atomically on large blobs', () => {
  const target = backup.slice(backup.indexOf("db: 'maomao-media-store'"), backup.indexOf("db: 'maomao_diary_photo_store_v1'"));
  assert.match(target, /atomicExport:\s*true/);
  assert.match(target, /store:\s*'audio'.*blobFields:\s*\['blob'\]/s);
  assert.doesNotMatch(target, /excludeFields:\s*\['blob'\]/);
  assert.match(backup, /missingAudioIds\.length === 0/);
  assert.match(backup, /backupMissingMusicBytes\(obj\)/);
});

test('DATA-003: actual import guard refuses legacy metadata-only music backups', () => {
  const start = backup.indexOf('function musicBackupBlobEncoded(value)');
  const end = backup.indexOf('function handleImportFile(file)', start);
  assert.ok(start > 0 && end > start);
  const fn = backup.slice(start, end);
  const catalog = JSON.stringify([{ id:'local_1', source:'local', name:'preserved' }]);
  const run = (archive) => runInNewContext(fn + '\nbackupMissingMusicBytes(archive)', { archive });
  assert.equal(run({data:{music_local_tracks:catalog},indexedDB:{'maomao-media-store':{audio:[{id:'local_1'}]}}}), true);
  assert.equal(run({data:{music_local_tracks:catalog},indexedDB:{}}), true);
  assert.equal(run({data:{music_local_tracks:catalog},indexedDB:{'maomao-media-store':{audio:[{id:'local_1',blob:'AQID'}]}}}), false);
  assert.equal(run({data:{music_local_tracks:'{broken'},indexedDB:{}}), true);
  assert.equal(run({data:{},indexedDB:{}}), false);
  assert.equal(run({data:{},indexedDB:{'maomao-media-store':{audio:[{id:'local_legacy'}]}}}), true,
    'legacy archive with audio metadata but no catalog must not overwrite existing audio');
  assert.equal(run({data:{music_local_tracks:catalog},indexedDB:{'maomao-media-store':{audio:[{id:'local_1',blob:'###'}]}}}), true,
    'corrupt audio encoding must be rejected before restore clears the store');
});

test('MUSIC-UI-001: actual saveLocalTracksMeta reports quota errors instead of swallowing them', () => {
  const start = music.indexOf('function saveLocalTracksMeta(list)');
  const end = music.indexOf('// 合并本地曲目', start);
  assert.ok(start > 0 && end > start);
  const fn = music.slice(start, end);
  const cache = new Map();
  const store = { setItem:(k,v)=>cache.set(k,v), getItem:k=>cache.get(k) ?? null };
  runInNewContext('let musicMetaReadFailure = null;\n' + fn + '\nsaveLocalTracksMeta([{id:"local_a"}])', {localStorage:store, LOCAL_TRACKS_KEY:'music_local_tracks'});
  assert.equal(JSON.parse(cache.get('music_local_tracks'))[0].id,'local_a');
  assert.throws(() => runInNewContext('let musicMetaReadFailure = null;\n' + fn + '\nsaveLocalTracksMeta([{id:"local_b"}])',
    {localStorage:{setItem(){throw new Error('QuotaExceededError')},getItem(){return null}}, LOCAL_TRACKS_KEY:'music_local_tracks'}), /QuotaExceededError/);
});

test('DATA-003: cover/background references cannot silently make a scoped backup complete', () => {
  assert.match(backup, /var missingMusicMedia = \[\]/);
  assert.match(backup, /missingMusicMedia\.length === 0/);
  assert.match(backup, /missingMusicMedia: missingMusicMedia\.length/);
  assert.match(backup, /backupMissingMusicImages\(obj\)/);
  assert.match(backup, /music_background_asset_v1/);
  assert.match(backup, /music_cover_assets_v1/);
});

test('DATA-003: an actual missing music image blocks restore; complete media allows restore', () => {
  const start = backup.indexOf('function musicBackupBlobEncoded(value)');
  const end = backup.indexOf('function backupMissingMusicBytes(obj)', start);
  assert.ok(start > 0 && end > start);
  const fn = backup.slice(start, end);
  const run = archive => runInNewContext(fn + '\nbackupMissingMusicImages(archive)', { archive });
  const asset = 'as_' + 'A'.repeat(32);
  const refs = {
    music_cover_assets_v1: JSON.stringify({ local_1: asset }),
    music_background_asset_v1: asset
  };
  assert.equal(run({ data: refs, indexedDB: {} }), true);
  assert.equal(run({ data: refs, indexedDB: { 'maomao-assets': { blobs: [{assetId:asset,blob:'X'}] } } }), true,
    'corrupt cover encoding must be rejected before restore');
  assert.equal(run({ data: refs, indexedDB: { 'maomao-assets': { blobs: [{assetId:asset,blob:'AAE='}] } } }), false);
  assert.equal(run({ data: { music_cover_assets_v1: '{invalid' }, indexedDB: {} }), true);
  assert.equal(run({ data: {}, indexedDB: {} }), false);
});

test('MUSIC-UI-001: LRC, image backgrounds and playlists persist through dedicated keys', () => {
  for (const key of ['music_lyrics_v1','music_playlists_v1','music_background_asset_v1']) {
    assert.ok(music.includes(key), key);
  }
  assert.match(music, /function parseMusicLyrics\(text\)/);
  assert.match(music, /musicWriteMap\(MUSIC_LYRICS_KEY, lyricMap\)/);
  assert.match(music, /musicWriteMap\(MUSIC_PLAYLISTS_KEY, playlists\)/);
  assert.match(music, /musicMedia\.putBlob\(file,/);
  assert.match(music, /function showMusicPlaylists\(/);
  assert.match(music, /id="lyricsUpload"/);
});

test('MUSIC-UI-001: imported filenames are escaped everywhere and wiping audio needs confirmation', () => {
  for (const fn of ['renderRecent','renderAlbum','renderSearch','renderFav']) {
    const at = music.indexOf('function ' + fn + '(');
    assert.ok(at >= 0, fn);
    assert.match(music.slice(at, at + 1400), /musicSafeText\(t\.name\)/);
  }
  assert.match(music, /window\.confirm\('这会清除本设备的本地歌曲/);
  assert.match(music, /await clearAudioStore\(\)/);
  assert.match(music, /musicMedia\.removeRef\(assetId, ownerType, ownerId\)/);
});

test('MUSIC-LISTEN-001: no imaginary sync—native playback and role invites have explicit delivery states', () => {
  assert.match(music, /MUSIC_ROLE_INVITES_KEY\s*=\s*'music_listen_invites_v1'/);
  assert.match(music, /MUSIC_PLAYBACK_STATE_KEY\s*=\s*'music_playback_state_v1'/);
  assert.match(music, /window\.MAOMAOMusicInvites = Object\.freeze/);
  assert.match(music, /window\.PhoneStorage\.getCharacters\(\)/);
  assert.match(music, /status:\s*'queued_local', delivered:\s*false, accepted:\s*false/);
  assert.match(music, /roleJoined:\s*false/);
  assert.match(music, /maomao:music:invite-created/);
  assert.match(music, /maomao:music:playback/);
  assert.doesNotMatch(music, /status:\s*'accepted'/);
});

test('MUSIC-UI-001: saved covers appear as original images in every song list without inline Base64', () => {
  assert.match(music, /function musicApplyTrackThumbnails\(container\)/);
  assert.match(music, /musicApplyTrackThumbnails\(recentList\)/);
  assert.match(music, /musicApplyTrackThumbnails\(searchResults\)/);
  assert.match(music, /musicApplyTrackThumbnails\(box\)/);
  assert.match(music, /data-music-track-id/);
  assert.match(music, /musicCoverUrlCache\.size > 64/);
  assert.match(music, /URL\.revokeObjectURL\(url\)/);
  assert.match(music, /event\.persisted/);
});

test('MUSIC-UI-001: no fake statusbar and local audio can resume after reload', () => {
  assert.doesNotMatch(music, /class="statusbar status-bar" data-maomao-system-statusbar/);
  assert.doesNotMatch(music, /<div class="phone-camera"><\/div>/);
  assert.match(music, /src="\.\.\/shared\/js\/statusbar-control\.js"/);
  const play = music.slice(music.indexOf('async function togglePlay()'), music.indexOf('// 音频事件', music.indexOf('async function togglePlay()')));
  assert.match(play, /selected\.source === 'local' && !currentBlobUrl/);
  assert.match(play, /await playTrack\(selected\.id\)/);
  assert.match(play, /resumeTime > 0/);
});

test('MUSIC-UI-001: local toast exists and favorites/progress fail closed without false success', () => {
  assert.match(music, /function toast\(message\)/);
  assert.match(music, /aria-live/);
  assert.match(music, /if \(!saveFavIds\(next\)\) \{ updateHeartIcon\(\); return; \}/);
  const start = music.indexOf('function musicReadIdList(key, kind)');
  const end = music.indexOf('function removeTrackFromRecent(id)', start);
  assert.ok(start >= 0 && end > start);
  const source = music.slice(start, end);
  const values = new Map([['music_fav_list', '["demo_2"]'], ['music_recent', '["demo_3"]']]);
  let quota = false;
  const warnings = [];
  const localStorage = {
    getItem(k) { return values.has(k) ? values.get(k) : null; },
    setItem(k, v) { if (quota) throw Error('QuotaExceededError'); values.set(k, v); }
  };
  const api = runInNewContext(
    'let musicRecentReadError=null;let musicFavReadError=null;\n' +
    source + '\n({readFavIds,saveFavIds,readRecentIds,saveRecentIds})',
    { localStorage, musicWarnOnce: (key, message) => warnings.push(message) }
  );
  assert.equal(api.readFavIds()[0], 'demo_2');
  quota = true;
  assert.equal(api.saveFavIds(['demo_2', 'local_1']), false);
  assert.equal(values.get('music_fav_list'), '["demo_2"]');
  quota = false;
  values.set('music_fav_list', '{invalid');
  assert.equal(api.readFavIds().length, 0);
  assert.equal(api.saveFavIds(['local_1']), false);
  assert.equal(values.get('music_fav_list'), '{invalid', 'must not overwrite damaged archive');

  const stateStart = music.indexOf('function saveState()');
  const stateEnd = music.indexOf('function loadState()', stateStart);
  assert.ok(stateStart >= 0 && stateEnd > stateStart);
  const originalState = JSON.stringify({ id:'local_1', time:20 });
  const saveState = runInNewContext(music.slice(stateStart, stateEnd) + '\nsaveState',
    { localStorage: {
        getItem:k => k === 'music_state' ? originalState : null,
        setItem() { throw Error('QuotaExceededError'); }
      }, musicWarnOnce: (key, message) => warnings.push(message),
      tracks:[{id:'local_1'}],currentIdx:0,playing:true,window:{audio:{currentTime:35}}
    });
  assert.equal(saveState(), false);
  assert.ok(warnings.some(message => message.includes('保存失败')));
});
