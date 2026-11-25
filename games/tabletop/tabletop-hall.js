import {createBrowserRoomVerifier} from './account-room-context.js';
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
export function mountTabletopHall(root,{win=root?.ownerDocument?.defaultView,gameOptions={},onExit=()=>{}}={}){
 if(!root?.ownerDocument||!win?.document||typeof onExit!=='function')fail('TABLETOP_HALL_INVALID');
 const doc=root.ownerDocument,verify=createBrowserRoomVerifier(win,{includeRoleLabels:true});
 const el=(tag,cls='',text)=>{const n=doc.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const btn=(text,cls,fn)=>{const n=el('button',cls,text);n.type='button';n.addEventListener('click',fn);return n;};
 let disposed=false,epoch=0,context=null,journal=null,current=null,checking=null,busy=false,exitArmed=false,replaceArmed=null,needsRefresh=false;
 const saves=new Map(),listeners=[];
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
 function purge(){journal?.close();journal=null;context=null;saves.clear();replaceArmed=null;exitArmed=false;}
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
     if(saves.has(game.id))row.append(btn('继续暂存','mao-table-link',()=>void launch(game.id,true)));
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
     page=mounts[id](container,{...gameOptions[id],win});current={kind:'game',id,page};
     if(saved){
       // Wait for the page's own scoped roster verification. A duplicate
       // reload cancels the initial picker request instead of bypassing it.
       await page.reload();check(stamp);await page.restoreMatch(saved);check(stamp);
     }
     note.textContent='';
   }catch{if(!disposed&&stamp===epoch){page?.destroy();showHome();note.textContent='无法进入游戏，请重新验证账号。';}}
   finally{busy=false;}
 }
 async function save(){
   const e=current,stamp=epoch;if(disposed||busy||needsRefresh||e?.kind!=='game')return;
   busy=true;try{
     await verified(stamp);const saved=await e.page.saveMatch();check(stamp);await verified(stamp);
     if(current!==e||saved?.board?.gameId!==e.id||saved.board.accountId!==context.accountId)fail('TABLETOP_HALL_SCOPE');
     // One temporary slot per game. Explicit replacement confirmation.
     if(saves.has(e.id)&&saves.get(e.id).board.roomId!==saved.board.roomId&&replaceArmed!==saved.board.roomId){replaceArmed=saved.board.roomId;note.textContent='该游戏已有暂存对局，再点一次暂存将替换它。';return;}
     saves.set(e.id,JSON.parse(JSON.stringify(saved)));replaceArmed=null;exitArmed=false;note.textContent='已暂存到当前大厅会话，关闭页面后不会保留。';
   }catch{if(!disposed&&stamp===epoch)note.textContent='暂存未完成，请等待当前回合结束后重试。';}finally{busy=false;}
 }
 async function archive(){
   const e=current,stamp=epoch;if(disposed||busy||needsRefresh||e?.kind!=='game')return;
   busy=true;try{
     await verified(stamp);const saved=await e.page.saveMatch();check(stamp);await verified(stamp);if(current!==e||saved.board.accountId!==context.accountId)fail('TABLETOP_HALL_STALE');const result=journal.recordSavedMatch(saved);check(stamp);
     note.textContent=result.duplicate?'本局已归档，无需重复记录。':'已记入本次会话的游戏手账。';
   }catch{if(!disposed&&stamp===epoch)note.textContent='仅可归档已结束且当前可验证的对局。';}finally{busy=false;}
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
   if(current?.kind==='game'&&!exitArmed){exitArmed=true;note.textContent='返回会结束当前页面。请先暂存或归档，再点击返回确认。';return;}
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
   catch{if(!disposed&&stamp===epoch){if(!context){removeCurrent();purge();showHome();}note.textContent='账号验证未完成，请重试。';}}finally{busy=false;}
 }
 function destroy(){if(disposed)return;disposed=true;epoch++;checking?.abort();removeCurrent();purge();for(const f of listeners.splice(0))f();wrap.remove();}
 listen(win,'storage',invalidate);listen(win,'offline',invalidate);listen(doc,'visibilitychange',()=>{if(doc.hidden)invalidate();});listen(win,'pagehide',destroy);
 showHome();return Object.freeze({destroy});
}
