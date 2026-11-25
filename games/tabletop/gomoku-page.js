import {createBrowserRoomVerifier} from './account-room-context.js';
import {createGomokuPageHost} from './gomoku-page-host.js';

export function mountGomokuPage(root,{win=root?.ownerDocument?.defaultView,makeRoomId=()=>win.crypto.randomUUID(),decideRole=null,pace=null,discussion={}}={}){
  if(!root?.ownerDocument||!win?.document||typeof makeRoomId!=='function')throw Error('GOMOKU_INVALID_PAGE');
  const doc=root.ownerDocument,verify=createBrowserRoomVerifier(win,{includeRoleLabels:true});
  const el=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const btn=(text,cls,fn)=>{const n=el('button',cls,text);n.type='button';n.addEventListener('click',fn);return n;};
  const select=(cls,label,items)=>{const n=el('select',cls);n.setAttribute('aria-label',label);for(const [value,text] of items){const o=el('option','',text);o.value=value;n.append(o);}n.value=items[0][0];return n;};
  let picker=null,active=null,epoch=0,checking=null,starting=false,advancing=false,disposed=false,stopped=false,auto=false,autoTimer=null,autoRemaining=0;
  const listeners=[],wrap=el('main','mao-gomoku'),setup=el('section','mao-gomoku__setup'),game=el('section','mao-gomoku__game'),board=el('div','mao-gomoku__board'),note=el('p','mao-gomoku__note');
  note.setAttribute('role','status');game.hidden=true;
  const mode=select('mao-gomoku__mode','对弈方式',[['play','与角色对弈'],['watch','观看角色对弈']]);
  const color=select('mao-gomoku__color','执棋颜色',[['black','我执黑'],['white','我执白']]);
  const difficulty=select('mao-gomoku__difficulty','难度',[['normal','普通'],['easy','简单'],['hard','困难']]);
  const a=select('mao-gomoku__first','第一位棋友',[['','选择棋友']]),b=select('mao-gomoku__second','第二位棋友',[['','选择棋友']]);b.hidden=true;
  const observers=el('details','mao-gomoku__observers'),observerList=el('div','mao-gomoku__observer-list');
  observers.append(el('summary','','旁观棋友'),observerList);
  const refresh=btn('读取角色','mao-gomoku__refresh',()=>void reload()),start=btn('开始对局','mao-gomoku__start',()=>void begin());start.disabled=true;
  setup.append(el('h1','mao-gomoku__heading','五子棋'),mode,color,a,b,difficulty,observers,refresh,start);
  const meta=el('p','mao-gomoku__meta'),footer=el('footer','mao-gomoku__footer');
  const rules=el('details','mao-gomoku__rules');rules.append(el('summary','','玩法'),el('p','','黑先，五连及以上获胜。满盘无胜者为和棋。'));
  const next=btn('继续对局','mao-gomoku__next',()=>void advance()),pause=btn('暂停','mao-gomoku__pause',()=>{stopped=true;host.pause();}),end=btn('结束本局','mao-gomoku__end',()=>host.end());
  const autoButton=btn('连续观战','mao-gomoku__auto',()=>{if(auto){stopAuto();if(!advancing)next.hidden=false;return;}if(!active?.watch||stopped||active.view?.phase!=='playing')return;auto=true;autoRemaining=32;autoButton.textContent='停止连播';scheduleAuto();});autoButton.hidden=true;
  function stopAuto(){auto=false;autoRemaining=0;if(autoTimer!==null){clearTimeout(autoTimer);autoTimer=null;}autoButton.textContent='连续观战';}
  function scheduleAuto(){if(!auto||autoTimer!==null||advancing||disposed||stopped||!active?.watch||active.view?.phase!=='playing')return;if(autoRemaining<=0){stopAuto();return;}autoTimer=setTimeout(()=>{autoTimer=null;if(auto&&!stopped&&!disposed)void advance();},350);}
  async function gamePace(v,signal){if(pace)return pace(v,signal);if(!auto)return;await new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,280);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});}
  const chat=el('details','mao-gomoku__chat'),messages=el('div','mao-gomoku__messages'),target=select('mao-gomoku__target','发言对象',[['','所有棋友']]),input=el('input','mao-gomoku__input');
  messages.setAttribute('role','log');messages.setAttribute('aria-live','polite');input.maxLength=1000;input.placeholder='说点什么';input.setAttribute('aria-label','游戏发言');
  const chatNote=el('p','mao-gomoku__chat-note'),row=el('div','mao-gomoku__composer'),send=btn('发送','mao-gomoku__send',()=>void submit()),stop=btn('停止生成','mao-gomoku__stop',()=>{host.stopChat();chatNote.textContent='已停止生成。';});
  row.append(input,send);chat.append(el('summary','','游戏聊天'),messages,target,row,stop,chatNote);
  let msgSeq=0;
  function clearChat(){messages.replaceChildren();target.replaceChildren();input.value='';chatNote.textContent='';chat.open=false;chat.hidden=true;}
  function renderMessages(items){if(!active||chat.hidden||disposed)return;messages.replaceChildren(...items.map(m=>{const n=el('div','mao-gomoku__message');n.append(el('small','',label(m.sender.seatId)),el('p','',m.text));return n;}));messages.scrollTop=messages.scrollHeight;}
  function showChat(v){chat.hidden=false;target.replaceChildren();const o=el('option','','所有棋友');o.value='';target.append(o);target.value='';for(const s of v.seats.filter(s=>s.kind==='role')){const o=el('option','',label(s.seatId));o.value=s.seatId;target.append(o);}input.disabled=send.disabled=v.phase==='finished';chatNote.textContent=discussion.generateRole?'':'当前未接入聊天模型。';}
  async function submit(){if(disposed||!active||chat.hidden||input.disabled||!input.value.trim())return;const stamp=epoch,text=input.value,replyToSeatId=target.value||null;input.value='';try{const result=await host.sendChat({messageId:typeof win.crypto?.randomUUID==='function'?win.crypto.randomUUID():String(++msgSeq),text,replyToSeatId});if(!disposed&&active&&stamp===epoch)chatNote.textContent=result.reason==='MODEL_UNAVAILABLE'?'已发送，当前没有可用模型。':result.reason==='SPEECH_LIMIT'?'已达到本局生成次数上限。':'';}catch{if(!disposed&&active&&stamp===epoch)chatNote.textContent='发言未完成，请查看记录。';}}
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();void submit();}});
  next.hidden=true;footer.append(rules,autoButton,next,pause,end);game.append(board,meta,chat,footer);wrap.append(setup,game,note);root.replaceChildren(wrap);
  const label=id=>id==='user'?'我':active?.labels.get(id)??'棋友';
  const selectedObservers=new Set(),boxes=new Map();
  function clearPicker(){picker=null;selectedObservers.clear();boxes.clear();for(const s of [a,b]){const o=el('option','','选择棋友');o.value='';s.replaceChildren(o);s.value='';}observerList.replaceChildren();start.disabled=true;}
  function invalidate(){epoch++;checking?.abort();checking=null;clearPicker();}
  function sync(){
    const watch=mode.value==='watch';b.hidden=!watch;color.hidden=watch;
    const needed=watch?2:1,ids=[a.value,...(watch?[b.value]:[])],valid=picker&&ids.length===needed&&ids.every(id=>picker.roleIds.includes(id))&&new Set(ids).size===ids.length;
    for(const id of ids)selectedObservers.delete(id);
    const max=watch?5:6;while(selectedObservers.size>max)selectedObservers.delete([...selectedObservers].at(-1));
    for(const [id,box] of boxes){box.checked=selectedObservers.has(id);box.disabled=starting||ids.includes(id)||(!box.checked&&selectedObservers.size>=max);}
    start.disabled=!valid||starting||disposed;
  }
  function showRoster(c){
    clearPicker();picker=c;
    for(const role of c.roleLabels){for(const s of [a,b]){const o=el('option','',role.name);o.value=role.id;s.append(o);}
      const line=el('label','mao-gomoku__observer'),box=el('input','');box.type='checkbox';boxes.set(role.id,box);
      box.addEventListener('change',()=>{if(picker!==c||starting)return;if(box.checked)selectedObservers.add(role.id);else selectedObservers.delete(role.id);sync();});
      line.append(box,el('span','',role.name));observerList.append(line);
    }
    sync();
  }
  const host=createGomokuPageHost(board,{win,labelForSeat:label,decideRole,pace:gamePace,discussion:{...discussion,onChange:renderMessages},onView:v=>{
    if(!active)return;
    active.view=v;if(v.phase==='finished')input.disabled=send.disabled=true;
    meta.textContent=(active.watch?'观战':'对弈')+' · '+(active.difficulty==='hard'?'困难':active.difficulty==='easy'?'简单':'普通')+' · '+v.seats.filter(s=>s.mode==='observer').length+'位旁观';
  },onDecision:d=>{if(active)meta.textContent=meta.textContent.split(' · 策略：')[0]+' · 策略：'+(d.source==='model'?'模型':'本地');},onStatus:s=>{
    if(disposed)return;
    if(s==='idle'){stopAuto();autoButton.hidden=true;invalidate();clearChat();active=null;game.hidden=true;setup.hidden=false;next.hidden=true;note.textContent='';return;}
    if(s==='paused'){stopAuto();autoButton.hidden=true;invalidate();clearChat();stopped=true;next.hidden=false;pause.hidden=true;meta.textContent='';note.textContent='本局暂停，继续前将重新验证账号。';return;}
    if(s==='finished'){stopAuto();autoButton.hidden=true;}next.hidden=s!=='yield'||auto;pause.hidden=s==='finished';note.textContent=s==='thinking'?'棋友正在思考…':s==='finished'?'本局结束。':'';
  }});
  async function reload(){
    if(disposed||active||starting)return;
    invalidate();const stamp=epoch,ac=new AbortController();checking=ac;refresh.disabled=true;note.textContent='读取角色…';
    try{if(win.document.hidden||win.navigator?.onLine===false)throw Error('inactive');const c=await verify({signal:ac.signal});if(!disposed&&epoch===stamp&&!ac.signal.aborted){showRoster(c);note.textContent=c.roleIds.length?'':'暂无可邀请角色。';}}
    catch{if(!disposed&&epoch===stamp)note.textContent='账号或角色名单验证失败。';}
    finally{if(checking===ac){checking=null;refresh.disabled=false;}}
  }
  async function begin(){
    if(disposed||starting||!picker||start.disabled)return;
    const c=picker,stamp=epoch,watch=mode.value==='watch',opponents=[a.value,...(watch?[b.value]:[])],obs=[...selectedObservers],level=difficulty.value;
    starting=true;start.disabled=refresh.disabled=true;
    active={watch,difficulty:level,labels:new Map(c.roleLabels.map(r=>['role:'+r.id,r.name]))};stopped=false;
    try{const v=await host.start({roomId:makeRoomId(),opponents,observers:obs,watch,blackFirst:color.value==='black',difficulty:level,expectedIdentity:{accountId:c.accountId,sessionId:c.sessionId}});
      if(disposed||epoch!==stamp||!active){host.end();return;}
      clearPicker();setup.hidden=true;game.hidden=false;showChat(v);autoButton.hidden=!watch;
      if(v.turnSeatId!=='user')void advance();
    }catch{if(!disposed){host.end();note.textContent='无法开局，请重新读取角色。';}}
    finally{starting=false;refresh.disabled=false;sync();}
  }
  async function advance(){
    if(disposed||!active||advancing)return;
    advancing=true;stopped=false;next.disabled=true;
    try{const result=await host.resume();if(!disposed&&active&&!stopped){if(auto)autoRemaining-=result.actions;next.hidden=result.status!=='yield'||auto;if(chat.hidden&&active.view){showChat(active.view);const stamp=epoch;const items=await host.readChat();if(!disposed&&active&&stamp===epoch)renderMessages(items);}}}
    catch{if(!disposed&&active)note.textContent='暂时无法继续，请重新验证或结束本局。';}
    finally{advancing=false;next.disabled=false;if(!disposed&&active?.watch&&!stopped&&active.view?.phase==='playing'){autoButton.hidden=false;if(auto&&autoRemaining<=0){stopAuto();next.hidden=false;}else scheduleAuto();}}
  }
  for(const s of [mode,a,b])s.addEventListener('change',sync);
  function listen(t,n,f){t.addEventListener(n,f);listeners.push(()=>t.removeEventListener(n,f));}
  function inactive(){if(!active){invalidate();refresh.disabled=false;note.textContent='账号状态变化，请重新读取角色。';}}
  listen(win,'storage',inactive);listen(win,'offline',inactive);listen(doc,'visibilitychange',()=>{if(doc.hidden)inactive();});
  function destroy(){if(disposed)return;disposed=true;stopAuto();invalidate();clearChat();active=null;host.destroy();for(const remove of listeners.splice(0))remove();wrap.remove();}
  listen(win,'pagehide',destroy);void reload();
  async function restoreMatch(saved){
    if(disposed||active||starting||advancing||!picker)throw Error('GOMOKU_PAGE_BUSY');
    if(saved?.board?.gameId!=='gomoku'||!Array.isArray(saved.board.seats))throw Error('GOMOKU_INVALID_MATCH');
    const copy=JSON.parse(JSON.stringify(saved)),c=picker,stamp=epoch;
    const watch=copy.board.seats.find(s=>s.seatId==='user')?.mode==='observer';
    starting=true;start.disabled=refresh.disabled=true;stopped=false;
    active={watch,difficulty:copy.difficulty,labels:new Map(c.roleLabels.map(r=>['role:'+r.id,r.name]))};
    try{
      const v=await host.restoreMatch(copy,{expectedIdentity:{accountId:c.accountId,sessionId:c.sessionId}});
      if(disposed||stamp!==epoch||!active)throw Error('GOMOKU_PAGE_STALE');
      clearPicker();setup.hidden=true;game.hidden=false;showChat(v);autoButton.hidden=!watch||v.phase==='finished';next.hidden=v.phase==='finished'||v.turnSeatId==='user';
      const items=await host.readChat();if(disposed||stamp!==epoch||!active)throw Error('GOMOKU_PAGE_STALE');renderMessages(items);return v;
    }catch(error){host.end();throw error;}
    finally{starting=false;refresh.disabled=false;sync();}
  }
  return Object.freeze({reload,destroy,saveMatch:()=>host.saveMatch(),restoreMatch,archiveMatch:j=>host.archiveMatch(j)});
}
