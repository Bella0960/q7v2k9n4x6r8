// Trusted in-memory room coordinator. No DOM, storage, AI or network access.
// Runtime adapter must supply verified scope and vetted role IDs; never pass full state to AI.
export const ROOM_SCHEMA = 1;
const USER = 'user';
const fail = code => { throw new Error(code); };
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;
const requireId = value => { if (!id(value)) fail('INVALID_ID'); return value; };
const copy = value => JSON.parse(JSON.stringify(value));
function checkContext(ctx) {
  if (!ctx || !id(ctx.accountId) || !id(ctx.sessionId) || !Array.isArray(ctx.roleIds) || !ctx.roleIds.every(id)) fail('INVALID_SCOPE');
}
function authorize(room, ctx) {
  checkContext(ctx);
  if (!room || room.schema !== ROOM_SCHEMA || room.accountId !== ctx.accountId || room.sessionId !== ctx.sessionId) fail('SCOPE_MISMATCH');
}
function checkRoster(room, ctx) {
  if (room.seats.some(s => s.kind === 'role' && !ctx.roleIds.includes(s.roleId))) fail('ROLE_UNAVAILABLE');
}
export function createRoom(ctx, spec) {
  checkContext(ctx);
  const { roomId, gameId, minSeats, maxSeats } = spec || {};
  requireId(roomId); requireId(gameId);
  if (!Number.isInteger(minSeats) || !Number.isInteger(maxSeats) || minSeats < 2 || minSeats > maxSeats || maxSeats > 12) fail('INVALID_CAPACITY');
  return { schema: ROOM_SCHEMA, accountId: ctx.accountId, sessionId: ctx.sessionId, roomId, gameId, minSeats, maxSeats, revision: 0, phase: 'lobby', seats: [{ seatId: USER, kind: 'user' }], turnSeatId: null };
}
export function roomToken(room, ctx, seatId) {
  authorize(room, ctx);
  if (seatId !== USER) checkRoster(room, ctx);
  if (!room.seats.some(s => s.seatId === seatId)) fail('UNKNOWN_SEAT');
  return { accountId: room.accountId, sessionId: room.sessionId, roomId: room.roomId, revision: room.revision, seatId };
}
// actorSeatId is trusted dispatch metadata, not an AI-provided field.
// 'advance' is a sequential-turn primitive; actual game adapters must validate moves first.
export function reduceRoom(room, ctx, actorSeatId, token, action) {
  authorize(room, ctx);
  if (!token || token.accountId !== room.accountId || token.sessionId !== room.sessionId || token.roomId !== room.roomId || token.revision !== room.revision || token.seatId !== actorSeatId) fail('STALE_ACTION');
  if (!room.seats.some(s => s.seatId === actorSeatId)) fail('UNKNOWN_SEAT');
  if (!action || typeof action.type !== 'string') fail('INVALID_ACTION');
  const next = copy(room);
  const host = () => { if (actorSeatId !== USER) fail('HOST_ONLY'); };
  const lobby = () => { host(); if (room.phase !== 'lobby') fail('NOT_IN_LOBBY'); };
  switch (action.type) {
    case 'invite': {
      lobby(); checkRoster(room, ctx);
      const roleId = requireId(action.roleId);
      if (!ctx.roleIds.includes(roleId)) fail('ROLE_UNAVAILABLE');
      if (room.seats.some(s => s.kind === 'role' && s.roleId === roleId)) fail('DUPLICATE_ROLE');
      if (room.seats.length >= room.maxSeats) fail('ROOM_FULL');
      next.seats.push({ seatId: `role:${roleId}`, kind: 'role', roleId });
      break;
    }
    case 'remove': {
      lobby();
      const index = room.seats.findIndex(s => s.kind === 'role' && s.seatId === action.seatId);
      if (index < 0) fail('UNKNOWN_ROLE_SEAT');
      next.seats.splice(index, 1); break;
    }
    case 'reorder': {
      lobby(); checkRoster(room, ctx);
      const order = action.seatIds;
      if (!Array.isArray(order) || order.length !== room.seats.length || new Set(order).size !== order.length || order.some(s => !room.seats.some(x => x.seatId === s))) fail('INVALID_ORDER');
      next.seats = order.map(s => copy(room.seats.find(x => x.seatId === s))); break;
    }
    case 'start':
      lobby(); checkRoster(room, ctx);
      if (room.seats.length < room.minSeats) fail('NOT_ENOUGH_PLAYERS');
      next.phase = 'playing'; next.turnSeatId = next.seats[0].seatId; break;
    case 'advance': {
      checkRoster(room, ctx);
      if (room.phase !== 'playing' || room.turnSeatId !== actorSeatId) fail('NOT_YOUR_TURN');
      const i = room.seats.findIndex(s => s.seatId === actorSeatId);
      next.turnSeatId = next.seats[(i + 1) % next.seats.length].seatId; break;
    }
    case 'close':
      host(); if (room.phase === 'closed') fail('ROOM_CLOSED');
      next.phase = 'closed'; next.turnSeatId = null; break;
    default: fail('UNKNOWN_ACTION');
  }
  next.revision += 1;
  return next;
}
export function seatView(room, ctx, seatId) {
  authorize(room, ctx); checkRoster(room, ctx);
  if (!room.seats.some(s => s.seatId === seatId)) fail('UNKNOWN_SEAT');
  return { schema: ROOM_SCHEMA, roomId: room.roomId, gameId: room.gameId, revision: room.revision, phase: room.phase, turnSeatId: room.turnSeatId, selfSeatId: seatId, seats: room.seats.map(s => s.kind === 'user' ? { seatId: s.seatId, kind: s.kind } : { seatId: s.seatId, kind: s.kind, roleId: s.roleId }) };
}
