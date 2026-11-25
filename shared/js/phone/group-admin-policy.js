/* Group-local simulated role permissions; custom title is never authority. */
(function installGroupAdminPolicy(global){
  'use strict';
  function member(group,id){
    if(!group||!Array.isArray(group.members)||!id||id==='__user')return null;
    var list=group.members.filter(function(m){return m&&String(m.id)===id;});
    return list.length===1?list[0]:null;
  }
  function isAdmin(m){return !!m&&(typeof m.isAdmin==='boolean'?m.isAdmin:m.memberRole==='admin');}
  function isMuted(m,now){return !!m&&(typeof m.muted==='boolean'?m.muted:m.isMuted===true)&&(!(Number(m.mutedUntil)>0)||Number(m.mutedUntil)>(now==null?Date.now():now));}
  function userOwns(group){return !!group&&group.userMembership!=='left'&&group.userMembership!=='declined'&&String(group.ownerId||'__user')==='__user';}
  function userCanManage(group,action,target){
    if(!userOwns(group)||!Array.isArray(group.members))return false;
    if(action==='invite')return true;
    if(action==='transfer'||action==='admin'||action==='mute'||action==='remove'){
      var m=member(group,target);
      return !!m&&String(group.ownerId||'__user')!==target&&(action!=='remove'||group.members.length>1);
    }
    return false;
  }
  function role(group,id){
    if(!group||!id)return '';
    if(id==='__user')return group.userMembership==='left'||group.userMembership==='declined'?'':userOwns(group)?'owner':'user';
    var m=member(group,id);
    if(!m)return '';
    return String(group.ownerId||'__user')===id?'owner':isAdmin(m)?'admin':'member';
  }
  function title(value){
    if(typeof value!=='string')return null;
    var result=value.trim();
    if(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(result)||Array.from(result).length>20)return null;
    return result;
  }
  function can(group,actor,action,target){
    if(!group||!group.settings||group.settings.allowRoleActions!==true||actor==='__user')return false;
    var r=role(group,actor), targetRole=role(group,target);
    if(!r)return false;
    if(action==='头衔'){
      if(!targetRole||target==='__user')return false;
      return actor===target||r==='owner'||(r==='admin'&&targetRole==='member');
    }
    if(r!=='owner'&&r!=='admin')return false;
    if(action==='改名'||action==='邀请')return true;
    if(action==='移除'||action==='禁言')return !!targetRole&&target!=='__user'&&target!==actor&&targetRole!=='owner'&&(r==='owner'||targetRole==='member');
    return false;
  }
  function findInviteRole(pool,target){
    if(!Array.isArray(pool)||typeof target!=='string'||!target||target==='__user')return null;
    var valid=pool.filter(function(r){return r&&r.id!=null&&String(r.id)&&String(r.id)!=='__user';});
    var matches=valid.filter(function(r){return String(r.id)===target;});
    if(matches.length>1)return null;
    if(matches.length===0)matches=valid.filter(function(r){return String(r.name||'').trim()===target;});
    if(matches.length!==1)return null;
    var id=String(matches[0].id);
    return valid.filter(function(r){return String(r.id)===id;}).length===1?matches[0]:null;
  }
  function defaultMember(r){
    if(!r||r.id==null||!String(r.id)||String(r.id)==='__user')return null;
    return {id:String(r.id),name:r.name||'未命名角色',avatar:r.avatar||'',nickname:'',title:'',isAdmin:false,muted:false,activeFrom:'08:00',activeTo:'23:00',talkativeness:0.5,replyThreshold:55,interests:[],interestTags:[],expertiseTags:[],backgroundTags:[]};
  }
  global.MAOGroupAdminPolicy={member:member,isAdmin:isAdmin,isMuted:isMuted,userOwns:userOwns,userCanManage:userCanManage,role:role,title:title,can:can,findInviteRole:findInviteRole,defaultMember:defaultMember};
})(typeof window!=='undefined'?window:globalThis);
