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
