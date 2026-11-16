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
  const scripts = [...music.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
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
  const start = backup.indexOf('function backupMissingMusicBytes(obj)');
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
  const start = backup.indexOf('function backupMissingMusicImages(obj)');
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
