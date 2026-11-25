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
      if(account()!==expected.account||global.localStorage.getItem('phone_groups')!==raw||account()!==expected.account)return {ok:false,reason:'stale'};
      global.localStorage.setItem('phone_groups',encoded);
      if(account()!==expected.account||global.localStorage.getItem('phone_groups')!==encoded||account()!==expected.account)return {ok:false,reason:'unconfirmed'};
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
      if(account()!==owner||global.localStorage.getItem('phone_groups')!==raw||account()!==owner)return {ok:false,reason:'stale'};
      global.localStorage.setItem('phone_groups',encoded);
      if(account()!==owner||global.localStorage.getItem('phone_groups')!==encoded||account()!==owner)return {ok:false,reason:'unconfirmed'};
      return {ok:true};
    }catch(error){return {ok:false,reason:'storage'};}
  }
  function matches(expected,speakerId){
    try{
      if(!expected)return false;
      var fresh=read(expected.id);
      if(!fresh||fresh.account!==expected.account||fresh.serialized!==expected.serialized)return false;
      if(speakerId==null)return true;
      if(typeof speakerId!=='string'||!speakerId||speakerId==='__user')return false;
      var members=Array.isArray(fresh.group.members)?fresh.group.members:[];
      var found=members.filter(function(m){return m&&String(m.id)===speakerId;});
      return found.length===1&&!found[0].muted;
    }catch(error){return false;}
  }
  function preferenceKey(expected,kind){
    if(!expected||typeof expected.id!=='string'||expected.id.charAt(0)!=='g')return '';
    var prefixes={alias:'chat_group_alias_',notice:'chat_group_notice_',pin:'chat_pin_',memory:'chat_memory_limit_',time:'chat_time_config_',sound:'sound_char_'};
    return Object.prototype.hasOwnProperty.call(prefixes,kind)?prefixes[kind]+expected.id:'';
  }
  function validPreference(kind,value){
    if(typeof value!=='string')return false;
    if(kind==='pin')return value==='true'||value==='false';
    if(kind==='memory')return ['10','20','30','50'].indexOf(value)!==-1;
    if(kind==='time'){
      try{var parsed=JSON.parse(value);return !!parsed&&['off','real','virtual'].indexOf(parsed.mode)!==-1&&typeof parsed.virtualTimeStr==='string'&&(parsed.mode!=='virtual'||!!parsed.virtualTimeStr.trim());}catch(error){return false;}
    }
    if(kind==='sound')return !!value&&value.length<=128;
    return kind==='alias'||kind==='notice';
  }
  function readPreference(expected,kind){
    try{
      var key=preferenceKey(expected,kind);
      if(!key||!matches(expected))return null;
      var raw=global.localStorage.getItem(key);
      return matches(expected)?{group:expected,kind:kind,raw:raw}:null;
    }catch(error){return null;}
  }
  function writePreference(snapshot,value){
    try{
      if(!snapshot||!validPreference(snapshot.kind,value))return {ok:false,reason:'invalid'};
      var key=preferenceKey(snapshot.group,snapshot.kind);
      if(!key||!matches(snapshot.group))return {ok:false,reason:'scope'};
      if(global.localStorage.getItem(key)!==snapshot.raw||!matches(snapshot.group)||global.localStorage.getItem(key)!==snapshot.raw||account()!==snapshot.group.account)return {ok:false,reason:'stale'};
      global.localStorage.setItem(key,value);
      return matches(snapshot.group)&&global.localStorage.getItem(key)===value&&account()===snapshot.group.account?{ok:true}:{ok:false,reason:'unconfirmed'};
    }catch(error){return {ok:false,reason:'storage'};}
  }
  function commit(expected,next){return change(expected,next,false);}
  function remove(expected){return change(expected,null,true);}
  global.MAOGroupWriteGuard={read:read,matches:matches,readPreference:readPreference,writePreference:writePreference,create:create,commit:commit,remove:remove,account:account};
})(window);
