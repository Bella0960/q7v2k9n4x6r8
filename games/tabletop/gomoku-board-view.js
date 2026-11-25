import {GOMOKU_RULES_V1} from './gomoku-rules.js';

export function createGomokuBoardView(root,{onMove,labelForSeat=id=>id==='user'?'我':'棋友',onError=()=>{}}={}){
  if(!root?.ownerDocument||typeof onMove!=='function'||typeof labelForSeat!=='function'||typeof onError!=='function')throw Error('GOMOKU_INVALID_BOARD');
  const doc=root.ownerDocument,size=GOMOKU_RULES_V1.size;
  const el=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const wrap=el('section','mao-gomoku-board'),header=el('div','mao-gomoku-board__header'),players=el('div','mao-gomoku-board__players'),status=el('p','mao-gomoku-board__status'),grid=el('div','mao-gomoku-board__grid');
  status.setAttribute('role','status');grid.setAttribute('role','group');grid.setAttribute('aria-label','五子棋棋盘');
  header.append(players,status);wrap.append(header,grid);root.replaceChildren(wrap);
  let current=null,legal=new Set(),pending=false,destroyed=false,focused=7*size+7;
  const cells=[];
  function select(i){if(destroyed||pending||!current||!legal.has(i))return;const v=current;pending=true;sync();
    Promise.resolve().then(()=>onMove({roomId:v.roomId,revision:v.revision,seatId:v.selfSeatId,move:{kind:'place',x:i%size,y:Math.floor(i/size)}})).catch(error=>{if(!destroyed)onError(error);}).finally(()=>{if(!destroyed){pending=false;sync();}});
  }
  for(let i=0;i<size*size;i++){
    const cell=el('button','mao-gomoku-board__cell');cell.type='button';
    cell.addEventListener('click',()=>select(i));
    cell.addEventListener('focus',()=>{focused=i;sync();});
    cell.addEventListener('keydown',e=>{
      const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-size,ArrowDown:size}[e.key];
      if(delta===undefined)return;e.preventDefault();
      const next=i+delta;if(next<0||next>=cells.length||(Math.abs(delta)===1&&Math.floor(next/size)!==Math.floor(i/size)))return;
      focused=next;sync();cells[next].focus?.();
    });
    cells.push(cell);grid.append(cell);
  }
  function sync(){
    if(!current)return;const g=current.game,win=new Set(g.winningLine.map(([x,y])=>y*size+x)),last=g.last?g.last.y*size+g.last.x:-1;
    cells.forEach((cell,i)=>{
      const x=i%size,y=Math.floor(i/size),color=g.board[i];
      cell.className='mao-gomoku-board__cell'+(x===0?' is-left':'')+(x===size-1?' is-right':'')+(y===0?' is-top':'')+(y===size-1?' is-bottom':'')+([3,7,11].includes(x)&&[3,7,11].includes(y)?' is-star':'')+(color===1?' is-black':color===2?' is-white':'')+(i===last?' is-last':'')+(win.has(i)?' is-win':'');
      cell.setAttribute('aria-label','第'+(y+1)+'行，第'+(x+1)+'列，'+(color===1?'黑棋':color===2?'白棋':'空位'));
      cell.setAttribute('aria-disabled',String(pending||!legal.has(i)));cell.tabIndex=i===focused?0:-1;
    });
  }
  function render(v){
    if(destroyed)throw Error('GOMOKU_BOARD_CLOSED');
    if(v?.gameId!=='gomoku'||v.selfSeatId!=='user'||!['playing','finished'].includes(v.phase)||!Number.isSafeInteger(v.revision)||v.game?.size!==size||!Array.isArray(v.game.board)||v.game.board.length!==size*size||!Array.from(v.game.board).every(c=>[0,1,2].includes(c))||!Array.isArray(v.game.players)||v.game.players.length!==2||!Array.isArray(v.game.winningLine)||!Array.isArray(v.game.legalMoves))throw Error('GOMOKU_INVALID_VIEW');
    current=JSON.parse(JSON.stringify(v));legal=new Set();
    if(v.phase==='playing'&&v.turnSeatId==='user')for(const m of v.game.legalMoves){if(m.kind==='place'&&Number.isInteger(m.x)&&Number.isInteger(m.y)&&m.x>=0&&m.x<size&&m.y>=0&&m.y<size&&v.game.board[m.y*size+m.x]===0)legal.add(m.y*size+m.x);}
    players.replaceChildren(...v.game.players.map(p=>{
      const n=el('div','mao-gomoku-board__player'+(v.turnSeatId===p.seatId?' is-active':'')),stone=el('span','mao-gomoku-board__stone '+(p.color===1?'is-black':'is-white'));
      n.append(stone,el('span','mao-gomoku-board__name',labelForSeat(p.seatId)),el('small','',p.color===1?'黑棋':'白棋'));return n;
    }));
    status.textContent=v.phase==='finished'?(v.result?.kind==='draw'?'和棋':labelForSeat(v.result?.winnerSeatIds?.[0])+'获胜'):(v.turnSeatId==='user'?'轮到你落子':labelForSeat(v.turnSeatId)+'的回合')+' · '+v.game.count+'手';
    sync();
  }
  return Object.freeze({render,destroy(){if(destroyed)return;destroyed=true;current=null;legal.clear();root.replaceChildren();}});
}
