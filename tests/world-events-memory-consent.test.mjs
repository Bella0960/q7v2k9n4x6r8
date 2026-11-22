import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../shared/js/phone/world-events-memory.js', import.meta.url), 'utf8');
const chat = fs.readFileSync(new URL('../chat/chat/chat-detail.html', import.meta.url), 'utf8');
const profile = fs.readFileSync(new URL('../worldbook/characters/js/characters-manager.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../worldbook/characters/characters.html', import.meta.url), 'utf8');

function session() {
  const records = [{roleId:'role-A', provenance:'user-confirmed', type:'encounter.first_met',
    occurredAt:'2026-11-21T08:00:00.000Z', summary:'通过邂逅正式认识了角色A', allowAI:false},
    {roleId:'role-A', provenance:'generated', type:'encounter.reunion',
    occurredAt:'2026-11-22T09:00:00.000Z', summary:'模型生成但未确认', allowAI:false}];
  let account = 'MAO-AAAAAAAAAAAA';
  const map = new Map();
  const storage = {
    getItem:key => map.has(key) ? map.get(key) : null,
    setItem:(key,val) => map.set(key,String(val))
  };
  const world = { 
    account:()=>({ok:true,value:account}),
    listForRole:(id)=>({ok:!!id && ['role-A','role-B'].includes(id),
      value:records.filter(e=>e.roleId===id)})
  };
  const window = {WorldEvents:world,localStorage:storage,navigator:{}};
  vm.runInNewContext(source,{window,Date,Object,String,encodeURIComponent}, {filename:'world-events-memory.js'});
  return {adapter:window.RoleEventMemory,world,records,map,storage,setAccount:id=>{account=id}};
}

test('default off even for confirmed first-met record previously marked allowAI false', () => {
  const t = session();
  assert.equal(t.adapter.getConsent('role-A').value,false);
  assert.equal(t.adapter.buildPrompt('role-A').value,'');
});

test('explicit opt-in uses only confirmed records of the same role, never generated rumors', async () => {
  const t = session();
  assert.equal((await t.adapter.setConsent('role-A',true)).ok,true);
  const prompt = t.adapter.buildPrompt('role-A');
  assert.equal(prompt.ok,true);
  assert.match(prompt.value,/通过邂逅正式认识了角色A/);
  assert.doesNotMatch(prompt.value,/模型生成但未确认/);
  assert.equal(t.adapter.buildPrompt('role-B').value,'');
});

test('disabling consent removes prompt, without deleting event data', async () => {
  const t = session();
  await t.adapter.setConsent('role-A',true);
  await t.adapter.setConsent('role-A',false);
  assert.equal(t.adapter.buildPrompt('role-A').value,'');
  assert.equal(t.records.length,2);
});

test('same role ID across accounts has independent consent', async () => {
  const t = session();
  await t.adapter.setConsent('role-A',true);
  t.setAccount('MAO-BBBBBBBBBBBB');
  assert.equal(t.adapter.buildPrompt('role-A').value,'');
  await t.adapter.setConsent('role-A',false);
  t.setAccount('MAO-AAAAAAAAAAAA');
  assert.notEqual(t.adapter.buildPrompt('role-A').value,'');
});

test('corrupt consent, invalid role and storage quota fail closed', async () => {
  const t=session();
  assert.equal((await t.adapter.setConsent('unknown',true)).ok,false);
  await t.adapter.setConsent('role-A',true);
  const key=[...t.map.keys()][0];
  t.map.set(key,'corrupted');
  assert.equal(t.adapter.getConsent('role-A').ok,false);
  assert.equal(t.adapter.buildPrompt('role-A').ok,false);
  t.storage.setItem=()=>{throw new Error('QuotaExceededError')};
  assert.equal((await t.adapter.setConsent('role-A',false)).ok,false);
});

test('the UI binds to a user-changed explicit control in the folded role profile', () => {
  assert.match(profile,/data-eco-memory-consent/);
  assert.match(profile,/content\.onchange = async function/);
  assert.match(profile,/setConsent\(savedRoleId, requested\)/);
  assert.ok(page.indexOf('world-events-memory.js') < page.indexOf('characters-manager.js'));
});

test('chat preserves identity and RP assembly and only injects opt-in memory in 1:1', () => {
  const marker=chat.indexOf('// ECO-LINK: only the exact, confirmed single-chat role');
  assert.ok(marker>0);
  const excerpt=chat.slice(marker,marker+950);
  assert.match(excerpt,/!isGroupChat/);
  assert.match(excerpt,/String\(roleForTurn\.id\)/);
  assert.match(excerpt,/eventHistory && eventHistory\.ok && eventHistory\.value/);
  assert.match(excerpt,/capText\(eventHistory\.value, 900\)/);
  assert.match(chat,/systemPrompt = roleIdentityHead/);
  assert.match(chat,/【世界书 \/ 角色生活背景】/);
});


test('consent construction does not repeatedly scan world event keys when hasRole exists', async () => {
  const t = session();
  let scans=0;
  t.world.hasRole=id=>({ok:id==='role-A',value:true});
  const original=t.world.listForRole;
  t.world.listForRole=(id,opts)=>{scans++;return original(id,opts)};
  t.records.push({roleId:'role-A',provenance:'user-confirmed',type:'encounter.first_met',
    occurredAt:'2026-11-21T08:00:00.000Z',summary:'确实相遇',allowAI:false});
  await t.adapter.setConsent('role-A',true);
  scans=0;
  const prompt=t.adapter.buildPrompt('role-A');
  assert.equal(prompt.ok,true);
  assert.match(prompt.value,/确实相遇/);
  assert.equal(scans,1,'the single prompt build should query events once');
});
