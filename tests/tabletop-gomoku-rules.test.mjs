import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGomokuRules} from '../games/tabletop/gomoku-rules.js';
import {chooseGomokuMove} from '../games/tabletop/gomoku-strategy.js';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
const ctx={accountId:'a',sessionId:'s',roleIds:['r1','r2','r3']};
function fixture({watch=false}={}){
  const d=createRoomDispatcher({getContext:()=>ctx,spec:{roomId:'gomoku',gameId:'gomoku'},rules:createGomokuRules()});
  const send=(actor,action,token=d.token(actor))=>d.dispatch(actor,token,action);
  send('user',{type:'invite',roleId:'r1'});send('user',{type:'invite',roleId:'r2',mode:'observer'});
  if(watch)send('user',{type:'swapSeats',playerSeatId:'user',observerSeatId:'role:r2'});
  send('user',{type:'start'});
  return {d,send,move:(x,y)=>send(d.view('user').turnSeatId,{type:'move',move:{kind:'place',x,y}})};
}
for(const [name,points] of [['horizontal',[[0,0],[1,0],[2,0],[3,0],[4,0]]],['vertical',[[14,0],[14,1],[14,2],[14,3],[14,4]]],['diagonal',[[0,0],[1,1],[2,2],[3,3],[4,4]]],['reverse diagonal',[[14,0],[13,1],[12,2],[11,3],[10,4]]]]){
  test(name+' win on board edges',()=>{
    const f=fixture();points.forEach(([x,y],i)=>{f.move(x,y);if(i<4)f.move(i*2,10);});
    const v=f.d.view('user');assert.equal(v.phase,'finished');assert.deepEqual(v.result,{kind:'win',winnerSeatIds:['user']});assert.equal(v.game.winningLine.length,5);
    assert.deepEqual(v.game.legalMoves,[]);assert.throws(()=>f.d.token('user'),/ROOM_TERMINAL/);
  });
}
test('overline is a win under provisional freestyle, disconnected four not a win',()=>{
  const f=fixture();for(const [i,x] of [0,1,2,4,5,3].entries()){f.move(x,0);if(i<5){assert.equal(f.d.view('user').phase,'playing');f.move(i*2,10);}}
  assert.equal(f.d.view('user').game.winningLine.length,6);
});
test('illegal occupied, out-of-range, forged and duplicate moves are rejected atomically',()=>{
  const f=fixture(),t=f.d.token('user');f.move(7,7);const v=f.d.view('user');
  assert.throws(()=>f.send('user',{type:'move',move:{kind:'place',x:8,y:7}},t),/STALE_ACTION/);
  for(const move of [{kind:'place',x:7,y:7},{kind:'place',x:15,y:1},{kind:'place',x:1.5,y:2},{kind:'place',x:2,y:2,color:1}])assert.throws(()=>f.send('role:r1',{type:'move',move}),/GOMOKU_OCCUPIED|GOMOKU_INVALID_MOVE/);
  assert.throws(()=>f.send('user',{type:'move',move:{kind:'place',x:8,y:7}}),/NOT_YOUR_TURN/);
  assert.deepEqual(f.d.view('user'),v);
});
test('user may watch two roles, observers have no legal moves and cannot play',()=>{
  const f=fixture({watch:true}),v=f.d.view('user');assert.deepEqual(v.game.players,[{seatId:'role:r1',color:1},{seatId:'role:r2',color:2}]);assert.equal(v.turnSeatId,'role:r1');
  assert.deepEqual(v.game.legalMoves,[]);assert.throws(()=>f.send('user',{type:'move',move:{kind:'place',x:0,y:0}}),/OBSERVER_CANNOT_MOVE/);
  f.move(7,7);assert.equal(f.d.view('user').turnSeatId,'role:r2');assert.throws(()=>f.send('user',{type:'swapSeats',playerSeatId:'role:r1',observerSeatId:'user'}),/NOT_IN_LOBBY/);
});
test('white can win, projection detached and non-active move list empty',()=>{
  const f=fixture();for(let i=0;i<5;i++){f.move(i*2,10);f.move(i,1);}
  const v=f.d.view('role:r1');assert.deepEqual(v.result,{kind:'win',winnerSeatIds:['role:r1']});v.game.board.fill(0);assert.equal(f.d.view('user').game.board[15],2);
});
test('full board without five becomes a draw through actual moves',()=>{
  const f=fixture(),black=[],white=[];
  for(let y=0;y<15;y++)for(let x=0;x<15;x++)((x+2*y)%4<2?black:white).push([x,y]);
  const [a,b]=black.length===113?[black,white]:[white,black];assert.equal(a.length,113);assert.equal(b.length,112);
  for(let i=0;i<a.length;i++){f.move(...a[i]);if(i<b.length)f.move(...b[i]);}
  assert.deepEqual(f.d.view('user').result,{kind:'draw',winnerSeatIds:[]});
});
test('strategy selects legal center, immediate win, block and validates proposals',()=>{
  const f=fixture();assert.deepEqual(chooseGomokuMove(f.d.view('user')),{kind:'place',x:7,y:7});
  for(let i=0;i<4;i++){f.move(i,0);f.move(i*2,10);}
  let v=f.d.view('user');assert.deepEqual(chooseGomokuMove(v,{difficulty:'hard'}),{kind:'place',x:4,y:0});
  assert.deepEqual(chooseGomokuMove(v,{proposal:{kind:'place',x:8,y:8}}),{kind:'place',x:8,y:8});
  assert.deepEqual(chooseGomokuMove(v,{proposal:{kind:'place',x:0,y:0}}),{kind:'place',x:4,y:0});
  f.move(10,10);v=f.d.view('role:r1');assert.deepEqual(chooseGomokuMove(v),{kind:'place',x:4,y:0});
  assert.equal(chooseGomokuMove(f.d.view('user')),null);
});
