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
  assert.match(js, /\/api\/accounts\/me/);
  assert.doesNotMatch(js, /VAPID_PRIVATE_KEY|AUTONOMY_MODEL_API_KEY\s*=/);
  assert.doesNotThrow(() => new Script(js, { filename: 'cloud-push-client.js' }));
});

test('QA keeps protected PWA HTML network-first while adding real account-gated push', () => {
  const sw = read('sw.js');
  assert.match(sw, /phone-app-pwa-v241/);
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
