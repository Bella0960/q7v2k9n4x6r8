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
  assert.match(music, /id="musicImport"[^>]*accept="audio\/\*,[^"]*\.wav/);
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

test('MUSIC-UI-001: now-playing group centers on tall screens and scrolls safely on short phones', () => {
  const start = music.indexOf('<div class="np-main">');
  const end = music.indexOf('<!-- /.np-main -->', start);
  assert.ok(start > 0 && end > start, 'one vertical now-playing body wrapper');
  const group = music.slice(start, end);
  for (const selector of ['id="npCover"', 'id="lyricView"', 'class="np-song-row"', 'id="progressBar"', 'class="np-controls"']) {
    assert.ok(group.includes(selector), 'now playing item stays in centered group: ' + selector);
  }
  assert.match(music, /\.np-main\s*\{[\s\S]*?justify-content:\s*center/);
  assert.match(music, /\.np-main\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(music, /@media\s*\(max-height:\s*690px\)/);
  assert.match(music, /\.np-main\s+\.np-cover\s*\{/);
  assert.match(music, /\.np-main\s+#lyricView\s*\{/);
});
