import {GOMOKU_RULES_V1} from './gomoku-rules.js';
// Deterministic local strategy, not a persona model. A model may propose a
// legal position; the engine still owns all moves and outcomes.
const size=GOMOKU_RULES_V1.size,dirs=[[1,0],[0,1],[1,1],[1,-1]];
const inside=(x,y)=>x>=0&&x<size&&y>=0&&y<size;
const at=(b,x,y)=>inside(x,y)?b[y*size+x]:-1;
function threat(b,x,y,c){
  let score=0;
  for(const [dx,dy] of dirs){
    let count=1,open=0;
    for(const sign of [-1,1]){
      let n=1;while(at(b,x+dx*n*sign,y+dy*n*sign)===c){count++;n++;}
      if(at(b,x+dx*n*sign,y+dy*n*sign)===0)open++;
    }
    if(count>=5)score+=1000000;
    else if(open)score+=([0,2,12,90,900][count])*(open===2?4:1);
  }
  return score;
}
export function chooseGomokuMove(view,{difficulty='normal',proposal=null}={}){
  if(!['easy','normal','hard'].includes(difficulty))throw Error('GOMOKU_INVALID_DIFFICULTY');
  if(view?.gameId!=='gomoku'||view.phase!=='playing'||view.selfSeatId!==view.turnSeatId||view.game?.size!==size||!Array.isArray(view.game.board)||view.game.board.length!==size*size||!Array.from(view.game.board).every(v=>[0,1,2].includes(v))||!Array.isArray(view.game.legalMoves))return null;
  const color=view.game.players?.find(p=>p.seatId===view.selfSeatId)?.color;if(![1,2].includes(color))return null;
  const legal=view.game.legalMoves.filter(m=>m?.kind==='place'&&Number.isInteger(m.x)&&Number.isInteger(m.y)&&inside(m.x,m.y)&&at(view.game.board,m.x,m.y)===0);
  if(!legal.length)return null;
  const out=m=>({kind:'place',x:m.x,y:m.y});
  if(proposal&&Object.keys(proposal).length===3&&Object.hasOwn(proposal,'kind')&&Object.hasOwn(proposal,'x')&&Object.hasOwn(proposal,'y')){
    const match=legal.find(m=>m.kind===proposal.kind&&m.x===proposal.x&&m.y===proposal.y);if(match)return out(match);
  }
  const b=view.game.board,enemy=3-color;
  // Immediate wins always take precedence. Normal/hard block immediate wins;
  // easy emphasizes adjacent play but intentionally overlooks some threats.
  const rated=legal.map(m=>{
    const {x,y}=m,attack=threat(b,x,y,color),defense=threat(b,x,y,enemy),center=14-Math.abs(x-7)-Math.abs(y-7);
    const score=attack>=1000000?1e9+attack: difficulty==='easy'?attack+center*2: defense>=1000000?1e8+defense:attack*(difficulty==='hard'?1.1:1)+defense*(difficulty==='hard'?1.05:.6)+center*.15;
    return {m,score};
  });
  rated.sort((a,b)=>b.score-a.score||a.m.y-b.m.y||a.m.x-b.m.x);
  return out(rated[0].m);
}
