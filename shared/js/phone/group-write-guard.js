/* Existing phone_groups writes: reject stale group snapshots; no migration. */
(function installGroupWriteGuard(global){
  'use strict';
  function account(){var m=global.document.querySelector('meta[name="mao-account-id"]');return m?String(m.content||'').trim():'';}
  function scopeAllowed(value){return !!value||/^(localhost|127\.0\.0\.1|\[::1\])$/.test(String(global.location&&global.location.hostname||''));}
  function read(id){
    if(typeof id!=='string'||id.charAt(0)!=='g')return null;
    var owner=account();if(!scopeAllowed(owner))return null;
    var raw=global.localStorage.getItem('phone_groups'),groups=JSON.parse(raw||'[]');
    if(!Array.isArray(groups)||account()!==owner)return null;
    var matches=groups.filter(function(x){return x&&String(x.id)===id;});
    return matches.length===1?{id:id,account:owner,serialized:JSON.stringify(matches[0]),group:matches[0]}:null;
  }
  function change(expected,next,remove){
    try{
      var owner=account();
      if(!expected||!scopeAllowed(owner)||(!remove&&(!next||String(next.id)!==expected.id))||owner!==expected.account)return {ok:false,reason:'scope'};
      var raw=global.localStorage.getItem('phone_groups'),groups=JSON.parse(raw||'[]');
      if(!Array.isArray(groups))return {ok:false,reason:'invalid'};
      var matches=groups.reduce(function(out,x,i){if(x&&String(x.id)===expected.id)out.push(i);return out;},[]);
      if(matches.length!==1||JSON.stringify(groups[matches[0]])!==expected.serialized)return {ok:false,reason:'stale'};
      if(remove)groups.splice(matches[0],1);else groups[matches[0]]=next;
      var encoded=JSON.stringify(groups);
      if(account()!==expected.account||global.localStorage.getItem('phone_groups')!==raw)return {ok:false,reason:'stale'};
      global.localStorage.setItem('phone_groups',encoded);
      if(account()!==expected.account||global.localStorage.getItem('phone_groups')!==encoded)return {ok:false,reason:'unconfirmed'};
      return remove?{ok:true}:{ok:true,expected:{id:expected.id,account:expected.account,serialized:JSON.stringify(next)}};
    }catch(error){return {ok:false,reason:'storage'};}
  }
  function create(expectedAccount,next){
    try{
      var owner=account();
      if(typeof expectedAccount!=='string'||!scopeAllowed(owner)||owner!==expectedAccount)return {ok:false,reason:'scope'};
      if(!next||typeof next.id!=='string'||next.id.charAt(0)!=='g'||next.id.length<2)return {ok:false,reason:'invalid'};
      var raw=global.localStorage.getItem('phone_groups'),groups=JSON.parse(raw===null?'[]':raw);
      if(!Array.isArray(groups))return {ok:false,reason:'invalid'};
      if(groups.some(function(g){return g&&String(g.id)===next.id;}))return {ok:false,reason:'duplicate'};
      var encoded=JSON.stringify(groups.concat([next]));
      if(account()!==owner||global.localStorage.getItem('phone_groups')!==raw)return {ok:false,reason:'stale'};
      global.localStorage.setItem('phone_groups',encoded);
      if(account()!==owner||global.localStorage.getItem('phone_groups')!==encoded)return {ok:false,reason:'unconfirmed'};
      return {ok:true};
    }catch(error){return {ok:false,reason:'storage'};}
  }
  function commit(expected,next){return change(expected,next,false);}
  function remove(expected){return change(expected,null,true);}
  global.MAOGroupWriteGuard={read:read,create:create,commit:commit,remove:remove,account:account};
})(window);
