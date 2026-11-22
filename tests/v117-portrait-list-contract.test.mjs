import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html=readFileSync(new URL('../worldbook/characters/characters.html',import.meta.url),'utf8');
test('portrait archive list keeps rectangular top-aligned photos and independently scrollable biography',()=>{
  assert.match(html,/#listView \.slim-avatar\s*\{[^}]*height:146px;[^}]*min-height:146px;[^}]*align-self:start;/s);
  assert.match(html,/#listView \.role-slim-bar\s*\{[^}]*height:174px;/s);
  assert.match(html,/#listView \.slim-desc\s*\{[^}]*overflow-y:auto;[^}]*scrollbar-width:none;/s);
  assert.match(html,/#listView \.slim-desc::-webkit-scrollbar\s*\{\s*display:none;/);
});
