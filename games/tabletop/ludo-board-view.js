import {buildLudoBoard} from './ludo-board.js';

// Mountable user board; the host owns verified session, dispatch and rendering.
// Include ludo-board.css in the host. No account, storage, network or route access.
export function createLudoBoardView(root,{onMove,labelForSeat}={}){
  if(!root?.ownerDocument||typeof onMove!=='function')throw Error('LUDO_INVALID_BOARD_HOST');
  const doc=root.ownerDocument;
  let model=null,pending=false,destroyed=false,accepted=null,errorText='';
  let actionButtons=[],chips=new Map(),dieNode=null,animations=[];
  function element(tag,cls,text){const e=doc.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
  const host=element('section','mao-ludo');host.setAttribute('aria-label','飞行棋');root.replaceChildren(host);
  const title=element('h2','mao-ludo__title','飞行棋'),status=element('p','mao-ludo__status'),eventLine=element('p','mao-ludo__event'),roster=element('div','mao-ludo__roster'),board=element('div','mao-ludo__board'),controls=element('div','mao-ludo__controls'),notice=element('p','mao-ludo__notice');
  status.setAttribute('aria-live','polite');notice.setAttribute('role','status');board.setAttribute('aria-label','游戏棋盘');host.append(title,status,roster,board,controls,eventLine,notice);
  const label=id=>{const p=model.players.find(p=>p.seatId===id);return id==='user'?'我':String(labelForSeat?.(id)??p?.label??'玩家');};
  const key=m=>JSON.stringify([m.roomId,m.revision]);
  const locked=()=>pending||accepted===key(model);
  function button(text,cls,action,disabled=false){const b=element('button',cls,text);b.type='button';b.disabled=disabled;actionButtons.push(b);const at=key(model);b.addEventListener('click',()=>{if(!destroyed&&model&&key(model)===at)void submit(action);});return b;}
  async function submit(move){
    if(destroyed||!model||locked()||!(move.kind==='roll'?model.canRoll:model.choices.includes(move.plane)))return;
    const sent=model;pending=true;errorText='';syncControls();
    try{await onMove({roomId:sent.roomId,revision:sent.revision,seatId:'user',move:{...move}});if(!destroyed)accepted=key(sent);}
    catch{if(!destroyed&&key(model)===key(sent))errorText='操作未完成，请重试。';}
    finally{pending=false;if(!destroyed)syncControls();}
  }
  function syncControls(){
    for(const b of actionButtons)b.disabled=locked();
    notice.textContent=errorText||(pending?'操作处理中…':'');
  }
  const pieceKey=p=>JSON.stringify([p.seatId,p.plane]);
  function stopAnimations(){for(const a of animations.splice(0))a?.cancel?.();}
  function play(node,frames,duration){
    if(typeof node?.animate!=='function')return;
    try{animations.push(node.animate(frames,{duration,easing:'ease-out'}));}catch{/* Presentation only; committed state remains visible. */}
  }
  function eventText(last){
    if(!last)return '本局已开始。';
    const who=label(last.seatId);
    if(last.kind==='roll')return who+' 掷出 '+last.die+' 点'+(last.skipped?'，没有可移动的飞机，跳过本回合。':'。');
    if(last.kind!=='move')return '';
    const effects=Array.isArray(last.effects)?last.effects:[];
    const terms={launch:'起飞',jump:'同色跳格',flight:'飞行捷径',bounce:'终点反弹',finish:'抵达终点'};
    const details=effects.filter(e=>Object.hasOwn(terms,e)).map(e=>terms[e]);
    if(last.captures?.length)details.push('撞回 '+last.captures.length+' 架对手机');
    return who+' 的 '+(last.plane+1)+' 号飞机'+(details.length?'：'+details.join('、'):'完成移动')+'。';
  }
  function draw(){
    actionButtons=[];chips=new Map();
    const b=model;const busy=locked();
    status.textContent=b.phase==='finished'?`${label(b.winners[0])} 获胜`:b.turnSeatId==='user'?(b.canRoll?'轮到我掷骰':'选择要移动的飞机'):`轮到${label(b.turnSeatId)}`;
    roster.replaceChildren(...b.players.map(p=>{
      const active=b.phase==='playing'&&b.turnSeatId===p.seatId;
      const item=element('span','mao-ludo__player mao-ludo__slot-'+p.slot+(active?' mao-ludo__active':''),p.label+' · '+label(p.seatId)+' '+p.finished+'/4');
      if(active)item.setAttribute('aria-current','true');
      return item;
    }));
    eventLine.textContent=eventText(b.last);
    const groups=new Map();for(const p of b.pieces){const group=groups.get(p.cellKey)??[];group.push(p);groups.set(p.cellKey,group);}
    board.replaceChildren(...b.cells.map(c=>{
      const tile=element('div',`mao-ludo__cell mao-ludo__${c.zone} mao-ludo__slot-${c.slot}`);tile.style.gridColumn=String(c.x+1);tile.style.gridRow=String(c.y+1);
      if(c.zone==='track'&&c.square%13===0)tile.classList.add('mao-ludo__start');
      const pieces=groups.get(`${c.x}:${c.y}`)??[];
      if(pieces.length>1)tile.classList.add('mao-ludo__stack');
      if(!pieces.length){tile.setAttribute('aria-hidden','true');return tile;}
      for(const p of pieces){const text=`${b.players.find(x=>x.slot===p.slot).label}${p.plane+1}`,cls=`mao-ludo__piece mao-ludo__slot-${p.slot}`;
        const chip=p.selectable?button(text,cls,{kind:'choose',plane:p.plane},busy):element('span',cls,text);chip.setAttribute('aria-label',`${label(p.seatId)}的${p.plane+1}号飞机`);chips.set(pieceKey(p),chip);tile.append(chip);}
      return tile;
    }));
    dieNode=element('span','mao-ludo__die',b.die===null?'—':String(b.die));dieNode.setAttribute('aria-label',b.die===null?'尚未掷骰':'骰子 '+b.die+' 点');controls.replaceChildren(dieNode);
    if(b.canRoll)controls.append(button('掷骰子','mao-ludo__action',{kind:'roll'},busy));
    for(const p of b.choices)controls.append(button(`${p+1}号飞机`,'mao-ludo__action',{kind:'choose',plane:p},busy));
    syncControls();
  }
  function render(view){
    if(destroyed)throw Error('LUDO_BOARD_DISPOSED');
    if(view?.selfSeatId!=='user')throw Error('LUDO_BOARD_USER_ONLY');
    const next=buildLudoBoard(view),before=model;
    // Each mounted board belongs to one room. Delayed render callbacks may
    // arrive out of order; never replace a newer committed view with an old one.
    if(before&&next.roomId!==before.roomId)throw Error('LUDO_BOARD_ROOM_CHANGED');
    if(before&&next.revision<before.revision)return;
    const transition=before&&before.roomId===next.roomId&&next.revision===before.revision+1;
    const motion=transition&&!doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    stopAnimations();
    const positions=new Map();
    if(motion&&next.last?.kind==='move'){
      const oldPieces=new Map(before.pieces.map(p=>[pieceKey(p),p]));
      for(const p of next.pieces){
        const k=pieceKey(p),old=oldPieces.get(k),node=chips.get(k);
        if(old&&old.cellKey!==p.cellKey&&typeof node?.getBoundingClientRect==='function')positions.set(k,node.getBoundingClientRect());
      }
    }
    model=next;errorText='';draw();
    if(motion&&next.last?.kind==='roll')play(dieNode,[{transform:'scale(.82)',opacity:.55},{transform:'scale(1)',opacity:1}],200);
    for(const [k,old] of positions){
      const node=chips.get(k);if(typeof node?.getBoundingClientRect!=='function')continue;
      const rect=node.getBoundingClientRect(),x=old.left-rect.left,y=old.top-rect.top;
      if(Number.isFinite(x)&&Number.isFinite(y)&&(x||y))play(node,[{transform:'translate('+x+'px,'+y+'px)'},{transform:'translate(0,0)'}],240);
    }
  }
  return Object.freeze({render,destroy(){destroyed=true;stopAnimations();model=null;host.remove();}});
}
