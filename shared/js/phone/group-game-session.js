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
  function voteKey(gid,sid,rid) { return PRIVATE + gid + '_' + sid + '_vote_' + rid; }
  function storageOf(req) { return req && req.storage || root.localStorage; }
  function read(storage, key) {
    try { var text = storage.getItem(key); return text ? JSON.parse(text) : null; }
    catch (e) { return null; }
  }
  // Unlike generic reads, a private inbox must distinguish an absent key from
  // unreadable/corrupted data. Never overwrite or silently ignore private DMs.
  function readInbox(storage, key) {
    var raw;
    try { raw=storage.getItem(key); }
    catch (e) { return error('STORAGE_UNAVAILABLE','无法读取本局游戏私聊'); }
    if (raw===null) return {ok:true,messages:[]};
    try {
      var parsed=JSON.parse(raw);
      return Array.isArray(parsed) ? {ok:true,messages:parsed} :
        error('CORRUPT_INBOX','游戏私聊记录格式异常，已保护原数据');
    } catch (e) {
      return error('CORRUPT_INBOX','游戏私聊记录损坏，已保护原数据');
    }
  }
  function write(storage, key, value) {
    try {
      var raw = JSON.stringify(value);
      storage.setItem(key, raw);
      return storage.getItem(key) === raw;
    } catch (e) { return false; }
  }
  function drop(storage, key) { try { storage.removeItem(key); } catch (e) {} }
  function cleanupKeys(session) {
    var keys=[inboxKey(session.groupId,session.sessionId,'__user')];
    session.players.forEach(function(rid){
      keys.push(secretKey(session.groupId,session.sessionId,rid));
      keys.push(voteKey(session.groupId,session.sessionId,rid));
      keys.push(inboxKey(session.groupId,session.sessionId,rid));
    });
    return keys;
  }
  function pendingCleanup(storage,session) {
    var count=0;
    cleanupKeys(session).forEach(function(key){
      try { if(storage.getItem(key)!==null)count++; }
      catch(e) { count++; }
    });
    return count;
  }
  function cleanupRound(storage,session) {
    cleanupKeys(session).forEach(function(key){drop(storage,key);});
    var pending=pendingCleanup(storage,session);
    return {complete:pending===0,pending:pending};
  }
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
  function voteFor(session, rid, storage) {
    var key=voteKey(session.groupId,session.sessionId,rid), raw;
    try { raw=storage.getItem(key); }
    catch(e) { return error('STORAGE_UNAVAILABLE','无法读取本局投票'); }
    if(raw===null)return {ok:true,voted:false};
    var vote=read(storage,key);
    if(!vote || vote.groupId!==session.groupId || vote.sessionId!==session.sessionId ||
      vote.voterId!==rid || session.players.indexOf(vote.targetId)===-1 ||
      !valid(vote.eventId) || !Number.isFinite(Number(vote.time)))
      return error('CORRUPT_VOTE','已有投票记录异常，已停止操作');
    return {ok:true,voted:true,vote:vote};
  }
  function game(groupId, storage) {
    if (!valid(groupId)) return null;
    var session = read(storage || root.localStorage, publicKey(groupId));
    if (!session || typeof session !== 'object' || session.groupId !== groupId ||
      !valid(session.sessionId) || !templates[session.gameId] ||
      ['active','finished','cancelled'].indexOf(session.status) === -1 ||
      !Array.isArray(session.players) || session.players.some(function (x) { return !valid(x); }) ||
      (session.hostId!=='__user' && (!valid(session.hostId) ||
        session.players.indexOf(session.hostId)!==-1)))
      return null;
    // A public game view exposes participation counts, NEVER private vote targets
    // until the host has explicitly ended and revealed the session.
    var voteCount=0,voteError=false;
    if(session.status==='active') {
      for(var pi=0;pi<session.players.length;pi++) {
        var check=voteFor(session,session.players[pi],storage||root.localStorage);
        if(!check.ok)voteError=true;
        else if(check.voted)voteCount++;
      }
    }
    return { version:1, sessionId:session.sessionId, groupId:session.groupId,
      gameId:session.gameId, status:session.status, hostId:session.hostId,
      players:session.players.slice(), rules:{
        allowPrivate:session.rules && session.rules.allowPrivate === true,
        showPrivateActivity:session.rules && session.rules.showPrivateActivity === true
      }, createdAt:session.createdAt, finishedAt:session.finishedAt || 0,
      cancelledAt:session.status==='cancelled' ? (Number(session.cancelledAt)||0) : 0,
      revealedRoleId:session.status === 'finished' ? id(session.revealedRoleId) : '',
      voteCount:session.status==='active' ? voteCount : (Number(session.voteCount)||0),
      voteError:voteError,
      correctVotes:session.status==='finished' ? (Number(session.correctVotes)||0) : null,
      voteTally:session.status==='finished' && Array.isArray(session.voteTally)
        ? session.voteTally.filter(function(v){return v&&session.players.indexOf(id(v.targetId))!==-1;})
          .map(function(v){return {targetId:id(v.targetId),count:Number(v.count)||0};}) : [],
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
    if (previous && !cleanupRound(storage,previous).complete)
      return error('PENDING_CLEANUP','上一局临时数据仍未完全清理，请先在群聊设置中重试');
    var members=groupMemberIds(group), hostId=id(req.hostId||'__user');
    if(hostId!=='__user' && (members.indexOf(hostId)===-1 || !valid(hostId)))
      return error('INVALID_HOST','只能从本群现有角色中选择主持人');
    var players=members.filter(function(rid){return rid!==hostId;});
    if (players.length < 2 || players.length > 24 || new Set(players).size !== players.length)
      return error('INVALID_PLAYERS','至少需要两位且不能有重复的有效角色');
    var culprit = id(req.badRoleId);
    if (players.indexOf(culprit) === -1) return error('INVALID_SECRET','请选择群里的一位角色');
    var sid = 'gs' + Date.now().toString(36) + Math.random().toString(36).slice(2, 13);
    var rules = { allowPrivate:req.allowPrivate === true, showPrivateActivity:req.allowPrivate === true && req.showPrivateActivity === true };
    var session = {
      version:1, sessionId:sid, groupId:gid, gameId:template.id, status:'active',
      hostId:hostId, players:players, rules:rules, activity:[], createdAt:Date.now()
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
    output=output.replace(/\[游戏揭晓\]?/g,'');
    output=output.replace(/\[(?:游戏私聊|群私聊|游戏猜测)[:：][\s\S]*?(?:\]|$)/g,'');
    var last=output.match(/\[[^\]\r\n]{0,200}$/);
    if(last) {
      var tail=last[0].slice(1), names=['游戏私聊','群私聊','游戏猜测','游戏揭晓'];
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
    if (session.hostId===rid && rid!=='__user') {
      if(session.voteError)return error('CORRUPT_VOTE','本局投票异常，主持人不能代替玩家结算');
      var ready=session.voteCount===session.players.length;
      return {ok:true,active:true,sessionId:session.sessionId,isHost:true,
        canWhisper:false,text:'[群聊游戏 · 你是本局主持人]\n'+
          '游戏：猜猜谁是坏人。你不是玩家，不参与抽身份或投票，也不知道坏人是谁。\n'+
          '群主已指定你主持本局；已投票：'+session.voteCount+'/'+session.players.length+'。\n'+
          (ready
            ? '所有玩家均已投票。你可以自然宣布即将公布结果；在完成本轮公开发言的最后附加 [游戏揭晓]。系统会核验投票并公布真实结果；你不能猜测或自行指定坏人。'
            : '请自然引导成员讲理由、依次猜测。尚未全部投票，不能宣布结果。')};
    }
    if (session.players.indexOf(rid) === -1) return error('NOT_PLAYER','非本局角色不能参与');
    var secret = read(storage, secretKey(gid, session.sessionId, rid));
    if (!secret || secret.groupId !== gid || secret.sessionId !== session.sessionId ||
      secret.recipientId !== rid || (secret.role !== 'good' && secret.role !== 'bad'))
      return error('MISSING_CARD','角色身份牌未找到，已停止本轮回复，避免身份串号');
    var ownVote=voteFor(session,rid,storage);
    if(!ownVote.ok)return ownVote;
    var rules = session.rules;
    var text = '[群聊游戏 · 本局仅给当前角色的资料]\n' +
      '游戏：猜猜谁是坏人；你的身份：' + (secret.role === 'bad' ? '坏人' : '普通玩家') + '。\n' +
      '本局私聊：' + (rules.allowPrivate ? '允许玩家之间的游戏私聊' : '禁止玩家之间的游戏私聊') + '。\n' +
      '请根据自己已知的事实参与推理；你无法读取其他成员的身份牌。' +
      (ownVote.voted
        ? '\n你已完成本局猜测，不得再次投票，也不要编造其他人的选票。'
        : '\n当主持人宣布开始猜测，且你根据公开对话确实想投票时，在正常回复末尾添加 [游戏猜测:你怀疑的准确角色ID]。只能选一位本局其他角色，一局只有一票；不要代替其他角色投票。');
    if (rules.allowPrivate) {
      var whisperRead = readInbox(storage, inboxKey(gid, session.sessionId, rid));
      if (!whisperRead.ok) return whisperRead;
      var incoming = whisperRead.messages.slice(-3).filter(function (m) {
        return m && m.toId === rid && m.sessionId === session.sessionId && m.groupId === gid;
      });
      if (incoming.length) text += '\n[只有你收到的私聊]\n' + incoming.map(function (m) {
        return id(m.fromId).slice(0,90) + '：' + id(m.text).slice(0,240);
      }).join('\n');
    }
    return { ok:true, active:true, text:text, sessionId:session.sessionId,
      canWhisper:rules.allowPrivate };
  }
  function castVote(req) {
    req=req||{};
    var gid=id(req.groupId),rid=id(req.voterId),target=id(req.targetId),
      storage=storageOf(req),session=game(gid,storage);
    if(!session || session.status!=='active' || !valid(req.sessionId) ||
      session.sessionId!==id(req.sessionId))
      return error('STALE_SESSION','投票所属对局已结束或已变化');
    if(session.voteError)return error('CORRUPT_VOTE','本局已有异常投票，暂停新增');
    if(session.players.indexOf(rid)===-1 || session.players.indexOf(target)===-1 ||
      rid===target)return error('INVALID_VOTE','只能由本局角色投给另一位参赛者');
    var eventId=id(req.eventId);
    if(!valid(eventId))return error('INVALID_EVENT','投票事件编号无效');
    // The role's identity card must remain valid when it votes.
    var card=read(storage,secretKey(gid,session.sessionId,rid));
    if(!card || card.groupId!==gid || card.sessionId!==session.sessionId ||
      card.recipientId!==rid || ['good','bad'].indexOf(card.role)===-1)
      return error('MISSING_CARD','角色身份牌缺失，禁止代投');
    var previous=voteFor(session,rid,storage);
    if(!previous.ok)return previous;
    if(previous.voted) {
      if(previous.vote.targetId===target && previous.vote.eventId===eventId)
        return {ok:true,duplicate:true,voteCount:session.voteCount};
      return error('ALREADY_VOTED','每位角色每局只能投一次');
    }
    var vote={version:1,groupId:gid,sessionId:session.sessionId,
      voterId:rid,targetId:target,eventId:eventId,time:Date.now()};
    if(!write(storage,voteKey(gid,session.sessionId,rid),vote))
      return error('SAVE_FAILED','投票没有保存成功');
    emit('game:voted',{groupId:gid,sessionId:session.sessionId,voterId:rid});
    return {ok:true,duplicate:false,voteCount:session.voteCount+1};
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
  // A no-private game also blocks ordinary 1:1 role replies for its players.
  // Otherwise leaving the group UI would silently bypass the frozen rule.
  function checkDirectPrivateAllowed(req) {
    req=req||{};
    var rid=id(req.roleId),storage=storageOf(req);
    if(!valid(rid))return {ok:true,allowed:true};
    var groups;
    try {
      var raw=storage.getItem('phone_groups');
      groups=raw?JSON.parse(raw):[];
      if(!Array.isArray(groups))throw Error('Invalid group index');
    } catch(e){return error('GROUP_INDEX_UNAVAILABLE','暂时无法确认群游戏规则');}
    for(var i=0;i<groups.length;i++) {
      var g=groups[i],gid=id(g&&g.id);
      if(!valid(gid)||!g||g.userMembership==='left'||g.userMembership==='declined'||
        !Array.isArray(g.members)||!g.members.some(function(m){return m&&id(m.id)===rid;}))
        continue;
      var current=game(gid,storage);
      if(!current) {
        // Corrupted active-game metadata must not act as permission to DM.
        try {
          if(storage.getItem(publicKey(gid))!==null)
            return error('CORRUPT_SESSION','关联群的游戏数据异常，私聊已暂停');
        } catch(e){return error('STORAGE_UNAVAILABLE','无法核对游戏规则');}
        continue;
      }
      if(current.status==='active' && current.players.indexOf(rid)!==-1 &&
        current.rules.allowPrivate!==true)
        return {ok:true,allowed:false,groupId:gid,
          groupName:id(g.name).slice(0,24),reason:'GAME_PRIVATE_DISABLED'};
    }
    return {ok:true,allowed:true};
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
    var key=inboxKey(gid,session.sessionId,to), inboxRead=readInbox(storage,key);
    if (!inboxRead.ok) return inboxRead;
    var inbox=inboxRead.messages;
    var existing=inbox.find(function(m){return m&&m.eventId===eventId;});
    var duplicate=!!existing;
    var event=existing||{ eventId:eventId, groupId:gid,sessionId:session.sessionId,
      fromId:from,toId:to,text:content,time:Date.now() };
    if(existing && (existing.groupId!==gid || existing.sessionId!==session.sessionId ||
       existing.fromId!==from || existing.toId!==to || existing.text!==content))
      return error('EVENT_CONFLICT','相同事件编号的私聊内容不一致');
    if(!duplicate && !write(storage,key,inbox.concat([event]).slice(-40)))
      return error('SAVE_FAILED','私聊没有保存成功');
    var activitySynced=true;
    if (session.rules.showPrivateActivity) {
      // Only participant metadata is stored in PUBLIC state. A public write can
      // fail after private delivery; retry with the SAME event ID reconciles it.
      var raw=read(storage,publicKey(gid));
      if (!raw || raw.sessionId!==session.sessionId || raw.status!=='active') {
        activitySynced=false;
      } else {
        var prior=Array.isArray(raw.activity)?raw.activity:[];
        if (!prior.some(function(m){return m&&m.eventId===eventId;})) {
          raw.activity=prior.concat([{ eventId:eventId,fromId:from,toId:to,time:event.time }]).slice(-12);
          activitySynced=write(storage,publicKey(gid),raw);
        }
      }
    }
    if(!duplicate)emit('game:whispered',{groupId:gid,sessionId:session.sessionId,fromId:from,toId:to});
    return {ok:true,duplicate:duplicate,privateSaved:true,activitySynced:activitySynced};
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
    var inboxRead=readInbox(storage,inboxKey(gid,session.sessionId,'__user'));
    if(!inboxRead.ok) return inboxRead;
    return {ok:true,sessionId:session.sessionId,messages:inboxRead.messages
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
    var sent=readInbox(storage,inboxKey(gid,session.sessionId,peer));
    if(!sent.ok) return sent;
    var received=readInbox(storage,inboxKey(gid,session.sessionId,'__user'));
    if(!received.ok) return received;
    var items=sent.messages.filter(function(m){
      return m&&m.groupId===gid&&m.sessionId===session.sessionId&&
        m.fromId==='__user'&&m.toId===peer;
    }).map(function(m){return {senderId:'__user',text:id(m.text).slice(0,240),
      time:Number(m.time)||0,direction:'sent'};}).concat(received.messages.filter(function(m){
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
    if (!valid(gid)) return error('INVALID_GROUP','当前群聊无效');
    var session=game(gid,storage);
    if (!session || session.status!=='active') return error('NOT_ACTIVE','当前没有进行中的游戏');
    if (!req.group || id(req.group.id)!==gid ||
      id(req.group.ownerId||'__user')!=='__user' || req.group.userMembership==='left')
      return error('NO_PERMISSION','无法确认当前群主权限');
    var actor=id(req.actorId), delegated=actor!=='__user';
    if(delegated) {
      if(!valid(actor)||actor!==session.hostId||!valid(req.sessionId)||
        id(req.sessionId)!==session.sessionId)
        return error('NO_PERMISSION','只有群主授权的本局主持人可以宣布结果');
      var hostMember=Array.isArray(req.group.members)&&req.group.members.find(function(m){
        return m&&id(m.id)===actor;
      });
      if(!hostMember||hostMember.isMuted===true||
        (Number(hostMember.mutedUntil)||0)>Date.now())
        return error('HOST_UNAVAILABLE','主持人已离群或被禁言');
      if(session.voteError || session.voteCount!==session.players.length)
        return error('NOT_READY','必须由全部玩家投票后，主持人才可以自动揭晓');
    }
    var bad=[],votes=[],targets=Object.create(null);
    for(var i=0;i<session.players.length;i++){
      var rid=session.players[i];
      var secret=read(storage,secretKey(gid,session.sessionId,rid));
      if(!secret||secret.recipientId!==rid||secret.sessionId!==session.sessionId)
        return error('MISSING_CARD','身份牌缺失，不能伪造揭晓结果');
      if(secret.role==='bad')bad.push(rid);
      else if(secret.role!=='good')return error('INVALID_CARD','身份牌异常');
      var ballot=voteFor(session,rid,storage);
      if(!ballot.ok)return ballot;
      if(ballot.voted) {
        votes.push(ballot.vote);
        targets[ballot.vote.targetId]=(targets[ballot.vote.targetId]||0)+1;
      }
    }
    if(bad.length!==1)return error('INVALID_RESULT','无法确定唯一坏人');
    if(delegated && votes.length!==session.players.length)
      return error('NOT_READY','投票在揭晓期间发生变化，请重试');
    var raw=read(storage,publicKey(gid));
    if(!raw||raw.sessionId!==session.sessionId||raw.status!=='active')
      return error('CONFLICT','对局已发生变化');
    raw.status='finished';raw.finishedAt=Date.now();raw.revealedRoleId=bad[0];
    raw.voteCount=votes.length;
    raw.correctVotes=votes.filter(function(v){return v.targetId===bad[0];}).length;
    raw.voteTally=session.players.map(function(rid){
      return {targetId:rid,count:targets[rid]||0};
    });
    if(!write(storage,publicKey(gid),raw))return error('SAVE_FAILED','游戏结束状态未保存');
    var finishCleanup=cleanupRound(storage,session);
    emit('game:finished',{groupId:gid,sessionId:session.sessionId,gameId:session.gameId,
      revealedRoleId:bad[0],finishedAt:raw.finishedAt});
    return {ok:true,session:game(gid,storage),
      cleanupComplete:finishCleanup.complete,cleanupPending:finishCleanup.pending};
  }
  // Host can abandon an invalid/unfinished round without inventing a winner.
  // This only clears the round's temporary cards, votes and private inboxes.
  function cancel(req) {
    req=req||{};
    var gid=id(req.groupId),storage=storageOf(req),group=req.group;
    if(req.actorId!=='__user'||!group||id(group.id)!==gid||
      id(group.ownerId||'__user')!=='__user'||group.userMembership==='left')
      return error('NO_PERMISSION','只有当前群主可以取消本局');
    var session=game(gid,storage);
    if(!session||session.status!=='active')return error('NOT_ACTIVE','当前没有进行中的游戏');
    var raw=read(storage,publicKey(gid));
    if(!raw||raw.sessionId!==session.sessionId||raw.status!=='active')
      return error('CONFLICT','对局已经发生变化');
    raw.status='cancelled';
    raw.cancelledAt=Date.now();
    // Do not publish private ballot, identity or whisper content on cancellation.
    delete raw.voteCount;
    delete raw.correctVotes;
    delete raw.voteTally;
    delete raw.revealedRoleId;
    if(!write(storage,publicKey(gid),raw))
      return error('SAVE_FAILED','取消状态没有保存成功；原对局仍然保留');
    var cancelCleanup=cleanupRound(storage,session);
    emit('game:cancelled',{groupId:gid,sessionId:session.sessionId,
      gameId:session.gameId,cancelledAt:raw.cancelledAt});
    return {ok:true,session:game(gid,storage),
      cleanupComplete:cancelCleanup.complete,cleanupPending:cancelCleanup.pending};
  }
  // Only the current owner may inspect/retry cleanup of an inactive game.
  function cleanupStatus(req,shouldRetry) {
    req=req||{};
    var gid=id(req.groupId),group=req.group,storage=storageOf(req);
    if(req.actorId!=='__user'||!group||id(group.id)!==gid||
      id(group.ownerId||'__user')!=='__user'||group.userMembership==='left')
      return error('NO_PERMISSION','只有当前群主可以清理本局临时数据');
    var session=game(gid,storage);
    if(!session || (session.status!=='finished'&&session.status!=='cancelled'))
      return error('NOT_FINISHED','当前对局尚不能清理');
    var value=shouldRetry ? cleanupRound(storage,session)
      : {pending:pendingCleanup(storage,session)};
    return {ok:true,cleanupComplete:value.pending===0,cleanupPending:value.pending};
  }
  function getCleanupStatus(req) { return cleanupStatus(req,false); }
  function retryCleanup(req) { return cleanupStatus(req,true); }
  root.GroupGameSessions=Object.freeze({
    registerGame:registerGame, games:games, on:on, getPublic:game,
    start:start, finish:finish, cancel:cancel,
    getCleanupStatus:getCleanupStatus, retryCleanup:retryCleanup,
    castVote:castVote, buildRoleContext:buildRoleContext,
    canWhisper:canWhisper, checkDirectPrivateAllowed:checkDirectPrivateAllowed,
    sendWhisper:sendWhisper, getHostInbox:getHostInbox, getHostConversation:getHostConversation,
    redactPublicStreamText:redactPublicStreamText
  });
})(typeof window!=='undefined'?window:globalThis);
