import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildOutboundPushPayload, safePushPreview } from '../worker/lib/app.js';

const ACCOUNT = 'MAO-ABCDEFGHIJKL';
const ID = 'autonomy_abcdefghijklmnop_1';
const fields = {
  accountId: ACCOUNT,
  characterId: 'role-fox',
  serverMessageId: ID,
  timestamp: 1732200000000
};

test('outbound push shows the opted-in role name and the real persisted text', () => {
  const result = buildOutboundPushPayload({
    ...fields,
    characterName: '小狐狸',
    messageText: '你吃过饭了吗？我刚下课，想和你聊聊天。'
  });
  assert.equal(result.title, '小狐狸');
  assert.equal(result.body, '你吃过饭了吗？我刚下课，想和你聊聊天。');
  assert.equal(result.accountId, ACCOUNT);
  assert.equal(result.url, './chat/chat/chat-detail.html?id=role-fox');
  assert.ok(result.tag.endsWith(ID));
  assert.doesNotMatch(JSON.stringify({ title: result.title, body: result.body }), /https?:\/\/|mao520\.com|MAO-[A-Z0-9]{12,24}/i);
});

test('visible notification text strips origin URLs, bare domains, account IDs and line breaks', () => {
  const result = buildOutboundPushPayload({
    ...fields,
    characterName: '小狐狸 https://preview.mao520.com',
    messageText: '我回来啦！ https://preview.mao520.com/xx 好想聊天\n' +
      ACCOUNT + ' www.mao520.com/test 你呢？'
  });
  assert.equal(result.title, '小狐狸');
  assert.equal(result.body, '我回来啦！ 好想聊天 你呢？');
  assert.doesNotMatch(result.body, /mao520|MAO-ABCD|https|www\./i);
  assert.equal(safePushPreview('普通聊天 😊\n下一句', 10), '普通聊天 😊 下一句');
});

test('missing names and empty URL-only text fail to generic message without leaking links', () => {
  const generic = buildOutboundPushPayload({ ...fields, messageText: 'https://preview.mao520.com/' });
  assert.equal(generic.title, '新消息');
  assert.equal(generic.body, '发来一条新消息');
});

test('notification preview is derived only from persisted outbox, not arbitrary request fields', () => {
  const store = fs.readFileSync(new URL('../worker/lib/store.js', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../worker/lib/app.js', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../shared/js/cloud-push-client.js', import.meta.url), 'utf8');
  assert.match(store, /o\.payload_json AS payload_json/);
  assert.match(app, /JSON\.parse\(candidate\.payload_json\)/);
  assert.match(app, /messageText: validText \? persisted\.text : ''/);
  assert.match(app, /characterName: validText \? persisted\.characterName : ''/);
  assert.match(app, /\['attemptCount', 'text', 'characterName'\]/);
  assert.match(app, /payload: repeatPayload/);
  assert.match(client, /scope\.ready === true && scope\.accountId === accountId/);
  assert.match(client, /characterName \? \{ characterName: characterName \} : \{\}/);
});
