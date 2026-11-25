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
export function createRoomDispatcher({getContext, spec, rules}) {
  if (typeof getContext!=='function' || !rules || typeof rules.init!=='function' || typeof rules.step!=='function' || rules.gameId!==spec?.gameId) fail('INVALID_RULE_ADAPTER');
  const policy=gamePolicy(spec.gameId);
  if(rules.project!==undefined && typeof rules.project!=='function') fail('INVALID_RULE_ADAPTER');
  const init=rules.init.bind(rules), step=rules.step.bind(rules), project=rules.project?.bind(rules);
  let room=createGameRoom(getContext(),spec), state=null, result=null, busy=false;
  function guarded(fn) {
    if(busy) fail('DISPATCH_BUSY');
    busy=true;try{return fn();}finally{busy=false;}
  }
  function check(actor,token,ctx) {
    const expected=roomToken(room,ctx,actor);
    if(!sameToken(token,expected)) fail('STALE_ACTION');
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
  return Object.freeze({
    view(actor){return guarded(()=>view(actor,getContext()));},
    token(actor){return guarded(()=>{if(terminal(room)) fail('ROOM_TERMINAL');return roomToken(room,getContext(),actor);});},
    dispatch(actor,token,action){return guarded(()=>{
      const ctx=getContext();check(actor,token,ctx);
      if(terminal(room)) fail('ROOM_TERMINAL');
      if(!action || typeof action.type!=='string') fail('INVALID_ACTION');
      if(lobbyActions.has(action.type)) {
        const next=reduceRoom(room,ctx,actor,token,action);
        const nextState=action.type==='start'?jsonState(init(baseView(actor,ctx,next,null))):action.type==='close'?null:state;
        return commit(next,nextState,result,actor,token,action.type==='remove'||action.type==='close');
      }
      if(action.type!=='move') fail('UNKNOWN_ACTION');
      if(room.phase!=='playing') fail('NOT_PLAYING');
      const actorView=baseView(actor,ctx), seat=actorView.seats.find(s=>s.seatId===actor);
      if(seat.mode==='observer') fail('OBSERVER_CANNOT_MOVE');
      if(!policy.phased && room.turnSeatId!==actor) fail('NOT_YOUR_TURN');
      // Rules are trusted local code. They must check phase/legality before returning.
      // AI output is only a move payload, never a room-state or result replacement.
      const transition=step({state:clone(state),room:actorView,actorSeatId:actor,move:jsonState(action.move)});
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
      return commit(next,nextState,nextResult,actor,token);
    });}
  });
}
