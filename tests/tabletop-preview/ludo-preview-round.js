// Test-only, in-memory preview. Never import this into the production app.
// The fixed fixture identities below are NOT an authenticated account adapter.
import {createRoomLifetime} from '../../games/tabletop/room-lifetime.js';
import {createRoomDispatcher} from '../../games/tabletop/room-dispatcher.js';
import {createLudoRules} from '../../games/tabletop/ludo-rules.js';
import {createLudoTurnDriver} from '../../games/tabletop/ludo-turn-driver.js';
import {createRoomChatLog} from '../../games/tabletop/room-chat-log.js';

export const PREVIEW_PLAYERS=Object.freeze(['fixture-1','fixture-2','fixture-3']);
export function createPreviewRound({roomId,selectedIds,render=()=>{},pace=()=>{},rollDie}={}){
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
    dispose(){if(disposed)return;disposed=true;driver.dispose();room.dispose();chat.close();},
    status:()=>disposed?'disposed':busy?'running':'idle'
  });
}
