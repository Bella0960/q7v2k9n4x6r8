// Internal page-runtime boundary. The context provider and dispatcher factory
// must be trusted local adapters. This module is not an authentication source.
const fail = code => { throw new Error(code); };
const validId = v => typeof v === 'string' && v.length > 0 && v.length <= 256 && v.trim() === v;
function readContext(getContext) {
  const c = getContext();
  if (!c || !validId(c.accountId) || !validId(c.sessionId) || !Array.isArray(c.roleIds) || !c.roleIds.every(validId)) fail('UNVERIFIED_CONTEXT');
  return {accountId:c.accountId,sessionId:c.sessionId,roleIds:[...new Set(c.roleIds)]};
}
export function createRoomLifetime({getContext,createDispatcher,spec,rules}) {
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
  dispatcher = createDispatcher({getContext:scopedContext,spec,rules});
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
      return active.dispatch(actor,token,roleId === null ? payload : {type:'move',move:payload});
    };
  }
  return Object.freeze({
    viewUser: () => current().view('user'),
    prepareUserAction: () => prepare('user',null),
    // Only the trusted role scheduler may call this method, never AI output.
    prepareRoleMove(roleId) {
      if (!validId(roleId)) fail('INVALID_ROLE_ID');
      const c = scopedContext();
      if (!c.roleIds.includes(roleId)) fail('ROLE_UNAVAILABLE');
      const actor = 'role:'+roleId, v = current().view(actor);
      const seat = v.seats.find(s=>s.seatId===actor && s.kind==='role' && s.roleId===roleId);
      if (v.phase!=='playing' || !seat || seat.mode==='observer') fail('ROLE_CANNOT_MOVE');
      return prepare(actor,roleId);
    },
    dispose
  });
}
