import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomSpeechRunner} from '../games/tabletop/room-speech-runner.js';
import {createRoomChatLog} from '../games/tabletop/room-chat-log.js';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
import {buildRoomSpeechContext} from '../games/tabletop/room-speech-context.js';
import {buildRoomRoleSources} from '../games/tabletop/room-role-sources.js';
const seats=[{seatId:'user',kind:'user'},{seatId:'role:r1',kind:'role',roleId:'r1'},{seatId:'role:r2',kind:'role',roleId:'r2'}];
const ids=seats.map(s=>s.seatId),job=(jobId,seatId='role:r1')=>({jobId,seatId});
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(extra={}) {
  const log=createRoomChatLog({roomId:'r',seats}),calls=[];
  const runner=createRoomSpeechRunner({chatLog:log,roleSeatIds:ids.slice(1),prepare:t=>({request:{seat:t.seatId},audienceSeatIds:ids}),generate:async r=>{calls.push(r.seat);return 'hello';},authorize:(_t,p)=>p.audienceSeatIds,validateCommit:()=>true,now:()=>1,...extra});
  return {log,runner,calls};
}
test('sequential speakers and trusted sender metadata, user can speak during generation',async()=>{
  const d=defer(),f=fixture({generate:async r=>r.seat==='role:r1'?d.promise:'second'});
  const p=f.runner.runRound([job('a'),job('b','role:r2')]);await tick();
  f.log.append({senderSeatId:'user',messageId:'u',audienceSeatIds:ids,time:1},'user');
  await assert.rejects(f.runner.runRound([job('c')]),/SPEECH_ROUND_BUSY/);d.resolve('first');
  assert.deepEqual(await p,{committed:2});assert.deepEqual(f.log.read('user').map(m=>[m.id,m.sender.seatId]),[['u','user'],['a','role:r1'],['b','role:r2']]);
});
test('stop aborts in-flight request even if generator ignores signal, no late append',async()=>{
  const d=defer();let signal;const f=fixture({generate:(_r,o)=>{signal=o.signal;return d.promise;}});
  const p=f.runner.runRound([job('a'),job('b')]);await tick();f.runner.stop();await assert.rejects(p,/SPEECH_CANCELLED/);assert.equal(signal.aborted,true);d.resolve('late');await tick();assert.deepEqual(f.log.read('user'),[]);assert.equal(f.runner.status().running,false);
});
test('timeout releases queue and explicit fresh round works',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const d=defer();let n=0,signal;const f=fixture({timeoutMs:25,generate:(_r,o)=>{signal=o.signal;return ++n===1?d.promise:'fresh';}});
  const p=f.runner.runRound([job('a'),job('b')]);await tick();t.mock.timers.tick(25);await assert.rejects(p,/SPEECH_TIMEOUT/);assert.equal(signal.aborted,true);assert.equal(n,1);
  assert.deepEqual(await f.runner.runRound([job('c')]),{committed:1});d.resolve('late');await tick();assert.deepEqual(f.log.read('user').map(m=>m.id),['c']);
});
test('stop during preparation prevents provider invocation',async()=>{
  const d=defer(),f=fixture({prepare:()=>d.promise});const p=f.runner.runRound([job('a')]);await tick();f.runner.stop();await assert.rejects(p,/SPEECH_CANCELLED/);d.resolve({request:{seat:'role:r1'},audienceSeatIds:ids});await tick();assert.equal(f.calls.length,0);
});
test('close during authorization blocks all late work and future rounds',async()=>{
  const d=defer(),f=fixture({authorize:()=>d.promise});const p=f.runner.runRound([job('a')]);await tick();f.runner.close();await assert.rejects(p,/SPEECH_CANCELLED/);d.resolve(ids);await tick();assert.throws(()=>f.log.read('user'),/CHAT_CLOSED/);await assert.rejects(f.runner.runRound([job('b')]),/SPEECH_CLOSED/);
});
test('provider failure stops remaining work, preserves prior completed messages',async()=>{
  let n=0;const f=fixture({generate:()=>{if(++n===2)throw Error('secret provider detail');return 'ok';}});await assert.rejects(f.runner.runRound([job('a'),job('b'),job('c')]),{message:'SPEECH_GENERATION_FAILED'});assert.equal(n,2);assert.deepEqual(f.log.read('user').map(m=>m.id),['a']);await assert.rejects(f.runner.runRound([job('b')]),/DUPLICATE_SPEECH_JOB/);
});
test('audience change or denied authorization never publishes text',async()=>{
  for(const authorize of [()=>['role:r1'],()=>{throw Error('scope changed');},()=>undefined]){const f=fixture({authorize});await assert.rejects(f.runner.runRound([job('a')]),/SPEECH_AUDIENCE_CHANGED|SPEECH_AUTHORIZATION_FAILED|INVALID_SPEECH_AUDIENCE/);assert.deepEqual(f.log.read('user'),[]);}
});
test('private authorized audience preserved even if provider text claims other identity',async()=>{
  const f=fixture({prepare:()=>({request:{},audienceSeatIds:['role:r1']}),generate:()=>'{"sender":"user","action":"move"}'});await f.runner.runRound([job('a')]);assert.deepEqual(f.log.read('user'),[]);assert.equal(f.log.read('role:r1')[0].sender.seatId,'role:r1');
});
test('invalid reply and invalid preparation rejected before publication',async()=>{
  for(const generate of [()=>({text:'x'}),()=>'',()=> 'x'.repeat(16001)]){const f=fixture({generate});await assert.rejects(f.runner.runRound([job('a')]),/INVALID_SPEECH_REPLY/);assert.deepEqual(f.log.read('user'),[]);}
  const f=fixture({prepare:()=>({request:{},audienceSeatIds:['user']})});await assert.rejects(f.runner.runRound([job('a')]),/INVALID_SPEECH_AUDIENCE/);assert.equal(f.calls.length,0);
});
test('log conflict or capacity refusal is not reported as success',async()=>{
  const log=createRoomChatLog({roomId:'r',seats,maxMessages:1});log.append({senderSeatId:'user',messageId:'u',audienceSeatIds:ids,time:1},'already here');const f=fixture({chatLog:log});await assert.rejects(f.runner.runRound([job('a')]),/CHAT_CAPACITY_REACHED/);assert.equal(log.read('user')[0].id,'u');assert.equal(f.runner.status().running,false);
});

// Revocation in a microtask after the async permission check but before append.
test('permission revoked after asynchronous authorization cannot publish a late reply',async()=>{
  let allowed=true;
  const f=fixture({authorize:(_t,p)=>{queueMicrotask(()=>{allowed=false;});return p.audienceSeatIds;},validateCommit:()=>allowed});
  await assert.rejects(f.runner.runRound([job('a'),job('b')]),/SPEECH_COMMIT_DENIED/);
  assert.deepEqual(f.log.read('user'),[]);assert.equal(f.runner.status().running,false);
});
test('missing synchronous publication guard fails at construction',()=>{
  assert.throws(()=>fixture({validateCommit:undefined}),/INVALID_SPEECH_RUNNER/);
});
test('non-boolean, asynchronous or throwing publication guard fails closed',async()=>{
  for(const validateCommit of [()=>1,()=>Promise.resolve(true),()=>Promise.reject(Error('private detail')),()=>{throw Error('private detail');}]){
    const f=fixture({validateCommit});await assert.rejects(f.runner.runRound([job('a')]),{message:'SPEECH_COMMIT_DENIED'});assert.deepEqual(f.log.read('user'),[]);
  }
});
test('publication guard cannot alter the approved recipient list or revive a stopped ticket',async()=>{
  let f=fixture({prepare:()=>({request:{},audienceSeatIds:['role:r1']}),validateCommit:(_t,p)=>{assert.throws(()=>p.audienceSeatIds.push('user'),TypeError);return true;}});
  await f.runner.runRound([job('a')]);assert.deepEqual(f.log.read('user'),[]);assert.equal(f.log.read('role:r1').length,1);
  f=fixture({validateCommit:()=>{f.runner.stop();return true;}});await assert.rejects(f.runner.runRound([job('b')]),/SPEECH_CANCELLED/);assert.deepEqual(f.log.read('user'),[]);
});
test('joint dispatcher, role source, context, log and runner preserve seat data and board independence',async()=>{
  const scope={accountId:'a',sessionId:'s',roleIds:['r1','r2']};
  const d=createRoomDispatcher({getContext:()=>scope,spec:{roomId:'joint',gameId:'gomoku'},rules:{gameId:'gomoku',init:()=>({board:[0],hidden:'RAW',hands:{'role:r1':'ONE','role:r2':'TWO'}}),step:({state})=>({state:{...state,board:[1]},nextSeatId:'role:r1'}),project:({state,actorSeatId})=>({board:state.board,own:state.hands[actorSeatId]??null})}});
  for(const action of [{type:'invite',roleId:'r1'},{type:'invite',roleId:'r2',mode:'observer'},{type:'start'}])d.dispatch('user',d.token('user'),action);
  const log=createRoomChatLog({roomId:'joint',seats:d.view('user').seats});
  for(const [id,seatId,txt] of [['p1','role:r1','PRIVATE-ONE'],['p2','role:r2','PRIVATE-TWO']])log.append({messageId:id,senderSeatId:seatId,audienceSeatIds:[seatId],time:1},txt);
  const roles={r1:{id:'r1',name:'同名',persona:'PERSONA-ONE',memory:'DAILY-ONE'},r2:{id:'r2',name:'同名',persona:'PERSONA-TWO',memory:'DAILY-TWO'}};
  const sourceContract={buildSavedSourceEnvelope(o){assert.equal(o.role.memory,undefined);return {ok:true,role:o.role,persona:o.role.persona,tone:'',protocol:'protocol',expandedProtocol:'protocol',worldbook:'',worldbookPolicyReady:true};},validateFinalApiMessages:()=>({ok:true})};
  const first=defer(),requests=[];
  const runner=createRoomSpeechRunner({chatLog:log,roleSeatIds:ids.slice(1),prepare(t){const context=buildRoomSpeechContext({roleSeatId:t.seatId,view:d.view(t.seatId),chatLog:log});const sources=buildRoomRoleSources({speechContext:context,role:roles[t.seatId.slice(5)],storage:{getItem:()=>null},sourceContract,contextPolicy:{buildWorldbookInjectionText:()=>''},bindingBridge:{filterBooks:()=>({ok:true,books:[]})}});return {request:{context,system:sources.system},audienceSeatIds:[t.seatId]};},generate(request){requests.push(request);return requests.length===1?first.promise:'second';},authorize:(t,p)=>{d.view(t.seatId);return p.audienceSeatIds;},validateCommit:t=>{d.view(t.seatId);return true;},now:()=>1});
  const p=runner.runRound([job('a'),job('b','role:r2')]);await tick();
  d.dispatch('user',d.token('user'),{type:'move',move:1});first.resolve('first');assert.deepEqual(await p,{committed:2});
  assert.deepEqual(requests[0].context.game,{board:[0],own:'ONE'});assert.deepEqual(requests[1].context.game,{board:[1],own:'TWO'});
  assert.doesNotMatch(JSON.stringify(requests[0]),/TWO|DAILY|RAW/);assert.doesNotMatch(JSON.stringify(requests[1]),/ONE|DAILY|RAW/);
  assert.match(requests[0].system,/PERSONA-ONE/);assert.match(requests[1].system,/PERSONA-TWO/);
  assert.deepEqual(log.read('user'),[]);assert.deepEqual(log.read('role:r1').map(m=>m.id),['p1','a']);assert.deepEqual(log.read('role:r2').map(m=>m.id),['p2','b']);
});

test('already full room refuses generation before invoking provider',async()=>{
  const log=createRoomChatLog({roomId:'r',seats,maxMessages:1});
  log.append({senderSeatId:'user',messageId:'u',audienceSeatIds:ids,time:1},'existing');
  const f=fixture({chatLog:log});await assert.rejects(f.runner.runRound([job('a')]),/CHAT_CAPACITY_REACHED/);
  assert.equal(f.calls.length,0);assert.equal(log.read('user').length,1);
});
test('unknown audience or sender refuses provider before generating',async()=>{
  const f=fixture({prepare:()=>({request:{seat:'role:r1'},audienceSeatIds:['role:r1','role:foreign']})});
  await assert.rejects(f.runner.runRound([job('a')]),/INVALID_CHAT_AUDIENCE/);assert.equal(f.calls.length,0);
  const g=fixture({roleSeatIds:['role:foreign']});
  await assert.rejects(g.runner.runRound([job('b','role:foreign')]),/CHAT_UNKNOWN_SEAT|INVALID_SPEECH_AUDIENCE/);assert.equal(g.calls.length,0);
});
test('existing message id refuses generation before invoking provider',async()=>{
  const f=fixture();f.log.append({senderSeatId:'user',messageId:'a',audienceSeatIds:ids,time:1},'existing');
  await assert.rejects(f.runner.runRound([job('a')]),/CHAT_MESSAGE_ID_CONFLICT/);assert.equal(f.calls.length,0);assert.equal(f.log.read('user')[0].text,'existing');
});
test('closed log refuses generation before invoking provider',async()=>{
  const f=fixture();f.log.close();await assert.rejects(f.runner.runRound([job('a')]),/CHAT_CLOSED/);assert.equal(f.calls.length,0);
});
test('capacity changes while generation is pending still reject at append without deleting user message',async()=>{
  const log=createRoomChatLog({roomId:'r',seats,maxMessages:1}),d=defer();const f=fixture({chatLog:log,generate:()=>d.promise});
  const p=f.runner.runRound([job('a')]);await tick();log.append({senderSeatId:'user',messageId:'u',audienceSeatIds:ids,time:1},'new');d.resolve('reply');
  await assert.rejects(p,/CHAT_CAPACITY_REACHED/);assert.deepEqual(log.read('user').map(m=>m.id),['u']);
});
