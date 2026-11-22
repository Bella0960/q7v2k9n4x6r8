import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const character = readFileSync(new URL('../worldbook/characters/characters.html', import.meta.url), 'utf8');
const music = readFileSync(new URL('../music/music.html', import.meta.url), 'utf8');

test('character archive uses native phone status and compact headers across all subviews', () => {
  assert.doesNotMatch(character, /<div class="status-bar">\s*<span>09:41<\/span>/);
  assert.match(character, /\.phone-mockup > \.view-section > \.header\s*\{\s*padding:\s*8px 20px !important;/);
  for (const id of ['listView', 'profileView', 'editorView', 'relationshipView', 'lifeView']) {
    assert.match(character, new RegExp('id="' + id + '"'));
  }
  for (const id of ['profileContent', 'roleListContainer', 'btnUseFromProfile']) {
    assert.match(character, new RegExp('id="' + id + '"'));
  }
});

test('music removes fake phone chrome and keeps a slim single-level mini-player and tabbar', () => {
  assert.doesNotMatch(music, /data-maomao-system-statusbar/);
  assert.doesNotMatch(music, /<div class="phone-camera"><\/div>/);
  assert.match(music, /\.mini-player\s*\{\s*bottom:\s*calc\(47px \+ env\(safe-area-inset-bottom, 0px\)\);/);
  assert.match(music, /\.tabbar\s*\{\s*min-height:\s*44px;/);
  for (const id of ['audioPlayer', 'miniPlayIcon', 'page-home', 'musicPlaylistList']) {
    assert.match(music, new RegExp('id="' + id + '"'));
  }
  assert.match(music, /onclick="showNP\(\)"/);
  assert.match(music, /onclick="event\.stopPropagation\(\);togglePlay\(\)"/);
});
