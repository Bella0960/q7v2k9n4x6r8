import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const iconSettings = readFileSync(new URL('../settings/icon-settings.html', import.meta.url), 'utf8');
const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const backup = readFileSync(new URL('../settings/js/backup.js', import.meta.url), 'utf8');
const serviceWorker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

test('icon preset controls live at the bottom of the existing icon upload page', () => {
  const uploadList = iconSettings.indexOf('id="iconList"');
  const presets = iconSettings.indexOf('<div class="group-title">图标套装</div>');
  assert.ok(uploadList >= 0, 'existing per-app icon upload list must remain');
  assert.ok(presets > uploadList, 'preset manager must follow the existing upload rows');
  assert.match(iconSettings, /id="saveIconPresetBtn"/);
  assert.match(iconSettings, /id="iconPresetList"/);
  assert.match(iconSettings, /id="resetAllIconsBtn"/);
  assert.match(iconSettings, /data-act="change"/);
  assert.match(iconSettings, /data-act="restore"/);
});


test('icon upload rows are generated from every launcher app instead of a separate hard-coded list', () => {
  assert.match(iconSettings, /fetch\('\.\.\/index\.html'/);
  assert.match(iconSettings, /querySelectorAll\('button\[data-drag\^="app_"\]'\)/);
  assert.match(iconSettings, /\.app-name/);
  assert.match(iconSettings, /\.app-icon svg/);
  assert.match(iconSettings, /var APPS = \[\]/);
  assert.doesNotMatch(iconSettings, /id:\s*'app_shopadmin'/,
    'the removed 商店管理 tile must not remain as a stale upload row');

  const openTags = [...home.matchAll(/<button\b[^>]*\bdata-drag="app_[^"]+"[^>]*>/g)];
  assert.ok(openTags.length > 0, 'launcher must expose app tiles');
  const ids = [];
  for (const match of openTags) {
    const tag = match[0];
    const id = tag.match(/\bdata-drag="(app_[^"]+)"/)?.[1];
    const end = home.indexOf('</button>', match.index);
    assert.ok(id && end > match.index, 'each launcher app tile must be a complete button');
    const block = home.slice(match.index, end);
    assert.match(tag, /\bdata-name="[^"]+"/, id + ' must keep its data-name fallback');
    assert.match(block, /class="app-name"/, id + ' must expose its visible label');
    assert.match(block, /class="app-icon"/, id + ' must expose its icon wrapper');
    assert.match(block, /<svg\b/, id + ' must expose a default SVG icon');
    ids.push(id);
  }
  assert.equal(new Set(ids).size, ids.length, 'launcher app IDs must be unique');
  for (const id of [
    'app_theme_store', 'app_footprint', 'app_takeout', 'app_couple', 'app_growth',
    'app_companion', 'app_live_room', 'app_poster', 'app_envelope',
    'app_novelstudio', 'app_date'
  ]) {
    assert.ok(ids.includes(id), id + ' must remain represented in the launcher inventory');
  }
});

test('preset metadata stays small while image copies use the existing IndexedDB wallpaper store', () => {
  assert.match(iconSettings, /PRESET_LIST_KEY = 'home_icon_presets_v1'/);
  assert.match(iconSettings, /ACTIVE_PRESET_KEY = 'home_icon_active_preset_v1'/);
  assert.match(iconSettings, /PRESET_IMAGE_PREFIX = 'home_icon_preset_img_v1_'/);
  assert.match(iconSettings, /store\.saveByKey\(presetImageKey\(presetId, snapshot\[i\]\.appId\), snapshot\[i\]\.dataUrl\)/);
  assert.match(iconSettings, /store\.getByKey\(presetImageKey\(preset\.id, appId\)\)/);
  assert.match(backup, /Object\.keys\(localStorage\)/, 'preset metadata is included in the existing full localStorage backup');
  assert.match(backup, /\{ store: 'wallpapers', keyPath: null \}/, 'preset image records are included in the existing wallpaper IndexedDB backup');
});

test('switching and resetting icons can roll back, while deleting a preset does not delete current icons', () => {
  assert.match(iconSettings, /async function applyIconPreset\(preset\)/);
  assert.match(iconSettings, /await restoreIconSnapshot\(snapshot, previousActiveId\)/);
  assert.match(iconSettings, /async function resetAllIconsToDefault\(\)/);
  const deleteStart = iconSettings.indexOf('async function deleteIconPreset(preset)');
  const deleteEnd = iconSettings.indexOf('async function resetAllIconsToDefault()', deleteStart);
  assert.ok(deleteStart >= 0 && deleteEnd > deleteStart);
  const deleteBody = iconSettings.slice(deleteStart, deleteEnd);
  assert.match(deleteBody, /store\.removeByKey\(presetImageKey\(/);
  assert.doesNotMatch(deleteBody, /store\.removeByKey\(KEY_PREFIX \+/,
    'deleting a saved preset must not remove the currently applied icon images');
  assert.match(home, /iconEl\.style\.removeProperty\('background-image'\)/,
    'desktop refresh must clear the previous custom image when a preset restores the default icon');
  assert.match(home, /svg\.style\.removeProperty\('display'\)/,
    'desktop refresh must show the original SVG icon again');
});

test('service worker cache version changes so installed PWA users receive the updated icon page', () => {
  assert.match(serviceWorker, /const CACHE_NAME = 'phone-app-pwa-v174'/);
});
