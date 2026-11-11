import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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
