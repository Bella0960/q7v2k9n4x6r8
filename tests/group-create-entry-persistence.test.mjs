import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chat=readFileSync(path.join(root,'chat/chat/chat.html'),'utf8');
test('聊天列表所有创建群入口都通向真实创建弹窗',()=>{
  assert.match(chat,/\['groupEntryBtn', 'silverGroupEntryBtn'\]\.forEach/);
  assert.match(chat,/entry\.addEventListener\('click',[\s\S]*?openModal\(\)/);
  assert.match(chat,/getElementById\('menuGroup'\)\.addEventListener[\s\S]*?getElementById\('groupEntryBtn'\)\.click\(\)/);
  assert.match(chat,/function openModal\(\)[\s\S]*?backdrop\.classList\.add\('show'\)/);
});
test('新群不覆盖损坏记录；需要成员；存储读回后才提示成功',()=>{
  assert.match(chat,/if \(!members\.length\)/);
  assert.match(chat,/groups = raw === null \? \[\] : JSON\.parse\(raw\)/);
  assert.match(chat,/if \(!Array\.isArray\(groups\)\) throw new Error/);
  assert.match(chat,/localStorage\.setItem\('phone_groups', JSON\.stringify\(updatedGroups\)\)/);
  assert.match(chat,/var saved = JSON\.parse\(localStorage\.getItem\('phone_groups'\)/);
  assert.match(chat,/showToast\('群聊已创建'\)/);
});
