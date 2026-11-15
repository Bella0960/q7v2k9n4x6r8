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

test('heart menu is a registry, not a fixed list wired into chat HTML', () => {
  const source = get('shared/js/chat-action-menu.js');
  assert.match(chat, /id="groupEntryBtn"[^>]*aria-label="更多操作/);
  assert.match(chat, /id="wechatMenu" role="menu"/);
  assert.match(chat, /MAOMAOChatActions\.mount\(menu,/);
  assert.match(chat, /chat-action-menu\.js/);
  assert.doesNotMatch(chat, /id="menuFriend"|id="menuGroup"|id="menuScan"/,
    'menu buttons must be generated from the registry, not hardcoded into the page');
  assert.match(source, /MAOMAOChatActions = Object\.freeze/);
  assert.match(source, /function register\(descriptor\)/);
  assert.match(source, /mounted\.forEach\(render\)/,
    'new actions must be rendered on existing pages without rewriting the HTML');
  assert.match(source, /id: 'friend'/);
  assert.match(source, /id: 'group'/);
  assert.match(source, /id: 'scan'/);
  assert.match(source, /id: 'background'/);
  assert.match(chat, /document\.addEventListener\('maomao:open-chat-group', openModal\)/);
  assert.doesNotMatch(chat, /document\.getElementById\('groupEntryBtn'\)\.click\(\)/,
    'group action must open the real modal and never reopen the menu');
});

test('an additional feature can be registered and clicked without editing the existing markup', async () => {
  const {runInNewContext} = await import('node:vm');
  const source = get('shared/js/chat-action-menu.js');
  const makeNode = (tag) => ({
    tag, children:[], attributes:{}, dataset:{},
    setAttribute(k,v){this.attributes[k]=v},
    appendChild(v){this.children.push(v)},
    replaceChildren(fragment){this.children = fragment.children.slice()},
    addEventListener(type,fn){this['on_'+type]=fn}
  });
  const document = {
    createElement:makeNode,
    createElementNS:(_ns,tag)=>makeNode(tag),
    createDocumentFragment:()=>makeNode('fragment'),
    dispatchEvent(){}
  };
  const window={location:{href:'https://example.test/chat/chat/chat.html'}};
  runInNewContext(source,{window,document,Event:class{}});
  const registry=window.MAOMAOChatActions;
  const menu=makeNode('menu'),ctx={closeMenu(){},toggleBackground(){}};
  registry.mount(menu,ctx);
  const before=menu.children.length;
  assert.ok(before>=4);
  assert.ok(registry.list().includes('friend'));
  const remove=registry.register({id:'test-extension',label:'扩展功能',
    icon:'scan',order:99,href:'/forum/forum.html'});
  assert.equal(menu.children.length,before+1);
  const entry=menu.children.find(node=>node.dataset.action==='test-extension');
  assert.ok(entry);
  entry['on_click']();
  assert.equal(window.location.href,'/forum/forum.html');
  remove();
  assert.equal(menu.children.length,before);
  assert.throws(()=>registry.register({id:'untrusted',label:'Bad',
    href:'https://evil.example/steal.html'}),/Invalid/);
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
