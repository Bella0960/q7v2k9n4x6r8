import {createBrowserRoomVerifier} from './account-room-context.js';
import {createBrowserRoomSession} from './browser-room-session.js';
import {listTurtlePuzzles} from './turtle-puzzles.js';
import {createTurtleRules,TURTLE_VERDICTS} from './turtle-rules.js';
import {createTurtleTurnDriver} from './turtle-turn-driver.js';

// Opt-in project page. No live route until canonical account integration.
export function mountTurtlePage(root,{win=root?.ownerDocument?.defaultView,makeRoomId=()=>win.crypto.randomUUID(),askRole=null,judgeRole=null,allowPlayerText=null,pace=()=>{}}={}){
 const fail=code=>{throw Error(code);};
 if(!root?.ownerDocument||!win?.document||typeof makeRoomId!=='function')fail('TURTLE_PAGE_INVALID');
 const doc=root.ownerDocument,verify=createBrowserRoomVerifier(win,{includeRoleLabels:true}),puzzles=listTurtlePuzzles();
 const el=(tag,cls='',text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const button=(text,cls,fn)=>{const n=el('button',cls,text);n.type='button';n.addEventListener('click',fn);return n;};
 const option=(value,text)=>{const o=el('option','',text);o.value=value;return o;};
 let epoch=0,picker=null,checking=null,active=null,busy=false,disposed=false,paused=false,view=null,revealArmed=false;
 const selected=new Set(),boxes=new Map(),listeners=[];
 const wrap=el('main','mao-turtle'),setup=el('section','mao-turtle__setup'),game=el('section','mao-turtle__game'),note=el('p','mao-turtle__note');note.setAttribute('role','status');
 const puzzle=el('select','mao-turtle__puzzle');puzzle.setAttribute('aria-label','谜题');puzzle.append(...puzzles.map(p=>option(p.id,p.title+' · '+(p.difficulty==='easy'?'简单':'普通'))));puzzle.value=puzzles[0].id;
 const host=el('select','mao-turtle__host');host.setAttribute('aria-label','主持人');host.append(option('user','我来主持'));host.value='user';
 const roster=el('div','mao-turtle__roster'),rosterNote=el('p','mao-turtle__small'),refresh=button('读取角色','mao-turtle__refresh',()=>void reload()),start=button('开始推理','mao-turtle__start',()=>void begin());start.disabled=true;
 setup.append(el('h1','mao-turtle__heading','海龟汤'),puzzle,el('p','mao-turtle__small','邀请1–7位角色'),roster,rosterNote,host,refresh,start);
 const title=el('h2','mao-turtle__title'),prompt=el('p','mao-turtle__prompt'),turn=el('p','mao-turtle__turn'),history=el('div','mao-turtle__history');history.setAttribute('role','log');history.setAttribute('aria-live','polite');
 const secret=el('details','mao-turtle__secret'),solution=el('p','mao-turtle__solution');secret.append(el('summary','','主持人谜底'),solution);secret.hidden=true;
 const controls=el('div','mao-turtle__controls'),choices=el('details','mao-turtle__choices'),quick=el('div','mao-turtle__quick');choices.append(el('summary','','参考提问'),quick);
 const input=el('textarea','mao-turtle__input');input.maxLength=500;input.rows=2;input.placeholder='提出一个问题，或者说出你的推理';input.setAttribute('aria-label','问题或推理');
 const ask=button('提问','mao-turtle__ask',()=>void submitText('ask')),guess=button('猜谜','mao-turtle__guess',()=>void submitText('guess')),actions=el('div','mao-turtle__actions');
 actions.append(ask,guess);
 const judgement=el('div','mao-turtle__judgement'),verdictText={yes:'是',no:'否',irrelevant:'无关',unclear:'无法判断'};
 const more=el('details','mao-turtle__more'),hint=button('请求提示','mao-turtle__hint',()=>void act({kind:'hint'})),pass=button('跳过本轮','mao-turtle__pass',()=>void act({kind:'pass'}));
 const reveal=button('揭晓谜底','mao-turtle__reveal',()=>{if(!revealArmed){revealArmed=true;reveal.textContent='确认揭晓';return;}void act({kind:'reveal'});});
 more.append(el('summary','','更多操作'),hint,pass,reveal);
 const resume=button('继续推理','mao-turtle__resume',()=>void advance()),pause=button('暂停','mao-turtle__pause',()=>suspend()),end=button('结束本局','mao-turtle__end',()=>finish());
 const footer=el('footer','mao-turtle__footer');footer.append(more,resume,pause,end);
 controls.append(choices,input,actions,judgement);game.append(title,prompt,turn,secret,history,controls,footer);game.hidden=true;wrap.append(setup,game,note);root.replaceChildren(wrap);
 const label=id=>id==='user'?'我':active?.labels.get(id)??'角色';
 function check(e,stamp){if(disposed||active!==e||epoch!==stamp||paused)fail('TURTLE_PAGE_STALE');}
 function wipe(){
   view=null;title.textContent=prompt.textContent=turn.textContent=solution.textContent='';secret.hidden=true;secret.open=false;history.replaceChildren();quick.replaceChildren();judgement.replaceChildren();input.value='';choices.open=false;controls.hidden=true;more.hidden=true;revealArmed=false;reveal.textContent='揭晓谜底';
 }
 function clearPicker(){picker=null;selected.clear();boxes.clear();roster.replaceChildren();host.replaceChildren(option('user','我来主持'));host.value='user';rosterNote.textContent='';start.disabled=true;}
 function invalidate(){epoch++;checking?.abort();checking=null;clearPicker();}
 function sync(){
   const previous=host.value;host.replaceChildren(option('user','我来主持'),...Array.from(selected,id=>option('role:'+id,picker?.roleLabels.find(r=>r.id===id)?.name??'角色')));host.value=previous==='user'||selected.has(previous.slice(5))?previous:'user';
   for(const [id,box] of boxes){box.checked=selected.has(id);box.disabled=busy||(!box.checked&&selected.size>=7);}
   rosterNote.textContent=picker?'共 '+(1+selected.size)+' 人':'';start.disabled=busy||!picker||selected.size<1;
 }
 async function reload(){
   if(disposed||active||busy)return;invalidate();const stamp=epoch,ac=new AbortController();checking=ac;refresh.disabled=true;note.textContent='正在读取角色…';
   try{
     if(doc.hidden||win.navigator?.onLine===false)fail('PAGE_INACTIVE');
     const c=await verify({signal:ac.signal});if(disposed||epoch!==stamp||ac.signal.aborted)return;
     picker=c;for(const role of c.roleLabels){const line=el('label','mao-turtle__role'),box=el('input');box.type='checkbox';boxes.set(role.id,box);
       box.addEventListener('change',()=>{if(picker!==c||busy)return;if(box.checked&&selected.size<7)selected.add(role.id);else selected.delete(role.id);sync();});line.append(box,el('span','',role.name));roster.append(line);}
     sync();note.textContent=c.roleIds.length?'':'暂无可邀请角色。';
   }catch{if(!disposed&&epoch===stamp)note.textContent='账号或角色名单未通过验证。';}
   finally{if(checking===ac){checking=null;refresh.disabled=false;}}
 }
 function render(e,v,stamp){
   check(e,stamp);if(v?.gameId!=='turtle'||v.roomId!==e.roomId||v.selfSeatId!=='user'||!v.game||!['playing','finished'].includes(v.phase))fail('TURTLE_PAGE_VIEW');
   view=v;const g=v.game,finished=v.phase==='finished',legal=new Set(g.legalKinds);
   title.textContent=g.puzzle.title;prompt.textContent=g.puzzle.prompt;
   turn.textContent=finished?(g.endReason==='solved'?label(v.result.winnerSeatIds[0])+'猜中谜底':'本局结束'):label(g.activeSeatId)+(g.stage==='judging'?'正在裁决':'正在推理');
   turn.textContent+=' · '+g.questions+'/'+g.maxQuestions;
   secret.hidden=!Object.hasOwn(g,'solution');solution.textContent=secret.hidden?'':g.solution;secret.firstElementChild&&(secret.firstElementChild.textContent=finished?'完整谜底':'主持人谜底');if(finished)secret.open=true;
   history.replaceChildren(...g.history.map(item=>{
     const n=el('div','mao-turtle__entry'),who=el('small','',label(item.seatId)),body=item.kind==='answer'?verdictText[item.verdict]:item.kind==='judge'?(item.correct?'猜对了':'尚未猜中'):item.kind==='pass'?'跳过本轮':item.kind==='hint'?'提示：'+item.text:item.kind==='guess'?'推理：'+item.text:item.text;
     n.append(who,el('p','',body));return n;
   }));history.scrollTop=history.scrollHeight;
   const canAsk=legal.has('ask'),canGuess=legal.has('guess');
   controls.hidden=finished||!canAsk&&!canGuess&&!legal.has('answer')&&!legal.has('judge');
   input.hidden=actions.hidden=!canAsk&&!canGuess;ask.hidden=!canAsk;guess.hidden=!canGuess;
   choices.hidden=!canAsk||!g.questionOptions.length;quick.replaceChildren(...(canAsk?g.questionOptions.map(q=>button(q.label,'mao-turtle__question',()=>void act({kind:'ask',factId:q.id}))):[]));
   judgement.replaceChildren();
   if(legal.has('answer'))for(const value of TURTLE_VERDICTS){const b=button(verdictText[value],'mao-turtle__verdict',()=>void act({kind:'answer',verdict:value}));b.disabled=g.pendingVerdict!==null&&g.pendingVerdict!==value;judgement.append(b);}
   if(legal.has('judge'))judgement.append(button('猜对了','mao-turtle__verdict',()=>void act({kind:'judge',correct:true})),button('尚未猜中','mao-turtle__verdict',()=>void act({kind:'judge',correct:false})));
   more.hidden=finished;hint.hidden=!legal.has('hint');pass.hidden=!legal.has('pass');reveal.hidden=!legal.has('reveal');
   resume.hidden=finished||g.activeSeatId==='user';pause.hidden=finished;revealArmed=false;reveal.textContent='揭晓谜底';
 }
 function report(result){note.textContent=result.status==='model-unavailable'?'自由推理暂缺可用模型。可以继续尝试或揭晓谜底。':result.status==='yield'?'点击继续推理。':'';resume.hidden=result.status==='finished'||result.status==='user';}
 async function run(e,stamp){note.textContent='角色正在推理…';e.stamp=stamp;const result=await e.driver.runUntilUser();check(e,stamp);report(result);return result;}
 async function begin(){
   if(disposed||busy||!picker||start.disabled||active)return;
   const c=picker,ids=[...selected],moderator=host.value,puzzleId=puzzle.value,stamp=++epoch;busy=true;start.disabled=true;refresh.disabled=true;let e;
   try{
     if(!puzzles.some(p=>p.id===puzzleId)||moderator!=='user'&&!ids.includes(moderator.slice(5)))fail('TURTLE_PAGE_SETUP');
     const roomId=makeRoomId(),session=createBrowserRoomSession({win,spec:{roomId,gameId:'turtle'},rules:createTurtleRules({puzzleId}),expectedIdentity:{accountId:c.accountId,sessionId:c.sessionId}});
     e={roomId,session,driver:null,stamp,labels:new Map(c.roleLabels.filter(r=>ids.includes(r.id)).map(r=>['role:'+r.id,r.name]))};active=e;paused=false;
     e.driver=createTurtleTurnDriver({session,askRole,judgeRole,allowPlayerText,pace,onView:v=>render(e,v,e.stamp)});
     await session.refresh();check(e,stamp);
     async function send(action){const commit=await session.prepareUserAction();check(e,stamp);const v=await commit(action);check(e,stamp);return v;}
     for(const id of ids)await send({type:'invite',roleId:id});
     await send({type:'setModerator',seatId:moderator});
     const v=await send({type:'start'});clearPicker();setup.hidden=true;game.hidden=false;render(e,v,stamp);note.textContent='';
     if(v.game.activeSeatId!=='user')await run(e,stamp);
   }catch{if(!disposed&&active===e&&epoch===stamp){finish();note.textContent='无法开局，请重新读取角色。';}}
   finally{busy=false;refresh.disabled=false;}
 }
 async function act(move){
   const e=active,stamp=epoch;if(disposed||busy||paused||!view?.game.legalKinds.includes(move.kind)||!e)return false;busy=true;
   try{
     const old=view,verified=await e.session.viewUser();check(e,stamp);
     if(verified.revision!==old.revision||!verified.game.legalKinds.includes(move.kind))fail('TURTLE_PAGE_STALE');
     const commit=await e.session.prepareUserAction();check(e,stamp);const v=await commit({type:'move',move});check(e,stamp);
     render(e,v,stamp);note.textContent='';
     if(v.phase==='playing'&&v.game.activeSeatId!=='user')await run(e,stamp);return true;
   }catch(error){if(!disposed&&active===e&&epoch===stamp){
     if(e.session.status()==='disposed')finish();
     else if(['TURTLE_DUPLICATE_QUESTION','TURTLE_INCONSISTENT_ANSWER','TURTLE_INVALID_PLAYER_ACTION'].includes(error.message))note.textContent='问题已问过或当前操作不适用。';
     else{note.textContent='当前推理未完成，请继续或暂停。';resume.hidden=false;}
   }return false;}finally{busy=false;}
 }
 async function submitText(kind){const value=input.value.trim();if(!value)return;if(await act({kind,text:value}))input.value='';}
 async function advance(){
   const e=active;if(disposed||busy||!e)return;busy=true;paused=false;const stamp=epoch;e.stamp=stamp;
   try{const v=await e.session.viewUser();check(e,stamp);render(e,v,stamp);if(v.phase==='playing'&&v.game.activeSeatId!=='user')await run(e,stamp);else note.textContent='';}
   catch{if(!disposed&&active===e&&epoch===stamp){if(e.session.status()==='disposed')finish();else{note.textContent='暂时无法继续，请重试。';resume.hidden=false;}}}finally{busy=false;}
 }
 function suspend(){if(!active)return;epoch++;paused=true;active.driver.stop();wipe();resume.hidden=false;pause.hidden=true;note.textContent='本局已暂停，继续前重新验证账号。';}
 function finish(){const e=active;active=null;epoch++;paused=false;e?.driver?.dispose();e?.session.dispose();wipe();invalidate();game.hidden=true;setup.hidden=false;note.textContent='';refresh.disabled=false;}
 function listen(t,n,f){t.addEventListener(n,f);listeners.push(()=>t.removeEventListener(n,f));}
 function inactive(){if(active){if(!game.hidden)suspend();else finish();}else{invalidate();refresh.disabled=false;note.textContent='请重新读取角色。';}}
 listen(win,'offline',inactive);listen(win,'storage',inactive);listen(doc,'visibilitychange',()=>{if(doc.hidden)inactive();});
 function destroy(){if(disposed)return;disposed=true;finish();for(const remove of listeners.splice(0))remove();wrap.remove();}
 listen(win,'pagehide',destroy);void reload();
 return Object.freeze({reload,destroy});
}
