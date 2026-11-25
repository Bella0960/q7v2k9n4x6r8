import {LUDO_RULES_V1 as rules} from './ludo-rules.js';

// Geometry for the provisional V1 cross board. Grid coordinates are 0-based.
const rotate=(x,y,n)=>{for(let i=0;i<n;i++) [x,y]=[14-y,x];return {x,y};};
const segment=[...Array.from({length:6},(_,x)=>[x,6]),...Array.from({length:6},(_,i)=>[6,5-i]),[7,0]];
const hangar=[[2,2],[3,2],[2,3],[3,3]];
const pos=(x,y)=>`${x}:${y}`;
const slots=Array.from({length:4},(_,i)=>i);
const cells=Object.freeze([
  ...slots.flatMap(slot=>segment.map(([x,y],i)=>Object.freeze({...rotate(x,y,slot),zone:'track',square:slot*13+i,slot:(slot*13+i)%4}))),
  ...slots.flatMap(slot=>Array.from({length:6},(_,i)=>Object.freeze({...rotate(i+1,7,slot),zone:i===5?'finished':'home',slot,progress:52+i}))),
  ...slots.flatMap(slot=>hangar.map(([x,y],plane)=>Object.freeze({...rotate(x,y,slot),zone:'hangar',slot,plane})))
]);
const track=cells.slice(0,rules.trackLength);
export const LUDO_BOARD_CELLS=cells;
const fail=()=>{throw new Error('LUDO_INVALID_BOARD_VIEW');};
const range=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
const seatNames=['甲','乙','丙','丁'];

// Presentation only: no move legality calculations, no mutable game state.
export function buildLudoBoard(view){
  const g=view?.game;
  if(view?.gameId!=='ludo'||!['playing','finished'].includes(view.phase)||g?.schema!==rules.schema||!Array.isArray(g.players)||!range(g.players.length,2,4)||!Array.isArray(g.legalMoves)||!Number.isSafeInteger(view.revision)) fail();
  const ids=new Set(),used=new Set(),pieces=[];
  for(const p of g.players){
    if(typeof p?.seatId!=='string'||!p.seatId||ids.has(p.seatId)||!range(p.slot,0,3)||used.has(p.slot)||!Array.isArray(p.planes)||p.planes.length!==rules.planesPerSeat) fail();
    ids.add(p.seatId);used.add(p.slot);
    for(let i=0;i<p.planes.length;i++){
      const v=p.planes[i];if(v?.plane!==i||!range(v.progress,-1,rules.finish)) fail();
      const z=v.progress===-1?'hangar':v.progress===rules.finish?'finished':v.progress>=rules.trackLength?'home':'track';
      const square=z==='track'?(p.slot*13+v.progress)%rules.trackLength:null;
      if(v.zone!==z||v.square!==square) fail();
      const cell=z==='track'?track[square]:cells.find(c=>c.slot===p.slot&&c.zone===z&&(z==='hangar'?c.plane===i:c.progress===v.progress));
      if(!cell)fail();pieces.push({seatId:p.seatId,slot:p.slot,plane:i,progress:v.progress,zone:z,x:cell.x,y:cell.y,cellKey:pos(cell.x,cell.y),shield:v.shield===true});
    }
  }
  if(!ids.has(view.selfSeatId)|| (view.phase==='playing'&&!ids.has(view.turnSeatId))) fail();
  const active=view.phase==='playing'&&view.selfSeatId===view.turnSeatId;
  const moves=active?g.legalMoves:[];
  const canRoll=moves.some(m=>m?.kind==='roll');
  const canCruise=moves.some(m=>m?.kind==='cruise');if(canCruise&&(!canRoll||g.mode!=='adventure'))fail();
  const choices=moves.filter(m=>m?.kind==='choose'&&!m.card).map(m=>m.plane);
  const cardMoves=moves.filter(m=>m?.kind==='choose'&&['boost','shield'].includes(m.card));
  if(cardMoves.some(m=>!choices.includes(m.plane))||new Set(cardMoves.map(m=>m.card+':'+m.plane)).size!==cardMoves.length|| (g.mode!=='adventure'&&cardMoves.length))fail();
  if(choices.some(i=>!range(i,0,3))||new Set(choices).size!==choices.length||moves.length!==choices.length+cardMoves.length+Number(canRoll)+Number(canCruise)|| (canRoll&&choices.length)) fail();
  const selectable=new Set(choices);
  return {roomId:view.roomId,revision:view.revision,phase:view.phase,selfSeatId:view.selfSeatId,turnSeatId:view.turnSeatId,stage:g.stage,die:g.die??g.last?.die??null,last:g.last??null,winners:[...(view.result?.winnerSeatIds??[])],canRoll,canCruise,choices,cardMoves,normalMoves:moves.filter(m=>m.kind==='choose'&&!m.card),mode:g.mode??'classic',specialSquares:g.specialSquares??{},cards:g.players.find(p=>p.seatId===view.selfSeatId)?.cards??null,
    cells,pieces:pieces.map(p=>({...p,selectable:p.seatId===view.selfSeatId&&selectable.has(p.plane)})),players:g.players.map(p=>({seatId:p.seatId,slot:p.slot,label:seatNames[p.slot],finished:p.planes.filter(v=>v.zone==='finished').length}))};
}

// Role proposals are restricted to the existing projected legal actions. The
// deterministic local policy is a fallback, not an AI request or a new rule engine.
export function chooseLudoRoleMove(view,proposal){
  const b=buildLudoBoard(view);
  if(!b.selfSeatId.startsWith('role:')||b.selfSeatId!==b.turnSeatId||b.phase!=='playing')return null;
  if(b.canRoll){
    // Reserve the one deterministic action for a known useful landing.
    const own=b.pieces.filter(p=>p.seatId===b.selfSeatId);
    if(b.canCruise&&own.some(p=>p.progress===54|| (b.players.find(p=>p.seatId===b.selfSeatId).slot===2&&[9,13].includes(p.progress))))return {kind:'cruise'};
    return {kind:'roll'};
  }
  if(!b.choices.length)return null;
  if(proposal&&typeof proposal==='object'&&!Array.isArray(proposal)&&Object.keys(proposal).length===2&&Object.hasOwn(proposal,'kind')&&Object.hasOwn(proposal,'plane')&&proposal.kind==='choose'&&b.choices.includes(proposal.plane)) return {kind:'choose',plane:proposal.plane};
  const self=b.players.find(p=>p.seatId===b.selfSeatId);
  const score=m=>{
    const landing=m.to<rules.trackLength?(self.slot*13+m.to)%rules.trackLength:null;
    const captures=landing===null?0:b.pieces.filter(p=>p.seatId!==self.seatId&&p.zone==='track'&&(p.slot*13+p.progress)%rules.trackLength===landing).length;
    if(b.mode==='classic')return (m.to===rules.finish?1000:0)+captures*200+(m.from===-1?70:0)+(m.to-m.from);
    const shielded=landing!==null&&b.pieces.some(p=>p.seatId!==self.seatId&&p.zone==='track'&&p.shield&&(p.slot*13+p.progress)%rules.trackLength===landing);
    const type=String(self.slot+1); // Local fallback strategy, independent of private role IDs.
    // Estimate immediate exposure from nearby opponents; not a prediction of their dice.
    const ownPlane=b.pieces.find(p=>p.seatId===self.seatId&&p.plane===m.plane);
    const threat=landing===null?0:b.pieces.filter(p=>{
      if(p.seatId===self.seatId||p.zone!=='track')return false;
      const gap=(landing-(p.slot*13+p.progress)%rules.trackLength+rules.trackLength)%rules.trackLength;
      return gap>=1&&gap<=6&&p.progress+gap<rules.trackLength;
    }).length;
    const protectedFlight=ownPlane?.shield||m.card==='shield';
    const cardCost=m.card==='boost'?(type==='2'?6:19):m.card==='shield'?15:0;
    const safety=(protectedFlight?0:threat)*(type==='1'?65:type==='3'?30:9);
    const progress=(m.to-m.from)*(type==='2'?4:2);
    const routeBonus=(m.effects.includes('flight')?18:0)+(m.effects.includes('supply')?(type==='3'?55:15):0)+(m.effects.includes('wind')?(type==='3'?20:6):0);
    const homeBonus=m.to>=52?(type==='1'?45:15):0;
    return (shielded?-10000:0)+(m.to===rules.finish?1000:0)+captures*(type==='2'?250:type==='3'?130:80)+(m.from===-1?35:0)+progress+routeBonus+homeBonus-cardCost-safety;
  };
  const ranked=view.game.legalMoves.filter(m=>m.kind==='choose'&&b.choices.includes(m.plane)).sort((a,c)=>score(c)-score(a)||a.plane-c.plane);
  return {kind:'choose',plane:ranked[0].plane,...(ranked[0].card?{card:ranked[0].card}:{})};
}
