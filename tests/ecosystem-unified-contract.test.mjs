import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const load = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const eventCode = load('shared/js/phone/world-events.js');
const memoryCode = load('shared/js/phone/world-events-memory.js');
const editor = load('worldbook/characters/js/characters-manager.js');
const profile = load('worldbook/characters/characters.html');
const encounter = load('encounter/encounter.html');
const footprint = load('chat/footprint/footprint.html');
const chat = load('chat/chat/chat-detail.html');

function storage() {
  const data = new Map();
  return {
    data,
    get length() { return data.size; },
    key(index) { return [...data.keys()][index] ?? null; },
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
}
function createFixture() {
  const disk = storage();
  let account = 'MAO-AAAAAAAAAAAA';
  const role = { id: 'role_enc_777', name: '林某',
    encounterOrigin: {version:1,sourceCandidateId:'enc_777',linkedAt:'2026-11-21T09:30:00.000Z'} };
  const roles = [role, {id:'role-B',name:'另一位'}];
  const root = { location:{hostname:'localhost'}, localStorage:disk, navigator:{} };
  const context = vm.createContext({ window:root, Date, Promise, Object, String,
    encodeURIComponent, decodeURIComponent, URLSearchParams, Number });
  vm.runInContext(eventCode, context, {filename:'world-events.js'});
  vm.runInContext(memoryCode, context, {filename:'world-events-memory.js'});
  const ledger = root.WorldEvents.createStore({
    storage:disk, locks:null, scopeResolver:()=>({ok:true,value:{id:account}}),
    readRoles:()=>roles, now:()=>Date.parse('2026-11-21T12:00:00Z')
  });
  const memory = root.RoleEventMemory.create({events:ledger,storage:disk,locks:null});
  root.WorldEvents = ledger;
  root.RoleEventMemory = memory;
  const event = (options={})=>({
    roleId:role.id,type:'encounter.first_met',
    source:{appId:'encounter',recordId:'enc_777'},
    occurredAt:'2026-11-21T09:30:00.000Z',
    summary:'通过邂逅正式认识了林某',
    provenance:'user-confirmed',allowAI:false,...options
  });
  return { disk, roles, role, root, ledger, memory, event,
    setAccount:id=>{account=id} };
}
function editorSnippet(startMark, endMark) {
  const start=editor.indexOf(startMark),end=editor.indexOf(endMark,start);
  assert.ok(start>=0 && end>start,'expected editor hook was not found');
  return editor.slice(start,end);
}
function escapeHtml(input) {
  return String(input??'').replace(/[&<>"']/g, ch=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[ch]));
}
function renderHistory(f) {
  const script=editorSnippet('function renderRoleEncounterHistory(role) {',
    'function renderRoleProfile() {');
  return new Function('window','role','escapeHtml',
    script+';return renderRoleEncounterHistory(role);')(f.root,f.role,escapeHtml);
}

test('integration loads the shared ledger before every consumer',()=>{
  assert.ok(profile.indexOf('world-events.js')>0);
  assert.ok(profile.indexOf('world-events-memory.js')>profile.indexOf('world-events.js'));
  assert.ok(chat.indexOf('world-events.js')>0);
  assert.ok(encounter.indexOf('world-events.js')>0);
  assert.ok(footprint.indexOf('world-events.js')>0);
  assert.match(profile,/characters-manager\.js/);
  assert.match(chat,/!isGroupChat && roleForTurn/);
});

test('first-met action attaches the already saved formal role exactly once', async()=>{
  const f=createFixture();
  const script=editorSnippet('const createdEncounter = !roleId && activeEncounterDraftId',
    'const oldDraftKey = currentDraftKey;');
  const notices=[];
  new Function('roles','roleId','activeEncounterDraftId','savedRoleId',
    'window','document','setSaveStatus',script)(
    f.roles,'','enc_777',f.role.id,f.root,
    {getElementById:()=>({value:f.role.id})},(...args)=>notices.push(args));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.ledger.listForRole(f.role.id).value.length,1);
  assert.equal(f.ledger.listForRole(f.role.id).value[0].source.recordId,'enc_777');
  assert.equal(f.ledger.listForRole(f.role.id).value[0].allowAI,false);
  assert.equal(f.roles.length,2);
  const again=await f.ledger.append(f.event());
  assert.equal(again.ok,true);
  assert.equal(f.ledger.listForRole(f.role.id).value.length,1);
});

test('corrupt or removed characters cannot acquire or reveal an event',async()=>{
  const f=createFixture();
  assert.equal((await f.ledger.append(f.event({roleId:'deleted'}))).ok,false);
  assert.equal(f.ledger.listForRole('deleted').ok,false);
  f.roles.splice(0,1);
  assert.equal(f.ledger.listForRole('role_enc_777').ok,false);
});

test('confirmed first meeting is the ONLY date allowed in the profile link',async()=>{
  const f=createFixture();
  const reunion=await f.ledger.append(f.event({
    type:'encounter.reunion',
    source:{appId:'encounter',recordId:'reunion_2026-11-22_everyday'},
    occurredAt:'2026-11-22T10:00:00.000Z',
    summary:'再次相遇'
  }));
  assert.equal(reunion.ok,true);
  let html=renderHistory(f);
  assert.doesNotMatch(html,/&date=2026-11-22/,'reunion is not first meeting');
  assert.doesNotMatch(html,/&date=2026-11-21/,'linkedAt alone is not an actual event');
  assert.match(html,/data-eco-restore-first/);
  await f.ledger.append(f.event());
  html=renderHistory(f);
  assert.match(html,/&date=2026-11-21/);
  assert.doesNotMatch(html,/data-eco-restore-first/);
});

test('explicit opt-in allows exactly one event scan per context construction',async()=>{
  const f=createFixture();
  await f.ledger.append(f.event());
  assert.equal(f.memory.buildPrompt(f.role.id).value,'');
  let scans=0;
  const counted={...f.ledger,listForRole(...args){scans++;return f.ledger.listForRole(...args)}};
  const delegated=f.root.RoleEventMemory.create({events:counted,storage:f.disk,locks:null});
  const start=performance.now();
  assert.equal((await delegated.setConsent(f.role.id,true)).ok,true);
  assert.equal(scans,0,'consent checks must not scan every event');
  const prompt=delegated.buildPrompt(f.role.id);
  const elapsedMs=performance.now()-start;
  assert.equal(prompt.ok,true);
  assert.match(prompt.value,/正式认识了林某/);
  assert.equal(scans,1,'one build = one event scan');
  assert.ok(Number.isFinite(elapsedMs),'perf measurement must be finite');
  console.log('ECO-LINK Node consent+context duration:',elapsedMs.toFixed(2),'ms (not Chromium)');
});

test('same role ID cannot leak between accounts, and switching back keeps A',async()=>{
  const f=createFixture();
  assert.equal((await f.ledger.append(f.event())).ok,true);
  await f.memory.setConsent(f.role.id,true);
  f.setAccount('MAO-BBBBBBBBBBBB');
  assert.equal(f.ledger.listForRole(f.role.id).value.length,0);
  assert.equal(f.memory.buildPrompt(f.role.id).value,'');
  f.setAccount('MAO-AAAAAAAAAAAA');
  assert.equal(f.ledger.listForRole(f.role.id).value.length,1);
  assert.match(f.memory.buildPrompt(f.role.id).value,/正式认识/);
});

test('retries and same-key collisions never erase a prior event',async()=>{
  const f=createFixture();
  assert.equal((await f.ledger.append(f.event())).ok,true);
  assert.equal((await f.ledger.append(f.event())).ok,true);
  const conflicting=await f.ledger.append(f.event({summary:'不应该覆盖的描述'}));
  assert.equal(conflicting.ok,false);
  assert.equal(f.ledger.listForRole(f.role.id).value.length,1);
  assert.match(f.ledger.listForRole(f.role.id).value[0].summary,/正式认识/);
});

test('event projection preserves the original footprint DOM structure and local day',()=>{
  assert.match(footprint,/const originalCards = items\.map/);
  assert.match(footprint,/worldEventsForDay\(currentDate\)/);
  assert.match(footprint,/eventDays\.has\(key\)/);
  assert.match(footprint,/t-eco-item/);
  assert.match(footprint,/showEncounter=1&returnDate=/);
  assert.match(footprint,/encounterRole=' \+ id/);
  assert.match(footprint,/if \(!currentRoleId\) return \[\]/);
  assert.doesNotMatch(footprint,/WorldEvents\.append\(/,'footprint must be a read-only projection');
});

test('deep links only route to existing formal character and retain parent date',()=>{
  assert.match(editor,/params\.get\('showEncounter'\) === '1'/);
  assert.match(editor,/details\.eco-profile-history/);
  assert.match(editor,/from === 'footprint'/);
  assert.match(encounter,/data-return-footprint/);
  assert.match(encounter,/footprintReturnRoute\(reunion\.id\)/);
  assert.match(encounter,/openReunion\(requestedRole,requestedScene\)/);
  assert.match(encounter,/provenance:'user-confirmed',allowAI:false/);
});

test('all imported scripts remain parseable and no extra dependency is introduced',()=>{
  new Function(eventCode);
  new Function(memoryCode);
  new Function(editor);
  for(const [label,markup] of [['encounter',encounter],['footprint',footprint],['chat',chat]]) {
    const inline=[...markup.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter(m=>!/\bsrc\s*=/.test(m[1])&&!/application\/json/i.test(m[1]));
    for(const code of inline) {
      assert.doesNotThrow(()=>new Function(code[2]),label+' inline script parse error');
    }
  }
});
