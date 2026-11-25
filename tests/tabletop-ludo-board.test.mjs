import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLudoRules} from '../games/tabletop/ludo-rules.js';
import {createRoomDispatcher} from '../games/tabletop/room-dispatcher.js';
import {LUDO_BOARD_CELLS,buildLudoBoard,chooseLudoRoleMove} from '../games/tabletop/ludo-board.js';
import {createLudoBoardView} from '../games/tabletop/ludo-board-view.js';
const setup=(n=2,rollDie=()=>6)=>{const ctx={accountId:'a',sessionId:'s',roleIds:['r1','r2','r3']},d=createRoomDispatcher({getContext:()=>ctx,spec:{roomId:'board-room',gameId:'ludo'},rules:createLudoRules({rollDie})});for(let i=1;i<n;i++)d.dispatch('user',d.token('user'),{type:'invite',roleId:'r'+i});d.dispatch('user',d.token('user'),{type:'start'});return d;};
const act=(d,actor,move)=>d.dispatch(actor,d.token(actor),{type:'move',move});
test('52 shared cells, 24 home cells and 16 hangar positions do not overlap',()=>{
  assert.equal(LUDO_BOARD_CELLS.length,92);assert.equal(new Set(LUDO_BOARD_CELLS.map(c=>`${c.x}:${c.y}`)).size,92);
  assert.ok(LUDO_BOARD_CELLS.every(c=>c.x>=0&&c.x<15&&c.y>=0&&c.y<15));
  const track=LUDO_BOARD_CELLS.filter(c=>c.zone==='track');assert.equal(track.length,52);
  for(let i=0;i<52;i++){const a=track[i],b=track[(i+1)%52];assert.equal(a.square,i);assert.equal(Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y)),1);}
  for(let slot=0;slot<4;slot++){const lane=LUDO_BOARD_CELLS.filter(c=>c.slot===slot&&['home','finished'].includes(c.zone));assert.equal(lane.length,6);const end=track[(slot*13+51)%52];assert.equal(Math.abs(end.x-lane[0].x)+Math.abs(end.y-lane[0].y),1);assert.equal(lane.at(-1).progress,57);}
});
test('actual room projection maps each plane and only own legal choices, including opposite seats',()=>{
  const d=setup();let b=buildLudoBoard(d.view('user'));assert.deepEqual(b.players.map(p=>p.slot),[0,2]);assert.equal(b.pieces.length,8);assert.equal(b.canRoll,true);assert.ok(b.pieces.every(p=>p.zone==='hangar'));
  act(d,'user',{kind:'roll'});b=buildLudoBoard(d.view('user'));assert.deepEqual(b.choices,[0,1,2,3]);assert.equal(b.pieces.filter(p=>p.selectable).length,4);assert.deepEqual(buildLudoBoard(d.view('role:r1')).choices,[]);
  act(d,'user',{kind:'choose',plane:2});b=buildLudoBoard(d.view('user'));const p=b.pieces.find(p=>p.seatId==='user'&&p.plane===2);assert.equal(p.zone,'track');assert.deepEqual([p.x,p.y],[0,6]);
});
test('all progress positions project to the correct shared or private cell',()=>{
  const rules=createLudoRules(),room={gameId:'ludo',phase:'playing',turnSeatId:'user',seats:[{seatId:'user',mode:'player'},{seatId:'role:r1',mode:'player'}]};const state=rules.init(room);
  for(let p=-1;p<=57;p++){state.players[0].planes[0]=p;state.players[1].planes[1]=p;const b=buildLudoBoard({...room,roomId:'r',revision:0,selfSeatId:'user',game:rules.project({state,room,actorSeatId:'user'})});for(const piece of b.pieces.filter(q=>q.progress===p)){const c=b.cells.find(c=>c.x===piece.x&&c.y===piece.y);assert.equal(c.zone,piece.zone);if(p>=0&&p<52)assert.equal(c.square,(piece.slot*13+p)%52);else assert.equal(c.slot,piece.slot);}}
});
test('role policy accepts only legal strict proposal, uses fallback for invented actions',()=>{
  const d=setup(2,()=>6);assert.equal(chooseLudoRoleMove(d.view('role:r1')),null);assert.equal(chooseLudoRoleMove(d.view('user')),null);
  const rules=createLudoRules(),room={gameId:'ludo',phase:'playing',turnSeatId:'role:r1',seats:[{seatId:'user',mode:'player'},{seatId:'role:r1',mode:'player'}]},state=rules.init(room);
  const view=()=>({...room,roomId:'r',revision:1,selfSeatId:'role:r1',game:rules.project({state,room,actorSeatId:'role:r1'})});assert.deepEqual(chooseLudoRoleMove(view(),{kind:'roll',die:6}),{kind:'roll'});
  state.stage='choose';state.die=6;state.players[1].planes=[57,-1,55,12];
  assert.deepEqual(chooseLudoRoleMove(view(),{kind:'choose',plane:3}),{kind:'choose',plane:3});
  for(const p of [{kind:'choose',plane:0},{kind:'choose',plane:3,to:57},{kind:'roll'},null]){const m=chooseLudoRoleMove(view(),p);assert.ok(view().game.legalMoves.some(x=>x.plane===m.plane));assert.equal(Object.keys(m).length,2);}
});
test('capture and exact finish are preferred by local fallback',()=>{
  const rules=createLudoRules(),room={gameId:'ludo',phase:'playing',turnSeatId:'role:r1',seats:[{seatId:'user',mode:'player'},{seatId:'role:r1',mode:'player'}]},state=rules.init(room);state.stage='choose';state.die=2;state.players[1].planes=[1,7,55,-1];state.players[0].planes=[29,-1,-1,-1];
  const view=()=>({...room,roomId:'r',revision:1,selfSeatId:'role:r1',game:rules.project({state,room,actorSeatId:'role:r1'})});assert.equal(chooseLudoRoleMove(view()).plane,2);state.players[1].planes[2]=57;assert.equal(chooseLudoRoleMove(view()).plane,0);
});
test('all 2–4 seat complete games can use local role selection with existing rule engine',()=>{
  for(const n of [2,3,4]){let seed=12+n;const d=setup(n,()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%6+1;});let finished=false;for(let i=0;i<20000;i++){const v=d.view('user');if(v.phase==='finished'){finished=true;assert.equal(buildLudoBoard(v).winners.length,1);break;}const id=v.turnSeatId,own=d.view(id),m=id==='user'?own.game.legalMoves[0]:chooseLudoRoleMove(own);act(d,id,m.kind==='roll'?{kind:'roll'}:{kind:'choose',plane:m.plane});}assert.equal(finished,true);}
});
// A minimal DOM contract fixture verifies callbacks and interaction locks; not a browser/layout test.
class El{constructor(tag,doc){this.tagName=tag;this.ownerDocument=doc;this.children=[];this.style={};this.attrs={};this.events={};this.classList={add:c=>{this.className+=' '+c;}};}setAttribute(k,v){this.attrs[k]=v;}append(...x){this.children.push(...x);x.forEach(c=>c.parent=this);}replaceChildren(...x){this.children=[];this.append(...x);}addEventListener(k,f){this.events[k]=f;}remove(){this.parent.children=this.parent.children.filter(c=>c!==this);}click(){if(!this.disabled)this.events.click?.();}}
const makeRoot=()=>{const doc={createElement:tag=>new El(tag,doc)};return new El('div',doc);};
const all=(e,cls)=>[...(e.className?.split(' ').includes(cls)?[e]:[]),...e.children.flatMap(c=>all(c,cls))];
const tick=()=>new Promise(r=>setImmediate(r));
test('user board sends only canonical action and revision, locks duplicate clicks, updates with host view',async()=>{
  const d=setup(),root=makeRoot(),calls=[];let release;const host=createLudoBoardView(root,{onMove:async a=>{calls.push(a);await new Promise(r=>{release=r;});act(d,'user',a.move);host.render(d.view('user'));}});host.render(d.view('user'));const old=all(root,'mao-ludo__action')[0];old.click();old.click();assert.equal(calls.length,1);assert.ok(all(root,'mao-ludo__action')[0].disabled);release();await tick();assert.deepEqual(calls[0],{roomId:'board-room',revision:2,seatId:'user',move:{kind:'roll'}});assert.equal(all(root,'mao-ludo__action').length,4);old.click();assert.equal(calls.length,1);const btn=all(root,'mao-ludo__action')[1];btn.click();assert.deepEqual(calls[1].move,{kind:'choose',plane:1});release();await tick();host.destroy();assert.equal(root.children.length,0);
});
test('failed action is retryable without moving pieces; successful unchanged revision stays locked',async()=>{
  const d=setup(),root=makeRoot();let n=0;const host=createLudoBoardView(root,{onMove:()=>{if(++n===1)throw Error('private');}});host.render(d.view('user'));all(root,'mao-ludo__action')[0].click();await tick();assert.match(all(root,'mao-ludo__notice')[0].textContent,/重试/);assert.equal(all(root,'mao-ludo__action')[0].disabled,false);all(root,'mao-ludo__action')[0].click();await tick();assert.equal(all(root,'mao-ludo__action')[0].disabled,true);assert.equal(n,2);assert.throws(()=>host.render(d.view('role:r1')),/LUDO_BOARD_USER_ONLY/);
});

test('committed roll and movement animate once; control unlocking does not rebuild the moving nodes',async()=>{
  const d=setup(),root=makeRoot(),animations=[];
  const doc=root.ownerDocument;
  const original=doc.createElement;
  doc.createElement=tag=>{const e=original(tag);e.animate=(frames,options)=>{const a={node:e,frames,options,cancelled:false,cancel(){this.cancelled=true;}};animations.push(a);return a;};e.getBoundingClientRect=()=>({left:Number(e.parent?.style.gridColumn??0)*20,top:Number(e.parent?.style.gridRow??0)*20});return e;};
  const host=createLudoBoardView(root,{onMove:async a=>{act(d,'user',a.move);host.render(d.view('user'));}});
  host.render(d.view('user'));assert.equal(animations.length,0);
  all(root,'mao-ludo__action')[0].click();await tick();
  assert.equal(animations.length,1);assert.equal(animations[0].options.duration,200);
  all(root,'mao-ludo__action')[0].click();await tick();
  assert.equal(animations.length,2);assert.equal(animations[1].options.duration,240);assert.equal(animations[1].cancelled,false);
  host.render(d.view('user'));assert.equal(animations.length,2);assert.equal(animations[1].cancelled,true);
  host.destroy();
});
test('reduced motion and skipped revisions render authoritative positions without animation',()=>{
  const d=setup(),root=makeRoot(),doc=root.ownerDocument;let count=0;
  doc.defaultView={matchMedia:()=>({matches:true})};
  const original=doc.createElement;
  doc.createElement=tag=>{const e=original(tag);e.animate=()=>{count++;return {cancel(){}};};return e;};
  const host=createLudoBoardView(root,{onMove:()=>{}});
  host.render(d.view('user'));act(d,'user',{kind:'roll'});host.render(d.view('user'));assert.equal(count,0);
  doc.defaultView.matchMedia=()=>({matches:false});act(d,'user',{kind:'choose',plane:0});act(d,'user',{kind:'roll'});host.render(d.view('user'));assert.equal(count,0);host.destroy();
});

test('board presents authoritative last event and active seat without inventing results',()=>{
  const d=setup(),root=makeRoot(),host=createLudoBoardView(root,{onMove:()=>{},labelForSeat:()=> '测试棋手'});
  host.render(d.view('user'));assert.equal(all(root,'mao-ludo__event')[0].textContent,'本局已开始。');
  assert.equal(all(root,'mao-ludo__active').length,1);
  act(d,'user',{kind:'roll'});host.render(d.view('user'));
  assert.match(all(root,'mao-ludo__event')[0].textContent,/掷出 6 点/);
  assert.equal(all(root,'mao-ludo__die')[0].attrs['aria-label'],'骰子 6 点');
  act(d,'user',{kind:'choose',plane:0});host.render(d.view('user'));
  assert.match(all(root,'mao-ludo__event')[0].textContent,/1 号飞机：起飞/);
  host.destroy();
});
test('stacked aircraft retain individual action controls and grid marker',()=>{
  const d=setup(),root=makeRoot(),host=createLudoBoardView(root,{onMove:()=>{}});
  act(d,'user',{kind:'roll'});act(d,'user',{kind:'choose',plane:0});
  act(d,'user',{kind:'roll'});act(d,'user',{kind:'choose',plane:1});
  act(d,'user',{kind:'roll'});host.render(d.view('user'));
  assert.equal(all(root,'mao-ludo__stack').length,1);
  assert.equal(all(all(root,'mao-ludo__stack')[0],'mao-ludo__piece').length,2);
  assert.equal(all(root,'mao-ludo__action').length,4);host.destroy();
});
test('skipped roll identifies the next player and keeps board read-only for user',()=>{
  const d=setup(2,()=>3),root=makeRoot(),host=createLudoBoardView(root,{onMove:()=>{},labelForSeat:()=> '测试棋手'});
  act(d,'user',{kind:'roll'});host.render(d.view('user'));
  assert.match(all(root,'mao-ludo__event')[0].textContent,/没有可移动的飞机/);
  assert.match(all(root,'mao-ludo__active')[0].textContent,/测试棋手/);
  assert.equal(all(root,'mao-ludo__action').length,0);host.destroy();
});

test('older room snapshot cannot roll back the displayed board or restore stale controls',()=>{
  const d=setup(),root=makeRoot(),calls=[];
  const host=createLudoBoardView(root,{onMove:a=>calls.push(a)});
  const old=d.view('user');host.render(old);
  act(d,'user',{kind:'roll'});host.render(d.view('user'));
  const current=all(root,'mao-ludo__action')[0];
  host.render(old);
  assert.match(all(root,'mao-ludo__status')[0].textContent,/选择要移动/);
  assert.equal(all(root,'mao-ludo__action').length,4);
  assert.equal(all(root,'mao-ludo__action')[0],current);
  current.click();assert.deepEqual(calls[0].move,{kind:'choose',plane:0});host.destroy();
});
test('a mounted board refuses a different room until the host explicitly replaces it',()=>{
  const d=setup(),root=makeRoot(),host=createLudoBoardView(root,{onMove:()=>{}});
  const view=d.view('user');host.render(view);
  assert.throws(()=>host.render({...view,roomId:'different-room'}),/LUDO_BOARD_ROOM_CHANGED/);
  assert.equal(all(root,'mao-ludo__action')[0].textContent,'掷骰子');host.destroy();
});

test('quick board exposes actual cruise and card moves, compact score and owner labels',async()=>{
  const ctx={accountId:'a',sessionId:'s',roleIds:['r1']};
  const d=createRoomDispatcher({getContext:()=>ctx,spec:{roomId:'quick',gameId:'ludo'},rules:createLudoRules({mode:'adventure',rollDie:()=>6})});
  d.dispatch('user',d.token('user'),{type:'invite',roleId:'r1'});d.dispatch('user',d.token('user'),{type:'start'});
  const root=makeRoot(),calls=[];
  const host=createLudoBoardView(root,{onMove:async a=>{calls.push(a.move);act(d,'user',a.move);host.render(d.view('user'));}});
  host.render(d.view('user'));
  assert.equal(all(root,'mao-ludo__title').length,0);
  assert.equal(all(root,'flight-hand').length,0);
  assert.ok(all(root,'mao-ludo__player').every(p=>p.textContent.endsWith('/2')));
  assert.equal(all(root,'flight-dice-owner')[0].textContent,'我的骰子');
  assert.ok(all(root,'is-my-plane').every(p=>p.textContent.startsWith('我')));
  assert.equal(all(root,'flight-shortcut-from').length,2);
  assert.equal(all(root,'flight-supply').length,4);
  all(root,'flight-cruise')[0].click();await tick();
  assert.deepEqual(calls[0],{kind:'cruise'});assert.equal(d.view('user').game.die,3);
  assert.ok(all(root,'flight-destination').length>0);
  assert.equal(all(root,'flight-hand').length,1);
  const boost=all(root,'flight-card').find(b=>b.textContent==='加速 · 1号');
  assert.ok(boost);boost.click();await tick();
  assert.deepEqual(calls[1],{kind:'choose',plane:0,card:'boost'});
  assert.equal(d.view('user').game.players[0].cards.boost,0);
  assert.equal(all(root,'flight-hand').length,0);
  host.destroy();
});
test('quick board shield control commits legal card choice, never stale replay',async()=>{
  const ctx={accountId:'a',sessionId:'s',roleIds:['r1']};
  const d=createRoomDispatcher({getContext:()=>ctx,spec:{roomId:'quick',gameId:'ludo'},rules:createLudoRules({mode:'adventure',rollDie:()=>3})});
  d.dispatch('user',d.token('user'),{type:'invite',roleId:'r1'});d.dispatch('user',d.token('user'),{type:'start'});
  const root=makeRoot(),calls=[];
  const host=createLudoBoardView(root,{onMove:async a=>{calls.push(a.move);act(d,'user',a.move);host.render(d.view('user'));}});
  host.render(d.view('user'));all(root,'mao-ludo__action')[0].click();await tick();
  const shield=all(root,'flight-card').find(b=>b.textContent==='护航 · 1号');
  assert.ok(shield);shield.click();shield.click();await tick();shield.click();
  assert.equal(calls.length,2);assert.deepEqual(calls[1],{kind:'choose',plane:0,card:'shield'});
  assert.equal(d.view('user').game.players[0].planes[0].shield,true);
  assert.equal(all(root,'flight-shielded').length,1);host.destroy();
});
