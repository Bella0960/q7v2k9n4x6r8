/* Group-only portrait overrides. No changes to character or profile data.
 * Optional group field v1; image bytes use the existing backed-up MediaRepository.
 * Never trust member names or use an asset from another account/group.
 */
(function(global){
  'use strict';
  var FIELD='portraitOverridesV1', ASSET=/^as_[A-Z2-7]{32}$/;
  var cache=new Map();
  function scope(){
    var meta=global.document.querySelector('meta[name="mao-account-id"]');
    return meta ? String(meta.content||'').trim() : '';
  }
  function readGroup(groupId){
    if(typeof groupId!=='string'||groupId.charAt(0)!=='g')return null;
    var raw=global.localStorage.getItem('phone_groups');
    var groups=JSON.parse(raw||'[]');
    if(!Array.isArray(groups))throw Error('群聊资料不可读取');
    var group=groups.find(function(g){return g&&String(g.id)===groupId;});
    return group?{raw:raw,groups:groups,group:group,account:scope()}:null;
  }
  function hasMember(group,id){
    return id==='__user'||(Array.isArray(group.members)&&group.members.some(function(m){return m&&String(m.id)===id;}));
  }
  function entries(group,account){
    var record=group&&group[FIELD];
    return account&&record&&record.accountId===account&&Array.isArray(record.entries)?record.entries:[];
  }
  function assetFor(group,id,account){
    if(!group||!hasMember(group,id))return '';
    var item=entries(group,account).find(function(x){return x&&x.memberId===id;});
    return item&&ASSET.test(item.assetId)?item.assetId:'';
  }
  function media(){
    if(!global.PhoneStorage||typeof global.PhoneStorage.MediaRepository!=='function')throw Error('图片存储暂不可用');
    return new global.PhoneStorage.MediaRepository();
  }
  function snapshot(groupId){
    var s=readGroup(groupId);
    if(!s||!s.account)throw Error('无法确认当前群聊或账号，请重新进入');
    return s;
  }
  function stillCurrent(s){
    return scope()===s.account&&global.localStorage.getItem('phone_groups')===s.raw;
  }
  async function save(s,changes){
    if(!s||!s.account||!stillCurrent(s))throw Error('群聊资料已变化，请重新打开');
    if(!(changes instanceof Map))throw Error('无效修改');
    var next=new Map(entries(s.group,s.account).filter(function(x){return x&&hasMember(s.group,x.memberId)&&ASSET.test(x.assetId);}).map(function(x){return [x.memberId,x.assetId];}));
    var repo=media();
    for(var pair of changes){
      var id=pair[0],blob=pair[1];
      if(typeof id!=='string'||!hasMember(s.group,id))throw Error('成员已不存在');
      if(!stillCurrent(s))throw Error('群聊资料已变化，请重新打开');
      if(blob===null){next.delete(id);continue;}
      if(!(blob instanceof Blob)||!/^image\/(?:jpeg|png|webp)$/.test(blob.type)||blob.size>1024*1024)throw Error('图片无效或过大');
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
  function resolve(group,id){
    var account=scope(),gid=String(group&&group.id||''),asset=assetFor(group,String(id),account);
    if(!asset||!account||gid.charAt(0)!=='g')return Promise.resolve('');
    var key=JSON.stringify([account,gid,asset]);
    if(!cache.has(key)){
      var task=Promise.resolve().then(function(){return media().toDataUrl(asset);}).then(function(r){
        return r&&r.ok&&/^data:image\/(?:jpeg|png|webp);base64,/i.test(r.value||'')?r.value:'';
      }).catch(function(){return '';});
      cache.set(key,task);
      if(cache.size>64)cache.delete(cache.keys().next().value);
    }
    return cache.get(key).then(function(url){
      if(scope()!==account)return '';
      try{var fresh=readGroup(gid);return fresh&&fresh.account===account&&assetFor(fresh.group,String(id),account)===asset?url:'';}
      catch(error){return '';}
    });
  }
  global.MAOGroupPortraits={snapshot:snapshot,save:save,resolve:resolve,assetFor:assetFor,scope:scope};
})(window);
