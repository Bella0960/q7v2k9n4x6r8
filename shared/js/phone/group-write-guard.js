/* Existing phone_groups writes: reject stale group snapshots; no migration. */
(function installGroupWriteGuard(global){
  'use strict';
  function account(){var m=global.document.querySelector('meta[name="mao-account-id"]');return m?String(m.content||'').trim():'';}
  function read(id){
    if(typeof id!=='string'||id.charAt(0)!=='g')return null;
    var raw=global.localStorage.getItem('phone_groups'),groups=JSON.parse(raw||'[]');
    if(!Array.isArray(groups))return null;
    var matches=groups.filter(function(x){return x&&String(x.id)===id;});
    return matches.length===1?{id:id,account:account(),serialized:JSON.stringify(matches[0]),group:matches[0]}:null;
  }
  function commit(expected,next){
    try{
      if(!expected||!next||String(next.id)!==expected.id||account()!==expected.account)return {ok:false,reason:'scope'};
      var raw=global.localStorage.getItem('phone_groups'),groups=JSON.parse(raw||'[]');
      if(!Array.isArray(groups))return {ok:false,reason:'invalid'};
      var matches=groups.reduce(function(out,x,i){if(x&&String(x.id)===expected.id)out.push(i);return out;},[]);
      if(matches.length!==1||JSON.stringify(groups[matches[0]])!==expected.serialized)return {ok:false,reason:'stale'};
      groups[matches[0]]=next;
      var encoded=JSON.stringify(groups);
      if(account()!==expected.account||global.localStorage.getItem('phone_groups')!==raw)return {ok:false,reason:'stale'};
      global.localStorage.setItem('phone_groups',encoded);
      if(account()!==expected.account||global.localStorage.getItem('phone_groups')!==encoded)return {ok:false,reason:'unconfirmed'};
      return {ok:true,expected:{id:expected.id,account:expected.account,serialized:JSON.stringify(next)}};
    }catch(error){return {ok:false,reason:'storage'};}
  }
  global.MAOGroupWriteGuard={read:read,commit:commit,account:account};
})(window);
