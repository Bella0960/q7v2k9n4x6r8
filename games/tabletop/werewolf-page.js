import {createBrowserRoomVerifier} from './account-room-context.js';
import {createBrowserRoomSession} from './browser-room-session.js';
import {createWerewolfRules,createWerewolfRulesFromMode,WEREWOLF_LINEUPS} from './werewolf-rules.js';
import {createWerewolfTurnDriver} from './werewolf-turn-driver.js';

// Internal mount; canonical account and provider integration required before route activation.
export function mountWerewolfPage(root,{win=root?.ownerDocument?.defaultView,makeRoomId=()=>win.crypto.randomUUID(),randomIndex,decideRole=null,decideBot=null,allowSpeech=null,pace=()=>{},onFinished=()=>{}}={}){
 const fail=code=>{throw Error(code);};
 if(!root?.ownerDocument||!win?.document||typeof makeRoomId!=='function')fail('WOLF_PAGE_INVALID');
 const doc=root.ownerDocument,verify=createBrowserRoomVerifier(win,{includeRoleLabels:true});
 const el=(tag,cls='',text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const button=(text,cls,fn)=>{const n=el('button',cls,text);n.type='button';n.addEventListener('click',fn);return n;};
 const option=(value,text)=>{const o=el('option','',text);o.value=value;return o;};
 const names={wolf:'狼人',seer:'预言家',guard:'守卫',villager:'村民'};
 const actions={choose:'选择',protect:'守护',inspect:'查验',vote:'投票'};
 let epoch=0,picker=null,checking=null,active=null,busy=false,paused=false,disposed=false,view=null;
 const selected=new Set(),boxes=new Map(),listeners=[];
 const wrap=el('main','mao-wolf'),setup=el('section','mao-wolf__setup'),game=el('section','mao-wolf__game'),note=el('p','mao-wolf__note');note.setAttribute('role','status');game.hidden=true;
 const size=el('select','mao-wolf__size');size.setAttribute('aria-label','游戏人数');size.append(...[6,9,12].map(n=>option(String(n),n+'人局')));size.value='6';
 const fill=el('input','mao-wolf__fill');fill.type='checkbox';fill.checked=false;const fillLabel=el('label','mao-wolf__pick');fillLabel.append(fill,el('span','','普通棋友补位'));
 const lineup=el('p','mao-wolf__lineup'),roster=el('div','mao-wolf__roster'),counter=el('p','mao-wolf__counter');
 const refresh=button('读取角色','mao-wolf__refresh',()=>void reload()),start=button('开始游戏','mao-wolf__start',()=>void begin());start.disabled=true;
 setup.append(el('h1','mao-wolf__heading','狼人杀'),size,lineup,roster,fillLabel,counter,refresh,start);
 const turn=el('p','mao-wolf__turn'),players=el('div','mao-wolf__players');
 const identity=el('details','mao-wolf__identity'),role=el('p','mao-wolf__role'),privateInfo=el('p','mao-wolf__private');
 identity.append(el('summary','','我的身份'),role,privateInfo);
 const history=el('div','mao-wolf__history');history.setAttribute('role','log');history.setAttribute('aria-live','polite');
 const ballot=el('div','mao-wolf__ballot'),target=el('select','mao-wolf__target');target.setAttribute('aria-label','选择目标');
 const confirm=button('确认','mao-wolf__confirm',()=>{const kind=view?.game.legalKinds.find(k=>Object.hasOwn(actions,k));if(kind&&target.value)void act({kind,targetSeatId:target.value});});ballot.append(target,confirm);
 const speech=el('div','mao-wolf__speech'),input=el('textarea','mao-wolf__input');input.rows=2;input.maxLength=500;input.placeholder='说出你的判断';input.setAttribute('aria-label','公开发言');
 const speak=button('发言','mao-wolf__speak',async()=>{const text=input.value.trim();if(text&&await act({kind:'speak',text}))input.value='';});speech.append(input,speak);
 const controls=el('div','mao-wolf__controls'),pass=button('跳过','mao-wolf__pass',()=>void act({kind:'pass'}));controls.append(ballot,speech,pass);
 const footer=el('footer','mao-wolf__footer'),resume=button('继续游戏','mao-wolf__resume',()=>void advance()),pause=button('暂停','mao-wolf__pause',()=>suspend()),end=button('结束本局','mao-wolf__end',()=>finish());footer.append(resume,pause,end);
 game.append(turn,identity,players,history,controls,footer);wrap.append(setup,game,note);root.replaceChildren(wrap);
 const label=id=>id===null?'弃票':id==='user'?'我':active?.labels.get(id)??(/^bot:(?:[1-9]|1[01])$/.test(id)?'棋友 '+id.slice(4):'角色');
 function check(e,stamp){if(disposed||active!==e||epoch!==stamp||paused)fail('WOLF_PAGE_STALE');}
 function wipe(){view=null;turn.textContent=role.textContent=privateInfo.textContent='';identity.open=false;players.replaceChildren();history.replaceChildren();target.replaceChildren();input.value='';controls.hidden=true;}
 function clearPicker(){picker=null;selected.clear();boxes.clear();roster.replaceChildren();start.disabled=true;counter.textContent='';}
 function invalidate(){epoch++;checking?.abort();checking=null;clearPicker();}
 function sync(){
   const count=Number(size.value),deck=WEREWOLF_LINEUPS[count],max=count-1;
   if(!deck)return;
   lineup.textContent=Object.keys(names).map(k=>names[k]+' '+deck.filter(r=>r===k).length).join(' · ');
   while(selected.size>max)selected.delete([...selected].at(-1));
   for(const [id,box] of boxes){box.checked=selected.has(id);box.disabled=busy||(!box.checked&&selected.size>=max);}
   counter.textContent='已选 '+selected.size+'/'+max+' 位角色'+(fill.checked?' · '+(max-selected.size)+'位普通棋友':'');start.disabled=busy||!picker||(!fill.checked&&selected.size!==max);
 }
 size.addEventListener('change',sync);fill.addEventListener('change',sync);
 async function reload(){
   if(disposed||active||busy)return;invalidate();const stamp=epoch,ac=new AbortController();checking=ac;refresh.disabled=true;note.textContent='读取角色…';
   try{if(doc.hidden||win.navigator?.onLine===false)fail('PAGE_INACTIVE');const c=await verify({signal:ac.signal});if(disposed||stamp!==epoch||ac.signal.aborted)return;picker=c;
     for(const r of c.roleLabels){const line=el('label','mao-wolf__pick'),box=el('input');box.type='checkbox';boxes.set(r.id,box);box.addEventListener('change',()=>{if(picker!==c||busy)return;if(box.checked&&selected.size<Number(size.value)-1)selected.add(r.id);else selected.delete(r.id);sync();});line.append(box,el('span','',r.name));roster.append(line);}
     sync();note.textContent=c.roleIds.length?'':'暂无可邀请角色。';
   }catch{if(!disposed&&stamp===epoch)note.textContent='账号或角色名单验证失败。';}finally{if(checking===ac){checking=null;refresh.disabled=false;}}
 }
 function notifyFinished(){if(!disposed&&!busy&&!paused&&active&&view?.phase==='finished'){try{onFinished({roomId:active.roomId,revision:view.revision});}catch{}}}
 function render(e,v,stamp){
   check(e,stamp);if(v?.gameId!=='werewolf'||v.roomId!==e.roomId||v.selfSeatId!=='user'||!v.game||!['playing','finished'].includes(v.phase))fail('WOLF_PAGE_VIEW');
   view=v;const g=v.game,done=v.phase==='finished',night=g.stage==='night',legal=g.legalKinds;
   if(!done&&g.players.some(p=>Object.hasOwn(p,'role')))fail('WOLF_PAGE_PRIVATE_VIEW');
   turn.textContent=done?(g.winningTeam==='wolf'?'狼人阵营获胜':g.winningTeam==='village'?'好人阵营获胜':'本局和局'):'第 '+g.round+' 轮 · '+(night?'夜间':g.stage==='day-talk'?'白天发言':'公开投票')+(!g.alive?' · 观战':legal.length?' · 轮到你':' · 等待其他玩家');
   role.textContent=names[g.selfRole]??'未知';
   const privateLines=[];
   if(g.teammates?.length)privateLines.push('队友：'+g.teammates.map(label).join('、'));
   if(g.inspections?.length)privateLines.push(...g.inspections.map(x=>'第'+x.round+'轮 · '+label(x.targetSeatId)+'：'+(x.team==='wolf'?'狼人阵营':'好人阵营')));
   privateInfo.textContent=privateLines.join('\n');
   players.replaceChildren(...g.players.map((p,i)=>{const n=el('div','mao-wolf__seat'+(!p.alive?' is-out':''));n.append(el('small','',String(i+1).padStart(2,'0')),el('span','',label(p.seatId)),el('small','',done?names[p.role]:p.alive?'在场':'出局'));return n;}));
   history.replaceChildren(...g.publicEvents.map(item=>{
     const n=el('div','mao-wolf__entry');let text='';
     if(item.kind==='dawn')text=item.outSeatId===null?'本轮无人出局':label(item.outSeatId)+'出局';
     else if(item.kind==='vote-result')text=item.votes.map(b=>label(b.seatId)+'：'+label(b.target)).join(' / ')+'。'+(item.outSeatId===null?'无人出局':label(item.outSeatId)+'出局');
     else if(item.kind==='speech')text=label(item.seatId)+'：'+item.text;
     else text=label(item.seatId)+'跳过发言';
     n.append(el('small','','第'+item.round+'轮'),el('p','',text));return n;
   }));history.scrollTop=history.scrollHeight;
   const kind=legal.find(k=>Object.hasOwn(actions,k));controls.hidden=done||!legal.length;ballot.hidden=!kind;speech.hidden=!legal.includes('speak');pass.hidden=!legal.includes('pass');
   target.replaceChildren(option('','请选择'),...g.legalTargets.map(id=>option(id,label(id))));target.value='';confirm.textContent=actions[kind]??'确认';
   resume.hidden=done||legal.length>0;pause.hidden=done;
 }
 function report(result){note.textContent=result.status==='model-unavailable'?'当前尚未接入角色模型，无法继续自动回合。':result.status==='yield'?'可以继续下一批回合。':'';resume.hidden=result.status==='finished'||result.status==='user';}
 async function run(e,stamp){e.stamp=stamp;note.textContent='其他玩家正在行动…';const result=await e.driver.runUntilUser();check(e,stamp);report(result);}
 async function begin(){
   if(disposed||busy||active||!picker||start.disabled)return;
   const ids=[...selected],c=picker,stamp=++epoch,count=Number(size.value);busy=true;start.disabled=true;let e;
   try{
     if(!WEREWOLF_LINEUPS[count]||ids.length>count-1||!fill.checked&&ids.length!==count-1)fail('WOLF_PAGE_SETUP');
     const roomId=makeRoomId(),session=createBrowserRoomSession({win,spec:{roomId,gameId:'werewolf'},rules:createWerewolfRules({randomIndex}),expectedIdentity:{accountId:c.accountId,sessionId:c.sessionId}});
     e={roomId,session,driver:null,stamp,labels:new Map(c.roleLabels.filter(r=>ids.includes(r.id)).map(r=>['role:'+r.id,r.name]))};active=e;paused=false;
     e.driver=createWerewolfTurnDriver({session,decideRole,decideBot,allowSpeech,pace,onView:v=>render(e,v,e.stamp)});
     await session.refresh();check(e,stamp);
     async function send(a){const commit=await session.prepareUserAction();check(e,stamp);const v=await commit(a);check(e,stamp);return v;}
     for(const id of ids)await send({type:'invite',roleId:id});
     if(ids.length<count-1)await send({type:'fillBots',playerCount:count});
     const v=await send({type:'start'});clearPicker();setup.hidden=true;game.hidden=false;render(e,v,stamp);note.textContent='';
     if(!v.game.legalKinds.length)await run(e,stamp);
   }catch{if(!disposed&&active===e&&stamp===epoch){if(game.hidden)finish();else resume.hidden=false;note.textContent='本局暂时无法继续，请重试。';}}
   finally{busy=false;notifyFinished();}
 }
 async function act(move){
   const e=active,stamp=epoch;if(disposed||busy||paused||!e||!view?.game.legalKinds.includes(move.kind))return false;busy=true;let committed=false;
   try{
     const old=view,v=await e.session.viewUser();check(e,stamp);if(v.revision!==old.revision||!v.game.legalKinds.includes(move.kind))fail('WOLF_PAGE_STALE');
     const commit=await e.session.prepareUserAction();check(e,stamp);const next=await commit({type:'move',move});check(e,stamp);committed=true;render(e,next,stamp);note.textContent='';
     if(next.phase==='playing'&&!next.game.legalKinds.length)await run(e,stamp);return true;
   }catch{if(!disposed&&active===e&&epoch===stamp){if(e.session.status()==='disposed')finish();else{note.textContent='操作未完成，请检查当前回合或继续。';resume.hidden=false;}}return committed;}finally{busy=false;notifyFinished();}
 }
 async function advance(){
   const e=active;if(disposed||busy||!e)return;busy=true;paused=false;const stamp=epoch;e.stamp=stamp;
   try{const v=await e.session.viewUser();check(e,stamp);render(e,v,stamp);if(v.phase==='playing'&&!v.game.legalKinds.length)await run(e,stamp);else note.textContent='';}
   catch{if(!disposed&&active===e&&epoch===stamp){if(e.session.status()==='disposed')finish();else{note.textContent='无法继续，请重试。';resume.hidden=false;}}}finally{busy=false;notifyFinished();}
 }
 function suspend(){if(!active)return;epoch++;paused=true;active.driver?.stop();wipe();resume.hidden=false;pause.hidden=true;note.textContent='已暂停，继续前重新验证账号。';}
 function finish(){const e=active;active=null;epoch++;paused=false;e?.driver?.dispose();e?.session.dispose();wipe();invalidate();game.hidden=true;setup.hidden=false;note.textContent='';refresh.disabled=false;}
 function listen(t,n,f){t.addEventListener(n,f);listeners.push(()=>t.removeEventListener(n,f));}
 function inactive(){if(active){if(game.hidden)finish();else suspend();}else{invalidate();refresh.disabled=false;note.textContent='请重新读取角色。';}}
 listen(win,'offline',inactive);listen(win,'storage',inactive);listen(doc,'visibilitychange',()=>{if(doc.hidden)inactive();});
 function destroy(){if(disposed)return;disposed=true;finish();for(const remove of listeners.splice(0))remove();wrap.remove();}
 listen(win,'pagehide',destroy);sync();void reload();
 // Private internal persistence hooks. Never expose the checkpoint to a
 // player model, public history export or arbitrary file import.
 async function saveMatch(){
   const e=active,stamp=epoch;if(disposed||busy||paused||!e||!view)fail('WOLF_PAGE_BUSY');
   busy=true;try{const board=await e.session.checkpoint();check(e,stamp);return {schema:1,board};}finally{busy=false;}
 }
 async function restoreMatch(saved){
   if(disposed||busy||active||!picker)fail('WOLF_PAGE_BUSY');
   if(!saved||Object.keys(saved).length!==2||saved.schema!==1||saved.board?.gameId!=='werewolf')fail('WOLF_INVALID_MATCH');
   const copy=JSON.parse(JSON.stringify(saved.board)),c=picker,stamp=++epoch;let e;busy=true;
   try{
     const session=createBrowserRoomSession({win,spec:{roomId:copy.roomId,gameId:'werewolf'},rules:createWerewolfRulesFromMode(copy.mode),checkpoint:copy,expectedIdentity:{accountId:c.accountId,sessionId:c.sessionId}});
     e={roomId:copy.roomId,session,driver:null,stamp,labels:new Map(c.roleLabels.map(r=>['role:'+r.id,r.name]))};active=e;paused=false;
     e.driver=createWerewolfTurnDriver({session,decideRole,decideBot,allowSpeech,pace,onView:v=>render(e,v,e.stamp)});
     const v=await session.viewUser();check(e,stamp);clearPicker();setup.hidden=true;game.hidden=false;render(e,v,stamp);note.textContent='';return v;
   }catch(error){if(active===e)finish();throw error;}finally{busy=false;notifyFinished();}
 }
 async function archiveMatch(journal){
   if(typeof journal?.recordSavedMatch!=='function')fail('WOLF_INVALID_JOURNAL');
   const e=active,stamp=epoch,saved=await saveMatch();check(e,stamp);return journal.recordSavedMatch(saved);
 }
 return Object.freeze({reload,destroy,saveMatch,restoreMatch,archiveMatch});
}
