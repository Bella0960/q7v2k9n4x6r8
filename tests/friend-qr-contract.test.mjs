import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(rootDir, 'shared/js/friend-qr.js'), 'utf8');
const friendCenterSource = fs.readFileSync(path.join(rootDir, 'chat/contacts/friend-center.html'), 'utf8');
const friendsClientSource = fs.readFileSync(path.join(rootDir, 'shared/js/friends-client.js'), 'utf8');

test('好友二维码只编码公开用户 ID，支持解析 MAOMAO-F1 标记', () => {
  const browserWindow = {};
  vm.runInNewContext(source, { window: browserWindow, TextEncoder });
  const qr = browserWindow.MaomaoFriendQr;
  const userId = 'u_abcdefghijklmno123456';
  const payload = qr.prefix + userId;
  const svg = qr.toSvg(userId);

  assert.equal(qr.parse(payload), userId);
  assert.equal(qr.parse(userId), userId);
  assert.match(svg, /viewBox="0 0 37 37"/);
  assert.match(svg, /<path d="M/);
  assert.equal(svg.includes('secret'), false);
  assert.throws(() => qr.toSvg('x'.repeat(45)), /二维码内容过长/);
});


test('好友页先显示本机固定二维码，云端注册成功前不开放分享', () => {
  const localId = friendCenterSource.indexOf('localUserId = api.getLocalAccountId()');
  const renderQr = friendCenterSource.indexOf('qr.toSvg(localUserId)');
  const registerCloud = friendCenterSource.indexOf('myAccount = await api.ensureAccount(displayName)');

  assert.ok(localId >= 0, '好友页先取得本机稳定的公开好友 ID');
  assert.ok(renderQr > localId, '先用本机 ID 绘制二维码');
  assert.ok(registerCloud > renderQr, '二维码绘制不再等待云端注册请求');
  assert.match(friendCenterSource, /云端账号尚未连接，此二维码暂不可用于添加好友/);
  assert.match(friendCenterSource, /id="copyIdBtn"[^>]*disabled/);
  assert.match(friendCenterSource, /id="copyQrTextBtn"[^>]*disabled/);
  assert.match(friendsClientSource, /getLocalAccountId:\\s*getLocalAccountId/);
});
