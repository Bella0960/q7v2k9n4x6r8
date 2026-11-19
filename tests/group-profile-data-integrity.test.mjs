/**
 * GROUP-UI-002: fast, dependency-free persistence contract.
 * Reads the real settings-page function body, not a reimplementation.
 * Run: node --test tests/group-profile-data-integrity.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'chat/chat/chat-settings.html'), 'utf8');
const start = html.indexOf('    function canManageGroup(group) {');
const end = html.indexOf('    // ===== 邀请角色', start);
assert.ok(start > 0 && end > start, 'the authoritative group mutation functions must still exist');
const source = html.slice(start, end);

const original = [
  { id:'g1', name:'旧群名', ownerId:'__user', members:[{ id:'c1' }] },
  { id:'g2', name:'另一群', ownerId:'__user', members:[{ id:'c2' }] }
];
function createHarness(writeMode='normal') {
  let raw=JSON.stringify(original);
  const notices=[];
  const localStorage={
    getItem(key) { return key==='phone_groups' ? raw : null; },
    setItem(key,value) {
      if (key !== 'phone_groups') throw Error('unexpected key');
      if (writeMode === 'no-op') return;
      if (writeMode === 'throws') throw Error('QuotaExceededError');
      raw = value;
    }
  };
  const context=vm.createContext({localStorage,showToast:message=>notices.push(message)});
  new vm.Script(source,{filename:'chat-settings.html#group-persistence'}).runInContext(context);
  return { save: group => context.saveCurrentGroup(group),
    canManage: group => context.canManageGroup(group),
    getGroupList: () => JSON.parse(raw), notices };
}

test('group rename persists without damaging the other group', () => {
  const h=createHarness();
  assert.equal(h.save({id:'g1',name:'新群名',ownerId:'__user',members:[{id:'c1'}]}),true);
  assert.equal(h.getGroupList()[0].name,'新群名');
  assert.deepEqual(h.getGroupList()[1],original[1]);
});
test('silent localStorage no-op never reports successful save', () => {
  const h=createHarness('no-op');
  assert.equal(h.save({id:'g1',name:'新群名',ownerId:'__user'}),false);
  assert.deepEqual(h.getGroupList(),original);
});
test('quota error never reports successful save', () => {
  const h=createHarness('throws');
  assert.equal(h.save({id:'g1',name:'新群名',ownerId:'__user'}),false);
  assert.deepEqual(h.getGroupList(),original);
});
test('user cannot modify role-owned or departed group', () => {
  const h=createHarness();
  assert.equal(h.save({id:'g1',ownerId:'c1',name:'伪修改'}),false);
  assert.equal(h.save({id:'g1',ownerId:'__user',userMembership:'left',name:'伪修改'}),false);
  assert.equal(h.save({id:'g1',ownerId:'__user',userMembership:'declined',name:'伪修改'}),false);
  assert.deepEqual(h.getGroupList(),original);
});
test('legacy group without ownerId is still editable by user', () => {
  const h=createHarness();
  assert.equal(h.save({id:'g1',name:'兼容旧群',members:[{id:'c1'}]}),true);
  assert.equal(h.getGroupList()[0].name,'兼容旧群');
});
test('group owner can create a new group record with existing records intact', () => {
  const h=createHarness();
  assert.equal(h.save({id:'g3',name:'新群',ownerId:'__user'}),true);
  assert.deepEqual(h.getGroupList().map(g=>g.id),['g1','g2','g3']);
});
test('source must guard destructive paths and validate read-back', () => {
  assert.match(html, /localStorage\.getItem\('phone_groups'\) === serialized/);
  assert.match(html, /localStorage\.getItem\(GP_ALIAS_KEY\) !== val/);
  assert.match(html, /localStorage\.getItem\(GP_NOTICE_KEY\) !== val/);
  assert.match(html, /localStorage\.getItem\(historyKey\) !== null/);
  assert.match(html, /localStorage\.getItem\('phone_groups'\) !== remaining/);
  assert.match(html, /g2\.members\.length < 2/);
  assert.match(html, /String\(g2\.ownerId \|\| '__user'\) === String\(mid\)/);
});
