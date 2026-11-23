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
  assert.ok(client.includes("DEVICE_STORAGE_PREFIX = 'cloud_device_v2:'"));
  assert.ok(client.includes("LEGACY_DEVICE_STORAGE_KEY = 'cloud_device_v1'"));
  assert.ok(client.includes("localStorage.getItem(key) !== serialized"));
  assert.ok(client.includes('await requestJson(\'/api/push/subscriptions\', { device: legacy })'));
  assert.ok(client.includes('SUBSCRIPTION_IN_USE'));
  assert.ok(client.includes('status.subscriptionEndpoints.indexOf(currentSubscription.endpoint)'));
  assert.match(worker, /assertAccountPageContext\(request, path\)/);
  assert.match(worker, /path === '\/api\/push\/subscriptions'/);
  assert.match(worker, /path === '\/api\/push\/test'/);
});

test('device identity never travels in backups or full restores', () => {
  assert.ok(backup.includes('function neverBackupKey(key)'));
  assert.ok(backup.includes('^cloud_device_v[0-9]+(?::|$)'));
  assert.ok(backup.includes('function snapshot(dropCaches, dropSecrets)'));
  assert.ok(backup.includes('var localDeviceKeys = {}'));
  assert.ok(backup.includes('Object.keys(localDeviceKeys).forEach'));
  assert.ok(backup.includes('function verifyRestore(snap)'));
  assert.ok(backup.includes('function restoreScoped(snap, scope)'));
});

test('failed revoke and unsubscribe do not falsely claim successful disconnection', () => {
  assert.ok(client.includes("await requestJson('/api/devices/revoke'"));
  assert.ok(client.indexOf("await requestJson('/api/devices/revoke'") <
    client.indexOf("clearDevice();\n    return { disconnected: true"));
  assert.ok(client.includes("error.code !== 'SUBSCRIPTION_NOT_FOUND'"));
});
test('cloud background model generation is not falsely advertised as ready', () => {
  assert.match(worker, /autonomousMessageGenerationReady: false/);
  assert.match(page, /关闭应用后生成/);
  assert.match(page, /尚未实现/);
});
