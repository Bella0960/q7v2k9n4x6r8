// Test-only, in-memory preview. Never import this into the production app.
// The fixed fixture identities below are NOT an authenticated account adapter.
import {createRoomLifetime} from '../../games/tabletop/room-lifetime.js';
import {createRoomDispatcher} from '../../games/tabletop/room-dispatcher.js';
import {createLudoRules} from '../../games/tabletop/ludo-rules.js';
import {createLudoTurnDriver} from '../../games/tabletop/ludo-turn-driver.js';
import {createRoomChatLog} from '../../games/tabletop/room-chat-log.js';
import {createRoomSpeechRunner} from '../../games/tabletop/room-speech-runner.js';
import {buildRoomSpeechContext} from '../../games/tabletop/room-speech-context.js';

export const PREVIEW_PLAYERS=Object.freeze(['fixture-1','fixture-2','fixture-3']);
// Deliberately deterministic fixture replies, never a real model or persona.
export function previewComment(context){
  const self=context.game.players.find(p=>p.seatId===context.selfSeatId);
  const done=self.planes.filter(p=>p.zone==='finished').length;
  const flying=self.planes.filter(p=>p.zone==='track'||p.zone==='home').length;
  return '我的飞机已有 '+done+' 架抵达，'+flying+' 架在途中。'+(context.phase==='finished'?'本局结束了。':context.turnSeatId===context.selfSeatId?'现在轮到我。':'继续看这一回合。');
}
export function createPreviewRound({roomId,selectedIds,render=()=>{},pace=()=>{},rollDie,speechPace=()=>{},onSpeech=()=>{}}={}){
  const fail=code=>{throw Error(code);};
  if(typeof roomId!=='string'||!roomId.startsWith('preview-')||!Array.isArray(selectedIds)||selectedIds.length<1||selectedIds.length>3||new Set(selectedIds).size!==selectedIds.length||!Array.from(selectedIds).every(id=>PREVIEW_PLAYERS.includes(id))||typeof render!=='function')fail('PREVIEW_INVALID_PLAYERS');
  const ids=[...selectedIds],ctx={accountId:'preview-fixture-only',sessionId:roomId,roleIds:ids};
  const room=createRoomLifetime({getContext:()=>ctx,createDispatcher:createRoomDispatcher,spec:{roomId,gameId:'ludo'},rules:createLudoRules({rollDie})});
  for(const roleId of ids)room.prepareUserAction()({type:'invite',roleId});
  room.prepareUserAction()({type:'start'});
  const seats=room.viewUser().seats.map(s=>s.seatId);
  const chat=createRoomChatLog({roomId,seats:room.viewUser().seats,maxMessages:256,maxTextLength:1000});
  let disposed=false,busy=false,revision=-1,seq=0;
  function alive(){if(disposed)fail('PREVIEW_DISPOSED');}
  function publish(view){alive();if(view.revision!==revision){render(view);revision=view.revision;}}
  const driver=createLudoTurnDriver({session:room,onView:publish,pace});
  let speechSeq=0,discussing=false,speaker=null;
  const roleSeatIds=seats.filter(id=>id!=='user');
  const runner=createRoomSpeechRunner({chatLog:chat,roleSeatIds,maxPerRound:3,maxPerRoom:60,
    prepare(ticket){
      alive();speaker=ticket.seatId;onSpeech();
      return {request:buildRoomSpeechContext({roleSeatId:ticket.seatId,view:room.viewRole(ticket.seatId.slice(5)),chatLog:chat}),audienceSeatIds:seats};
    },
    async generate(context,{signal}){await speechPace(signal);if(signal.aborted)fail('PREVIEW_SPEECH_CANCELLED');return previewComment(context);},
    authorize(ticket,p){alive();room.viewRole(ticket.seatId.slice(5));return p.audienceSeatIds;},
    validateCommit(ticket){if(disposed)return false;try{return room.viewRole(ticket.seatId.slice(5)).roomId===roomId;}catch{return false;}}
  });
  async function discuss(){
    alive();if(discussing)fail('PREVIEW_SPEECH_BUSY');discussing=true;
    try{return await runner.runRound(roleSeatIds.map(seatId=>({seatId,jobId:'speech-'+(++speechSeq)})));}
    finally{discussing=false;speaker=null;if(!disposed)onSpeech();}
  }
  async function advanceRoles(){
    alive();if(busy)fail('PREVIEW_BUSY');busy=true;
    try{return await driver.runUntilUser();}finally{busy=false;}
  }
  function userMove(action){
    alive();if(busy)fail('PREVIEW_BUSY');const view=room.viewUser();
    if(action?.roomId!==roomId||action?.revision!==view.revision||action?.seatId!=='user'||view.turnSeatId!=='user'||view.phase!=='playing')fail('PREVIEW_STALE_ACTION');
    const next=room.prepareUserAction()({type:'move',move:action.move});publish(next);return next;
  }
  return Object.freeze({
    view(){alive();return room.viewUser();},
    show(){publish(room.viewUser());},
    userMove,advanceRoles,
    send(text){alive();return chat.append({senderSeatId:'user',messageId:'message-'+(++seq),audienceSeatIds:seats,time:Date.now()},text).message;},
    messages(){alive();return chat.read('user');},
    discuss,stopSpeech(){alive();runner.stop();},
    speechStatus(){alive();return {running:discussing,speaker,remaining:runner.status().remaining};},
    dispose(){if(disposed)return;disposed=true;driver.dispose();room.dispose();runner.close();},
    status:()=>disposed?'disposed':busy?'running':'idle'
  });
}
