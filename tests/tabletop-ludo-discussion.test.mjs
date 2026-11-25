import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLudoDiscussion} from '../games/tabletop/ludo-discussion.js';
function fixture(options={}){
  const seats=[{seatId:'user',kind:'user',mode:'player'},{seatId:'role:r',kind:'role',roleId:'r',mode:'player'},{seatId:'bot:1',kind:'bot',mode:'player'}];
  const view={roomId:'r',gameId:'ludo',phase:'playing',selfSeatId:'user',seats,turnSeatId:'user',revision:1,game:{stage:'roll'}};
  let ac=new AbortController(),valid=true;
  const session={viewUser:async()=>({...view}),viewRole:async()=>({...view,selfSeatId:'role:r'}),viewBot:async()=>({...view,selfSeatId:'bot:1'}),discussionSignal:async()=>ac.signal,discussionCurrent:(s,{allowFinished=false}={})=>valid&&s===ac.signal&&!s.aborted&&(view.phase==='playing'||allowFinished&&view.phase==='finished')};
  const discussion=createLudoDiscussion({session,view,...options});
  return {discussion,view,revoke(){valid=false;ac.abort();},update(){view.revision++;}};
}
test('separate provider routes and ordered public history, no private source fallback',async()=>{
  const calls=[],f=fixture({allowOutput:()=>true,generateRole:async c=>{calls.push(['role',c]);return '我选这条路线。';},generateBot:async c=>{calls.push(['bot',c]);return '该我了。';}});
  const one=f.discussion.send({messageId:'a',text:'一起玩'}),two=f.discussion.send({messageId:'b',text:'你怎么看？',replyToSeatId:'bot:1'});
  assert.equal((await one).committed,2);assert.equal((await two).committed,1);
  assert.deepEqual(calls.map(c=>c[0]),['role','bot','bot']);
  assert.deepEqual(calls[1][1].messages.map(m=>m.text),['一起玩','我选这条路线。']);
  assert.equal(calls[1][1].selfSeatId,'bot:1');
  assert.deepEqual((await f.discussion.read()).map(m=>m.sender.kind),['user','role','bot','user','bot']);
  assert.equal((await f.discussion.send({messageId:'b',text:'你怎么看？'})).duplicate,true);assert.equal(calls.length,3);
});
test('no connected model means visible reason and no fabricated replies',async()=>{
  const f=fixture();assert.equal((await f.discussion.send({messageId:'a',text:'你好'})).reason,'MODEL_UNAVAILABLE');
  assert.equal((await f.discussion.read()).length,1);
});
test('output denial never appends generated text',async()=>{
  const f=fixture({generateRole:()=> '私人资料',allowOutput:()=>false});
  await assert.rejects(f.discussion.send({messageId:'a',text:'你好'}),/SPEECH_AUTHORIZATION_FAILED/);
  assert.equal((await f.discussion.read()).length,1);
});
test('stop clears queued work and prevents late response from being written',async()=>{
  let resolve,started;
  const waiting=new Promise(r=>{started=r;});
  const f=fixture({generateRole:()=>{started();return new Promise(r=>{resolve=r;});},allowOutput:()=>true});
  const a=f.discussion.send({messageId:'a',text:'先说'}),b=f.discussion.send({messageId:'b',text:'下一条'});
  const ra=assert.rejects(a,/SPEECH_CANCELLED|LUDO_DISCUSSION_STOPPED/),rb=assert.rejects(b,/LUDO_DISCUSSION_STOPPED/);
  await waiting;f.discussion.stop();resolve('迟到回复');await Promise.all([ra,rb]);
  assert.equal((await f.discussion.read()).length,1);
});
test('account invalidation after generation cannot publish',async()=>{
  let f;
  f=fixture({generateRole:async()=>{f.revoke();return '过期消息';},allowOutput:()=>true});
  await assert.rejects(f.discussion.send({messageId:'a',text:'开始'}),/SPEECH_CANCELLED|SPEECH_AUTHORIZATION_FAILED/);
  await assert.rejects(f.discussion.read(),/LUDO_DISCUSSION_SCOPE/);
});
test('finished room can read history but cannot begin generation',async()=>{
  const f=fixture();await f.discussion.send({messageId:'a',text:'结束前'});
  f.view.phase='finished';assert.equal((await f.discussion.read()).length,1);
  await assert.rejects(f.discussion.send({messageId:'b',text:'结束后'}),/LUDO_DISCUSSION_SCOPE/);
});
