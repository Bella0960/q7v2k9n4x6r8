import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const detail = read('chat/chat/chat-detail.html');
const storage = new Map([
  ['ai_custom_characters', JSON.stringify([{id:'a',name:'甲'},{id:'b',name:'乙',worldBookIds:['b']}])],
  ['phone_worldbooks', JSON.stringify([{id:'global',scope:'global',enabled:true},{id:'b',scope:'local',enabled:true}])]
]);
const localStorage = {getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))};
const window = {};
vm.runInNewContext(read('shared/js/phone/role-worldbook-bindings.js'),{window,localStorage});
vm.runInNewContext(read('shared/js/phone/chat-context-policy.js'),{window,localStorage});
test('no implicit global books, explicit role books only',()=>{
  assert.deepEqual(Array.from(window.RoleWorldbookBindings.read('a').ids),[]);
  assert.deepEqual(Array.from(window.RoleWorldbookBindings.read('b').ids),['b']);
  assert.deepEqual(Array.from(window.RoleWorldbookBindings.filterBooks('a',JSON.parse(storage.get('phone_worldbooks'))).books),[]);
});
test('unscoped and other-role memories are never selected',()=>{
  const input=[{text:'legacy'},{sourceRoleId:'b',text:'other'},{sourceRoleId:'a',text:'mine'}];
  assert.deepEqual(Array.from(window.ChatContextPolicy.filterUserMemoriesForRole(input,'a'),m=>m.text),['mine']);
  assert.deepEqual(Array.from(window.ChatContextPolicy.filterUserMemoriesForRole(input,'')),[]);
  assert.match(detail,/String\(m\.sourceRoleId\)\.trim\(\) === activeMemoryRoleId/);
});
test('missing or name-only persona uses short no-invention notice, not generic default',()=>{
  assert.match(detail,/const personaIncomplete =/);
  assert.match(detail,/注意：当前角色档案缺失，请保持简短回应，绝对不要自行编造姓名或职业/);
  assert.match(detail,/rpProtocol = rpProtocol\.trim\(\) \|\| \(personaIncomplete/);
  assert.match(detail,/const turnSpeakerPersona = personaIncomplete/);
});
