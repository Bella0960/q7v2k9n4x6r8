/* MAOMAO local group private-message receipt repair.
 * Repair only metadata cards for explicitly marked, already-saved role DMs.
 * Private message bodies never enter group history, group memory, or logs.
 * This is local crash/partial-write recovery, NOT a cloud transaction.
 */
(function (root) {
  'use strict';
  if (root.GroupPrivateReceiptRecovery) return;
  function str(x) { return String(x == null ? '' : x).trim(); }
  function validId(x) { return /^[A-Za-z0-9_-]{1,120}$/.test(str(x)); }
  function fail(code) { return { ok:false, code:code, repaired:0 }; }
  function reconcile(req) {
    req=req||{};
    var group=req.group, gid=str(group&&group.id);
    if(!validId(gid)||!group||group.userMembership==='left'||
       !Array.isArray(group.members)||group.members.length>100||
       typeof req.readGroupHistory!=='function'||
       typeof req.readRoleHistory!=='function'||
       typeof req.saveGroupHistory!=='function') return fail('INVALID_SCOPE');
    var history;
    try { history=req.readGroupHistory(); } catch(e) { return fail('GROUP_READ_FAILED'); }
    if(!Array.isArray(history))return fail('GROUP_READ_FAILED');
    var present=Object.create(null), proposed=[], seenRoles=Object.create(null), unreadable=0;
    history.forEach(function(card) {
      if(card&&card.type==='group_private'&&validId(card.privateMessageId)&&
         validId(card.privateRoleId||card.senderId)&&str(card.fromGroupId)===gid) {
        present[str(card.privateRoleId||card.senderId)+'|'+str(card.privateMessageId)]=true;
      }
    });
    group.members.forEach(function(member) {
      var rid=str(member&&member.id);
      if(!validId(rid)||seenRoles[rid])return;
      seenRoles[rid]=true;
      var messages;
      try {messages=req.readRoleHistory(rid);}catch(e){unreadable++;return;}
      if(!Array.isArray(messages)){unreadable++;return;}
      // A bounded scan avoids a large synchronous UI stall with old chat history.
      messages.slice(-600).forEach(function(message) {
        if(!message||message.role!=='assistant'||
           message.privateFromGroup!==true||message.privateGroupReceiptV1!==true||
           str(message.fromGroupId)!==gid||!validId(message.mid)||
           !str(message.text))return;
        var key=rid+'|'+str(message.mid);
        if(present[key])return;
        var when=Number(message.time);
        if(!Number.isFinite(when)||when<=0)return;
        present[key]=true;
        // Deliberately omit text; the real body is exclusively in role history.
        proposed.push({role:'assistant',type:'group_private',text:'',
          mid:'grp_receipt_'+rid+'_'+str(message.mid),
          privateMessageId:str(message.mid),privateRoleId:rid,senderId:rid,
          senderName:str(member.nickname||member.name||'群成员').slice(0,60),
          name:str(member.nickname||member.name||'群成员').slice(0,60),
          fromGroupId:gid,time:when});
      });
    });
    if(!proposed.length)return {ok:unreadable===0,repaired:0,unreadable:unreadable,
      code:unreadable?'ROLE_READ_FAILED':'NOTHING_TO_REPAIR'};
    // Atomic for this single group-history key; the caller must verify readback.
    try {
      if(req.saveGroupHistory(history.concat(proposed))!==true)
        return {ok:false,code:'SAVE_FAILED',repaired:0,unreadable:unreadable};
      var readback=req.readGroupHistory();
      if(!Array.isArray(readback))return fail('VERIFY_FAILED');
      var verified=proposed.every(function(card) {
        return readback.some(function(saved) {
          return saved&&saved.type==='group_private'&&saved.text===''&&
            saved.mid===card.mid&&saved.privateMessageId===card.privateMessageId&&
            saved.privateRoleId===card.privateRoleId&&saved.fromGroupId===gid;
        });
      });
      if(!verified)return fail('VERIFY_FAILED');
      return {ok:unreadable===0,repaired:proposed.length,unreadable:unreadable,
        code:unreadable?'PARTIAL_RECOVERY':'RECOVERED'};
    } catch(e){return fail('SAVE_FAILED');}
  }
  root.GroupPrivateReceiptRecovery=Object.freeze({reconcile:reconcile});
})(typeof window!=='undefined'?window:globalThis);
