// Owner-only management UI; every operation is mediated by a fresh scoped
// verifier in the containing hall. Never give this adapter to player models.
export function mountGameJournal(root,{roles,run,onBack=()=>{}}={}){
 if(!root?.ownerDocument||!Array.isArray(roles)||typeof run!=='function')throw Error('JOURNAL_PAGE_INVALID');
 const doc=root.ownerDocument,el=(tag,cls='',text)=>{const n=doc.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const btn=(text,cls,fn)=>{const n=el('button',cls,text);n.type='button';n.addEventListener('click',fn);return n;};
 const opt=(value,text)=>{const n=el('option','',text);n.value=value;return n;};
 const names={ludo:'飞行棋',gomoku:'五子棋',turtle:'海龟汤',werewolf:'狼人杀'};
 const outcomes={win:'获胜',loss:'未获胜',draw:'和局',hosted:'主持',solved:'猜中谜底',participated:'参与推理',observed:'观战'};
 const labels=new Map(roles.map(r=>['role:'+r.id,r.name])),label=id=>id==='user'?'我':labels.get(id)??(id?.startsWith('bot:')?'棋友 '+id.slice(4):'角色');
 let disposed=false,epoch=0,busy=false,tab='history',offset=0;
 const wrap=el('section','mao-table-journal'),top=el('header','mao-table-journal__top'),title=el('h2','','游戏手账'),back=btn('返回','mao-table-link',()=>onBack());top.append(title,back);
 const nav=el('div','mao-table-journal__nav'),historyTab=btn('历史对局','mao-table-link',()=>switchTab('history')),memoryTab=btn('角色记忆','mao-table-link',()=>switchTab('memory'));nav.append(historyTab,memoryTab);
 const filters=el('div','mao-table-journal__filters'),role=el('select','mao-table-journal__role'),game=el('select','mao-table-journal__game');
 role.setAttribute('aria-label','所属角色');role.append(...roles.map(r=>opt(r.id,r.name)));role.value=roles[0]?.id??'';
 game.setAttribute('aria-label','游戏筛选');game.append(opt('','全部游戏'),...Object.entries(names).map(([id,name])=>opt(id,name)));game.value='';filters.append(role,game);
 const content=el('div','mao-table-journal__content'),note=el('p','mao-table-note');note.setAttribute('role','status');
 const pageNav=el('div','mao-table-journal__pagination'),prev=btn('上一页','mao-table-link',()=>{offset=Math.max(0,offset-20);void refresh();}),next=btn('下一页','mao-table-link',()=>{offset+=20;void refresh();});pageNav.append(prev,next);
 wrap.append(top,nav,filters,content,pageNav,note);root.replaceChildren(wrap);
 function switchTab(value){if(disposed||busy)return;tab=value;offset=0;void refresh();}
 for(const s of [role,game])s.addEventListener('change',()=>{offset=0;void refresh();});
 function setNote(text){if(!disposed)note.textContent=text;}
 function drawHistory(items){
   if(!items.length)content.append(el('p','mao-table-note','暂无已归档的对局。'));
   for(const r of items){
     const line=el('article','mao-table-journal__row'),heading=el('div','mao-table-journal__line'),result=r.gameId==='werewolf'?(r.winningTeam==='wolf'?'狼人阵营获胜':r.winningTeam==='village'?'好人阵营获胜':'和局'):r.gameId==='turtle'?(r.winnerSeatId?label(r.winnerSeatId)+'猜中谜底':'谜底已揭晓'):(r.winnerSeatId?label(r.winnerSeatId)+'获胜':'和局');
     heading.append(el('strong','',names[r.gameId]??'游戏'),el('span','',result));
     line.append(heading,el('p','mao-table-note',r.players.map(p=>label(p.seatId)).join('、')+(r.title?' · '+r.title:'')+(Number.isInteger(r.moves)?' · '+r.moves+'步':'')));
     const detail=el('details','mao-table-journal__fragment'),summary=el('summary','','查看公开交流'),body=el('div','mao-table-journal__review');detail.append(summary,body);
     let start=0,loading=false,loaded=false;
     async function showReview(){
       if(disposed||loading)return;loading=true;const stamp=epoch;
       try{
         const data=await run(j=>j.review({gameId:r.gameId,roomId:r.roomId,offset:start,limit:50}));
         if(disposed||stamp!==epoch)return;body.replaceChildren();
         if(!data.items.length)body.append(el('p','mao-table-note','暂无公开交流记录。'));
         const verdicts={yes:'是',no:'否',irrelevant:'无关',unclear:'无法确定'};
         for(const m of data.items){
           let value=m.text;
           if(m.kind==='answer')value=verdicts[m.verdict]??'已回答';
           if(m.kind==='judge')value=m.correct?'猜中谜底':'尚未猜中';
           if(m.kind==='hint')value='使用了提示';
           if(m.kind==='pass')value='跳过';
           if(m.kind==='dawn'||m.kind==='vote-result')value=(m.kind==='dawn'?'新一轮开始':'投票结束')+' · '+(m.outSeatId?label(m.outSeatId)+'出局':'无人出局');
           body.append(el('p','mao-table-journal__text',(m.round?'第 '+m.round+' 轮 · ':'')+(m.seatId?label(m.seatId)+'：':'')+(value??'公开事件')));
         }
         if(start>0)body.append(btn('上一页交流','mao-table-link',()=>{start=Math.max(0,start-50);void showReview();}));
         if(start+50<data.total)body.append(btn('下一页交流','mao-table-link',()=>{start+=50;void showReview();}));
         loaded=true;
       }catch{if(!disposed&&stamp===epoch)body.replaceChildren(el('p','mao-table-note','暂时无法读取，请关闭后重试。'));}
       finally{loading=false;}
     }
     detail.addEventListener('toggle',()=>{if(detail.open&&!loaded)void showReview();});line.append(detail);content.append(line);
   }
 }
 function drawMemory(items){
   if(!items.length)content.append(el('p','mao-table-note','该角色暂无游戏记忆。'));
   for(const item of items){
     const f=item.fragment,block=el('details','mao-table-journal__fragment'),summary=el('summary','',names[f.gameId]+' · '+(f.kind==='result'?outcomes[f.outcome]??'对局记录':'公开发言')+(item.enabled?'':' · 已停用'));
     const body=el('p','mao-table-journal__text',f.text??(outcomes[f.outcome]??'对局记录'));
     const recall=btn(item.enabled?'停用记忆':'恢复记忆','mao-table-link',()=>void change(j=>j.setRecall({fragmentId:f.id,enabled:!item.enabled})));
     block.append(summary,body,recall);
     const permissions=el('details','mao-table-journal__permissions');permissions.append(el('summary','','授权管理'));
     const target=el('select',''),channel=el('select','');target.setAttribute('aria-label','授权对象');channel.setAttribute('aria-label','读取场景');
     target.append(...roles.map(r=>opt(r.id,r.name)));target.value=f.roleId;channel.append(opt('daily','日常聊天'),opt('game','其他角色的游戏'));channel.value='daily';
     const allow=btn('授权读取','mao-table-link',()=>{if(!item.enabled)return;void change(j=>j.permit({fragmentId:f.id,targetRoleId:target.value,channel:channel.value,allowed:true}));});allow.disabled=!item.enabled;
     permissions.append(target,channel,allow);
     for(const g of item.grants){const line=el('div','mao-table-journal__grant');line.append(el('span','',label('role:'+g.targetRoleId)+' · '+(g.channel==='daily'?'日常聊天':'游戏')),btn('撤回','mao-table-link',()=>void change(j=>j.permit({fragmentId:f.id,...g,allowed:false}))));permissions.append(line);}
     block.append(permissions);content.append(block);
   }
 }
 async function change(op){
   if(disposed||busy)return;busy=true;const stamp=++epoch;
   try{await run(op);if(!disposed&&stamp===epoch){busy=false;await refresh();setNote('已更新本次会话的记忆权限。');}}
   catch{if(!disposed&&stamp===epoch)setNote('权限更新未完成，请重新验证。');}
   finally{busy=false;}
 }
 async function refresh(){
   if(disposed)return;const stamp=++epoch;content.replaceChildren();setNote('');
   role.hidden=tab==='history';historyTab.setAttribute('aria-pressed',String(tab==='history'));memoryTab.setAttribute('aria-pressed',String(tab==='memory'));
   const selected=role.value,gid=game.value||null,currentTab=tab;
   try{
     const data=await run(j=>{if(currentTab==='history'){const rows=j.list().filter(r=>!gid||r.gameId===gid).reverse();return {items:rows.slice(offset,offset+20),total:rows.length};}
       if(!selected)return {items:[],total:0};return j.manage({roleId:selected,gameId:gid,limit:20,offset});});
     if(disposed||stamp!==epoch)return;
     if(currentTab==='history')drawHistory(data.items);else drawMemory(data.items);
     prev.hidden=offset===0;next.hidden=offset+20>=data.total;
   }catch{if(!disposed&&stamp===epoch){content.replaceChildren();prev.hidden=next.hidden=true;setNote('暂时无法读取手账，请返回后重新验证。');}}
 }
 function destroy(){if(disposed)return;disposed=true;epoch++;root.replaceChildren();}
 void refresh();return Object.freeze({destroy,refresh});
}
