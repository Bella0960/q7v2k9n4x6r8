/* MAOMAO group memory event bridge.
 * Only confirmed PUBLIC game/chain events enter existing MemoryRecall storage.
 * Private game cards, private chats and other role's memories are never inputs.
 */
(function (root) {
  'use strict';
  if (root.GroupMemoryEvents) return;
  var KEY='phone_group_memory_public_events_v1_';
  function id(value) { return String(value==null?'':value).trim(); }
  function valid(value) { return /^[a-zA-Z0-9_-]{1,90}$/.test(id(value)); }
  function fail(code,message) { return {ok:false,code:code,message:message}; }
  function storageOf(req) { return req && req.storage || root.localStorage; }
  function ledger(storage,gid) {
    try {
      var raw=storage.getItem(KEY+gid);
      if(!raw)return [];
      var data=JSON.parse(raw);
      return Array.isArray(data)?data:null;
    } catch(e){ return null; }
  }
  function persist(storage,gid,items) {
    try {
      var value=JSON.stringify(items.slice(-100));
      storage.setItem(KEY+gid,value);
      return storage.getItem(KEY+gid)===value;
    } catch(e){return false;}
  }
  function storePublic(req, event) {
    var gid=id(event.groupId), source=id(event.sourceId), storage=storageOf(req);
    if(!valid(gid)||!source||source.length>180)return fail('INVALID_EVENT','群事件编号无效');
    var previous=ledger(storage,gid);
    if(!previous)return fail('CORRUPT_LEDGER','群记忆索引异常，已停止写入');
    var eid=event.kind+':'+source;
    if(previous.some(function (e){return e && e.eventId===eid;}))
      return {ok:true,duplicate:true};
    if(!root.MemoryRecall||typeof root.MemoryRecall.upsertMemory!=='function'||
      typeof root.MemoryRecall.getMemories!=='function')
      return fail('MEMORY_UNAVAILABLE','原记忆空间暂不可用');
    var record=root.MemoryRecall.upsertMemory(gid,{
      content:event.summary,category:'plot',status:'fixed',importance:4,
      source:event.kind==='game-finished'?'group_game_public':'group_chain_public'
    });
    if(!record||!record.ok)return fail('MEMORY_SAVE_FAILED','群事件没有保存为长期记忆');
    var check=root.MemoryRecall.getMemories(gid);
    if(!Array.isArray(check)||!check.some(function (x) {
      return x && record.memory && String(x.id)===String(record.memory.id);
    }))return fail('MEMORY_NOT_VERIFIED','无法确认群记忆写入');
    var snapshot={eventId:eid,kind:event.kind,sourceId:source,
      createdAt:Number(event.createdAt)||Date.now(),visibility:'public',
      memoryId:String(record.memory.id)};
    if(!persist(storage,gid,previous.concat([snapshot])))
      return fail('LEDGER_SAVE_FAILED','群记忆已写入，但事件索引未确认；可重试');
    return {ok:true,duplicate:!!record.duplicate,event:snapshot};
  }
  function recordChainClosure(req){
    req=req||{};
    var g=req.group, m=req.message;
    if(!g||!m||m.type!=='group_chain'||!m.chain||m.chain.closed!==true)
      return fail('NOT_CLOSED','只有已完成的群接龙才能入长期记忆');
    var entries=Array.isArray(m.chain.entries)?m.chain.entries.filter(function(x){
      return x&&id(x.memberId)&&id(x.text);
    }):[];
    if(!entries.length)return fail('EMPTY_CHAIN','空接龙不生成事件');
    var title=id(m.chain.title).slice(0,65), mid=id(m.mid);
    if(!title||!mid)return fail('INVALID_EVENT','接龙缺少已保存的主题或消息编号');
    var people=Object.create(null);
    entries.forEach(function(e){people[id(e.memberId)]=true;});
    return storePublic(req,{groupId:id(g.id),kind:'chain-finished',sourceId:mid,
      createdAt:Number(m.time)||Date.now(),summary:
        '群聊完成接龙「'+title+'」，'+Object.keys(people).length+'位成员参与，共接了'+entries.length+'条。'});
  }
  function recordGameClosure(req){
    req=req||{};
    var session=req.session;
    if(!session||session.status!=='finished'||session.gameId!=='mystery'||
      !valid(session.groupId)||!valid(session.sessionId)||!valid(session.revealedRoleId)||
      !Array.isArray(session.players)||session.players.indexOf(session.revealedRoleId)===-1)
      return fail('NOT_REVEALED','游戏尚未正式揭晓，秘密不能写进共同记忆');
    var members=req.group&&Array.isArray(req.group.members)?req.group.members:[];
    var match=members.find(function(m){return m&&id(m.id)===session.revealedRoleId;});
    var name=match?id(match.nickname||match.name).slice(0,28):'一位成员';
    return storePublic(req,{groupId:session.groupId,kind:'game-finished',
      sourceId:session.sessionId,createdAt:session.finishedAt,
      summary:'群聊结束「猜猜谁是坏人」游戏，共'+session.players.length+
        '位角色参与，公布的坏人是「'+name+'」。'});
  }
  function getPublicPrompt(req){
    req=req||{};
    var gid=id(req.groupId);
    if(!valid(gid)||!root.MemoryRecall||typeof root.MemoryRecall.getMemories!=='function')return '';
    var list=root.MemoryRecall.getMemories(gid);
    if(!Array.isArray(list))return '';
    var allowed={group_game_public:true,group_chain_public:true,group_manual:true};
    var maxChars=Math.max(120,Math.min(750,Number(req.maxChars)||420));
    var recent=list.filter(function(m){
      return m&&allowed[m.source]===true&&['fixed','confirmed'].indexOf(m.status)!==-1;
    }).sort(function(a,b){return (Number(b.lastReinforcedAt)||Number(b.createdAt)||0)-
      (Number(a.lastReinforcedAt)||Number(a.createdAt)||0);}).slice(0,8);
    var lines=[],count=0;
    recent.forEach(function(m){
      var text=id(m.content).replace(/[\r\n]+/g,' ').slice(0,200);
      if(text&&count+text.length+3<=maxChars){lines.push('· '+text);count+=text.length+3;}
    });
    return lines.length?'[当前群已确认的公开共同回忆]\n'+lines.join('\n')+
      '\n以上是公开记录，不包含其他成员的私聊或未揭晓的游戏身份。':'';
  }
  root.GroupMemoryEvents=Object.freeze({
    recordChainClosure:recordChainClosure,recordGameClosure:recordGameClosure,
    getPublicPrompt:getPublicPrompt
  });
})(typeof window!=='undefined'?window:globalThis);
