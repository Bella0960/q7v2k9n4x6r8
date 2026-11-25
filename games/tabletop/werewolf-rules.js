// Fictional social deduction: abstract elimination only. Provisional v1
// lineup and tie rules, isolated from the other games.
export const WEREWOLF_LINEUPS=Object.freeze({
  6:Object.freeze(['wolf','wolf','seer','guard','villager','villager']),
  9:Object.freeze(['wolf','wolf','wolf','seer','guard','villager','villager','villager','villager']),
  12:Object.freeze(['wolf','wolf','wolf','wolf','seer','guard','villager','villager','villager','villager','villager','villager'])
});
const fail=code=>{throw Error(code);};
const clone=v=>JSON.parse(JSON.stringify(v));
const exact=(o,ks)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===ks.length&&ks.every(k=>Object.hasOwn(o,k));
function seats(room){
 if(room?.gameId!=='werewolf'||!Array.isArray(room.seats)||!Object.hasOwn(WEREWOLF_LINEUPS,room.seats.length)||room.seats.some(s=>s.mode!=='player')||new Set(room.seats.map(s=>s.seatId)).size!==room.seats.length)fail('WOLF_INVALID_ROOM');
 return room.seats.map(s=>s.seatId);
}
const team=role=>role==='wolf'?'wolf':'village';
const plurality=ballots=>{
 const counts=new Map();for(const b of ballots)if(b.target!==null)counts.set(b.target,(counts.get(b.target)||0)+1);
 const max=Math.max(0,...counts.values()),top=[...counts].filter(([,n])=>n===max).map(([id])=>id);
 return top.length===1?top[0]:null;
};
export function createWerewolfRules({randomIndex=n=>{const max=0x100000000,limit=max-max%n;const a=new Uint32Array(1);do{globalThis.crypto.getRandomValues(a);}while(a[0]>=limit);return a[0]%n;},maxRounds=12}={}){
 if(typeof randomIndex!=='function'||!Number.isInteger(maxRounds)||maxRounds<1||maxRounds>30)fail('WOLF_INVALID_CONFIG');
 const alive=s=>s.players.filter(p=>p.alive);
 const get=(s,id)=>s.players.find(p=>p.seatId===id);
 const active=s=>s.queue[0]??null;
 const stages=['night-wolf','night-guard','night-seer','day-talk','day-vote'];
 function enter(s,stage){
   s.stage=stage;
   s.queue=alive(s).filter(p=>stage==='night-wolf'?p.role==='wolf':stage==='night-guard'?p.role==='guard':stage==='night-seer'?p.role==='seer':true).map(p=>p.seatId);
 }
 function outcome(s){
   const wolves=alive(s).filter(p=>p.role==='wolf').length,others=alive(s).length-wolves;
   return wolves===0?'village':wolves>=others?'wolf':null;
 }
 function terminal(s,winner){
   s.stage='finished';s.queue=[];s.winningTeam=winner;s.night={wolf:[],guard:null};s.votes=[];
   return {state:s,result:winner?{kind:'win',winnerSeatIds:s.players.filter(p=>team(p.role)===winner).map(p=>p.seatId)}:{kind:'draw',winnerSeatIds:[]}};
 }
 function remove(s,id){if(id!==null){const p=get(s,id);if(!p?.alive)fail('WOLF_INVALID_TARGET');p.alive=false;}}
 function progress(s){
   while(!s.queue.length){
     if(s.stage==='night-wolf')enter(s,'night-guard');
     else if(s.stage==='night-guard')enter(s,'night-seer');
     else if(s.stage==='night-seer'){
       const chosen=plurality(s.night.wolf),out=chosen!==null&&chosen!==s.night.guard?chosen:null;
       remove(s,out);s.publicEvents.push({kind:'dawn',round:s.round,outSeatId:out});
       s.night={wolf:[],guard:null};const won=outcome(s);if(won)return terminal(s,won);
       enter(s,'day-talk');
     }else if(s.stage==='day-talk'){s.votes=[];enter(s,'day-vote');}
     else if(s.stage==='day-vote'){
       const out=plurality(s.votes);
       s.publicEvents.push({kind:'vote-result',round:s.round,votes:clone(s.votes),outSeatId:out});
       remove(s,out);s.votes=[];const won=outcome(s);if(won)return terminal(s,won);
       if(s.round>=maxRounds)return terminal(s,null);
       s.round++;enter(s,'night-wolf');
     }else fail('WOLF_INVALID_STAGE');
   }
   return {state:s,nextSeatId:null};
 }
 function check(s,room){
   const ids=seats(room);
   if(s?.schema!==1||!Array.isArray(s.players)||s.players.length!==ids.length||
      !s.players.every((p,i)=>p.seatId===ids[i]&&typeof p.alive==='boolean'&&WEREWOLF_LINEUPS[ids.length].includes(p.role))||
      JSON.stringify(s.players.map(p=>p.role).sort())!==JSON.stringify([...WEREWOLF_LINEUPS[ids.length]].sort())||
      !Number.isInteger(s.round)||s.round<1||s.round>maxRounds||!Array.isArray(s.queue)||new Set(s.queue).size!==s.queue.length||s.queue.some(id=>!get(s,id)?.alive)||
      !Array.isArray(s.publicEvents)||!Array.isArray(s.votes)||!Array.isArray(s.inspections)||!s.night||
      (room.phase==='finished'?s.stage!=='finished'||s.queue.length!==0:room.phase!=='playing'||!stages.includes(s.stage)||s.queue.length===0))fail('WOLF_INVALID_STATE');
 }
 function legal(s,id){
   if(active(s)!==id||!get(s,id)?.alive)return {kinds:[],targets:[]};
   const other=alive(s).filter(p=>p.seatId!==id);
   switch(s.stage){
     case 'night-wolf':return {kinds:['choose','pass'],targets:other.filter(p=>p.role!=='wolf').map(p=>p.seatId)};
     case 'night-guard':return {kinds:['protect','pass'],targets:alive(s).map(p=>p.seatId)};
     case 'night-seer':return {kinds:['inspect','pass'],targets:other.map(p=>p.seatId)};
     case 'day-talk':return {kinds:['speak','pass'],targets:[]};
     case 'day-vote':return {kinds:['vote','pass'],targets:other.map(p=>p.seatId)};
     default:return {kinds:[],targets:[]};
   }
 }
 return Object.freeze({gameId:'werewolf',
   init(room){
     const ids=seats(room),deck=[...WEREWOLF_LINEUPS[ids.length]];
     for(let i=deck.length-1;i>0;i--){const j=randomIndex(i+1);if(!Number.isInteger(j)||j<0||j>i)fail('WOLF_INVALID_RANDOM');[deck[i],deck[j]]=[deck[j],deck[i]];}
     const s={schema:1,players:ids.map((seatId,i)=>({seatId,role:deck[i],alive:true})),round:1,stage:null,queue:[],night:{wolf:[],guard:null},votes:[],inspections:[],publicEvents:[],winningTeam:null};
     enter(s,'night-wolf');return s;
   },
   step({state,room,actorSeatId,move}){
     check(state,room);if(room.phase!=='playing'||active(state)!==actorSeatId)fail('WOLF_NOT_YOUR_TURN');
     const s=clone(state),l=legal(s,actorSeatId),kind=move?.kind;
     if(!l.kinds.includes(kind))fail('WOLF_ILLEGAL_ACTION');
     const pass=kind==='pass';let target=null;
     if(pass){if(!exact(move,['kind']))fail('WOLF_ILLEGAL_ACTION');}
     else if(kind==='speak'){
       if(!exact(move,['kind','text'])||typeof move.text!=='string'||!move.text.trim()||move.text!==move.text.trim()||move.text.length>500)fail('WOLF_ILLEGAL_SPEECH');
     }else{
       if(!exact(move,['kind','targetSeatId'])||!l.targets.includes(move.targetSeatId))fail('WOLF_INVALID_TARGET');target=move.targetSeatId;
     }
     if(s.stage==='night-wolf')s.night.wolf.push({seatId:actorSeatId,target});
     else if(s.stage==='night-guard')s.night.guard=target;
     else if(s.stage==='night-seer'&&!pass)s.inspections.push({seatId:actorSeatId,round:s.round,targetSeatId:target,team:team(get(s,target).role)});
     else if(s.stage==='day-talk')s.publicEvents.push({kind:pass?'pass':'speech',round:s.round,seatId:actorSeatId,...(pass?{}:{text:move.text})});
     else if(s.stage==='day-vote')s.votes.push({seatId:actorSeatId,target});
     s.queue.shift();return progress(s);
   },
   project({state:s,room,actorSeatId}){
     check(s,room);const self=get(s,actorSeatId);if(!self)fail('WOLF_UNKNOWN_SEAT');
     const finished=room.phase==='finished',day=s.stage.startsWith('day-'),l=legal(s,actorSeatId);
     // Night schedule/actor and even precise subphase are private. Trusted
     // scheduling uses a separate control plane, not the player projection.
     return {schema:1,round:s.round,stage:finished?'finished':day?s.stage:'night',selfRole:self.role,alive:self.alive,
       players:s.players.map(p=>({seatId:p.seatId,alive:p.alive,...(finished?{role:p.role}:{})})),
       publicEvents:clone(s.publicEvents),activeSeatId:day?active(s):active(s)===actorSeatId?actorSeatId:null,
       legalKinds:[...l.kinds],legalTargets:[...l.targets],
       ...(self.role==='wolf'?{teammates:s.players.filter(p=>p.role==='wolf'&&p.seatId!==actorSeatId).map(p=>p.seatId),teamChoices:clone(s.night.wolf.filter(p=>p.seatId===actorSeatId))}:{}),
       ...(self.role==='seer'?{inspections:clone(s.inspections.filter(p=>p.seatId===actorSeatId))}:{}),
       ...(finished?{winningTeam:s.winningTeam}:{})};
   }
 });
}
