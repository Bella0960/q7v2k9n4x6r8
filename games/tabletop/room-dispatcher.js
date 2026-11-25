import {createGameRoom, gamePolicy, reduceRoom, roomToken, seatView} from './room-engine.js';

// Trusted, synchronous, single-room coordinator. The future runtime adapter must
// verify session/actor identity and use one authoritative instance per room.
const clone = value => JSON.parse(JSON.stringify(value));
const fail = code => { throw new Error(code); };
const lobbyActions = new Set(['invite','fillBots','remove','reorder','swapSeats','setModerator','start','close']);
const terminal = r => r.phase === 'finished' || r.phase === 'closed';
function sameToken(a,b) {
  return a && ['accountId','sessionId','roomId','revision','seatId'].every(k=>a[k]===b[k]);
}
function jsonState(value) {
  if (value === undefined || (value && typeof value.then === 'function')) fail('INVALID_RULE_STATE');
  return clone(value);
}
function validateResult(result, room) {
  if (!result || !['win','draw'].includes(result.kind) || !Array.isArray(result.winnerSeatIds)) fail('INVALID_RESULT');
  const winners = result.winnerSeatIds;
  if (new Set(winners).size !== winners.length || (result.kind==='win' ? !winners.length : winners.length!==0) || Array.from(winners).some(id=>!room.seats.some(s=>s.seatId===id&&s.mode==='player'))) fail('INVALID_RESULT');
  return {kind:result.kind,winnerSeatIds:[...winners]};
}
export function createRoomDispatcher({getContext, spec, rules, checkpoint=null}) {
  if (typeof getContext!=='function' || !rules || typeof rules.init!=='function' || typeof rules.step!=='function' || rules.gameId!==spec?.gameId) fail('INVALID_RULE_ADAPTER');
  const policy=gamePolicy(spec.gameId);
  if(rules.project!==undefined && typeof rules.project!=='function') fail('INVALID_RULE_ADAPTER');
  const init=rules.init.bind(rules), step=rules.step.bind(rules), project=rules.project?.bind(rules);
  let room=createGameRoom(getContext(),spec), state=null, result=null, busy=false;
  const gomoku=spec.gameId==='gomoku',turtle=spec.gameId==='turtle',wolf=spec.gameId==='werewolf';
  const replayable=['ludo','gomoku','turtle','werewolf'].includes(spec.gameId)&&rules.checkpointVersion===1&&typeof rules.replayStep==='function';
  const issued=new WeakSet();let initial=null,history=[];
  const maxMoves=20000;
  const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
  const validId=v=>typeof v==='string'&&v.length>0&&v.length<=256&&v.trim()===v;
  function recordMove(actor,move,transition){
    if(turtle||wolf)return {actorSeatId:actor,move:clone(move)};
    if(gomoku)return {actorSeatId:actor,move:{kind:'place',x:move.x,y:move.y}};
    const kind=move.kind,record={actorSeatId:actor,move:kind==='choose'?{kind,plane:move.plane,...(move.card?{card:move.card}:{})}:{kind},die:kind==='choose'?null:transition.state.last.die};
    return record;
  }
  function guarded(fn) {
    if(busy) fail('DISPATCH_BUSY');
    busy=true;try{return fn();}finally{busy=false;}
  }
  function check(actor,token,ctx) {
    const expected=roomToken(room,ctx,actor);
    if(!sameToken(token,expected)||(replayable&&!issued.has(token))) fail('STALE_ACTION');
  }
  function baseView(actor,ctx,r=room,outcome=result) {
    const v=seatView(r,ctx,actor);
    return {...v,result:outcome===null?null:clone(outcome)};
  }
  // Trusted game rules must explicitly allowlist each seat's visible state.
  // No projector means no board/hidden state is exposed; never return raw state.
  function view(actor,ctx,r=room,outcome=result,snapshot=state) {
    const v=baseView(actor,ctx,r,outcome);
    if(!project || !['playing','finished'].includes(r.phase)) return v;
    const visible=project({state:clone(snapshot),room:clone(v),actorSeatId:actor});
    if(!visible || typeof visible!=='object' || Array.isArray(visible) || typeof visible.then==='function') fail('INVALID_RULE_PROJECTION');
    const detached=clone(visible);
    if(!detached || typeof detached!=='object' || Array.isArray(detached)) fail('INVALID_RULE_PROJECTION');
    // The projector is trusted synchronous code, but its execution must not
    // bypass a context/roster change before the result is returned.
    seatView(r,getContext(),actor);
    return {...v,game:detached};
  }
  // Re-check the authoritative context just before publishing any transition.
  function commit(next,nextState,nextResult,actor,token,cleanup=false) {
    const ctx=getContext();check(actor,token,ctx);
    // A host must be able to remove deleted roles or close even with an invalid roster.
    // Do not expose any unverified roster details through this recovery response.
    const projected=cleanup && next.seats.some(s=>s.kind==='role'&&!ctx.roleIds.includes(s.roleId))
      ? {roomId:next.roomId,revision:next.revision,phase:next.phase,recoveryRequired:next.phase!=='closed'}
      : view(actor,ctx,next,nextResult,nextState);
    room=next;state=nextState;result=nextResult;return projected;
  }
  const api=Object.freeze({
    checkpoint(){return guarded(()=>{
      if(!replayable||!initial||!['playing','finished'].includes(room.phase))fail('CHECKPOINT_UNAVAILABLE');
      seatView(room,getContext(),'user');
      return clone({schema:1,gameId:spec.gameId,mode:rules.checkpointMode,accountId:room.accountId,roomId:room.roomId,startRevision:initial.revision,seats:initial.seats,moves:history,...(wolf?{privateInit:initial.privateInit}:{})});
    });},
    view(actor){return guarded(()=>view(actor,getContext()));},
    token(actor){return guarded(()=>{if(terminal(room)) fail('ROOM_TERMINAL');const t=roomToken(room,getContext(),actor);if(replayable){Object.freeze(t);issued.add(t);}return t;});},
    dispatch(actor,token,action){return guarded(()=>{
      const ctx=getContext();check(actor,token,ctx);
      if(terminal(room)) fail('ROOM_TERMINAL');
      if(!action || typeof action.type!=='string') fail('INVALID_ACTION');
      if(lobbyActions.has(action.type)) {
        const next=reduceRoom(room,ctx,actor,token,action);
        const nextState=action.type==='start'?jsonState(init(baseView(actor,ctx,next,null))):action.type==='close'?null:state;
        const projected=commit(next,nextState,result,actor,token,action.type==='remove'||action.type==='close');
        if(replayable&&action.type==='start')initial={revision:room.revision,seats:clone(room.seats),...(wolf?{privateInit:jsonState(rules.checkpointInitial(state))}:{})};
        return projected;
      }
      if(action.type!=='move') fail('UNKNOWN_ACTION');
      if(room.phase!=='playing') fail('NOT_PLAYING');
      const actorView=baseView(actor,ctx), seat=actorView.seats.find(s=>s.seatId===actor);
      if(seat.mode==='observer') fail('OBSERVER_CANNOT_MOVE');
      if(!policy.phased && room.turnSeatId!==actor) fail('NOT_YOUR_TURN');
      // Rules are trusted local code. They must check phase/legality before returning.
      // AI output is only a move payload, never a room-state or result replacement.
      if(replayable&&history.length>=maxMoves)fail('CHECKPOINT_CAPACITY');
      const move=jsonState(action.move);
      const transition=step({state:clone(state),room:actorView,actorSeatId:actor,move});
      if(!transition || typeof transition.then==='function' || !Object.hasOwn(transition,'state')) fail('INVALID_RULE_TRANSITION');
      const nextState=jsonState(transition.state);
      let nextResult=null, nextTurn=null, phase='playing';
      if(transition.result!=null) {
        nextResult=validateResult(transition.result,room);phase='finished';
        if(transition.nextSeatId!=null) fail('INVALID_NEXT_SEAT');
      } else {
        nextTurn=transition.nextSeatId;
        if(nextTurn===null && !policy.phased) fail('INVALID_NEXT_SEAT');
        if(nextTurn!==null && !room.seats.some(s=>s.seatId===nextTurn&&s.mode==='player')) fail('INVALID_NEXT_SEAT');
      }
      const next={...room,phase,turnSeatId:nextTurn,revision:room.revision+1};
      const record=replayable?recordMove(actor,move,transition):null;
      const projected=commit(next,nextState,nextResult,actor,token);
      if(record)history.push(record);
      return projected;
    });}
  });
  if(checkpoint!==null){
    // Restore only from a trusted, account-scoped repository. Replay is semantic
    // validation, not a signature or authorization for arbitrary imported data.
    if(!replayable||!exact(checkpoint,['schema','gameId','mode','accountId','roomId','startRevision','seats','moves',...(wolf?['privateInit']:[])])||
      checkpoint.schema!==1||checkpoint.gameId!==spec.gameId||checkpoint.mode!==rules.checkpointMode||
      checkpoint.accountId!==room.accountId||checkpoint.roomId!==room.roomId||
      !Number.isSafeInteger(checkpoint.startRevision)||checkpoint.startRevision<2||checkpoint.startRevision>maxMoves||
      !Array.isArray(checkpoint.seats)||checkpoint.seats.length<2||checkpoint.seats.length>(wolf?12:gomoku||turtle?8:4)||
      !Array.isArray(checkpoint.moves)||checkpoint.moves.length>(wolf?900:gomoku?225:turtle?243:maxMoves))fail('INVALID_CHECKPOINT');
    const ctx=getContext(),seats=[],ids=new Set();
    for(const seat of checkpoint.seats){
      if(!seat||!(seat.mode==='player'||gomoku&&seat.mode==='observer'||turtle&&seat.mode==='moderator')||!validId(seat.seatId)||ids.has(seat.seatId))fail('INVALID_CHECKPOINT_SEAT');
      if(seat.kind==='user'&&seat.seatId==='user'&&exact(seat,['seatId','kind','mode'])){}
      else if(seat.kind==='role'&&validId(seat.roleId)&&seat.seatId==='role:'+seat.roleId&&exact(seat,['seatId','kind','mode','roleId'])&&ctx.roleIds.includes(seat.roleId)){}
      else if(!turtle&&seat.kind==='bot'&&seat.mode==='player'&&(wolf?/^bot:(?:[1-9]|1[01])$/:gomoku?/^bot:1$/:/^bot:[1-3]$/).test(seat.seatId)&&exact(seat,['seatId','kind','mode'])){}
      else fail('INVALID_CHECKPOINT_SEAT');
      seats.push(clone(seat));ids.add(seat.seatId);
    }
    if(!ids.has('user')||gomoku&&seats.filter(s=>s.mode==='player').length!==2||turtle&&seats.filter(s=>s.mode==='moderator').length!==1)fail('INVALID_CHECKPOINT_SEAT');
    const bots=seats.filter(s=>s.kind==='bot').map(s=>s.seatId);
    if(bots.some((_,i)=>!bots.includes('bot:'+(i+1))))fail('INVALID_CHECKPOINT_SEAT');
    if(checkpoint.startRevision<seats.filter(s=>s.kind==='role').length+Number(bots.length>0)+1+Number(turtle))fail('INVALID_CHECKPOINT');
    room={...room,seats,phase:'playing',turnSeatId:turtle||wolf?null:seats.find(s=>s.mode==='player').seatId,revision:checkpoint.startRevision};
    initial={revision:room.revision,seats:clone(seats),...(wolf?{privateInit:clone(checkpoint.privateInit)}:{})};
    state=jsonState(wolf?rules.restoreInitial(baseView('user',ctx,room,null),initial.privateInit):init(baseView('user',ctx,room,null)));
    for(const entry of checkpoint.moves){
      if(!exact(entry,gomoku||turtle||wolf?['actorSeatId','move']:['actorSeatId','move','die'])||room.phase!=='playing'||(turtle||wolf?!ids.has(entry.actorSeatId):entry.actorSeatId!==room.turnSeatId))fail('INVALID_CHECKPOINT_MOVE');
      const move=entry.move;
      if(gomoku){if(!exact(move,['kind','x','y'])||move.kind!=='place'||!Number.isInteger(move.x)||!Number.isInteger(move.y)||move.x<0||move.x>=15||move.y<0||move.y>=15)fail('INVALID_CHECKPOINT_MOVE');}
      else if(!turtle&&!wolf&&!(exact(move,['kind'])&&['roll','cruise'].includes(move.kind)||
        (exact(move,['kind','plane'])||exact(move,['kind','plane','card']))&&move.kind==='choose'&&Number.isInteger(move.plane)&&move.plane>=0&&move.plane<4&&(!Object.hasOwn(move,'card')||['boost','shield'].includes(move.card))))fail('INVALID_CHECKPOINT_MOVE');
      const t=rules.replayStep({state:clone(state),room:baseView(entry.actorSeatId,ctx),actorSeatId:entry.actorSeatId,move:clone(move),die:entry.die});
      state=jsonState(t.state);result=t.result==null?null:validateResult(t.result,room);
      const nextTurn=result?null:t.nextSeatId;
      if(!result&&!((turtle||wolf)&&nextTurn===null)&&!seats.some(s=>s.seatId===nextTurn&&s.mode==='player'))fail('INVALID_CHECKPOINT_MOVE');
      room={...room,phase:result?'finished':'playing',turnSeatId:nextTurn,revision:room.revision+1};
      history.push(clone(entry));
    }
    view('user',getContext());
  }
  return api;
}
