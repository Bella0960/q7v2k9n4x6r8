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

function event(f,revision,last){f.view.revision=revision;f.view.game={stage:'roll',last};return {...f.view,game:{...f.view.game}};}
const collision={kind:'move',seatId:'bot:1',plane:0,effects:[],captures:[{seatId:'role:r',plane:2}]};
test('collision schedules the affected saved role, carries public event and current board, no duplicate',async()=>{
  const calls=[],f=fixture({generateRole:c=>{calls.push(c);return '下回再追回来。';},generateBot:()=>{throw Error('wrong speaker');},allowOutput:()=>true});
  const v=event(f,4,collision);f.update();
  assert.equal((await f.discussion.react(v)).committed,1);
  assert.equal(calls[0].selfSeatId,'role:r');assert.equal(calls[0].revision,5);
  assert.deepEqual(calls[0].trigger.captures,[{seatId:'role:r',plane:2}]);
  assert.equal(calls[0].trigger.revision,4);
  assert.equal((await f.discussion.react(v)).reason,'STALE_EVENT');
  assert.equal((await f.discussion.read())[0].sender.seatId,'role:r');
});
test('ordinary rolls stay quiet, special events may be declined without bogus text',async()=>{
  let calls=0;const f=fixture({generateRole:()=>{calls++;return null;},allowOutput:()=>{throw Error('silence should not be moderated');}});
  assert.equal((await f.discussion.react(event(f,2,{kind:'roll',seatId:'user',die:4}))).reason,'QUIET');
  assert.equal((await f.discussion.react(event(f,3,{kind:'move',seatId:'role:r',plane:0,effects:['flight'],captures:[]}))).committed,0);
  assert.equal((await f.discussion.react(event(f,4,collision))).reason,'QUIET');
  assert.equal(calls,1);assert.deepEqual(await f.discussion.read(),[]);
  await assert.rejects(f.discussion.send({messageId:'direct',text:'你好',replyToSeatId:'role:r'}),/INVALID_SPEECH_REPLY/);
});
test('automatic event uses bot provider only for ordinary seat, no model means no reply',async()=>{
  const calls=[],f=fixture({generateBot:c=>{calls.push(c);return '这次运气不错。';},allowOutput:()=>true});
  assert.equal((await f.discussion.react(event(f,4,{kind:'move',seatId:'bot:1',plane:1,effects:['flight'],captures:[]}))).committed,1);
  assert.equal(calls[0].selfSeatId,'bot:1');assert.equal((await f.discussion.read())[0].sender.kind,'bot');
  const g=fixture();assert.equal((await g.discussion.react(event(g,4,collision))).reason,'MODEL_UNAVAILABLE');
  assert.deepEqual(await g.discussion.read(),[]);
});
test('manual message preempts a stalled optional reaction, and late reply cannot append',async()=>{
  let started,release;const waiting=new Promise(r=>{started=r;});
  const f=fixture({generateRole:c=>{if(c.trigger){started();return new Promise(r=>{release=r;});}return '收到。';},allowOutput:()=>true});
  const a=f.discussion.react(event(f,4,collision)),ar=assert.rejects(a,/SPEECH_CANCELLED/);await waiting;
  const manual=f.discussion.send({messageId:'m',text:'我想说话',replyToSeatId:'role:r'});release('过期事件');
  await ar;assert.equal((await manual).committed,1);
  assert.deepEqual((await f.discussion.read()).map(m=>m.text),['我想说话','收到。']);
});
test('stale or finished events cannot generate, output denial remains mandatory',async()=>{
  let calls=0;const f=fixture({generateRole:()=>{calls++;return '拒绝发布';},allowOutput:()=>false});
  const old=event(f,4,collision);f.view.revision=20;
  assert.equal((await f.discussion.react(old)).reason,'STALE_EVENT');assert.equal(calls,0);
  await assert.rejects(f.discussion.react(event(f,24,collision)),/SPEECH_AUTHORIZATION_FAILED/);
  f.view.phase='finished';assert.equal((await f.discussion.react({...f.view,revision:28})).reason,'STALE_EVENT');
  assert.equal(calls,1);assert.deepEqual(await f.discussion.read(),[]);
});
test('automatic commentary has a bounded per-match call count',async()=>{
  let calls=0;const f=fixture({generateRole:()=>{calls++;return null;},allowOutput:()=>true});
  for(let i=1;i<=15;i++)await f.discussion.react(event(f,i*5,collision));
  assert.equal(calls,12);assert.deepEqual(await f.discussion.read(),[]);
});
