/* GROUP-CALL-001 C01: independent identity binding for the existing call UI.
 * No network, storage writes, message generation or runtime mounting.
 */
(function(root){
 'use strict';
 const validId=id=>typeof id==='string'&&id.length>0&&id.length<=256&&id===id.trim()&&!/[\u0000-\u001f\u007f]/.test(id)&&!['__proto__','constructor','prototype','__user','__self__'].includes(id);
 function create(options){
  const {getGroupId,hasRole}=options||{},guard=root.MAOGroupWriteGuard,gov=root.GroupGovernance;
  if(!guard||!gov||typeof getGroupId!=='function'||typeof hasRole!=='function')return null;
  function read(){
   try{
    const groupId=getGroupId(),account=guard.account();
    if(!validId(groupId)||!/^g.+/.test(groupId)||typeof account!=='string')return null;
    const row=guard.read(groupId);
    if(!row||row.account!==account||!gov.userIsInGroup(row.group)||!Array.isArray(row.group.members))return null;
    const members=Array.from(row.group.members,m=>m&&m.id!=null?String(m.id):'');
    if(members.some(id=>!validId(id)||id===groupId)||new Set(members).size!==members.length)return null;
    const flags=row.group.members.map((m,i)=>[members[i],!!gov.isMuted(m),hasRole(members[i])===true]).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
    if(guard.account()!==account)return null;
    return {account,groupId,identity:root.__MAO_ACCOUNT_SCOPE__,storage:root.localStorage,
     key:JSON.stringify(flags),participants:flags.filter(x=>!x[1]&&x[2]).map(x=>x[0])};
   }catch{return null;}
  }
  const initial=read();
  if(!initial||!initial.participants.length)return null;
  let closed=false;
  function current(){
   if(closed)return false;
   const f=read();
   if(!f||f.account!==initial.account||f.groupId!==initial.groupId||f.identity!==initial.identity||f.storage!==initial.storage||f.key!==initial.key){closed=true;return false;}
   return true;
  }
  const participants=Object.freeze(initial.participants.slice());
  return Object.freeze({
   isCurrent:current,
   getSnapshot(){return current()?Object.freeze({accountId:initial.account,groupId:initial.groupId,participants}):null;},
   speakerFor(message){
    if(!current()||!message||message.isError||!['assistant','received'].includes(message.role))return null;
    const id=message.memberId;
    return validId(id)&&participants.includes(id)?id:null;
   },
   close(){closed=true;}
  });
 }
 root.MAOGroupCallRoster=Object.freeze({version:1,create});
})(window);
