import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomChatLog} from '../games/tabletop/room-chat-log.js';
import {buildRoomSpeechContext} from '../games/tabletop/room-speech-context.js';
import {createRoomSpeechQueue} from '../games/tabletop/room-speech-queue.js';
import {createRoomLifetime} from '../games/tabletop/room-lifetime.js';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
import {createLudoRules} from '../games/tabletop/ludo-rules.js';
function fixture(){
  const ctx={accountId:'a',sessionId:'s',roleIds:['bot:1']};
  const session=createRoomLifetime({getContext:()=>ctx,createDispatcher:createRoomDispatcher,spec:{roomId:'r',gameId:'ludo'},rules:createLudoRules()});
  const act=a=>session.prepareUserAction()(a);act({type:'invite',roleId:'bot:1'});act({type:'fillBots',playerCount:3});
  const view=act({type:'start'}),log=createRoomChatLog({roomId:'r',seats:view.seats});
  return {session,log,view};
}
test('mixed chat identity, public and private audiences stay distinct',()=>{
  const f=fixture(),all=f.view.seats.map(s=>s.seatId);
  f.log.append({senderSeatId:'role:bot:1',messageId:'private',audienceSeatIds:['user','role:bot:1'],time:0},'private role detail');
  f.log.append({senderSeatId:'bot:1',messageId:'public',audienceSeatIds:all,time:1},'ordinary reply');
  const context=buildRoomSpeechContext({roleSeatId:'bot:1',view:f.session.viewBot('bot:1'),chatLog:f.log});
  assert.deepEqual(context.messages.map(m=>m.id),['public']);
  const sender=f.log.read('user')[1].sender;
  assert.deepEqual(sender,{seatId:'bot:1',kind:'bot'});
  const role=buildRoomSpeechContext({roleSeatId:'role:bot:1',view:f.session.viewRole('bot:1'),chatLog:f.log});
  assert.deepEqual(role.messages.map(m=>m.id),['private','public']);
});
test('bot may discuss off-turn but cannot use role view or foreign bot seat',()=>{
  const f=fixture();assert.equal(f.session.viewBot('bot:1').selfSeatId,'bot:1');
  assert.throws(()=>f.session.viewBot('bot:2'),/UNKNOWN_SEAT/);
  assert.throws(()=>f.session.viewBot('role:bot:1'),/INVALID_BOT_SEAT/);
  assert.throws(()=>f.session.prepareBotTurn('bot:1'),/BOT_CANNOT_MOVE/);
});
test('invalid bot identities and role impersonation rejected by context and log',()=>{
  const f=fixture();
  assert.throws(()=>createRoomChatLog({roomId:'r',seats:[{seatId:'user',kind:'user'},{seatId:'bot:1',kind:'bot',roleId:'bot:1'}]}),/INVALID_CHAT_SEAT/);
  assert.throws(()=>buildRoomSpeechContext({roleSeatId:'bot:1',view:f.session.viewRole('bot:1'),chatLog:f.log}),/INVALID_SPEECH_VIEW/);
  const view=f.session.viewBot('bot:1');view.gameId='werewolf';
  assert.throws(()=>buildRoomSpeechContext({roleSeatId:'bot:1',view,chatLog:f.log}),/INVALID_SPEECH_VIEW/);
});
test('mixed queue schedules distinct speakers and cancels without identity alias',()=>{
  const q=createRoomSpeechQueue({roleSeatIds:['role:bot:1','bot:1']});
  q.beginRound([{jobId:'a',seatId:'role:bot:1'},{jobId:'b',seatId:'bot:1'}]);
  const a=q.take();assert.equal(a.seatId,'role:bot:1');assert.equal(q.settle(a),true);
  const b=q.take();assert.equal(b.seatId,'bot:1');q.stop();assert.equal(b.signal.aborted,true);assert.equal(q.settle(b),false);
});
