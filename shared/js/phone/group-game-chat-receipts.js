/* MAOMAO | group-game result receipt -> the existing group chat history.
 * This is an idempotent projection of a CONFIRMED public session. It does not
 * duplicate game state or write role cards/whispers/ballots into public chat.
 * Uses PhoneStorage's existing chat-history adapter when available.
 */
(function (root) {
  'use strict';
  if (root.GroupGameChatReceipts) return;

  function asId(value) { return String(value == null ? '' : value).trim(); }
  function valid(value) { return /^[A-Za-z0-9_-]{1,90}$/.test(asId(value)); }
  function problem(code, message) { return { ok:false, code:code, message:message }; }
  function messageId(sessionId) { return 'm_game_result_' + sessionId; }
  function source(req) { return req && req.storage || root.localStorage; }
  function adapter(req) {
    if (req && Object.prototype.hasOwnProperty.call(req, 'phoneStorage')) return req.phoneStorage;
    return root.PhoneStorage || null;
  }

  function readHistory(groupId, req) {
    var storage=source(req), key='chat_history_'+groupId, raw;
    try { raw=storage.getItem(key); }
    catch(e) { return problem('READ_FAILED','无法读取群聊记录，已停止写入'); }
    if (raw !== null) {
      try {
        var parsed=JSON.parse(raw);
        return Array.isArray(parsed) ? {ok:true,list:parsed}
          : problem('HISTORY_CORRUPT','群聊历史格式异常，已保护旧数据');
      } catch(e) { return problem('HISTORY_CORRUPT','群聊历史损坏，禁止覆盖'); }
    }

    // Old groups can have a legacy copy in phone_data_v2. Do NOT replace it
    // with a brand-new result-only history if that fallback cannot be read.
    var old;
    try { old=storage.getItem('phone_data_v2'); }
    catch(e) { return problem('READ_FAILED','无法检查旧版群聊数据'); }
    if (old !== null) {
      try {
        var parsedRoot=JSON.parse(old);
        if (!parsedRoot || typeof parsedRoot !== 'object' || Array.isArray(parsedRoot))
          return problem('HISTORY_CORRUPT','旧版聊天存储格式异常');
        var bucket=parsedRoot[groupId];
        if (bucket && bucket.chat && bucket.chat.history != null &&
          !Array.isArray(bucket.chat.history))
          return problem('HISTORY_CORRUPT','旧版群聊记录损坏，已停止写入');
      } catch(e) { return problem('HISTORY_CORRUPT','旧版聊天存储损坏，禁止覆盖'); }
    }
    var phone=adapter(req);
    if (phone && typeof phone.getChatHistory === 'function') {
      try {
        var legacy=phone.getChatHistory(groupId);
        return Array.isArray(legacy) ? {ok:true,list:legacy}
          : problem('HISTORY_CORRUPT','群聊记录不是消息列表');
      } catch(e) { return problem('READ_FAILED','无法读取旧版群聊记录'); }
    }
    if (old !== null) {
      // Without the verified fallback reader, do not risk overwriting history.
      return problem('STORAGE_UNAVAILABLE','没有可用的旧版聊天读取模块');
    }
    return {ok:true,list:[]};
  }

  function canonical(req) {
    req=req||{};
    var group=req.group, gid=asId(group&&group.id);
    if (!valid(gid) || asId(req.actorId)!=='__user' ||
      !group || asId(group.ownerId||'__user')!=='__user' ||
      group.userMembership==='left') return problem('NO_PERMISSION','只有当前群主能发布本群游戏结果');
    var api=root.GroupGameSessions, input=req.session;
    if (!api || typeof api.getPublic!=='function' || !input || !valid(input.sessionId))
      return problem('MISSING_GAME','游戏状态不可用');
    var official=api.getPublic(gid,source(req));
    if (!official || official.sessionId!==input.sessionId ||
      official.status!==input.status || official.gameId!=='mystery')
      return problem('UNVERIFIED_RESULT','对局结果还没有保存确认');
    if (official.status!=='finished' && official.status!=='cancelled')
      return problem('NOT_CLOSED','游戏还没有结束');
    if (official.status==='finished' &&
      (!valid(official.revealedRoleId) ||
        !Array.isArray(official.players) ||
        official.players.indexOf(official.revealedRoleId)===-1))
      return problem('UNVERIFIED_RESULT','尚未取得可靠的身份揭晓结果');
    var members=Array.isArray(group.members)?group.members:[];
    function memberName(rid) {
      var match=members.find(function(m){return m&&asId(m.id)===rid;});
      return asId(match&&(match.nickname||match.name)||'群成员').slice(0,36);
    }
    var finished=official.status==='finished',
      count=Math.max(0,Math.min(24,Number(official.voteCount)||0)),
      correct=Math.max(0,Math.min(count,Number(official.correctVotes)||0));
    var votes=finished && Array.isArray(official.voteTally)
      ? official.voteTally.filter(function(v){
        return v && official.players.indexOf(asId(v.targetId))!==-1 &&
          Number.isInteger(Number(v.count)) && Number(v.count)>=0;
      }).map(function(v){
        return {targetId:asId(v.targetId),
          name:memberName(asId(v.targetId)).slice(0,36), count:Number(v.count)};
      }) : [];
    var time=Number(finished?official.finishedAt:official.cancelledAt);
    if (!Number.isFinite(time) || time<=0)
      return problem('UNVERIFIED_RESULT','游戏结束时间没有确认');
    var text=finished
      ? '猜猜谁是坏人 · 已揭晓。坏人是'+memberName(official.revealedRoleId)+
        '；'+count+'人投票，'+correct+'人猜对。'
      : '猜猜谁是坏人 · 本局已取消，身份未揭晓。';
    return {ok:true,record:{
      mid:messageId(official.sessionId),
      time:time, role:'system', type:'group_game_result',
      text:text, visibility:'public',
      groupGame:{
        version:1,groupId:gid,sessionId:official.sessionId,
        gameId:'mystery',status:official.status,
        revealedName:finished?memberName(official.revealedRoleId):'',
        voteCount:finished?count:0,correctVotes:finished?correct:0,
        voteTally:votes,playersCount:official.players.length
      }
    }};
  }

  function check(req) {
    var prepared=canonical(req);
    if (!prepared.ok) return prepared;
    var gid=prepared.record.groupGame.groupId,
      history=readHistory(gid,req);
    if (!history.ok) return history;
    var message=prepared.record;
    var found=history.list.filter(function(item){
      return item && asId(item.mid)===message.mid;
    });
    if (found.length>1) return problem('DUPLICATE_CONFLICT','历史中存在重复的游戏结果编号，禁止覆盖');
    if (found.length===1) {
      if (JSON.stringify(found[0])!==JSON.stringify(message))
        return problem('RECEIPT_CONFLICT','已有游戏结果与当前已保存对局不一致');
      return {ok:true,exists:true,record:message};
    }
    return {ok:true,exists:false,record:message};
  }

  function publish(req) {
    var status=check(req);
    if (!status.ok) return status;
    if (status.exists) return {ok:true,duplicate:true,record:status.record};
    var record=status.record, gid=record.groupGame.groupId,
      history=readHistory(gid,req);
    if (!history.ok) return history;
    var raw=JSON.stringify(history.list);
    var next=history.list.concat([record]);
    var lastCheck=readHistory(gid,req);
    if (!lastCheck.ok) return lastCheck;
    if (JSON.stringify(lastCheck.list)!==raw)
      return problem('HISTORY_CHANGED','保存过程中聊天记录发生变化，请重试');
    var storage=source(req), phone=adapter(req), written=false;
    try {
      if (phone && typeof phone.saveChatHistory==='function')
        written=phone.saveChatHistory(gid,next)===true;
      else {
        storage.setItem('chat_history_'+gid,JSON.stringify(next));
        written=true;
      }
    } catch(e) { written=false; }
    if (!written) return problem('SAVE_FAILED','游戏结果卡没有保存成功，请检查本机存储');
    var after=readHistory(gid,req);
    if (!after.ok || JSON.stringify(after.list)!==JSON.stringify(next))
      return problem('NOT_VERIFIED','游戏结果写入未能读回确认，请检查聊天记录');
    return {ok:true,duplicate:false,record:record};
  }

  root.GroupGameChatReceipts=Object.freeze({
    check:check,publish:publish
  });
})(typeof window!=='undefined'?window:globalThis);
