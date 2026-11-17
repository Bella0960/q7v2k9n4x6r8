import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Script } from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('QA Settings AI menu links to the original cloud push module', () => {
  const settings = read('settings/settings.html');
  assert.match(settings, /window\.location\.href='cloud-push\.html'/);
  assert.match(settings, /<span class="t-cn">云端推送<\/span>/);
  assert.ok(existsSync(new URL('../settings/cloud-push.html', import.meta.url)));
});

test('cloud page loads the existing cloud client and reports unverified background AI truthfully', () => {
  const html = read('settings/cloud-push.html');
  const js = read('shared/js/cloud-push-client.js');
  assert.match(html, /shared\/js\/cloud-push-client\.js/);
  assert.match(html, /MaomaoCloud\.mountSettings\(\)/);
  assert.match(html, /id="cloudPushToggle"/);
  assert.match(html, /id="cloudReadinessCheck"/);
  assert.match(html, /id="cloudContextSharingToggle" disabled/);
  assert.match(html, /云端独立运行 AI 生成尚未验收/);
  assert.match(js, /\/api\/push\/subscriptions/);
  assert.match(js, /\/api\/autonomy\/readiness/);
  assert.match(js, /registerDeviceForCurrentAccount/);
  assert.doesNotMatch(js, /VAPID_PRIVATE_KEY|AUTONOMY_MODEL_API_KEY\s*=/);
  assert.doesNotThrow(() => new Script(js, { filename: 'cloud-push-client.js' }));
});

test('QA keeps protected PWA HTML network-first while adding real account-gated push', () => {
  const sw = read('sw.js');
  const cacheVersion = Number(
    sw.match(/^const CACHE_NAME = 'phone-app-pwa-v(\d+)'/m)?.[1] || 0
  );
  assert.ok(cacheVersion >= 241, 'QA PWA security baseline must remain at v241 or higher');
  assert.match(sw, /cacheablePublicResponse/);
  assert.match(sw, /if \(!isPublicAccountPage && \(url\.pathname === '\/' \|\| \/\\\.html\$\/i\.test\(url\.pathname\)\)\)/);
  assert.match(sw, /self\.addEventListener\('push'/);
  assert.match(sw, /self\.addEventListener\('notificationclick'/);
  assert.match(sw, /fetch\('\/api\/accounts\/me'/);
  assert.match(sw, /authPayload && authPayload\.account/);
  assert.match(sw, /payload\.type === 'test'/);
  assert.match(sw, /同源/);
  assert.doesNotThrow(() => new Script(sw, { filename: 'sw.js' }));
});

test('current QA server supports cloud diagnostics, and does not claim standalone AI generation', () => {
  const app = read('worker/lib/app.js');
  assert.match(app, /'\/api\/push\/config'/);
  assert.match(app, /'\/api\/push\/test'/);
  assert.match(app, /'\/api\/devices\/register'/);
  assert.match(app, /'\/api\/autonomy\/readiness'/);
  assert.match(app, /autonomousMessageGenerationReady: false/);
});

test('music-only QA release never redeploys or alters the isolated identity core', () => {
  const runner = read('scripts/qa-direct-release.mjs');
  const qa = JSON.parse(read('wrangler.qa.jsonc'));
  assert.equal(qa.name, 'maomao-aw-qa-20261114');
  assert.equal(qa.keep_vars, true);
  assert.equal(qa.assets?.directory, './dist');
  assert.equal(qa.vars?.MAO_QA_IDENTITY_SETUP, 'disabled');
  assert.match(runner, /const qaOnly = process\.argv\.includes\('--qa-only'\)/);
  assert.match(runner, /const deploy = qaOnly \|\| process\.argv\.includes\('--deploy'\)/);
  assert.match(runner, /if \(qaOnly\) \{[\s\S]*?coreInitialized[\s\S]*?\} else \{/);
  assert.match(runner, /else \{[\s\S]*?wrangler@4'[\s\S]*?wrangler\.qa-identity-core\.jsonc/);
  assert.match(runner, /assert\.equal\(coreAfter\.versionId, coreVersion\.versionId/);
  assert.match(runner, /MAOMAO_QA_DEPLOY_CONFIRM/);
  assert.match(runner, /\['node', \['tests\/music-mobile-browser\.mjs'\]\]/);
  assert.match(runner, /'wrangler\.qa\.jsonc'/);
});


test('Opera site permission flow keeps browser and website grants separate', async () => {
  const js = read('shared/js/cloud-push-client.js');
  const html = read('settings/cloud-push.html');
  assert.match(html, /cloud-push-client\.js\?v=20261118opera1/);
  assert.match(js, /setToggle\(status\.permission === 'granted' && status\.currentBrowserMatched === true\)/);
  assert.match(js, /localTestRow\.addEventListener\('click'[\s\S]*?await requestNotificationPermissionFromGesture\(\)/);

  function environment(initialPermission, promptResult) {
    let prompts = 0;
    const notification = {
      permission: initialPermission,
      requestPermission: async () => { prompts += 1; return promptResult; }
    };
    const window = {
      isSecureContext: true,
      location: { hostname: 'preview.mao520.com' },
      Notification: notification,
      PushManager: function PushManager() {}
    };
    const context = {
      window,
      document: { currentScript: { src: 'https://preview.mao520.com/shared/js/cloud-push-client.js' } },
      navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 15) OPT/80.0', serviceWorker: {} },
      Notification: notification,
      localStorage: { getItem: () => null },
      URL
    };
    new Script(js, { filename: 'cloud-push-client.js' }).runInNewContext(context);
    return { api: window.MaomaoCloud._internal, count: () => prompts };
  }

  const freshGrant = environment('default', 'granted');
  assert.equal(await freshGrant.api.requestNotificationPermissionFromGesture(), 'granted');
  assert.equal(freshGrant.count(), 1, 'site prompt is called once from user gesture');

  const alreadyGranted = environment('granted', 'denied');
  assert.equal(await alreadyGranted.api.requestNotificationPermissionFromGesture(), 'granted');
  assert.equal(alreadyGranted.count(), 0, 'do not re-prompt an authorized site');

  const denied = environment('denied', 'granted');
  await assert.rejects(denied.api.requestNotificationPermissionFromGesture(), /Opera.*通知|Opera.*应用通知/);
  assert.equal(denied.count(), 0, 'a rejected site cannot be re-prompted');

  const dismissed = environment('default', 'default');
  await assert.rejects(dismissed.api.requestNotificationPermissionFromGesture(), /preview\.mao520\.com/);
  assert.equal(dismissed.count(), 1);
});
