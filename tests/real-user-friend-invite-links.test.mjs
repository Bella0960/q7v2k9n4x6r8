import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inviteSource = fs.readFileSync(path.join(ROOT, 'shared/js/phone/real-user-friend-invite.js'), 'utf8');
const qrSource = fs.readFileSync(path.join(ROOT, 'shared/js/phone/qrcode-generator.js'), 'utf8');
function inviteApi() {
  const window = {};
  vm.runInNewContext(inviteSource, { window, URL, String, RegExp, Error }, { filename: 'real-user-friend-invite.js' });
  return window.PhoneRealUserInviteLinks;
}
const code = 'a'.repeat(64);
const page = {
  href: 'https://mao.example/chat/contacts/contacts.html',
  origin: 'https://mao.example', protocol: 'https:', hostname: 'mao.example',
  pathname: '/chat/contacts/contacts.html', search: '', hash: ''
};

test('HTTPS share links keep invitation credentials in the URL fragment', () => {
  const api = inviteApi();
  const link = api.createShareUrl(page, code);
  const parsed = new URL(link);
  assert.equal(parsed.origin, page.origin);
  assert.equal(parsed.pathname, page.pathname);
  assert.equal(parsed.search, '');
  assert.equal(parsed.hash, '#mao-friend=' + code);
  assert.equal(api.extractFriendCode(link, page), code);
});
test('raw codes and the legacy mao scheme remain accepted', () => {
  const api = inviteApi();
  assert.equal(api.extractFriendCode(code, page), code);
  assert.equal(api.extractFriendCode('mao://friend/add?code=' + code, page), code);
});
test('external origins, arbitrary URLs and malformed invitations are rejected', () => {
  const api = inviteApi();
  assert.equal(api.extractFriendCode('https://attacker.example/chat/contacts/contacts.html#mao-friend=' + code, page), '');
  assert.equal(api.extractFriendCode('javascript:alert(1)', page), '');
  assert.equal(api.extractFriendCode('https://mao.example/other#mao-friend=' + code, page), '');
  assert.equal(api.extractFriendCode('mao://friend/add?code=' + code + '&next=https://attacker.example', page), '');
  assert.throws(() => api.createShareUrl({ ...page, href: 'http://mao.example/chat/contacts/contacts.html' }, code), /https_required/);
  assert.throws(() => api.createShareUrl(page, 'not-a-code'), /invalid_friend_code/);
});
test('opening a share link captures the invite and clears only the fragment', () => {
  const api = inviteApi();
  const location = { ...page, href: 'https://mao.example/chat/contacts/contacts.html#mao-friend=' + code, hash: '#mao-friend=' + code };
  const calls = [];
  const history = { replaceState: (...args) => calls.push(args) };
  assert.equal(api.captureCurrentInvite(location, history, '通讯录'), code);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], '/chat/contacts/contacts.html');
});
test('the QR uses the exact server-returned payload and creates a local SVG', () => {
  const sandbox = { console };
  vm.runInNewContext(qrSource, sandbox, { filename: 'qrcode-generator.js' });
  assert.equal(typeof sandbox.qrcode, 'function');
  const api = inviteApi();
  const link = api.createShareUrl(page, code);
  const serverPayload = { code, qrPayload: 'mao://friend/add?code=' + code };
  const qrPayload = api.getQrPayload(serverPayload, link);
  assert.equal(qrPayload, serverPayload.qrPayload);
  const qr = sandbox.qrcode(0, 'M');
  qr.addData(qrPayload, 'Byte');
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
  assert.match(svg, /^<svg/);
  assert.match(svg, /viewBox=/);
  assert.ok(qr.getModuleCount() >= 21);
  assert.throws(() => api.getQrPayload({ code, qrPayload: 'https://attacker.example/#mao-friend=' + code }, link), /invalid_friend_qr_payload/);
});
