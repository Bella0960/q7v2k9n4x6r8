import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomSpeechQueue} from '../games/tabletop/room-speech-queue.js';
import {createRoomChatLog} from '../games/tabletop/room-chat-log.js';

const queue=(extra={})=>createRoomSpeechQueue({roleSeatIds:['role:r1','role:r2'],...extra});
const job=(jobId,seatId='role:r1')=>({jobId,seatId});

test('one in-flight speaker and stable order, including repeat speakers',()=>{
  const q=queue();q.beginRound([job('a'),job('b','role:r2'),job('c')]);
  for(const [id,seat] of [['a','role:r1'],['b','role:r2'],['c','role:r1']]){
    const t=q.take();assert.equal(t.jobId,id);assert.equal(t.seatId,seat);
    assert.equal(q.take(),null);assert.equal(q.settle(t),true);assert.equal(q.settle(t),false);
  }
  assert.equal(q.take(),null);assert.equal(q.status().active,false);
});
test('busy round cannot be replaced or extended',()=>{
  const q=queue();q.beginRound([job('a'),job('b')]);
  assert.throws(()=>q.beginRound([job('c')]),/SPEECH_ROUND_BUSY/);
  const a=q.take();assert.throws(()=>q.beginRound([job('c')]),/SPEECH_ROUND_BUSY/);
  assert.equal(q.settle(a),true);assert.equal(q.take().jobId,'b');
});
test('invalid batch does not reserve jobs or partially enqueue',()=>{
  const q=queue();for(const jobs of [[],[job('a'),job('b','user')],[job('a'),,],[job('a'),job('a')],[job('a'),job('b','role:foreign')]]){
    assert.throws(()=>q.beginRound(jobs),/INVALID_SPEECH_|DUPLICATE_SPEECH_JOB/);
    assert.equal(q.status().queued,0);assert.equal(q.status().remaining,128);
  }
  q.beginRound([job('a')]);assert.equal(q.take().jobId,'a');
});
test('per-round and room limits reject the entire excess batch',()=>{
  const q=queue({maxPerRound:2,maxPerRoom:3});
  assert.throws(()=>q.beginRound([job('a'),job('b'),job('c')]),/INVALID_SPEECH_ROUND/);
  q.beginRound([job('a'),job('b')]);q.stop();assert.equal(q.status().remaining,1);
  assert.throws(()=>q.beginRound([job('c'),job('d')]),/SPEECH_BUDGET_EXHAUSTED/);
  assert.equal(q.status().remaining,1);q.beginRound([job('c')]);q.settle(q.take());
  assert.throws(()=>q.beginRound([job('d')]),/SPEECH_BUDGET_EXHAUSTED/);
});
test('completed and cancelled IDs cannot be retried or silently replayed',()=>{
  const q=queue();q.beginRound([job('a')]);q.settle(q.take());q.beginRound([job('b'),job('c')]);q.take();q.stop();
  for(const i of ['a','b','c']) assert.throws(()=>q.beginRound([job(i)]),/DUPLICATE_SPEECH_JOB/);
  q.beginRound([job('d')]);assert.equal(q.take().jobId,'d');
});
test('stop aborts current request and discards pending jobs, then explicit new round works',()=>{
  const q=queue();q.beginRound([job('a'),job('b')]);const old=q.take();let aborted=0;
  old.signal.addEventListener('abort',()=>aborted++);q.stop();q.stop();
  assert.equal(aborted,1);assert.equal(old.signal.aborted,true);assert.equal(q.take(),null);
  q.beginRound([job('c')]);const fresh=q.take();assert.equal(q.settle(old),false);
  assert.equal(q.take(),null);assert.equal(fresh.signal.aborted,false);assert.equal(q.settle(fresh),true);
});
test('stop cannot be reentered to start a new round from an abort handler',()=>{
  const q=queue();q.beginRound([job('a')]);const t=q.take();let called=false;
  t.signal.addEventListener('abort',()=>{called=true;assert.throws(()=>q.beginRound([job('b')]),/SPEECH_STOPPING/);assert.equal(q.settle(t),false);});
  q.stop();assert.equal(called,true);assert.equal(q.status().queued,0);q.beginRound([job('b')]);
});
test('close is terminal and aborts current ticket; late results are rejected',()=>{
  const q=queue();q.beginRound([job('a'),job('b')]);const t=q.take();q.close();q.close();
  assert.equal(t.signal.aborted,true);assert.equal(q.settle(t),false);assert.equal(q.status().closed,true);
  assert.throws(()=>q.beginRound([job('c')]),/SPEECH_CLOSED/);assert.throws(()=>q.take(),/SPEECH_CLOSED/);
});
test('identical jobs from another queue or a copied ticket cannot settle active work',()=>{
  const a=queue(),b=queue();a.beginRound([job('a')]);b.beginRound([job('a')]);
  const t=a.take(),other=b.take();assert.equal(a.settle(other),false);assert.equal(a.settle({...t}),false);
  assert.equal(a.settle(t),true);assert.equal(b.settle(other),true);
});
test('input mutation and unrecognized payload fields cannot switch speaker or job',()=>{
  const roles=['role:r1'],q=queue({roleSeatIds:roles}),j={...job('a'),text:'untrusted',actor:'user'};
  q.beginRound([j]);j.seatId='user';j.jobId='b';roles.push('role:r2');
  const t=q.take();assert.equal(t.seatId,'role:r1');assert.equal(t.jobId,'a');assert.equal('text' in t,false);
  assert.throws(()=>{t.seatId='user'},TypeError);q.settle(t);assert.throws(()=>q.beginRound([job('b','role:r2')]),/INVALID_SPEECH_JOB/);
});
test('invalid specs and sparse role lists fail closed',()=>{
  for(const extra of [{roleSeatIds:['user']},{roleSeatIds:['role:']},{roleSeatIds:['role:r1','role:r1']},{roleSeatIds:Array(1)},{maxPerRound:0},{maxPerRoom:4},{maxPerRoom:4097}]) assert.throws(()=>queue(extra),/INVALID_SPEECH_SPEC/);
});
test('pure queue plus existing log can reject late speech without blocking user messages',()=>{
  const q=queue(),log=createRoomChatLog({roomId:'fixture',seats:[{seatId:'user',kind:'user'},{seatId:'role:r1',kind:'role',roleId:'r1'}]});
  const append=(senderSeatId,messageId,text)=>log.append({senderSeatId,messageId,audienceSeatIds:['user','role:r1'],time:1},text);
  q.beginRound([job('a')]);const t=q.take();append('user','u','轮到我了');q.stop();
  if(q.settle(t))append(t.seatId,t.jobId,'过期发言');
  q.beginRound([job('b')]);const fresh=q.take();if(q.settle(fresh))append(fresh.seatId,fresh.jobId,'继续下棋');
  assert.deepEqual(log.read('user').map(m=>[m.id,m.sender.seatId]),[['u','user'],['b','role:r1']]);
});
