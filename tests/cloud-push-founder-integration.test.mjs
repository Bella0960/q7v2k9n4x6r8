import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const settings = read('settings/settings.html');
const pushPage = read('settings/cloud-push.html');
const client = read('shared/js/cloud-push-client.js');
const sw = read('sw.js');
const worker = read('worker.js');
const app = read('worker/lib/app.js');
const wranglerSource = read('wrangler.jsonc');
const wrangler = JSON.parse(wranglerSource.replace(/^\s*\/\/.*$/gm, ''));

test('founder 001 settings shows a real push route with a versioned connected client', () => {
  assert.match(settings, /window\.location\.href='cloud-push\.html'/);
  assert.match(pushPage, /id="cloudPushToggle"/);
  assert.match(pushPage, /id="cloudTestRow"/);
  assert.match(pushPage, /MaomaoCloud\.mountSettings\(\)/);
  assert.match(pushPage, /cloud-push-client\.js\?v=20261114v2/);
  assert.match(sw, /phone-app-pwa-v226/);
  assert.match(sw, /settings\/cloud-push\.html/);
});

test('the push client requests permission while a user gesture is active', () => {
  assert.match(client, /async function requestPushPermissionFromGesture\(\)/);
  const source = client.slice(client.indexOf('async function enablePush('),
    client.indexOf('async function connectDeviceWithPairingCode('));
  assert.ok(source.indexOf('requestPushPermissionFromGesture()') < source.indexOf('registerDeviceForCurrentAccount('));
  assert.match(client, /navigator\.serviceWorker/);
  assert.match(client, /pushManager\.subscribe/);
  assert.match(client, /MAO/i);
});

test('service worker filters notifications by active authenticated MAO account', () => {
  assert.equal((sw.match(/self\.addEventListener\('push'/g) || []).length, 1);
  assert.equal((sw.match(/self\.addEventListener\('notificationclick'/g) || []).length, 1);
  assert.match(sw, /\/api\/accounts\/me/);
  assert.match(sw, /currentAccount\.id !== accountId/);
  assert.match(sw, /registration\.showNotification/);
  assert.match(sw, /pushTargetUrl/);
});

test('founder push API uses existing account sessions for first device and test notification', () => {
  assert.match(app, /async function registerDevice/);
  assert.match(app, /accountAuth\.getAuthenticatedAccount\(request\)/);
  assert.match(app, /store\.insertMaoAccountDevice/);
  assert.match(app, /async function subscribe\(request\)/);
  assert.match(app, /async function testPush\(request\)/);
  assert.match(app, /sendWebPush/);
  assert.match(worker, /env\.CLOUD_DB/);
  assert.match(worker, /injectAccountScope/);
});

test('preview device token expiry is explicit; production identity settings stay unchanged', () => {
  assert.equal(wrangler.name, 'mao');
  assert.equal(wrangler.assets.binding, 'ASSETS');
  assert.equal(wrangler.durable_objects.bindings[0].name, 'CLOUD_DB');
  assert.equal(wrangler.previews.vars.DEVICE_PAIRING_TOKEN_TTL_MS, '300000');
  assert.equal(wrangler.previews.vars.MAO_SOCIAL_E2EE_ENABLED, 'true');
  assert.equal(wrangler.vars, undefined);
});


test('test push action is visible beside the notification toggle and no longer buried under the device panel', () => {
  assert.match(pushPage, /id="cloudPushResult"/);
  assert.match(pushPage, /id="cloudRoleSaveStatus"/);
  assert.ok(pushPage.indexOf('id="cloudTestRow"') < pushPage.indexOf('CHARACTER ACTIVITY'));
  assert.equal((pushPage.match(/id="cloudTestRow"/g) || []).length, 1);
  assert.match(client, /测试通知未送达/);
  assert.match(client, /服务器 VAPID 签名错误/);
  assert.match(client, /服务器消息加密错误/);
  assert.match(client, /服务器连接推送服务失败/);
  assert.match(client, /角色授权已保存（不代表推送已发出）/);
});

test('test delivery logs preserve actionable safe failure stage instead of one anonymous HTTP zero', () => {
  assert.match(app, /failurePhases/);
  assert.match(app, /failurePhase: phase/);
  assert.match(app, /failureKind: outcome\.failureKind \|\| null/);
  assert.match(app, /cryptoFailed/);
  const push = read('worker/lib/webpush.js');
  assert.match(push, /tagged\.phase = 'vapid'/);
  assert.match(push, /tagged\.phase = 'encrypt'/);
  assert.match(push, /tagged\.phase = 'transport'/);
});
