import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomSpeechRunner} from '../games/tabletop/room-speech-runner.js';
import {createRoomChatLog} from '../games/tabletop/room-chat-log.js';
const seats=[{seatId:'user',kind:'user'},{seatId:'role:r1',kind:'role',roleId:'r1'},{seatId:'role:r2',kind:'role',roleId:'r2'}];
const ids=seats.map(s=>s.seatId),job=(jobId,seatId='role:r1')=>({jobId,seatId});
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(extra={}) {
  const log=createRoomChatLog({roomId:'r',seats}),calls=[];
  const runner=createRoomSpeechRunner({chatLog:log,roleSeatIds:ids.slice(1),prepare:t=>({request:{seat:t.seatId},audienceSeatIds:ids}),generate:async r=>{calls.push(r.seat);return 'hello';},authorize:(_t,p)=>p.audienceSeatIds,now:()=>1,...extra});
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
