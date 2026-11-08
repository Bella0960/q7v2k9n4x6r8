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


test('好友页先显示本机二维码；复制 ID 不等待云端，二维码分享仍需注册成功', () => {
  const localId = friendCenterSource.indexOf('localUserId = api.getLocalAccountId()');
  const renderQr = friendCenterSource.indexOf('qr.toSvg(localUserId)');
  const enableCopyId = friendCenterSource.indexOf("$('copyIdBtn').disabled = false");
  const bindCopyId = friendCenterSource.indexOf("$('copyIdBtn').addEventListener('click'");
  const registerCloud = friendCenterSource.indexOf('myAccount = await api.ensureAccount(displayName)');
  const enableCopyQr = friendCenterSource.indexOf("$('copyQrTextBtn').disabled = false");

  assert.ok(localId >= 0, '好友页先取得本机稳定的公开好友 ID');
  assert.ok(renderQr > localId, '先用本机 ID 绘制二维码');
  assert.ok(enableCopyId > localId && enableCopyId < registerCloud, '本机 ID 一生成就开放复制');
  assert.ok(bindCopyId > enableCopyId && bindCopyId < registerCloud, '复制 ID 的点击事件不依赖云端注册');
  assert.ok(registerCloud > renderQr, '二维码绘制不再等待云端注册请求');
  assert.ok(enableCopyQr > registerCloud, '复制二维码内容仍需云端注册成功');
  assert.match(friendCenterSource, /二维码暂时无法显示，可以先复制下方 ID/);
  assert.match(friendCenterSource, /好友 ID 已复制；当前账号尚未连接云端，暂时无法被查找/);
  assert.match(friendCenterSource, /id="copyIdBtn" type="button" disabled>复制 ID/);
  assert.match(friendCenterSource, /id="copyQrTextBtn"[^>]*disabled/);
  assert.match(friendCenterSource, /friends-client\.js\?v=friend6/);
  assert.match(friendCenterSource, /friend-qr\.js\?v=friend2/);
  assert.match(friendsClientSource, /getLocalAccountId:\s*getLocalAccountId/);
});


test('好友中心复制结果准确；二维码能力缺失不阻断手动 ID 查找', () => {
  assert.match(friendCenterSource, /copied = document\.execCommand\('copy'\) === true/);
  assert.match(friendCenterSource, /copied \? successMessage : '复制未成功/);
  assert.match(friendCenterSource, /qr && typeof qr\.parse === 'function'/);
  assert.match(friendCenterSource, /rawId\.indexOf\('MAOMAO-F1:'\) === 0/);
  assert.match(
    friendCenterSource,
    /if \(qr && typeof qr\.toSvg === 'function' && typeof qr\.prefix === 'string'\) \{\s*\$\('copyQrTextBtn'\)\.disabled = false/
  );
  assert.match(friendCenterSource, /账号已连接，但好友列表暂时刷新失败/);
  assert.match(friendCenterSource, /refreshLists\(\)\.catch\(function \(\) \{\}\)/);
  assert.doesNotMatch(
    friendCenterSource,
    /api\.getFriends\(\)\.then\(renderFriends\)\.catch\(function \(\) \{\}\)/
  );
});


test('好友关系操作成功后，列表刷新失败不会误报为操作失败', () => {
  assert.match(friendCenterSource, /async function refreshListsAfterAction\(successMessage\)/);
  assert.match(friendCenterSource, /successMessage \+ '但好友列表暂时刷新失败/);
  assert.match(friendCenterSource, /await refreshListsAfterAction\(successMessage\)/);
  assert.match(friendCenterSource, /await refreshListsAfterAction\(accept \? '已同意好友申请。' : '已拒绝好友申请。'\)/);
  assert.match(friendCenterSource, /await refreshListsAfterAction\('好友已删除。'\)/);
});
