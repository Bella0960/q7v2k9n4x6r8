// GAME-TABLE-001: standalone aeroplane chess rules, no storage, UI or AI calls.
// Version 1 provisional variant: 52 shared squares, 6 private home squares,
// launch on six, own-colour +4, shortcut 16->28, exact finish with bounce.
// Same-colour stacking is allowed; capture all opponents at final landing only.
export const LUDO_RULES_V1=Object.freeze({schema:1,trackLength:52,finish:57,planesPerSeat:4,launchRoll:6,jump:4,flightFrom:16,flightTo:28,bonusOnSix:true});
const fail=code=>{throw new Error(code);};
const {trackLength,finish,planesPerSeat,launchRoll,jump,flightFrom,flightTo}=LUDO_RULES_V1;
const integer=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
const slots=n=>n===2?[0,2]:Array.from({length:n},(_,i)=>i);
const clone=v=>JSON.parse(JSON.stringify(v));
const square=(slot,p)=>p>=0&&p<trackLength?(slot*13+p)%trackLength:null;
const players=room=>{
  if(room?.gameId!=='ludo'||!Array.isArray(room.seats)||room.seats.length<2||room.seats.length>4||!Array.from(room.seats).every(s=>s?.mode==='player'&&typeof s.seatId==='string'&&s.seatId.length)) fail('LUDO_INVALID_ROOM');
  const ids=room.seats.map(s=>s.seatId);if(new Set(ids).size!==ids.length) fail('LUDO_INVALID_ROOM');return ids;
};
function validate(state,room){
  const ids=players(room),positions=slots(ids.length);
  if(state?.schema!==1||!['roll','choose','finished'].includes(state.stage)||!Array.isArray(state.players)||state.players.length!==ids.length||!Array.from(state.players).every((p,i)=>p?.seatId===ids[i]&&p.slot===positions[i]&&Array.isArray(p.planes)&&p.planes.length===planesPerSeat&&Array.from(p.planes).every(v=>integer(v,-1,finish)))|| (state.stage==='choose'?!integer(state.die,1,6):state.die!==null)) fail('LUDO_INVALID_STATE');
  const won=state.players.filter(p=>p.planes.every(v=>v===finish));
  if(state.stage==='finished'?won.length!==1:won.length!==0) fail('LUDO_INVALID_STATE');
  if(state.stage==='finished'?room.phase!=='finished':room.phase!=='playing'||!ids.includes(room.turnSeatId)) fail('LUDO_INVALID_PHASE');
  return ids;
}
function destination(p,die){
  if(p===finish||(p===-1&&die!==launchRoll)) return null;
  if(p===-1) return {to:0,effects:['launch']};
  let to=p+die;const effects=[];
  if(to>finish){to=2*finish-to;effects.push('bounce');}
  // Slot-relative colour repeats every four squares. Special movement must
  // remain on the shared track; neither jump nor flight enters a home lane.
  if(to<trackLength&&to===flightFrom){to=flightTo;effects.push('flight');}
  else if(to<trackLength&&to%4===0&&to+jump<trackLength){to+=jump;effects.push('jump');if(to===flightFrom){to=flightTo;effects.push('flight');}}
  if(to===finish)effects.push('finish');
  return {to,effects};
}
function choices(player,die){return player.planes.flatMap((p,i)=>{const target=destination(p,die);return target===null?[]:[{kind:'choose',plane:i,from:p,...target}];});}
function strictMove(move,kind,keys){return move&&typeof move==='object'&&!Array.isArray(move)&&move.kind===kind&&Object.keys(move).length===keys.length&&keys.every(k=>Object.hasOwn(move,k));}
// Inject only a trusted dice source for reproducible tests. A move never carries
// dice values, destinations, capture results, or a caller-selected next turn.
export function createLudoRules({rollDie=()=>1+Math.floor(Math.random()*6)}={}){
  if(typeof rollDie!=='function') fail('LUDO_INVALID_DICE_SOURCE');
  return Object.freeze({gameId:'ludo',
    init(room){const ids=players(room);return {schema:1,stage:'roll',die:null,players:ids.map((seatId,i)=>({seatId,slot:slots(ids.length)[i],planes:Array(planesPerSeat).fill(-1)})),last:null};},
    step({state,room,actorSeatId,move}){
      const ids=validate(state,room);
      if(state.stage==='finished'||room.turnSeatId!==actorSeatId) fail('LUDO_NOT_YOUR_TURN');
      const next=clone(state),actor=next.players.find(p=>p.seatId===actorSeatId),following=ids[(ids.indexOf(actorSeatId)+1)%ids.length];
      if(state.stage==='roll'){
        if(!strictMove(move,'roll',['kind'])) fail('LUDO_EXPECT_ROLL');
        const die=rollDie();if(!integer(die,1,6)) fail('LUDO_INVALID_DIE');
        const legal=choices(actor,die);next.last={kind:'roll',seatId:actorSeatId,die,skipped:legal.length===0};
        next.die=legal.length?die:null;next.stage=legal.length?'choose':'roll';
        return {state:next,nextSeatId:legal.length||die===launchRoll?actorSeatId:following};
      }
      if(!strictMove(move,'choose',['kind','plane'])||!integer(move.plane,0,planesPerSeat-1)) fail('LUDO_EXPECT_PLANE');
      const selected=choices(actor,state.die).find(m=>m.plane===move.plane);if(!selected) fail('LUDO_ILLEGAL_PLANE');
      actor.planes[move.plane]=selected.to;
      const landed=square(actor.slot,selected.to),captures=[];
      if(landed!==null)for(const opponent of next.players){if(opponent===actor)continue;opponent.planes.forEach((p,i)=>{if(square(opponent.slot,p)===landed){opponent.planes[i]=-1;captures.push({seatId:opponent.seatId,plane:i});}});}
      next.last={kind:'move',seatId:actorSeatId,plane:move.plane,die:state.die,from:selected.from,to:selected.to,effects:selected.effects,captures};
      next.die=null;
      if(actor.planes.every(p=>p===finish)){next.stage='finished';return {state:next,result:{kind:'win',winnerSeatIds:[actorSeatId]}};}
      next.stage='roll';return {state:next,nextSeatId:state.die===launchRoll?actorSeatId:following};
    },
    project({state,room,actorSeatId}){
      const ids=validate(state,room);if(!ids.includes(actorSeatId)) fail('LUDO_UNKNOWN_SEAT');
      const active=room.turnSeatId===actorSeatId&&state.stage!=='finished';
      return {schema:1,stage:state.stage,die:state.die,players:state.players.map(p=>({seatId:p.seatId,slot:p.slot,planes:p.planes.map((progress,i)=>({plane:i,progress,zone:progress===-1?'hangar':progress===finish?'finished':progress>=trackLength?'home':'track',square:square(p.slot,progress)}))})),last:clone(state.last),legalMoves:!active?[]:state.stage==='roll'?[{kind:'roll'}]:choices(state.players.find(p=>p.seatId===actorSeatId),state.die)};
    }
  });
}
