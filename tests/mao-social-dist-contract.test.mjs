import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const dist = file => resolve(root, 'dist', file);

test('mobile real-friends page is present in the actual Vite build and PWA page manifest', () => {
  const page = 'chat/contacts/real-friends.html';
  assert.ok(existsSync(dist(page)), 'the social page must be deployed, not merely exist in source');
  const manifest = JSON.parse(readFileSync(dist('pwa-pages.json'), 'utf8'));
  assert.ok(manifest.includes(page), 'PWA route list must include the real social page');
  const html = readFileSync(dist(page), 'utf8');
  for (const id of ['inviteSection', 'requestForm', 'requestsSection', 'approvalSection', 'friendsSection', 'chatPanel']) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(html, /<title>真人好友<\/title>/);
});

test('friend QR generator is self-hosted and bundled for mobile share links', () => {
  const page = readFileSync(dist('chat/contacts/real-friends.html'), 'utf8');
  assert.match(page, /qrcode-generator\.js/);
  const script = 'shared/js/phone/qrcode-generator.js';
  assert.ok(existsSync(dist(script)), 'a missing classic QR script must fail the release build');
  const code = readFileSync(dist(script), 'utf8');
  assert.ok(code.length > 1000, 'copied QR generator must not be empty');
  assert.match(page, /#mao-friend=/, 'share URL must keep one-time code in the URL fragment');
});

test('camera scanner remains inside authenticated original MAO preview and builds with QR parsing module', () => {
  const name = 'chat/contacts/scan-friend.html';
  const htmlFile = dist(name);
  assert.ok(existsSync(htmlFile), 'heart scan route must be present in deployed assets');
  const manifest = JSON.parse(readFileSync(dist('pwa-pages.json'), 'utf8'));
  assert.ok(manifest.includes(name), 'scanner page should be discoverable in the Vite route manifest');
  const html = readFileSync(htmlFile, 'utf8');
  assert.match(html, /<title>扫一扫 · 好友<\/title>/);
  assert.match(html, /打开相机/);
  assert.match(html, /从相册选择/);
  assert.match(html, /好友码 \/ 邀请链接/);
  assert.doesNotMatch(html, /https:\/\/[^"]+\.js/);
});

test('chat menu can grow through one registry file and is shipped in actual PWA assets', () => {
  const menuFile = 'shared/js/chat-action-menu.js';
  assert.ok(existsSync(dist(menuFile)), 'menu extension registry must be deployed');
  const built = readFileSync(dist('chat/chat/chat.html'), 'utf8');
  assert.match(built, /chat-action-menu\.js/);
  assert.match(built, /MAOMAOChatActions\.mount/);
  const source = readFileSync(dist(menuFile), 'utf8');
  assert.match(source, /MAOMAOChatActions/);
  assert.match(source, /register/);
});

test('the social mobile HTML remains protected by the Worker login gate', () => {
  const worker = readFileSync(resolve(root, 'worker.js'), 'utf8');
  const start = worker.indexOf('const isPublicAccountDocument =');
  const end = worker.indexOf('let authorizedAccount', start);
  assert.ok(start >= 0 && end > start, 'explicit public login allowlist is required');
  const publicList = worker.slice(start, end);
  assert.doesNotMatch(publicList, /real-friends\.html/, 'social cannot become an anonymous public account page');
  assert.match(worker, /if \(isHtmlDocument && !isPublicAccountDocument\)/);
  assert.match(worker, /\/api\/accounts\/me/);
});

// Only the isolated social Preview may exercise friend consent + 001 approval.
// The app.mao520.com production Worker must stay opt-in disabled, and
// plaintext messaging must never be offered as a real E2EE product.
test('social QA preview opens only E2EE message transport while production and plaintext chat remain off', () => {
  const raw = readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '');
  const config = JSON.parse(raw);
  assert.equal(config.name, 'mao');
  assert.equal(config.vars?.MAO_SOCIAL_ENABLED, undefined);
  assert.equal(config.vars?.MAO_SOCIAL_CHAT_ENABLED, undefined);
  assert.equal(config.previews?.vars?.MAO_SOCIAL_ENABLED, 'true');
  assert.equal(config.previews?.vars?.MAO_SOCIAL_CHAT_ENABLED, 'false');
  assert.equal(config.previews?.vars?.MAO_SOCIAL_E2EE_ENABLED, 'true');
  assert.equal(config.vars?.MAO_SOCIAL_E2EE_ENABLED, undefined);
  assert.equal(config.previews?.vars?.MAO_IDENTITY_MODE, undefined,
    'this isolated migration rehearsal exercises preexisting local identities without delegated login');
  assert.equal(config.previews?.vars?.MAO_IDENTITY_AUTHORITY_MODE, undefined,
    'wrong founder database must never be treated as the actual creator authority');
  assert.equal(config.vars?.MAO_IDENTITY_AUTHORITY_MODE, undefined,
    'production cannot delegate its identity to the old auth preview');
  assert.equal(config.vars?.MAO_IDENTITY_MODE, undefined,
    'production identity must never silently bind to an old preview authority');
  assert.equal(config.previews?.durable_objects?.bindings?.[0]?.name, 'CLOUD_DB');
  assert.equal(config.services, undefined, 'production must not call old auth service');
  assert.equal(config.previews?.services, undefined,
    'until the original 2026-11-11 founder database is safely connected, no preview may request creator credentials');

  const server = readFileSync(resolve(root, 'worker/lib/mao-social.js'), 'utf8');
  assert.match(server, /env\.MAO_SOCIAL_ENABLED !== 'true'/);
  assert.match(server, /env\.MAO_SOCIAL_CHAT_ENABLED !== 'true'/);
});

test('encrypted real-user conversation is deployed and never rendered as AI chat', () => {
  const page='chat/contacts/real-chat.html';
  const manifest=JSON.parse(readFileSync(dist('pwa-pages.json'),'utf8'));
  assert.ok(manifest.includes(page),'E2EE chat page must be in built manifest');
  const file=readFileSync(dist(page),'utf8');
  assert.match(file,/双人加密聊天/);
  // Vite bundles the source module into a hashed assets chunk; don't
  // require its prebuild filename to survive optimization.
  // Vite may emit a relative hashed module, inline a module wrapper or
  // hoist crypto into a shared chunk. Assert the compiled crypto exists,
  // instead of hardcoding its URL or versioned filename.
  // This MPA build keeps relative route directories inside assets:
  // assets/chat/contacts/real-chat-<hash>.js, not assets/<hash>.js.
  const scripts = readdirSync(dist('assets/chat/contacts'))
    .filter(name=>/^real-chat-[A-Za-z0-9_-]+\.js$/.test(name));
  assert.ok(scripts.length>0,'compiled real chat entry script must be deployed');
  const encryptedRuntime = scripts.some(name=>
    readFileSync(dist('assets/chat/contacts/'+name),'utf8').includes('MAO-E2EE-v1'));
  assert.ok(encryptedRuntime,'encrypted browser crypto must exist in compiled chat entry');
  const original=readFileSync(resolve(root,'chat/contacts/real-chat.html'),'utf8');
  assert.match(original,/real-chat-crypto\.mjs/);
  assert.match(original,/api\/social\/e2ee\/chats/);
  assert.doesNotMatch(original,/\/api\/ai\//);
});

test('photo and voice E2EE are bundled into the private chat only', () => {
  const scripts=readdirSync(dist('assets/chat/contacts'))
    .filter(name=>/^real-chat-[A-Za-z0-9_-]+\.js$/.test(name));
  assert.ok(scripts.length>0);
  const bundle=scripts.map(name=>readFileSync(dist('assets/chat/contacts/'+name),'utf8')).join('');
  assert.match(bundle,/MAO-E2EE-media-v1/);
  assert.match(bundle,/MediaRecorder/);
  assert.match(bundle,/image\/jpeg/);
  const page=readFileSync(dist('chat/contacts/real-chat.html'),'utf8');
  assert.match(page,/id="photoBtn"/);
  assert.match(page,/id="voiceBtn"/);
  assert.doesNotMatch(page,/id="videoBtn"|id="giftBtn"|id="payBtn"/);
});

test('approved real-user chats appear in the existing built chat list, not a new contacts tile', () => {
  const page=readFileSync(dist('chat/chat/chat.html'),'utf8');
  const filename='shared/js/social-chat-list.js';
  assert.ok(existsSync(dist(filename)), 'server-backed real chat provider must be deployed');
  assert.match(page, /social-chat-list\.js/);
  assert.match(page, /chat-real-card/);
  assert.match(page, /realHTML \+ groupsHTML \+ rolesHTML/);
  const source=readFileSync(dist(filename),'utf8');
  assert.match(source, /\/api\/social\/e2ee\/conversations/);
  assert.match(source, /credentials:'same-origin'/);
  assert.match(source, /cache:'no-store'/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
});
