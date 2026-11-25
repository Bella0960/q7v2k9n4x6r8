import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../shared/js/phone/phone_storage.js',import.meta.url),'utf8');

const original={id:'m1',content:'门票周六领取',sourceRoleId:'A',status:'fixed',extra:'preserve'};
function fixture(items=[original],settings={}){
 const data=new Map([['chat_memories_A',JSON.stringify(items)]]);let writes=0,read=0,role='A',ready=false;
 const window={__MAO_ACCOUNT_SCOPE__:{accountId:'fixture',ready:true}};
 const storage={getItem:k=>k==='chat_memories_A'&&ready&&settings.change&&++read===2?'[]':data.get(k)??null,setItem:(k,v)=>{if(k==='chat_memories_A'&&ready){writes++;if(settings.drop)return;}data.set(k,String(v));},removeItem:k=>data.delete(k)};
 new Function('window','localStorage',source)(window,storage);ready=true;
 return {api:window.PhoneStorage,window,opts:{confirmed:true,accountId:'fixture',getCurrentRoleId:()=>role},records:()=>JSON.parse(data.get('chat_memories_A')),writes:()=>writes,role:v=>role=v};
}
const revise=(f,m=original,txt='门票周日领取')=>f.api.reviewMemoryRevision('A','revise',m,txt,f.opts);
const undo=(f,m)=>f.api.reviewMemoryRevision('A','undo',m,null,f.opts);
test('revision retains original and fixed status',()=>{const f=fixture(),r=revise(f);assert.equal(r.ok,true);assert.equal(r.memory.status,'fixed');assert.deepEqual(f.records()[0],{...original,status:'superseded-fixed'});assert.equal(f.writes(),1);});
test('chained undo preserves all versions',()=>{const f=fixture(),a=revise(f),b=revise(f,a.memory,'门票周一领取'),c=undo(f,b.memory),d=undo(f,c.memory);assert.equal(d.ok,true);assert.deepEqual(f.records()[0],original);assert.ok(f.records().slice(1).every(m=>m.status==='withdrawn'));});
test('ordinary save cannot bypass revision protection',()=>{const f=fixture();assert.equal(revise(f).ok,true);assert.equal(f.api.saveMemories('A',[original]),false);});
test('unconfirmed operation fails before writes',()=>{const f=fixture();f.opts.confirmed=false;assert.equal(revise(f).reason,'invalid-scope');assert.equal(f.writes(),0);});
test('role mismatch fails before writes',()=>{const f=fixture();f.role('B');assert.equal(revise(f).reason,'invalid-scope');assert.equal(f.writes(),0);});
test('account mismatch fails before writes',()=>{const f=fixture();f.opts.accountId='other';assert.equal(revise(f).reason,'invalid-scope');assert.equal(f.writes(),0);});
test('changed snapshot blocks write',()=>{const f=fixture([original],{change:true});assert.equal(revise(f).reason,'stale-memory');assert.equal(f.writes(),0);});
test('dropped write fails readback',()=>{const f=fixture([original],{drop:true});assert.equal(revise(f).reason,'readback-failed');assert.deepEqual(f.records(),[original]);});
test('capacity never evicts',()=>{const f=fixture(Array.from({length:300},(_,i)=>i===0?original:{id:'other'+i,content:'old'}));assert.equal(revise(f).reason,'capacity');assert.equal(f.writes(),0);});
test('malformed chain fails closed',()=>{const f=fixture([{...original,status:'superseded-fixed'}]);assert.equal(revise(f).reason,'revision-conflict');assert.equal(f.writes(),0);});
test('new revision after undo retains withdrawn child',()=>{const f=fixture(),a=revise(f);assert.equal(undo(f,a.memory).ok,true);assert.equal(revise(f).ok,true);assert.equal(f.records()[1].status,'withdrawn');assert.equal(f.records().length,3);});
test('foreign original cannot be revised',()=>{const foreign={...original,sourceRoleId:'B'},f=fixture([foreign]);assert.equal(revise(f,foreign).reason,'stale-memory');assert.equal(f.writes(),0);});
