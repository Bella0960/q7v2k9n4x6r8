import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sources=['../shared/js/phone/group-write-guard.js','../shared/js/group-governance.js','../shared/js/phone/group-call-roster.js'].map(path=>readFileSync(new URL(path,import.meta.url),'utf8'));
function fixture(){
 let account='MAO-AAAAAAAAAAAA',groupId='g-call',scope={ready:true,accountId:account,role:'member'};
 const groups=[{id:'g-call',ownerId:'__user',members:[{id:'r1',name:'同名'},{id:'r2',name:'同名'},{id:'r3',muted:true},{id:'r4'}]}];
 const roles=new Set(['r1','r2','r3']),storage={getItem:k=>k==='phone_groups'?JSON.stringify(groups):null,setItem(){throw Error('read only');}};
 const root={location:{hostname:'preview.mao520.com'},localStorage:storage,document:{querySelector:s=>({content:s.includes('mao-account-id')?account:'member'})},get __MAO_ACCOUNT_SCOPE__(){return scope;}};
 for(const src of sources)new Function('window',src)(root);
 const create=()=>root.MAOGroupCallRoster.create({getGroupId:()=>groupId,hasRole:id=>roles.has(id)});
 return {create,groups,roles,root,accountChange(){account='MAO-BBBBBBBBBBBB';scope={ready:true,accountId:account,role:'member'};},scopeChange(){scope={...scope};},groupChange(){groupId='g-other';}};
}
test('same names never substitute for an exact eligible speaker ID',()=>{
 const h=fixture(),r=h.create();
 assert.deepEqual(r.getSnapshot().participants,['r1','r2']);
 assert.equal(r.speakerFor({role:'assistant',memberId:'r2',name:'同名'}),'r2');
 for(const m of [{role:'assistant',name:'同名'},{role:'assistant',memberId:'r3'},{role:'assistant',memberId:'r4'},{role:'user',memberId:'r1'},{role:'assistant',memberId:'r1',isError:true},{role:'assistant',memberId:'__user'}])assert.equal(r.speakerFor(m),null);
});
test('group and role changes invalidate without reopening old scope',()=>{
 for(const change of [h=>h.accountChange(),h=>h.scopeChange(),h=>h.groupChange(),h=>h.groups[0].members.pop(),h=>h.groups[0].members[0].muted=true,h=>h.roles.delete('r1'),h=>h.groups[0].userMembership='left',h=>h.groups.pop()]){
  const h=fixture(),r=h.create();assert.ok(r);
  change(h);assert.equal(r.isCurrent(),false);assert.equal(r.getSnapshot(),null);assert.equal(r.speakerFor({role:'assistant',memberId:'r2'}),null);
 }
});
test('order and presentation edits preserve roster; scope close is terminal',()=>{
 const h=fixture(),r=h.create();h.groups[0].members.reverse();h.groups[0].members[0].name='更名';
 assert.equal(r.isCurrent(),true);assert.equal(Object.isFrozen(r.getSnapshot().participants),true);
 r.close();assert.equal(r.getSnapshot(),null);
});
test('ambiguous group and member IDs fail closed',()=>{
 const h=fixture();h.groups.push({...h.groups[0]});assert.equal(h.create(),null);
 const b=fixture();b.groups[0].members.push({id:'r1'});assert.equal(b.create(),null);
 const c=fixture();c.roles.clear();assert.equal(c.create(),null);
});
