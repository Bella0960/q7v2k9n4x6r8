import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const page=readFileSync(new URL('../chat/chat/chat-detail.html',import.meta.url),'utf8');
const start=page.indexOf('        const groupCallReceiptBindings=new WeakMap();');
const end=page.indexOf("        window.addEventListener('maomao:followup-message'",start);
assert.ok(start>=0&&end>start);
const source=page.slice(start,end);
function mount(send){
 let current=true,scope={account:'MAO-AAAAAAAAAAAA',group:{members:[{id:'r1'},{id:'r2'}]}};
 const window={},token={accountId:scope.account,groupId:'g1',turn:1};
 const run=new Function('window','isGroupChat','currentRoleId','readGroupScope','groupPageExited','groupGuard','handler',source+'\nfunction sendMsg(opts){return handler(opts,groupCallReceiptBindings.get(opts));}');
 run(window,true,'g1',()=>scope,false,{account:()=>scope.account,matches:()=>current},send);
 return {send:window.sendGroupCallMessage,token,guard:()=>current,revoke:()=>{current=false;}};
}
test('existing sender receives a private binding and exact saved receipt',async()=>{
 const h=mount(async(opts,turn)=>{assert.equal(opts.text,'你好');assert.equal(turn.current(),true);turn.userMid='u1';turn.replyMids.push('r1','r2');});
 const result=await h.send(' 你好 ',h.token,h.guard);
 assert.deepEqual(result,{accountId:h.token.accountId,groupId:'g1',userMid:'u1',replyMids:['r1','r2']});assert.equal(Object.isFrozen(result.replyMids),true);
});
test('busy/no save returns no receipt; no inferred success from text',async()=>{
 const h=mount(async()=>{});assert.equal(await h.send('你好',h.token,h.guard),null);
});
test('scope revoked after asynchronous send cannot return an old receipt',async()=>{
 let h;h=mount(async(opts,turn)=>{turn.userMid='u1';h.revoke();});
 assert.equal(await h.send('你好',h.token,h.guard),null);
 assert.equal(await h.send('你好',{...h.token,groupId:'g2'},()=>true),null);
});
test('committed user ID survives later sender failure without fictional reply',async()=>{
 const h=mount(async(opts,turn)=>{turn.userMid='u1';throw Error('interrupted');});
 const result=await h.send('你好',h.token,h.guard);assert.equal(result.userMid,'u1');assert.deepEqual(result.replyMids,[]);
});
test('actual sender uses locked append, verified reply save, scope guard and bounded serial followups',()=>{
 assert.match(page,/appendChatSafely\(\[userMsg\],callTurn\?callCurrent:undefined\)/);
 assert.match(page,/try\{return callCurrent\(\)&&\(!groupPageExited/);
 assert.match(page,/if\(callTurn&&replySaved&&callCurrent\(\)\)replyMessages\.forEach/);
 assert.match(page,/if\(groupAutoDepth>=callTurn\.maxFollowups\|\|!callCurrent\(\)\)return/);
 assert.match(page,/groupCallReceiptBindings\.set\(next,callTurn\);\s*await sendMsgTurn\(next\)/);
 assert.match(page,/void sendMsg\(\{contextOnly:true,silent:true,groupFollowup:true/);
 assert.match(page,/if\(!callTurn\)\{input\.value = '';input\.style\.height = 'auto';updateSendBtnState\(\);\}/);
});

test('progress publishes exact committed receipt and stops after scope revocation',async()=>{
 let h;h=mount(async(opts,turn)=>{turn.userMid='u1';turn.progress();turn.replyMids.push('r1');turn.progress();h.revoke();turn.replyMids.push('r2');turn.progress();});
 const seen=[];assert.equal(await h.send('你好',h.token,h.guard,value=>seen.push(value)),null);
 assert.deepEqual(seen.map(x=>x.replyMids),[[],['r1']]);
});
