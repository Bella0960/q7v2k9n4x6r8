import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(rootDir, 'shared/js/friend-qr.js'), 'utf8');

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
