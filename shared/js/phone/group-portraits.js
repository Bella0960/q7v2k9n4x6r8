/* Group-only portrait overrides. No changes to character or profile data.
 * Optional group field v1; image bytes use the existing backed-up MediaRepository.
 * Never trust member names or use an asset from another account/group.
 */
(function(global){
  'use strict';
  var FIELD='portraitOverridesV1', ASSET=/^as_[A-Z2-7]{32}$/;
  var cache=new Map(), readCache={raw:null,account:null,groups:null};
  function scope(){
    var meta=global.document.querySelector('meta[name="mao-account-id"]');
    return meta ? String(meta.content||'').trim() : '';
  }
  function readGroup(groupId){
    if(typeof groupId!=='string'||groupId.charAt(0)!=='g')return null;
    var raw=global.localStorage.getItem('phone_groups');
    var groups=JSON.parse(raw||'[]');
    if(!Array.isArray(groups))throw Error('群聊资料不可读取');
    var matches=groups.filter(function(g){return g&&String(g.id)===groupId;});
    return matches.length===1?{raw:raw,groups:groups,group:matches[0],account:scope()}:null;
  }
  function hasMember(group,id){
    return id==='__user'||(Array.isArray(group.members)&&group.members.filter(function(m){return m&&String(m.id)===id;}).length===1);
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
    if(!s||!s.account)throw Error('无法确认当前群聊或账号，请重新进入');
    if(s.group[FIELD]&&s.group[FIELD].accountId!==s.account)throw Error('头像资料归属不匹配');
    return s;
  }
  function stillCurrent(s){
    return scope()===s.account&&global.localStorage.getItem('phone_groups')===s.raw;
  }
  async function save(s,changes){
    if(!s||!s.account||!stillCurrent(s))throw Error('群聊资料已变化，请重新打开');
    if(!(changes instanceof Map))throw Error('无效修改');
    var next=new Map(entries(s.group,s.account).filter(function(x){return x&&hasMember(s.group,x.memberId)&&ASSET.test(x.assetId);}).map(function(x){return [x.memberId,x.assetId];}));
    var repo=null;
    for(var pair of changes){
      var id=pair[0],blob=pair[1];
      if(typeof id!=='string'||!hasMember(s.group,id))throw Error('成员已不存在');
      if(!stillCurrent(s))throw Error('群聊资料已变化，请重新打开');
      if(blob===null){next.delete(id);continue;}
      if(!(blob instanceof Blob)||!/^image\/(?:jpeg|png|webp)$/.test(blob.type)||blob.size>1024*1024)throw Error('图片无效或过大');
      if(!repo)repo=media();
      var result=await repo.putBlob(blob,{type:'image',mimeType:blob.type,ownerType:'group-portrait',ownerId:JSON.stringify([s.account,String(s.group.id),id])});
      if(!result||!result.ok||!result.value||!ASSET.test(result.value.assetId))throw Error('头像存储失败');
      if(!stillCurrent(s))throw Error('群聊资料已变化，请重新打开');
      var verified=await repo.getBlob(result.value.assetId);
      if(!verified||!verified.ok)throw Error('头像读取验证失败');
      next.set(id,result.value.assetId);
    }
    if(!stillCurrent(s))throw Error('群聊资料已变化，请重新打开');
    s.group[FIELD]={accountId:s.account,entries:Array.from(next,function(x){return {memberId:x[0],assetId:x[1]};})};
    var encoded=JSON.stringify(s.groups);
    global.localStorage.setItem('phone_groups',encoded);
    if(global.localStorage.getItem('phone_groups')!==encoded)throw Error('群聊头像保存未确认');
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
      var raw=global.localStorage.getItem('phone_groups');
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
        var repo=media();
        var refs=await repo.listByOwner('group-portrait',JSON.stringify([account,gid,id]));
        if(!refs||!refs.ok||!Array.isArray(refs.value)||!refs.value.some(function(x){return x&&x.assetId===asset;}))return '';
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
