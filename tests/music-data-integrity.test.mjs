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
const backupModules = readFileSync(new URL('../settings/js/backup-modules.js', import.meta.url), 'utf8');

test('MUSIC-UI-001: actual embedded player script is syntactically valid', () => {
  const scripts = [...music.matchAll(/<script\s*>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'one inline native player script');
  assert.doesNotThrow(() => new Script(scripts[0][1], { filename: 'music/music.html:inline' }));
});

test('MUSIC-UI-001: statusbar #301, favorites #273 and native playback remain', () => {
  assert.match(music, /src="\.\.\/shared\/js\/statusbar-control\.js"/);
  assert.match(music, /data-maomao-system-statusbar/);
  assert.match(music, /location\.hash === '#favorites'\) showFav\(\)/);
  assert.match(music, /id="audioPlayer"/);
  assert.match(music, /await getAudioBlob\(t\.id\)/);
  assert.match(music, /window\.audio\.play\(\)/);
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
  assert.match(music, /data-maomao-system-statusbar/);
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

test('MUSIC-UI-001: global statusbar visibly responds and local song can resume after reload', () => {
  assert.match(music, /class="statusbar status-bar" data-maomao-system-statusbar/);
  assert.match(music, /function updateMusicStatusClock\(\)/);
  assert.doesNotMatch(music, /\.statusbar\s*\{\s*display:\s*none/);
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
      tracks:[{id:'local_1'}],currentIdx:0,playing:true,musicPlaybackQueue:null,
      window:{audio:{currentTime:35}}
    });
  assert.equal(saveState(), false);
  assert.ok(warnings.some(message => message.includes('保存失败')));
});

test('MUSIC-UI-001: timeupdate stores once per 5-second bucket, while seek stores immediately', () => {
  const start = music.indexOf("window.audio.addEventListener('timeupdate'");
  const end = music.indexOf('// 点击"词"按钮切换歌词显示', start);
  assert.ok(start >= 0 && end > start, 'production timeupdate handler must exist');
  const seekStart = music.indexOf("window.audio.addEventListener('seeked'", end);
  const seekEnd = music.indexOf('// 播完自动切下一首', seekStart);
  assert.ok(seekStart >= 0 && seekEnd > seekStart, 'production seeked handler must exist');
  const handlers = {};
  let writes = 0;
  const audio = {
    currentTime: 5, duration: 100,
    addEventListener(type, handler) { handlers[type] = handler; }
  };
  const elements = {
    curTime: { textContent: '' }, totalTime: { textContent: '' },
    progressFill: { style: {} }
  };
  const document = {
    getElementById(id) { return elements[id]; },
    querySelector() { return { style: {} }; },
    querySelectorAll() { return []; }
  };
  runInNewContext(
    "let musicLastPersistedProgressKey = ''; let currentIdx = 0;\n" +
    music.slice(start, end) + '\n' + music.slice(seekStart, seekEnd),
    {
      window: { audio, lastLyricLine: -1 }, tracks: [{ id: 'local_1' }],
      document, saveState() { writes++; }
    }
  );
  assert.equal(typeof handlers.timeupdate, 'function');
  assert.equal(typeof handlers.seeked, 'function');
  for (let i = 0; i < 6; i++) handlers.timeupdate();
  assert.equal(writes, 1, 'multiple timeupdate notifications within same second must not write repeatedly');
  audio.currentTime = 6;
  handlers.timeupdate();
  assert.equal(writes, 1);
  audio.currentTime = 10;
  handlers.timeupdate();
  assert.equal(writes, 2);
  audio.currentTime = 12.5;
  handlers.seeked();
  assert.equal(writes, 3, 'seeking must persist without waiting for another five-second interval');
  audio.duration = Infinity;
  audio.currentTime = 15;
  handlers.timeupdate();
  assert.equal(writes, 3, 'invalid metadata must not write or render an invalid percentage');
});

test('MUSIC-UI-001: playlist edits keep original song IDs, fail closed and emit only committed events', () => {
  const mapStart = music.indexOf('function musicReadMap(key)');
  const mapEnd = music.indexOf('async function musicReleaseOldAsset(', mapStart);
  const apiStart = music.indexOf('let musicPlaylistActiveName = null');
  const apiEnd = music.indexOf('function musicPlaylistAction(', apiStart);
  assert.ok(mapStart > 0 && mapEnd > mapStart && apiStart > 0 && apiEnd > apiStart);
  const production = music.slice(mapStart, mapEnd) + '\n' +
    music.slice(apiStart, apiEnd) + '\nwindow.MAOMAOMusicPlaylists';
  const records = new Map();
  const events = [];
  let quota = false;
  const api = runInNewContext(production, {
    MUSIC_PLAYLISTS_KEY: 'music_playlists_v1',
    localStorage: {
      getItem: key => records.get(key) ?? null,
      setItem: (key, value) => {
        if (quota) throw new Error('QuotaExceededError');
        records.set(key, value);
      }
    },
    window: {
      dispatchEvent: event => events.push(event.detail),
      addEventListener() {}, removeEventListener() {}
    },
    CustomEvent: class {
      constructor(type, options) { this.type = type; this.detail = options.detail; }
    },
    getTrackById: id => ['local_1', 'local_2'].includes(id) ? {id} : null
  });
  assert.equal(api.addTrack('清晨', 'local_1'), true);
  assert.equal(api.addTrack('清晨', 'local_1'), false, 'duplicate add must not create new event');
  assert.equal(events.length, 1);
  assert.equal(api.addTrack('清晨', 'local_2'), true);
  assert.equal(api.rename('清晨', '通勤'), true);
  assert.equal(JSON.stringify(Array.from(api.getTrackIds('通勤'))), '["local_1","local_2"]');
  assert.equal(api.addTrack('周末', 'local_1'), true);
  const beforeCollision = records.get('music_playlists_v1');
  const eventCount = events.length;
  assert.throws(() => api.rename('通勤', '周末'), /同名歌单/);
  assert.equal(records.get('music_playlists_v1'), beforeCollision);
  assert.equal(events.length, eventCount);
  assert.equal(api.removeTrack('通勤', 'local_1'), true);
  assert.equal(JSON.stringify(Array.from(api.getTrackIds('通勤'))), '["local_2"]');
  assert.equal(api.removePlaylist('通勤'), true);
  assert.equal(api.getTrackIds('通勤'), null);
  assert.equal(JSON.stringify(Array.from(api.getTrackIds('周末'))), '["local_1"]');
  const beforeQuota = records.get('music_playlists_v1');
  const countBeforeQuota = events.length;
  quota = true;
  assert.throws(() => api.addTrack('周末', 'local_2'), /QuotaExceededError/);
  quota = false;
  assert.equal(records.get('music_playlists_v1'), beforeQuota);
  assert.equal(events.length, countBeforeQuota, 'no success event when saving fails');
  records.set('music_playlists_v1', '{bad');
  assert.throws(() => api.addTrack('周末', 'local_2'));
  assert.equal(records.get('music_playlists_v1'), '{bad', 'corrupted old playlists never overwritten');
  records.delete('music_playlists_v1');
  assert.equal(api.addTrack('__proto__', 'local_1'), true, 'untrusted name must not mutate Object prototype');
  assert.equal(JSON.parse(records.get('music_playlists_v1'))['__proto__'][0], 'local_1');
  assert.ok(events.every(event => event.version === 1 && event.savedLocal === true));
  const source = music.slice(apiStart, apiEnd);
  assert.doesNotMatch(source, /deleteAudioBlob|clearAudioStore|removeTrackFromFav/);
});

test('MUSIC-UI-001: playlist management is hidden in the existing panel with real controls', () => {
  assert.match(music, /id="musicPlaylistView"/);
  assert.match(music, /id="musicPlaylistTitle"/);
  assert.match(music, /onclick="musicPlaylistBack\(\)"/);
  assert.match(music, /onclick="musicPlaylistRefresh\(\)"/);
  assert.match(music, /function musicPlaylistRename\(name\)/);
  assert.match(music, /function musicPlaylistRemoveTrack\(name, trackId\)/);
  assert.match(music, /function musicPlaylistDelete\(name\)/);
  assert.match(music, /className = 'music-playlist-toolbar'/);
  assert.match(music, /className = 'music-playlist-track'/);
  assert.match(music, /window\.confirm\('删除歌单/);
  assert.match(music, /function musicPlaylistCommit\(data, action, name, extra\)/);
  assert.match(music, /maomao:music:playlist-changed/);
});

test('MUSIC-UI-001: existing scoped backup includes playlist/lyrics/cover references but not chat', () => {
  const registry = runInNewContext(backupModules + '\nwindow.MAOMAOBackupRegistry', { window:{} });
  const musicKeys = [
    'music_local_tracks', 'music_playlists_v1', 'music_lyrics_v1',
    'music_cover_assets_v1', 'music_background_asset_v1',
    'music_recent', 'music_fav_list', 'music_listen_invites_v1',
    'music_playback_state_v1'
  ];
  const example = Object.fromEntries(musicKeys.map(key => [key, 'saved']));
  example.chat_history_001 = 'private-chat';
  for (const key of musicKeys) assert.equal(registry.belongsTo('music', key), true, key);
  const result = registry.selectSnapshot('music', example);
  assert.equal(Object.keys(result).length, musicKeys.length);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'chat_history_001'), false);
  // Important limitation: music-only backups do not yet include the referenced maomao-assets image Blob store.
  // Existing exporter correctly marks such archives incomplete; never describe them as restored/tested.
});

test('MUSIC-UI-001: actual queue traversal follows selected playlist through repeat and edits', () => {
  const start = music.indexOf('let musicPlaybackQueue = null;');
  const end = music.indexOf('window.isShuffle = false;', start);
  const navigationStart = music.indexOf('function musicNavigateTrack(direction, fromEnded)');
  const navigationEnd = music.indexOf('async function togglePlay()', navigationStart);
  assert.ok(start > -1 && end > start && navigationStart > -1 && navigationEnd > navigationStart);
  const tracks = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  const lists = { '晨间': ['a', 'c'], '周末': ['b', 'd', 'unavailable'] };
  const listeners = {};
  const calls = [];
  const events = [];
  const window = {
    isShuffle: false, loopState: 0,
    MAOMAOMusicPlaylists: { getTrackIds: name =>
      Object.prototype.hasOwnProperty.call(lists, name) ? lists[name] : null },
    addEventListener: (type, cb) => (listeners[type] ||= []).push(cb),
    removeEventListener() {},
    dispatchEvent: event => events.push(event.detail)
  };
  const api = runInNewContext(
    'let currentIdx = 0;\n' + music.slice(start, end) + '\n' +
    music.slice(navigationStart, navigationEnd) + '\n' +
    '({ select:musicQueueAssign, previous:prevTrack, next:nextTrack,' +
    ' state:()=>window.MAOMAOMusicQueue.getState(),' +
    ' setCurrent:id=>{currentIdx=tracks.findIndex(t=>t.id===id)} })',
    { window, tracks, CustomEvent: class {
        constructor(type, opts) { this.type = type; this.detail = opts.detail; }
      }, getTrackById: id => tracks.find(t => t.id === id) || null,
      playTrack: (id, opts) => { calls.push({id, opts}); return Promise.resolve(true); },
      toast() {}, Math: Object.assign(Object.create(Math), {random: () => 0}) }
  );
  api.setCurrent('a');
  api.select('a', {playlistName:'晨间'});
  assert.equal(api.state().playlistName, '晨间');
  assert.equal(Array.from(api.state().trackIds).join(','), 'a,c');
  assert.equal(api.next(false), true);
  assert.equal(calls.at(-1).id, 'c');
  assert.equal(calls.at(-1).opts.playlistName, '晨间');
  api.setCurrent('c');
  assert.equal(api.next(true), false, 'loop off must stop at playlist end');
  window.loopState = 1;
  assert.equal(api.next(true), true);
  assert.equal(calls.at(-1).id, 'a', 'playlist repeat wraps inside playlist');
  window.isShuffle = true;
  api.setCurrent('a');
  api.next(false);
  assert.equal(calls.at(-1).id, 'c', 'shuffle cannot escape playlist');
  window.isShuffle = false;
  lists['晨间'] = ['a', 'missing', 'c'];
  assert.equal(Array.from(api.state().trackIds).join(','), 'a,c');
  listeners['maomao:music:playlist-changed'][0]({
    detail: {action:'renamed',previousName:'晨间',name:'午后'}
  });
  lists['午后'] = lists['晨间']; delete lists['晨间'];
  assert.equal(api.state().playlistName, '午后');
  listeners['maomao:music:playlist-changed'][0]({
    detail: {action:'track-removed',name:'午后',trackId:'a'}
  });
  assert.equal(api.state().playlistName, null, 'removing current song releases queue context');
  api.setCurrent('b');
  api.select('b', {playlistName:'周末'});
  assert.equal(Array.from(api.state().trackIds).join(','), 'b,d');
  listeners['maomao:music:playlist-changed'][0]({
    detail: {action:'playlist-removed',name:'周末'}
  });
  assert.equal(api.state().playlistName, null, 'deleting active playlist returns to library');
  assert.ok(events.every(event => event.savedLocal === false && event.version === 1));
});

test('MUSIC-UI-001: playback context changes only after real audio success, and song menu remains on failure', () => {
  const start = music.indexOf('async function playTrack(trackId, options)');
  const end = music.indexOf('function musicNavigateTrack(direction, fromEnded)', start);
  assert.ok(start > -1 && end > start);
  const play = music.slice(start, end);
  assert.ok(play.indexOf('await window.audio.play()') < play.indexOf('musicQueueAssign(t.id, options)'),
    'do not switch queue if new source cannot actually play');
  assert.match(play, /return false;/);
  assert.match(play, /return true;/);
  assert.match(music, /playTrack\(t\.id, \{ playlistName:name \}\)\.then\(function\(started\)/);
  assert.match(music, /if \(started\) document\.getElementById\('musicPlaylistView'\)\.style\.display = 'none'/);
  assert.match(music, /nextTrack\(true\)/);
  assert.match(music, /if \(fromEnded && index === ids\.length - 1 && window\.loopState !== 1\)/);
});

test('MUSIC-UI-001: playlist session survives refresh, while legacy or stale queue state safely falls back', () => {
  const start = music.indexOf('function saveState()');
  const end = music.indexOf('// ===== Now Playing 三点菜单 =====', start);
  assert.ok(start > 0 && end > start);
  const code = music.slice(start, end);
  const tracks = [
    {id:'local_1', name:'本地歌曲', artist:'用户导入', source:'local'},
    {id:'local_2', name:'另一首', artist:'用户导入', source:'local'}
  ];
  const currentPlaylist = { name:'清晨' };
  const storage = new Map();
  const mock = {
    localStorage: {
      getItem: k => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, v)
    },
    tracks, currentIdx:0, playing:true, musicPlaybackQueue:currentPlaylist,
    window:{
      audio:{currentTime:23,src:''},
      MAOMAOMusicPlaylists:{
        getTrackIds:name => name === '清晨' ? ['local_1', 'local_2'] : null
      }
    },
    musicQueuePublish() {}, musicWarnOnce() {},
    getTrackById:id => tracks.find(t => t.id === id) || null,
    updateHeartIcon() {}, renderAlbum() {}, renderTrackLyrics() {},
    document:{
      getElementById() {return {textContent:''};}
    }
  };
  const runner = (payload, playlist) => runInNewContext(
    'let currentIdx=0;let musicPlaybackQueue=' + (playlist ? '{name:"清晨"}' : 'null') + ';\n' +
    code + '\n({saveState, loadState, state:()=>musicPlaybackQueue})',
    { ...mock, musicPlaybackQueue:undefined }
  );
  const saveFns = runner();
  assert.equal(saveFns.saveState(), true);
  const saved = JSON.parse(storage.get('music_state'));
  assert.equal(saved.id, 'local_1');
  assert.equal(saved.playlistName, '清晨');
  const restored = runner();
  restored.loadState();
  assert.equal(restored.state().name, '清晨');
  storage.set('music_state', JSON.stringify({id:'local_1', idx:0, time:9, playing:false}));
  const legacy = runner();
  legacy.loadState();
  assert.equal(legacy.state(), null, 'old records have no queue and must still load');
  storage.set('music_state', JSON.stringify({id:'local_1', playlistName:'已删除歌单', time:8}));
  const stale = runner();
  stale.loadState();
  assert.equal(stale.state(), null, 'deleted playlist must not be resurrected');
  assert.match(music, /playlistName:musicPlaybackQueue \? musicPlaybackQueue\.name : null/);
  assert.match(music, /await playTrack\(selected\.id,\s*musicPlaybackQueue \? \{ playlistName:musicPlaybackQueue\.name \} : undefined\)/);
});
