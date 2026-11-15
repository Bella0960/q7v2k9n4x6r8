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
  function savedChain(req, gid, mid) {
    var history = [];
    try {
      if(root.PhoneStorage && typeof root.PhoneStorage.getChatHistory==='function') {
        history = root.PhoneStorage.getChatHistory(gid);
      }
      if(!Array.isArray(history))return null;
      if(!history.length) {
        var raw=storageOf(req).getItem('chat_history_'+gid);
        history=raw?JSON.parse(raw):[];
      }
      if(!Array.isArray(history))return null;
      var matched=history.filter(function(m) {
        return m&&m.type==='group_chain'&&id(m.mid)===mid&&m.chain&&m.chain.closed===true;
      });
      return matched.length===1?matched[0]:null;
    } catch(e){return null;}
  }
  function recordChainClosure(req){
    req=req||{};
    var g=req.group, m=req.message;
    if(!g||!m||m.type!=='group_chain'||!m.chain||m.chain.closed!==true)
      return fail('NOT_CLOSED','只有已完成的群接龙才能入长期记忆');
    var gid=id(g.id), mid=id(m.mid);
    if(!valid(gid)||!mid||mid.length>180)
      return fail('INVALID_EVENT','接龙缺少有效群 ID 或消息编号');
    // A UI-supplied object is not evidence that a group message was saved.
    var saved=savedChain(req,gid,mid);
    if(!saved)return fail('NOT_SAVED','接龙结束状态尚未确认写入聊天历史');
    m=saved;
    var entries=Array.isArray(m.chain.entries)?m.chain.entries.filter(function(x){
      return x&&id(x.memberId)&&id(x.text);
    }):[];
    if(!entries.length)return fail('EMPTY_CHAIN','空接龙不生成事件');
    var title=id(m.chain.title).slice(0,65);
    if(!title||!mid)return fail('INVALID_EVENT','接龙缺少已保存的主题或消息编号');
    var people=Object.create(null);
    entries.forEach(function(e){people[id(e.memberId)]=true;});
    return storePublic(req,{groupId:gid,kind:'chain-finished',sourceId:mid,
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
    // Verify the revealed outcome against the saved public session, never a
    // caller-provided result object or unrevealed private identity cards.
    var official=root.GroupGameSessions &&
      typeof root.GroupGameSessions.getPublic==='function'
      ? root.GroupGameSessions.getPublic(session.groupId,storageOf(req)) : null;
    if(!official||official.status!=='finished'||
      official.sessionId!==session.sessionId||
      official.revealedRoleId!==session.revealedRoleId||
      JSON.stringify(official.players)!==JSON.stringify(session.players))
      return fail('UNVERIFIED_RESULT','游戏结果尚未确认保存，禁止进入群共同记忆');
    var members=req.group&&Array.isArray(req.group.members)?req.group.members:[];
    var match=members.find(function(m){return m&&id(m.id)===session.revealedRoleId;});
    var name=match?id(match.nickname||match.name).slice(0,28):'一位成员';
    var host=members.find(function(m){return m&&id(m.id)===id(official.hostId);});
    var hostLabel=official.hostId==='__user'?'群主':
      (host?id(host.nickname||host.name).slice(0,28):'一位主持人');
    return storePublic(req,{groupId:session.groupId,kind:'game-finished',
      sourceId:session.sessionId,createdAt:session.finishedAt,
      summary:'群聊结束「猜猜谁是坏人」游戏，由「'+hostLabel+'」主持，共'+official.players.length+
        '位角色参与，公布的坏人是「'+name+'」。'+
        (official.voteCount>0
          ? '本局'+official.voteCount+'人投票，'+official.correctVotes+'人猜对。'
          : '本局没有提交猜测票。')});
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
