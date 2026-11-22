import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const js=readFileSync(new URL('../worldbook/characters/js/characters-manager.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../worldbook/characters/characters.html',import.meta.url),'utf8');
test('archive is after core role settings and folded by default',()=>{
  const role=js.slice(js.indexOf('function renderRoleProfile()'),js.indexOf('content.onclick = function',js.indexOf('function renderRoleProfile()')));
  assert.ok(role.indexOf('CHARACTER SETTINGS')<role.indexOf('avatar-library-section'));
  assert.ok(role.indexOf('avatar-library-section')<role.indexOf('SOCIAL WORLD'));
  assert.match(role,/<details class="avatar-library-section"/);
  assert.doesNotMatch(role,/<details class="avatar-library-section" open/);
  assert.match(html,/\.avatar-library-trigger\s*\{/);
  assert.match(role,/id="avatarPairList"/);
  assert.match(role,/avatar-autonomy/);
  assert.match(role,/id="avatarPairDisclosure"/);
});
