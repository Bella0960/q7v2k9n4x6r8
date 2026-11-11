import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = path => readFileSync(join(root, path), 'utf8');
const home = read('index.html');
const sw = read('sw.js');
const worker = read('worker.js');
const settings = read('settings/settings.html');
const account = read('account/account.js');
const auth = read('worker/lib/account-auth.js');

test('the latest main desktop and tutorial remain intact during account integration', () => {
  assert.match(home, /addTutorialShortcutToExistingLayouts/);
  assert.match(home, /data-href="tutorial\/tutorial\.html"/);
  assert.match(home, /role-gallery-image-autonomy|app_tutorial/);
  assert.match(home, /var LS_KEY = 'ds_layout_v14'/);
  assert.match(home, /home_widget_upload_v1_/);
  assert.match(sw, /\.\/tutorial\/tutorial\.html/);
});

test('the sole server-confirmed creator gets an automatic desktop management tile', () => {
  assert.match(home, /data-href="admin\/admin-center\.html" data-drag="app_admin_center"[^>]*hidden/);
  assert.match(home, /roleMeta\.content === 'super_admin'/);
  assert.match(home, /tile\.hidden = false/);
  assert.match(home, /currentLayout\.removed = \(currentLayout\.removed \|\| \[\]\)\.filter/);
  assert.match(home, /currentLayout\.pages = \(currentLayout\.pages \|\| \[\]\)\.map/);
  assert.match(worker, /url\.pathname\.startsWith\('\/admin\/'\)/);
  assert.match(worker, /authorizedAccount\.role !== 'super_admin'/);
  assert.match(auth, /founderNumber: '001'/);
  assert.match(auth, /store\.createMaoSuperAdminAccountIfEmpty/);
});

test('the one entry uses same-origin sessions, not a public admin domain', () => {
  assert.match(account, /window\.location\.assign\('\/index\.html'\)/);
  assert.doesNotMatch(read('account/index.html'), /href="https:\/\/admin\.mao520\.com/);
  assert.match(worker, /new URL\('\/api\/accounts\/me', url\)/);
  assert.match(worker, /const isPublicAccountDocument/);
  assert.match(worker, /const authorizedAccount =|let authorizedAccount =/);
  assert.match(settings, /account\/settings-link\.js\?v=1/);
});

test('old cache-first PWA entries cannot bypass the new server login gate', () => {
  const cacheVersion = Number(/phone-app-pwa-v(\d+)/.exec(sw)?.[1]);
  assert.ok(cacheVersion >= 204, 'account login gate must never restore an older cache version');
  assert.match(sw, /APP_SHELL\.concat\(pageEntries\)/);
  assert.match(sw, /Only public sign-in\/first-time setup HTML may be cached/);
  assert.match(sw, /if \(req\.mode === 'navigate' && !isPublicAccountPage\)/);
  assert.match(sw, /return await fetch\(req\)/);
  assert.match(sw, /url\.pathname === '\/api' \|\| url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw, /requestedAccountId !== account\.id/);
  assert.match(worker, /mao-account-role/);
});

test('account authentication and its assets exist without replacing the latest main app', () => {
  for (const file of [
    'account/index.html', 'account/bootstrap.html', 'account/manage.html',
    'admin/admin-center.html', 'assets/ivory-mao/hero.webp',
    'shared/js/mao-account-scope.js', 'shared/js/phone/character-schedule-policy.js',
    'worker/lib/app.js', 'worker/lib/store.js', 'worker/lib/account-auth.js',
    'worker/migrations/0012_mao_accounts.js', 'wrangler.preview.jsonc',
    'tutorial/tutorial.html', 'chat/chat/chat-detail.html'
  ]) {
    assert.ok(existsSync(join(root, file)), 'missing integration asset: ' + file);
  }
});

test('founder bootstrap refuses HTTP 200 responses without a verified founder session', () => {
  const bootstrap = read('account/bootstrap.js');
  assert.match(bootstrap, /payload\.ok !== true/);
  assert.match(bootstrap, /typeof payload\.initialized !== 'boolean'/);
  assert.match(bootstrap, /payload\.account\?\.role !== 'super_admin'/);
  assert.match(bootstrap, /payload\.account\?\.founderNumber !== '001'/);
  assert.match(bootstrap, /window\.location\.replace\('\/admin\/admin-center\.html'\)/);
});

test('phone QA Worker Preview has its own SQLite-backed account store', () => {
  const wrangler = JSON.parse(read('wrangler.jsonc').replace(/^\s*\/\/[^\n]*$/gm, ''));
  assert.equal(wrangler.name, 'mao');
  assert.ok(wrangler.migrations.some(m => m.new_sqlite_classes?.includes('CloudDatabase')));
  assert.deepEqual(wrangler.previews.durable_objects.bindings, [
    { name: 'CLOUD_DB', class_name: 'CloudDatabase' }
  ]);
  assert.equal(wrangler.assets.run_worker_first, true);
});

test('founder sign-up readiness is a non-secret boolean and blocks unavailable Preview setup', () => {
  const backend = read('worker/lib/account-auth.js');
  const html = read('account/bootstrap.html');
  const entry = read('account/bootstrap.js');
  assert.match(backend, /(?:configured:|const configured =)\s*String\(env\.MAO_SUPER_ADMIN_BOOTSTRAP_SECRET \|\| ''\)\.length >= 32/);
  assert.match(backend, /String\(env\.DEVICE_SECRET_PEPPER \|\| ''\)\.length >= 32/);
  assert.match(html, /id="bootstrapSetupHelp"/);
  assert.match(html, /npx wrangler preview secret put DEVICE_SECRET_PEPPER/);
  assert.match(html, /npx wrangler preview secret put MAO_SUPER_ADMIN_BOOTSTRAP_SECRET/);
  assert.match(entry, /if \(status\.configured === false\)/);
  assert.match(entry, /crypto\.getRandomValues\(bytes\)/);
  assert.doesNotMatch(entry, /localStorage|sessionStorage|document\.cookie/);
});

test('iPhone 注册页不输出会被 Safari 渲染成绿色表情方块的装饰', () => {
  const html = read('account/index.html');
  assert.doesNotMatch(html, /<div class="footer-divider"/);
  assert.doesNotMatch(html, /✳/);
  assert.match(html, /id="registerPanel"/);
  assert.match(html, /id="inviteForm"/);
});
