import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const music = readFileSync(new URL('../music/music.html', import.meta.url), 'utf8');

test('MUSIC-UI-001: light default contains no built-in dark image display paths', () => {
  assert.match(music, /--music-placeholder:\s*#ebebef/i);
  assert.match(music, /class="music-placeholder-art"/);
  assert.doesNotMatch(music, /<img src="covers\/(?:charcoal|nightfall|grey-skies|deep-blue|song-default)\.jpg"/);
  assert.match(music, /\.mini-player\s*\{[\s\S]*?background:\s*rgba\(255,255,255,\.95\)/);
});

test('MUSIC-UI-001: native local import and playback remain wired', () => {
  assert.match(music, /id="musicImport"[^>]*accept="audio\/\*"/);
  assert.match(music, /class="music-import-link"[^>]*musicImport/);
  assert.match(music, /const MEDIA_DB_NAME\s*=\s*'maomao-media-store'/);
  assert.match(music, /const LOCAL_TRACKS_KEY\s*=\s*'music_local_tracks'/);
  assert.match(music, /async function playTrack\(trackId\)/);
  assert.match(music, /await getAudioBlob\(t\.id\)/);
  assert.match(music, /id="coverUpload"/);
});

test('MUSIC-UI-001: self-contained playback features are still available', () => {
  for (const fn of ['toggleLyrics', 'togglePlay', 'nextTrack', 'prevTrack', 'showFav', 'showQueue']) {
    assert.match(music, new RegExp('function ' + fn + '\\('));
  }
  assert.match(music, /id="npOverlay"/);
  assert.match(music, /id="audioPlayer"/);
  assert.match(music, /id="progressBar"/);
});
