import {createBrowserRoomVerifier} from './account-room-context.js';
import {createTabletopModelOptions} from './tabletop-model-options.js';
import {createGameJournal} from './ludo-journal.js';
import {mountGameJournal} from './game-journal-page.js';
import {mountLudoPage} from './ludo-page.js';
import {mountGomokuPage} from './gomoku-page.js';
import {mountTurtlePage} from './turtle-page.js';
import {mountWerewolfPage} from './werewolf-page.js';

export const TABLETOP_GAMES=Object.freeze([
 Object.freeze({id:'ludo',name:'飞行棋',meta:'2–4 人',description:'经典航线与奇遇快局'}),
 Object.freeze({id:'gomoku',name:'五子棋',meta:'2 人对弈',description:'与角色下棋，也可观战'}),
 Object.freeze({id:'turtle',name:'海龟汤',meta:'2–8 人',description:'自由提问，共同推理'}),
 Object.freeze({id:'werewolf',name:'狼人杀',meta:'6 / 9 / 12 人',description:'身份推理与公开投票'})
]);
const mounts=Object.freeze({ludo:mountLudoPage,gomoku:mountGomokuPage,turtle:mountTurtlePage,werewolf:mountWerewolfPage});
const fail=code=>{throw Error(code);};
// A mountable feature module for the existing hall, not a second route.
// Session-only save slots: durable storage requires the approved repository.
export function mountTabletopHall(root,{win=root?.ownerDocument?.defaultView,gameOptions={},modelServices=null,onExit=()=>{}}={}){
 if(!root?.ownerDocument||!win?.document||typeof onExit!=='function')fail('TABLETOP_HALL_INVALID');
 const doc=root.ownerDocument,verify=createBrowserRoomVerifier(win,{includeRoleLabels:true});
 const el=(tag,cls='',text)=>{const n=doc.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const btn=(text,cls,fn)=>{const n=el('button',cls,text);n.type='button';n.addEventListener('click',fn);return n;};
 let disposed=false,epoch=0,context=null,journal=null,current=null,checking=null,busy=false,exitArmed=false,exitSaveResult=null,replaceArmed=null,needsRefresh=false;
 const saves=new Map(),finishedSaves=new Set(),listeners=[];
 const wrap=el('section','mao-table-hall'),top=el('header','mao-table-hall__top'),title=el('h1','','多人游戏'),back=btn('返回游戏大厅','mao-table-link',()=>void exit());top.append(title,back);
 const main=el('div','mao-table-hall__main'),toolbar=el('div','mao-table-hall__tools'),note=el('p','mao-table-note');note.setAttribute('role','status');
 const reverify=btn('重新验证','mao-table-link',()=>void recover());reverify.hidden=true;
 wrap.append(top,toolbar,main,reverify,note);root.replaceChildren(wrap);
 function check(stamp){if(disposed||stamp!==epoch||doc.hidden||win.navigator?.onLine===false)fail('TABLETOP_HALL_STALE');}
 function localCheck(){
   const s=win.__MAO_ACCOUNT_SCOPE__;
   if(!context||s?.ready!==true||s.accountId!==context.accountId||doc.querySelector('meta[name="mao-account-id"]')?.content!==s.accountId||doc.querySelector('meta[name="mao-account-role"]')?.content!==s.role)fail('TABLETOP_HALL_SCOPE');
   return context;
 }
 function purge(){journal?.close();journal=null;context=null;saves.clear();finishedSaves.clear();replaceArmed=null;exitArmed=false;}
 async function verified(stamp){
   check(stamp);const ac=new AbortController();checking=ac;
   try{
     const c=await verify({signal:ac.signal});check(stamp);
     if(context&&(context.accountId!==c.accountId||context.sessionId!==c.sessionId)){removeCurrent();purge();fail('TABLETOP_HALL_SCOPE_CHANGED');}
     context=c;localCheck();if(!journal)journal=createGameJournal({getContext:localCheck});return c;
   }finally{if(checking===ac)checking=null;}
 }
 function removeCurrent(){const old=current;current=null;old?.page?.destroy();main.replaceChildren();toolbar.replaceChildren();exitArmed=false;replaceArmed=null;}
 function showHome(){
   removeCurrent();main.hidden=toolbar.hidden=false;reverify.hidden=true;needsRefresh=false;title.textContent='多人游戏';title.hidden=false;back.textContent='返回游戏大厅';note.textContent='';
   const list=el('div','mao-table-hall__list');for(const game of TABLETOP_GAMES){
     const row=el('div','mao-table-hall__row'),open=btn(game.name,'mao-table-hall__open',()=>void launch(game.id,false));
     const copy=el('span','mao-table-hall__meta',game.meta+' · '+game.description);open.append(copy);row.append(open);
     if(saves.has(game.id))row.append(btn(finishedSaves.has(game.id)?'查看已结束对局':'继续暂存','mao-table-link',()=>void launch(game.id,true)));
     list.append(row);
   }
   main.append(list,btn('游戏手账','mao-table-hall__journal',()=>void openJournal()),el('p','mao-table-note','暂存与手账仅保留于当前大厅会话，尚未接入永久存储。'));
 }
 function tools(){
   toolbar.replaceChildren(btn('暂存本局','mao-table-link',()=>void save()),btn('归档已结束对局','mao-table-link',()=>void archive()));
 }
 async function launch(id,restore){
   if(disposed||busy||needsRefresh||current||!Object.hasOwn(mounts,id))return;
   busy=true;const stamp=++epoch;let page;
   try{
     const c=await verified(stamp);const saved=restore?saves.get(id):null;if(restore&&!saved)fail('TABLETOP_NO_SAVE');
     const container=el('div','mao-table-hall__game');main.replaceChildren(container);title.hidden=true;back.textContent='返回多人游戏';tools();
     // Use the existing game journal, never the general daily-memory reader.
     const modelOptions=modelServices?createTabletopModelOptions({...modelServices,win,identity:c,gameId:id,
       readGameMemory:async ({roleId,excludePuzzleId},{signal}={})=>{
         if(disposed||doc.hidden||win.navigator?.onLine===false||signal?.aborted||needsRefresh||current?.page!==page||current?.id!==id||context?.accountId!==c.accountId||context?.sessionId!==c.sessionId)fail('TABLETOP_MEMORY_STALE');
         const items=journal.read({roleId,channel:'game',excludePuzzleId,limit:24});
         const lines=[];let used=0;
         for(const f of items.slice().reverse()){
           const name=TABLETOP_GAMES.find(g=>g.id===f.gameId)?.name??'桌游';
           const line=JSON.stringify({game:name,kind:f.kind,...(f.kind==='result'?{outcome:f.outcome}:{text:f.text})});
           if(used+line.length+1>6000)break;lines.unshift(line);used+=line.length+1;
         }
         return lines.join('\n');
       }}):{};
     page=mounts[id](container,{...gameOptions[id],...modelOptions,win,onFinished:event=>{
       if(disposed||needsRefresh||current?.page!==page||!event||typeof event.roomId!=='string'||!Number.isSafeInteger(event.revision))return;
       const key=JSON.stringify([event.roomId,event.revision]);if(current.archived===key||current.attempted===key)return;
       current.terminal={...event,key};drainFinish();
     }});current={kind:'game',id,page};
     if(saved){
       // Wait for the page's own scoped roster verification. A duplicate
       // reload cancels the initial picker request instead of bypassing it.
       await page.reload();check(stamp);await page.restoreMatch(saved);check(stamp);
     }
     note.textContent='';
   }catch{if(!disposed&&stamp===epoch){page?.destroy();showHome();note.textContent='无法进入游戏，请重新验证账号。';}}
   finally{busy=false;drainFinish();}
 }
 async function save({automatic=false}={}){
   const e=current,stamp=epoch;if(disposed||busy||needsRefresh||e?.kind!=='game')return 'unavailable';
   busy=true;try{
     await verified(stamp);const saved=await e.page.saveMatch();check(stamp);await verified(stamp);
     if(current!==e||saved?.board?.gameId!==e.id||saved.board.accountId!==context.accountId)fail('TABLETOP_HALL_SCOPE');
     // One temporary slot per game. Explicit replacement confirmation.
     const prior=saves.get(e.id);
     if(prior&&prior.board.roomId!==saved.board.roomId){
       if(automatic)return 'other-match';
       if(replaceArmed!==saved.board.roomId){replaceArmed=saved.board.roomId;note.textContent='该游戏已有暂存对局，再点一次暂存将替换它。';return 'other-match';}
     }
     if(prior&&prior.board.roomId===saved.board.roomId&&!isPrefix(prior,saved)){note.textContent='暂存进度存在冲突，已保留原记录。';return 'conflict';}
     saves.set(e.id,JSON.parse(JSON.stringify(saved)));if(e.archived===JSON.stringify([saved.board.roomId,saved.board.startRevision+saved.board.moves.length]))finishedSaves.add(e.id);else finishedSaves.delete(e.id);replaceArmed=null;exitArmed=false;note.textContent='已暂存到当前大厅会话，关闭页面后不会保留。';return 'saved';
   }catch{if(!disposed&&stamp===epoch)note.textContent='暂存未完成，请等待当前回合结束后重试。';return 'unavailable';}finally{busy=false;drainFinish();}
 }
 function isPrefix(prior,terminal){
   const a=prior.board,b=terminal.board;
   if(a.roomId!==b.roomId||a.moves.length>b.moves.length)return false;
   const {moves:am,...ai}=a,{moves:bm,...bi}=b;
   if(JSON.stringify(ai)!==JSON.stringify(bi)||!am.every((m,i)=>JSON.stringify(m)===JSON.stringify(bm[i])))return false;
   if(prior.chat&&!terminal.chat)return false;
   if(prior.chat&&!prior.chat.messages.every((m,i)=>JSON.stringify(m)===JSON.stringify(terminal.chat.messages[i])))return false;
   return prior.difficulty===terminal.difficulty;
 }
 function drainFinish(){
   const e=current;if(disposed||busy||needsRefresh||e?.kind!=='game'||!e.terminal||e.attempted===e.terminal.key||e.archived===e.terminal.key)return;
   e.attempted=e.terminal.key;void archive(e.terminal);
 }
 async function archive(expected=null){
   const e=current,stamp=epoch;if(disposed||busy||needsRefresh||e?.kind!=='game')return;
   busy=true;try{
     await verified(stamp);const saved=await e.page.saveMatch();check(stamp);await verified(stamp);if(current!==e||saved.board.accountId!==context.accountId)fail('TABLETOP_HALL_STALE');if(expected&&(saved.board.roomId!==expected.roomId||saved.board.startRevision+saved.board.moves.length!==expected.revision))fail('TABLETOP_HALL_STALE');
     const result=journal.recordSavedMatch(saved);check(stamp);
     e.archived=JSON.stringify([saved.board.roomId,saved.board.startRevision+saved.board.moves.length]);
     // Advance only an earlier temporary snapshot of this exact match.
     // Never replace another match or a divergent branch of the same room.
     const prior=saves.get(e.id);
     if(prior&&isPrefix(prior,saved)){saves.set(e.id,JSON.parse(JSON.stringify(saved)));finishedSaves.add(e.id);}
     note.textContent=result.duplicate?'本局已归档，无需重复记录。':'已自动或手动记入本次会话的游戏手账。';
   }catch{if(!disposed&&stamp===epoch)note.textContent=expected?'自动归档未完成，请点击归档重试。':'仅可归档已结束且当前可验证的对局。';}finally{busy=false;drainFinish();}
 }
 async function openJournal(){
   if(disposed||busy||needsRefresh||current)return;busy=true;const stamp=++epoch;
   try{
     const c=await verified(stamp);main.replaceChildren();toolbar.replaceChildren();title.hidden=true;back.textContent='返回多人游戏';
     const page=mountGameJournal(main,{roles:c.roleLabels,run:async op=>{
       await verified(stamp);check(stamp);if(current?.kind!=='journal')fail('TABLETOP_HALL_STALE');return op(journal);
     },onBack:()=>{epoch++;showHome();}});
     current={kind:'journal',page};note.textContent='';
   }catch{if(!disposed&&stamp===epoch){showHome();note.textContent='手账暂时不可用。';}}finally{busy=false;}
 }
 async function exit(){
   if(disposed||busy||needsRefresh)return;
   if(current?.kind==='game'){
     const e=current,stamp=epoch,previous=exitArmed?exitSaveResult:null,result=await save({automatic:true});
     if(disposed||stamp!==epoch||current!==e||needsRefresh)return;
     // A player or automatic turn may advance between the two return taps.
     // Re-save at confirmation; if the status changed to failure, warn again.
     if(previous!==null&&(result==='saved'||result===previous)){epoch++;showHome();return;}
     exitArmed=true;exitSaveResult=result;
     note.textContent=result==='saved'?'本局已暂存到当前大厅会话，再点一次返回。':result==='other-match'?'已有另一局暂存，未覆盖。可手动暂存并确认替换，或再次返回放弃当前进度。':result==='conflict'?'进度冲突，已保留原暂存。再次返回将放弃当前未保存进度。':'当前未能暂存，可重试暂存或再次返回放弃未保存进度。';return;
   }
   if(current){epoch++;showHome();return;}
   if((saves.size||journal)&&!exitArmed){exitArmed=true;note.textContent='离开将清除本次会话的暂存与手账，再点一次返回确认。';return;}
   destroy();onExit();
 }
 function listen(t,n,f){t.addEventListener(n,f);listeners.push(()=>t.removeEventListener(n,f));}
 function invalidate(){
   if(disposed)return;epoch++;checking?.abort();checking=null;needsRefresh=true;exitArmed=false;replaceArmed=null;
   // Child pages already suspend and clear private DOM on these events.
   // Keep their in-memory engine and saved slots inaccessible until verified.
   if(current?.kind==='journal')removeCurrent();
   main.hidden=toolbar.hidden=true;reverify.hidden=false;note.textContent='已暂停显示，重新验证后可继续。';
 }
 async function recover(){
   if(disposed||busy||!needsRefresh)return;busy=true;const stamp=epoch;
   try{await verified(stamp);check(stamp);needsRefresh=false;reverify.hidden=true;main.hidden=toolbar.hidden=false;if(!current)showHome();note.textContent=current?'账号已验证，请继续当前游戏。':'';}
   catch{if(!disposed&&stamp===epoch){if(!context){removeCurrent();purge();showHome();}note.textContent='账号验证未完成，请重试。';}}finally{busy=false;drainFinish();}
 }
 function destroy(){if(disposed)return;disposed=true;epoch++;checking?.abort();removeCurrent();purge();for(const f of listeners.splice(0))f();wrap.remove();}
 listen(win,'storage',invalidate);listen(win,'offline',invalidate);listen(doc,'visibilitychange',()=>{if(doc.hidden)invalidate();});listen(win,'pagehide',destroy);
 showHome();return Object.freeze({destroy});
}
