/* MAOMAO group games: local role-play session boundary, separate from the chat engine.
 * PUBLIC state and ROLE-ONLY secrets are stored under different keys.
 * This is AI-context isolation, NOT cryptographic protection against scripts,
 * browser owners or real human group accounts. Server auth is required for them.
 */
(function (root) {
  'use strict';
  if (root.GroupGameSessions) return;
  var PREFIX = 'phone_group_game_v1_';
  var PRIVATE = 'phone_group_game_private_v1_';
  var templates = Object.create(null), handlers = Object.create(null);
  function id(v) { return String(v == null ? '' : v).trim(); }
  function valid(v) { return /^[a-zA-Z0-9_-]{1,90}$/.test(id(v)); }
  function publicKey(gid) { return PREFIX + gid; }
  function secretKey(gid, sid, rid) { return PRIVATE + gid + '_' + sid + '_' + rid; }
  function inboxKey(gid, sid, rid) { return PRIVATE + gid + '_' + sid + '_inbox_' + rid; }
  function storageOf(req) { return req && req.storage || root.localStorage; }
  function read(storage, key) {
    try { var text = storage.getItem(key); return text ? JSON.parse(text) : null; }
    catch (e) { return null; }
  }
  function write(storage, key, value) {
    try {
      var raw = JSON.stringify(value);
      storage.setItem(key, raw);
      return storage.getItem(key) === raw;
    } catch (e) { return false; }
  }
  function drop(storage, key) { try { storage.removeItem(key); } catch (e) {} }
  function error(code, message) { return { ok:false, code:code, message:message }; }
  function emit(event, payload) {
    (handlers[event] || []).concat(handlers['*'] || []).forEach(function (fn) {
      try { fn(payload); } catch (e) { console.error('[GroupGameSessions] event handler failed', e); }
    });
  }
  function on(event, fn) {
    if (typeof fn !== 'function') return function () {};
    (handlers[event] || (handlers[event] = [])).push(fn);
    return function () { handlers[event] = handlers[event].filter(function (h) { return h !== fn; }); };
  }
  function registerGame(name, spec) {
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(name) || templates[name] ||
      !spec || typeof spec !== 'object' || typeof spec.label !== 'string') return false;
    // A template is metadata, not a bypass of the session authorization layer.
    templates[name] = Object.freeze({ id:name, label:spec.label.slice(0,40),
      supportsSecrets:spec.supportsSecrets === true, mode:spec.mode === 'legacy' ? 'legacy' : 'session' });
    return true;
  }
  function games() { return Object.keys(templates).map(function (k) { return templates[k]; }); }
  registerGame('chain', { label:'群聊接龙', mode:'legacy' });
  registerGame('poll', { label:'群投票', mode:'legacy' });
  registerGame('mystery', { label:'猜猜谁是坏人', supportsSecrets:true });
  function groupMemberIds(group) {
    return group && Array.isArray(group.members) ? group.members.map(function (m) {
      return m && id(m.id);
    }).filter(valid) : [];
  }
  function game(groupId, storage) {
    if (!valid(groupId)) return null;
    var session = read(storage || root.localStorage, publicKey(groupId));
    if (!session || typeof session !== 'object' || session.groupId !== groupId ||
      !valid(session.sessionId) || !templates[session.gameId] ||
      ['active','finished'].indexOf(session.status) === -1 ||
      !Array.isArray(session.players) || session.players.some(function (x) { return !valid(x); }))
      return null;
    // Never return a storage object bearing a private answer.
    return { version:1, sessionId:session.sessionId, groupId:session.groupId,
      gameId:session.gameId, status:session.status, hostId:session.hostId,
      players:session.players.slice(), rules:{
        allowPrivate:session.rules && session.rules.allowPrivate === true,
        showPrivateActivity:session.rules && session.rules.showPrivateActivity === true
      }, createdAt:session.createdAt, finishedAt:session.finishedAt || 0,
      revealedRoleId:session.status === 'finished' ? id(session.revealedRoleId) : '',
      activity:session.rules && session.rules.showPrivateActivity === true
        ? (Array.isArray(session.activity) ? session.activity.slice(-12).map(function (v) {
          return { fromId:id(v.fromId), toId:id(v.toId), time:Number(v.time)||0 };
        }) : []) : [] };
  }
  function start(req) {
    req = req || {};
    var group = req.group, gid = id(group && group.id), storage = storageOf(req);
    if (!valid(gid) || !group || group.ownerId && group.ownerId !== '__user' ||
      group.userMembership === 'left') return error('NO_PERMISSION','只有当前群主可以设置并开始此局');
    if (req.actorId !== '__user') return error('NO_PERMISSION','只有群主可以开始秘密游戏');
    var template = templates[id(req.gameId || 'mystery')];
    if (!template || template.mode !== 'session') return error('UNKNOWN_GAME','该玩法尚未接入独立对局');
    var previous = game(gid, storage), rawExisting;
    try { rawExisting = storage.getItem(publicKey(gid)); }
    catch (e) { return error('STORAGE_UNAVAILABLE','暂时无法读取原有对局，已停止新建'); }
    if (rawExisting !== null && !previous)
      return error('CORRUPT_SESSION','旧游戏记录异常，已保护原始数据，不会覆盖');
    if (previous && previous.status === 'active') return error('ALREADY_ACTIVE','请先结束正在进行的游戏');
    var players = groupMemberIds(group);
    if (players.length < 2 || players.length > 24 || new Set(players).size !== players.length)
      return error('INVALID_PLAYERS','至少需要两位且不能有重复的有效角色');
    var culprit = id(req.badRoleId);
    if (players.indexOf(culprit) === -1) return error('INVALID_SECRET','请选择群里的一位角色');
    var sid = 'gs' + Date.now().toString(36) + Math.random().toString(36).slice(2, 13);
    var rules = { allowPrivate:req.allowPrivate === true, showPrivateActivity:req.allowPrivate === true && req.showPrivateActivity === true };
    var session = {
      version:1, sessionId:sid, groupId:gid, gameId:template.id, status:'active',
      hostId:'__user', players:players, rules:rules, activity:[], createdAt:Date.now()
    };
    // Write ALL role-only secrets first, verify each, THEN publish the public active state.
    var secretKeys = [];
    for (var i = 0; i < players.length; i++) {
      var rid = players[i], key = secretKey(gid, sid, rid);
      var secret = { groupId:gid, sessionId:sid, recipientId:rid,
        role:rid === culprit ? 'bad' : 'good', text:rid === culprit ? '你是本局唯一的坏人。不要主动公开身份。' : '你是普通玩家。你不知道坏人是谁。' };
      if (!write(storage, key, secret)) {
        secretKeys.forEach(function (k) { drop(storage,k); });
        drop(storage,key);
        return error('SAVE_FAILED','身份牌保存失败，本局没有开始');
      }
      secretKeys.push(key);
    }
    if (!write(storage, publicKey(gid), session)) {
      secretKeys.forEach(function (k) { drop(storage,k); });
      return error('SAVE_FAILED','公开对局状态保存失败，本局没有开始');
    }
    var safe = game(gid, storage);
    emit('game:started', { groupId:gid, sessionId:sid, gameId:template.id });
    return { ok:true, session:safe };
  }
  // Hide complete AND half-streamed private directives before temporary DOM paint,
  // background/pagehide snapshots, search or any public group transcript.
  // Incomplete prefixes matter: streaming often stops midway through a marker.
  function redactPublicStreamText(input) {
    var output=String(input==null?'':input);
    output=output.replace(/\[(?:游戏私聊|群私聊)[:：][^\]\r\n]{0,1000}(?:\]|$)/g,'');
    var last=output.match(/\[[^\]\r\n]{0,200}$/);
    if(last) {
      var tail=last[0].slice(1), names=['游戏私聊','群私聊'];
      if(!tail || names.some(function(name){
        return name.indexOf(tail)===0 || tail.indexOf(name+':')===0 ||
          tail.indexOf(name+'：')===0;
      })) output=output.slice(0,output.length-last[0].length);
    }
    return output;
  }
  function buildRoleContext(req) {
    req = req || {};
    var gid = id(req.groupId), rid = id(req.roleId), storage = storageOf(req);
    var session = game(gid, storage);
    if (!session) {
      // Missing session is normal; unreadable public session is NOT. Do not
      // silently resume a game with no role card or private-chat protection.
      try {
        if (storage.getItem(publicKey(gid)) !== null)
          return error('CORRUPT_SESSION','群游戏数据异常，已停止角色回复');
      } catch(e) { return error('STORAGE_UNAVAILABLE','无法读取游戏状态，已停止角色回复'); }
      return { ok:true, active:false, text:'' };
    }
    if (session.status !== 'active') return { ok:true, active:false, text:'' };
    if (session.players.indexOf(rid) === -1) return error('NOT_PLAYER','非本局角色不能参与');
    var secret = read(storage, secretKey(gid, session.sessionId, rid));
    if (!secret || secret.groupId !== gid || secret.sessionId !== session.sessionId ||
      secret.recipientId !== rid || (secret.role !== 'good' && secret.role !== 'bad'))
      return error('MISSING_CARD','角色身份牌未找到，已停止本轮回复，避免身份串号');
    var rules = session.rules;
    var text = '[群聊游戏 · 本局仅给当前角色的资料]\n' +
      '游戏：猜猜谁是坏人；你的身份：' + (secret.role === 'bad' ? '坏人' : '普通玩家') + '。\n' +
      '本局私聊：' + (rules.allowPrivate ? '允许玩家之间的游戏私聊' : '禁止玩家之间的游戏私聊') + '。\n' +
      '请根据自己已知的事实参与推理；你无法读取其他成员的身份牌。';
    if (rules.allowPrivate) {
      var whispers = read(storage, inboxKey(gid, session.sessionId, rid));
      var incoming = Array.isArray(whispers) ? whispers.slice(-3).filter(function (m) {
        return m && m.toId === rid && m.sessionId === session.sessionId && m.groupId === gid;
      }) : [];
      if (incoming.length) text += '\n[只有你收到的私聊]\n' + incoming.map(function (m) {
        return id(m.fromId).slice(0,90) + '：' + id(m.text).slice(0,240);
      }).join('\n');
    }
    return { ok:true, active:true, text:text, sessionId:session.sessionId,
      canWhisper:rules.allowPrivate };
  }
  function canWhisper(req) {
    req = req || {};
    var session = game(id(req.groupId),storageOf(req));
    if (!session) {
      try {
        if (storageOf(req).getItem(publicKey(id(req.groupId))) !== null)
          return { active:true, allowed:false, code:'CORRUPT_SESSION' };
      } catch(e) { return { active:true, allowed:false, code:'STORAGE_UNAVAILABLE' }; }
      return { active:false, allowed:true };
    }
    if (session.status !== 'active') return { active:false, allowed:true };
    var from=id(req.fromId), to=id(req.toId);
    return { active:true, allowed:(!req.sessionId || id(req.sessionId) === session.sessionId) &&
      session.rules.allowPrivate === true &&
      (from === '__user' || session.players.indexOf(from) !== -1) &&
      (to === '__user' || session.players.indexOf(to) !== -1) &&
      from !== to };
  }
  function sendWhisper(req) {
    req = req || {};
    var gid=id(req.groupId), to=id(req.toId), from=id(req.fromId), storage=storageOf(req);
    var session=game(gid,storage);
    // A queued AI whisper must be bound to the session which produced it.
    // Never allow a late completion from an old game to write into a new round.
    if(!session || session.status !== 'active' || !valid(req.sessionId) ||
      id(req.sessionId)!==session.sessionId)
      return error('STALE_SESSION','私聊所属对局已结束或发生变化');
    var right=canWhisper(req);
    if(!right.allowed) return error('PRIVATE_DISABLED','本局不允许玩家私聊');
    if (to!=='__user' && session.players.indexOf(to)===-1) return error('INVALID_RECIPIENT','只能发给本局角色或群主');
    var content=id(req.text);
    if (!content || content.length>240) return error('INVALID_TEXT','私聊消息最多240字');
    var eventId=id(req.eventId);
    if (!valid(eventId)) return error('INVALID_EVENT','消息需要唯一事件编号');
    var key=inboxKey(gid,session.sessionId,to), inbox=read(storage,key);
    if (inbox != null && !Array.isArray(inbox)) return error('CORRUPT_INBOX','私聊记录异常');
    inbox=inbox||[];
    if (inbox.some(function (m) { return m && m.eventId===eventId; }))
      return { ok:true, duplicate:true };
    var event={ eventId:eventId, groupId:gid,sessionId:session.sessionId,
      fromId:from,toId:to,text:content,time:Date.now() };
    if (!write(storage,key,inbox.concat([event]).slice(-40)))
      return error('SAVE_FAILED','私聊没有保存成功');
    if (session.rules.showPrivateActivity) {
      // Store only who spoke to whom, NEVER private text or identity.
      var raw=read(storage,publicKey(gid));
      if (raw && raw.sessionId===session.sessionId && raw.status==='active') {
        raw.activity=(Array.isArray(raw.activity)?raw.activity:[]).concat([
          { fromId:from,toId:to,time:event.time }
        ]).slice(-12);
        write(storage,publicKey(gid),raw);
      }
    }
    emit('game:whispered',{groupId:gid,sessionId:session.sessionId,fromId:from,toId:to});
    return {ok:true,duplicate:false};
  }
  // A host may read ONLY messages addressed to the host in the active round.
  // No general "view all private chats" API is exposed to the group owner.
  function getHostInbox(req) {
    req=req||{};
    var gid=id(req.groupId),group=req.group,storage=storageOf(req);
    if(!group || id(group.id)!==gid || id(group.ownerId||'__user')!=='__user' ||
      group.userMembership==='left' || req.actorId!=='__user')
      return error('NO_PERMISSION','只有当前群主可以查看发给自己的游戏私聊');
    var session=game(gid,storage);
    if(!session || session.status!=='active')
      return error('NOT_ACTIVE','当前没有进行中的游戏');
    var inbox=read(storage,inboxKey(gid,session.sessionId,'__user'));
    if(inbox!==null && !Array.isArray(inbox))
      return error('CORRUPT_INBOX','群主私聊收件箱异常');
    return {ok:true,sessionId:session.sessionId,messages:(inbox||[])
      .filter(function(msg){return msg&&msg.groupId===gid &&
        msg.sessionId===session.sessionId && msg.toId==='__user' &&
        session.players.indexOf(msg.fromId)!==-1;})
      .slice(-20).map(function(msg){return {fromId:id(msg.fromId),
        text:id(msg.text).slice(0,240),time:Number(msg.time)||0};})};
  }
  // Private conversation with one player: host-sent + host-received only.
  // Whispers exchanged by two other players are never returned, even to host.
  function getHostConversation(req) {
    req=req||{};
    var checked=getHostInbox(req);
    if(!checked.ok)return checked;
    var gid=id(req.groupId),peer=id(req.peerId),storage=storageOf(req);
    var session=game(gid,storage);
    if(!session || session.players.indexOf(peer)===-1)
      return error('NOT_PLAYER','没有找到本局私聊对象');
    var sent=read(storage,inboxKey(gid,session.sessionId,peer));
    if(sent!==null && !Array.isArray(sent))return error('CORRUPT_INBOX','私聊记录异常');
    var received=read(storage,inboxKey(gid,session.sessionId,'__user'));
    if(received!==null && !Array.isArray(received))return error('CORRUPT_INBOX','群主私聊记录异常');
    var items=(sent||[]).filter(function(m){
      return m&&m.groupId===gid&&m.sessionId===session.sessionId&&
        m.fromId==='__user'&&m.toId===peer;
    }).map(function(m){return {senderId:'__user',text:id(m.text).slice(0,240),
      time:Number(m.time)||0,direction:'sent'};}).concat((received||[]).filter(function(m){
      return m&&m.groupId===gid&&m.sessionId===session.sessionId&&
        m.fromId===peer&&m.toId==='__user';
    }).map(function(m){return {senderId:peer,text:id(m.text).slice(0,240),
      time:Number(m.time)||0,direction:'received'};}));
    items.sort(function(a,b){return a.time-b.time;});
    return {ok:true,sessionId:session.sessionId,messages:items.slice(-40)};
  }
  function finish(req) {
    req=req||{};
    var gid=id(req.groupId), storage=storageOf(req);
    if (!valid(gid)||req.actorId!=='__user') return error('NO_PERMISSION','只有群主能结束并揭晓');
    var session=game(gid,storage);
    if (!session || session.status!=='active') return error('NOT_ACTIVE','当前没有进行中的游戏');
    if (!req.group || id(req.group.id)!==gid ||
      id(req.group.ownerId||'__user')!=='__user' || req.group.userMembership==='left')
      return error('NO_PERMISSION','无法确认当前群主权限');
    var bad=[];
    for(var i=0;i<session.players.length;i++){
      var rid=session.players[i];
      var secret=read(storage,secretKey(gid,session.sessionId,rid));
      if(!secret||secret.recipientId!==rid||secret.sessionId!==session.sessionId)
        return error('MISSING_CARD','身份牌缺失，不能伪造揭晓结果');
      if(secret.role==='bad')bad.push(rid);
      else if(secret.role!=='good')return error('INVALID_CARD','身份牌异常');
    }
    if(bad.length!==1)return error('INVALID_RESULT','无法确定唯一坏人');
    var raw=read(storage,publicKey(gid));
    if(!raw||raw.sessionId!==session.sessionId)return error('CONFLICT','对局已发生变化');
    raw.status='finished';raw.finishedAt=Date.now();raw.revealedRoleId=bad[0];
    if(!write(storage,publicKey(gid),raw))return error('SAVE_FAILED','游戏结束状态未保存');
    drop(storage,inboxKey(gid,session.sessionId,'__user'));
    session.players.forEach(function (rid) {
      drop(storage,secretKey(gid,session.sessionId,rid));
      drop(storage,inboxKey(gid,session.sessionId,rid));
    });
    emit('game:finished',{groupId:gid,sessionId:session.sessionId,gameId:session.gameId,
      revealedRoleId:bad[0],finishedAt:raw.finishedAt});
    return {ok:true,session:game(gid,storage)};
  }
  root.GroupGameSessions=Object.freeze({
    registerGame:registerGame, games:games, on:on, getPublic:game,
    start:start, finish:finish, buildRoleContext:buildRoleContext,
    canWhisper:canWhisper, sendWhisper:sendWhisper, getHostInbox:getHostInbox, getHostConversation:getHostConversation,
    redactPublicStreamText:redactPublicStreamText
  });
})(typeof window!=='undefined'?window:globalThis);
