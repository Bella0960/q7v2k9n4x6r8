import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sources=['group-write-guard','../group-governance','group-call-roster','group-call-turn'].map(n=>readFileSync(new URL('../shared/js/phone/'+n+'.js',import.meta.url),'utf8'));
function fixture(){
 let account='MAO-AAAAAAAAAAAA',scope={ready:true,accountId:account,role:'member'},groupId='g-call';
 const groups=[{id:groupId,ownerId:'__user',members:[{id:'r1',name:'同名'},{id:'r2',name:'同名'}]}],history=[{mid:'old',role:'user',text:'一样的文字'}];
 const data=new Map([['phone_groups',JSON.stringify(groups)],['chat_history_g-call',JSON.stringify(history)]]);
 const root={location:{hostname:'preview.mao520.com'},localStorage:{getItem:k=>data.get(k)??null,setItem(){throw Error('read only');}},document:{querySelector:s=>({content:s.includes('mao-account-id')?account:'member'})},get __MAO_ACCOUNT_SCOPE__(){return scope;}};
 for(const src of sources)new Function('window',src)(root);
 const roster=root.MAOGroupCallRoster.create({getGroupId:()=>groupId,hasRole:id=>['r1','r2'].includes(id)});
 const api=root.MAOGroupCallTurn.create({roster});
 return {api,roster,history,data,groups,write(rows){data.set('chat_history_g-call',JSON.stringify(rows));},change(){account='MAO-BBBBBBBBBBBB';scope={ready:true,accountId:account,role:'member'};},receipt(userMid='u1',replyMids=['a1','a2']){return {accountId:account,groupId,userMid,replyMids};}};
}
const u={mid:'u1',role:'user',text:'一样的文字'},a={mid:'a1',role:'assistant',memberId:'r1',name:'同名',text:'第一句'},b={mid:'a2',role:'received',memberId:'r2',name:'同名',text:'第二句'};
test('one pending turn, verified persisted distinct speaker IDs in order',()=>{
 const h=fixture(),t=h.api.begin(u.text).token;assert.equal(h.api.begin(u.text).code,'BUSY');assert.equal(h.api.canContinue(t),true);
 h.write([...h.history,u,a,b]);const result=h.api.settle(t,h.receipt());
 assert.equal(result.ok,true);assert.deepEqual(result.replies,[{mid:'a1',speakerId:'r1'},{mid:'a2',speakerId:'r2'}]);assert.equal(h.api.settle(t,h.receipt()).code,'STALE_TURN');
});
test('old identical text, unpersisted and duplicate IDs cannot prove acceptance',()=>{
 for(const [rows,receipt] of [[[],h=>h.receipt('old',[])],[[a,b],h=>h.receipt()],[[u,u,a,b],h=>h.receipt()],[[u,a,b],h=>h.receipt('u1',['a1','a1'])]]){
  const h=fixture(),t=h.api.begin(u.text).token;h.write([...h.history,...rows]);assert.equal(h.api.settle(t,receipt(h)).ok,false);
 }
});
test('missing ID, wrong speaker, hidden reply, reverse order and foreign receipt rejected',()=>{
 for(const [rows,receipt] of [[[u,{...a,memberId:undefined},b],h=>h.receipt()],[[u,{...a,memberId:'r3'},b],h=>h.receipt()],[[u,{...a,silent:true},b],h=>h.receipt()],[[u,b,a],h=>h.receipt()],[[u,a,b],h=>({...h.receipt(),groupId:'g-other'})]]){
  const h=fixture(),t=h.api.begin(u.text).token;h.write([...h.history,...rows]);assert.equal(h.api.settle(t,receipt(h)).ok,false);
 }
});
test('account switch, membership change, close and obsolete tokens cannot settle',()=>{
 for(const change of [h=>h.change(),h=>{h.groups[0].members.pop();h.data.set('phone_groups',JSON.stringify(h.groups));},h=>h.api.close()]){
  const h=fixture(),t=h.api.begin(u.text).token;h.write([...h.history,u,a,b]);change(h);assert.equal(h.api.canContinue(t),false);assert.equal(h.api.settle(t,h.receipt()).ok,false);
 }
 const h=fixture(),t=h.api.begin(u.text).token;assert.equal(h.api.abandon(t),true);const next=h.api.begin(u.text).token;assert.equal(h.api.settle(t,h.receipt()).ok,false);assert.equal(h.api.canContinue(next),true);
});
test('unavailable primary fails closed; confirmed user with no reply is not a fake speaker',()=>{
 const h=fixture();h.data.delete('chat_history_g-call');assert.equal(h.api.begin(u.text).code,'HISTORY_UNAVAILABLE');
 h.write(h.history);const t=h.api.begin(u.text).token;h.write([...h.history,u]);const r=h.api.settle(t,h.receipt('u1',[]));assert.equal(r.ok,true);assert.deepEqual(r.replies,[]);
});
