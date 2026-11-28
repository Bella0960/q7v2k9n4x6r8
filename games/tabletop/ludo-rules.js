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
  const goal=state.mode==='adventure'?2:4;
  const won=state.players.filter(p=>p.planes.filter(v=>v===finish).length>=goal);
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
const adventureSquares=Object.freeze({5:'supply',18:'supply',31:'supply',44:'supply',9:'wind',22:'wind',35:'wind',48:'wind'});
function adventureDestination(player,plane,die,card){
  const from=player.planes[plane],freeLaunch=from===-1&&!player.planes.some(p=>p>=0&&p<finish),base=destination(from,freeLaunch?6:die);if(!base)return null;
  let {to}=base;const effects=[...base.effects];
  if(card==='boost'){
    if(!player.cards.boost||from<0||to+2>finish||to===finish)return null;
    to+=2;effects.push('boost');if(to===finish)effects.push('finish');
  }else if(card==='shield'){
    if(!player.cards.shield||player.shields[plane]||to>=trackLength)return null;
    effects.push('shield');
  }else if(card!==undefined)return null;
  const event=adventureSquares[square(player.slot,to)];
  if(event==='wind'&&to+2<trackLength){to+=2;effects.push('wind');}
  if(event==='supply')effects.push('supply');
  return {kind:'choose',plane,from,to,effects,...(card?{card}:{})};
}
function adventureChoices(player,die){return player.planes.flatMap((p,i)=>[undefined,'boost','shield'].map(card=>adventureDestination(player,i,die,card)).filter(Boolean));}
export function createLudoRules({rollDie=()=>1+Math.floor(Math.random()*6),mode='classic'}={}){
  if(!['classic','adventure'].includes(mode))fail('LUDO_INVALID_MODE');
  const adventure=mode==='adventure';
  const legalChoices=(p,die)=>adventure?adventureChoices(p,die):choices(p,die);
  function verifyVariant(state){if(adventure?(state.mode!=='adventure'||!state.players.every(p=>integer(p.cruise,0,1)&&p.cards&&['boost','shield'].every(k=>integer(p.cards[k],0,2))&&Array.isArray(p.shields)&&p.shields.length===4&&Array.from(p.shields).every(x=>typeof x==='boolean'))):state.mode!==undefined)fail('LUDO_INVALID_ADVENTURE_STATE');}

  if(typeof rollDie!=='function') fail('LUDO_INVALID_DICE_SOURCE');
  return Object.freeze({gameId:'ludo',checkpointVersion:1,checkpointMode:mode,
    replayStep({state,room,actorSeatId,move,die}){
      const rolling=move?.kind==='roll'||move?.kind==='cruise';
      if(rolling?!integer(die,1,6):die!==null)fail('LUDO_INVALID_REPLAY_DIE');
      if(move?.kind==='cruise'&&die!==3)fail('LUDO_INVALID_REPLAY_DIE');
      return createLudoRules({mode,rollDie:()=>die}).step({state,room,actorSeatId,move});
    },
    init(room){const ids=players(room);return {schema:1,stage:'roll',die:null,players:ids.map((seatId,i)=>({seatId,slot:slots(ids.length)[i],planes:adventure?[0,4,-1,-1]:Array(planesPerSeat).fill(-1),...(adventure?{cards:{boost:1,shield:1},cruise:1,shields:[false,false,false,false]}:{})})),last:null,...(adventure?{mode:'adventure'}:{})};},
    step({state,room,actorSeatId,move}){
      const ids=validate(state,room);verifyVariant(state);
      if(state.stage==='finished'||room.turnSeatId!==actorSeatId) fail('LUDO_NOT_YOUR_TURN');
      const next=clone(state),actor=next.players.find(p=>p.seatId===actorSeatId),following=ids[(ids.indexOf(actorSeatId)+1)%ids.length];
      if(state.stage==='roll'){
        const cruise=adventure&&strictMove(move,'cruise',['kind']);
        if(!cruise&&!strictMove(move,'roll',['kind'])) fail('LUDO_EXPECT_ROLL');
        if(cruise&&!actor.cruise)fail('LUDO_CRUISE_USED');
        const die=cruise?3:rollDie();if(cruise)actor.cruise--;if(!integer(die,1,6)) fail('LUDO_INVALID_DIE');
        const legal=legalChoices(actor,die);next.last={kind:'roll',seatId:actorSeatId,die,skipped:legal.length===0,...(cruise?{cruise:true}:{})};
        next.die=legal.length?die:null;next.stage=legal.length?'choose':'roll';
        return {state:next,nextSeatId:legal.length||(!adventure&&die===launchRoll)?actorSeatId:following};
      }
      if(!(strictMove(move,'choose',['kind','plane'])||(adventure&&strictMove(move,'choose',['kind','plane','card'])&&['boost','shield'].includes(move.card)))||!integer(move.plane,0,planesPerSeat-1)) fail('LUDO_EXPECT_PLANE');
      const selected=legalChoices(actor,state.die).find(m=>m.plane===move.plane&&m.card===move.card);if(!selected) fail('LUDO_ILLEGAL_PLANE');
      const effects=[...selected.effects],captures=[];let blocked=false;
      if(adventure&&selected.card){actor.cards[selected.card]--;if(selected.card==='shield')actor.shields[move.plane]=true;}
      actor.planes[move.plane]=selected.to;
      const landed=square(actor.slot,selected.to);
      const targets=[];if(landed!==null)for(const opponent of next.players){if(opponent===actor)continue;opponent.planes.forEach((p,i)=>{if(square(opponent.slot,p)===landed)targets.push({opponent,i});});}
      if(adventure&&targets.some(({opponent,i})=>opponent.shields[i])){
        for(const {opponent,i} of targets)if(opponent.shields[i])opponent.shields[i]=false;
        actor.planes[move.plane]=-1;actor.shields[move.plane]=false;blocked=true;
        effects.splice(0,effects.length,...effects.filter(e=>!['supply','finish'].includes(e)),'blocked');
      }else for(const {opponent,i} of targets){opponent.planes[i]=-1;if(adventure)opponent.shields[i]=false;captures.push({seatId:opponent.seatId,plane:i});}
      let gained=null;
      if(adventure&&!blocked){
        if(selected.to>=trackLength)actor.shields[move.plane]=false;
        if(effects.includes('supply')){const kind=state.die%2?'shield':'boost';if(actor.cards[kind]<2){actor.cards[kind]++;gained=kind;}}
      }
      next.last={kind:'move',seatId:actorSeatId,plane:move.plane,die:state.die,from:selected.from,to:actor.planes[move.plane],effects,captures,...(adventure?{card:selected.card??null,gained}: {})};
      next.die=null;
      if(actor.planes.filter(p=>p===finish).length>=(adventure?2:4)){next.stage='finished';return {state:next,result:{kind:'win',winnerSeatIds:[actorSeatId]}};}
      next.stage='roll';return {state:next,nextSeatId:!adventure&&state.die===launchRoll?actorSeatId:following};
    },
    project({state,room,actorSeatId}){
      const ids=validate(state,room);verifyVariant(state);if(!ids.includes(actorSeatId)) fail('LUDO_UNKNOWN_SEAT');
      const active=room.turnSeatId===actorSeatId&&state.stage!=='finished';
      return {schema:1,stage:state.stage,die:state.die,players:state.players.map(p=>({seatId:p.seatId,slot:p.slot,planes:p.planes.map((progress,i)=>({plane:i,progress,zone:progress===-1?'hangar':progress===finish?'finished':progress>=trackLength?'home':'track',square:square(p.slot,progress),...(adventure?{shield:p.shields[i]}:{})})),...(adventure?{cards:{...p.cards},cruise:p.cruise}:{})})),last:clone(state.last),legalMoves:!active?[]:state.stage==='roll'?[{kind:'roll'},...(adventure&&state.players.find(p=>p.seatId===actorSeatId).cruise?[{kind:'cruise'}]:[])]:legalChoices(state.players.find(p=>p.seatId===actorSeatId),state.die),...(adventure?{mode:'adventure',specialSquares:adventureSquares}:{})};
    }
  });
}
