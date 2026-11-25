import {createBrowserRoomVerifier} from './account-room-context.js';
import {createLudoPageHost} from './ludo-page-host.js';

// Production mountable surface. Route activation is separate and must load
// the authenticated account scope before PhoneStorage. No fixture fallback.
export function mountLudoPage(root,{win=root?.ownerDocument?.defaultView,makeRoomId=()=>win.crypto.randomUUID(),pace=()=>{},discussion={},decideRole=null}={}){
  if(!root?.ownerDocument||!win?.document||typeof makeRoomId!=='function')throw Error('LUDO_PAGE_INVALID_ROOT');
  const doc=root.ownerDocument,verify=createBrowserRoomVerifier(win,{includeRoleLabels:true});
  const el=(tag,cls,text)=>{const n=doc.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const button=(text,cls,fn)=>{const n=el('button',cls,text);n.type='button';n.addEventListener('click',fn);return n;};
  const option=(value,text)=>{const n=el('option','',text);n.value=value;return n;};
  let disposed=false,epoch=0,picker=null,active=null,checking=null,starting=false,resuming=false,messageSequence=0;
  const listeners=[],selected=new Set();
  const wrap=el('main','mao-flight'),setup=el('section','mao-flight__setup'),game=el('section','mao-flight__game'),board=el('div','mao-flight__board');
  const note=el('p','mao-flight__status');note.setAttribute('role','status');
  const heading=el('h1','mao-flight__heading','飞行棋'),intro=el('p','mao-flight__intro','选好同行棋友，开始一局。');
  const count=el('select','mao-flight__count');count.setAttribute('aria-label','游戏人数');count.append(...[2,3,4].map(n=>option(String(n),n+'人')));count.value='4';
  const mode=el('select','mao-flight__mode');mode.setAttribute('aria-label','游戏玩法');mode.append(option('classic','经典航线'),option('adventure','奇遇快局'));mode.value='classic';
  const roles=el('div','mao-flight__roles'),rosterNote=el('p','mao-flight__roster-note');
  const refresh=button('读取角色','mao-flight__refresh',()=>void reload());
  const start=button('开始游戏','mao-flight__start',()=>void begin());start.disabled=true;
  setup.append(heading,intro,count,mode,el('p','mao-flight__label','邀请已有角色'),roles,rosterNote,refresh,start);
  const chat=el('details','mao-flight__chat'),list=el('div','mao-flight__messages');
  list.setAttribute('role','log');list.setAttribute('aria-live','polite');
  const reply=el('select','mao-flight__reply');reply.setAttribute('aria-label','回复对象');
  const input=el('input','mao-flight__input');input.maxLength=1000;input.placeholder='说点什么';input.setAttribute('aria-label','游戏发言');
  const chatNote=el('p','mao-flight__chat-note');chatNote.setAttribute('role','status');
  const send=button('发送','mao-flight__send',()=>void submit());
  const stop=button('停止生成','mao-flight__stop',()=>{host.stopChat();chatNote.textContent='已停止生成。';});
  const row=el('div','mao-flight__composer');row.append(input,send);
  chat.append(el('summary','','游戏聊天'),list,reply,row,stop,chatNote);
  const footer=el('footer','mao-flight__footer'),rules=el('details','mao-flight__rules'),ruleCopy=el('p','');
  rules.append(el('summary','','人数与玩法'),ruleCopy);
  const resume=button('继续本局','mao-flight__resume',()=>void resumeGame());resume.hidden=true;
  const end=button('结束本局','mao-flight__end',()=>{host.end();});
  footer.append(rules,resume,end);
  game.append(board,chat,footer);game.hidden=true;
  wrap.append(setup,game,note);root.replaceChildren(wrap);
  const label=id=>id==='user'?'我':id.startsWith('bot:')?'普通棋手 '+id.slice(4):active?.labels.get(id)??'角色';
  function renderMessages(messages){
    if(disposed||!active||game.hidden||chat.hidden)return;
    list.replaceChildren(...messages.map(m=>{
      const item=el('div','mao-flight__message');
      item.append(el('small','',label(m.sender.seatId)),el('p','',m.text));return item;
    }));
    list.scrollTop=list.scrollHeight;
  }
  function clearChat(){list.replaceChildren();reply.replaceChildren();input.value='';chatNote.textContent='';chat.open=false;ruleCopy.textContent='';}
  function resetPicker(){picker=null;selected.clear();roles.replaceChildren();rosterNote.textContent='';start.disabled=true;}
  function clearPrivate(){epoch++;checking?.abort();checking=null;resetPicker();clearChat();}
  function paused(){clearPrivate();chat.hidden=true;resume.hidden=false;note.textContent='本局已暂停，请验证账号后继续。';}
  function idle(){clearPrivate();active=null;game.hidden=true;setup.hidden=false;chat.hidden=true;resume.hidden=true;note.textContent='请重新读取角色后开始。';}
  const host=createLudoPageHost(board,{win,pace,decideRole,labelForSeat:label,discussion:{...discussion,onChange:renderMessages},onStatus(state){
    if(disposed)return;
    if(state==='paused'){paused();return;}
    if(state==='idle'){idle();return;}
    if(state==='yield'){resume.hidden=false;note.textContent='点击继续自动回合。';return;}
    if(state==='finished'){send.disabled=true;input.disabled=true;note.textContent='本局结束。';return;}
    if(state==='ready'){note.textContent='';}
  }});
  function syncSelection(){
    const max=Number(count.value)-1;
    while(selected.size>max)selected.delete([...selected].at(-1));
    for(const [id,box] of boxes){box.checked=selected.has(id);box.disabled=starting||(!box.checked&&selected.size>=max);}
    rosterNote.textContent=picker?'已选 '+selected.size+' 位角色，自动补齐 '+(max-selected.size)+' 位普通棋手。':'';
    start.disabled=!picker||starting||disposed;
  }
  const boxes=new Map();
  function showRoster(context){
    resetPicker();picker=context;boxes.clear();
    for(const role of context.roleLabels){
      const line=el('label','mao-flight__role'),box=el('input','');box.type='checkbox';boxes.set(role.id,box);
      box.addEventListener('change',()=>{if(picker!==context||starting)return;if(box.checked&&selected.size<Number(count.value)-1)selected.add(role.id);else selected.delete(role.id);syncSelection();});
      line.append(box,el('span','',role.name));roles.append(line);
    }
    if(!context.roleLabels.length)roles.append(el('p','mao-flight__empty','当前没有可邀请角色，可以和普通棋手玩。'));
    syncSelection();
  }
  async function reload(){
    if(disposed||active||starting)return;
    clearPrivate();boxes.clear();
    if(win.document.hidden||win.navigator?.onLine===false){note.textContent='当前无法验证账号。';return;}
    const stamp=epoch,ac=new AbortController();checking=ac;refresh.disabled=true;note.textContent='正在验证角色名单…';
    try{const context=await verify({signal:ac.signal});
      if(disposed||stamp!==epoch||ac.signal.aborted)return;
      showRoster(context);note.textContent='';
    }catch{if(!disposed&&stamp===epoch)note.textContent='账号或角色名单未通过验证，请重试。';}
    finally{if(checking===ac)checking=null;refresh.disabled=false;}
  }
  function showGame(view){
    active.seats=view.seats.map(s=>({...s}));setup.hidden=true;game.hidden=false;chat.hidden=false;
    reply.replaceChildren(option('','所有棋友'),...active.seats.filter(s=>s.kind!=='user').map(s=>option(s.seatId,label(s.seatId))));
    ruleCopy.textContent=active.count+'人 · '+(active.mode==='adventure'?'奇遇快局：两架飞机抵达获胜，可使用道具。':'经典航线：四架飞机抵达获胜，六点起飞。');
    input.disabled=send.disabled=view.phase==='finished';
    chatNote.textContent=discussion.generateRole||discussion.generateBot?'':'模型尚未接通，当前使用规则棋手。';
  }
  async function begin(){
    if(disposed||starting||!picker||active)return;
    const stamp=epoch,context=picker,ids=[...selected],n=Number(count.value),variant=mode.value;
    if(![2,3,4].includes(n)||ids.length>=n||!['classic','adventure'].includes(variant))return;
    starting=true;start.disabled=true;refresh.disabled=true;count.disabled=mode.disabled=true;
    active={labels:new Map(context.roleLabels.filter(s=>ids.includes(s.id)).map(s=>['role:'+s.id,s.name])),count:n,mode:variant,seats:[]};
    try{const view=await host.start({roomId:makeRoomId(),roleIds:ids,playerCount:n,mode:variant,expectedIdentity:{accountId:context.accountId,sessionId:context.sessionId}});
      if(disposed||stamp!==epoch||!active){host.end();return;}
      resetPicker();boxes.clear();showGame(view);note.textContent='';
    }catch{if(!disposed){host.end();note.textContent='未能开始游戏，请重新验证账号与角色。';}}
    finally{starting=false;refresh.disabled=false;count.disabled=mode.disabled=false;syncSelection();}
  }
  async function resumeGame(){
    if(disposed||!active||resuming)return;
    resuming=true;const stamp=epoch;resume.disabled=true;
    try{const result=await host.resume();if(disposed||stamp!==epoch||!active)return;
      resume.hidden=result.status!=='yield';showGame({seats:active.seats,phase:result.status==='finished'?'finished':'playing'});
      const messages=await host.readChat();if(!disposed&&stamp===epoch&&active)renderMessages(messages);
    }catch{if(!disposed&&stamp===epoch){chat.hidden=true;clearChat();note.textContent='本局暂时无法恢复，请重试或结束本局。';}}
    finally{resuming=false;resume.disabled=false;}
  }
  async function submit(){
    if(disposed||!active||chat.hidden||input.disabled||!input.value?.trim())return;
    const stamp=epoch,text=input.value,replyToSeatId=reply.value||null;input.value='';
    try{const result=await host.sendChat({messageId:String(++messageSequence),text,replyToSeatId});
      if(disposed||stamp!==epoch||!active)return;
      chatNote.textContent=result.reason==='MODEL_UNAVAILABLE'?'消息已发送，当前没有可用模型回复。':'';
    }catch{if(!disposed&&stamp===epoch&&active)chatNote.textContent='发言或回复未完成，请查看聊天记录。';}
  }
  count.addEventListener('change',syncSelection);
  input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();void submit();}});
  function listen(target,name,fn){target.addEventListener(name,fn);listeners.push(()=>target.removeEventListener(name,fn));}
  function invalidate(){if(!active){clearPrivate();boxes.clear();note.textContent='账号状态变化，请重新读取角色。';}}
  listen(win,'storage',invalidate);listen(win,'offline',invalidate);listen(doc,'visibilitychange',()=>{if(doc.hidden)invalidate();});
  function destroy(){if(disposed)return;disposed=true;clearPrivate();active=null;host.destroy();for(const remove of listeners.splice(0))remove();wrap.remove();}
  listen(win,'pagehide',destroy);
  void reload();
  return Object.freeze({reload,destroy});
}
