import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../settings/js/backup.js',import.meta.url),'utf8');

function fixture(opts={}){
 const state={a:'before',b:'old',c:'new',api_settings:'secret',auth_token:'secret'};
 const data=new Map(Object.entries(state)),digests=[];
 const window={crypto:{subtle:{digest:async(algo,bytes)=>{
  digests.push(Array.from(bytes));const out=new Uint8Array(32);for(let i=0;i<bytes.length;i++)out[i%32]=(out[i%32]*31+bytes[i])&255;
  if(opts.duringHash)opts.duringHash(data);
  return out.buffer;
 }}}};
 const start=source.indexOf('    function sameRecoveryPoint('),end=source.indexOf('    function recoveryScope(',start);
 const params={window,neverBackupKey:k=>k==='auth_token',SECRET_KEYS:['api_settings'],
  backupRegistry:()=>({belongsTo:(scope,k)=>k==='a'}),backupTargets:()=>[{db:'media'}],
  localStorage:{getItem:k=>data.has(k)?data.get(k):null}};
 const api=new Function(...Object.keys(params),source.slice(start,end)+'\nreturn {prepareRestoreJournal,journalFingerprint,journalWithState,inspectRecoveryJournal,sameRecoveryPoint};')(...Object.values(params));
 return {api,state,data,digests,plan:()=>api.prepareRestoreJournal(state,{a:'imported',c:'new',d:'added',api_settings:'new-secret',auth_token:'new-secret'},'',{indexedDB:{media:{audio:[{}]}}},()=>true)};
}
async function rejects(p){let failed=false;try{await p;}catch(_){failed=true;}assert.equal(failed,true);}
test('journal captures changed keys only and no known credentials',async()=>{const f=fixture(),j=await f.plan();assert.deepEqual(j.local.entries.map(e=>e.key),['a','b','d']);assert.equal(j.local.entries[1].expected,null);assert.equal(j.local.entries[0].expected.length,64);assert.ok(!JSON.stringify(j).includes('imported'));assert.ok(!JSON.stringify(j).includes('secret'));assert.equal(j.databases[0].expectedCount,1);});
test('scoped journal ignores unrelated keys',async()=>{const f=fixture(),j=await f.api.prepareRestoreJournal(f.state,{a:'next'},'chat',{},()=>true);assert.deepEqual(j.local.entries.map(e=>e.key),['a']);});
test('fingerprint encodes exact UTF16 code units',async()=>{const f=fixture();await f.api.journalFingerprint('\uD800');assert.deepEqual(f.digests[0],[216,0]);await f.api.journalFingerprint('\uFFFD');assert.deepEqual(f.digests[1],[255,253]);});
test('journal refuses changed scope',async()=>{const f=fixture();await rejects(f.api.prepareRestoreJournal(f.state,{a:'next'},'',{},()=>false));});
test('journal refuses overlong changed payload',async()=>{const f=fixture();await rejects(f.api.prepareRestoreJournal({}, {a:'a'.repeat(16*1024*1024)},'',{},()=>true));});
test('state transitions cannot skip writing intent',async()=>{const f=fixture(),j=await f.plan();let failed=false;try{f.api.journalWithState({journal:j},'local',null,'verified');}catch(_){failed=true;}assert.equal(failed,true);});
test('state updates do not mutate prior checkpoint',async()=>{const f=fixture(),j=await f.plan(),n=f.api.journalWithState({journal:j},'local',null,'writing');assert.equal(j.local.state,'not-started');assert.equal(n.local.state,'writing');});
test('verified journal identifies original, expected and later change',async()=>{const f=fixture(),j=await f.plan();j.local.state='verified';f.data.set('a','imported');f.data.set('d','later');const r=await f.api.inspectRecoveryJournal({snap:f.state,journal:j},()=>true);assert.equal(r.original,1);assert.equal(r.matchesIntent,1);assert.equal(r.changed,1);});
test('unverified writes are not classified as matching intent',async()=>{const f=fixture(),j=await f.plan();j.local.state='writing';f.data.set('a','imported');const r=await f.api.inspectRecoveryJournal({snap:f.state,journal:j},()=>true);assert.equal(r.matchesIntent,0);assert.equal(r.unverified,1);});
test('missing value is distinct from an empty value',async()=>{const f=fixture(),j=await f.plan();j.local.state='verified';f.data.delete('b');const r=await f.api.inspectRecoveryJournal({snap:f.state,journal:j},()=>true);assert.equal(r.matchesIntent,1);});
test('later modification during async fingerprint is classified changed',async()=>{let changed=false;const f=fixture({duringHash:data=>{if(changed)data.set('a','later');}}),j=await f.plan();j.local.state='verified';f.data.set('a','imported');changed=true;const r=await f.api.inspectRecoveryJournal({snap:f.state,journal:j},()=>true);assert.equal(r.changed,1);assert.equal(r.matchesIntent,0);});
test('legacy point without journal remains viewable',async()=>{const f=fixture();assert.equal(await f.api.inspectRecoveryJournal({snap:{}},()=>true),null);});
test('recovery identity includes journal revision',async()=>{const f=fixture(),j=await f.plan(),r={role:'pre-import',createdAt:1,snap:f.state,media:'{}',journal:j};assert.equal(f.api.sameRecoveryPoint(r,{...r,journal:{...j,local:{...j.local,state:'writing'}}}),false);});
