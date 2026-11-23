import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const client = read('shared/js/cloud-push-client.js');
const page = read('settings/cloud-push.html');
const settings = read('settings/settings.html');
const backup = read('settings/js/backup.js');
const worker = read('worker/lib/app.js');
const sw = read('sw.js');

test('restored push settings are opt-in and preserve existing page navigation', () => {
  assert.match(settings, /window\.location\.href='cloud-push\.html'/);
  assert.match(page, /shared\/js\/cloud-push-client\.js/);
  assert.match(page, /MaomaoCloud\.mountSettings\(\)/);
  assert.match(page, /id="cloudPushToggle"/);
  assert.match(page, /id="cloudTestRow"/);
  assert.match(sw, /'\.\/settings\/cloud-push\.html'/);
  assert.match(sw, /'\.\/shared\/js\/cloud-push-client\.js'/);
});

test('push requests carry same-origin account context and independent device authentication', () => {
  assert.match(client, /meta\[name="mao-account-id"\]/);
  assert.match(client, /X-MAO-Account-Context/);
  assert.match(client, /credentials: 'same-origin'/);
  assert.match(client, /'X-Device-Auth'/);
  assert.match(client, /DEVICE_STORAGE_KEY = 'cloud_device_v1'/);
  assert.match(client, /localStorage\.getItem\(DEVICE_STORAGE_KEY\) !== serialized/);
  assert.match(worker, /assertAccountPageContext\(request, path\)/);
  assert.match(worker, /path === '\/api\/push\/subscriptions'/);
  assert.match(worker, /path === '\/api\/push\/test'/);
});

test('device identity never travels in full/scoped JSON backups, even with API-key export', () => {
  assert.match(backup, /function neverBackupKey\(key\)[\s\S]{0,100}\^cloud_device_v/);
  assert.match(backup, /function snapshot\([\s\S]*?cloud_device_v\[0-9\]/);
  assert.match(backup, /function restore\(snap\)[\s\S]*?var localDevice/);
  assert.match(backup, /Object\.keys\(snap\)\.forEach\(function \(k\) \{\s*if \(\/\^cloud_device_v/);
  assert.match(backup, /function verifyRestore\(snap\)[\s\S]*?filter\(function\(k\) \{ return !\/\^cloud_device_v/);
});

test('cloud background model generation is not falsely advertised as ready', () => {
  assert.match(worker, /autonomousMessageGenerationReady: false/);
  assert.match(page, /关闭应用后生成/);
  assert.match(page, /尚未实现/);
});
