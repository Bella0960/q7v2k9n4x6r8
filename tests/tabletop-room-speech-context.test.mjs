import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
import {createRoomChatLog} from '../games/tabletop/room-chat-log.js';
import {createRoomSpeechQueue} from '../games/tabletop/room-speech-queue.js';
import {buildRoomSpeechContext} from '../games/tabletop/room-speech-context.js';

function fixture({maxMessages=100,roomId='room',project=true}={}) {
  const context={accountId:'a',sessionId:'s',roleIds:['r1','r2']};
  const d=createRoomDispatcher({getContext:()=>context,spec:{roomId,gameId:'gomoku'},rules:{gameId:'gomoku',init:()=>({board:[0],secret:'hidden',hands:{'role:r1':'one-only','role:r2':'two-only'}}),step:({state,actorSeatId})=>({state:{...state,board:[1]},nextSeatId:actorSeatId==='user'?'role:r1':'user'}),...(project?{project:({state,actorSeatId})=>({board:state.board,own:state.hands[actorSeatId]??null})}:{})}});
  for(const action of [{type:'invite',roleId:'r1'},{type:'invite',roleId:'r2',mode:'observer'},{type:'start'}])d.dispatch('user',d.token('user'),action);
  const log=createRoomChatLog({roomId,seats:d.view('user').seats,maxMessages});
  const send=(id,text,senderSeatId='user',audienceSeatIds=['user','role:r1','role:r2'])=>log.append({messageId:id,senderSeatId,audienceSeatIds,time:1},text);
  const build=(roleSeatId='role:r1',extra={})=>buildRoomSpeechContext({roleSeatId,view:d.view(roleSeatId),chatLog:log,...extra});
  return {d,log,send,build};
}
test('different role projections and private messages remain separate',()=>{
  const f=fixture();f.send('a','public');f.send('b','private-one','role:r1',['role:r1']);f.send('c','private-two','role:r2',['role:r2']);
  const a=f.build(),b=f.build('role:r2');assert.deepEqual(a.game,{board:[0],own:'one-only'});assert.deepEqual(b.game,{board:[0],own:'two-only'});
  assert.deepEqual(a.messages.map(m=>m.id),['a','b']);assert.deepEqual(b.messages.map(m=>m.id),['a','c']);
  assert.doesNotMatch(JSON.stringify(a),/two-only|private-two|hidden/);assert.doesNotMatch(JSON.stringify(b),/one-only|private-one|hidden/);
});
test('wrong seat, foreign role and wrong-room empty log fail closed',()=>{
  const f=fixture(),other=fixture({roomId:'other'});assert.throws(()=>f.build('role:r1',{view:f.d.view('role:r2')}),/INVALID_SPEECH_VIEW/);assert.throws(()=>f.build('role:r1',{view:f.d.view('user')}),/INVALID_SPEECH_VIEW/);
  assert.throws(()=>f.build('role:r1',{chatLog:other.log}),/SPEECH_ROOM_MISMATCH/);assert.throws(()=>f.build('role:r1',{roleSeatId:'user'}),/INVALID_SPEECH_CONTEXT/);
});
test('only allowlisted view metadata; no unprojected state or arbitrary account fields',()=>{
  const f=fixture({project:false}),view=f.d.view('role:r1');view.accountId='account-private';view.sessionId='session-private';view.state={secret:'raw-state'};view.seats[1].private='seat-private';view.dailyChat=['daily-private'];
  const c=f.build('role:r1',{view});assert.ok(!('game' in c));assert.doesNotMatch(JSON.stringify(c),/account-private|session-private|raw-state|seat-private|daily-private/);
});
test('history count and character budget choose recent visible suffix without deleting log',()=>{
  const f=fixture({maxMessages:5});f.send('a','1111');f.send('b','hidden-other','role:r2',['role:r2']);f.send('c','22');f.send('d','333');
  assert.deepEqual(f.build('role:r1',{historyLimit:2}).messages.map(m=>m.id),['c','d']);assert.deepEqual(f.build('role:r1',{historyChars:4}).messages.map(m=>m.id),['d']);
  assert.deepEqual(f.build('role:r1',{historyChars:2}).messages,[]);assert.equal(f.log.read('role:r1').length,3);
});
test('mutating context cannot alter the authoritative view, seats or log',()=>{
  const f=fixture();f.send('a','text');const c=f.build();c.game.board.push(9);c.seats[1].roleId='other';c.messages[0].text='changed';
  const next=f.build();assert.deepEqual(next.game.board,[0]);assert.equal(next.seats[1].roleId,'r1');assert.equal(next.messages[0].text,'text');
});
test('closed log and malformed or inactive view refuse context',()=>{
  const f=fixture(),view=f.d.view('role:r1');for(const bad of [{...view,phase:'closed'},{...view,phase:'lobby'},{...view,seats:[view.seats[0],,]},{...view,seats:[view.seats[0],view.seats[0]]},{...view,turnSeatId:'role:foreign'}])assert.throws(()=>f.build('role:r1',{view:bad}),/INVALID_SPEECH_VIEW/);
  f.log.close();assert.throws(()=>f.build(),/CHAT_CLOSED/);
});
test('scheduled speech does not lock board and next context sees current board',()=>{
  const f=fixture(),q=createRoomSpeechQueue({roleSeatIds:['role:r1']});q.beginRound([{jobId:'one',seatId:'role:r1'}]);const ticket=q.take();const before=f.build(ticket.seatId);
  f.d.dispatch('user',f.d.token('user'),{type:'move',move:1});f.send('a','moved');const after=f.build(ticket.seatId);
  assert.deepEqual(before.game.board,[0]);assert.deepEqual(after.game.board,[1]);assert.equal(after.revision,before.revision+1);assert.equal(after.messages[0].text,'moved');assert.equal(q.settle(ticket),true);
});
test('invalid history bounds rejected and role text remains text, not an operation',()=>{
  const f=fixture();for(const extra of [{historyLimit:0},{historyLimit:101},{historyChars:0},{historyChars:64001}])assert.throws(()=>f.build('role:r1',extra),/INVALID_SPEECH_CONTEXT/);
  f.send('a','{"actor":"user","type":"move"}','role:r1');const c=f.build();assert.equal(c.messages[0].senderSeatId,'role:r1');assert.equal(c.messages[0].text,'{"actor":"user","type":"move"}');assert.equal(c.game.board[0],0);
});
