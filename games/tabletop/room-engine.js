// Trusted in-memory coordinator; no runtime authentication, storage or AI calls.
export const ROOM_SCHEMA = 2;
const USER = 'user';
const fail = code => { throw new Error(code); };
const id = v => typeof v === 'string' && v.length > 0 && v.length <= 256 && v.trim() === v;
const requireId = v => { if (!id(v)) fail('INVALID_ID'); return v; };
const copy = v => JSON.parse(JSON.stringify(v));
const policies = Object.freeze({
  ludo: Object.freeze({min:2,max:4,observers:0,moderator:false,phased:false}),
  gomoku: Object.freeze({min:2,max:2,observers:6,moderator:false,phased:false}),
  turtle: Object.freeze({min:2,max:8,observers:0,moderator:true,phased:true}),
  werewolf: Object.freeze({min:6,max:12,observers:0,moderator:false,phased:true,exact:Object.freeze([6,9,12])})
});
export function gamePolicy(gameId) {
  if (!Object.hasOwn(policies,gameId)) fail('UNKNOWN_GAME');
  return copy(policies[gameId]);
}
function checkContext(ctx) {
  if (!ctx || !id(ctx.accountId) || !id(ctx.sessionId) || !Array.isArray(ctx.roleIds) || !Array.from(ctx.roleIds).every(id)) fail('INVALID_SCOPE');
}
function authorize(room,ctx) {
  checkContext(ctx);
  if (!room || room.schema !== ROOM_SCHEMA || room.accountId !== ctx.accountId || room.sessionId !== ctx.sessionId) fail('SCOPE_MISMATCH');
}
function checkRoster(room,ctx) {
  if (room.seats.some(s=>s.kind==='role'&&!ctx.roleIds.includes(s.roleId))) fail('ROLE_UNAVAILABLE');
}
const mode = s => s.mode;
const participants = r => r.seats.filter(s=>mode(s)!=='observer');
const players = r => r.seats.filter(s=>mode(s)==='player');
function checkCapacity(r) {
  if (participants(r).length>r.maxSeats || r.seats.filter(s=>mode(s)==='observer').length>r.observerLimit) fail('ROOM_FULL');
}
// The generic constructor is for trusted rule adapters and tests only.
export function createRoom(ctx,spec) {
  checkContext(ctx);
  const {roomId,gameId,minSeats,maxSeats}=spec||{};
  requireId(roomId); requireId(gameId);
  const p=Object.hasOwn(policies,gameId)?gamePolicy(gameId):null;
  const min=p?p.min:minSeats, max=p?p.max:maxSeats;
  if (!Number.isInteger(min)||!Number.isInteger(max)||min<2||min>max||max>12) fail('INVALID_CAPACITY');
  return {schema:ROOM_SCHEMA,accountId:ctx.accountId,sessionId:ctx.sessionId,roomId,gameId,minSeats:min,maxSeats:max,observerLimit:p?p.observers:0,revision:0,phase:'lobby',seats:[{seatId:USER,kind:'user',mode:'player'}],turnSeatId:null};
}
export function createGameRoom(ctx,spec) {
  gamePolicy(spec?.gameId);
  return createRoom(ctx,spec);
}
export function roomToken(room,ctx,seatId) {
  authorize(room,ctx);
  if(seatId!==USER) checkRoster(room,ctx);
  if(!room.seats.some(s=>s.seatId===seatId)) fail('UNKNOWN_SEAT');
  return {accountId:room.accountId,sessionId:room.sessionId,roomId:room.roomId,revision:room.revision,seatId};
}
// actorSeatId is trusted dispatch metadata. 'advance' must follow a validated game move.
export function reduceRoom(room,ctx,actorSeatId,token,action) {
  authorize(room,ctx);
  if(!token||token.accountId!==room.accountId||token.sessionId!==room.sessionId||token.roomId!==room.roomId||token.revision!==room.revision||token.seatId!==actorSeatId) fail('STALE_ACTION');
  if(!room.seats.some(s=>s.seatId===actorSeatId)) fail('UNKNOWN_SEAT');
  if(!action||typeof action.type!=='string') fail('INVALID_ACTION');
  const next=copy(room), p=Object.hasOwn(policies,room.gameId)?policies[room.gameId]:null;
  const host=()=>{if(actorSeatId!==USER) fail('HOST_ONLY');};
  const lobby=()=>{host();if(room.phase!=='lobby') fail('NOT_IN_LOBBY');};
  const getSeat=seatId=>{const s=next.seats.find(x=>x.seatId===seatId);if(!s) fail('UNKNOWN_SEAT');return s;};
  switch(action.type){
    case 'invite': {
      lobby();checkRoster(room,ctx);
      const roleId=requireId(action.roleId), requested=action.mode??'player';
      if(!ctx.roleIds.includes(roleId)) fail('ROLE_UNAVAILABLE');
      if(room.seats.some(s=>s.kind==='role'&&s.roleId===roleId)) fail('DUPLICATE_ROLE');
      if(requested!=='player'&&(requested!=='observer'||!room.observerLimit)) fail('INVALID_SEAT_MODE');
      next.seats.push({seatId:'role:'+roleId,kind:'role',roleId,mode:requested});checkCapacity(next);break;
    }
    case 'fillBots': {
      lobby();checkRoster(room,ctx);
      if(!['ludo','gomoku','turtle','werewolf'].includes(room.gameId)) fail('BOTS_UNSUPPORTED');
      if(room.gameId==='turtle'&&room.seats.some(s=>s.kind==='bot'&&s.mode==='moderator'))fail('MODERATOR_ALREADY_ASSIGNED');
      const count=action.playerCount, real=participants(room).filter(s=>s.kind!=='bot').length;
      if(!Number.isInteger(count)||count<room.minSeats||count>room.maxSeats||count<real||(p?.exact&&!p.exact.includes(count))) fail('INVALID_PLAYER_COUNT');
      next.seats=next.seats.filter(s=>s.kind!=='bot');
      for(let i=1;i<=count-real;i++) next.seats.push({seatId:'bot:'+i,kind:'bot',mode:'player'});
      checkCapacity(next);break;
    }
    case 'remove': {
      lobby();const i=room.seats.findIndex(s=>s.kind==='role'&&s.seatId===action.seatId);
      if(i<0) fail('UNKNOWN_ROLE_SEAT');next.seats.splice(i,1);break;
    }
    case 'reorder': {
      lobby();checkRoster(room,ctx);const order=action.seatIds;
      if(!Array.isArray(order)||order.length!==room.seats.length||new Set(order).size!==order.length||Array.from(order).some(s=>!room.seats.some(x=>x.seatId===s))) fail('INVALID_ORDER');
      next.seats=order.map(s=>getSeat(s));break;
    }
    case 'swapSeats': {
      lobby();checkRoster(room,ctx);if(!room.observerLimit) fail('OBSERVERS_UNSUPPORTED');
      const a=getSeat(action.playerSeatId), b=getSeat(action.observerSeatId);
      if(a.kind==='bot'||b.kind==='bot'||mode(a)!=='player'||mode(b)!=='observer') fail('INVALID_SWAP');
      a.mode='observer';b.mode='player';break;
    }
    case 'setModerator': {
      lobby();checkRoster(room,ctx);if(!p?.moderator) fail('MODERATOR_UNSUPPORTED');
      const target=getSeat(action.seatId);for(const s of next.seats) if(mode(s)==='moderator') s.mode='player';
      target.mode='moderator';break;
    }
    case 'start': {
      lobby();checkRoster(room,ctx);const n=participants(room).length;
      if(n<room.minSeats) fail('NOT_ENOUGH_PLAYERS');
      if(p?.exact&&!p.exact.includes(n)) fail('INVALID_PLAYER_COUNT');
      if(p?.moderator&&room.seats.filter(s=>mode(s)==='moderator').length!==1) fail('MODERATOR_REQUIRED');
      if(!players(room).length) fail('NOT_ENOUGH_PLAYERS');
      checkCapacity(room);next.phase='playing';next.turnSeatId=p?.phased?null:players(room)[0].seatId;break;
    }
    case 'advance': {
      checkRoster(room,ctx);if(p?.phased) fail('PHASE_ENGINE_REQUIRED');
      if(room.phase!=='playing'||room.turnSeatId!==actorSeatId) fail('NOT_YOUR_TURN');
      const order=players(room),i=order.findIndex(s=>s.seatId===actorSeatId);if(i<0) fail('NOT_YOUR_TURN');
      next.turnSeatId=order[(i+1)%order.length].seatId;break;
    }
    case 'close': host();if(room.phase==='closed') fail('ROOM_CLOSED');next.phase='closed';next.turnSeatId=null;break;
    default: fail('UNKNOWN_ACTION');
  }
  next.revision+=1;return next;
}
export function seatView(room,ctx,seatId) {
  authorize(room,ctx);checkRoster(room,ctx);
  if(!room.seats.some(s=>s.seatId===seatId)) fail('UNKNOWN_SEAT');
  return {schema:ROOM_SCHEMA,roomId:room.roomId,gameId:room.gameId,revision:room.revision,phase:room.phase,turnSeatId:room.turnSeatId,selfSeatId:seatId,seats:room.seats.map(s=>s.kind!=='role'?{seatId:s.seatId,kind:s.kind,mode:s.mode}:{seatId:s.seatId,kind:s.kind,roleId:s.roleId,mode:s.mode})};
}
