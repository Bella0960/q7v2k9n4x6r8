// Internal page-runtime boundary. The context provider and dispatcher factory
// must be trusted local adapters. This module is not an authentication source.
const fail = code => { throw new Error(code); };
const validId = v => typeof v === 'string' && v.length > 0 && v.length <= 256 && v.trim() === v;
function readContext(getContext) {
  const c = getContext();
  if (!c || !validId(c.accountId) || !validId(c.sessionId) || !Array.isArray(c.roleIds) || !Array.from(c.roleIds).every(validId)) fail('UNVERIFIED_CONTEXT');
  return {accountId:c.accountId,sessionId:c.sessionId,roleIds:[...new Set(c.roleIds)]};
}
export function createRoomLifetime({getContext,createDispatcher,spec,rules,checkpoint=null}) {
  if (typeof getContext !== 'function' || typeof createDispatcher !== 'function') fail('INVALID_RUNTIME_ADAPTER');
  const initial = readContext(getContext);
  const accountId = initial.accountId, sessionId = initial.sessionId;
  let disposed = false, dispatcher = null;
  function dispose() { disposed = true; dispatcher = null; }
  function scopedContext() {
    if (disposed) fail('ROOM_DISPOSED');
    let c;
    try { c = readContext(getContext); } catch { dispose(); fail('UNVERIFIED_CONTEXT'); }
    if (c.accountId !== accountId || c.sessionId !== sessionId) { dispose(); fail('SCOPE_CHANGED'); }
    return c;
  }
  dispatcher = createDispatcher({getContext:scopedContext,spec,rules,...(checkpoint===null?{}:{checkpoint})});
  scopedContext();
  function current() { scopedContext(); if (!dispatcher) fail('ROOM_DISPOSED'); return dispatcher; }
  function prepare(actor,roleId) {
    const d = current();
    if (roleId !== null && !scopedContext().roleIds.includes(roleId)) fail('ROLE_UNAVAILABLE');
    const token = d.token(actor);
    let consumed = false;
    return payload => {
      const active = current();
      if (consumed) fail('CALLBACK_CONSUMED');
      consumed = true;
      if (roleId !== null && !scopedContext().roleIds.includes(roleId)) fail('ROLE_UNAVAILABLE');
      // Role output is a move payload only; it cannot select an actor or action.
      return active.dispatch(actor,token,actor === 'user' ? payload : {type:'move',move:payload});
    };
  }
  // Trusted discussion scheduler: read a seat projection without a move token.
  function viewRole(roleId) {
    if (!validId(roleId)) fail('INVALID_ROLE_ID');
    const c = scopedContext();
    if (!c.roleIds.includes(roleId)) fail('ROLE_UNAVAILABLE');
    const v = current().view('role:'+roleId);
    if (!['playing','finished'].includes(v.phase)) fail('ROLE_CANNOT_VIEW');
    return v;
  }
  // Trusted scheduler only: pair a seat-specific view with the capability
  // for that exact turn, before any asynchronous role generation starts.
  function prepareRoleTurn(roleId) {
    if (!validId(roleId)) fail('INVALID_ROLE_ID');
    const c = scopedContext();
    if (!c.roleIds.includes(roleId)) fail('ROLE_UNAVAILABLE');
    const actor = 'role:'+roleId, v = current().view(actor);
    const seat = v.seats.find(s=>s.seatId===actor && s.kind==='role' && s.roleId===roleId);
    if (v.phase!=='playing' || !seat || seat.mode==='observer') fail('ROLE_CANNOT_MOVE');
    // Sequential games must not schedule a role request before its turn.
    if (['ludo','gomoku'].includes(v.gameId) && v.turnSeatId!==actor) fail('NOT_YOUR_TURN');
    return Object.freeze({view:v,commit:prepare(actor,roleId)});
  }
  function botId(seatId){return typeof seatId==='string'&&/^bot:(?:[1-9]|1[01])$/.test(seatId);}
  function viewBot(seatId) {
    if(!botId(seatId)) fail('INVALID_BOT_SEAT');
    const v=current().view(seatId);
    if(!['ludo','gomoku','werewolf'].includes(v.gameId)||!['playing','finished'].includes(v.phase)||
      !v.seats.some(s=>s.seatId===seatId&&s.kind==='bot'&&s.mode==='player')) fail('BOT_CANNOT_VIEW');
    return v;
  }
  function prepareBotTurn(seatId) {
    if(!botId(seatId)) fail('INVALID_BOT_SEAT');
    const v=current().view(seatId);
    if(!['ludo','gomoku','werewolf'].includes(v.gameId)||v.phase!=='playing'||(v.gameId!=='werewolf'?v.turnSeatId!==seatId:!v.game?.legalKinds?.length)||
      !v.seats.some(s=>s.seatId===seatId&&s.kind==='bot'&&s.mode==='player')) fail('BOT_CANNOT_MOVE');
    return Object.freeze({view:v,commit:prepare(seatId,null)});
  }
  return Object.freeze({
    prepareBotTurn,viewBot,
    checkpoint:()=>current().checkpoint(),
    viewUser: () => current().view('user'),
    viewRole,
    prepareUserAction: () => prepare('user',null),
    prepareRoleTurn,
    prepareRoleMove: roleId => prepareRoleTurn(roleId).commit,
    dispose
  });
}
