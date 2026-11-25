/* Group-only portrait overrides. No changes to character or profile data.
 * Optional group field v1; image bytes use the existing backed-up MediaRepository.
 * Never trust member names or use an asset from another account/group.
 */
(function(global){
  'use strict';
  var FIELD='portraitOverridesV1', ASSET=/^as_[A-Z2-7]{32}$/;
  var cache=new Map(), readCache={raw:null,account:null,groups:null};
  function scope(){
    var guard=global.MAOGroupWriteGuard;
    return guard&&typeof guard.account==='function'?guard.account():null;
  }
  function readGroup(groupId){
    if(typeof groupId!=='string'||groupId.charAt(0)!=='g')return null;
    var account=scope();if(!account)return null;
    var raw=global.localStorage.getItem('phone_groups');
    var groups=JSON.parse(raw||'[]');
    if(!Array.isArray(groups)||scope()!==account)throw Error('群聊资料不可读取');
    var matches=groups.filter(function(g){return g&&String(g.id)===groupId;});
    return matches.length===1?{raw:raw,groups:groups,group:matches[0],account:account}:null;
  }
  function joined(group){return !!group&&group.userMembership!=='left'&&group.userMembership!=='declined';}
  function hasMember(group,id){
    return joined(group)&&(id==='__user'||(Array.isArray(group.members)&&group.members.filter(function(m){return m&&String(m.id)===id;}).length===1));
  }
  function mayEdit(group,id){
    return hasMember(group,id)&&(id==='__user'||(global.GroupGovernance&&global.GroupGovernance.rank(group,'__user')>=2));
  }
  function entries(group,account){
    var record=group&&group[FIELD];
    return account&&record&&record.accountId===account&&Array.isArray(record.entries)?record.entries:[];
  }
  function assetFor(group,id,account){
    if(!group||!hasMember(group,id))return '';
    var matches=entries(group,account).filter(function(x){return x&&x.memberId===id;});
    return matches.length===1&&ASSET.test(matches[0].assetId)?matches[0].assetId:'';
  }
  function media(){
    if(!global.PhoneStorage||typeof global.PhoneStorage.MediaRepository!=='function')throw Error('图片存储暂不可用');
    return new global.PhoneStorage.MediaRepository();
  }
  function snapshot(groupId){
    var s=readGroup(groupId);
    if(!s||!s.account||!joined(s.group))throw Error('无法确认当前群聊或账号，请重新进入');
    if(s.group[FIELD]&&(s.group[FIELD].accountId!==s.account||!Array.isArray(s.group[FIELD].entries)))throw Error('头像资料归属不匹配或格式损坏');
    var list=entries(s.group,s.account),ids=new Set();
    for(var entry of list){
      if(!entry||typeof entry.memberId!=='string'||!ASSET.test(entry.assetId)||ids.has(entry.memberId))throw Error('头像资料损坏，请先恢复完整备份');
      ids.add(entry.memberId);
    }
    s.expected={id:groupId,account:s.account,serialized:JSON.stringify(s.group)};
    return s;
  }
  function stillCurrent(s){
    if(!s||!s.expected||scope()!==s.account)return false;
    try{var current=readGroup(s.expected.id);return !!current&&current.account===s.account&&JSON.stringify(current.group)===s.expected.serialized;}
    catch(error){return false;}
  }
  async function save(s,changes,active){
    function valid(){try{return stillCurrent(s)&&(active==null||typeof active==='function'&&active()===true);}catch(error){return false;}}
    if(!s||!s.account||!valid())throw Error('群聊资料已变化，请重新打开');
    if(!(changes instanceof Map))throw Error('无效修改');
    var original=JSON.parse(s.expected.serialized),next=new Map(entries(original,s.account).map(function(x){return [x.memberId,x.assetId];}));
    if(changes.size===0)return true;
    // Validate all edits before starting any media writes.
    for(var pair of changes){
      if(typeof pair[0]!=='string'||!mayEdit(original,pair[0]))throw Error('没有修改该成员头像的权限');
      var candidate=pair[1];
      if(candidate!==null&&(!(candidate instanceof Blob)||!/^image\/(?:jpeg|png|webp)$/.test(candidate.type)||candidate.size===0||candidate.size>1024*1024))throw Error('图片无效或过大');
    }
    var repo=null;
    for(var pair of changes){
      var id=pair[0],blob=pair[1];
      if(typeof id!=='string'||!mayEdit(original,id))throw Error('成员已不存在或没有编辑权限');
      if(!valid())throw Error('群聊资料已变化，请重新打开');
      if(blob===null){next.delete(id);continue;}
      if(!(blob instanceof Blob)||!/^image\/(?:jpeg|png|webp)$/.test(blob.type)||blob.size>1024*1024)throw Error('图片无效或过大');
      if(!repo)repo=media();
      var result=await repo.putBlob(blob,{type:'image',mimeType:blob.type,ownerType:'group-portrait',ownerId:JSON.stringify([s.account,String(s.group.id),id])});
      if(!result||!result.ok||!result.value||!ASSET.test(result.value.assetId))throw Error('头像存储失败');
      if(!valid())throw Error('群聊资料已变化，请重新打开');
      var verified=await repo.getBlob(result.value.assetId);
      if(!valid()||!verified||!verified.ok||!verified.value||verified.value.size!==blob.size||verified.value.type!==blob.type)throw Error('头像读取验证失败');
      var refs=await repo.listByOwner('group-portrait',JSON.stringify([s.account,String(original.id),id]));
      if(!valid()||!refs||!refs.ok||!Array.isArray(refs.value)||!refs.value.some(function(ref){return ref&&ref.assetId===result.value.assetId;}))throw Error('头像引用验证失败');
      next.set(id,result.value.assetId);
    }
    if(!valid())throw Error('群聊资料已变化，请重新打开');
    var updated=original;
    updated[FIELD]={accountId:s.account,entries:Array.from(next,function(x){return {memberId:x[0],assetId:x[1]};})};
    var guard=global.MAOGroupWriteGuard;
    if(!guard||typeof guard.commit!=='function')throw Error('群资料保存保护暂不可用');
    var result=guard.commit(s.expected,updated);
    if(!result.ok)throw Error('群聊头像保存失败，请重新打开');
    cache.clear();
    return true;
  }
  function forgetMember(group,id){
    var record=group&&group[FIELD];
    if(!record||record.accountId!==scope()||!Array.isArray(record.entries))return;
    record.entries=record.entries.filter(function(x){return x&&x.memberId!==String(id);});
  }
  function currentAsset(gid,id,account){
    try{
      if(!account||scope()!==account)return '';
      var raw=global.localStorage.getItem('phone_groups');
      if(scope()!==account)return '';
      if(readCache.raw!==raw||readCache.account!==account||!readCache.groups){
        var list=JSON.parse(raw||'[]');
        if(!Array.isArray(list))return '';
        readCache={raw:raw,account:account,groups:list};
      }
      var matches=readCache.groups.filter(function(g){return g&&String(g.id)===gid;});
      return matches.length===1?assetFor(matches[0],id,account):'';
    }catch(error){return '';}
  }
  function resolve(group,id){
    id=String(id);
    var account=scope(),gid=String(group&&group.id||''),asset=assetFor(group,id,account);
    if(!asset||!account||gid.charAt(0)!=='g'||currentAsset(gid,id,account)!==asset)return Promise.resolve('');
    var key=JSON.stringify([account,gid,id,asset]);
    if(!cache.has(key)){
      var task=Promise.resolve().then(async function(){
        if(scope()!==account||currentAsset(gid,id,account)!==asset)return '';
        var repo=media();
        var refs=await repo.listByOwner('group-portrait',JSON.stringify([account,gid,id]));
        if(scope()!==account||currentAsset(gid,id,account)!==asset||!refs||!refs.ok||!Array.isArray(refs.value)||!refs.value.some(function(x){return x&&x.assetId===asset;}))return '';
        var r=await repo.toDataUrl(asset);
        return r&&r.ok&&/^data:image\/(?:jpeg|png|webp);base64,/i.test(r.value||'')?r.value:'';
      }).catch(function(){return '';});
      cache.set(key,task);
      task.then(function(url){if(!url&&cache.get(key)===task)cache.delete(key);});
      if(cache.size>64)cache.delete(cache.keys().next().value);
    }
    return cache.get(key).then(function(url){
      return scope()===account&&currentAsset(gid,id,account)===asset?url:'';
    });
  }
  global.MAOGroupPortraits={snapshot:snapshot,save:save,resolve:resolve,assetFor:assetFor,scope:scope,forgetMember:forgetMember};
})(window);
