import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseFriendQr, friendRequestUrl} from '../chat/contacts/friend-qr-scan.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const get = name => readFileSync(resolve(root, name), 'utf8');
const chat = get('chat/chat/chat.html');
const contacts = get('chat/contacts/contacts.html');
const scanner = get('chat/contacts/scan-friend.html');
const origin = 'https://qa-phone-founder-001-keyreset-20261111.preview.mao520.com';
const code = 'af'.repeat(32);

test('heart keeps its existing music-card placement and hosts one restrained action menu', () => {
  assert.match(chat, /id="groupEntryBtn"[^>]*aria-label="更多操作/);
  assert.match(chat, /id="wechatMenu" role="menu"/);
  assert.match(chat, /id="menuBgToggle"/);
  assert.match(chat, /id="menuFriend"/);
  assert.match(chat, /id="menuGroup"/);
  assert.match(chat, /id="menuScan"/);
  assert.match(chat, /'groupEntryBtn','wechatGroupEntryBtn','silverGroupEntryBtn'/);
  assert.match(chat, /document\.getElementById\('menuFriend'\)\.addEventListener\('click'/);
  assert.match(chat, /window\.location\.href = '\.\.\/contacts\/real-friends\.html'/);
  assert.match(chat, /window\.location\.href = '\.\.\/contacts\/scan-friend\.html'/);
  assert.match(chat, /document\.dispatchEvent\(new Event\('maomao:open-chat-group'\)\)/);
  assert.match(chat, /document\.addEventListener\('maomao:open-chat-group', openModal\)/);
  assert.doesNotMatch(chat, /document\.getElementById\('groupEntryBtn'\)\.click\(\)/,
    'group menu must not reopen the heart menu instead of creating a group');
});

test('contacts restores its uncluttered AI-role entry without a duplicate real-friends tile', () => {
  assert.doesNotMatch(contacts, /id="goRealFriends"|真人好友 · 申请与聊天/);
  assert.match(contacts, /id="goManageRole"/);
  assert.match(contacts, /id="contactList"/);
});

test('friend QR parser accepts only a current-origin exact QR invite or raw code', () => {
  const link = origin + friendRequestUrl(code);
  assert.equal(parseFriendQr(link, origin), code);
  assert.equal(parseFriendQr(code.toUpperCase(), origin), code);
  assert.equal(parseFriendQr(' \n' + link + ' ', origin), code);
  assert.equal(parseFriendQr('https://other.example'+friendRequestUrl(code),origin),null);
  assert.equal(parseFriendQr('http://'+new URL(origin).host+friendRequestUrl(code),origin),null);
  assert.equal(parseFriendQr(origin+'/chat/contacts/scan-friend.html#mao-friend='+code,origin),null);
  assert.equal(parseFriendQr(origin+'/chat/contacts/real-friends.html?redirect=elsewhere#mao-friend='+code,origin),null);
  assert.equal(parseFriendQr('https://'+new URL(origin).host+'.example'+friendRequestUrl(code),origin),null);
  assert.equal(parseFriendQr('javascript:alert(1)',origin),null);
  assert.equal(parseFriendQr('hello world',origin),null);
  assert.equal(parseFriendQr(code.slice(2),origin),null);
  assert.throws(() => friendRequestUrl('bad'), /Invalid/);
});

test('scan UI uses an on-demand, stoppable camera and local image detection with privacy fallbacks', () => {
  assert.match(scanner, /import \{parseFriendQr, friendRequestUrl\}/);
  assert.match(scanner, /getUserMedia\(/);
  assert.match(scanner, /facingMode:\{ideal:'environment'\}/);
  assert.match(scanner, /playsinline muted autoplay/);
  assert.match(scanner, /getSupportedFormats/);
  assert.match(scanner, /detector\.detect\(video\)/);
  assert.match(scanner, /scanner\.detect\(img\)/);
  assert.match(scanner, /stream\.getTracks\(\)\.forEach\(track => track\.stop\(\)\)/);
  assert.match(scanner, /URL\.revokeObjectURL\(src\)/);
  assert.match(scanner, /addEventListener\('pagehide', stopCamera\)/);
  assert.match(scanner, /系统相机/);
  assert.match(scanner, /不支持网页内二维码识别/);
  assert.match(scanner, /只识别当前小手机站点的好友邀请/);
  assert.doesNotMatch(scanner, /fetch\(|localStorage|sendBeacon|upload/i);
});
