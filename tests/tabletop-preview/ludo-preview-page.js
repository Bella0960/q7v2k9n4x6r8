import {createPreviewRound,PREVIEW_PLAYERS} from './ludo-preview-round.js';
import {createLudoBoardView} from '../../games/tabletop/ludo-board-view.js';

const $=id=>document.getElementById(id);
const setup=$('setup'),game=$('game'),start=$('start'),end=$('end'),resume=$('resume'),status=$('preview-status'),chat=$('chat'),messages=$('messages'),form=$('message-form'),input=$('message');
let current=null,counter=0;
const label=id=>id==='user'?'我':'测试棋手 '+(PREVIEW_PLAYERS.indexOf(id.slice(5))+1);
const pace=()=>new Promise(resolve=>setTimeout(resolve,300));
function showMessages(entry){
  if(current!==entry)return;
  const rows=entry.round.messages().map(m=>{const li=document.createElement('li');li.textContent='我：'+m.text;return li;});
  messages.replaceChildren(...rows);
}
async function advance(entry){
  if(current!==entry||entry.running)return;
  entry.running=true;resume.hidden=true;
  try{
    const outcome=await entry.round.advanceRoles();
    if(current!==entry)return;
    status.textContent=outcome.status==='finished'?'本局结束。':outcome.status==='yield'?'自动回合已暂停，可继续。':'';
    resume.hidden=outcome.status!=='yield';
  }catch{
    if(current===entry){status.textContent='自动回合暂停，请继续或结束本局。';resume.hidden=false;}
  }finally{entry.running=false;}
}
function close(){
  const old=current;current=null;
  if(old){old.round.dispose();old.board.destroy();}
  game.hidden=true;setup.hidden=false;start.disabled=false;resume.hidden=true;status.textContent='';messages.replaceChildren();input.value='';chat.open=false;
}
function begin(){
  if(current)return;
  const selectedIds=Array.from(setup.querySelectorAll('input[name=player]:checked'),e=>e.value);
  if(!selectedIds.length){status.textContent='请至少选择一位测试棋手。';return;}
  start.disabled=true;status.textContent='';
  let board,round;
  try{
    const entry={round:null,board:null,running:false};
    board=createLudoBoardView($('board'),{labelForSeat:label,onMove:async action=>{
      if(current!==entry)throw Error('PREVIEW_STALE_ACTION');
      const next=entry.round.userMove(action);
      if(next.phase==='finished')status.textContent='本局结束。';
      else if(next.turnSeatId!=='user')await advance(entry);
    }});
    round=createPreviewRound({roomId:'preview-'+(++counter),selectedIds,pace,render:v=>board.render(v)});
    entry.round=round;entry.board=board;current=entry;
    setup.hidden=true;game.hidden=false;round.show();showMessages(entry);
  }catch{
    round?.dispose();board?.destroy();current=null;setup.hidden=false;game.hidden=true;start.disabled=false;status.textContent='无法开始，请重试。';
  }
}
start.addEventListener('click',begin);
end.addEventListener('click',()=>{if(current&&window.confirm('结束本局？预览进度不会保存。'))close();});
resume.addEventListener('click',()=>{if(current)void advance(current);});
form.addEventListener('submit',event=>{
  event.preventDefault();const entry=current;if(!entry)return;
  try{entry.round.send(input.value);input.value='';showMessages(entry);}
  catch{status.textContent='发言未发送，请检查内容或本局消息容量。';}
});
window.addEventListener('pagehide',close);
