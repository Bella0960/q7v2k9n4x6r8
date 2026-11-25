/* Group-local simulated role permissions; custom title is never authority. */
(function installGroupAdminPolicy(global){
  'use strict';
  function member(group,id){
    if(!group||!Array.isArray(group.members)||!id||id==='__user')return null;
    var list=group.members.filter(function(m){return m&&String(m.id)===id;});
    return list.length===1?list[0]:null;
  }
  function role(group,id){
    if(!group||!id)return '';
    if(id==='__user')return String(group.ownerId||'__user')===id?'owner':'user';
    var m=member(group,id);
    if(!m)return '';
    return String(group.ownerId||'__user')===id?'owner':m.isAdmin===true?'admin':'member';
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
  global.MAOGroupAdminPolicy={member:member,role:role,title:title,can:can};
})(typeof window!=='undefined'?window:globalThis);
