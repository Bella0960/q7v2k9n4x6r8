import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('../shared/js/phone/npc-social.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../chat/contacts/npc-friends.html', import.meta.url), 'utf8');
const contacts = readFileSync(new URL('../chat/contacts/contacts.html', import.meta.url), 'utf8');

test('NPC social requests are separate from existing role relationship NPC records', () => {
  assert.match(service, /npc_friend_requests_v1/);
  assert.match(service, /npc_friend_discovery_settings_v1/);
  assert.match(service, /npcSocialRole: true/);
  assert.match(service, /npcFriendRequestId/);
  assert.doesNotMatch(service, /role\.npcCharacters\s*=/);
});

test('NPC discovery requires opt-in for automatic checks and caps pending requests', () => {
  assert.match(service, /enabled: value\.enabled === true/);
  assert.match(service, /settings\.enabled/);
  assert.match(service, /countPending\(requests\) >= 1/);
  assert.match(service, /intervalHours/);
});

test('NPC acceptance is explicit and role storage uses the result repository', () => {
  assert.match(service, /NS\.accept = function/);
  assert.match(service, /store\.saveCharacters\(roles\)/);
  assert.match(service, /request\.status = 'accepted'/);
  assert.match(page, /data-action="accept"/);
  assert.match(page, /自动发现新朋友/);
});

test('NPC requests do not enter real-user accounts or financial capabilities', () => {
  assert.doesNotMatch(service, /real_user_contacts_v1|\/api\/real-user-chat|red.?packet|transfer|wallet/i);
  assert.match(page, /NPC 是 AI 角色，不是真人账号/);
});

test('Contacts exposes the NPC request center entry', () => {
  assert.match(contacts, /npc-friends\.html/);
});
