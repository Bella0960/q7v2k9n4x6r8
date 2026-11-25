import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildRoomRoleSources} from '../games/tabletop/room-role-sources.js';

function fixture(){
  const calls=[],role={id:'r1',name:'同名',persona:'谨慎玩家',tone:'简洁',memory:'DAILY_MEMORY',worldBookIds:['b1'],private:'OTHER_DATA'};
  const speechContext={selfSeatId:'role:r1',seats:[{seatId:'role:r1',kind:'role',roleId:'r1'},{seatId:'role:r2',kind:'role',roleId:'r2'}],messages:[{text:'棋局讨论',other:'PRIVATE'}],dailyChat:['DAILY_HISTORY']};
  const storage={getItem(k){calls.push(k);return k==='phone_worldbooks'?'[]':'协议';}};
  const bindingBridge={filterBooks(id,books,record){calls.push(id);assert.equal(record.id,'r1');return {ok:true,books};}};
  const sourceContract={buildSavedSourceEnvelope(o){calls.push(o);o.storage.getItem('chat_rp_protocol_');o.storage.getItem('phone_worldbooks');o.bindingBridge.filterBooks(o.conversationId,[]);return {ok:true,role:o.role,persona:o.role.persona,tone:o.role.tone,protocol:'协议',expandedProtocol:'协议',worldbook:'棋类设定',worldbookPolicyReady:true};},validateFinalApiMessages(o){calls.push(o);return {ok:true};}};
  const args={role,speechContext,storage,bindingBridge,sourceContract,contextPolicy:{buildWorldbookInjectionText(){return '';}}};
  return {args,calls,role,speechContext,build:()=>buildRoomRoleSources(args)};
}
test('existing source contract receives exact role, not daily memory or other role data',()=>{
  const f=fixture(),out=f.build(),input=f.calls[0];assert.equal(out.roleId,'r1');assert.equal(out.persona,'谨慎玩家');assert.equal(out.tone,'简洁');
  assert.deepEqual(input.role,{id:'r1',name:'同名',persona:'谨慎玩家',tone:'简洁',worldBookIds:['b1']});
  assert.deepEqual(input.recentMessages,[{text:'棋局讨论'}]);assert.equal(input.memory,'');assert.equal(input.conversationId,'r1');
  assert.doesNotMatch(JSON.stringify(out),/DAILY_|PRIVATE|OTHER_DATA/);assert.deepEqual(f.calls.slice(1,4),['chat_rp_protocol_','phone_worldbooks','r1']);
});
test('same name does not authorize another role, user or missing role',()=>{
  for(const role of [{id:'r2',name:'同名'},null,{id:'user',name:'同名'}]){const f=fixture();f.args.role=role;assert.throws(f.build,/SPEECH_ROLE_MISMATCH/);assert.equal(f.calls.length,0);}
});
test('missing shared contract or binding policy rejects instead of fallback',()=>{
  for(const key of ['storage','sourceContract','contextPolicy','bindingBridge']){const f=fixture();delete f.args[key];assert.throws(f.build,/SPEECH_SOURCE_DEPENDENCIES/);}
});
test('only permitted source reads and own binding ID reach shared adapters',()=>{
  for(const key of ['chat_history_r1','chat_memories_r1','api_settings','ai_custom_characters']){const f=fixture();f.args.sourceContract.buildSavedSourceEnvelope=o=>o.storage.getItem(key);assert.throws(f.build,/SPEECH_SOURCE_READ_DENIED/);assert.equal(f.calls.length,0);}
  const f=fixture();f.args.sourceContract.buildSavedSourceEnvelope=o=>o.bindingBridge.filterBooks('r2',[]);assert.throws(f.build,/SPEECH_ROLE_MISMATCH/);assert.equal(f.calls.length,0);
});
test('invalid or failed shared source never becomes a generic prompt',()=>{
  for(const result of [{ok:false,code:'worldbook-storage'},{ok:true,role:{id:'r2'},worldbookPolicyReady:true},{ok:true,role:{id:'r1'},worldbookPolicyReady:false}]){const f=fixture();f.args.sourceContract.buildSavedSourceEnvelope=()=>result;assert.throws(f.build,/SPEECH_SOURCE_UNVERIFIED/);}
  const f=fixture();f.args.sourceContract.validateFinalApiMessages=()=>({ok:false});assert.throws(f.build,/SPEECH_SOURCE_UNVERIFIED/);
});
test('malformed role records and bindings fail before source access',()=>{
  for(const change of [{name:''},{persona:{}},{worldBookIds:['b1',,]},{worldBookIds:[' b1 ']}]){const f=fixture();Object.assign(f.role,change);assert.throws(f.build,/INVALID_SPEECH_ROLE/);assert.equal(f.calls.length,0);}
});
test('valid empty worldbook and existing shared persona fallback are accepted without inventing another role',()=>{
  const f=fixture();f.role.persona='';f.args.sourceContract.buildSavedSourceEnvelope=o=>({ok:true,role:o.role,persona:'共享空档案规则',tone:'',protocol:'协议',expandedProtocol:'协议',worldbook:'',worldbookPolicyReady:true});
  const out=f.build();assert.equal(out.roleId,'r1');assert.equal(out.worldbook,'');assert.equal(out.persona,'共享空档案规则');
});
test('only recent visible texts and detached role binding list, no role record mutation',()=>{
  const f=fixture();f.speechContext.messages=Array.from({length:12},(_,i)=>({text:String(i)}));const original=f.args.sourceContract.buildSavedSourceEnvelope;
  f.args.sourceContract.buildSavedSourceEnvelope=o=>{const result=original(o);o.role.worldBookIds.push('new');return result;};
  const out=f.build();assert.deepEqual(f.calls[0].recentMessages.map(m=>m.text),['4','5','6','7','8','9','10','11']);assert.deepEqual(f.role.worldBookIds,['b1']);assert.throws(()=>{out.name='other'},TypeError);
});
test('oversized or non-string shared source is rejected without silent truncation',()=>{
  for(const value of ['x'.repeat(32001),{},null]){const f=fixture(),original=f.args.sourceContract.buildSavedSourceEnvelope;f.args.sourceContract.buildSavedSourceEnvelope=o=>({...original(o),worldbook:value});assert.throws(f.build,/INVALID_SPEECH_SOURCE/);}
});
