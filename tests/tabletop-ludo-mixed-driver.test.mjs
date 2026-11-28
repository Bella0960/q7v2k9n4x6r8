import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRoomLifetime} from '../games/tabletop/room-lifetime.js';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
import {createLudoRules} from '../games/tabletop/ludo-rules.js';
import {createLudoTurnDriver} from '../games/tabletop/ludo-turn-driver.js';
function match(mode,ids,count){
  const ctx={accountId:'a',sessionId:'s',roleIds:ids};
  const session=createRoomLifetime({getContext:()=>ctx,createDispatcher:createRoomDispatcher,spec:{roomId:'mixed',gameId:'ludo'},rules:createLudoRules({mode,rollDie:()=>3})});
  const act=a=>session.prepareUserAction()(a);
  for(const roleId of ids)act({type:'invite',roleId});
  act({type:'fillBots',playerCount:count});act({type:'start'});
  act({type:'move',move:{kind:'roll'}});
  if(mode==='adventure')act({type:'move',move:{kind:'choose',plane:0}});
  return session;
}
test('mixed quick game: custom-role hook is not called for temporary bots',async()=>{
  const session=match('adventure',['alpha'],4),asked=[];
  const d=createLudoTurnDriver({session,decide:async v=>{asked.push(v.selfSeatId);return {move:v.game.stage==='roll'?{kind:'cruise'}:{kind:'choose',plane:0}};}});
  const result=await d.runUntilUser();assert.equal(result.status,'user');assert.equal(result.actions,6);
  assert.ok(asked.length>0&&asked.every(id=>id==='role:alpha'));
});
test('all-ordinary classic room advances each bot and returns to user',async()=>{
  const session=match('classic',[],4),d=createLudoTurnDriver({session});
  const result=await d.runUntilUser();assert.equal(result.status,'user');assert.equal(result.actions,3);
});
test('all-ordinary quick room advances both bot actions per seat',async()=>{
  const session=match('adventure',[],3),d=createLudoTurnDriver({session});
  const result=await d.runUntilUser();assert.equal(result.status,'user');assert.equal(result.actions,4);
});
