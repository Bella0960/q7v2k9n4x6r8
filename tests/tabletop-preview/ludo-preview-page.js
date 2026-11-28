import {createPreviewRound,PREVIEW_PLAYERS} from './ludo-preview-round.js';
import {createLudoBoardView} from '../../games/tabletop/ludo-board-view.js';

export function mountLudoPreview({doc=document,win=window,delay=300,rollDie}={}){
const $=id=>doc.getElementById(id);
const setup=$('setup'),game=$('game'),start=$('start'),end=$('end'),resume=$('resume'),status=$('preview-status'),chat=$('chat'),messages=$('messages'),form=$('message-form'),input=$('message'),chatStatus=$('chat-status'),selection=$('selection-count'),discussButton=$('discuss'),stopButton=$('stop-speech'),speaker=$('speaker');
let current=null,counter=0;
const label=id=>id==='user'?'我':'测试棋手 '+(PREVIEW_PLAYERS.indexOf(id.slice(5))+1);
const pace=()=>delay===0?Promise.resolve():new Promise(resolve=>win.setTimeout(resolve,delay));
const selected=()=>Array.from(setup.querySelectorAll('input[name=player]:checked'),e=>e.value);
function updateSelection(){const n=selected().length;selection.textContent='已选 '+n+' 位'+(n?' · '+(n+1)+' 人局':'');start.disabled=n===0||current!==null;}
function finished(){status.textContent='本局结束。';end.textContent='再来一局';resume.hidden=true;}
function showMessages(entry){
  if(current!==entry)return;
  const rows=entry.round.messages().map(m=>{const li=doc.createElement('li');li.textContent=label(m.sender.seatId)+'：'+m.text;return li;});
  messages.replaceChildren(...rows);
}
function updateSpeech(entry){
  if(current!==entry)return;
  const state=entry.round.speechStatus();showMessages(entry);
  discussButton.disabled=state.running||state.remaining<entry.selectedCount;
  stopButton.hidden=!state.running;
  speaker.textContent=state.speaker?label(state.speaker)+' 正在准备本地回复…':'';
}
async function discuss(entry){
  if(current!==entry||entry.round.speechStatus().running)return;
  chatStatus.textContent='';
  try{await entry.round.discuss();}
  catch(error){if(current===entry)chatStatus.textContent=error.message==='SPEECH_CANCELLED'?'已停止本次讨论。':'本次讨论未完成。';}
  finally{if(current===entry)updateSpeech(entry);}
}
async function advance(entry){
  if(current!==entry||entry.running)return;
  entry.running=true;resume.hidden=true;
  try{
    const outcome=await entry.round.advanceRoles();
    if(current!==entry)return;
    if(outcome.status==='finished')finished();
    else{status.textContent=outcome.status==='yield'?'自动回合已暂停，可继续。':'';resume.hidden=outcome.status!=='yield';}
  }catch{
    if(current===entry){status.textContent='自动回合暂停，请继续或结束本局。';resume.hidden=false;}
  }finally{entry.running=false;}
}
function close(){
  const old=current;current=null;
  if(old){old.round.dispose();old.board.destroy();}
  game.hidden=true;setup.hidden=false;resume.hidden=true;status.textContent='';chatStatus.textContent='';messages.replaceChildren();input.value='';chat.open=false;speaker.textContent='';stopButton.hidden=true;discussButton.disabled=false;end.textContent='结束本局';updateSelection();
}
function begin(){
  if(current)return;
  const selectedIds=selected();
  if(!selectedIds.length){status.textContent='请至少选择一位测试棋手。';return;}
  start.disabled=true;status.textContent='';
  let board,round;
  try{
    const entry={round:null,board:null,running:false,selectedCount:selectedIds.length};
    board=createLudoBoardView($('board'),{labelForSeat:label,onMove:async action=>{
      if(current!==entry)throw Error('PREVIEW_STALE_ACTION');
      const next=entry.round.userMove(action);
      if(next.phase==='finished')finished();
      else if(next.turnSeatId!=='user')await advance(entry);
    }});
    round=createPreviewRound({roomId:'preview-'+(++counter),selectedIds,pace,rollDie,speechPace:pace,onSpeech:()=>updateSpeech(entry),render:v=>board.render(v)});
    entry.round=round;entry.board=board;current=entry;
    setup.hidden=true;game.hidden=false;round.show();updateSpeech(entry);
  }catch{
    round?.dispose();board?.destroy();current=null;setup.hidden=false;game.hidden=true;updateSelection();status.textContent='无法开始，请重试。';
  }
}
setup.addEventListener('change',updateSelection);
start.addEventListener('click',begin);
end.addEventListener('click',()=>{if(current&&(current.round.view().phase==='finished'||win.confirm('结束本局？预览进度不会保存。')))close();});
resume.addEventListener('click',()=>{if(current)void advance(current);});
discussButton.addEventListener('click',()=>{if(current)void discuss(current);});
stopButton.addEventListener('click',()=>{if(current)current.round.stopSpeech();});
form.addEventListener('submit',event=>{
  event.preventDefault();const entry=current;if(!entry)return;
  try{entry.round.send(input.value);input.value='';chatStatus.textContent='';showMessages(entry);}
  catch{chatStatus.textContent='发言未发送，请检查内容或本局消息容量。';}
});
win.addEventListener('pagehide',close);
updateSelection();
}
if(typeof document!=='undefined'&&typeof window!=='undefined')mountLudoPreview();
