import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
const worker = read('worker.js');
const chat = read('chat/chat/chat-detail.html');
const cloud = read('shared/js/cloud-push-client.js');
const inbox = read('shared/js/cloud-outbound-inbox.js');
const scope = read('shared/js/mao-account-scope.js');
const sw = read('sw.js');

test('authenticated Worker account scope is physically shipped in Vite static assets', () => {
  assert.match(worker, /<script src="\/shared\/js\/mao-account-scope\.js\?v=2"/);
  assert.match(scope, /function markReady\(\)/);
  assert.match(scope, /markReady\(\);\s*\}\)\(window\)/);
  const vite = read('vite.config.js');
  assert.match(vite, /copy-static-web-resources/);
  assert.match(vite, /walk\(__dirname, ''\)/);
});

test('single chat loads cloud client and inbox bridge before the existing chat initialization', () => {
  const clientTag = chat.indexOf('src="../../shared/js/cloud-push-client.js?v=20261124inbox1"');
  const inboxTag = chat.indexOf('src="../../shared/js/cloud-outbound-inbox.js?v=20261124inbox1"');
  const init = chat.indexOf('function installCloudInboxForSingleChat()');
  assert.ok(clientTag >= 0 && inboxTag > clientTag && init > inboxTag);
  assert.match(chat, /if \(isGroupChat \|\| !currentRoleId \|\| !cloud \|\| !bridge/);
  assert.match(chat, /saveHistory: function \(rows\) \{ return saveMessages\(rows\) === true; \}/);
  assert.match(chat, /verifySession: async function \(expectedAccount\)/);
  assert.match(chat, /event\.persisted\) receiver\.stop\(\)/);
});

test('cloud inbox will not ACK before exact local save/readback and same-account checks', () => {
  assert.match(inbox, /global\.navigator\.locks\.request/);
  assert.match(inbox, /await verifySession\(\)/);
  assert.match(inbox, /var persisted = await opts\.saveHistory\(next\)/);
  assert.match(inbox, /var readBack = opts\.readHistory\(\)/);
  assert.match(inbox, /inspect\(readBack, parsed\.id, parsed\.text\)/);
  assert.match(inbox, /scope\.ready === true/);
  assert.match(inbox, /String\(envelope\.characterId \|\| ''\) !== roleId/);
  assert.match(cloud, /persisted = await persistMessage\(message\.payload, message\)/);
  assert.match(cloud, /if \(persisted !== true\)/);
  assert.match(cloud, /await acknowledgeCharacterOutboundMessage\(characterId, message\.serverMessageId\)/);
});

test('no cloud AI generation, app-wide data deletion, or silent offline replay in this PR', () => {
  assert.doesNotMatch(inbox, /chat\/completions|env\.AI\.run|localStorage\.clear/);
  assert.doesNotMatch(scope, /localStorage\.clear\(\)/);
  assert.match(sw, /url\.pathname === '\/api' \|\| url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw, /fetch\(req, \{ cache: 'no-store' \}\)/);
});
