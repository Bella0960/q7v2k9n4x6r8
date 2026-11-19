import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const contacts = read('chat/contacts/contacts.html');
const page = read('chat/contacts/npc-friends.html');
const npc = read('shared/js/phone/npc-social.js');
const nav = read('shared/js/nav.js');
const worker = read('worker.js');
const scope = read('shared/js/mao-account-scope.js');
const sw = read('sw.js');
const api = read('shared/js/phone/phone_api.js');

test('NPC request entry uses existing Contacts layout and routes to original page', () => {
  assert.match(contacts, /id="goManageRole"/);
  assert.match(contacts, /id="contactList"/);
  assert.match(contacts, /id="goNpcRequests"/);
  assert.match(contacts, /npc-friends\.html/);
  assert.match(page, /NPC 好友申请/);
  assert.match(page, /data-action="accept"/);
  assert.match(page, /data-action="decline"/);
  assert.match(page, /data-action="block"/);
});

test('opt-in NPC AI runs only on foreground chat or Contacts', () => {
  assert.match(nav, /currentPage === 'chat\.html' \|\| currentPage === 'contacts\.html'/);
  assert.match(nav, /npc-social\.js\?v=20261108i/);
  assert.match(npc, /enabled: value\.enabled === true/);
  assert.match(npc, /npc_friend_requests_v2_/);
  assert.match(npc, /signal: controller\.signal/);
});

test('existing authenticated MAO Worker scopes NPC HTML and local data per account', () => {
  assert.match(worker, /url\.pathname\.toLowerCase\(\)\.endsWith\('\.html'\)/);
  assert.match(worker, /injectAccountScope\(response, authorizedAccount\)/);
  assert.match(worker, /mao-account-scope\.js/);
  assert.match(scope, /__mao_account_v1__/);
  assert.match(scope, /scopedStorage\(rawLocalStorage\)/);
  assert.match(page, /phone_storage\.js/);
});

test('PWA includes NPC assets and preserves secured account navigation', () => {
  assert.match(sw, /phone-app-pwa-v266/);
  assert.match(sw, /chat\/contacts\/npc-friends\.html/);
  assert.match(sw, /shared\/js\/phone\/npc-social\.js\?v=20261108i/);
  assert.match(sw, /accountPath/);
  assert.match(sw, /no-store/);
});


test('QA PhoneAPI truthfully advertises abort support required by NPC discovery', () => {
  assert.match(api, /NS\.supportsAbortSignal = true/);
  assert.match(api, /var externalSignal = opts && opts\.signal/);
  assert.match(api, /externalSignal\.addEventListener\('abort', onCallerAbort/);
  assert.match(api, /NS\.completeJSON = function \(opts\)/);
  assert.match(api, /return NS\.complete\(opts\)/);
  assert.match(npc, /supportsAbortSignal === true/);
});
