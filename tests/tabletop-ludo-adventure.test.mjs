import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLudoRules} from '../games/tabletop/ludo-rules.js';
import {buildLudoBoard} from '../games/tabletop/ludo-board.js';
import {createLudoTurnDriver} from '../games/tabletop/ludo-turn-driver.js';
import {createRoomLifetime} from '../games/tabletop/room-lifetime.js';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
const room={gameId:'ludo',phase:'playing',turnSeatId:'user',seats:[{seatId:'user',mode:'player'},{seatId:'role:alpha',mode:'player'}]};
const fixture=(die=3)=>{const rules=createLudoRules({mode:'adventure',rollDie:()=>die}),state=rules.init(room);return {rules,state,step:move=>rules.step({state,room,actorSeatId:'user',move})};};
test('quick game starts symmetrically, fixed cruise is once and never calls dice',()=>{
  let rolls=0;const rules=createLudoRules({mode:'adventure',rollDie:()=>{rolls++;return 6;}}),state=rules.init(room);
  assert.ok(state.players.every(p=>JSON.stringify(p.planes)==='[0,4,-1,-1]'));
  const a=rules.step({state,room,actorSeatId:'user',move:{kind:'cruise'}});assert.equal(a.state.die,3);assert.equal(a.state.players[0].cruise,0);assert.equal(rolls,0);
  const b=rules.step({state:a.state,room,actorSeatId:'user',move:{kind:'choose',plane:0}});assert.equal(b.nextSeatId,'role:alpha');
  assert.throws(()=>rules.step({state:b.state,room,actorSeatId:'user',move:{kind:'cruise'}}),/LUDO_CRUISE_USED/);
});
test('two finished planes win quick game; wrong variant is rejected',()=>{
  const f=fixture(1);f.state.players[0].planes=[57,56,-1,-1];f.state.stage='choose';f.state.die=1;
  const a=f.step({kind:'choose',plane:1});assert.deepEqual(a.result,{kind:'win',winnerSeatIds:['user']});
  assert.throws(()=>createLudoRules().project({state:f.state,room,actorSeatId:'user'}),/LUDO_INVALID_ADVENTURE_STATE/);
  assert.throws(()=>f.rules.project({state:createLudoRules().init(room),room,actorSeatId:'user'}),/LUDO_INVALID_ADVENTURE_STATE/);
});
test('legal projected cards and cruise, consumption and supply',()=>{
  const f=fixture(3);f.state.stage='choose';f.state.die=3;const game=f.rules.project({state:f.state,room,actorSeatId:'user'});
  const b=buildLudoBoard({...room,roomId:'r',revision:1,selfSeatId:'user',game});assert.ok(b.cardMoves.some(m=>m.card==='boost'&&m.plane===0));
  const a=f.step({kind:'choose',plane:0,card:'boost'});assert.equal(a.state.players[0].planes[0],5);assert.equal(a.state.players[0].cards.boost,0);assert.equal(a.state.players[0].cards.shield,2);
  assert.equal(a.state.last.gained,'shield');assert.throws(()=>f.step({kind:'choose',plane:0,card:'fake'}),/LUDO_EXPECT_PLANE/);
});
test('shield blocks collision, consumes shield and returns attacker',()=>{
  const f=fixture();f.state.stage='choose';f.state.die=3;f.state.players[1].planes=[29,-1,-1,-1];f.state.players[1].shields[0]=true;
  const a=f.step({kind:'choose',plane:0});assert.equal(a.state.players[0].planes[0],-1);assert.equal(a.state.players[1].planes[0],29);assert.equal(a.state.players[1].shields[0],false);assert.ok(a.state.last.effects.includes('blocked'));
});
function match(options={}){
  const ctx={accountId:'fixture-account',sessionId:'fixture-session',roleIds:['alpha']};
  const session=createRoomLifetime({getContext:()=>ctx,createDispatcher:createRoomDispatcher,spec:{roomId:'quick',gameId:'ludo'},rules:createLudoRules({mode:'adventure',rollDie:()=>3})});
  session.prepareUserAction()({type:'invite',roleId:'alpha'});session.prepareUserAction()({type:'start'});session.prepareUserAction()({type:'move',move:{kind:'roll'}});session.prepareUserAction()({type:'move',move:{kind:'choose',plane:0}});
  return {session,driver:createLudoTurnDriver({session,...options})};
}
test('trusted model decision hook commits chosen legal cruise and boost, then emits role identity',async()=>{
  const speech=[];const f=match({decide:async v=>({move:v.game.stage==='roll'?{kind:'cruise'}:{kind:'choose',plane:0,card:'boost'},say:'试试这条航线。'}),onDecision:(id,say,v)=>speech.push({id,say,revision:v.revision})});
  assert.equal((await f.driver.runUntilUser()).status,'user');const p=f.session.viewUser().game.players[1];assert.equal(p.cruise,0);assert.equal(p.cards.boost,0);assert.equal(speech.length,2);assert.ok(speech.every(s=>s.id==='role:alpha'));
});
test('invented move and speech are ignored; local fallback still makes legal move',async()=>{
  let speeches=0;const f=match({decide:async()=>({move:{kind:'roll',die:6},say:'不合法的播报'}),onDecision:()=>speeches++});
  assert.equal((await f.driver.runUntilUser()).status,'user');assert.equal(speeches,0);
});
test('stop aborts waiting decision; late answer cannot commit or speak',async()=>{
  let resolve,signal,speeches=0;const f=match({decide:(v,s)=>{signal=s;return new Promise(r=>{resolve=r;});},onDecision:()=>speeches++});
  const revision=f.session.viewUser().revision,p=f.driver.runUntilUser();while(!resolve)await Promise.resolve();f.driver.stop();await assert.rejects(p,/LUDO_DRIVER_STOPPED/);assert.equal(signal.aborted,true);resolve({move:{kind:'cruise'},say:'旧回复'});await new Promise(r=>setImmediate(r));assert.equal(f.session.viewUser().revision,revision);assert.equal(speeches,0);
});
