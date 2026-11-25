// GAME-TABLE-001 stage 06. Provisional freestyle rules: >=5 in a row,
// black first, no forbidden moves. No UI, persistence or model dependencies.
export const GOMOKU_RULES_V1=Object.freeze({schema:1,size:15,winLength:5,variant:'freestyle'});
const {size,winLength}=GOMOKU_RULES_V1;
const fail=code=>{throw Error(code);};
const inside=(x,y)=>Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&x<size&&y>=0&&y<size;
const index=(x,y)=>y*size+x;
const directions=[[1,0],[0,1],[1,1],[1,-1]];
function players(room){
  if(room?.gameId!=='gomoku'||!Array.isArray(room.seats)||room.seats.length<2||room.seats.length>8||
    !Array.from(room.seats).every(s=>s&&typeof s.seatId==='string'&&s.seatId&&['player','observer'].includes(s.mode))||
    new Set(room.seats.map(s=>s.seatId)).size!==room.seats.length)fail('GOMOKU_INVALID_ROOM');
  const ids=room.seats.filter(s=>s.mode==='player').map(s=>s.seatId);
  if(ids.length!==2)fail('GOMOKU_INVALID_ROOM');
  return ids;
}
export function gomokuWinningLine(board,x,y,color){
  if(!inside(x,y)||![1,2].includes(color)||board[index(x,y)]!==color)return [];
  for(const [dx,dy] of directions){
    const line=[[x,y]];
    for(let sign of [-1,1]){
      for(let n=1;inside(x+dx*n*sign,y+dy*n*sign)&&board[index(x+dx*n*sign,y+dy*n*sign)]===color;n++){
        const point=[x+dx*n*sign,y+dy*n*sign];if(sign<0)line.unshift(point);else line.push(point);
      }
    }
    if(line.length>=winLength)return line;
  }
  return [];
}
function validate(state,room){
  const ids=players(room);
  if(state?.schema!==1||!Array.isArray(state.board)||state.board.length!==size*size||
    !Array.from(state.board).every(v=>v===0||v===1||v===2)||
    !Array.isArray(state.players)||state.players.length!==2||!state.players.every((s,i)=>s===ids[i])||
    !Number.isInteger(state.count)||state.count<0||state.count>size*size)fail('GOMOKU_INVALID_STATE');
  const black=state.board.filter(v=>v===1).length,white=state.board.filter(v=>v===2).length;
  if(black+white!==state.count||black!==Math.ceil(state.count/2)||white!==Math.floor(state.count/2))fail('GOMOKU_INVALID_STATE');
  const color=state.count%2?1:2,last=state.last;
  if(state.count===0?last!==null:(!last||!inside(last.x,last.y)||last.seatId!==ids[color-1]||state.board[index(last.x,last.y)]!==color))fail('GOMOKU_INVALID_STATE');
  const line=last?gomokuWinningLine(state.board,last.x,last.y,color):[];
  const done=line.length>0||state.count===size*size;
  if(done?(room.phase!=='finished'||room.turnSeatId!==null):(room.phase!=='playing'||room.turnSeatId!==ids[state.count%2]))fail('GOMOKU_INVALID_PHASE');
  if(!Array.isArray(state.winningLine)||JSON.stringify(state.winningLine)!==JSON.stringify(line))fail('GOMOKU_INVALID_STATE');
  // Prevent an earlier or opposing win from surviving in a supplied raw state.
  for(let i=0;i<state.board.length;i++){
    const c=state.board[i];if(!c)continue;
    const found=gomokuWinningLine(state.board,i%size,Math.floor(i/size),c);
    if(found.length&&(!last||c!==color||!found.some(([x,y])=>x===last.x&&y===last.y)))fail('GOMOKU_INVALID_STATE');
  }
  return ids;
}
export function createGomokuRules(){
  return Object.freeze({gameId:'gomoku',
    init(room){const ids=players(room);return {schema:1,players:ids,board:Array(size*size).fill(0),count:0,last:null,winningLine:[]};},
    step({state,room,actorSeatId,move}){
      const ids=validate(state,room);
      if(room.phase!=='playing'||room.turnSeatId!==actorSeatId)fail('GOMOKU_NOT_YOUR_TURN');
      if(!move||typeof move!=='object'||Array.isArray(move)||Object.keys(move).length!==3||
        !Object.hasOwn(move,'kind')||!Object.hasOwn(move,'x')||!Object.hasOwn(move,'y')||move.kind!=='place'||!inside(move.x,move.y))fail('GOMOKU_INVALID_MOVE');
      const {x,y}=move,i=index(x,y);if(state.board[i]!==0)fail('GOMOKU_OCCUPIED');
      const color=ids.indexOf(actorSeatId)+1,board=[...state.board];board[i]=color;
      const line=gomokuWinningLine(board,x,y,color),next={schema:1,players:[...ids],board,count:state.count+1,last:{x,y,seatId:actorSeatId},winningLine:line};
      if(line.length)return {state:next,result:{kind:'win',winnerSeatIds:[actorSeatId]}};
      if(next.count===size*size)return {state:next,result:{kind:'draw',winnerSeatIds:[]}};
      return {state:next,nextSeatId:ids[color===1?1:0]};
    },
    project({state,room,actorSeatId}){
      const ids=validate(state,room);
      if(!room.seats.some(s=>s.seatId===actorSeatId))fail('GOMOKU_UNKNOWN_SEAT');
      const active=room.phase==='playing'&&room.turnSeatId===actorSeatId;
      return {schema:1,variant:'freestyle',size,board:[...state.board],players:ids.map((seatId,i)=>({seatId,color:i+1})),count:state.count,
        last:state.last?{...state.last}:null,winningLine:state.winningLine.map(p=>[...p]),
        legalMoves:active?state.board.flatMap((v,i)=>v===0?[{kind:'place',x:i%size,y:Math.floor(i/size)}]:[]):[]};
    }
  });
}
